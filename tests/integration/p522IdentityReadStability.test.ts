import { afterEach, expect, it, vi } from "vitest";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";

let db: CareerAdaptDb;
afterEach(async () => { vi.restoreAllMocks(); db?.close(); if (db) await db.delete(); });

it("keeps identity metadata unchanged across the reads used by Workspace subscriptions", async () => {
  db = new CareerAdaptDb(`p522-read-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  const profile = await repository.saveProfile(demoCareerProfile);
  await repository.setActiveProfileId(profile.id);
  await repository.ensureCareerIdentityMigration();
  const before = { profiles: await db.profiles.toArray(), meta: await db.appMeta.toArray() };
  const write = vi.spyOn(db.appMeta, "put");
  for (let i = 0; i < 3; i++) {
    await repository.getProfile(profile.id);
    await repository.listCareerPersons();
    await repository.listProfiles();
    await repository.getActiveCareerContext();
  }
  expect(write).not.toHaveBeenCalled();
  expect({ profiles: await db.profiles.toArray(), meta: await db.appMeta.toArray() }).toEqual(before);
});

it("still repairs a missing legacy identity and index once, then becomes read-only", async () => {
  db = new CareerAdaptDb(`p522-legacy-${crypto.randomUUID()}`);
  const repository = new WorkspaceRepository(db);
  // A legacy storage fixture is deliberately missing identity metadata.
  await db.profiles.put(demoCareerProfile);
  const first = await repository.ensureCareerIdentityMigration();
  expect(first).toHaveLength(1);
  expect(first[0].currentProfileId).toBe(demoCareerProfile.id);
  const before = await db.appMeta.toArray();
  const write = vi.spyOn(db.appMeta, "put");
  expect(await repository.ensureCareerIdentityMigration()).toEqual(first);
  expect(write).not.toHaveBeenCalled();
  expect(await db.appMeta.toArray()).toEqual(before);
});
