import { NextResponse } from "next/server";

export async function GET() {
  const baseUrl = process.env.HERMES_RUNTIME_URL?.trim();
  if (!baseUrl) {
    return NextResponse.json({
      available: false,
      runtimeId: "hermes",
      reason: "hermes_companion_not_configured"
    }, { status: 503 });
  }
  return proxy(baseUrl.replace(/\/$/u, "") + "/health");
}

async function proxy(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
    return new Response(response.body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" }
    });
  } catch {
    return NextResponse.json({
      available: false,
      runtimeId: "hermes",
      reason: "hermes_companion_unreachable"
    }, { status: 503 });
  }
}

function upstreamHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (process.env.HERMES_RUNTIME_API_KEY) headers.Authorization = `Bearer ${process.env.HERMES_RUNTIME_API_KEY}`;
  return headers;
}
