import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import type { AiCareerAdaptResumeV2MapperOutput } from "@/domain/schemas";
import {
  coerceResumeDocumentMapperOutput,
  normalizeResumeMapperBoundaryOutput
} from "@/ai/tasks/resumeDocumentMapperOutput";

const definition = aiTaskRegistry["resume-document-mapper"];
const input = {
  rawText: JSON.stringify([
    { id: "b-name", text: "张三" },
    { id: "b-role", text: "求职意向：Android研发实习生" },
    { id: "b-edu", text: "示例大学 | 计算机相关专业 本科 | 2021.09 - 2025.06" },
    { id: "b-project", text: "驱动桌面任务与学习规划系统 (示例任务系统) | 全栈开发 | 2024.03 至今" },
    { id: "b-project-bullet", text: "实现任务规划、学习路径生成与数据同步。" },
    { id: "b-skill-heading", text: "编程语言与框架" },
    { id: "b-skill", text: "Java/Kotlin：熟悉 Android 开发。" },
    { id: "b-unused", text: "未映射页脚" }
  ]),
  inputHash: "document-mapper-input"
};

describe("resume-document-mapper canonical v2 boundary", () => {
  it("prompts for canonical v2 output with compact sourceRefs", () => {
    const prompt = JSON.parse(definition.buildUserPrompt(input)) as Record<string, unknown>;
    expect(prompt).toMatchObject({ schemaVersion: "resume-import-v2" });
    expect(prompt.outputContract).toHaveProperty("resume");
    expect(prompt.outputContract).toHaveProperty("sourceRefs");
    expect(definition.systemPrompt).toContain("CareerAdapt Resume JSON v2");
    expect(definition.systemPrompt).toContain("Never flatten");
    expect(definition.systemPrompt).toContain("Never echo source text or sourceValues");
    expect(definition.systemPrompt).not.toContain("structured-resume-draft-v1");
  });

  it("rejects the legacy generic structuredDraft contract", () => {
    expect(() => coerceResumeDocumentMapperOutput({
      structuredDraft: { schemaVersion: "structured-resume-draft-v1", basics: {}, sections: [] }
    })).toThrow("resume_document_mapper_output_cannot_be_safely_coerced");
  });

  it("normalizes target role, education, project title, skill category, and current dates losslessly", () => {
    const normalized = normalizeResumeMapperBoundaryOutput({
      resume: {
        schemaVersion: "careeradapt-resume-v2",
        basics: {
          name: "张三",
          targetRole: "Android研发实习生"
        },
        sections: [
          {
            sectionType: "education",
            title: "教育经历",
            items: [{
              sectionType: "education",
              school: "示例大学",
              major: "计算机相关专业",
              degree: "本科",
              startDate: "2021.09",
              endDate: "2025.06"
            }]
          },
          {
            sectionType: "project",
            title: "项目经历",
            items: [{
              sectionType: "project",
              title: "驱动桌面任务与学习规划系统 (示例任务系统)",
              role: "全栈开发",
              startDate: "2024.03",
              endDate: "至今",
              current: true,
              highlights: ["实现任务规划、学习路径生成与数据同步。"]
            }]
          },
          {
            sectionType: "skills",
            title: "技能",
            items: [{
              sectionType: "skills",
              name: "Java/Kotlin",
              category: "编程语言与框架",
              description: "熟悉 Android 开发。"
            }]
          }
        ]
      },
      sourceRefs: [
        { path: "/basics/name", blockIds: ["b-name"] },
        { path: "/basics/targetRole", blockIds: ["b-role"] },
        { path: "/sections/0/items/0", blockIds: ["b-edu"] },
        { path: "/sections/1/items/0", blockIds: ["b-project", "b-project-bullet"] },
        { path: "/sections/2/items/0", blockIds: ["b-skill-heading", "b-skill"] }
      ]
    }, JSON.parse(input.rawText)) as AiCareerAdaptResumeV2MapperOutput;

    expect(normalized.resume.basics).toMatchObject({
      name: "张三",
      headline: "Android研发实习生"
    });
    expect(normalized.resume.sections[0].items[0]).toMatchObject({
      sectionType: "education",
      school: "示例大学",
      major: "计算机相关专业",
      degree: "本科",
      startDate: "2021-09",
      endDate: "2025-06"
    });
    expect(normalized.resume.sections[1].items[0]).toMatchObject({
      sectionType: "project",
      title: "驱动桌面任务与学习规划系统 (示例任务系统)",
      role: "全栈开发",
      startDate: "2024-03",
      current: true
    });
    expect(normalized.resume.sections[1].items[0]).not.toHaveProperty("endDate");
    expect(normalized.resume.sections[2].items[0]).toMatchObject({
      sectionType: "skills",
      category: "编程语言与框架",
      name: "Java/Kotlin",
      description: "熟悉 Android 开发。"
    });
    expect(normalized.sourceRefs.flatMap((ref) => Object.keys(ref))).not.toContain("sourceValues");
    expect(() => definition.validateOutput(normalized, input)).not.toThrow();
  });

  it("merges repeated same-title same-type sections into independent items", () => {
    const normalized = normalizeResumeMapperBoundaryOutput({
      resume: {
        schemaVersion: "careeradapt-resume-v2",
        basics: {},
        sections: [
          { sectionType: "project", title: "项目经历", items: [{ sectionType: "project", title: "项目 A" }] },
          { sectionType: "project", title: "项目经历", items: [{ sectionType: "project", title: "项目 B" }] }
        ]
      },
      sourceRefs: [
        { path: "/sections/0/items/0", blockIds: ["p1"] },
        { path: "/sections/1/items/0", blockIds: ["p2"] }
      ]
    }, [{ id: "p1", text: "项目 A" }, { id: "p2", text: "项目 B" }]) as AiCareerAdaptResumeV2MapperOutput;

    expect(normalized.resume.sections).toHaveLength(1);
    expect(normalized.resume.sections[0].items.map((item) => "title" in item ? item.title : undefined)).toEqual(["项目 A", "项目 B"]);
  });

  it("quarantines an ungrounded field without destroying the grounded item", () => {
    const normalized = normalizeResumeMapperBoundaryOutput({
      resume: {
        schemaVersion: "careeradapt-resume-v2",
        basics: {},
        sections: [{
          sectionType: "work",
          title: "工作经历",
          items: [{
            sectionType: "work",
            organization: "示例公司",
            role: "虚构职位"
          }]
        }]
      },
      sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["w1"] }]
    }, [{ id: "w1", text: "示例公司" }]) as AiCareerAdaptResumeV2MapperOutput;

    expect(normalized.resume.sections[0].items[0]).toMatchObject({
      organization: "示例公司"
    });
    expect(normalized.resume.sections[0].items[0]).not.toHaveProperty("role");
    expect(normalized.mapperDiagnostics?.rejectedFields).toContainEqual({
      path: "/sections/0/items/0/role",
      reason: "ai_field_not_grounded"
    });
    expect(normalized.unclassifiedRefs).toContainEqual(expect.objectContaining({
      blockIds: ["w1"]
    }));
  });

  it("rejects systematically unsupported facts and fabricated block ids", () => {
    expect(() => normalizeResumeMapperBoundaryOutput({
      resume: {
        schemaVersion: "careeradapt-resume-v2",
        basics: {},
        sections: [{
          sectionType: "work",
          title: "工作经历",
          items: [{
            sectionType: "work",
            organization: "虚构公司",
            role: "虚构职位",
            description: "虚构职责"
          }]
        }]
      },
      sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["fake-1", "fake-2", "fake-3"] }]
    }, [{ id: "real", text: "真实来源" }])).toThrow("resume_document_mapper_systematic_grounding_failure");
  });
});
