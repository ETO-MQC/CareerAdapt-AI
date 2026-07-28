import { describe, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import {
  deriveNextLegalStage,
  resolveContinuationIntent
} from "@/agent/runtime/TaskContinuationResolver";
import { projectTaskStateToWorkflowState } from "@/agent/runtime/projectTaskStateToWorkflowState";
import { AgentTaskCompletionGuard } from "@/agent/kernel/AgentTaskCompletionGuard";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import { AgentProductCapabilityManifest, RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentSessionSchema, AgentTaskStateSchema, type AgentSession, type AgentTaskState } from "@/agent/contracts/agentSession";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";

function routeTurn(
  reducer: AgentTaskStateReducer,
  state: AgentTaskState,
  message: string
) {
  const decision = classifyTurnIntent({ text: message, taskState: state });
  let routed = state;
  if (decision.newTask && decision.taskMutation === "replace") {
    routed = reducer.reduce(routed, { type: "new_root_task", ...decision.newTask });
  } else if (decision.newTask && decision.taskMutation === "continue") {
    routed = reducer.reduce(routed, { type: "new_active_task", ...decision.newTask });
  }
  return reducer.reduce(routed, {
    type: "user_message",
    message,
    turnIntent: decision.intent
  });
}

describe("P4.2a.3b canonical task runtime", () => {
  it("replaces a stale quick-action workflow and uses the task workflow for every later resolution", () => {
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const reducer = new AgentTaskStateReducer();
    const task = routeTurn(reducer, reducer.create(base), "基于现有简历做岗位定制");
    const staleSession = { ...base, taskState: task };
    const names = new AgentToolResolver(createAgentToolRegistry(services())).allowedTools({
      workflowId: base.workflowState.workflowId,
      step: base.workflowState.step,
      skills: [],
      session: staleSession,
      userMessage: "基于现有简历做岗位定制"
    }).map((tool) => tool.name);

    expect(task.workflowId).toBe("tailor_existing_resume");
    expect(task.stage).toBe("choose_resume_source");
    expect(names).toContain("list_resumes");
    expect(projectTaskStateToWorkflowState(task, base.workflowState)).toMatchObject({
      workflowId: "tailor_existing_resume",
      step: "choose_resume_source"
    });
  });

  it("treats continuation phrases as intent and derives the next stage from unresolved facts", () => {
    const state = tailoringState("preview_changes");
    const unresolved = {
      ...state,
      knownSlots: {
        ...state.knownSlots,
        tailoringSession: {
          plan: {
            clarificationQuestions: [{ id: "q-1" }],
            clarificationAnswers: []
          }
        }
      }
    };
    expect(resolveContinuationIntent(unresolved, "就按这些改")).toMatchObject({
      consumed: true,
      intent: "continue"
    });
    expect(deriveNextLegalStage(unresolved)).toBe("clarify_unsupported_facts");

    const resolved = {
      ...unresolved,
      knownSlots: {
        ...unresolved.knownSlots,
        tailoringSession: {
          plan: {
            clarificationQuestions: [{ id: "q-1" }],
            clarificationAnswers: [{ questionId: "q-1", answer: "确认" }]
          }
        }
      }
    };
    expect(deriveNextLegalStage(resolved)).toBe("preview_changes");
  });

  it("finishes fit analysis without entering tailoring and blocks unknown domain goals", () => {
    const reducer = new AgentTaskStateReducer();
    let analysis = reducer.create(AgentRuntime.create("analyze_job_fit", "analyze_fit"), "analyze_job_fit");
    analysis = reducer.reduce(analysis, {
      type: "tool_observation",
      toolName: "analyze_job_fit",
      observation: { analysis: { score: 88 } },
      artifactIds: ["fit-1"]
    });
    expect(analysis).toMatchObject({ stage: "completed", completionStatus: "completed" });
    expect(new AgentTaskCompletionGuard().evaluate(analysis)).toMatchObject({
      canFinish: true,
      reason: "analysis_complete"
    });

    const unknown = {
      ...analysis,
      goal: "unknown_domain_mutation",
      rootGoal: "unknown_domain_mutation",
      activeGoal: "unknown_domain_mutation",
      workflowId: "tailor_existing_resume",
      stage: "generate_plan",
      completionStatus: "active" as const
    };
    expect(new AgentTaskCompletionGuard().evaluate(unknown)).toMatchObject({
      canFinish: false,
      requiredNextStage: "clarification_required"
    });
  });

  it("normalizes a pasted JD into ingest_job instead of a broad application goal", () => {
    const reducer = new AgentTaskStateReducer();
    const jd = `岗位：AI训练师
公司：示例科技
岗位职责：负责训练数据设计、质量验收与迭代复盘，维护可追溯的任务记录。
任职要求：具备 AI 应用、数据分析和清晰书面沟通能力。`.repeat(3);
    let state = routeTurn(
      reducer,
      reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent")),
      jd
    );
    expect(state).toMatchObject({
      goal: "ingest_job",
      rootGoal: "ingest_job",
      activeGoal: "ingest_job",
      workflowId: "job_ingestion",
      stage: "parse_job"
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "parse_job_description",
      observation: {
        graph: { requirements: [] },
        candidateTitle: "AI训练师",
        candidateCompany: "示例科技"
      }
    });
    expect(state.stage).toBe("review_job");
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "commit_job",
      observation: { jobId: "job-ai-trainer" }
    });
    expect(state).toMatchObject({ stage: "completed", completionStatus: "completed" });
  });

  it("sets ingest_job as the root before the user supplies the JD", () => {
    const reducer = new AgentTaskStateReducer();
    const state = routeTurn(
      reducer,
      reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent")),
      "录入这个岗位"
    );
    expect(state).toMatchObject({
      rootGoal: "ingest_job",
      activeGoal: "ingest_job",
      workflowId: "job_ingestion",
      stage: "collect_job_description",
      completionStatus: "active"
    });
  });

  it("keeps apply_to_job as the root goal while ingest_job is an active subtask", () => {
    const reducer = new AgentTaskStateReducer();
    const jd = `岗位：AI训练师
公司：示例科技
岗位职责：负责训练数据设计、质量验收与迭代复盘，维护可追溯的任务记录。
任职要求：具备 AI 应用、数据分析和清晰书面沟通能力。`.repeat(3);
    let state = routeTurn(
      reducer,
      reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent")),
      "我想应聘这个岗位"
    );
    expect(state).toMatchObject({
      rootGoal: "apply_to_job",
      activeGoal: "apply_to_job"
    });

    state = routeTurn(reducer, state, jd);
    expect(state).toMatchObject({
      goal: "apply_to_job",
      rootGoal: "apply_to_job",
      activeGoal: "ingest_job",
      workflowId: "job_ingestion",
      stage: "parse_job"
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "parse_job_description",
      observation: {
        graph: { requirements: [] },
        candidateTitle: "AI训练师",
        candidateCompany: "示例科技"
      }
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "commit_job",
      observation: { jobId: "job-ai-trainer" }
    });

    expect(state).toMatchObject({
      rootGoal: "apply_to_job",
      activeGoal: "resolve_resume_source",
      workflowId: "tailor_existing_resume",
      stage: "choose_resume_source",
      completionStatus: "active",
      selectedEntities: { jobId: "job-ai-trainer" }
    });
    expect(new AgentTaskCompletionGuard().evaluate(state)).toMatchObject({
      canFinish: false,
      requiredNextStage: "choose_resume_source"
    });
  });

  it("does not let fit analysis complete a tailoring root goal", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(
      AgentRuntime.create("tailor_existing_resume", "analyze_fit"),
      "create_tailored_resume"
    );
    state = {
      ...state,
      selectedEntities: {
        profileId: "profile-1",
        resumeId: "resume-general",
        jobId: "job-ai-trainer"
      }
    };
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "analyze_job_fit",
      observation: { analysis: { score: 88 } }
    });
    expect(state).toMatchObject({
      rootGoal: "create_tailored_resume",
      activeGoal: "create_tailored_resume",
      stage: "generate_plan",
      completionStatus: "active"
    });
    expect(new AgentTaskCompletionGuard().evaluate(state)).toMatchObject({
      canFinish: false,
      requiredNextStage: "generate_plan"
    });
  });

  it("does not let an ingestion subtask complete a create_tailored_resume root goal", () => {
    const reducer = new AgentTaskStateReducer();
    const state = reducer.reduce({
      ...reducer.create(
        AgentRuntime.create("job_ingestion", "confirm_commit"),
        "create_tailored_resume"
      ),
      activeGoal: "ingest_job",
      knownSlots: {
        rawText: "岗位职责与任职要求",
        graph: { requirements: [] },
        title: "AI训练师",
        company: "目标科技"
      }
    }, {
      type: "tool_observation",
      toolName: "commit_job",
      observation: { jobId: "job-ai-trainer" }
    });
    expect(state).toMatchObject({
      rootGoal: "create_tailored_resume",
      activeGoal: "resolve_resume_source",
      stage: "choose_resume_source",
      completionStatus: "active",
      selectedEntities: { jobId: "job-ai-trainer" }
    });
  });

  it("migrates legacy goal state and persists root/subtask semantics across reload", () => {
    const migrated = AgentTaskStateSchema.parse({
      goal: "apply_to_job",
      workflowId: "job_ingestion",
      stage: "completed",
      requiredSlots: [],
      knownSlots: {},
      missingSlots: [],
      selectedEntities: { jobId: "job-1" },
      artifacts: [],
      completionStatus: "active",
      computeTier: "T3",
      updatedAt: new Date().toISOString()
    });
    expect(migrated).toMatchObject({
      rootGoal: "apply_to_job",
      activeGoal: "apply_to_job"
    });

    const base = AgentRuntime.create("tailor_existing_resume", "clarify_unsupported_facts");
    const persisted = AgentSessionSchema.parse({
      ...base,
      activeResumeId: "resume-1",
      activeJobId: "job-1",
      taskState: {
        ...migrated,
        activeGoal: "create_tailored_resume",
        workflowId: "tailor_existing_resume",
        stage: "clarify_unsupported_facts",
        selectedEntities: {
          resumeId: "resume-1",
          jobId: "job-1"
        },
        completionStatus: "waiting_for_user"
      }
    });
    expect(persisted.taskState).toMatchObject({
      goal: "apply_to_job",
      rootGoal: "apply_to_job",
      activeGoal: "create_tailored_resume",
      stage: "clarify_unsupported_facts",
      selectedEntities: {
        resumeId: "resume-1",
        jobId: "job-1"
      }
    });
  });

  it("derives the compatibility goal from rootGoal and never lets a stale legacy goal overwrite it", () => {
    const timestamp = new Date().toISOString();
    const fresh = AgentTaskStateSchema.parse({
      goal: "stale_ingest_job",
      rootGoal: "apply_to_job",
      activeGoal: "analyze_job_fit",
      workflowId: "tailor_existing_resume",
      stage: "analyze_fit",
      requiredSlots: [],
      knownSlots: {},
      missingSlots: [],
      selectedEntities: {},
      artifacts: [],
      completionStatus: "active",
      computeTier: "T3",
      updatedAt: timestamp
    });
    expect(fresh.goal).toBe(fresh.rootGoal);
    expect(fresh.rootGoal).toBe("apply_to_job");

    const legacy = AgentTaskStateSchema.parse({
      goal: "create_tailored_resume",
      workflowId: "tailor_existing_resume",
      stage: "choose_resume_source",
      updatedAt: timestamp
    });
    expect(legacy).toMatchObject({
      goal: "create_tailored_resume",
      rootGoal: "create_tailored_resume",
      activeGoal: "create_tailored_resume"
    });
  });

  it("persists a typed resume route decision and resumes the correct stage after reload", () => {
    const reducer = new AgentTaskStateReducer();
    let state = reducer.create(
      AgentRuntime.create("tailor_existing_resume", "choose_resume_source"),
      "apply_to_job"
    );
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "recommend_resume_source",
      observation: {
        recommendedResumeId: "resume-general",
        recommendation: { route: "existing_resume", resumeId: "resume-general" }
      }
    });
    const reloaded = AgentTaskStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(reloaded.pendingDecision).toEqual({
      type: "resume_source_route",
      options: ["profile", "existing_resume"]
    });

    const selected = reducer.reduce(reloaded, {
      type: "decision_selected",
      decisionType: "resume_source_route",
      option: "existing_resume"
    });
    expect(selected).toMatchObject({
      rootGoal: "apply_to_job",
      activeGoal: "analyze_job_fit",
      stage: "analyze_fit",
      selectedEntities: { resumeId: "resume-general" }
    });
    expect(selected.pendingDecision).toBeUndefined();
  });

  it("invalidates every downstream result when the selected resume revision changes", () => {
    const reducer = new AgentTaskStateReducer();
    const seeded = {
      ...tailoringState("confirm_apply"),
      selectedEntities: {
        profileId: "profile-1",
        profileVersion: 3,
        resumeId: "resume-1",
        resumeRevisionId: "revision-a",
        resumeHash: "hash-a",
        jobId: "job-1",
        jobRevision: "job-revision-a",
        jobGraphHash: "job-hash-a",
        tailoringSessionId: "tailoring-1"
      },
      knownSlots: {
        fitAnalysis: { score: 80 },
        tailoringSession: { id: "tailoring-1" },
        selectedDiffs: [{ id: "diff-1" }],
        confirmedRequirementIds: ["requirement-1"],
        currentClarification: { id: "question-1" },
        previewComplete: true,
        confirmationAccepted: true,
        qualityResult: { status: "passed" },
        pendingConfirmation: { toolName: "apply_tailoring_changes", operationId: "operation-1" }
      },
      dependencySnapshots: {
        fitResult: { resumeId: "resume-1", resumeRevisionId: "revision-a" },
        tailoringSession: { resumeId: "resume-1", resumeRevisionId: "revision-a" },
        clarificationAnswers: { resumeId: "resume-1", resumeRevisionId: "revision-a" },
        preview: { resumeId: "resume-1", resumeRevisionId: "revision-a" },
        pendingApplyConfirmation: { resumeId: "resume-1", resumeRevisionId: "revision-a" },
        qualityResult: { resumeId: "resume-1", resumeRevisionId: "revision-a" }
      }
    };
    const invalidated = reducer.reduce(AgentTaskStateSchema.parse(seeded), {
      type: "entity_revision",
      entityType: "resume",
      entityId: "resume-1",
      revisionId: "revision-b",
      hash: "hash-b"
    });
    expect(invalidated).toMatchObject({
      rootGoal: "create_tailored_resume",
      activeGoal: "analyze_job_fit",
      stage: "analyze_fit",
      selectedEntities: {
        resumeId: "resume-1",
        resumeRevisionId: "revision-b",
        resumeHash: "hash-b"
      },
      dependencySnapshots: {}
    });
    expect(invalidated.knownSlots).not.toHaveProperty("fitAnalysis");
    expect(invalidated.knownSlots).not.toHaveProperty("tailoringSession");
    expect(invalidated.knownSlots).not.toHaveProperty("previewComplete");
    expect(invalidated.knownSlots).not.toHaveProperty("pendingConfirmation");
    expect(invalidated.knownSlots).not.toHaveProperty("qualityResult");
  });

  it.each([
    ["choose_resume_source", ["list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts", "get_resume", "get_resume_revision", "get_job", "recommend_resume_source"]],
    ["analyze_fit", ["list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts", "get_resume", "get_resume_revision", "get_job", "analyze_job_fit"]],
    ["generate_plan", ["list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts", "get_resume", "get_resume_revision", "get_job", "create_tailoring_session"]],
    ["clarify_unsupported_facts", ["answer_tailoring_question"]],
    ["preview_changes", ["list_resumes", "list_profiles", "list_jobs", "get_active_profile", "get_profile", "search_profile_facts", "get_resume", "get_resume_revision", "get_job", "preview_tailoring_changes"]],
    ["confirm_apply", ["apply_tailoring_changes"]],
    ["quality_result", ["list_resumes", "get_resume", "get_resume_revision"]]
  ])("exposes the exact Route B tools at %s", (stage, expected) => {
    const state = tailoringState(stage);
    const session = {
      ...AgentRuntime.create("agent_quick_action", "collecting_intent"),
      taskState: state
    };
    const names = new AgentToolResolver(createAgentToolRegistry(services())).allowedTools({
      workflowId: "agent_quick_action",
      step: "collecting_intent",
      skills: [],
      session,
      userMessage: "继续"
    }).map((tool) => tool.name);
    expect(names).toEqual(expected);
  });

  it("uses one truthful product manifest and repository-backed archive semantics", async () => {
    expect(RESUME_IMPORT_ACCEPT).toContain(".docx");
    expect(RESUME_IMPORT_ACCEPT).not.toContain(".rtf");
    expect(AgentProductCapabilityManifest.inputFormats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "pdf",
        productStatus: "available",
        entrypoints: { manual: "available", agent: "available" }
      }),
      expect.objectContaining({
        id: "docx",
        productStatus: "available",
        entrypoints: { manual: "available", agent: "available" }
      }),
      expect.objectContaining({
        id: "json",
        productStatus: "available",
        entrypoints: { manual: "available", agent: "available" }
      }),
      expect.objectContaining({
        id: "png",
        productStatus: "partial",
        entrypoints: { manual: "partial", agent: "unavailable" }
      }),
      expect.objectContaining({
        id: "jpeg",
        productStatus: "partial",
        entrypoints: { manual: "partial", agent: "unavailable" }
      })
    ]));
    expect(AgentProductCapabilityManifest.supportedExportFormats.map((item) => item.id)).toEqual(["pdf", "json"]);

    const repository = {
      getResumeBranch: vi.fn(async () => ({
        id: "resume-1",
        lifecycleStatus: "active",
        revision: 4
      })),
      archiveResumeBranch: vi.fn(async () => ({
        branch: { id: "resume-1", lifecycleStatus: "archived", revision: 5 },
        idempotent: false
      }))
    };
    const result = await new BrowserAgentToolService(repository as never).archiveResume({
      resumeId: "resume-1",
      expectedRevision: 4
    }, "archive-operation-1");
    expect(repository.archiveResumeBranch).toHaveBeenCalledWith({
      branchId: "resume-1",
      expectedRevision: 4,
      operationId: "archive-operation-1",
      confirmedImpact: true
    });
    expect(result).toMatchObject({ lifecycleStatus: "archived", revision: 5 });
    expect(result).not.toHaveProperty("route");
  });

  it("resolves the latest general resume before exposing archive_resume", () => {
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    let state = reducer.reduce(reducer.create(base), {
      type: "user_message",
      message: "归档最新的通用简历"
    });
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "list_resumes",
      observation: {
        resumes: [{
          id: "resume-general",
          purpose: "general",
          revision: 1,
          updatedAt: new Date().toISOString()
        }]
      }
    });
    const tools = new AgentToolResolver(createAgentToolRegistry(services())).allowedTools({
      workflowId: base.workflowState.workflowId,
      step: base.workflowState.step,
      skills: [],
      session: { ...base, taskState: state },
      userMessage: "归档最新的通用简历"
    });
    expect(state.selectedEntities.resumeId).toBe("resume-general");
    expect(tools.map((tool) => tool.name)).toContain("archive_resume");
  });

  it("recovers orphaned thinking when a persisted session is adopted without a live turn", () => {
    const base = AgentRuntime.create("tailor_existing_resume", "clarify_unsupported_facts");
    const session: AgentSession = {
      ...base,
      messages: [{
        id: "thinking-1",
        turnId: "turn-1",
        role: "assistant",
        content: "正在处理",
        kind: "assistant_thinking",
        type: "assistant_thinking",
        status: "thinking",
        streaming: true,
        createdAt: new Date().toISOString()
      }],
      activeTurn: {
        id: "turn-1",
        sessionId: base.id,
        status: "running",
        startedAt: new Date().toISOString()
      }
    };
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    host.adopt(session);
    expect(host.getSnapshot().activeSession?.activeTurn?.status).toBe("aborted");
    expect(host.getSnapshot().activeSession?.messages[0]).toMatchObject({
      kind: "system_notice",
      status: "recovered",
      streaming: false
    });
  });

  it("executes a persisted confirmation exactly once when confirm is double-clicked", async () => {
    const now = new Date().toISOString();
    const base = AgentRuntime.create("tailor_existing_resume", "confirm_apply");
    const taskState = tailoringState("confirm_apply");
    const session: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "assistant-confirmation-1",
        turnId: "turn-confirmation-1",
        role: "assistant",
        content: "请确认是否应用这次修改。",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }],
      pendingConfirmation: {
        id: "confirmation-1",
        turnId: "turn-confirmation-1",
        operationId: "apply-operation-1",
        toolName: "apply_tailoring_changes",
        title: "应用定制",
        description: "确认创建岗位专属版本。",
        destructive: false,
        status: "pending",
        validatedInput: { session: { id: "tailoring-1" }, selectedDiffs: [] },
        dependencyExpectation: {
          profileId: "profile-1",
          resumeId: "resume-1",
          jobId: "job-1"
        },
        requestedAt: now
      },
      pendingToolCall: {
        turnId: "turn-confirmation-1",
        toolName: "apply_tailoring_changes",
        operationId: "apply-operation-1",
        input: { ambiguous: "model-input-is-not-authoritative" }
      }
    };
    const execute = vi.fn(async () => ({
      ok: true,
      toolName: "apply_tailoring_changes",
      data: { branchId: "resume-job-1", revisionId: "revision-2" },
      artifactIds: []
    }));
    const save = vi.fn(async (value: AgentSession) => value);
    const kernelResult = {
      trajectory: completedTrajectory(taskState.workflowId),
      conversationSummary: "",
      taskState: { ...taskState, completionStatus: "completed" as const }
    };
    const host = new AgentHostStore({
      kernel: { resumeTurn: vi.fn(async () => kernelResult) } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);
    const [confirmed] = await Promise.all([
      host.dispatch({ type: "confirmation", confirmed: true }, {
        pageContext: { pathname: "/ai-workspace", query: {} }
      }),
      host.dispatch({ type: "confirmation", confirmed: true }, {
        pageContext: { pathname: "/ai-workspace", query: {} }
      })
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "apply-operation-1",
      toolInput: expect.objectContaining({ selectedDiffs: [] }),
      confirmed: true
    }));
    expect(confirmed?.messages.filter((message) => message.role === "user")).toHaveLength(0);
    expect(confirmed?.messages.find((message) => message.id === "assistant-confirmation-1")?.metadata)
      .toMatchObject({ confirmationResolution: "confirmed" });
  });

  it("persists a compact authoritative receipt for a confirmed profile intake commit", async () => {
    const now = new Date().toISOString();
    const base = AgentRuntime.create("guided_profile_intake", "confirm_commit");
    const reducer = new AgentTaskStateReducer();
    const taskState = AgentTaskStateSchema.parse({
      ...reducer.create(base, "profile_intake"),
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation",
      knownSlots: {
        targetProfileId: "profile-1",
        expectedProfileVersion: 1,
        intakeImportId: "intake-diagnostic",
        expectedIntakeDraftRevision: 0,
        expectedIntakeReconciliationRevision: 0,
        pendingConfirmation: {
          toolName: "commit_profile_intake",
          operationId: "commit-profile-diagnostic"
        }
      }
    });
    const session: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "assistant-profile-diagnostic",
        turnId: "turn-profile-diagnostic",
        role: "assistant",
        content: "请确认写入资料库。",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }],
      pendingConfirmation: {
        id: "confirmation-profile-diagnostic",
        turnId: "turn-profile-diagnostic",
        operationId: "commit-profile-diagnostic",
        toolName: "commit_profile_intake",
        title: "写入资料库？",
        description: "确认后保存已核对事实。",
        destructive: false,
        status: "pending",
        requestedAt: now
      },
      pendingToolCall: {
        turnId: "turn-profile-diagnostic",
        toolName: "commit_profile_intake",
        operationId: "commit-profile-diagnostic",
        input: {}
      }
    };
    const execute = vi.fn(async () => ({
      ok: true,
      toolName: "commit_profile_intake",
      data: {
        profileId: "profile-1",
        profileVersion: 2,
        committedItemCount: 8,
        committedFactCount: 8,
        idempotent: false
      },
      artifactIds: []
    }));
    const save = vi.fn(async (value: AgentSession) => value);
    const resumeTurn = vi.fn(async (input: { session: AgentSession }) => ({
      trajectory: completedTrajectory("guided_profile_intake"),
      conversationSummary: "",
      taskState: new AgentTaskStateReducer().reduce(input.session.taskState!, {
        type: "tool_observation",
        toolName: "commit_profile_intake",
        observation: {
          profileId: "profile-1",
          profileVersion: 2,
          committedItemCount: 8,
          committedFactCount: 8,
          idempotent: false
        }
      })
    }));
    const host = new AgentHostStore({
      kernel: { resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);

    const confirmed = await host.dispatch({ type: "confirmation", confirmed: true }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(confirmed?.messages.find((message) =>
      message.toolName === "commit_profile_intake"
      && message.operationId === "commit-profile-diagnostic"
    )?.metadata).toMatchObject({
      diagnostic: {
        ok: true,
        profileId: "profile-1",
        profileVersion: 2,
        committedItemCount: 8,
        committedFactCount: 8,
        idempotent: false
      }
    });
  });

  it("silently cancels profile intake confirmation and returns to interview collection", async () => {
    const now = new Date().toISOString();
    const base = AgentRuntime.create("guided_profile_intake", "confirm_commit");
    const reducer = new AgentTaskStateReducer();
    const taskState = AgentTaskStateSchema.parse({
      ...reducer.create(base, "profile_intake"),
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation",
      knownSlots: {
        intakeImportId: "intake-1",
        expectedIntakeDraftRevision: 1,
        intakeReconciliation: { additions: [{}] },
        expectedIntakeReconciliationRevision: 1,
        pendingConfirmation: {
          toolName: "commit_profile_intake",
          operationId: "commit-profile-operation"
        }
      }
    });
    const session: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "assistant-profile-confirmation",
        turnId: "turn-profile-confirmation",
        role: "assistant",
        content: "是否写入这项教育经历？",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }],
      pendingConfirmation: {
        id: "profile-confirmation",
        turnId: "turn-profile-confirmation",
        operationId: "commit-profile-operation",
        toolName: "commit_profile_intake",
        title: "写入资料库？",
        description: "确认后保存已核对事实。",
        destructive: false,
        status: "pending",
        requestedAt: now
      },
      pendingToolCall: {
        turnId: "turn-profile-confirmation",
        toolName: "commit_profile_intake",
        operationId: "commit-profile-operation",
        input: {}
      }
    };
    const save = vi.fn(async (value: AgentSession) => value);
    const resumeTurn = vi.fn(async (input: { session: AgentSession }) => ({
      trajectory: completedTrajectory("guided_profile_intake"),
      conversationSummary: "",
      taskState: input.session.taskState
    }));
    const execute = vi.fn();
    const host = new AgentHostStore({
      kernel: { resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);

    const cancelled = await host.dispatch({ type: "confirmation", confirmed: false }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(execute).not.toHaveBeenCalled();
    expect(cancelled?.messages.filter((message) => message.role === "user")).toHaveLength(0);
    expect(cancelled?.messages.find((message) => message.id === "assistant-profile-confirmation")?.metadata)
      .toMatchObject({ confirmationResolution: "rejected" });
    expect(cancelled?.taskState).toMatchObject({
      stage: "collect_experience",
      completionStatus: "waiting_for_user"
    });
    expect(cancelled?.taskState?.knownSlots).not.toHaveProperty("intakeImportId");
  });

  it("executes a profile intake artifact decision directly without a synthetic user turn", async () => {
    const base = AgentRuntime.create("guided_profile_intake", "review_facts");
    const reducer = new AgentTaskStateReducer();
    const taskState = AgentTaskStateSchema.parse({
      ...reducer.create(base, "profile_intake"),
      stage: "review_facts",
      completionStatus: "waiting_for_user",
      knownSlots: {
        intakeImportId: "intake-review-1",
        expectedIntakeDraftRevision: 2,
        intakeCandidates: [{
          id: "candidate-deep-tutor",
          label: "DeepTutor",
          needsConfirmation: true
        }]
      }
    });
    const session: AgentSession = { ...base, taskState };
    const execute = vi.fn(async () => ({
      ok: true,
      operationId: "artifact-action-profile",
      toolName: "review_profile_intake",
      data: {
        importId: "intake-review-1",
        expectedDraftRevision: 3,
        candidateId: "candidate-deep-tutor",
        decision: "reject",
        unresolvedCount: 0
      },
      artifactIds: [],
      completedAt: new Date().toISOString()
    }));
    const resumeTurn = vi.fn(async (input: { session: AgentSession }) => ({
      trajectory: completedTrajectory("guided_profile_intake"),
      conversationSummary: "",
      taskState: input.session.taskState
    }));
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: { resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);

    const result = await host.dispatch({
      type: "artifact_action",
      action: {
        type: "profile_intake_candidate_decision",
        candidateId: "candidate-deep-tutor",
        decision: "reject"
      }
    }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "review_profile_intake",
      toolInput: {
        importId: "intake-review-1",
        expectedDraftRevision: 2,
        candidateId: "candidate-deep-tutor",
        decision: "reject"
      }
    }));
    expect(resumeTurn).toHaveBeenCalledWith(expect.objectContaining({
      reason: "tool_observation",
      toolName: "review_profile_intake",
      observation: expect.objectContaining({
        candidateId: "candidate-deep-tutor",
        decision: "reject"
      })
    }));
    expect(result?.messages.filter((message) => message.role === "user")).toHaveLength(0);
  });

  it("invalidates an unclicked confirmation when the user corrects the facts and captures the correction", async () => {
    const now = new Date().toISOString();
    const base = AgentRuntime.create("guided_profile_intake", "confirm_commit");
    const reducer = new AgentTaskStateReducer();
    const taskState = AgentTaskStateSchema.parse({
      ...reducer.create(base, "profile_intake"),
      stage: "confirm_commit",
      completionStatus: "waiting_for_confirmation",
      knownSlots: {
        intakeImportId: "intake-before-correction",
        expectedIntakeDraftRevision: 1,
        intakeReconciliation: { additions: [{}] },
        expectedIntakeReconciliationRevision: 1,
        pendingConfirmation: {
          toolName: "commit_profile_intake",
          operationId: "commit-before-correction"
        }
      }
    });
    const session: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "assistant-before-correction",
        turnId: "turn-before-correction",
        role: "assistant",
        content: "是否写入这项教育经历？",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }],
      pendingConfirmation: {
        id: "confirmation-before-correction",
        turnId: "turn-before-correction",
        operationId: "commit-before-correction",
        toolName: "commit_profile_intake",
        title: "写入资料库？",
        description: "确认后保存已核对事实。",
        destructive: false,
        status: "pending",
        requestedAt: now
      },
      pendingToolCall: {
        turnId: "turn-before-correction",
        toolName: "commit_profile_intake",
        operationId: "commit-before-correction",
        input: {}
      }
    };
    const runTurn = vi.fn(async (input: { session: AgentSession }) => ({
      trajectory: completedTrajectory("guided_profile_intake"),
      conversationSummary: "",
      taskState: input.session.taskState
    }));
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: { runTurn } as never,
      executor: {} as never,
      persistence: { save } as never
    });
    host.adopt(session);

    const corrected = await host.dispatch({
      type: "message",
      text: "更正一下，我是2025年9月入学。"
    }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });

    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(corrected?.pendingConfirmation).toBeUndefined();
    expect(corrected?.messages.find((message) => message.id === "assistant-before-correction")?.metadata)
      .toMatchObject({ confirmationResolution: "superseded" });
    expect(corrected?.messages.filter((message) => message.role === "user").at(-1)?.content)
      .toBe("更正一下，我是2025年9月入学。");
    expect(corrected?.taskState).toMatchObject({
      stage: "structure_facts",
      knownSlots: {
        latestIntakeSource: {
          exactSourceQuote: "更正一下，我是2025年9月入学。"
        }
      }
    });
  });

  it("revalidates dependencies before a confirmed write and invalidates a stale preview", async () => {
    const now = new Date().toISOString();
    const base = AgentRuntime.create("tailor_existing_resume", "confirm_apply");
    const taskState = AgentTaskStateSchema.parse({
      ...tailoringState("confirm_apply"),
      selectedEntities: {
        profileId: "profile-1",
        resumeId: "resume-1",
        resumeRevisionId: "revision-a",
        resumeHash: "hash-a",
        jobId: "job-1"
      },
      knownSlots: {
        tailoringSession: { id: "tailoring-1" },
        selectedDiffs: [{ id: "diff-1" }],
        previewComplete: true,
        pendingConfirmation: {
          toolName: "apply_tailoring_changes",
          operationId: "apply-operation-stale"
        }
      },
      dependencySnapshots: {
        preview: {
          resumeId: "resume-1",
          resumeRevisionId: "revision-a",
          resumeHash: "hash-a"
        },
        pendingApplyConfirmation: {
          resumeId: "resume-1",
          resumeRevisionId: "revision-a",
          resumeHash: "hash-a"
        }
      }
    });
    const session: AgentSession = {
      ...base,
      taskState,
      pendingConfirmation: {
        id: "confirmation-stale",
        operationId: "apply-operation-stale",
        toolName: "apply_tailoring_changes",
        title: "应用定制",
        description: "确认创建岗位专属版本。",
        destructive: false,
        status: "pending",
        validatedInput: { session: { id: "tailoring-1" }, selectedDiffs: [{ id: "diff-1" }] },
        dependencyExpectation: {
          resumeId: "resume-1",
          resumeRevisionId: "revision-a",
          resumeHash: "hash-a"
        },
        requestedAt: now
      },
      pendingToolCall: {
        toolName: "apply_tailoring_changes",
        operationId: "apply-operation-stale",
        input: {}
      }
    };
    const execute = vi.fn(async (input: { toolName: string }) => {
      if (input.toolName !== "get_resume") throw new Error("stale write must not execute");
      return {
        ok: true,
        toolName: "get_resume",
        data: {
          resume: { id: "resume-1", currentRevisionId: "revision-b" },
          resumeHash: "hash-b"
        },
        artifactIds: []
      };
    });
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);
    const result = await host.dispatch({ type: "confirmation", confirmed: true }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "get_resume" }));
    expect(result?.taskState).toMatchObject({
      stage: "analyze_fit",
      selectedEntities: {
        resumeRevisionId: "revision-b",
        resumeHash: "hash-b"
      },
      dependencySnapshots: {}
    });
    expect(result?.taskState?.knownSlots).not.toHaveProperty("previewComplete");
  });

  it("does not stall a 60-second operation that reports heartbeat progress every 10 seconds", async () => {
    vi.useFakeTimers();
    try {
      const base = AgentRuntime.create("analyze_job_fit", "analyze_fit");
      const taskState = new AgentTaskStateReducer().create(base, "analyze_job_fit");
      const save = vi.fn(async (value: AgentSession) => value);
      const runTurn = vi.fn(async (input: {
        emit(event: { type: "heartbeat"; stage: string }): void | Promise<void>;
      }) => {
        for (let elapsed = 10; elapsed <= 60; elapsed += 10) {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          await input.emit({ type: "heartbeat", stage: `elapsed-${elapsed}` });
        }
        return {
          trajectory: completedTrajectory(taskState.workflowId),
          conversationSummary: "",
          taskState: { ...taskState, completionStatus: "completed" as const }
        };
      });
      const host = new AgentHostStore({
        kernel: { runTurn } as never,
        executor: {} as never,
        persistence: { save } as never,
        stallThresholdMs: 30_000
      });
      const running = host.startTurn({
        session: { ...base, taskState },
        userMessage: "分析岗位匹配",
        pageContext: { pathname: "/ai-workspace", query: {} }
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(host.getSnapshot().stalled).toBe(false);
      await running;
      expect(host.getSnapshot().turnStatus).toBe("completed");
      expect(runTurn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

function tailoringState(stage: string) {
  const reducer = new AgentTaskStateReducer();
  return {
    ...reducer.create(AgentRuntime.create("tailor_existing_resume", stage), "create_tailored_resume"),
    stage,
    selectedEntities: {
      profileId: "profile-1",
      resumeId: "resume-1",
      jobId: "job-1"
    },
    knownSlots: {
      tailoringSession: { plan: { clarificationQuestions: [], clarificationAnswers: [] } },
      selectedDiffs: []
    },
    completionStatus: stage === "confirm_apply" ? "waiting_for_confirmation" as const : "active" as const
  };
}

function services(): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result,
    listProfiles: result,
    listJobs: result,
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
    archiveResume: result,
    restoreResume: result,
    exportResume: result
  };
}

function completedTrajectory(workflowId: string) {
  return {
    taskId: "task-test",
    workflowId,
    turns: 1,
    skillsLoaded: [],
    toolCalls: [],
    confirmations: [],
    artifacts: [],
    outcome: "completed" as const,
    errors: []
  };
}
