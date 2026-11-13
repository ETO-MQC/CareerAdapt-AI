import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { CareerProfileSchema, ResumeBranchSchema, type CareerProfile } from "@/domain/schemas";
import { buildGeneralBranchFromProfile, buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { createResumeRevision } from "@/domain/branch/revision";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { AgentHostStore } from "@/agent/runtime/AgentHostStore";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import { CareerToolGateway, CareerToolGatewayExecutor } from "@/agent/tools/CareerToolGateway";
import { projectPreciseProposal } from "@/agent/runtime/preciseResumeEditCheckpoint";
import { createPreciseProposal, canonicalJson, preciseSha256, preciseOperationKey, PreciseModelOutputSchema, PreciseSelectionSchema, type PreciseProposal } from "@/domain/resumeEditing/preciseResumeEdit";
import { projectBusinessWorkflowProgress } from "@/agent/runtime/businessWorkflowProgress";

const now = "2026-11-06T08:00:00.000Z";
const original = "参与接口开发与测试。";
const after = "参与测试与接口开发。";
let db: CareerAdaptDb;
afterEach(async () => { db?.close(); if (db) await db.delete(); });
function profileFixture(): CareerProfile {
  return CareerProfileSchema.parse({ id: "profile-precise", name: "匿名测试", basics: { name: "匿名测试", links: [] },
    preference: { targetRoles: [], targetCities: [], industries: [] }, version: 1,
    experiences: ["project", "work", "internship"].map(type => ({ id: type, type, organization: `匿名${type}`, role: "开发",
      facts: [{ id: `fact-${type}`, statement: original, category: "experience", confirmedByUser: true, riskLevel: "low",
        provenance: [{ sourceType: "user_input", sourceId: "source", sourceText: original, confidence: 1, confirmedByUser: true, riskLevel: "low", createdAt: now }], createdAt: now, updatedAt: now }],
      resumeDrafts: [], tags: [], evidenceIds: [], createdAt: now, updatedAt: now })),
    skills: [], certificates: [], evidences: [], unclassifiedBlocks: [], createdAt: now, updatedAt: now });
}
async function setup(section: "project" | "work" | "internship" = "project", field: "description" | "highlights" = "description", job = false) {
  db = new CareerAdaptDb(`precise-${crypto.randomUUID()}`);
  const repo = new WorkspaceRepository(db);
  let profile = profileFixture(); await repo.saveProfile(profile);
  profile = (await repo.getProfile(profile.id))!;
  const general = buildGeneralBranchFromProfile({ profile, operationId: "general-create", name: "匿名通用简历", includeProfileFacts: true, includeProfileBasics: true, now });
  const jobBranch = buildJobBranchFromProfile({ profile, operationId: "job-create", name: "匿名岗位简历", jobId: "job-precise", jobTitle: "开发", jobVersion: now,
    selectedCanonicalItemIds: ["project", "work", "internship"], requirementMatchIds: [], sourceMatchSetHash: "match-precise", now });
  await repo.saveJobDescription({ id: "job-precise", title: "开发", company: "匿名公司", rawText: "接口开发测试", source: "manual", requirements: [], createdAt: now, updatedAt: now });
  const source = job ? jobBranch : general;
  const branch = ResumeBranchSchema.parse({ ...source.branch, structuredContentItems: source.branch.structuredContentItems!.map(i => {
    if (!["project", "work", "internship"].includes(i.data.sectionType)) return i;
    return { ...i, data: { ...i.data, description: original, highlights: [original, "保留第二条。", "保留第三条。"] }, legacyTextProjection: [original, original, "保留第二条。", "保留第三条。"].join("\n") };
  }) });
  branch.contentItems = branch.contentItems.map(i => ({ ...i, text: branch.structuredContentItems!.find(s => s.id === i.id)!.legacyTextProjection! }));
  const firstRevision = createResumeRevision({ branch, source: source.firstRevision.source, operationId: source.firstRevision.operationId, now });
  branch.currentRevisionId = firstRevision.id;
  await repo.saveResumeBranch(branch); await db.resumeRevisions.put(firstRevision);
  const other = job ? general : jobBranch;
  await repo.saveResumeBranch(other.branch); await db.resumeRevisions.put(other.firstRevision);
  const item = branch.structuredContentItems!.find(i => i.data.sectionType === section)!;
  const persistence = new AgentSessionStore(repo);
  let session = await persistence.save({ ...AgentRuntime.createConversationSession(), personId: profile.personId, activeProfileId: profile.id, profileVersionNumber: 1, profileRevision: profile.version,
    activeTurn: { id: "turn-precise", sessionId: "placeholder", status: "running", startedAt: now } });
  session.activeTurn!.sessionId = session.id;
  const selection = { sessionId: session.id, taskId: "task-precise", profileId: profile.id, branchId: branch.id,
    baseRevisionId: branch.currentRevisionId!, sectionType: section, itemId: item.id, field, bulletIndex: field === "highlights" ? 0 : null };
  const proposal = await createPreciseProposal({ branch, profile, selection, modelOutput: { proposedValue: after }, turnId: "turn-precise", operationId: "operation-precise" });
  session.taskState = AgentTaskStateSchema.parse({ rootGoal: "precise_resume_edit", activeGoal: "precise_resume_edit", workflowId: "precise_resume_edit", stage: "propose_precise_edit", selectedEntities: { profileId: profile.id, profileVersion: profile.version, resumeId: branch.id, resumeRevisionId: branch.currentRevisionId!, revisionId: branch.currentRevisionId! }, knownSlots: { preciseResumeEdit: { selection } }, updatedAt: now });
  session = projectPreciseProposal(session, proposal);
  session.pendingConfirmation!.status = "confirmed";
  session = await persistence.save(session);
  return { repo, profile, branch, proposal, session, persistence, other: other.branch };
}
async function rehash(proposal: PreciseProposal, patch: Partial<PreciseProposal>) {
  const rest = { ...proposal, ...patch } as Partial<PreciseProposal>;
  delete rest.proposalHash;
  return { ...rest, proposalHash: await preciseSha256(canonicalJson(rest)) } as PreciseProposal;
}

describe("A1 exact Repository boundary", () => {
  it.each(["project", "work", "internship"] as const)("preserves the complete complement for %s.description", async section => {
    const f = await setup(section);
    const beforeProfile = await f.repo.getProfile(f.profile.id);
    const beforeOther = await f.repo.getResumeBranch(f.other.id);
    const initialPresentation = await f.repo.getResumePresentationConfig(f.branch.id);
    const { config: presentation } = await f.repo.saveResumePresentationConfig({ branchId: f.branch.id,
      expectedBranchRevision: f.branch.revision, expectedRevisionId: f.branch.currentRevisionId!,
      expectedPresentationRevision: initialPresentation.presentationRevision, operationId: "save-test-presentation", nextConfig: { ...initialPresentation, presentationRevision: initialPresentation.presentationRevision + 1 } });
    const storedPresentation = await db.appMeta.toArray();
    const baseline = await db.resumeRevisions.count();
    const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    const next = (await f.repo.getResumeBranch(f.branch.id))!;
    expect(next.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!.data).toMatchObject({ description: after });
    const expected = structuredClone(f.branch);
    const selected = expected.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!;
    (selected.data as { description: string }).description = after;
    selected.legacyTextProjection = [after, original, "保留第二条。", "保留第三条。"].join("\n");
    expected.contentItems.find(i => i.id === selected.id)!.text = selected.legacyTextProjection;
    expect(next).toEqual({ ...expected, revision: f.branch.revision + 1, currentRevisionId: result.revisionId, updatedAt: next.updatedAt });
    expect(await db.appMeta.toArray()).toEqual(storedPresentation);
    expect(await f.repo.getProfile(f.profile.id)).toEqual(beforeProfile);
    expect(await f.repo.getResumeBranch(f.other.id)).toEqual(beforeOther);
    const nextPresentation = await f.repo.getResumePresentationConfig(f.branch.id);
    expect(nextPresentation).toEqual({ ...presentation, contentRevision: { branchRevision: next.revision, currentRevisionId: next.currentRevisionId } });
    expect(await db.resumeRevisions.count()).toBe(baseline + 1);
    expect(result.revision.previousRevisionId).toBe(f.branch.currentRevisionId);
    expect((await f.repo.getResumeRevision(result.revisionId))!.id).toBe(result.revisionId);
    if (process.env.UX013_EVIDENCE_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.UX013_EVIDENCE_DIR, { recursive: true });
      writeFileSync(`${process.env.UX013_EVIDENCE_DIR}/${section}-description.json`, JSON.stringify({ before: { profile: beforeProfile, branch: f.branch, other: beforeOther, presentation }, after: { profile: await f.repo.getProfile(f.profile.id), branch: next, other: await f.repo.getResumeBranch(f.other.id), presentation: await f.repo.getResumePresentationConfig(f.branch.id) }, receipt: result }, null, 2));
    }
  });
  it.each(["project", "work", "internship"] as const)("patches one %s.highlights index on a job branch", async section => {
    const f = await setup(section, "highlights", true);
    const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    const next = (await f.repo.getResumeBranch(f.branch.id))!;
    const expected = structuredClone(f.branch);
    const item = expected.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!;
    (item.data as { highlights: string[] }).highlights[0] = after;
    item.legacyTextProjection = [original, after, "保留第二条。", "保留第三条。"].join("\n");
    expected.contentItems.find(i => i.id === item.id)!.text = item.legacyTextProjection;
    expect(next).toEqual({ ...expected, revision: f.branch.revision + 1, currentRevisionId: result.revisionId, updatedAt: next.updatedAt });
    expect(await f.repo.getResumeBranch(f.other.id)).toEqual(f.other);
    expect(await f.repo.getProfile(f.profile.id)).toEqual(f.profile);
    if (process.env.UX013_EVIDENCE_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.UX013_EVIDENCE_DIR, { recursive: true });
      writeFileSync(`${process.env.UX013_EVIDENCE_DIR}/${section}-bullet.json`, JSON.stringify({ before: { branch: f.branch, profile: f.profile, other: f.other }, after: { branch: next, profile: await f.repo.getProfile(f.profile.id), other: await f.repo.getResumeBranch(f.other.id) }, receipt: result }, null, 2));
    }
  });
  it("uses the real unique Dexie index and atomically deduplicates concurrent confirmations", async () => {
    const f = await setup(); const count = await db.resumeRevisions.count();
    expect(db.resumeBranchOperations.schema.idxByName.operationId.unique).toBe(true);
    const key = await preciseOperationKey(f.proposal); expect(key.key).toHaveLength(137);
    const results = await Promise.all([f.repo.applyPreciseResumeEdit(f.proposal), f.repo.applyPreciseResumeEdit(f.proposal), f.repo.applyPreciseResumeEdit(f.proposal)]);
    expect(new Set(results.map(r => r.revisionId)).size).toBe(1);
    expect(results.filter(r => !r.idempotent)).toHaveLength(1);
    expect(await db.resumeRevisions.count()).toBe(count + 1);
    expect(await db.resumeBranchOperations.where("operationId").startsWith(key.prefix).count()).toBe(1);
  });
  it("rejects the same operation with changed hash without changing generic idempotency", async () => {
    const f = await setup(); await f.repo.applyPreciseResumeEdit(f.proposal);
    const changed = await rehash(f.proposal, { proposedValue: "参与接口测试与开发。" });
    await expect(f.repo.applyPreciseResumeEdit(changed)).rejects.toThrow("resume_precise_operation_conflict");
  });
  it("recovers the original receipt after later branch revisions", async () => {
    const f = await setup(); const result = await f.repo.applyPreciseResumeEdit(f.proposal);
    const next = (await f.repo.getResumeBranch(f.branch.id))!;
    await f.repo.editResumeBranch({ branchId: next.id, expectedRevision: next.revision, operationId: "later-manual-edit", edits: [{ itemId: next.contentItems[0].id, text: "后来的手动修改。" }] });
    const baseline = await db.resumeRevisions.count();
    const duplicate = await f.repo.applyPreciseResumeEdit(f.proposal);
    expect(duplicate.revisionId).toBe(result.revisionId);
    expect((await f.repo.getPreciseResumeEditReceipt(f.proposal))?.revisionId).toBe(result.revisionId);
    expect(await db.resumeRevisions.count()).toBe(baseline);
  });
  it("rejects stale Revision and preserves the newer edit", async () => {
    const f = await setup();
    await f.repo.editResumeBranch({ branchId: f.branch.id, expectedRevision: f.branch.revision, operationId: "newer-manual-edit", edits: [{ itemId: f.branch.contentItems[0].id, text: "新的手动修改。" }] });
    const before = await f.repo.getResumeBranch(f.branch.id);
    const count = await db.resumeRevisions.count();
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_precise_revision_stale");
    expect(await f.repo.getResumeBranch(f.branch.id)).toEqual(before); expect(await db.resumeRevisions.count()).toBe(count);
  });
  it("requires strict Profile version and blocks forged evidence and unconfirmed writes", async () => {
    const f = await setup();
    await db.profiles.update(f.profile.id, { version: f.profile.version + 1 });
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_precise_profile_stale");
    await db.profiles.update(f.profile.id, { version: f.profile.version });
    f.session.pendingConfirmation!.status = "pending"; await f.persistence.save(f.session);
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("resume_precise_reference_mismatch");
  });
  it.each(["task", "turn", "confirmation", "call"])("rejects inconsistent %s authority/reference", async location => {
    const f = await setup(); const count = await db.resumeRevisions.count();
    const session = structuredClone(f.session);
    if (location === "task") (session.taskState!.knownSlots.preciseResumeEdit as { proposal: PreciseProposal }).proposal.proposedValue += "篡改";
    if (location === "turn") session.activeTurn!.workflowCheckpoint!.preciseEditRef = { operationId: "wrong", proposalHash: f.proposal.proposalHash };
    if (location === "confirmation") session.pendingConfirmation!.validatedInput = { proposalHash: "wrong" };
    if (location === "call") session.pendingToolCall!.input = { proposalHash: "wrong" };
    await f.persistence.save(session);
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow(/resume_precise_(owner|reference)_mismatch/);
    expect(await db.resumeRevisions.count()).toBe(count);
  });
  it("rolls back Branch/Revision when ledger persistence fails", async () => {
    const f = await setup(); const count = await db.resumeRevisions.count();
    const spy = vi.spyOn(db.resumeBranchOperations, "put").mockRejectedValueOnce(new Error("simulated write failure"));
    await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow("simulated write failure");
    spy.mockRestore();
    expect(await f.repo.getResumeBranch(f.branch.id)).toEqual(f.branch); expect(await db.resumeRevisions.count()).toBe(count);
  });
});

it("rejects model-provided authority fields and unsupported or invalid selection", () => {
  for (const field of ["target", "profileId", "branchId", "itemId", "bulletIndex", "originalValue", "evidenceRefs", "claimClassification", "operationId", "proposalHash"]) {
    expect(PreciseModelOutputSchema.safeParse({ proposedValue: after, [field]: "forged" }).success).toBe(false);
  }
  expect(PreciseModelOutputSchema.safeParse({ proposedValue: "  " }).success).toBe(false);
  expect(PreciseSelectionSchema.safeParse({ sectionType: "education", field: "title" }).success).toBe(false);
});
it.each(["独立负责接口开发，提升效率50%。", "担任负责人并带领团队完成项目。"])("blocks unsupported factual/ownership claim %s", async proposedValue => {
  const f = await setup(); const count = await db.resumeRevisions.count();
  await expect(createPreciseProposal({ branch: f.branch, profile: f.profile, selection: f.proposal.selection, modelOutput: { proposedValue }, turnId: "turn-precise", operationId: "unsafe-operation" })).rejects.toThrow(/guard|safety/);
  expect(await db.resumeRevisions.count()).toBe(count);
});

async function hostFixture() {
  const f = await setup();
  const registry = createAgentToolRegistry(new BrowserAgentToolService(f.repo));
  const gateway: CareerToolGateway = new CareerToolGateway({ registry, getAuthoritativeTaskState: () => host.getSnapshot().activeSession?.taskState });
  const host: AgentHostStore = new AgentHostStore({ repository: f.repo, persistence: f.persistence, executor: new CareerToolGatewayExecutor(registry, gateway) });
  await host.adoptDurably(f.session);
  return { ...f, host, gateway };
}
it("recovers Repository success after TaskState projection failure without writing another Revision", async () => {
  const f = await hostFixture();
  const result = await f.repo.applyPreciseResumeEdit(f.proposal);
  const count = await db.resumeRevisions.count();
  expect((await f.persistence.get(f.session.id))?.taskState?.completionStatus).toBe("waiting_for_confirmation");
  const restored = await f.host.resolvePreciseResumeEdit(f.session.id, "recover");
  expect(projectBusinessWorkflowProgress(restored!).state).toBe("completed");
  expect((restored!.taskState!.knownSlots.preciseResumeEdit as { outcome: { revisionId: string } }).outcome.revisionId).toBe(result.revisionId);
  expect(await db.resumeRevisions.count()).toBe(count);
});
it.each(["reject", "cancel"] as const)("persists %s without resurrecting an actionable proposal", async decision => {
  const f = await hostFixture(); const current = (await f.persistence.get(f.session.id))!; current.pendingConfirmation!.status = "pending"; current.updatedAt = new Date().toISOString();
  const session = await f.persistence.save(current); await f.host.adoptDurably(session);
  const count = await db.resumeRevisions.count();
  await f.host.resolvePreciseResumeEdit(session.id, decision);
  const restored = (await f.persistence.get(session.id))!;
  expect(restored.pendingConfirmation).toBeUndefined(); expect(restored.taskState?.completionStatus).toBe("cancelled");
  await expect(f.repo.applyPreciseResumeEdit(f.proposal)).rejects.toThrow(); expect(await db.resumeRevisions.count()).toBe(count);
});
it("selects the TaskState Profile even when the compatibility alias is stale", async () => {
  const f = await hostFixture();
  let session = (await f.persistence.get(f.session.id))!;
  session.pendingConfirmation = undefined; session.pendingToolCall = undefined; session.activeTurn = undefined;
  session.activeProfileId = "stale-profile"; session.updatedAt = new Date().toISOString();
  session = await f.persistence.save(session);
  await f.host.adoptDurably(session);
  const selected = await f.host.selectPreciseResumeEdit(f.proposal.selection);
  expect(selected.activeProfileId).toBe(f.profile.id);
  expect(selected.taskState?.selectedEntities).toMatchObject({ profileId: f.profile.id, resumeId: f.branch.id, revisionId: f.branch.currentRevisionId });
});
it("uses UI selection through real Facade/Gateway/Host then concurrent confirm", async () => {
  const f = await hostFixture();
  let session = (await f.persistence.get(f.session.id))!;
  session.pendingConfirmation = undefined; session.pendingToolCall = undefined; session.taskState = undefined; session.activeTurn = undefined;
  session = await f.persistence.save(session); f.host.adopt(session);
  await f.host.selectPreciseResumeEdit(f.proposal.selection);
  const proposed = await f.host.proposePreciseResumeEdit(after);
  expect(proposed.pendingConfirmation?.status).toBe("pending");
  const baseline = await db.resumeRevisions.count();
  const results = await Promise.all([f.host.resolvePreciseResumeEdit(session.id, "confirm"), f.host.resolvePreciseResumeEdit(session.id, "confirm")]);
  expect(results.every(r => r?.taskState?.completionStatus === "completed")).toBe(true);
  expect(await db.resumeRevisions.count()).toBe(baseline + 1);
});

it("keeps the original proposal after a write failure and retries only explicitly", async () => {
  const f = await hostFixture();
  const spy = vi.spyOn(f.repo, "applyPreciseResumeEdit").mockRejectedValueOnce(new Error("resume_precise_simulated_write_failure"));
  const count = await db.resumeRevisions.count();
  const failed = await f.host.resolvePreciseResumeEdit(f.session.id, "confirm");
  expect(failed?.taskState?.completionStatus).toBe("failed");
  expect(await db.resumeRevisions.count()).toBe(count);
  expect((failed?.taskState?.knownSlots.preciseResumeEdit as { proposal: unknown }).proposal).toEqual(f.proposal);
  spy.mockRestore();
  const noWriteRecovery = await f.host.resolvePreciseResumeEdit(f.session.id, "recover");
  expect(noWriteRecovery?.taskState?.completionStatus).toBe("failed");
  expect(await db.resumeRevisions.count()).toBe(count);
  const saved = await f.host.resolvePreciseResumeEdit(f.session.id, "confirm");
  expect(saved?.taskState?.completionStatus).toBe("completed"); expect(await db.resumeRevisions.count()).toBe(count + 1);
});
it("survives an actual projection persistence failure after Repository commit", async () => {
  const f = await hostFixture(); const count = await db.resumeRevisions.count();
  const save = f.persistence.save.bind(f.persistence);
  const spy = vi.spyOn(f.persistence, "save").mockImplementation(async value => {
    if (value.taskState?.completionStatus === "completed") throw new Error("simulated projection failure");
    return save(value);
  });
  await expect(f.host.resolvePreciseResumeEdit(f.session.id, "confirm")).rejects.toThrow("simulated projection failure");
  expect(await db.resumeRevisions.count()).toBe(count + 1);
  const authoritative = await f.repo.getPreciseResumeEditReceipt(f.proposal);
  expect(authoritative?.revisionId).toBeTruthy(); spy.mockRestore();
  const refreshed = await f.host.resolvePreciseResumeEdit(f.session.id, "recover");
  expect(refreshed?.taskState?.selectedEntities.revisionId).toBe(authoritative!.revisionId);
  expect(await db.resumeRevisions.count()).toBe(count + 1);
});
it("does not replace another Session with a late precise commit result", async () => {
  const f = await hostFixture();
  const execute = f.repo.applyPreciseResumeEdit.bind(f.repo);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  vi.spyOn(f.repo, "applyPreciseResumeEdit").mockImplementation(async p => { started(); await gate; return execute(p); });
  const work = f.host.resolvePreciseResumeEdit(f.session.id, "confirm"); await ready;
  const other = await f.persistence.save(AgentRuntime.createConversationSession()); await f.host.adoptDurably(other);
  release(); await work;
  expect(f.host.getSnapshot().activeSession?.id).toBe(other.id);
  expect((await f.persistence.get(other.id))?.taskState).toBeUndefined();
});
it.each(["missing", "index", "historical", "general-job", "job-mismatch", "evidence"])("rejects invalid %s before any write", async kind => {
  const f = await setup(); const count = await db.resumeRevisions.count();
  if (kind === "missing") {
    const branch = structuredClone(f.branch);
    delete (branch.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!.data as { description?: string }).description;
    await expect(createPreciseProposal({ branch, profile: f.profile, selection: f.proposal.selection, modelOutput: { proposedValue: after }, turnId: "turn-precise", operationId: "invalid-operation" })).rejects.toThrow(/field_missing/);
  } else if (kind === "index") {
    await expect(createPreciseProposal({ branch: f.branch, profile: f.profile, selection: { ...f.proposal.selection, field: "highlights", bulletIndex: 100 }, modelOutput: { proposedValue: after }, turnId: "turn-precise", operationId: "invalid-operation" })).rejects.toThrow(/index_invalid/);
  } else {
    const changed = await rehash(f.proposal, kind === "historical" ? { selection: { ...f.proposal.selection, baseRevisionId: "historical" } }
      : kind === "general-job" ? { jobId: "forged" } : kind === "job-mismatch" ? { branchPurpose: "job_specific", jobId: "forged" }
        : { evidenceRefs: f.proposal.evidenceRefs.map(ref => ({ ...ref, factText: "伪造证据" })) });
    // Tamper all proposal references consistently: semantic dependency validation must still reject.
    let session = (await f.persistence.get(f.session.id))!;
    session.pendingConfirmation = undefined; session.pendingToolCall = undefined;
    session.taskState!.knownSlots.preciseResumeEdit = { selection: changed.selection };
    session.taskState!.selectedEntities.revisionId = changed.selection.baseRevisionId;
    session.taskState!.selectedEntities.resumeRevisionId = changed.selection.baseRevisionId;
    session = projectPreciseProposal(session, changed); session.pendingConfirmation!.status = "confirmed";
    await f.persistence.save(session);
    await expect(f.repo.applyPreciseResumeEdit(changed)).rejects.toThrow(/stale|purpose_mismatch|evidence_mismatch/);
  }
  expect(await db.resumeRevisions.count()).toBe(count);
});
it("uses deterministic canonical hash and binds every identity and payload field", async () => {
  const f = await setup();
  expect(await preciseSha256(canonicalJson({ b: 2, a: [1, 2] }))).toBe(await preciseSha256(canonicalJson({ a: [1, 2], b: 2 })));
  expect(await preciseSha256(canonicalJson([1, 2]))).not.toBe(await preciseSha256(canonicalJson([2, 1])));
  for (const patch of [{ operationId: "another-operation" }, { proposedValue: "不同文案" }, { originalValue: "不同原文" }, { profileVersion: 2 }, { turnId: "other-turn" }, { selection: { ...f.proposal.selection, taskId: "other-task" } }]) {
    expect((await rehash(f.proposal, patch)).proposalHash).not.toBe(f.proposal.proposalHash);
  }
});
it("requires explicit selection for ambiguous model requests and writes nothing", async () => {
  const f = await hostFixture(); const count = await db.resumeRevisions.count();
  const current = (await f.persistence.get(f.session.id))!;
  current.taskState = undefined; current.pendingConfirmation = undefined; current.pendingToolCall = undefined;
  const saved = await f.persistence.save(current); await f.host.adoptDurably(saved);
  await expect(f.host.proposePreciseResumeEdit(after)).rejects.toThrow("resume_precise_selection_required");
  expect(await db.resumeRevisions.count()).toBe(count);
});

it("projects the model proposedValue facade through the existing Hermes event boundary", async () => {
  const f = await hostFixture();
  let session = (await f.persistence.get(f.session.id))!;
  session.pendingConfirmation = undefined; session.pendingToolCall = undefined; session.taskState = undefined; session.activeTurn = undefined;
  session = await f.persistence.save(session); await f.host.adoptDurably(session);
  await f.host.selectPreciseResumeEdit(f.proposal.selection);
  const selected = f.host.getSnapshot().activeSession!;
  const shell = await f.host.beginRuntimeShell({ session: selected, userMessage: "请润色所选字段", runtimeId: "hermes" });
  const context = { logicalTurnId: shell.turnId, agentSessionId: session.id, operationId: "model-precise-operation", careerSessionBinding: {
    personId: session.personId!, profileId: session.activeProfileId!, profileVersionNumber: session.profileVersionNumber!, profileRevision: session.profileRevision!, agentSessionId: session.id
  } };
  const result = await f.gateway.execute("career.workflow.precise_edit", { proposedValue: after }, context);
  expect(result.ok).toBe(true);
  await f.host.applyRuntimeEvent({ sessionId: session.id, turnId: shell.turnId, timestamp: new Date().toISOString(), type: "tool_call_completed",
    toolName: "career.workflow.precise_edit", operationId: context.operationId, data: { result } }, shell.assistantMessageId);
  const proposalSession = (await f.persistence.get(session.id))!;
  expect(proposalSession.pendingConfirmation?.status).toBe("pending");
  expect(proposalSession.taskState?.completionStatus).toBe("waiting_for_confirmation");
  const baseline = await db.resumeRevisions.count();
  const saved = await f.host.resolvePreciseResumeEdit(session.id, "confirm");
  expect(saved?.taskState?.completionStatus).toBe("completed");
  expect(await db.resumeRevisions.count()).toBe(baseline + 1);
});

it("accepts an exact evidence-backed import-style wording change", async () => {
  const f = await setup();
  const before = "参与 AI 应用项目的需求梳理、原型设计和功能验收。";
  const branch = structuredClone(f.branch);
  const item = branch.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!;
  (item.data as { description: string }).description = before;
  const p = await createPreciseProposal({ branch, profile: f.profile, selection: f.proposal.selection,
    modelOutput: { proposedValue: "参加 AI 应用项目的需求梳理、原型设计和功能验收。" }, turnId: "turn-precise", operationId: "import-style-edit" });
  expect(p.claimClassification).toBe("presentation_only");
});

it("retains the Guard's conservative rejection of a reordered responsibility object", async () => {
  const f = await setup(); const branch = structuredClone(f.branch);
  (branch.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!.data as { description: string }).description = "参与 AI 应用项目的需求梳理、原型设计和功能验收。";
  await expect(createPreciseProposal({ branch, profile: f.profile, selection: f.proposal.selection,
    modelOutput: { proposedValue: "参与 AI 应用项目的功能验收、原型设计和需求梳理。" }, turnId: "turn-precise", operationId: "guard-conservative-edit" })).rejects.toThrow("resume_precise_fact_guard_blocked");
});

it.each(["reject", "cancel"] as const)("cannot resurrect %s via a duplicate proposal result", async decision => {
  const f = await hostFixture();
  const current = (await f.persistence.get(f.session.id))!; current.pendingConfirmation!.status = "pending";
  const pending = await f.persistence.save(current); await f.host.adoptDurably(pending);
  const resolved = (await f.host.resolvePreciseResumeEdit(f.session.id, decision))!;
  expect(projectPreciseProposal(resolved, f.proposal)).toEqual(resolved);
  expect(projectPreciseProposal(resolved, f.proposal).pendingConfirmation).toBeUndefined();
});

it("rejects an empty existing description instead of inserting a new factual assertion", async () => {
  const f = await setup(); const branch = structuredClone(f.branch);
  (branch.structuredContentItems!.find(i => i.id === f.proposal.selection.itemId)!.data as { description: string }).description = "";
  await expect(createPreciseProposal({ branch, profile: f.profile, selection: f.proposal.selection,
    modelOutput: { proposedValue: "承担全新职责。" }, turnId: "turn-precise", operationId: "empty-field-edit" })).rejects.toThrow("resume_precise_field_missing_or_index_invalid");
});

it("isolates the selected job Branch from both the general and a second job Branch", async () => {
  const f = await setup("project", "highlights", true);
  const otherJob = buildJobBranchFromProfile({ profile: f.profile, operationId: "second-job-create", name: "第二岗位简历", jobId: "job-second", jobTitle: "测试", jobVersion: now,
    selectedCanonicalItemIds: ["project"], requirementMatchIds: [], sourceMatchSetHash: "match-second", now });
  await f.repo.saveJobDescription({ id: "job-second", title: "测试", company: "其他匿名公司", rawText: "测试工作", source: "manual", requirements: [], createdAt: now, updatedAt: now });
  await f.repo.saveResumeBranch(otherJob.branch); await db.resumeRevisions.put(otherJob.firstRevision);
  const before = await db.resumeBranches.toArray(); const profileBefore = await db.profiles.toArray(); const metaBefore = await db.appMeta.toArray();
  const result = await f.repo.applyPreciseResumeEdit(f.proposal);
  const after = await db.resumeBranches.toArray();
  expect(after.filter(b => b.id !== f.branch.id)).toEqual(before.filter(b => b.id !== f.branch.id));
  expect(await db.profiles.toArray()).toEqual(profileBefore); expect(await db.appMeta.toArray()).toEqual(metaBefore);
  if (process.env.UX013_EVIDENCE_DIR) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(`${process.env.UX013_EVIDENCE_DIR}/job-branch-isolation.json`, JSON.stringify({ before, after, profileBefore, profileAfter: await db.profiles.toArray(), receipt: result }, null, 2));
  }
});
