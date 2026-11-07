import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeStructuredAi } from "@/ai/client";

describe("structured AI client response parsing", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
    localStorage.removeItem("careeradapt-ai-settings");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("transports a provider-only mock selection instead of silently using the server provider", async () => {
    localStorage.setItem("careeradapt-ai-settings", JSON.stringify({ baseUrl: "", model: "", provider: "mock" }));
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true, task: "resume-tailor-diff", promptVersion: "test", output: { value: "ok" }, meta: { provider: "mock" } })));
    vi.stubGlobal("fetch", fetchMock);
    await invokeStructuredAi({ task: "resume-tailor-diff", businessInput: {}, outputSchema: z.object({ value: z.string() }) });
    const headers = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect((headers?.headers as Record<string, string>)["x-ai-config"]).toBeTruthy();
    localStorage.removeItem("careeradapt-ai-settings");
  });

  it("ends a stalled tailoring request with a timeout and one attempt", async () => {
    vi.useFakeTimers();
    // Use a controllable deadline while exercising the actual request abort/error path.
    const controller = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("deadline", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = invokeStructuredAi({ task: "resume-tailor-diff", businessInput: {}, outputSchema: z.object({ value: z.string() }) });
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, errorCode: "provider_timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("classifies a malformed endpoint response without leaking a native SyntaxError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "{\"ok\":false,\"error\":",
      { status: 502, headers: { "Content-Type": "application/json" } }
    )));

    const result = await invokeStructuredAi({
      task: "resume-document-mapper",
      businessInput: { rawText: "[]", inputHash: "client-invalid-json" },
      outputSchema: z.object({ value: z.string() })
    });

    expect(result).toMatchObject({
      ok: false,
      errorCode: "structured_endpoint_invalid_json",
      log: { errorCode: "structured_endpoint_invalid_json" }
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
