import { describe, expect, it } from "vitest";
import { CareerAdaptResumeJsonV2Schema } from "@/domain/schemas";
import { adaptResumeJsonToV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { adaptWenmoResumeJson, cleanExternalResumeText, normalizeExternalResumeDate } from "@/domain/resumeImport/wenmoJsonAdapter";
import { wenmoPairedJsonFixture } from "../fixtures/resume-import/wenmo-paired";

describe("Wenmo external JSON adapter", () => {
  it("maps the paired resume into canonical v2 without changing the abnormal phone", () => {
    const result = adaptWenmoResumeJson(wenmoPairedJsonFixture);
    expect(() => CareerAdaptResumeJsonV2Schema.parse(result.canonicalResume)).not.toThrow();
    expect(result.canonicalResume.basics).toMatchObject({
      name: "示例用户", phone: "138001380000", email: "demo.user@example.com", targetRole: "开发工程师"
    });
    expect(result.issues).toEqual([expect.objectContaining({ code: "abnormal_phone_format", value: "138001380000", needsConfirmation: true })]);
    expect(counts(result.canonicalResume)).toEqual({ summary: 1, education: 1, internship: 2, project: 3, skills: 4, certificates: 0, experience: 0 });
  });

  it("keeps education and project roles in independent canonical fields", () => {
    const resume = adaptWenmoResumeJson(wenmoPairedJsonFixture).canonicalResume;
    expect(resume.sections.find((section) => section.sectionType === "education")?.items[0]).toMatchObject({
      school: "示例大学", major: "计算机相关专业", degree: "本科", startDate: "2024-09", endDate: "2028-06"
    });
    expect(resume.sections.find((section) => section.sectionType === "project")?.items[0]).toMatchObject({ title: "示例任务系统", role: "全栈开发" });
    expect(resume.sections.find((section) => section.sectionType === "skills")?.items).toHaveLength(4);
  });

  it("removes markup, entities, zero-width characters, CR/LF and bullet markers", () => {
    expect(cleanExternalResumeText("<strong>&#8203; A\r\n B&nbsp;</strong>")).toBe("A B");
    expect(normalizeExternalResumeDate("2026年2月")).toBe("2026-02");
    const highlights = adaptWenmoResumeJson(wenmoPairedJsonFixture).canonicalResume.sections
      .find((section) => section.sectionType === "internship")?.items.flatMap((item) => "highlights" in item ? item.highlights : []) ?? [];
    expect(highlights.every((highlight) => !/^[•·●▪◦■□◆◇▶►*-]/u.test(highlight))).toBe(true);
    expect(highlights).not.toContain("隐藏教育信息");
  });

  it("is selected by the public JSON v2 adapter", () => {
    const result = adaptResumeJsonToV2(wenmoPairedJsonFixture);
    expect(result).toMatchObject({ ok: true, sourceKind: "external" });
    if (!result.ok) throw new Error(result.message);
    expect(result.validationIssues).toHaveLength(1);
    expect(counts(result.value).experience).toBe(0);
  });
});

function counts(resume: ReturnType<typeof adaptWenmoResumeJson>["canonicalResume"]) {
  const count = (sectionType: string) => resume.sections.filter((section) => section.sectionType === sectionType).reduce((sum, section) => sum + section.items.length, 0);
  return { summary: count("summary"), education: count("education"), internship: count("internship"), project: count("project"), skills: count("skills"), certificates: count("certificates"), experience: count("experience") };
}
