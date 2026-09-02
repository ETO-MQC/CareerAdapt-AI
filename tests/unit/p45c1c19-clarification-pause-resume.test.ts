import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionSchema, type AgentSession, type AgentTaskState } from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import {
  AgentHostStore,
  attachTaskStateOptions,
  getActiveTailoringQuestionProjection
} from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer, normalizeAgentTaskState } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";

const pageContext = { pathname: "/ai-workspace", query: {} };

afterEach(() => {
  vi.useRealTimers();
});

describe("P4.5c.1.19 clarification pause/resume closure", () => {
  it("projects the authoritative question after a tool result and ignores a stale delta", async () => {
    const save = vi.fn(async (session: AgentSession) => session);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const session = clarificationSession();
    host.adopt(session);
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: "长岗位描述",
      runtimeId: "hermes"
    });

    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "answer_tailoring_question",
      operationId: "answer-question-1",
      data: {
        result: {
          ok: true,
          data: { session: tailoringSession() }
        }
      }
    }, shell.assistantMessageId);

    const projected = host.getSnapshot().activeSession;
    const question = projected?.messages.find((message) => message.metadata?.tailoringQuestionProjection === true);
    const progress = projected?.messages.find((message) => message.id === shell.assistantMessageId);
    expect(projected?.taskState?.completionStatus).toBe("waiting_for_user");
    expect(projected?.activeTurn?.status).toBe("waiting_for_user");
    expect(question).toMatchObject({
      status: "complete",
      streaming: false,
      metadata: {
        questionId: "q-1",
        questionPlanId: "question-plan-1",
        questionPlanRevision: 1,
        questionPosition: 1,
        questionCount: 1,
        answerType: "boolean",
        allowSkip: true
      },
      options: [{ action: { type: "answer", field: "tailoring-question:q-1", value: "有" } }]
    });
    expect(progress).toMatchObject({ streaming: false, metadata: { retracted: true } });
    const questionText = question?.content;

    await host.applyRuntimeEvent({
      type: "text_delta",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      delta: "迟到的模型文本不应覆盖权威问题。"
    }, shell.assistantMessageId);

    const afterStaleDelta = host.getSnapshot().activeSession;
    expect(afterStaleDelta?.messages.find((message) => message.id === question?.id)?.content).toBe(questionText);
    expect(afterStaleDelta?.activeTurn?.status).toBe("waiting_for_user");
    expect(save).toHaveBeenCalled();
  });

  it("consumes a text answer locally without starting a continuation turn", async () => {
    const save = vi.fn(async (session: AgentSession) => session);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const session = attachTaskStateOptions(clarificationSession(), clarificationSession().taskState!);
    host.adopt(session);

    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "有的" },
      pageContext
    });
    const answers = prepared.session.messages.filter((message) =>
      message.role === "user" && message.metadata?.answerPayload === true
    );
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      content: "有的",
      turnId: prepared.turnId,
      metadata: {
        tailoringQuestionId: "q-1",
        tailoringQuestionPlanId: "question-plan-1",
        tailoringQuestionPlanRevision: 1,
        executionOwner: "deterministic_transition",
        executionState: "complete",
        tailoringAnswerReceipt: {
          questionId: "q-1",
          disposition: "answered"
        }
      }
    });
    expect(prepared.prePersistedUserMessageId).toBe(answers[0]?.id);
    expect(prepared.tailoringAnswerBinding).toBeUndefined();
    expect(prepared.deterministicTerminal).toBe(true);
    expect(prepared.session.taskState?.completionStatus).toBe("active");
    expect(prepared.session.taskState?.knownSlots.tailoringQuestionAnswerReceipts).toMatchObject([
      { questionId: "q-1", answerMessageId: answers[0]?.id, disposition: "answered" }
    ]);
    expect(prepared.session.messages.find((message) => message.metadata?.questionId === "q-1" && message.role === "assistant"))
      .toMatchObject({
        metadata: { questionProjectionState: "resolved" },
        options: [expect.objectContaining({ disabled: true })]
      });
    expect(save).toHaveBeenCalled();
  });

  it("forces waiting_for_user whenever a tailoring question remains active", () => {
    const session = clarificationSession();
    const state = session.taskState!;
    state.completionStatus = "active";
    expect(normalizeAgentTaskState(state).completionStatus).toBe("waiting_for_user");
    expect(getActiveTailoringQuestionProjection(state)).toMatchObject({
      questionId: "q-1",
      messageId: expect.stringContaining("question-plan-1")
    });
  });

  it("binds the canonical continuation to the active question and sends one answer payload", async () => {
    const execute = vi.fn(async (_name: string, input: unknown) => ({
      ok: true as const,
      data: input,
      artifacts: [],
      receipt: {
        operationId: "tailor-answer-operation",
        toolName: "career.workflow.tailor_resume",
        status: "completed" as const,
        completedAt: new Date().toISOString()
      }
    }));
    const client = new CareerAdaptMcpBridgeClient();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const internal = client as unknown as {
        gateway: { listContracts(): unknown[]; execute(name: string, input: unknown, context: unknown): Promise<unknown> };
        bridgeId: string;
        token: string;
        stopped: boolean;
        confirmationContext: unknown;
        execute(request: unknown): Promise<void>;
      };
      internal.gateway = {
        listContracts: () => [{ name: "career.workflow.tailor_resume", contractVersion: "test" }],
        execute
      };
      internal.bridgeId = "bridge-answer-test";
      internal.token = "token-answer-test";
      internal.stopped = false;
      internal.confirmationContext = {
        sessionId: "agent-session-1",
        turnId: "answer-turn-1",
        assistantMessageId: "assistant-answer-1",
        tailoringAnswer: {
          checkpointId: "tailoring-session-1",
          questionId: "q-1",
          questionPlanId: "question-plan-1",
          questionPlanRevision: 1,
          answer: "有的"
        }
      };
      await internal.execute({
        id: "request-answer-1",
        name: "career.workflow.tailor_resume",
        input: { checkpointId: "model-invented", userAnswer: "错误答案" },
        operationId: "tailor-answer-operation",
        logicalTurnId: "answer-turn-1"
      });

      expect(execute).toHaveBeenCalledTimes(1);
      expect(execute.mock.calls[0]?.[1]).toEqual({
        checkpointId: "tailoring-session-1",
        userAnswer: "有的"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function clarificationSession() {
  const base = AgentRuntime.create("tailor_existing_resume", "generate_changes", "定制问题测试");
  const state = new AgentTaskStateReducer().create(base, "generate_changes") as AgentTaskState;
  const taskState: AgentTaskState = {
    ...state,
    rootGoal: "generate_job_specific_resume",
    activeGoal: "clarify_tailoring",
    workflowId: "tailor_resume",
    stage: "clarify_unsupported_facts",
    completionStatus: "active",
    completionType: "transactional",
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-1",
      resumeId: "resume-1",
      jobId: "job-1",
      tailoringSessionId: "tailoring-session-1"
    },
    knownSlots: {
      ...state.knownSlots,
      tailoringSession: tailoringSession(),
      questionPlan: tailoringSession().plan.questionPlan,
      activeQuestionId: "q-1"
    },
    updatedAt: new Date().toISOString()
  };
  return AgentSessionSchema.parse(projectTaskStateIntoSession(base, taskState));
}

function tailoringSession() {
  return {
    id: "tailoring-session-1",
    plan: {
      clarificationQuestions: [{
        id: "q-1",
        question: "你是否有真实的 AI 交付案例？",
        answerType: "boolean",
        options: [{ id: "yes", label: "有", value: "有" }]
      }],
      questionPlan: {
        id: "question-plan-1",
        sessionId: "tailoring-session-1",
        revision: 1,
        questionIds: ["q-1"],
        activeQuestionId: "q-1",
        answeredQuestionIds: [],
        skippedQuestionIds: [],
        status: "asking"
      }
    }
  };
}
