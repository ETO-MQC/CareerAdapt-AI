import { describe, expect, it } from "vitest";
import {
  applyHermesProviderTest,
  createHermesControlSnapshot,
  createInitialHermesControlSnapshot,
  hermesControlStatusLabel,
  requestHermesStart,
  updateHermesControlRunState,
  type HermesSupervisorSnapshot
} from "@/services/agent/hermesControl";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";

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

  it("updates the shared projection immediately after a Provider test and keeps service state independent", () => {
    const initial = createInitialHermesControlSnapshot("web");
    const result = applyHermesProviderTest(initial, {
      ok: false,
      provider: "openai-compatible",
      model: "mimo-v2.5-pro",
      credentialConfigured: true,
      credentialSource: "custom_header",
      checkedAt: new Date().toISOString(),
      httpStatus: 401,
      safeErrorCode: "provider_http_401"
    });

    expect(result.serviceState).toBe("unavailable");
    expect(result.apiState).toBe("unreachable");
    expect(result.providerState).toBe("auth_error");
    expect(result.status).toBe("configuration_required");
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
    const result = await requestHermesStart();
    expect(result.ok).toBe(false);
    expect(result.receipt).toMatchObject({
      action: "start",
      accepted: false,
      executed: false,
      safeReasonCode: "control_not_supported_in_web",
      controlOwner: "external_environment"
    });
  });
});
