import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

function project(description: string, overrides: Record<string, unknown> = {}) {
  return projectResumePresentationItem({
    id: "work-1",
    sectionType: "work",
    organization: "某公司",
    role: "工程师",
    current: false,
    description,
    highlights: [],
    customFields: [],
    ...overrides
  } as never);
}

describe("presentation newline handling", () => {
  it("does not introduce line breaks when the author typed none", () => {
    const item = project("第一句。第二句。");
    expect(item.description).toBe("第一句。第二句。");
    expect(item.description).not.toContain("\n");
  });

  it("keeps line breaks the author typed", () => {
    const item = project("第一段\n第二段");
    expect(item.description).toBe("第一段\n第二段");
    expect(item.description?.split("\n")).toHaveLength(2);
  });

  it("normalises CRLF without collapsing the author's paragraphs", () => {
    const item = project("第一段\r\n第二段");
    expect(item.description).toBe("第一段\n第二段");
  });

  it("still removes duplicate paragraphs", () => {
    const item = project("重复的段落\n保留的段落\n重复的段落");
    expect(item.description).toBe("重复的段落\n保留的段落");
  });

  it("still drops a description identical to a highlight", () => {
    const item = project("与要点完全相同", { highlights: ["与要点完全相同"] });
    expect(item.description).toBeUndefined();
  });

  it("keeps a description that only partially repeats a highlight", () => {
    const item = project("与要点完全相同但更长", { highlights: ["与要点完全相同"] });
    expect(item.description).toBe("与要点完全相同但更长");
  });

  it("does not mutate the stored item while projecting", () => {
    const source = { description: "第一段\n重复\n重复" };
    const input = {
      id: "work-2",
      sectionType: "work",
      organization: "某公司",
      role: "工程师",
      current: false,
      highlights: [],
      customFields: [],
      ...source
    } as never;
    projectResumePresentationItem(input);
    expect(source).toEqual({ description: "第一段\n重复\n重复" });
  });

  it("applies the same paragraph rule to every narrative section", () => {
    const sectionCases = [
      { sectionType: "education", extra: { school: "某大学", degree: "本科", honors: [], courses: [] } },
      { sectionType: "project", extra: { tools: [], outcomes: [] } },
      { sectionType: "research", extra: { methods: [] } },
      { sectionType: "campus", extra: {} },
      { sectionType: "volunteer", extra: {} },
      { sectionType: "awards", extra: {} },
      { sectionType: "publications", extra: { authors: [] } },
      { sectionType: "patents", extra: { inventors: [] } },
      { sectionType: "portfolio", extra: { tools: [] } },
      { sectionType: "other", extra: {} },
      { sectionType: "custom", extra: {} }
    ] as const;

    for (const testCase of sectionCases) {
      const item = projectResumePresentationItem({
        id: `${testCase.sectionType}-1`,
        sectionType: testCase.sectionType,
        title: "标题",
        organization: "某组织",
        description: "一。二。",
        highlights: [],
        customFields: [],
        ...testCase.extra
      } as never);
      expect(item.description, testCase.sectionType).toBe("一。二。");
    }
  });
});

describe("newline styling contract", () => {
  it("honours authored breaks for block-level narrative descriptions", () => {
    expect(css).toMatch(/\.resume-presentation-description\s*\{[^}]*white-space:\s*pre-line/);
    expect(css).toMatch(/\.resume-presentation-summary p\s*\{[^}]*white-space:\s*pre-line/);
  });

  it("does not give single-line scalars a pre-line rule", () => {
    expect(css).not.toMatch(/\.resume-presentation-title\s*\{[^}]*pre-line/);
    expect(css).not.toMatch(/\.resume-template-header h1\s*\{[^}]*pre-line/);
    expect(css).not.toMatch(/\.resume-presentation-meta\s*\{[^}]*pre-line/);
    expect(css).not.toMatch(/\.resume-presentation-subtitle\s*\{[^}]*pre-line/);
  });

  it("leaves the compact skills and languages rows alone", () => {
    expect(css).not.toMatch(/\.resume-skill-description\s*\{[^}]*pre-line/);
    expect(css).not.toMatch(/\.resume-language-row\s*\{[^}]*pre-line/);
  });

  it("keeps highlights as a list rather than inline text", () => {
    expect(css).toMatch(/\.resume-presentation-highlights\s*\{[^}]*list-style/);
  });
});
