import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { CareerProfileSchema, ResumeBranchSchema } from "@/domain/schemas";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { assessTemplateCompatibility, resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveResumeTargetRole } from "@/domain/branch/targetRole";

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
    expect(model.structuredSections[0]).toMatchObject({
      sectionId: "summary",
      sectionType: "summary",
      items: [{ presentation: { sectionType: "summary" } }]
    });
    expect(model.structuredSections.find((section) => section.sectionType === "education")).toMatchObject({
      sectionId: "education",
      sectionType: "education",
      items: [{ itemId: "edu-1", plainText: `说明：${fact.statement}`, presentation: { id: "edu-1", sectionType: "education" } }]
    });
    expect(model.sections.flatMap((section) => section.blocks).map((block) => block.text)).toEqual([fact.statement]);
    for (const template of resumeTemplates) {
      expect(assessTemplateCompatibility(model, template)).toEqual([]);
      const markup = renderToStaticMarkup(template.render(model));
      expect(markup).not.toContain('data-render-section="experience"');
      expect(markup).not.toContain(branch.name);
      expect(markup).not.toContain("通用简历 /");
      expect(markup).not.toMatch(/<h2[^>]*>经历<\/h2>/);
      expect(markup).toContain('data-render-section="education"');
      expect(markup.match(/data-source-item-id="edu-1"/g)).toHaveLength(1);
    }
  });

  it("separates branch names from target roles and preserves explicit clearing", () => {
    const now = new Date().toISOString();
    const migratedProfile = migrateCareerProfileToV2(demoCareerProfile);
    const profile = CareerProfileSchema.parse({
      ...migratedProfile,
      structuredBasics: { ...migratedProfile.structuredBasics, targetRole: "开发工程师", headline: "技术人才" }
    });
    const base = ResumeBranchSchema.parse({
      id: "target-role-base", createdAt: now, updatedAt: now, branchPurpose: "general", profileId: profile.id,
      name: "校招技术版A", sourceProfileSnapshotId: "profile-snapshot-target-role", sourceProfileVersion: profile.version,
      sourceDraftRevision: 0, matcherVersion: "test", sourceMatchSetHash: "12345678", revision: 0,
      currentRevisionId: "rev-target-role", lifecycleStatus: "active", migrationStatus: "verified",
      syncStatusCache: { status: "in_sync", sourceProfileVersion: profile.version, currentProfileVersion: profile.version, invalidFactRefs: [], checkedAt: now, message: "ok" },
      resumeBasics: { name: profile.basics.name, targetRole: "", email: "", phone: "", location: "", summary: "", links: [] },
      contentItems: [{ id: "empty-target-role", itemType: "structural", source: "system_structural", sourceSectionId: "empty", text: "empty-resume-placeholder", originalText: "empty-resume-placeholder", order: 0, visible: false, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] }]
    });

    expect(resolveResumeTargetRole({ branch: base, profile })).toBeUndefined();
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, resumeBasics: undefined }), profile })).toBe("开发工程师");
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, name: "开发工程师", resumeBasics: undefined }), profile })).toBe("开发工程师");
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, resumeBasics: { ...base.resumeBasics, targetRole: "测试工程师" } }), profile })).toBe("测试工程师");
  });
});
