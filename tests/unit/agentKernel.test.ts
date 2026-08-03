import { describe, expect, it, vi } from "vitest";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import type { AgentModel, AgentModelResult } from "@/agent/model/agentModel";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";

function services(overrides: Partial<AgentToolServices> = {}): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result,
    listProfiles: result,
    listJobs: result,
    getActiveProfile: async () => ({ selected: true, profileId: "profile-1", name: "MQC" }),
    getProfile: async () => ({ profile: { id: "profile-1", name: "MQC", sectionCounts: { projects: 3 } } }),
    searchProfileFacts: async () => ({ results: [] }),
    getResume: result,
    getResumeRevision: result,
    getJob: result,
    getAgentTaskContext: result,
    searchAgentSessions: result,
    skillsList: result,
    skillView: result,
    parseResumeFile: result,
    createResumeImportDraft: result,
    commitResumeImport: result,
    parseJobDescription: result,
    commitJob: result,
    analyzeJobFit: result,
    createTailoringSession: result,
    answerTailoringQuestion: result,
    previewTailoringChanges: result,
    applyTailoringChanges: result,
    exportResume: result,
    ...overrides
  };
}

function scriptedModel(...results: AgentModelResult[]) {
  let index = 0;
  const completeWithTools = vi.fn(async () => results[Math.min(index++, results.length - 1)]);
  return { completeWithTools } satisfies AgentModel;
}

function harness(model: AgentModel, overrides: Partial<AgentToolServices> = {}, options: { maxToolCalls?: number; maxIterations?: number } = {}) {
  const registry = createAgentToolRegistry(services(overrides));
  const executor = new AgentExecutor(registry);
  return {
    kernel: new AgentKernel({
      model,
      executor,
      toolResolver: new AgentToolResolver(registry),
      ...options
    }),
    registry
  };
}

describe("AgentKernel", () => {
  it("answers direct identity questions without reading the user's profile or exposing tool protocol", async () => {
    const model = scriptedModel({ stopReason: "final", text: '{\n  "tool": "get_active_profile",\n  "input": {}\n}' });
    const getActiveProfile = vi.fn(async () => ({ selected: true, profileId: "profile-1", name: "不应被读取" }));
    const { kernel } = harness(model, { getActiveProfile });
    const events: Array<{ type: string; message?: string; delta?: string }> = [];

    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你是谁",
      emit: (event) => { events.push(event); }
    });

    expect(getActiveProfile).not.toHaveBeenCalled();
    expect(result.text).toContain("职适AI里的本地求职助手");
    expect(result.text).not.toContain("get_active_profile");
    expect(JSON.stringify(events)).not.toContain('"tool"');
  });

  it("resolves cheap tailoring context before showing only the unresolved job question", async () => {
    const getActiveProfile = vi.fn(async () => ({ selected: true, profileId: "profile-1", name: "当前资料库", version: 4 }));
    const listResumes = vi.fn(async () => ({ resumes: [{
      id: "resume-general",
      profileId: "profile-1",
      name: "通用简历",
      purpose: "general",
      revision: 2,
      currentRevisionId: "revision-general"
    }] }));
    const listJobs = vi.fn(async () => ({ jobs: [
      { id: "job-1", title: "Android研发实习生", company: "智乐活", order: 1 },
      { id: "job-2", title: "前端研发实习生", company: "云启", order: 2 },
      { id: "job-3", title: "AI产品实习生", company: "星河", order: 3 }
    ] }));
    const session = AgentRuntime.create("tailor_existing_resume", "choose_resume_source");
    session.taskState = new AgentTaskStateReducer().create(session, "create_tailored_resume");
    const model = scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [
        { id: "tailor-active-profile", name: "get_active_profile", arguments: {} },
        { id: "tailor-list-resumes", name: "list_resumes", arguments: {} },
        { id: "tailor-list-jobs", name: "list_jobs", arguments: {} }
      ]
    });
    const { kernel } = harness(model, { getActiveProfile, listResumes, listJobs });

    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "我想用现有简历生成岗位定制版本"
    });

    expect(result.text).toContain("我会使用当前资料库和《通用简历》。");
    expect(result.text).toContain("要针对哪个岗位定制？");
    expect(result.text).toContain("Android研发实习生");
    expect(result.text).toContain("前端研发实习生");
    expect(result.text).toContain("AI产品实习生");
    expect(result.text).not.toContain("个人资料库、要比较的简历、目标岗位");
    expect(getActiveProfile).toHaveBeenCalledTimes(1);
    expect(listResumes).toHaveBeenCalledTimes(1);
    expect(listJobs).toHaveBeenCalledTimes(1);
    expect(result.trajectory.toolCalls.map((call) => call.toolName)).toEqual([
      "get_active_profile",
      "list_resumes",
      "list_jobs"
    ]);
  });

  it("runs an autonomous profile-aware multi-tool loop", async () => {
    const getActiveProfile = vi.fn(async () => ({ selected: true, profileId: "profile-1", name: "MQC" }));
    const getProfile = vi.fn(async () => ({ profile: { id: "profile-1", name: "MQC", sectionCounts: { projects: 3, work: 2 } } }));
    const model = scriptedModel(
      { stopReason: "tool_calls", toolCalls: [{ id: "call-active-profile", name: "get_active_profile", arguments: {} }] },
      { stopReason: "tool_calls", toolCalls: [{ id: "call-profile-detail", name: "get_profile", arguments: { profileId: "profile-1" } }] },
      { stopReason: "final", text: "你当前选择的是 MQC 资料库，共有 5 项相关内容。" }
    );
    const { kernel } = harness(model, { getActiveProfile, getProfile });
    const events: string[] = [];
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你知道我是谁吗",
      emit: (event) => { events.push(event.type); }
    });

    expect(getActiveProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledWith({ profileId: "profile-1" }, undefined);
    expect(result.text).toContain("MQC");
    expect(result.trajectory.toolCalls.map((call) => call.toolName)).toEqual(["get_active_profile", "get_profile"]);
    expect(events).toEqual(expect.arrayContaining(["turn_ack", "tool_started", "tool_result", "assistant_start", "assistant_delta", "done"]));
  });

  it("converts an allowed textual tool protocol into a guarded tool call without exposing it", async () => {
    const getActiveProfile = vi.fn(async () => ({
      selected: true,
      profileId: "profile-1",
      name: "MQC"
    }));
    const rawToolProtocol = [
      "我先读取资料库。",
      "<tool_call>",
      "<function=get_active_profile>",
      "</function>",
      "</tool_call>"
    ].join("\n");
    const model = scriptedModel(
      { stopReason: "final", text: rawToolProtocol },
      { stopReason: "final", text: "已确认当前资料库为 MQC。" }
    );
    const events: Array<{ type: string; delta?: string; message?: string }> = [];
    const { kernel } = harness(model, { getActiveProfile });

    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你知道我是谁吗",
      emit: (event) => { events.push(event); }
    });

    expect(getActiveProfile).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("已确认当前资料库为 MQC。");
    expect(JSON.stringify(events)).not.toContain("<tool_call>");
    expect(JSON.stringify(events)).not.toContain("<function=");
  });

  it("maps the provider's read_profile textual alias to the allowed read-only tool", async () => {
    const leaked = "<tool_call><function=read_profile><parameter=profileId>profile-1</parameter></function></tool_call>";
    const getActiveProfile = vi.fn(async () => ({
      selected: true,
      profileId: "profile-1",
      name: "MQC"
    }));
    const getProfile = vi.fn(async () => ({ profile: { id: "profile-1", name: "MQC" } }));
    const model = scriptedModel(
      {
        stopReason: "tool_calls",
        toolCalls: [{ id: "resolve-active-profile", name: "get_active_profile", arguments: {} }]
      },
      { stopReason: "final", text: leaked },
      { stopReason: "final", text: "已读取当前资料库。" }
    );
    const { kernel } = harness(model, { getActiveProfile, getProfile });

    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你知道我是谁吗"
    });

    expect(getActiveProfile).toHaveBeenCalledTimes(1);
    expect(getProfile).toHaveBeenCalledTimes(1);
    expect(result.text).toBe("已读取当前资料库。");
    expect(result.trajectory.errors).toEqual([]);
  });

  it("blocks unknown textual tool protocols before they reach the conversation", async () => {
    const leaked = "<tool_call><function=delete_profile><parameter=profileId>profile-1</parameter></function></tool_call>";
    const events: Array<{ type: string; code?: string; message?: string }> = [];
    const { kernel } = harness(scriptedModel({ stopReason: "final", text: leaked }));

    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "你知道我是谁吗",
      emit: (event) => { events.push(event); }
    });

    expect(result.text).toBeUndefined();
    expect(result.trajectory.errors).toEqual([
      expect.objectContaining({ code: "provider_textual_tool_protocol" })
    ]);
    expect(JSON.stringify(events)).not.toContain("<tool_call>");
    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      code: "provider_textual_tool_protocol"
    }));
  });

  it("keeps resume review at the artifact boundary without asking the model for a tool call", async () => {
    const session = AgentRuntime.create("resume_import", "import_review", "导入简历");
    const reducer = new AgentTaskStateReducer();
    const state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-review-boundary",
      fileName: "示例用户.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      createdAt: "2026-07-29T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-review-boundary",
      expectedDraftRevision: 1,
      reviewStatus: "needs_review",
      importTargetIntent: "new",
      importTarget: { mode: "new", profileName: "启辰", createGeneralResume: true }
    };
    state.stage = "import_review";
    state.completionStatus = "waiting_for_user";
    session.taskState = state;
    const model = scriptedModel({ stopReason: "final", text: "不应调用模型" });
    const { kernel } = harness(model);

    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "审核那3项需要确认的资料"
    });

    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.trajectory.outcome).toBe("waiting_for_user");
    expect(result.text).toContain("导入核对卡");
    expect(result.text).toContain("当前不会写入资料库");
  });

  it("uses authoritative import state for an explicit conversational review decision", async () => {
    const session = AgentRuntime.create("resume_import", "import_review", "导入简历");
    const reducer = new AgentTaskStateReducer();
    const state = reducer.create(session, "import_resume");
    state.attachment = {
      id: "agent-attachment-review-decision",
      fileName: "示例用户.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size: 100,
      createdAt: "2026-07-29T00:00:00.000Z"
    };
    state.knownSlots = {
      importId: "import-review-decision",
      expectedDraftRevision: 3,
      reviewStatus: "needs_review",
      importTarget: { mode: "new", profileName: "启辰", createGeneralResume: true }
    };
    state.stage = "import_review";
    state.completionStatus = "waiting_for_user";
    session.taskState = state;
    const model = scriptedModel({ stopReason: "final", text: "不应调用模型" });
    const reviewResumeImport = vi.fn(async () => ({
      importId: "import-review-decision",
      expectedDraftRevision: 4
    }));
    const { kernel } = harness(model, { reviewResumeImport });

    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "确认这些信息，全部采用"
    });

    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(reviewResumeImport).toHaveBeenCalledWith({
      importId: "import-review-decision",
      expectedDraftRevision: 3,
      decision: "accept_all"
    }, undefined);
    expect(result.pendingConfirmation).toMatchObject({
      toolName: "commit_resume_import"
    });
  });

  it("returns a recoverable observation for equivalent repeated calls", async () => {
    const repeated = { stopReason: "tool_calls", toolCalls: [{ id: "repeat-call-id", name: "get_active_profile", arguments: {} }] } satisfies AgentModelResult;
    const { kernel } = harness(scriptedModel(repeated, repeated, { stopReason: "final", text: "已复用现有结果。" }));
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "资料库"
    });
    expect(result.trajectory.outcome).toBe("completed");
    expect(result.text).toBeTruthy();
  });

  it("stops a persistently repeated empty fact search without reaching the safety budget", async () => {
    const searchProfileFacts = vi.fn(async () => ({ results: [] }));
    const repeatedEmptySearch = {
      stopReason: "tool_calls",
      toolCalls: [{
        id: "repeat-empty-facts",
        name: "search_profile_facts",
        arguments: {
          profileId: "profile-1",
          query: "Smart Focus AI"
        }
      }]
    } satisfies AgentModelResult;
    const model = scriptedModel(repeatedEmptySearch);
    const events: Array<{ type: string; toolName?: string }> = [];
    const { kernel } = harness(model, { searchProfileFacts });
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "collect_experience",
      completionStatus: "active" as const,
      selectedEntities: { profileId: "profile-1" }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "继续整理 Smart Focus AI 的经历",
      taskEventAlreadyReduced: true,
      emit: (event) => {
        events.push(event);
      }
    });

    expect(searchProfileFacts).toHaveBeenCalledTimes(1);
    expect(model.completeWithTools).toHaveBeenCalledTimes(2);
    expect(events.filter((event) =>
      event.type === "tool_result"
      && event.toolName === "search_profile_facts"
    )).toHaveLength(1);
    expect(result.text).toContain("不会重复查询");
    expect(result.text).not.toContain("当前步骤没有成功推进");
    expect(result.text).not.toContain("重试刚才");
    expect(result.trajectory.errors).toEqual([]);
    expect(result.trajectory.outcome).toBe("waiting_for_user");
  });

  it("replaces generic no-progress recovery after an empty fact search with a specific next input", async () => {
    const searchProfileFacts = vi.fn(async () => ({ results: [] }));
    const model = scriptedModel(
      {
        stopReason: "tool_calls",
        toolCalls: [{
          id: "empty-facts-before-no-progress",
          name: "search_profile_facts",
          arguments: {
            profileId: "profile-1",
            query: "不存在的经历"
          }
        }]
      },
      { stopReason: "final", text: "我会继续处理。" },
      { stopReason: "final", text: "我会继续处理。" }
    );
    const { kernel } = harness(model, { searchProfileFacts });
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "collect_experience",
      completionStatus: "active" as const,
      selectedEntities: { profileId: "profile-1" }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "继续整理这段经历",
      taskEventAlreadyReduced: true
    });

    expect(searchProfileFacts).toHaveBeenCalledTimes(1);
    expect(model.completeWithTools).toHaveBeenCalledTimes(3);
    expect(result.text).toContain("项目名称、你做了什么和结果");
    expect(result.text).not.toContain("当前步骤没有成功推进");
    expect(result.text).not.toContain("重试刚才");
    expect(result.trajectory.errors).toEqual([]);
  });

  it("enforces the total tool-call budget", async () => {
    const { kernel } = harness(scriptedModel(
      { stopReason: "tool_calls", toolCalls: [{ id: "budget-call-one", name: "get_active_profile", arguments: {} }] },
      { stopReason: "tool_calls", toolCalls: [{ id: "budget-call-two", name: "list_profiles", arguments: {} }] }
    ), {}, { maxToolCalls: 1 });
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "资料库"
    });
    expect(result.trajectory.errors[0]?.code).toBe("agent_tool_budget_exceeded");
  });

  it("stops at confirmation without executing a write", async () => {
    const commitJob = vi.fn(async () => ({ jobId: "job-1" }));
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{ id: "confirm-job-call", name: "commit_job", arguments: { title: "AI 训练师", company: "A", rawText: "x".repeat(30), graph: {} } }]
    }), { commitJob });
    const base = AgentRuntime.create("job_ingestion", "confirm_commit");
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.create(base, "apply_to_job");
    for (const [slot, value] of Object.entries({
      title: "AI 训练师",
      company: "A",
      rawText: "x".repeat(30),
      graph: {}
    })) {
      taskState = reducer.reduce(taskState, { type: "slot_answer", slot, value });
    }
    taskState = { ...taskState, completionStatus: "active" };
    const session = { ...base, taskState };
    const result = await kernel.runTurn({
      session,
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "确认保存岗位"
    });
    expect(commitJob).not.toHaveBeenCalled();
    expect(result.trajectory.errors).toEqual([]);
    expect(result.pendingConfirmation?.toolName).toBe("commit_job");
    expect(result.trajectory.outcome).toBe("waiting_for_confirmation");
  });

  it("creates the profile intake confirmation deterministically at the confirmation boundary", async () => {
    const model = scriptedModel({ stopReason: "final", text: "不应由模型只输出一句请确认。" });
    const { kernel } = harness(model);
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "confirm_commit");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      rootGoal: "profile_intake",
      activeGoal: "profile_intake",
      goal: "profile_intake",
      workflowId: "guided_profile_intake",
      stage: "confirm_commit",
      completionStatus: "active" as const,
      knownSlots: {
        intakeImportId: "intake-1",
        expectedIntakeDraftRevision: 1,
        expectedIntakeReconciliationRevision: 1,
        targetProfileId: "profile-1",
        expectedProfileVersion: 1,
        acknowledgedActiveProfileId: "profile-1"
      },
      selectedEntities: {
        profileId: "profile-1",
        profileVersion: 1
      }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "请让我确认后再写入",
      taskEventAlreadyReduced: true
    });

    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.pendingConfirmation).toMatchObject({
      toolName: "commit_profile_intake",
      title: "确认写入个人资料库"
    });
    expect(result.pendingCall?.input).toMatchObject({
      importId: "intake-1",
      expectedDraftRevision: 1,
      expectedReconciliationRevision: 1,
      targetProfileId: "profile-1",
      expectedProfileVersion: 1
    });
  });

  it("finishes profile commit messaging without another model request", async () => {
    const model = scriptedModel({
      stopReason: "final",
      text: "不应请求模型生成提交后的总结。"
    });
    const { kernel } = harness(model);
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "profile_complete");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      workflowId: "guided_profile_intake",
      stage: "profile_complete",
      completionStatus: "waiting_for_user" as const,
      pendingDecision: {
        type: "profile_intake_resume" as const,
        options: ["save_profile_only" as const, "generate_general_resume" as const]
      },
      knownSlots: {
        profileCommitResult: {
          profileId: "profile-1",
          profileVersion: 2,
          committedItemCount: 8
        }
      }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "导入",
      taskEventAlreadyReduced: true
    });

    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.text).toContain("资料已成功保存");
    expect(result.trajectory.outcome).toBe("waiting_for_user");
    expect(result.taskState?.completionStatus).toBe("waiting_for_user");
  });

  it("settles tailoring after apply without a second provider request", async () => {
    const model = scriptedModel({ stopReason: "final", text: "不应再次请求 provider。" });
    const { kernel } = harness(model);
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("tailor_existing_resume", "confirm_apply");
    const taskState = {
      ...reducer.create(base, "create_tailored_resume"),
      workflowId: "tailor_existing_resume",
      rootGoal: "create_tailored_resume",
      activeGoal: "confirm_apply",
      goal: "create_tailored_resume",
      stage: "confirm_apply" as const,
      completionStatus: "active" as const,
      selectedEntities: {
        profileId: "profile-1",
        resumeId: "resume-general",
        jobId: "job-1"
      },
      knownSlots: {
        fitAnalysis: { fitScore: 0.8 },
        tailoringSession: { id: "tailoring-1" },
        previewComplete: true,
        confirmationAccepted: true
      }
    };

    const result = await kernel.resumeTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      reason: "tool_observation",
      toolName: "apply_tailoring_changes",
      observation: {
        branchId: "resume-job-1",
        revisionId: "revision-job-1",
        qualityResult: { status: "passed", factGuard: "passed" }
      }
    });

    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.text).toContain("新的岗位定制简历版本已创建");
    expect(result.trajectory.outcome).toBe("completed");
    expect(result.taskState).toMatchObject({ stage: "quality_result", completionStatus: "completed" });
  });

  it("continues a profile interview without treating the command as stalled work", async () => {
    const model = scriptedModel({
      stopReason: "final",
      text: "好，我们继续。你想先整理实习、项目、校园活动还是技能证书？"
    });
    const { kernel } = harness(model);
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "collect_experience");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "collect_experience",
      completionStatus: "waiting_for_user" as const
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "继续添加经历",
      turnIntent: "continue_current_task"
    });

    expect(model.completeWithTools).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("你想先整理");
    expect(result.text).not.toContain("暂时没有新进展");
    expect(result.taskState).toMatchObject({
      stage: "collect_experience",
      completionStatus: "waiting_for_user"
    });
    expect(result.taskState?.knownSlots).not.toHaveProperty("latestIntakeSource");
  });

  it("captures a submitted experience deterministically before asking the model for the next step", async () => {
    const model = scriptedModel({
      stopReason: "final",
      text: "我已整理出可核对的经历候选，请先确认其中标记不确定的内容。"
    });
    const captureProfileIntake = vi.fn(async () => {
      expect(model.completeWithTools).not.toHaveBeenCalled();
      return {
        importId: "intake-long-answer",
        expectedDraftRevision: 0,
        targetProfileId: "profile-1",
        expectedProfileVersion: 1,
        candidateCount: 4,
        needsConfirmationCount: 2,
        candidates: [{ id: "candidate-1" }],
        artifactPayload: { title: "经历核对" }
      };
    });
    const { kernel } = harness(model, { captureProfileIntake });
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "structure_facts");
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "structure_facts",
      completionStatus: "active" as const,
      knownSlots: {
        targetProfileId: "profile-1",
        expectedProfileVersion: 1,
        acknowledgedActiveProfileId: "profile-1",
        latestIntakeSource: {
          sessionId: base.id,
          messageId: "message-long-answer",
          turnId: "turn-long-answer",
          exactSourceQuote: "我参加课程项目，负责心跳模块、摔倒模块和蓝牙联调。",
          capturedAt: "2026-07-28T05:00:00.000Z"
        }
      },
      selectedEntities: {
        profileId: "profile-1",
        profileVersion: 1
      }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "我参加课程项目，负责心跳模块、摔倒模块和蓝牙联调。",
      taskEventAlreadyReduced: true
    });

    expect(captureProfileIntake).toHaveBeenCalledTimes(1);
    expect(model.completeWithTools).toHaveBeenCalledTimes(1);
    expect(result.taskState).toMatchObject({
      stage: "review_facts",
      completionStatus: "waiting_for_user",
      knownSlots: {
        intakeImportId: "intake-long-answer",
        expectedIntakeDraftRevision: 0
      }
    });
    expect(result.trajectory.errors).toEqual([]);
  });

  it("binds a profile candidate name correction to the existing review draft", async () => {
    const reviewProfileIntake = vi.fn(async () => ({
      importId: "intake-1",
      expectedDraftRevision: 2,
      candidateId: "candidate-smart",
      decision: "accept" as const,
      editedLabel: "Smart Focus AI",
      unresolvedCount: 1
    }));
    const model = scriptedModel(
      {
        stopReason: "tool_calls",
        toolCalls: [{
          id: "review-smart-focus",
          name: "review_profile_intake",
          arguments: {
            candidateId: "candidate-smart",
            decision: "accept",
            editedLabel: "Smart Focus AI"
          }
        }]
      },
      { stopReason: "final", text: "已按你的更正更新项目名称。" }
    );
    const { kernel } = harness(model, { reviewProfileIntake });
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("guided_profile_intake", "review_facts");
    const candidate = {
      id: "candidate-smart",
      label: "Smart Fox",
      needsConfirmation: true,
      reason: "名称需要确认"
    };
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "review_facts",
      completionStatus: "waiting_for_user" as const,
      knownSlots: {
        intakeImportId: "intake-1",
        expectedIntakeDraftRevision: 1,
        intakeCandidates: [candidate],
        intakeArtifact: {
          recognized: [],
          needsConfirmation: [candidate]
        }
      }
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "就叫 Smart Focus AI 吧",
      taskEventAlreadyReduced: true,
      turnIntent: "clarification_answer"
    });

    expect(reviewProfileIntake).toHaveBeenCalledWith({
      importId: "intake-1",
      expectedDraftRevision: 1,
      candidateId: "candidate-smart",
      decision: "accept",
      editedLabel: "Smart Focus AI"
    }, undefined);
    expect(result.taskState).toMatchObject({
      stage: "review_facts",
      knownSlots: {
        expectedIntakeDraftRevision: 2,
        intakeArtifact: {
          recognized: [expect.objectContaining({
            id: "candidate-smart",
            label: "Smart Focus AI"
          })],
          needsConfirmation: []
        }
      }
    });
  });

  it("offers executable retry and exit paths when a step genuinely cannot progress", async () => {
    const repeated = { stopReason: "final" as const, text: "我会继续处理。" };
    const { kernel } = harness(scriptedModel(repeated, repeated));
    const base = AgentRuntime.create("guided_profile_intake", "unmapped_stage");
    const reducer = new AgentTaskStateReducer();
    const taskState = {
      ...reducer.create(base, "profile_intake"),
      stage: "unmapped_stage",
      completionStatus: "active" as const
    };

    const result = await kernel.runTurn({
      session: { ...base, taskState },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "继续",
      taskEventAlreadyReduced: true
    });

    expect(result.text).toContain("重试刚才");
    expect(result.text).toContain("结束任务");
    expect(result.text).toContain("直接告诉我你想改做什么");
    expect(result.text).not.toContain("这项任务暂时没有新进展");
    expect(result.taskState?.completionStatus).toBe("waiting_for_user");
  });

  it("reports a concrete tool failure and does not offer the same non-retryable tool again", async () => {
    const model = {
      completeWithTools: vi.fn()
        .mockResolvedValueOnce({
          stopReason: "tool_calls" as const,
          toolCalls: [{
            id: "read-missing-session",
            name: "get_agent_task_context",
            arguments: { sessionId: "missing-session" }
          }]
        })
        .mockImplementationOnce(async (request: Parameters<AgentModel["completeWithTools"]>[0]) => {
          expect(request.tools.map((tool) => tool.name)).not.toContain("get_agent_task_context");
          return { stopReason: "final" as const, text: "没有找到该历史任务，请选择仍然存在的任务。" };
        })
    } satisfies AgentModel;
    const missingSession = Object.assign(new Error("Agent session no longer exists."), {
      code: "agent_session_not_found"
    });
    const events: Array<{ type: string; summary?: string }> = [];
    const { kernel } = harness(model, {
      getAgentTaskContext: vi.fn(async () => {
        throw missingSession;
      })
    });

    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "读取上次任务",
      emit: (event) => {
        events.push(event);
      }
    });

    expect(model.completeWithTools).toHaveBeenCalledTimes(2);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool_result",
      summary: expect.stringContaining("读取指定任务的当前进度未完成：指定会话不存在或已失效")
    }));
    expect(result.text).toContain("没有找到该历史任务");
  });

  it("rejects a tool hidden by the current workflow step", async () => {
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{ id: "hidden-commit-call", name: "commit_job", arguments: { title: "A", company: "B", rawText: "x".repeat(30), graph: {} } }]
    }));
    const result = await kernel.runTurn({
      session: AgentRuntime.create("job_ingestion", "parse_job"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "分析这个岗位"
    });
    expect(result.trajectory.errors[0]?.code).toBe("agent_tool_not_allowed");
  });

  it("records the one active tailoring answer without a second confirmation", async () => {
    const answerTailoringQuestion = vi.fn(async () => ({ session: { status: "updated" } }));
    const { kernel } = harness(scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{
        id: "user-fact-answer-call",
        name: "answer_tailoring_question",
        arguments: { session: {}, questionId: "q-ai", answer: "熟悉模型训练", proficiency: "familiar" }
      }]
    }), { answerTailoringQuestion });
    const base = AgentRuntime.create("tailor_existing_resume", "answer_questions");
    const state = new AgentTaskStateReducer().create(base, "create_tailored_resume");
    const result = await kernel.runTurn({
      session: {
        ...base,
        taskState: {
          ...state,
          stage: "clarify_unsupported_facts",
          completionStatus: "active",
          knownSlots: {
            ...state.knownSlots,
            activeQuestionId: "q-ai",
            currentClarification: { id: "q-ai", question: "你是否有模型训练经验？" },
            questionPlan: { questionIds: ["q-ai"], activeQuestionId: "q-ai" },
            tailoringSession: {}
          }
        }
      },
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "我补充一条 AI 能力"
    });
    expect(answerTailoringQuestion).toHaveBeenCalledTimes(1);
    expect(result.pendingConfirmation).toBeUndefined();
  });

  it("honors an already-aborted turn", async () => {
    const controller = new AbortController();
    controller.abort();
    const model = scriptedModel({ stopReason: "final", text: "never" });
    const { kernel } = harness(model);
    const result = await kernel.runTurn({
      session: AgentRuntime.create("agent_quick_action", "collecting_intent"),
      pageContext: { pathname: "/ai-workspace", query: {} },
      userMessage: "停止",
      signal: controller.signal
    });
    expect(model.completeWithTools).not.toHaveBeenCalled();
    expect(result.trajectory.outcome).toBe("aborted");
  });
});
