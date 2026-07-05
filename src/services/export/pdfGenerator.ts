import { chromium, type Browser } from "@playwright/test";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { classifyA4Overflow } from "./overflow";
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
    const html = await renderResumePdfHtml(snapshot);
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.emulateMedia({ media: "print" });
    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
    });

    const measurement = await page.locator("[data-testid='resume-a4-page']").evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight
    }));
    const overflow = classifyA4Overflow(measurement);
    if (overflow.status === "overflow") {
      throw new ResumePdfGenerationError("export_snapshot_overflow");
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
      overflowStatus: overflow.status
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
