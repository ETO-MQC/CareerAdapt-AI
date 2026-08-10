import { describe, expect, it } from "vitest";
import { CareerAdaptResumeJsonV2Schema } from "@/domain/schemas";
import { adaptResumeJsonToV2, createResumeJsonV2Example, jsonV2ToLegacyMapperOutput, v1ToJsonV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { resumeFieldCatalog, resumeSectionCapabilityMatrix, resumeSectionCatalog, RESUME_CATALOG_VERSION } from "@/domain/resumeFields";
import { fullAiTemplateFixture } from "../fixtures/resume-v2/fullAiTemplate";

describe("careeradapt resume JSON v2", () => {
  it("round-trips strict v2 including custom fields and custom sections", () => {
    const example = createResumeJsonV2Example();
    const withCustom = CareerAdaptResumeJsonV2Schema.parse({
      ...example,
      sections: [...example.sections, { id: "custom-1", sectionType: "custom", title: "开源贡献", order: 17, visible: true, items: [{ id: "custom-item-extra", sectionType: "custom", description: "维护组件库", highlights: [], customFields: [{ id: "stars", label: "Stars", valueType: "number", value: 120, order: 0 }] }] }]
    });
    expect(CareerAdaptResumeJsonV2Schema.parse(JSON.parse(JSON.stringify(withCustom)))).toEqual(withCustom);
  });

  it("keeps the placeholder-free full AI fixture aligned with every canonical catalog field", () => {
    expect(RESUME_CATALOG_VERSION).toBe("resume-field-catalog-v2.1.1");
    expect(CareerAdaptResumeJsonV2Schema.parse(fullAiTemplateFixture)).toEqual(fullAiTemplateFixture);
    expect(JSON.stringify(fullAiTemplateFixture)).not.toMatch(/\{\{|\}\}/);
    for (const field of resumeFieldCatalog) {
      const key = field.id.split(".").at(-1)!;
      const value = field.sectionType === "basics"
        ? (fullAiTemplateFixture.basics as unknown as Record<string, unknown>)[key]
        : (fullAiTemplateFixture.sections.find((section) => section.sectionType === field.sectionType)?.items[0] as unknown as Record<string, unknown> | undefined)?.[key];
      expect(value, field.id).not.toBeUndefined();
    }
    expect(resumeSectionCapabilityMatrix.map((entry) => entry.sectionType)).toEqual(resumeSectionCatalog.map((section) => section.id));
    expect(resumeSectionCapabilityMatrix.every((entry) => entry.rendererSupport && entry.templateSupport === "native" && entry.preservesCustomFields)).toBe(true);
  });

  it("adapts the supplied AI template dialect without weakening the strict export schema", () => {
    const result = adaptResumeJsonToV2({
      schemaVersion: "careeradapt-resume-v2",
      locale: "zh-CN",
      basics: { name: "陈同学", summary: "顶部简介", links: ["https://github.com/example"] },
      sections: [
        { id: "publication", type: "publications", title: "论文与出版", items: [{ id: "publication-1", title: "论文", authors: ["陈同学"], publication: "示例期刊", customFields: [] }] },
        { id: "patent", type: "patents", title: "专利", items: [{ id: "patent-1", title: "专利", role: "第一发明人", customFields: [] }] },
        { id: "portfolio", type: "portfolio", title: "作品集", items: [{ id: "portfolio-1", title: "作品", portfolioType: "网页", customFields: [] }] },
        { id: "other", type: "other", title: "其他内容", items: [{ id: "other-1", text: "补充内容", customFields: [] }] },
        { id: "custom", type: "custom", title: "自定义", items: [{ id: "custom-1", customFields: [{ id: "custom-field", label: "字段", valueType: "string", value: "值", displayOrder: 10 }] }] }
      ],
      unclassifiedBlocks: []
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.basics).toMatchObject({ summary: "顶部简介", otherLinks: ["https://github.com/example"] });
    expect(result.value.sections.find((section) => section.sectionType === "publications")?.items[0]).toMatchObject({ publisher: "示例期刊" });
    expect(result.value.sections.find((section) => section.sectionType === "patents")?.items[0]?.customFields).toContainEqual(expect.objectContaining({ label: "角色", value: "第一发明人" }));
    expect(result.value.sections.find((section) => section.sectionType === "portfolio")?.items[0]).toMatchObject({ type: "网页" });
    expect(result.value.sections.find((section) => section.sectionType === "other")?.items[0]).toMatchObject({ description: "补充内容" });
  });

  it("rejects unknown DTO fields instead of stripping them", () => {
    const invalid = { ...createResumeJsonV2Example(), internalBranchId: "secret" };
    expect(CareerAdaptResumeJsonV2Schema.safeParse(invalid).success).toBe(false);
    expect(adaptResumeJsonToV2(invalid).ok).toBe(false);
  });

  it("projects every canonical v2 field into the legacy review without silent loss", () => {
    const example = createResumeJsonV2Example();
    const review = jsonV2ToLegacyMapperOutput(example);
    const education = review.structuredDraft.sections.find((section) => section.category === "education");
    expect(education?.items.join("\n")).toContain("GPA：3.8");
    expect(education?.items.join("\n")).toContain("GPA 满分：4");
    expect(education?.items.join("\n")).toContain("主修课程：统计建模");
  });

  it("converts structured-resume-draft-v1 conservatively", () => {
    const converted = v1ToJsonV2({ schemaVersion: "structured-resume-draft-v1", basics: { name: "陈同学" }, sections: [{ title: "工作经历", sectionType: "experience", category: "work", items: [{ organization: "甲公司", role: "工程师", text: "负责数据平台" }] }] });
    expect(converted.basics.name).toBe("陈同学");
    expect(converted.sections[0]?.sectionType).toBe("work");
    expect(converted.sections[0]?.items[0]).toMatchObject({ organization: "甲公司", role: "工程师", description: "负责数据平台" });
  });

  it("splits a legacy generic experience wrapper into canonical peer sections", () => {
    const converted = v1ToJsonV2({
      schemaVersion: "structured-resume-draft-v1",
      basics: { name: "陈同学" },
      sections: [{
        title: "经历",
        sectionType: "experience",
        items: [
          { organization: "示例大学", role: "统计学本科", text: "主修统计建模" },
          { organization: "示例公司", role: "数据实习生", text: "完成指标核对" },
          { organization: "示例任务系统 项目", role: "开发者", text: "构建任务系统" },
          { text: "省级竞赛二等奖" }
        ]
      }]
    });
    expect(converted.sections.map((section) => section.sectionType)).toEqual(["education", "internship", "project", "awards"]);
    expect(converted.sections.some((section) => section.title === "经历")).toBe(false);
  });

  it("routes external unknown values into v2 unclassified blocks", () => {
    const result = adaptResumeJsonToV2({ name: "陈同学", vendorPrivate: { code: 7 } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.sourceKind).toBe("external");
    expect(result.value.unclassifiedBlocks).toContainEqual(expect.objectContaining({ sourcePath: "vendorPrivate.code", sourceValue: 7 }));
  });
});
