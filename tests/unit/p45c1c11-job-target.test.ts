import { describe, expect, it, vi } from "vitest";
import { AgentCapabilityBroker } from "@/agent/kernel/AgentCapabilityBroker";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentSessionSchema, AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { executeCareerWorkflowFacade } from "@/agent/workflows/CareerWorkflowFacade";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { createPastedJobTargetSnapshot, jobTargetSnapshotHash } from "@/domain/jobTarget/jobTargetSnapshot";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { JobTargetSnapshotSchema, ResumeBranchSchema } from "@/domain/schemas";
import { demoCareerProfile } from "@/data/demoProfile";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";
import type { CareerToolResult } from "@/agent/tools/CareerToolGateway";

const TARGET_TEXT = `${AI_TRAINER_JD_V4}\n帮我根据我的真实资料生成对应的岗位简历`;

function atomicResult(toolName: string, data: unknown): CareerToolResult {
  return {
    ok: true,
    data,
    artifacts: [],
    receipt: {
      operationId: `atomic-${toolName}`,
      toolName,
      status: "completed",
      completedAt: "2026-08-16T00:00:00.000Z"
    }
  };
}

function targetSnapshot() {
  const analyzed = analyzeJobDescriptionV4({ rawText: AI_TRAINER_JD_V4 });
  return createPastedJobTargetSnapshot({
    rawText: AI_TRAINER_JD_V4,
    graph: analyzed.graph,
    title: "AI训练师",
    company: "示例科技"
  });
}

describe("P4.5c.1.11 external job target closure", () => {
  it("routes a pasted JD plus resume-generation language before job ingestion", () => {
    const broker = new AgentCapabilityBroker();
    const plain = broker.route(AI_TRAINER_JD_V4);
    const application = broker.route(TARGET_TEXT);
    const ingestion = broker.route(`录入岗位\n${AI_TRAINER_JD_V4}`);

    expect(plain).toMatchObject({
      intent: "external_target",
      goal: "clarify_external_target",
      possibleWorkflow: "tailor_existing_resume"
    });
    expect(application).toMatchObject({
      intent: "external_target",
      goal: "apply_to_external_job",
      possibleWorkflow: "tailor_existing_resume"
    });
    expect(ingestion).toMatchObject({
      intent: "job_ingestion",
      goal: "ingest_job",
      possibleWorkflow: "job_ingestion"
    });
  });

  it("keeps the pasted text in the tailoring task and exposes structured persistence choices", () => {
    const reducer = new AgentTaskStateReducer();
    const initial = reducer.create(AgentRuntime.create("agent_quick_action", "collecting_intent"));
    const intent = classifyTurnIntent({ text: TARGET_TEXT, taskState: initial });
    expect(intent).toMatchObject({
      intent: "new_domain_task",
      taskMutation: "replace",
      newTask: {
        goal: "apply_to_external_job",
        workflowId: "tailor_existing_resume",
        stage: "choose_resume_source"
      }
    });
    const plainIntent = classifyTurnIntent({ text: AI_TRAINER_JD_V4, taskState: initial });
    expect(plainIntent.newTask).toMatchObject({
      goal: "clarify_external_target",
      workflowId: "tailor_existing_resume",
      stage: "clarify_target"
    });
    const plainState = reducer.reduce(initial, {
      type: "new_root_task",
      goal: plainIntent.newTask!.goal,
      workflowId: plainIntent.newTask!.workflowId,
      stage: plainIntent.newTask!.stage
    });
    expect(reducer.reduce(plainState, {
      type: "user_message",
      message: AI_TRAINER_JD_V4,
      turnIntent: plainIntent.intent
    })).toMatchObject({
      stage: "clarify_target",
      completionStatus: "waiting_for_user"
    });

    let state = reducer.reduce(initial, {
      type: "new_root_task",
      goal: intent.newTask!.goal,
      workflowId: intent.newTask!.workflowId,
      stage: intent.newTask!.stage
    });
    state = reducer.reduce(state, {
      type: "user_message",
      message: TARGET_TEXT,
      turnIntent: intent.intent
    });
    expect(state.knownSlots).toMatchObject({
      rawText: TARGET_TEXT,
      targetSourceType: "pasted_jd",
      jobPersistenceDecision: "ask"
    });

    const withDecision = AgentTaskStateSchema.parse({
      ...state,
      stage: "confirm_apply",
      completionStatus: "waiting_for_user",
      pendingDecision: { type: "job_target_persistence", options: ["session_only", "save_job"] }
    });
    const sessionOnly = reducer.reduce(withDecision, {
      type: "decision_selected",
      decisionType: "job_target_persistence",
      option: "session_only"
    });
    expect(sessionOnly).toMatchObject({
      stage: "confirm_apply",
      completionStatus: "active",
      knownSlots: { jobPersistenceDecision: "session_only" }
    });
    expect(sessionOnly.pendingDecision).toBeUndefined();
  });

  it("builds a durable target checkpoint without calling Job commit during parsing", async () => {
    const snapshot = targetSnapshot();
    const calls: Array<{ name: string; input: unknown }> = [];
    const session = {
      id: "tailoring-session-external-target",
      branch: { id: "resume-general-1", currentRevisionId: "resume-revision-1" },
      job: { id: snapshot.id, title: snapshot.title, company: snapshot.company },
      targetSnapshot: snapshot,
      plan: {
        generationStatus: "ready_for_generation",
        questionPlan: { status: "ready_for_generation", revision: 1 },
        clarificationQuestions: []
      }
    };
    const result = await executeCareerWorkflowFacade(
      "career.workflow.tailor_resume",
      {
        profileId: "profile-1",
        sourceResumeId: "resume-general-1",
        target: { type: "pasted_jd", text: AI_TRAINER_JD_V4, persistence: "ask" }
      },
      { availableCareerToolNames: new Set(["career.job.parse", "career.job.analyze_fit", "career.tailoring.create_session"]) },
      "external-target-operation",
      async (name, input) => {
        calls.push({ name, input });
        if (name === "career.job.parse") {
          return atomicResult(name, { graph: snapshot.requirementGraph, candidateTitle: snapshot.title, candidateCompany: snapshot.company });
        }
        if (name === "career.job.analyze_fit") return atomicResult(name, { analysis: {}, dependencies: {} });
        if (name === "career.tailoring.create_session") return atomicResult(name, { session });
        throw new Error(`unexpected_atomic_call:${name}`);
      }
    );

    expect(calls.map((call) => call.name)).toEqual([
      "career.job.parse",
      "career.job.analyze_fit",
      "career.tailoring.create_session"
    ]);
    expect(calls.some((call) => call.name === "career.job.commit")).toBe(false);
    expect(result.data.status).toBe("waiting_for_user");
    expect(result.data.workflowCheckpoint).toMatchObject({
      targetSourceType: "pasted_jd",
      targetSnapshotId: snapshot.id,
      targetSnapshotVersion: snapshot.version,
      targetSnapshotHash: jobTargetSnapshotHash(snapshot),
      jobPersistenceDecision: "ask"
    });
  });

  it("accepts target-snapshot provenance while rejecting a job branch with no target", () => {
    const snapshot = JobTargetSnapshotSchema.parse(targetSnapshot());
    const general = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "job-target-branch-test",
      name: "通用简历",
      includeProfileFacts: true,
      includeProfileBasics: true
    });
    const missingTarget = ResumeBranchSchema.safeParse({
      ...general.branch,
      branchPurpose: "job_specific",
      jobId: undefined,
      sourceJobVersion: undefined
    });
    expect(missingTarget.success).toBe(false);

    const savedJobBranch = ResumeBranchSchema.safeParse({
      ...general.branch,
      branchPurpose: "job_specific",
      jobId: "saved-job-1",
      sourceJobVersion: "2026-08-16T00:00:00.000Z"
    });
    expect(savedJobBranch.success).toBe(true);

    const targetBranch = ResumeBranchSchema.safeParse({
      ...general.branch,
      branchPurpose: "job_specific",
      jobId: undefined,
      sourceJobVersion: undefined,
      targetSnapshotId: snapshot.id,
      targetSnapshotVersion: snapshot.version,
      targetSnapshotHash: jobTargetSnapshotHash(snapshot),
      targetSnapshot: snapshot
    });
    expect(targetBranch.success).toBe(true);
  });

  it("keeps session-only targets out of Job commit and persists an explicit save choice once", async () => {
    const snapshot = targetSnapshot();
    const reducer = new AgentTaskStateReducer();
    const base = AgentRuntime.create("tailor_existing_resume", "confirm_apply");
    const taskState = AgentTaskStateSchema.parse({
      ...reducer.create(base, "apply_to_external_job"),
      rootGoal: "apply_to_external_job",
      activeGoal: "apply_to_external_job",
      workflowId: "tailor_existing_resume",
      stage: "confirm_apply",
      completionStatus: "waiting_for_user",
      selectedEntities: {
        profileId: "profile-1",
        resumeId: "resume-general-1",
        sourceResumeId: "resume-general-1",
        targetSnapshotId: snapshot.id,
        targetSnapshotVersion: snapshot.version,
        targetSnapshotHash: jobTargetSnapshotHash(snapshot)
      },
      pendingDecision: { type: "job_target_persistence", options: ["session_only", "save_job"] },
      knownSlots: {
        targetSnapshot: snapshot,
        targetSourceType: "pasted_jd",
        jobPersistenceDecision: "ask",
        tailoringSession: {
          id: "tailoring-session-1",
          branch: { id: "resume-general-1", currentRevisionId: "resume-revision-1" },
          job: { id: snapshot.id, title: snapshot.title, company: snapshot.company },
          targetSnapshot: snapshot,
          plan: { clarificationQuestions: [], questionPlan: { status: "completed" } }
        },
        pendingTargetApplyInput: { selectedDiffs: [], confirmedRequirementIds: [] },
        pendingTargetApplyOperationId: "apply-target-1"
      }
    });
    const session = AgentSessionSchema.parse({ ...base, taskState, messages: [] });
    const save = vi.fn(async (value: typeof session) => value);
    const execute = vi.fn(async (call: { toolName: string }) => ({
      ok: true,
      toolName: call.toolName,
      data: call.toolName === "commit_job"
        ? { jobId: "saved-job-1", jobRevision: "saved-revision-1", jobDescription: { id: "saved-job-1", updatedAt: "saved-revision-1" } }
        : {},
      artifactIds: [],
      receipt: {
        operationId: "job-target-save",
        toolName: call.toolName,
        status: "completed" as const,
        completedAt: "2026-08-16T00:00:00.000Z"
      }
    }));
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(session);

    const sessionOnly = await host.dispatch({
      type: "option",
      action: { type: "task_decision", decisionType: "job_target_persistence", option: "session_only" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(execute).not.toHaveBeenCalled();
    expect(sessionOnly?.pendingConfirmation).toMatchObject({ toolName: "apply_tailoring_changes" });
    expect(sessionOnly?.taskState?.knownSlots.jobPersistenceDecision).toBe("session_only");

    const saveChoiceSession = AgentSessionSchema.parse({
      ...session,
      sessionRevision: session.sessionRevision + 1,
      updatedAt: new Date(Date.parse(session.updatedAt) + 1_000).toISOString(),
      taskState: {
        ...taskState,
        pendingDecision: { type: "job_target_persistence", options: ["session_only", "save_job"] }
      }
    });
    host.adopt(saveChoiceSession);
    const saved = await host.dispatch({
      type: "option",
      action: { type: "task_decision", decisionType: "job_target_persistence", option: "save_job" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "commit_job", confirmed: true }));
    expect(saved?.taskState?.knownSlots.savedJobId).toBe("saved-job-1");
    expect(saved?.pendingConfirmation).toMatchObject({ toolName: "apply_tailoring_changes" });
  });
});
