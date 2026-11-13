import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { afterEach, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { buildQuickActionContextSnapshot } from "@/agent/workflows/QuickActionContextSnapshot";
let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });
async function fixture() {
  db = new CareerAdaptDb(`RecycleAudit-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = await repository.saveProfile(migrateCareerProfileToV2(demoCareerProfile));
  await repository.setActiveProfileId(profile.id);
  const service = new BrowserAgentToolService(repository);
  const gateway = () => {
    const registry = createAgentToolRegistry(service);
    return new CareerToolGateway({ registry, executor: new AgentExecutor(registry),
      assertAvailableTargets: (name, input, binding) => service.assertAvailableToolTargets(name, input, binding),
      filterAvailableResult: (name, data) => service.filterAvailableToolResult(name, data) });
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

it("hides a recycled Job from Agent list/detail/context and all normal summary reads, while management can restore", async () => {
  const f = await fixture(); await f.repository.moveJobToRecycleBin(f.job.id);
  expect((await f.service.listJobs()).jobs).toHaveLength(0);
  await expect(f.service.getJob({ jobId: f.job.id })).rejects.toThrow();
  await expect(f.service.retrieveCareerContext({ profileId: f.profile.id, jobId: f.job.id, query: "岗位匹配" })).rejects.toThrow();
  expect(await f.repository.getAvailableJobDescription(f.job.id)).toBeUndefined();
  expect((await buildQuickActionContextSnapshot(f.repository)).jobSummaries).toHaveLength(0);
  expect(await f.repository.getJobDescription(f.job.id)).toBeDefined();
  await f.repository.restoreJobFromRecycleBin(f.job.id);
  expect((await f.service.listJobs()).jobs[0].id).toBe(f.job.id);
  await expect(f.service.retrieveCareerContext({ profileId: f.profile.id, jobId: f.job.id, query: "岗位匹配" })).resolves.toBeDefined();
});
it("resolves current/active only through the trusted Profile binding and keeps explicit IDs isolated", async () => {
  const f = await fixture();
  const gateway = f.gateway();
  for (const profileId of ["current", "active", undefined]) {
    const result = await gateway.execute("career.profile.get", { profileId }, { ...f.context, operationId: `profile-${profileId}` });
    expect(result.ok, JSON.stringify(result.error)).toBe(true);
    expect(result.data).toMatchObject({ profile: { id: f.profile.id } });
    const context = await gateway.execute("career.context.retrieve", { profileId, query: "有什么资料" }, { ...f.context, operationId: `context-${profileId}` });
    expect(context.ok, JSON.stringify(context.error)).toBe(true);
  }
  const wrong = await gateway.execute("career.profile.get", { profileId: "wrong-profile" }, { ...f.context, operationId: "wrong-profile" });
  expect(wrong.ok).toBe(false); expect(wrong.data).toBeUndefined();
  const version = await f.repository.createProfileVersion({ profileId: f.profile.id });
  const other = await gateway.execute("career.profile.get", { profileId: version.id }, { ...f.context, operationId: "other-existing-profile" });
  expect(other.ok).toBe(false); expect(other.data).toBeUndefined();
  for (const name of ["career.profile.get", "career.context.retrieve"]) {
    const unbound = await gateway.execute(name, { profileId: "active", query: "资料" }, { operationId: `unbound-${name}` });
    expect(unbound.ok).toBe(false);
    expect(unbound.error?.code).toBe("career_session_binding_required");
  }
  expect((await gateway.execute("career.profile.get", { profileId: f.profile.id }, { ...f.context, operationId: "explicit-profile" })).ok).toBe(true);
});
it("newly submitted identical JD creates one new available Job without restoring or overwriting the recycled record", async () => {
  const f = await fixture(); const listing = (await db.jobListings.toArray())[0];
  await f.repository.moveJobToRecycleBin(f.job.id);
  const result = await f.gateway().execute("career.workflow.job_intake", f.input, { ...f.context, operationId: "new-save-after-delete" });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  const available = await f.repository.listAvailableJobDescriptions();
  expect(available).toHaveLength(1); expect(available[0].id).not.toBe(f.job.id);
  expect(available[0].rawText).toBe(f.job.rawText);
  expect((await f.repository.getRecycleBinState()).jobIds).toContain(f.job.id);
  expect(await f.repository.getJobDescription(f.job.id)).toEqual(f.job);
  expect(await db.jobListings.get(listing.id)).toEqual(listing);
  const repeated = await f.gateway().execute("career.workflow.job_intake", f.input, { ...f.context, operationId: "new-save-repeat" });
  expect(repeated.ok).toBe(true);
  expect((await f.repository.listAvailableJobDescriptions())[0].id).toBe(available[0].id);
  expect(await db.jobDescriptions.count()).toBe(2);
});
it("deletion after parse and before commit cannot cause false reuse of the deleted Job", async () => {
  const f = await fixture(); const parse = f.service.parseJobDescription.bind(f.service);
  vi.spyOn(f.service, "parseJobDescription").mockImplementation(async (...args) => {
    const parsed = await parse(...args); await f.repository.moveJobToRecycleBin(f.job.id); return parsed;
  });
  const result = await f.gateway().execute("career.workflow.job_intake", f.input, { ...f.context, operationId: "delete-while-parse" });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  expect(result.data).toMatchObject({ workflowCheckpoint: { persistenceVerified: true } });
  expect((await f.repository.listAvailableJobDescriptions())[0].id).not.toBe(f.job.id);
});
it("blocks deleted Job updates and committed company receipt replay without changing raw data", async () => {
  const f = await fixture(); const update = { jobId: f.job.id, company: "补全公司", expectedRevision: f.job.updatedAt, operationId: "company-before-delete", userMessageId: "audit-user-2" };
  await f.repository.completeJobCompany(update);
  await f.repository.moveJobToRecycleBin(f.job.id);
  const snapshot = await f.repository.getJobDescription(f.job.id);
  await expect(f.repository.completeJobCompany(update)).rejects.toThrow();
  await expect(f.repository.completeJobCompany({ ...update, operationId: "company-after-delete", expectedRevision: snapshot!.updatedAt })).rejects.toThrow();
  expect(await f.repository.getJobDescription(f.job.id)).toEqual(snapshot);
});
it("invalidates cached Agent detail and filters cached list receipts after deletion", async () => {
  const f = await fixture(); const gateway = f.gateway();
  expect((await gateway.execute("career.job.get", { jobId: f.job.id }, { operationId: "cached-detail" })).ok).toBe(true);
  expect((await gateway.execute("career.job.list", {}, { operationId: "cached-job-list" })).ok).toBe(true);
  await f.repository.moveJobToRecycleBin(f.job.id);
  const read = await gateway.execute("career.job.get", { jobId: f.job.id }, { operationId: "cached-detail" });
  expect(read.ok).toBe(false); expect(read.data).toBeUndefined();
  const list = await gateway.execute("career.job.list", {}, { operationId: "cached-job-list" });
  expect(list.ok).toBe(true); expect(list.data).toMatchObject({ jobs: [] });
});
it("hides a deleted Profile version and refuses detail/search/resumes belonging to it", async () => {
  const f = await fixture(); await f.repository.createProfileVersion({ profileId: f.profile.id });
  const old = (await f.repository.getProfile(f.profile.id))!;
  await f.repository.trashProfileVersion({ profileId: old.id, expectedRevision: old.version, operationId: "trash-version" });
  expect((await f.service.listProfiles()).profiles.some(profile => profile.id === old.id)).toBe(false);
  await expect(f.service.getProfile({ profileId: old.id })).rejects.toThrow();
  await expect(f.service.searchProfileFacts({ profileId: old.id, query: "项目" })).rejects.toThrow();
});
it("hides an entire deleted Person and all child versions/resumes from Agent current reads", async () => {
  const f = await fixture(); const created = await f.repository.createGeneralResumeBranch({ profileId: f.profile.id,
    operationId: "person-child-resume", name: "人物简历", includeProfileFacts: true, includeProfileBasics: true });
  await f.repository.trashPerson(f.profile.personId!);
  expect((await f.service.listProfiles()).profiles).toHaveLength(0);
  expect((await f.service.listResumes()).resumes).toHaveLength(0);
  expect((await f.service.getActiveProfile()).selected).toBe(false);
  await expect(f.service.getProfile({ profileId: f.profile.id })).rejects.toThrow();
  await expect(f.service.getResume({ resumeId: created.branch.id })).rejects.toThrow();
});
it("does not return detail or historical revisions of a trashed resume through normal Agent tools", async () => {
  const f = await fixture(); const created = await f.repository.createGeneralResumeBranch({ profileId: f.profile.id,
    operationId: "resume-delete-test", name: "待删除简历", includeProfileFacts: true, includeProfileBasics: true });
  const archived = await f.repository.archiveResumeBranch({ branchId: created.branch.id, expectedRevision: created.branch.revision, operationId: "archive-test", confirmedImpact: true });
  await f.repository.moveResumeBranchToTrash({ branchId: created.branch.id, expectedRevision: archived.branch.revision, operationId: "trash-test" });
  expect((await f.service.listResumes()).resumes).toHaveLength(0);
  await expect(f.service.getResume({ resumeId: created.branch.id })).rejects.toThrow();
  await expect(f.service.getResumeRevision({ resumeId: created.branch.id })).rejects.toThrow();
  expect(await f.repository.getResumeBranch(created.branch.id)).toBeDefined();
});
it("concurrent recycle operations retain both tombstones", async () => {
  const f = await fixture(); const second = { ...f.job, id: "second-job" }; await f.repository.saveJobDescription(second);
  await Promise.all([f.repository.moveJobToRecycleBin(f.job.id), f.repository.moveJobToRecycleBin(second.id)]);
  expect((await f.repository.getRecycleBinState()).jobIds.sort()).toEqual([f.job.id, second.id].sort());
  expect(await f.repository.listAvailableJobDescriptions()).toHaveLength(0);
});

it("revokes a deleted target from subsequent runtime checkpoints without deleting the user's transcript", async () => {
  const f = await fixture();
  const session = { ...AgentRuntime.createConversationSession(), activeProfileId: f.profile.id, profileRevision: f.profile.version,
    taskState: AgentTaskStateSchema.parse({ rootGoal: "ingest_job", workflowId: "job_ingestion", stage: "completed",
      selectedEntities: { jobId: f.job.id }, knownSlots: { rawText: f.job.rawText }, updatedAt: new Date().toISOString() }) };
  const before = await f.service.prepareAvailableRuntimeContext(session);
  expect(before.resetContext).toBe(false);
  await f.repository.moveJobToRecycleBin(f.job.id);
  const after = await f.service.prepareAvailableRuntimeContext(session);
  expect(after.resetContext).toBe(true);
  expect(after.suppressConversationHistory).toBe(true);
  expect(after.hermesSessionId).not.toBe(before.hermesSessionId);
  expect(after.session.taskState).toBeUndefined();
  expect(after.session.artifactRefs).toEqual([]);
  expect(after.session.messages).toEqual(session.messages);
});
it("projects validated TaskState selections at the runtime boundary instead of stale active aliases", async () => {
  const f = await fixture();
  const session = { ...AgentRuntime.createConversationSession(), personId: f.profile.personId,
    activeProfileId: "stale-profile", activeJobId: "stale-job", activeResumeId: "stale-resume",
    taskState: AgentTaskStateSchema.parse({ rootGoal: "analyze_job_fit", workflowId: "analyze_job_fit", stage: "analyze_fit",
      selectedEntities: { profileId: f.profile.id, profileVersion: f.profile.version, jobId: f.job.id },
      knownSlots: {}, updatedAt: new Date().toISOString() }) };
  const access = await f.service.prepareAvailableRuntimeContext(session);
  expect(access.resetContext).toBe(false);
  expect(access.session).toMatchObject({ activeProfileId: f.profile.id, activeJobId: f.job.id, activeResumeId: undefined });
  expect(access.session.taskState?.selectedEntities).toMatchObject({ profileId: f.profile.id, jobId: f.job.id });
});
it("searches sessions by canonical TaskState instead of stale profile and job aliases", async () => {
  const f = await fixture();
  await f.repository.setActiveCareerContext({ personId: f.profile.personId!, profileId: f.profile.id });
  const session = { ...AgentRuntime.createConversationSession("unique-canonical-session"), personId: f.profile.personId,
    activeProfileId: "stale-profile", activeJobId: "stale-job", profileRevision: 99,
    taskState: AgentTaskStateSchema.parse({ rootGoal: "analyze_job_fit", workflowId: "analyze_job_fit", stage: "analyze_fit",
      selectedEntities: { profileId: f.profile.id, profileVersion: f.profile.version, jobId: f.job.id },
      knownSlots: {}, updatedAt: new Date().toISOString() }) };
  await f.repository.saveAgentSession(session);
  const results = await f.service.searchAgentSessions({ query: "unique-canonical-session" });
  expect(results.sessions.map(row => row.id)).toContain(session.id);
});
it("scope rotation isolates profile versions and deleted fields even when the Job is not selected", async () => {
  const f = await fixture();
  const session = { ...AgentRuntime.createConversationSession(), activeProfileId: f.profile.id, profileRevision: f.profile.version };
  const before = await f.service.prepareAvailableRuntimeContext(session);
  const current = (await f.repository.getProfile(f.profile.id))!;
  await f.repository.saveProfile({ ...current, version: current.version + 1, structuredFacts: current.structuredFacts!.slice(1) });
  const after = await f.service.prepareAvailableRuntimeContext(session);
  expect(after.resetContext).toBe(true);
  expect(after.hermesSessionId).not.toBe(before.hermesSessionId);
  expect(after.session.profileRevision).toBe(current.version + 1);
});
it("read results cannot be returned after their owning Person is deleted during tool execution", async () => {
  const f = await fixture(); const read = f.service.getProfile.bind(f.service);
  vi.spyOn(f.service, "getProfile").mockImplementation(async (...args) => {
    const data = await read(...args); await f.repository.trashPerson(f.profile.personId!); return data;
  });
  const result = await f.gateway().execute("career.profile.get", { profileId: f.profile.id }, { operationId: "delete-during-profile-read" });
  expect(result.ok).toBe(false); expect(result.data).toBeUndefined();
});

it("Repository writers reject stale source snapshots after a Person is deleted", async () => {
  const f = await fixture(); await f.repository.trashPerson(f.profile.personId!);
  const before = await f.repository.getProfile(f.profile.id);
  await expect(f.repository.saveProfile({ ...f.profile, version: f.profile.version + 1 })).rejects.toThrow("profile_not_available");
  await expect(f.repository.createGeneralResumeBranch({ profileId: f.profile.id, operationId: "stale-create", name: "不得创建",
    includeProfileFacts: true, includeProfileBasics: true })).rejects.toThrow("profile_not_available");
  expect(await f.repository.getProfile(f.profile.id)).toEqual(before);
  expect(await db.resumeBranches.count()).toBe(0);
});

it("task diagnostics and session search cannot disclose a deleted target or a different profile's summary", async () => {
  const f = await fixture();
  const session = { ...AgentRuntime.createConversationSession(), activeProfileId: f.profile.id, profileRevision: f.profile.version,
    conversationSummary: "DELETED-TARGET-SECRET", activeJobId: f.job.id,
    taskState: AgentTaskStateSchema.parse({ rootGoal: "ingest_job", workflowId: "job_ingestion", stage: "completed",
      selectedEntities: { jobId: f.job.id }, knownSlots: { rawText: f.job.rawText }, updatedAt: new Date().toISOString() }) };
  await f.repository.saveAgentSession(session);
  await f.service.prepareAvailableRuntimeContext(session);
  await f.repository.moveJobToRecycleBin(f.job.id);
  const context = await f.service.getAgentTaskContext({ sessionId: session.id });
  expect(context.activeJobId).toBeUndefined(); expect(context.conversationSummary).toBe("");
  expect((await f.service.searchAgentSessions({ query: "DELETED-TARGET-SECRET" })).sessions).toHaveLength(0);
});

it("explicit archive receipts remain usable while archived content stays isolated", async () => {
  const f = await fixture();
  const created = await f.repository.createGeneralResumeBranch({ profileId: f.profile.id,
    operationId: "archive-isolation-create", name: "归档测试", includeProfileFacts: true, includeProfileBasics: true });
  const result = await f.gateway().execute("career.resume.archive", { resumeId: created.branch.id, expectedRevision: created.branch.revision },
    { ...f.context, operationId: "archive-isolation-action" });
  expect(result.ok, JSON.stringify(result.error)).toBe(true);
  expect(result.data).toMatchObject({ lifecycleStatus: "archived" });
  await expect(f.service.getResume({ resumeId: created.branch.id })).rejects.toThrow();
  await f.repository.trashPerson(f.profile.personId!);
  const replay = await f.gateway().execute("career.resume.archive", { resumeId: created.branch.id, expectedRevision: created.branch.revision },
    { ...f.context, operationId: "archive-isolation-action" });
  expect(replay.ok).toBe(false);
});
