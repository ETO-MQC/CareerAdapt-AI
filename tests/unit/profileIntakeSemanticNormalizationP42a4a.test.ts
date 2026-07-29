import { describe, expect, it } from "vitest";
import { ResumeItemV2Schema } from "@/domain/schemas";
import {
  applyProfileIntakeStructuredPatch,
  normalizeCareerMonth,
  ProfileIntakeNormalizer,
  profileIntakeCareerReadyText,
  validateProfileIntakeStructuredPatch
} from "@/domain/profileIntake/ProfileIntakeNormalizer";

describe("P4.2a.4a deterministic profile intake normalization layer", () => {
  it.each([
    ["2026年2月", "2026-02"],
    ["2026.2", "2026-02"],
    ["2026-02", "2026-02"]
  ])("canonicalizes month precision without inventing a day", (input, expected) => {
    expect(normalizeCareerMonth(input)).toBe(expected);
    expect(expected).not.toMatch(/^\d{4}-\d{2}-\d{2}$/u);
  });

  it("applies a grounded date patch to an already classified project", () => {
    const project = ResumeItemV2Schema.parse({
      id: "project-generic",
      sectionType: "project",
      title: "TideNote",
      current: false,
      tools: ["Rust"],
      highlights: [],
      outcomes: [],
      customFields: []
    });
    const patched = applyProfileIntakeStructuredPatch(project, {
      startDate: "2026.02",
      endDate: "2026.05",
      current: false
    });

    expect(patched).toMatchObject({ startDate: "2026-02", endDate: "2026-05", current: false });
  });

  it("clears endDate when a follow-up explicitly marks an item current", () => {
    const item = ResumeItemV2Schema.parse({
      id: "work-generic",
      sectionType: "work",
      organization: "海岚物流",
      role: "运营实习生",
      startDate: "2025-06",
      endDate: "2025-08",
      current: false,
      highlights: [],
      customFields: []
    });
    const patched = applyProfileIntakeStructuredPatch(item, { current: true });

    expect(patched).toMatchObject({ current: true });
    expect("endDate" in patched ? patched.endDate : undefined).toBeUndefined();
  });

  it("uses awardedAt for awards and rejects range fields", () => {
    const award = ResumeItemV2Schema.parse({
      id: "award-generic",
      sectionType: "awards",
      name: "启明杯华东赛区二等奖",
      customFields: []
    });
    expect(applyProfileIntakeStructuredPatch(award, { awardedAt: "2024.11" })).toMatchObject({
      awardedAt: "2024-11"
    });
    expect(() => applyProfileIntakeStructuredPatch(award, { startDate: "2024.11" })).toThrow(
      "profile_intake_award_requires_awarded_at"
    );
  });

  it("keeps provider-failure fallback raw, reviewable, dated, and explicitly unnormalized", () => {
    const raw = "嗯，2025年3月就是在一家新公司帮忙整理过资料，具体名称我还要确认。";
    const result = new ProfileIntakeNormalizer().fallback(raw);

    expect(result).toMatchObject({
      sectionType: "other",
      normalizedText: "原始回答已保留，等待职业化整理。",
      needsConfirmation: true,
      needsNormalization: true,
      deterministicDatePatch: { startDate: "2025-03" }
    });
    expect(result.structuredItem).toMatchObject({ description: "原始回答已保留，等待职业化整理。" });
    expect("description" in result.structuredItem! ? result.structuredItem!.description : undefined).not.toBe(raw);
    expect(result.fieldEvidence[0]).toMatchObject({ field: "rawNarrative", sourceQuote: raw, support: "explicit" });
  });

  it("renders professional text from validated structured fields rather than operation metadata", () => {
    const item = ResumeItemV2Schema.parse({
      id: "project-copy",
      sectionType: "project",
      title: "山岚咖啡门店分析",
      description: "使用 SQL 整理订单并通过 Tableau 分析时段分布。",
      highlights: ["形成门店选址建议。"],
      tools: ["SQL", "Tableau"],
      outcomes: [],
      current: false,
      customFields: []
    });

    expect(profileIntakeCareerReadyText(item)).toBe(
      "使用 SQL 整理订单并通过 Tableau 分析时段分布。\n形成门店选址建议。"
    );
  });

  it("rejects an unsupported role when the follow-up only supplies a date", () => {
    const project = ResumeItemV2Schema.parse({
      id: "project-date-only",
      sectionType: "project",
      title: "TideNote",
      current: false,
      tools: [],
      highlights: [],
      outcomes: [],
      customFields: []
    });
    expect(() => validateProfileIntakeStructuredPatch({
      item: project,
      rawPatch: { startDate: "2026.02", role: "项目负责人" },
      evidenceSources: [{ sourceQuote: "时间是 2026年2月。" }]
    })).toThrow("profile_intake_patch_field_unsupported:role");
  });

  it.each([
    ["invented tool", "我参与整理用户反馈。", "使用 Python 整理用户反馈。", "new_tool"],
    ["responsibility upgrade", "我协助整理用户反馈。", "负责整理用户反馈。", "participation_to_owner"]
  ])("rejects %s in derived follow-up wording", (_, sourceQuote, description, finding) => {
    const project = ResumeItemV2Schema.parse({
      id: "project-derived-guard",
      sectionType: "project",
      title: "反馈整理",
      current: false,
      tools: [],
      highlights: [],
      outcomes: [],
      customFields: []
    });
    expect(() => validateProfileIntakeStructuredPatch({
      item: project,
      rawPatch: { description },
      evidenceSources: [{ sourceQuote }]
    })).toThrow(finding);
  });

  it("accepts a grounded later project outcome and records derived evidence honestly", () => {
    const project = ResumeItemV2Schema.parse({
      id: "project-outcome",
      sectionType: "project",
      title: "门店分析",
      current: false,
      tools: ["SQL"],
      highlights: [],
      outcomes: [],
      customFields: []
    });
    const validated = validateProfileIntakeStructuredPatch({
      item: project,
      rawPatch: { outcomes: ["交付门店选址建议。"] },
      evidenceSources: [{ sourceQuote: "最后交了一份门店选址建议。" }]
    });
    const patched = applyProfileIntakeStructuredPatch(project, validated.patch);

    expect(patched.sectionType === "project" ? patched.outcomes : []).toEqual(["交付门店选址建议。"]);
    expect(validated.fieldEvidence).toEqual([
      expect.objectContaining({ field: "outcomes", support: "derived", needsConfirmation: false })
    ]);
  });
});
