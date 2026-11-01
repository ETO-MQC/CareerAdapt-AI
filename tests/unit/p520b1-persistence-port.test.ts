import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository, RevisionConflictError } from "@/services/storage/repositories";
import { DexieCareerPersistenceAdapter } from "@/services/storage/persistence/dexieCareerPersistenceAdapter";
import type { CareerPersistencePort } from "@/services/storage/persistence/careerPersistencePort";

let db: CareerAdaptDb;
let repo: WorkspaceRepository;
let port: CareerPersistencePort;
beforeEach(async () => {
  db = new CareerAdaptDb(`P520B1-fixture-${crypto.randomUUID()}`);
  repo = new WorkspaceRepository(db);
  port = new DexieCareerPersistenceAdapter(db);
  await repo.saveProfile(demoCareerProfile);
  await repo.saveJobDescription(demoJobDescriptions[0]);
});
afterEach(async () => { vi.restoreAllMocks(); db.close(); await db.delete(); });
const create = (operationId = "create") => repo.createGeneralResumeBranch({ profileId: demoCareerProfile.id, operationId, name: operationId, includeProfileFacts: true, includeProfileBasics: true });
const persisted = async () => ({ branches: await db.resumeBranches.toArray(), revisions: await db.resumeRevisions.toArray(), receipts: await db.resumeBranchOperations.toArray(), profiles: await db.profiles.toArray(), jobs: await db.jobDescriptions.toArray() });

describe("canonical Branch mutation persistence port", () => {
  it("reads the exact Profile/Job IDs and never substitutes another owner", async () => {
    const profile = await db.profiles.get(demoCareerProfile.id);
    const job = await db.jobDescriptions.get(demoJobDescriptions[0].id);
    await port.withBranchMutation(async unit => {
      expect(await unit.readProfile(demoCareerProfile.id)).toEqual(profile);
      expect(await unit.readJob(demoJobDescriptions[0].id)).toEqual(job);
      expect(await unit.readProfile("other-person")).toBeUndefined();
      expect(await unit.readJob("other-job")).toBeUndefined();
    });
  });

  it("uses the adapter in the real edit path and persists linked revisions and receipt", async () => {
    const created = await create();
    const spy = vi.spyOn(DexieCareerPersistenceAdapter.prototype, "withBranchMutation");
    const edited = await repo.editResumeBranchBasics({ branchId: created.branch.id, expectedRevision: created.branch.revision, operationId: "edit", basics: { name: "Resume only" } });
    expect(spy).toHaveBeenCalledTimes(1);
    const stored = await persisted();
    expect(stored.branches[0]).toEqual(edited.branch);
    expect(stored.revisions.find(r => r.id === edited.revision?.id)).toMatchObject({ previousRevisionId: created.branch.currentRevisionId, revisionNumber: created.branch.revision + 1 });
    expect(stored.receipts.find(r => r.operationId === "edit")).toMatchObject({ branchId: created.branch.id, revisionId: edited.revision?.id, beforeRevision: created.branch.revision, afterRevision: edited.branch.revision });
    expect((await repo.listResumeRevisions(created.branch.id)).map(r => r.revisionNumber)).toEqual([created.branch.revision, edited.branch.revision]);
  });

  it("replays a duplicate operation before stale CAS without additional writes", async () => {
    const { branch } = await create();
    const input = { branchId: branch.id, expectedRevision: branch.revision, operationId: "repeat", basics: { name: "Independent" } };
    const first = await repo.editResumeBranchBasics(input);
    const before = await persisted();
    const replay = await repo.editResumeBranchBasics(input);
    expect(replay).toMatchObject({ idempotent: true, branch: first.branch, revision: first.revision });
    expect(await persisted()).toEqual(before);
  });

  it("serializes competing revisions: one commit, one conflict, no orphan writes", async () => {
    const { branch } = await create();
    const results = await Promise.allSettled(["left", "right"].map(operationId => repo.editResumeBranchBasics({ branchId: branch.id, expectedRevision: branch.revision, operationId, basics: { name: operationId } })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find(r => r.status === "rejected");
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(RevisionConflictError);
    const stored = await persisted();
    expect(stored.revisions).toHaveLength(2);
    expect(stored.receipts).toHaveLength(2);
    const winner = stored.receipts.find(r => r.operationId !== "create")!;
    expect(stored.branches[0].currentRevisionId).toBe(winner.revisionId);
    expect(stored.revisions.find(r => r.id === winner.revisionId)?.previousRevisionId).toBe(branch.currentRevisionId);
  });

  it.each(["resumeRevisions", "resumeBranchOperations"] as const)("rolls back all stores if %s fails after the Branch write", async table => {
    const { branch } = await create();
    const before = await persisted();
    vi.spyOn(db[table], "put").mockRejectedValueOnce(new Error("injected-storage-failure"));
    await expect(repo.editResumeBranchBasics({ branchId: branch.id, expectedRevision: branch.revision, operationId: "failed", basics: { name: "Must roll back" } })).rejects.toThrow("injected-storage-failure");
    expect(await persisted()).toEqual(before);
  });

  it("rolls back after every write including the receipt when the unit of work throws", async () => {
    const { branch } = await create();
    const before = await persisted();
    await expect(port.withBranchMutation(async unit => {
      await unit.saveBranch({ ...branch, name: "Rollback" });
      await unit.appendRevision({ ...before.revisions[0], id: "transient-revision" });
      await unit.saveOperation({ ...before.receipts[0], id: "transient-receipt", operationId: "transient-operation" });
      throw new Error("post-receipt-failure");
    })).rejects.toThrow("post-receipt-failure");
    expect(await persisted()).toEqual(before);
  });

  it("preserves unique operationId and rolls back an attempted duplicate", async () => {
    const { branch } = await create();
    const before = await persisted();
    await expect(port.withBranchMutation(async unit => {
      await unit.saveBranch({ ...branch, name: "Rollback" });
      await unit.saveOperation({ ...before.receipts[0], id: "different-primary-key" });
    })).rejects.toMatchObject({ name: "ConstraintError" });
    expect(await persisted()).toEqual(before);
  });

  it("isolates another General, another Profile and a Job Branch during a portable edit", async () => {
    const { branch } = await create();
    const other = await create("other-general");
    await repo.saveProfile({ ...demoCareerProfile, id: "other-profile" });
    const otherProfile = await repo.createGeneralResumeBranch({ profileId: "other-profile", operationId: "other-person-general", name: "Other", includeProfileFacts: false, includeProfileBasics: false });
    const job = await repo.createJobSpecificBranchFromProfile({ profileId: demoCareerProfile.id, jobId: demoJobDescriptions[0].id, operationId: "job", name: "Job", selectedCanonicalItemIds: branch.structuredContentItems!.map(item => item.data.id), requirementMatchIds: [] });
    const before = await persisted();
    await repo.editResumeBranchBasics({ branchId: branch.id, expectedRevision: branch.revision, operationId: "isolated-edit", basics: { name: "Only selected resume" } });
    for (const id of [other.branch.id, otherProfile.branch.id, job.branch.id]) expect(await db.resumeBranches.get(id)).toEqual(before.branches.find(b => b.id === id));
    expect(await db.profiles.toArray()).toEqual(before.profiles);
    expect(await db.jobDescriptions.toArray()).toEqual(before.jobs);
  });

  it("edits a real Job Branch through the same port without modifying its source or Job", async () => {
    const general = await create();
    const job = await repo.createJobSpecificBranchFromProfile({ profileId: demoCareerProfile.id, jobId: demoJobDescriptions[0].id, operationId: "job-edit-create", name: "Job", selectedCanonicalItemIds: general.branch.structuredContentItems!.map(item => item.data.id), requirementMatchIds: [] });
    const before = await persisted();
    const edited = await repo.editResumeBranchBasics({ branchId: job.branch.id, expectedRevision: job.branch.revision, operationId: "job-edit", basics: { name: "Job resume only" } });
    expect(await db.resumeBranches.get(general.branch.id)).toEqual(general.branch);
    expect(await db.jobDescriptions.toArray()).toEqual(before.jobs);
    expect(await db.profiles.toArray()).toEqual(before.profiles);
    expect(await db.resumeRevisions.get(edited.revision!.id)).toMatchObject({ branchId: job.branch.id, previousRevisionId: job.branch.currentRevisionId });
    await db.jobDescriptions.delete(demoJobDescriptions[0].id);
    const missingBefore = await persisted();
    await expect(repo.editResumeBranchBasics({ branchId: job.branch.id, expectedRevision: edited.branch.revision, operationId: "job-missing", basics: { name: "Blocked" } })).rejects.toThrow("branch_source_missing");
    expect(await persisted()).toEqual(missingBefore);
  });

  it("retains missing source validation and leaves no partial mutation", async () => {
    const { branch } = await create();
    await db.profiles.delete(branch.profileId);
    const before = await persisted();
    await expect(repo.editResumeBranchBasics({ branchId: branch.id, expectedRevision: branch.revision, operationId: "missing", basics: { name: "Forbidden" } })).rejects.toThrow("branch_source_missing");
    expect(await persisted()).toEqual(before);
  });
});
