import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { createJobAdaptationDraft } from "@/domain/adaptation/draft";
import { mergeAiFactGuardReview, runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createRuleRequirementMatches } from "@/domain/match/matcher";

const TEST_TIME = "2026-07-02T12:00:00.000Z";

describe("stage C2 adaptation draft and fact guard", () => {
  it("creates JobAdaptationDraft only from non-stale C1 matches", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const draft = createJobAdaptationDraft({
      profile: demoCareerProfile,
      job,
      matches,
      operationId: "op-create-c2-test",
      now: TEST_TIME
    });

    expect(draft.profileId).toBe(demoCareerProfile.id);
    expect(draft.jobId).toBe(job.id);
    expect(draft.profileVersion).toBe(demoCareerProfile.version);
    expect(draft.jobVersion).toBe(job.updatedAt);
    expect(draft.requirementMatchIds).toHaveLength(matches.length);
    expect(draft.sectionTexts.length).toBeGreaterThan(0);
    expect(draft.revision).toBe(0);
  });

  it("blocks stale matches before creating C2 draft", () => {
    const job = demoJobDescriptions[0];
    const matches = createRuleRequirementMatches({ profile: demoCareerProfile, job }, TEST_TIME);
    const staleProfile = { ...demoCareerProfile, version: demoCareerProfile.version + 1 };

    expect(() => createJobAdaptationDraft({
      profile: staleProfile,
      job,
      matches,
      operationId: "op-stale-c2-test",
      now: TEST_TIME
    })).toThrowError(expect.objectContaining({ code: "c2_match_stale_return_to_c1" }));
  });

  it("detects unsupported numbers, tools, and responsibility upgrades", () => {
    const ref = {
      type: "experience_fact" as const,
      experienceId: "exp-guard",
      factId: "fact-guard",
      factQuote: "参与数据整理，使用 Excel 完成周报。",
      factText: "参与数据整理，使用 Excel 完成周报。"
    };
    const result = runRuleFactGuard({
      originalText: "参与数据整理，使用 Excel 完成周报。",
      checkedText: "主导数据分析项目，使用 Python 将转化率提升 30%。",
      usedEvidenceRefs: [ref],
      now: TEST_TIME
    });

    expect(result.status).toBe("blocked_high_risk");
    expect(result.ruleFindings.map((finding) => finding.type)).toEqual(expect.arrayContaining([
      "new_number",
      "new_tool",
      "participation_to_owner"
    ]));
  });

  it("keeps rule findings when AI fact guard fails", () => {
    const ruleResult = runRuleFactGuard({
      originalText: "协助整理活动数据。",
      checkedText: "独立完成活动数据分析。",
      usedEvidenceRefs: [],
      now: TEST_TIME
    });
    const merged = mergeAiFactGuardReview({
      ruleResult,
      aiFailed: true,
      now: TEST_TIME
    });

    expect(merged.status).toBe("blocked_high_risk");
    expect(merged.ruleFindings.length).toBeGreaterThan(0);
  });
});
