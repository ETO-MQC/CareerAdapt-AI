"use client";

import { invokeStructuredAi } from "@/ai/client";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import {
  buildSemanticMappingBatches,
  sourceDocumentFromDraft,
  tokenizeResumeSourceDocument
} from "@/domain/resumeImport/sourceDocument";
import {
  ImportedResumeDraftSchema,
  ResumeJsonMapperOutputSchema,
  type ImportedResumeDraft,
  type ImportedResumeDraftV2,
  type ResumeJsonMapperOutput,
  type ResumeSourceBlockV2
} from "@/domain/schemas";
import {
  containsUnresolvedSensitivePlaceholder,
  createSensitiveTextTokenizer,
  hashText,
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
    const highConfidenceName = sourceDraft.basics.name?.confidence === "high"
      && sourceDraft.basics.name.sourceStatus === "located"
      ? sourceDraft.basics.name.value
      : undefined;
    const tokenizer = createSensitiveTextTokenizer({
      highConfidenceNames: highConfidenceName ? [highConfidenceName] : []
    });
    const sourceDocument = sourceDocumentFromDraft(sourceDraft);
    const redactedDocument = tokenizeResumeSourceDocument(sourceDocument, tokenizer);
    const batches = buildSemanticMappingBatches(redactedDocument);

    const outputs: ResumeJsonMapperOutput[] = [];
    const logs = [];
    for (let index = 0; index < batches.length; index += 1) {
      input.onProgress?.(
        batches.length > 1
          ? `AI 正在识别简历内容（${index + 1}/${batches.length}）…`
          : "AI 正在识别简历内容…"
      );
      const rawText = JSON.stringify(batches[index]);
      const inputHash = await hashText(
        `${rawText}|${sourceDraft.parserVersion}|resume-document-mapper.v3`
      );
      const result = await invokeStructuredAi({
        task: "resume-document-mapper",
        businessInput: { rawText, inputHash },
        outputSchema: ResumeJsonMapperOutputSchema,
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

    // This construction is deliberately performed against the redacted authority
    // before any local placeholder restoration.
    createMappedDraft(sourceDraft, redactedMerged, redactedDocument.blocks);

    const restoredMerged = restoreSensitivePlaceholders(
      redactedMerged,
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
    return mappedDraft;
  }
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
  output: ResumeJsonMapperOutput,
  sourceBlocks: ResumeSourceBlockV2[]
) {
  const mapped = createImportedResumeDraftFromStructuredJson({
    importId: sourceDraft.importId,
    source: sourceDraft.source,
    structuredDraft: output.structuredDraft,
    unclassifiedBlocks: output.unclassifiedBlocks,
    sourceKind: "external_json",
    sourceBlocks,
    qualityReport: sourceDraft.qualityReport,
    mappingDecisions: output.mappingDecisions,
    now: sourceDraft.createdAt
  });
  return ImportedResumeDraftSchema.parse({
    ...mapped,
    sourceKind: sourceDraft.sourceKind,
    source: sourceDraft.source,
    pages: sourceDraft.pages,
    parserVersion: `${sourceDraft.parserVersion}+resume-document-mapper.v4-boundary`,
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

export function mergeDocumentMapperOutputs(
  outputs: ResumeJsonMapperOutput[],
  sourceBlocks: readonly ResumeSourceBlockV2[]
): ResumeJsonMapperOutput {
  const structuredDraft = {
    schemaVersion: "structured-resume-draft-v1" as const,
    basics: Object.assign({}, ...outputs.map((output) => output.structuredDraft.basics)),
    sections: outputs.flatMap((output) => output.structuredDraft.sections)
  };
  const mappingDecisions = outputs.flatMap((output) => output.mappingDecisions ?? []);
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
    ...collectSourcePaths(structuredDraft),
    ...mappingDecisions.flatMap((decision) => decision.sourceBlockIds)
  ]);
  const unclassifiedBlocks = outputs.flatMap((output) => output.unclassifiedBlocks);
  for (const block of sourceBlocks) {
    if (
      !cited.has(block.id)
      && !unclassifiedBlocks.some((item) => item.sourcePath === block.id)
    ) {
      unclassifiedBlocks.push({
        sourcePath: block.id,
        sourceValue: block.normalizedText,
        reason: "AI 未引用该来源块，已确定性保留。"
      });
    }
  }
  return ResumeJsonMapperOutputSchema.parse({
    structuredDraft,
    mappingDecisions,
    mapperDiagnostics,
    unclassifiedBlocks: Array.from(
      new Map(unclassifiedBlocks.map((item) => [item.sourcePath, item])).values()
    )
  });
}

function collectSourcePaths(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSourcePaths);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const own = Array.isArray(record.sourcePaths)
    ? record.sourcePaths.filter((item): item is string => typeof item === "string")
    : [];
  return [...own, ...Object.values(record).flatMap(collectSourcePaths)];
}
