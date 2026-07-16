import { describe, expect, it } from "vitest";
import { selectDocumentImportRoute } from "@/domain/resumeImport/routing";
import {
  DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
  migrateDocumentRecognitionPreferences
} from "@/services/preferences/documentRecognition";
import { buildDefaultModelDirectoryCandidates } from "@/services/documentRecognition/serverHealth";

const damagedQuality = {
  sourceType: "text_pdf" as const,
  textCoverage: 0.1,
  replacementCharacterRatio: 0.03,
  abnormalWhitespaceRatio: 0,
  lineFragmentationScore: 0.95,
  readingOrderConfidence: "low" as const,
  layoutComplexity: "unknown" as const,
  recommendedRoute: "ocr_ai" as const,
  warnings: []
};

const complexQuality = {
  ...damagedQuality,
  textCoverage: 0.9,
  replacementCharacterRatio: 0,
  lineFragmentationScore: 0.2,
  readingOrderConfidence: "medium" as const,
  layoutComplexity: "multi_column" as const,
  recommendedRoute: "ai_text" as const
};

describe("document recognition routing", () => {
  it("uses PDF.js for a normal digital PDF in auto mode", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
      qualityReport: { ...complexQuality, layoutComplexity: "single_column", readingOrderConfidence: "high", recommendedRoute: "deterministic" }
    }).route).toBe("pdfjs");
  });

  it("keeps text parsing when text layer mode is forced", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES, parsingMode: "text_layer" },
      qualityReport: damagedQuality
    }).route).toBe("pdfjs");
  });

  it("uses local OCR for damaged text in auto mode", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
      qualityReport: damagedQuality
    }).route).toBe("local_ocr");
  });

  it("falls back to manual review when forced OCR is unavailable", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES, parsingMode: "local_ocr" },
      qualityReport: damagedQuality,
      ocrReady: false
    }).route).toBe("manual_review");
  });

  it("does not use OpenDataLoader while the experiment is off", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
      qualityReport: complexQuality,
      openDataLoaderReady: true
    }).route).toBe("pdfjs");
  });

  it("uses OpenDataLoader only for an enabled complex PDF experiment", () => {
    expect(selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences: { ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES, openDataLoaderExperimental: true },
      qualityReport: complexQuality,
      openDataLoaderReady: true
    })).toMatchObject({
      route: "opendataloader",
      fallbackRoute: "pdfjs",
      experimental: true
    });
  });
});

describe("document recognition settings", () => {
  it("migrates the legacy text_first mode and fills defaults", () => {
    expect(migrateDocumentRecognitionPreferences({
      parsingMode: "text_first",
      localOcrEnabled: false
    })).toEqual({
      ...DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES,
      parsingMode: "text_layer",
      localOcrEnabled: false
    });
  });

  it("builds portable default model candidates without a developer machine path", () => {
    const candidates = buildDefaultModelDirectoryCandidates({
      homeDirectory: "C:\\Users\\Example",
      environment: {
        PADDLEOCR_VL_MODEL_DIR: "D:\\Models\\PaddleOCR-VL-1.6",
        PADDLEOCR_VL_MODEL_SEARCH_PATH: "E:\\Shared\\PaddleOCR-VL-1.6"
      }
    });
    expect(candidates[0]).toContain("Models");
    expect(candidates.some((candidate) => candidate.includes(".paddlex"))).toBe(true);
    expect(candidates.join("\n")).not.toContain("mqcin");
  });
});
