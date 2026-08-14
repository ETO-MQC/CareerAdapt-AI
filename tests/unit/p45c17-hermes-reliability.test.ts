import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { upsertAgentActivity } from "@/agent/runtime/AgentSessionMessages";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import type { HermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { hermesProductionToolNames, HermesCareerToolCatalog } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import { createHermesRunFailure } from "@/agent/runtime/hermes/hermesRunReliability";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";

describe("P4.5c.1.7 Hermes runtime reliability", () => {
  it("retries one transient run_start failure with the same logical turn and no Native persona", async () => {
    let starts = 0;
    const nativeRun = vi.fn(async function* () {
      yield { type: "turn_completed", sessionId: "session", turnId: "turn", timestamp: new Date().toISOString() } as never;
    });
    const transport = runsTransport({
      startRun: async (input) => {
        starts += 1;
        if (starts === 1) throw createHermesRunFailure({
          code: "hermes_run_start_failed",
          message: "upstream unavailable",
          httpStatus: 503,
          hermesSessionId: input.sessionId,
          requestedTurnId: input.turnId
        });
        return { runId: "run-recovered", status: "started" };
      },
      runEvents: async function* () {
        yield { type: "turn_completed", message: "完成" };
      }
    });
    const hermes = new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() });
    const router = new AgentRuntimeRouter({
      native: { id: "native", runTurn: nativeRun, capabilities: () => ({ streaming: true }) } as never,
      hermes,
      configuration: { agentRuntime: "hermes" }
    });
    const events = [];
    for await (const event of router.active().runTurn({
      sessionId: "session",
      turnId: "turn",
      userMessage: "继续",
      pageContext: { query: {} }
    })) events.push(event);

    expect(starts).toBe(2);
    expect(nativeRun).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", turnId: "turn" });
  });

  it("does not retry provider authentication failures and preserves safe diagnostics", async () => {
    let starts = 0;
    const transport = runsTransport({
      startRun: async () => {
        starts += 1;
        throw createHermesRunFailure({
          code: "hermes_run_start_failed",
          message: "provider rejected credentials",
          httpStatus: 401
        });
      }
    });
    const router = new AgentRuntimeRouter({
      native: { id: "native", runTurn: async function* () { yield { type: "turn_completed" } as never; }, capabilities: () => ({}) } as never,
      hermes: new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() }),
      configuration: { agentRuntime: "hermes" }
    });
    const events = [];
    for await (const event of router.active().runTurn({ sessionId: "session", turnId: "turn-auth", userMessage: "继续", pageContext: { query: {} } })) {
      events.push(event);
    }

    expect(starts).toBe(1);
    expect(events.at(-1)).toMatchObject({
      type: "turn_failed",
      error: { code: "hermes_provider_auth_failed", recoverable: false },
      data: { diagnostics: { safeErrorCode: "hermes_provider_auth_failed", httpStatus: 401 } }
    });
  });

  it("settles a known active remote run before starting a new user action", async () => {
    const getStatuses = ["running", "completed"];
    const getRun = vi.fn(async (runId: string) => ({ run_id: runId, status: (getStatuses.shift() ?? "completed") as "running" | "completed" }));
    const stopRun = vi.fn(async (runId: string) => ({ run_id: runId, status: "stopping" as const }));
    const startRun = vi.fn(async () => ({ runId: "new-run", status: "started" as const }));
    const transport = runsTransport({ getRun, stopRun, startRun });
    const runtime = new HermesCareerAgentRuntime({ transport, careerToolGateway: emptyGateway() });
    const session = {
      ...AgentRuntime.create("tailor_existing_resume", "generate_plan"),
      id: "session",
      personId: "person",
      activeProfileId: "profile",
      profileVersionNumber: 1,
      profileRevision: 1,
      hermesRun: {
        runId: "old-run",
        hermesSessionId: "hermes-session",
        careerAgentSessionId: "session",
        turnId: "old-turn",
        status: "running" as const,
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString()
      }
    };
    const events = [];
    for await (const event of runtime.runTurn({
      sessionId: "session",
      turnId: "new-turn",
      userMessage: "继续这个岗位任务",
      pageContext: { query: {} },
      session
    })) events.push(event);

    expect(getRun.mock.calls[0]?.[0]).toBe("old-run");
    expect(stopRun.mock.calls[0]?.[0]).toBe("old-run");
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(events[0]).toMatchObject({ type: "progress", data: { runHandle: { runId: "new-run" } } });
  });

  it("keeps the production model-facing profile to facades, status, and small reads", () => {
    const names = hermesProductionToolNames();
    const catalog = new HermesCareerToolCatalog([
      "career.workflow.tailor_resume",
      "career.system.runtime_status",
      "career.resume.list",
      "career.tailoring.answer_question",
      "career.resume.compose"
    ]);
    expect(names.has("career.workflow.tailor_resume")).toBe(true);
    expect(names.has("career.tailoring.answer_question")).toBe(false);
    expect(catalog.entries().filter((entry) => names.has(entry.stableName)).map((entry) => entry.stableName)).toEqual([
      "career.resume.list",
      "career.system.runtime_status",
      "career.workflow.tailor_resume"
    ]);
  });

  it("deduplicates MCP and Gateway lifecycle rows by logical tool operation", () => {
    const session = AgentRuntime.create("conversation", "idle");
    const started = upsertAgentActivity(session, {
      id: "agent-tool-mcp-call",
      turnId: "turn-activity",
      content: "正在调用 Career 工具…",
      toolName: "career.workflow.tailor_resume",
      operationId: "mcp-call",
      status: "pending",
      metadata: { logicalToolOperationId: "hermes-tool-call-1", transportOperationIds: ["mcp-call"] }
    });
    const completed = upsertAgentActivity(started, {
      id: "agent-tool-gateway-call",
      turnId: "turn-activity",
      content: "Career 工具执行完成。",
      toolName: "career.workflow.tailor_resume",
      operationId: "gateway-call",
      status: "complete",
      metadata: { logicalToolOperationId: "hermes-tool-call-1", transportOperationIds: ["gateway-call"] }
    });
    expect(completed.messages.filter((message) => message.role === "tool")).toHaveLength(1);
    expect(completed.messages.find((message) => message.role === "tool")?.metadata?.transportOperationIds).toEqual([
      "mcp-call",
      "gateway-call"
    ]);
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
    startRun: async () => ({ runId: "run-default", status: "started" }),
    getRun: async (runId) => ({ run_id: runId, status: "completed" }),
    runEvents: async function* () { yield { type: "turn_completed", message: "完成" }; },
    approveRun: async (runId) => ({ run_id: runId, status: "running" }),
    stopRun: async (runId) => ({ run_id: runId, status: "completed" }),
    ...overrides
  };
}
