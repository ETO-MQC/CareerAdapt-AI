import { describe, expect, it } from "vitest";
import { AgentSessionSchema } from "@/agent/contracts/agentSession";
import {
  AgentHostStore,
  attachTaskStateOptions,
  getActiveTailoringQuestionProjection
} from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";

const pageContext = { pathname: "/ai-workspace", query: {} };

describe("P4.5c.1 final tailoring question/answer loop", () => {
  it("replays Q1 skip as one atomic local transition and appends Q2", async () => {
    const session = projectedLoopSession();
    const before = session.messages.find((message) => message.metadata?.questionId === "q-1");
    expect(before).toBeDefined();

    const host = createHost();
    host.adopt(session);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: {
        type: "option_selected",
        action: { type: "answer", field: "tailoring-question:q-1", value: "跳过" }
      },
      pageContext
    });
    const afterQ1 = prepared.session.messages.find((message) => message.id === before?.id);
    const q2 = prepared.session.messages.find((message) => message.metadata?.questionId === "q-2");
    const answer = prepared.session.messages.find((message) => message.role === "user" && message.metadata?.answerPayload === true);
    const plan = prepared.session.taskState?.knownSlots.questionPlan as Record<string, unknown>;
    const receipts = prepared.session.taskState?.knownSlots.tailoringQuestionAnswerReceipts as Array<Record<string, unknown>>;

    expect(prepared.deterministicTerminal).toBe(true);
    expect(prepared.tailoringAnswerBinding).toBeUndefined();
    expect(prepared.session.hermesRun).toBeUndefined();
    expect(answer).toMatchObject({
      content: "跳过",
      metadata: {
        executionOwner: "deterministic_transition",
        optionField: "tailoring-question:q-1",
        optionValue: "跳过",
        executionState: "complete",
        tailoringAnswerReceipt: {
          questionPlanId: "question-plan-1",
          questionPlanRevision: 1,
          questionId: "q-1",
          disposition: "skipped"
        }
      }
    });
    expect(receipts).toEqual([expect.objectContaining({
      questionPlanId: "question-plan-1",
      questionPlanRevision: 1,
      questionId: "q-1",
      answerMessageId: answer?.id,
      disposition: "skipped"
    })]);
    expect(plan).toMatchObject({
      revision: 2,
      activeQuestionId: "q-2",
      answeredQuestionIds: [],
      skippedQuestionIds: ["q-1"],
      uncertainQuestionIds: []
    });
    expect(afterQ1).toMatchObject({
      id: before?.id,
      createdAt: before?.createdAt,
      turnId: before?.turnId,
      parentMessageId: before?.parentMessageId,
      options: expect.arrayContaining([
        expect.objectContaining({ disabled: true })
      ]),
      metadata: {
        questionId: "q-1",
        questionProjectionState: "resolved",
        tailoringAnswerDisposition: "skipped"
      }
    });
    expect(q2).toMatchObject({
      id: expect.not.stringMatching(String(before?.id)),
      metadata: {
        questionId: "q-2",
        questionPlanId: "question-plan-1",
        questionPlanRevision: 2,
        questionProjectionState: "active"
      },
      options: expect.arrayContaining([
        expect.objectContaining({ action: expect.objectContaining({ value: "跳过" }) })
      ])
    });
    expect(getActiveTailoringQuestionProjection(prepared.session)?.questionId).toBe("q-2");
  });

  it.each([
    ["不确定", "uncertain"],
    ["跳过", "skipped"],
    ["没有", "none"],
    ["我在 LearnKata 项目里使用过 pytest 做接口和回归测试。", "answered"]
  ] as const)("routes typed answer %s through the same receipt handler", async (answerText, disposition) => {
    const session = projectedLoopSession();
    const host = createHost();
    host.adopt(session);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: answerText },
      pageContext
    });
    const receipt = (prepared.session.taskState?.knownSlots.tailoringQuestionAnswerReceipts as Array<Record<string, unknown>>)?.[0];
    expect(prepared.deterministicTerminal).toBe(true);
    expect(receipt).toMatchObject({ questionId: "q-1", disposition, answerMessageId: expect.any(String) });
    expect((prepared.session.taskState?.knownSlots.questionPlan as Record<string, unknown>).activeQuestionId).toBe("q-2");
    expect(prepared.session.messages.filter((message) => message.metadata?.questionId === "q-1")).toHaveLength(1);
    expect(prepared.session.messages.filter((message) => message.metadata?.questionId === "q-2")).toHaveLength(1);
  });
});

function createHost() {
  return new AgentHostStore({
    kernel: {} as never,
    executor: {} as never,
    persistence: { save: async <T>(value: T) => value } as never
  });
}

function projectedLoopSession() {
  const base = AgentRuntime.create("tailor_existing_resume", "generate_changes", "问答闭环测试");
  const state = new AgentTaskStateReducer().create(base, "generate_changes");
  const questions = ["q-1", "q-2", "q-3"].map((id, index) => ({
    id,
    question: `你是否有 ${id} 的真实经历？`,
    requirementText: `${id} 的结构化岗位要求`,
    requirementCategory: "tool_or_technology",
    requirementPriority: "high",
    evidenceNeed: "请提供实际使用场景、项目范围和可核验结果",
    requirementIds: [`requirement-${id}`],
    sourceItemIds: ["item-1"],
    relatedItemIds: ["item-1"],
    candidateClaim: `${id} 的候选事实`,
    targetFieldPaths: ["sections.projects.items.item-1.highlights"],
    answerType: "text" as const,
    options: [
      { id: "yes", label: "有", value: "有" },
      { id: "none", label: "没有", value: "没有" },
      { id: "uncertain", label: "不确定", value: "不确定" },
      { id: "skip", label: "跳过", value: "跳过" }
    ],
    status: index === 0 ? "active" as const : "pending" as const,
    updatedAt: "2026-08-21T00:00:00.000Z"
  }));
  const tailoringSession = {
    id: "tailoring-session-1",
    plan: {
      clarificationQuestions: questions,
      clarificationAnswers: [],
      answerReceipts: [],
      questionPlan: {
        id: "question-plan-1",
        sessionId: "tailoring-session-1",
        revision: 1,
        questionIds: ["q-1", "q-2", "q-3"],
        activeQuestionId: "q-1",
        answeredQuestionIds: [],
        skippedQuestionIds: [],
        uncertainQuestionIds: [],
        status: "asking"
      }
    }
  };
  const taskState = {
    ...state,
    rootGoal: "generate_job_specific_resume" as const,
    activeGoal: "clarify_tailoring" as const,
    workflowId: "tailor_resume" as const,
    stage: "clarify_unsupported_facts" as const,
    completionStatus: "waiting_for_user" as const,
    completionType: "transactional" as const,
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-1",
      resumeId: "resume-1",
      jobId: "job-1",
      tailoringSessionId: "tailoring-session-1"
    },
    knownSlots: {
      ...state.knownSlots,
      tailoringSession,
      questionPlan: tailoringSession.plan.questionPlan,
      activeQuestionId: "q-1"
    },
    updatedAt: "2026-08-21T00:00:00.000Z"
  };
  const session = AgentSessionSchema.parse(projectTaskStateIntoSession(base, taskState));
  return attachTaskStateOptions(session, taskState);
}
