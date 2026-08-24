import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { createPastedJobTargetSnapshot, jobTargetSnapshotToJobDescription } from "@/domain/jobTarget/jobTargetSnapshot";
import { analyzeJobDescriptionV4 } from "@/domain/jobOptimization";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import {
  TailoringSessionSchema,
  createTailoringSessionCommand,
  reviewTailoringDiffCommand,
  tailoringDiffId
} from "@/services/jobs/tailoringCommands";
import type { AgentSession } from "@/agent/contracts/agentSession";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  await db?.delete();
  db = undefined;
});

describe("P4.3d.1 artifact action runtime", () => {
  it("applies a diff through executor, reducer and persistence without a model call", async () => {
    const job = demoJobDescriptions[0];
    const built = buildJobBranchFromProfile({
      profile: demoCareerProfile,
      jobId: job.id,
      jobTitle: job.title,
      jobVersion: "artifact-test-v1",
      operationId: "artifact-branch-create",
      name: "Artifact 岗位简历",
      selectedCanonicalItemIds: canonicalProfileLibraryItems(demoCareerProfile).slice(0, 4).map((item) => item.id),
      requirementMatchIds: [],
      sourceMatchSetHash: "artifact-match-hash",
      now: "2026-08-02T12:00:00.000Z"
    });
    const created = createTailoringSessionCommand({
      operationId: "artifact-tailoring-create",
      profile: demoCareerProfile,
      branch: built.branch,
      job
    });
    const diffA = {
      target: { sectionId: "summary", itemId: "summary-a", fieldPath: "text" as const },
      operation: "replace" as const,
      original: "原文 A", value: "新文 A", reason: "匹配岗位 A",
      requirementIds: [], targetKeywords: [], evidenceRefs: [], supportLevel: "verified" as const
    };
    const diffB = {
      ...diffA,
      target: { sectionId: "summary", itemId: "summary-b", fieldPath: "text" as const },
      original: "原文 B", value: "新文 B", reason: "匹配岗位 B"
    };
    const now = "2026-08-02T12:00:00.000Z";
    const plan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      questionPlan: { ...created.session.plan.questionPlan!, status: "completed", activeQuestionId: undefined, completedAt: now },
      diffs: [diffA, diffB],
      diffReviews: [diffA, diffB].map((diff) => ({ diffId: tailoringDiffId(diff), status: "suggested", updatedAt: now }))
    });
    const tailoringSession = TailoringSessionSchema.parse({ ...created.session, plan, revision: 4, generatedDiffRevision: 1 });
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "Artifact runtime");
    const reducer = new AgentTaskStateReducer();
    const initial = reducer.create(base, "create_tailored_resume");
    const taskState = reducer.reduce(initial, {
      type: "tool_observation",
      toolName: "generate_tailoring_changes",
      observation: { session: tailoringSession, appliedDiffs: [diffA, diffB] }
    });
    const initialSession: AgentSession = {
      ...base,
      taskState,
      activeTurn: {
        id: "artifact-turn",
        sessionId: base.id,
        status: "waiting_for_user",
        startedAt: now
      }
    };
    let persisted = initialSession;
    const save = vi.fn(async (value: AgentSession) => { persisted = value; return value; });
    const execute = vi.fn(async (input: { toolName: string; toolInput: Record<string, unknown>; operationId: string }) => {
      const data = input.toolName === "review_tailoring_diff"
        ? reviewTailoringDiffCommand({ operationId: input.operationId, ...input.toolInput } as never)
        : input.toolName === "preview_tailoring_changes"
          ? { operationId: input.operationId, preview: true }
          : (() => { throw new Error(`unexpected:${input.toolName}`); })();
      return { ok: true, operationId: input.operationId, toolName: input.toolName, data, artifactIds: [], completedAt: now };
    });
    const runTurn = vi.fn();
    const resumeTurn = vi.fn();
    const host = new AgentHostStore({
      kernel: { runTurn, resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(initialSession);

    const beforeRevision = tailoringSession.revision;
    const result = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    const afterTailoring = result?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(afterTailoring.revision).toBe(beforeRevision + 1);
    expect(result?.taskState?.knownSlots.remainingDiffCount).toBe(1);
    expect(afterTailoring.plan.diffReviews?.find((review) => review.diffId === tailoringDiffId(diffA))?.status).toBe("accepted");
    expect(result?.taskState?.knownSlots.artifactActionFeedback).toMatchObject({
      fieldNames: ["summary.text"]
    });
    const artifactFeedback = result?.taskState?.knownSlots.artifactActionFeedback as { operationId?: string } | undefined;
    expect(String(artifactFeedback?.operationId)).not.toMatch(/accept-none/i);
    expect(result?.messages.some((message) => message.kind === "assistant_thinking" || message.status === "thinking" || message.streaming === true)).toBe(false);
    expect(runTurn).not.toHaveBeenCalled();
    expect(resumeTurn).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(persisted).toEqual(result);

    const activityCount = result?.messages.filter((message) => message.toolName === "review_tailoring_diff").length;
    const [repeated, completed] = await Promise.all([
      host.dispatch({
        type: "artifact_action",
        action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
      }, { pageContext: { pathname: "/ai-workspace", query: {} } }),
      host.dispatch({
        type: "artifact_action",
        action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diffB), decision: "accept" }
      }, { pageContext: { pathname: "/ai-workspace", query: {} } })
    ]);
    const repeatedTailoring = repeated?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(repeatedTailoring.revision).toBe(beforeRevision + 1);
    expect(repeated?.messages.filter((message) => message.toolName === "review_tailoring_diff")).toHaveLength(activityCount ?? 0);
    expect(completed?.taskState).toMatchObject({
      stage: "confirm_apply",
      completionStatus: "waiting_for_confirmation",
      knownSlots: { remainingDiffCount: 0 }
    });
    expect(completed?.pendingConfirmation).toMatchObject({
      toolName: "apply_tailoring_changes",
      status: "pending"
    });
    expect(completed?.pendingToolCall).toMatchObject({ toolName: "apply_tailoring_changes" });
    expect(completed?.activeTurn?.status).toBe("waiting_for_confirmation");
    expect(completed?.pendingConfirmation?.turnId).toBe("artifact-turn");
    expect(runTurn).not.toHaveBeenCalled();
    expect(resumeTurn).not.toHaveBeenCalled();

    const reloadedHost = new AgentHostStore({ kernel: {} as never, executor: {} as never, persistence: { save } as never });
    reloadedHost.adopt(persisted);
    const reloaded = reloadedHost.getSnapshot().activeSession?.taskState?.knownSlots.tailoringSession as typeof tailoringSession;
    expect(reloaded.plan.diffReviews?.find((review) => review.diffId === tailoringDiffId(diffA))?.status).toBe("accepted");
  });

  it("stages diff choices without execution and submits them as one workflow step", async () => {
    const job = demoJobDescriptions[0];
    const built = buildJobBranchFromProfile({
      profile: demoCareerProfile,
      jobId: job.id,
      jobTitle: job.title,
      jobVersion: "artifact-batch-v1",
      operationId: "artifact-batch-branch-create",
      name: "批量提交岗位简历",
      selectedCanonicalItemIds: canonicalProfileLibraryItems(demoCareerProfile).slice(0, 4).map((item) => item.id),
      requirementMatchIds: [],
      sourceMatchSetHash: "artifact-batch-hash",
      now: "2026-08-02T12:00:00.000Z"
    });
    const created = createTailoringSessionCommand({
      operationId: "artifact-batch-tailoring-create",
      profile: demoCareerProfile,
      branch: built.branch,
      job
    });
    const diffA = {
      target: { sectionId: "summary", itemId: "summary-batch", fieldPath: "text" as const },
      operation: "replace" as const,
      original: "批量原文", value: "批量新文", reason: "批量岗位匹配",
      requirementIds: [], targetKeywords: [], evidenceRefs: [], supportLevel: "verified" as const
    };
    const diffB = {
      ...diffA,
      target: { sectionId: "summary", itemId: "summary-batch-2", fieldPath: "text" as const },
      original: "批量原文 2",
      value: "批量新文 2"
    };
    const now = "2026-08-02T12:00:00.000Z";
    const plan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      questionPlan: { ...created.session.plan.questionPlan!, status: "completed", activeQuestionId: undefined, completedAt: now },
      diffs: [diffA, diffB],
      diffReviews: []
    });
    const tailoringSession = TailoringSessionSchema.parse({ ...created.session, plan, revision: 4, generatedDiffRevision: 1 });
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "Artifact batch runtime");
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(reducer.create(base, "create_tailored_resume"), {
      type: "tool_observation",
      toolName: "generate_tailoring_changes",
      observation: { session: tailoringSession, appliedDiffs: [diffA, diffB] }
    });
    const initialSession: AgentSession = {
      ...base,
      taskState,
      messages: [{
        id: "batch-review-status",
        role: "assistant",
        content: "已生成岗位修改建议，请在右侧选择后提交本次选择。",
        kind: "text",
        type: "text",
        status: "complete",
        metadata: { workflowInteractionKind: "review_decision", workflowInteractionProjection: true },
        createdAt: now
      }],
      activeTurn: {
        id: "batch-turn",
        sessionId: base.id,
        status: "waiting_for_user",
        startedAt: now
      }
    };
    let persisted = initialSession;
    const save = vi.fn(async (value: AgentSession) => { persisted = value; return value; });
    const execute = vi.fn(async (input: { toolName: string; toolInput: Record<string, unknown>; operationId: string }) => {
      const data = input.toolName === "review_tailoring_diff"
        ? reviewTailoringDiffCommand({ operationId: input.operationId, ...input.toolInput } as never)
        : input.toolName === "preview_tailoring_changes"
          ? { operationId: input.operationId, preview: true }
          : (() => { throw new Error(`unexpected:${input.toolName}`); })();
      return { ok: true, operationId: input.operationId, toolName: input.toolName, data, artifactIds: [], completedAt: now };
    });
    const host = new AgentHostStore({
      kernel: {} as never,
      executor: { execute } as never,
      persistence: { save } as never
    });
    host.adopt(initialSession);
    const pageContext = { pathname: "/ai-workspace", query: {} };
    const staged = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_stage_decision", diffId: tailoringDiffId(diffA), decision: "accept" }
    }, { pageContext });

    expect(execute).not.toHaveBeenCalled();
    expect(staged?.taskState?.knownSlots.tailoringDraftDiffReviews).toEqual([
      expect.objectContaining({ diffId: tailoringDiffId(diffA), decision: "accept", status: "accepted" })
    ]);

    const partial = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_submit" }
    }, { pageContext });

    expect(execute).not.toHaveBeenCalled();
    expect(partial?.taskState?.knownSlots.tailoringDraftDiffReviews).toEqual([
      expect.objectContaining({ diffId: tailoringDiffId(diffA), decision: "accept", status: "accepted" })
    ]);
    expect(partial?.taskState?.knownSlots.artifactActionFeedback).toMatchObject({
      message: "还有 1 项修改未完成选择，请先逐项选择“采用、编辑后采用”或“忽略”。"
    });

    await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_stage_decision", diffId: tailoringDiffId(diffB), decision: "reject" }
    }, { pageContext });

    const submitted = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_submit" }
    }, { pageContext });

    expect(execute.mock.calls.map(([input]) => input.toolName)).toEqual([
      "review_tailoring_diff",
      "review_tailoring_diff",
      "preview_tailoring_changes"
    ]);
    expect(submitted?.taskState?.knownSlots.tailoringDraftDiffReviews).toEqual([]);
    expect(submitted?.taskState?.knownSlots.tailoringReviewSubmittedDiffRevision).toBe(1);
    expect(submitted?.taskState).toMatchObject({ stage: "confirm_apply", completionStatus: "waiting_for_confirmation" });
    expect(submitted?.messages.filter((message) => message.metadata?.workflowInteractionKind === "review_decision")).toHaveLength(1);
    expect(submitted?.messages.find((message) => message.metadata?.workflowInteractionKind === "confirmation")?.content)
      .toBe("岗位简历预览已生成，确认后我会创建独立岗位简历。");
    expect(persisted).toEqual(submitted);
  });

  it("writes the accepted summary diff through Host confirmation into a new Job Revision", async () => {
    const job = demoJobDescriptions[0];
    const general = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "artifact-general-create",
      name: "通用简历",
      includeProfileFacts: true,
      includeProfileBasics: true,
      now: "2026-08-02T12:00:00.000Z"
    });
    const summary = general.branch.structuredContentItems?.find((item) => item.data.sectionType === "summary");
    if (!summary || summary.data.sectionType !== "summary") throw new Error("summary_fixture_missing");
    const beforeSummary = summary.data.text;
    const fact = demoCareerProfile.experiences[0].facts[0];
    const evidence = {
      type: "experience_fact" as const,
      experienceId: demoCareerProfile.experiences[0].id,
      factId: fact.id,
      factQuote: fact.statement,
      factText: fact.statement
    };
    const acceptedSummary = "基于数据分析项目，使用 Stata 清洗 31 个省级样本并完成区域差异分析。";
    const diff = {
      target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const },
      operation: "replace" as const,
      original: beforeSummary,
      value: acceptedSummary,
      reason: "突出已验证的数据分析交付经验",
      requirementIds: [],
      targetKeywords: ["Stata"],
      evidenceRefs: [evidence],
      supportLevel: "reasonable_inference" as const
    };
    db = new CareerAdaptDb(`ArtifactRuntimeApply-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveJobDescription(job);
    await repository.saveResumeBranch(general.branch);
    await db.resumeRevisions.put(general.firstRevision);

    const created = createTailoringSessionCommand({
      operationId: "artifact-tailoring-apply-create",
      profile: demoCareerProfile,
      branch: general.branch,
      job
    });
    const now = "2026-08-02T12:00:00.000Z";
    const plan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      questionPlan: created.session.plan.questionPlan
        ? { ...created.session.plan.questionPlan, status: "completed", activeQuestionId: undefined, completedAt: now }
        : undefined,
      diffs: [diff],
      diffReviews: [{ diffId: tailoringDiffId(diff), status: "suggested", updatedAt: now }]
    });
    const tailoringSession = TailoringSessionSchema.parse({
      ...created.session,
      plan,
      revision: 2,
      generatedDiffRevision: 1
    });
    const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "Artifact apply runtime");
    const reducer = new AgentTaskStateReducer();
    const initialTaskState = reducer.reduce(
      {
        ...reducer.create(base, "create_tailored_resume"),
        selectedEntities: {
          ...reducer.create(base, "create_tailored_resume").selectedEntities,
          profileId: demoCareerProfile.id,
          resumeId: general.branch.id,
          jobId: job.id
        }
      },
      {
        type: "tool_observation",
        toolName: "generate_tailoring_changes",
        observation: { session: tailoringSession, appliedDiffs: [diff] }
      }
    );
    const initialSession: AgentSession = {
      ...base,
      taskState: initialTaskState,
      messages: [{
        id: "artifact-apply-assistant",
        turnId: "artifact-apply-turn",
        role: "assistant",
        content: "请核对这项岗位修改。",
        kind: "text",
        type: "text",
        status: "complete",
        createdAt: now
      }],
      activeTurn: {
        id: "artifact-apply-turn",
        sessionId: base.id,
        status: "waiting_for_user",
        startedAt: now
      }
    };
    const service = new BrowserAgentToolService(repository);
    const execute = vi.fn(async (input: { toolName: string; toolInput: Record<string, unknown>; operationId: string }) => {
      const data = input.toolName === "review_tailoring_diff"
        ? await service.reviewTailoringDiff(input.toolInput, input.operationId)
        : input.toolName === "preview_tailoring_changes"
          ? await service.previewTailoringChanges(input.toolInput, input.operationId)
          : input.toolName === "apply_tailoring_changes"
            ? await service.applyTailoringChanges(input.toolInput, input.operationId)
            : (() => { throw new Error(`unexpected:${input.toolName}`); })();
      return { ok: true, operationId: input.operationId, toolName: input.toolName, data, artifactIds: [], completedAt: now };
    });
    const sessionStore = new AgentSessionStore(repository);
    const save = vi.fn((value: AgentSession) => sessionStore.save(value));
    const resumeTurn = vi.fn(async (input: { session: AgentSession; observation: unknown }) => {
      const taskState = new AgentTaskStateReducer().reduce(input.session.taskState!, {
        type: "tool_observation",
        toolName: "apply_tailoring_changes",
        observation: input.observation
      });
      return {
        trajectory: {
          taskId: "artifact-apply-task",
          workflowId: taskState.workflowId,
          turns: 1,
          skillsLoaded: [],
          toolCalls: [],
          confirmations: [],
          artifacts: [],
          outcome: "completed" as const,
          errors: []
        },
        conversationSummary: "",
        taskState
      };
    });
    const host = new AgentHostStore({
      kernel: { resumeTurn } as never,
      executor: { execute } as never,
      persistence: { save, get: (sessionId: string) => sessionStore.get(sessionId) } as never
    });
    host.adopt(initialSession);

    const reviewed = await host.dispatch({
      type: "artifact_action",
      action: { type: "tailoring_diff_decision", diffId: tailoringDiffId(diff), decision: "accept" }
    }, { pageContext: { pathname: "/ai-workspace", query: {} } });
    const feedback = reviewed?.taskState?.knownSlots.artifactActionFeedback as Record<string, unknown> | undefined;
    expect(feedback).toMatchObject({ fieldNames: ["summary.text"] });
    expect(String(feedback?.operationId)).not.toMatch(/accept-none/i);
    expect(reviewed?.taskState?.knownSlots.acceptedDiffIds).toEqual([tailoringDiffId(diff)]);
    expect(reviewed?.taskState?.knownSlots.acceptedDiffCount).toBe(1);
    expect(reviewed?.pendingConfirmation?.toolName).toBe("apply_tailoring_changes");

    const confirmed = await host.dispatch({ type: "confirmation", confirmed: true }, {
      pageContext: { pathname: "/ai-workspace", query: {} }
    });
    const qualityResult = confirmed?.taskState?.knownSlots.qualityResult as Record<string, unknown> | undefined;
    expect(qualityResult).toMatchObject({
      acceptedDiffIds: [tailoringDiffId(diff)],
      acceptedDiffCount: 1,
      changedFieldPaths: [`summary.${summary.id}.text`]
    });
    expect(qualityResult?.beforeContentHash).not.toBe(qualityResult?.afterContentHash);
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ toolName: "apply_tailoring_changes", confirmed: true }));

    const jobBranches = (await repository.listResumeBranches(demoCareerProfile.id)).filter((branch) => branch.branchPurpose === "job_specific");
    expect(jobBranches).toHaveLength(1);
    const jobBranch = jobBranches[0];
    const jobRevision = await repository.getResumeRevision(jobBranch.currentRevisionId!);
    const jobSummary = jobBranch.structuredContentItems?.find((item) => item.id === summary.id);
    expect(jobSummary?.data).toMatchObject({ sectionType: "summary", text: acceptedSummary });
    expect(jobRevision?.snapshot.structuredContentItems?.find((item) => item.id === summary.id)?.data).toMatchObject({
      sectionType: "summary",
      text: acceptedSummary
    });
    expect(jobBranch.sourceBranchId).toBe(general.branch.id);
    expect(jobBranch.currentRevisionId).toBeTruthy();
    expect(jobRevision?.id).toBe(jobBranch.currentRevisionId);
    const generalAfter = await repository.getResumeBranch(general.branch.id);
    expect(generalAfter?.revision).toBe(general.branch.revision);
    expect(generalAfter?.currentRevisionId).toBe(general.branch.currentRevisionId);
    expect(generalAfter?.structuredContentItems).toEqual(general.branch.structuredContentItems);
    expect(generalAfter?.structuredContentItems?.find((item) => item.id === summary.id)?.data).toMatchObject({
      sectionType: "summary",
      text: beforeSummary
    });
    expect(await repository.getProfile(demoCareerProfile.id)).toEqual(expect.objectContaining({ version: demoCareerProfile.version }));
  });

  it("writes a session-only external target through the same local apply transaction", async () => {
    const sourceJob = demoJobDescriptions[0];
    const targetSnapshot = createPastedJobTargetSnapshot({
      rawText: sourceJob.rawText,
      graph: analyzeJobDescriptionV4({ rawText: sourceJob.rawText }).graph,
      title: sourceJob.title,
      company: sourceJob.company,
      capturedAt: "2026-08-02T12:00:00.000Z"
    });
    const targetJob = jobTargetSnapshotToJobDescription(targetSnapshot);
    const general = buildGeneralBranchFromProfile({
      profile: demoCareerProfile,
      operationId: "artifact-external-general-create",
      name: "通用简历",
      includeProfileFacts: true,
      includeProfileBasics: true
    });
    const summary = general.branch.structuredContentItems?.find((item) => item.data.sectionType === "summary");
    if (!summary || summary.data.sectionType !== "summary") throw new Error("summary_fixture_missing");
    const fact = demoCareerProfile.experiences[0].facts[0];
    const diff = {
      target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const },
      operation: "replace" as const,
      original: summary.data.text,
      value: "基于已核验经历，突出与目标岗位相关的交付能力。",
      reason: "突出岗位相关的已核验经历",
      requirementIds: [],
      targetKeywords: ["交付"],
      evidenceRefs: [{
        type: "experience_fact" as const,
        experienceId: demoCareerProfile.experiences[0].id,
        factId: fact.id,
        factQuote: fact.statement,
        factText: fact.statement
      }],
      supportLevel: "verified" as const
    };
    db = new CareerAdaptDb(`ArtifactRuntimeExternalApply-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.saveProfile(demoCareerProfile);
    await repository.saveResumeBranch(general.branch);
    await db.resumeRevisions.put(general.firstRevision);

    const created = createTailoringSessionCommand({
      operationId: "artifact-external-tailoring-create",
      profile: demoCareerProfile,
      branch: general.branch,
      job: targetJob,
      targetSnapshot
    });
    const now = "2026-08-02T12:00:00.000Z";
    const plan = ResumeTailoringPlanSchema.parse({
      ...created.session.plan,
      questionPlan: created.session.plan.questionPlan
        ? { ...created.session.plan.questionPlan, status: "completed", activeQuestionId: undefined, completedAt: now }
        : undefined,
      diffs: [diff],
      diffReviews: [{ diffId: tailoringDiffId(diff), status: "accepted", updatedAt: now }]
    });
    const tailoringSession = TailoringSessionSchema.parse({
      ...created.session,
      plan,
      revision: 2,
      generatedDiffRevision: 1
    });
    const service = new BrowserAgentToolService(repository);
    const result = await service.applyTailoringChanges({
      session: tailoringSession,
      selectedDiffs: [diff],
      confirmedRequirementIds: []
    }, "artifact-external-tailoring-apply");

    expect(result.qualityResult).toMatchObject({
      status: "passed",
      repositoryReadBackVerified: true,
      resumeListVisibilityVerified: true,
      acceptedDiffCount: 1,
      changedFieldPaths: [`summary.${summary.id}.text`]
    });
    const jobBranches = (await repository.listResumeBranches(demoCareerProfile.id))
      .filter((branch) => branch.branchPurpose === "job_specific");
    expect(jobBranches).toHaveLength(1);
    expect(jobBranches[0]).toMatchObject({
      targetSnapshotId: targetSnapshot.id,
      targetSnapshotVersion: targetSnapshot.version,
      targetSnapshotHash: expect.any(String),
      sourceBranchId: general.branch.id
    });
    expect(jobBranches[0].jobId).toBeUndefined();
  });
});
