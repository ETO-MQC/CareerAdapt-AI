import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderError, OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";

const settings = {
  baseUrl: "https://openrouter.ai/api/v1",
  apiKey: "test-key",
  model: "inclusionai/ling-3.0-flash-vl:free",
  provider: "openrouter"
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAI-compatible structured requests", () => {
  it("does not send response_format because compatible providers may reject it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" }, finish_reason: "stop" }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiCompatibleProvider(settings);
    const response = await provider.invoke({
      systemPrompt: "Return JSON.",
      userPrompt: "{}",
      maxOutputChars: 1000
    });

    const requestBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty("response_format");
    expect(response.output).toEqual({ ok: true });
  });

  it("keeps a redacted provider error message in the safe diagnostic", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "This model does not support response_format" }
    }), { status: 400 })));

    const provider = new OpenAiCompatibleProvider(settings);
    const error = await provider.invoke({
      systemPrompt: "Return JSON.",
      userPrompt: "{}",
      maxOutputChars: 1000
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AiProviderError);
    expect(error).toMatchObject({
      code: "provider_http_400",
      diagnostic: {
        safeErrorCode: "provider_http_400",
        providerMessage: "This model does not support response_format"
      }
    });
  });
});
