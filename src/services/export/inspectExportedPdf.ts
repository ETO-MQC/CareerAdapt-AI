import type { ResumePdfExportSnapshot } from "@/domain/schemas";
import { comparePdfText, normalizePdfText, PdfTextReadinessSchema } from "./pdfTextReadiness";

/** Inspect the bytes actually returned by Chromium, never template metadata. */
export async function inspectExportedPdf(pdf: Uint8Array, expectedText: string, snapshot: ResumePdfExportSnapshot) {
  let pages: string[];
  try { pages = await extractExportedPdf(pdf); }
  catch {
    // The PDF parser is an external boundary. Do not turn unavailable parser
    // observations into a pass, or log private document text.
    return PdfTextReadinessSchema.parse({ version: "pdf-text-1", snapshotHash: snapshot.snapshotHash,
      revisionId: snapshot.currentRevisionId, templateId: snapshot.templateId,
      presentationRevision: snapshot.presentationRevision, pageCount: 0,
      textLayer: "unknown", contentParity: "unknown", readingOrder: "unknown",
      extractedCharacters: 0, expectedCharacters: normalizePdfText(expectedText).length,
      thirdPartyAts: "unknown", failureCode: "pdf_text_extraction_failed" });
  }
  return PdfTextReadinessSchema.parse({ version: "pdf-text-1", snapshotHash: snapshot.snapshotHash,
    revisionId: snapshot.currentRevisionId, templateId: snapshot.templateId,
    presentationRevision: snapshot.presentationRevision, pageCount: pages.length,
    ...comparePdfText(expectedText, pages), thirdPartyAts: "unknown" });
}

async function extractExportedPdf(pdf: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: Uint8Array.from(pdf), useSystemFonts: true, isEvalSupported: false }).promise;
  try {
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      try {
        const content = await page.getTextContent();
        pages.push(content.items.flatMap(item => "str" in item ? [item.str] : []).join(""));
      } finally { page.cleanup(); }
    }
    return pages;
  } finally { await document.destroy(); }
}
