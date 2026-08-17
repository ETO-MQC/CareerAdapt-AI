import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { AgentGoalCompletionGuard } from "@/agent/kernel/AgentGoalCompletionGuard";
import { evaluateGroundedResumeOutput } from "@/agent/kernel/GroundedResumeOutputGate";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { CareerToolGateway, type CareerToolResult } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { EventStreamLeaseConflictError, EventStreamLeaseRegistry } from "@/agent/runtime/hermes/hermesEventStreamLease";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { TransactionalWorkflowLeaseManager } from "@/agent/workflows/TransactionalWorkflowLease";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";

function atomicResult(toolName: string, data: unknown): CareerToolResult {
  return {
    ok: true,
    data,
    artifacts: [],
    receipt: {
      operationId: `atomic-${toolName.replace(/[^A-Za-z0-9-]/gu, "-")}`,
      toolName,
      status: "completed",
      completedAt: "2026-08-17T00:00:00.000Z"
    }
  };
}

describe("P4.5c.1.14 Career workflow transactional closure", () => {
  it("allows only one active Hermes event consumer and permits reattach after closure", () => {
    const registry = new EventStreamLeaseRegistry();
    const first = registry.acquire({
      runId: "run-closure-1",
      consumerId: "consumer-1",
      sessionId: "session-closure-1",
      logicalTurnId: "turn-closure-1"
    });
    registry.activate(first);

    expect(() => registry.acquire({
      runId: "run-closure-1",
      consumerId: "consumer-2",
      sessionId: "session-closure-1",
      logicalTurnId: "turn-closure-1"
    })).toThrow(EventStreamLeaseConflictError);

    registry.close(first);
    const reattached = registry.acquire({
      runId: "run-closure-1",
      consumerId: "consumer-2",
      sessionId: "session-closure-1",
      logicalTurnId: "turn-closure-1"
    });
    expect(reattached.state).toBe("opening");
    expect(reattached.runId).toBe("run-closure-1");
  });

  it("serializes one LogicalTurn/Task and reports a recoverable busy observation", async () => {
    const leases = new TransactionalWorkflowLeaseManager();
    const held = leases.acquire({
      workflowName: "career.workflow.tailor_resume",
      logicalTurnId: "turn-busy-1",
      taskId: "task-busy-1",
      operationId: "held-operation-1"
    });
    const gateway = new CareerToolGateway({
      registry: new AgentToolRegistry([]),
      transactionalWorkflowLeases: leases
    });
    const result = await gateway.execute("career.workflow.tailor_resume", {
      profileId: "profile-busy-1",
      targetText: AI_TRAINER_JD_V4
    }, {
      operationId: "blocked-operation-1",
      logicalTurnId: "turn-busy-1",
      taskId: "task-busy-1"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "career_workflow_in_progress", recoverable: true },
      diagnostics: {
        toolFailureLayer: "workflow_precondition",
        safeDomainErrorCode: "career_workflow_in_progress",
        logicalTurnId: "turn-busy-1",
        taskId: "task-busy-1",
        toolResultIsError: true
      }
    });
    leases.release(held);
    expect(leases.get("turn-busy-1", "task-busy-1")).toBeUndefined();
  });

  it("returns safe gateway diagnostics without exposing invalid target text", async () => {
    const rawTarget = "raw-target-text-must-not-enter-diagnostics";
    const result = await new CareerToolGateway(new AgentToolRegistry([])).execute("career.workflow.tailor_resume", {
      profileId: "profile-diagnostic-1",
      targetText: "too-short"
    }, {
      operationId: "diagnostic-operation-1",
      logicalToolOperationId: "logical-diagnostic-1",
      logicalTurnId: "turn-diagnostic-1",
      taskId: "task-diagnostic-1"
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "schema_validation_failed" },
      diagnostics: {
        toolFailureLayer: "gateway_validation",
        failureScope: "career_workflow",
        failedStage: "gateway_validation",
        operationId: "diagnostic-operation-1",
        logicalToolOperationId: "logical-diagnostic-1",
        logicalTurnId: "turn-diagnostic-1",
        taskId: "task-diagnostic-1",
        toolResultIsError: true
      }
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(rawTarget);
    expect(JSON.stringify(result.diagnostics)).not.toContain("too-short");
    expect(result.diagnostics?.durationMs).toEqual(expect.any(Number));
  });

  it("keeps direct external targetText on tailor semantics and out of compose", async () => {
    const analyzed = analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 });
    const calls: string[] = [];
    const result = await executeCareerWorkflowFacade(
      "career.workflow.tailor_resume",
      {
        profileId: "profile-target-1",
        sourceResumeId: "resume-general-1",
        targetText: AI_TRAINER_JD_V4
      },
      {
        availableCareerToolNames: new Set(["career.job.parse", "career.tailoring.create_session"])
      },
      "tailor-target-operation-1",
      async (toolName, input) => {
        calls.push(toolName);
        if (toolName === "career.job.parse") {
          return atomicResult(toolName, {
            graph: analyzed.graph,
            candidateTitle: "AI训练师",
            candidateCompany: "示例科技"
          });
        }
        if (toolName === "career.tailoring.create_session") {
          const value = input as { targetSnapshot?: unknown };
          return atomicResult(toolName, {
            session: {
              id: "tailoring-session-target-1",
              branch: { id: "resume-general-1" },
              targetSnapshot: value.targetSnapshot,
              plan: { questionPlan: { status: "completed" } }
            }
          });
        }
        throw new Error(`unexpected_atomic_tool:${toolName}`);
      }
    );

    expect(calls).toEqual(["career.job.parse", "career.tailoring.create_session"]);
    expect(result.data.status).toBe("waiting_for_user");
    expect(result.data.workflowCheckpoint).toMatchObject({
      targetSourceType: "pasted_jd",
      jobPersistenceDecision: "ask",
      resumeId: "resume-general-1"
    });
  });

  it("publishes the canonical target contract and keeps compose explicitly general/base", () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const tailor = gateway.getContract("career.workflow.tailor_resume");
    const compose = gateway.getContract("career.workflow.compose_resume");
    const properties = (tailor.inputSchema.properties ?? {}) as Record<string, unknown>;

    expect(properties).toHaveProperty("targetText");
    expect(properties).toHaveProperty("saveTargetPreference");
    expect(tailor.description).toContain("generate_job_specific_resume");
    expect(compose.description).toContain("general/base");
    expect(compose.description).toContain("tailor_resume");
  });

  it("requires authoritative result proof before a canonical job resume can complete", () => {
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("tailor_existing_resume", "quality_result");
    const incomplete = reducer.create(session, "generate_job_specific_resume");
    const blocked = new AgentGoalCompletionGuard().evaluate(AgentTaskStateSchema.parse({
      ...incomplete,
      stage: "quality_result",
      completionStatus: "completed"
    }));
    expect(blocked).toMatchObject({ canFinish: false, reason: "task_incomplete" });

    const complete = AgentTaskStateSchema.parse({
      ...incomplete,
      stage: "quality_result",
      completionStatus: "completed",
      selectedEntities: {
        profileId: "profile-proof-1",
        resumeId: "resume-source-1",
        sourceResumeId: "resume-source-1",
        targetSnapshotId: "snapshot-proof-1",
        targetSnapshotVersion: 1,
        targetSnapshotHash: "snapshot-hash-proof-1",
        resultResumeId: "resume-result-1",
        resultResumeRevisionId: "revision-result-1"
      },
      knownSlots: {
        fitAnalysis: { score: 80 },
        tailoringSession: { id: "tailoring-proof-1" },
        previewComplete: true,
        confirmationAccepted: true,
        qualityResult: {
          status: "passed",
          factGuard: "passed",
          revisionCreated: true,
          acceptedDiffCount: 1,
          acceptedDiffIds: ["diff-1"],
          changedFieldPaths: ["sections.experience.items.1.highlights"],
          beforeContentHash: "before-proof-hash",
          afterContentHash: "after-proof-hash",
          resultResumeId: "resume-result-1",
          resultResumeRevisionId: "revision-result-1",
          receipt: { status: "completed" }
        }
      }
    });
    expect(new AgentGoalCompletionGuard().evaluate(complete)).toEqual({ canFinish: true, reason: "goal_completed" });
  });

  it("uses the Fact Guard fallback instead of presenting an ungrounded composition", () => {
    const reducer = new AgentTaskStateReducer();
    const state = reducer.create(AgentRuntime.create("compose_resume", "review_composition"), "compose_resume");
    const decision = evaluateGroundedResumeOutput({
      taskState: state,
      text: "教育经历：某某大学计算机科学专业，毕业时间和学历信息尚未确认。项目经历：智能招聘平台负责核心功能开发，具体职责与结果尚未经过资料库和用户核验。"
    });

    expect(decision).toMatchObject({ allowed: false, reasonCode: "resume_output_without_grounding" });
    if (!decision.allowed) expect(decision.recoveryText).toContain("不会把未确认内容显示为简历");
  });

  it("projects MCP tool failures with a scope-specific diagnostic", async () => {
    const adapter = new CareerAdaptMcpAdapter(new CareerToolGateway(new AgentToolRegistry([])));
    const rawTarget = "raw-target-value-that-stays-out-of-diagnostics";
    const result = await adapter.callTool("career.workflow.tailor_resume", {
      profileId: "profile-mcp-1",
      targetText: rawTarget.slice(0, 10)
    }, { operationId: "mcp-diagnostic-operation-1", logicalTurnId: "turn-mcp-1", taskId: "task-mcp-1" });
    const payload = result.structuredContent as Record<string, unknown>;
    const diagnostics = payload.diagnostics as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(diagnostics).toMatchObject({
      toolFailureLayer: "gateway_validation",
      safeDomainErrorCode: "schema_validation_failed",
      logicalTurnId: "turn-mcp-1",
      taskId: "task-mcp-1"
    });
    expect(JSON.stringify(diagnostics)).not.toContain(rawTarget);
  });

  it("narrates MCP transport failure separately from Hermes startup failure", async () => {
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save: async (session: unknown) => session as never } as never
    });
    const shell = await host.beginRuntimeShell({
      session: AgentRuntime.create("conversation", "collecting_intent"),
      userMessage: "继续当前任务",
      runtimeId: "hermes"
    });
    await host.applyRuntimeEvent({
      type: "turn_failed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      error: { code: "mcp_bridge_timeout", message: "bridge timeout", recoverable: true },
      data: {
        diagnostics: {
          toolFailureLayer: "mcp_transport",
          safeDomainErrorCode: "mcp_bridge_timeout",
          toolResultIsError: true
        }
      }
    }, shell.assistantMessageId);
    const assistant = host.getSnapshot().activeSession?.messages.find((message) => message.id === shell.assistantMessageId);

    expect(assistant?.content).toContain("CareerAdapt MCP");
    expect(assistant?.content).not.toContain("Hermes 暂时无法启动");
  });

  it("normalizes contradictory official tool completion payloads as failures", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          'event: tool.completed\ndata: {"tool_name":"career.workflow.tailor_resume","tool_call_id":"tool-closure-1","operation_id":"operation-closure-1","status":"completed","result":{"ok":false,"error":{"code":"fact_guard_failed","message":"事实核验失败","recoverable":false}}}\n\n'
        ));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })));
    try {
      const events = [];
      for await (const event of new HttpHermesBridgeTransport("/hermes").runEvents!("run-closure-official")) events.push(event);
      const first = events[0];
      expect(first).toMatchObject({
        type: "tool_call_failed",
        code: "fact_guard_failed",
      });
      const firstData = first && "data" in first ? first.data : undefined;
      expect(firstData).toMatchObject({
        toolFailureLayer: "hermes_tool_protocol",
        safeDomainErrorCode: "fact_guard_failed",
        toolResultIsError: true
      });
      expect(JSON.stringify(firstData)).not.toContain("事实核验失败");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
