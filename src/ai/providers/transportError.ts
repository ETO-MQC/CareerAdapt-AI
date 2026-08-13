export type AiTransportPhase = "dns" | "tcp" | "tls" | "http" | "unknown";

export type SafeAiTransportDiagnostic = {
  safeErrorCode: string;
  phase: AiTransportPhase;
  safeCauseCode?: string;
  httpStatus?: number;
};

type TransportErrorOptions = {
  requestSignal?: AbortSignal;
  deadline?: number;
};

const SAFE_CAUSE_CODES = new Set([
  "EAI_AGAIN",
  "EAI_FAIL",
  "EAI_NODATA",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_SSL_PROTOCOL_ERROR",
  "ERR_SSL_WRONG_VERSION_NUMBER",
  "ERR_TLS_HANDSHAKE_TIMEOUT"
]);

const DNS_CODES = new Set(["EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "ENOTFOUND"]);
const CONNECTION_CODES = new Set([
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE"
]);
const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT"
]);
const CERTIFICATE_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT"
]);

export function classifyAiTransportError(
  error: unknown,
  options: TransportErrorOptions = {}
): SafeAiTransportDiagnostic {
  if (options.requestSignal?.aborted) {
    return { safeErrorCode: "request_cancelled", phase: "unknown" };
  }

  if (
    (options.deadline !== undefined && Date.now() >= options.deadline)
    || isTimeoutError(error)
  ) {
    return { safeErrorCode: "provider_timeout", phase: "unknown", safeCauseCode: firstSafeCauseCode(error) };
  }

  const existingDiagnostic = safeDiagnostic(error);
  if (existingDiagnostic) return existingDiagnostic;

  const causeCode = firstSafeCauseCode(error);
  if (causeCode && DNS_CODES.has(causeCode)) {
    return { safeErrorCode: "provider_dns_failed", phase: "dns", safeCauseCode: causeCode };
  }
  if (causeCode && CONNECTION_CODES.has(causeCode)) {
    return { safeErrorCode: "provider_connection_failed", phase: "tcp", safeCauseCode: causeCode };
  }
  if (causeCode && TIMEOUT_CODES.has(causeCode)) {
    return { safeErrorCode: "provider_timeout", phase: "unknown", safeCauseCode: causeCode };
  }
  if (causeCode && CERTIFICATE_CODES.has(causeCode)) {
    return { safeErrorCode: "provider_tls_certificate_invalid", phase: "tls", safeCauseCode: causeCode };
  }
  if (causeCode && (causeCode.startsWith("ERR_TLS_") || causeCode.startsWith("ERR_SSL_"))) {
    return { safeErrorCode: "provider_tls_failed", phase: "tls", safeCauseCode: causeCode };
  }

  const name = errorName(error);
  if (name === "TimeoutError") {
    return { safeErrorCode: "provider_timeout", phase: "unknown" };
  }
  if (name === "AbortError") {
    return { safeErrorCode: "provider_timeout", phase: "unknown" };
  }

  return { safeErrorCode: "provider_unavailable", phase: "unknown" };
}

/**
 * Shared code extraction for provider-backed AI routes. Known application
 * errors remain intact; raw Node/fetch transport errors become safe semantic
 * codes through the classifier above.
 */
export function aiProviderErrorCode(
  error: unknown,
  options: TransportErrorOptions & { fallback?: string } = {}
) {
  if (options.requestSignal?.aborted) return "request_cancelled";

  const existingCode = errorCode(error);
  if (existingCode && !isRawTransportCode(existingCode)) return existingCode;

  const classified = classifyAiTransportError(error, options);
  return classified.safeErrorCode === "provider_unavailable"
    ? options.fallback ?? classified.safeErrorCode
    : classified.safeErrorCode;
}

export function isProviderTransportFailureCode(code: string) {
  return /^(?:provider_(?:dns_failed|connection_failed|tls_failed|tls_certificate_invalid|timeout|unavailable)|provider_http_(?:408|425|429|5\d\d))$/u.test(code);
}

export function isRetryableAiProviderErrorCode(code: string) {
  return isProviderTransportFailureCode(code) || /temporar|timeout|network|unavailable/u.test(code);
}

export function safeTransportMessage(code: string) {
  if (code === "provider_dns_failed") return "AI 简历撰写服务无法解析当前服务地址。";
  if (code === "provider_connection_failed") return "AI 简历撰写服务连接失败。";
  if (code === "provider_tls_certificate_invalid" || code === "provider_tls_failed") return "AI 简历撰写服务连接失败。";
  if (code === "provider_timeout") return "AI 简历撰写服务响应超时。";
  return "AI 简历撰写服务暂时不可用。";
}

export function transportDiagnosticForHttpStatus(status: number): SafeAiTransportDiagnostic {
  return {
    safeErrorCode: `provider_http_${status}`,
    phase: "http",
    httpStatus: status
  };
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function safeDiagnostic(error: unknown): SafeAiTransportDiagnostic | undefined {
  if (!error || typeof error !== "object" || !("diagnostic" in error)) return undefined;
  const diagnostic = error.diagnostic;
  if (!diagnostic || typeof diagnostic !== "object") return undefined;
  const value = diagnostic as Record<string, unknown>;
  const safeErrorCode = typeof value.safeErrorCode === "string" && value.safeErrorCode.startsWith("provider_")
    ? value.safeErrorCode
    : undefined;
  const phase = value.phase === "dns" || value.phase === "tcp" || value.phase === "tls" || value.phase === "http" || value.phase === "unknown"
    ? value.phase
    : undefined;
  if (!safeErrorCode || !phase) return undefined;
  return {
    safeErrorCode,
    phase,
    ...(typeof value.safeCauseCode === "string" && SAFE_CAUSE_CODES.has(value.safeCauseCode) ? { safeCauseCode: value.safeCauseCode } : {}),
    ...(typeof value.httpStatus === "number" && Number.isInteger(value.httpStatus) ? { httpStatus: value.httpStatus } : {})
  };
}

function isRawTransportCode(code: string) {
  return SAFE_CAUSE_CODES.has(code)
    || code.startsWith("ERR_TLS_")
    || code.startsWith("ERR_SSL_")
    || code.startsWith("UND_ERR_")
    || code === "AbortError"
    || code === "TimeoutError";
}

function firstSafeCauseCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = errorCode(current);
    if (code && (SAFE_CAUSE_CODES.has(code) || code.startsWith("ERR_TLS_") || code.startsWith("ERR_SSL_") || code.startsWith("UND_ERR_"))) {
      return code;
    }
    current = current && typeof current === "object" && "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

function errorName(error: unknown) {
  return error && typeof error === "object" && "name" in error && typeof error.name === "string"
    ? error.name
    : undefined;
}

function isTimeoutError(error: unknown) {
  const code = firstSafeCauseCode(error);
  return Boolean(code && TIMEOUT_CODES.has(code));
}
