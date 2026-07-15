import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { BranchContentItemSchema, ResumeBranchSchema } from "@/domain/schemas";
import { migrateCareerProfileToV2, migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";

describe("progressive resume v2 migration", () => {
  it("is idempotent for v1 profiles and preserves fact ids", () => {
    const once = migrateCareerProfileToV2(demoCareerProfile);
    const twice = migrateCareerProfileToV2(once);
    expect(twice).toEqual(once);
    expect(once.structuredFacts.flatMap((entry) => entry.factIds)).toEqual(expect.arrayContaining(demoCareerProfile.experiences.flatMap((experience) => experience.facts.map((fact) => fact.id))));
  });

  it("preserves unsplittable branch text byte-for-byte and is idempotent", () => {
    const now = new Date().toISOString();
    const content = BranchContentItemSchema.parse({ id: "item-1", itemType: "experience", source: "legacy", sourceSectionId: "experience", text: "甲公司 / 工程师\n完成 20% 提升", originalText: "甲公司 / 工程师\n完成 20% 提升", order: 0, visible: true, factRefs: [{ type: "experience_fact", experienceId: "e1", factId: "f1" }], guardMode: "rule_verified", guardStatus: "pass", guardRiskLevel: "low", guardFindings: [] });
    const branch = ResumeBranchSchema.parse({ id: "b1", createdAt: now, updatedAt: now, branchPurpose: "general", profileId: "p1", name: "通用简历", sourceProfileVersion: 1, sourceDraftRevision: 0, matcherVersion: "legacy", sourceMatchSetHash: "12345678", revision: 0, lifecycleStatus: "active", migrationStatus: "legacy_unverified", syncStatusCache: { status: "in_sync", sourceProfileVersion: 1, currentProfileVersion: 1, invalidFactRefs: [], checkedAt: now, message: "ok" }, contentItems: [content] });
    const once = migrateResumeBranchToV2(branch);
    expect(once.structuredContentItems[0]?.legacyTextProjection).toBe(content.text);
    expect(migrateResumeBranchToV2(once)).toEqual(once);
    const edited = ResumeBranchSchema.parse({
      ...once,
      contentItems: once.contentItems.map((item) => item.id === "item-1" ? { ...item, text: "用户修改后的正文", originalText: item.originalText } : item)
    });
    expect(migrateResumeBranchToV2(edited).structuredContentItems[0]?.legacyTextProjection).toBe("用户修改后的正文");
  });
});
