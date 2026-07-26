import "server-only";
import type { AiSettings } from "@/services/storage/aiSettings";
import { parseOpenAiCompatibleSse } from "./openAiSse";
import {
  AgentModelResultSchema,
  type AgentModelMessage,
  type AgentModelRequest,
  type AgentModelResult
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
