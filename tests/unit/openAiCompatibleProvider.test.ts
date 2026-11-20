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
  it("selects DeepSeek thinking per task without changing other providers", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "openai-compatible" });
    await provider.invoke({ systemPrompt: "JSON", userPrompt: "test", maxOutputChars: 1000, thinkingMode: "disabled" });
    await provider.invoke({ systemPrompt: "JSON", userPrompt: "test", maxOutputChars: 1000 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).thinking).toEqual({ type: "disabled" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).not.toHaveProperty("thinking");
  });

  it("carries DeepSeek thinking state through tool calls without exposing it as answer text", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: {
      content: null, reasoning_content: "private continuation", tool_calls: [{ id: "call-1", function: { name: "get_profile", arguments: '{"profileId":"current"}' } }]
    }, finish_reason: "tool_calls" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "openai-compatible" });
    const tools = [{ name: "get_profile", description: "Read profile", inputSchema: { type: "object" } }];
    const result = await provider.completeWithTools({ systemPrompt: "Use tools", messages: [{ role: "user", content: "Read" }], tools, thinkingMode: "enabled" });
    expect(result.text).toBeUndefined();
    expect(result.reasoningContent).toBe("private continuation");
    expect(result.toolCalls?.[0]).toMatchObject({ id: "call-1", name: "get_profile", arguments: { profileId: "current" } });
    await provider.completeWithTools({ systemPrompt: "Use tools", tools, thinkingMode: "enabled", messages: [
      { role: "user", content: "Read" }, { role: "assistant", content: "", toolCalls: result.toolCalls, reasoningContent: result.reasoningContent },
      { role: "tool", content: "confirmed profile", toolCallId: "call-1" }
    ] });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.messages[2]).toMatchObject({ role: "assistant", reasoning_content: "private continuation", tool_calls: [{ id: "call-1" }] });
    expect(body.messages[3]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
    await expect(provider.completeWithTools({ systemPrompt: "Use tools", tools, thinkingMode: "enabled", messages: [
      { role: "assistant", content: "", toolCalls: result.toolCalls }
    ] })).rejects.toMatchObject({ code: "missing_tool_reasoning" });
  });

  it("defaults DeepSeek tool requests to non-thinking and rejects incomplete calls", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: [{ id: "call-1", function: { name: "get_profile", arguments: "{}" } }]
    }, finish_reason: "tool_calls" }] }))).mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: {
      content: null, tool_calls: [{ id: "call-1", function: { name: "get_profile", arguments: '{"id":' } }]
    }, finish_reason: "length" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "openai-compatible" });
    const request = { systemPrompt: "Use tools", messages: [{ role: "user" as const, content: "Read" }], tools: [{ name: "get_profile", description: "Read profile", inputSchema: { type: "object" } }] };
    expect((await provider.completeWithTools(request)).stopReason).toBe("tool_calls");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).thinking).toEqual({ type: "disabled" });
    await expect(provider.completeWithTools(request)).rejects.toMatchObject({ code: "model_output_truncated" });
  });

  it("disables DeepSeek thinking for a named forced tool", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: null,
      tool_calls: [{ id: "call-1", function: { name: "get_profile", arguments: "{}" } }] }, finish_reason: "tool_calls" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "openai-compatible" });
    const toolChoice = { type: "function" as const, function: { name: "get_profile" } };
    await provider.completeWithTools({ systemPrompt: "Use tools", messages: [{ role: "user", content: "Read" }],
      tools: [{ name: "get_profile", description: "Read profile", inputSchema: { type: "object" } }], toolChoice, thinkingMode: "enabled" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ thinking: { type: "disabled" }, tool_choice: toolChoice });
  });

  it("preserves DeepSeek streamed reasoning privately and rejects a truncated tool stream", async () => {
    const frames = [
      { choices: [{ delta: { reasoning_content: "private " }, finish_reason: null }] },
      { choices: [{ delta: { reasoning_content: "continuation", tool_calls: [{ index: 0, id: "call-1", function: { name: "get_profile", arguments: '{"id":' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"current"}' } }] }, finish_reason: "tool_calls" }] }
    ];
    const sse = (items: unknown[]) => new Response(items.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(sse(frames)).mockResolvedValueOnce(sse([frames[1], { choices: [{ delta: {}, finish_reason: "length" }] }])));
    const provider = new OpenAiCompatibleProvider({ ...settings, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", provider: "openai-compatible" });
    const request = { systemPrompt: "Use tools", messages: [{ role: "user" as const, content: "Read" }], tools: [{ name: "get_profile", description: "Read profile", inputSchema: { type: "object" } }], thinkingMode: "enabled" as const };
    const events = []; for await (const event of provider.streamTurn(request)) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: "finish", reasoningContent: "private continuation", stopReason: "tool_calls" }));
    expect(events.filter(event => event.type === "assistant_text_delta")).toHaveLength(0);
    const consume = async () => { for await (const event of provider.streamTurn(request)) void event; };
    await expect(consume()).rejects.toMatchObject({ code: "model_output_truncated" });
  });
  it("budgets MiMo thinking without treating reasoning as the structured answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { reasoning: "private reasoning", content: '{"ok":true}' }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, provider: "custom:amd", baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "MiMo-V2.6-Flash" });
    const result = await provider.invoke({ systemPrompt: "JSON", userPrompt: "anonymous", maxOutputChars: 1000 });
    expect(result.output).toEqual({ ok: true });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  it("reports MiMo's empty length-limited response as truncation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { reasoning: "thinking", content: "" }, finish_reason: "length" }] }))));
    const provider = new OpenAiCompatibleProvider({ ...settings, provider: "custom:amd", baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "MiMo-V2.6-Flash" });
    await expect(provider.invoke({ systemPrompt: "JSON", userPrompt: "anonymous", maxOutputChars: 1000 })).rejects.toMatchObject({ code: "model_output_truncated" });
  });

  it("does not report a reasoning-only truncated MiMo text stream as complete", async () => {
    const frame = { choices: [{ delta: { reasoning: "thinking", content: "" }, finish_reason: "length" }] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(frame)}\n\n`, { headers: { "Content-Type": "text/event-stream" } })));
    const provider = new OpenAiCompatibleProvider({ ...settings, provider: "custom:amd", baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "MiMo-V2.6-Flash" });
    const consume = async () => { for await (const event of provider.streamText({ systemPrompt: "Brief", userPrompt: "hello", maxOutputChars: 100 })) void event; };
    await expect(consume()).rejects.toMatchObject({ code: "model_output_truncated" });
  });

  it("retains streamed MiMo tool fragments while excluding reasoning", async () => {
    const frames = [
      { choices: [{ delta: { reasoning: "private reasoning" }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call-1", function: { name: "get_profile", arguments: '{"id":' } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"current"}' } }] }, finish_reason: "tool_calls" }] }
    ];
    const fetchMock = vi.fn().mockResolvedValue(new Response(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new OpenAiCompatibleProvider({ ...settings, provider: "custom:amd", baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "MiMo-V2.6-Flash" });
    const events = [];
    for await (const event of provider.streamTurn({ systemPrompt: "Use tools", messages: [{ role: "user", content: "read profile" }], tools: [{ name: "get_profile", description: "Read profile", inputSchema: { type: "object" } }] })) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_call_complete", call: { id: "call-1", name: "get_profile", arguments: { id: "current" } } }));
    expect(JSON.stringify(events)).not.toContain("private reasoning");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(4096);
  });
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
