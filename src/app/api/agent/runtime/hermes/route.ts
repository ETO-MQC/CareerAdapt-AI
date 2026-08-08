import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

const HermesBridgeRequestSchema = z.object({
  action: z.enum(["session_create", "session_resume", "turn", "tool_callback", "interrupt"])
}).passthrough();

const upstreamPath: Record<z.infer<typeof HermesBridgeRequestSchema>["action"], string> = {
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
    return legacyRequest(baseUrl, action, payload);
  }
  return officialHermesRequest(baseUrl, action, payload);
}

async function officialHermesRequest(baseUrl: string, action: z.infer<typeof HermesBridgeRequestSchema>["action"], payload: Record<string, unknown>) {
  const root = baseUrl.replace(/\/$/u, "");
  try {
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
          model: process.env.HERMES_MODEL?.trim() || undefined,
          source: "careerad"
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
    const response = await fetch(`${root}/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...apiKeyHeader() },
      body: JSON.stringify({
        message: typeof payload.userMessage === "string" ? payload.userMessage : "",
        ...(process.env.HERMES_MODEL?.trim() ? { model: process.env.HERMES_MODEL.trim() } : {})
      }),
      signal: AbortSignal.timeout(180_000),
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

async function legacyRequest(baseUrl: string, action: z.infer<typeof HermesBridgeRequestSchema>["action"], payload: Record<string, unknown>) {
  try {
    const response = await fetch(baseUrl.replace(/\/$/u, "") + upstreamPath[action], {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: action === "turn" ? "application/x-ndjson" : "application/json", ...apiKeyHeader() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(action === "turn" ? 180_000 : 30_000),
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

function unavailable() {
  return NextResponse.json({
    ok: false,
    error: { code: "hermes_bridge_unavailable", message: "Hermes companion is unavailable." }
  }, { status: 503 });
}

function apiKeyHeader(): Record<string, string> {
  const apiKey = process.env.HERMES_API_KEY?.trim() || process.env.HERMES_RUNTIME_API_KEY?.trim();
  return apiKey
    ? { Authorization: `Bearer ${apiKey}` }
    : {};
}
