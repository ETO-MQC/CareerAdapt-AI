import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import { normalizeResumeMapperBoundaryOutput } from "@/ai/tasks/resumeDocumentMapperOutput";
import {
  buildSemanticMappingBatches,
  tokenizeResumeSourceDocument
} from "@/domain/resumeImport/sourceDocument";
import {
  ImportQualityReportV2Schema,
  ResumeSourceDocumentV2Schema,
  type ResumeJsonMapperOutput
} from "@/domain/schemas";
import {
  createSensitiveTextTokenizer,
  restoreSensitivePlaceholders
} from "@/services/security/text";
import { mergeDocumentMapperOutputs } from "@/services/resumeImport/ResumeDocumentSemanticMapper";

const quality = ImportQualityReportV2Schema.parse({
  schemaVersion: "resume-import-quality-v2",
  sourceType: "docx",
  classification: "docx",
  textCoverage: 1,
  replacementCharacterRatio: 0,
  abnormalWhitespaceRatio: 0,
  lineFragmentationScore: 0,
  readingOrderConfidence: "high",
  layoutComplexity: "single_column",
  recommendedRoute: "ai_text",
  recommendedPipeline: "docx_structure",
  pageCount: 1,
  coordinateCoverage: 1,
  hasUsableTextLayer: true,
  ocrRequiredPages: [],
  thresholds: {
    minimumTextCoverage: 0.45,
    maximumReplacementCharacterRatio: 0.015,
    maximumLineFragmentationScore: 0.88
  },
  warnings: []
});

function sourceDocument(texts: string[]) {
  return ResumeSourceDocumentV2Schema.parse({
    schemaVersion: "resume-source-document-v2",
    sourceId: "reliability-source",
    sourceKind: "docx",
    fileName: "visual-headings.docx",
    fileHash: "1234567890abcdef",
    pageCount: 1,
    quality,
    blocks: texts.map((text, order) => ({
      id: `block-${order}`,
      text,
      rawText: text,
      normalizedText: text,
      blockType: "paragraph",
      order,
      page: 1,
      position: {
        x: 0.12345678901234566 + order,
        y: 0.9876543210987654 + order,
        width: 531.1234567890123,
        height: 12.9876543210987
      },
      normalizationActions: [],
      sourceKind: "docx",
      sourceEngine: "docx_xml",
      sourceEngineVersion: "test",
      extractionConfidence: 1
    }))
  });
}

describe("P4.3c.2 resume import reliability", () => {
  it("tokenizes only human text and leaves fractional numeric metadata exact", () => {
    const original = sourceDocument(["张三 13800000000 demo@example.com 上海市浦东新区世纪大道1号"]);
    const tokenizer = createSensitiveTextTokenizer({ highConfidenceNames: ["张三"] });
    const tokenized = tokenizeResumeSourceDocument(original, tokenizer);

    expect(tokenized.blocks[0].position).toEqual(original.blocks[0].position);
    expect(tokenized.blocks[0].order).toBe(original.blocks[0].order);
    expect(tokenized.blocks[0].normalizedText).toContain("[PHONE_1]");
    expect(tokenized.blocks[0].normalizedText).toContain("[EMAIL_1]");
    expect(restoreSensitivePlaceholders(tokenized, tokenizer.restorationMap).blocks[0].normalizedText)
      .toBe(original.blocks[0].normalizedText);
  });

  it("compacts and batches a heading-free DOCX without batch_too_large or source loss", () => {
    const document = sourceDocument(Array.from(
      { length: 60 },
      (_, index) => `${index % 10 === 0 ? "项目经历" : "项目要点"} ${index} ${"完整来源内容".repeat(80)}`
    ));
    const batches = buildSemanticMappingBatches(document);
    const providerBlocks = batches.flat();

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => JSON.stringify(batch).length <= 20_000)).toBe(true);
    expect(new Set(providerBlocks.map((block) => block.originalBlockId ?? block.id))).toEqual(
      new Set(document.blocks.map((block) => block.id))
    );
    expect(providerBlocks.every((block) => !("rawText" in block) && !("normalizationActions" in block))).toBe(true);
  });

  it("keeps fractional provider DTO metadata valid and accepts an uncited Markdown block", () => {
    const definition = aiTaskRegistry["resume-document-mapper"];
    const document = sourceDocument(["# 张三", "## 项目", "完成项目 12 个", "无关页脚"]);
    const compact = buildSemanticMappingBatches(document)[0];
    const rawText = JSON.stringify(compact);
    const output: ResumeJsonMapperOutput = {
      structuredDraft: {
        basics: {},
        sections: [{
          title: "项目",
          sectionType: "experience",
          category: "project",
          items: [{
            text: "完成项目 12 个",
            mapping: {
              sourcePaths: ["block-2"],
              sourceValues: ["完成项目 12 个"],
              confidenceLevel: "high",
              confidenceReason: "exact",
              needsConfirmation: false
            }
          }]
        }]
      },
      mappingDecisions: [],
      unclassifiedBlocks: []
    };

    expect(() => JSON.parse(rawText)).not.toThrow();
    expect(() => definition.validateOutput(output, { rawText, inputHash: "fractional-input" })).not.toThrow();
    const merged = mergeDocumentMapperOutputs([output], document.blocks);
    expect(merged.unclassifiedBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourcePath: "block-3", sourceValue: "无关页脚" })
    ]));
  });

  it("quarantines isolated invented numbers and invalid source block ids", () => {
    const definition = aiTaskRegistry["resume-document-mapper"];
    const rawText = JSON.stringify([{ id: "known", text: "完成项目 12 个" }]);
    const invented: ResumeJsonMapperOutput = {
      structuredDraft: {
        basics: {},
        sections: [{
          title: "项目",
          sectionType: "experience",
          category: "project",
          items: [{
            text: "完成项目 13 个",
            mapping: {
              sourcePaths: ["known"],
              sourceValues: ["完成项目 12 个"],
              confidenceLevel: "high",
              confidenceReason: "exact",
              needsConfirmation: false
            }
          }]
        }]
      },
      mappingDecisions: [],
      unclassifiedBlocks: []
    };
    const normalizedInvented = normalizeResumeMapperBoundaryOutput(
      invented,
      [{ id: "known", text: "完成项目 12 个" }]
    ) as ResumeJsonMapperOutput;
    expect(normalizedInvented.structuredDraft.sections[0].items).toEqual([]);
    expect(normalizedInvented.mapperDiagnostics?.rejectedFields).toContainEqual({
      path: "structuredDraft.sections[0].items[0].text",
      reason: "ai_field_not_grounded"
    });
    expect(() => definition.validateOutput(
      normalizedInvented,
      { rawText, inputHash: "invented-number" }
    )).not.toThrow();

    const invalidId = structuredOutputFor("missing", "完成项目 12 个");
    const normalizedInvalidId = normalizeResumeMapperBoundaryOutput(
      invalidId,
      [{ id: "known", text: "完成项目 12 个" }]
    ) as ResumeJsonMapperOutput;
    expect(normalizedInvalidId.structuredDraft.sections[0].items).toEqual([]);
    expect(normalizedInvalidId.mapperDiagnostics?.rejectedFields).toContainEqual({
      path: "structuredDraft.sections[0].items[0].text",
      reason: "ai_field_not_grounded"
    });
  });
});

function structuredOutputFor(sourcePath: string, text: string): ResumeJsonMapperOutput {
  return {
    structuredDraft: {
      basics: {},
      sections: [{
        title: "项目",
        sectionType: "experience",
        category: "project",
        items: [{
          text,
          mapping: {
            sourcePaths: [sourcePath],
            sourceValues: [text],
            confidenceLevel: "high",
            confidenceReason: "exact",
            needsConfirmation: false
          }
        }]
      }]
    },
    mappingDecisions: [],
    unclassifiedBlocks: []
  };
}
