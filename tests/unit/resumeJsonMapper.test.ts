import { describe, expect, it } from "vitest";
import { mapExternalResumeJson, parseResumeJsonText, RESUME_JSON_MAX_CHARS } from "@/domain/resumeImport/jsonMapper";
import { ResumeJsonMapperOutputSchema, StructuredResumeDraftSchema } from "@/domain/schemas";
import { sampleStructuredResumeJson } from "@/components/resume/import/ResumeImportWizard";

describe("resume JSON import adapter", () => {
  it("keeps the downloadable example complete and directly importable by the current schema", () => {
    const template = StructuredResumeDraftSchema.parse(sampleStructuredResumeJson());
    expect(template.sections.map((section) => section.category)).toEqual([
      "summary", "education", "work", "project", "campus", "award", "skill", "certificate", "language", "custom"
    ]);
    expect(JSON.parse(JSON.stringify(template))).toEqual(template);
  });

  it("reports empty, malformed, and oversized JSON without changing the input", () => {
    expect(parseResumeJsonText(" ")).toMatchObject({ ok: false, error: { message: "请先粘贴 JSON 内容。" } });
    expect(parseResumeJsonText('{"name":"A",}')).toMatchObject({ ok: false });
    expect(parseResumeJsonText(`{"value":"${"x".repeat(RESUME_JSON_MAX_CHARS)}"}`)).toMatchObject({ ok: false });
  });

  it("maps common aliases, preserves source paths, and keeps unknown leaves", () => {
    const input = {
      personalInfo: { name: "陈同学", email: "student@example.com" },
      workExperiences: [{ company: "示例科技", position: "数据实习生", details: ["整理周报"] }],
      technicalSkills: ["Excel", "SQL"],
      privateNote: "不得丢弃"
    };
    const result = mapExternalResumeJson(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const mapped = ResumeJsonMapperOutputSchema.parse(result.value);
    expect(mapped.structuredDraft.basics.name).toMatchObject({ value: "陈同学", mapping: { sourcePaths: ["personalInfo.name"] } });
    expect(mapped.structuredDraft.sections.map((section) => section.category)).toEqual(["work", "skill"]);
    expect(mapped.unclassifiedBlocks).toContainEqual(expect.objectContaining({ sourcePath: "privateNote", sourceValue: "不得丢弃" }));
  });

  it("does not create mapped values that are absent from source values", () => {
    const result = mapExternalResumeJson({ projects: [{ name: "原始项目", role: "成员", bullets: ["完成数据清洗"] }] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    const mapped = result.value;
    const serializedSources = JSON.stringify(mapped.structuredDraft.sections.flatMap((section) => section.items).flatMap((item) => typeof item === "string" ? [] : item.mapping?.sourceValues ?? []));
    expect(serializedSources).toContain("原始项目");
    expect(serializedSources).toContain("成员");
    expect(serializedSources).not.toContain("负责人");
  });

  it("preserves structured items that become empty after defensive cleaning", () => {
    const original = {
      schemaVersion: "structured-resume-draft-v1",
      sections: [{
        title: "教育经历",
        category: "education",
        sectionType: "experience",
        items: [{ organization: "  ", role: "", highlights: ["", "   "], vendorId: "keep-me" }]
      }]
    };
    const result = mapExternalResumeJson(original);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.structuredDraft.sections).toHaveLength(1);
    expect(result.value.structuredDraft.sections[0]?.items).toEqual([]);
    expect(result.value.unclassifiedBlocks).toContainEqual({
      sourcePath: "sections[0].items[0]",
      sourceValue: original.sections[0].items[0],
      reason: "清洗后无有效内容，保留原对象供人工核对。"
    });
    expect(original.sections[0].items[0]).toEqual({ organization: "  ", role: "", highlights: ["", "   "], vendorId: "keep-me" });
  });

  it("preserves unknown leaves inside a recognized structured item", () => {
    const result = mapExternalResumeJson({
      schemaVersion: "structured-resume-draft-v1",
      sections: [{
        title: "项目经历",
        category: "project",
        sectionType: "experience",
        items: [{ organization: "项目 A", role: "成员", vendorMetadata: { source: "legacy" } }]
      }]
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.value.unclassifiedBlocks).toContainEqual(expect.objectContaining({
      sourcePath: "sections[0].items[0].vendorMetadata.source",
      sourceValue: "legacy"
    }));
  });
});
