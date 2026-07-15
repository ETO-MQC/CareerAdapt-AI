import {
  ImportQualityReportV2Schema,
  ResumeSourceBlockV2Schema,
  type ImportQualityReport,
  type ImportQualityReportV2,
  type NormalizedSourceBlock,
  type ResumeImportPipelineRoute,
  type ResumeImportSourceClassification,
  type ResumeSourceBlockV2,
  type ResumeSourceEngine,
  type ResumeSourceKind
} from "@/domain/schemas";

export const RESUME_IMPORT_PIPELINE_VERSION = "resume-import.pipeline.v2";

export const RESUME_IMPORT_QUALITY_THRESHOLDS = Object.freeze({
  minimumTextCoverage: 0.45,
  maximumReplacementCharacterRatio: 0.015,
  maximumLineFragmentationScore: 0.88
});

export function classifyImportSource(input: {
  sourceKind: ResumeSourceKind;
  qualityReport?: ImportQualityReport;
  blocks: readonly NormalizedSourceBlock[];
}): ResumeImportSourceClassification {
  if (input.sourceKind !== "text_pdf") return input.sourceKind;
  if (input.qualityReport?.recommendedRoute === "ocr_ai" || visibleCharacters(input.blocks) < 20) return "scanned_pdf";
  if (input.qualityReport?.layoutComplexity === "multi_column" || input.qualityReport?.layoutComplexity === "table") {
    return "complex_digital_pdf";
  }
  return "digital_pdf";
}

export function buildResumeSourceBlocksV2(input: {
  blocks: readonly NormalizedSourceBlock[];
  classification: ResumeImportSourceClassification;
}): ResumeSourceBlockV2[] {
  return input.blocks.map((block) => ResumeSourceBlockV2Schema.parse({
    ...block,
    sourceKind: input.classification,
    sourceEngine: block.sourceEngine ?? defaultEngine(input.classification),
    sourceEngineVersion: block.sourceEngineVersion ?? "unknown",
    extractionConfidence: block.extractionConfidence ?? defaultExtractionConfidence(input.classification)
  }));
}

export function buildImportQualityReportV2(input: {
  classification: ResumeImportSourceClassification;
  pageCount: number;
  blocks: readonly NormalizedSourceBlock[];
  legacyReport?: ImportQualityReport;
  ocrRequiredPages?: readonly number[];
}): ImportQualityReportV2 {
  const raw = input.blocks.map((block) => block.rawText).join("\n");
  const visible = visibleCharacters(input.blocks);
  const rawLength = Math.max(1, Array.from(raw).length);
  const coordinateCoverage = input.blocks.length
    ? input.blocks.filter((block) => block.position).length / input.blocks.length
    : 0;
  const replacementCharacterRatio = input.legacyReport?.replacementCharacterRatio
    ?? count(raw, /\uFFFD/g) / rawLength;
  const textCoverage = input.legacyReport?.textCoverage
    ?? Math.min(1, visible / Math.max(1, rawLength * 0.75));
  const lineFragmentationScore = input.legacyReport?.lineFragmentationScore
    ?? (visible < 20 ? 1 : 0);
  const hasUsableTextLayer = !["scanned_pdf", "image"].includes(input.classification)
    && textCoverage >= RESUME_IMPORT_QUALITY_THRESHOLDS.minimumTextCoverage
    && replacementCharacterRatio <= RESUME_IMPORT_QUALITY_THRESHOLDS.maximumReplacementCharacterRatio
    && lineFragmentationScore <= RESUME_IMPORT_QUALITY_THRESHOLDS.maximumLineFragmentationScore;
  const ocrCompleted = input.blocks.some((block) => block.sourceEngine === "paddleocr_vl" && block.normalizedText.trim().length > 0);
  const recommendedPipeline = pipelineRoute(input.classification, hasUsableTextLayer, ocrCompleted);
  const legacyRoute = recommendedPipeline === "ocr_local"
    ? "ocr_ai"
    : recommendedPipeline === "manual_review" || (recommendedPipeline === "digital_pdf_layout" && input.legacyReport?.readingOrderConfidence !== "high")
      ? "ai_text"
      : "deterministic";

  return ImportQualityReportV2Schema.parse({
    schemaVersion: "resume-import-quality-v2",
    sourceType: input.classification,
    classification: input.classification,
    textCoverage,
    replacementCharacterRatio,
    abnormalWhitespaceRatio: input.legacyReport?.abnormalWhitespaceRatio ?? 0,
    lineFragmentationScore,
    readingOrderConfidence: input.legacyReport?.readingOrderConfidence
      ?? (hasUsableTextLayer ? "high" : "low"),
    layoutComplexity: input.legacyReport?.layoutComplexity
      ?? (input.classification === "complex_digital_pdf" ? "multi_column" : input.classification === "docx" ? "unknown" : "single_column"),
    recommendedRoute: legacyRoute,
    recommendedPipeline,
    pageCount: input.pageCount,
    coordinateCoverage,
    hasUsableTextLayer,
    ocrRequiredPages: [...new Set(input.ocrRequiredPages ?? (hasUsableTextLayer || ocrCompleted ? [] : pageNumbers(input.blocks, input.pageCount)))],
    thresholds: RESUME_IMPORT_QUALITY_THRESHOLDS,
    warnings: input.legacyReport?.warnings ?? []
  });
}

function pipelineRoute(classification: ResumeImportSourceClassification, hasUsableTextLayer: boolean, ocrCompleted: boolean): ResumeImportPipelineRoute {
  if (classification === "standard_json") return "standard_json";
  if (classification === "external_json") return "deterministic_json";
  if (classification === "docx") return "docx_structure";
  if (classification === "scanned_pdf" || classification === "image") return ocrCompleted ? "manual_review" : "ocr_local";
  return hasUsableTextLayer ? "digital_pdf_layout" : "ocr_local";
}

function defaultEngine(classification: ResumeImportSourceClassification): ResumeSourceEngine {
  if (classification === "standard_json" || classification === "external_json") return "json_mapper";
  if (classification === "docx") return "docx_xml";
  if (classification === "scanned_pdf" || classification === "image") return "paddleocr_vl";
  return "pdfjs";
}

function defaultExtractionConfidence(classification: ResumeImportSourceClassification) {
  if (classification === "scanned_pdf" || classification === "image") return 0.5;
  if (classification === "complex_digital_pdf" || classification === "external_json") return 0.82;
  return 0.96;
}

function visibleCharacters(blocks: readonly NormalizedSourceBlock[]) {
  return Array.from(blocks.map((block) => block.normalizedText).join("")).filter((character) => !/\s/.test(character)).length;
}

function pageNumbers(blocks: readonly NormalizedSourceBlock[], pageCount: number) {
  const pages = blocks.flatMap((block) => block.page ? [block.page] : []);
  return pages.length ? pages : Array.from({ length: pageCount }, (_, index) => index + 1);
}

function count(value: string, pattern: RegExp) {
  return Array.from(value.matchAll(pattern)).length;
}
