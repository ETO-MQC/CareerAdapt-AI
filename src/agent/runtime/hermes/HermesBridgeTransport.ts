import { z } from "zod";
import type { AgentPageContext } from "../../contracts/agentContext";
import type { AgentRuntimeAttachment } from "../agentRuntime";
import type { CareerSessionBinding } from "../careerSessionBinding";
import { RuntimeHealthSchema, type RuntimeHealth } from "../runtimeHealth";
import {
  createHermesRunFailure,
  type HermesRunFailureDiagnostics,
  withHermesRunFailureDiagnostics
} from "./hermesRunReliability";
import {
  abortSourceForReason,
  type BridgeRequestTrace,
  type RunStopReason
} from "./hermesIncidentTrace";
import { stableCareerLogicalToolOperationId } from "../../tools/careerToolContract";

export const HermesHealthSchema = z.object({
  available: z.boolean(),
  runtimeId: z.string().min(1).optional(),
  activeRunId: z.string().min(1).optional(),
  hermesRunId: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  providerStatus: z.enum(["ready", "unconfigured", "unreachable", "invalid", "unknown"]).optional(),
  contextWindow: z.number().int().min(0).optional(),
  toolCalling: z.enum(["verified", "unverified", "unsupported", "unknown"]).optional(),
  toolCallingCapability: z.enum(["verified", "unverified", "unsupported", "unknown"]).optional(),
  toolCallInFlight: z.boolean().optional(),
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
  | ({ type: "progress"; message?: string; data?: unknown } & HermesBridgeEventMetadata)
  | ({ type: "reasoning_status"; message?: string; data?: unknown } & HermesBridgeEventMetadata)
  | ({ type: "text_delta"; delta: string } & HermesBridgeEventMetadata)
  | ({ type: "tool_call_requested"; toolCallId: string; toolName: string; operationId: string; logicalToolOperationId?: string; input: Record<string, unknown> } & HermesBridgeEventMetadata)
  | ({ type: "tool_call_started"; toolCallId?: string; toolName: string; operationId: string; logicalToolOperationId?: string; data?: unknown } & HermesBridgeEventMetadata)
  | ({ type: "tool_call_completed"; toolCallId?: string; toolName: string; operationId: string; logicalToolOperationId?: string; data?: unknown } & HermesBridgeEventMetadata)
  | ({ type: "tool_call_failed"; toolCallId?: string; toolName: string; operationId: string; logicalToolOperationId?: string; code: string; message: string; recoverable: boolean; data?: unknown } & HermesBridgeEventMetadata)
  | ({ type: "approval_required"; toolCallId?: string; toolName?: string; operationId?: string; data?: unknown; message?: string } & HermesBridgeEventMetadata)
  | ({ type: "artifact_updated"; data: unknown; artifactId?: string } & HermesBridgeEventMetadata)
  | ({ type: "turn_completed"; data?: unknown; message?: string } & HermesBridgeEventMetadata)
  | ({ type: "turn_failed"; code: string; message: string; recoverable: boolean; data?: unknown } & HermesBridgeEventMetadata);

type HermesBridgeEventMetadata = { eventId?: string };

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
  incidentTraceId?: string;
  logicalTurnId?: string;
  attemptTraceId?: string;
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

export type HermesRunTraceContext = {
  incidentTraceId?: string;
  traceId?: string;
  logicalTurnId?: string;
  sessionId?: string;
  turnId?: string;
  runId?: string;
  eventCursor?: string;
  stopReason?: RunStopReason;
};

const HermesRunStartSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["started", "queued", "running"])
}).passthrough();

export type HermesToolCallback = {
  sessionId: string;
  turnId: string;
  toolCallId: string;
  toolName: string;
  operationId: string;
  logicalToolOperationId?: string;
  incidentTraceId?: string;
  attemptTraceId?: string;
  careerSessionBinding?: CareerSessionBinding;
  result: unknown;
};

export function logicalToolOperationId(input: {
  toolCallId?: string;
  operationId?: string;
  turnId?: string;
  stableToolName?: string;
  preferStableToolName?: boolean;
}) {
  if (input.preferStableToolName && input.turnId?.trim() && input.stableToolName?.trim()) {
    return stableCareerLogicalToolOperationId(input.turnId.trim(), input.stableToolName.trim());
  }
  const source = input.toolCallId?.trim();
  if (source) return `hermes-tool-${source}`;
  if (input.turnId?.trim() && input.stableToolName?.trim()) {
    return `hermes-tool-${sanitizeLogicalPart(input.turnId)}-${sanitizeLogicalPart(input.stableToolName)}`;
  }
  const operation = input.operationId?.trim();
  return operation ? `hermes-tool-${operation}` : undefined;
}

function sanitizeLogicalPart(value: string) {
  return value.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 180);
}

export interface HermesBridgeTransport {
  health(signal?: AbortSignal): Promise<HermesHealth>;
  createSession(input: { sessionId: string; metadata?: Record<string, unknown> }, signal?: AbortSignal): Promise<HermesSession>;
  resumeSession(input: { sessionId: string }, signal?: AbortSignal): Promise<HermesSession>;
  turn(input: HermesTurnRequest, signal?: AbortSignal): AsyncIterable<HermesBridgeEvent>;
  toolCallback(input: HermesToolCallback, signal?: AbortSignal): Promise<void>;
  interrupt(input: { sessionId: string; turnId?: string; reason?: string; stopReason?: RunStopReason }, signal?: AbortSignal, trace?: HermesRunTraceContext): Promise<void>;
  /** Runs are mandatory for production transports. Optionality only keeps
   * pre-P4.4e in-memory adapters source-compatible during migration. */
  startRun?(input: HermesTurnRequest, signal?: AbortSignal): Promise<HermesRunStart>;
  getRun?(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext): Promise<HermesRunStatus>;
  runEvents?(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext): AsyncIterable<HermesBridgeEvent>;
  approveRun?(runId: string, choice: "once" | "session" | "always" | "deny", signal?: AbortSignal, trace?: HermesRunTraceContext): Promise<HermesRunStatus>;
  stopRun?(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext): Promise<HermesRunStatus>;
  getDiagnostics?(): { bridgeRequestTraces: BridgeRequestTrace[] };
}

/** Browser-safe bridge client. Hermes itself remains a server/local companion. */
export class HttpHermesBridgeTransport implements HermesBridgeTransport {
  private readonly bridgeRequestTraces: BridgeRequestTrace[] = [];

  constructor(private readonly endpoint = "/api/agent/runtime/hermes") {}

  getDiagnostics() {
    return { bridgeRequestTraces: [...this.bridgeRequestTraces] };
  }

  async health(signal?: AbortSignal) {
    const response = await this.request(`${this.endpoint}/health`, { method: "GET", signal }, "hermes_health_timeout");
    const payload = await response.json();
    return HermesHealthSchema.parse(payload);
  }

  async createSession(input: { sessionId: string; metadata?: Record<string, unknown> }, signal?: AbortSignal) {
    return this.jsonRequest<HermesSession>("session_create", input, signal, { sessionId: input.sessionId });
  }

  async resumeSession(input: { sessionId: string }, signal?: AbortSignal) {
    return this.jsonRequest<HermesSession>("session_resume", input, signal, { sessionId: input.sessionId });
  }

  turn(input: HermesTurnRequest, signal?: AbortSignal) {
    return this.streamRequest({ action: "turn", ...input }, signal, {
      incidentTraceId: input.incidentTraceId,
      traceId: input.attemptTraceId,
      logicalTurnId: input.logicalTurnId,
      sessionId: input.sessionId,
      turnId: input.turnId
    });
  }

  async toolCallback(input: HermesToolCallback, signal?: AbortSignal) {
    await this.jsonRequest("tool_callback", input, signal, {
      incidentTraceId: input.incidentTraceId,
      traceId: input.attemptTraceId,
      sessionId: input.sessionId,
      turnId: input.turnId
    });
  }

  async interrupt(input: { sessionId: string; turnId?: string; reason?: string; stopReason?: RunStopReason }, signal?: AbortSignal, trace?: HermesRunTraceContext) {
    await this.jsonRequest("interrupt", input, signal, {
      ...trace,
      sessionId: input.sessionId,
      turnId: input.turnId,
      stopReason: input.stopReason ?? trace?.stopReason
    });
  }

  async startRun(input: HermesTurnRequest, signal?: AbortSignal) {
    const startedAt = Date.now();
    try {
      const result = await this.jsonRequest<HermesRunStart>("run_start", input, signal, {
        incidentTraceId: input.incidentTraceId,
        traceId: input.attemptTraceId,
        logicalTurnId: input.logicalTurnId,
        sessionId: input.sessionId,
        turnId: input.turnId
      });
      const parsed = HermesRunStartSchema.safeParse(result);
      if (!parsed.success) {
        throw createHermesRunFailure({
          code: "hermes_run_start_invalid_response",
          message: "Hermes run_start 返回了无法识别的运行句柄。",
          failureLayer: "response",
          hermesSessionId: input.sessionId,
          requestedTurnId: input.turnId,
          runStartKind: "new",
          incidentTraceId: input.incidentTraceId,
          attemptTraceId: input.attemptTraceId,
          latencyMs: Date.now() - startedAt,
          retryable: false
        });
      }
      return parsed.data;
    } catch (error) {
      throw withHermesRunFailureDiagnostics(error, {
        hermesSessionId: input.sessionId,
        requestedTurnId: input.turnId,
        runStartKind: "new",
        incidentTraceId: input.incidentTraceId,
        attemptTraceId: input.attemptTraceId,
        latencyMs: Date.now() - startedAt
      });
    }
  }

  async getRun(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext) {
    const result = await this.jsonRequest<HermesRunStatus>("run_status", { runId }, signal, { ...trace, runId });
    return HermesRunStatusSchema.parse(result);
  }

  runEvents(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext) {
    return this.streamRequest({ action: "run_events", runId, ...(trace?.eventCursor ? { eventCursor: trace.eventCursor } : {}) }, signal, { ...trace, runId });
  }

  async approveRun(runId: string, choice: "once" | "session" | "always" | "deny", signal?: AbortSignal, trace?: HermesRunTraceContext) {
    const result = await this.jsonRequest<HermesRunStatus>("run_approval", { runId, choice }, signal, { ...trace, runId });
    return HermesRunStatusSchema.parse(result);
  }

  async stopRun(runId: string, signal?: AbortSignal, trace?: HermesRunTraceContext) {
    const result = await this.jsonRequest<HermesRunStatus>("run_stop", {
      runId,
      ...(trace?.stopReason ? { stopReason: trace.stopReason } : {})
    }, signal, { ...trace, runId });
    return HermesRunStatusSchema.parse(result);
  }

  private async jsonRequest<T = unknown>(action: string, input: Record<string, unknown>, signal?: AbortSignal, trace?: HermesRunTraceContext) {
    const traceIndex = this.beginBridgeTrace(action, input, trace);
    try {
      const response = await this.request(this.endpoint, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...input })
      }, `hermes_${action}_timeout`);
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        data?: T;
        error?: { code?: string; message?: string; httpStatus?: number; failureLayer?: string; diagnostics?: Partial<HermesRunFailureDiagnostics> };
      };
      if (!response.ok || payload.ok === false) {
        throw bridgeError(
          payload.error?.code ?? `hermes_${action}_failed`,
          payload.error?.message ?? "Hermes bridge request failed.",
          {
            httpStatus: response.status,
            failureLayer: payload.error?.failureLayer === "provider" ? "provider" : "bridge_http",
            upstreamErrorCode: payload.error?.code,
            hermesRunId: safeString(input.runId),
            diagnostics: payload.error?.diagnostics
          }
        );
      }
      const result = (payload.data ?? payload) as T;
      this.finishBridgeTrace(traceIndex, { httpStatus: response.status, runId: safeRunId(result) });
      return result;
    } catch (error) {
      this.finishBridgeTrace(traceIndex, { safeErrorCode: safeErrorCode(error), ...(errorStatus(error) ? { httpStatus: errorStatus(error) } : {}) }, signal);
      throw error;
    }
  }

  private async *streamRequest(input: Record<string, unknown>, signal?: AbortSignal, trace?: HermesRunTraceContext): AsyncIterable<HermesBridgeEvent> {
    const traceIndex = this.beginBridgeTrace(String(input.action), input, trace);
    let response: Response;
    try {
      response = await this.request(this.endpoint, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream, application/x-ndjson" },
        body: JSON.stringify(input)
      }, `hermes_${String(input.action)}_timeout`);
    } catch (error) {
      this.finishBridgeTrace(traceIndex, { safeErrorCode: safeErrorCode(error), ...(errorStatus(error) ? { httpStatus: errorStatus(error) } : {}) }, signal);
      throw error;
    }
    if (!response.ok || !response.body) {
      const payload = await safeJson(response);
      const action = String(input.action);
      const error = bridgeError(payload?.error?.code ?? `hermes_${action}_failed`, payload?.error?.message ?? "Hermes turn stream is unavailable.", {
        httpStatus: response.status,
        failureLayer: "bridge_http",
        upstreamErrorCode: payload?.error?.code,
        hermesRunId: safeString(input.runId),
        diagnostics: payload?.error?.diagnostics
      });
      this.finishBridgeTrace(traceIndex, { httpStatus: response.status, safeErrorCode: safeErrorCode(error) }, signal);
      throw error;
    }
    this.updateBridgeTrace(traceIndex, { httpStatus: response.status });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const isSse = (response.headers.get("content-type") ?? "").toLowerCase().includes("text/event-stream");
    let sseEventName = "message";
    let sseEventId: string | undefined;
    let sseData: string[] = [];
    const consumeSseLine = (line: string) => {
      if (line.trim()) {
        if (line.startsWith(":")) return { type: "progress", data: { heartbeat: true } } satisfies HermesBridgeEvent;
        if (line.startsWith("event:")) {
          sseEventName = line.slice("event:".length).trim();
          return undefined;
        }
        if (line.startsWith("id:")) {
          sseEventId = line.slice("id:".length).trim();
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
        const mapped = mapOfficialHermesEvent(officialEventName, payload);
        const event = mapped && sseEventId ? { ...mapped, eventId: sseEventId } : mapped;
        sseEventName = "message";
        sseEventId = undefined;
        sseData = [];
        return event;
      } catch {
        throw bridgeError("hermes_bridge_invalid_event", "Hermes returned an invalid SSE event.");
      }
    };
    let buffer = "";
    try {
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
    } catch (error) {
      this.finishBridgeTrace(traceIndex, { safeErrorCode: safeErrorCode(error) }, signal);
      throw error;
    } finally {
      this.finishBridgeTrace(traceIndex, {}, signal);
    }
  }

  private beginBridgeTrace(action: string, input: Record<string, unknown>, trace?: HermesRunTraceContext) {
    const entry: BridgeRequestTrace = {
      action: action as BridgeRequestTrace["action"],
      startedAt: new Date().toISOString(),
      ...(safeString(input.runId) || trace?.stopReason?.runId ? { runId: safeString(input.runId) ?? trace?.stopReason?.runId } : {}),
      ...(safeString(input.turnId) || trace?.turnId ? { turnId: safeString(input.turnId) ?? trace?.turnId } : {}),
      ...(safeString(input.sessionId) || trace?.sessionId ? { sessionId: safeString(input.sessionId) ?? trace?.sessionId } : {}),
      ...(trace?.traceId || trace?.incidentTraceId ? { traceId: trace.traceId ?? trace.incidentTraceId } : {}),
      ...(trace?.incidentTraceId ? { incidentTraceId: trace.incidentTraceId } : {})
    };
    this.bridgeRequestTraces.push(entry);
    if (this.bridgeRequestTraces.length > 200) this.bridgeRequestTraces.splice(0, this.bridgeRequestTraces.length - 200);
    return this.bridgeRequestTraces.length - 1;
  }

  private finishBridgeTrace(index: number, patch: Partial<BridgeRequestTrace>, signal?: AbortSignal) {
    const entry = this.bridgeRequestTraces[index];
    if (!entry) return;
    const completedAt = new Date().toISOString();
    const aborted = signal?.aborted === true;
    this.bridgeRequestTraces[index] = {
      ...entry,
      ...patch,
      ...(patch.runId ? { runId: patch.runId } : {}),
      ...(aborted ? {
        abortedAt: completedAt,
        abortSource: abortSourceForReason(signal?.reason)
      } : {}),
      completedAt,
      latencyMs: Math.max(0, Date.now() - Date.parse(entry.startedAt))
    };
  }

  private updateBridgeTrace(index: number, patch: Partial<BridgeRequestTrace>) {
    const entry = this.bridgeRequestTraces[index];
    if (!entry) return;
    this.bridgeRequestTraces[index] = { ...entry, ...patch };
  }

  private async request(url: string, init: RequestInit, timeoutCode = "hermes_bridge_timeout") {
    try {
      const response = await fetch(url, init);
      return response;
    } catch (error) {
      throw bridgeError(
        error instanceof Error && error.name === "AbortError" ? timeoutCode : "hermes_bridge_unavailable",
        error instanceof Error ? error.message : "Hermes bridge is unavailable.",
        { failureLayer: "companion" }
      );
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

export function mapOfficialHermesEvent(name: string, value: unknown): HermesBridgeEvent | undefined {
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
  const eventLogicalToolOperationId = officialLogicalToolOperationId(payload, toolCallId, operationId, toolName);

  if (name === "message.delta") {
    return typeof payload.delta === "string" ? { type: "text_delta", delta: payload.delta } : undefined;
  }
  if (name === "tool.started") {
    return { type: "tool_call_started", toolCallId, toolName, operationId, logicalToolOperationId: eventLogicalToolOperationId, data: payload };
  }
  if (name === "tool.completed") {
    const failure = officialToolFailure(payload);
    const terminalData = officialToolTerminalData(payload, failure ? "failed" : "completed");
    return failure
      ? {
          type: "tool_call_failed",
          toolName,
          operationId,
          logicalToolOperationId: eventLogicalToolOperationId,
          code: failure.code,
          message: failure.message,
          recoverable: failure.recoverable,
          data: { ...safeOfficialToolFailureData(payload, failure.code), ...terminalData }
        }
      : { type: "tool_call_completed", toolCallId, toolName, operationId, logicalToolOperationId: eventLogicalToolOperationId, data: { ...payload, ...terminalData } };
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
    const message = typeof payload.error === "string" ? payload.error : "Hermes run failed.";
    return { type: "turn_failed", code: "hermes_run_failed", message, recoverable: isTransientHermesEventError(message) };
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
  if (name === "tool.failed") {
    const validMcpSuccessEnvelope = isValidMcpSuccessEnvelope(payload);
    const failure = officialToolFailure(payload);
    const code = failure?.code ?? (validMcpSuccessEnvelope
      ? "hermes_protocol_rejected_valid_mcp_success"
      : "hermes_tool_failed");
    const message = failure?.message ?? (validMcpSuccessEnvelope
      ? "Hermes rejected a valid MCP success envelope."
      : "Career 工具执行没有完成。");
    return {
      type: "tool_call_failed",
      toolCallId,
      toolName,
      operationId,
      code,
      message,
      recoverable: failure?.recoverable ?? true,
      logicalToolOperationId: eventLogicalToolOperationId,
      data: {
        ...safeOfficialToolFailureData(payload, code),
        ...(validMcpSuccessEnvelope ? {
          toolResultIsError: false,
          protocolCause: "valid_mcp_success_envelope_rejected_by_hermes"
        } : {}),
        ...officialToolTerminalData(payload, "failed")
      }
    };
  }
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

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function officialLogicalToolOperationId(
  payload: Record<string, unknown>,
  toolCallId: string | undefined,
  operationId: string,
  toolName: string
) {
  const explicit = officialResponseCandidates(payload)
    .map((candidate) => typeof candidate.logical_tool_operation_id === "string"
      ? candidate.logical_tool_operation_id
      : typeof candidate.logicalToolOperationId === "string"
        ? candidate.logicalToolOperationId
        : typeof candidate["careeradapt/logicalToolOperationId"] === "string"
          ? candidate["careeradapt/logicalToolOperationId"]
          : undefined)
    .find((candidate): candidate is string => Boolean(candidate?.trim()));
  if (explicit?.trim()) return explicit.trim();
  const turnId = typeof payload.logical_turn_id === "string"
    ? payload.logical_turn_id
    : typeof payload.turn_id === "string"
      ? payload.turn_id
      : typeof payload.turnId === "string"
        ? payload.turnId
        : typeof payload.run_id === "string" ? payload.run_id : undefined;
  return logicalToolOperationId({
    toolCallId,
    operationId,
    turnId,
    stableToolName: toolName,
    preferStableToolName: Boolean(turnId)
  });
}

function officialToolFailure(payload: Record<string, unknown>) {
  if (isValidMcpSuccessEnvelope(payload)) return undefined;
  const result = objectRecord(payload.result);
  const data = objectRecord(payload.data);
  const candidates = [
    payload,
    result,
    objectRecord(result.structuredContent),
    data,
    objectRecord(data.structuredContent),
    objectRecord(payload.error),
    objectRecord(result.error),
    objectRecord(data.error)
  ];
  const errorRecord = candidates.find((candidate) => Object.keys(candidate).length > 0 && (
    candidate.error === true
    || typeof candidate.error === "string"
    || Object.keys(objectRecord(candidate.error)).length > 0
    || candidate.ok === false
    || candidate.isError === true
    || candidate.is_error === true
    || candidate.status === "failed"
    || typeof candidate.safeErrorCode === "string"
  ));
  if (!errorRecord && payload.error !== true && typeof payload.error !== "string") return undefined;
  const nested = objectRecord(errorRecord?.error);
  const code = typeof nested.code === "string"
    ? nested.code
    : typeof errorRecord?.safeErrorCode === "string"
      ? errorRecord.safeErrorCode
      : typeof payload.code === "string" ? payload.code : "hermes_tool_failed";
  const message = typeof nested.message === "string"
    ? nested.message
    : typeof errorRecord?.error === "string"
      ? errorRecord.error
      : typeof errorRecord?.message === "string" ? errorRecord.message : "Hermes 工具执行没有完成。";
  const recoverable = typeof nested.recoverable === "boolean"
    ? nested.recoverable
    : typeof errorRecord?.recoverable === "boolean" ? errorRecord.recoverable : true;
  return { code, message, recoverable };
}

function officialResponseCandidates(payload: Record<string, unknown>) {
  const result = objectRecord(payload.result);
  const data = objectRecord(payload.data);
  const resultStructured = objectRecord(result.structuredContent);
  const dataStructured = objectRecord(data.structuredContent);
  return [
    payload,
    objectRecord(payload._meta),
    result,
    objectRecord(result._meta),
    resultStructured,
    objectRecord(resultStructured._meta),
    objectRecord(result.data),
    data,
    objectRecord(data._meta),
    dataStructured,
    objectRecord(dataStructured._meta),
    objectRecord(data.result)
  ];
}

function isValidMcpSuccessEnvelope(payload: Record<string, unknown>) {
  return officialResponseCandidates(payload).some((candidate) => {
    const result = Array.isArray(candidate.content)
      ? candidate
      : objectRecord(candidate.result);
    const structuredContent = objectRecord(result.structuredContent);
    const receipt = objectRecord(structuredContent.receipt);
    return Object.keys(result).length > 0
      && result.isError !== true
      && result.is_error !== true
      && Array.isArray(result.content)
      && structuredContent.ok === true
      && typeof receipt.operationId === "string"
      && typeof receipt.status === "string";
  });
}

function officialToolTerminalData(payload: Record<string, unknown>, terminalEvent: "completed" | "failed") {
  const responseTrace = officialMcpResponseTrace(payload, terminalEvent);
  return {
    hermesResultObserved: true,
    officialHermesToolTerminalEvent: terminalEvent,
    ...(responseTrace ? { mcpResponseTrace: responseTrace } : {})
  };
}

function officialMcpResponseTrace(payload: Record<string, unknown>, terminalEvent: "completed" | "failed") {
  const candidates = officialResponseCandidates(payload);
  for (const candidate of candidates) {
    const direct = objectRecord(candidate.mcpResponseTrace);
    const namespaced = objectRecord(candidate["careeradapt/mcpResponseTrace"]);
    const diagnostics = objectRecord(candidate.diagnostics);
    const diagnosticTrace = objectRecord(diagnostics.mcpResponseTrace);
    const namespacedDiagnosticTrace = objectRecord(diagnostics["careeradapt/mcpResponseTrace"]);
    const trace = Object.keys(direct).length
      ? direct
      : Object.keys(namespaced).length
        ? namespaced
        : Object.keys(diagnosticTrace).length
          ? diagnosticTrace
          : namespacedDiagnosticTrace;
    if (!Object.keys(trace).length) continue;
    return {
      ...(typeof trace.handlerResultCreated === "boolean" ? { handlerResultCreated: trace.handlerResultCreated } : {}),
      ...(typeof trace.responseSerialized === "boolean" ? { responseSerialized: trace.responseSerialized } : {}),
      ...(typeof trace.responseBytesBucket === "string" ? { responseBytesBucket: trace.responseBytesBucket } : {}),
      ...(typeof trace.responseEnvelopeValid === "boolean" ? { responseEnvelopeValid: trace.responseEnvelopeValid } : {}),
      ...(typeof trace.responseSent === "boolean" ? { responseSent: trace.responseSent } : {}),
      hermesResultObserved: true,
      officialHermesToolTerminalEvent: terminalEvent
    };
  }
  return undefined;
}

function safeOfficialToolFailureData(payload: Record<string, unknown>, code: string) {
  const result = objectRecord(payload.result);
  const nestedDiagnostics = [
    objectRecord(payload.diagnostics),
    objectRecord(result.diagnostics),
    objectRecord(objectRecord(payload.error).diagnostics),
    objectRecord(objectRecord(result.error).diagnostics)
  ].find((candidate) => Object.keys(candidate).length > 0) ?? {};
  return {
    toolFailureLayer: "hermes_tool_protocol",
    safeDomainErrorCode: code,
    toolResultIsError: true,
    failedStage: "hermes_tool_protocol",
    ...(typeof payload.tool_call_id === "string" ? { toolCallId: payload.tool_call_id } : {}),
    ...(typeof payload.operation_id === "string" ? { operationId: payload.operation_id } : {}),
    ...(typeof result.status === "string" ? { upstreamStatus: result.status } : {}),
    ...(typeof payload.stableCareerToolName === "string" ? { stableCareerToolName: payload.stableCareerToolName } : {}),
    ...(typeof payload.stable_tool_name === "string" ? { stableCareerToolName: payload.stable_tool_name } : {}),
    ...(typeof nestedDiagnostics.failureKind === "string" ? { failureKind: nestedDiagnostics.failureKind } : {}),
    ...(typeof nestedDiagnostics.failureScope === "string" ? { failureScope: nestedDiagnostics.failureScope } : {}),
    ...(typeof nestedDiagnostics.duplicateProjection === "boolean" ? { duplicateProjection: nestedDiagnostics.duplicateProjection } : {}),
    ...(typeof nestedDiagnostics.publishedContractVersion === "string" ? { publishedContractVersion: nestedDiagnostics.publishedContractVersion } : {}),
    ...(typeof nestedDiagnostics.publishedSchemaHash === "string" ? { publishedSchemaHash: nestedDiagnostics.publishedSchemaHash } : {})
  };
}

function isTransientHermesEventError(message: string) {
  return /(?:timeout|timed out|temporar|unavailable|overload|rate limit|reset|502|503|504|429)/iu.test(message);
}

/** Convert the compatibility health shape into the authoritative contract. */
export function toRuntimeHealth(
  health: HermesHealth,
  overrides: Partial<Pick<RuntimeHealth,
    | "mcpConnected"
    | "mcpToolCount"
    | "careerSkillsLoaded"
    | "browserCareerDomainHostConnected"
    | "careerMcpServerReachable"
    | "careerMcpContractCount"
    | "hermesMcpRegistered"
    | "hermesMcpToolCount"
    | "hermesCareerFacadeCount"
    | "requiredCareerFacadesMissing"
    | "careerGatewayContracts"
    | "careerMcpExposedTools"
    | "hermesRegisteredToolsets"
    | "hermesVisibleTools"
    | "missingRequiredCareerTools"
  >> = {}
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
    ...(health.activeRunId ? { activeRunId: health.activeRunId } : {}),
    ...(health.hermesRunId ? { hermesRunId: health.hermesRunId } : {}),
    runtimeAvailable: health.available,
    providerConfigured,
    providerReachable,
    ...(health.model ? { model: health.model } : {}),
    ...(health.contextWindow === undefined ? {} : { contextWindow: health.contextWindow }),
    toolCallingCapability: health.toolCallingCapability ?? health.toolCalling ?? "unknown",
    toolCallingAvailable: (health.toolCallingCapability ?? health.toolCalling) === "verified",
    toolCallInFlight: health.toolCallInFlight ?? false,
    mcpConnected: overrides.mcpConnected ?? health.mcpConnected ?? false,
    mcpToolCount: overrides.mcpToolCount ?? health.discoveredToolCount ?? 0,
    careerSkillsLoaded: overrides.careerSkillsLoaded ?? false,
    lastCheckedAt: new Date().toISOString(),
    ...(health.reason ? { safeErrorCode: safeRuntimeErrorCode(health.reason) } : {})
  });
}

async function safeJson(response: Response) {
  try {
    return await response.json() as { error?: { code?: string; message?: string; diagnostics?: Partial<HermesRunFailureDiagnostics> } };
  } catch {
    return undefined;
  }
}

function bridgeError(
  code: string,
  message: string,
  context: {
    httpStatus?: number;
    failureLayer?: "companion" | "session" | "provider" | "mcp" | "run_start" | "bridge_http" | "response";
    upstreamErrorCode?: string;
    hermesRunId?: string;
    diagnostics?: Partial<HermesRunFailureDiagnostics>;
  } = {}
) {
  const { diagnostics, ...base } = context;
  return createHermesRunFailure({ code, message, ...diagnostics, ...base });
}

function safeRuntimeErrorCode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return normalized.slice(0, 120) || "hermes_health_failed";
}

function safeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : undefined;
}

function safeRunId(value: unknown) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return safeString(record.runId) ?? safeString(record.run_id);
}

function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "hermes_bridge_failed";
  const value = error as { code?: unknown; diagnostics?: { safeErrorCode?: unknown } };
  return safeString(value.diagnostics?.safeErrorCode) ?? safeString(value.code) ?? "hermes_bridge_failed";
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { httpStatus?: unknown; diagnostics?: { httpStatus?: unknown } };
  const status = value.httpStatus ?? value.diagnostics?.httpStatus;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}
