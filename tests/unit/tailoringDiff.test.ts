import { describe, expect, it } from "vitest";
import {
  extractPhraseAwareKeywords,
  validateEachTailoringDiffLocally
} from "@/domain/jobOptimization";
import type { ResumeBranch, ResumeTailoringDiff } from "@/domain/schemas";

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
    contentItems: [{
      id: "project-1",
      text: "参与模型输出评估\n定位逻辑缺陷",
      factRefs: [{ type: "experience_fact", experienceId: "experience-1", factId: "fact-1" }]
    }],
    structuredContentItems: [{
      id: "project-1",
      order: 0,
      visible: true,
      data: {
        id: "project-1",
        sectionType: "project",
        title: "模型评估项目",
        description: "参与模型输出评估",
        highlights: ["参与模型输出评估", "定位逻辑缺陷"]
      }
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

describe("phrase-aware tailoring keywords", () => {
  it("retains complete core phrases while downweighting standalone generic tokens", () => {
    const keywords = extractPhraseAwareKeywords(["AI Coding 与 Coding Agent、Vibe Coding、AI Agent，AI"]);
    expect(keywords.map((item) => item.phrase)).toEqual(expect.arrayContaining(["AI Coding", "Coding Agent", "Vibe Coding", "AI Agent", "AI"]));
    expect(keywords.find((item) => item.phrase === "Coding Agent")?.weight).toBeGreaterThan(0.9);
    expect(keywords.find((item) => item.phrase === "AI")?.weight).toBeLessThan(0.2);
  });
});

describe("operation-aware resume diff validation", () => {
  it("accepts a meaningful low-change replace without a text-change-ratio gate", () => {
    const result = validateEachTailoringDiffLocally({ branch: branchFixture(), diffs: [diff()] });
    expect(result.appliedDiffs).toHaveLength(1);
    expect(result.rejectedDiffs).toHaveLength(0);
  });

  it("validates reorder by exact multiset instead of text change ratio", () => {
    const result = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [diff({
        target: { sectionId: "project", itemId: "project-1", fieldPath: "highlights" },
        operation: "reorder",
        original: ["参与模型输出评估", "定位逻辑缺陷"],
        value: ["定位逻辑缺陷", "参与模型输出评估"]
      })]
    });
    expect(result.appliedDiffs).toHaveLength(1);
  });

  it("rejects presentation-affecting diffs in submission-safe mode", () => {
    const result = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      submissionSafe: true,
      diffs: [diff({
        target: { sectionId: "project", itemId: "project-1", fieldPath: "visible" },
        operation: "hide",
        original: true,
        value: false
      })]
    });
    expect(result.appliedDiffs).toHaveLength(0);
    expect(result.rejectedDiffs[0]?.reasonCode).toBe("path_not_allowed");
  });

  it("rejects stale originals and identity paths without rejecting valid sibling diffs", () => {
    const result = validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [
        diff(),
        diff({ original: "旧 Revision 的值" }),
        diff({
          target: { sectionId: "project", itemId: "project-1", fieldPath: "name" },
          original: "",
          value: "改写项目标题"
        })
      ]
    });
    expect(result.appliedDiffs).toHaveLength(1);
    expect(result.rejectedDiffs.map((item) => item.reasonCode)).toEqual(["original_mismatch", "blocked_identity_path"]);
  });

  it("requires confirmation for inference at apply time", () => {
    const candidate = diff({ supportLevel: "reasonable_inference", evidenceRefs: [] });
    expect(validateEachTailoringDiffLocally({ branch: branchFixture(), diffs: [candidate], allowUnconfirmed: false }).rejectedDiffs[0].reasonCode).toBe("confirmation_required");
    expect(validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [candidate],
      allowUnconfirmed: false,
      confirmedRequirementIds: ["req-eval"]
    }).appliedDiffs).toHaveLength(1);
    expect(validateEachTailoringDiffLocally({
      branch: branchFixture(),
      diffs: [candidate],
      explicitlyAcceptedDiffs: [candidate],
      allowUnconfirmed: false
    }).appliedDiffs).toHaveLength(1);
  });
});
