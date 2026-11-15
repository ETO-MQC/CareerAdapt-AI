import { afterEach, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { resolveCareerAgentContext } from "@/agent/runtime/careerContextBindingResolver";
import { demoCareerProfile } from "@/data/demoProfile";
import { assessResumeProfileCompatibility } from "@/domain/branch/validation";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { buildCareerIntelligence } from "@/domain/jobOptimization/careerIntelligence";
import { jd02Fixture } from "../fixtures/jd02";
import type { ResumeTailoringDiff } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });

it("discovers an unchanged historical branch only within the same person and keeps it selected in career context", async () => {
  db = new CareerAdaptDb(`person-resume-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const { profile } = await repository.createPerson("甲");
  const old = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "old-version-resume",
    name: "原简历", includeProfileBasics: true, includeProfileFacts: true });
  const beforeBranch = await repository.getResumeBranch(old.branch.id);
  const beforeRevision = await repository.getResumeRevision(old.revision!.id);
  const branchWrites = vi.spyOn(db.resumeBranches, "put");
  const revisionWrites = vi.spyOn(db.resumeRevisions, "put");
  const explicitVersion = await repository.createProfileVersion({ profileId: profile.id });
  const receipt = { newProfileId: explicitVersion.id, newRevision: explicitVersion.version };
  expect(branchWrites).not.toHaveBeenCalled();
  expect(revisionWrites).not.toHaveBeenCalled();
  expect(await repository.getResumeBranch(old.branch.id)).toEqual(beforeBranch);
  expect(await repository.getResumeRevision(old.revision!.id)).toEqual(beforeRevision);
  expect(await repository.listAvailableResumesForCareerProfile(receipt.newProfileId)).toMatchObject([
    { branch: { id: old.branch.id, profileId: profile.id }, compatibility: { status: "profile_updated" } }
  ]);
  const session = AgentRuntime.createConversationSession();
  session.personId = profile.personId;
  session.taskState = AgentTaskStateSchema.parse({ rootGoal: "fit", workflowId: "analyze_job_fit", stage: "select",
    selectedEntities: { profileId: receipt.newProfileId, profileVersion: receipt.newRevision, resumeId: old.branch.id,
      revisionId: old.revision!.id }, knownSlots: {}, updatedAt: new Date().toISOString() });
  expect(await resolveCareerAgentContext(session, repository)).toMatchObject({ profileId: receipt.newProfileId,
    resumeBranchId: old.branch.id, revisionId: old.revision!.id });
  const service = new BrowserAgentToolService(repository);
  expect((await service.prepareAvailableRuntimeContext(session, false)).session.taskState?.selectedEntities.resumeId).toBe(old.branch.id);
  const other = await repository.createPerson("乙");
  const foreign = await repository.createGeneralResumeBranch({ profileId: other.profile.id, operationId: "other-person-resume",
    name: "其他人物简历", includeProfileBasics: true, includeProfileFacts: true });
  expect((await repository.listAvailableResumesForCareerProfile(other.profile.id)).map(row => row.branch.id)).toEqual([foreign.branch.id]);
  const registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry),
    assertAvailableTargets: (name, input, binding) => service.assertAvailableToolTargets(name, input, binding),
    filterAvailableResult: (name, data, binding) => service.filterAvailableToolResult(name, data, binding) });
  const binding = { agentSessionId: session.id, personId: profile.personId!, profileId: receipt.newProfileId,
    profileVersionNumber: 2, profileRevision: receipt.newRevision };
  const listed = await gateway.execute("career.resume.list", {}, { operationId: "same-person-list", careerSessionBinding: binding });
  expect(listed.ok).toBe(true);
  expect(listed.data).toMatchObject({ resumes: [{ id: old.branch.id, profileId: profile.id,
    compatibility: { status: "profile_updated" } }] });
  const read = await gateway.execute("career.resume.get", { resumeId: old.branch.id }, { operationId: "same-person-read", careerSessionBinding: binding });
  expect(read.ok).toBe(true);
  expect(read.data).toMatchObject({ resume: { id: old.branch.id, profileId: profile.id } });
  const rejected = await gateway.execute("career.resume.get", { resumeId: foreign.branch.id }, { operationId: "other-person-read", careerSessionBinding: binding });
  expect(rejected.ok).toBe(false);
  session.personId = other.profile.personId;
  session.taskState.selectedEntities.profileId = other.profile.id;
  session.taskState.selectedEntities.profileVersion = other.profile.version;
  expect((await resolveCareerAgentContext(session, repository)).resumeBranchId).toBeUndefined();
});

it("rejects missing or changed fact references even when profile revisions happen to match", () => {
  const source = { ...demoCareerProfile, id: "source", personId: "person" };
  const current = structuredClone({ ...source, id: "current" });
  const fact = source.experiences[0].facts[0];
  const ref = { type: "experience_fact" as const, experienceId: source.experiences[0].id, factId: fact.id };
  const branch = { profileId: source.id, sourceProfileVersion: source.version,
    contentItems: [{ factRefs: [ref] }] } as Parameters<typeof assessResumeProfileCompatibility>[0]["branch"];
  expect(assessResumeProfileCompatibility({ branch, sourceProfile: source, currentProfile: current }).status).toBe("profile_updated");
  current.experiences[0].facts[0].statement = "不同事实";
  expect(assessResumeProfileCompatibility({ branch, sourceProfile: source, currentProfile: current })).toMatchObject({
    status: "invalid_reference", invalidFactRefs: [`experience_fact:${ref.experienceId}:${ref.factId}`] });
  current.experiences[0].facts = [];
  expect(assessResumeProfileCompatibility({ branch, sourceProfile: source, currentProfile: current }).status).toBe("invalid_reference");
  current.personId = "other";
  expect(assessResumeProfileCompatibility({ branch, sourceProfile: source, currentProfile: current }).status).toBe("different_person");
});

it("uses verified same-person resume evidence for job fit and never admits other-person or changed facts", () => {
  const f = jd02Fixture();
  const source = { ...f.profile, personId: "person" };
  const current = structuredClone({ ...source, id: "new-profile" });
  const input = { profile: current, sourceProfile: source, branch: f.branches[0].branch, job: f.jobs[0] };
  const same = buildCareerIntelligence(input);
  expect(same.evidenceUnits.length).toBeGreaterThan(0);
  expect(same.evidenceUnits.flatMap(unit => unit.factRefs)).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "experience_fact", factId: "jd02-f1" })
  ]));
  const changed = structuredClone(current);
  changed.experiences[0].facts[0].statement = "已变化的事实";
  expect(buildCareerIntelligence({ ...input, profile: changed }).evidenceUnits).toEqual([]);
  const foreign = { ...current, personId: "foreign" };
  expect(buildCareerIntelligence({ ...input, profile: foreign }).evidenceUnits).toEqual([]);
});

it("permits a read-only historical preview of a verified invalid-reference branch without relaxing the regular renderer", () => {
  const f = jd02Fixture();
  const branch = { ...f.branches[0].branch, syncStatusCache: { ...f.branches[0].branch.syncStatusCache,
    status: "invalid_reference" as const, invalidFactRefs: ["experience_fact:missing:missing"] } };
  expect(() => mapBranchToResumeRenderModel({ profile: f.profile, branch })).toThrow("branch_invalid_reference");
  expect(mapBranchToResumeRenderModel({ profile: f.profile, branch, historicalView: true, coveragePolicy: "warn" }).branchId).toBe(branch.id);
});

it("rechecks compatibility in the atomic derivation and keeps the source branch and revision unchanged", async () => {
  db = new CareerAdaptDb(`cross-version-derive-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const f = jd02Fixture();
  const sourceProfile = await repository.saveProfile(f.profile);
  await repository.setActiveProfileId(sourceProfile.id);
  await repository.saveJobDescription(f.jobs[0]);
  const original = f.branches[0];
  await repository.saveResumeBranch(original.branch);
  await db.resumeRevisions.put(original.revision);
  const sourceBefore = await repository.getResumeBranch(original.branch.id);
  const revisionBefore = await repository.getResumeRevision(original.revision.id);
  const explicitVersion = await repository.createProfileVersion({ profileId: sourceProfile.id });
  const updated = { newProfileId: explicitVersion.id, newRevision: explicitVersion.version };
  const service = new BrowserAgentToolService(repository);
  const selection = { profileId: updated.newProfileId, resumeId: original.branch.id, jobId: f.jobs[0].id };
  const fit = await service.analyzeJobFit(selection, "cross-version-fit");
  expect(fit.analysis.evidenceMapping!.evidenceUnits.length).toBeGreaterThan(0);
  const planned = await service.createTailoringSession(selection, "cross-version-plan");
  expect(planned.session.profile.id).toBe(updated.newProfileId);
  expect(planned.session.branch.profileId).toBe(sourceProfile.id);
  const item = original.branch.structuredContentItems![0];
  if (item.data.sectionType !== "project") throw new Error("expected_project");
  const diff: ResumeTailoringDiff = { target: { sectionId: "project", itemId: item.id, fieldPath: "highlights" },
    operation: "replace", original: item.data.highlights, value: [...item.data.highlights, "已确认的补充"],
    reason: "用户确认的补充", requirementIds: [f.jobs[0].requirements[0].id], targetKeywords: ["Python"],
    evidenceRefs: [], supportLevel: "user_declared" };
  const input = { sourceBranchId: original.branch.id, targetProfileId: updated.newProfileId, jobId: f.jobs[0].id,
    expectedSourceRevision: original.branch.revision, expectedSourceRevisionId: original.branch.currentRevisionId!,
    expectedProfileRevision: updated.newRevision, expectedJobRevision: f.jobs[0].updatedAt, diffs: [diff], name: "岗位简历" };
  const derived = await repository.deriveAndApplyTailoringDiffsAtomic({ ...input, operationId: "cross-version-derive" });
  expect(derived.branch).toMatchObject({ profileId: updated.newProfileId, sourceBranchId: original.branch.id,
    sourceRevisionId: original.branch.currentRevisionId, sourceProfileVersion: updated.newRevision });
  expect(await repository.getResumeBranch(original.branch.id)).toEqual(sourceBefore);
  expect(await repository.getResumeRevision(original.revision.id)).toEqual(revisionBefore);
  const reviewed = { ...planned.session, plan: { ...planned.session.plan, diffs: [diff], diffReviews: [{
    diffId: tailoringDiffId(diff), status: "accepted" as const, updatedAt: new Date().toISOString()
  }] } };
  const committed = await service.applyTailoringChanges({ session: reviewed, selectedDiffs: [diff] }, "cross-version-confirmed-apply");
  expect(committed.branch).toMatchObject({ profileId: updated.newProfileId, sourceBranchId: original.branch.id });
  expect(await repository.getResumeBranch(original.branch.id)).toEqual(sourceBefore);
  const created = await repository.deriveJobSpecificBranchFromBranch({ sourceBranchId: original.branch.id,
    targetProfileId: updated.newProfileId, expectedProfileRevision: updated.newRevision, jobId: f.jobs[0].id,
    expectedSourceRevision: original.branch.revision, expectedSourceRevisionId: original.branch.currentRevisionId!,
    operationId: "cross-version-create", name: "直接生成岗位简历" });
  expect(created.branch).toMatchObject({ profileId: updated.newProfileId, sourceBranchId: original.branch.id,
    sourceRevisionId: original.branch.currentRevisionId });
  expect(await repository.getResumeBranch(original.branch.id)).toEqual(sourceBefore);
  const target = (await repository.getProfile(updated.newProfileId))!;
  const changed = structuredClone(target);
  changed.experiences[0].facts[0].statement = "已发生不兼容变化";
  changed.version++;
  await repository.saveProfile(changed);
  await expect(service.analyzeJobFit(selection, "cross-version-fit-invalid")).rejects.toThrow();
  await expect(service.createTailoringSession(selection, "cross-version-plan-invalid")).rejects.toThrow();
  const count = (await repository.listResumeBranches()).length;
  await expect(repository.deriveAndApplyTailoringDiffsAtomic({ ...input, expectedProfileRevision: changed.version,
    operationId: "cross-version-invalid" })).rejects.toThrow("branch_invalid_reference");
  await expect(repository.deriveJobSpecificBranchFromBranch({ sourceBranchId: original.branch.id,
    targetProfileId: updated.newProfileId, expectedProfileRevision: changed.version, jobId: f.jobs[0].id,
    expectedSourceRevision: original.branch.revision, expectedSourceRevisionId: original.branch.currentRevisionId!,
    operationId: "cross-version-create-invalid", name: "不得生成" })).rejects.toThrow("branch_invalid_reference");
  expect((await repository.listResumeBranches()).length).toBe(count);
});
