"use client";

import { nanoid } from "nanoid";
import { PDF_IMPORT_EXTRACTION_VERSION } from "@/domain/pdfImport/limits";
import { buildPageTextRecords, preparePdfText } from "@/domain/pdfImport/text";
import { validatePdfFileDescriptor, validatePdfHeader } from "@/domain/pdfImport/validation";
import { extractTextFromDocxBuffer } from "@/domain/resumeImport/docx";
import { createJsonSourceBlocks, parseResumeJsonText, RESUME_JSON_MAX_CHARS } from "@/domain/resumeImport/jsonMapper";
import { adaptResumeJsonToV2, jsonV2ToLegacyMapperOutput } from "@/domain/resumeImport/jsonV2Adapter";
import {
  analyzeImportQuality,
  normalizeExtractedSourceBlocks,
  normalizedBlocksToText,
  RESUME_IMPORT_CLEANER_VERSION
} from "@/domain/resumeImport/normalizer";
import { runOpenDataLoaderAdapter } from "@/domain/resumeImport/openDataLoaderAdapter";
import {
  extractMarkdownSourceBlocks,
  extractPlainTextSourceBlocks
} from "@/domain/resumeImport/textDocument";
import {
  createImportedResumeDraftFromPdf,
  createImportedResumeDraftFromStructuredJson,
  createImportedResumeDraftFromText
} from "@/domain/resumeImport/parser";
import {
  selectDocumentImportRoute,
  type DocumentImportRoutingDecision
} from "@/domain/resumeImport/routing";
import type {
  DocumentRecognitionPreferences,
  ExtractedSourceBlock,
  ImportedResumeDraft,
  ImportQualityReport,
  PdfImportSession,
  PdfPageText,
  ResumeJsonMapperOutput,
  ResumeSourceDocumentV2,
  ResumeSourceKind
} from "@/domain/schemas";
import { sourceDocumentFromDraft } from "@/domain/resumeImport/sourceDocument";
import { extractTextFromPdfBuffer } from "@/services/pdf/extractText";
import { hashBytes, hashText } from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import {
  ResumeDocumentSemanticMapper,
  ResumeDocumentSemanticMapperError
} from "@/services/resumeImport/ResumeDocumentSemanticMapper";
import {
  DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES
} from "@/services/preferences/documentRecognition";

export type ResumeImportProgressStage =
  | "validating"
  | "extracting"
  | "normalizing"
  | "mapping"
  | "building_draft"
  | "ready_for_review"
  | "fallback"
  | "failed";

export type ResumeImportProgress = {
  stage: ResumeImportProgressStage;
  message: string;
  heartbeat: boolean;
  at: string;
};

export type ResumeImportLocalSource = {
  fileName: string;
  mimeType: string;
  size: number;
  file: File;
};

export type ResumeImportReviewSummary = {
  sectionCount: number;
  itemCount: number;
  highConfidenceCount: number;
  needsReviewCount: number;
  conflictCount: number;
  unclassifiedCount: number;
};

export type ResumeImportReviewArtifactPayload = ResumeImportReviewSummary & {
  importId: string;
  draftRevision: number;
  sourceFile: string;
  sourceType: ResumeSourceKind;
  warnings: string[];
  target: { status: "unresolved" };
  reviewState: "ready_for_review";
};

export type ResumeImportPrepareResult = {
  importId: string;
  draftRevision: number;
  sourceKind: ResumeSourceKind;
  fileName: string;
  fileHash: string;
  status: "ready_for_review";
  quality: ImportQualityReport;
  reviewSummary: ResumeImportReviewSummary;
  artifactPayload: ResumeImportReviewArtifactPayload;
  warnings: string[];
  draft: ImportedResumeDraft;
  pages: PdfPageText[];
  routingDecision: DocumentImportRoutingDecision;
};

export type ResumeImportPrepareContext = {
  signal?: AbortSignal;
  preferences?: DocumentRecognitionPreferences;
  semanticMode?: "ai" | "local";
  onProgress?: (progress: ResumeImportProgress) => void;
};

export class ResumeImportOrchestratorError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: "reselect_file" | "manual_ocr" | "manual_review" | "retry_ai",
    readonly fallbackResult?: ResumeImportPrepareResult
  ) {
    super(message);
  }
}

type InternalPrepareContext = ResumeImportPrepareContext & {
  deferPersistence?: boolean;
  suppressReadyProgress?: boolean;
};

export type ResumeImportExtractionResult = {
  sourceDocument: ResumeSourceDocumentV2;
  fallbackDraft: ImportedResumeDraft;
  pages: PdfPageText[];
  routingDecision: DocumentImportRoutingDecision;
};

export class ResumeImportOrchestrator {
  constructor(private readonly repository: WorkspaceRepository) {}

  async prepare(
    source: ResumeImportLocalSource,
    context: ResumeImportPrepareContext = {}
  ): Promise<ResumeImportPrepareResult> {
    try {
      const extracted = await this.extractSourceDocument(source, context);
      let draft = extracted.fallbackDraft;
      if (
        context.semanticMode === "ai"
        && draft.schemaVersion === "resume-import-v2"
        && draft.sourceKind !== "standard_json"
      ) {
        emit(context, "mapping", "AI 正在识别简历内容…");
        try {
          draft = await new ResumeDocumentSemanticMapper(this.repository).map(draft, {
            signal: context.signal,
            onProgress: (message) => emit(context, "mapping", message)
          });
        } catch (error) {
          if (!(error instanceof ResumeDocumentSemanticMapperError)) throw error;
          const fallback = await this.persistAndResult(
            { ...extracted.fallbackDraft, status: "failed" },
            extracted.pages,
            extracted.routingDecision,
            { ...context, suppressReadyProgress: true }
          );
          throw new ResumeImportOrchestratorError(
            `resume_import_${error.code}`,
            `${error.message} 来源文档和本地解析结果已保留，可重试 AI 或改用仅本地解析。`,
            "retry_ai",
            fallback
          );
        }
      }
      return await this.persistAndResult(
        draft,
        extracted.pages,
        extracted.routingDecision,
        context
      );
    } catch (error) {
      emit(context, "failed", error instanceof Error ? error.message : "简历导入失败。");
      throw error;
    }
  }

  async extractSourceDocument(
    source: ResumeImportLocalSource,
    context: ResumeImportPrepareContext = {}
  ): Promise<ResumeImportExtractionResult> {
    const prepared = await this.prepareLocalExtraction(source, {
      ...context,
      deferPersistence: true
    });
    if (prepared.draft.schemaVersion !== "resume-import-v2") {
      throw new ResumeImportOrchestratorError(
        "resume_import_source_document_v2_required",
        "来源文档未能转换为 Resume SourceDocument v2。"
      );
    }
    return {
      sourceDocument: sourceDocumentFromDraft(prepared.draft),
      fallbackDraft: prepared.draft,
      pages: prepared.pages,
      routingDecision: prepared.routingDecision
    };
  }

  private async prepareLocalExtraction(
    source: ResumeImportLocalSource,
    context: InternalPrepareContext
  ): Promise<ResumeImportPrepareResult> {
    assertNotAborted(context.signal);
    const format = detectFormat(source);
    if (!format) {
      throw new ResumeImportOrchestratorError(
        "resume_import_unsupported_file",
        "当前仅支持 PDF、DOCX、JSON、Markdown 和 TXT 简历文件。"
      );
    }
    if (format === "pdf") return this.preparePdf(source, context);
    if (format === "docx") return this.prepareDocx(source, context);
    if (format === "markdown" || format === "text") {
      return this.prepareTextDocument(source, format, context);
    }
    return this.prepareJson(source, context);
  }

  private async preparePdf(
    source: ResumeImportLocalSource,
    context: InternalPrepareContext
  ): Promise<ResumeImportPrepareResult> {
    emit(context, "validating", "正在读取文档…");
    const descriptor = validatePdfFileDescriptor(source.file);
    if (!descriptor.ok) throw new ResumeImportOrchestratorError("invalid_pdf_descriptor", descriptor.message);
    const buffer = await source.file.arrayBuffer();
    assertNotAborted(context.signal);
    const bytes = new Uint8Array(buffer);
    const header = validatePdfHeader(bytes);
    if (!header.ok) throw new ResumeImportOrchestratorError("invalid_pdf_header", header.message);
    const now = new Date().toISOString();
    const fileHash = await hashBytes(bytes);
    const session: PdfImportSession = {
      id: `pdf-session-${nanoid(10)}`,
      status: "extracting",
      fileName: source.fileName,
      fileSize: source.size,
      mimeType: descriptor.mimeType,
      extension: descriptor.extension,
      fileHash,
      pageCount: 0,
      textLength: 0,
      extractionVersion: PDF_IMPORT_EXTRACTION_VERSION,
      hasPromptInjectionRisk: false,
      warnings: descriptor.warnings,
      createdAt: now,
      updatedAt: now
    };
    await this.repository.createPdfImportSession(session);
    emit(context, "extracting", "正在本地提取 PDF 文本与版面结构。");
    const extracted = await withHeartbeat(
      () => extractTextFromPdfBuffer(buffer, context.signal),
      context,
      "正在读取 PDF 页面。"
    );
    if (!extracted.ok) {
      await this.repository.updatePdfImportSession({
        ...session,
        status: extracted.code === "extract_cancelled" ? "cancelled" : "failed",
        errorCode: extracted.code,
        errorMessage: extracted.message
      });
      if (extracted.code === "no_text_layer") {
        throw new ResumeImportOrchestratorError(
          "resume_import_ocr_required",
          "PDF 没有可用文本层。Agent OCR 尚未开放，请使用本地 OCR 手动导入。",
          "manual_ocr"
        );
      }
      throw new ResumeImportOrchestratorError(extracted.code, extracted.message);
    }
    const prepared = preparePdfText(extracted.pages);
    if (!prepared.ok) {
      await this.repository.updatePdfImportSession({
        ...session,
        status: "failed",
        errorCode: prepared.code,
        errorMessage: prepared.message
      });
      if (prepared.code === "no_text_layer" || prepared.code === "empty_extracted_text") {
        throw new ResumeImportOrchestratorError(
          "resume_import_ocr_required",
          "PDF 没有可用文本层。Agent OCR 尚未开放，请使用本地 OCR 手动导入。",
          "manual_ocr"
        );
      }
      throw new ResumeImportOrchestratorError(prepared.code, prepared.message);
    }

    emit(context, "normalizing", "正在还原阅读顺序并规范化来源块。");
    const sourceBlocks = normalizeExtractedSourceBlocks(extracted.pages.flatMap((page) => page.blocks));
    const analyzedQuality = analyzeImportQuality({ sourceType: "text_pdf", blocks: sourceBlocks });
    const hasComplexPdfLayout = extracted.pages.some((page) =>
      page.classification === "complex_digital_pdf"
      || page.warnings.some((warning) => warning.startsWith("complex_layout:"))
    );
    const quality: ImportQualityReport = hasComplexPdfLayout
      ? {
          ...analyzedQuality,
          readingOrderConfidence: analyzedQuality.readingOrderConfidence === "low" ? "low" : "medium",
          layoutComplexity: "multi_column",
          recommendedRoute: analyzedQuality.recommendedRoute === "ocr_ai" ? "ocr_ai" : "ai_text",
          warnings: Array.from(new Set([
            ...analyzedQuality.warnings,
            "检测到多栏布局，已按坐标恢复阅读顺序，请重点核对跨栏内容。"
          ]))
        }
      : analyzedQuality;
    const preferences = context.preferences ?? DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES;
    let decision = selectDocumentImportRoute({
      sourceKind: "text_pdf",
      preferences,
      qualityReport: quality
    });
    if (decision.route === "local_ocr" || decision.route === "manual_review") {
      throw new ResumeImportOrchestratorError(
        "resume_import_ocr_required",
        decision.reason,
        decision.route === "local_ocr" ? "manual_ocr" : "manual_review"
      );
    }
    if (decision.route === "opendataloader") {
      emit(context, "extracting", "正在尝试 OpenDataLoader 复杂版面解析。");
      const experimental = await withHeartbeat(
        () => runOpenDataLoaderAdapter(source.file, { signal: context.signal }),
        context,
        "OpenDataLoader 仍在解析。"
      );
      if (experimental.ok) {
        const blocks = normalizeExtractedSourceBlocks(experimental.blocks);
        await this.repository.updatePdfImportSession({
          ...session,
          status: "extracted",
          pageCount: extracted.pageCount,
          textLength: experimental.text.length,
          hasPromptInjectionRisk: false,
          warnings: [...descriptor.warnings, ...experimental.warnings]
        });
        return this.persistTextDraft({
          source,
          fileHash,
          sourceSessionId: session.id,
          sourceKind: "text_pdf",
          text: experimental.text,
          sourceBlocks: blocks,
          pageCount: extracted.pageCount,
          routingDecision: decision,
          extraWarnings: experimental.warnings
        }, context);
      }
      emit(context, "fallback", `${experimental.message} 已回退 PDF.js 坐标解析。`);
      decision = {
        route: "pdfjs",
        reason: `${experimental.message} 已自动回退 PDF.js 坐标解析。`,
        fallbackRoute: "manual_review",
        canUseOcr: preferences.localOcrEnabled,
        ocrExpectedSlow: false,
        experimental: false
      };
    }
    const normalizedPages = prepared.pages.map((page) => ({
      ...page,
      cleanedText: normalizedBlocksToText(sourceBlocks.filter((block) => block.page === page.pageNumber))
        || page.cleanedText
    }));
    const hashes = await Promise.all(normalizedPages.map(async (page) => ({
      rawTextHash: await hashText(page.rawText),
      cleanedTextHash: await hashText(page.cleanedText)
    })));
    const pages = buildPageTextRecords({
      sessionId: session.id,
      pages: normalizedPages,
      hashes,
      now
    });
    await this.repository.savePdfPageTexts(session.id, pages);
    const normalizedTextHash = await hashText(prepared.combinedText);
    await this.repository.updatePdfImportSession({
      ...session,
      status: "extracted",
      pageCount: extracted.pageCount,
      textLength: prepared.combinedText.length,
      normalizedTextHash,
      hasPromptInjectionRisk: prepared.hasPromptInjectionRisk,
      warnings: [...descriptor.warnings, ...prepared.warnings]
    });
    emit(context, "mapping", "正在映射简历结构并保留来源证据。");
    const draft = createImportedResumeDraftFromPdf({
      source: {
        sourceSessionId: session.id,
        fileName: source.fileName,
        fileHash,
        normalizedTextHash,
        pageCount: extracted.pageCount,
        extractedAt: now
      },
      pages,
      sourceKind: "text_pdf",
      sourceBlocks,
      qualityReport: quality,
      layoutArtifacts: extracted.pages.map((page) => ({
        layoutDocument: page.layoutDocument,
        layoutGraph: page.layoutGraph,
        semanticTree: page.semanticTree
      })),
      now
    });
    return this.persistAndResult(draft, pages, decision, context);
  }

  private async prepareDocx(
    source: ResumeImportLocalSource,
    context: InternalPrepareContext
  ) {
    emit(context, "validating", "正在读取文档…");
    const buffer = await source.file.arrayBuffer();
    assertNotAborted(context.signal);
    const fileHash = await hashBytes(new Uint8Array(buffer));
    emit(context, "extracting", "正在读取 DOCX 正文、列表和表格。");
    const extracted = await withHeartbeat(
      () => extractTextFromDocxBuffer(buffer),
      context,
      "正在读取 DOCX 结构。"
    );
    if (!extracted.ok) throw new ResumeImportOrchestratorError(extracted.code, extracted.message);
    const decision = selectDocumentImportRoute({
      sourceKind: "docx",
      preferences: context.preferences ?? DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES
    });
    return this.persistTextDraft({
      source,
      fileHash,
      sourceKind: "docx",
      text: extracted.text,
      sourceBlocks: extracted.blocks,
      routingDecision: decision,
      extraWarnings: extracted.warnings
    }, context);
  }

  private async prepareJson(
    source: ResumeImportLocalSource,
    context: InternalPrepareContext
  ) {
    emit(context, "validating", "正在读取文档…");
    const rawText = await source.file.text();
    const risk = validateJsonText(rawText);
    if (risk) throw new ResumeImportOrchestratorError("invalid_json_source", risk);
    const parsed = parseResumeJsonText(rawText);
    if (!parsed.ok) throw new ResumeImportOrchestratorError("invalid_json_syntax", parsed.error.message);
    emit(context, "mapping", "正在应用 JSON v2、v1 或外部格式适配器。");
    const adapted = adaptResumeJsonToV2(parsed.value);
    if (!adapted.ok) {
      throw new ResumeImportOrchestratorError("json_adapter_failed", adapted.message);
    }
    const mapped: ResumeJsonMapperOutput = {
      ...jsonV2ToLegacyMapperOutput(adapted.value),
      mappingDecisions: []
    };
    const sourceKind = adapted.sourceKind === "v2" ? "standard_json" : "external_json";
    const fileHash = await hashText(rawText);
    const blocks = normalizeExtractedSourceBlocks(createJsonSourceBlocks(parsed.value));
    const quality = analyzeImportQuality({ sourceType: sourceKind, blocks });
    const now = new Date().toISOString();
    const draft = createImportedResumeDraftFromStructuredJson({
      source: {
        fileName: source.fileName,
        mimeType: "application/json",
        fileHash,
        normalizedTextHash: fileHash,
        pageCount: 1,
        extractedAt: now
      },
      structuredDraft: mapped.structuredDraft,
      unclassifiedBlocks: mapped.unclassifiedBlocks,
      sourceKind,
      sourceBlocks: blocks,
      qualityReport: quality,
      mappingDecisions: mapped.mappingDecisions,
      canonicalResume: adapted.value,
      now
    });
    const decision = selectDocumentImportRoute({
      sourceKind,
      preferences: context.preferences ?? DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES
    });
    return this.persistAndResult(draft, [], decision, context);
  }

  private async prepareTextDocument(
    source: ResumeImportLocalSource,
    format: "markdown" | "text",
    context: InternalPrepareContext
  ) {
    emit(context, "validating", "正在读取文档…");
    const text = await source.file.text();
    if (!text.trim()) throw new ResumeImportOrchestratorError("empty_import_text", "文件中没有可导入文本。");
    if (text.length > 200_000) throw new ResumeImportOrchestratorError("text_import_too_large", "文本文件超过 200000 字符限制。");
    const blocks = format === "markdown"
      ? extractMarkdownSourceBlocks(text)
      : extractPlainTextSourceBlocks(text);
    const fileHash = await hashText(text);
    const decision = selectDocumentImportRoute({
      sourceKind: format,
      preferences: context.preferences ?? DEFAULT_DOCUMENT_RECOGNITION_PREFERENCES
    });
    return this.persistTextDraft({
      source,
      fileHash,
      sourceKind: format,
      text,
      sourceBlocks: blocks,
      routingDecision: decision
    }, context);
  }

  private async persistTextDraft(
    input: {
      source: ResumeImportLocalSource;
      fileHash: string;
      sourceSessionId?: string;
      sourceKind: "docx" | "markdown" | "text" | "text_pdf";
      text: string;
      sourceBlocks: ExtractedSourceBlock[];
      pageCount?: number;
      routingDecision: DocumentImportRoutingDecision;
      extraWarnings?: string[];
    },
    context: InternalPrepareContext
  ) {
    emit(context, "normalizing", "正在规范化来源块。");
    const blocks = normalizeExtractedSourceBlocks(input.sourceBlocks);
    const normalizedText = normalizedBlocksToText(blocks);
    if (!normalizedText) {
      throw new ResumeImportOrchestratorError("empty_import_text", "未读取到可导入文本。");
    }
    const normalizedTextHash = await hashText(normalizedText);
    const now = new Date().toISOString();
    const pages = await buildSyntheticPageTexts({
      sessionId: input.sourceSessionId,
      fileName: input.source.fileName,
      pageTexts: Array.from({ length: input.pageCount ?? 1 }, (_, index) =>
        normalizedBlocksToText(blocks.filter((block) => (block.page ?? 1) === index + 1))
      ),
      fallbackText: normalizedText,
      now
    });
    emit(context, "mapping", "正在映射简历结构并保留来源证据。");
    const draft = createImportedResumeDraftFromText({
      source: {
        sourceSessionId: input.sourceSessionId,
        fileName: input.source.fileName,
        mimeType: input.source.mimeType as "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileHash: input.fileHash,
        normalizedTextHash,
        pageCount: pages.length,
        extractedAt: now
      },
      pages,
      sourceKind: input.sourceKind,
      sourceBlocks: blocks,
      qualityReport: analyzeImportQuality({ sourceType: input.sourceKind, blocks }),
      now
    });
    if (input.sourceSessionId) {
      await this.repository.savePdfPageTexts(input.sourceSessionId, pages);
    }
    const withWarnings = {
      ...draft,
      warnings: [
        ...draft.warnings,
        ...(input.extraWarnings ?? []).map((message, index) => ({
          id: `import-warning-${nanoid(8)}-${index}`,
          code: "source_extraction_warning",
          message,
          severity: "warning" as const
        }))
      ]
    };
    return this.persistAndResult(withWarnings, pages, input.routingDecision, context);
  }

  private async persistAndResult(
    draft: ImportedResumeDraft,
    pages: PdfPageText[],
    routingDecision: DocumentImportRoutingDecision,
    context: InternalPrepareContext
  ): Promise<ResumeImportPrepareResult> {
    assertNotAborted(context.signal);
    const preparedDraft = {
      ...draft,
      parserVersion: `${draft.parserVersion}+${RESUME_IMPORT_CLEANER_VERSION}`
    };
    if (context.deferPersistence) {
      return buildPrepareResult(preparedDraft, pages, routingDecision);
    }
    emit(context, "building_draft", "正在保存可恢复的导入核对草稿。");
    const saved = await this.repository.saveImportedResumeDraft(preparedDraft, 0);
    const result = buildPrepareResult(saved, pages, routingDecision);
    if (!context.suppressReadyProgress) {
      emit(context, "ready_for_review", `已识别 ${result.reviewSummary.itemCount} 项信息，其中 ${result.reviewSummary.needsReviewCount} 项需要确认。`);
    }
    return result;
  }
}

function buildPrepareResult(
  saved: ImportedResumeDraft,
  pages: PdfPageText[],
  routingDecision: DocumentImportRoutingDecision
): ResumeImportPrepareResult {
    const reviewSummary = summarizeDraft(saved);
    const warnings = [
      ...(saved.qualityReport?.warnings ?? []),
      ...saved.warnings.map((warning) => warning.message)
    ].filter((warning, index, all) => all.indexOf(warning) === index);
    const artifactPayload: ResumeImportReviewArtifactPayload = {
      ...reviewSummary,
      importId: saved.importId,
      draftRevision: saved.revision,
      sourceFile: saved.source.fileName,
      sourceType: saved.sourceKind,
      warnings,
      target: { status: "unresolved" },
      reviewState: "ready_for_review"
    };
    return {
      importId: saved.importId,
      draftRevision: saved.revision,
      sourceKind: saved.sourceKind,
      fileName: saved.source.fileName,
      fileHash: saved.source.fileHash,
      status: "ready_for_review",
      quality: saved.qualityReport!,
      reviewSummary,
      artifactPayload,
      warnings,
      draft: saved,
      pages,
      routingDecision
    };
}

function detectFormat(source: ResumeImportLocalSource) {
  const lower = source.fileName.toLowerCase();
  if (source.mimeType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    source.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    || lower.endsWith(".docx")
  ) return "docx";
  if (source.mimeType === "application/json" || lower.endsWith(".json")) return "json";
  if (source.mimeType === "text/markdown" || lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (source.mimeType === "text/plain" || lower.endsWith(".txt")) return "text";
  return undefined;
}

function validateJsonText(text: string) {
  if (!text.trim()) return "请选择包含内容的 JSON 文件。";
  if (text.length > RESUME_JSON_MAX_CHARS) return `JSON 超过 ${RESUME_JSON_MAX_CHARS} 字符限制。`;
  if (/<\/?(script|style|iframe|object|embed)\b/i.test(text)) return "JSON 中包含脚本或样式片段，已阻止导入。";
  if (/(api[_-]?key|secret[_-]?key|OPENAI_API_KEY|AI_API_KEY|-----BEGIN\s+(?:RSA|PRIVATE))/i.test(text)) {
    return "JSON 中疑似包含密钥或私密凭据，已阻止导入。";
  }
  return undefined;
}

function summarizeDraft(draft: ImportedResumeDraft): ResumeImportReviewSummary {
  const items = draft.sections.flatMap((section) => section.items);
  const namedFields = [
    ["name", draft.basics.name],
    ["email", draft.basics.email],
    ["phone", draft.basics.phone],
    ["location", draft.basics.location],
    ["summary", draft.basics.summary],
    ...draft.basics.links.map((field, index) => [`link:${index}`, field] as const)
  ] as const;
  const fields = namedFields
    .map(([, field]) => field)
    .filter((field): field is NonNullable<typeof field> => Boolean(field));
  const candidates = draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates : [];
  const reviewUnits = new Set<string>();
  for (const candidate of candidates.filter((candidate) => candidate.reviewStatus === "needs_review")) {
    reviewUnits.add(`candidate:${candidate.itemId ?? "basics"}:${candidate.targetFieldId}`);
  }
  for (const [fieldName, field] of namedFields) {
    if (!field || (!field.mapping?.needsConfirmation && field.confidence !== "low")) continue;
    const represented = candidates.some((candidate) =>
      candidate.reviewStatus === "needs_review"
      && (candidate.itemId === "basics" || !candidate.itemId)
      && candidate.targetFieldId.endsWith(fieldName.split(":")[0])
    );
    if (!represented) reviewUnits.add(`basic:${fieldName}`);
  }
  for (const item of items) {
    if (!item.mapping?.needsConfirmation && item.confidence !== "low") continue;
    const represented = candidates.some((candidate) =>
      candidate.reviewStatus === "needs_review" && candidate.itemId === item.id
    );
    if (!represented) reviewUnits.add(`item:${item.id}`);
  }
  for (const [index, block] of draft.unclassifiedBlocks.entries()) {
    reviewUnits.add(`unclassified:${"sourcePath" in block ? block.sourcePath : `${block.sourceBlockId}:${block.sourceRange.start}:${block.sourceRange.end}`}:${index}`);
  }
  return {
    sectionCount: draft.sections.length,
    itemCount: items.length + fields.length,
    highConfidenceCount:
      fields.filter((field) => field.confidence === "high" && !field.mapping?.needsConfirmation).length
      + items.filter((item) => item.confidence === "high" && !item.mapping?.needsConfirmation).length,
    needsReviewCount: reviewUnits.size,
    conflictCount: 0,
    unclassifiedCount: draft.unclassifiedBlocks.length
  };
}

async function buildSyntheticPageTexts(input: {
  sessionId?: string;
  fileName: string;
  pageTexts: string[];
  fallbackText: string;
  now: string;
}) {
  const sessionId = input.sessionId ?? `synthetic-${nanoid(10)}`;
  const sourcePages = input.pageTexts.some((text) => text.trim()) ? input.pageTexts : [input.fallbackText];
  const pages: PdfPageText[] = [];
  let charStart = 0;
  for (const [index, text] of sourcePages.entries()) {
    const cleaned = text.trim();
    pages.push({
      id: `import-text-page-${nanoid(10)}`,
      sessionId,
      pageNumber: index + 1,
      extractedPageText: text,
      cleanedPageText: cleaned,
      charStart,
      charEnd: charStart + cleaned.length,
      textItemCount: text.split(/\s+/).filter(Boolean).length,
      warnings: [`${input.fileName} 已转换为第 ${index + 1} 页来源文本。`],
      rawTextHash: await hashText(text),
      cleanedTextHash: await hashText(cleaned),
      createdAt: input.now,
      updatedAt: input.now
    });
    charStart += cleaned.length + 2;
  }
  return pages;
}

async function withHeartbeat<T>(
  operation: () => Promise<T>,
  context: ResumeImportPrepareContext,
  message: string
) {
  const timer = setInterval(() => emit(context, "extracting", message, true), 10_000);
  try {
    return await operation();
  } finally {
    clearInterval(timer);
  }
}

function emit(
  context: ResumeImportPrepareContext,
  stage: ResumeImportProgressStage,
  message: string,
  heartbeat = false
) {
  context.onProgress?.({ stage, message, heartbeat, at: new Date().toISOString() });
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new ResumeImportOrchestratorError("resume_import_aborted", "简历导入已取消。", "reselect_file");
  }
}
