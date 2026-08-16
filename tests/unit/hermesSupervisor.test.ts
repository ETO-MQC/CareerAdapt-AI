import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { HermesSupervisor } = require("../../electron/hermesSupervisor.js") as {
  HermesSupervisor: new (options: Record<string, unknown>) => {
    start(settings?: unknown): Promise<Record<string, unknown>>;
    rendererHostReady(settings?: unknown): Promise<Record<string, unknown>>;
    recover(): Promise<Record<string, unknown>>;
    shutdown(): Promise<Record<string, unknown>>;
    applyHealth(health: Record<string, unknown>): void;
    getStatus(): Record<string, unknown>;
  };
};

const supervisors: Array<InstanceType<typeof HermesSupervisor>> = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
});

function createHealth(overrides: Record<string, unknown> = {}) {
  const careerDomainContracts = Array.from({ length: 56 }, (_, index) => `career.domain.${index}`);
  const productionTools = Array.from({ length: 15 }, (_, index) => `career.production.${index}`);
  return {
    available: true,
    version: "0.19.0",
    provider: "https://provider.example/v1",
    model: "mimo-v2.5-pro",
    providerStatus: "ready",
    runtimeHealth: {
      runtimeAvailable: true,
      companionReady: true,
      providerConfigured: true,
      providerReachable: true,
      providerReady: true,
      mcpConnected: true,
      mcpReady: true,
      mcpToolCount: productionTools.length,
      browserCareerDomainHostConnected: true,
      careerMcpServerReachable: true,
      careerMcpContractCount: productionTools.length,
      hermesMcpRegistered: true,
      hermesMcpToolCount: productionTools.length,
      careerSkillsLoaded: true,
      requiredCareerFacadesMissing: [],
      careerGatewayContracts: careerDomainContracts,
      careerMcpExposedTools: productionTools,
      hermesRegisteredToolsets: ["careeradapt"],
      hermesVisibleTools: productionTools,
      runReady: true
    },
    ...overrides
  };
}

function createHarness(initialHealth = createHealth(), options: Record<string, unknown> = {}) {
  let currentHealth: Record<string, unknown> = initialHealth;
  let startCount = 0;
  const children: Array<EventEmitter & { exitCode: number | null }> = [];
  const startCompanion = async () => {
    startCount += 1;
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    children.push(child);
    return {
      ok: true,
      owned: true,
      child,
      runtime: { baseUrl: "http://127.0.0.1:18642" },
      logPath: "C:/logs/hermes-runtime.log"
    };
  };
  const stopCompanion = async (handle: { child?: EventEmitter & { exitCode: number | null } }) => {
    const child = handle.child;
    if (!child || child.exitCode !== null) return;
    child.exitCode = 0;
    child.emit("exit", 0, null);
  };
  const fetchImpl = async (url: string) => url.includes("/api/agent/runtime/hermes/health")
    ? { ok: true, json: async () => currentHealth }
    : { ok: false, json: async () => ({}) };
  const supervisor = new HermesSupervisor({
    projectRoot: process.cwd(),
    appBaseUrl: "http://127.0.0.1:3000",
    environment: {
      HERMES_RUNTIME_URL: "http://127.0.0.1:18642",
      HERMES_RUNTIME_API_KEY: "local-test-secret",
      AI_BASE_URL: "https://provider.example/v1",
      AI_MODEL: "mimo-v2.5-pro"
    },
    startCompanion,
    stopCompanion,
    fetchImpl,
    careerSyncPollIntervalMs: 0,
    startupSyncTimeoutMs: 15,
    autoRestartDelaysMs: [0],
    ...options
  });
  supervisors.push(supervisor);
  return {
    supervisor,
    children,
    getStartCount: () => startCount,
    setHealth: (health: Record<string, unknown>) => { currentHealth = health; }
  };
}

describe("Hermes Supervisor lifecycle", () => {
  it("does not launch before renderer MCP READY and reaches Ready once", async () => {
    const harness = createHarness();
    const beforeReady = await harness.supervisor.start();
    expect(beforeReady.overallState).toBe("stopped");
    expect(harness.getStartCount()).toBe(0);

    const ready = await harness.supervisor.rendererHostReady();
    expect(ready).toMatchObject({
      overallState: "ready",
      processReady: true,
      apiReady: true,
      providerReady: true,
      careerMcpReady: true,
      toolSurfaceReady: true,
      runReady: true,
      careerDomainToolCount: 56,
      hermesCareerToolCount: 15,
      requiredCareerFacadesReady: 8,
      requiredCareerFacadesTotal: 8
    });
    expect(harness.getStartCount()).toBe(1);

    const second = await harness.supervisor.start();
    expect(second.overallState).toBe("ready");
    expect(harness.getStartCount()).toBe(1);
  });

  it("settles bounded tool synchronization as degraded instead of deadlocking in starting", async () => {
    const harness = createHarness(createHealth({
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        browserCareerDomainHostConnected: false,
        careerMcpServerReachable: false,
        mcpConnected: false,
        mcpReady: false,
        runReady: false
      }
    }));
    const result = await harness.supervisor.rendererHostReady();
    expect(result.overallState).toBe("degraded");
    expect(result.reasonCode).toBe("career_mcp_sync_timeout");
    expect(harness.getStartCount()).toBe(1);
  });

  it("does not restart-loop on provider configuration errors", async () => {
    const harness = createHarness(createHealth({
      providerStatus: "invalid",
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        providerReady: false,
        providerReachable: false,
        runReady: false
      }
    }));
    const result = await harness.supervisor.rendererHostReady();
    expect(result.overallState).toBe("degraded");
    expect(result.reasonCode).toBe("configuration_required");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.getStartCount()).toBe(1);
  });

  it("auto-recovers one unexpected child crash and keeps the same supervisor owner", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    harness.children[0].exitCode = 1;
    harness.children[0].emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.getStartCount()).toBe(2);
    expect(harness.supervisor.getStatus().overallState).toBe("ready");
  });

  it("uses one controlled restart to repair a Career tool-surface desync", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    harness.supervisor.applyHealth(createHealth({
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        hermesMcpRegistered: true,
        hermesMcpToolCount: 0,
        careerMcpExposedTools: [],
        hermesVisibleTools: []
      }
    }));
    expect(harness.supervisor.getStatus().overallState).toBe("syncing_career_tools");
    await harness.supervisor.recover();
    expect(harness.getStartCount()).toBe(2);
    expect(harness.supervisor.getStatus().overallState).toBe("ready");
  });
});
