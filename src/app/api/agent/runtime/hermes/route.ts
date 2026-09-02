import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { classifyHermesRunFailure } from "@/agent/runtime/hermes/hermesRunReliability";
import { recordHermesRunStartFailure, recordHermesRunStartSuccess } from "@/agent/runtime/hermes/hermesRunReadiness";

const HermesBridgeRequestSchema = z.object({
  action: z.enum([
    "session_create", "session_resume", "turn", "tool_callback", "interrupt",
    "run_start", "run_status", "run_events", "run_approval", "run_stop"
  ])
}).passthrough();

type LegacyAction = "session_create" | "session_resume" | "turn" | "tool_callback" | "interrupt";

const upstreamPath: Record<LegacyAction, string> = {
  session_create: "/sessions",
  session_resume: "/sessions/resume",
  turn: "/turn",
  tool_callback: "/tool-callback",
  interrupt: "/interrupt"
};

export async function POST(request: NextRequest) {
  const baseUrl = process.env.HERMES_RUNTIME_URL?.trim();
  if (!baseUrl) return unavailable();
  const body = HermesBridgeRequestSchema.safeParse(await request.json());
  if (!body.success) return NextResponse.json({ ok: false, error: { code: "hermes_bridge_bad_request", message: "Invalid Hermes bridge request." } }, { status: 400 });
  const { action, ...payload } = body.data;
  if (process.env.HERMES_RUNTIME_PROTOCOL?.trim().toLowerCase() === "legacy") {
    if (action.startsWith("run_")) return unavailable("hermes_runs_unsupported");
    return legacyRequest(baseUrl, action as LegacyAction, payload);
  }
  return officialHermesRequest(baseUrl, action, payload);
}

async function officialHermesRequest(baseUrl: string, action: z.infer<typeof HermesBridgeRequestSchema>["action"], payload: Record<string, unknown>) {
  const root = baseUrl.replace(/\/$/u, "");
  try {
    if (action === "run_start") {
      const requestContext = runStartDiagnosticContext(payload);
      const response = await fetch(`${root}/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...apiKeyHeader() },
        body: JSON.stringify({
          input: typeof payload.userMessage === "string" ? payload.userMessage : "",
          session_id: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
          ...(configuredModel() ? { model: configuredModel() } : {}),
          instructions: careerRunInstructions(payload),
          conversation_history: safeConversationHistory(payload.conversationHistory),
          career_context: {
            session_id: safeCareerBinding(payload.careerSessionBinding)?.agentSessionId ?? safeDiagnosticString(payload.sessionId),
            binding: safeCareerBinding(payload.careerSessionBinding),
            page: safePageContext(payload.pageContext),
            attachments: safeAttachments(payload.attachments)
          },
          metadata: safeRuntimeMetadata({
            ...asRecord(payload.metadata),
            incidentTraceId: payload.incidentTraceId,
            logicalTurnId: payload.logicalTurnId
          })
        }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store"
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) {
        const rawError = asRecord(asRecord(raw).error);
        const diagnostics = classifyHermesRunFailure({
          code: typeof rawError.code === "string" ? rawError.code : "hermes_run_start_failed",
          message: typeof rawError.message === "string" ? rawError.message : undefined,
          httpStatus: response.status,
          failureLayer: /provider|model|auth/u.test(String(rawError.code ?? "")) ? "provider" : "bridge_http",
          upstreamErrorCode: typeof rawError.code === "string" ? rawError.code : undefined,
          upstreamErrorType: safeDiagnosticString(rawError.type ?? rawError.error_type),
          runStartKind: "new",
          companionConnected: true,
          ...requestContext,
          activeRunId: safeDiagnosticString(rawError.activeRunId ?? rawError.active_run_id ?? rawError.runId ?? rawError.run_id) ?? requestContext.activeRunId
        });
        recordHermesRunStartFailure(root, diagnostics);
        return upstreamError(response.status, raw, "hermes_run_start_failed", {
          ...requestContext,
          activeRunId: safeDiagnosticString(rawError.activeRunId ?? rawError.active_run_id ?? rawError.runId ?? rawError.run_id)
        });
      }
      const record = asRecord(raw);
      if (typeof record.run_id !== "string" || !record.run_id.trim()) {
        recordHermesRunStartFailure(root, {
          code: "hermes_run_start_invalid_response",
          message: "Hermes run_start 返回了无法识别的运行句柄。",
          httpStatus: 502,
          failureLayer: "response",
          runStartKind: "new",
          companionConnected: true,
          retryable: false
        });
        return upstreamError(502, {
          error: {
            code: "hermes_run_start_invalid_response",
            message: "Hermes run_start 返回了无法识别的运行句柄。"
          }
        }, "hermes_run_start_invalid_response");
      }
      recordHermesRunStartSuccess(root);
      return NextResponse.json({
        ok: true,
        data: {
          runId: record.run_id,
          status: typeof record.status === "string" ? record.status : "started"
        }
      });
    }
    if (action === "run_status") return proxyRunJson(root, payload, "GET", "status");
    if (action === "run_approval") return proxyRunJson(root, payload, "POST", "approval");
    if (action === "run_stop") return proxyRunJson(root, payload, "POST", "stop");
    if (action === "run_events") {
      const runId = requiredRunId(payload);
      const eventCursor = typeof payload.eventCursor === "string" && payload.eventCursor.trim()
        ? payload.eventCursor.trim().slice(0, 240)
        : undefined;
      const response = await fetch(`${root}/v1/runs/${encodeURIComponent(runId)}/events`, {
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          ...(eventCursor ? { "Last-Event-ID": eventCursor } : {}),
          ...apiKeyHeader()
        },
        signal: requestSignal(),
        cache: "no-store"
      });
      if (!response.ok || !response.body) {
        const raw = await response.json().catch(() => ({}));
        return upstreamError(response.status, raw, "hermes_run_events_failed");
      }
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" }
      });
    }
    if (action === "tool_callback") {
      // Official Hermes API Server executes MCP tools on its own host. The
      // legacy callback action remains accepted so the browser adapter can
      // keep one stable protocol without pretending a callback was needed.
      return NextResponse.json({ ok: true, data: { accepted: false, execution: "hermes-api-server" } });
    }
    if (action === "interrupt") {
      return NextResponse.json({ ok: true, data: { interrupted: false, reason: "official_session_stream_interrupt_not_exposed_by_bridge" } });
    }
    if (action === "session_create") {
      const response = await fetch(`${root}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...apiKeyHeader() },
        body: JSON.stringify({
          id: payload.sessionId,
          model: configuredModel(),
          source: "careerad",
          metadata: safeCareerMetadata(payload)
        }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store"
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) return upstreamError(response.status, raw, "hermes_session_create_failed");
      const sessionId = sessionIdFromResponse(raw) ?? String(payload.sessionId);
      return NextResponse.json({ ok: true, data: { sessionId, resumed: false } }, { status: 200 });
    }
    if (action === "session_resume") {
      const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
      const response = await fetch(`${root}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "GET",
        headers: { Accept: "application/json", ...apiKeyHeader() },
        signal: AbortSignal.timeout(30_000),
        cache: "no-store"
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) return upstreamError(response.status, raw, "hermes_session_not_found");
      return NextResponse.json({ ok: true, data: { sessionId: sessionIdFromResponse(raw) ?? sessionId, resumed: true } });
    }
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : "";
    const careerBinding = safeCareerBinding(payload.careerSessionBinding);
    const response = await fetch(`${root}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...apiKeyHeader() },
      body: JSON.stringify({
        message: typeof payload.userMessage === "string" ? payload.userMessage : "",
        ...(configuredModel() ? { model: configuredModel() } : {}),
        // Hermes owns reasoning and tool selection. CareerAdapt only supplies
        // the immutable task binding and page hints; no Repository is sent.
        career_context: {
          // The URL/sessionId above is the Hermes API session. Tool inputs
          // such as profile-intake evidence use the CareerAdapt Agent Session
          // ID, which is the binding authority and may differ after Hermes
          // creates/resumes its own session.
          session_id: careerBinding?.agentSessionId ?? sessionId,
          binding: careerBinding,
          page: safePageContext(payload.pageContext),
          tool_contract_count: Array.isArray(payload.toolContracts) ? payload.toolContracts.length : 0,
          runtime_user_event: safeRuntimeUserEvent(asRecord(payload.metadata).runtimeUserEvent)
        }
      }),
      cache: "no-store"
    });
    if (!response.ok || !response.body) {
      const raw = await response.json().catch(() => ({}));
      return upstreamError(response.status, raw, "hermes_turn_failed");
    }
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "text/event-stream", "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (action === "run_start") {
      const diagnostics = classifyHermesRunFailure({
        code: error instanceof Error && error.name === "AbortError" ? "hermes_run_start_timeout" : "hermes_companion_unavailable",
        message: error instanceof Error ? error.message : "Hermes companion is unavailable.",
        httpStatus: 503,
        failureLayer: error instanceof Error && error.name === "AbortError" ? "bridge_http" : "companion",
        runStartKind: "new",
        companionConnected: false,
        ...runStartDiagnosticContext(payload)
      });
      recordHermesRunStartFailure(root, diagnostics);
      return unavailable(diagnostics.safeErrorCode, diagnostics);
    }
    if (action === "run_events") {
      const diagnostics = classifyHermesRunFailure({
        code: "hermes_run_events_failed",
        message: error instanceof Error ? error.message : "Hermes run event stream is unavailable.",
        httpStatus: 503,
        failureLayer: "bridge_http",
        runPhase: "after_run_start"
      });
      return unavailable(diagnostics.safeErrorCode, diagnostics);
    }
    if (action === "run_status") {
      const diagnostics = classifyHermesRunFailure({
        code: "hermes_run_status_failed",
        message: error instanceof Error ? error.message : "Hermes run status is unavailable.",
        httpStatus: 503,
        failureLayer: "bridge_http",
        runPhase: "after_run_start"
      });
      return unavailable(diagnostics.safeErrorCode, diagnostics);
    }
    return unavailable();
  }
}

async function legacyRequest(baseUrl: string, action: LegacyAction, payload: Record<string, unknown>) {
  try {
    const response = await fetch(baseUrl.replace(/\/$/u, "") + upstreamPath[action], {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: action === "turn" ? "application/x-ndjson" : "application/json", ...apiKeyHeader() },
      body: JSON.stringify(payload),
      ...(action === "turn" ? {} : { signal: AbortSignal.timeout(30_000) }),
      cache: "no-store"
    });
    if (action === "turn") {
      return new Response(response.body, {
        status: response.status,
        headers: { "Content-Type": response.headers.get("content-type") ?? "application/x-ndjson", "Cache-Control": "no-store" }
      });
    }
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    return unavailable();
  }
}

function sessionIdFromResponse(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const session = record.session && typeof record.session === "object" && !Array.isArray(record.session)
    ? record.session as Record<string, unknown>
    : undefined;
  return typeof record.session_id === "string"
    ? record.session_id
    : typeof session?.id === "string"
      ? session.id
      : undefined;
}

function upstreamError(status: number, value: unknown, fallbackCode: string, context: Partial<ReturnType<typeof classifyHermesRunFailure>> = {}) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawError = record.error;
  const error = rawError && typeof rawError === "object" && !Array.isArray(rawError)
    ? rawError as Record<string, unknown>
    : {};
  const message = typeof rawError === "string"
    ? rawError
    : typeof error.message === "string" ? error.message : undefined;
  const diagnostics = classifyHermesRunFailure({
    code: typeof error.code === "string" ? error.code : fallbackCode,
    message,
    httpStatus: status || 502,
    failureLayer: /provider|model|auth/u.test(String(error.code ?? fallbackCode)) ? "provider" : "bridge_http",
    upstreamErrorCode: typeof error.code === "string" ? error.code : fallbackCode,
    upstreamErrorType: safeDiagnosticString(error.type ?? error.error_type),
    ...context
  });
  return NextResponse.json({
    ok: false,
    error: {
      code: diagnostics.safeErrorCode,
      message: diagnostics.safeErrorMessage,
      httpStatus: diagnostics.httpStatus,
      failureLayer: diagnostics.failureLayer,
      upstreamErrorCode: diagnostics.upstreamErrorCode,
      diagnostics
    }
  }, { status: status || 502 });
}

function runStartDiagnosticContext(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);
  return {
    sessionId: safeDiagnosticString(payload.sessionId),
    requestedTurnId: safeDiagnosticString(payload.turnId ?? payload.requestedTurnId),
    activeRunId: safeDiagnosticString(payload.activeRunId ?? metadata.activeRunId ?? metadata.hermesRunId),
    requestState: safeDiagnosticString(metadata.requestState),
    controllerState: safeDiagnosticString(metadata.controllerState),
    existingPendingTurnId: safeDiagnosticString(metadata.existingPendingTurnId),
    existingActiveTurnId: safeDiagnosticString(metadata.existingActiveTurnId)
  };
}

function safeDiagnosticString(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,160}$/u.test(value) ? value : undefined;
}

function unavailable(code = "hermes_bridge_unavailable", diagnostics?: ReturnType<typeof classifyHermesRunFailure>) {
  const safeDiagnostics = diagnostics ?? classifyHermesRunFailure({ code, httpStatus: 503, failureLayer: "companion" });
  return NextResponse.json({
    ok: false,
    error: {
      code: safeDiagnostics.safeErrorCode,
      message: safeDiagnostics.safeErrorMessage,
      httpStatus: safeDiagnostics.httpStatus ?? 503,
      failureLayer: safeDiagnostics.failureLayer,
      ...(safeDiagnostics.upstreamErrorCode ? { upstreamErrorCode: safeDiagnostics.upstreamErrorCode } : {}),
      diagnostics: safeDiagnostics
    }
  }, { status: 503 });
}

async function proxyRunJson(root: string, payload: Record<string, unknown>, method: "GET" | "POST", kind: "status" | "approval" | "stop") {
  const runId = requiredRunId(payload);
  const suffix = kind === "status" ? "" : `/${kind}`;
  const response = await fetch(`${root}/v1/runs/${encodeURIComponent(runId)}${suffix}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...apiKeyHeader() },
    ...(kind === "approval" ? { body: JSON.stringify({ choice: payload.choice }) } : kind === "stop" ? { body: JSON.stringify({ stop_reason: safeStopReason(payload.stopReason) }) } : {}),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store"
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) return upstreamError(response.status, raw, `hermes_run_${kind}_failed`);
  return NextResponse.json({ ok: true, data: safeRunStatus(raw) });
}

function requiredRunId(payload: Record<string, unknown>) {
  if (typeof payload.runId !== "string" || !payload.runId.trim()) {
    throw Object.assign(new Error("hermes_run_id_required"), { code: "hermes_run_id_required" });
  }
  return payload.runId;
}

function safeRunStatus(value: unknown) {
  const record = asRecord(value);
  const allowedStatuses = ["queued", "started", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled"] as const;
  const rawStatus = typeof record.status === "string" ? record.status : "failed";
  const status = allowedStatuses.includes(rawStatus as typeof allowedStatuses[number])
    ? rawStatus as typeof allowedStatuses[number]
    : "failed";
  const output = typeof record.output === "string" ? record.output.slice(0, 16_000) : undefined;
  const error = safeRunError(record.error);
  const usage = asRecord(record.usage);
  const numericUsage = Object.fromEntries(Object.entries(usage).flatMap(([key, entry]) =>
    typeof entry === "number" && Number.isFinite(entry) ? [[key, entry]] : []
  ));
  return {
    run_id: safeDiagnosticString(record.run_id) ?? "unknown-run",
    status,
    ...(safeLabel(record.session_id) ? { session_id: safeLabel(record.session_id) } : {}),
    ...(safeLabel(record.provider) ? { provider: safeLabel(record.provider) } : {}),
    ...(safeLabel(record.model) ? { model: safeLabel(record.model) } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(error ? { error } : {}),
    ...(safeLabel(record.last_event) ? { last_event: safeLabel(record.last_event) } : {}),
    ...(typeof record.created_at === "number" ? { created_at: record.created_at } : {}),
    ...(typeof record.updated_at === "number" ? { updated_at: record.updated_at } : {}),
    ...(Object.keys(numericUsage).length ? { usage: numericUsage } : {})
  };
}

function safeRunError(value: unknown) {
  const error = typeof value === "string"
    ? { message: value }
    : asRecord(value);
  const message = typeof error.message === "string"
    ? error.message
    : typeof error.error === "string" ? error.error : undefined;
  const code = safeDiagnosticString(error.code);
  const httpStatus = [error.http_status, error.httpStatus, error.status_code, error.statusCode]
    .find((entry): entry is number => typeof entry === "number" && Number.isInteger(entry) && entry >= 100 && entry <= 599);
  if (!message && !code && httpStatus === undefined) return undefined;
  return {
    ...(code ? { code } : {}),
    ...(message ? { message: redactRunText(message) } : {}),
    ...(httpStatus === undefined ? {} : { httpStatus })
  };
}

function redactRunText(value: string) {
  return value
    .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-key]")
    .replace(/\b(?:x-api-key|api[_ -]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/giu, "[redacted-secret]")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 360);
}

function safeLabel(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : undefined;
}

function safeConversationHistory(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    return (record.role === "user" || record.role === "assistant") && typeof record.content === "string"
      ? [{ role: record.role, content: record.content.slice(0, 8_000) }]
      : [];
  }).slice(-24);
}

function careerRunInstructions(payload: Record<string, unknown>) {
  const metadata = asRecord(payload.metadata);
  const workflowId = typeof payload.workflowId === "string" ? payload.workflowId : typeof metadata.workflowId === "string" ? metadata.workflowId : undefined;
  const workflowStage = typeof payload.workflowStage === "string" ? payload.workflowStage : typeof metadata.workflowStage === "string" ? metadata.workflowStage : undefined;
  const binding = safeCareerBinding(payload.careerSessionBinding);
  const activeWorkflow = workflowId && workflowStage
    ? `Active CareerAdapt workflow checkpoint: ${safeDiagnosticString(workflowId) ?? "unknown"} / ${safeDiagnosticString(workflowStage) ?? "unknown"}. Continue from this checkpoint only and stop at any host confirmation or review boundary.`
    : "";
  const attachmentHint = safeAttachments(payload.attachments).length > 0
    ? "The host supplied local attachment references. Use only their IDs when the user explicitly asks to import them; never request file paths, bytes, or base64."
    : "";
  return [
    "You are CareerAdapt's career assistant. Answer ordinary conversation naturally and concisely.",
    "Use CareerAdapt MCP when confirmed saved career facts or an explicit Career action is needed. Never invent user facts or claim a write without a completed CareerAdapt receipt.",
    "CareerAdapt owns persistence, authorization, workflow checkpoints, confirmations, attachments, and artifacts. Hermes owns semantic reasoning, response generation, and model-driven tool selection.",
    activeWorkflow,
    attachmentHint,
    binding ? "Use the host-provided Career session binding for CareerAdapt MCP calls; do not replace it with guessed identifiers." : ""
  ].filter(Boolean).join("\n");
}

function safeRuntimeMetadata(value: unknown) {
  const metadata = asRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of ["executionOwner", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackUsed", "fallbackReasonCode", "workflowId", "workflowStage", "rootGoal", "runtimeId", "hermesSessionId", "hermesRunId", "nextHermesRunId", "activeRunId", "firstEventAt", "runtimeFailureAt", "runtimeRecoveryAttempted", "runtimeRecoveryKind", "transportReattachAttempted", "attemptNumber", "primaryFailureCode", "recoveryFailureCode", "incidentTraceId", "logicalTurnId", "attemptTraceId", "recoveryReason", "requestState", "controllerState", "existingPendingTurnId", "existingActiveTurnId", "upstreamErrorType", "safeErrorCategory", "safeMessageCategory"]) {
    const entry = metadata[key];
    if (typeof entry === "string" || typeof entry === "boolean" || typeof entry === "number") {
      result[key] = entry;
    } else if (Array.isArray(entry) && entry.every((item) => typeof item === "string")) {
      result[key] = entry.slice(0, 128);
    }
  }
  const event = safeRuntimeUserEvent(metadata.runtimeUserEvent);
  if (event) result.runtimeUserEvent = event;
  return result;
}

function safeStopReason(value: unknown) {
  const record = asRecord(value);
  const requestedBy = typeof record.requestedBy === "string" ? record.requestedBy : undefined;
  const reasonCode = typeof record.reasonCode === "string" ? record.reasonCode.slice(0, 160) : undefined;
  const sourceComponent = typeof record.sourceComponent === "string" ? record.sourceComponent.slice(0, 160) : undefined;
  if (!requestedBy || !reasonCode || !sourceComponent) return undefined;
  return {
    requestedBy,
    reasonCode,
    sourceComponent,
    ...(typeof record.sessionId === "string" ? { sessionId: record.sessionId } : {}),
    ...(typeof record.logicalTurnId === "string" ? { logicalTurnId: record.logicalTurnId } : {}),
    ...(typeof record.runId === "string" ? { runId: record.runId } : {}),
    ...(typeof record.requestedAt === "string" ? { requestedAt: record.requestedAt } : {}),
    ...(typeof record.incidentTraceId === "string" ? { incidentTraceId: record.incidentTraceId } : {})
  };
}

function safeRuntimeUserEvent(value: unknown) {
  const record = asRecord(value);
  if (typeof record.type !== "string") return undefined;
  const action = record.action && typeof record.action === "object" && !Array.isArray(record.action)
    ? record.action as Record<string, unknown>
    : undefined;
  return {
    type: record.type,
    ...(typeof record.text === "string" ? { text: record.text.slice(0, 8_000) } : {}),
    ...(typeof record.actionId === "string" ? { actionId: record.actionId } : {}),
    ...(action ? { action } : {}),
    ...(typeof record.confirmed === "boolean" ? { confirmed: record.confirmed } : {}),
    ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}),
    ...(typeof record.sourceMessageId === "string" ? { sourceMessageId: record.sourceMessageId } : {})
  };
}

function safeAttachments(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = asRecord(entry);
    return typeof item.id === "string" && typeof item.fileName === "string" && typeof item.mimeType === "string" && typeof item.size === "number"
      ? [{ id: item.id, fileName: item.fileName, mimeType: item.mimeType, size: item.size, purpose: typeof item.purpose === "string" ? item.purpose : "other" }]
      : [];
  }).slice(0, 8);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requestSignal() {
  return undefined;
}

function apiKeyHeader(): Record<string, string> {
  const apiKey = process.env.HERMES_RUNTIME_API_KEY?.trim()
    || process.env.HERMES_API_KEY?.trim()
    || process.env.AI_API_KEY?.trim();
  return apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
}

function configuredModel() {
  return process.env.HERMES_MODEL?.trim() || process.env.AI_MODEL?.trim() || undefined;
}

function safeCareerBinding(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.personId === "string"
    && typeof candidate.profileId === "string"
    && typeof candidate.profileVersionNumber === "number"
    && typeof candidate.profileRevision === "number"
    && typeof candidate.agentSessionId === "string"
    ? {
        personId: candidate.personId,
        profileId: candidate.profileId,
        profileVersionNumber: candidate.profileVersionNumber,
        profileRevision: candidate.profileRevision,
        agentSessionId: candidate.agentSessionId
      }
    : undefined;
}

function safePageContext(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(candidate).filter(([key, entry]) =>
    ["pathname", "route", "title", "selectedSectionId", "selectedItemId", "selectedFieldPath", "templateId"].includes(key)
    && typeof entry === "string"
  ));
}

function safeCareerMetadata(payload: Record<string, unknown>) {
  return {
    source: "careerad",
    binding: safeCareerBinding(payload.careerSessionBinding),
    tool_contract_count: Array.isArray(payload.toolContracts) ? payload.toolContracts.length : 0
  };
}
