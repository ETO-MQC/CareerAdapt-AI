// Manual audit of observed current behavior. Passing observations reproduce defects; they do NOT certify deletion isolation.
import { afterEach, expect, it, vi } from "vitest";
import { writeFile } from "node:fs/promises";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { buildQuickActionContextSnapshot } from "@/agent/workflows/QuickActionContextSnapshot";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
const observations: Record<string, unknown> = {};
let db: CareerAdaptDb;
afterEach(async () => {
  vi.restoreAllMocks();
  await writeFile("docs/quality/recycle-isolation-audit-2026-11-09/observations.json", JSON.stringify(observations, null, 2));
  db?.close(); if (db) await db.delete();
});
async function fixture() {
  db = new CareerAdaptDb(`RecycleAudit-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = await repository.saveProfile(migrateCareerProfileToV2(demoCareerProfile));
  await repository.setActiveProfileId(profile.id);
  const service = new BrowserAgentToolService(repository);
  const gateway = () => {
    const registry = createAgentToolRegistry(service);
    return new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
  };
  const context = { operationId: "audit-first-save", confirmed: true, userMessageId: "audit-user", careerSessionBinding: {
    agentSessionId: "audit-session", personId: profile.personId!, profileId: profile.id,
    profileVersionNumber: profile.profileVersionNumber ?? 1, profileRevision: profile.version
  } };
  const input = { rawText: "公司：华为\n岗位：算法应用开发\n岗位职责\n1、负责模型应用开发。\n任职要求\n1、熟悉 Python 或 Java。", persistence: "save" };
  const result = await gateway().execute("career.workflow.job_intake", input, context);
  expect(result.ok).toBe(true);
  const job = (await repository.listJobDescriptions())[0];
  return { repository, profile, service, gateway, context, input, job };
}
it("OBSERVATION: Job page hides a recycled Job while Agent list/get and quick context still include it", async () => {
  const f = await fixture(); await f.repository.moveJobToRecycleBin(f.job.id);
  const bin = await f.repository.getRecycleBinState();
  const uiVisible = (await f.repository.listJobDescriptions()).filter(job => !bin.jobIds.includes(job.id));
  const listed = await f.service.listJobs(); const read = await f.service.getJob({ jobId: f.job.id });
  const quick = await buildQuickActionContextSnapshot(f.repository);
  observations.jobRead = { uiVisibleCount: uiVisible.length, agentListsDeleted: listed.jobs.some(job => job.id === f.job.id),
    directReadDeleted: read.job.id === f.job.id, quickActionIncludesDeleted: quick.jobSummaries.some(job => job.id === f.job.id) };
  expect(observations.jobRead).toEqual({ uiVisibleCount: 0, agentListsDeleted: true, directReadDeleted: true, quickActionIncludesDeleted: true });
});
it("OBSERVATION: deletion before a new Agent call still produces a verified-success receipt for the hidden old Job", async () => {
  const f = await fixture(); await f.repository.moveJobToRecycleBin(f.job.id);
  const result = await f.gateway().execute("career.workflow.job_intake", f.input, { ...f.context, operationId: "audit-save-after-trash" });
  const cp = (result.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  const bin = await f.repository.getRecycleBinState();
  observations.deletedBeforeCall = { ok: result.ok, jobId: cp.jobId, originalJobId: f.job.id,
    persistenceVerified: cp.persistenceVerified, businessStatus: cp.businessStatus, stillInRecycleBin: bin.jobIds.includes(f.job.id),
    formalJobCount: await db.jobDescriptions.count() };
  expect(observations.deletedBeforeCall).toMatchObject({ ok: true, jobId: f.job.id, persistenceVerified: true, businessStatus: "committed", stillInRecycleBin: true, formalJobCount: 1 });
});
it("OBSERVATION: deletion after parse but before commit also leaves the old hidden Job reported as saved", async () => {
  const f = await fixture(); const parse = f.service.parseJobDescription.bind(f.service);
  vi.spyOn(f.service, "parseJobDescription").mockImplementation(async (...args) => {
    const result = await parse(...args); await f.repository.moveJobToRecycleBin(f.job.id); return result;
  });
  const result = await f.gateway().execute("career.workflow.job_intake", f.input, { ...f.context, operationId: "audit-delete-during-parse" });
  const cp = (result.data as { workflowCheckpoint: Record<string, unknown> }).workflowCheckpoint;
  observations.deletedDuringParse = { originalJobReturned: cp.jobId === f.job.id, verified: cp.persistenceVerified,
    stillInRecycleBin: (await f.repository.getRecycleBinState()).jobIds.includes(f.job.id) };
  expect(observations.deletedDuringParse).toEqual({ originalJobReturned: true, verified: true, stillInRecycleBin: true });
});
it("OBSERVATION: company completion can modify a Job already in the recycle bin", async () => {
  const f = await fixture(); await f.repository.moveJobToRecycleBin(f.job.id);
  const result = await f.repository.completeJobCompany({ jobId: f.job.id, company: "审计补全公司", expectedRevision: f.job.updatedAt,
    operationId: "audit-update-trashed", userMessageId: "audit-user-2" });
  observations.updateDeletedJob = { changed: result.jobDescription.company !== f.job.company,
    stillInRecycleBin: (await f.repository.getRecycleBinState()).jobIds.includes(f.job.id) };
  expect(observations.updateDeletedJob).toEqual({ changed: true, stillInRecycleBin: true });
});
it("OBSERVATION: trashed Resume is excluded from listing but direct detail and revision reads still succeed", async () => {
  const f = await fixture(); const created = await f.repository.createGeneralResumeBranch({ profileId: f.profile.id,
    operationId: "audit-general-resume", name: "审计简历", includeProfileFacts: true, includeProfileBasics: true });
  const branch = created.branch;
  const archived = await f.repository.archiveResumeBranch({ branchId: branch.id, expectedRevision: branch.revision, operationId: "audit-archive-resume", confirmedImpact: true });
  const trashed = await f.repository.moveResumeBranchToTrash({ branchId: branch.id, expectedRevision: archived.branch.revision, operationId: "audit-trash-resume" });
  const listed = await f.service.listResumes(); const detail = await f.service.getResume({ resumeId: branch.id });
  const revision = await f.service.getResumeRevision({ resumeId: branch.id });
  observations.resume = { lifecycle: trashed.branch.lifecycleStatus, listed: listed.resumes.some(resume => resume.id === branch.id),
    detailReadable: detail.resume.id === branch.id, revisionReadable: !!revision.revision };
  expect(observations.resume).toEqual({ lifecycle: "trashed", listed: false, detailReadable: true, revisionReadable: true });
});
it("OBSERVATION: trashed Profile version is excluded from listing but direct read/search still succeed", async () => {
  const f = await fixture(); const clone = await f.repository.createProfileVersion({ profileId: f.profile.id });
  const original = (await f.repository.getProfile(f.profile.id))!;
  await f.repository.trashProfileVersion({ profileId: original.id, expectedRevision: original.version, operationId: "audit-trash-profile" });
  const listed = await f.service.listProfiles(); const read = await f.service.getProfile({ profileId: original.id });
  const item = canonicalProfileLibraryItems(original)[0];
  const search = await f.service.searchProfileFacts({ profileId: original.id, query: item.title });
  observations.profile = { newCurrentProfile: clone.id !== original.id, listed: listed.profiles.some(p => p.id === original.id),
    detailReadable: read.profile.id === original.id, searchResultCount: search.results.length };
  expect(observations.profile).toMatchObject({ newCurrentProfile: true, listed: false, detailReadable: true });
  expect(search.results.length).toBeGreaterThan(0);
});
it("OBSERVATION: deleting a Person container does not remove its Profiles from Agent list", async () => {
  const f = await fixture(); await f.repository.trashPerson(f.profile.personId!);
  const listed = await f.service.listProfiles();
  observations.person = { personTrashed: !!(await f.repository.getCareerPerson(f.profile.personId!))?.trashedAt,
    childProfileStillListed: listed.profiles.some(p => p.id === f.profile.id) };
  expect(observations.person).toEqual({ personTrashed: true, childProfileStillListed: true });
});
it("CONTROL: explicit Job restoration restores visibility without creating another Job", async () => {
  const f = await fixture(); await f.repository.moveJobToRecycleBin(f.job.id); await f.repository.restoreJobFromRecycleBin(f.job.id);
  observations.restoreControl = { inRecycleBin: (await f.repository.getRecycleBinState()).jobIds.includes(f.job.id), count: await db.jobDescriptions.count() };
  expect(observations.restoreControl).toEqual({ inRecycleBin: false, count: 1 });
});

it("CONTROL: deleting a canonical Profile item removes it from current Agent detail/search while retaining a recycle copy", async () => {
  const f = await fixture(); const current = (await f.repository.getProfile(f.profile.id))!;
  const entry = current.structuredFacts![0]; const item = canonicalProfileLibraryItems(current).find(item => item.id === entry.data.id)!;
  const now = new Date().toISOString();
  await f.repository.saveProfile({ ...current, structuredFacts: current.structuredFacts!.filter(row => row.data.id !== entry.data.id),
    version: current.version + 1, updatedAt: now });
  await f.repository.addProfileRecycleItem({ id: entry.data.id, profileId: current.id, kind: "canonical", category: entry.data.sectionType,
    title: item.title, deletedAt: now, value: entry });
  const detail = await f.service.getProfile({ profileId: current.id });
  const search = await f.service.searchProfileFacts({ profileId: current.id, query: item.title });
  const reloaded = (await f.repository.getProfile(current.id))!;
  observations.canonicalItemControl = { currentDetailContainsRemoved: detail.profile.items.some(item => item.id === entry.data.id),
    currentSearchContainsRemoved: search.results.some(item => item.id === entry.data.id),
    returnsAfterReload: canonicalProfileLibraryItems(reloaded).some(item => item.id === entry.data.id),
    recycleCopyRetained: (await f.repository.getRecycleBinState()).profileItems.some(item => item.id === entry.data.id) };
  expect(observations.canonicalItemControl).toEqual({ currentDetailContainsRemoved: false, currentSearchContainsRemoved: false,
    returnsAfterReload: false, recycleCopyRetained: true });
});
