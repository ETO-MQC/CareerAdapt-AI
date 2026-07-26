"use client";

import {
  AgentModelRequestSchema,
  AgentModelResultSchema,
  type AgentModel,
  type AgentModelRequest
} from "./agentModel";
import { encodeAiSettingsForHeader, readAiSettings } from "@/services/storage/aiSettings";
import { parseAgentSseStream } from "@/agent/runtime/agentSse";

export class HttpAgentModel implements AgentModel {
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
