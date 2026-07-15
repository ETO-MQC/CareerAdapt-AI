import { afterEach, describe, expect, it } from "vitest";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { demoCareerProfile } from "@/data/demoProfile";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  if (!db) return;
  db.close();
  await db.delete();
  db = undefined;
});

function draft(importId: string) {
  const now = "2026-07-15T08:00:00.000Z";
  return createImportedResumeDraftFromStructuredJson({
    importId,
    source: { fileName: "sample.json", mimeType: "application/json", fileHash: `hash-${importId}-1234567890`, pageCount: 1, extractedAt: now },
    structuredDraft: {
      schemaVersion: "structured-resume-draft-v1",
      basics: { name: "导入人物" },
      sections: [{ title: "项目经历", sectionType: "experience", category: "project", items: ["完成可核验的数据项目。"] }]
    },
    sourceKind: "standard_json",
    now
  });
}

describe("resume import target semantics", () => {
  it("does not create an empty profile when a new-person import is cancelled", async () => {
    db = new CareerAdaptDb(`p36a-cancel-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const saved = await repository.saveImportedResumeDraft(draft("cancel"), 0);
    await repository.cancelImportedResumeDraft(saved.importId, saved.revision);
    expect(await repository.listProfiles()).toHaveLength(0);
    expect((await repository.getImportedResumeDraft(saved.importId))?.status).toBe("cancelled");
  });

  it("can create a new profile without creating a general resume", async () => {
    db = new CareerAdaptDb(`p36a-profile-only-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const saved = await repository.saveImportedResumeDraft(draft("profile-only"), 0);
    const result = await repository.confirmImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      operationId: "profile-only-operation",
      target: { mode: "new", profileName: "新人物", createGeneralResume: false }
    });
    expect(result.branchId).toBeUndefined();
    expect((await repository.getProfile(result.profileId))?.name).toBe("新人物");
    expect(await repository.listResumeBranches(result.profileId)).toHaveLength(0);
  });

  it("updates the explicitly selected existing profile instead of the first profile", async () => {
    db = new CareerAdaptDb(`p36a-existing-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const first = { ...demoCareerProfile, id: "profile-first", name: "第一人物", basics: { ...demoCareerProfile.basics, name: "第一人物" } };
    const second = { ...demoCareerProfile, id: "profile-second", name: "第二人物", basics: { ...demoCareerProfile.basics, name: "第二人物" } };
    await repository.saveProfile(first);
    await repository.saveProfile(second);
    const saved = await repository.saveImportedResumeDraft(draft("existing-target"), 0);
    const result = await repository.confirmImportedResume({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      operationId: "existing-target-operation",
      target: { mode: "existing", profileId: second.id },
      mergeDecisions: [{ target: "name", importedValue: "导入人物", action: "keep_existing" }]
    });
    expect(result.profileId).toBe(second.id);
    expect((await repository.getProfile(first.id))?.version).toBe(first.version);
    expect((await repository.getProfile(second.id))?.version).toBe(second.version + 1);
  });
});
