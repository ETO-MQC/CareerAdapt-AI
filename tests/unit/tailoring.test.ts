import { describe, expect, it, vi } from "vitest";
import { classifyTailoringClaim, claimDecisionFor } from "@/domain/jobOptimization/claimGuard";
import { recommendedTailoringIntensity, sectionTailoringPolicy } from "@/domain/jobOptimization/sectionPolicy";
import { answerTailoringClarification, applyTailoringPlan, confirmTailoringClaims, validateTailoringSuggestions, withTailoringSuggestions } from "@/services/jobs/tailoringService";
import { resolveTailoringClaimPolicy } from "@/domain/jobOptimization/tailoringClaimPolicy";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { ResumeTailorPlannerOutputSchema } from "@/domain/schemas";
import type { ResumeTailoringPlan } from "@/domain/schemas";

const NOW = "2026-07-20T08:00:00.000Z";

describe("Claim Guard", () => {
  it.each(["new_tool", "new_skill", "know_to_proficient"] as const)("turns %s into a confirmable capability", (type) => {
    const guard = runRuleFactGuard({ originalText: "了解基础开发流程", checkedText: "熟练使用 Python 完成开发", usedEvidenceRefs: [], now: NOW });
    const result = resolveTailoringClaimPolicy({
      suggestion: { claimSupportLevel: "user_declared", targetKeywords: ["Python"] },
      guardResult: { ...guard, ruleFindings: [{ type, text: "Python", severity: "high", allowed: false, message: "missing" }] },
      sectionType: "skills",
      intensity: "balanced"
    });
    expect(result).toMatchObject({ claimClass: "user_confirmable_capability", decision: "requires_confirmation", confirmationKind: "capability" });
    expect(result.blockingFindings).toHaveLength(0);
  });

  it.each(["new_number", "new_company", "participation_to_owner"] as const)("keeps %s blocked", (type) => {
    const guard = runRuleFactGuard({ originalText: "参与项目", checkedText: "主导某公司项目并提升 80%", usedEvidenceRefs: [], now: NOW });
    const result = resolveTailoringClaimPolicy({
      suggestion: { claimSupportLevel: "reasonable_inference", targetKeywords: [] },
      guardResult: { ...guard, ruleFindings: [{ type, text: "invented", severity: "high", allowed: false, message: "missing" }] },
      sectionType: "project",
      intensity: "proactive"
    });
    expect(result).toMatchObject({ claimClass: "unsupported_hard_fact", decision: "blocked" });
  });

  it("accepts planner ask_user actions and bound clarification questions", () => {
    expect(ResumeTailorPlannerOutputSchema.parse({ assessments: [{ itemId: "summary", action: "ask_user", reason: "需要确认工具经验", suggestedKeywords: ["Cursor"], relatedRequirementIds: ["req-cursor"], clarificationQuestions: ["是否使用过 Cursor？"] }] }).assessments[0].action).toBe("clarification_required");
  });

  it("keeps an AI suggestion with a new tool selectable pending confirmation", () => {
    const result = validateTailoringSuggestions({ suggestions: [{
      id: "python-claim", intensity: "balanced", operation: "rewrite", targetSectionType: "skills", targetSectionId: "skills", targetItemId: "skill-1", targetFieldPath: "sections.skills.items.skill-1.description",
      before: "开发数据服务和接口", after: "使用 Python 开发数据服务和接口", changedFields: ["description"], requirementIds: ["req-python"], targetKeywords: ["Python"], coveredKeywordsBefore: [], coveredKeywordsAfter: [],
      claimSupportLevel: "verified", evidenceRefs: [], rationale: "补充 Python 岗位关键词并保留原有开发内容", riskLevel: "low", metrics: { textChangeRatio: 0.3, keywordGain: 1 }, status: "ready"
    }] });
    expect(result.suggestions[0]).toMatchObject({ status: "requires_confirmation", claimSupportLevel: "user_declared", riskLevel: "medium" });
  });
  it("maps the four support levels to stable decisions", () => {
    expect(claimDecisionFor("verified")).toBe("auto_applicable");
    expect(claimDecisionFor("reasonable_inference")).toBe("requires_confirmation");
    expect(claimDecisionFor("user_declared")).toBe("requires_confirmation");
    expect(claimDecisionFor("unsupported_hard_fact")).toBe("blocked");
  });

  it("keeps user-declared skills separate from verified evidence", () => {
    const claim = classifyTailoringClaim({ id: "pytest", section: "skills", proposedText: "了解 pytest", reason: "岗位关键词", declaredByUser: true });
    expect(claim).toMatchObject({ supportLevel: "user_declared", decision: "requires_confirmation", syncScope: "resume_only", confirmed: false });
  });

  it("permanently blocks invented numeric outcomes", () => {
    const claim = classifyTailoringClaim({ id: "number", section: "project", currentText: "优化核心流程", proposedText: "优化核心流程并提升 80%", reason: "增强成果" });
    expect(claim).toMatchObject({ supportLevel: "unsupported_hard_fact", decision: "blocked", syncScope: "rejected" });
  });
});

describe("tailoring intensity and section policy", () => {
  it("uses balanced as the middle recommendation", () => {
    expect(recommendedTailoringIntensity(80)).toBe("conservative");
    expect(recommendedTailoringIntensity(55)).toBe("balanced");
    expect(recommendedTailoringIntensity(20)).toBe("proactive");
  });

  it("never rewrites immutable factual sections", () => {
    for (const section of ["education", "awards", "certificates", "publications", "patents"] as const) {
      expect(sectionTailoringPolicy(section, "proactive")).toMatchObject({ immutableFacts: true, allowsInference: false, allowsUserDeclared: false });
      expect(sectionTailoringPolicy(section, "proactive").allowedActions).toEqual(["show", "hide", "reorder", "format"]);
    }
    expect(sectionTailoringPolicy("skills", "proactive").allowsUserDeclared).toBe(true);
    expect(sectionTailoringPolicy("project", "balanced").allowsInference).toBe(true);
    expect(sectionTailoringPolicy("project", "conservative").allowsInference).toBe(false);
  });
});

describe("tailoring application service", () => {
  const plan: ResumeTailoringPlan = {
    id: "plan-1", branchId: "branch-1", jobId: "job-1", intensity: "balanced", basedOnBranchRevision: 1,
    estimatedFitScore: 68, createdAt: NOW,
    claims: [{ id: "claim-1", section: "skills", currentText: "", proposedText: "了解 pytest", reason: "岗位要求", keywords: ["pytest"], supportLevel: "user_declared", decision: "requires_confirmation", evidenceRefs: [], syncScope: "resume_only", confirmed: false }]
  };

  it("groups confirmation and defaults it to resume-only", async () => {
    const before = await applyTailoringPlan({ plan, operationId: "apply-1", apply: vi.fn() });
    expect(before.status).toBe("needs_confirmation");
    expect(before.confirmationGroups?.[0].defaultSyncScope).toBe("resume_only");

    const confirmed = confirmTailoringClaims({ plan, confirmations: [{ claimId: "claim-1", accepted: true, proficiency: "aware", syncScope: "resume_only" }] });
    const apply = vi.fn().mockResolvedValue({ branchId: "branch-1", revisionId: "revision-2" });
    const result = await applyTailoringPlan({ plan: confirmed.plan!, operationId: "apply-1", apply });
    expect(result).toMatchObject({ status: "completed", resultRefs: { branchId: "branch-1", revisionId: "revision-2", planId: "plan-1" } });
    expect(apply).toHaveBeenCalledOnce();
  });

  it.each([
    ["proficient", "熟练运用 Cursor 完成相关任务、问题定位与结果交付。"],
    ["familiar", "熟悉 Cursor 在相关任务中的使用、修改与问题定位流程。"],
    ["aware", "了解 Cursor 等相关工具或方法的基本工作方式。"],
    ["learning", "正在学习 Cursor 等相关工具或方法在真实任务中的应用。"]
  ] as const)("resolves %s into proficiency-aware final text", (proficiency, resolvedText) => {
    const cursorPlan = { ...plan, claims: [{ ...plan.claims[0], proposedText: "深度使用 Cursor", keywords: ["Cursor"] }] };
    const confirmed = confirmTailoringClaims({ plan: cursorPlan, confirmations: [{ claimId: "claim-1", accepted: true, proficiency, syncScope: "resume_only" }] });
    expect(confirmed.plan?.claims[0].resolvedText).toBe(resolvedText);
    if (proficiency === "learning") expect(confirmed.plan?.claims[0].resolvedText).not.toMatch(/熟练|精通|深度使用/);
  });

  it("does not produce resolved text when the user chooses not to add", () => {
    const confirmed = confirmTailoringClaims({ plan, confirmations: [{ claimId: "claim-1", accepted: false, syncScope: "rejected" }] });
    expect(confirmed.plan?.claims[0].resolvedText).toBeUndefined();
  });

  it("does not erase deterministic claims when AI returns no suggestions", () => {
    expect(withTailoringSuggestions({ plan, suggestions: [] }).claims).toEqual(plan.claims);
  });

  it("turns a clarification answer into a resume-only confirmable claim", () => {
    const patch = { sectionId: "skills", itemId: "skill-1", fieldPath: "description" as const, operation: "replace" as const, before: "工程开发", after: "工程开发" };
    const base = { ...plan, claims: [{ ...plan.claims[0], targetContentItemId: "skill-1", targetPatches: [patch] }] };
    const question = { id: "q-cursor", question: "你使用过哪些 AI Coding 工具？", requirementIds: ["req-cursor"], sourceItemIds: ["skill-1"], relatedItemIds: ["skill-1"], candidateClaim: "AI Coding 工具", targetFieldPaths: ["description"], answerType: "multi_select" as const };
    const answered = answerTailoringClarification({ plan: base, question, answer: ["Cursor", "Codex"] });
    expect(answered.claims.at(-1)).toMatchObject({ supportLevel: "user_declared", decision: "requires_confirmation", syncScope: "resume_only", keywords: ["Cursor", "Codex"] });
    expect(answered.claims.at(-1)?.proposedText).toContain("Cursor");
  });

  it("records a negative clarification answer and does not create a claim", () => {
    const question = { id: "q-negative", question: "你使用过 Cursor 吗？", requirementIds: ["req-cursor"], sourceItemIds: ["skill-1"], relatedItemIds: ["skill-1"], candidateClaim: "Cursor", targetFieldPaths: ["description"], answerType: "boolean" as const };
    const answered = answerTailoringClarification({ plan: { ...plan, claims: [] }, question, answer: false });
    expect(answered.claims).toHaveLength(0);
    expect(answered.clarificationAnswers).toEqual([expect.objectContaining({ questionId: "q-negative", status: "rejected", answer: false })]);
  });

  it("builds a safe fallback patch when clarification has no deterministic suggestion", () => {
    const question = { id: "q-fallback", question: "请描述 badcase", requirementIds: ["req-badcase"], sourceItemIds: ["project-1"], relatedItemIds: ["project-1"], candidateClaim: "badcase 复盘", targetFieldPaths: ["sections.project.items.project-1.highlights"], answerType: "text" as const };
    const branch = { contentItems: [{ id: "project-1", text: "定位并修复模型输出问题" }], structuredContentItems: [{ id: "project-1", data: { id: "project-1", sectionType: "project", highlights: ["定位并修复模型输出问题"] } }] } as never;
    const answered = answerTailoringClarification({ plan: { ...plan, claims: [], suggestions: [] }, question, answer: "复现失败输出并定位提示词约束缺失", branch });
    expect(answered.claims).toHaveLength(1);
    expect(answered.claims[0].targetPatches?.[0]).toMatchObject({ itemId: "project-1", fieldPath: "highlights", before: ["定位并修复模型输出问题"] });
    expect(answered.claims[0].proposedText).toContain("复现失败输出");
  });
});
