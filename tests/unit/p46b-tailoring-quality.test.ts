import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import {
  dedupeTailoringDiffs,
  validateEachTailoringDiffLocally
} from "@/domain/jobOptimization";
import { ResumeTailoringDiffTaskInputSchema, type ResumeTailoringDiff } from "@/domain/schemas";
import type { ResumeBranch } from "@/domain/schemas";
import { prioritizeTailoringTargets } from "@/services/jobs/tailoringCommands";

const evidence = {
  type: "experience_fact" as const,
  experienceId: "experience-1",
  factId: "fact-1",
  factQuote: "使用 RAG 评估模型输出",
  factText: "使用 RAG 评估模型输出"
};

function branchFixture() {
  return {
    id: "branch-1",
    contentItems: [{ id: "project-1", text: "参与模型输出评估", factRefs: [{ type: "experience_fact", experienceId: "experience-1", factId: "fact-1" }] }],
    structuredContentItems: [{
      id: "project-1", order: 0, visible: true,
      data: { id: "project-1", sectionType: "project", title: "模型评估项目", description: "参与模型输出评估", highlights: [] }
    }]
  } as unknown as ResumeBranch;
}

function diff(overrides: Partial<ResumeTailoringDiff> = {}): ResumeTailoringDiff {
  return {
    target: { sectionId: "project", itemId: "project-1", fieldPath: "description" },
    operation: "replace",
    original: "参与模型输出评估",
    value: "参与模型输出质量评估",
    reason: "对齐岗位中的完整动作短语",
    requirementIds: ["req-eval"],
    targetKeywords: ["模型评测", "输出质量评估"],
    evidenceRefs: [evidence],
    supportLevel: "verified",
    ...overrides
  };
}

describe("P4.6b deterministic tailoring quality closure", () => {
  it("A-D rejects no-op, mechanical prefix, ownership upgrade, and invented metric", () => {
    const result = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [
        diff({ value: "参与模型输出评估" }),
        diff({ value: "围绕任务背景复现问题、定位原因并验证结果：原文" }),
        diff({ value: "主导模型输出质量评估" }),
        diff({ value: "参与模型输出评估，提升 30%" })
      ]
    });
    expect(result.rejectedDiffs.map((item) => item.reasonCode)).toEqual([
      "no_op", "mechanical_prefix", "responsibility_upgrade", "invented_metric"
    ]);
  });

  it("E-G rejects generic proficiency, malformed Chinese, and internal field labels", () => {
    const result = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [
        diff({ value: "熟悉相关技能" }),
        diff({ value: "负责负责模型输出评估" }),
        diff({ value: "项目名称：模型评估项目" })
      ]
    });
    expect(result.rejectedDiffs.map((item) => item.reasonCode)).toEqual([
      "generic_proficiency_sentence", "malformed_chinese_phrase", "internal_field_label"
    ]);
  });

  it("H-I makes denied capability and weak proficiency answers binding", () => {
    const denied = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      forbiddenTerms: ["Cursor"],
      diffs: [diff({ value: "参与模型输出评估，并使用 Cursor 辅助编码" })]
    });
    expect(denied.rejectedDiffs[0]?.reasonCode).toBe("denied_capability");

    const weakAnswer = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      confirmedUserDeclarations: [{ questionId: "q-1", value: "Claude Code", requirementIds: ["req-eval"], proficiency: "familiar" }],
      diffs: [diff({ value: "熟练运用 Claude Code 完成模型输出评估" })]
    });
    expect(weakAnswer.rejectedDiffs[0]?.reasonCode).toBe("proficiency_upgrade");
  });

  it("J keeps the first diff and conservatively rejects cross-target repetition", () => {
    const result = dedupeTailoringDiffs([
      diff(),
      diff({ target: { sectionId: "project", itemId: "project-2", fieldPath: "description" } }),
      diff({ value: "参与模型输出质量评估并完成结果核验" })
    ]);
    expect(result.appliedDiffs).toHaveLength(1);
    expect(result.rejectedDiffs.map((item) => item.reasonCode)).toEqual(["duplicate_sentence", "cross_diff_duplicate"]);
  });

  it("K ranks evidence-backed experience before generic skills and preserves diversity", () => {
    const makeTask = (sectionType: "project" | "work" | "skills" | "summary", itemId: string, direct: number) => ({
      target: { sectionType, sectionId: sectionType, itemId, fieldPath: sectionType === "skills" ? "description" : "description" },
      currentContent: { structuredItem: { sectionType, id: itemId }, fieldValue: "已有内容", renderedText: "已有内容" },
      relevantRequirements: [{ requirementId: `req-${itemId}`, description: "交付并验证模型输出", priority: "high", keywords: ["模型输出"], relevanceScore: direct ? 12 : 10 }],
      allowedEvidenceRefs: direct ? [evidence] : [],
      evidenceBundle: { directEvidence: direct ? [{ value: "直接项目事实", evidenceRefs: [evidence] }] : [], relatedResumeEvidence: [], relatedProfileEvidence: [], confirmableSignals: [], confirmedUserDeclarations: [], negativeUserDeclarations: [], uncertainUserDeclarations: [] }
    }) as never;
    const selected = prioritizeTailoringTargets([
      makeTask("skills", "skill-1", 1),
      makeTask("project", "project-1", 1),
      makeTask("work", "work-1", 0),
      makeTask("summary", "summary-1", 0)
    ]);
    expect(selected[0]?.target.sectionType).toBe("project");
    expect(new Set(selected.map((item) => item.target.sectionType)).size).toBeGreaterThan(1);
  });

  it("L sends bounded FACT/REQUIREMENT/CONTEXT sections and retry diagnostics", () => {
    const input = ResumeTailoringDiffTaskInputSchema.parse({
      draftId: "draft-1", profileId: "profile-1", jobId: "job-1", intensity: "balanced",
      jobContext: { title: "模型评估工程师", rawText: "不应进入用户 prompt 的完整 JD", responsibilities: ["评估模型输出"], mustHave: [], niceToHave: [], tools: ["RAG"], keywords: ["模型评估"] },
      target: { sectionType: "project", sectionId: "project", itemId: "project-1", fieldPath: "description" },
      currentContent: { structuredItem: { id: "project-1", sectionType: "project", title: "模型评估", highlights: [] }, fieldValue: "参与模型输出评估", renderedText: "参与模型输出评估" },
      relevantRequirements: [{ requirementId: "req-1", description: "评估模型输出", priority: "high", keywords: ["模型评估"], relevanceScore: 12, detailClauses: ["说明验证方式"], semanticAliases: ["模型测试"], hardConstraint: false }],
      requirementDetails: { "req-1": { requirementId: "req-1", detailClauses: ["说明验证方式"], semanticAliases: ["模型测试"], hardConstraint: false } },
      evidenceBundle: { directEvidence: [{ value: "直接项目事实", evidenceRefs: [evidence] }], relatedResumeEvidence: [], relatedProfileEvidence: [], confirmableSignals: [], confirmedUserDeclarations: [], negativeUserDeclarations: [], uncertainUserDeclarations: [] },
      wholeResumeContext: { neighboringLines: ["相邻经历"], topCapabilityPhrases: ["RAG"], alreadySelectedRequirementIds: [], nearbyItemIds: ["project-1"] },
      allowedEvidenceRefs: [evidence], allowedFacts: [{ value: "直接项目事实", evidenceRefs: [evidence] }], allowedOperation: "replace",
      retryContext: { reasonCodes: ["mechanical_prefix"], attempt: 1 }
    });
    const payload = JSON.parse(aiTaskRegistry["resume-tailor-diff"].buildUserPrompt(input));
    expect(payload).toHaveProperty("FACT");
    expect(payload).toHaveProperty("REQUIREMENT.requirementDetails.req-1");
    expect(payload).toHaveProperty("CONTEXT.wholeResumeContext");
    expect(payload["RETRY DIAGNOSTIC"]).toEqual({ reasonCodes: ["mechanical_prefix"], attempt: 1 });
    expect(JSON.stringify(payload)).not.toContain("不应进入用户 prompt 的完整 JD");
  });
});
