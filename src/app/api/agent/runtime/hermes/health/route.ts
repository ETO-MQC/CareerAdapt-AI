import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { HermesHealthSchema, type HermesHealth } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { RuntimeHealthSchema } from "@/agent/runtime/runtimeHealth";
import { statusCareerAdaptMcpBridge } from "@/server/careerAdaptMcpBridgeRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  const mcp = statusCareerAdaptMcpBridge();
  const runtimeUrl = process.env.HERMES_RUNTIME_URL?.trim();
  if (!runtimeUrl) {
    const provider = await checkConfiguredProvider();
    const legacy: HermesHealth = {
      available: false,
      runtimeId: "hermes",
      reason: provider.providerStatus === "unreachable"
        ? "hermes_companion_not_configured_provider_unreachable"
        : "hermes_companion_not_configured",
      ...provider,
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    };
    return NextResponse.json(await withRuntimeHealth(legacy, mcp), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return proxy(`${runtimeUrl.replace(/\/$/u, "")}/health`, mcp);
}

async function proxy(url: string, mcp: ReturnType<typeof statusCareerAdaptMcpBridge>) {
  try {
    let response = await fetch(url, {
      method: "GET",
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store"
    });
    // Hermes 0.19's official backend serves its health contract at
    // /api/health while older companion builds expose /health. Keep the
    // configured runtime root stable and accept both official shapes here.
    if (response.status === 404 && /\/health$/u.test(url)) {
      response = await fetch(url.replace(/\/health$/u, "/api/health"), {
        method: "GET",
        headers: upstreamHeaders(),
        signal: AbortSignal.timeout(8_000),
        cache: "no-store"
      });
    }
    const raw = await response.json().catch(() => ({}));
    const upstream = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const upstreamRuntimeHealth = readRuntimeHealth(upstream.runtimeHealth);
    const configuredProvider = typeof upstream.providerStatus === "string"
      || typeof upstream.provider === "string"
      || typeof upstream.model === "string"
      ? undefined
      : await checkConfiguredProvider();
    const health = HermesHealthSchema.safeParse({
      available: typeof upstream.available === "boolean" ? upstream.available : response.ok,
      runtimeId: typeof upstream.runtimeId === "string" ? upstream.runtimeId : "hermes",
      version: typeof upstream.version === "string" ? upstream.version : undefined,
      reason: typeof upstream.reason === "string" ? upstream.reason : response.ok ? undefined : `hermes_http_${response.status}`,
      provider: typeof upstream.provider === "string" ? upstream.provider : configuredProvider?.provider ?? (configuredProviderBaseUrl() ? "openai-compatible" : undefined),
      model: typeof upstream.model === "string" ? upstream.model : configuredProvider?.model ?? configuredModel(),
      providerStatus: typeof upstream.providerStatus === "string"
        ? normalizeProviderStatus(upstream.providerStatus, response.ok)
        : configuredProvider?.providerStatus ?? normalizeProviderStatus(upstream.providerStatus, response.ok),
      contextWindow: numberValue(upstream.contextWindow) ?? configuredProvider?.contextWindow,
      toolCalling: typeof upstream.toolCalling === "string"
        ? normalizeToolCalling(upstream.toolCalling)
        : configuredProvider?.toolCalling ?? normalizeToolCalling(upstream.toolCalling),
      ...(upstream.roadshowMode === true ? { roadshowMode: true } : {}),
      ...(upstreamRuntimeHealth ? { runtimeHealth: upstreamRuntimeHealth } : {}),
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    });
    if (!health.success) {
      const legacy = {
        available: false,
        runtimeId: "hermes",
        reason: "hermes_health_invalid_response",
        mcpServer: mcp.server,
        mcpConnected: mcp.connected,
        discoveredToolCount: mcp.discoveredToolCount
      };
      return NextResponse.json(await withRuntimeHealth(legacy, mcp), { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await withRuntimeHealth(health.data, mcp), {
      status: health.data.available ? 200 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  } catch {
    const legacy: HermesHealth = {
      available: false,
      runtimeId: "hermes",
      reason: "hermes_companion_unreachable",
      providerStatus: "unreachable",
      mcpServer: mcp.server,
      mcpConnected: mcp.connected,
      discoveredToolCount: mcp.discoveredToolCount
    };
    return NextResponse.json(await withRuntimeHealth(legacy, mcp), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function withRuntimeHealth(
  health: ReturnType<typeof HermesHealthSchema.parse>,
  mcp: ReturnType<typeof statusCareerAdaptMcpBridge>
) {
  const upstreamRuntimeHealth = health.runtimeHealth;
  const careerSkillsLoaded = upstreamRuntimeHealth?.careerSkillsLoaded ?? await detectCareerSkills();
  const runtimeHealth = RuntimeHealthSchema.parse({
    ...(upstreamRuntimeHealth ?? {}),
    runtimeId: upstreamRuntimeHealth?.runtimeId ?? health.runtimeId ?? "hermes",
    runtimeAvailable: upstreamRuntimeHealth?.runtimeAvailable ?? health.available,
    providerConfigured: upstreamRuntimeHealth?.providerConfigured ?? (health.providerStatus === "ready"
      || health.providerStatus === "invalid"
      || health.providerStatus === "unreachable"
      || Boolean(health.provider || health.model)),
    providerReachable: upstreamRuntimeHealth?.providerReachable ?? health.providerStatus === "ready",
    ...(health.model || upstreamRuntimeHealth?.model ? { model: health.model ?? upstreamRuntimeHealth?.model } : {}),
    ...(health.contextWindow === undefined && upstreamRuntimeHealth?.contextWindow === undefined ? {} : { contextWindow: health.contextWindow ?? upstreamRuntimeHealth?.contextWindow }),
    toolCallingAvailable: upstreamRuntimeHealth?.toolCallingAvailable ?? health.toolCalling === "verified",
    mcpConnected: mcp.connected,
    mcpToolCount: mcp.discoveredToolCount,
    careerSkillsLoaded,
    lastCheckedAt: new Date().toISOString(),
    ...(health.reason ? { safeErrorCode: safeErrorCode(health.reason) } : {})
  });
  return { ...health, roadshowMode: process.env.ROADSHOW_AGENT_MODE?.trim().toLowerCase() === "true", runtimeHealth };
}

async function detectCareerSkills() {
  const explicitRoot = process.env.HERMES_SKILLS_ROOT?.trim();
  const hermesHome = process.env.HERMES_HOME?.trim()
    || (process.platform === "win32"
      ? process.env.LOCALAPPDATA?.trim() || path.join(os.homedir(), "AppData", "Local", "hermes")
      : path.join(os.homedir(), ".hermes"));
  const root = explicitRoot || path.join(hermesHome, "skills", "careeradapt");
  const expected = [
    "candidate-profile-interview",
    "career-story-mining",
    "job-fit-analysis",
    "resume-tailoring",
    "resume-review",
    "resume-composition"
  ];
  const found = await Promise.all(expected.map(async (name) => {
    try {
      await fs.access(path.join(root, name, "SKILL.md"));
      return true;
    } catch {
      return false;
    }
  }));
  return found.every(Boolean);
}

function readRuntimeHealth(value: unknown) {
  const parsed = RuntimeHealthSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

async function checkConfiguredProvider() {
  const baseUrl = configuredProviderBaseUrl();
  if (!baseUrl) {
    return {
      providerStatus: "unconfigured" as const,
      provider: undefined,
      model: configuredModel(),
      contextWindow: undefined,
      toolCalling: "unknown" as const
    };
  }
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/models`, {
      headers: providerHeaders(),
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
      model: configuredModel() || (typeof modelRecord.id === "string" ? modelRecord.id : undefined),
      providerStatus: response.ok ? "ready" as const : "invalid" as const,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      toolCalling: "unknown" as const
    };
  } catch {
    return {
      provider: "openai-compatible",
      model: configuredModel(),
      providerStatus: "unreachable" as const,
      toolCalling: "unknown" as const
    };
  }
}

function upstreamHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.HERMES_RUNTIME_API_KEY?.trim()
    || process.env.HERMES_API_KEY?.trim()
    || process.env.AI_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function providerHeaders() {
  const headers: Record<string, string> = { Accept: "application/json" };
  const apiKey = process.env.AI_API_KEY?.trim()
    || process.env.HERMES_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function configuredProviderBaseUrl() {
  return process.env.HERMES_BASE_URL?.trim() || process.env.AI_BASE_URL?.trim();
}

function configuredModel() {
  return process.env.HERMES_MODEL?.trim() || process.env.AI_MODEL?.trim() || undefined;
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

function safeErrorCode(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_");
  return normalized.slice(0, 120) || "hermes_health_failed";
}
