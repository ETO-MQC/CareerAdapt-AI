import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { createQuickActionIntent } from "@/agent/contracts/agentQuickAction";
import { AgentTaskCompletionGuard } from "@/agent/kernel/AgentTaskCompletionGuard";
import { adaptConversationMessageToIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { ProfileReconciliationEngine } from "@/domain/profileReconciliation/ProfileReconciliationEngine";
import { demoCareerProfile } from "@/data/demoProfile";
import { groundMutationClaims } from "@/agent/kernel/AgentMutationClaimGuard";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { findRecoverableProfileIntakeSource } from "@/agent/runtime/AgentHostStore";

const REAL_LONG_PROFILE_ANSWER = [
  "示例大学计算机相关专业。",
  "课程项目使用 ESP32 做可检测心跳与摔倒的穿戴设备，我协助心跳模块、走线修复和蓝牙连接。",
  "参加示例编程竞赛并获得某省省级三等奖。",
  "在实验室用视觉模型和 Python 从近 1000 页 PDF 中提取实验数据。",
  "担任团支书，组织团日活动、信息答疑和社会实践传达。",
  "独立开发 示例任务系统 / TaskAI、示例学习助手。",
  "开发示例内容采集与 AI 可信度分析系统，支持多格式报告导出。",
  "开发 CareerAdapt AI 简历制作平台。"
].join("");

describe("P4.2a.3f guided profile intake intent authority", () => {
  it("seeds the profile intake workflow from the action id", () => {
    expect(createQuickActionIntent("build_profile_from_scratch").task).toEqual({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "resolve_profile_target"
    });
  });

  it.each([
    ["short answer", "示例大学"],
    ["single interview answer", "我现在是示例大学本科学生，计算机相关专业专业，2024年9月入学，预计2028年6月毕业"],
    ["long narrative", REAL_LONG_PROFILE_ANSWER]
  ])("routes a %s into fact capture without a character-count threshold", (_, answer) => {
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const intake = {
      ...reducer.create(session, "profile_intake"),
      rootGoal: "profile_intake",
      activeGoal: "profile_intake",
      goal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "collect_experience",
      completionStatus: "waiting_for_user" as const
    };
    const intent = classifyTurnIntent({ text: answer, taskState: intake });

    const result = reducer.reduce(intake, {
      type: "user_message",
      message: answer,
      turnIntent: intent.intent
    });

    expect(result.rootGoal).toBe("profile_intake");
    expect(result.workflowId).toBe("guided_profile_intake");
    expect(result.stage).toBe("structure_facts");
    expect(result.knownSlots.latestIntakeSource).toMatchObject({
      exactSourceQuote: answer
    });
  });

  it.each([
    ["continue_current_task", "继续"],
    ["task_control", "停止"]
  ] as const)("does not capture a %s command as a profile fact", (turnIntent, message) => {
    const reducer = new AgentTaskStateReducer();
    const intake = {
      ...reducer.create(AgentRuntime.create("guided_profile_intake", "collect_experience"), "profile_intake"),
      stage: "collect_experience",
      completionStatus: "waiting_for_user" as const
    };

    const result = reducer.reduce(intake, {
      type: "user_message",
      message,
      turnIntent
    });

    expect(result.stage).toBe("collect_experience");
    expect(result.completionStatus).toBe("waiting_for_user");
    expect(result.knownSlots).not.toHaveProperty("latestIntakeSource");
  });

  it.each(["是的", "确认", "没有问题", "导入"])(
    "does not capture a bare acknowledgement as profile evidence: %s",
    (message) => {
      const reducer = new AgentTaskStateReducer();
      const intake = {
        ...reducer.create(AgentRuntime.create("guided_profile_intake", "collect_experience"), "profile_intake"),
        stage: "collect_experience",
        completionStatus: "waiting_for_user" as const
      };

      const result = reducer.reduce(intake, {
        type: "user_message",
        message,
        turnIntent: "clarification_answer"
      });

      expect(result.stage).toBe("collect_experience");
      expect(result.completionStatus).toBe("waiting_for_user");
      expect(result.knownSlots).not.toHaveProperty("latestIntakeSource");
    }
  );

  it("does not reinterpret an import acknowledgement as historical profile evidence", () => {
    const now = "2026-07-28T08:50:00.000Z";
    const session = {
      ...AgentRuntime.create("guided_profile_intake", "collect_experience"),
      messages: [{
        id: "message-original",
        turnId: "turn-original",
        role: "user" as const,
        content: REAL_LONG_PROFILE_ANSWER,
        status: "complete" as const,
        createdAt: now,
        updatedAt: now
      }]
    };
    const taskState = {
      ...new AgentTaskStateReducer().create(session, "profile_intake"),
      workflowId: "guided_profile_intake",
      stage: "collect_experience"
    };

    expect(findRecoverableProfileIntakeSource(session, taskState, "导入")).toBeUndefined();
  });

  it("recovers the most complete original narrative on an explicit retry", () => {
    const now = "2026-07-28T08:50:00.000Z";
    const session = {
      ...AgentRuntime.create("guided_profile_intake", "collect_experience"),
      messages: [{
        id: "message-original",
        turnId: "turn-original",
        role: "user" as const,
        content: REAL_LONG_PROFILE_ANSWER,
        status: "complete" as const,
        createdAt: now,
        updatedAt: now
      }, {
        id: "message-clarification",
        turnId: "turn-clarification",
        role: "user" as const,
        content: "实验室课题组是2025年2月，团支书是从大一一直到现在",
        status: "complete" as const,
        createdAt: now,
        updatedAt: now
      }]
    };
    const taskState = {
      ...new AgentTaskStateReducer().create(session, "profile_intake"),
      workflowId: "guided_profile_intake",
      stage: "collect_experience"
    };

    expect(findRecoverableProfileIntakeSource(session, taskState, "重试刚才")).toMatchObject({
      messageId: "message-original",
      content: REAL_LONG_PROFILE_ANSWER
    });
  });

  it.each(["导入", "写入", "确认保存"])(
    "recovers the original narrative when a completed intake is explicitly recommitted with: %s",
    (command) => {
      const now = "2026-07-28T08:50:00.000Z";
      const session = {
        ...AgentRuntime.create("guided_profile_intake", "profile_complete"),
        messages: [{
          id: "message-original",
          turnId: "turn-original",
          role: "user" as const,
          content: REAL_LONG_PROFILE_ANSWER,
          status: "complete" as const,
          createdAt: now,
          updatedAt: now
        }]
      };
      const taskState = {
        ...new AgentTaskStateReducer().create(session, "profile_intake"),
        workflowId: "guided_profile_intake",
        stage: "profile_complete",
        completionStatus: "waiting_for_user" as const,
        knownSlots: {
          targetProfileId: "profile-1",
          expectedProfileVersion: 2,
          profileCommitResult: {
            profileId: "profile-1",
            profileVersion: 2,
            committedItemCount: 0
          }
        }
      };

      expect(findRecoverableProfileIntakeSource(session, taskState, command)).toMatchObject({
        messageId: "message-original",
        content: REAL_LONG_PROFILE_ANSWER
      });
    }
  );

  it("starts a fresh intake draft when new experience evidence arrives after profile completion", () => {
    const reducer = new AgentTaskStateReducer();
    const base = reducer.create(
      AgentRuntime.create("guided_profile_intake", "profile_complete"),
      "profile_intake"
    );
    const result = reducer.reduce({
      ...base,
      stage: "profile_complete",
      completionStatus: "completed",
      pendingDecision: {
        type: "profile_intake_resume",
        options: ["save_profile_only", "generate_general_resume"]
      },
      knownSlots: {
        ...base.knownSlots,
        targetProfileId: "profile-1",
        expectedProfileVersion: 2,
        intakeImportId: "old-empty-intake",
        expectedIntakeDraftRevision: 0,
        profileCommitResult: { profileId: "profile-1", profileVersion: 2 }
      }
    }, {
      type: "user_message",
      message: REAL_LONG_PROFILE_ANSWER,
      turnIntent: "clarification_answer",
      sessionId: "session-new-evidence",
      messageId: "message-new-evidence",
      turnId: "turn-new-evidence",
      capturedAt: "2026-07-28T08:18:25.450Z"
    });

    expect(result).toMatchObject({
      stage: "structure_facts",
      completionStatus: "active",
      knownSlots: {
        targetProfileId: "profile-1",
        expectedProfileVersion: 2,
        latestIntakeSource: {
          messageId: "message-new-evidence",
          exactSourceQuote: REAL_LONG_PROFILE_ANSWER
        }
      }
    });
    expect(result.pendingDecision).toBeUndefined();
    expect(result.knownSlots).not.toHaveProperty("intakeImportId");
    expect(result.knownSlots).not.toHaveProperty("profileCommitResult");
  });

  it("can explicitly restart a completed intake while preserving the authoritative profile target", () => {
    const reducer = new AgentTaskStateReducer();
    const base = reducer.create(
      AgentRuntime.create("guided_profile_intake", "profile_complete"),
      "profile_intake"
    );
    const result = reducer.reduce({
      ...base,
      stage: "profile_complete",
      completionStatus: "failed",
      knownSlots: {
        targetProfileId: "profile-1",
        expectedProfileVersion: 3,
        intakeImportId: "stale-intake",
        profileCommitResult: { profileId: "profile-1", profileVersion: 3 }
      },
      selectedEntities: {
        ...base.selectedEntities,
        profileId: "profile-1",
        profileVersion: 3
      }
    }, { type: "restart_profile_intake" });

    expect(result).toMatchObject({
      stage: "collect_experience",
      completionStatus: "active",
      knownSlots: {
        targetProfileId: "profile-1",
        expectedProfileVersion: 3
      },
      selectedEntities: {
        profileId: "profile-1",
        profileVersion: 3
      }
    });
    expect(result.knownSlots).not.toHaveProperty("intakeImportId");
    expect(result.knownSlots).not.toHaveProperty("profileCommitResult");
  });

  it("does not classify embedded report-export wording as an explicit Resume export command", () => {
    const taskState = new AgentTaskStateReducer().create(
      AgentRuntime.create("guided_profile_intake", "collect_experience"),
      "profile_intake"
    );
    const narrativeIntent = classifyTurnIntent({ text: REAL_LONG_PROFILE_ANSWER, taskState });
    expect(narrativeIntent.taskMutation).toBe("continue");
    expect(narrativeIntent.newTask).toBeUndefined();
    expect(classifyTurnIntent({ text: "把这份简历导出 PDF", taskState }).newTask).toEqual({
      goal: "export_resume",
      workflowId: "repair_and_export_resume",
      stage: "select_resume"
    });
  });

  it("uses export_ready as the reachable export terminal", () => {
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("repair_and_export_resume", "export");
    const state = reducer.reduce({
      ...reducer.create(session, "export_resume"),
      rootGoal: "export_resume",
      activeGoal: "export_resume",
      goal: "export_resume",
      workflowId: "repair_and_export_resume",
      stage: "export"
    }, {
      type: "tool_observation",
      toolName: "export_resume",
      observation: {
        status: "ready_for_preview",
        route: "/resume?branchId=resume-1&export=pdf"
      }
    });

    expect(state).toMatchObject({
      stage: "export_ready",
      completionStatus: "completed",
      knownSlots: {
        exportResult: expect.objectContaining({ status: "ready_for_preview" })
      }
    });
    expect(new AgentTaskCompletionGuard().evaluate(state).canFinish).toBe(true);
  });

  it("keeps the full long answer reviewable when semantic normalization has not run", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-real-regression",
      messageId: "message-long-answer",
      turnId: "turn-long-answer",
      text: REAL_LONG_PROFILE_ANSWER,
      capturedAt: "2026-07-27T10:09:56.725Z"
    });

    expect(captured.candidates).toHaveLength(1);
    expect(captured.candidates[0]).toMatchObject({
      label: "待整理经历",
      sourceQuote: REAL_LONG_PROFILE_ANSWER,
      needsConfirmation: true,
      status: "insufficient"
    });
    expect(captured.artifact.sources).toEqual([{
      sessionId: "session-real-regression",
      messageId: "message-long-answer",
      turnId: "turn-long-answer",
      sourceContentHash: expect.any(String),
      capturedAt: "2026-07-27T10:09:56.725Z"
    }]);

    const plan = new ProfileReconciliationEngine().createPlan({
      draft: captured.draft,
      profile: demoCareerProfile,
      now: "2026-07-27T10:10:00.000Z"
    });
    expect(plan.candidates).toHaveLength(0);
    expect(captured.draft.sections[0]?.items[0]?.conversationEvidence?.[0]).toMatchObject({
      sessionId: "session-real-regression",
      messageId: "message-long-answer",
      turnId: "turn-long-answer",
      sourceQuote: REAL_LONG_PROFILE_ANSWER
    });
  });

  it("keeps uncertain transcriptions raw instead of applying fixture corrections", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-ambiguous",
      messageId: "message-ambiguous",
      turnId: "turn-ambiguous",
      text: "我参加了南郊杯，项目可能叫 Smart Fox，也提到 LearnCat 和 DeepTurd。",
      capturedAt: "2026-07-27T10:09:56.725Z"
    });

    expect(captured.artifact.needsConfirmation).toEqual([
      expect.objectContaining({ label: "待整理经历" })
    ]);
    expect(captured.candidates[0]?.sourceQuote).toContain("南郊杯");
    expect(captured.draft.sections.every((section) => !section.included)).toBe(true);
  });

  it("does not invent clause classification before a semantic proposal exists", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-clause-boundary",
      messageId: "message-clause-boundary",
      turnId: "turn-clause-boundary",
      text: "还有实验室课题组，使用视觉模型和 Python 处理近1000页 PDF。然后社团学生组织，我是团支书，每月组织团日活动并负责信息解答。",
      capturedAt: "2026-07-28T08:50:00.000Z"
    });
    expect(captured.candidates).toHaveLength(1);
    expect(captured.candidates[0]?.kind).toBe("other");
    expect(captured.candidates[0]?.sourceQuote).toContain("视觉模型");
    expect(captured.candidates[0]?.sourceQuote).toContain("团支书");
  });

  it("does not turn a mixed date clarification into invented structured identity facts", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-campus-date",
      messageId: "message-campus-date",
      turnId: "turn-campus-date",
      text: "实验室课题组是大一下学期的寒假，大概是2025.02月，做了一星期左右，在除夕前做好了，然后团支书是从大一一直到现在",
      capturedAt: "2026-07-28T08:50:00.000Z"
    });
    const fallbackItem = captured.draft.sections[0]?.items[0];
    const fallback = fallbackItem?.structuredItem;
    expect(fallback).toMatchObject({ sectionType: "other" });
    expect(fallback).not.toHaveProperty("organization");
    expect(fallback).not.toHaveProperty("role");
    expect(fallbackItem?.rawText).toContain("2025.02月");
    expect(fallbackItem?.normalizedText).toBe("原始回答已保留，等待职业化整理。");
    expect(fallbackItem?.careerNormalization).toMatchObject({
      needsNormalization: true,
      deterministicDatePatch: { startDate: "2025-02" }
    });
  });

  it("preserves a successful profile commit if a later model-only step fails", () => {
    const reducer = new AgentTaskStateReducer();
    const base = reducer.create(
      AgentRuntime.create("guided_profile_intake", "profile_complete"),
      "profile_intake"
    );
    const state = reducer.reduce({
      ...base,
      stage: "profile_complete",
      completionStatus: "waiting_for_user",
      knownSlots: {
        profileCommitResult: {
          profileId: "profile-1",
          profileVersion: 2
        }
      }
    }, {
      type: "failed",
      errorCode: "agent_model_failed"
    });

    expect(state.completionStatus).toBe("waiting_for_user");
    expect(state.lastObservation).toEqual({ errorCode: "agent_model_failed" });
  });

  it("does not guess ownership boundaries without a semantic proposal", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-learning-assistant",
      messageId: "message-learning-assistant",
      turnId: "turn-learning-assistant",
      text: "第二个开发的是 LearnSome AI Tool，是我做的学习助手。现在也有个开源 DeepDeepTurd，准确说是 DeepTutor，也是个学习助手。",
      capturedAt: "2026-07-28T06:52:08.157Z"
    });

    expect(captured.candidates).toHaveLength(1);
    expect(captured.candidates[0]?.sourceQuote).toContain("LearnSome AI Tool");
    expect(captured.candidates[0]?.sourceQuote).toContain("DeepTutor");
    expect(captured.candidates[0]?.needsConfirmation).toBe(true);
  });

  it("removes an ignored candidate from the review artifact and advances", () => {
    const reducer = new AgentTaskStateReducer();
    const base = {
      ...reducer.create(AgentRuntime.create("guided_profile_intake", "review_facts"), "profile_intake"),
      stage: "review_facts",
      completionStatus: "waiting_for_user" as const,
      knownSlots: {
        intakeCandidates: [{
          id: "candidate-deep-tutor",
          label: "DeepTutor",
          needsConfirmation: true
        }],
        intakeArtifact: {
          recognized: [],
          needsConfirmation: [{
            id: "candidate-deep-tutor",
            label: "DeepTutor",
            reason: "可能是对比产品"
          }]
        }
      }
    };

    const reviewed = reducer.reduce(base, {
      type: "tool_observation",
      toolName: "review_profile_intake",
      observation: {
        candidateId: "candidate-deep-tutor",
        decision: "reject",
        expectedDraftRevision: 2,
        unresolvedCount: 0
      }
    });

    expect(reviewed).toMatchObject({
      stage: "collect_experience",
      completionStatus: "waiting_for_user",
      knownSlots: {
        intakeArtifact: {
          recognized: [],
        needsConfirmation: [expect.objectContaining({ id: "candidate-deep-tutor" })]
        }
      }
    });
  });

  it("binds by profile id, preserves rename, and asks once before switching profiles", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.reduce(
      reducer.create(AgentRuntime.create("guided_profile_intake", "resolve_profile_target"), "profile_intake"),
      {
        type: "new_root_task",
        goal: "profile_intake",
        workflowId: "guided_profile_intake",
        stage: "resolve_profile_target"
      }
    );
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-a", name: "示例用户", version: 1 }
    });
    expect(state).toMatchObject({
      stage: "collect_experience",
      knownSlots: {
        targetProfileId: "profile-a",
        targetProfileName: "示例用户",
        expectedProfileVersion: 1
      }
    });

    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-a", name: "小明", version: 2 }
    });
    expect(state.pendingDecision).toBeUndefined();
    expect(state).toMatchObject({
      knownSlots: {
        targetProfileId: "profile-a",
        targetProfileName: "小明",
        expectedProfileVersion: 2
      }
    });

    state = {
      ...state,
      selectedEntities: {
        ...state.selectedEntities,
        resumeId: "resume-a",
        resumeRevisionId: "revision-a"
      }
    };
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_active_profile",
      observation: { selected: true, profileId: "profile-b", name: "小明 B", version: 1 }
    });
    expect(state).toMatchObject({
      stage: "resolve_profile_target",
      completionStatus: "waiting_for_user",
      pendingDecision: {
        type: "profile_intake_target",
        options: ["switch_to_active", "keep_original"]
      },
      selectedEntities: {
        profileId: "profile-a",
        resumeId: "resume-a"
      }
    });

    state = reducer.reduce(state, {
      type: "decision_selected",
      decisionType: "profile_intake_target",
      option: "switch_to_active"
    });
    expect(state).toMatchObject({
      stage: "collect_experience",
      knownSlots: { targetProfileId: "profile-b" },
      selectedEntities: { profileId: "profile-b" }
    });
    expect(state.selectedEntities.resumeId).toBeUndefined();
    expect(state.selectedEntities.resumeRevisionId).toBeUndefined();
  });

  it("rejects a selected Resume owned by another target profile before mutation", () => {
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const state = reducer.reduce({
      ...reducer.create(session, "profile_intake"),
      rootGoal: "profile_intake",
      goal: "profile_intake",
      activeGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "collect_experience",
      knownSlots: { targetProfileId: "profile-b", expectedProfileVersion: 1 },
      selectedEntities: {
        profileId: "profile-b",
        profileVersion: 1,
        resumeId: "resume-a"
      }
    }, {
      type: "tool_observation",
      toolName: "get_resume",
      observation: {
        resume: {
          id: "resume-a",
          profileId: "profile-a",
          revision: 1,
          currentRevisionId: "revision-a"
        }
      }
    });

    expect(state.selectedEntities.resumeId).toBeUndefined();
    expect(state.knownSlots.resumeOwnershipMismatch).toEqual({
      resumeId: "resume-a",
      resumeProfileId: "profile-a",
      targetProfileId: "profile-b"
    });
  });

  it("advances a legitimate export from an authoritative Resume read to export_ready", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.reduce(
      reducer.create(AgentRuntime.create("repair_and_export_resume", "select_resume"), "export_resume"),
      {
        type: "new_root_task",
        goal: "export_resume",
        workflowId: "repair_and_export_resume",
        stage: "select_resume"
      }
    );
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_resume",
      observation: {
        resume: {
          id: "resume-export",
          profileId: "profile-a",
          revision: 3,
          currentRevisionId: "revision-export"
        }
      }
    });
    expect(state).toMatchObject({
      rootGoal: "export_resume",
      workflowId: "repair_and_export_resume",
      stage: "export",
      completionStatus: "active"
    });

    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "export_resume",
      observation: {
        status: "ready_for_preview",
        route: "/resumes/resume-export/preview"
      }
    });
    expect(state).toMatchObject({
      stage: "export_ready",
      completionStatus: "completed",
      knownSlots: {
        exportResult: {
          status: "ready_for_preview",
          route: "/resumes/resume-export/preview"
        }
      }
    });
  });

  it("captures the optional General Resume decision as a workflow-specific slot answer", () => {
    const reducer = new AgentTaskStateReducer();
    const base = reducer.create(AgentRuntime.create("guided_profile_intake", "profile_complete"), "profile_intake");
    const state = reducer.reduce({
      ...base,
      rootGoal: "profile_intake",
      goal: "profile_intake",
      activeGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "profile_complete",
      completionStatus: "waiting_for_user",
      pendingDecision: {
        type: "profile_intake_post_save",
        options: ["generate_general_resume", "finish"]
      }
    }, {
      type: "user_message",
      message: "请生成一份通用简历",
      sessionId: "session-option",
      messageId: "message-option",
      turnId: "turn-option",
      capturedAt: "2026-07-27T10:09:56.725Z"
    });

    expect(state).toMatchObject({
      rootGoal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "optional_resume_decision",
      completionStatus: "active"
    });
    expect(state.pendingDecision).toBeUndefined();
  });

  it("does not turn a user assertion into a persisted mutation claim", () => {
    expect(groundMutationClaims({
      userMessage: "已修改为小明",
      text: "好的，已经记录姓名改为小明。",
      observations: []
    })).toBe("好的，我会先读取当前资料库确认后继续。");

    expect(groundMutationClaims({
      userMessage: "确认保存这些经历",
      text: "已成功保存 8 段经历到你的个人资料库。",
      observations: [{
        toolName: "commit_profile_intake",
        value: {
          profileId: "profile-a",
          profileVersion: 2,
          committedFactCount: 8,
          committedItemCount: 3
        }
      }]
    })).toBe("写入步骤已完成，正在读取核验；暂不显示个人资料库写入结论。");

    expect(groundMutationClaims({
      userMessage: "确认保存这些经历",
      text: "已成功保存 8 段经历到你的个人资料库。",
      observations: [
        {
          toolName: "commit_profile_intake",
          value: { profileId: "profile-a", profileVersion: 2, committedItemCount: 3 }
        },
        {
          toolName: "get_profile",
          value: { profile: { id: "profile-a", version: 2, name: "小明" } }
        }
      ]
    })).toBe("已写入‘小明 · V2’个人资料库。本次新增 3 项经历。");

    expect(groundMutationClaims({
      userMessage: "确认保存这些经历",
      text: "已成功保存 8 段经历到你的个人资料库。",
      observations: [{
        toolName: "commit_profile_intake",
        value: { profileId: "profile-a", profileVersion: 2 }
      }]
    })).toContain("暂不能确认资料已保存");

    expect(groundMutationClaims({
      userMessage: "把这份简历导出 PDF",
      text: "已经导出 PDF。",
      observations: [{ toolName: "export_resume", value: { status: "ready_for_preview" } }]
    })).toBe("PDF 导出入口已准备好，请在预览页确认并下载。");
  });
});
