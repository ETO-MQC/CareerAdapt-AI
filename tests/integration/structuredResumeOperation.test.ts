import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerProfileSchema, ResumeBranchSchema } from "@/domain/schemas";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { createResumeRevision } from "@/domain/branch/revision";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { appendAgentMessage } from "@/agent/runtime/AgentSessionMessages";
import { projectPreciseProposal } from "@/agent/runtime/preciseResumeEditCheckpoint";
import { canonicalJson, preciseSha256 } from "@/domain/resumeEditing/preciseResumeEdit";
import { verifyPreciseProposal, preciseOperationKey } from "@/domain/resumeEditing/preciseResumeContract";
import { createStructuredProposal, StructuredSelectionSchema, StructuredModelOutputSchema, correctionDate, skillIdentity, type StructuredProposal, type StructuredSelection } from "@/domain/resumeEditing/structuredResumeOperation";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { mkdirSync, writeFileSync } from "node:fs";
import { isRenderableContentItem } from "@/domain/resumeDocument/mapper";
import Dexie from "dexie";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });
type Kind = StructuredSelection["operation"];
async function setup(kind: Kind = "fact_correction", job = false, field: StructuredSelection["field"] = "title", section: "project" | "work" | "internship" = "project", value = "用户纠正的项目名称") {
  const now = new Date().toISOString();
  db = new CareerAdaptDb(`structured-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db), persistence = new AgentSessionStore(repo);
  const fact = (id: string, statement: string, category = "experience") => ({ id, statement, category, confirmedByUser: true, riskLevel: "low", maturity: "demonstrated",
    provenance: [{ sourceType: "user_input", sourceId: `source-${id}`, sourceText: statement, confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }], createdAt: now, updatedAt: now });
  await repo.saveProfile(CareerProfileSchema.parse({ id: "profile-a2", name: "匿名A2", preference: { targetRoles: [], targetCities: [], industries: [] }, basics: { name: "匿名A2", links: [] },
    experiences: ["project", "work", "internship"].map(type => ({ id: type, type, organization: `原始${type}`, role: "开发", startDate: "2024-01", endDate: "2024-06",
      facts: [fact(`fact-${type}`, "执行接口测试。")], resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now })),
    skills: ["SQL", "Python"].map(name => ({ id: name, name, level: "familiar", evidenceIds: [], fact: fact(`fact-${name}`, `掌握${name}`, "skill"), createdAt: now, updatedAt: now })),
    certificates: [], evidences: [], unclassifiedBlocks: [], version: 1, createdAt: now, updatedAt: now }));
  const profile = (await repo.getProfile("profile-a2"))!;
  const ids = ["project", "work", "internship"];
  const general = buildGeneralBranchFromProfile({ profile, operationId: "general-a2", name: "通用A2", includeProfileFacts: true, includeProfileBasics: true, selectedCanonicalItemIds: ids, now });
  const buildJob = (id: string) => buildJobBranchFromProfile({ profile, operationId: `create-${id}`, name: id, jobId: id, jobTitle: "开发", jobVersion: now, selectedCanonicalItemIds: ids, requirementMatchIds: [], sourceMatchSetHash: "match-a2", now });
  const jobs = [buildJob("job-a2"), buildJob("job-a2-second")];
  for (const jobId of ["job-a2", "job-a2-second"]) await repo.saveJobDescription({ id: jobId, title: "开发", company: "匿名公司", rawText: "开发测试", source: "manual", requirements: [], createdAt: now, updatedAt: now });
  const chosen = job ? jobs[0] : general;
  let branch = ResumeBranchSchema.parse({ ...chosen.branch, structuredContentItems: chosen.branch.structuredContentItems!.map(i => ({ ...i,
    data: { ...i.data, ...(i.data.sectionType === "project" ? { organization: "原组织" } : {}), highlights: ["重复文字", "SQL 查询", "重复文字"] } })) });
  const revision = createResumeRevision({ branch, source: chosen.firstRevision.source, operationId: chosen.firstRevision.operationId, now });
  branch = { ...branch, currentRevisionId: revision.id };
  for (const item of [general, ...jobs]) {
    await repo.saveResumeBranch(item.branch.id === branch.id ? branch : item.branch);
    await db.resumeRevisions.put(item.branch.id === branch.id ? revision : item.firstRevision);
  }
  let session = AgentRuntime.createConversationSession();
  session = { ...session, activeProfileId: profile.id, personId: profile.personId, profileVersionNumber: profile.profileVersionNumber, profileRevision: profile.version,
    activeTurn: { id: "turn-a2", sessionId: session.id, status: "running", startedAt: now } };
  session = appendAgentMessage(session, "user", value, { turnId: "turn-a2" });
  session = await persistence.save(session);
  const source = kind === "fact_correction" ? await repo.capturePreciseCorrectionSource(session.id, "turn-a2", session.messages.at(-1)!.id) : undefined;
  const selection = StructuredSelectionSchema.parse({ sessionId: session.id, taskId: "task-a2", profileId: profile.id, branchId: branch.id, baseRevisionId: branch.currentRevisionId,
    sectionType: kind === "confirmed_skill_addition" ? "skills" : section,
    itemId: kind === "confirmed_skill_addition" ? "SQL" : branch.structuredContentItems!.find(i => i.data.sectionType === section)!.id,
    field: kind === "fact_correction" ? field : kind === "confirmed_skill_addition" ? "name" : "highlights", bulletIndex: kind === "bullet_removal" ? 2 : null, operation: kind });
  const output = kind === "fact_correction" ? { operation: kind, proposedValue: value } : kind === "bullet_reordering" ? { operation: kind, permutation: [1, 2, 0] } : { operation: kind };
  const proposal = await createStructuredProposal({ branch, profile, selection, modelOutput: output, turnId: "turn-a2", operationId: `operation-${kind}`, source });
  session.taskState = AgentTaskStateSchema.parse({ rootGoal: "precise_resume_edit", activeGoal: "precise_resume_edit", workflowId: "precise_resume_edit", stage: "propose_precise_edit", knownSlots: { preciseResumeEdit: { selection } }, updatedAt: now });
  if (kind === "fact_correction") await repo.preparePreciseFactConfirmation(proposal);
  session = projectPreciseProposal(session, proposal);
  session.pendingConfirmation!.status = "confirmed"; session.pendingConfirmation!.resolvedAt = now;
  session = await persistence.save(session);
  return { repo, profile, branch, proposal, session, persistence, output, source };
}
async function snapshot() {
  return { profiles: await db.profiles.toArray(), branches: await db.resumeBranches.toArray(), revisions: await db.resumeRevisions.toArray(), operations: await db.resumeBranchOperations.toArray(), appMeta: await db.appMeta.toArray() };
}
async function hostFixture(kind: Kind) {
  const f = await setup(kind);
  const service = new BrowserAgentToolService(f.repo), registry = createAgentToolRegistry(service);
  const gateway = new CareerToolGateway({ registry, getAuthoritativeTaskState: () => host.getSnapshot().activeSession?.taskState });
  const host: AgentHostStore = new AgentHostStore({ repository: f.repo, persistence: f.persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  await host.adoptDurably(f.session);
  return { ...f, host, gateway };
}
async function rehash(p: StructuredProposal, patch: Partial<StructuredProposal>) {
  const { proposalHash: _, ...content } = { ...p, ...patch }; void _;
  return { ...content, proposalHash: await preciseSha256(canonicalJson(content)) } as StructuredProposal;
}
describe("A2 typed operations through real Dexie Repository", () => {
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("%s preserves the full complement on general and two job branches", async kind => {
    const f = await setup(kind), before = await snapshot();
    const results = await Promise.all([f.repo.applyPreciseResumeEdit(f.proposal), f.repo.applyPreciseResumeEdit(f.proposal), f.repo.applyPreciseResumeEdit(f.proposal)]);
    expect(new Set(results.map(r => r.revisionId)).size).toBe(1);
    expect(results.filter(r => !r.idempotent)).toHaveLength(1);
    const after = await snapshot(), next = after.branches.find(b => b.id === f.branch.id)!;
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(b => b.id !== f.branch.id)).toEqual(before.branches.filter(b => b.id !== f.branch.id));
    expect(after.revisions.filter(r => r.id !== results[0].revisionId)).toEqual(before.revisions);
    expect(after.revisions).toHaveLength(before.revisions.length + 1);
    const original = f.branch.structuredContentItems!, changed = next.structuredContentItems!;
    if (kind === "confirmed_skill_addition") {
      expect(changed.slice(0, -1)).toEqual(original); expect(next.contentItems.slice(0, -1)).toEqual(f.branch.contentItems);
      expect(changed.at(-1)!.data).toEqual((f.proposal.operation as { data: unknown }).data);
    } else {
      const id = f.proposal.selection.itemId;
      expect(changed.filter(i => i.id !== id)).toEqual(original.filter(i => i.id !== id));
      expect(next.contentItems.filter(i => i.id !== id)).toEqual(f.branch.contentItems.filter(i => i.id !== id));
      const a = changed.find(i => i.id === id)!, b = original.find(i => i.id === id)!;
      const expected = { ...b.data, ...(kind === "fact_correction" ? { title: "用户纠正的项目名称" } : { highlights: kind === "bullet_removal" ? ["重复文字", "SQL 查询"] : ["SQL 查询", "重复文字", "重复文字"] }) };
      expect(a.data).toEqual(expected); expect(a.factRefs).toEqual(b.factRefs);
      expect(a).toEqual({ ...b, data: a.data, legacyTextProjection: a.legacyTextProjection, ...(kind === "fact_correction" ? { source: "user_manual", userConfirmation: a.userConfirmation } : {}) });
    }
    const expectedBranch = { ...f.branch, structuredContentItems: next.structuredContentItems, contentItems: next.contentItems,
      revision: f.branch.revision + 1, currentRevisionId: results[0].revisionId, updatedAt: next.updatedAt };
    expect(next).toEqual(expectedBranch);
    const key = await preciseOperationKey(f.proposal);
    expect(after.operations.filter(o => o.operationId.startsWith(key.prefix))).toHaveLength(1);
    const audit = await f.repo.getPreciseResumeRevisionAudit(results[0].revisionId);
    expect(audit?.proposal).toEqual(f.proposal);
    if (kind === "fact_correction") expect(audit?.factConfirmation).toMatchObject({ state: "consumed", revisionId: results[0].revisionId, confirmed: { scope: "resume_only", userConfirmed: true, verification: "user_declared_not_independently_verified" } });
    await f.persistence.delete(f.session.id);
    expect((await f.repo.getPreciseResumeRevisionAudit(results[0].revisionId))?.proposal).toEqual(f.proposal);
    expect((await f.repo.getPreciseResumeEditReceipt(f.proposal))?.revisionId).toBe(results[0].revisionId);
    const dir = process.env.UX013_A2_EVIDENCE_DIR;
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/${kind}.json`, JSON.stringify({ before, after, proposal: f.proposal, receipt: results[0], audit }, null, 2)); }
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("supports %s on a job Branch with complete isolation", async kind => {
    const f = await setup(kind, true), before = await snapshot();
    const result = await f.repo.applyPreciseResumeEdit(f.proposal), after = await snapshot();
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(b => b.id !== f.branch.id)).toEqual(before.branches.filter(b => b.id !== f.branch.id));
    expect(after.revisions.filter(r => r.id !== result.revisionId)).toEqual(before.revisions);
  });
  it.each(["revision", "confirmation", "audit"])("rolls back confirmation consumption and all formal writes if %s persistence fails", async point => {
    const f = await setup(), before = await snapshot();
    const target = point === "revision" ? db.resumeRevisions : db.appMeta;
    const method = point === "audit" ? "add" : "put";
    const spy = vi.spyOn(target, method).mockRejectedValueOnce(new Error(`injected-${point}`));
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow(`injected-${point}`); spy.mockRestore();
    const failed = await snapshot(); expect(failed).toEqual(before);
    const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    expect(await db.resumeRevisions.count()).toBe(before.revisions.length + 1);
    const dir = process.env.UX013_A2_EVIDENCE_DIR;
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/rollback-${point}.json`, JSON.stringify({ injectedFailure: point, before, failed, afterRetry: await snapshot(), receipt: result }, null, 2)); }
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("rejects stale %s and changed-hash replay", async kind => {
    const f = await setup(kind); await f.repo.applyPreciseResumeEdit(f.proposal);
    const forged = await rehash(f.proposal, { canonicalFieldId: "forged" });
    await expect(f.repo.applyPreciseResumeEdit(forged)).rejects.toThrow(/conflict|source_mismatch/);
    const initialCount = await db.resumeRevisions.count();
    const changed = await rehash(f.proposal, { operationId: `new-${f.proposal.operationId}` });
    await expect(f.repo.applyPreciseResumeEdit(changed)).rejects.toThrow(/owner|reference|source_mismatch/);
    expect(await db.resumeRevisions.count()).toBe(initialCount);
  });
  it("rejects unsupported field/source/AI identity injection", async () => {
    const f = await setup();
    expect(StructuredSelectionSchema.safeParse({ ...f.proposal.selection, field: "level" }).success).toBe(false);
    expect(StructuredSelectionSchema.safeParse({ ...f.proposal.selection, sectionType: "skills" }).success).toBe(false);
    expect(StructuredModelOutputSchema.safeParse({ operation: "fact_correction", proposedValue: "x", evidenceRefs: [] }).success).toBe(false);
    expect(StructuredModelOutputSchema.safeParse({ operation: "replace_array", value: [] }).success).toBe(false);
    await expect(createStructuredProposal({ branch: f.branch, profile: f.profile, selection: f.proposal.selection, turnId: "turn-a2", operationId: "bad-source-operation",
      modelOutput: { operation: "fact_correction", proposedValue: "模型推断" }, source: f.source })).rejects.toThrow(/source_mismatch/);
    await db.appMeta.update(f.source!.id, { value: { ...f.source, content: "被修改的来源" } });
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow(/source_mismatch/);
  });
  it.each(["work", "internship"] as const)("corrects verified catalog fields on %s", async section => {
    const f = await setup("fact_correction", false, "role", section, "后端工程师");
    const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    expect(result.revision.snapshot.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)?.data).toMatchObject({ role: "后端工程师" });
  });
  it.each(["startDate", "endDate", "organization"] as const)("supports exact %s correction without Profile sync", async field => {
    const f = await setup("fact_correction", false, field, field === "organization" ? "work" : "project", field === "organization" ? "新组织" : field === "startDate" ? "2024-02" : "2024-07");
    await f.repo.applyPreciseResumeEdit(f.proposal);
    expect(await f.repo.getProfile(f.profile.id)).toEqual(f.profile);
  });
  it.each([{ permutation: [0, 0, 2] }, { permutation: [0, 1] }, { permutation: [0, 1, 3] }, { permutation: [0, 1, 2] }, { permutation: [-1, 0, 1] }])("rejects invalid permutation %j", async ({ permutation }) => {
    const f = await setup("bullet_reordering");
    await expect(createStructuredProposal({ branch: f.branch, profile: f.profile, selection: f.proposal.selection, modelOutput: { operation: "bullet_reordering", permutation }, turnId: "turn-a2", operationId: "invalid-permutation" })).rejects.toThrow();
  });
  it("rejects exact canonical skill aliases and unconfirmed/learning facts", async () => {
    const f = await setup("confirmed_skill_addition"); await f.repo.applyPreciseResumeEdit(f.proposal);
    const branch = (await f.repo.getResumeBranch(f.branch.id))!;
    await expect(createStructuredProposal({ branch, profile: f.profile, selection: { ...f.proposal.selection, baseRevisionId: branch.currentRevisionId! }, modelOutput: f.output, turnId: "turn-a2", operationId: "duplicate-skill" })).rejects.toThrow(/already_exists/);
    const profile = structuredClone(f.profile); profile.skills[0].fact!.confirmedByUser = false;
    await expect(createStructuredProposal({ branch: f.branch, profile, selection: f.proposal.selection, modelOutput: f.output, turnId: "turn-a2", operationId: "unconfirmed-skill" })).rejects.toThrow(/confirmed_skill/);
    profile.skills[0].fact!.confirmedByUser = true; profile.skills[0].fact!.maturity = "learning";
    await expect(createStructuredProposal({ branch: f.branch, profile, selection: f.proposal.selection, modelOutput: f.output, turnId: "turn-a2", operationId: "learning-skill" })).rejects.toThrow(/maturity/);
  });
  it("validates exact calendar dates and keeps year/month/day precision", () => {
    for (const value of ["2024", "2024-02", "2024-02-29", "2024年2月29日"]) expect(correctionDate(value).normalized).toMatch(/^2024/);
    for (const value of ["2023-02-29", "2024-13", "2024-04-31", "至今", "2024-", "未知"]) expect(() => correctionDate(value)).toThrow();
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("recovers %s after actual TaskState projection failure", async kind => {
    const f = await hostFixture(kind), count = await db.resumeRevisions.count();
    const save = f.persistence.save.bind(f.persistence);
    const spy = vi.spyOn(f.persistence, "save").mockImplementation(async s => { if (s.taskState?.completionStatus === "completed") throw new Error("injected-projection"); return save(s); });
    await expect(f.host.resolvePreciseResumeEdit(f.session.id, "confirm")).rejects.toThrow("injected-projection");
    expect(await db.resumeRevisions.count()).toBe(count + 1); spy.mockRestore();
    const restored = await f.host.resolvePreciseResumeEdit(f.session.id, "recover");
    expect(restored?.taskState?.completionStatus).toBe("completed");
    expect(await db.resumeRevisions.count()).toBe(count + 1);
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("rejects %s after an intervening formal Revision", async kind => {
    const f = await setup(kind), before = await snapshot();
    await f.repo.editResumeBranch({ branchId: f.branch.id, expectedRevision: f.branch.revision, operationId: `manual-${kind}`,
      edits: [{ itemId: f.branch.contentItems[0].id, visible: false }] });
    const afterManual = await snapshot();
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_precise_revision_stale");
    expect(await snapshot()).toEqual(afterManual);
    expect(afterManual.revisions).toHaveLength(before.revisions.length + 1);
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("does not commit unconfirmed or rejected %s", async kind => {
    const f = await hostFixture(kind), before = await snapshot();
    const session = await f.persistence.get(f.session.id); session!.pendingConfirmation!.status = "pending";
    session!.updatedAt = new Date().toISOString(); await f.persistence.save(session!); await f.host.adoptDurably((await f.persistence.get(f.session.id))!);
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_precise_reference_mismatch");
    await f.host.resolvePreciseResumeEdit(f.session.id, "reject");
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow();
    const after = await snapshot(), expected = structuredClone(before);
    // Existing Session hydration calls getProfile/identity migration, updating only these registry bookkeeping timestamps.
    // Keep every registry identity/value and all source/confirmation records under the full deep comparison.
    for (const row of expected.appMeta) {
      if (row.key !== `careerPerson:v1:${f.profile.personId}` && row.key !== "careerPersons:v1") continue;
      const actual = after.appMeta.find(r => r.key === row.key)!;
      row.updatedAt = actual.updatedAt;
      if (row.key.startsWith("careerPerson:v1:")) (row.value as { updatedAt: string }).updatedAt = (actual.value as { updatedAt: string }).updatedAt;
    }
    expect(after).toEqual(expected);
  });
  it.each(["2024", "2024-02-01", "2025-07", "2024-13", "2023-02-29", "至今"])("rejects precision changes, impossible ranges or invalid date %s", async value => {
    await expect(setup("fact_correction", false, "startDate", "project", value)).rejects.toThrow(/precision|date/);
  });
  it("separates same-precision normalization from a changed date fact", async () => {
    const f = await setup("fact_correction", false, "startDate", "project", "2024/01");
    expect(f.proposal.operation).toMatchObject({ type: "fact_correction", correctionKind: "date_normalization" });
    await f.repo.applyPreciseResumeEdit(f.proposal);
  });
  it("keeps ongoing experiences ongoing and never infers a missing date", async () => {
    const f = await setup("fact_correction", false, "endDate", "project", "2024-07");
    const branch = structuredClone(f.branch);
    const data = branch.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!.data as { current: boolean; startDate?: string };
    data.current = true;
    await expect(createStructuredProposal({ branch, profile: f.profile, selection: f.proposal.selection, modelOutput: f.output, source: f.source,
      turnId: "turn-a2", operationId: "ongoing-fact-operation" })).rejects.toThrow("resume_structured_current_date_conflict");
    delete data.startDate;
    await expect(createStructuredProposal({ branch, profile: f.profile, selection: { ...f.proposal.selection, field: "startDate" }, modelOutput: f.output, source: f.source,
      turnId: "turn-a2", operationId: "missing-date-operation" })).rejects.toThrow(/field_missing/);
  });
  it("rejects invalidated skill evidence even if Profile version is unchanged", async () => {
    const f = await setup("confirmed_skill_addition"), before = await db.resumeRevisions.count();
    const profile = structuredClone(f.profile); profile.skills[0].fact!.confirmedByUser = false;
    await db.profiles.put(profile);
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow(/confirmed_skill/);
    expect(await db.resumeRevisions.count()).toBe(before);
  });
  it("recovers a historical receipt after subsequent edits and detects historical provenance corruption", async () => {
    const f = await setup(), result = await f.repo.applyPreciseResumeEdit(f.proposal);
    const branch = (await f.repo.getResumeBranch(f.branch.id))!;
    await f.repo.editResumeBranch({ branchId: branch.id, expectedRevision: branch.revision, operationId: "later-edit", edits: [{ itemId: branch.contentItems[0].id, visible: false }] });
    const count = await db.resumeRevisions.count();
    expect((await f.repo.getPreciseResumeEditReceipt(f.proposal))?.revisionId).toBe(result.revisionId);
    expect((await f.repo.applyPreciseResumeEdit(f.proposal)).revisionId).toBe(result.revisionId);
    expect(await db.resumeRevisions.count()).toBe(count);
    await db.appMeta.update(f.source!.id, { value: { ...f.source, contentHash: "0".repeat(64) } });
    await expect(f.repo.getPreciseResumeRevisionAudit(result.revisionId)).rejects.toThrow("resume_structured_fact_source_mismatch");
  });
  it("requires live confirmation provenance and rejects a forged source even with a recomputed hash", async () => {
    const f = await setup(), before = await db.resumeRevisions.count();
    await db.agentMessages.update(f.source!.messageId, { role: "assistant" });
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_structured_fact_source_mismatch");
    expect(await db.resumeRevisions.count()).toBe(before);
    const op = f.proposal.operation;
    if (op.type !== "fact_correction") throw new Error("fixture-kind");
    const forged = await rehash(f.proposal, { operation: { ...op, factProposal: { ...op.factProposal, source: { ...op.factProposal.source, content: "伪造" } } } });
    await expect(verifyPreciseProposal(forged)).rejects.toThrow("resume_structured_fact_source_mismatch");
  });
  it("does not project a late A2 receipt into a different foreground Session", async () => {
    const f = await hostFixture("bullet_removal"), execute = f.repo.applyPreciseResumeEdit.bind(f.repo);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { started = r; });
    vi.spyOn(f.repo, "applyPreciseResumeEdit").mockImplementation(async p => { started(); await gate; return execute(p); });
    const pending = f.host.resolvePreciseResumeEdit(f.session.id, "confirm"); await ready;
    const other = await f.persistence.save(AgentRuntime.createConversationSession()); await f.host.adoptDurably(other);
    release(); await pending;
    expect(f.host.getSnapshot().activeSession?.id).toBe(other.id);
  });
  it.each((["project", "work", "internship"] as const).flatMap(section =>
    (["role", "organization", "startDate", "endDate", ...(section === "project" ? ["title"] as const : [])] as const).map(field => ({ section, field }))))("roundtrips supported $section.$field through Schema, catalog, validation and Repository", async ({ section, field }) => {
    const value = field === "startDate" ? "2024-02" : field === "endDate" ? "2024-07" : "用户纠正名称";
    const f = await setup("fact_correction", true, field, section, value);
    const before = await snapshot(), result = await f.repo.applyPreciseResumeEdit(f.proposal), after = await snapshot();
    const next = result.revision.snapshot.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!;
    expect(next.data).toEqual({ ...f.branch.structuredContentItems!.find(i => i.id === next.id)!.data, [field]: value });
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(i => i.id !== f.branch.id)).toEqual(before.branches.filter(i => i.id !== f.branch.id));
    expect(after.revisions.filter(i => i.id !== result.revisionId)).toEqual(before.revisions);
  });
  it("reuses the existing skill alias normalization without fuzzy matching", async () => {
    expect(skillIdentity("Node")).toBe(skillIdentity("Node.js"));
    expect(skillIdentity("Python")).toBe(skillIdentity(" python "));
    expect(skillIdentity("SQL")).not.toBe(skillIdentity("MySQL"));
    const f = await setup("confirmed_skill_addition"), result = await f.repo.applyPreciseResumeEdit(f.proposal);
    const branch = (await f.repo.getResumeBranch(f.branch.id))!;
    const data = branch.structuredContentItems!.find(i => i.data.sectionType === "skills")!.data as { name: string }; data.name = "sql";
    await expect(createStructuredProposal({ branch, profile: f.profile, selection: { ...f.proposal.selection, baseRevisionId: result.revisionId },
      modelOutput: f.output, turnId: "turn-a2", operationId: "alias-dedup-operation" })).rejects.toThrow("resume_structured_skill_already_exists");
  });
  it("resolves imported canonical Skill IDs through the unique confirmed Fact ID", async () => {
    const f = await setup("confirmed_skill_addition"), profile = structuredClone(f.profile);
    profile.structuredFacts!.find(i => i.data.sectionType === "skills" && i.factIds.includes("fact-SQL"))!.data.id = "canonical-imported-sql";
    await db.profiles.put(profile);
    const proposal = await createStructuredProposal({ branch: f.branch, profile, selection: f.proposal.selection, modelOutput: f.output, turnId: "turn-a2", operationId: "canonical-skill-operation" });
    let session = (await f.persistence.get(f.session.id))!;
    session.taskState!.knownSlots.preciseResumeEdit = { selection: proposal.selection };
    session = projectPreciseProposal(session, proposal); session.pendingConfirmation!.status = "confirmed"; session.pendingConfirmation!.resolvedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString(); await f.persistence.save(session);
    const result = await f.repo.applyPreciseResumeEdit(proposal);
    expect(result.revision.snapshot.structuredContentItems!.at(-1)!.data.id).toBe("canonical-imported-sql");
    const ambiguous = structuredClone(profile); ambiguous.structuredFacts!.push({ ...ambiguous.structuredFacts!.find(i => i.data.id === "canonical-imported-sql")!, data: { ...ambiguous.structuredFacts!.find(i => i.data.id === "canonical-imported-sql")!.data, id: "other-canonical-sql" } });
    await expect(createStructuredProposal({ branch: f.branch, profile: ambiguous, selection: f.proposal.selection, modelOutput: f.output, turnId: "turn-a2", operationId: "ambiguous-skill-operation" })).rejects.toThrow(/source_missing_or_ambiguous/);
  });
  it.each(["bullet_removal", "bullet_reordering"] as const)("keeps the original confirmed fact renderable after %s", async kind => {
    const f = await setup(), first = await f.repo.applyPreciseResumeEdit(f.proposal);
    const branch = (await f.repo.getResumeBranch(f.branch.id))!;
    const selection = StructuredSelectionSchema.parse({ ...f.proposal.selection, baseRevisionId: first.revisionId, operation: kind,
      field: "highlights", bulletIndex: kind === "bullet_removal" ? 2 : null });
    const p = await createStructuredProposal({ branch, profile: f.profile, selection, modelOutput: kind === "bullet_removal" ? { operation: kind } : { operation: kind, permutation: [1, 2, 0] },
      turnId: "turn-b-after-fact", operationId: `after-fact-${kind}` });
    let session = (await f.persistence.get(f.session.id))!;
    session.activeTurn = { id: p.turnId, sessionId: session.id, status: "running", startedAt: new Date().toISOString() };
    session.taskState!.knownSlots.preciseResumeEdit = { selection };
    session = projectPreciseProposal(session, p); session.pendingConfirmation!.status = "confirmed"; session.pendingConfirmation!.resolvedAt = new Date().toISOString();
    session.updatedAt = new Date().toISOString(); await f.persistence.save(session);
    const saved = await f.repo.applyPreciseResumeEdit(p);
    const item = saved.revision.snapshot.contentItems.find(i => i.id === selection.itemId)!;
    expect(isRenderableContentItem({ item, profile: f.profile })).toEqual({ renderable: true });
    expect(item.userConfirmation?.confirmedAt).toBe(first.revision.snapshot.contentItems.find(i => i.id === selection.itemId)!.userConfirmation!.confirmedAt);
    expect((await f.repo.getPreciseResumeRevisionAudit(first.revisionId))?.proposal).toEqual(f.proposal);
  });
  it.each((["work", "internship"] as const).flatMap(section => (["bullet_removal", "bullet_reordering"] as const).map(kind => ({ section, kind }))))("preserves $section bullet identities for $kind on a job branch", async ({ section, kind }) => {
    const f = await setup(kind, true, "title", section), before = await snapshot();
    const saved = await f.repo.applyPreciseResumeEdit(f.proposal), after = await snapshot();
    const item = saved.revision.snapshot.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!;
    expect(item.data).toEqual({ ...f.branch.structuredContentItems!.find(i => i.id === item.id)!.data,
      highlights: kind === "bullet_removal" ? ["重复文字", "SQL 查询"] : ["SQL 查询", "重复文字", "重复文字"] });
    expect(after.profiles).toEqual(before.profiles);
    expect(after.branches.filter(b => b.id !== f.branch.id)).toEqual(before.branches.filter(b => b.id !== f.branch.id));
    expect(after.revisions.filter(r => r.id !== saved.revisionId)).toEqual(before.revisions);
  });
  it("observes the actual Dexie transaction covering confirmation consumption and formal Revision writes", async () => {
    const f = await setup();
    let activeTables: string[] = [];
    db.appMeta.hook("updating", function (_modifications, key) {
      if (String(key).startsWith("fact-proposal:")) activeTables = [...Dexie.currentTransaction!.storeNames].sort();
    });
    const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    expect(activeTables).toEqual(["profiles", "jobDescriptions", "resumeBranches", "resumeRevisions", "resumeBranchOperations", "agentSessions", "agentMessages", "appMeta"].sort());
    const audit = await f.repo.getPreciseResumeRevisionAudit(result.revisionId);
    expect(audit?.factConfirmation).toMatchObject({ state: "consumed", revisionId: result.revisionId });
    const dir = process.env.UX013_A2_EVIDENCE_DIR;
    if (dir) { mkdirSync(dir, { recursive: true }); writeFileSync(`${dir}/actual-dexie-transaction.json`, JSON.stringify({ observedFrom: "appMeta updating hook during consumption", activeTables, receipt: result, audit }, null, 2)); }
  });
  it.each(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"] as const)("projects %s across the actual Hermes event boundary while preserving original source Turn", async kind => {
    const f = await hostFixture(kind);
    let session = (await f.persistence.get(f.session.id))!;
    session.pendingConfirmation = undefined; session.pendingToolCall = undefined; session.taskState = undefined; session.activeTurn = undefined;
    session.updatedAt = new Date().toISOString(); session = await f.persistence.save(session); await f.host.adoptDurably(session);
    if (kind === "fact_correction") await f.host.selectPreciseFactCorrection(f.proposal.selection, "用户纠正的项目名称");
    else await f.host.selectPreciseResumeEdit(f.proposal.selection);
    const shell = await f.host.beginRuntimeShell({ session: f.host.getSnapshot().activeSession!, userMessage: "请对所选目标提出结构化修改", runtimeId: "hermes" });
    const result = await f.gateway.execute("career.workflow.precise_edit", f.output, { logicalTurnId: shell.turnId, agentSessionId: session.id,
      operationId: `model-${kind}-operation`, careerSessionBinding: { personId: f.profile.personId!, profileId: f.profile.id,
        profileVersionNumber: f.profile.profileVersionNumber!, profileRevision: f.profile.version, agentSessionId: session.id } });
    expect(result.ok).toBe(true);
    await f.host.applyRuntimeEvent({ sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(), type: "tool_call_completed",
      toolName: "career.workflow.precise_edit", operationId: `model-${kind}-operation`, data: { result } }, shell.assistantMessageId);
    const pending = (await f.persistence.get(session.id))!;
    expect(pending.pendingConfirmation?.status).toBe("pending");
    const p = (pending.taskState!.knownSlots.preciseResumeEdit as { proposal: StructuredProposal }).proposal;
    expect(p.operation.type).toBe(kind);
    if (p.operation.type === "fact_correction") expect(p.operation.factProposal.source.turnId).not.toBe(p.turnId);
    const count = await db.resumeRevisions.count();
    await f.host.resolvePreciseResumeEdit(session.id, "confirm");
    expect(await db.resumeRevisions.count()).toBe(count + 1);
  });
});
