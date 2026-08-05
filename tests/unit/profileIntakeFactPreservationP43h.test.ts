import { describe, expect, it } from "vitest";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { isProfileIntakeEvidence } from "@/agent/runtime/AgentTaskStateReducer";

function serviceFor(input: { candidates: unknown[] }, seen?: { currentDate?: string }) {
  return new ProfileIntakeSemanticService(async (semanticInput) => {
    if (seen) seen.currentDate = semanticInput.currentDate;
    return { ok: true as const, data: { ...input, followUpQuestions: [] } as never };
  });
}

describe("P4.3h Profile Intake fact preservation", () => {
  it("does not upgrade 协助开发 or RPA 采集 into independent or compliance claims", async () => {
    const narrative = "我协助开发一个流程，使用 RPA 技术采集数据。";
    const result = await serviceFor({ candidates: [{
      candidateKey: "unsafe-project",
      sectionType: "project",
      sourceSpan: { start: 0, end: narrative.length },
      structuredItem: {
        sectionType: "project",
        title: "数据流程",
        description: "独立完成合规采集流程"
      },
      professionalText: "独立完成合规采集流程",
      uncertainFields: []
    }]}).normalize({ rawNarrative: narrative });

    expect(result.mode).toBe("deterministic");
    expect(result.candidates[0]?.normalization.normalizedText).not.toContain("独立完成");
    expect(result.candidates[0]?.normalization.normalizedText).not.toContain("合规采集");
    expect(result.candidates[0]?.sourceQuote).toBe(narrative);
  });

  it("quarantines a competition that the model incorrectly classifies as a project", async () => {
    const narrative = "2026年参加启明杯编程竞赛并获得三等奖。";
    const result = await serviceFor({ candidates: [{
      candidateKey: "competition-as-project",
      sectionType: "project",
      sourceSpan: { start: 0, end: narrative.length },
      structuredItem: {
        sectionType: "project",
        title: "启明杯",
        description: "参加编程竞赛并获得三等奖"
      },
      professionalText: "启明杯项目",
      uncertainFields: []
    }]}).normalize({ rawNarrative: narrative });

    expect(result.candidates.every((candidate) => candidate.normalization.structuredItem?.sectionType !== "project")).toBe(true);
  });

  it("injects the caller-provided runtime date into the semantic boundary", async () => {
    const seen: { currentDate?: string } = {};
    const narrative = "2026年6月完成校内研究。";
    await serviceFor({ candidates: [] }, seen).normalize({ rawNarrative: narrative, currentDate: "2026-08-05" });
    expect(seen.currentDate).toBe("2026-08-05");
  });

  it("treats a spaced date correction as authoritative intake evidence", () => {
    expect(isProfileIntakeEvidence(
      "我更正时间为 2026 年 6 月，之前写成 2025 年是笔误；截至 2026 年仍在推进。",
      { stage: "collect_experience", turnKind: "follow_up_answer" }
    )).toBe(true);
  });
});
