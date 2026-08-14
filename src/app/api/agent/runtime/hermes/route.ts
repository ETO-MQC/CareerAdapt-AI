import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { HermesCareerToolCatalog } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
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
      if (!response.ok) {
        const rawError = asRecord(asRecord(raw).error);
        const diagnostics = classifyHermesRunFailure({
          code: typeof rawError.code === "string" ? rawError.code : "hermes_run_start_failed",
          message: typeof rawError.message === "string" ? rawError.message : undefined,
          httpStatus: response.status,
          failureLayer: /provider|model|auth/u.test(String(rawError.code ?? "")) ? "provider" : "bridge_http",
          runStartKind: "new",
          companionConnected: true
        });
        recordHermesRunStartFailure(root, diagnostics);
        return upstreamError(response.status, raw, "hermes_run_start_failed");
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
  } catch (error) {
    if (action === "run_start") {
      const diagnostics = classifyHermesRunFailure({
        code: error instanceof Error && error.name === "AbortError" ? "hermes_run_start_timeout" : "hermes_companion_unavailable",
        message: error instanceof Error ? error.message : "Hermes companion is unavailable.",
        httpStatus: 503,
        failureLayer: error instanceof Error && error.name === "AbortError" ? "bridge_http" : "companion",
        runStartKind: "new",
        companionConnected: false
      });
      recordHermesRunStartFailure(root, diagnostics);
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

function upstreamError(status: number, value: unknown, fallbackCode: string) {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const error = record.error && typeof record.error === "object" && !Array.isArray(record.error)
    ? record.error as Record<string, unknown>
    : {};
  const diagnostics = classifyHermesRunFailure({
    code: typeof error.code === "string" ? error.code : fallbackCode,
    message: typeof error.message === "string" ? error.message : undefined,
    httpStatus: status || 502,
    failureLayer: /provider|model|auth/u.test(String(error.code ?? fallbackCode)) ? "provider" : "bridge_http",
    upstreamErrorCode: typeof error.code === "string" ? error.code : fallbackCode
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
  const contracts = Array.isArray(payload.toolContracts)
    ? payload.toolContracts.flatMap((value) => {
        const contract = asRecord(value);
        if (typeof contract.name !== "string") return [];
        return [{
          stableName: typeof contract.careerAdaptStableName === "string" ? contract.careerAdaptStableName : contract.name,
          registeredName: contract.name
        }];
      })
    : [];
  const catalog = new HermesCareerToolCatalog(contracts.map((contract) => contract.stableName));
  const metadata = asRecord(payload.metadata);
  const workflowId = typeof payload.workflowId === "string" ? payload.workflowId : typeof metadata.workflowId === "string" ? metadata.workflowId : undefined;
  const workflowStage = typeof payload.workflowStage === "string" ? payload.workflowStage : typeof metadata.workflowStage === "string" ? metadata.workflowStage : undefined;
  const systemStatusTurn = isSystemStatusQuestion(payload.userMessage);
  const registered = (stableName: string) => contracts.find((contract) => contract.stableName === stableName)?.registeredName
    ?? catalog.registeredNameForStableName(stableName);
  const facadeLines = contracts
    .filter((contract) => contract.stableName.startsWith("career.workflow."))
    .map((contract) => `${contract.stableName} -> ${contract.registeredName.startsWith("mcp__") ? contract.registeredName : catalog.registeredNameForStableName(contract.stableName)}`)
    .join(", ");
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
    "You are the CareerAdapt Career Agent. Hermes v0.19 exposes CareerAdapt MCP tools under exact mcp__careeradapt__... registry names.",
    systemStatusTurn
      ? "This is a CareerAdapt system-status question. Use the read-only CareerAdapt system contracts first: runtime status, current task, and last failure. Do not inspect the host with terminal, file, process, or search tools."
      : `There are two Career Agent task classes. A ConversationalCareerTask is read-only natural career Q&A: call ${registered("career.context.retrieve")} only when confirmed facts or saved target context are needed, then answer in natural prose. A TransactionalCareerWorkflow is import, profile intake, job fit, tailoring, resume composition, modification, save, or export: call exactly the matching high-level workflow facade first and respect its checkpoint, receipt, stale, confirmation, and terminal status.`,
    `Callable facade mapping (stable CareerAdapt name -> exact Hermes name): ${facadeLines || "not supplied; use visible mcp__careeradapt__ names from the active registry"}`,
    "Dotted names are stable CareerAdapt diagnostics aliases only. Never send career.workflow.* or career.profile.* as the provider tool name when an mcp__careeradapt__ registry name is available.",
    systemStatusTurn
      ? "For this status question, do not call a workflow facade or any write tool; return Hermes runtime, model, Career MCP, Career skills, and current Career task diagnostics."
      : `For a conversational turn, do not call a workflow facade, resume/profile/job write, or atomic workflow tool. If context is needed, call ${registered("career.context.retrieve")} with the bound profileId and the user's question; do not require jobId for ordinary questions. Its facts are confirmed/evidence-bound and ranked deterministically. Use only returned facts, say plainly when a requested target or skill is unsupported, and never expose the whole profile JSON.`,
    "For follow-up conversational turns, reuse the conversation and pinned context; do not reread the entire profile automatically. targetText is ephemeral turn context and must not be persisted.",
    "Never invent profile, resume, job, metric, ownership, or skill-level facts. Never claim a write or draft exists without a completed CareerAdapt tool receipt. Hermes writes natural prose; career.context.retrieve returns structured facts.",
    "A conversational answer may offer or accept an explicit escalation to a workflow facade. Once the user asks to import, modify, create, tailor, save, or export, begin the matching transaction and keep conversation and transaction state separate; after completion, return to read-only Q&A.",
    "Do not manually orchestrate atomic CareerAdapt tools when a workflow facade exists. Use atomic contracts only when a facade explicitly reports a bounded recovery path.",
    "runtime_user_event is an authoritative structured event from the host. For entity_selected, option_selected, retry, confirmation, and workflow_control, use the typed action and persisted task state exactly; never parse a visible button label, ask the user to repeat a validated selection, or repeat a deterministic host write.",
    workflowId === "compose_resume" && workflowStage === "select_profile_scope"
      ? `For this compose_resume task, call ${registered("career.workflow.compose_resume")} immediately as the first CareerAdapt call. Use the bound career_context.binding.profileId and career_context.binding.profileRevision with mode "general"; do not call profile reads/searches first because the facade performs the authoritative read and returns the composition checkpoint.`
      : "",
    `For tailor_existing_resume, prefer ${registered("career.workflow.tailor_resume")} as the single resumable facade. START uses sourceResumeId and jobId; CONTINUE uses checkpointId and userAnswer when present. The facade internally advances Job Fit, plan, clarification, and generation stages, then returns one structured status/checkpoint/userPrompt/interaction/review boundary. Do not call career.tailoring.* atomic tools directly.`,
    `When a workflow returns waiting_for_user, stop tool-calling and ask exactly the returned high-value question. When tailor_resume returns review_ready, stop at the deterministic Host review boundary; never apply or write a resume from Hermes narration.`,
    "When it returns waiting_for_confirmation, stop and yield the approval boundary. When completed, stop the tool loop and narrate the result.",
    `Attachments are local CareerAdapt references. Use only their IDs with ${registered("career.workflow.resume_import")}; never request paths, bytes, base64, or parse them yourself.`,
    `Runtime context: ${JSON.stringify(context)}`
  ].join("\n");
}

function isSystemStatusQuestion(value: unknown) {
  return typeof value === "string"
    && /(?:CareerAdapt|职适AI).*(?:系统状态|运行状态|健康状态)|(?:检查|查看|查询).*(?:系统状态|运行状态)|系统状态/u.test(value.trim());
}

function safeRuntimeMetadata(value: unknown) {
  const metadata = asRecord(value);
  const result: Record<string, unknown> = {};
  for (const key of ["executionOwner", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackUsed", "fallbackReasonCode", "workflowId", "workflowStage", "rootGoal", "runtimeId", "hermesRunId", "nextHermesRunId", "firstEventAt", "runtimeFailureAt", "runtimeRecoveryAttempted", "recoveryFailureCode", "nativeAllowedSourceTools", "careerGatewayContracts", "careerMcpExposedTools", "hermesRegisteredToolsets", "hermesVisibleTools", "missingRequiredCareerTools", "lastRequestedHermesToolName", "lastRequestedCareerToolName"]) {
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
