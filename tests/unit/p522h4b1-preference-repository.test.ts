import { afterEach, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });

async function fixture() {
  db = new CareerAdaptDb(`preference-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const { profile } = await repository.createPerson("测试");
  const saved = await repository.saveProfile({ ...profile, preference: {
    targetRoles: ["供应链助理", "跨境电商运营"], targetCities: ["郑州", "上海"], industries: ["银行"]
  }, version: profile.version + 1 });
  return { repository, profile: saved };
}

it("atomically updates the same profile revision with canonical deduplication and removals", async () => {
  const { repository, profile } = await fixture();
  const receipt = await repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "preference-update",
    patch: { additions: { targetRoles: ["供应链助理", "新能源运营"], targetCities: [" 郑州 "], industries: ["新能源"] },
      removals: { targetRoles: ["跨境电商运营"], targetCities: ["上海"], industries: ["银行"] } } });
  expect(receipt).toMatchObject({ profileId: profile.id, previousRevision: profile.version, currentRevision: profile.version + 1, persistenceVerified: true,
    preference: { targetRoles: ["供应链助理", "新能源运营"], targetCities: ["郑州"], industries: ["新能源"] } });
  expect(await repository.getProfile(profile.id)).toMatchObject({ profileVersionNumber: profile.profileVersionNumber,
    preference: receipt.preference, isCurrent: true, version: profile.version + 1 });
  expect(await repository.getActiveCareerContext()).toMatchObject({ profileId: profile.id, profileRevision: profile.version + 1 });
  expect(await repository.getCareerPerson(profile.personId!)).toMatchObject({ currentProfileId: profile.id });
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
});

it("rejects stale revision and old current profile without changing either version or context", async () => {
  const { repository, profile } = await fixture();
  const patch = { additions: { targetRoles: ["运营"] } };
  await expect(repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version - 1, operationId: "stale", patch })).rejects.toThrow("stale_profile_revision");
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
  expect(await repository.getActiveCareerContext()).toMatchObject({ profileId: profile.id });
  await repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "first", patch });
  await expect(repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "second", patch })).rejects.toThrow("stale_profile_revision");
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
});

it("rolls back profile and both current pointers when a late transactional write fails", async () => {
  const { repository, profile } = await fixture();
  const put = db.appMeta.put.bind(db.appMeta);
  vi.spyOn(db.appMeta, "put").mockImplementation((row, key) => {
    if (row.key.startsWith("careerPreferenceOperation:v1:")) throw new Error("injected_write_failure");
    return put(row, key);
  });
  await expect(repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "rollback",
    patch: { additions: { targetRoles: ["运营"] } } })).rejects.toThrow("injected_write_failure");
  vi.restoreAllMocks();
  expect(await repository.getProfile(profile.id)).toMatchObject({ isCurrent: true, preference: profile.preference });
  expect(await repository.getCareerPerson(profile.personId!)).toMatchObject({ currentProfileId: profile.id });
  expect(await repository.getActiveCareerContext()).toMatchObject({ profileId: profile.id });
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
});

it("rejects conflicting changes and unrecognized fields before writing", async () => {
  const { repository, profile } = await fixture();
  await expect(repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "conflicting-patch",
    patch: { additions: { targetCities: ["上海"] }, removals: { targetCities: [" 上海 "] } } })).rejects.toThrow("preference_patch_conflict");
  await expect(repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "invalid-patch",
    patch: { additions: { targetRoles: ["运营"], salary: ["高薪"] } } as never })).rejects.toThrow();
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
});

it("allows only one concurrent confirmation for the same source revision", async () => {
  const { repository, profile } = await fixture();
  const outcomes = await Promise.allSettled(["运营", "产品"].map(role => repository.updateCareerPreferences({
    profileId: profile.id, expectedProfileRevision: profile.version, operationId: `concurrent-${role}`, patch: { additions: { targetRoles: [role] } }
  })));
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
  expect((await repository.getProfilesForPerson(profile.personId!))).toHaveLength(1);
});

it("keeps the existing resume visible and unchanged after a preference revision", async () => {
  const { repository, profile } = await fixture();
  const resume = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "preference-resume-boundary",
    name: "通用简历", includeProfileFacts: true, includeProfileBasics: true });
  const before = await repository.getResumeBranch(resume.branch.id);
  const beforeRevision = await repository.getResumeRevision(resume.revision!.id);
  const branchWrites = vi.spyOn(db.resumeBranches, "put");
  const revisionWrites = vi.spyOn(db.resumeRevisions, "put");
  const receipt = await repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version, operationId: "resume-continuity",
    patch: { additions: { targetRoles: ["运营"] } } });
  expect((await repository.getAvailableResumeBranch(resume.branch.id))?.profileId).toBe(profile.id);
  expect(receipt.profileId).toBe(profile.id);
  expect((await repository.listAvailableResumeBranches(profile.id)).map(branch => branch.id)).toContain(resume.branch.id);
  expect(await repository.getResumeBranch(resume.branch.id)).toEqual(before);
  expect(await repository.getResumeRevision(resume.revision!.id)).toEqual(beforeRevision);
  expect(branchWrites).not.toHaveBeenCalled();
  expect(revisionWrites).not.toHaveBeenCalled();
});

it("deduplicates an operation and refuses a reused operation id with a different patch", async () => {
  const { repository, profile } = await fixture();
  const input = { profileId: profile.id, expectedProfileRevision: profile.version, operationId: "same-operation",
    patch: { additions: { targetRoles: ["运营"] } } };
  const first = await repository.updateCareerPreferences(input);
  const replay = await repository.updateCareerPreferences(input);
  expect(replay).toMatchObject({ profileId: profile.id, currentRevision: first.currentRevision, idempotent: true });
  expect((await repository.getProfile(profile.id))?.version).toBe(profile.version + 1);
  await expect(repository.updateCareerPreferences({ ...input, patch: { additions: { targetRoles: ["产品"] } } })).rejects.toThrow("preference_operation_conflict");
});

it("does not create a revision for an unchanged patch", async () => {
  const { repository, profile } = await fixture();
  const result = await repository.updateCareerPreferences({ profileId: profile.id, expectedProfileRevision: profile.version,
    operationId: "unchanged", patch: { additions: { targetCities: [" 郑州 "] } } });
  expect(result).toMatchObject({ profileId: profile.id, previousRevision: profile.version, currentRevision: profile.version, changed: false });
  expect(await repository.getProfile(profile.id)).toEqual(profile);
});
