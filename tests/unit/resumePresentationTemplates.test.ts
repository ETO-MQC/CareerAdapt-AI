import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { ResumePresentationConfigSchema, ResumeRenderModelSchema } from "@/domain/schemas";
import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";
import { createResumePaginationPlan, paginateResumeRenderModel } from "@/services/export/pagination";

const FORBIDDEN_DEBUG_LABELS = [
  "学校：", "专业：", "学位/学历：", "所在地：", "开始日期：", "结束日期：", "至今：", "进行中：",
  "组织：", "职位/角色：", "项目名称：", "角色：", "亮点：", "奖项名称：", "获奖日期：", "技能名称：", "语言："
];

function presentationFixture() {
  const resume = createResumeJsonV2Example();
  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v2",
    branchId: "presentation-branch",
    branchRevision: 1,
    branchCurrentRevisionId: "revision-1",
    branchName: "通用简历",
    jobTitle: resume.basics.targetRole ?? "通用简历",
    company: "通用",
    candidate: {
      name: resume.basics.name ?? "候选人",
      summary: resume.basics.summary,
      targetRole: resume.basics.targetRole,
      contacts: [resume.basics.phone, resume.basics.email, resume.basics.homepage, resume.basics.location].filter(Boolean)
    },
    sections: [],
    structuredSections: resume.sections.map((section) => ({
      sectionId: section.id,
      sectionType: section.sectionType,
      title: section.title,
      order: section.order,
      items: section.items.map((item) => ({
        sectionId: section.id,
        sectionType: section.sectionType,
        itemId: item.id,
        data: item,
        plainText: FORBIDDEN_DEBUG_LABELS.join("\n"),
        presentation: { ...projectResumePresentationItem(item), id: `branch-${item.id}` }
      }))
    })),
    compatibilityWarnings: [],
    safety: { ruleOnlyItemIds: [], visibleItemCount: resume.sections.reduce((count, section) => count + section.items.length, 0), excludedItemIds: [] },
    sourceTrace: { profileId: "profile-1", currentRevisionId: "revision-1", sourceProfileVersion: 1 }
  });
}

describe.each(resumeTemplates)("$id formal presentation", (template) => {
  it("renders the shared presentation contract without generic canonical labels", () => {
    const model = presentationFixture();
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(template.render(model));
    const text = host.textContent ?? "";

    for (const label of FORBIDDEN_DEBUG_LABELS) expect(text).not.toContain(label);
    expect(text).not.toContain("diagnostic-only");
    expect(host.querySelector('[data-render-section="experience"]')).toBeNull();
    expect([...host.querySelectorAll("h2")].filter((heading) => heading.textContent === "经历")).toHaveLength(0);

    if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 model");
    for (const section of model.structuredSections) {
      expect(host.querySelectorAll(`[data-render-section="${section.sectionType}"]`)).toHaveLength(1);
      for (const item of section.items) expect(host.querySelectorAll(`[data-source-item-id="${item.presentation.id}"]`)).toHaveLength(1);
    }

    expect(text).toContain("2022.09–2026.06");
    expect(text).toContain("本科 · 统计学");
    expect(text).toContain("示例大学");
    expect(text).toContain("数据分析");
    expect(text).toContain("英语");
    expect(host.querySelectorAll(".resume-presentation-highlights li").length).toBeGreaterThan(0);
    expect(host.querySelector('a[href="https://example.com/project"]')).not.toBeNull();
    const internship = host.querySelector('[data-render-section="internship"]');
    expect(internship?.textContent).toContain("示例研究院");
    expect(internship?.textContent).toMatch(/实习|工程师|分析/);
    expect(internship?.querySelector("time")?.textContent).toMatch(/\d{4}/);
    expect(internship?.querySelectorAll(".resume-presentation-highlights li").length).toBeGreaterThan(0);
    const project = host.querySelector('[data-render-section="project"]');
    expect(project?.querySelectorAll(".resume-presentation-highlights li").length).toBeGreaterThanOrEqual(2);
    const skillItems = host.querySelectorAll(".resume-skill-item");
    expect(skillItems.length).toBeGreaterThan(0);
    expect([...skillItems].every((item) => item.querySelector(".resume-skill-name"))).toBe(true);
    expect([...skillItems].every((item) => {
      const heading = item.querySelector(".resume-skill-heading");
      return heading?.querySelector(".resume-skill-name")
        && heading.querySelector(".resume-skill-level")
        && item.querySelector(".resume-skill-description");
    })).toBe(true);
    const education = host.querySelector('[data-render-section="education"]')!;
    const educationText = education.textContent!;
    expect(educationText.indexOf("GPA")).toBeLessThan(educationText.indexOf("荣誉奖项"));
    expect(educationText.indexOf("荣誉奖项")).toBeLessThan(educationText.indexOf("核心课程"));
    expect(education.querySelector('[data-pagination-unit="education-honors"] strong')?.textContent).toBe("荣誉奖项：");
  });
});

it("uses the reference education structure while preserving movable section identities", () => {
  const model = presentationFixture();
  const template = resumeTemplates.find((entry) => entry.id === "classic-technical")!;
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(template.render(model));
  const education = host.querySelector('[data-render-section="education"]')!;
  const text = education.textContent!;
  expect(text.indexOf("GPA")).toBeLessThan(text.indexOf("优秀学生"));
  expect(text.indexOf("专业排名")).toBeLessThan(text.indexOf("优秀学生"));
  expect(text.indexOf("优秀学生")).toBeLessThan(text.indexOf("核心课程"));
  expect(text).toContain("3.8/4");
  expect(text).toContain("5/120");
  expect(text).toContain("统计建模");
  if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 model");
  const ordered = [...model.structuredSections].reverse().map((section) => section.sectionId);
  const config = ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "presentation-branch", templateId: "classic-technical", contentRevision: { branchRevision: 1, currentRevisionId: "revision-1" }, canonicalSectionOrder: ordered, presentationRevision: 0, updatedAt: "2026-11-20T00:00:00.000Z" });
  const reversedModel = { ...model, structuredSections: [...model.structuredSections].reverse() };
  host.innerHTML = renderToStaticMarkup(template.render(reversedModel, { presentationConfig: config }));
  expect([...host.querySelectorAll<HTMLElement>("[data-render-section-id]")].map((section) => section.dataset.renderSectionId)).toEqual(ordered);
});

it("keeps education honors distinct from other highlights after duplicate removal", () => {
  const education = createResumeJsonV2Example().sections.flatMap(section => section.items).find(item => item.sectionType === "education");
  if (!education || education.sectionType !== "education") throw new Error("expected education");
  const projected = projectResumePresentationItem({ ...education, honors: ["奖学金", "奖学金"], highlights: ["课程项目"] });
  expect(projected.highlights).toEqual(["奖学金", "课程项目"]);
  expect(projected.educationHonorCount).toBe(1);
});

it("keeps education metrics and courses exactly once when an education item crosses pages", () => {
  const model = presentationFixture();
  if (model.schemaVersion !== "resume-render-v2") throw new Error("expected v2 model");
  const education = model.structuredSections.find((section) => section.sectionType === "education")!;
  const item = education.items[0];
  const measurement = {
    scrollHeight: 100, clientHeight: 70,
    sections: [{ sectionType: "education" as const, sectionId: education.sectionId, top: 0, bottom: 100, height: 100, blockIds: [item.itemId] }],
    blocks: [{ sourceItemId: item.itemId, sectionType: "education" as const, sectionId: education.sectionId, top: 0, bottom: 100, height: 100, units: [
      { key: "heading", top: 0, bottom: 10, height: 10 },
      { key: "custom-rows:education-meta", top: 10, bottom: 20, height: 10 },
      { key: "education-honors", top: 20, bottom: 30, height: 10 },
      { key: "custom-rows:education-courses", top: 30, bottom: 75, height: 45 },
      { key: "description", top: 75, bottom: 85, height: 10 },
      { key: "highlight:1", top: 85, bottom: 100, height: 15 }
    ] }]
  };
  const config = ResumePresentationConfigSchema.parse({ schemaVersion: "resume-presentation-v1", branchId: "presentation-branch", templateId: "classic-technical", contentRevision: { branchRevision: 1, currentRevisionId: "revision-1" }, presentationRevision: 0, updatedAt: "2026-11-20T00:00:00.000Z" });
  const plan = createResumePaginationPlan({ measurement, paginationConfig: config.pagination });
  const pages = paginateResumeRenderModel(model, plan);
  expect(pages).toHaveLength(2);
  const template = resumeTemplates.find((entry) => entry.id === "classic-technical")!;
  const text = pages.map((page) => renderToStaticMarkup(template.render(page)));
  expect(text[0]).toContain("GPA");
  expect(text[0]).not.toContain("核心课程");
  expect(text[1]).toContain("核心课程");
  expect(text[1]).not.toContain("GPA");
});
