import { z } from "zod";

export const RunStopRequesterSchema = z.enum([
  "user",
  "agent_runtime_provider",
  "hermes_supervisor",
  "renderer_unmount",
  "application_shutdown",
  "run_reconciliation",
  "runtime_recovery",
  "unknown"
]);

export type RunStopRequester = z.infer<typeof RunStopRequesterSchema>;

export const RunStopReasonSchema = z.object({
  requestedBy: RunStopRequesterSchema,
  reasonCode: z.string().min(1).max(160),
  sourceComponent: z.string().min(1).max(160),
  sessionId: z.string().min(1).optional(),
  logicalTurnId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  requestedAt: z.string().datetime({ offset: true }),
  incidentTraceId: z.string().min(1).optional()
}).strict();

export type RunStopReason = z.infer<typeof RunStopReasonSchema>;

export const RuntimeAttemptSchema = z.object({
  attemptNumber: z.number().int().min(1),
  traceId: z.string().min(1),
  sessionId: z.string().min(1),
  turnId: z.string().min(1),
  hermesSessionId: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  startRequestedAt: z.string().datetime({ offset: true }).optional(),
  runStartedAt: z.string().datetime({ offset: true }).optional(),
  runStartStatus: z.enum(["started", "queued", "running"]).optional(),
  firstEventAt: z.string().datetime({ offset: true }).optional(),
  terminalAt: z.string().datetime({ offset: true }).optional(),
  terminalStatus: z.enum(["completed", "failed", "cancelled"]).optional(),
  status: z.enum(["requested", "queued", "running", "waiting_for_approval", "completed", "failed", "cancelled", "paused"]),
  lastEventType: z.string().min(1).optional(),
  failureCode: z.string().min(1).optional(),
  failureLayer: z.string().min(1).optional(),
  retryable: z.boolean().optional(),
  recoveryReason: z.string().min(1).optional(),
  recoveryKind: z.enum(["reattach", "retry", "restart"]).optional(),
  cancellationOwner: z.string().min(1).optional(),
  stopReason: RunStopReasonSchema.optional()
}).strict();

export type RuntimeAttempt = z.infer<typeof RuntimeAttemptSchema>;

export const RuntimeCausalChainEntrySchema = z.object({
  event: z.string().min(1).max(120),
  component: z.string().min(1).max(160),
  at: z.string().datetime({ offset: true }),
  runId: z.string().min(1).optional(),
  attemptTraceId: z.string().min(1).optional(),
  detail: z.string().max(360).optional()
}).strict();

export type RuntimeCausalChainEntry = z.infer<typeof RuntimeCausalChainEntrySchema>;

export const SecondaryRecoveryFailureSchema = z.object({
  code: z.string().min(1).max(160),
  message: z.string().min(1).max(360),
  operation: z.string().min(1).max(80),
  capturedAt: z.string().datetime({ offset: true }),
  runId: z.string().min(1).optional(),
  attemptTraceId: z.string().min(1).optional(),
  httpStatus: z.number().int().min(100).max(599).optional()
}).strict();

export type SecondaryRecoveryFailure = z.infer<typeof SecondaryRecoveryFailureSchema>;

export const AbortTraceSchema = z.object({
  abortSource: z.enum([
    "run_completed",
    "user_cancel",
    "workflow_pause",
    "navigation",
    "component_unmount",
    "network_timeout",
    "inactivity_watchdog",
    "absolute_stream_timeout",
    "unknown_upstream",
    "user_interrupt",
    "renderer_unmount",
    "new_turn_superseded",
    "runtime_restart",
    "page_navigation",
    "runtime_recovery",
    "unknown_abort"
  ]),
  abortReason: z.string().min(1).max(240).optional(),
  abortedAt: z.string().datetime({ offset: true }),
  incidentTraceId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  runId: z.string().min(1).optional()
}).strict();

export type AbortTrace = z.infer<typeof AbortTraceSchema>;

export const EventStreamDiagnosticSchema = z.object({
  openedAt: z.string().datetime({ offset: true }),
  lastEventAt: z.string().datetime({ offset: true }).optional(),
  closedAt: z.string().datetime({ offset: true }).optional(),
  closeReason: z.string().min(1).max(160).optional(),
  abortedBy: z.string().min(1).max(80).optional(),
  absoluteLifetimeMs: z.number().int().min(0).optional(),
  localTimeoutConfiguredMs: z.number().int().min(0).optional()
}).strict();

export type EventStreamDiagnostic = z.infer<typeof EventStreamDiagnosticSchema>;

export const BridgeRequestTraceSchema = z.object({
  action: z.enum(["run_start", "run_events", "run_status", "run_stop", "run_approval", "session_create", "session_resume", "turn", "tool_callback", "interrupt", "health"]),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).optional(),
  latencyMs: z.number().int().min(0).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  safeErrorCode: z.string().min(1).optional(),
  runId: z.string().min(1).optional(),
  turnId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  incidentTraceId: z.string().min(1).optional(),
  abortedAt: z.string().datetime({ offset: true }).optional(),
  abortSource: z.string().min(1).optional()
}).strict();

export type BridgeRequestTrace = z.infer<typeof BridgeRequestTraceSchema>;

export type HermesSupervisorFailureSnapshot = {
  overallState: string;
  processReady: boolean;
  apiReady: boolean;
  providerReady: boolean;
  careerMcpReady: boolean;
  toolSurfaceReady: boolean;
  runReady: boolean;
  reasonCode?: string;
  activeRunId?: string;
  restartAttempt: number;
  capturedAt?: string;
  maintenancePending?: boolean;
};

export type RuntimeRunSnapshot = {
  runId?: string;
  status?: string;
  lastEvent?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type RuntimeFailureSnapshot = {
  capturedAt: string;
  supervisor: HermesSupervisorFailureSnapshot;
  runtimeHealth?: Record<string, unknown>;
  run: RuntimeRunSnapshot;
};

export type RuntimeStartSnapshot = RuntimeFailureSnapshot;

const RuntimeSupervisorSnapshotSchema = z.object({
  overallState: z.string().min(1),
  processReady: z.boolean(),
  apiReady: z.boolean(),
  providerReady: z.boolean(),
  careerMcpReady: z.boolean(),
  toolSurfaceReady: z.boolean(),
  runReady: z.boolean(),
  reasonCode: z.string().min(1).optional(),
  activeRunId: z.string().min(1).optional(),
  restartAttempt: z.number().int().min(0),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  maintenancePending: z.boolean().optional()
}).strict();

export const RuntimeFailureSnapshotSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  supervisor: RuntimeSupervisorSnapshotSchema,
  runtimeHealth: z.record(z.string(), z.unknown()).optional(),
  run: z.object({
    runId: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    lastEvent: z.string().min(1).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional()
  }).strict()
}).strict();

export function createIncidentTraceId() {
  return `incident-${crypto.randomUUID()}`;
}

export function createRunStopReason(input: Omit<RunStopReason, "requestedAt"> & { requestedAt?: string }): RunStopReason {
  return RunStopReasonSchema.parse({
    ...input,
    requestedAt: input.requestedAt ?? new Date().toISOString()
  });
}

export function abortSourceForReason(reason: unknown): AbortTrace["abortSource"] {
  const value = reason && typeof reason === "object" && !Array.isArray(reason)
    ? reason as Record<string, unknown>
    : {};
  const source = typeof value.abortSource === "string" ? value.abortSource : typeof value.reasonCode === "string" ? value.reasonCode : "";
  if (source === "run_completed") return source;
  if (source === "user_cancel" || source === "user_stop") return "user_cancel";
  if (source === "workflow_pause" || source === "workflow_paused") return "workflow_pause";
  if (source === "navigation") return source;
  if (source === "component_unmount") return source;
  if (source === "network_timeout" || source === "timeout" || source === "AbortError") return "network_timeout";
  if (source === "inactivity_watchdog") return source;
  if (source === "absolute_stream_timeout") return source;
  if (source === "unknown_upstream") return source;
  if (source === "user_interrupt") return source;
  if (source === "renderer_unmount") return source;
  if (source === "new_turn_superseded") return source;
  if (source === "runtime_restart" || source === "hermes_run_stopped_for_restart") return "runtime_restart";
  if (source === "page_navigation") return source;
  if (source === "runtime_recovery") return source;
  return "unknown_upstream";
}

export function abortTraceFromSignal(signal: AbortSignal | undefined, input: Omit<AbortTrace, "abortSource" | "abortReason" | "abortedAt">): AbortTrace | undefined {
  if (!signal?.aborted) return undefined;
  const reason = signal.reason;
  const record = reason && typeof reason === "object" && !Array.isArray(reason)
    ? reason as Record<string, unknown>
    : {};
  const abortReason = typeof record.abortReason === "string"
    ? record.abortReason
    : typeof record.reasonCode === "string"
      ? record.reasonCode
      : typeof reason === "string" ? reason : undefined;
  return AbortTraceSchema.parse({
    ...input,
    abortSource: abortSourceForReason(reason),
    ...(abortReason ? { abortReason: abortReason.slice(0, 240) } : {}),
    abortedAt: new Date().toISOString()
  });
}
