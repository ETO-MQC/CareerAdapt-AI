import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { encodeAiSettingsForHeader, type AiSettings } from "@/services/storage/aiSettings";
import { POST as postAiTest } from "@/app/api/ai/test/route";

/**
 * V4-P0 S-2 route contract: the credential must never arrive from the renderer.
 *
 * `/api/ai/test` is the route most exposed to header injection, so it is the right place to pin
 * that a credential in `x-ai-config` is neither honoured nor forwarded upstream, and that the
 * provider is contacted with the server-resolved credential instead.
 */

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  invoke: vi.fn(),
  probe: vi.fn()
}));

vi.mock("server-only", () => ({}));

// The provider is NOT mocked: the point of this contract is that the real implementation resolves
// the credential server-side and reports its true source in `configurationDiagnostic`.
// Only the network layer is stubbed. `connectionDiagnosticsWithHttp` is replaced for the same
// reason as in aiConnectionTestP46e: it expects a full diagnostics shape that a stubbed probe
// does not produce.
vi.mock("@/ai/providers/transportDiagnostics", () => ({
  probeAiProviderTransport: mocks.probe,
  connectionDiagnosticsWithHttp: (diagnostics: Record<string, unknown>, input: Record<string, unknown>) => ({
    ...diagnostics,
    http: input,
    latencyMs: Number(diagnostics.latencyMs ?? 0) + Number(input.latencyMs ?? 0)
  })
}));

const SECRET = "unit-test-provider-secret-do-not-log";
const STORED_KEY = "server-side-stored-key";

const settings: AiSettings = {
  provider: "openai-compatible",
  baseUrl: "https://provider.example/v1",
  apiKey: SECRET,
  model: "candidate-model"
};

beforeEach(() => {
  // The server resolves the credential from its own configuration, never from the header.
  vi.stubEnv("AI_API_KEY", STORED_KEY);
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
    data: [{ id: "candidate-model" }]
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));
  mocks.invoke.mockReset();
  mocks.probe.mockReset();
  mocks.probe.mockResolvedValue({
    failureCode: undefined,
    diagnostics: { runtime: "node-test", dns: { status: "ok" }, tcp: { status: "ok" }, tls: { status: "ok" }, http: { status: "not_attempted" } }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function legacyHeaderRequest() {
  return new NextRequest("http://127.0.0.1/api/ai/test", {
    method: "POST",
    headers: {
      "x-ai-config": btoa(encodeURIComponent(JSON.stringify({
        provider: "openai-compatible",
        baseUrl: "https://provider.example/v1",
        apiKey: SECRET,
        model: "candidate-model"
      })))
    }
  });
}

describe("V4-P0 S-2 provider route credential contract", () => {
  it("ignores a credential supplied in the header and uses the server configuration", async () => {
    const response = await postAiTest(legacyHeaderRequest());
    const payload = await response.json();

    // The legacy key is neither reported as the source nor used.
    expect(payload.configuration?.sources?.credential).not.toBe("custom_header");
    expect(payload.configuration?.credentialPresent).toBe(true);
    expect(JSON.stringify(payload), "the response must not echo a renderer-supplied key").not.toContain(SECRET);

    // Upstream is contacted with the server-side credential, never the header one.
    const upstreamAuth = mocks.fetch.mock.calls
      .map((call) => (call[1]?.headers as Record<string, string> | undefined)?.Authorization)
      .filter(Boolean);
    expect(upstreamAuth.length).toBeGreaterThan(0);
    for (const authorization of upstreamAuth) {
      expect(authorization).toContain(STORED_KEY);
      expect(authorization).not.toContain(SECRET);
    }
  });

  it("carries no credential in the header this client encodes", async () => {
    const encoded = encodeAiSettingsForHeader(settings);
    expect(encoded).not.toContain(SECRET);

    const response = await postAiTest(new NextRequest("http://127.0.0.1/api/ai/test", {
      method: "POST",
      headers: { "x-ai-config": encoded }
    }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(payload.configuration?.sources?.credential).toBe("server_env");
  });

  it("reports a missing credential instead of contacting the provider without one", async () => {
    vi.stubEnv("AI_API_KEY", "");
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }));

    const response = await postAiTest(new NextRequest("http://127.0.0.1/api/ai/test", {
      method: "POST",
      headers: { "x-ai-config": encodeAiSettingsForHeader({ ...settings, apiKey: "" }) }
    }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.code).toBe("missing_ai_config");
    expect(mocks.fetch, "no provider call may be made without a credential").not.toHaveBeenCalled();
  });
});