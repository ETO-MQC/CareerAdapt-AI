import { describe, expect, it } from "vitest";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { validateTailoringSuggestions } from "@/services/jobs/tailoringService";
import { TailoringSuggestionSchema } from "@/domain/schemas";
const before = "参与 AI 应用项目的需求梳理、原型设计和功能验收。";
const oldAfter = "参与需求梳理、原型设计和功能验收等 AI 应用项目工作。";
const after = "AI 应用项目：参与需求梳理、原型设计和功能验收。";
function suggestion(value: string) {
  return TailoringSuggestionSchema.parse({ id: "jd03r-project", intensity: "balanced", operation: "rewrite", targetSectionType: "project", targetSectionId: "project", targetItemId: "project", targetFieldPath: "sections.project.items.project.highlights", before: [before], after: [value], changedFields: ["highlights"], requirementIds: ["req"], targetKeywords: [], claimSupportLevel: "verified", evidenceRefs: [], rationale: "重排已确认的项目职责，保留原有事实和证据", riskLevel: "low", metrics: { textChangeRatio: 0.1, keywordGain: 0 }, status: "ready" });
}
describe("JD03R legacy fixture contract", () => {
  it("preserves the old blocked output and proves the actual Guard finding instead of forcing application", () => {
    const guard = runRuleFactGuard({ originalText: before, checkedText: oldAfter, usedEvidenceRefs: [] });
    expect(guard.ruleFindings).toEqual(expect.arrayContaining([expect.objectContaining({ type: "participation_to_owner", allowed: false })]));
    const result = validateTailoringSuggestions({ suggestions: [suggestion(oldAfter)] });
    expect(result.suggestions[0]).toMatchObject({ status: "blocked", claimSupportLevel: "unsupported_hard_fact" });
  });
  it("accepts the fixture rewrite that preserves the exact responsibility object and participation level", () => {
    const guard = runRuleFactGuard({ originalText: before, checkedText: after, usedEvidenceRefs: [] });
    expect(guard.status).toBe("pass");
    expect(validateTailoringSuggestions({ suggestions: [suggestion(after)] }).suggestions[0]).toMatchObject({ status: "ready", claimSupportLevel: "verified" });
  });
});
