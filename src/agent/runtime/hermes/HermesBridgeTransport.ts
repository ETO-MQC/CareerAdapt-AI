import { z } from "zod";
import type { AgentPageContext } from "../../contracts/agentContext";
import type { AgentRuntimeAttachment } from "../agentRuntime";
import type { CareerSessionBinding } from "../careerSessionBinding";
import { RuntimeHealthSchema, type RuntimeHealth } from "../runtimeHealth";

export const HermesHealthSchema = z.object({
  available: z.boolean(),
  runtimeId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  providerStatus: z.enum(["ready", "unconfigured", "unreachable", "invalid", "unknown"]).optional(),
  contextWindow: z.number().int().min(0).optional(),
  toolCalling: z.enum(["verified", "unverified", "unsupported", "unknown"]).optional(),
  mcpServer: z.string().min(1).optional(),
  mcpConnected: z.boolean().optional(),
  discoveredToolCount: z.number().int().min(0).optional(),
  runtimeUrl: z.string().url().optional(),
  appUrl: z.string().url().optional(),
  roadshowMode: z.boolean().optional(),
  runtimeHealth: RuntimeHealthSchema.optional()
}).strict();

export type HermesHealth = z.infer<typeof HermesHealthSchema>;

export type HermesBridgeEvent =
  | { type: "progress"; message?: string; data?: unknown }
  | { type: "reasoning_status"; message?: string; data?: unknown }
  | { type: "text_delta"; delta: string }
  | { type: "tool_call_requested"; toolCallId: string; toolName: string; operationId: string; input: Record<string, unknown> }
  | { type: "tool_call_started"; toolCallId?: string; toolName: string; operationId: string; data?: unknown }
  | { type: "tool_call_completed"; toolCallId?: string; toolName: string; operationId: string; data?: unknown }
  | { type: "tool_call_failed"; toolCallId?: string; toolName: string; operationId: string; code: string; message: string; recoverable: boolean; data?: unknown }
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
  careerSessionBinding?: CareerSessionBinding;
  attachments?: AgentRuntimeAttachment[];
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
  metadata?: Record<string, unknown>;
};

export const HermesRunStatusSchema = z.object({
  object: z.string().optional(),
  run_id: z.string().min(1),
  status: z.enum(["queued", "started", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled"]),
  session_id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  output: z.string().optional(),
  error: z.string().optional(),
  last_event: z.string().optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  usage: z.record(z.string(), z.number()).optional()
}).passthrough();

export type HermesRunStatus = z.infer<typeof HermesRunStatusSchema>;

export type HermesRunStart = {
  runId: string;
  status: "started" | "queued" | "running";
};

export type HermesToolCallback = {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  operationId: string;
  careerSessionBinding?: CareerSessionBinding;
  result: unknown;
};

export interface HermesBridgeTransport {
  health(signal?: AbortSignal): Promise<HermesHealth>;
  createSession(input: { sessionId: string; metadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<HermesSession>;
  resumeSession(input: { sessionId: string }, signal?: AbortSignal): Promise<HermesSession>;
  turn(input: HermesTurnRequest, signal?: AbortSignal): AsyncIterable<HermesBridgeEvent>;
  toolCallback(input: HermesToolCallback, signal?: AbortSignal): Promise<void>;
  interrupt(input: { sessionId: string; turnId?: string; reason?: string }, signal?: AbortSignal): Promise<void>;
  /** Runs are mandatory for production transports. Optionality only keeps
   * pre-P4.4e in-memory adapters source-compatible during migration. */
  startRun?(input: HermesTurnRequest, signal?: AbortSignal): Promise<HermesRunStart>;
  getRun?(runId: string, signal?: AbortSignal): Promise<HermesRunStatus>;
  runEvents?(runId: string, signal?: AbortSignal): AsyncIterable<HermesBridgeEvent>;
  approveRun?(runId: string, choice: "once" | "session" | "always" | "deny", signal?: AbortSignal): Promise<HermesRunStatus>;
  stopRun?(runId: string, signal?: AbortSignal): Promise<HermesRunStatus>;
}

/** Browser-safe bridge client. Hermes itself remains a server/local companion. */
export class HttpHermesBridgeTransport implements HermesBridgeTransport {
  constructor(private readonly endpoint = "/api/agent/runtime/hermes") {}

  async health(signal?: AbortSignal) {
    const response = await this.request(`${this.endpoint}/health`, { method: "GET", signal });
    const payload = await response.json();
    return HermesHealthSchema.parse(payload);
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

  async startRun(input: HermesTurnRequest, signal?: AbortSignal) {
    return this.jsonRequest<HermesRunStart>("run_start", input, signal);
  }

  async getRun(runId: string, signal?: AbortSignal) {
    const result = await this.jsonRequest<HermesRunStatus>("run_status", { runId }, signal);
    return HermesRunStatusSchema.parse(result);
  }

  runEvents(runId: string, signal?: AbortSignal) {
    return this.streamRequest({ action: "run_events", runId }, signal);
  }

  async approveRun(runId: string, choice: "once" | "session" | "always" | "deny", signal?: AbortSignal) {
    const result = await this.jsonRequest<HermesRunStatus>("run_approval", { runId, choice }, signal);
    return HermesRunStatusSchema.parse(result);
  }

  async stopRun(runId: string, signal?: AbortSignal) {
    const result = await this.jsonRequest<HermesRunStatus>("run_stop", { runId }, signal);
    return HermesRunStatusSchema.parse(result);
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
    const isSse = (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
    let sseEventName = "message";
    let sseData: string[] = [];
    const consumeSseLine = (line: string) => {
      if (line.trim()) {
        if (line.startsWith(":")) return { type: "progress", data: { heartbeat: true } } satisfies HermesBridgeEvent;
        if (line.startsWith("event:")) {
          sseEventName = line.slice("event:".length).trim();
          return undefined;
        }
        if (line.startsWith("data:")) {
          sseData.push(line.slice("data:".length).trimStart());
        }
        return undefined;
      }
      if (!sseData.length) {
        sseEventName = "message";
        return undefined;
      }
      try {
        const payload = JSON.parse(sseData.join("\n")) as unknown;
        const payloadRecord = payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload as Record<string, unknown>
          : {};
        const officialEventName = sseEventName === "message" && typeof payloadRecord.event === "string"
          ? payloadRecord.event
          : sseEventName;
        const event = mapOfficialHermesEvent(officialEventName, payload);
        sseEventName = "message";
        sseData = [];
        return event;
      } catch {
        throw bridgeError("hermes_bridge_invalid_event", "Hermes returned an invalid SSE event.");
      }
    };
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      if (isSse) {
        for (const line of lines) {
          const event = consumeSseLine(line);
          if (event) yield event;
        }
      } else {
        for (const line of lines) {
          const event = parseBridgeEvent(line);
          if (event) yield event;
        }
      }
      if (done) break;
    }
    if (isSse) {
      if (buffer) {
        const event = consumeSseLine(buffer);
        if (event) yield event;
      }
      const event = consumeSseLine("");
      if (event) yield event;
    } else {
      const finalEvent = parseBridgeEvent(buffer);
      if (finalEvent) yield finalEvent;
    }
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

function mapOfficialHermesEvent(name: string, value: unknown): HermesBridgeEvent | undefined {
  const payload = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const toolName = typeof payload.tool_name === "string"
    ? payload.tool_name
    : typeof payload.tool === "string" ? payload.tool : "hermes_tool";
  const toolCallId = typeof payload.tool_call_id === "string" ? payload.tool_call_id : undefined;
  const operationId = typeof payload.operation_id === "string"
    ? payload.operation_id
    : toolCallId
      ? `hermes-mcp-${toolCallId}`
      : `hermes-mcp-${typeof payload.run_id === "string" ? payload.run_id : "run"}-${toolName}`;

  if (name === "message.delta") {
    return typeof payload.delta === "string" ? { type: "text_delta", delta: payload.delta } : undefined;
  }
  if (name === "tool.started") {
    return { type: "tool_call_started", toolName, operationId, data: payload };
  }
  if (name === "tool.completed") {
    return payload.error === true
      ? { type: "tool_call_failed", toolName, operationId, code: "hermes_tool_failed", message: "Hermes tool failed.", recoverable: true, data: payload }
      : { type: "tool_call_completed", toolName, operationId, data: payload };
  }
  if (name === "reasoning.available") {
    return { type: "reasoning_status", message: typeof payload.text === "string" ? payload.text : undefined, data: payload };
  }
  if (name === "approval.request") {
    return { type: "approval_required", toolName, operationId, data: payload, message: "Hermes run requires approval." };
  }
  if (name === "run.completed") {
    return { type: "turn_completed", data: payload, message: typeof payload.output === "string" ? payload.output : undefined };
  }
  if (name === "run.cancelled") {
    return { type: "turn_failed", code: "hermes_run_cancelled", message: "Hermes run was stopped.", recoverable: true };
  }
  if (name === "run.failed") {
    return { type: "turn_failed", code: "hermes_run_failed", message: typeof payload.error === "string" ? payload.error : "Hermes run failed.", recoverable: false };
  }
  if (name === "assistant.delta") {
    return typeof payload.delta === "string" ? { type: "text_delta", delta: payload.delta } : undefined;
  }
  if (name === "chat.completion.chunk") {
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const choice = choices[0] && typeof choices[0] === "object" && !Array.isArray(choices[0])
      ? choices[0] as Record<string, unknown>
      : {};
    const delta = choice.delta && typeof choice.delta === "object" && !Array.isArray(choice.delta)
      ? choice.delta as Record<string, unknown>
      : {};
    if (typeof delta.content === "string" && delta.content) {
      return { type: "text_delta", delta: delta.content };
    }
    const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
    return finishReason
      ? { type: "turn_completed", data: { finishReason, usage: payload.usage } }
      : undefined;
  }
  if (name === "response.output_text.delta") {
    return typeof payload.delta === "string" ? { type: "text_delta", delta: payload.delta } : undefined;
  }
  if (name === "hermes.tool.progress" || name === "tool.progress") {
    const message = typeof payload.delta === "string" ? payload.delta : typeof payload.preview === "string" ? payload.preview : undefined;
    return payload.tool_name === "_thinking"
      ? { type: "reasoning_status", message, data: payload }
      : { type: "progress", message, data: payload };
  }
  if (name === "tool.started") return { type: "tool_call_started", toolCallId, toolName, operationId, data: payload };
  if (name === "tool.completed") return { type: "tool_call_completed", toolCallId, toolName, operationId, data: payload };
  if (name === "tool.failed") return {
    type: "tool_call_failed",
    toolCallId,
    toolName,
    operationId,
    code: typeof payload.code === "string" ? payload.code : "hermes_tool_failed",
    message: typeof payload.preview === "string" ? payload.preview : "Hermes MCP tool failed.",
    recoverable: true,
    data: payload
  };
  if (name === "error") return {
    type: "turn_failed",
    code: typeof payload.code === "string" ? payload.code : "hermes_api_error",
    message: typeof payload.message === "string" ? payload.message : "Hermes returned an error.",
    recoverable: true
  };
  if (name === "assistant.completed") return {
    type: "turn_completed",
    message: typeof payload.content === "string" ? payload.content : undefined,
    data: payload
  };
  if (name === "response.completed" || name === "run.completed") return { type: "turn_completed", data: payload };
  if (name === "response.created" || name === "run.started" || name === "message.started") {
    return { type: "progress", message: "Hermes 已接收当前任务。", data: payload };
  }
  return undefined;
}

/** Convert the compatibility health shape into the authoritative contract. */
export function toRuntimeHealth(
  health: HermesHealth,
  overrides: Partial<Pick<RuntimeHealth, "mcpConnected" | "mcpToolCount" | "careerSkillsLoaded">> = {}
): RuntimeHealth {
  if (health.runtimeHealth) {
    return RuntimeHealthSchema.parse({
      ...health.runtimeHealth,
      ...overrides,
      lastCheckedAt: health.runtimeHealth.lastCheckedAt ?? new Date().toISOString()
    });
  }
  const providerConfigured = health.providerStatus !== "unconfigured"
    && Boolean(health.provider || health.model);
  const providerReachable = health.providerStatus === "ready"
    || (health.providerStatus === undefined && health.available);
  return RuntimeHealthSchema.parse({
    runtimeId: health.runtimeId ?? "hermes",
    runtimeAvailable: health.available,
    providerConfigured,
    providerReachable,
    ...(health.model ? { model: health.model } : {}),
    ...(health.contextWindow === undefined ? {} : { contextWindow: health.contextWindow }),
    toolCallingAvailable: health.toolCalling === "verified",
    mcpConnected: overrides.mcpConnected ?? health.mcpConnected ?? false,
    mcpToolCount: overrides.mcpToolCount ?? health.discoveredToolCount ?? 0,
    careerSkillsLoaded: overrides.careerSkillsLoaded ?? false,
    lastCheckedAt: new Date().toISOString(),
    ...(health.reason ? { safeErrorCode: safeRuntimeErrorCode(health.reason) } : {})
  });
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

function safeRuntimeErrorCode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return normalized.slice(0, 120) || "hermes_health_failed";
}
