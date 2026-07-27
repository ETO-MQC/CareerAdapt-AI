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

const REAL_LONG_PROFILE_ANSWER = [
  "示例大学计算机相关专业。",
  "课程项目使用 ESP32 做可检测心跳与摔倒的穿戴设备，我协助心跳模块、走线修复和蓝牙连接。",
  "参加示例编程竞赛并获得某省省级三等奖。",
  "在实验室用视觉模型和 Python 从近 1000 页 PDF 中提取实验数据。",
  "担任团支书，组织团日活动、信息答疑和社会实践传达。",
  "独立开发 示例任务系统 / TaskAI、示例学习助手。",
  "开发示例内容分析系统，支持多格式报告导出。",
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

  it("keeps the exact long profile narrative inside guided profile intake", () => {
    const reducer = new AgentTaskStateReducer();
    const session = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const intake = {
      ...reducer.create(session, "profile_intake"),
      rootGoal: "profile_intake",
      activeGoal: "profile_intake",
      goal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "collect_experience"
    };

    const result = reducer.reduce(intake, {
      type: "user_message",
      message: REAL_LONG_PROFILE_ANSWER
    });

    expect(result.rootGoal).toBe("profile_intake");
    expect(result.workflowId).toBe("guided_profile_intake");
    expect(result.stage).not.toBe("export_complete");
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

  it("structures one long answer into many reviewable candidates with conversation provenance", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-real-regression",
      messageId: "message-long-answer",
      turnId: "turn-long-answer",
      text: REAL_LONG_PROFILE_ANSWER,
      capturedAt: "2026-07-27T10:09:56.725Z"
    });

    expect(captured.candidates.map((candidate) => candidate.label)).toEqual(expect.arrayContaining([
      "示例大学 / 计算机相关专业",
      "ESP32 穿戴设备课程项目",
      "示例编程竞赛某省省级三等奖",
      "视觉模型 / Python PDF 数据提取",
      "团支书与团日活动",
      "示例任务系统",
      "示例学习助手",
      "示例内容采集与 AI 可信度分析",
      "CareerAdapt AI"
    ]));
    expect(captured.artifact.sources).toEqual([{
      sessionId: "session-real-regression",
      messageId: "message-long-answer",
      turnId: "turn-long-answer",
      capturedAt: "2026-07-27T10:09:56.725Z"
    }]);

    const plan = new ProfileReconciliationEngine().createPlan({
      draft: captured.draft,
      profile: demoCareerProfile,
      now: "2026-07-27T10:10:00.000Z"
    });
    expect(plan.candidates.length).toBeGreaterThanOrEqual(8);
    expect(plan.candidates[0]?.sourceProvenance[0]).toMatchObject({
      sourceType: "user_input",
      sourceSessionId: "session-real-regression",
      sourceMessageId: "message-long-answer",
      sourceTurnId: "turn-long-answer",
      sourceQuote: expect.any(String)
    });
  });

  it("keeps uncertain transcriptions reviewable instead of auto-correcting them", () => {
    const captured = adaptConversationMessageToIntakeDraft({
      sessionId: "session-ambiguous",
      messageId: "message-ambiguous",
      turnId: "turn-ambiguous",
      text: "我参加了南郊杯，项目可能叫 Smart Fox，也提到 LearnCat 和 DeepTurd。",
      capturedAt: "2026-07-27T10:09:56.725Z"
    });

    expect(captured.artifact.needsConfirmation.map((item) => item.label)).toEqual(expect.arrayContaining([
      "示例编程竞赛某省省级三等奖",
      "Smart Fox",
      "LearnCat"
    ]));
    expect(captured.draft.sections.every((section) => !section.included)).toBe(true);
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
        type: "profile_intake_resume",
        options: ["save_profile_only", "generate_general_resume"]
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
      text: "已经保存到资料库。",
      observations: [{ toolName: "commit_profile_intake", value: { profileId: "profile-a" } }]
    })).toBe("已经保存到资料库。");

    expect(groundMutationClaims({
      userMessage: "把这份简历导出 PDF",
      text: "已经导出 PDF。",
      observations: [{ toolName: "export_resume", value: { status: "ready_for_preview" } }]
    })).toBe("PDF 导出入口已准备好，请在预览页确认并下载。");
  });
});
