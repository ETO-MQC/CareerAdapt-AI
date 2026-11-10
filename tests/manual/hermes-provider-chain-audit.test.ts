import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const { HermesSupervisor } = createRequire(import.meta.url)("../../electron/hermesSupervisor.js");
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function configuredEnvironment() {
  const env = { HERMES_RUNTIME_URL: "http://127.0.0.1:18643", API_SERVER_KEY: "audit-control-synthetic",
    AI_PROVIDER: "openai-compatible", HERMES_PROVIDER: "openai-compatible", AI_BASE_URL: "http://127.0.0.1:18644/v1",
    HERMES_BASE_URL: "http://127.0.0.1:18644/v1", AI_API_KEY: "audit-provider-synthetic",
    HERMES_CUSTOM_CAREERADAPT_API_KEY: "audit-provider-synthetic", AI_MODEL: "audit-model", HERMES_MODEL: "audit-model" };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  return env;
}

describe("diagnostic observations only: PASS confirms defects, not repaired readiness", () => {
  it("O1 actual health route treats /models 429 as invalid despite configured credentials", async () => {
    configuredEnvironment(); vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok", version: "0.19.0" });
      if (url.endsWith("/models")) return Response.json({ error: "synthetic rate limit" }, { status: 429 });
      if (url.endsWith("/api/agent/mcp")) return Response.json({ server: "careeradapt" });
      if (url.endsWith("/v1/toolsets")) return Response.json({ object: "list", data: [{ name: "skills", enabled: true, tools: ["skills_list"] }] });
      return Response.json({}, { status: 503 });
    }));
    const { GET } = await import("@/app/api/agent/runtime/hermes/health/route");
    const response = await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"));
    const payload = await response.json();
    expect(payload).toMatchObject({ available: true, providerStatus: "invalid", providerDiagnostic: { credentialConfigured: true, lastHttpStatus: 429, safeErrorCode: "provider_http_429" } });
    expect(JSON.stringify(payload)).not.toContain("audit-provider-synthetic");
  });
  it("O2 each readiness poll probes /models again, with no provider probe cache", async () => {
    configuredEnvironment(); vi.resetModules();
    let modelProbes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/models")) { modelProbes++; return Response.json({ data: [] }); }
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      return Response.json({}, { status: 503 });
    }));
    const { GET } = await import("@/app/api/agent/runtime/hermes/health/route");
    for (let index = 0; index < 3; index++) await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"));
    expect(modelProbes).toBe(3);
  });
  it("O3 tool synchronization is bounded, but a later HTTP 429 turns into configuration_required", async () => {
    const env = configuredEnvironment();
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    const health = { available: true, provider: "custom:careeradapt", model: "audit-model", providerStatus: "ready",
      runtimeHealth: { runtimeAvailable: true, providerConfigured: true, providerReachable: true, providerReady: true,
        browserCareerDomainHostConnected: true, careerMcpServerReachable: true, mcpConnected: true,
        careerToolContractReady: true, hermesMcpRegistered: false, hermesMcpToolCount: 0, careerSkillsLoaded: true,
        requiredCareerFacadesMissing: ["career.workflow.job_intake"], runReady: false } };
    const supervisor = new HermesSupervisor({ projectRoot: process.cwd(), environment: env,
      appBaseUrl: "http://127.0.0.1:3000", startupSyncTimeoutMs: 40, careerSyncPollIntervalMs: 1,
      startCompanion: async () => ({ ok: true, owned: true, child, runtime: { baseUrl: env.HERMES_RUNTIME_URL } }),
      stopCompanion: async () => { child.exitCode = 0; },
      fetchImpl: async (url: string) => url.endsWith("/api/agent/runtime/hermes/health")
        ? Response.json(health) : Response.json({}, { status: 404 }) });
    try {
      const initial = await supervisor.rendererHostReady({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL, provider: "openai-compatible" });
      expect(initial).toMatchObject({ overallState: "degraded", reasonCode: "hermes_tool_surface_sync_timeout", providerReady: true, toolSurfaceReady: false });
      supervisor.applyHealth({ ...health, providerStatus: "invalid", providerDiagnostic: { credentialConfigured: true, lastHttpStatus: 429, safeErrorCode: "provider_http_429" }, runtimeHealth: { ...health.runtimeHealth, providerReachable: false, providerReady: false } });
      expect(supervisor.getStatus()).toMatchObject({ overallState: "degraded", reasonCode: "configuration_required", apiReady: true, careerMcpReady: true, providerReady: false });
    } finally { await supervisor.shutdown(); }
  });
});
