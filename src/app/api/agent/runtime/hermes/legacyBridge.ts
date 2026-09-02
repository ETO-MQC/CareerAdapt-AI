/**
 * Development/test compatibility for Hermes builds that predate /v1/runs.
 * The production bridge rejects this protocol before this module is called.
 */
export type LegacyHermesAction = "session_create" | "session_resume" | "turn" | "tool_callback" | "interrupt";

const upstreamPath: Record<LegacyHermesAction, string> = {
  session_create: "/sessions",
  session_resume: "/sessions/resume",
  turn: "/turn",
  tool_callback: "/tool-callback",
  interrupt: "/interrupt"
};

export async function requestLegacyHermes(
  baseUrl: string,
  action: LegacyHermesAction,
  payload: Record<string, unknown>,
  unavailable: () => Response | Promise<Response>
) {
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

function apiKeyHeader(): Record<string, string> {
  const key = process.env.HERMES_RUNTIME_API_KEY?.trim()
    || process.env.HERMES_API_KEY?.trim()
    || process.env.API_SERVER_KEY?.trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}
