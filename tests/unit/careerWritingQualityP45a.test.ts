import { describe, expect, it } from "vitest";
import { ProfileIntakeFinalCareerSynthesisAssetSchema } from "@/domain/profileIntake/ProfileIntakeFinalCareerSynthesis";
import { dedupeCareerWriting, preservesOwnership, writingOverlap } from "@/domain/profileIntake/CareerWritingQuality";

describe("P4.5a career writing quality", () => {
  it("allows zero or one reliable highlight instead of filler bullets", () => {
    const base = {
      candidateId: "asset-1",
      structuredItem: {
        id: "asset-1",
        sectionType: "project" as const,
        title: "Smart Fox",
        role: "参与者",
        tools: [],
        highlights: [],
        outcomes: [],
        current: false,
        customFields: []
      },
      careerReadySummary: "参与 Smart Fox 项目。",
      missingDimensions: ["result"],
      conflicts: []
    };
    expect(ProfileIntakeFinalCareerSynthesisAssetSchema.parse({
      ...base,
      careerReadyHighlights: ["参与 Smart Fox 项目。"]
    }).careerReadyHighlights).toHaveLength(1);
    expect(ProfileIntakeFinalCareerSynthesisAssetSchema.parse({ ...base, careerReadyHighlights: [] }).careerReadyHighlights).toEqual([]);
  });

  it("removes exact, near, and filler duplicates without a vector index", () => {
    const values = dedupeCareerWriting([
      "使用 Python 完成数据清洗并交付训练数据集。",
      "使用 Python 完成数据清洗，交付训练数据集。",
      "来源事实：使用 Python 完成数据清洗。",
      "参与数据清洗工作。"
    ]);
    expect(values).toHaveLength(2);
    expect(writingOverlap(values[0], values[1])).toBeLessThan(0.72);
  });

  it("preserves ownership strength", () => {
    expect(preservesOwnership("参与课程项目，协助完成展示。", "负责课程项目并主导展示。")).toBe(false);
    expect(preservesOwnership("主要负责数据清洗。", "负责数据清洗并形成交付物。")).toBe(true);
  });
});

