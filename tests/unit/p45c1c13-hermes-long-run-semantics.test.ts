import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { HttpHermesBridgeTransport, type HermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { classifyHermesRunFailure, createHermesRunFailure } from "@/agent/runtime/hermes/hermesRunReliability";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";

afterEach(() => {
  vi.useRealTimers();
});

describe("P4.5c.1.13 Hermes long-run semantics and non-destructive recovery", () => {
  it("reattaches a live run after a pre-event failure without stopping or starting another run", async () => {
    let starts = 0;
    let stops = 0;
    let statusChecks = 0;
    const observedRunIds: string[] = [];
    const transport = runsTransport({
      startRun: async () => {
        starts += 1;
        throw createHermesRunFailure({ code: "hermes_run_start_failed", httpStatus: 503, message: "temporary" });
      },
      getRun: async (runId) => {
        statusChecks += 1;
        return { run_id: runId, status: statusChecks === 1 ? "completed" as const : "running" as const };
      },
      runEvents: async function* (runId) {
        observedRunIds.push(runId);
        yield { type: "turn_completed", message: "已恢复" } as const;
      },
      stopRun: async (runId) => {
        stops += 1;
        return { run_id: runId, status: "stopping" as const };
      }
    });
    const session = persistedSession("run-live", "running", true);
    const router = new AgentRuntimeRouter({
      native: nativeRuntime(),
      hermes: new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }),
      configuration: { agentRuntime: "hermes" }
    });
    const events = [];
    for await (const event of router.active().runTurn({
      sessionId: session.id,
      turnId: "turn-live",
      userMessage: "长岗位描述",
      pageContext: { query: {} },
      session
    })) events.push(event);

    expect(starts).toBe(1);
    expect(stops).toBe(0);
    expect(observedRunIds).toEqual(["run-live"]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-live" } } });
  });

  it("retries a terminal run with one new POST and a new run id, never reading old run events", async () => {
    let starts = 0;
    const startMessages: string[] = [];
    const observedRunIds: string[] = [];
    const transport = runsTransport({
      startRun: async (input) => {
        starts += 1;
        startMessages.push(input.userMessage);
        if (starts === 1) throw createHermesRunFailure({ code: "hermes_run_start_failed", httpStatus: 503, message: "temporary" });
        return { runId: "run-B", status: "started" as const };
      },
      getRun: async (runId) => ({ run_id: runId, status: "completed" as const }),
      runEvents: async function* (runId) {
        observedRunIds.push(runId);
        yield { type: "turn_completed", message: "重试完成" } as const;
      }
    });
    const session = persistedSession("run-A", "completed", false);
    const router = new AgentRuntimeRouter({
      native: nativeRuntime(),
      hermes: new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }),
      configuration: { agentRuntime: "hermes" }
    });
    const events = [];
    for await (const event of router.active().runTurn({
      sessionId: session.id,
      turnId: "turn-retry",
      userMessage: "长岗位描述",
      pageContext: { query: {} },
      session
    })) events.push(event);

    expect(starts).toBe(2);
    expect(startMessages).toEqual(["长岗位描述", "长岗位描述"]);
    expect(observedRunIds).toEqual(["run-B"]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-B" } } });
  });

  it("checks a disconnected event stream and reattaches the same run", async () => {
    let eventStreams = 0;
    let statuses = 0;
    const transport = runsTransport({
      getRun: async (runId) => {
        statuses += 1;
        return { run_id: runId, status: "running" as const };
      },
      runEvents: async function* () {
        eventStreams += 1;
        if (eventStreams === 1) throw new Error("observer_disconnected");
        yield { type: "turn_completed", message: "连接恢复" } as const;
      }
    });
    const events = [];
    for await (const event of runtime(transport).runTurn({
      sessionId: "session-disconnect",
      turnId: "turn-disconnect",
      userMessage: "继续",
      pageContext: { query: {} }
    })) events.push(event);

    expect(statuses).toBe(1);
    expect(eventStreams).toBe(2);
    expect(events.some((event) => event.type === "progress" && event.data && typeof event.data === "object" && "watchdog" in event.data)).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-default" } } });
  });

  it("does not stop or fail a running run after 90 seconds of observer silence", async () => {
    vi.useFakeTimers();
    let starts = 0;
    let stops = 0;
    let eventStreams = 0;
    const transport = runsTransport({
      startRun: async () => {
        starts += 1;
        return { runId: "run-silent", status: "started" as const };
      },
      getRun: async (runId) => ({ run_id: runId, status: "running" as const }),
      runEvents: async function* (_runId, signal) {
        eventStreams += 1;
        if (eventStreams === 1) {
          yield { type: "tool_call_started", toolCallId: "tool-1", toolName: "career.workflow.tailor_resume", operationId: "operation-1" } as const;
        }
        if (eventStreams === 3) {
          yield { type: "turn_completed", message: "静默后完成" } as const;
          return;
        }
        await waitForAbort(signal);
      },
      stopRun: async (runId) => {
        stops += 1;
        return { run_id: runId, status: "stopping" as const };
      }
    });
    const iterator = runtime(transport, {
      observerHeartbeatMs: 45_000,
      statusPollMs: 1,
      hardDeadlineMs: 180_000
    }).runTurn({
      sessionId: "session-silent",
      turnId: "turn-silent",
      userMessage: "分析长岗位描述",
      pageContext: { query: {} }
    })[Symbol.asyncIterator]();

    await iterator.next();
    const toolStarted = await iterator.next();
    expect(toolStarted.value).toMatchObject({ type: "tool_call_started", toolName: "career.workflow.tailor_resume" });
    const firstReconnect = iterator.next();
    await vi.advanceTimersByTimeAsync(45_000);
    const firstProgress = await firstReconnect;
    expect(firstProgress.value).toMatchObject({ type: "progress", data: { watchdog: { action: "reattach_events", runId: "run-silent" } } });

    const secondReconnect = iterator.next();
    await vi.advanceTimersByTimeAsync(45_000);
    const secondProgress = await secondReconnect;
    expect(secondProgress.value).toMatchObject({ type: "progress", data: { watchdog: { action: "reattach_events", runId: "run-silent" } } });

    const completed = await iterator.next();
    expect(completed.value).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-silent" } } });
    expect(starts).toBe(1);
    expect(stops).toBe(0);
    expect(eventStreams).toBe(3);
  });

  it("keeps post-start and run-status errors in their correct phase", () => {
    expect(classifyHermesRunFailure({
      code: "hermes_unavailable_before_turn",
      runPhase: "after_run_start"
    }).safeErrorCode).toBe("hermes_run_failed_after_start");
    expect(classifyHermesRunFailure({
      code: "hermes_run_status_failed",
      httpStatus: 404,
      message: "run id not found",
      runPhase: "after_run_start"
    }).safeErrorCode).toBe("hermes_run_status_failed");
  });

  it("never emits hermes_unavailable_before_turn after run_start has succeeded", async () => {
    const transport = runsTransport({
      runEvents: async function* () {
        yield { type: "turn_failed", code: "hermes_unavailable_before_turn", message: "late health failure", recoverable: true } as const;
      }
    });
    const events = [];
    for await (const event of runtime(transport).runTurn({
      sessionId: "session-post-start",
      turnId: "turn-post-start",
      userMessage: "继续",
      pageContext: { query: {} }
    })) events.push(event);
    expect(events.find((event) => event.type === "turn_failed")?.error?.code).toBe("hermes_run_failed_after_start");
  });

  it("records one attempt per successful run_start and preserves primary plus secondary recovery data", async () => {
    const saved: unknown[] = [];
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async (session: unknown) => { saved.push(session); return session as never; } } as never
    });
    const shell = await host.beginRuntimeShell({
      session: AgentRuntime.create("conversation", "collecting_intent"),
      userMessage: "长岗位描述",
      runtimeId: "hermes"
    });
    const now = new Date().toISOString();
    const runHandle = {
      runId: "run-A",
      hermesSessionId: "hermes-session",
      careerAgentSessionId: shell.session.id,
      turnId: shell.turnId,
      status: "running" as const,
      startedAt: now,
      lastEventAt: now
    };
    await host.applyRuntimeEvent({
      type: "progress",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: now,
      data: {
        runHandle,
        traceId: "incident-attempt-1",
        attemptNumber: 1,
        runStartRequestedAt: now,
        runStartedAt: now,
        runStartStatus: "started",
        primaryCausalChain: [{ event: "run_start_succeeded", component: "HermesCareerAgentRuntime", at: now, runId: "run-A", attemptTraceId: "incident-attempt-1" }]
      }
    }, shell.assistantMessageId);
    const first = host.getSnapshot().activeSession?.activeTurn;
    expect(first?.runtimeAttempts).toHaveLength(1);
    expect(first?.runtimeAttempts?.[0]).toMatchObject({
      attemptNumber: 1,
      traceId: "incident-attempt-1",
      runId: "run-A",
      runStartStatus: "started",
      status: "running"
    });

    await host.applyRuntimeEvent({
      type: "turn_failed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      error: { code: "hermes_run_events_failed", message: "old stream missing", recoverable: true },
      data: {
        runHandle: { ...runHandle, status: "failed" },
        traceId: "incident-attempt-1",
        diagnostics: {
          retryable: true,
          primaryCausalChain: [{ event: "run_start_succeeded", component: "HermesCareerAgentRuntime", at: now, runId: "run-A", attemptTraceId: "incident-attempt-1" }],
          secondaryRecoveryFailures: [{ code: "hermes_run_status_failed", message: "404", operation: "run_status_reattach", capturedAt: now, runId: "run-A", attemptTraceId: "incident-attempt-1", httpStatus: 404 }]
        }
      }
    }, shell.assistantMessageId);
    const failed = host.getSnapshot().activeSession?.activeTurn;
    expect(failed?.runtimeAttempts).toHaveLength(1);
    expect(failed?.runtimeAttempts?.[0]).toMatchObject({ terminalStatus: "failed", runId: "run-A" });
    expect(failed?.secondaryRecoveryFailures).toHaveLength(1);
    expect(saved.length).toBeGreaterThan(0);
  });

  it("classifies an old run event 404 as a run-events failure, never as run-start unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    try {
      const iterator = new HttpHermesBridgeTransport("/hermes").runEvents!("run-old", undefined, { runId: "run-old" })[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        code: "hermes_run_events_failed",
        diagnostics: { safeErrorCode: "hermes_run_events_failed", httpStatus: 404 }
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the original failure primary when a reattach attempt receives an old-run 404", async () => {
    const oldRunFailure = () => createHermesRunFailure({
      code: "hermes_run_status_failed",
      httpStatus: 404,
      message: "run id not found"
    });
    const transport = runsTransport({
      getRun: async () => { throw oldRunFailure(); },
      runEvents: async function* () { throw oldRunFailure(); }
    });
    const session = persistedSession("run-old", "running", true);
    const events = [];
    for await (const event of runtime(transport).runTurn({
      sessionId: session.id,
      turnId: "turn-live",
      userMessage: "",
      pageContext: { query: {} },
      session,
      metadata: {
        reattachRunId: "run-old",
        runtimeRecoveryAttempted: true,
        runtimeRecoveryKind: "reattach",
        transportReattachAttempted: true,
        primaryFailureCode: "hermes_run_start_failed"
      }
    })) events.push(event);

    expect(events.at(-1)).toMatchObject({
      type: "turn_failed",
      error: { code: "hermes_run_start_failed" },
      data: { secondaryRecoveryFailures: [{ code: "hermes_run_status_failed", httpStatus: 404 }] }
    });
  });
});

function emptyGateway() {
  return new CareerToolGateway(new AgentToolRegistry([]));
}

function runtime(transport: HermesBridgeTransport, longRunPolicy?: { observerHeartbeatMs?: number; statusPollMs?: number; hardDeadlineMs?: number }) {
  return new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway(), longRunPolicy });
}

function nativeRuntime() {
  return {
    id: "native",
    runTurn: async function* () { yield { type: "turn_completed" } as never; },
    capabilities: () => ({})
  } as never;
}

function persistedSession(runId: string, status: "running" | "completed", withAssistant: boolean) {
  const session = AgentRuntime.create("tailor_existing_resume", "generate_plan");
  return {
    ...session,
    id: "session-hermes",
    personId: "person-hermes",
    activeProfileId: "profile-hermes",
    profileVersionNumber: 1,
    profileRevision: 1,
    hermesRun: {
      runId,
      hermesSessionId: "hermes-session",
      careerAgentSessionId: "session-hermes",
      turnId: withAssistant ? "turn-live" : "turn-retry",
      status,
      startedAt: "2026-08-09T01:00:00.000Z",
      lastEventAt: "2026-08-09T01:00:01.000Z"
    },
    messages: withAssistant ? [{
      id: "assistant-live",
      role: "assistant" as const,
      turnId: "turn-live",
      content: "正在处理…",
      createdAt: "2026-08-09T01:00:00.000Z"
    }] : []
  };
}

function runsTransport(overrides: Partial<HermesBridgeTransport> = {}): HermesBridgeTransport {
  return {
    health: async () => ({ available: true, mcpConnected: true }),
    createSession: async ({ sessionId }) => ({ sessionId, resumed: false }),
    resumeSession: async ({ sessionId }) => ({ sessionId, resumed: true }),
    turn: async function* () {},
    toolCallback: async () => undefined,
    interrupt: async () => undefined,
    startRun: async () => ({ runId: "run-default", status: "started" }),
    getRun: async (runId) => ({ run_id: runId, status: "completed", output: "完成" }),
    runEvents: async function* () { yield { type: "turn_completed", message: "完成" }; },
    approveRun: async (runId) => ({ run_id: runId, status: "running" }),
    stopRun: async (runId) => ({ run_id: runId, status: "stopping" }),
    ...overrides
  };
}

function waitForAbort(signal?: AbortSignal) {
  if (!signal || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}
