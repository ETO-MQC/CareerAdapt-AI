import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { CareerProfileSchema, ResumeBranchSchema, ResumePresentationConfigSchema } from "@/domain/schemas";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { assessTemplateCompatibility, resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveResumeTargetRole } from "@/domain/branch/targetRole";
import { stableHashText } from "@/services/security/text";

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

  it("does not resurrect a basics summary when an explicit summary item is hidden", () => {
    const now = new Date().toISOString();
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const text = "当前简历中的独立自我评价";
    const branch = migrateResumeBranchToV2(ResumeBranchSchema.parse({
      id: "render-summary-visibility", createdAt: now, updatedAt: now, branchPurpose: "general", profileId: profile.id,
      name: "摘要可见性测试", sourceProfileSnapshotId: "profile-snapshot-summary-visibility", sourceProfileVersion: profile.version,
      sourceDraftRevision: 0, matcherVersion: "test", sourceMatchSetHash: "12345678", revision: 0,
      currentRevisionId: "rev-summary-visibility", lifecycleStatus: "active", migrationStatus: "verified",
      syncStatusCache: { status: "in_sync", sourceProfileVersion: profile.version, currentProfileVersion: profile.version, invalidFactRefs: [], checkedAt: now, message: "ok" },
      resumeBasics: { name: profile.basics.name, email: "", phone: "", location: "", summary: "旧的基本信息摘要", links: [] },
      contentItems: [{
        id: "summary-visibility-1", itemType: "summary", source: "user_manual", sourceSectionId: "summary", text,
        originalText: text, order: 0, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [],
        guardMode: "not_fact", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [],
        userConfirmation: { scope: "resume_only", confirmedTextHash: stableHashText(text), confirmedAt: now }
      }]
    }));
    const presentationConfig = ResumePresentationConfigSchema.parse({
      schemaVersion: "resume-presentation-v1",
      branchId: branch.id,
      templateId: "classic-technical",
      contentRevision: { branchRevision: branch.revision, currentRevisionId: branch.currentRevisionId! },
      hiddenItemIds: ["summary-visibility-1"],
      presentationRevision: 1,
      updatedAt: now
    });

    const model = mapBranchToResumeRenderModel({ branch, profile, presentationConfig });
    if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 render model");
    expect(model.structuredSections.some((section) => section.sectionType === "summary")).toBe(false);
  });

  it("uses the saved legacy summary text when its structured projection is stale", () => {
    const now = new Date().toISOString();
    const profile = migrateCareerProfileToV2(demoCareerProfile);
    const educationExperience = profile.experiences[0]!;
    const educationFact = educationExperience.facts[0]!;
    const educationFactRef = { type: "experience_fact" as const, experienceId: educationExperience.id, factId: educationFact.id };
    const savedText = "保存后的自我评价内容";
    const confirmation = { scope: "resume_only" as const, confirmedTextHash: stableHashText(savedText), confirmedAt: now };
    const branch = ResumeBranchSchema.parse({
      schemaVersion: "resume-branch-v2",
      id: "render-summary-stale-projection",
      createdAt: now,
      updatedAt: now,
      branchPurpose: "general",
      profileId: profile.id,
      name: "结构化摘要映射测试",
      sourceProfileSnapshotId: "profile-snapshot-summary-stale-projection",
      sourceProfileVersion: profile.version,
      sourceDraftRevision: 0,
      matcherVersion: "test",
      sourceMatchSetHash: "12345678",
      revision: 0,
      currentRevisionId: "rev-summary-stale-projection",
      lifecycleStatus: "active",
      migrationStatus: "verified",
      syncStatusCache: { status: "in_sync", sourceProfileVersion: profile.version, currentProfileVersion: profile.version, invalidFactRefs: [], checkedAt: now, message: "ok" },
      resumeBasics: { name: profile.basics.name, email: "", phone: "", location: "", summary: "", links: [] },
      contentItems: [{
        id: "summary-stale-projection-1",
        itemType: "summary",
        source: "user_manual",
        sourceSectionId: "summary",
        text: savedText,
        originalText: savedText,
        order: 0,
        visible: true,
        requirementIds: [],
        sourceSuggestionIds: [],
        factRefs: [],
        guardMode: "not_fact",
        guardStatus: "pass",
        guardRiskLevel: "low",
        guardFindings: [],
        userConfirmation: confirmation
      }, {
        id: "education-before-summary-1",
        itemType: "experience",
        source: "legacy",
        sourceSectionId: "education",
        text: educationFact.statement,
        originalText: educationFact.statement,
        order: 1,
        visible: true,
        requirementIds: [],
        sourceSuggestionIds: [],
        factRefs: [educationFactRef],
        guardMode: "rule_verified",
        guardStatus: "pass",
        guardRiskLevel: "low",
        guardFindings: []
      }],
      structuredContentItems: [{
        id: "education-before-summary-1",
        schemaVersion: "resume-content-item-v2",
        data: { id: "education-before-summary-data", sectionType: "education", school: "测试大学", major: "计算机", degree: "本科", current: false, courses: [], honors: [], highlights: [], customFields: [] },
        factRefs: [educationFactRef],
        source: "legacy",
        order: 0,
        visible: true,
        guardMode: "rule_verified",
        guardStatus: "pass",
        guardFindings: [],
        legacyTextProjection: educationFact.statement,
        sourceBlockIds: [],
        sourceRanges: [],
        mappingTrace: []
      }, {
        id: "summary-stale-projection-1",
        schemaVersion: "resume-content-item-v2",
        data: { id: "summary-stale-data", sectionType: "summary", text: "旧的结构化摘要", customFields: [] },
        factRefs: [],
        source: "user_manual",
        order: 0,
        visible: true,
        guardMode: "not_fact",
        guardStatus: "pass",
        guardFindings: [],
        userConfirmation: confirmation,
        legacyTextProjection: savedText,
        sourceBlockIds: [],
        sourceRanges: [],
        mappingTrace: []
      }]
    });

    const model = mapBranchToResumeRenderModel({ branch, profile });
    if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 render model");
    expect(model.structuredSections[0]?.sectionType).toBe("summary");
    expect(model.structuredSections.find((section) => section.sectionType === "summary")?.items[0]?.data).toMatchObject({
      sectionType: "summary",
      text: savedText
    });
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
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, resumeBasics: undefined }), profile })).toBeUndefined();
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, name: "开发工程师", resumeBasics: undefined }), profile })).toBeUndefined();
    expect(resolveResumeTargetRole({
      branch: ResumeBranchSchema.parse({ ...base, resumeBasics: { ...base.resumeBasics, targetRole: "AI 应用方向" } }),
      profile
    })).toBe("AI 应用方向");
    expect(resolveResumeTargetRole({
      branch: ResumeBranchSchema.parse({ ...base, resumeBasics: { ...base.resumeBasics, targetRole: "技术人才" } }),
      profile
    })).toBeUndefined();
    expect(resolveResumeTargetRole({ branch: ResumeBranchSchema.parse({ ...base, resumeBasics: { ...base.resumeBasics, targetRole: "测试工程师" } }), profile })).toBe("测试工程师");
  });
});
