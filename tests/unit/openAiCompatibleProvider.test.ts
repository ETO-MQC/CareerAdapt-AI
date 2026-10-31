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
  it.each([undefined, "low"] as const)("uses Radeon top-level low for extraction with requested effort %s", async reasoningEffort => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await new OpenAiCompatibleProvider({ ...settings, provider: "custom:amd", baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B" })
      .invoke({ systemPrompt: "JSON", userPrompt: "anonymous", maxOutputChars: 1000, reasoningEffort });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(body).not.toHaveProperty("reasoning");
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("keeps Radeon low on streamed direct text without imposing the evaluator ceiling", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: "OK" }, finish_reason: "stop" }] })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://developer.amd.com.cn/radeon/api/v1", provider: "custom:amd", model: "Qwen3.8-27B" });
    for await (const chunk of provider.streamText({ systemPrompt: "Brief", userPrompt: "Test", maxOutputChars: 100 })) void chunk;
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });
  it("finishes structured JSON on the terminal stream frame without waiting for HTTP close", async () => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode([
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "not resume content" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'true}' }, finish_reason: "stop" }] })}`
    ].join("\r\n\r\n") + "\r\n\r\n");
    const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(bytes.slice(0, 41)); controller.enqueue(bytes.slice(41)); },
      cancel
    }), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await new OpenAiCompatibleProvider(settings).invoke({
      systemPrompt: "Return JSON.", userPrompt: "{}", maxOutputChars: 1000, stream: true, reasoningEffort: "low"
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning).toEqual({ effort: "low" });
    expect(response.output).toEqual({ ok: true });
    expect(response.finishReason).toBe("stop");
    expect(cancel).toHaveBeenCalledOnce();
  }, 1000);

  it("does not accept a valid-looking JSON prefix if the stream was truncated", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: "length" }] })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    )));
    await expect(new OpenAiCompatibleProvider(settings).invoke({
      systemPrompt: "Return JSON.", userPrompt: "{}", maxOutputChars: 1000, stream: true
    })).rejects.toMatchObject({ code: "model_output_truncated" });
  });

  it("retains the output size limit and rejects upstream stream errors", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const [frame, code] of [
      [{ choices: [{ delta: { content: '"long output"' } }] }, "model_output_too_large"],
      [{ error: { message: "upstream private detail" } }, "provider_stream_error"]
    ] as const) {
      fetchMock.mockResolvedValueOnce(new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { "Content-Type": "text/event-stream" } }));
      await expect(new OpenAiCompatibleProvider(settings).invoke({
        systemPrompt: "Return JSON.", userPrompt: "{}", maxOutputChars: 5, stream: true
      })).rejects.toMatchObject({ code });
    }
  });

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
    expect(requestBody).not.toHaveProperty("reasoning");
    expect(requestBody).not.toHaveProperty("chat_template_kwargs");
    expect(response.output).toEqual({ ok: true });
  });

  it("disables thinking only for a requested extraction on a custom Qwen endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);
    await new OpenAiCompatibleProvider({ ...settings, provider: "custom:example", baseUrl: "https://example.test/v1", model: "Qwen3.8-Flash-Next" })
      .invoke({ systemPrompt: "JSON", userPrompt: "Python", maxOutputChars: 1000, reasoningEffort: "low" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body).not.toHaveProperty("reasoning_effort");
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
