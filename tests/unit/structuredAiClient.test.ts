import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { invokeStructuredAi } from "@/ai/client";

describe("structured AI client response parsing", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.stubGlobal("fetch", originalFetch);
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
