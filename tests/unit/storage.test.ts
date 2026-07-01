import { afterEach, describe, expect, it } from "vitest";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) {
    return;
  }

  db.close();
  await db.delete();
  db = undefined;
});

describe("WorkspaceRepository", () => {
  it("writes, reads, updates, and exports the demo workspace", async () => {
    db = new CareerAdaptDb(`CareerAdaptTestDb-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);

    await repository.seedDemoWorkspace();

    const profile = await repository.getProfile(demoCareerProfile.id);
    const jobs = await repository.listJobDescriptions();

    expect(profile?.name).toBe("陈同学");
    expect(jobs).toHaveLength(demoJobDescriptions.length);

    await repository.saveProfile({
      ...demoCareerProfile,
      version: 2,
      updatedAt: "2026-07-01T10:30:00.000Z"
    });

    const updated = await repository.getProfile(demoCareerProfile.id);
    expect(updated?.version).toBe(2);

    const exported = await repository.exportWorkspaceJson();
    expect(exported.schemaVersion).toBe("stage-a-v1");
    expect(exported.profiles).toHaveLength(1);
    expect(exported.jobDescriptions).toHaveLength(2);
    expect(exported.appMeta.some((meta) => meta.key === "demoSeededAt")).toBe(true);
  });
});
