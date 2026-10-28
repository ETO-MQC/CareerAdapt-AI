import { z } from "zod";

export type HermesFailureLayer =
  | "companion"
  | "session"
  | "provider"
  | "mcp"
  | "control_plane"
  | "run_start"
  | "bridge_http"
  | "response";

export type HermesSafeErrorCategory =
  | "runtime_control_auth"
  | "credential_unavailable"
  | "provider_rate_limit"
  | "provider_http"
  | "request_timeout"
  | "provider_auth"
  | "provider_request_invalid"
  | "model_not_found"
  | "tool_schema_invalid"
  | "context_overflow"
  | "provider_timeout"
  | "mcp_tool_failure"
  | "mcp_connection"
  | "model_error"
  | "hermes_internal_failure"
  | "runtime_internal"
  | "transport_failure"
  | "unknown";

export type HermesRunFailureDiagnostics = {
  failureLayer: HermesFailureLayer;
  httpStatus?: number;
  safeErrorCode: string;
  safeErrorMessage: string;
  upstreamErrorCode?: string;
  upstreamErrorType?: string;
  safeErrorCategory: HermesSafeErrorCategory;
  safeMessageCategory?: "auth" | "invalid_request" | "conflict" | "provider" | "transport" | "unknown";
  hermesSessionId?: string;
  hermesRunId?: string;
  activeRunId?: string;
  sessionId?: string;
  requestedTurnId?: string;
  requestState?: string;
  controllerState?: string;
  existingPendingTurnId?: string;
  existingActiveTurnId?: string;
  runStartKind?: "new" | "reattach";
  runPhase?: "before_run_start" | "after_run_start";
  companionConnected?: boolean;
  providerStatus?: string;
  provider?: string;
  model?: string;
  lastHermesEventType?: string;
  toolName?: string;
  mcpConnected?: boolean;
  latencyMs?: number;
  incidentTraceId?: string;
  attemptTraceId?: string;
  retryable: boolean;
};

export const HermesRunFailureDiagnosticsSchema = z.object({
  failureLayer: z.enum(["companion", "session", "provider", "mcp", "control_plane", "run_start", "bridge_http", "response"]),
  httpStatus: z.number().int().min(100).max(599).optional(),
  safeErrorCode: z.string().min(1),
  safeErrorMessage: z.string().min(1),
  upstreamErrorCode: z.string().min(1).optional(),
  upstreamErrorType: z.string().min(1).max(120).optional(),
  safeErrorCategory: z.enum([
    "runtime_control_auth",
    "credential_unavailable",
    "provider_rate_limit",
    "provider_http",
    "request_timeout",
    "provider_auth",
    "provider_request_invalid",
    "model_not_found",
    "tool_schema_invalid",
    "context_overflow",
    "provider_timeout",
    "mcp_tool_failure",
    "mcp_connection",
    "model_error",
    "hermes_internal_failure",
    "runtime_internal",
    "transport_failure",
    "unknown"
  ]).optional(),
  safeMessageCategory: z.enum(["auth", "invalid_request", "conflict", "provider", "transport", "unknown"]).optional(),
  hermesSessionId: z.string().min(1).optional(),
  hermesRunId: z.string().min(1).optional(),
  activeRunId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  requestedTurnId: z.string().min(1).optional(),
  requestState: z.string().min(1).max(120).optional(),
  controllerState: z.string().min(1).max(120).optional(),
  existingPendingTurnId: z.string().min(1).optional(),
  existingActiveTurnId: z.string().min(1).optional(),
  runStartKind: z.enum(["new", "reattach"]).optional(),
  runPhase: z.enum(["before_run_start", "after_run_start"]).optional(),
  companionConnected: z.boolean().optional(),
  providerStatus: z.string().min(1).optional(),
  provider: z.string().min(1).max(160).optional(),
  model: z.string().min(1).max(160).optional(),
  lastHermesEventType: z.string().min(1).max(160).optional(),
  toolName: z.string().min(1).max(160).optional(),
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
  upstreamErrorType?: string;
  safeErrorCategory?: HermesSafeErrorCategory;
  safeMessageCategory?: HermesRunFailureDiagnostics["safeMessageCategory"];
  hermesSessionId?: string;
  hermesRunId?: string;
  activeRunId?: string;
  sessionId?: string;
  requestedTurnId?: string;
  requestState?: string;
  controllerState?: string;
  existingPendingTurnId?: string;
  existingActiveTurnId?: string;
  runStartKind?: "new" | "reattach";
  runPhase?: "before_run_start" | "after_run_start";
  companionConnected?: boolean;
  providerStatus?: string;
  provider?: string;
  model?: string;
  lastHermesEventType?: string;
  toolName?: string;
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
  const sourceMessage = safeMessage(input.message)
    ?? (input.runPhase === "after_run_start" ? "Hermes 本轮任务没有完成。" : "Hermes 本轮任务没有启动。");
  const status = input.httpStatus;
  const code = sourceCode.toLowerCase();
  // Free text is display evidence only; it must never establish a root cause.
  const credentialFailure = ["credential_store_read_failed", "credential_store_unavailable", "credential_store_not_configured", "provider_credential_missing"].includes(code);
  const authFailure = ((status === 401 || status === 403) && (input.failureLayer === "provider" || (!input.failureLayer && /^(?:hermes_)?provider_/u.test(code))))
    || /^(?:hermes_)?provider_(?:auth_invalid|auth_failed|http_401|http_403)$/u.test(code);
  const timeout = /timeout|timed[_ -]?out|abort/u.test(code);
  const activeConflict = status === 409
    || /active[_ -]?run|run[_ -]?conflict|already[_ -]?running|conflict/u.test(code);
  const invalidResponse = /invalid[_ -]?(response|run)|missing[_ -]?run|schema/u.test(code);
  const configurationFailure = /config|unconfigured|not[_ -]?configured|missing[_ -]?(api|model|provider)/u.test(code);
  const providerFailure = /provider|model|upstream/u.test(code);
  const runtimeControlFailure = input.failureLayer === "control_plane"
    || input.safeErrorCategory === "runtime_control_auth"
    || /gateway[_ -]?auth|api[_ -]?server[_ -]?key|runtime[_ -]?(?:control|auth)/u.test(code);
  const transientHttp = status === 408 || status === 425 || status === 429 || (status !== undefined && status >= 500);
  const companionFailure = /companion|bridge[_ -]?(unavailable|http)|network|connect/u.test(code);
  const postStartOperation = /^hermes_run_(events|status|approval|stop)_(failed|timeout)$/u.test(sourceCode);
  const postStartPhase = input.runPhase === "after_run_start";
  const modelNotFound = ["hermes_model_not_found", "provider_model_not_found"].includes(code) || /(?:model|deployment).*(?:not found|does not exist|unknown|missing)|(?:not found|does not exist).*(?:model|deployment)/u.test(code);
  const toolSchemaInvalid = /(?:tool|function|mcp).*(?:schema|contract).*(?:invalid|error)|(?:invalid|malformed).*(?:tool|function|mcp)/u.test(code);
  const contextOverflow = /context|token.*(?:limit|length|overflow)|too many tokens|maximum context/u.test(code);
  const mcpToolFailure = input.failureLayer === "mcp"
    || /mcp|tool[_ -]?(?:call|execution|failure)|function[_ -]?call/u.test(code);
  const modelError = input.safeErrorCategory === "model_error"
    || /(?:model|inference|completion|generation)[_ -]?(?:error|failure|failed|unavailable)/u.test(code);
  const runtimeInternalFailure = input.safeErrorCategory === "runtime_internal"
    || /runtime[_ -]?(?:internal|error|failure|exception)/u.test(code);
  const hermesInternalFailure = /hermes.*(?:internal|server)|internal.*(?:error|failure)|server error/u.test(code);
  const providerRequestInvalid = status === 400 || status === 422
    || /invalid[_ -]?(?:request|parameter|input)|bad[_ -]?request/u.test(code);
  const providerTimeout = timeout && (input.failureLayer === "provider" || providerFailure);
  const mcpConnectionFailure = input.failureLayer === "mcp"
    && /connect|unreachable|unavailable|handshake/u.test(code);
  const transportFailure = input.failureLayer === "companion"
    || input.failureLayer === "bridge_http"
    || companionFailure
    || transientHttp;
  const safeErrorCategory = input.safeErrorCategory ?? (
    credentialFailure ? "credential_unavailable"
      : runtimeControlFailure ? "runtime_control_auth"
      : authFailure ? "provider_auth"
      : input.failureLayer === "provider" && status === 429 ? "provider_rate_limit"
      : input.failureLayer === "provider" && status !== undefined && status >= 400 && ![400, 422].includes(status) ? "provider_http"
      : timeout && !providerTimeout ? "request_timeout"
      : modelNotFound ? "model_not_found"
        : toolSchemaInvalid ? "tool_schema_invalid"
          : contextOverflow ? "context_overflow"
            : providerTimeout ? "provider_timeout"
                : mcpConnectionFailure ? "mcp_connection"
                : mcpToolFailure ? "mcp_tool_failure"
                  : modelError ? "model_error"
                    : runtimeInternalFailure ? "runtime_internal"
                      : hermesInternalFailure ? "hermes_internal_failure"
                        : providerRequestInvalid ? "provider_request_invalid"
                    : postStartOperation || activeConflict || transportFailure ? "transport_failure"
                      : "unknown"
  );
  const safeMessageCategory = input.safeMessageCategory ?? (
    ["runtime_control_auth", "provider_auth"].includes(safeErrorCategory) ? "auth"
      : activeConflict ? "conflict"
        : ["provider_request_invalid", "tool_schema_invalid", "context_overflow"].includes(safeErrorCategory) ? "invalid_request"
          : ["model_not_found", "provider_timeout", "model_error", "hermes_internal_failure"].includes(safeErrorCategory) ? "provider"
          : ["mcp_tool_failure", "mcp_connection", "transport_failure"].includes(safeErrorCategory) ? "transport"
              : "unknown"
  );

  let safeErrorCode = sourceCode;
  let retryable = input.retryable ?? true;
  let failureLayer = input.failureLayer ?? "run_start";
  if (safeErrorCategory === "credential_unavailable") {
    retryable = false;
  } else if (["provider_rate_limit", "provider_http", "provider_timeout"].includes(safeErrorCategory)) {
    failureLayer = "provider";
    retryable = input.retryable ?? (safeErrorCategory !== "provider_http" || transientHttp);
  } else if (safeErrorCategory === "runtime_control_auth") {
    safeErrorCode = sourceCode === "hermes_runtime_control_key_missing"
      ? sourceCode
      : "hermes_runtime_control_auth_failed";
    retryable = false;
    failureLayer = "control_plane";
  } else if (safeErrorCategory === "model_not_found") {
    safeErrorCode = "hermes_model_not_found";
    retryable = false;
    failureLayer = "provider";
  } else if (safeErrorCategory === "tool_schema_invalid") {
    safeErrorCode = "hermes_tool_schema_invalid";
    retryable = false;
    failureLayer = "mcp";
  } else if (safeErrorCategory === "context_overflow") {
    safeErrorCode = "hermes_context_overflow";
    retryable = false;
    failureLayer = "provider";
  } else if (safeErrorCategory === "mcp_tool_failure") {
    safeErrorCode = sourceCode === "hermes_tool_failed" ? "hermes_mcp_tool_failed" : sourceCode;
    retryable = input.retryable ?? false;
    failureLayer = "mcp";
  } else if (safeErrorCategory === "mcp_connection") {
    safeErrorCode = "hermes_mcp_connection_failed";
    retryable = input.retryable ?? true;
    failureLayer = "mcp";
  } else if (safeErrorCategory === "model_error") {
    safeErrorCode = "hermes_model_error";
    retryable = input.retryable ?? false;
    failureLayer = "provider";
  } else if (safeErrorCategory === "runtime_internal") {
    safeErrorCode = "hermes_runtime_internal";
    retryable = input.retryable ?? false;
    failureLayer = input.failureLayer ?? "bridge_http";
  } else if (safeErrorCategory === "hermes_internal_failure") {
    safeErrorCode = "hermes_internal_failure";
    retryable = input.retryable ?? false;
    failureLayer = input.failureLayer ?? "bridge_http";
  } else if (safeErrorCategory === "provider_auth" || authFailure) {
    safeErrorCode = "hermes_provider_auth_failed";
    retryable = false;
    failureLayer = "provider";
  } else if (postStartOperation) {
    // A status/events/approval/stop failure belongs to an already-created
    // run. Preserve its operation-specific code even when the provider says
    // "run id not found"; it must not be reclassified as run_start failure.
    safeErrorCode = sourceCode;
    retryable = input.retryable ?? (status === undefined || transientHttp);
    failureLayer = "bridge_http";
  } else if (invalidResponse) {
    safeErrorCode = "hermes_run_start_invalid_response";
    retryable = false;
    failureLayer = "response";
  } else if (activeConflict) {
    safeErrorCode = "hermes_active_run_conflict";
    retryable = true;
    failureLayer = "run_start";
  } else if (timeout) {
    safeErrorCode = postStartOperation ? sourceCode : "hermes_run_start_timeout";
    retryable = true;
    failureLayer = "bridge_http";
  } else if (configurationFailure) {
    safeErrorCode = "hermes_provider_unconfigured";
    retryable = false;
    failureLayer = "provider";
  } else if (safeErrorCategory === "provider_request_invalid"
    && (providerFailure || input.providerStatus === "invalid" || input.failureLayer === "provider")) {
    safeErrorCode = "hermes_provider_unavailable";
    retryable = false;
    failureLayer = "provider";
  } else if (companionFailure && status === undefined && input.failureLayer !== "provider") {
    safeErrorCode = sourceCode === "hermes_companion_unreachable" ? sourceCode : "hermes_companion_unavailable";
    retryable = true;
    failureLayer = "companion";
  } else if (transientHttp) {
    safeErrorCode = postStartOperation ? sourceCode : "hermes_run_start_http_failed";
    retryable = true;
    failureLayer = "bridge_http";
  } else if (status !== undefined && status >= 400) {
    safeErrorCode = postStartOperation ? sourceCode : "hermes_run_start_http_failed";
    retryable = false;
    failureLayer = "bridge_http";
  } else if (postStartPhase && (sourceCode === "hermes_unavailable_before_turn" || sourceCode.startsWith("hermes_run_start_"))) {
    safeErrorCode = "hermes_run_failed_after_start";
    retryable = input.retryable ?? true;
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
    ...((input.upstreamErrorCode || sourceCode !== safeErrorCode) ? { upstreamErrorCode: safeCode(input.upstreamErrorCode) ?? sourceCode } : {}),
    ...(input.upstreamErrorType && /^[A-Za-z0-9_.:-]{1,120}$/u.test(input.upstreamErrorType) ? { upstreamErrorType: input.upstreamErrorType } : {}),
    safeErrorCategory,
    safeMessageCategory,
    ...(input.hermesSessionId ? { hermesSessionId: input.hermesSessionId } : {}),
    ...(input.hermesRunId ? { hermesRunId: input.hermesRunId } : {}),
    ...(input.activeRunId ? { activeRunId: input.activeRunId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.requestedTurnId ? { requestedTurnId: input.requestedTurnId } : {}),
    ...(input.requestState ? { requestState: input.requestState.slice(0, 120) } : {}),
    ...(input.controllerState ? { controllerState: input.controllerState.slice(0, 120) } : {}),
    ...(input.existingPendingTurnId ? { existingPendingTurnId: input.existingPendingTurnId } : {}),
    ...(input.existingActiveTurnId ? { existingActiveTurnId: input.existingActiveTurnId } : {}),
    ...(input.runStartKind ? { runStartKind: input.runStartKind } : {}),
    ...(input.runPhase ? { runPhase: input.runPhase } : {}),
    ...(input.companionConnected === undefined ? {} : { companionConnected: input.companionConnected }),
    ...(input.providerStatus ? { providerStatus: input.providerStatus } : {}),
    ...(input.provider ? { provider: input.provider.slice(0, 160) } : {}),
    ...(input.model ? { model: input.model.slice(0, 160) } : {}),
    ...(input.lastHermesEventType ? { lastHermesEventType: input.lastHermesEventType.slice(0, 160) } : {}),
    ...(input.toolName ? { toolName: input.toolName.slice(0, 160) } : {}),
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
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{3,120}$/u.test(value) && !/^(?:sk|rk)-/u.test(value) ? value : undefined;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return redactSensitiveText(value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim()).slice(0, 360);
}

function redactSensitiveText(value: string) {
  return value
    .replace(/["']?(?:x-api-key|api[_ -]?key|authorization|token|secret|password)["']?\s*[:=]\s*["'][^"']*["']/giu, "[redacted-secret]")
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-key]")
    .replace(/\b(?:x-api-key|api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "[redacted-secret]");
}

/** Allowlisted system-boundary evidence; never copy exception text, URL, headers or stack. */
export function companionHealthFailure(error: unknown): HermesRunFailureDiagnostics {
  const record = error && typeof error === "object" ? error as { name?: unknown; cause?: { code?: unknown } } : {};
  const cause = record.cause?.code;
  const networkCode = typeof cause === "string" && ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EHOSTUNREACH", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(cause) ? cause : undefined;
  const timeout = record.name === "TimeoutError";
  const exceptionType = typeof record.name === "string"
    && ["TypeError", "ReferenceError", "SyntaxError", "RangeError", "ZodError", "AbortError"].includes(record.name)
    ? record.name : undefined;
  return classifyHermesRunFailure({
    code: networkCode || timeout ? "hermes_companion_unreachable" : "hermes_health_check_failed",
    failureLayer: "companion",
    upstreamErrorCode: networkCode ?? (timeout ? "TimeoutError" : exceptionType),
    safeErrorCategory: networkCode || timeout ? "transport_failure" : "unknown",
    message: networkCode || timeout ? "Hermes Companion 健康检查连接失败。" : "Hermes 健康检查失败，原因尚未确定。"
  });
}
