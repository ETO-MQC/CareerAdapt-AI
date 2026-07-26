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
import type { AgentSession } from "@/agent/contracts/agentSession";

describe("P4.2a.3b canonical task runtime", () => {
  it("replaces a stale quick-action workflow and uses the task workflow for every later resolution", () => {
    const base = AgentRuntime.create("agent_quick_action", "collecting_intent");
    const reducer = new AgentTaskStateReducer();
    const task = reducer.reduce(reducer.create(base), {
      type: "user_message",
      message: "基于现有简历做岗位定制"
    });
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
    let state = reducer.reduce(
      reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent")),
      { type: "user_message", message: jd }
    );
    expect(state).toMatchObject({
      goal: "ingest_job",
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
