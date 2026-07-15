import { describe, expect, it } from "vitest";
import {
  ImportedResumeDateValueSchema,
  ImportedResumeDraftSchema,
  ImportedResumeDraftV2Schema,
  ImportQualityReportV2Schema,
  ResumeSourceBlockV2Schema
} from "@/domain/schemas";
import { buildImportQualityReportV2, buildResumeSourceBlocksV2 } from "@/domain/resumeImport/pipeline";

const now = "2026-07-15T00:00:00.000Z";

function sourceBlock(overrides: Record<string, unknown> = {}) {
  return {
    id: "pdf:1:line:0",
    page: 1,
    text: "广东财经大学 2024年9月—至今",
    rawText: "广东财经大学 2024年9月—至今",
    normalizedText: "广东财经大学 2024年9月—至今",
    normalizationActions: [],
    blockType: "paragraph",
    position: { x: 28, y: 600, width: 320, height: 12 },
    order: 0,
    sourceKind: "digital_pdf",
    sourceEngine: "pdfjs",
    sourceEngineVersion: "5.4.296",
    extractionConfidence: 0.96,
    ...overrides
  };
}

function qualityReport(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "resume-import-quality-v2",
    sourceType: "digital_pdf",
    classification: "digital_pdf",
    textCoverage: 0.96,
    replacementCharacterRatio: 0,
    abnormalWhitespaceRatio: 0,
    lineFragmentationScore: 0.1,
    readingOrderConfidence: "high",
    layoutComplexity: "single_column",
    recommendedRoute: "deterministic",
    recommendedPipeline: "digital_pdf_layout",
    pageCount: 1,
    coordinateCoverage: 1,
    hasUsableTextLayer: true,
    ocrRequiredPages: [],
    thresholds: {
      minimumTextCoverage: 0.45,
      maximumReplacementCharacterRatio: 0.015,
      maximumLineFragmentationScore: 0.88
    },
    warnings: [],
    ...overrides
  };
}

describe("Resume import pipeline v2 schemas", () => {
  it("requires traceable engine provenance on formal source blocks", () => {
    expect(ResumeSourceBlockV2Schema.parse(sourceBlock()).sourceEngine).toBe("pdfjs");
    const missingEngine = sourceBlock();
    Reflect.deleteProperty(missingEngine, "sourceEngine");
    expect(ResumeSourceBlockV2Schema.safeParse(missingEngine).success).toBe(false);
  });

  it("records the explicit classification, quality thresholds, and pipeline route", () => {
    const parsed = ImportQualityReportV2Schema.parse(qualityReport({
      classification: "complex_digital_pdf",
      sourceType: "complex_digital_pdf",
      layoutComplexity: "multi_column"
    }));
    expect(parsed.recommendedPipeline).toBe("digital_pdf_layout");
    expect(parsed.thresholds.maximumReplacementCharacterRatio).toBe(0.015);
  });

  it("preserves raw date precision and never fabricates an end date for present", () => {
    expect(ImportedResumeDateValueSchema.parse({
      rawText: "2024年9月",
      value: "2024-09",
      precision: "month",
      current: false,
      sourceBlockIds: ["pdf:1:line:0"],
      sourceQuote: "2024年9月",
      confidence: 0.98,
      needsConfirmation: false
    }).precision).toBe("month");

    expect(ImportedResumeDateValueSchema.parse({
      rawText: "至今",
      current: true,
      sourceBlockIds: ["pdf:1:line:0"],
      sourceQuote: "至今",
      confidence: 1,
      needsConfirmation: false
    }).value).toBeUndefined();

    expect(ImportedResumeDateValueSchema.safeParse({
      rawText: "至今",
      value: "2026-07-15",
      precision: "day",
      current: true,
      sourceBlockIds: ["pdf:1:line:0"],
      sourceQuote: "至今",
      confidence: 1,
      needsConfirmation: false
    }).success).toBe(false);
  });

  it("accepts a strict resume-import-v2 draft while retaining v1 read compatibility", () => {
    const parsed = ImportedResumeDraftV2Schema.parse({
      id: "import-1",
      schemaVersion: "resume-import-v2",
      importId: "import-1",
      revision: 0,
      status: "reviewing",
      source: {
        fileName: "resume.pdf",
        mimeType: "application/pdf",
        fileHash: "1234567890abcdef",
        pageCount: 1,
        extractedAt: now
      },
      sourceKind: "digital_pdf",
      sourceBlocks: [sourceBlock()],
      qualityReport: qualityReport(),
      basics: { links: [] },
      sections: [],
      pages: [{ pageNumber: 1, rawText: "text", normalizedText: "text" }],
      unclassifiedBlocks: [],
      warnings: [],
      mappingDecisions: [],
      fieldCandidates: [],
      parserVersion: "resume-import.pipeline.v2",
      createdAt: now,
      updatedAt: now
    });

    expect(parsed.schemaVersion).toBe("resume-import-v2");
    expect(ImportedResumeDraftSchema.parse(parsed).schemaVersion).toBe("resume-import-v2");
  });

  it("routes completed local OCR to manual review instead of requesting OCR forever", () => {
    const blocks = buildResumeSourceBlocksV2({
      classification: "image",
      blocks: [{
        id: "ocr:1:block:0",
        page: 1,
        text: "教育背景 GPA：3.95/5.0",
        rawText: "教育背景 GPA：3.95/5.0",
        normalizedText: "教育背景 GPA：3.95/5.0",
        normalizationActions: [],
        blockType: "paragraph",
        order: 0,
        sourceEngine: "paddleocr_vl",
        sourceEngineVersion: "3.7.0",
        extractionConfidence: 0.7
      }]
    });
    const report = buildImportQualityReportV2({ classification: "image", pageCount: 1, blocks });
    expect(report.recommendedPipeline).toBe("manual_review");
    expect(report.recommendedRoute).toBe("ai_text");
    expect(report.ocrRequiredPages).toEqual([]);
  });
});
