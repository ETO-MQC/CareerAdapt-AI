import { NextResponse } from "next/server";
import { HermesHealthSchema } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { statusCareerAdaptMcpBridge } from "@/server/careerAdaptMcpBridgeRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  const mcp = statusCareerAdaptMcpBridge();
  const runtimeUrl = process.env.HERMES_RUNTIME_URL?.trim();
  if (!runtimeUrl) {
    const provider = await checkConfiguredProvider();
    return NextResponse.json({
      available: false,
      runtimeId: "hermes",
      reason: provider.providerStatus === "unreachable"
        ? "hermes_companion_not_configured_provider_unreachable"
        : "hermes_companion_not_configured",
      ...provider,
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return proxy(`${runtimeUrl.replace(/\/$/u, "")}/health`, mcp);
}

async function proxy(url: string, mcp: ReturnType<typeof statusCareerAdaptMcpBridge>) {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
    const raw = await response.json().catch(() => ({}));
    const upstream = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const health = HermesHealthSchema.safeParse({
      available: typeof upstream.available === "boolean" ? upstream.available : response.ok,
      runtimeId: typeof upstream.runtimeId === "string" ? upstream.runtimeId : "hermes",
      version: typeof upstream.version === "string" ? upstream.version : undefined,
      reason: typeof upstream.reason === "string" ? upstream.reason : response.ok ? undefined : `hermes_http_${response.status}`,
      provider: typeof upstream.provider === "string" ? upstream.provider : process.env.HERMES_BASE_URL ? "openai-compatible" : undefined,
      model: typeof upstream.model === "string" ? upstream.model : process.env.HERMES_MODEL?.trim() || undefined,
      providerStatus: normalizeProviderStatus(upstream.providerStatus, response.ok),
      contextWindow: numberValue(upstream.contextWindow),
      toolCalling: normalizeToolCalling(upstream.toolCalling),
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    });
    if (!health.success) {
      return NextResponse.json({
        available: false,
        runtimeId: "hermes",
        reason: "hermes_health_invalid_response",
        mcpServer: mcp.server,
        mcpConnected: mcp.connected,
        discoveredToolCount: mcp.discoveredToolCount
      }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(health.data, {
      status: health.data.available ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    return NextResponse.json({
      available: false,
      runtimeId: "hermes",
      reason: "hermes_companion_unreachable",
      providerStatus: "unreachable",
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function checkConfiguredProvider() {
  const baseUrl = process.env.HERMES_BASE_URL?.trim();
  if (!baseUrl) {
    return {
      providerStatus: "unconfigured" as const,
      provider: undefined,
      model: process.env.HERMES_MODEL?.trim() || undefined,
      toolCalling: "unknown" as const
    };
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/models`, {
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(5_000),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    const firstModel = payload && typeof payload === "object" && !Array.isArray(payload)
      && Array.isArray((payload as Record<string, unknown>).data)
      ? ((payload as Record<string, unknown>).data as unknown[])[0]
      : undefined;
    const modelRecord = firstModel && typeof firstModel === "object" && !Array.isArray(firstModel)
      ? firstModel as Record<string, unknown>
      : {};
    const contextWindow = numberValue(modelRecord.context_length ?? modelRecord.contextWindow);
    return {
      provider: "openai-compatible",
      model: process.env.HERMES_MODEL?.trim() || (typeof modelRecord.id === "string" ? modelRecord.id : undefined),
      providerStatus: response.ok ? "ready" as const : "invalid" as const,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      toolCalling: "unknown" as const
    };
  } catch {
    return {
      provider: "openai-compatible",
      model: process.env.HERMES_MODEL?.trim() || undefined,
      providerStatus: "unreachable" as const,
      toolCalling: "unknown" as const
    };
  }
}

function upstreamHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.HERMES_API_KEY?.trim() || process.env.HERMES_RUNTIME_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeProviderStatus(value: unknown, responseOk: boolean) {
  if (value === "ready" || value === "unconfigured" || value === "unreachable" || value === "invalid" || value === "unknown") return value;
  return responseOk ? "unknown" : "unreachable";
}

function normalizeToolCalling(value: unknown) {
  if (value === "verified" || value === "unverified" || value === "unsupported" || value === "unknown") return value;
  return "unknown";
}
