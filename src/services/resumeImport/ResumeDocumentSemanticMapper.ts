"use client";

import { invokeStructuredAi } from "@/ai/client";
import { createImportedResumeDraftFromStructuredJson } from "@/domain/resumeImport/parser";
import {
  buildSemanticMappingBatches,
  sourceDocumentFromDraft
} from "@/domain/resumeImport/sourceDocument";
import {
  ImportedResumeDraftSchema,
  ResumeJsonMapperOutputSchema,
  ResumeSourceDocumentV2Schema,
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

export class ResumeDocumentSemanticMapperError extends Error {
  constructor(
    readonly code: "batch_too_large" | "ai_unavailable" | "unresolved_sensitive_placeholder",
    message: string
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
    const redactedDocument = ResumeSourceDocumentV2Schema.parse(
      JSON.parse(tokenizer.tokenize(JSON.stringify(sourceDocument)).text)
    );
    let batches: ResumeSourceBlockV2[][];
    try {
      batches = buildSemanticMappingBatches(redactedDocument);
    } catch {
      throw new ResumeDocumentSemanticMapperError(
        "batch_too_large",
        "单个完整经历过长，未将其强行拆分。"
      );
    }

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
        `${rawText}|${sourceDraft.parserVersion}|resume-document-mapper.v2`
      );
      const result = await invokeStructuredAi({
        task: "resume-document-mapper",
        businessInput: { rawText, inputHash },
        outputSchema: ResumeJsonMapperOutputSchema,
        signal: input.signal
      });
      logs.push(result.log);
      if (!result.ok) {
        await this.repository.saveAiLogs(logs);
        throw new ResumeDocumentSemanticMapperError(
          "ai_unavailable",
          "AI 简历语义识别暂时不可用。"
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
    parserVersion: `${sourceDraft.parserVersion}+resume-document-mapper.v2`,
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
