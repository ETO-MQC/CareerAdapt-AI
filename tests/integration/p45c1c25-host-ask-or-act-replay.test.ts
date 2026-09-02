import { describe, expect, it } from "vitest";
import {
  AgentSessionSchema,
  isWorkflowAgentSession,
  type AgentTaskState,
  type WorkflowAgentSession
} from "@/agent/contracts/agentSession";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore, attachTaskStateOptions } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { projectTaskStateIntoSession } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { TARGET_REQUIRED_PROMPT } from "@/agent/runtime/workflowUserInputCheckpoint";

const pageContext = { pathname: "/ai-workspace", query: {} };

describe("P4.5c.1 Host Ask-or-Act replay", () => {
  it("replays target_required, preserves the source UserMessage, and answers 需要什么 with the same checkpoint", async () => {
    const host = createHost();
    const session = tailoringSession("choose_resume_source");
    host.adopt(session);
    const shell = await host.beginRuntimeShell({
      session,
      userMessage: "帮我生成对应的岗位简历",
      runtimeId: "hermes"
    });
    const gateway = new CareerToolGateway({
      registry: new AgentToolRegistry([]),
      getUserMessageForTurn: (turnId) => host.getUserMessageForTurn(turnId)
    });

    const result = await gateway.execute("career.workflow.tailor_resume", {}, {
      operationId: "target-required-1",
      logicalToolOperationId: "logical-target-required-1",
      logicalTurnId: shell.turnId,
      sourceUserMessageId: shell.userMessageId
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "target_required", message: TARGET_REQUIRED_PROMPT }
    });

    await host.applyRuntimeEvent({
      type: "tool_call_completed",
      sessionId: shell.session.id,
      turnId: shell.turnId,
      timestamp: new Date().toISOString(),
      toolName: "career.workflow.tailor_resume",
      operationId: "target-required-1",
      data: {
        logicalToolOperationId: "logical-target-required-1",
        result: { structuredContent: result }
      }
    }, shell.assistantMessageId);

    const waiting = host.getSnapshot().activeSession!;
    expect(waiting.taskState?.workflowUserInputCheckpoint).toMatchObject({
      kind: "target_input",
      promptProjection: {
        text: TARGET_REQUIRED_PROMPT,
        options: [
          { label: "粘贴岗位描述", value: "paste_target" },
          { label: "选择已有岗位", value: "select_saved_job" }
        ]
      },
      allowedInput: { type: "target_input" }
    });
    expect(host.getUserMessageForTurn(shell.turnId)?.content).toBe("帮我生成对应的岗位简历");

    const explained = await host.prepareRuntimeUserEvent({
      session: waiting,
      event: { type: "text_message", text: "需要什么" },
      pageContext
    });
    const assistant = explained.session.messages.at(-1);
    expect(explained.deterministicTerminal).toBe(true);
    expect(explained.executionOwner).toBe("deterministic_transition");
    expect(assistant).toMatchObject({ role: "assistant", status: "complete" });
    expect(assistant?.content).toContain(TARGET_REQUIRED_PROMPT);
    expect(assistant?.content).toContain("粘贴岗位描述");
    expect(assistant?.content).toContain("选择已有岗位");
    expect(explained.session.taskState?.workflowUserInputCheckpoint?.kind).toBe("target_input");
  });

  it.each([
    {
      name: "resume ambiguity",
      state: () => resumeChoiceState(),
      kind: "resume_choice"
    },
    {
      name: "clarification",
      state: () => clarificationState(),
      kind: "clarification"
    },
    {
      name: "confirmation",
      state: () => confirmationState(),
      kind: "confirmation"
    }
  ])("replays $name as one concrete checkpoint and one answer path", async ({ state, kind }) => {
    const source = state();
    const session = attachTaskStateOptions(source.session, source.taskState);
    const checkpoint = session.taskState?.workflowUserInputCheckpoint;
    expect(checkpoint?.kind).toBe(kind);
    expect(checkpoint?.promptProjection.text.trim()).not.toBe("");
    expect(checkpoint?.allowedInput.type.trim()).not.toBe("");
    expect(session.taskState?.completionStatus === "waiting_for_user" || session.taskState?.completionStatus === "waiting_for_confirmation").toBe(true);

    const host = createHost();
    host.adopt(session);
    const explained = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "需要什么" },
      pageContext
    });
    expect(explained.deterministicTerminal).toBe(true);
    expect(explained.session.messages.at(-1)?.content).toContain(checkpoint?.promptProjection.text);
    expect(explained.session.taskState?.workflowUserInputCheckpoint?.kind).toBe(kind);
  });

  it("projects the external target persistence choice with concrete actions", () => {
    const base = tailoringSession("confirm_apply");
    const pendingDecision: NonNullable<AgentTaskState["pendingDecision"]> = {
      type: "job_target_persistence",
      options: ["session_only", "save_job"]
    };
    const state = {
      ...base.taskState!,
      stage: "confirm_apply",
      completionStatus: "waiting_for_user" as const,
      pendingDecision,
      selectedEntities: {
        ...base.taskState!.selectedEntities,
        targetSnapshotId: "target-snapshot-1"
      },
      knownSlots: {
        ...base.taskState!.knownSlots,
        jobPersistenceDecision: "ask" as const
      },
      updatedAt: new Date().toISOString()
    };
    const session = attachTaskStateOptions(projectTaskStateIntoSession(base, state), state);
    const interaction = session.taskState?.workflowUserInputCheckpoint;
    const message = session.messages.find((candidate) =>
      candidate.metadata?.workflowInteractionKind === "target_persistence_choice"
    );

    expect(interaction).toMatchObject({
      kind: "target_persistence_choice",
      prompt: "是否将这份外部岗位保存到岗位列表？"
    });
    expect(message).toMatchObject({
      content: "是否将这份外部岗位保存到岗位列表？",
      options: [
        expect.objectContaining({
          label: "仅用于本次定制",
          action: expect.objectContaining({ type: "task_decision", option: "session_only" })
        }),
        expect.objectContaining({
          label: "保存到岗位列表",
          action: expect.objectContaining({ type: "task_decision", option: "save_job" })
        })
      ]
    });
  });

  it("stops at the explicit apply confirmation instead of reopening Hermes", async () => {
    const base = tailoringSession("confirm_apply");
    const pendingDecision: NonNullable<AgentTaskState["pendingDecision"]> = {
      type: "job_target_persistence",
      options: ["session_only", "save_job"]
    };
    const state = {
      ...base.taskState!,
      stage: "confirm_apply",
      completionStatus: "waiting_for_user" as const,
      pendingDecision,
      knownSlots: {
        ...base.taskState!.knownSlots,
        jobPersistenceDecision: "ask" as const,
        tailoringSession: { id: "tailoring-session-1" },
        selectedDiffs: [{ diffId: "diff-1", value: "已核对的岗位描述" }],
        confirmedRequirementIds: []
      },
      updatedAt: new Date().toISOString()
    };
    const session = attachTaskStateOptions(projectTaskStateIntoSession(base, state), state);
    const host = createHost();
    host.adopt(session);

    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: {
        type: "option_selected",
        action: {
          type: "task_decision",
          decisionType: "job_target_persistence",
          option: "session_only"
        }
      },
      pageContext
    });

    expect(prepared.executionOwner).toBe("deterministic_transition");
    expect(prepared.deterministicTransitionApplied).toBe(true);
    expect(prepared.deterministicTerminal).toBe(true);
    expect(prepared.session.pendingConfirmation).toMatchObject({
      toolName: "apply_tailoring_changes",
      status: "pending"
    });
    expect(prepared.session.taskState?.completionStatus).toBe("waiting_for_confirmation");
  });

  it("keeps one healthy General Resume on the automatic route and asks only when there are multiple", () => {
    const base = tailoringSession("choose_resume_source");
    const reducer = new AgentTaskStateReducer();
    const one = reducer.reduce(base.taskState!, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [{ id: "resume-1", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 1 }]
      }
    });
    const oneSession = attachTaskStateOptions(projectTaskStateIntoSession(base, one), one);
    expect(oneSession.taskState?.workflowUserInputCheckpoint).toBeUndefined();
    expect(oneSession.taskState?.knownSlots.resumeSelectionRequired).not.toBe(true);

    const two = reducer.reduce(base.taskState!, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [
          { id: "resume-1", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 1 },
          { id: "resume-2", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 2 }
        ]
      }
    });
    const twoSession = attachTaskStateOptions(projectTaskStateIntoSession(base, two), two);
    expect(twoSession.taskState?.workflowUserInputCheckpoint?.kind).toBe("resume_choice");
    expect(twoSession.taskState?.workflowUserInputCheckpoint?.allowedInput.type).toBe("resume");
  });

  it("repairs an invalid waiting state before answering 需要什么", async () => {
    const base = tailoringSession("choose_resume_source");
    const state = {
      ...base.taskState!,
      completionStatus: "waiting_for_user" as const,
      knownSlots: {
        ...base.taskState!.knownSlots,
        canonicalWorkflowFailure: { code: "target_required", operationId: "repair-target-1" }
      },
      workflowUserInputCheckpoint: undefined,
      updatedAt: new Date().toISOString()
    };
    const session = projectTaskStateIntoSession(base, state);
    const host = createHost();
    host.adopt(session);
    const prepared = await host.prepareRuntimeUserEvent({
      session,
      event: { type: "text_message", text: "需要什么" },
      pageContext
    });
    expect(prepared.deterministicTerminal).toBe(true);
    expect(prepared.session.taskState?.workflowUserInputCheckpoint).toMatchObject({
      kind: "target_input",
      promptProjection: { text: TARGET_REQUIRED_PROMPT }
    });
    expect(prepared.session.messages.at(-1)?.content).toContain("粘贴岗位描述");
  });
});

function createHost() {
  return new AgentHostStore({
    kernel: {} as never,
    executor: {} as never,
    persistence: { save: async <T>(value: T) => value } as never
  });
}

function tailoringSession(stage: string): WorkflowAgentSession {
  const base = AgentRuntime.create("tailor_resume", stage, "P4.5c.1.25 replay");
  const state = new AgentTaskStateReducer().create(base, "generate_job_specific_resume");
  const parsed = AgentSessionSchema.parse(projectTaskStateIntoSession(base, {
    ...state,
    rootGoal: "generate_job_specific_resume",
    activeGoal: "resolve_resume_source",
    workflowId: "tailor_resume",
    stage,
    completionType: "transactional",
    selectedEntities: {
      ...state.selectedEntities,
      profileId: "profile-1",
      profileVersion: 3
    },
    updatedAt: new Date().toISOString()
  }));
  if (!isWorkflowAgentSession(parsed)) throw new Error("test_fixture_requires_workflow_session");
  return parsed;
}

function resumeChoiceState() {
  const base = tailoringSession("choose_resume_source");
  const state = new AgentTaskStateReducer().reduce(base.taskState!, {
    type: "tool_observation",
    toolName: "list_resumes",
    observation: {
      resumes: [
        { id: "resume-1", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 1 },
        { id: "resume-2", profileId: "profile-1", purpose: "general", status: "active", healthy: true, revision: 2 }
      ]
    }
  });
  return { session: projectTaskStateIntoSession(base, state), taskState: state };
}

function clarificationState() {
  const base = tailoringSession("clarify_unsupported_facts");
  const state = new AgentTaskStateReducer().create(base, "generate_job_specific_resume") as AgentTaskState;
  const tailoringSessionValue = {
    id: "tailoring-session-1",
    plan: {
      clarificationQuestions: [{
        id: "q-1",
        question: "请补充一个真实的 AI 交付案例。",
        answerType: "text",
        options: []
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
      },
      clarificationAnswers: [],
      diffs: [],
      diffReviews: [],
      generationStatus: "not_started"
    }
  };
  const next = {
    ...state,
    activeGoal: "clarify_tailoring",
    stage: "clarify_unsupported_facts",
    completionStatus: "waiting_for_user" as const,
    selectedEntities: { ...state.selectedEntities, profileId: "profile-1", resumeId: "resume-1", jobId: "job-1", tailoringSessionId: "tailoring-session-1" },
    knownSlots: {
      ...state.knownSlots,
      tailoringSession: tailoringSessionValue,
      questionPlan: tailoringSessionValue.plan.questionPlan,
      activeQuestionId: "q-1"
    },
    updatedAt: new Date().toISOString()
  };
  return { session: projectTaskStateIntoSession(base, next), taskState: next };
}

function confirmationState() {
  const base = tailoringSession("confirm_apply");
  const now = new Date().toISOString();
  const pendingConfirmation = {
    id: "confirmation-1",
    operationId: "confirmation-operation-1",
    toolName: "apply_tailoring_changes",
    title: "确认应用岗位定制修改",
    description: "请确认应用已审核的岗位定制修改。",
    destructive: false,
    status: "pending" as const,
    requestedAt: now
  };
  const pendingToolCall = {
    toolName: "apply_tailoring_changes",
    operationId: "confirmation-operation-1",
    input: {}
  };
  const state = new AgentTaskStateReducer().create({
    ...base,
    pendingConfirmation,
    pendingToolCall,
    workflowState: { ...base.workflowState, status: "waiting_for_confirmation" }
  }, "generate_job_specific_resume");
  const next = {
    ...state,
    stage: "confirm_apply",
    completionStatus: "waiting_for_confirmation" as const,
    knownSlots: {
      ...state.knownSlots,
      pendingConfirmation: {
        operationId: pendingConfirmation.operationId,
        toolName: pendingConfirmation.toolName
      }
    },
    updatedAt: now
  };
  return {
    session: projectTaskStateIntoSession({ ...base, pendingConfirmation, pendingToolCall }, next),
    taskState: next
  };
}
