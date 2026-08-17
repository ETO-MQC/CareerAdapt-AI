import { z } from "zod";

export type HermesFailureLayer =
  | "companion"
  | "session"
  | "provider"
  | "mcp"
  | "run_start"
  | "bridge_http"
  | "response";

export type HermesRunFailureDiagnostics = {
  failureLayer: HermesFailureLayer;
  httpStatus?: number;
  safeErrorCode: string;
  safeErrorMessage: string;
  upstreamErrorCode?: string;
  hermesSessionId?: string;
  hermesRunId?: string;
  requestedTurnId?: string;
  runStartKind?: "new" | "reattach";
  companionConnected?: boolean;
  providerStatus?: string;
  mcpConnected?: boolean;
  latencyMs?: number;
  incidentTraceId?: string;
  attemptTraceId?: string;
  retryable: boolean;
};

export const HermesRunFailureDiagnosticsSchema = z.object({
  failureLayer: z.enum(["companion", "session", "provider", "mcp", "run_start", "bridge_http", "response"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  safeErrorCode: z.string().min(1),
  safeErrorMessage: z.string().min(1),
  upstreamErrorCode: z.string().min(1).optional(),
  hermesSessionId: z.string().min(1).optional(),
  hermesRunId: z.string().min(1).optional(),
  requestedTurnId: z.string().min(1).optional(),
  runStartKind: z.enum(["new", "reattach"]).optional(),
  companionConnected: z.boolean().optional(),
  providerStatus: z.string().min(1).optional(),
  mcpConnected: z.boolean().optional(),
  latencyMs: z.number().int().min(0).optional(),
  incidentTraceId: z.string().min(1).optional(),
  attemptTraceId: z.string().min(1).optional(),
  retryable: z.boolean()
}).strict();

export type HermesRunFailureError = Error & {
  code: string;
  diagnostics?: HermesRunFailureDiagnostics;
  retryable?: boolean;
  httpStatus?: number;
};

export type HermesRunFailureInput = {
  code?: string;
  message?: string;
  httpStatus?: number;
  failureLayer?: HermesFailureLayer;
  upstreamErrorCode?: string;
  hermesSessionId?: string;
  hermesRunId?: string;
  requestedTurnId?: string;
  runStartKind?: "new" | "reattach";
  companionConnected?: boolean;
  providerStatus?: string;
  mcpConnected?: boolean;
  latencyMs?: number;
  incidentTraceId?: string;
  attemptTraceId?: string;
  retryable?: boolean;
};

/**
 * Keep the original run-start failure useful to the host without allowing
 * provider responses, prompts, or private Career data to cross the boundary.
 */
export function createHermesRunFailure(input: HermesRunFailureInput): HermesRunFailureError {
  const classified = classifyHermesRunFailure(input);
  const error = new Error(classified.safeErrorMessage) as HermesRunFailureError;
  error.name = "HermesRunFailureError";
  error.code = classified.safeErrorCode;
  error.retryable = classified.retryable;
  error.httpStatus = classified.httpStatus;
  error.diagnostics = classified;
  return error;
}

export function classifyHermesRunFailure(input: HermesRunFailureInput): HermesRunFailureDiagnostics {
  const sourceCode = safeCode(input.code) ?? "hermes_run_start_failed";
  const sourceMessage = safeMessage(input.message) ?? "Hermes 本轮任务没有启动。";
  const status = input.httpStatus;
  const code = sourceCode.toLowerCase();
  const message = sourceMessage.toLowerCase();
  const authFailure = status === 401 || status === 403
    || /auth|unauthor|forbidden|invalid[_ -]?api[_ -]?key|credential/u.test(code)
    || /auth|unauthor|forbidden|api key|credential/u.test(message);
  const timeout = /timeout|timed[_ -]?out|abort/u.test(code) || /timeout|timed out|aborted/u.test(message);
  const activeConflict = status === 409
    || /active[_ -]?run|run[_ -]?conflict|already[_ -]?running|conflict/u.test(code)
    || /active run|already running|run conflict/u.test(message);
  const invalidResponse = /invalid[_ -]?(response|run)|missing[_ -]?run|schema/u.test(code)
    || /invalid response|missing run|run[_ ]?id/u.test(message);
  const configurationFailure = /config|unconfigured|not[_ -]?configured|missing[_ -]?(api|model|provider)/u.test(code)
    || /configuration|not configured|missing (api|model|provider)/u.test(message);
  const providerFailure = /provider|model|upstream/u.test(code) || /provider|model|upstream/u.test(message);
  const transientHttp = status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
  const companionFailure = /companion|bridge[_ -]?(unavailable|http)|network|connect/u.test(code)
    || /companion|bridge|network|connect/u.test(message);

  let safeErrorCode = sourceCode;
  let retryable = input.retryable ?? true;
  let failureLayer = input.failureLayer ?? "run_start";
  if (authFailure) {
    safeErrorCode = "hermes_provider_auth_failed";
    retryable = false;
    failureLayer = "provider";
  } else if (invalidResponse) {
    safeErrorCode = "hermes_run_start_invalid_response";
    retryable = false;
    failureLayer = "response";
  } else if (activeConflict) {
    safeErrorCode = "hermes_active_run_conflict";
    retryable = true;
    failureLayer = "run_start";
  } else if (timeout) {
    safeErrorCode = "hermes_run_start_timeout";
    retryable = true;
    failureLayer = "bridge_http";
  } else if (configurationFailure) {
    safeErrorCode = "hermes_provider_unconfigured";
    retryable = false;
    failureLayer = "provider";
  } else if (providerFailure && (status === 400 || status === 422 || input.providerStatus === "invalid")) {
    safeErrorCode = "hermes_provider_unavailable";
    retryable = false;
    failureLayer = "provider";
  } else if (companionFailure && status === undefined) {
    safeErrorCode = "hermes_companion_unavailable";
    retryable = true;
    failureLayer = "companion";
  } else if (transientHttp) {
    safeErrorCode = "hermes_run_start_http_failed";
    retryable = true;
    failureLayer = "bridge_http";
  } else if (status !== undefined && status >= 400) {
    safeErrorCode = "hermes_run_start_http_failed";
    retryable = false;
    failureLayer = "bridge_http";
  } else if (sourceCode === "hermes_bridge_unavailable") {
    safeErrorCode = "hermes_companion_unavailable";
    retryable = true;
    failureLayer = "companion";
  }

  return {
    failureLayer,
    ...(status === undefined ? {} : { httpStatus: status }),
    safeErrorCode,
    safeErrorMessage: sourceMessage,
    ...(sourceCode !== safeErrorCode ? { upstreamErrorCode: sourceCode } : {}),
    ...(input.hermesSessionId ? { hermesSessionId: input.hermesSessionId } : {}),
    ...(input.hermesRunId ? { hermesRunId: input.hermesRunId } : {}),
    ...(input.requestedTurnId ? { requestedTurnId: input.requestedTurnId } : {}),
    ...(input.runStartKind ? { runStartKind: input.runStartKind } : {}),
    ...(input.companionConnected === undefined ? {} : { companionConnected: input.companionConnected }),
    ...(input.providerStatus ? { providerStatus: input.providerStatus } : {}),
    ...(input.mcpConnected === undefined ? {} : { mcpConnected: input.mcpConnected }),
    ...(input.latencyMs === undefined ? {} : { latencyMs: Math.max(0, Math.round(input.latencyMs)) }),
    ...(input.incidentTraceId ? { incidentTraceId: input.incidentTraceId } : {}),
    ...(input.attemptTraceId ? { attemptTraceId: input.attemptTraceId } : {}),
    retryable
  };
}

export function withHermesRunFailureDiagnostics(
  error: unknown,
  context: Omit<HermesRunFailureInput, "code" | "message"> = {}
): HermesRunFailureError {
  const source = error as Partial<HermesRunFailureError>;
  const diagnostics = source.diagnostics;
  if (diagnostics) {
    const merged = classifyHermesRunFailure({
      ...diagnostics,
      ...context,
      code: source.code ?? diagnostics.safeErrorCode,
      message: source.message ?? diagnostics.safeErrorMessage
    });
    const next = createHermesRunFailure(merged);
    next.diagnostics = merged;
    return next;
  }
  return createHermesRunFailure({
    ...context,
    code: typeof source.code === "string" ? source.code : undefined,
    message: source.message
  });
}

export function isRetryableHermesRunFailure(error: unknown) {
  const candidate = error as Partial<HermesRunFailureError>;
  if (candidate.diagnostics) return candidate.diagnostics.retryable;
  if (candidate.retryable !== undefined) return candidate.retryable;
  const code = typeof candidate.code === "string" ? candidate.code : "";
  return classifyHermesRunFailure({ code }).retryable;
}

export function isHermesRuntimeFailureCode(code?: string) {
  return Boolean(code)
    && code !== "hermes_tool_failed"
    && code !== "hermes_run_cancelled"
    && code !== "hermes_run_stopped_by_user"
    && code !== "hermes_run_stopped_for_restart"
    && (code!.startsWith("hermes_") || code === "mcp_unavailable_before_turn");
}

function safeCode(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{3,120}$/u.test(value) ? value : undefined;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return redactSensitiveText(value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, 360);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-key]")
    .replace(/\b(?:x-api-key|api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "[redacted-secret]");
}
