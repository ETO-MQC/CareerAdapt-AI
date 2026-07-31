import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { OpenAiCompatibleProvider } from "@/ai/providers/openAiCompatibleProvider";
import {
  aiTaskRegistry,
  type AiTaskDefinition,
  type ResumeDocumentMapperTaskInput
} from "@/ai/tasks/registry";
import {
  AiCareerAdaptResumeV2MapperOutputSchema,
  type AiCareerAdaptResumeV2MapperOutput
} from "@/domain/schemas";
import { extractMarkdownSourceBlocks } from "@/domain/resumeImport/textDocument";
import { extractTextFromDocxBuffer } from "@/domain/resumeImport/docx";
import { normalizeExtractedSourceBlocks } from "@/domain/resumeImport/normalizer";
import { buildSemanticMappingBatches } from "@/domain/resumeImport/sourceDocument";
import { buildRetryPrompt } from "@/ai/retryPrompt";
import { summarizeSchemaIssues } from "@/ai/resumeDocumentMapperDiagnostics";
import { stableHashText } from "@/services/security/text";
import type { ExtractedSourceBlock, ResumeSourceDocumentV2 } from "@/domain/schemas";

const hasRealAiConfig = Boolean(process.env.AI_API_KEY && process.env.AI_MODEL);

const ANONYMIZED_MARKDOWN = `# 匿名候选人

## 教育经历
- 示例大学，信息管理，2022-09 至 2026-06

## 项目经历
- 校园信息平台，后端开发
- 使用 TypeScript 实现数据导入与校验

## 技能
- TypeScript、SQL
`;

describe("resume-document-mapper real provider", () => {
  (hasRealAiConfig ? it : it.skip)(
    "maps one anonymized Markdown resume into the grounded contract",
    async () => {
      const definition = aiTaskRegistry["resume-document-mapper"] as AiTaskDefinition<
        ResumeDocumentMapperTaskInput,
        AiCareerAdaptResumeV2MapperOutput
      >;
      const blocks = extractMarkdownSourceBlocks(ANONYMIZED_MARKDOWN);
      const result = await runRealMapper(definition, blocks, "markdown");
      expect(result.batchCount).toBe(1);
    }
  );

  (hasRealAiConfig ? it : it.skip)(
    "maps the existing DOCX fixture after real DOCX extraction",
    async () => {
      const definition = aiTaskRegistry["resume-document-mapper"] as AiTaskDefinition<
        ResumeDocumentMapperTaskInput,
        AiCareerAdaptResumeV2MapperOutput
      >;
      const bytes = await readFile(resolve("tests/fixtures/resume-import/ordinary.docx"));
      const extracted = await extractTextFromDocxBuffer(toArrayBuffer(bytes));
      expect(extracted.ok).toBe(true);
      if (!extracted.ok) return;
      const result = await runRealMapper(definition, extracted.blocks, "docx");
      expect(result.batchCount).toBeGreaterThan(0);
    }
  );

});

async function runRealMapper(
  definition: AiTaskDefinition<ResumeDocumentMapperTaskInput, AiCareerAdaptResumeV2MapperOutput>,
  extractedBlocks: ExtractedSourceBlock[],
  source: "markdown" | "docx" | "pdf"
) {
  const normalized = normalizeExtractedSourceBlocks(extractedBlocks);
  const document = {
    schemaVersion: "resume-source-document-v2",
    sourceId: `real-smoke-${source}`,
    sourceKind: source === "pdf" ? "complex_digital_pdf" : source,
    fileName: `anonymous.${source === "markdown" ? "md" : source}`,
    fileHash: "real-smoke-anonymous-hash",
    pageCount: Math.max(1, ...normalized.map((block) => block.page ?? 1)),
    blocks: normalized,
    quality: {}
  } as ResumeSourceDocumentV2;
  const batches = buildSemanticMappingBatches(document);
  const provider = new OpenAiCompatibleProvider();
  let attemptCount = 0;
  let totalLatencyMs = 0;
  let providerName = "";
  let model = "";

  for (const batch of batches) {
    const rawText = JSON.stringify(batch);
    const input: ResumeDocumentMapperTaskInput = {
      rawText,
      inputHash: stableHashText(rawText)
    };
    const baseUserPrompt = definition.buildUserPrompt(input);
    let issues = undefined;
    let passed = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attemptCount += 1;
      const startedAt = Date.now();
      const response = await provider.invoke({
        systemPrompt: definition.systemPrompt,
        userPrompt: attempt === 0 ? baseUserPrompt : buildRetryPrompt({
          task: "resume-document-mapper",
          baseUserPrompt,
          failure: "model_schema_invalid",
          issues
        }),
        maxOutputChars: definition.maxOutputChars,
        signal: AbortSignal.timeout(55_000)
      });
      totalLatencyMs += Date.now() - startedAt;
      providerName = response.provider;
      model = response.model;
      try {
        const normalizedOutput = definition.normalizeOutput(
          definition.coerceRawOutput(response.output, input) as AiCareerAdaptResumeV2MapperOutput,
          input
        );
        const parsed = AiCareerAdaptResumeV2MapperOutputSchema.parse(normalizedOutput);
        definition.validateOutput?.(parsed, input);
        passed = true;
        break;
      } catch (error) {
        issues = summarizeSchemaIssues(error);
        if (attempt === 1) throw error;
      }
    }
    expect(passed).toBe(true);
  }
  console.info("[resume-document-mapper:real-gate]", {
    source,
    provider: providerName,
    model,
    latencyMs: totalLatencyMs,
    attemptCount,
    batchCount: batches.length
  });
  return { batchCount: batches.length, attemptCount, totalLatencyMs };
}

function toArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
