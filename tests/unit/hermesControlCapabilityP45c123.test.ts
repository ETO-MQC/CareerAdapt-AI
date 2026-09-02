import { describe, expect, it, vi } from "vitest";
import {
  createHermesControlSnapshot,
  hermesControlStatusLabel,
  requestHermesStart,
  updateHermesControlRunState,
  type HermesSupervisorSnapshot
} from "@/services/agent/hermesControl";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import type { RuntimeHealth } from "@/agent/runtime/runtimeHealth";

function careerHealth(overrides: Record<string, unknown> = {}) {
  return {
    runtimeAvailable: true,
    companionReady: true,
    providerConfigured: true,
    providerReachable: true,
    providerReady: true,
    providerStatus: "ready",
    model: "mimo-v2.5-pro",
    runReady: true,
    mcpReady: true,
    mcpConnected: true,
    browserCareerDomainHostConnected: true,
    careerMcpServerReachable: true,
    hermesMcpRegistered: true,
    hermesMcpToolCount: 8,
    hermesCareerFacadeCount: 8,
    requiredCareerFacadesMissing: [],
    careerMcpContractCount: 8,
    careerSkillsLoaded: true,
    ...overrides
  };
}

function electronSupervisor(): HermesSupervisorSnapshot {
  return {
    overallState: "ready",
    processReady: true,
    apiReady: true,
    providerReady: true,
    careerMcpReady: true,
    toolSurfaceReady: true,
    runReady: true,
    careerSkillsReady: true,
    updatedAt: new Date().toISOString(),
    model: "mimo-v2.5-pro",
    provider: "openai-compatible",
    restartAttempt: 0,
    uptimeMs: 100,
    careerDomainToolCount: 8,
    hermesCareerToolCount: 8,
    requiredCareerFacadesReady: 8,
    requiredCareerFacadesTotal: 8,
    latestLifecycleEntries: []
  };
}

describe("P4.5c.1.23 Hermes control capability and provider closure", () => {
  it("disables Web process controls and exposes reconnect/run/provider actions", () => {
    const snapshot = createHermesControlSnapshot({
      environment: "web",
      health: { available: true, providerStatus: "unknown", runtimeHealth: careerHealth({ providerReady: undefined, providerStatus: "unknown", runReady: false }) }
    });

    expect(snapshot.supervisorExpected).toBe(false);
    expect(snapshot.controlOwner).toBe("external_environment");
    expect(snapshot.capabilities.canStartService).toBe(false);
    expect(snapshot.capabilities.canStopService).toBe(false);
    expect(snapshot.capabilities.canRestartService).toBe(false);
    expect(snapshot.capabilities.canRecoverService).toBe(false);
    expect(snapshot.capabilities.canReconnect).toBe(true);
    expect(snapshot.capabilities.canTestProvider).toBe(true);
    expect(snapshot.capabilities.unsupportedReason).toContain("Web 调试模式");
    expect(hermesControlStatusLabel(snapshot)).toBe("Hermes API 已连接");
  });

  it("classifies Provider HTTP 401 as auth_error and configuration_required", () => {
    const apiSnapshot = createHermesControlSnapshot({
      environment: "web",
      health: {
        available: true,
        provider: "openai-compatible",
        model: "mimo-v2.5-pro",
        providerStatus: "invalid",
        providerDiagnostic: {
          provider: "openai-compatible",
          model: "mimo-v2.5-pro",
          credentialConfigured: true,
          credentialSource: "server_env",
          lastHttpStatus: 401,
          safeErrorCode: "provider_http_401"
        },
        runtimeHealth: careerHealth({ providerReachable: false, providerReady: false, providerStatus: "invalid", runReady: false })
      }
    });

    expect(apiSnapshot.apiState).toBe("reachable");
    expect(apiSnapshot.apiReady).toBe(true);
    expect(apiSnapshot.providerState).toBe("auth_error");
    expect(apiSnapshot.providerReady).toBe(false);
    expect(apiSnapshot.status).toBe("configuration_required");
    expect(apiSnapshot.ready).toBe(false);
    expect(hermesControlStatusLabel(apiSnapshot)).toBe("需要配置");
  });

  it("maps health_endpoint_ready to API-connected feedback without declaring Ready", () => {
    const snapshot = createHermesControlSnapshot({
      environment: "web",
      health: {
        available: true,
        reason: "health_endpoint_ready",
        providerStatus: "unknown",
        runtimeHealth: careerHealth({ providerReady: undefined, providerStatus: "unknown", runReady: false })
      }
    });

    expect(snapshot.apiReady).toBe(true);
    expect(snapshot.ready).toBe(false);
    expect(hermesControlStatusLabel(snapshot)).toBe("Hermes API 已连接");
  });

  it("gives Electron Supervisor the process capabilities and preserves a single projection", () => {
    const snapshot = createHermesControlSnapshot({ environment: "electron", supervisor: electronSupervisor() });
    expect(snapshot.controlOwner).toBe("electron_supervisor");
    expect(snapshot.capabilities.canStartService).toBe(true);
    expect(snapshot.capabilities.canStopService).toBe(true);
    expect(snapshot.capabilities.canRestartService).toBe(true);
    expect(snapshot.capabilities.canRecoverService).toBe(true);

    const store = new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "starting" });
    store.recordControlSnapshot(snapshot);
    expect(store.getSnapshot().controlSnapshot).toBe(snapshot);
    expect(store.getSnapshot().status).toBe("ready");
  });

  it("gives the local Web Supervisor the same process capabilities", () => {
    const snapshot = createHermesControlSnapshot({
      environment: "web",
      controlOwner: "web_supervisor",
      health: { available: false }
    });
    expect(snapshot.supervisorExpected).toBe(true);
    expect(snapshot.controlOwner).toBe("web_supervisor");
    expect(snapshot.capabilities.canStartService).toBe(true);
    expect(snapshot.capabilities.canStopService).toBe(true);
    expect(snapshot.capabilities.canRestartService).toBe(true);
    expect(snapshot.capabilities.canRecoverService).toBe(true);
  });

  it("reports apply failure and degraded readiness instead of waiting indefinitely", () => {
    const snapshot = createHermesControlSnapshot({
      environment: "electron",
      supervisor: {
        ...electronSupervisor(),
        overallState: "degraded",
        providerReady: false,
        providerStatus: "ready",
        runReady: false,
        reasonCode: "configuration_desync",
        runtimeConfig: {
          applyStatus: "failed",
          verified: false,
          rollbackOccurred: false,
          reasonCode: "configuration_desync"
        }
      }
    });

    expect(snapshot.status).toBe("degraded");
    expect(hermesControlStatusLabel(snapshot)).toBe("应用失败");
    expect(hermesControlStatusLabel({
      ...snapshot,
      runtimeConfig: { ...snapshot.runtimeConfig, applyStatus: "idle" }
    })).toBe("检查未通过");
  });

  it("keeps Supervisor readiness authoritative when a refresh observes a transient health failure", () => {
    const store = new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "starting" });
    store.recordSupervisorStatus(electronSupervisor(), "web");

    store.recordHealth({
      runtimeId: "hermes",
      runtimeAvailable: false,
      providerConfigured: true,
      providerReachable: false,
      providerReady: false,
      providerStatus: "unreachable",
      toolCallingAvailable: false,
      mcpConnected: false,
      mcpToolCount: 0,
      careerSkillsLoaded: false,
      browserCareerDomainHostConnected: false,
      careerMcpServerReachable: false,
      careerMcpContractCount: 0,
      hermesMcpRegistered: false,
      hermesMcpToolCount: 0,
      hermesCareerFacadeCount: 0,
      careerToolContractReady: true,
      careerToolContractMismatches: [],
      requiredCareerFacadesMissing: [],
      careerGatewayContracts: [],
      careerMcpExposedTools: [],
      hermesRegisteredToolsets: [],
      hermesVisibleTools: [],
      missingRequiredCareerTools: [],
      lastCheckedAt: new Date().toISOString(),
      runReady: false
    } satisfies RuntimeHealth);
    store.recordMcp({ connected: false, discoveredToolCount: 0, reason: "mcp_bridge_reconnecting" });

    expect(store.getSnapshot().controlSnapshot).toMatchObject({
      status: "ready",
      serviceState: "running",
      controlOwner: "web_supervisor",
      ready: true
    });
  });

  it("does not let an older Supervisor response roll back a newer Ready projection", () => {
    const store = new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "starting" });
    const ready = {
      ...electronSupervisor(),
      updatedAt: "2026-09-02T01:30:21.181Z",
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      runtimeConfig: {
        active: {
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "z-ai/glm-5.3-flash",
          credentialConfigured: true,
          credentialSource: "managed_config" as const,
          configFingerprint: "ready-fingerprint",
          configGeneration: 2,
          source: "runtime_readback" as const
        },
        applyStatus: "applied" as const,
        verified: true,
        rollbackOccurred: false
      }
    };
    const staleStopped = {
      ...electronSupervisor(),
      overallState: "stopped" as const,
      processReady: false,
      apiReady: false,
      providerReady: false,
      careerMcpReady: false,
      toolSurfaceReady: false,
      runReady: false,
      reasonCode: "hermes_renderer_not_ready",
      updatedAt: "2026-09-02T01:30:09.789Z",
      runtimeConfig: {
        applyStatus: "idle" as const,
        verified: false,
        rollbackOccurred: false
      }
    };

    store.recordSupervisorStatus(ready, "web");
    store.recordSupervisorStatus(staleStopped, "web");

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      supervisorSnapshot: { updatedAt: "2026-09-02T01:30:21.181Z" },
      controlSnapshot: {
        status: "ready",
        runtimeConfig: { applyStatus: "applied", verified: true }
      }
    });
  });

  it("keeps Supervisor configuration and readiness authoritative when Run state changes", () => {
    const supervisor = {
      ...electronSupervisor(),
      activeRunId: "run-1",
      runState: "running" as const,
      runtimeConfig: {
        active: {
          provider: "openrouter",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "stealth/ox-alpha",
          credentialConfigured: true,
          credentialSource: "managed_config" as const,
          configFingerprint: "active-fingerprint",
          configGeneration: 4,
          source: "runtime_readback" as const
        },
        applyStatus: "applied" as const,
        verified: true,
        rollbackOccurred: false
      }
    };
    const store = new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "starting" });
    store.recordSupervisorStatus(supervisor, "electron");

    store.recordRunState("completed");

    expect(store.getSnapshot().controlSnapshot).toMatchObject({
      status: "ready",
      ready: true,
      provider: "openrouter",
      model: "stealth/ox-alpha",
      runtimeConfig: { active: { model: "stealth/ox-alpha" }, applyStatus: "applied" },
      runState: "completed"
    });
  });

  it("keeps candidate test results out of RuntimeStatusStore", () => {
    const store = new RuntimeStatusStore({ preferredRuntime: "hermes", activeRuntime: "hermes", status: "starting" });
    expect("recordCandidateProviderTest" in store).toBe(false);
    expect("candidateProviderTest" in store.getSnapshot()).toBe(false);
    expect(store.getSnapshot().controlSnapshot?.providerState).toBe("unknown");
    expect(store.getSnapshot().providerReady).toBeUndefined();
  });

  it("keeps a stale Run stop in the Run state plane without changing service controls", () => {
    const running = createHermesControlSnapshot({
      environment: "electron",
      supervisor: { ...electronSupervisor(), runReady: true, activeRunId: "run-1", runState: "running" }
    });
    const stopping = updateHermesControlRunState(running, "stopping", "run-1");
    expect(stopping.serviceState).toBe("running");
    expect(stopping.runState).toBe("stopping");
    expect(stopping.capabilities.canStopService).toBe(true);
    expect(stopping.capabilities.canStopCurrentRun).toBe(true);
    const completed = updateHermesControlRunState(stopping, "completed");
    expect(completed.serviceState).toBe("running");
    expect(completed.runState).toBe("completed");
    expect(completed.activeRunId).toBeUndefined();
  });

  it("returns an explicit unsupported receipt for a Web process action", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: false,
      error: { code: "web_control_disabled" }
    }), { status: 409, headers: { "Content-Type": "application/json" } })));
    const result = await requestHermesStart();
    expect(result.ok).toBe(false);
    expect(result.receipt).toMatchObject({
      action: "start",
      accepted: false,
      executed: false,
      safeReasonCode: "web_control_disabled",
      controlOwner: "external_environment"
    });
    vi.unstubAllGlobals();
  });
});
