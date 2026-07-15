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
    const mapped = ResumeJsonMapperOutputSchema.parse(mapExternalResumeJson(input));
    expect(mapped.structuredDraft.basics.name).toMatchObject({ value: "陈同学", mapping: { sourcePaths: ["personalInfo.name"] } });
    expect(mapped.structuredDraft.sections.map((section) => section.category)).toEqual(["work", "skill"]);
    expect(mapped.unclassifiedBlocks).toContainEqual(expect.objectContaining({ sourcePath: "privateNote", sourceValue: "不得丢弃" }));
  });

  it("does not create mapped values that are absent from source values", () => {
    const mapped = mapExternalResumeJson({ projects: [{ name: "原始项目", role: "成员", bullets: ["完成数据清洗"] }] });
    const serializedSources = JSON.stringify(mapped.structuredDraft.sections.flatMap((section) => section.items).flatMap((item) => typeof item === "string" ? [] : item.mapping?.sourceValues ?? []));
    expect(serializedSources).toContain("原始项目");
    expect(serializedSources).toContain("成员");
    expect(serializedSources).not.toContain("负责人");
  });
});
