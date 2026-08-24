import { describe, expect, it, vi } from "vitest";
import { AgentSessionSchema, type AgentSession } from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { TurnController } from "@/agent/runtime/TurnController";
import {
  evaluateTailoringQuestionCompleteness,
  isTailoringQuestionPlanComplete
} from "@/services/jobs/tailoringService";
import { TailoringQuestionAnswerReceiptSchema, TailoringQuestionPlanSchema } from "@/domain/schemas";

const PAGE_CONTEXT = { pathname: "/ai-workspace", query: {} };

describe("P4.5 Codex-style agent interaction rebase", () => {
  it("treats terminal receipts as complete by question identity, not plan revision", () => {
    const questionPlan = TailoringQuestionPlanSchema.parse({
      id: "question-plan-p45c5",
      sessionId: "tailoring-session-p45c5",
      revision: 3,
      status: "asking",
      questionIds: ["q-1", "q-2", "q-3"],
      answeredQuestionIds: ["q-3"],
      skippedQuestionIds: ["q-2"],
      uncertainQuestionIds: ["q-1"],
      createdAt: "2026-08-22T00:00:00.000Z"
    });
    const answerReceipts = [
      { questionPlanId: questionPlan.id, questionPlanRevision: 1, questionId: "q-1", answerMessageId: "answer-1", disposition: "uncertain", consumedAt: "2026-08-22T00:00:01.000Z" },
      { questionPlanId: questionPlan.id, questionPlanRevision: 2, questionId: "q-2", answerMessageId: "answer-2", disposition: "skipped", consumedAt: "2026-08-22T00:00:02.000Z" },
      { questionPlanId: questionPlan.id, questionPlanRevision: 3, questionId: "q-3", answerMessageId: "answer-3", disposition: "answered", answerText: "真实经历", consumedAt: "2026-08-22T00:00:03.000Z" }
    ].map((receipt) => TailoringQuestionAnswerReceiptSchema.parse(receipt));

    expect(evaluateTailoringQuestionCompleteness({ questionPlan, answerReceipts })).toMatchObject({
      complete: true,
      resolvedQuestionIds: ["q-1", "q-2", "q-3"],
      missingQuestionIds: [],
      duplicateQuestionIds: []
    });
    expect(isTailoringQuestionPlanComplete({ questionPlan, answerReceipts })).toBe(true);
  });

  it("rejects a missing or duplicate terminal disposition", () => {
    const questionPlan = TailoringQuestionPlanSchema.parse({
      id: "question-plan-p45c5-invariant",
      sessionId: "tailoring-session-p45c5-invariant",
      revision: 3,
      status: "asking",
      questionIds: ["q-1", "q-2"],
      answeredQuestionIds: ["q-1"],
      skippedQuestionIds: [],
      uncertainQuestionIds: [],
      createdAt: "2026-08-22T00:00:00.000Z"
    });
    const receipt = (questionId: string, messageId: string) => TailoringQuestionAnswerReceiptSchema.parse({
      questionPlanId: questionPlan.id,
      questionPlanRevision: 1,
      questionId,
      answerMessageId: messageId,
      disposition: "answered",
      answerText: "有",
      consumedAt: "2026-08-22T00:00:01.000Z"
    });

    expect(evaluateTailoringQuestionCompleteness({
      questionPlan,
      answerReceipts: [receipt("q-1", "answer-1")]
    })).toMatchObject({ complete: false, missingQuestionIds: ["q-2"] });
    expect(evaluateTailoringQuestionCompleteness({
      questionPlan,
      answerReceipts: [receipt("q-1", "answer-1"), receipt("q-1", "answer-1-duplicate"), receipt("q-2", "answer-2")]
    })).toMatchObject({ complete: false, duplicateQuestionIds: ["q-1"] });
  });

  it("claims twenty rapid retry clicks as one pending-start operation and one turn", async () => {
    const base = simpleSession();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const runTurn = vi.fn(async (input: { session: AgentSession }) => {
      await gate;
      return completedResult(input.session.taskState);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });
    host.adopt(base);
    const operationId = `retry:${base.id}:retry-turn-p45c5`;
    const inputs = Array.from({ length: 20 }, () => host.startTurn({
      session: base,
      userMessage: "继续当前步骤",
      turnId: "retry-turn-p45c5",
      userMessageId: "retry-source-user-p45c5",
      appendUserMessage: false,
      pageContext: PAGE_CONTEXT,
      supersede: true,
      retryWorkflowStep: true,
      operationId,
      operationKind: "retry"
    }));

    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    expect(host.getTurnOperation(operationId)?.state).toBe("running");
    release();
    const results = await Promise.all(inputs);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(new Set(results.filter(Boolean).map((result) => result?.activeTurn?.id))).toEqual(new Set(["retry-turn-p45c5"]));
    expect(host.getTurnOperation(operationId)?.state).toBe("completed");
  });

  it("aborts a pending start before the network boundary and prevents a late run", async () => {
    const controller = new TurnController();
    const claim = controller.claim({
      sessionId: "session-p45c5-pause",
      operationId: "retry:session-p45c5-pause:turn-1",
      kind: "retry",
      turnId: "turn-1"
    });
    let runStarts = 0;
    const delayedStart = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (!claim.operation.controller.signal.aborted) runStarts += 1;
        resolve();
      }, 0);
    });
    controller.attachOperationPromise(claim.operation.operationId, delayedStart);
    controller.interrupt(claim.operation.sessionId, { reasonCode: "workflow_paused" });
    await delayedStart;
    expect(claim.operation.controller.signal.aborted).toBe(true);
    expect(runStarts).toBe(0);
    controller.finish(claim.operation.sessionId, "completed", undefined, claim.operation.operationId);
    expect(controller.getState(claim.operation.sessionId)).toBe("idle");
  });

  it("does not auto-start a queued retry after pause wins the cancel race", async () => {
    const base = simpleSession();
    const runTurn = vi.fn(async (input: { signal: AbortSignal; session: AgentSession }) => {
      await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
      return completedResult(input.session.taskState);
    });
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: { execute: vi.fn() } as never,
      persistence: { save: async (value: AgentSession) => value } as never
    });
    host.adopt(base);
    const first = host.startTurn({ session: base, userMessage: "原始任务", pageContext: PAGE_CONTEXT });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    const queuedRetry = host.startTurn({
      session: base,
      userMessage: "继续失败步骤",
      pageContext: PAGE_CONTEXT,
      supersede: true,
      operationId: `retry:${base.id}:pause-race`,
      operationKind: "retry",
      retryWorkflowStep: true
    });
    host.setPaused(true);
    host.interrupt(base.id);
    await Promise.all([first, queuedRetry]);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(host.getSnapshot().turnStatus).toBe("paused");
  });

  it("keeps regeneration single-flight on one branch operation", async () => {
    const controller = new TurnController();
    const operationId = "regenerate:session-p45c5:assistant-1";
    const claims = Array.from({ length: 20 }, () => controller.claim({
      sessionId: "session-p45c5",
      operationId,
      kind: "regenerate",
      turnId: "turn-1"
    }));
    expect(claims.filter((claim) => claim.accepted)).toHaveLength(1);
    expect(new Set(claims.map((claim) => claim.operation.operationId))).toEqual(new Set([operationId]));
    expect(new Set(claims.map((claim) => claim.operation.turnId))).toEqual(new Set(["turn-1"]));
  });

  it("does not erase a failed terminal operation during shared cleanup", () => {
    const controller = new TurnController();
    const claim = controller.claim({
      sessionId: "session-p45c5-failure",
      operationId: "turn:session-p45c5-failure:1",
      kind: "user_turn",
      turnId: "turn-failure"
    });
    controller.setOperationState(claim.operation.operationId, "failed");
    controller.finish(claim.operation.sessionId, undefined, undefined, claim.operation.operationId);
    expect(controller.getOperation(claim.operation.operationId)?.state).toBe("failed");
  });
});

function simpleSession() {
  const base = AgentRuntime.create("tailor_existing_resume", "analyze_fit", "P4.5 retry single-flight");
  return AgentSessionSchema.parse({
    ...base,
    taskState: {
      ...base.taskState,
      rootGoal: "create_tailored_resume",
      activeGoal: "analyze_fit",
      workflowId: "tailor_existing_resume",
      stage: "analyze_fit",
      selectedEntities: {
        profileId: "profile-p45c5",
        resumeId: "resume-p45c5",
        jobId: "job-p45c5"
      },
      completionStatus: "active",
      updatedAt: "2026-08-22T00:00:00.000Z"
    }
  });
}

function completedResult(taskState: AgentSession["taskState"]) {
  return {
    trajectory: {
      workflowId: taskState?.workflowId ?? "tailor_existing_resume",
      startedAt: "2026-08-22T00:00:00.000Z",
      completedAt: "2026-08-22T00:00:01.000Z",
      outcome: "completed" as const,
      toolCalls: [],
      artifacts: [],
      observations: []
    },
    taskState: taskState
      ? { ...taskState, completionStatus: "completed" as const, updatedAt: "2026-08-22T00:00:01.000Z" }
      : undefined
  };
}
