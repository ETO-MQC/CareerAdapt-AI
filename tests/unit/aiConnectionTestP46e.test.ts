import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encodeAiSettingsForHeader } from "@/services/storage/aiSettings";
import type { AiSettings } from "@/services/storage/aiSettings";
import { POST } from "@/app/api/ai/test/route";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  invoke: vi.fn(async () => ({
    provider: "custom",
    model: "candidate-model",
    output: { ok: true },
    outputLength: 11
  })),
  probe: vi.fn(async () => ({
    diagnostics: {
      runtime: "node-test",
      dns: { status: "ok" as const },
      tcp: { status: "ok" as const },
      tls: { status: "ok" as const },
      http: { status: "not_attempted" as const },
      latencyMs: 8
    }
  }))
}));

vi.mock("@/ai/providers/openAiCompatibleProvider", () => ({
  OpenAiCompatibleProvider: class {
    provider = "custom";
    model = "candidate-model";
    configurationDiagnostic = {
      provider: "custom",
      model: "candidate-model",
      baseUrlHostPath: "provider.example/v1",
      credentialPresent: true,
      authMode: "bearer_custom_header" as const,
      sources: {
        provider: "custom_header" as const,
        model: "custom_header" as const,
        baseUrl: "custom_header" as const,
        credential: "custom_header" as const
      }
    };

    async invoke(request: Record<string, unknown>) {
      const response = await fetch("https://provider.example/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: this.model, ...request })
      });
      await response.text();
      return mocks.invoke();
    }
  }
}));

vi.mock("@/ai/providers/transportDiagnostics", () => ({
  probeAiProviderTransport: mocks.probe,
  connectionDiagnosticsWithHttp: (diagnostics: Record<string, unknown>, input: Record<string, unknown>) => ({
    ...diagnostics,
    http: input,
    latencyMs: Number(diagnostics.latencyMs ?? 0) + Number(input.latencyMs ?? 0)
  })
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetch.mockReset();
  mocks.invoke.mockClear();
  mocks.probe.mockClear();
});

const settings: AiSettings = {
  provider: "openai-compatible",
  baseUrl: "https://provider.example/v1",
  apiKey: "candidate-key",
  model: "candidate-model"
};

function request() {
  return new NextRequest("http://127.0.0.1/api/ai/test", {
    method: "POST",
    headers: { "x-ai-config": encodeAiSettingsForHeader(settings) }
  });
}

function latencyRequest() {
  return new NextRequest("http://127.0.0.1/api/ai/test", {
    method: "POST",
    headers: {
      "x-ai-config": encodeAiSettingsForHeader(settings),
      "x-ai-test-mode": "latency"
    }
  });
}

async function responseBody(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("P4.6e candidate connection test", () => {
  it("uses GET /models when the requested model is advertised", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: "candidate-model" }, { id: "other-model" }]
    }), { status: 200 }));

    const response = await POST(request());
    const body = await responseBody(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, model: "candidate-model", latencyMs: expect.any(Number) });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0][0]).toBe("https://provider.example/v1/models");
  });

  it("reports invalid credentials without invoking a completion", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    const response = await POST(request());
    const body = await responseBody(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      code: "provider_http_401",
      message: "API Key 无效或没有模型权限。"
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a missing requested model from a successful model list", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      data: [{ id: "different-model" }]
    }), { status: 200 }));

    const response = await POST(request());
    const body = await responseBody(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      code: "provider_model_not_found",
      message: "未找到这个模型，请检查模型名称。"
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("uses one minimal completion only when /models is unavailable", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch
      .mockResolvedValueOnce(new Response("not implemented", { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }]
      }), { status: 200 }));

    const response = await POST(request());
    const body = await responseBody(response);
    const completionInit = mocks.fetch.mock.calls[1][1] as RequestInit;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(String(completionInit.body)).not.toContain("\"tools\"");
  });

  it("measures one minimal completion for the configured model", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }]
    }), { status: 200 }));

    const response = await POST(latencyRequest());
    const body = await responseBody(response);
    const completionInit = mocks.fetch.mock.calls[0][1] as RequestInit;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, model: "candidate-model", latencyMs: expect.any(Number) });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(String(completionInit.body)).toContain("\"model\":\"candidate-model\"");
    expect(String(completionInit.body)).not.toContain("\"tools\"");
    expect(mocks.probe).not.toHaveBeenCalled();
  });

  it("maps a models-endpoint DNS failure to an actionable connection message", async () => {
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockRejectedValueOnce(Object.assign(new Error("dns failed"), { code: "ENOTFOUND" }));

    const response = await POST(request());
    const body = await responseBody(response);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      code: "provider_dns_failed",
      message: "无法连接 API 地址，请检查地址和网络。"
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
