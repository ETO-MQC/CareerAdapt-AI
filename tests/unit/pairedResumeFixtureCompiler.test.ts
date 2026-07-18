import { describe, expect, it } from "vitest";
import { adaptWenmoResumeJson } from "@/domain/resumeImport/wenmoJsonAdapter";
import { createLayoutDocument, type LayoutTextFragment } from "@/domain/resumeImport/layoutDocument";
import { buildLayoutGraph } from "@/domain/resumeImport/layoutGraph";
import { compilePairedResumeFixture } from "@/domain/resumeImport/pairedFixtureCompiler";
import { wenmoPairedJsonFixture } from "../fixtures/resume-import/wenmo-paired";

describe("paired resume fixture compiler", () => {
  it("uses JSON structure truth while binding every expected value to source blocks", () => {
    const canonical = adaptWenmoResumeJson(wenmoPairedJsonFixture).canonicalResume;
    const document = createLayoutDocument({ pageCount: 1, fragments: canonicalFragments(canonical) });
    const graph = buildLayoutGraph(document);
    const fixture = compilePairedResumeFixture({ externalJson: wenmoPairedJsonFixture, layoutDocument: document, layoutGraph: graph });
    expect(fixture.metrics).toEqual({ sourceCoverage: 1, hallucinationCount: 0 });
    expect(fixture.expectedCanonicalV2.sections.find((section) => section.sectionType === "project")?.items).toHaveLength(3);
    expect(fixture.expectedSemanticTree.sections.some((section) => section.sectionType === "internship")).toBe(true);
    expect(Object.values(fixture.expectedLayoutBlockRoles).flat()).toContain("project.role");
  });
});

function canonicalFragments(resume: ReturnType<typeof adaptWenmoResumeJson>["canonicalResume"]): LayoutTextFragment[] {
  const fragments: LayoutTextFragment[] = [];
  let y = 820;
  const add = (id: string, text: string, weight = 400) => {
    fragments.push({ id, page: 1, text, bbox: { x: 20, y, width: Math.max(20, text.length * 8), height: 12 }, fontSize: 12, fontWeight: weight, fontFamily: "Fixture Sans", color: "#000", sourceBlockRef: id, sourceEngine: "pdfjs" });
    y -= 16;
  };
  for (const [field, value] of Object.entries(resume.basics)) for (const text of strings(value)) add(`basic-${field}-${fragments.length}`, text);
  for (const section of resume.sections) {
    add(`heading-${section.id}`, section.title, 700);
    for (const item of section.items) {
      for (const [field, value] of Object.entries(item)) {
        if (["id", "sectionType", "current", "customFields"].includes(field)) continue;
        for (const text of strings(value)) add(`${item.id}-${field}-${fragments.length}`, text, ["title", "name", "organization", "school"].includes(field) ? 700 : 400);
      }
    }
  }
  return fragments;
}

function strings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  return [];
}
