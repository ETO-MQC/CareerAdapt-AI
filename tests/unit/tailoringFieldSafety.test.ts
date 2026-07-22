import { describe, expect, it } from "vitest";
import {
  ConfirmableClaimSchema,
  ResumeFieldPatchSchema,
  type ResumeTailoringPlan,
  type TailoringSuggestion
} from "@/domain/schemas";
import {
  buildConfirmableClaim,
  groupTailoringKeywords,
  resolveConfirmableClaim,
  tailoringTargetPriority
} from "@/domain/jobOptimization";
import { validateTailoringSuggestions } from "@/services/jobs/tailoringService";

const suggestion: TailoringSuggestion = {
  id: "smartfocus-highlight",
  intensity: "balanced",
  operation: "rewrite",
  targetSectionType: "project",
  targetSectionId: "project",
  targetItemId: "smartfocus",
  targetFieldPath: "sections.project.items.smartfocus.highlights",
  before: ["设计高风险操作二次确认机制。"],
  after: ["复现模型在模糊指令下过度执行的问题，设计二次确认与预提交保护机制。"],
  changedFields: ["highlights"],
  requirementIds: ["req-risk"],
  targetKeywords: ["Coding Agent", "风险操作约束"],
  coveredKeywordsBefore: [],
  coveredKeywordsAfter: ["风险操作约束"],
  claimSupportLevel: "verified",
  evidenceRefs: [],
  rationale: "对应风险操作约束要求。",
  riskLevel: "low",
  metrics: { textChangeRatio: 0.55, keywordGain: 1 },
  status: "ready"
};

describe("typed resume field patches", () => {
  it("keeps experience highlights as a string array and rejects flattened metadata", () => {
    expect(ResumeFieldPatchSchema.parse({
      sectionId: "project",
      itemId: "smartfocus",
      fieldPath: "highlights",
      operation: "replace",
      before: suggestion.before,
      after: suggestion.after
    }).after).toEqual(suggestion.after);

    expect(() => ResumeFieldPatchSchema.parse({
      sectionId: "project",
      itemId: "smartfocus",
      fieldPath: "highlights",
      operation: "replace",
      before: suggestion.before,
      after: "项目名称：示例任务系统 开始日期：2026-02 亮点：设计保护机制"
    })).toThrow();
  });

  it("builds a claim whose formal target is only the typed field patch", () => {
    const claim = buildConfirmableClaim(suggestion);
    expect(claim).toMatchObject({
      label: "强化 示例任务系统 的风险操作约束经验",
      claimText: suggestion.after[0],
      sourceItemIds: ["smartfocus"],
      requirementIds: ["req-risk"],
      claimType: "experience_reframe"
    });
    expect(claim.targetPatches).toEqual([expect.objectContaining({ fieldPath: "highlights", after: suggestion.after })]);
  });
});

describe("claim-level confirmation", () => {
  it("resolves proficiency into both the visible final sentence and target patch", () => {
    const toolSuggestion = { ...suggestion, id: "cursor", targetSectionType: "skills" as const, targetSectionId: "skills", targetItemId: "skill-ai-coding", targetFieldPath: "sections.skills.items.skill-ai-coding.description", before: "AI Coding 工具", after: "深度使用 Cursor 完成开发", targetKeywords: ["Cursor"], claimSupportLevel: "user_declared" as const, status: "requires_confirmation" as const };
    const claim = buildConfirmableClaim(toolSuggestion);
    const resolved = resolveConfirmableClaim(claim, { claimId: claim.id, accepted: true, syncScope: "resume_only", proficiency: "aware" });
    expect(resolved.resolvedText).toBe("了解 Cursor 等 AI Coding 工具的基本工作方式。");
    expect(resolved.targetPatches[0].after).toBe(resolved.resolvedText);
    expect(resolved.targetPatches[0].after).not.toMatch(/熟练|精通|深度使用/);
  });

  it("uses adopt/edit/reject for experience reframes instead of proficiency", () => {
    const multiHighlightSuggestion = {
      ...suggestion,
      after: [...suggestion.after, "通过自动化测试验证保护机制在回归场景中的有效性。"],
      status: "requires_confirmation" as const,
      claimSupportLevel: "reasonable_inference" as const
    };
    const claim = ConfirmableClaimSchema.parse(buildConfirmableClaim(multiHighlightSuggestion));
    expect(claim.claimType).toBe("experience_reframe");
    expect(claim.finalTextByProficiency).toBeUndefined();
    const resolved = resolveConfirmableClaim(claim, { claimId: claim.id, accepted: true, syncScope: "resume_only" });
    expect(resolved.targetPatches[0].after).toEqual(multiHighlightSuggestion.after);
    expect(resolved.targetPatches[0].after).not.toEqual([claim.claimText]);
  });
});

describe("tailoring quality gates", () => {
  it("rejects a truncated summary and analytical boilerplate", () => {
    const base = { ...suggestion, targetSectionType: "summary" as const, targetSectionId: "summary", targetItemId: "summary", targetFieldPath: "sections.summary.items.summary.text", before: "持续跟踪 AI Coding 产品能力变化，能够复现错误、定位原因、验证模型输出，并建立风险操作约束。" };
    const truncated = validateTailoringSuggestions({ suggestions: [{ ...base, after: "持续跟踪 AI Coding 产品能力变化，能够复现错误、定位原因、验证模型输出与风险", changedFields: ["text"] }] });
    expect(truncated.rejected[0]?.reasons).toContain("truncated_summary");

    const boilerplate = validateTailoringSuggestions({ suggestions: [{ ...suggestion, after: ["完成模型输出验证，该能力适用于分析 Coding Agent 的输出质量。"] }] });
    expect(boilerplate.rejected[0]?.reasons).toContain("resume_analysis_boilerplate");
  });

  it("deduplicates keyword variants and separates decision groups", () => {
    expect(groupTailoringKeywords(["vibe", "vibe coding", "coding", "agent", "coding agent", "AI", "Cursor", "GitHub", "badcase"])).toEqual({
      core: ["badcase"],
      confirmableTools: ["Cursor"],
      materials: ["GitHub"]
    });
  });

  it("prioritizes the most relevant AI Coding evidence", () => {
    const ranked = [
      ["other", "其他经历：日常文档整理"],
      ["ai-review", "AI 辅助开发与指令评估，验证模型输出"],
      ["redbook", "示例内容分析，badcase 与评测"],
      ["learnkata", "示例学习助手：RAG 幻觉、拒答边界与 verifier"],
      ["smartfocus", "示例任务系统：Coding Agent 多文件修改、错误复现、Playwright 与风险操作约束"]
    ].sort((a, b) => tailoringTargetPriority(b[0], b[1]) - tailoringTargetPriority(a[0], a[1]));
    expect(ranked.map(([id]) => id)).toEqual(["smartfocus", "ai-review", "learnkata", "redbook", "other"]);
  });
});

void ({} as ResumeTailoringPlan);
