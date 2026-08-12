import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { HermesHealthSchema, type HermesHealth } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { RuntimeHealthSchema } from "@/agent/runtime/runtimeHealth";
import { HermesCareerToolCatalog } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import {
  careerAdaptMcpBridgeContracts,
  statusCareerAdaptMcpBridge
} from "@/server/careerAdaptMcpBridgeRegistry";

export const dynamic = "force-dynamic";

const HERMES_HEALTH_REQUEST_TIMEOUT_MS = 15_000;
const HERMES_TOOLSET_CACHE_TTL_MS = 10_000;
let hermesToolsetSnapshotCache: {
  runtimeBaseUrl: string;
  snapshot: HermesToolsetSnapshot;
  expiresAt: number;
} | undefined;
let hermesToolsetSnapshotInFlight: Promise<HermesToolsetSnapshot> | undefined;

export async function GET(request: Request) {
  const appBaseUrl = new URL(request.url).origin;
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
    return NextResponse.json(await withRuntimeHealth(legacy, mcp, undefined, appBaseUrl), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return proxy(`${runtimeUrl.replace(/\/$/u, "")}/health`, mcp, appBaseUrl);
}

async function proxy(url: string, mcp: ReturnType<typeof statusCareerAdaptMcpBridge>, appBaseUrl: string) {
  try {
    let response = await fetch(url, {
      method: "GET",
      headers: upstreamHeaders(),
      signal: AbortSignal.timeout(HERMES_HEALTH_REQUEST_TIMEOUT_MS),
      cache: "no-store"
    });
    // Hermes 0.19's official backend serves its health contract at
    // /api/health while older companion builds expose /health. Keep the
    // configured runtime root stable and accept both official shapes here.
    if (response.status === 404 && /\/health$/u.test(url)) {
      response = await fetch(url.replace(/\/health$/u, "/api/health"), {
          method: "GET",
          headers: upstreamHeaders(),
          signal: AbortSignal.timeout(HERMES_HEALTH_REQUEST_TIMEOUT_MS),
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
      return NextResponse.json(await withRuntimeHealth(legacy, mcp, rootUrl(url), appBaseUrl), { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(await withRuntimeHealth(health.data, mcp, rootUrl(url), appBaseUrl), {
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
    return NextResponse.json(await withRuntimeHealth(legacy, mcp, rootUrl(url), appBaseUrl), { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

async function withRuntimeHealth(
  health: ReturnType<typeof HermesHealthSchema.parse>,
  mcp: ReturnType<typeof statusCareerAdaptMcpBridge>,
  runtimeBaseUrl?: string,
  appBaseUrl?: string
) {
  const upstreamRuntimeHealth = health.runtimeHealth;
  const careerSkillsLoaded = upstreamRuntimeHealth?.careerSkillsLoaded ?? await detectCareerSkills();
  const registry = await readHermesToolsetSnapshot(runtimeBaseUrl);
  const careerMcpServerReachable = await probeCareerMcpServer(appBaseUrl);
  const contracts = careerAdaptMcpBridgeContracts();
  const catalog = new HermesCareerToolCatalog(contracts);
  const coverage = catalog.coverage(registry.visibleTools, registry.registeredToolsets);
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
    browserCareerDomainHostConnected: mcp.connected,
    // The health route itself is served by the CareerAdapt Next process and
    // the MCP endpoint is part of that process. This is intentionally kept
    // separate from the browser bridge signal above.
    careerMcpServerReachable,
    careerMcpContractCount: mcp.discoveredToolCount,
    hermesMcpRegistered: coverage.hermesMcpRegistered,
    hermesMcpToolCount: coverage.hermesMcpToolCount,
    hermesCareerFacadeCount: coverage.hermesCareerFacadeCount,
    requiredCareerFacadesMissing: coverage.requiredCareerFacadesMissing,
    careerGatewayContracts: contracts.map((contract) => contract.name).sort(),
    careerMcpExposedTools: contracts.map((contract) => contract.name).sort(),
    hermesRegisteredToolsets: registry.registeredToolsets,
    hermesVisibleTools: registry.visibleTools,
    missingRequiredCareerTools: coverage.requiredCareerFacadesMissing,
    lastCheckedAt: new Date().toISOString(),
    ...(health.reason ? { safeErrorCode: safeErrorCode(health.reason) } : {})
  });
  const configuredRuntimeUrl = process.env.HERMES_RUNTIME_URL?.trim().replace(/\/$/u, "");
  const appUrl = process.env.CAREERADAPT_BASE_URL?.trim().replace(/\/$/u, "");
  return {
    ...health,
    ...(configuredRuntimeUrl ? { runtimeUrl: configuredRuntimeUrl } : {}),
    ...(appUrl ? { appUrl } : {}),
    roadshowMode: process.env.ROADSHOW_AGENT_MODE?.trim().toLowerCase() === "true",
    runtimeHealth
  };
}

export type HermesToolsetSnapshot = {
  ok: boolean;
  registeredToolsets: string[];
  visibleTools: string[];
};

/** Parse the official Hermes `/v1/toolsets` payload without trusting labels. */
export function parseHermesToolsetsPayload(value: unknown): HermesToolsetSnapshot {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rows = Array.isArray(root.data) ? root.data : [];
  const registeredToolsets: string[] = [];
  const visibleTools: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const enabled = record.enabled === true;
    if (!enabled) continue;
    if (typeof record.name === "string" && record.name.trim()) registeredToolsets.push(record.name.trim());
    const tools = Array.isArray(record.tools)
      ? record.tools
      : Array.isArray(record.resolved_tools) ? record.resolved_tools : [];
    for (const tool of tools) {
      if (typeof tool === "string" && tool.trim()) visibleTools.push(tool.trim());
    }
  }
  return {
    ok: typeof root.object === "string" || Array.isArray(root.data),
    registeredToolsets: [...new Set(registeredToolsets)].sort(),
    visibleTools: [...new Set(visibleTools)].sort()
  };
}

async function readHermesToolsetSnapshot(runtimeBaseUrl?: string): Promise<HermesToolsetSnapshot> {
  if (!runtimeBaseUrl) return { ok: false, registeredToolsets: [], visibleTools: [] };
  const normalizedRuntimeBaseUrl = runtimeBaseUrl.replace(/\/$/u, "");
  const now = Date.now();
  if (hermesToolsetSnapshotCache
    && hermesToolsetSnapshotCache.runtimeBaseUrl === normalizedRuntimeBaseUrl
    && hermesToolsetSnapshotCache.expiresAt > now) {
    return hermesToolsetSnapshotCache.snapshot;
  }
  // Renderer boot and diagnostics can ask for the same aggregate health
  // snapshot concurrently. Share one bounded official Hermes request so
  // repeated `/v1/toolsets` discovery calls do not starve the API server.
  if (hermesToolsetSnapshotInFlight) return hermesToolsetSnapshotInFlight;
  hermesToolsetSnapshotInFlight = (async () => {
    const url = `${normalizedRuntimeBaseUrl}/v1/toolsets`;
    let snapshot: HermesToolsetSnapshot = { ok: false, registeredToolsets: [], visibleTools: [] };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: upstreamHeaders(),
          // Hermes 0.19 resolves the static toolset catalog and runs
          // availability checks before returning the live MCP registry. On a
          // cold packaged start this official endpoint can take several
          // seconds even after /health is ready.
          signal: AbortSignal.timeout(20_000),
          cache: "no-store"
        });
        if (!response.ok) return snapshot;
        const raw = await response.text();
        if (raw.trim()) snapshot = parseHermesToolsetsPayload(JSON.parse(raw));
        // A cold Hermes API Server can briefly return a successful empty body
        // while another request is materialising the live toolset registry.
        if (snapshot.ok) return snapshot;
      } catch {
        // Retry once for cold-start connection/JSON errors. Readiness remains
        // false if the official endpoint still cannot provide a valid payload.
      }
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return snapshot;
  })();
  try {
    const snapshot = await hermesToolsetSnapshotInFlight;
    if (snapshot.ok) {
      hermesToolsetSnapshotCache = {
        runtimeBaseUrl: normalizedRuntimeBaseUrl,
        snapshot,
        expiresAt: Date.now() + HERMES_TOOLSET_CACHE_TTL_MS
      };
    }
    return snapshot;
  } finally {
    hermesToolsetSnapshotInFlight = undefined;
  }
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

async function probeCareerMcpServer(appBaseUrl?: string) {
  if (!appBaseUrl) return false;
  try {
    const response = await fetch(`${appBaseUrl.replace(/\/$/u, "")}/api/agent/mcp`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2_000),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      && payload && typeof payload === "object" && !Array.isArray(payload)
      && (payload as Record<string, unknown>).server === "careeradapt";
  } catch {
    return false;
  }
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

function rootUrl(url: string) {
  return url.replace(/\/(?:api\/health|health)$/u, "");
}
