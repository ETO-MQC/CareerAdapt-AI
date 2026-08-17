import { describe, expect, it, vi } from "vitest";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { NativeCareerAgentRuntime } from "@/agent/runtime/NativeCareerAgentRuntime";
import {
  AgentHostStore,
  attachTaskStateOptions
} from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import {
  AgentSessionSchema,
  AgentTaskStateSchema,
  type AgentSession,
  type AgentTaskState
} from "@/agent/contracts/agentSession";
import { createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";
import type { AgentModel, AgentModelResult } from "@/agent/model/agentModel";
import type { AgentRuntimeTurnInput } from "@/agent/runtime/agentRuntime";

const pageContext = { pathname: "/ai-workspace", query: {} };
const authoritativeSelection = {
  profileId: "profile-1",
  profileVersion: 4,
  resumeId: "resume-1",
  resumeRevisionId: "resume-revision-1",
  jobId: "job-1",
  jobRevision: "job-revision-1"
} as const;

describe("P4.5c.1.6 Hermes-first tailoring continuation and failure closure", () => {
  it("does not silently switch to Native after a pre-first-event Hermes failure", async () => {
    const analyzeJobFit = vi.fn(async (input: unknown, operationId: string) => {
      void input;
      void operationId;
      return {
        analysis: { score: 88, gaps: ["AI 应用"] },
        dependencies: authoritativeSelection
      };
    });
    const createTailoringSession = vi.fn(async (input: unknown, operationId: string) => {
      void input;
      void operationId;
      return {
        session: {
          id: "tailoring-1",
          plan: {
            clarificationQuestions: [{ id: "q-1", question: "请确认一个真实交付案例。", status: "active" }],
            clarificationAnswers: [],
            questionPlan: {
              id: "question-plan-1",
              revision: 1,
              questionIds: ["q-1"],
              activeQuestionId: "q-1",
              answeredQuestionIds: [],
              skippedQuestionIds: [],
              status: "active"
            },
            diffs: [],
            diffReviews: [],
            generationStatus: "not_started"
          }
        },
        dependencies: { ...authoritativeSelection, tailoringSessionId: "tailoring-1" },
        appliedDiffs: []
      };
    });
    const model = scriptedModel({
      stopReason: "tool_calls",
      toolCalls: [{ id: "fit-call", name: "analyze_job_fit", arguments: { profileId: "stale", resumeId: "stale", jobId: "stale" } }]
    });
    const registry = createAgentToolRegistry(baseServices({ analyzeJobFit, createTailoringSession }));
    const kernel = new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry)
    });
    const session = {
      ...AgentRuntime.create("tailor_existing_resume", "analyze_fit"),
      taskState: tailoringState("analyze_fit")
    };
    const nativeRunTurn = vi.fn(async (input: AgentRuntimeTurnInput) =>
      kernel.runTurn({
        session: input.session!,
        pageContext: input.pageContext,
        userMessage: "",
        turnId: input.turnId,
        taskEventAlreadyReduced: true
      })
    );
    const native = new NativeCareerAgentRuntime({ runTurn: nativeRunTurn });
    const hermes = {
      id: "hermes" as const,
      async *runTurn() {
        throw Object.assign(new Error("Hermes failed before the first event."), { code: "hermes_run_start_failed" });
      },
      pause: async () => undefined,
      interrupt: async () => undefined,
      resume: async () => undefined,
      capabilities: () => ({
        streaming: true,
        interruptible: true,
        resumable: true,
        toolCalls: true,
        approvals: true,
        offline: false
      })
    };
    const router = new AgentRuntimeRouter({
      native,
      hermes,
      configuration: { agentRuntime: "hermes" }
    });
    const events = [];
    for await (const event of router.runUserEvent(
      { type: "retry", action: { type: "retry_current_step" } },
      {
        sessionId: session.id,
        turnId: "runtime-turn-fallback-1",
        userMessage: "",
        pageContext,
        session,
        metadata: {
          runtimeEventPrepared: true,
          executionOwner: "runtime_continuation"
        }
      }
    )) {
      events.push(event);
    }

    expect(nativeRunTurn).not.toHaveBeenCalled();
    expect(analyzeJobFit).not.toHaveBeenCalled();
    expect(createTailoringSession).not.toHaveBeenCalled();
    expect(model.completeWithTools).not.toHaveBeenCalled();

    const failed = [...events].reverse().find((event) => event.type === "turn_failed");
    const failedData = failed?.data as Record<string, unknown> | undefined;
    expect(failed?.error).toMatchObject({
      code: "hermes_unavailable_recoverable",
      recoverable: true
    });
    expect(failedData?.telemetry).toMatchObject({
      fallbackUsed: false,
      preferredRuntime: "hermes",
      attemptedRuntime: "hermes",
      finalRuntime: "hermes",
      fallbackReasonCode: "hermes_run_start_failed"
    });
  });

  it("keeps the fit checkpoint and selected entities when plan creation fails, then retries generate_plan", async () => {
    const createTailoringSession = vi.fn(async () => {
      throw Object.assign(new Error("provider failure"), { code: "tailoring_plan_failed" });
    });
    const model = scriptedModel(
      { stopReason: "final", text: "我会继续处理。" },
      { stopReason: "final", text: "当前没有其他步骤。" }
    );
    const registry = createAgentToolRegistry(baseServices({ createTailoringSession }));
    const kernel = new AgentKernel({
      model,
      executor: new AgentExecutor(registry),
      toolResolver: new AgentToolResolver(registry)
    });
    const session = {
      ...AgentRuntime.create("tailor_existing_resume", "generate_plan"),
      taskState: tailoringState("generate_plan")
    };
    const result = await kernel.runTurn({
      session,
      pageContext,
      userMessage: "",
      taskEventAlreadyReduced: true
    });

    expect(createTailoringSession).toHaveBeenCalledTimes(1);
    expect(result.text).toContain("岗位和简历已保留，定制计划生成过程中出现临时问题。可以直接重试此步骤。");
    expect(result.text).not.toContain("provider failure");
    expect(result.taskState).toMatchObject({
      stage: "generate_plan",
      completionStatus: "waiting_for_user",
      knownSlots: { fitAnalysis: { score: 88 } },
      selectedEntities: authoritativeSelection
    });

    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    const failedSession = {
      ...session,
      taskState: result.taskState
    } as AgentSession;
    host.adopt(failedSession);
    const prepared = await host.prepareRuntimeUserEvent({
      session: failedSession,
      event: { type: "option_selected", action: { type: "retry_current_step" } },
      pageContext
    });

    expect(prepared.deterministicTransitionApplied).toBe(true);
    expect(prepared.session.taskState).toMatchObject({
      stage: "generate_plan",
      completionStatus: "active",
      knownSlots: { fitAnalysis: { score: 88 } },
      selectedEntities: authoritativeSelection
    });
    expect(prepared.session.taskState?.stage).not.toMatch(/choose_resume_source|choose_job/);
    expect(save).toHaveBeenCalled();
  });

  it("uses retry-current-turn and preserves the failed turn message and logical turn", async () => {
    const base = AgentRuntime.create("tailor_existing_resume", "generate_plan");
    const turnId = "tailoring-retry-turn-1";
    const userMessageId = "tailoring-retry-user-1";
    const assistantMessageId = "tailoring-retry-assistant-1";
    const now = new Date().toISOString();
    const session = AgentSessionSchema.parse({
      ...base,
      taskState: tailoringState("generate_plan"),
      messages: [
        {
          id: userMessageId,
          turnId,
          role: "user",
          content: "请根据当前岗位继续生成",
          kind: "text",
          type: "text",
          status: "complete",
          createdAt: now
        },
        {
          id: assistantMessageId,
          turnId,
          role: "assistant",
          content: "正在生成岗位简历…",
          kind: "assistant_thinking",
          type: "assistant_thinking",
          status: "thinking",
          createdAt: now
        }
      ],
      activeTurn: {
        id: turnId,
        sessionId: base.id,
        userMessageId,
        runtimeId: "hermes",
        status: "running",
        startedAt: now
      }
    });
    const save = vi.fn(async (value: AgentSession) => value);
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: {} as never,
      persistence: { save } as never
    });
    host.adopt(session);
    const failed = await host.applyRuntimeEvent({
      type: "turn_failed",
      sessionId: session.id,
      turnId,
      timestamp: now,
      error: { code: "hermes_run_failed_after_start", message: "provider failure", recoverable: true }
    }, assistantMessageId);

    expect(failed?.messages.find((message) => message.id === assistantMessageId)?.options).toEqual([
      expect.objectContaining({ id: "retry-current-turn", action: { type: "retry_current_step" } })
    ]);
    host.adopt(failed!);
    const prepared = await host.prepareRuntimeUserEvent({
      session: failed!,
      event: { type: "option_selected", action: { type: "retry_current_step" } },
      pageContext
    });
    expect(prepared).toMatchObject({
      turnId,
      userMessage: "请根据当前岗位继续生成",
      session: { activeTurn: { id: turnId, userMessageId }, taskState: { stage: "generate_plan", completionStatus: "active" } }
    });
  });

  it("keeps candidate names in option sets, not narrative, and supersedes stale choices", async () => {
    const resumeModel = scriptedModel({ stopReason: "final", text: "模型不应接管简历选择。" });
    const resumeRegistry = createAgentToolRegistry(baseServices());
    const resumeKernel = new AgentKernel({
      model: resumeModel,
      executor: new AgentExecutor(resumeRegistry),
      toolResolver: new AgentToolResolver(resumeRegistry)
    });
    const resumeState = tailoringState("choose_resume_source");
    resumeState.selectedEntities = { profileId: "profile-1" };
    resumeState.knownSlots = {
      resumeSelectionRequired: true,
      resumeCandidates: [{ id: "resume-1", name: "Competition Resume" }],
      resumeCandidateSetRevision: "resumes-1"
    };
    const resumeResult = await resumeKernel.runTurn({
      session: { ...AgentRuntime.create("tailor_existing_resume", "choose_resume_source"), taskState: resumeState },
      pageContext,
      userMessage: "",
      taskEventAlreadyReduced: true
    });
    expect(resumeResult.text).toBe("请选择要作为定制基础的简历。");
    expect(resumeResult.text).not.toContain("Competition Resume");
    expect(resumeModel.completeWithTools).not.toHaveBeenCalled();

    const jobModel = scriptedModel({ stopReason: "final", text: "模型不应接管岗位选择。" });
    const jobKernel = new AgentKernel({
      model: jobModel,
      executor: new AgentExecutor(resumeRegistry),
      toolResolver: new AgentToolResolver(resumeRegistry)
    });
    const jobState = tailoringState("choose_job");
    jobState.selectedEntities = { profileId: "profile-1", resumeId: "resume-1" };
    jobState.knownSlots = {
      selectedResumeName: "Competition Resume",
      jobCandidates: [{ id: "job-1", title: "Competition Role", company: "Example Co." }],
      jobCandidateSetRevision: "jobs-1"
    };
    const jobResult = await jobKernel.runTurn({
      session: { ...AgentRuntime.create("tailor_existing_resume", "choose_job"), taskState: jobState },
      pageContext,
      userMessage: "",
      taskEventAlreadyReduced: true
    });
    expect(jobResult.text).toBe("我会使用《Competition Resume》。\n请选择要投递的岗位。");
    expect(jobResult.text).not.toContain("Competition Role");
    expect(jobModel.completeWithTools).not.toHaveBeenCalled();

    const now = new Date().toISOString();
    const optionSession = AgentSessionSchema.parse({
      ...AgentRuntime.create("tailor_existing_resume", "choose_resume_source"),
      messages: [{
        id: "assistant-choice-1",
        role: "assistant",
        content: "请选择要作为定制基础的简历。",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }]
    });
    const withResumeOptions = attachTaskStateOptions(optionSession, resumeState);
    expect(withResumeOptions.messages[0]?.options?.[0]?.action).toMatchObject({
      type: "select_entity",
      entityType: "resume",
      entityId: "resume-1",
      candidateSetRevision: "resumes-1"
    });
    const withJobMessage = {
      ...withResumeOptions,
      messages: [
        ...withResumeOptions.messages,
        {
          id: "assistant-choice-2",
          role: "assistant" as const,
          content: "我会使用《Competition Resume》。\n请选择要投递的岗位。",
          kind: "text" as const,
          type: "text" as const,
          status: "complete" as const,
          createdAt: now
        }
      ]
    };
    const withJobOptions = attachTaskStateOptions(withJobMessage, jobState);
    expect(withJobOptions.messages[0]?.optionSet?.state).toBe("superseded");
    expect(withJobOptions.messages[0]?.options).toBeUndefined();
    expect(withJobOptions.messages[1]?.options?.map((option) => option.action)).toEqual([
      expect.objectContaining({ entityType: "job", entityId: "job-1", candidateSetRevision: "jobs-1" })
    ]);
  });
});

function scriptedModel(...results: AgentModelResult[]) {
  let index = 0;
  const completeWithTools = vi.fn(async () => results[Math.min(index++, results.length - 1)]);
  return { completeWithTools } satisfies AgentModel;
}

function baseServices(overrides: Partial<AgentToolServices> = {}): AgentToolServices {
  const empty = async () => ({ value: "ok" });
  return {
    listResumes: empty,
    listProfiles: empty,
    listJobs: empty,
    parseResumeFile: empty,
    createResumeImportDraft: empty,
    commitResumeImport: empty,
    parseJobDescription: empty,
    commitJob: empty,
    analyzeJobFit: empty,
    createTailoringSession: empty,
    answerTailoringQuestion: empty,
    previewTailoringChanges: empty,
    applyTailoringChanges: empty,
    exportResume: empty,
    ...overrides
  };
}

function tailoringState(stage: string): AgentTaskState {
  const base = new AgentTaskStateReducer().create(
    AgentRuntime.create("tailor_existing_resume", stage),
    "create_tailored_resume"
  );
  return AgentTaskStateSchema.parse({
    ...base,
    workflowId: "tailor_existing_resume",
    rootGoal: "create_tailored_resume",
    goal: "create_tailored_resume",
    activeGoal: stage === "generate_plan" ? "create_tailored_resume" : "analyze_job_fit",
    stage,
    selectedEntities: { ...authoritativeSelection },
    knownSlots: stage === "generate_plan" ? { fitAnalysis: { score: 88 } } : {},
    completionStatus: "active"
  });
}
