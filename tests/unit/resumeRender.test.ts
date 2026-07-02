import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { mapAdaptationDraftToResumeBranch } from "@/domain/branch/mapper";
import { createJobAdaptationDraft } from "@/domain/adaptation/draft";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches, resolveEffectiveMatch } from "@/domain/match/matcher";
import { mapBranchToResumeRenderModel } from "@/domain/resumeRender/mapper";
import { classifyOverflow } from "@/components/resume/useA4Overflow";
import type { AiSuggestion } from "@/domain/schemas";

const TEST_TIME = "2026-07-02T12:00:00.000Z";

describe("D2 resume render model", () => {
  it("maps only verified visible branch content into the render model", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-draft",
      now: TEST_TIME
    });
    const mapped = mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-branch",
      name: "D2 render branch",
      now: TEST_TIME
    });

    const hiddenItemId = mapped.branch.contentItems[0].id;
    const model = mapBranchToResumeRenderModel({
      branch: {
        ...mapped.branch,
        contentItems: mapped.branch.contentItems.map((item, index) => index === 0 ? { ...item, visible: false } : item)
      },
      profile: demoCareerProfile,
      job
    });

    expect(model.branchId).toBe(mapped.branch.id);
    expect(model.sections.flatMap((section) => section.blocks).some((block) => block.sourceItemId === hiddenItemId)).toBe(false);
    expect(model.safety.excludedItemIds).toContain(hiddenItemId);
    expect(model.sections.flatMap((section) => section.blocks).every((block) => block.factRefKeys.length > 0)).toBe(true);
  });

  it("rejects legacy_unverified branches before template rendering", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-legacy-draft",
      now: TEST_TIME
    });
    const mapped = mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-legacy-branch",
      name: "D2 legacy branch",
      now: TEST_TIME
    });

    expect(() => mapBranchToResumeRenderModel({
      branch: {
        ...mapped.branch,
        migrationStatus: "legacy_unverified",
        requirementMatchIds: [],
        contentItems: []
      },
      profile: demoCareerProfile,
      job
    })).toThrow("legacy_branch_cannot_render");
  });

  it("keeps rule_only_verified content in the model but exposes safety metadata only", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-rule-only-draft",
      now: TEST_TIME
    });
    const section = draft.sectionTexts[0];
    const match = matches.find((item) => resolveEffectiveMatch(item).evidenceRefs.length > 0)!;
    const evidenceRef = resolveEffectiveMatch(match).evidenceRefs[0];
    const guard = runRuleFactGuard({
      originalText: section.originalText,
      checkedText: section.originalText,
      usedEvidenceRefs: [evidenceRef],
      now: TEST_TIME
    });
    const suggestion: AiSuggestion = {
      id: "d2-rule-only-suggestion",
      draftId: draft.id,
      targetSectionId: section.sectionId,
      type: "rewrite",
      originalText: section.originalText,
      suggestedText: section.originalText,
      reason: "Keep rule-only content in preview.",
      requirementIds: [match.requirementId],
      usedEvidenceRefs: [evidenceRef],
      guardResult: { ...guard, status: "ai_failed_rule_kept" },
      riskLevel: "low",
      status: "accepted",
      promptVersion: "resume-tailor.v1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };
    const mapped = mapAdaptationDraftToResumeBranch({
      draft,
      suggestions: [suggestion],
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "d2-render-rule-only-branch",
      name: "D2 rule only branch",
      now: TEST_TIME
    });

    const model = mapBranchToResumeRenderModel({ branch: mapped.branch, profile: demoCareerProfile, job });
    const blocks = model.sections.flatMap((item) => item.blocks);

    expect(model.safety.ruleOnlyItemIds).toContain(mapped.branch.contentItems[0].id);
    expect(blocks.some((block) => block.guardMode === "rule_only_verified")).toBe(true);
  });
});

describe("D2 overflow classification", () => {
  it("classifies fits, near_limit, and overflow from real container heights", () => {
    expect(classifyOverflow({ scrollHeight: 900, clientHeight: 1000 }).status).toBe("fits");
    expect(classifyOverflow({ scrollHeight: 970, clientHeight: 1000 }).status).toBe("near_limit");
    expect(classifyOverflow({ scrollHeight: 1004, clientHeight: 1000 }).status).toBe("overflow");
  });
});
