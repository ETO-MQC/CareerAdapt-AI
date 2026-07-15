import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { ResumeBranchSchema } from "@/domain/schemas";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { assessTemplateCompatibility, resumeTemplates } from "@/components/resume/templates/templateRegistry";

describe("resume render model v2", () => {
  it("preserves canonical sections while retaining current template projection", () => {
    const now = new Date().toISOString();
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const experience = profile.experiences[0]!;
    const fact = experience.facts[0]!;
    const branch = migrateResumeBranchToV2(ResumeBranchSchema.parse({
      id: "render-v2", createdAt: now, updatedAt: now, branchPurpose: "general", profileId: profile.id, name: "通用简历",
      sourceProfileSnapshotId: "profile-snapshot-1",
      sourceProfileVersion: profile.version, sourceDraftRevision: 0, matcherVersion: "test", sourceMatchSetHash: "12345678", revision: 0,
      currentRevisionId: "rev-1", lifecycleStatus: "active", migrationStatus: "verified",
      syncStatusCache: { status: "in_sync", sourceProfileVersion: profile.version, currentProfileVersion: profile.version, invalidFactRefs: [], checkedAt: now, message: "ok" },
      contentItems: [{ id: "edu-1", itemType: "experience", source: "legacy", sourceSectionId: "education", text: fact.statement, originalText: fact.statement, order: 0, visible: true, factRefs: [{ type: "experience_fact", experienceId: experience.id, factId: fact.id }], guardMode: "rule_verified", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] }]
    }));
    const model = mapBranchToResumeRenderModel({ branch, profile });
    expect(model.schemaVersion).toBe("resume-render-v2");
    if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2");
    expect(model.structuredSections[0]).toMatchObject({ sectionId: "education", sectionType: "education", items: [{ itemId: "edu-1", plainText: fact.statement }] });
    expect(model.sections.flatMap((section) => section.blocks).map((block) => block.text)).toEqual([fact.statement]);
    for (const template of resumeTemplates) expect(assessTemplateCompatibility(model, template)).toEqual([]);
  });
});
