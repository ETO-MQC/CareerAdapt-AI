import { z } from "zod";
import type { AgentPageContext } from "../../contracts/agentContext";

export const HermesHealthSchema = z.object({
  available: z.boolean(),
  runtimeId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();

export type HermesHealth = z.infer<typeof HermesHealthSchema>;

export type HermesBridgeEvent =
  | { type: "progress"; message?: string; data?: unknown }
  | { type: "reasoning_status"; message?: string; data?: unknown }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_requested"; toolCallId: string; toolName: string; operationId: string; input: Record<string, unknown> }
  | { type: "approval_required"; toolCallId?: string; toolName?: string; operationId?: string; data?: unknown; message?: string }
  | { type: "artifact_updated"; data: unknown; artifactId?: string }
  | { type: "turn_completed"; data?: unknown; message?: string }
  | { type: "turn_failed"; code: string; message: string; recoverable: boolean };

export type HermesSession = {
  sessionId: string;
  resumed: boolean;
};

export type HermesTurnRequest = {
  sessionId: string;
  turnId: string;
  userMessage: string;
  pageContext: AgentPageContext;
  toolContracts: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type HermesToolCallback = {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  operationId: string;
  result: unknown;
};

export interface HermesBridgeTransport {
  health(signal?: AbortSignal): Promise<HermesHealth>;
  createSession(input: { sessionId: string; metadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<HermesSession>;
  resumeSession(input: { sessionId: string }, signal?: AbortSignal): Promise<HermesSession>;
  turn(input: HermesTurnRequest, signal?: AbortSignal): AsyncIterable<HermesBridgeEvent>;
  toolCallback(input: HermesToolCallback, signal?: AbortSignal): Promise<void>;
  interrupt(input: { sessionId: string; turnId?: string; reason?: string }, signal?: AbortSignal): Promise<void>;
}

/** Browser-safe bridge client. Hermes itself remains a server/local companion. */
export class HttpHermesBridgeTransport implements HermesBridgeTransport {
  constructor(private readonly endpoint = "/api/agent/runtime/hermes") {}

  async health(signal?: AbortSignal) {
    const response = await this.request(`${this.endpoint}/health`, { method: "GET", signal });
    return HermesHealthSchema.parse(await response.json());
  }

  async createSession(input: { sessionId: string; metadata?: Record<string, unknown> }, signal?: AbortSignal) {
    return this.jsonRequest<HermesSession>("session_create", input, signal);
  }

  async resumeSession(input: { sessionId: string }, signal?: AbortSignal) {
    return this.jsonRequest<HermesSession>("session_resume", input, signal);
  }

  turn(input: HermesTurnRequest, signal?: AbortSignal) {
    return this.streamRequest({ action: "turn", ...input }, signal);
  }

  async toolCallback(input: HermesToolCallback, signal?: AbortSignal) {
    await this.jsonRequest("tool_callback", input, signal);
  }

  async interrupt(input: { sessionId: string; turnId?: string; reason?: string }, signal?: AbortSignal) {
    await this.jsonRequest("interrupt", input, signal);
  }

  private async jsonRequest<T = unknown>(action: string, input: Record<string, unknown>, signal?: AbortSignal) {
    const response = await this.request(this.endpoint, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...input })
    });
    const payload = await response.json() as { ok?: boolean; data?: T; error?: { code?: string; message?: string } };
    if (!response.ok || payload.ok === false) {
      throw bridgeError(payload.error?.code ?? `hermes_bridge_http_${response.status}`, payload.error?.message ?? "Hermes bridge request failed.");
    }
    return (payload.data ?? payload) as T;
  }

  private async *streamRequest(input: Record<string, unknown>, signal?: AbortSignal): AsyncIterable<HermesBridgeEvent> {
    let response: Response;
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(input)
      });
    } catch (error) {
      throw error;
    }
    if (!response.ok || !response.body) {
      const payload = await safeJson(response);
      throw bridgeError(payload?.error?.code ?? `hermes_bridge_http_${response.status}`, payload?.error?.message ?? "Hermes turn stream is unavailable.");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const event = parseBridgeEvent(line);
        if (event) yield event;
      }
      if (done) break;
    }
    const finalEvent = parseBridgeEvent(buffer);
    if (finalEvent) yield finalEvent;
  }

  private async request(url: string, init: RequestInit) {
    try {
      const response = await fetch(url, init);
      return response;
    } catch (error) {
      throw bridgeError("hermes_bridge_unavailable", error instanceof Error ? error.message : "Hermes bridge is unavailable.");
    }
  }
}

function parseBridgeEvent(line: string): HermesBridgeEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as HermesBridgeEvent;
    return parsed && typeof parsed === "object" && "type" in parsed ? parsed : undefined;
  } catch {
    throw bridgeError("hermes_bridge_invalid_event", "Hermes bridge returned an invalid event.");
  }
}

async function safeJson(response: Response) {
  try {
    return await response.json() as { error?: { code?: string; message?: string } };
  } catch {
    return undefined;
  }
}

function bridgeError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
