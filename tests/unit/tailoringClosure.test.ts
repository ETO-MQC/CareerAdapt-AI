import { describe, expect, it } from "vitest";
import {
  captureAndDedupeTailoringClaims,
  resolveCapabilityEntities,
  tailoringValueHash,
  validateTailoringClaimClosure
} from "@/domain/jobOptimization";
import type { ResumeBranch, TailoringClaim } from "@/domain/schemas";
import { answerTailoringClarification, dedupeClarificationQuestions, withTailoringSuggestions } from "@/services/jobs/tailoringService";

function branchFixture(): ResumeBranch {
  return {
    id: "branch-tailoring-closure",
    revision: 3,
    currentRevisionId: "revision-3",
    contentItems: [
      { id: "summary-1", text: "关注 AI 产品质量。", factRefs: [] },
      { id: "project-1", text: "定位模型输出问题", factRefs: [] }
    ],
    structuredContentItems: [
      { id: "summary-1", data: { id: "summary-1", sectionType: "summary", text: "关注 AI 产品质量。", customFields: [] } },
      { id: "project-1", data: { id: "project-1", sectionType: "project", title: "评测项目", highlights: ["定位模型输出问题", "验证修复结果"], customFields: [] } }
    ]
  } as unknown as ResumeBranch;
}

function claim(overrides: Partial<TailoringClaim> = {}): TailoringClaim {
  return {
    id: "claim-1",
    section: "project",
    targetContentItemId: "project-1",
    targetFieldPath: "sections.project.items.project-1.highlights[0]",
    targetPolicy: "specific_item",
    currentText: "定位模型输出问题\n验证修复结果",
    proposedText: "复现并定位模型输出问题\n验证修复结果",
    reason: "对齐输出质量评估要求",
    keywords: ["输出质量评估"],
    requirementIds: ["req-1"],
    supportLevel: "verified",
    decision: "auto_applicable",
    evidenceRefs: [],
    syncScope: "resume_only",
    confirmed: true,
    targetPatches: [{
      sectionId: "project",
      itemId: "project-1",
      fieldPath: "highlights",
      targetIndex: 0,
      operation: "replace",
      before: ["定位模型输出问题", "验证修复结果"],
      after: ["复现并定位模型输出问题", "验证修复结果"]
    }],
    ...overrides
  };
}

describe("capability entity resolver", () => {
  it("classifies employers, platforms, tools, models, workflows and materials", () => {
    const entities = resolveCapabilityEntities({
      job: {
        title: "AI 训练师",
        company: "示例招聘平台",
        rawText: "通过 Talents AI 平台提交 dashboard 与 GitHub 链接",
        responsibilities: ["使用 Cursor、Claude Code、Playwright 与 Vitest"],
        mustHave: ["复杂指令设计、任务规划、输出质量评估"],
        niceToHave: ["ChatGPT、Claude、Gemini、Qwen、豆包、元宝"],
        tools: [],
        keywords: []
      },
      requirements: ["通过 Talents AI 平台提交 billing history"]
    });
    expect(entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ normalizedLabel: "示例招聘平台", type: "company", source: "job_company" }),
      expect.objectContaining({ normalizedLabel: "talents", type: "platform" }),
      expect.objectContaining({ label: "Cursor", type: "tool" }),
      expect.objectContaining({ label: "ChatGPT", type: "model" }),
      expect.objectContaining({ label: "任务规划", type: "workflow" }),
      expect.objectContaining({ label: "billing history", type: "material" })
    ]));
  });

  it("never promotes Talents spelling variants to proficiency-capable entities", () => {
    for (const value of ["Talents", "示例招聘平台", "Telent"]) {
      expect(resolveCapabilityEntities({ keywords: [value] })[0]?.type).toBe("company");
    }
  });
});

describe("tailoring closure invariants", () => {
  it("deduplicates clarification cards by capability and policy while merging requirements", () => {
    const capability = resolveCapabilityEntities({ keywords: ["Cursor"] })[0];
    const questions = ["req-1", "req-2"].map((requirementId, index) => ({
      id: `question-${index}`,
      question: "你对 Cursor 的真实使用程度是什么？",
      requirementIds: [requirementId],
      sourceItemIds: [`project-${index + 1}`],
      relatedItemIds: [`project-${index + 1}`],
      candidateClaim: "Cursor",
      targetFieldPaths: [`sections.project.items.project-${index + 1}.highlights`],
      capability,
      targetPolicy: "skill_once" as const,
      answerType: "proficiency" as const
    }));
    const deduped = dedupeClarificationQuestions(questions, "job-1");
    expect(deduped).toHaveLength(1);
    expect(deduped[0].requirementIds).toEqual(["req-1", "req-2"]);
  });

  it("captures the immutable branch revision value and merges requirement ids by semantic target", () => {
    const result = captureAndDedupeTailoringClaims({
      branch: branchFixture(),
      jobId: "job-1",
      claims: [
        claim(),
        claim({ id: "claim-2", requirementIds: ["req-2"] })
      ]
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      baseRevisionId: "revision-3",
      originalValue: ["定位模型输出问题", "验证修复结果"],
      originalValueHash: tailoringValueHash(["定位模型输出问题", "验证修复结果"]),
      requirementIds: ["req-1", "req-2"]
    });
  });

  it("detects a changed revision without mutating the saved original snapshot", () => {
    const original = captureAndDedupeTailoringClaims({ branch: branchFixture(), jobId: "job-1", claims: [claim()] })[0];
    const changed = branchFixture();
    changed.currentRevisionId = "revision-4";
    const project = changed.structuredContentItems?.find((item) => item.id === "project-1");
    if (project?.data.sectionType === "project") project.data.highlights[0] = "后来修改的文本";
    expect(validateTailoringClaimClosure({ claims: [original], branch: changed }).map((item) => item.code)).toContain("original_snapshot_mismatch");
    expect(original.originalValue).toEqual(["定位模型输出问题", "验证修复结果"]);
  });

  it("rejects Talents proficiency text and duplicate final sentences", () => {
    const talents = claim({
      id: "talents",
      section: "skills",
      capability: resolveCapabilityEntities({ keywords: ["Talents"] })[0],
      proposedText: "熟练使用 talents 完成多文件开发、代码修改与问题定位。",
      targetPatches: [{ sectionId: "skills", itemId: "skill-talents", fieldPath: "description", operation: "replace", before: "", after: "熟练使用 talents 完成多文件开发、代码修改与问题定位。" }]
    });
    const duplicate = claim({ id: "duplicate", targetContentItemId: "project-2", targetPatches: [{ ...claim().targetPatches![0], itemId: "project-2" }] });
    const codes = validateTailoringClaimClosure({ claims: [talents, claim(), duplicate] }).map((item) => item.code);
    expect(codes).toContain("company_as_skill");
    expect(codes).toContain("platform_as_skill");
    expect(codes).toContain("duplicate_sentence");
  });

  it("does not create a skill claim from a Talents suggestion", () => {
    const plan = {
      id: "plan-talents",
      branchId: "branch-1",
      jobId: "job-1",
      intensity: "balanced" as const,
      basedOnBranchRevision: 1,
      basedOnRevisionId: "revision-1",
      claims: [],
      estimatedFitScore: 0,
      createdAt: "2026-07-23T00:00:00.000Z"
    };
    const result = withTailoringSuggestions({
      plan,
      suggestions: [{
        id: "talents-suggestion",
        intensity: "balanced",
        operation: "rewrite",
        targetSectionType: "skills",
        targetSectionId: "skills",
        targetItemId: "skill-1",
        targetFieldPath: "sections.skills.items.skill-1.description",
        before: "AI 工具",
        after: "熟练使用 talents 完成多文件开发、代码修改与问题定位。",
        changedFields: ["description"],
        requirementIds: ["req-1"],
        targetKeywords: ["Talents"],
        coveredKeywordsBefore: [],
        coveredKeywordsAfter: ["Talents"],
        claimSupportLevel: "user_declared",
        evidenceRefs: [],
        rationale: "错误的平台技能建议",
        riskLevel: "high",
        metrics: { textChangeRatio: 0.8, keywordGain: 1 },
        status: "requires_confirmation"
      }]
    });
    expect(result.claims).toHaveLength(0);
  });

  it("appends a confirmed project bullet instead of prepending a generic proficiency sentence", () => {
    const branch = branchFixture();
    const plan = {
      id: "plan-1",
      branchId: branch.id,
      jobId: "job-1",
      intensity: "balanced" as const,
      basedOnBranchRevision: branch.revision,
      basedOnRevisionId: branch.currentRevisionId!,
      claims: [],
      estimatedFitScore: 0,
      createdAt: "2026-07-23T00:00:00.000Z"
    };
    const answered = answerTailoringClarification({
      plan,
      branch,
      question: {
        id: "question-project",
        question: "请补充该项目中真实的输出质量评估过程。",
        requirementIds: ["req-1"],
        sourceItemIds: ["project-1"],
        relatedItemIds: ["project-1"],
        candidateClaim: "输出质量评估",
        targetFieldPaths: ["sections.project.items.project-1.highlights"],
        targetPolicy: "specific_item",
        answerType: "text"
      },
      answer: "复现失败输出并验证修复结果"
    });
    expect(answered.claims[0].targetPatches?.[0]).toMatchObject({
      operation: "append",
      after: ["定位模型输出问题", "验证修复结果", "复现失败输出并验证修复结果"]
    });
  });
});
