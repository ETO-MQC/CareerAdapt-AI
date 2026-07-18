import { afterEach, describe, expect, it } from "vitest";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { fullAiTemplateFixture } from "../fixtures/resume-v2/fullAiTemplate";
import type { ResumeItemV2 } from "@/domain/schemas";

let db: CareerAdaptDb | undefined;
afterEach(async () => { if (db) { db.close(); await db.delete(); db = undefined; } });

const expected = new Map<string, number>([["summary", 1], ["education", 1], ["work", 2], ["internship", 1], ["project", 4], ["research", 1], ["campus", 1], ["volunteer", 1], ["awards", 2], ["skills", 6], ["certificates", 1], ["languages", 1], ["publications", 1], ["patents", 1], ["portfolio", 1], ["other", 1], ["custom", 1]]);

describe("P3.6g0.2 canonical import persistence", () => {
  it("keeps review, Profile, Branch and Profile-copy counts equal", async () => {
    db = new CareerAdaptDb(`p36g02-counts-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const saved = await repository.saveImportedResumeDraft(draft("counts"), 0);
    const confirmed = await repository.confirmImportedResume({ importId: saved.importId, expectedDraftRevision: saved.revision, operationId: "confirm-counts", target: { mode: "new", profileName: "Counts", createGeneralResume: true } });
    const profile = (await repository.getProfile(confirmed.profileId))!;
    const branch = (await repository.getResumeBranch(confirmed.branchId!))!;
    assertCounts(saved.sections.flatMap((section) => section.items.map((item) => item.structuredItem!).filter(Boolean)));
    assertCounts(profile.structuredFacts!.map((entry) => entry.data));
    assertCounts(branch.structuredContentItems!.map((entry) => entry.data));
    expect(profile.experiences.filter((item) => item.type === "competition")).toHaveLength(2);
    expect(profile.skills.filter((item) => item.fact?.category === "language")).toHaveLength(1);
    const copied = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "copy-counts", name: "Copy", includeProfileFacts: true, includeProfileBasics: true });
    assertCounts(copied.branch.structuredContentItems!.map((entry) => entry.data));
  });

  it("adds 6 canonical skills with revisions and without changing Profile", async () => {
    db = new CareerAdaptDb(`p36g02-library-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const saved = await repository.saveImportedResumeDraft(draft("library"), 0);
    const confirmed = await repository.confirmImportedResume({ importId: saved.importId, expectedDraftRevision: saved.revision, operationId: "profile-only", target: { mode: "new", profileName: "Library", createGeneralResume: false } });
    const profile = (await repository.getProfile(confirmed.profileId))!;
    const created = await repository.createGeneralResumeBranch({ profileId: profile.id, operationId: "blank", name: "Blank", includeProfileFacts: false, includeProfileBasics: true });
    let branch = created.branch;
    const skills = profile.structuredFacts!.filter((entry) => entry.data.sectionType === "skills");
    for (const [index, skill] of skills.entries()) branch = (await repository.addResumeContentItemFromProfileReference({ branchId: branch.id, expectedRevision: branch.revision, operationId: `add-${index}`, section: "skills", reference: { type: "canonical", itemId: skill.data.id, sectionType: "skills" } })).branch;
    expect(skills).toHaveLength(6);
    expect(branch.revision).toBe(6);
    expect(branch.structuredContentItems!.filter((entry) => entry.data.sectionType === "skills")).toHaveLength(6);
    expect((await repository.getProfile(profile.id))!.version).toBe(profile.version);
  });
});

function draft(id: string) {
  const canonicalResume = { ...fullAiTemplateFixture, sections: fullAiTemplateFixture.sections.map((section) => ({ ...section, items: Array.from({ length: expected.get(section.sectionType) ?? 1 }, (_, index) => ({ ...section.items[0], id: `${section.sectionType}-${id}-${index}` })) as ResumeItemV2[] })) };
  return createImportedResumeDraftFromStructuredJson({ importId: `p36g02-${id}`, source: { fileName: "canonical.json", mimeType: "application/json", fileHash: `p36g02-${id}-hash`, pageCount: 1, extractedAt: "2026-07-18T08:00:00.000Z" }, structuredDraft: { schemaVersion: "structured-resume-draft-v1", basics: {}, sections: [] }, canonicalResume, now: "2026-07-18T08:00:00.000Z" });
}

function assertCounts(items: ResumeItemV2[]) {
  for (const [sectionType, count] of expected) expect(items.filter((item) => item.sectionType === sectionType), sectionType).toHaveLength(count);
}
