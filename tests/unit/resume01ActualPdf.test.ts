// @vitest-environment node
import { describe, it, expect } from "vitest";
import { chromium } from "playwright-core";
import { inspectExportedPdf } from "@/services/export/inspectExportedPdf";
import type { ResumePdfExportSnapshot } from "@/domain/schemas";

const binding = { snapshotHash: "synthetic-resume01-snapshot", currentRevisionId: "synthetic-revision-1",
  templateId: "classic-technical", presentationRevision: 2 } as ResumePdfExportSnapshot;

describe("RESUME-01 real multipage PDF bytes", () => {
  it("returns Unknown when actual PDF bytes cannot be parsed", async () => {
    const report = await inspectExportedPdf(new Uint8Array([1, 2, 3]), "原文", binding);
    expect(report).toMatchObject({ textLayer: "unknown", contentParity: "unknown", readingOrder: "unknown", failureCode: "pdf_text_extraction_failed" });
  });
  it("extracts Chinese, English, numbers and symbols from both physical pages", async () => {
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent('<style>@page{size:A4} body{font-family:"Microsoft YaHei",sans-serif}.page{break-before:page}</style><div>第一页 中文 Python 2026 C++ 35% →</div><div class="page">第二页 最后经历 SQL 12345@example.org</div>');
      const pdf = await page.pdf({ format: "A4" });
      const expected = "第一页 中文 Python 2026 C++ 35% →\n第二页 最后经历 SQL 12345@example.org";
      const report = await inspectExportedPdf(pdf, expected, binding);
      expect(report).toMatchObject({ pageCount: 2, textLayer: "pass", contentParity: "pass", readingOrder: "pass",
        revisionId: binding.currentRevisionId, presentationRevision: 2, thirdPartyAts: "unknown" });
      const missingPageBaseline = await inspectExportedPdf(pdf, expected + "\n第三页不存在", binding);
      expect(missingPageBaseline.contentParity).toBe("needs_review");
    } finally { await browser.close(); }
  }, 30_000);
});
