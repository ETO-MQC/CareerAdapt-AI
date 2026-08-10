import { describe, expect, it, vi } from "vitest";
import { evaluateConversationContinuity } from "@/agent/runtime/ConversationContinuityGuard";
import { evaluateGroundedResumeOutput } from "@/agent/kernel/GroundedResumeOutputGate";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { resolveContinuationIntent } from "@/agent/runtime/TaskContinuationResolver";
import { allowedToolManifestForStep } from "@/agent/workflows/workflowRegistry";
import { migrateAgentSessionToCurrentSchema } from "@/agent/runtime/AgentSessionMigration";
import { AgentTaskCompletionGuard } from "@/agent/kernel/AgentTaskCompletionGuard";
import { prepareSessionForAssistantRegeneration } from "@/agent/runtime/AgentHostStore";

const compositionManifest = [
  "get_profile",
  "build_resume_evidence_graph",
  "plan_resume_composition",
  "review_resume_composition",
  "compose_resume",
  "create_resume_from_profile"
].map((name) => ({ name }));

function composeState() {
  const reducer = new AgentTaskStateReducer();
  const session = AgentRuntime.create("agent_quick_action", "collecting_intent");
  let state = reducer.create(session);
  state = reducer.reduce(state, {
    type: "new_root_task",
    goal: "create_resume_from_profile",
    workflowId: "build_resume_from_profile",
    stage: "select_profile_scope"
  });
  return { reducer, state };
}

describe("P4.5b.1 canonical resume composition journey", () => {
  it("does not consume Card 4's initial instruction as the target-direction answer", () => {
    const { reducer, state: initial } = composeState();
    const state = reducer.reduce(
      reducer.reduce(initial, {
        type: "entity_revision",
        entityType: "profile",
        entityId: "profile-1",
        version: 3
      }),
      {
        type: "user_message",
        message: "我想从个人资料库整理一份通用简历。先直接开始；如果目标方向会明显改变结果，再问我一次。",
        turnIntent: "new_domain_task"
      }
    );

    expect(state.workflowId).toBe("compose_resume");
    expect(state.stage).toBe("select_profile_scope");
    expect(state.knownSlots.resumeCompositionLastAnswer).toBeUndefined();
    expect(state.knownSlots.resumeCompositionPendingInformationNeed).toMatchObject({
      informationNeedId: "target_direction",
      status: "pending"
    });
  });

  it("captures a later target answer and makes direct generation an explicit confirmation", () => {
    const { reducer, state: initial } = composeState();
    let state = reducer.reduce(initial, {
      type: "entity_revision",
      entityType: "profile",
      entityId: "profile-1",
      version: 3
    });
    state = reducer.reduce(state, {
      type: "user_message",
      message: "用于互联网的秋招",
      turnIntent: "clarification_answer"
    });
    expect(state).toMatchObject({ workflowId: "compose_resume", stage: "review_composition" });
    expect(state.knownSlots.resumeCompositionLastAnswer).toMatchObject({
      informationNeedId: "target_direction",
      value: "用于互联网的秋招",
      source: "user_message"
    });

    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "plan_resume_composition",
      observation: {
        profileId: "profile-1",
        profileRevision: 3,
        compositionProposal: {
          mode: "general",
          title: "通用简历组装预览",
          summary: "只使用已确认资料。",
          selectedAssetTitles: [],
          derivedSkillNames: [],
          bulletCount: 0,
          informationNeeds: [],
          actions: ["generate", "supplement", "adjust", "cancel"]
        }
      }
    });
    state = reducer.reduce(state, {
      type: "user_message",
      message: "直接生成",
      turnIntent: "clarification_answer"
    });
    expect(state).toMatchObject({
      workflowId: "compose_resume",
      stage: "confirm_create",
      completionStatus: "active"
    });
    expect(state.knownSlots.resumeCompositionDecision).toBe("generate");
    expect(state.knownSlots.resumeCompositionExplicitConfirmation).toBe(true);
  });

  it("keeps a short target answer in compose_resume even before the pause is marked waiting", () => {
    const { state } = composeState();
    expect(classifyTurnIntent({
      text: "用于互联网的秋招",
      taskState: { ...state, completionStatus: "active" }
    })).toMatchObject({
      intent: "clarification_answer",
      taskMutation: "continue",
      toolScope: "domain"
    });
  });

  it("keeps the canonical tool permission set and removes the legacy raw writer", () => {
    expect(allowedToolManifestForStep("compose_resume", "review_composition", compositionManifest).map((tool) => tool.name)).toEqual([
      "get_profile",
      "build_resume_evidence_graph",
      "plan_resume_composition",
      "review_resume_composition"
    ]);
    expect(allowedToolManifestForStep("compose_resume", "confirm_create", compositionManifest).map((tool) => tool.name)).toEqual([
      "compose_resume"
    ]);
  });

  it("migrates a completed legacy branch without reopening it as an unfinished composition", () => {
    const { state } = composeState();
    const legacySession = {
      ...AgentRuntime.create("build_resume_from_profile", "completed"),
      workflowState: {
        ...AgentRuntime.create("build_resume_from_profile", "completed").workflowState,
        status: "completed" as const
      },
      taskState: {
        ...state,
        rootGoal: "create_resume_from_profile",
        goal: "create_resume_from_profile",
        activeGoal: "create_resume_from_profile",
        workflowId: "build_resume_from_profile",
        stage: "completed",
        completionStatus: "completed" as const,
        selectedEntities: {
          profileId: "profile-legacy",
          resumeId: "resume-legacy",
          revisionId: "revision-legacy"
        },
        knownSlots: {
          selectedFactIds: ["fact-legacy"],
          resumeFromProfileResult: {
            profileId: "profile-legacy",
            profileVersion: 7,
            resumeId: "resume-legacy",
            revisionId: "revision-legacy"
          }
        }
      }
    };

    const migrated = migrateAgentSessionToCurrentSchema(legacySession);
    expect(migrated.taskState).toMatchObject({
      workflowId: "compose_resume",
      stage: "resume_ready",
      completionStatus: "completed",
      knownSlots: {
        resumeCompositionMigration: "legacy_build_resume_from_profile"
      }
    });
    expect(new AgentTaskCompletionGuard().evaluate(migrated.taskState!)).toEqual({
      canFinish: true,
      reason: "goal_completed"
    });
  });

  it("blocks a resume-shaped fabricated answer until a proposal or result is grounded", () => {
    const { reducer, state: initial } = composeState();
    const state = reducer.reduce(initial, {
      type: "entity_revision",
      entityType: "profile",
      entityId: "profile-1",
      version: 3
    });
    const fabricated = [
      "个人简介",
      "教育背景：毕业于XX大学，GPA 3.7/4.0。",
      "证书：CET-6 580。",
      "实习经历：XX科技有限公司实习。",
      "项目经历：开发电商用户行为分析系统，10万+用户评论，留存率提升5%，1000+并发。"
    ].join("\n");
    expect(evaluateGroundedResumeOutput({ text: fabricated, taskState: state })).toMatchObject({
      allowed: false,
      reasonCode: "resume_output_without_grounding"
    });

    const grounded = {
      ...state,
      knownSlots: {
        ...state.knownSlots,
        resumeCompositionProposal: {
          mode: "general",
          title: "通用简历组装预览",
          summary: "只使用已确认资料。",
          selectedAssetTitles: [],
          derivedSkillNames: [],
          bulletCount: 0,
          informationNeeds: [],
          actions: ["generate", "supplement", "adjust", "cancel"]
        }
      }
    };
    expect(evaluateGroundedResumeOutput({ text: fabricated, taskState: grounded })).toMatchObject({
      allowed: false,
      reasonCode: "resume_output_contains_unsupported_fact"
    });
  });

  it("persists an external runtime's canonical task before it can call the model", async () => {
    const save = vi.fn(async <T>(session: T) => session);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const session = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const prepared = await host.prepareRuntimeTask({
      session,
      userMessage: "我想从个人资料库整理一份通用简历"
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(prepared.taskState).toMatchObject({
      rootGoal: "compose_resume",
      workflowId: "compose_resume",
      stage: "select_profile_scope"
    });
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      taskState: { workflowId: "compose_resume" }
    });
  });

  it("recognizes the three proposal continuations without lexical workflow switching", () => {
    const { state } = composeState();
    const target = {
      ...state,
      selectedEntities: { ...state.selectedEntities, profileId: "profile-1" },
      knownSlots: {
        ...state.knownSlots,
        resumeCompositionPendingInformationNeed: {
          informationNeedId: "target_direction",
          question: "这份通用简历主要准备投什么方向？",
          status: "pending"
        }
      }
    };
    expect(resolveContinuationIntent(target, "调整方向").slotUpdates).toMatchObject({ resumeCompositionDecision: "adjust_direction" });
    expect(resolveContinuationIntent(target, "继续补充资料").slotUpdates).toMatchObject({ resumeCompositionDecision: "supplement" });
    expect(resolveContinuationIntent(target, "直接生成").slotUpdates).toMatchObject({
      resumeCompositionDecision: "generate",
      resumeCompositionExplicitConfirmation: true
    });
  });

  it("requires a legal terminal result for the current turn", () => {
    const { state } = composeState();
    const session = {
      ...AgentRuntime.create("agent_quick_action", "collecting_intent"),
      taskState: state,
      activeTurn: {
        id: "turn-1",
        sessionId: "session-1",
        status: "completed" as const,
        startedAt: "2026-08-10T00:00:00.000Z",
        completedAt: "2026-08-10T00:00:01.000Z"
      },
      messages: [{
        id: "assistant-1",
        role: "assistant" as const,
        content: "这一步没有任何结果。",
        kind: "text" as const,
        type: "text" as const,
        status: "complete" as const,
        turnId: "turn-1",
        metadata: { terminalState: "COMPLETED" },
        createdAt: "2026-08-10T00:00:00.000Z"
      }]
    };
    expect(evaluateConversationContinuity(session)).toMatchObject({
      ok: false,
      reasonCode: "agent_conversation_dead_end"
    });
  });

  it("regenerates a failed composition turn from its canonical checkpoint", () => {
    const initial = AgentRuntime.create("compose_resume", "review_composition");
    const reducer = new AgentTaskStateReducer();
    const checkpointState = {
      ...reducer.create(initial, "create_resume_from_profile"),
      stage: "review_composition",
      selectedEntities: {
        ...reducer.create(initial, "create_resume_from_profile").selectedEntities,
        profileId: "profile-1"
      },
      knownSlots: {
        ...reducer.create(initial, "create_resume_from_profile").knownSlots,
        resumeCompositionCheckpoint: {
          kind: "resume_composition",
          profileId: "profile-1",
          expectedProfileRevision: 3,
          mode: "general",
          proposal: { title: "通用简历组装预览" }
        }
      }
    };
    const session = {
      ...initial,
      taskState: { ...checkpointState, completionStatus: "failed" as const },
      workflowState: { ...initial.workflowState, status: "failed" as const },
      messages: [
        {
          id: "user-compose",
          turnId: "turn-compose",
          role: "user" as const,
          content: "用于互联网的秋招",
          createdAt: "2026-08-10T00:00:00.000Z"
        },
        {
          id: "assistant-compose",
          turnId: "turn-compose",
          role: "assistant" as const,
          content: "当前步骤失败。",
          kind: "error_status" as const,
          type: "error" as const,
          status: "failed" as const,
          errorCode: "plan_resume_composition_failed",
          createdAt: "2026-08-10T00:00:01.000Z"
        }
      ],
      turnCheckpoints: [{
        turnId: "turn-compose",
        userMessageId: "user-compose",
        taskStateBefore: checkpointState,
        workflowStateBefore: initial.workflowState,
        selectedEntitiesBefore: checkpointState.selectedEntities,
        artifactRefsBefore: [],
        createdAt: "2026-08-10T00:00:00.000Z"
      }]
    };

    const prepared = prepareSessionForAssistantRegeneration(session, "assistant-compose");
    expect(prepared).toMatchObject({
      retryWorkflowStep: true,
      userMessage: "用于互联网的秋招",
      session: {
        taskState: {
          workflowId: "compose_resume",
          stage: "review_composition",
          completionStatus: "active",
          selectedEntities: { profileId: "profile-1" }
        }
      }
    });
    expect(prepared?.session.taskState?.knownSlots.resumeCompositionCheckpoint).toBeDefined();
  });
});
