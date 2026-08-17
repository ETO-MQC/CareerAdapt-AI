import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentExecutionCoordinator } from "@/agent/runtime/AgentExecutionCoordinator";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import type { HermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { createRunStopReason } from "@/agent/runtime/hermes/hermesIncidentTrace";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import type { HermesSupervisorSnapshot } from "@/services/agent/hermesControl";

const require = createRequire(import.meta.url);
const { HermesSupervisor } = require("../../electron/hermesSupervisor.js") as {
  HermesSupervisor: new (options: Record<string, unknown>) => {
    rendererHostReady(settings?: unknown): Promise<Record<string, unknown>>;
    ensureStarted(settings?: unknown): Promise<Record<string, unknown>>;
    recover(): Promise<Record<string, unknown>>;
    shutdown(): Promise<Record<string, unknown>>;
    getStatus(): Record<string, unknown>;
    applyHealth(health: Record<string, unknown>): void;
  };
};

const supervisors: Array<InstanceType<typeof HermesSupervisor>> = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
});

describe("P4.5c.1.12 Hermes incident trace and lifecycle race closure", () => {
  it("keeps an active semantic run alive across duplicate ready, ensure, and recovery checks", async () => {
    let stopCount = 0;
    let starts = 0;
    let health: Record<string, unknown> = activeRunHealth();
    const children: Array<EventEmitter & { exitCode: number | null }> = [];
    const supervisor = new HermesSupervisor({
      environment: { AI_BASE_URL: "https://provider.example/v1", AI_MODEL: "test-model" },
      careerSyncPollIntervalMs: 0,
      startupSyncTimeoutMs: 10,
      startCompanion: async () => {
        starts += 1;
        const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
        children.push(child);
        return { ok: true, owned: true, child, runtime: { baseUrl: "http://127.0.0.1:18642" } };
      },
      stopCompanion: async () => { stopCount += 1; },
      fetchImpl: async () => ({ ok: true, json: async () => health })
    });
    supervisors.push(supervisor);

    await supervisor.rendererHostReady();
    await supervisor.rendererHostReady();
    await supervisor.ensureStarted();
    await supervisor.recover();

    expect(starts).toBe(1);
    expect(stopCount).toBe(0);
    expect(children[0]?.exitCode).toBeNull();
    expect(supervisor.getStatus().activeRunId).toBe("run-active");

    health = {
      ...activeRunHealth(),
      activeRunId: undefined,
      hermesRunId: undefined,
      runtimeHealth: { ...(activeRunHealth().runtimeHealth as Record<string, unknown>), activeRunId: undefined, hermesRunId: undefined }
    };
    supervisor.applyHealth(health);
    expect(supervisor.getStatus().activeRunId).toBeUndefined();
  });

  it("carries a structured stop reason to the remote run stop request", async () => {
    const stopRun = vi.fn(async (runId: string) => ({ run_id: runId, status: "stopping" as const }));
    const transport = runsTransport({ stopRun });
    const runtime = new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() });
    const iterator = runtime.runTurn({
      sessionId: "career-session",
      turnId: "logical-turn",
      userMessage: "继续当前任务",
      pageContext: { query: {} }
    })[Symbol.asyncIterator]();

    await iterator.next();
    const reason = createRunStopReason({
      requestedBy: "user",
      reasonCode: "user_interrupt",
      sourceComponent: "incident-trace-test",
      sessionId: "career-session",
      logicalTurnId: "logical-turn",
      runId: "run-active",
      incidentTraceId: "incident-test-1"
    });
    await runtime.interrupt("career-session", reason);
    await iterator.return?.();

    expect(stopRun).toHaveBeenCalledWith("run-active", undefined, expect.objectContaining({
      incidentTraceId: "incident-test-1",
      stopReason: reason
    }));
  });

  it("records bridge request trace identity and completion", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        action: "run_start",
        incidentTraceId: "incident-test-2"
      });
      return new Response(JSON.stringify({ ok: true, data: { runId: "run-traced", status: "started" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const transport = new HttpHermesBridgeTransport("/hermes");
    await transport.startRun!({
      sessionId: "career-session",
      turnId: "logical-turn",
      userMessage: "继续",
      pageContext: { query: {} },
      toolContracts: [],
      incidentTraceId: "incident-test-2",
      logicalTurnId: "logical-turn"
    });

    expect(transport.getDiagnostics().bridgeRequestTraces).toEqual([
      expect.objectContaining({
        action: "run_start",
        traceId: "incident-test-2",
        runId: "run-traced",
        completedAt: expect.any(String),
        latencyMs: expect.any(Number)
      })
    ]);
  });

  it("keeps the first failure-time supervisor snapshot immutable after recovery", () => {
    const store = new RuntimeStatusStore({
      preferredRuntime: "hermes",
      activeRuntime: "hermes",
      status: "starting"
    });
    const ready = supervisorSnapshot("ready", true, "run-before-failure");
    const degraded = supervisorSnapshot("degraded", false, "run-before-failure");
    const recovered = supervisorSnapshot("ready", true, undefined);
    store.recordSupervisorStatus(ready);
    store.recordSupervisorStatus(degraded);
    store.recordRunFailure({
      code: "hermes_run_cancelled_upstream",
      message: "upstream cancellation",
      hermesRunId: "run-before-failure",
      retryable: true
    });
    const failureSnapshot = store.getSnapshot().runtimeFailureSnapshot;
    const failureSupervisor = store.getSnapshot().failureTimeSupervisorSnapshot;
    store.recordSupervisorStatus(recovered);

    expect(store.getSnapshot().runtimeFailureSnapshot).toEqual(failureSnapshot);
    expect(store.getSnapshot().failureTimeSupervisorSnapshot).toEqual(failureSupervisor);
    expect(store.getSnapshot().runtimeFailureSnapshot?.supervisor.activeRunId).toBe("run-before-failure");
  });

  it("captures runReady=false in the Supervisor failure-time snapshot", async () => {
    let health: Record<string, unknown> = activeRunHealth();
    const supervisor = new HermesSupervisor({
      environment: { AI_BASE_URL: "https://provider.example/v1", AI_MODEL: "test-model" },
      careerSyncPollIntervalMs: 0,
      startupSyncTimeoutMs: 10,
      startCompanion: async () => {
        const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
        return { ok: true, owned: true, child, runtime: { baseUrl: "http://127.0.0.1:18642" } };
      },
      stopCompanion: async () => undefined,
      fetchImpl: async () => ({ ok: true, json: async () => health })
    });
    supervisors.push(supervisor);

    await supervisor.rendererHostReady();
    health = {
      ...activeRunHealth(),
      runtimeHealth: {
        ...(activeRunHealth().runtimeHealth as Record<string, unknown>),
        runReady: false
      }
    };
    supervisor.applyHealth(health);
    const failure = supervisor.getStatus().failureTimeSnapshot;

    health = activeRunHealth();
    supervisor.applyHealth(health);

    expect(failure).toMatchObject({ runReady: false });
    expect(supervisor.getStatus().failureTimeSnapshot).toEqual(failure);
    expect(supervisor.getStatus().runReady).toBe(true);
  });

  it("exposes the abort reason through the session execution controller", () => {
    const coordinator = new AgentExecutionCoordinator();
    const execution = coordinator.begin({ sessionId: "session", activeTurnId: "turn" });
    const abort = { abortSource: "runtime_restart", abortReason: "runtime_restart" };
    coordinator.interrupt("session", abort);
    expect(execution.controller.signal.aborted).toBe(true);
    expect(execution.controller.signal.reason).toEqual(abort);
  });
});

function emptyGateway() {
  return new CareerToolGateway(new AgentToolRegistry([]));
}

function runsTransport(overrides: Partial<HermesBridgeTransport> = {}): HermesBridgeTransport {
  return {
    health: async () => ({ available: true, mcpConnected: true }),
    createSession: async ({ sessionId }) => ({ sessionId, resumed: false }),
    resumeSession: async ({ sessionId }) => ({ sessionId, resumed: true }),
    turn: async function* () {},
    toolCallback: async () => undefined,
    interrupt: async () => undefined,
    startRun: async () => ({ runId: "run-active", status: "started" }),
    getRun: async (runId) => ({ run_id: runId, status: "running" }),
    runEvents: async function* () {},
    approveRun: async (runId) => ({ run_id: runId, status: "running" }),
    stopRun: async (runId) => ({ run_id: runId, status: "completed" }),
    ...overrides
  };
}

function supervisorSnapshot(
  overallState: HermesSupervisorSnapshot["overallState"],
  runReady: boolean,
  activeRunId?: string
): HermesSupervisorSnapshot {
  return {
    overallState,
    processReady: true,
    apiReady: true,
    providerReady: true,
    careerMcpReady: true,
    toolSurfaceReady: true,
    runReady,
    careerSkillsReady: true,
    reasonCode: runReady ? "ready" : "hermes_run_not_ready",
    updatedAt: new Date().toISOString(),
    activeRunId,
    restartAttempt: 0,
    uptimeMs: 100,
    careerDomainToolCount: 56,
    hermesCareerToolCount: 15,
    requiredCareerFacadesReady: 8,
    requiredCareerFacadesTotal: 8,
    latestLifecycleEntries: []
  };
}

function activeRunHealth(): Record<string, unknown> {
  return {
    available: true,
    providerStatus: "ready",
    model: "test-model",
    activeRunId: "run-active",
    runtimeHealth: {
      runtimeAvailable: true,
      companionReady: true,
      providerConfigured: true,
      providerReachable: true,
      providerReady: true,
      mcpConnected: true,
      browserCareerDomainHostConnected: true,
      careerMcpServerReachable: true,
      hermesMcpRegistered: true,
      hermesMcpToolCount: 15,
      careerSkillsLoaded: true,
      requiredCareerFacadesMissing: [],
      runReady: true,
      activeRunId: "run-active"
    }
  };
}
