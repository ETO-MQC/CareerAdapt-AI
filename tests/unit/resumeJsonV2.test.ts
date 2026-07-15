import { describe, expect, it } from "vitest";
import { CareerAdaptResumeJsonV2Schema } from "@/domain/schemas";
import { adaptResumeJsonToV2, createResumeJsonV2Example, jsonV2ToLegacyMapperOutput, v1ToJsonV2 } from "@/domain/resumeImport/jsonV2Adapter";

describe("careeradapt resume JSON v2", () => {
  it("round-trips strict v2 including custom fields and custom sections", () => {
    const example = createResumeJsonV2Example();
    const withCustom = CareerAdaptResumeJsonV2Schema.parse({
      ...example,
      sections: [...example.sections, { id: "custom-1", sectionType: "custom", title: "开源贡献", order: 2, visible: true, items: [{ id: "custom-item-1", sectionType: "custom", description: "维护组件库", highlights: [], customFields: [{ id: "stars", label: "Stars", valueType: "number", value: 120, order: 0 }] }] }]
    });
    expect(CareerAdaptResumeJsonV2Schema.parse(JSON.parse(JSON.stringify(withCustom)))).toEqual(withCustom);
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

  it("routes external unknown values into v2 unclassified blocks", () => {
    const result = adaptResumeJsonToV2({ name: "陈同学", vendorPrivate: { code: 7 } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.sourceKind).toBe("external");
    expect(result.value.unclassifiedBlocks).toContainEqual(expect.objectContaining({ sourcePath: "vendorPrivate.code", sourceValue: 7 }));
  });
});
