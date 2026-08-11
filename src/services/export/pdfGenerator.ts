import { chromium, type Browser, type Page } from "@playwright/test";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2 } from "@/domain/resumeFields";
import { createResumePaginationPlan, paginateResumeRenderModel, type ResumePaginationMeasurement } from "./pagination";
import { renderResumePdfHtml } from "./pdfHtml";
import {
  createRenderCoverageReport,
  paginatedCoverage,
  presentationCoverage,
  renderCoverageHasBlockingFailure,
  type RenderCoverageDiagnostics,
  type RenderCoverageEntry
} from "./renderCoverage";

export class ResumePdfGenerationError extends Error {
  constructor(
    readonly code: string,
    readonly diagnostics?: RenderCoverageDiagnostics,
    readonly recoveryAttempt = false
  ) {
    super(code);
    this.name = "ResumePdfGenerationError";
  }
}

export async function generateResumePdf(snapshot: ResumePdfExportSnapshot) {
  const browser = await launchChromium();
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const page = await browser.newPage({
        viewport: {
          width: 794,
          height: 1123
        }
      });
      try {
        return await generateResumePdfAttempt(snapshot, page, attempt > 0);
      } catch (error) {
        if (attempt === 0 && error instanceof ResumePdfGenerationError && error.code === "render_coverage_failed") {
          // A fresh page is the bounded server-side recovery for stale fonts/layout/DOM state.
          continue;
        }
        throw error;
      } finally {
        await page.close();
      }
    }
    throw new ResumePdfGenerationError("pdf_generation_failed");
  } finally {
    await browser.close();
  }
}

async function generateResumePdfAttempt(snapshot: ResumePdfExportSnapshot, page: Page, recoveryAttempt: boolean) {
    const html = await renderResumePdfHtml(snapshot, { includeMeasurement: true });
    await page.setContent(html, { waitUntil: "networkidle" });
    await waitForStableLayout(page);

    // Combine V1 sectionOrder with V2 section types so all sections are measured
    const allSectionTypes = [...new Set([...snapshot.presentation.sectionOrder, ...RESUME_SECTION_TYPES_V2.filter((t) => t !== "basics")])];
    const measurement = await page.locator("[data-resume-pagination-measurement='true']").evaluate((element, sectionTypes): ResumePaginationMeasurement => {
      const pageElement = element as HTMLElement;
      const pageRect = pageElement.getBoundingClientRect();
      const sections = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-render-section]")).flatMap((sectionElement) => {
        const sectionType = sectionElement.dataset.renderSection;
        if (!sectionType || !sectionTypes.includes(sectionType as (typeof sectionTypes)[number])) {
          return [];
        }
        const rect = sectionElement.getBoundingClientRect();
        return [{
          sectionType: sectionType as "summary" | "experience" | "skills" | "certificates",
          sectionId: sectionElement.dataset.renderSectionId,
          top: rect.top - pageRect.top,
          bottom: rect.bottom - pageRect.top,
          height: rect.height,
          blockIds: Array.from(sectionElement.querySelectorAll<HTMLElement>("[data-pagination-item-id]"))
            .map((block) => block.dataset.paginationItemId)
            .filter((id): id is string => Boolean(id))
        }];
      });
      const blocks = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-pagination-item-id]")).flatMap((blockElement) => {
        const sourceItemId = blockElement.dataset.paginationItemId;
        const sectionElement = blockElement.closest<HTMLElement>("[data-render-section]");
        const sectionType = sectionElement?.dataset.renderSection;
        if (!sourceItemId || !sectionType || !sectionTypes.includes(sectionType as (typeof sectionTypes)[number])) {
          return [];
        }
        const rect = blockElement.getBoundingClientRect();
        const unitElements = blockElement.matches("[data-pagination-unit]")
          ? [blockElement]
          : Array.from(blockElement.querySelectorAll<HTMLElement>("[data-pagination-unit]"));
        return [{
          sourceItemId,
          sectionType: sectionType as "summary" | "experience" | "skills" | "certificates",
          sectionId: sectionElement?.dataset.renderSectionId,
          top: rect.top - pageRect.top,
          bottom: rect.bottom - pageRect.top,
          height: rect.height,
          units: unitElements.flatMap((unit) => {
            const key = unit.dataset.paginationUnit;
            if (!key) return [];
            const unitRect = unit.getBoundingClientRect();
            return [{
              key,
              top: unitRect.top - pageRect.top,
              bottom: unitRect.bottom - pageRect.top,
              height: unitRect.height
            }];
          })
        }];
      });
      return {
        scrollHeight: pageElement.scrollHeight,
        clientHeight: pageElement.clientHeight,
        sections,
        blocks
      };
    }, allSectionTypes);
    const paginationPlan = createResumePaginationPlan({
      measurement,
      paginationConfig: snapshot.presentation.pagination
    });
    const sourceCoverage = presentationCoverage(snapshot.renderModel);
    const pageModels = paginateResumeRenderModel(snapshot.renderModel, paginationPlan);
    const paginationCoverageReport = createRenderCoverageReport({
      source: sourceCoverage,
      presentation: sourceCoverage,
      paginated: paginatedCoverage(pageModels),
      paginationHash: paginationPlan.paginationHash,
      revisionId: snapshot.currentRevisionId,
      presentationRevision: snapshot.presentationRevision
    });
    if (renderCoverageHasBlockingFailure(paginationCoverageReport)) {
      throw new ResumePdfGenerationError("render_coverage_failed", paginationCoverageReport.diagnostics, recoveryAttempt);
    }
    // Server uses its own measurement directly — client/server fonts differ so hash comparison is unreliable

    const finalHtml = await renderResumePdfHtml(snapshot, { paginationPlan });
    await page.setContent(finalHtml, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await waitForStableLayout(page);
    const renderedEntries = await page.locator(".resume-preview-pages").evaluate((root): RenderCoverageEntry[] => {
      const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-render-section][data-render-section-id]"))
        .filter((section) => section.dataset.renderSectionPrimary !== "false")
        .map((section) => ({
          sectionType: section.dataset.renderSection as RenderCoverageEntry["sectionType"],
          sectionId: section.dataset.renderSectionId!
        }));
      const items = Array.from(root.querySelectorAll<HTMLElement>("[data-coverage-item-id]"))
        .filter((item) => (item.dataset.renderFragmentIndex ?? "0") === "0")
        .flatMap((item) => {
          const section = item.closest<HTMLElement>("[data-render-section][data-render-section-id]");
          const itemId = item.dataset.coverageItemId;
          if (!section || !itemId) return [];
          return [{
            sectionType: section.dataset.renderSection as RenderCoverageEntry["sectionType"],
            sectionId: section.dataset.renderSectionId!,
            itemId
          }];
        });
      return [...sections, ...items];
    });
    const renderedCoverageReport = createRenderCoverageReport({
      source: sourceCoverage,
      presentation: sourceCoverage,
      paginated: paginatedCoverage(pageModels),
      rendered: renderedEntries,
      paginationHash: paginationPlan.paginationHash,
      revisionId: snapshot.currentRevisionId,
      presentationRevision: snapshot.presentationRevision
    });
    if (renderCoverageHasBlockingFailure(renderedCoverageReport)) {
      throw new ResumePdfGenerationError("render_coverage_failed", renderedCoverageReport.diagnostics, recoveryAttempt);
    }

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "0",
        right: "0",
        bottom: "0",
        left: "0"
      }
    });
    return {
      pdf,
      overflowStatus: paginationPlan.status,
      paginationPlan
    };
}

async function waitForStableLayout(page: Page) {
  await page.evaluate(async () => {
    if ("fonts" in document) {
      await document.fonts.ready;
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      headless: true
    });
  } catch {
    return await chromium.launch({
      channel: "msedge",
      headless: true
    });
  }
}
