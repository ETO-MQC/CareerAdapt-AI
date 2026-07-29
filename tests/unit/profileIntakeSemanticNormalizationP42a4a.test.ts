import { describe, expect, it } from "vitest";
import { ResumeItemV2Schema } from "@/domain/schemas";
import {
  applyProfileIntakeStructuredPatch,
  normalizeCareerMonth,
  ProfileIntakeNormalizer,
  profileIntakeCareerReadyText
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

  it("keeps provider-failure fallback raw, reviewable, and explicitly unnormalized", () => {
    const raw = "嗯，就是在一家新公司帮忙整理过资料，具体名称我还要确认。";
    const result = new ProfileIntakeNormalizer().fallback(raw);

    expect(result).toMatchObject({
      sectionType: "other",
      normalizedText: raw,
      needsConfirmation: true,
      needsNormalization: true
    });
    expect(result.fieldEvidence[0]).toMatchObject({ sourceQuote: raw, support: "explicit" });
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
});
