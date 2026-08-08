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

function unavailable() {
  return NextResponse.json({
    ok: false,
    error: { code: "hermes_bridge_unavailable", message: "Hermes companion is unavailable." }
  }, { status: 503 });
}

function apiKeyHeader(): Record<string, string> {
  return process.env.HERMES_RUNTIME_API_KEY
    ? { Authorization: `Bearer ${process.env.HERMES_RUNTIME_API_KEY}` }
    : {};
}
