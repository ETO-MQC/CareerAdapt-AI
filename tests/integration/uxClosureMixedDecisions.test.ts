import { expect, it, vi } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { assertTailoringDiffFacts } from "@/domain/jobOptimization/tailoringFactGuard";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createTailoringSessionCommand, reviewTailoringDiffCommand, TailoringSessionSchema, tailoringDiffId } from "@/services/jobs/tailoringCommands";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { advanceTailoringWorkflow } from "@/agent/workflows/tailoringWorkflowDriver";

it("accepts Profile-confirmed Python and facts already present in the resume", () => {
  const profile = structuredClone(demoCareerProfile);
  const experience = profile.experiences[0];
  const fact = experience.facts[0];
  fact.statement = "使用 Python 完成数据处理。";
  const diff = { target: { sectionId: "project", itemId: "example", fieldPath: "highlights" as const },
    operation: "replace" as const, original: ["参与数据处理。"], value: ["使用 Python 完成数据处理。"],
    reason: "使用已确认事实", requirementIds: [], targetKeywords: [], supportLevel: "verified" as const,
    evidenceRefs: [{ type: "experience_fact" as const, experienceId: experience.id, factId: fact.id,
      factQuote: fact.statement, factText: fact.statement }] };
  expect(() => assertTailoringDiffFacts(profile, [diff])).not.toThrow();
  expect(() => assertTailoringDiffFacts(profile, [{ ...diff, original: diff.value, evidenceRefs: [] }])).not.toThrow();
});

it("persists only accepted and edited tailoring decisions and replays the operation", async () => {
  const profile = demoCareerProfile;
  const job = demoJobDescriptions[0];
  const now = "2026-08-02T12:00:00.000Z";
  const source = buildGeneralBranchFromProfile({ profile, operationId: "ux-mixed-source", name: "匿名通用简历",
    includeProfileFacts: true, includeProfileBasics: true, now });
  const summary = source.branch.structuredContentItems?.find(item => item.data.sectionType === "summary");
  const project = source.branch.structuredContentItems?.find(item => item.data.sectionType === "project" && item.data.highlights.length > 0);
  const internship = source.branch.structuredContentItems?.find(item => item.data.sectionType === "internship" && item.data.highlights.length > 0);
  if (!summary || summary.data.sectionType !== "summary" || !project || project.data.sectionType !== "project"
    || !internship || internship.data.sectionType !== "internship") throw new Error("mixed_fixture_missing");
  const fact = profile.experiences[0].facts[0];
  const evidence = [{ type: "experience_fact" as const, experienceId: profile.experiences[0].id, factId: fact.id,
    factQuote: fact.statement, factText: fact.statement }];
  const projectFact = profile.experiences.find(item => item.id === "exp-ai-product")!;
  const projectEvidence = [{ type: "experience_fact" as const, experienceId: projectFact.id, factId: projectFact.facts[0].id,
    factQuote: projectFact.facts[0].statement, factText: projectFact.facts[0].statement }];
  const internshipFact = profile.experiences.find(item => item.id === "exp-gov-internship")!;
  const internshipEvidence = [{ type: "experience_fact" as const, experienceId: internshipFact.id, factId: internshipFact.facts[0].id,
    factQuote: internshipFact.facts[0].statement, factText: internshipFact.facts[0].statement }];
  const common = { operation: "replace" as const, reason: "依据已有内容调整表达", requirementIds: [], targetKeywords: [],
    evidenceRefs: evidence, supportLevel: "verified" as const };
  const diffs = [
    { ...common, target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const }, original: summary.data.text,
      value: "基于数据分析项目，使用 Stata 清洗 31 个省级样本并完成区域差异分析。" },
    { ...common, evidenceRefs: projectEvidence, target: { sectionId: "project", itemId: project.id, fieldPath: "highlights" as const }, original: project.data.highlights,
      value: project.data.highlights.map(text => `职责：${text}`) },
    { ...common, evidenceRefs: internshipEvidence, target: { sectionId: "internship", itemId: internship.id, fieldPath: "highlights" as const }, original: internship.data.highlights,
      value: internship.data.highlights.map(text => `实习经历：${text}`) }
  ];
  const db = new CareerAdaptDb(`ux-mixed-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  await repository.saveProfile(profile);
  const storedProfileBefore = await repository.getProfile(profile.id);
  await repository.saveJobDescription(job);
  await repository.saveResumeBranch(source.branch);
  await db.resumeRevisions.put(source.firstRevision);
  const created = createTailoringSessionCommand({ operationId: "ux-mixed-create", profile, branch: source.branch, job });
  let session = TailoringSessionSchema.parse({ ...created.session, generatedDiffRevision: 1, plan: ResumeTailoringPlanSchema.parse({
    ...created.session.plan, questionPlan: created.session.plan.questionPlan
      ? { ...created.session.plan.questionPlan, status: "completed", activeQuestionId: undefined, completedAt: now } : undefined,
    diffs, diffReviews: [] }) });
  const edited = project.data.highlights.map(text => `项目经历：${text}`);
  const unreviewed = session;
  for (const [index, decision] of (["accept", "edit", "reject"] as const).entries()) {
    session = reviewTailoringDiffCommand({ operationId: `ux-mixed-review-${index}`, session, diffId: tailoringDiffId(diffs[index]), decision,
      ...(decision === "edit" ? { editedValue: edited } : {}) }).session;
  }
  expect(session.plan.diffReviews?.map(review => review.status)).toEqual(["accepted", "edited", "rejected"]);
  expect(await repository.getResumeBranch(source.branch.id)).toEqual(source.branch);
  const service = new BrowserAgentToolService(repository);
  let ignored = unreviewed;
  for (const [index, diff] of diffs.entries()) {
    ignored = reviewTailoringDiffCommand({ operationId: `ux-ignore-review-${index}`, session: ignored,
      diffId: tailoringDiffId(diff), decision: "reject" }).session;
  }
  await expect(service.applyTailoringChanges({ session: ignored, selectedDiffs: [], confirmedRequirementIds: [] }, "ux-ignore-operation"))
    .rejects.toMatchObject({ code: "tailoring_no_selected_changes" });
  const unsafe = reviewTailoringDiffCommand({ operationId: "ux-unsafe-review", session: unreviewed,
    diffId: tailoringDiffId(diffs[1]), decision: "edit", editedValue: ["独立负责并完成 100 个项目。"] }).session;
  await expect(service.previewTailoringChanges({ session: unsafe, selectedDiffs: [], confirmedRequirementIds: [] }, "ux-unsafe-preview"))
    .rejects.toThrow("tailoring_fact_guard_rejected");
  await expect(service.applyTailoringChanges({ session: unsafe, selectedDiffs: [], confirmedRequirementIds: [] }, "ux-unsafe-apply-operation"))
    .rejects.toThrow("tailoring_fact_guard_rejected");
  expect(await repository.getResumeBranch(source.branch.id)).toEqual(source.branch);
  const input = { session, selectedDiffs: [], confirmedRequirementIds: [] };
  for (const [diff, value] of [[diffs[0], diffs[0].value], [diffs[1], edited]] as const) {
    const guard = runRuleFactGuard({ originalText: Array.isArray(diff.original) ? diff.original.join("\n") : diff.original,
      checkedText: Array.isArray(value) ? value.join("\n") : value, usedEvidenceRefs: diff.evidenceRefs });
    expect(guard.ruleFindings.filter(finding => !finding.allowed), diff.target.sectionId).toEqual([]);
  }
  const preview = await service.previewTailoringChanges(input, "ux-mixed-preview-operation");
  expect(preview.rejectedDiffs).toEqual([]);
  const result = await service.applyTailoringChanges(input, "ux-mixed-apply-operation");
  const branch = await repository.getResumeBranch(result.branchId);
  const revision = await repository.getResumeRevision(result.revisionId);
  expect(branch?.sourceBranchId).toBe(source.branch.id);
  expect(branch?.jobId).toBe(job.id);
  expect(revision?.previousRevisionId).toBe(source.branch.currentRevisionId);
  expect(branch?.structuredContentItems?.find(item => item.id === summary.id)?.data).toMatchObject({ text: diffs[0].value });
  expect(branch?.structuredContentItems?.find(item => item.id === project.id)?.data).toMatchObject({ highlights: edited });
  expect(branch?.structuredContentItems?.find(item => item.id === internship.id)?.data).toEqual(internship.data);
  const replay = await service.applyTailoringChanges(input, "ux-mixed-apply-operation");
  expect(replay.revisionId).toBe(result.revisionId);
  await expect(repository.deriveAndApplyTailoringDiffsAtomic({ sourceBranchId: source.branch.id, jobId: "ux-wrong-job",
    expectedSourceRevision: source.branch.revision, expectedSourceRevisionId: source.branch.currentRevisionId!,
    diffs: [diffs[0]], operationId: "ux-mixed-apply-operation", name: "错误岗位" }))
    .rejects.toThrow("tailoring_operation_target_conflict");
  expect(await repository.getResumeBranch(source.branch.id)).toEqual(source.branch);
  if (!branch) throw new Error("saved_job_branch_missing");
  const nextProject = branch.structuredContentItems?.find(item => item.id === project.id);
  if (!nextProject || nextProject.data.sectionType !== "project") throw new Error("saved_project_missing");
  const nextDiff = { ...diffs[1], original: nextProject.data.highlights, value: ["独立负责并完成 100 个项目。"] };
  await expect(repository.applyTailoringDiffs({ branchId: branch.id, jobId: job.id, diffs: [nextDiff],
    operationId: "ux-stale-revision", expectedBranchRevision: branch.revision - 1,
    expectedRevisionId: branch.currentRevisionId! })).rejects.toThrow("revision_conflict");
  await expect(repository.applyTailoringDiffs({ branchId: branch.id, jobId: "ux-other-job", diffs: [nextDiff],
    operationId: "ux-wrong-job", expectedBranchRevision: branch.revision,
    expectedRevisionId: branch.currentRevisionId! })).rejects.toThrow("tailoring_plan_target_invalid");
  expect(await repository.getResumeBranch(branch.id)).toEqual(branch);
  expect(await repository.getProfile(profile.id)).toEqual(storedProfileBefore);
  const next = createTailoringSessionCommand({ operationId: "ux-existing-session", profile, branch, job }).session;
  const nextSession = TailoringSessionSchema.parse({ ...next, plan: { ...next.plan, diffs: [nextDiff], diffReviews: [] } });
  const nextReview = reviewTailoringDiffCommand({ operationId: "ux-existing-review", session: nextSession,
    diffId: tailoringDiffId(nextDiff), decision: "accept" }).session;
  await expect(service.applyTailoringChanges({ session: nextReview, selectedDiffs: [], confirmedRequirementIds: [] }, "ux-existing-unsafe-apply"))
    .rejects.toThrow("tailoring_fact_guard_rejected");
  expect(await repository.getResumeBranch(branch.id)).toEqual(branch);
  expect(await repository.getResumeRevision(result.revisionId)).toEqual(revision);
  const jobB = { ...job, id: "ux-mixed-job-b" };
  await repository.saveJobDescription(jobB);
  const allCreated = createTailoringSessionCommand({ operationId: "ux-all-create", profile, branch: source.branch, job: jobB }).session;
  let allAccepted = TailoringSessionSchema.parse({ ...allCreated, plan: { ...allCreated.plan, diffs, diffReviews: [] } });
  for (const [index, diff] of diffs.entries()) {
    allAccepted = reviewTailoringDiffCommand({ operationId: `ux-all-review-${index}`, session: allAccepted,
      diffId: tailoringDiffId(diff), decision: "accept" }).session;
  }
  const allResult = await service.applyTailoringChanges({ session: allAccepted, selectedDiffs: [], confirmedRequirementIds: [] }, "ux-all-apply-operation");
  expect(allResult.artifactReceipt.acceptedDiffCount).toBe(3);
  expect(allResult.branchId).not.toBe(branch.id);
  expect((await repository.getResumeBranch(branch.id))?.currentRevisionId).toBe(result.revisionId);
  expect(await repository.getResumeBranch(source.branch.id)).toEqual(source.branch);

  const jobC = { ...job, id: "ux-mixed-job-c" };
  await repository.saveJobDescription(jobC);
  const hostCreated = createTailoringSessionCommand({ operationId: "ux-host-create", profile, branch: source.branch, job: jobC }).session;
  const hostPlan = ResumeTailoringPlanSchema.parse({ ...hostCreated.plan,
    questionPlan: hostCreated.plan.questionPlan ? { ...hostCreated.plan.questionPlan, status: "completed", activeQuestionId: undefined, completedAt: now } : undefined,
    diffs, diffReviews: [] });
  const hostTailoring = TailoringSessionSchema.parse({ ...hostCreated, generatedDiffRevision: 1, plan: hostPlan });
  const base = { ...AgentRuntime.create("tailor_existing_resume", "preview_changes", "匿名三项定制"),
    personId: "ux-host-person", activeProfileId: profile.id, profileVersionNumber: 1, profileRevision: profile.version };
  const reducer = new AgentTaskStateReducer();
  const initialTask = reducer.create(base, "create_tailored_resume");
  const taskState = reducer.reduce({ ...initialTask, selectedEntities: { ...initialTask.selectedEntities,
    profileId: profile.id, resumeId: source.branch.id, jobId: jobC.id } }, {
    type: "tool_observation", toolName: "generate_tailoring_changes", observation: { session: hostTailoring, appliedDiffs: diffs }
  });
  const initial: AgentSession = { ...base, taskState, activeTurn: { id: "ux-host-turn", sessionId: base.id, status: "waiting_for_user", startedAt: now } };
  const store = new AgentSessionStore(repository);
  const executor = new AgentExecutor(createAgentToolRegistry(service));
  const resumeTurn = async (input: { session: AgentSession; observation: unknown }) => ({
    trajectory: { taskId: "ux-host-task", workflowId: input.session.taskState!.workflowId, turns: 1, skillsLoaded: [], toolCalls: [], confirmations: [], artifacts: [], outcome: "completed" as const, errors: [] },
    conversationSummary: "", taskState: reducer.reduce(input.session.taskState!, { type: "tool_observation", toolName: "apply_tailoring_changes", observation: input.observation })
  });
  let injectedRace = false;
  const save = async (value: AgentSession) => {
    if (!injectedRace && Array.isArray(value.taskState?.knownSlots.tailoringDraftDiffReviews)
      && value.taskState.knownSlots.tailoringDraftDiffReviews.length > 0) {
      injectedRace = true;
      const latest = await store.get(value.id);
      if (latest) await store.save(latest);
    }
    return store.save(value);
  };
  const dependencies = { kernel: { resumeTurn } as never, executor,
    persistence: { save, get: (id: string) => store.get(id) } as never };
  let host = new AgentHostStore(dependencies);
  host.adopt(await store.save(initial));
  const context = { pageContext: { pathname: "/ai-workspace", query: {} } };
  for (const [index, decision] of (["accept", "edit", "reject"] as const).entries()) {
    const staged = await host.dispatch({ type: "artifact_action", action: { type: "tailoring_diff_stage_decision", diffId: tailoringDiffId(diffs[index]), decision,
      ...(decision === "edit" ? { editedValue: edited.join("\n") } : {}) } }, context);
    expect(staged?.taskState?.knownSlots.artifactActionFeedback, `feedback ${index}`).toMatchObject({ result: "handled" });
    expect(staged?.taskState?.knownSlots.tailoringDraftDiffReviews, `stage ${index}`).toHaveLength(index + 1);
  }
  const restoredSession = await store.get(initial.id);
  expect(injectedRace).toBe(true);
  expect(restoredSession?.taskState?.knownSlots.tailoringDraftDiffReviews).toEqual(diffs.map((diff, index) =>
    expect.objectContaining({ diffId: tailoringDiffId(diff), decision: ["accept", "edit", "reject"][index] })));
  expect((await repository.listResumeBranches(profile.id)).filter(item => item.jobId === jobC.id)).toHaveLength(0);
  host = new AgentHostStore(dependencies);
  host.adopt(restoredSession!);
  const submitted = await host.dispatch({ type: "artifact_action", action: { type: "tailoring_diff_submit" } }, context);
  expect(submitted?.pendingConfirmation?.toolName).toBe("apply_tailoring_changes");
  const rejectedPreview = await advanceTailoringWorkflow({ taskState: { ...submitted!.taskState!, stage: "preview_changes", completionStatus: "active",
    knownSlots: { ...submitted!.taskState!.knownSlots, remainingDiffCount: 0, acceptedDiffCount: 2 } }, operationId: "ux-rejected-preview",
    execute: async () => ({ ok: true, operationId: "ux-preview-result", toolName: "preview_tailoring_changes",
      data: { appliedDiffs: [diffs[0]], rejectedDiffs: [{ diff: diffs[1], reasonCode: "invalid_value_type" }], patches: [] }, artifactIds: [], completedAt: now }) });
  expect(rejectedPreview).toMatchObject({ kind: "RECOVERABLE_FAILURE", error: { code: "tailoring_preview_rejected" } });
  const confirmed = await host.dispatch({ type: "confirmation", confirmed: true }, context);
  expect(confirmed?.taskState?.knownSlots.qualityResult).toMatchObject({ acceptedDiffCount: 2, repositoryReadBackVerified: true });
  const hostBranch = (await repository.listResumeBranches(profile.id)).find(item => item.jobId === jobC.id);
  expect(hostBranch?.currentRevisionId).toBeTruthy();
  expect(hostBranch?.structuredContentItems?.find(item => item.id === project.id)?.data).toMatchObject({ highlights: edited });
  expect(hostBranch?.structuredContentItems?.find(item => item.id === internship.id)?.data).toEqual(internship.data);
  expect((await store.get(initial.id))?.taskState?.knownSlots.qualityResult).toMatchObject({ acceptedDiffCount: 2, repositoryReadBackVerified: true });
  db.close();
});

it("preserves an explicitly confirmed session-only declaration during tailoring preview", async () => {
  const profile = demoCareerProfile;
  const job = demoJobDescriptions[0];
  const source = buildGeneralBranchFromProfile({ profile, operationId: "ux-session-source", name: "匿名通用简历",
    includeProfileFacts: true, includeProfileBasics: true });
  const project = source.branch.structuredContentItems?.find(item => item.data.sectionType === "project" && item.data.highlights.length > 0);
  if (!project || project.data.sectionType !== "project") throw new Error("project_fixture_missing");
  const created = createTailoringSessionCommand({ operationId: "ux-session-create", profile, branch: source.branch, job }).session;
  const question = { id: "ux-python-question", question: "你是否使用过 Python？", requirementIds: ["ux-python-requirement"],
    sourceItemIds: [project.id], relatedItemIds: [project.id], candidateClaim: "Python", targetFieldPaths: ["highlights"],
    answerType: "text" as const, status: "answered" as const };
  const diff = { target: { sectionId: "project", itemId: project.id, fieldPath: "highlights" as const }, operation: "replace" as const,
    original: project.data.highlights, value: [...project.data.highlights, "使用 Python 完成数据处理。"],
    reason: "使用已确认的本次任务回答", requirementIds: ["ux-python-requirement"], targetKeywords: [], evidenceRefs: [], supportLevel: "user_declared" as const };
  const confirmedAt = new Date().toISOString();
  const session = TailoringSessionSchema.parse({ ...created, plan: { ...created.plan, clarificationQuestions: [question],
    questionPlan: { questionPlanVersion: 2, id: "ux-python-plan", sessionId: created.id, revision: 1, status: "completed", defaultBudget: 1,
      maximumBudget: 1, questionIds: [question.id], answeredQuestionIds: [question.id], skippedQuestionIds: [], uncertainQuestionIds: [],
      createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
    clarificationAnswers: [{ questionId: question.id, status: "accepted", answer: "使用 Python 完成数据处理。", answerRevision: 1, resolvedAt: confirmedAt }],
    answerReceipts: [{ questionPlanId: "ux-python-plan", questionPlanRevision: 1, questionId: question.id,
      answerMessageId: "ux-python-message", disposition: "answered", answerText: "使用 Python 完成数据处理。", consumedAt: confirmedAt }],
    diffs: [diff], diffReviews: [] } });
  const reviewed = reviewTailoringDiffCommand({ operationId: "ux-session-review", session, diffId: tailoringDiffId(diff), decision: "accept" }).session;
  const db = new CareerAdaptDb(`ux-session-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  await repository.saveProfile(profile);
  const profileBefore = await repository.getProfile(profile.id);
  await repository.saveJobDescription(job);
  await repository.saveResumeBranch(source.branch);
  await db.resumeRevisions.put(source.firstRevision);
  const base = AgentRuntime.create("tailor_existing_resume", "preview_changes", "任务证据测试");
  const task = new AgentTaskStateReducer().create(base, "create_tailored_resume");
  const receipt = session.plan.answerReceipts[0];
  const saved = await repository.saveAgentSession({ ...base, personId: "ux-person", activeProfileId: profile.id,
    profileVersionNumber: 1, profileRevision: profile.version,
    messages: [{ id: receipt.answerMessageId, role: "user", status: "complete", content: receipt.answerText!, branchId: base.activeBranchId,
      turnId: "ux-python-turn", createdAt: receipt.consumedAt, metadata: { tailoringAnswerReceipt: receipt } }],
    taskState: { ...task, selectedEntities: { ...task.selectedEntities, profileId: profile.id, jobId: job.id,
      resumeId: source.branch.id, revisionId: source.branch.currentRevisionId! },
      knownSlots: { ...task.knownSlots, tailoringSession: session } } });
  const binding = { agentSessionId: saved.id, personId: "ux-person", profileId: profile.id,
    profileVersionNumber: 1, profileRevision: profile.version };
  const service = new BrowserAgentToolService(repository);
  const input = { session: reviewed, selectedDiffs: [], confirmedRequirementIds: [] };
  await expect(service.previewTailoringChanges(input, "ux-session-untrusted-preview")).rejects.toThrow("tailoring_fact_guard_rejected");
  const preview = await service.previewTailoringChanges(input, "ux-session-preview", undefined, { operationId: "ux-session-preview", careerSessionBinding: binding });
  expect(preview.rejectedDiffs).toEqual([]);
  expect(preview.appliedDiffs).toHaveLength(1);
  const taskExecutor = new AgentExecutor(createAgentToolRegistry(service));
  const beforeEvidenceRead = await db.agentSessions.get(saved.id);
  const registryPreview = await taskExecutor.execute({ toolName: "preview_tailoring_changes", toolInput: input,
    operationId: "ux-session-registry-preview", careerSessionBinding: binding });
  expect(registryPreview.ok).toBe(true);
  expect(await db.agentSessions.get(saved.id)).toEqual(beforeEvidenceRead);
  const hostReducer = new AgentTaskStateReducer();
  const hostTask = hostReducer.reduce(saved.taskState!, { type: "tool_observation", toolName: "generate_tailoring_changes",
    observation: { session, appliedDiffs: [diff] } });
  const hostStore = new AgentSessionStore(repository);
  const hostSession = await hostStore.save({ ...saved, taskState: hostTask,
    activeTurn: { id: "ux-task-answer-turn", sessionId: saved.id, status: "waiting_for_user", startedAt: confirmedAt } });
  const host = new AgentHostStore({ executor: taskExecutor,
    persistence: { save: (value: AgentSession) => hostStore.save(value), get: (id: string) => hostStore.get(id) } as never } as never);
  host.adopt(hostSession);
  const hostContext = { pageContext: { pathname: "/ai-workspace", query: {} } };
  await host.dispatch({ type: "artifact_action", action: { type: "tailoring_diff_stage_decision",
    diffId: tailoringDiffId(diff), decision: "accept" } }, hostContext);
  const hostSubmitted = await host.dispatch({ type: "artifact_action", action: { type: "tailoring_diff_submit" } }, hostContext);
  expect(hostSubmitted?.pendingConfirmation?.toolName).toBe("apply_tailoring_changes");
  const summary = source.branch.structuredContentItems?.find((item) => item.data.sectionType === "summary");
  const internship = source.branch.structuredContentItems?.find((item) => item.data.sectionType === "internship" && item.data.highlights.length > 0);
  if (!summary || summary.data.sectionType !== "summary" || !internship || internship.data.sectionType !== "internship") throw new Error("task_mixed_fixture_missing");
  const profileFact = profile.experiences[0].facts[0];
  const firstDiff = { ...diff, target: { sectionId: "summary", itemId: summary.id, fieldPath: "text" as const },
    original: summary.data.text, value: "基于数据分析项目，使用 Stata 清洗 31 个省级样本并完成区域差异分析。",
    supportLevel: "verified" as const, evidenceRefs: [{ type: "experience_fact" as const, experienceId: profile.experiences[0].id,
      factId: profileFact.id, factQuote: profileFact.statement, factText: profileFact.statement }] };
  const editDiff = { ...diff, value: [...project.data.highlights, "使用 Python 进行数据处理。"] };
  const ignoreDiff = { ...diff, target: { sectionId: "internship", itemId: internship.id, fieldPath: "highlights" as const },
    original: internship.data.highlights, value: internship.data.highlights.map((text) => `实习经历：${text}`) };
  let mixed = TailoringSessionSchema.parse({ ...session, plan: { ...session.plan, diffs: [firstDiff, editDiff, ignoreDiff], diffReviews: [] } });
  for (const [index, candidate] of [firstDiff, editDiff, ignoreDiff].entries()) {
    const decision = (["accept", "edit", "reject"] as const)[index];
    mixed = reviewTailoringDiffCommand({ operationId: `ux-task-mixed-review-${index}`, session: mixed,
      diffId: tailoringDiffId(candidate), decision, ...(decision === "edit" ? { editedValue: diff.value } : {}) }).session;
  }
  const mixedInput = { session: mixed, selectedDiffs: [], confirmedRequirementIds: [] };
  const mixedApplied = await taskExecutor.execute({ toolName: "apply_tailoring_changes", toolInput: mixedInput,
    operationId: "ux-task-mixed-apply", careerSessionBinding: binding, confirmed: true });
  expect(mixedApplied.ok).toBe(true);
  const mixedResult = mixedApplied.data as Awaited<ReturnType<typeof service.applyTailoringChanges>>;
  const mixedBranch = await repository.getResumeBranch(mixedResult.branchId);
  expect(mixedResult.artifactReceipt.acceptedDiffCount).toBe(2);
  expect(mixedBranch?.structuredContentItems?.find((item) => item.id === project.id)?.data).toMatchObject({ highlights: diff.value });
  expect(mixedBranch?.structuredContentItems?.find((item) => item.id === internship.id)?.data).toEqual(internship.data);
  expect(await repository.getTailoringRevisionProvenance(mixedResult.revisionId)).toMatchObject({
    sources: [expect.objectContaining({ factText: receipt.answerText, sourceMessageId: receipt.answerMessageId })]
  });
  expect(await repository.getProfile(profile.id)).toEqual(profileBefore);
  const unsafeDiff = { ...diff, value: [...project.data.highlights, "独立负责并完成 100 个项目。"] };
  const unsafeSession = TailoringSessionSchema.parse({ ...created, plan: { ...created.plan, diffs: [unsafeDiff], diffReviews: [] } });
  const unsafe = reviewTailoringDiffCommand({ operationId: "ux-session-unsafe-review", session: unsafeSession,
    diffId: tailoringDiffId(unsafeDiff), decision: "accept" }).session;
  await expect(service.previewTailoringChanges({ session: unsafe, selectedDiffs: [], confirmedRequirementIds: [] },
    "ux-session-unsafe-preview", undefined, { operationId: "ux-session-unsafe-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  await expect(service.previewTailoringChanges(input, "ux-other-session", undefined, { operationId: "ux-other-session",
    careerSessionBinding: { ...binding, agentSessionId: "other-session" } })).rejects.toThrow("tailoring_fact_guard_rejected");
  const otherJob = { ...input, session: { ...reviewed, job: { ...reviewed.job, id: "ux-other-job" } } };
  await expect(service.previewTailoringChanges(otherJob, "ux-other-job-preview", undefined,
    { operationId: "ux-other-job-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  const otherBranch = { ...input, session: { ...reviewed, branch: { ...reviewed.branch, id: "ux-other-branch" } } };
  await expect(service.previewTailoringChanges(otherBranch, "ux-other-branch-preview", undefined,
    { operationId: "ux-other-branch-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  const otherRevision = { ...input, session: { ...reviewed, branch: { ...reviewed.branch, currentRevisionId: "ux-other-revision" } } };
  await expect(service.previewTailoringChanges(otherRevision, "ux-other-revision-preview", undefined,
    { operationId: "ux-other-revision-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  const yesBase = AgentRuntime.create("tailor_existing_resume", "preview_changes", "明确问题确认测试");
  const yesReceipt = { ...receipt, answerMessageId: "ux-yes-message", answerText: "是" };
  const yesQuestion = { ...question, candidateClaim: "使用 Python 完成数据处理。", question: "你是否使用 Python 完成数据处理？", answer: "是", answeredAt: confirmedAt };
  const yesTailoring = { ...session, plan: { ...session.plan, clarificationQuestions: [yesQuestion], answerReceipts: [yesReceipt],
    clarificationAnswers: session.plan.clarificationAnswers!.map((answer) => ({ ...answer, answer: "是" })) } };
  const yesSession = await repository.saveAgentSession({ ...yesBase, personId: "ux-person", activeProfileId: profile.id,
    profileVersionNumber: 1, profileRevision: profile.version, taskState: { ...task, selectedEntities: { ...task.selectedEntities,
      profileId: profile.id, jobId: job.id, resumeId: source.branch.id, revisionId: source.branch.currentRevisionId! },
      knownSlots: { ...task.knownSlots, tailoringSession: yesTailoring } }, messages: [
        { id: "ux-yes-question", role: "assistant", status: "complete", branchId: yesBase.activeBranchId,
          turnId: "ux-yes-turn", content: `已记录。\n\n问题 1/1：\n\n${yesQuestion.question}\n\n你可以直接补充说明，或回复“跳过”。`, createdAt: confirmedAt,
          metadata: { tailoringQuestionProjection: true, questionId: question.id, questionPlanId: yesReceipt.questionPlanId,
            questionText: yesQuestion.question, questionProjectionState: "resolved", answerMessageId: yesReceipt.answerMessageId } },
        { id: yesReceipt.answerMessageId, role: "user", status: "complete", branchId: yesBase.activeBranchId,
          turnId: "ux-yes-turn", content: "是", createdAt: confirmedAt, metadata: { tailoringAnswerReceipt: yesReceipt } }
      ] });
  const yesBinding = { ...binding, agentSessionId: yesSession.id };
  const yesEvidence = await repository.resolveTailoringTaskEvidence({ binding: yesBinding, taskId: session.id, jobId: job.id,
    branchId: source.branch.id, baseRevisionId: source.branch.currentRevisionId!, diffs: [diff] });
  expect(yesEvidence).toEqual([expect.objectContaining({ confirmationMethod: "answer_to_persisted_question",
    sourceMessageId: yesReceipt.answerMessageId, questionMessageId: "ux-yes-question", factText: "使用 Python 完成数据处理。" })]);
  const yesReviewed = reviewTailoringDiffCommand({ operationId: "ux-yes-review", session: yesTailoring,
    diffId: tailoringDiffId(diff), decision: "accept" }).session;
  const yesInput = { session: yesReviewed, selectedDiffs: [], confirmedRequirementIds: [] };
  const yesPreview = await service.previewTailoringChanges(yesInput, "ux-yes-preview", undefined,
    { operationId: "ux-yes-preview", careerSessionBinding: yesBinding });
  expect(yesPreview.appliedDiffs).toHaveLength(1);
  const yesResult = await service.applyTailoringChanges(yesInput, "ux-yes-apply", undefined,
    { operationId: "ux-yes-apply", careerSessionBinding: yesBinding });
  expect(await repository.getTailoringRevisionProvenance(yesResult.revisionId)).toMatchObject({
    sources: [expect.objectContaining({ questionMessageId: "ux-yes-question", confirmationMethod: "answer_to_persisted_question",
      questionText: yesQuestion.question, confirmationAnswer: "是" })]
  });
  await db.agentMessages.delete("ux-yes-question");
  expect(await repository.resolveTailoringTaskEvidence({ binding: yesBinding, taskId: session.id, jobId: job.id,
    branchId: source.branch.id, baseRevisionId: source.branch.currentRevisionId!, diffs: [diff] })).toEqual([]);
  expect(await repository.getTailoringRevisionProvenance(yesResult.revisionId)).toMatchObject({
    sources: [expect.objectContaining({ questionText: yesQuestion.question, confirmationAnswer: "是" })]
  });
  await db.agentMessages.update(receipt.answerMessageId, { role: "assistant" });
  await expect(service.previewTailoringChanges(input, "ux-assistant-only", undefined,
    { operationId: "ux-assistant-only", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  await db.agentMessages.update(receipt.answerMessageId, { role: "user" });
  const reloaded = await repository.getAgentSession(saved.id);
  expect(reloaded?.messages.some((message) => message.id === receipt.answerMessageId && message.role === "user")).toBe(true);
  const bareReceipt = { ...receipt, answerText: "好的" };
  const bareTailoring = { ...session, plan: { ...session.plan, answerReceipts: [bareReceipt],
    clarificationAnswers: session.plan.clarificationAnswers!.map((answer) => ({ ...answer, answer: "好的" })) } };
  const bare = await repository.saveAgentSession({ ...reloaded!, messages: reloaded!.messages.map((message) => message.id === receipt.answerMessageId
    ? { ...message, content: "好的", metadata: { ...message.metadata, tailoringAnswerReceipt: bareReceipt } } : message),
    taskState: { ...reloaded!.taskState!, knownSlots: { ...reloaded!.taskState!.knownSlots, tailoringSession: bareTailoring } },
    updatedAt: new Date().toISOString() });
  const bareDiff = { ...diff, value: [...project.data.highlights, "好的"] };
  expect(await repository.resolveTailoringTaskEvidence({ binding, taskId: session.id, jobId: job.id,
    branchId: source.branch.id, baseRevisionId: source.branch.currentRevisionId!, diffs: [bareDiff] })).toEqual([]);
  const afterBare = await repository.getAgentSession(bare.id);
  const restoredAnswer = await repository.saveAgentSession({ ...afterBare!, messages: afterBare!.messages.map((message) => message.id === receipt.answerMessageId
    ? { ...message, content: receipt.answerText!, metadata: { ...message.metadata, tailoringAnswerReceipt: receipt } } : message),
    taskState: { ...afterBare!.taskState!, knownSlots: { ...afterBare!.taskState!.knownSlots, tailoringSession: session } },
    updatedAt: new Date().toISOString() });
  const revokedTailoring = { ...session, plan: { ...session.plan,
    clarificationAnswers: session.plan.clarificationAnswers!.map((answer) => ({ ...answer, status: "rejected" as const })) } };
  const beforeRevocation = await repository.getAgentSession(restoredAnswer.id);
  await repository.saveAgentSession({ ...beforeRevocation!, taskState: { ...beforeRevocation!.taskState!,
    knownSlots: { ...beforeRevocation!.taskState!.knownSlots, tailoringSession: revokedTailoring } }, updatedAt: new Date().toISOString() });
  await expect(service.previewTailoringChanges(input, "ux-revoked-preview", undefined,
    { operationId: "ux-revoked-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  const afterRevocation = await repository.getAgentSession(saved.id);
  await repository.saveAgentSession({ ...afterRevocation!, taskState: { ...afterRevocation!.taskState!,
    knownSlots: { ...afterRevocation!.taskState!.knownSlots, tailoringSession: session } }, updatedAt: new Date().toISOString() });
  expect(((await repository.getAgentSession(saved.id))!.taskState!.knownSlots.tailoringSession as typeof session).plan.clarificationAnswers?.[0].status).toBe("accepted");
  expect(await repository.resolveTailoringTaskEvidence({ binding, taskId: session.id, jobId: job.id,
    branchId: source.branch.id, baseRevisionId: source.branch.currentRevisionId!, diffs: [diff] })).toHaveLength(1);
  const branchCount = (await repository.listResumeBranches(profile.id)).length;
  const revisionCount = await db.resumeRevisions.count();
  const failAudit = (key: string) => { if (String(key).startsWith("tailoring-provenance:")) throw new Error("ux-audit-write-failed"); };
  db.appMeta.hook("creating", failAudit);
  await expect(repository.deriveAndApplyTailoringDiffsAtomic({ sourceBranchId: source.branch.id, jobId: job.id,
    expectedSourceRevision: source.branch.revision, expectedSourceRevisionId: source.branch.currentRevisionId!,
    expectedProfileRevision: profile.version, expectedJobRevision: job.updatedAt, diffs: [diff], operationId: "ux-rollback-apply",
    name: "回滚测试", taskEvidenceContext: { binding, taskId: session.id } })).rejects.toThrow("ux-audit-write-failed");
  db.appMeta.hook("creating").unsubscribe(failAudit);
  expect((await repository.listResumeBranches(profile.id)).length).toBe(branchCount);
  expect(await db.resumeRevisions.count()).toBe(revisionCount);
  await expect(taskExecutor.execute({ toolName: "apply_tailoring_changes", toolInput: input,
    operationId: "ux-session-apply", careerSessionBinding: binding })).rejects.toMatchObject({ code: "agent_confirmation_required" });
  const applied = await taskExecutor.execute({ toolName: "apply_tailoring_changes", toolInput: input,
    operationId: "ux-session-apply", careerSessionBinding: binding, confirmed: true });
  expect(applied.ok).toBe(true);
  const result = applied.data as Awaited<ReturnType<typeof service.applyTailoringChanges>>;
  expect(await repository.getProfile(profile.id)).toEqual(profileBefore);
  const audit = await repository.getTailoringRevisionProvenance(result.revisionId) as { resultRevisionId: string; sources: Array<{ factText: string; sourceMessageId: string }> };
  expect(audit.resultRevisionId).toBe(result.revisionId);
  expect(audit.sources).toEqual([expect.objectContaining({ factText: receipt.answerText, sourceMessageId: receipt.answerMessageId })]);
  await expect(repository.setMeta(`tailoring-provenance:${result.revisionId}`, {})).rejects.toThrow("tailoring_provenance_immutable");
  const replay = await service.applyTailoringChanges(input, "ux-session-apply", undefined, { operationId: "ux-session-apply", careerSessionBinding: binding });
  expect(replay.revisionId).toBe(result.revisionId);
  const readback = vi.spyOn(repository, "getAvailableResumeBranch").mockResolvedValueOnce(undefined);
  await expect(service.applyTailoringChanges(input, "ux-lost-readback", undefined,
    { operationId: "ux-lost-readback", careerSessionBinding: binding })).rejects.toMatchObject({ code: "artifact_commit_visibility_verification_failed" });
  readback.mockRestore();
  const recoveredOperation = await repository.getTailoringOperationResult("ux-lost-readback");
  expect(recoveredOperation?.revisionId).toBeTruthy();
  expect(await repository.getResumeArtifactWriteCheckpoint("ux-lost-readback")).toMatchObject({
    status: "visibility_verification_failed", resultResumeId: recoveredOperation!.branchId, resultResumeRevisionId: recoveredOperation!.revisionId
  });
  const countAfterLostResponse = await db.resumeRevisions.count();
  const recovered = await service.applyTailoringChanges(input, "ux-lost-readback", undefined,
    { operationId: "ux-lost-readback", careerSessionBinding: binding });
  expect(recovered.revisionId).toBe(recoveredOperation!.revisionId);
  expect(await db.resumeRevisions.count()).toBe(countAfterLostResponse);
  await expect(repository.deriveAndApplyTailoringDiffsAtomic({ sourceBranchId: source.branch.id, jobId: job.id,
    expectedSourceRevision: source.branch.revision, expectedSourceRevisionId: source.branch.currentRevisionId!,
    diffs: [diff], operationId: "ux-session-apply", name: "不应跨会话重放",
    taskEvidenceContext: { binding: { ...binding, agentSessionId: "other-session" }, taskId: session.id } }))
    .rejects.toThrow("tailoring_provenance_replay_conflict");
  const completedSession = await repository.getAgentSession(saved.id);
  await repository.saveAgentSession({ ...completedSession!, taskState: { ...completedSession!.taskState!, completionStatus: "completed" },
    updatedAt: new Date().toISOString() });
  await expect(service.previewTailoringChanges(input, "ux-completed-task-preview", undefined,
    { operationId: "ux-completed-task-preview", careerSessionBinding: binding })).rejects.toThrow("tailoring_fact_guard_rejected");
  await repository.deleteAgentSession(saved.id);
  expect(await repository.getAgentSession(saved.id)).toBeUndefined();
  expect(await db.agentMessages.where("sessionId").equals(saved.id).count()).toBe(0);
  expect(await repository.getTailoringRevisionProvenance(result.revisionId)).toEqual(audit);
  const target = await repository.getResumeBranch(result.branchId);
  const archived = await repository.archiveResumeBranch({ branchId: result.branchId, expectedRevision: target!.revision,
    operationId: "ux-archive-target", confirmedImpact: true });
  expect(await repository.getTailoringRevisionProvenance(result.revisionId)).toEqual(audit);
  const trashed = await repository.moveResumeBranchToTrash({ branchId: result.branchId, expectedRevision: archived.branch.revision,
    operationId: "ux-trash-target" });
  expect((await repository.deleteResumeBranchPermanently({ branchId: result.branchId, expectedRevision: trashed.branch.revision })).deleted).toBe(true);
  expect(await repository.getTailoringRevisionProvenance(result.revisionId)).toBeUndefined();
  db.close();
});
