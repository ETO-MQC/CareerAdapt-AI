import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import {
  CURRENT_AGENT_SESSION_SCHEMA_VERSION,
  CURRENT_QUESTION_PLAN_VERSION,
  CURRENT_TAILORING_RUNTIME_VERSION,
  migrateAgentSessionToCurrentSchema
} from "@/agent/runtime/AgentSessionMigration";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";

const NOW = "2026-08-02T12:00:00.000Z";

describe("P4.3d.1 agent session migration", () => {
  it("supersedes legacy tailoring confirmation, settles activities, and invalidates an oversized legacy plan", () => {
    const base = AgentRuntime.create("tailor_existing_resume", "answer_questions", "Legacy");
    const initialTask = new AgentTaskStateReducer().create(base, "create_tailored_resume");
    const raw = {
      ...base,
      agentSessionSchemaVersion: undefined,
      pendingConfirmation: {
        id: "confirmation-old",
        operationId: "operation-answer-old",
        toolName: "answer_tailoring_question",
        title: "确认回答",
        description: "旧确认",
        destructive: false,
        status: "pending",
        requestedAt: NOW
      },
      pendingToolCall: {
        toolName: "answer_tailoring_question",
        operationId: "operation-answer-old",
        input: { answer: "原始用户回答" }
      },
      messages: [
        {
          id: "user-old",
          turnId: "turn-old",
          role: "user",
          content: "原始用户回答",
          status: "complete",
          metadata: { executionState: "running" },
          createdAt: NOW
        },
        {
          id: "tool-old",
          turnId: "turn-old",
          role: "tool",
          content: "等待回答写入",
          kind: "tool_status",
          type: "tool_status",
          status: "pending",
          toolName: "answer_tailoring_question",
          operationId: "operation-answer-old",
          metadata: { activityState: "running" },
          createdAt: NOW
        },
        {
          id: "assistant-old",
          turnId: "turn-old",
          role: "assistant",
          content: "正常完成消息",
          kind: "text",
          type: "text",
          status: "complete",
          errorCode: "provider_textual_tool_protocol",
          userMessageId: "user-old",
          streaming: false,
          metadata: { errorType: "provider" },
          createdAt: NOW
        }
      ],
      taskState: {
        ...initialTask,
        rootGoal: "create_tailored_resume",
        goal: "create_tailored_resume",
        activeGoal: "clarify_tailoring",
        workflowId: "tailor_existing_resume",
        stage: "clarify_unsupported_facts",
        selectedEntities: { profileId: "profile-1", resumeId: "resume-1", jobId: "job-1", tailoringSessionId: "tailoring-old" },
        dependencySnapshots: { fitResult: { profileId: "profile-1", resumeId: "resume-1", jobId: "job-1" } },
        knownSlots: {
          pendingConfirmation: { toolName: "answer_tailoring_question", operationId: "operation-answer-old" },
          tailoringSession: {
            id: "tailoring-old",
            plan: {
              clarificationQuestions: Array.from({ length: 39 }, (_, index) => ({ id: `q-${index}`, question: `问题 ${index}` })),
              diffs: []
            }
          }
        }
      }
    };

    const migrated = migrateAgentSessionToCurrentSchema(raw as never, NOW);
    expect(migrated.agentSessionSchemaVersion).toBe(CURRENT_AGENT_SESSION_SCHEMA_VERSION);
    expect(migrated.pendingConfirmation).toBeUndefined();
    expect(migrated.pendingToolCall).toBeUndefined();
    expect(migrated.taskState?.knownSlots).not.toHaveProperty("pendingConfirmation");
    expect(migrated.taskState?.knownSlots).not.toHaveProperty("tailoringSession");
    expect(migrated.taskState?.stage).toBe("analyze_fit");
    expect(migrated.taskState?.activeGoal).toBe("analyze_job_fit");
    expect(migrated.taskState?.selectedEntities).toMatchObject({ profileId: "profile-1", resumeId: "resume-1", jobId: "job-1" });
    expect(migrated.messages.find((message) => message.id === "tool-old")).toMatchObject({ status: "recovered", metadata: { activityState: "recovered" } });
    expect(migrated.messages.find((message) => message.id === "user-old")?.metadata?.executionState).toBe("complete");
    expect(migrated.messages.find((message) => message.id === "assistant-old")).not.toHaveProperty("errorCode");
    expect(migrated.messages.filter((message) => message.content === "旧版岗位定制会话已升级，当前问题和核对状态已恢复。")).toHaveLength(1);
    expect(migrateAgentSessionToCurrentSchema(migrated, NOW)).toEqual(migrated);
  });

  it("preserves a valid current question plan and backfills reviews by stable diff id", () => {
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "Current");
    const initialTask = new AgentTaskStateReducer().create(base, "create_tailored_resume");
    const diff = {
      target: { sectionId: "summary", itemId: "summary-1", fieldPath: "text" as const },
      operation: "replace" as const,
      original: "原文",
      value: "新文",
      reason: "匹配岗位",
      requirementIds: [], targetKeywords: [], evidenceRefs: [], supportLevel: "verified" as const
    };
    const questionPlan = {
      id: "plan-1", sessionId: "tailoring-1", revision: 1, status: "completed",
      defaultBudget: 3, maximumBudget: 5, questionIds: [], answeredQuestionIds: [], skippedQuestionIds: [],
      createdAt: NOW, frozenAt: NOW, completedAt: NOW
    };
    const raw = {
      ...base,
      taskState: {
        ...initialTask,
        knownSlots: { tailoringSession: { id: "tailoring-1", revision: 2, plan: { questionPlan, diffs: [diff] } } }
      }
    };
    const migrated = migrateAgentSessionToCurrentSchema(raw as never, NOW);
    const tailoring = migrated.taskState?.knownSlots.tailoringSession as { tailoringRuntimeVersion: number; plan: { questionPlan: { questionPlanVersion: number }; diffReviews: Array<{ diffId: string; status: string }> } };
    expect(tailoring.tailoringRuntimeVersion).toBe(CURRENT_TAILORING_RUNTIME_VERSION);
    expect(tailoring.plan.questionPlan.questionPlanVersion).toBe(CURRENT_QUESTION_PLAN_VERSION);
    expect(tailoring.plan.diffReviews).toEqual([{ diffId: tailoringDiffId(diff), status: "suggested", updatedAt: NOW }]);
  });

  it("keeps standalone analyze_job_fit artifacts separate from tailoring workspaces", () => {
    const base = AgentRuntime.create("analyze_job_fit", "analyze_fit", "Standalone fit");
    const initialTask = new AgentTaskStateReducer().create(base, "analyze_job_fit");
    const raw = {
      ...base,
      artifactRefs: [{
        id: "fit-artifact-1",
        kind: "job_fit_overview",
        title: "岗位匹配分析",
        entityType: "job",
        entityId: "job-1",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW
      }],
      taskState: {
        ...initialTask,
        workflowId: "analyze_job_fit",
        rootGoal: "analyze_job_fit",
        activeGoal: "analyze_job_fit",
        stage: "analyze_fit"
      }
    };

    const migrated = migrateAgentSessionToCurrentSchema(raw as never, NOW);
    expect(migrated.artifactRefs).toEqual(raw.artifactRefs);
  });
});
