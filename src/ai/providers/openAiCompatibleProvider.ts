import "server-only";
import type { AiSettings } from "@/services/storage/aiSettings";
import { normalizeProviderFrame, parseOpenAiCompatibleSse } from "./openAiSse";
import { parseOpenAiJsonSse } from "./openAiToolSse";
import {
  AgentModelResultSchema,
  type AgentModelMessage,
  type AgentModelRequest,
  type AgentModelResult,
  type AgentModelStreamEvent
} from "@/agent/model/agentModel";

export type OpenAiCompatibleRequest = {
  systemPrompt: string;
  userPrompt: string;
  maxOutputChars: number;
  signal?: AbortSignal;
};

export type OpenAiCompatibleResponse = {
  output: unknown;
  provider: string;
  model: string;
  outputLength: number;
};

export type OpenAiCompatibleTextChunk =
  | { type: "delta"; delta: string }
  | { type: "done"; output: string; provider: string; model: string; outputLength: number };

export class OpenAiCompatibleProvider {
  readonly provider: string;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(settings?: AiSettings) {
    this.provider = settings?.provider || process.env.AI_PROVIDER || "openai-compatible";
    this.model = settings?.model || process.env.AI_MODEL || "";
    this.baseUrl = settings?.baseUrl || process.env.AI_BASE_URL || "https://api.openai.com/v1";
    this.apiKey = settings?.apiKey || process.env.AI_API_KEY || "";
  }

  async invoke(request: OpenAiCompatibleRequest): Promise<OpenAiCompatibleResponse> {
    if (!this.apiKey || !this.model) {
      throw createAiProviderError("missing_ai_config", "AI_API_KEY and AI_MODEL are required.");
    }
    if (this.provider.toLowerCase().includes("anthropic") || /anthropic\.com|\/messages\/?$/i.test(this.baseUrl)) {
      throw createAiProviderError(
        "provider_protocol_mismatch",
        "The configured endpoint uses the Anthropic Messages protocol, but this provider requires an OpenAI-compatible chat/completions endpoint."
      );
    }

    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt }
        ],
        temperature: 0.1
      }),
      signal: request.signal
    });

    if (!response.ok) {
      throw createAiProviderError(`provider_http_${response.status}`, `Provider returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      throw createAiProviderError("empty_model_output", "Provider returned empty content.");
    }

    if (content.length > request.maxOutputChars) {
      throw createAiProviderError("model_output_too_large", "Provider output exceeded the task limit.");
    }

    return {
      output: parseJsonContent(content),
      provider: this.provider,
      model: this.model,
      outputLength: content.length
    };
  }

  async completeWithTools(request: AgentModelRequest & { signal?: AbortSignal }): Promise<AgentModelResult> {
    this.assertUsable();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages.map(toOpenAiMessage)
        ],
        tools: request.tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema
          }
        })),
        tool_choice: request.tools.length ? "auto" : undefined,
        temperature: 0.1
      }),
      signal: request.signal
    });

    if (!response.ok) {
      if ([400, 404, 422].includes(response.status)) return this.completeWithStructuredActions(request);
      throw createAiProviderError(`provider_http_${response.status}`, `Provider returned HTTP ${response.status}.`);
    }
    const payload = await response.json();
    const choice = payload?.choices?.[0];
    const message = choice?.message;
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls.map((call: Record<string, unknown>, index: number) => {
          const fn = call.function as Record<string, unknown> | undefined;
          return {
            id: typeof call.id === "string" ? call.id : `tool-call-${index + 1}`,
            name: String(fn?.name ?? ""),
            arguments: parseToolArguments(fn?.arguments)
          };
        })
      : [];
    return AgentModelResultSchema.parse({
      text: typeof message?.content === "string" && message.content.trim() ? message.content : undefined,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: toolCalls.length ? "tool_calls" : choice?.finish_reason === "length" ? "length" : "final",
      usage: payload?.usage ? {
        inputTokens: numberOrUndefined(payload.usage.prompt_tokens),
        outputTokens: numberOrUndefined(payload.usage.completion_tokens)
      } : undefined
    });
  }

  async *streamTurn(request: AgentModelRequest & { signal?: AbortSignal }): AsyncGenerator<AgentModelStreamEvent> {
    this.assertUsable();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: request.systemPrompt },
          ...request.messages.map(toOpenAiMessage)
        ],
        tools: request.tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.inputSchema }
        })),
        tool_choice: request.tools.length ? "auto" : undefined,
        temperature: 0.1
      }),
      signal: request.signal
    });
    if (!response.ok) {
      throw createAiProviderError(
        [400, 404, 405, 422].includes(response.status) ? "native_tool_streaming_unsupported" : `provider_http_${response.status}`,
        `Provider returned HTTP ${response.status}.`
      );
    }
    if (!response.body) throw createAiProviderError("empty_stream_body", "Provider returned an empty stream body.");

    const calls = new Map<number, { id: string; name: string; argumentsText: string }>();
    let finishReason: unknown;
    let assistantText = "";
    for await (const payload of parseOpenAiJsonSse(response.body)) {
      const usage = objectRecord(payload.usage);
      if (usage) {
        yield {
          type: "usage",
          inputTokens: numberOrUndefined(usage.prompt_tokens),
          outputTokens: numberOrUndefined(usage.completion_tokens)
        };
      }
      const choice = Array.isArray(payload.choices) ? objectRecord(payload.choices[0]) : undefined;
      if (!choice) continue;
      finishReason = choice.finish_reason ?? finishReason;
      const delta = objectRecord(choice.delta);
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content) {
        const normalized = normalizeProviderFrame(assistantText, delta.content);
        if (normalized) {
          assistantText += normalized;
          yield { type: "assistant_text_delta", delta: normalized };
        }
      }
      if (!Array.isArray(delta.tool_calls)) continue;
      for (const rawCall of delta.tool_calls) {
        const part = objectRecord(rawCall);
        if (!part) continue;
        const index = typeof part.index === "number" ? part.index : calls.size;
        const fn = objectRecord(part.function);
        const prior = calls.get(index);
        const id = typeof part.id === "string" ? part.id : prior?.id ?? `tool-call-${index + 1}`;
        const name = typeof fn?.name === "string" ? fn.name : prior?.name ?? "";
        if (!prior) {
          calls.set(index, { id, name, argumentsText: "" });
          yield { type: "tool_call_start", index, id, name };
        } else {
          prior.id = id;
          prior.name = name;
        }
        if (typeof fn?.arguments === "string" && fn.arguments) {
          calls.get(index)!.argumentsText += fn.arguments;
          yield { type: "tool_call_arguments_delta", index, id, delta: fn.arguments };
        }
      }
    }
    for (const [index, call] of [...calls.entries()].sort(([left], [right]) => left - right)) {
      yield {
        type: "tool_call_complete",
        index,
        call: { id: call.id, name: call.name, arguments: parseToolArguments(call.argumentsText) }
      };
    }
    yield {
      type: "finish",
      stopReason: calls.size ? "tool_calls" : finishReason === "length" ? "length" : "final"
    };
  }

  async *streamText(request: OpenAiCompatibleRequest): AsyncGenerator<OpenAiCompatibleTextChunk> {
    this.assertUsable();
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        stream: true,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userPrompt }
        ],
        temperature: 0.2
      }),
      signal: request.signal
    });

    if (!response.ok) {
      throw createAiProviderError(`provider_http_${response.status}`, `Provider returned HTTP ${response.status}.`);
    }
    if (!response.body) {
      throw createAiProviderError("empty_stream_body", "Provider returned an empty stream body.");
    }

    let output = "";
    for await (const delta of parseOpenAiCompatibleSse(response.body)) {
      output += delta;
      if (output.length > request.maxOutputChars) {
        throw createAiProviderError("model_output_too_large", "Provider output exceeded the task limit.");
      }
      yield { type: "delta", delta };
    }
    yield {
      type: "done",
      output,
      provider: this.provider,
      model: this.model,
      outputLength: output.length
    };
  }

  private assertUsable() {
    if (!this.apiKey || !this.model) {
      throw createAiProviderError("missing_ai_config", "AI_API_KEY and AI_MODEL are required.");
    }
    if (this.provider.toLowerCase().includes("anthropic") || /anthropic\.com|\/messages\/?$/i.test(this.baseUrl)) {
      throw createAiProviderError(
        "provider_protocol_mismatch",
        "The configured endpoint uses the Anthropic Messages protocol, but this provider requires an OpenAI-compatible chat/completions endpoint."
      );
    }
  }

  private async completeWithStructuredActions(request: AgentModelRequest & { signal?: AbortSignal }) {
    const response = await this.invoke({
      systemPrompt: `${request.systemPrompt}

This provider does not expose native function calling. Return exactly one JSON object:
{"text":"final answer","stopReason":"final"}
or
{"toolCalls":[{"id":"stable-id","name":"allowed_tool","arguments":{}}],"stopReason":"tool_calls"}.
Use only the provided tool names. Do not include reasoning or markdown fences.`,
      userPrompt: JSON.stringify({ messages: request.messages, tools: request.tools }),
      maxOutputChars: 16_000,
      signal: request.signal
    });
    return AgentModelResultSchema.parse(response.output);
  }
}

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function createAiProviderError(code: string, message: string) {
  return new AiProviderError(code, message);
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Some models wrap JSON in explanatory text; try to extract the JSON object/array.
    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try { return JSON.parse(objectMatch[0]); } catch { /* fall through */ }
    }
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try { return JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
    }
    throw createAiProviderError("invalid_json", "Provider returned content that is not valid JSON.");
  }
}

function toOpenAiMessage(message: AgentModelMessage) {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) }
      }))
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId,
      name: message.name
    };
  }
  return { role: message.role, content: message.content };
}

function parseToolArguments(value: unknown) {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw createAiProviderError("invalid_tool_arguments", "Provider returned invalid tool arguments.");
  }
}

function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
