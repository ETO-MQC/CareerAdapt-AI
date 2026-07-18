import { describe, expect, it } from "vitest";
import type { ResumeItemV2 } from "@/domain/schemas";
import {
  RESUME_PRESENTATION_ALLOWED_LABELS,
  formatResumePresentationDate,
  formatResumePresentationDateRange,
  projectResumePresentationItem
} from "@/domain/resumePresentation/projector";

describe("resume presentation contract", () => {
  it("normalizes year and month dates without inventing a day", () => {
    expect(formatResumePresentationDate("2024")).toBe("2024");
    expect(formatResumePresentationDate("2024-09")).toBe("2024.09");
    expect(formatResumePresentationDate("2024-09-01")).toBe("2024.09");
    expect(formatResumePresentationDateRange("2024-09", "2028-06")).toBe("2024.09–2028.06");
    expect(formatResumePresentationDateRange("2024-09", undefined, true)).toBe("2024.09–至今");
  });

  it("projects education without canonical field labels", () => {
    const item = projectResumePresentationItem({
      id: "education-1", sectionType: "education", school: "示例大学（示例高校）", degree: "本科",
      major: "计算机相关专业", location: "某地", startDate: "2024-09", endDate: "2028-06", current: false,
      gpa: 3.8, gpaScale: 4, rankPosition: 5, rankTotal: 120, courses: ["数据结构"], honors: ["校级荣誉"],
      description: "计算机学院", highlights: ["参与课程项目"], customFields: []
    });
    expect(item).toMatchObject({
      primaryTitle: "示例大学（示例高校）",
      secondaryTitle: "本科 · 计算机相关专业",
      location: "某地",
      dateRange: "2024.09–2028.06",
      highlights: ["校级荣誉", "参与课程项目"]
    });
    expect(item.customRows.map((row) => row.label)).toEqual(["GPA", "专业排名", "核心课程"]);
  });

  it.each([
    ["work", { organization: "甲公司", role: "工程师", department: "平台部", location: "上海", startDate: "2023-01", current: true, description: "负责平台建设", highlights: ["交付版本"] }],
    ["internship", { organization: "乙公司", role: "实习生", location: "杭州", startDate: "2022-07", endDate: "2022-09", current: false, highlights: ["完成分析"] }],
    ["campus", { organization: "学生会", role: "负责人", location: "某地", current: false, highlights: ["组织活动"] }],
    ["volunteer", { organization: "志愿中心", role: "志愿者", current: false, highlights: ["完成服务"] }]
  ] as const)("projects %s experience fields into resume semantics", (sectionType, values) => {
    const input = { id: `${sectionType}-1`, sectionType, customFields: [], ...values, highlights: [...values.highlights] } as ResumeItemV2;
    const item = projectResumePresentationItem(input);
    expect(item.primaryTitle).toBe(values.organization);
    expect(item.secondaryTitle).toBe(values.role);
    expect(item.highlights).toEqual(values.highlights);
  });

  it("keeps project punctuation, links and independent highlights", () => {
    const item = projectResumePresentationItem({
      id: "project-1", sectionType: "project", title: "CareerAdapt / PDF—Pipeline", role: "负责人", organization: "开源团队",
      location: "远程", startDate: "2025-01", current: true, url: "https://example.com/project", tools: ["React", "TypeScript"],
      background: "项目背景", description: "项目说明", highlights: ["亮点一", "亮点二", "亮点一"], outcomes: ["亮点二", "成果一"], customFields: []
    });
    expect(item.primaryTitle).toBe("CareerAdapt / PDF—Pipeline");
    expect(item.dateRange).toBe("2025.01–至今");
    expect(item.links).toEqual(["https://example.com/project"]);
    expect(item.highlights).toEqual(["亮点一", "亮点二", "成果一"]);
  });

  it("projects awards, skills and languages as compact natural content", () => {
    expect(projectResumePresentationItem({ id: "a1", sectionType: "awards", name: "一等奖", level: "国家级", issuer: "组委会", awardedAt: "2025-05", customFields: [] })).toMatchObject({ primaryTitle: "一等奖", secondaryTitle: "国家级 · 组委会", dateRange: "2025.05" });
    expect(projectResumePresentationItem({ id: "s1", sectionType: "skills", name: "TypeScript", category: "工程开发", level: "熟练", customFields: [] })).toMatchObject({ primaryTitle: "TypeScript", groupLabel: "工程开发", secondaryTitle: "熟练" });
    expect(projectResumePresentationItem({ id: "l1", sectionType: "languages", language: "英语", level: "CET-4", description: "备考中", customFields: [] })).toMatchObject({ primaryTitle: "英语", secondaryTitle: "CET-4", description: "备考中" });
  });

  it("uses only the centralized canonical label whitelist and preserves custom fields", () => {
    expect(RESUME_PRESENTATION_ALLOWED_LABELS).toEqual({
      gpa: "GPA", rank: "专业排名", courses: "核心课程", tools: "技术栈", doi: "DOI",
      patentNumber: "专利号", credentialId: "证书编号"
    });
    const item = projectResumePresentationItem({
      id: "custom-1", sectionType: "custom", title: "社区贡献", highlights: [],
      customFields: [{ id: "stars", label: "Stars", valueType: "number", value: 120, order: 0, sensitive: false }]
    });
    expect(item.customRows).toEqual([{ label: "Stars", value: "120", displayMode: "inline" }]);
    expect(item.warnings).toHaveLength(1);
  });

  it("has a dedicated projector for every standard and flexible section", () => {
    const items: ResumeItemV2[] = [
      { id: "summary", sectionType: "summary", text: "摘要", customFields: [] },
      { id: "research", sectionType: "research", title: "研究", methods: [], current: false, highlights: [], customFields: [] },
      { id: "certificate", sectionType: "certificates", name: "证书", customFields: [] },
      { id: "publication", sectionType: "publications", title: "论文", authors: [], customFields: [] },
      { id: "patent", sectionType: "patents", title: "专利", inventors: [], customFields: [] },
      { id: "portfolio", sectionType: "portfolio", title: "作品", tools: [], highlights: [], customFields: [] },
      { id: "other", sectionType: "other", description: "其他内容", highlights: [], customFields: [] }
    ];
    for (const item of items) expect(projectResumePresentationItem(item).id).toBe(item.id);
  });
});
