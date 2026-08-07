import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { AgentExecutionCoordinator } from "@/agent/runtime/AgentExecutionCoordinator";
import { AgentSessionSchema } from "@/agent/contracts/agentSession";
import { refineAgentTaskTitle } from "@/agent/services/AgentTaskTitleService";
import { buildQuickActionContextSnapshot } from "@/agent/workflows/QuickActionContextSnapshot";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

describe("P4.3i career identity and execution boundaries", () => {
  it("migrates same-name legacy profiles into distinct people and creates V2 without changing the internal revision meaning", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43iIdentity-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const base = migrateCareerProfileToV2(demoCareerProfile);
    const first = { ...base, id: "profile-person-a", personId: undefined, profileVersionNumber: undefined, isCurrent: undefined, versionCreatedReason: undefined, name: "张三", basics: { ...base.basics, name: "张三" }, structuredBasics: { ...base.structuredBasics, name: "张三" } };
    const second = { ...base, id: "profile-person-b", personId: undefined, profileVersionNumber: undefined, isCurrent: undefined, versionCreatedReason: undefined, name: "张三", basics: { ...base.basics, name: "张三" }, structuredBasics: { ...base.structuredBasics, name: "张三" } };
    await db.profiles.bulkPut([first, second]);

    const people = await repository.listCareerPersons();
    expect(people).toHaveLength(2);
    expect(new Set(people.map((person) => person.id)).size).toBe(2);
    const profiles = await repository.listProfiles();
    expect(profiles.map((profile) => profile.profileVersionNumber)).toEqual([1, 1]);
    expect(profiles.every((profile) => profile.isCurrent === true)).toBe(true);
    expect(profiles.every((profile) => profile.version === base.version)).toBe(true);

    await repository.setActiveCareerContext({ personId: profiles[0].personId!, profileId: profiles[0].id });
    const next = await repository.createProfileVersion({ profileId: profiles[0].id });
    expect(next.profileVersionNumber).toBe(2);
    expect(next.version).toBe(1);
    expect((await repository.getActiveCareerContext())?.profileId).toBe(next.id);
  });

  it("builds a typed quick-action snapshot from repository reads and keeps titles bounded", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43iSnapshot-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    await repository.seedDemoWorkspace();
    const snapshot = await buildQuickActionContextSnapshot(repository);
    expect(snapshot.activePerson).toBeDefined();
    expect(snapshot.activeProfile).toBeDefined();
    expect(snapshot.profileItemCount).toBeGreaterThan(0);
    const title = refineAgentTaskTitle("analyze_job_fit", snapshot);
    expect(Array.from(title).length).toBeLessThanOrEqual(12);
    expect(title).not.toMatch(/[，。！？!?、；;：:]/u);
  });

  it("keeps quick-action resume metadata pinned to the session Person", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43iResumeIsolation-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const personA = await repository.createPerson("隔离人物A");
    const branchA = await repository.createGeneralResumeBranch({
      profileId: personA.profile.id,
      operationId: "p43j-resume-a",
      name: "人物A简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const personB = await repository.createPerson("隔离人物B");
    const branchB = await repository.createGeneralResumeBranch({
      profileId: personB.profile.id,
      operationId: "p43j-resume-b",
      name: "人物B简历",
      includeProfileFacts: false,
      includeProfileBasics: false
    });
    const now = new Date().toISOString();
    const sessionA = AgentSessionSchema.parse({
      id: "session-person-a",
      title: "人物 A 任务",
      messages: [],
      workflowState: { workflowId: "conversation", step: "idle", status: "idle" },
      artifactRefs: [],
      personId: personA.person.id,
      activeProfileId: personA.profile.id,
      createdAt: now,
      updatedAt: now
    });

    const pinned = await buildQuickActionContextSnapshot(repository, sessionA);
    expect(pinned.targetPersonId).toBe(personA.person.id);
    expect(pinned.targetProfileId).toBe(personA.profile.id);
    expect(pinned.activeProfileResumeSummaries.map((resume) => resume.id)).toEqual([branchA.branch.id]);
    expect(pinned.samePersonOtherVersionResumeSummaries).toEqual([]);
    expect(pinned.excludedOtherPersonResumeCount).toBe(1);
    const serialized = JSON.stringify(pinned);
    expect(serialized).not.toContain(branchB.branch.id);
    expect(serialized).not.toContain(branchB.branch.name);

    const globalB = await buildQuickActionContextSnapshot(repository);
    expect(globalB.targetPersonId).toBe(personB.person.id);
    expect(globalB.activeProfileResumeSummaries.map((resume) => resume.id)).toEqual([branchB.branch.id]);
    expect(globalB.excludedOtherPersonResumeCount).toBe(1);
  });

  it("does not let first-run demo seeding replace an already selected career context", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43iSeed-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const created = await repository.createPerson("先选人物");
    await repository.ensureDemoWorkspace();

    expect((await repository.getActiveCareerContext())?.personId).toBe(created.person.id);
    const active = await repository.getProfile(created.profile.id);
    expect(active).toBeDefined();
    await repository.saveProfile({ ...active!, version: active!.version + 1, updatedAt: new Date().toISOString() });
    expect((await repository.getActiveCareerContext())?.profileRevision).toBe(active!.version + 1);
  });

  it("keeps execution state independent per session", () => {
    const coordinator = new AgentExecutionCoordinator();
    const first = coordinator.begin({ sessionId: "session-a", activeTurnId: "turn-a" });
    const second = coordinator.begin({ sessionId: "session-b", activeTurnId: "turn-b" });
    coordinator.markStalled("session-a", true);
    coordinator.interrupt("session-b");

    expect(coordinator.isRunning("session-a")).toBe(true);
    expect(coordinator.get("session-a")?.stalled).toBe(true);
    expect(second.controller.signal.aborted).toBe(true);
    expect(first.controller.signal.aborted).toBe(false);
  });

  it("enforces safe Profile Version lifecycle transitions with idempotent receipts", async () => {
    db = new CareerAdaptDb(`CareerAdaptP43iLifecycle-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const created = await repository.createPerson("生命周期人物");
    const first = created.profile;
    const second = await repository.createProfileVersion({ profileId: first.id });

    const archivedFirst = await repository.archiveProfileVersion({
      profileId: first.id,
      expectedRevision: first.version,
      operationId: "p43j-archive-first"
    });
    expect(archivedFirst.profile.archivedAt).toBeTruthy();
    const repeatedArchive = await repository.archiveProfileVersion({
      profileId: first.id,
      expectedRevision: first.version,
      operationId: "p43j-archive-first"
    });
    expect(repeatedArchive.idempotent).toBe(true);

    const restoredFirst = await repository.restoreArchivedProfileVersion({
      profileId: first.id,
      expectedRevision: archivedFirst.profile.version,
      operationId: "p43j-restore-first"
    });
    const trashedFirst = await repository.trashProfileVersion({
      profileId: first.id,
      expectedRevision: restoredFirst.profile.version,
      operationId: "p43j-trash-first"
    });
    expect(trashedFirst.profile.trashedAt).toBeTruthy();
    const restoredFromTrash = await repository.restoreProfileVersionFromTrash({
      profileId: first.id,
      expectedRevision: trashedFirst.profile.version,
      operationId: "p43j-restore-trash-first"
    });
    expect(restoredFromTrash.profile.trashedAt).toBeUndefined();

    await expect(repository.trashProfileVersion({
      profileId: second.id,
      expectedRevision: second.version,
      operationId: "p43j-trash-current"
    })).rejects.toThrow("career_profile_current_cannot_trash");

    const archivedSecond = await repository.archiveProfileVersion({
      profileId: second.id,
      expectedRevision: second.version,
      operationId: "p43j-archive-second"
    });
    const trashedSecond = await repository.trashProfileVersion({
      profileId: second.id,
      expectedRevision: archivedSecond.profile.version,
      operationId: "p43j-trash-second"
    });
    const deletedSecond = await repository.permanentlyDeleteProfileVersion({
      profileId: second.id,
      expectedRevision: trashedSecond.profile.version,
      operationId: "p43j-delete-second"
    });
    expect(deletedSecond.deleted).toBe(true);
    await expect(repository.getProfile(second.id)).resolves.toBeUndefined();
  });
});
