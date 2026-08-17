import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { assessTemplateCompatibility, resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { ResumeRenderModelSchema, type ResumeRenderModelV2, type ResumeSectionTypeV2 } from "@/domain/schemas";
import {
  coverageCounts,
  createRenderCoverageReport,
  paginatedCoverage,
  presentationCoverage,
  renderedCoverage,
  renderCoverageHasBlockingFailure
} from "@/services/export/renderCoverage";

const EXPECTED_COUNTS = {
  summary: 1,
  education: 1,
  work: 2,
  project: 4,
  awards: 2,
  skills: 6,
  languages: 1
};

describe("render coverage", () => {
  it("preserves the complete canonical fixture through presentation, pagination, and all templates", () => {
    const model = completeModel();
    const source = presentationCoverage(model);
    expect(coverageCounts(source)).toMatchObject(EXPECTED_COUNTS);

    for (const template of resumeTemplates) {
      const host = document.createElement("div");
      host.innerHTML = renderToStaticMarkup(template.render(model));
      const report = createRenderCoverageReport({
        source,
        presentation: presentationCoverage(model),
        paginated: paginatedCoverage([model]),
        rendered: renderedCoverage(host)
      });
      expect(report.droppedEntries).toEqual([]);
      expect(report).toMatchObject({
        silentDroppedSectionCount: 0,
        silentDroppedItemCount: 0,
        duplicateRenderedSectionCount: 0,
        duplicateRenderedItemCount: 0,
        genericExperienceRendered: 0
      });
      expect(renderCoverageHasBlockingFailure(report)).toBe(false);
      expect(coverageCounts(report.rendered ?? [])).toMatchObject(EXPECTED_COUNTS);
    }
  });

  it("measures every skill item independently when categories are grouped for the visible page", () => {
    const model = completeModel();
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(resumeTemplates[0].render(model, { measurement: true }));

    expect(Array.from(host.querySelectorAll<HTMLElement>('[data-render-section="skills"] [data-pagination-item-id]'))
      .map((item) => item.dataset.paginationItemId))
      .toEqual(Array.from({ length: EXPECTED_COUNTS.skills }, (_, index) => `skills-${index + 1}`));
  });

  it("reports the first exact stage and identifiers for dropped entries", () => {
    const model = completeModel();
    const source = presentationCoverage(model);
    const presentation = source.filter((entry) => entry.sectionType !== "languages");
    const report = createRenderCoverageReport({ source, presentation });

    expect(report.silentDroppedSectionCount).toBe(1);
    expect(report.silentDroppedItemCount).toBe(1);
    expect(report.droppedEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({ sectionType: "languages", sectionId: "languages", droppedStage: "presentation" }),
      expect.objectContaining({ sectionType: "languages", sectionId: "languages", itemId: "languages-1", droppedStage: "presentation" })
    ]));
    expect(renderCoverageHasBlockingFailure(report)).toBe(true);
  });

  it("treats template capability as layout support instead of permission to drop data", () => {
    const model = completeModel();
    const template = {
      ...resumeTemplates[0],
      capabilities: {
        ...resumeTemplates[0].capabilities,
        supportedSections: ["education" as const],
        fallbackBehavior: {
          unsupportedField: "render_plain" as const,
          unsupportedSection: "preserve_with_warning" as const
        }
      }
    };
    expect(assessTemplateCompatibility(model, template).length).toBeGreaterThan(0);
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(template.render(model));
    expect(host.querySelectorAll('[data-render-section="awards"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-coverage-item-id^="awards-"]')).toHaveLength(2);
  });
});

function completeModel(): ResumeRenderModelV2 {
  const sections = (Object.entries(EXPECTED_COUNTS) as Array<[Exclude<ResumeSectionTypeV2, "basics">, number]>).map(([sectionType, count], order) => ({
    sectionId: sectionType,
    sectionType,
    title: sectionType,
    order,
    items: Array.from({ length: count }, (_, index) => {
      const itemId = `${sectionType}-${index + 1}`;
      return {
        sectionId: sectionType,
        sectionType,
        itemId,
        data: dataFor(sectionType, itemId),
        plainText: itemId,
        presentation: {
          id: itemId,
          sourceItemId: itemId,
          sectionType,
          primaryTitle: sectionType === "summary" ? undefined : itemId,
          description: sectionType === "summary" ? "summary text" : undefined,
          inlineMeta: [],
          secondaryMeta: [],
          highlights: [],
          links: [],
          customRows: [],
          warnings: []
        }
      };
    })
  }));
  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v2",
    branchId: "coverage-branch",
    branchRevision: 1,
    branchCurrentRevisionId: "coverage-revision",
    branchName: "coverage",
    jobTitle: "general",
    company: "general",
    candidate: { name: "Candidate", contacts: [] },
    sections: [],
    structuredSections: sections,
    compatibilityWarnings: [],
    safety: { ruleOnlyItemIds: [], visibleItemCount: 17, excludedItemIds: [] },
    sourceTrace: { profileId: "profile", currentRevisionId: "coverage-revision", sourceProfileVersion: 1 }
  }) as ResumeRenderModelV2;
}

function dataFor(sectionType: Exclude<ResumeSectionTypeV2, "basics">, id: string) {
  const common = { id, customFields: [] };
  switch (sectionType) {
    case "summary": return { ...common, sectionType, text: id };
    case "education": return { ...common, sectionType, school: id, current: false, courses: [], honors: [], highlights: [] };
    case "work": return { ...common, sectionType, organization: id, current: false, highlights: [] };
    case "project": return { ...common, sectionType, title: id, current: false, tools: [], highlights: [], outcomes: [] };
    case "awards": return { ...common, sectionType, name: id };
    case "skills": return { ...common, sectionType, name: id };
    case "languages": return { ...common, sectionType, language: id };
    default: throw new Error(`unsupported fixture section: ${sectionType}`);
  }
}
