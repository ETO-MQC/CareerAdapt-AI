import { chromium, type Browser } from "@playwright/test";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { createResumePaginationPlan, type ResumePaginationMeasurement } from "./pagination";
import { renderResumePdfHtml } from "./pdfHtml";

export class ResumePdfGenerationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResumePdfGenerationError";
  }
}

export async function generateResumePdf(snapshot: ResumePdfExportSnapshot) {
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({
      viewport: {
        width: 794,
        height: 1123
      }
    });
    const html = await renderResumePdfHtml(snapshot, { includeMeasurement: true });
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });

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
          top: rect.top - pageRect.top,
          bottom: rect.bottom - pageRect.top,
          height: rect.height,
          blockIds: Array.from(sectionElement.querySelectorAll<HTMLElement>("[data-source-item-id]"))
            .map((block) => block.dataset.sourceItemId)
            .filter((id): id is string => Boolean(id))
        }];
      });
      const blocks = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-source-item-id]")).flatMap((blockElement) => {
        const sourceItemId = blockElement.dataset.sourceItemId;
        const sectionType = blockElement.closest<HTMLElement>("[data-render-section]")?.dataset.renderSection;
        if (!sourceItemId || !sectionType || !sectionTypes.includes(sectionType as (typeof sectionTypes)[number])) {
          return [];
        }
        const rect = blockElement.getBoundingClientRect();
        return [{
          sourceItemId,
          sectionType: sectionType as "summary" | "experience" | "skills" | "certificates",
          top: rect.top - pageRect.top,
          bottom: rect.bottom - pageRect.top,
          height: rect.height
        }];
      });
      return {
        scrollHeight: pageElement.scrollHeight,
        clientHeight: pageElement.clientHeight,
        sections,
        blocks
      };
    }, snapshot.presentation.sectionOrder);
    const paginationPlan = createResumePaginationPlan({
      measurement,
      paginationConfig: snapshot.presentation.pagination
    });
    // Server uses its own measurement directly — client/server fonts differ so hash comparison is unreliable

    const finalHtml = await renderResumePdfHtml(snapshot, { paginationPlan });
    await page.setContent(finalHtml, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });

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
  } finally {
    await browser.close();
  }
}

async function launchChromium(): Promise<Browser> {
  try {
    return await chromium.launch({
      channel: "msedge",
      headless: true
    });
  } catch {
    return await chromium.launch({
      headless: true
    });
  }
}
