"use client";

import { invokeStructuredAi } from "@/ai/client";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import {
  buildSemanticMappingBatches,
  sourceDocumentFromDraft,
  tokenizeResumeSourceDocument
} from "@/domain/resumeImport/sourceDocument";
import { matchResumeSectionHeading } from "@/domain/resumeImport/sectionHeading";
import { auditResumeImportInvariants } from "@/domain/resumeImport/invariants";
import {
  AiCareerAdaptResumeV2MapperOutputSchema,
  CareerAdaptResumeJsonV2Schema,
  ImportedResumeDraftSchema,
  type ImportedResumeDraft,
  type ImportedResumeDraftV2,
  type AiCareerAdaptResumeV2MapperOutput,
  type ResumeSourceBlockV2
} from "@/domain/schemas";
import {
  containsUnresolvedSensitivePlaceholder,
  createSensitiveTextTokenizer,
  hashText,
  isPlausibleSensitiveNameCandidate,
  restoreSensitivePlaceholders
} from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import type { SafeSchemaIssue } from "@/ai/resumeDocumentMapperDiagnostics";

export type ResumeMapperSafeDiagnostics = {
  safeErrorCode: string;
  failedIssues: SafeSchemaIssue[];
  provider?: string;
  model?: string;
  attempt?: number;
  latencyMs?: number;
};

export class ResumeDocumentSemanticMapperError extends Error {
  constructor(
    readonly code:
      | "provider_unavailable"
      | "provider_timeout"
      | "provider_http_error"
      | "model_output_truncated"
      | "model_invalid_json"
      | "model_schema_invalid"
      | "grounding_validation_failed"
      | "semantic_validation_failed"
      | "request_cancelled"
      | "unresolved_sensitive_placeholder",
    message: string,
    readonly diagnostics?: ResumeMapperSafeDiagnostics
  ) {
    super(message);
  }
}

export class ResumeDocumentSemanticMapper {
  constructor(private readonly repository: WorkspaceRepository) {}

  async map(
    sourceDraft: ImportedResumeDraftV2,
    input: {
      signal?: AbortSignal;
      onProgress?: (message: string) => void;
    } = {}
  ): Promise<ImportedResumeDraft> {
    const highConfidenceName = highConfidenceNameForTokenization(sourceDraft);
    const tokenizer = createSensitiveTextTokenizer({
      highConfidenceNames: highConfidenceName ? [highConfidenceName] : []
    });
    const sourceDocument = sourceDocumentFromDraft(sourceDraft);
    const redactedDocument = tokenizeResumeSourceDocument(sourceDocument, tokenizer);
    const batches = buildSemanticMappingBatches(redactedDocument);

    const outputs: AiCareerAdaptResumeV2MapperOutput[] = [];
    const logs = [];
    for (let index = 0; index < batches.length; index += 1) {
      input.onProgress?.(
        batches.length > 1
          ? `AI 正在识别简历内容（${index + 1}/${batches.length}）…`
          : "AI 正在识别简历内容…"
      );
      const rawText = JSON.stringify(batches[index]);
      const inputHash = await hashText(
        `${rawText}|${sourceDraft.parserVersion}|resume-document-mapper.v6`
      );
      const result = await invokeStructuredAi({
        task: "resume-document-mapper",
        businessInput: { rawText, inputHash },
        outputSchema: AiCareerAdaptResumeV2MapperOutputSchema,
        signal: input.signal
      });
      logs.push(result.ok && result.data.mapperDiagnostics ? {
        ...result.log,
        localNormalizationMs: result.data.mapperDiagnostics.localNormalizationMs,
        groundedFieldCount: result.data.mapperDiagnostics.groundedFieldCount,
        repairedFieldCount: result.data.mapperDiagnostics.repairedFieldCount,
        rejectedFieldCount: result.data.mapperDiagnostics.rejectedFieldCount,
        shapeRepairs: result.data.mapperDiagnostics.shapeRepairs,
        evidenceRepairs: result.data.mapperDiagnostics.evidenceRepairs,
        rejectedFields: result.data.mapperDiagnostics.rejectedFields
      } : result.log);
      if (process.env.NODE_ENV === "development") {
        console.info("[resume-document-mapper:batch]", {
          task: "resume-document-mapper",
          provider: result.log.provider,
          model: result.log.model,
          attempt: result.log.attemptCount ?? 1,
          safeErrorCode: result.ok ? undefined : result.errorCode,
          latencyMs: result.log.latencyMs,
          inputChars: rawText.length,
          outputChars: result.log.outputLength,
          batchIndex: index + 1,
          batchCount: batches.length,
          localNormalizationMs: result.ok
            ? result.data.mapperDiagnostics?.localNormalizationMs
            : undefined,
          groundedFieldCount: result.ok
            ? result.data.mapperDiagnostics?.groundedFieldCount
            : undefined,
          repairedFieldCount: result.ok
            ? result.data.mapperDiagnostics?.repairedFieldCount
            : undefined,
          rejectedFieldCount: result.ok
            ? result.data.mapperDiagnostics?.rejectedFieldCount
            : undefined
        });
      }
      if (!result.ok) {
        await this.repository.saveAiLogs(logs);
        const classified = classifyMapperError(result.errorCode);
        throw new ResumeDocumentSemanticMapperError(
          classified.code,
          classified.message,
          result.diagnostics
        );
      }
      outputs.push(result.data);
    }
    await this.repository.saveAiLogs(logs);

    input.onProgress?.("正在校验字段来源…");
    const redactedMerged = mergeDocumentMapperOutputs(outputs, redactedDocument.blocks);

    // Build once against the redacted authority, then close the source-block
    // partition from the actual draft bindings rather than model uncited hints.
    const redactedDraft = createMappedDraft(sourceDraft, redactedMerged, redactedDocument.blocks);
    const closedRedactedMerged = {
      ...redactedMerged,
      unclassifiedRefs: recomputeFinalUnclassifiedRefs(
        redactedMerged,
        redactedDraft,
        redactedDocument.blocks
      )
    };

    const restoredMerged = restoreSensitivePlaceholders(
      closedRedactedMerged,
      tokenizer.restorationMap
    );
    const mappedDraft = createMappedDraft(
      sourceDraft,
      restoredMerged,
      sourceDraft.sourceBlocks
    );
    if (containsUnresolvedSensitivePlaceholder(mappedDraft)) {
      throw new ResumeDocumentSemanticMapperError(
        "unresolved_sensitive_placeholder",
        "AI 映射结果仍包含未恢复的敏感信息占位符。"
      );
    }
    const invariantReport = auditResumeImportInvariants(mappedDraft);
    if (invariantReport.mappedSourceBlockRepeatedInUnclassified > 0) {
      throw new ResumeDocumentSemanticMapperError(
        "semantic_validation_failed",
        "来源块同时进入已映射条目和未分类列表，已停止导入以避免重复。"
      );
    }
    return mappedDraft;
  }
}

function highConfidenceNameForTokenization(sourceDraft: ImportedResumeDraftV2) {
  const candidate = sourceDraft.basics.name?.confidence === "high"
    && sourceDraft.basics.name.sourceStatus === "located"
    ? sourceDraft.basics.name.value
    : undefined;
  if (!isPlausibleSensitiveNameCandidate(candidate)) return undefined;
  const firstSectionIndex = sourceDraft.sourceBlocks.findIndex((block) => block.blockType === "heading");
  const topBlocks = sourceDraft.sourceBlocks
    .slice(0, firstSectionIndex < 0 ? Math.min(12, sourceDraft.sourceBlocks.length) : firstSectionIndex)
    .map((block) => block.normalizedText);
  return topBlocks.some((text) => text.includes(candidate)) ? candidate : undefined;
}

function classifyMapperError(errorCode: string): {
  code: ResumeDocumentSemanticMapperError["code"];
  message: string;
} {
  if (errorCode === "request_cancelled") {
    return { code: "request_cancelled", message: "AI 识别已取消。" };
  }
  if (errorCode === "provider_timeout") {
    return { code: "provider_timeout", message: "AI 服务超时，可重试或使用本地解析。" };
  }
  if (errorCode === "model_output_truncated") {
    return { code: "model_output_truncated", message: "AI 输出被截断，请重试或使用本地解析。" };
  }
  if (errorCode === "model_invalid_json" || errorCode === "structured_endpoint_invalid_json") {
    return { code: "model_invalid_json", message: "模型返回的结构无法读取，可重试。" };
  }
  if (errorCode === "model_schema_invalid" || errorCode === "client_schema_validation_failed") {
    return { code: "model_schema_invalid", message: "模型返回的结构未通过校验，可重试。" };
  }
  if (errorCode.startsWith("grounding_validation_failed")) {
    return { code: "grounding_validation_failed", message: "模型返回的内容无法与原文对应，请重试或使用本地解析。" };
  }
  if (errorCode.startsWith("semantic_validation_failed")) {
    return { code: "semantic_validation_failed", message: "模型返回的结构未通过语义校验，可重试。" };
  }
  if (errorCode.startsWith("provider_http_") || errorCode === "provider_http_error") {
    return { code: "provider_http_error", message: "AI 服务返回错误，可重试或使用本地解析。" };
  }
  if (errorCode === "provider_invalid_json") {
    return { code: "provider_http_error", message: "AI 服务响应无法读取，可重试或使用本地解析。" };
  }
  return { code: "provider_unavailable", message: "AI 服务暂时不可用，可重试或使用本地解析。" };
}

function createMappedDraft(
  sourceDraft: ImportedResumeDraftV2,
  output: AiCareerAdaptResumeV2MapperOutput,
  sourceBlocks: ResumeSourceBlockV2[]
) {
  const mapped = createImportedResumeDraftFromStructuredJson({
    importId: sourceDraft.importId,
    source: sourceDraft.source,
    canonicalResume: CareerAdaptResumeJsonV2Schema.parse(output.resume),
    canonicalSourceRefs: output.sourceRefs,
    unclassifiedBlocks: unclassifiedBlocksFromRefs(output, sourceBlocks),
    sourceKind: "external_json",
    sourceBlocks,
    qualityReport: sourceDraft.qualityReport,
    now: sourceDraft.createdAt
  });
  return ImportedResumeDraftSchema.parse({
    ...mapped,
    sourceKind: sourceDraft.sourceKind,
    source: sourceDraft.source,
    pages: sourceDraft.pages,
    parserVersion: `${sourceDraft.parserVersion}+resume-document-mapper.v6-canonical-v2`,
    warnings: [
      ...mapped.warnings,
      ...(output.mapperDiagnostics?.rejectedFields ?? []).map((field) => ({
        code: "ai_field_not_grounded",
        message: `AI 字段未通过来源核验，已隔离待核对：${field.path}`
      }))
    ],
    createdAt: sourceDraft.createdAt
  });
}

function recomputeFinalUnclassifiedRefs(
  output: AiCareerAdaptResumeV2MapperOutput,
  draft: ImportedResumeDraft,
  sourceBlocks: readonly ResumeSourceBlockV2[]
): AiCareerAdaptResumeV2MapperOutput["unclassifiedRefs"] {
  const blockByAnyId = new Map<string, ResumeSourceBlockV2>();
  for (const block of sourceBlocks) {
    blockByAnyId.set(block.id, block);
    if (block.sourcePath) blockByAnyId.set(block.sourcePath, block);
  }
  const coveredBlockIds = new Set<string>();
  const addCovered = (blockIds: readonly string[]) => {
    for (const blockId of blockIds) {
      const block = blockByAnyId.get(blockId);
      if (block) coveredBlockIds.add(block.id);
    }
  };

  for (const field of Object.values(draft.basics)) {
    if (Array.isArray(field)) {
      field.forEach((entry) => addCovered(entry.sourceBlockIds));
    } else if (field) {
      addCovered(field.sourceBlockIds);
    }
  }
  for (const section of draft.sections) {
    for (const item of section.items) addCovered(item.sourceBlockIds);
  }

  for (const ref of output.sourceRefs) {
    if (isCanonicalSourceRefPath(ref.path)) addCovered(ref.blockIds);
  }

  const canonicalSectionTypes = new Set(draft.sections.map((section) => section.sectionType));
  const structuralBlockIds = new Set(
    sourceBlocks.flatMap((block) => {
      const match = matchResumeSectionHeading(block.normalizedText);
      return match?.kind === "canonical_section" && canonicalSectionTypes.has(match.sectionType)
        ? [block.id]
        : [];
    })
  );

  const refs = output.unclassifiedRefs.flatMap((ref) => {
    const blockIds = [...new Set(ref.blockIds.flatMap((blockId) => {
      const block = blockByAnyId.get(blockId);
      return block && !coveredBlockIds.has(block.id) && !structuralBlockIds.has(block.id) ? [block.id] : [];
    }))];
    return blockIds.length ? [{ blockIds, reason: ref.reason }] : [];
  });
  for (const block of sourceBlocks) {
    if (coveredBlockIds.has(block.id) || structuralBlockIds.has(block.id)) continue;
    refs.push({ blockIds: [block.id], reason: "AI 未引用该来源块，已确定性保留。" });
  }
  return dedupeUnclassifiedRefs(refs);
}

function isCanonicalSourceRefPath(path: string) {
  return /^\/basics\/[A-Za-z][A-Za-z0-9_-]*$/u.test(path)
    || /^\/sections\/\d+\/items\/\d+(?:\/[A-Za-z][A-Za-z0-9_-]*(?:\/\d+)*)?$/u.test(path);
}

export function mergeDocumentMapperOutputs(
  outputs: AiCareerAdaptResumeV2MapperOutput[],
  sourceBlocks: readonly ResumeSourceBlockV2[]
): AiCareerAdaptResumeV2MapperOutput {
  const originalItemRefs = outputs.flatMap((output, outputIndex) =>
    output.sourceRefs.flatMap((ref) => {
      const match = ref.path.match(/^\/sections\/(\d+)\/items\/(\d+)$/u);
      if (!match) return [];
      const sectionIndex = Number(match[1]);
      const itemIndex = Number(match[2]);
      const itemId = output.resume.sections[sectionIndex]?.items[itemIndex]?.id;
      return itemId ? [{ outputIndex, originalPath: ref.path, itemId }] : [];
    })
  );
  const sections = mergeCanonicalSections(outputs.flatMap((output) => output.resume.sections));
  const finalPathByItemId = new Map(sections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => [item.id, `/sections/${sectionIndex}/items/${itemIndex}`] as const)
  ));
  const itemRefPathByOriginal = new Map(originalItemRefs.flatMap((entry) => {
    const path = finalPathByItemId.get(entry.itemId);
    return path ? [[`${entry.outputIndex}:${entry.originalPath}`, path] as const] : [];
  }));
  const mapperDiagnostics = {
    shapeRepairs: Array.from(new Set(outputs.flatMap(
      (output) => output.mapperDiagnostics?.shapeRepairs ?? []
    ))),
    evidenceRepairs: Array.from(new Set(outputs.flatMap(
      (output) => output.mapperDiagnostics?.evidenceRepairs ?? []
    ))),
    rejectedFields: outputs.flatMap(
      (output) => output.mapperDiagnostics?.rejectedFields ?? []
    ),
    localNormalizationMs: outputs.reduce(
      (sum, output) => sum + (output.mapperDiagnostics?.localNormalizationMs ?? 0),
      0
    ),
    groundedFieldCount: outputs.reduce(
      (sum, output) => sum + (output.mapperDiagnostics?.groundedFieldCount ?? 0),
      0
    ),
    repairedFieldCount: outputs.reduce(
      (sum, output) => sum + (output.mapperDiagnostics?.repairedFieldCount ?? 0),
      0
    ),
    rejectedFieldCount: outputs.reduce(
      (sum, output) => sum + (output.mapperDiagnostics?.rejectedFieldCount ?? 0),
      0
    )
  };
  const cited = new Set([
    ...outputs.flatMap((output) => output.sourceRefs.flatMap((ref) => ref.blockIds)),
    ...outputs.flatMap((output) => output.unclassifiedRefs.flatMap((ref) => ref.blockIds))
  ]);
  const unclassifiedRefs = outputs.flatMap((output) => output.unclassifiedRefs);
  for (const block of sourceBlocks) {
    if (
      !cited.has(block.id)
      && !unclassifiedRefs.some((item) => item.blockIds.includes(block.id))
    ) {
      unclassifiedRefs.push({
        blockIds: [block.id],
        reason: "AI 未引用该来源块，已确定性保留。"
      });
    }
  }
  return AiCareerAdaptResumeV2MapperOutputSchema.parse({
    resume: {
      schemaVersion: "careeradapt-resume-v2",
      locale: outputs.find((output) => output.resume.locale)?.resume.locale ?? "zh-CN",
      basics: Object.assign({}, ...outputs.map((output) => output.resume.basics)),
      sections,
      unclassifiedBlocks: []
    },
    sourceRefs: outputs.flatMap((output, outputIndex) => output.sourceRefs.map((ref) => ({
      ...ref,
      path: itemRefPathByOriginal.get(`${outputIndex}:${ref.path}`) ?? ref.path
    }))),
    unclassifiedRefs: dedupeUnclassifiedRefs(unclassifiedRefs),
    mapperDiagnostics,
  });
}

function unclassifiedBlocksFromRefs(
  output: AiCareerAdaptResumeV2MapperOutput,
  sourceBlocks: readonly ResumeSourceBlockV2[]
): ImportedResumeDraft["unclassifiedBlocks"] {
  const blockById = new Map(sourceBlocks.flatMap((block) => [
    [block.id, block] as const,
    ...(block.sourcePath ? [[block.sourcePath, block] as const] : [])
  ]));
  return output.unclassifiedRefs.flatMap((ref) =>
    ref.blockIds.flatMap((blockId) => {
      const block = blockById.get(blockId);
      return block ? [{
        sourcePath: block.id,
        sourceValue: block.normalizedText,
        reason: ref.reason
      }] : [];
    })
  );
}

function mergeCanonicalSections(sections: AiCareerAdaptResumeV2MapperOutput["resume"]["sections"]) {
  const merged = new Map<string, AiCareerAdaptResumeV2MapperOutput["resume"]["sections"][number]>();
  for (const section of [...sections].sort((left, right) => (left.order ?? 0) - (right.order ?? 0))) {
    const title = section.title ?? section.sectionType;
    const key = `${section.sectionType}:${title.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase()}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...section, title, items: [...section.items] });
      continue;
    }
    existing.items.push(...section.items);
    existing.visible = existing.visible || section.visible;
  }
  return [...merged.values()].map((section, order) => ({
    ...section,
    order,
    items: section.items.map((item, itemIndex) => ({
      ...item,
      id: item.id || `ai-${section.sectionType}-${order + 1}-${itemIndex + 1}`
    }))
  }));
}

function dedupeUnclassifiedRefs(refs: AiCareerAdaptResumeV2MapperOutput["unclassifiedRefs"]) {
  return [...new Map(refs.map((ref) => [
    `${ref.blockIds.join(",")}\u0000${ref.reason}`,
    ref
  ])).values()];
}
