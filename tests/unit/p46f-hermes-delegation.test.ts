import { describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { RuntimeStatusStore } from "@/agent/runtime/runtimeStatus";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import {
  mapOfficialHermesEvent,
  type HermesBridgeTransport,
  type HermesRunStatus
} from "@/agent/runtime/hermes/HermesBridgeTransport";
import {
  classifyHermesRunFailure,
  type HermesSafeErrorCategory
} from "@/agent/runtime/hermes/hermesRunReliability";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";

describe("P4.6f Hermes delegation architecture", () => {
  it("creates a plain conversation session without workflow or fake task state", () => {
    const session = AgentRuntime.createConversationSession();

    expect(session.workflowState).toBeUndefined();
    expect(session.taskState).toBeUndefined();
    expect(session.activeTurn).toBeUndefined();
  });

  it("keeps a normal conversation shell free of workflow checkpoints", async () => {
    const saves: unknown[] = [];
    const host = new AgentHostStore({
      executor: {} as never,
      persistence: { save: async (session: unknown) => { saves.push(session); return session as never; } } as never
    });

    const result = await host.beginRuntimeShell({
      session: AgentRuntime.createConversationSession(),
      userMessage: "你好",
      runtimeId: "hermes"
    });
    const persisted = saves.at(-1) as Record<string, unknown>;
    const messages = persisted.messages as Array<Record<string, unknown>>;

    expect(result.session.workflowState).toBeUndefined();
    expect(persisted.taskState).toBeUndefined();
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]).toMatchObject({ content: "正在回复…", streaming: true });
  });

  it("keeps a completed greeting free of workflow state and task routing", async () => {
    const saves: unknown[] = [];
    const host = new AgentHostStore({
      executor: {} as never,
      persistence: { save: async (session: unknown) => { saves.push(session); return session as never; } } as never
    });
    const session = AgentRuntime.createConversationSession();
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: "你好",
      runtimeId: "hermes",
      turnId: "greeting-turn"
    });
    await host.applyRuntimeEvent({
      type: "text_delta",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      delta: "你好，我是职适AI。"
    }, shell.assistantMessageId);
    await host.applyRuntimeEvent({
      type: "turn_completed",
      sessionId: session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      message: "你好，我是职适AI。"
    }, shell.assistantMessageId);

    const persisted = saves.at(-1) as AgentSession;
    expect(persisted.workflowState).toBeUndefined();
    expect(persisted.taskState).toBeUndefined();
    expect(persisted.turnCheckpoints).toEqual([]);
    expect(persisted.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(persisted.messages.at(-1)).toMatchObject({ content: "你好，我是职适AI。", status: "complete" });
    expect(JSON.stringify(persisted)).not.toContain("agent_quick_action");
    expect(JSON.stringify(persisted)).not.toContain("collecting_intent");
  });

  it("uses one official run and never enters the legacy tool callback loop", async () => {
    const starts: Array<Record<string, unknown>> = [];
    let legacyTurns = 0;
    let callbacks = 0;
    const transport = runsTransport({
      startRun: async (input) => {
        starts.push(input as unknown as Record<string, unknown>);
        return { runId: "run-one", status: "started" as const };
      },
      turn: async function* () {
        legacyTurns += 1;
      },
      toolCallback: async () => {
        callbacks += 1;
      },
      runEvents: async function* () {
        yield { type: "text_delta", delta: "你好，我可以帮你处理职业资料。" } as const;
        yield { type: "turn_completed", message: "你好，我可以帮你处理职业资料。" } as const;
      }
    });
    const events = await collect(new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }).runTurn({
      sessionId: "session-one",
      turnId: "turn-one",
      userMessage: "你好",
      pageContext: { query: {} }
    }));

    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({ userMessage: "你好", toolContracts: [] });
    expect(legacyTurns).toBe(0);
    expect(callbacks).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["progress", "text_delta", "turn_completed"]);
    expect(events.at(-1)?.data).toMatchObject({ runId: "run-one", telemetry: { toolCalls: 0 } });
  });

  it("reads one authoritative terminal status after run.failed and exposes only safe diagnostics", async () => {
    let statusReads = 0;
    const transport = runsTransport({
      runEvents: async function* () {
        yield {
          type: "turn_failed",
          code: "hermes_run_failed",
          message: "HTTP 401: Missing Authentication header",
          recoverable: false
        } as const;
      },
      getRun: async (runId) => {
        statusReads += 1;
        return {
          run_id: runId,
          status: "failed" as const,
          provider: "openrouter",
          model: "z-ai/glm-5.3-flash",
          last_event: "run.failed",
          error: { message: "HTTP 401: Missing Authentication header", httpStatus: 401 }
        };
      }
    });
    const events = await collect(new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }).runTurn({
      sessionId: "session-failure",
      turnId: "turn-failure",
      userMessage: "不要把这段输入写入诊断",
      pageContext: { query: {} }
    }));
    const failed = events.at(-1);
    const diagnostics = failed?.data && typeof failed.data === "object"
      ? (failed.data as { diagnostics?: Record<string, unknown> }).diagnostics
      : undefined;

    expect(statusReads).toBe(1);
    expect(failed).toMatchObject({
      type: "turn_failed",
      error: { code: "hermes_provider_auth_failed" },
      data: { terminalStatus: "failed", provider: "openrouter", model: "z-ai/glm-5.3-flash" }
    });
    expect(diagnostics).toMatchObject({
      safeErrorCategory: "provider_auth",
      httpStatus: 401,
      provider: "openrouter",
      model: "z-ai/glm-5.3-flash",
      lastHermesEventType: "run.failed"
    });
    expect(JSON.stringify(failed)).not.toContain("不要把这段输入写入诊断");
  });

  it("reattaches the same run once after a disconnected stream without semantic retry", async () => {
    const streams: string[] = [];
    let starts = 0;
    let statusReads = 0;
    const transport = runsTransport({
      startRun: async () => {
        starts += 1;
        return { runId: "run-reattach", status: "started" as const };
      },
      runEvents: async function* (runId) {
        streams.push(runId);
        if (streams.length === 1) return;
        yield { type: "turn_completed", message: "同一回答已完成" } as const;
      },
      getRun: async (runId) => {
        statusReads += 1;
        return { run_id: runId, status: "running" as const };
      }
    });
    const events = await collect(new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }).runTurn({
      sessionId: "session-reattach",
      turnId: "turn-reattach",
      userMessage: "继续",
      pageContext: { query: {} }
    }));

    expect(starts).toBe(1);
    expect(statusReads).toBe(1);
    expect(streams).toEqual(["run-reattach", "run-reattach"]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-reattach" } } });
    expect(events.some((event) => event.type === "turn_failed")).toBe(false);
  });

  it("does not fall back to Native after a Hermes failure", async () => {
    const nativeRuns = vi.fn();
    const native = {
      id: "native",
      runTurn: async function* () {
        nativeRuns();
        yield { type: "turn_completed", sessionId: "session-router", turnId: "turn-router", timestamp: new Date().toISOString() } as never;
      },
      pause: async () => undefined,
      interrupt: async () => undefined,
      resume: async () => undefined,
      capabilities: () => ({}) as never
    } as never;
    const router = new AgentRuntimeRouter({
      native,
      hermes: new HermesCareerAgentRuntime({
        transport: runsTransport({
          startRun: async () => { throw Object.assign(new Error("HTTP 401: Missing Authentication header"), { code: "auth_failed", httpStatus: 401 }); }
        }),
        careerToolGateway: emptyGateway()
      }),
      configuration: { agentRuntime: "hermes" }
    });
    const events = await collect(router.active().runTurn({
      sessionId: "session-router",
      turnId: "turn-router",
      userMessage: "你好",
      pageContext: { query: {} }
    }));

    expect(nativeRuns).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "turn_failed", error: { code: "hermes_provider_auth_failed" } });
  });

  it("keeps global Agent Ready while recording the failed run", () => {
    const status = new RuntimeStatusStore({
      preferredRuntime: "hermes",
      activeRuntime: "hermes",
      status: "ready",
      runReady: true,
      processReady: true,
      apiReady: true,
      providerReady: true,
      careerMcpReady: true,
      toolSurfaceReady: true
    });

    status.recordRunFailure({
      code: "hermes_provider_auth_failed",
      message: "HTTP 401: Missing Authentication header",
      httpStatus: 401,
      hermesRunId: "run-failed",
      runPhase: "after_run_start",
      retryable: false
    });

    expect(status.getSnapshot()).toMatchObject({
      status: "ready",
      runReady: true,
      runtimeFailureSnapshot: { run: { runId: "run-failed", status: "failed" } }
    });
  });

  it("maps official Hermes failure events into the bounded category vocabulary", () => {
    const categories: Array<[string, number | undefined, HermesSafeErrorCategory]> = [
      ["HTTP 401: Missing Authentication header", 401, "provider_auth"],
      ["invalid request parameter", 400, "provider_request_invalid"],
      ["model not found", 404, "model_not_found"],
      ["tool schema invalid", 422, "tool_schema_invalid"],
      ["maximum context length exceeded", 400, "context_overflow"],
      ["provider timed out", 504, "provider_timeout"],
      ["MCP tool execution failed", 500, "mcp_tool_failure"],
      ["Hermes internal server error", 500, "hermes_internal_failure"],
      ["bridge network disconnected", undefined, "transport_failure"]
    ];

    for (const [message, httpStatus, category] of categories) {
      expect(classifyHermesRunFailure({ message, httpStatus, code: "hermes_run_failed" }).safeErrorCategory).toBe(category);
    }

    expect(classifyHermesRunFailure({
      code: "gateway_auth_failed",
      message: "Invalid gateway API key",
      httpStatus: 401,
      failureLayer: "control_plane"
    })).toMatchObject({
      safeErrorCategory: "runtime_control_auth",
      safeErrorCode: "hermes_runtime_control_auth_failed",
      failureLayer: "control_plane",
      retryable: false
    });

    expect(classifyHermesRunFailure({
      code: "provider_auth",
      message: "Provider rejected the configured credential.",
      httpStatus: 401,
      failureLayer: "provider"
    })).toMatchObject({
      safeErrorCategory: "provider_auth",
      safeErrorCode: "hermes_provider_auth_failed",
      failureLayer: "provider"
    });

    expect(classifyHermesRunFailure({ code: "mcp_connection_failed", message: "MCP connection refused", failureLayer: "mcp" }))
      .toMatchObject({ safeErrorCategory: "mcp_connection", safeErrorCode: "hermes_mcp_connection_failed", failureLayer: "mcp" });
    expect(classifyHermesRunFailure({ code: "model_error", message: "Model error", failureLayer: "provider" }))
      .toMatchObject({ safeErrorCategory: "model_error", safeErrorCode: "hermes_model_error", failureLayer: "provider" });
    expect(classifyHermesRunFailure({ code: "runtime_internal", message: "Runtime internal failure", failureLayer: "bridge_http" }))
      .toMatchObject({ safeErrorCategory: "runtime_internal", safeErrorCode: "hermes_runtime_internal", failureLayer: "bridge_http" });

    expect(mapOfficialHermesEvent("run.failed", {
      code: "provider_auth",
      error: { message: "HTTP 401: Missing Authentication header", http_status: 401 },
      prompt: "secret prompt must not cross the event boundary"
    })).toMatchObject({
      type: "turn_failed",
      code: "hermes_provider_auth_failed",
      data: { diagnostics: { safeErrorCategory: "provider_auth", httpStatus: 401 } }
    });
  });
});

async function collect<T extends { type: string }>(events: AsyncIterable<T>) {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

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
    startRun: async () => ({ runId: "run-default", status: "started" as const }),
    getRun: async (runId): Promise<HermesRunStatus> => ({ run_id: runId, status: "completed", output: "完成" }),
    runEvents: async function* () { yield { type: "turn_completed", message: "完成" } as const; },
    approveRun: async (runId) => ({ run_id: runId, status: "running" as const }),
    stopRun: async (runId) => ({ run_id: runId, status: "stopping" as const }),
    ...overrides
  };
}
