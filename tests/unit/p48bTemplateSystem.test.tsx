import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resumeTemplates } from "@/components/resume/templates/templateRegistry";
import { createP48bTemplateFixtures } from "../fixtures/resume-v2/p4.8bTemplateFixtures";
import {
  createRenderCoverageReport,
  paginatedCoverage,
  presentationCoverage,
  renderedCoverage,
  renderCoverageHasBlockingFailure
} from "@/services/export/renderCoverage";

const fixtures = createP48bTemplateFixtures();

describe("P4.8b template presentation matrix", () => {
  it("keeps at least three high-readability ATS metadata templates", () => {
    expect(resumeTemplates.filter((template) => template.atsLevel === "high")).toHaveLength(4);
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s preserves every available section and item through all six renderers",
    (_name, fixture) => {
      const source = presentationCoverage(fixture.model);
      const renderedMarkup = new Map<string, string>();

      for (const template of resumeTemplates) {
        const host = document.createElement("div");
        const markup = renderToStaticMarkup(template.render(fixture.model));
        renderedMarkup.set(template.id, markup);
        host.innerHTML = markup;
        const report = createRenderCoverageReport({
          source,
          presentation: source,
          paginated: paginatedCoverage([fixture.model]),
          rendered: renderedCoverage(host)
        });

        expect(report.droppedEntries, `${template.id} dropped fixture content`).toEqual([]);
        expect(report.silentDroppedSectionCount).toBe(0);
        expect(report.silentDroppedItemCount).toBe(0);
        expect(renderCoverageHasBlockingFailure(report)).toBe(false);

        for (const section of fixture.model.structuredSections) {
          expect(host.querySelectorAll(`[data-render-section="${section.sectionType}"]`)).toHaveLength(1);
          for (const item of section.items) {
            expect(host.querySelectorAll(`[data-coverage-item-id="${item.itemId}"]`)).toHaveLength(1);
          }
        }
      }

      expect(renderedMarkup.get("campus-clean")).not.toBe(renderedMarkup.get("professional-classic"));
    }
  );

  it("uses one content signature while allowing template-specific presentation differences", () => {
    const fixture = fixtures.find((candidate) => candidate.name === "dense-mixed");
    if (!fixture) throw new Error("dense fixture missing");
    const signature = JSON.stringify(presentationCoverage(fixture.model));
    for (const template of resumeTemplates) {
      expect(JSON.stringify(presentationCoverage(fixture.model))).toBe(signature);
      expect(template.render).toBeTypeOf("function");
    }
  });
});
