import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { ResumeRenderModelSchema } from "@/domain/schemas";
import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";

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
  });
});
