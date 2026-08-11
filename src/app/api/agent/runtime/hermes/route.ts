import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

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
      const response = await fetch(`${root}/v1/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...apiKeyHeader() },
        body: JSON.stringify({
          input: typeof payload.userMessage === "string" ? payload.userMessage : "",
          session_id: typeof payload.sessionId === "string" ? payload.sessionId : undefined,
          ...(configuredModel() ? { model: configuredModel() } : {}),
          instructions: careerRunInstructions(payload),
          conversation_history: safeConversationHistory(payload.conversationHistory),
          metadata: safeRuntimeMetadata(payload.metadata)
        }),
        signal: AbortSignal.timeout(30_000),
        cache: "no-store"
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) return upstreamError(response.status, raw, "hermes_run_start_failed");
      const record = asRecord(raw);
      return NextResponse.json({
        ok: true,
        data: {
          runId: typeof record.run_id === "string" ? record.run_id : "",
          status: typeof record.status === "string" ? record.status : "started"
        }
      });
    }
    if (action === "run_status") return proxyRunJson(root, payload, "GET", "status");
    if (action === "run_approval") return proxyRunJson(root, payload, "POST", "approval");
    if (action === "run_stop") return proxyRunJson(root, payload, "POST", "stop");
    if (action === "run_events") {
      const runId = requiredRunId(payload);
      const response = await fetch(`${root}/v1/runs/${encodeURIComponent(runId)}/events`, {
        method: "GET",
        headers: { Accept: "text/event-stream", ...apiKeyHeader() },
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
  } catch {
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

function upstreamError(status: number, value: unknown, fallbackCode: string) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : {};
  return NextResponse.json({
    ok: false,
    error: {
      code: typeof error.code === "string" ? error.code : fallbackCode,
      message: typeof error.message === "string" ? error.message : `Hermes API Server returned HTTP ${status}.`
    }
  }, { status: status || 502 });
}

function unavailable(code = "hermes_bridge_unavailable") {
  return NextResponse.json({
    ok: false,
    error: { code, message: "Hermes companion is unavailable." }
  }, { status: 503 });
}

async function proxyRunJson(root: string, payload: Record<string, unknown>, method: "GET" | "POST", kind: "status" | "approval" | "stop") {
  const runId = requiredRunId(payload);
  const suffix = kind === "status" ? "" : `/${kind}`;
  const response = await fetch(`${root}/v1/runs/${encodeURIComponent(runId)}${suffix}`, {
    method,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...apiKeyHeader() },
    ...(kind === "approval" ? { body: JSON.stringify({ choice: payload.choice }) } : kind === "stop" ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store"
  });
  const raw = await response.json().catch(() => ({}));
  if (!response.ok) return upstreamError(response.status, raw, `hermes_run_${kind}_failed`);
  return NextResponse.json({ ok: true, data: raw });
}

function requiredRunId(payload: Record<string, unknown>) {
  if (typeof payload.runId !== "string" || !payload.runId.trim()) {
    throw Object.assign(new Error("hermes_run_id_required"), { code: "hermes_run_id_required" });
  }
  return payload.runId;
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
  const context = {
    career_context: {
      session_id: safeCareerBinding(payload.careerSessionBinding)?.agentSessionId,
      binding: safeCareerBinding(payload.careerSessionBinding),
      page: safePageContext(payload.pageContext),
      runtime_user_event: safeRuntimeUserEvent(asRecord(payload.metadata).runtimeUserEvent)
    },
    attachments: safeAttachments(payload.attachments)
  };
  return [
    "You are the CareerAdapt Career Agent. For a normal end-to-end workflow, you MUST call exactly one matching career.workflow.* MCP facade first; do not start with its atomic counterpart.",
    "Facade mapping: Profile Intake=career.workflow.profile_intake_turn/finalize; Resume Import=career.workflow.resume_import; Job Fit=career.workflow.job_fit; Tailoring=career.workflow.tailor_resume; Profile→Resume=career.workflow.profile_to_resume; Repair→Export=career.workflow.resume_export.",
    "Use atomic career.profile.*, career.resume.*, career.job.*, and career.tailoring.* tools only for inspection, unusual repair, or recovery after a facade reports a recoverable failure.",
    "Never invent profile or resume facts. Never claim a write or draft exists without a completed CareerAdapt tool receipt.",
    "runtime_user_event is an authoritative structured event from the host. For entity_selected, option_selected, retry, confirmation, and workflow_control, use the typed action and persisted task state exactly; never parse a visible button label, ask the user to repeat a validated selection, or repeat a deterministic host write.",
    "After the host persists a selected Job or Resume, reread the selected entities before reasoning. For tailor_existing_resume at analyze_fit, call career.workflow.job_fit first, interpret its returned fit checkpoint, then continue with the tailoring workflow; ask only a returned high-value question that can change the result.",
    "When a workflow returns waiting_for_user, stop tool-calling and ask exactly the returned high-value question. Exception: inside tailor_existing_resume at analyze_fit, a completed career.workflow.job_fit is an intermediate checkpoint; use it to call the allowed career.workflow.tailor_resume before stopping.",
    "When it returns waiting_for_confirmation, stop and yield the approval boundary. When completed, stop the tool loop and narrate the result.",
    "Attachments are local CareerAdapt references. Use only their IDs with career.workflow.resume_import; never request paths, bytes, base64, or parse them yourself.",
    `Runtime context: ${JSON.stringify(context)}`
  ].join("\n");
}

function safeRuntimeMetadata(value: unknown) {
  const metadata = asRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of ["executionOwner", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackUsed", "fallbackReasonCode", "workflowId", "workflowStage", "rootGoal", "runtimeId", "hermesRunId", "nextHermesRunId", "firstEventAt", "runtimeFailureAt", "runtimeRecoveryAttempted", "recoveryFailureCode"]) {
    const entry = metadata[key];
    if (typeof entry === "string" || typeof entry === "boolean") result[key] = entry;
  }
  const event = safeRuntimeUserEvent(metadata.runtimeUserEvent);
  if (event) result.runtimeUserEvent = event;
  return result;
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
