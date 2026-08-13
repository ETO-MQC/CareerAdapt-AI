import { afterEach, describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";
import { compileResumeComposition, createResumeCompositionCheckpoint } from "@/domain/resumeComposition";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.5c.1 resume composition commit quality gate", () => {
  it("does not persist a branch when AI Writer fell back", async () => {
    db = new CareerAdaptDb(`CareerAdaptP45c1CommitGate-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    await repository.saveProfile(profile);
    await repository.setActiveProfileId(profile.id);
    const composition = compileResumeComposition({
      profile,
      mode: "general",
      targetDirection: "互联网技术 / AI 应用方向秋招"
    });
    expect(composition.writingExecution?.mode).toBe("deterministic_fallback");
    const checkpoint = await repository.saveResumeCompositionCheckpoint(
      createResumeCompositionCheckpoint({ composition })
    );
    const service = new BrowserAgentToolService(repository);

    await expect(service.composeResume({
      profileId: profile.id,
      expectedProfileRevision: profile.version,
      mode: "general",
      checkpointId: checkpoint.checkpointId
    }, "p45c1-fallback-must-not-commit")).rejects.toMatchObject({
      code: "resume_composition_ai_writer_required"
    });
    expect(await repository.listResumeBranches()).toHaveLength(0);
  });
});
