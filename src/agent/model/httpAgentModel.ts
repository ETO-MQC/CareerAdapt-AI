"use client";

import {
  AgentModelRequestSchema,
  AgentModelResultSchema,
  type AgentModel,
  type AgentModelStreamEvent,
  type AgentModelRequest
} from "./agentModel";
import { encodeAiSettingsForHeader, readAiSettings } from "@/services/storage/aiSettings";
import { parseAgentSseStream } from "@/agent/runtime/agentSse";

export class HttpAgentModel implements AgentModel {
  readonly capabilities = { nativeToolStreaming: true };

  async completeWithTools(request: AgentModelRequest & { signal?: AbortSignal }) {
    const { signal, ...wireRequest } = request;
    const response = await fetchRetryable("/api/agent/stream", {
      method: "POST",
      headers: modelHeaders(),
      body: JSON.stringify({
        mode: "decision",
        ...AgentModelRequestSchema.parse(wireRequest)
      }),
      signal
    });
    const body = await response.json();
    if (!response.ok) {
      throw Object.assign(new Error(body?.error?.message ?? "Agent model request failed."), {
        code: body?.error?.code ?? "agent_model_failed"
      });
    }
    return AgentModelResultSchema.parse(body);
  }

  async *streamTurn(request: AgentModelRequest & { signal?: AbortSignal }): AsyncIterable<AgentModelStreamEvent> {
    try {
      const { signal, ...wireRequest } = request;
      const response = await fetchRetryable("/api/agent/stream", {
        method: "POST",
        headers: modelHeaders(),
        body: JSON.stringify({
          mode: "native_turn",
          ...AgentModelRequestSchema.parse(wireRequest)
        }),
        signal
      });
      if (!response.ok || !response.body) throw Object.assign(new Error("Agent model stream failed."), { code: "agent_stream_failed" });
      for await (const event of parseAgentSseStream(response.body)) {
        if (event.type === "model_text_delta") yield { type: "assistant_text_delta", delta: event.delta };
        if (event.type === "model_tool_call_start") yield { type: "tool_call_start", index: event.index, id: event.id, name: event.name };
        if (event.type === "model_tool_arguments_delta") yield { type: "tool_call_arguments_delta", index: event.index, id: event.id, delta: event.delta };
        if (event.type === "model_tool_call_complete") yield { type: "tool_call_complete", index: event.index, call: event.call };
        if (event.type === "model_usage") yield { type: "usage", inputTokens: event.inputTokens, outputTokens: event.outputTokens };
        if (event.type === "model_finish") yield { type: "finish", stopReason: event.stopReason };
        if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
      }
    } catch (error) {
      if (!isNativeStreamingUnsupported(error)) throw error;
      const fallback = await this.completeWithTools(request);
      if (fallback.toolCalls?.length) {
        for (const [index, call] of fallback.toolCalls.entries()) {
          yield { type: "tool_call_start", index, id: call.id, name: call.name };
          yield { type: "tool_call_complete", index, call };
        }
      } else if (fallback.text) {
        for await (const delta of this.streamFinalText({ ...request, draft: fallback.text })) {
          yield { type: "assistant_text_delta", delta };
        }
      }
      if (fallback.usage) yield { type: "usage", ...fallback.usage };
      yield { type: "finish", stopReason: fallback.stopReason };
    }
  }

  async *streamFinalText(request: AgentModelRequest & { draft: string; signal?: AbortSignal }) {
    const { signal, draft, ...wireRequest } = request;
    const response = await fetchRetryable("/api/agent/stream", {
      method: "POST",
      headers: modelHeaders(),
      body: JSON.stringify({
        mode: "narration",
        ...AgentModelRequestSchema.parse(wireRequest),
        draft
      }),
      signal
    });
    if (!response.ok || !response.body) throw Object.assign(new Error("Agent narration failed."), { code: "agent_stream_failed" });
    for await (const event of parseAgentSseStream(response.body)) {
      if (event.type === "assistant_delta") yield event.delta;
      if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
    }
  }
}

async function fetchRetryable(input: RequestInfo | URL, init: RequestInit) {
  try {
    const response = await fetch(input, init);
    if (!isRetryableStatus(response.status) || init.signal?.aborted) return response;
    return fetch(input, init);
  } catch (error) {
    if (init.signal?.aborted || error instanceof DOMException && error.name === "AbortError") throw error;
    return fetch(input, init);
  }
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function modelHeaders() {
  const settings = readAiSettings();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey || settings.baseUrl || settings.model) {
    headers["x-ai-config"] = encodeAiSettingsForHeader(settings);
  }
  return headers;
}

function isNativeStreamingUnsupported(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return code === "native_tool_streaming_unsupported";
}
