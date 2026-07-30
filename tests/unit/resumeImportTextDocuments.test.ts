import { describe, expect, it } from "vitest";
import {
  extractMarkdownSourceBlocks,
  extractPlainTextSourceBlocks
} from "@/domain/resumeImport/textDocument";
import {
  buildSemanticMappingBatches,
  groupSourceDocument
} from "@/domain/resumeImport/sourceDocument";
import {
  ImportQualityReportV2Schema,
  ResumeSourceDocumentV2Schema
} from "@/domain/schemas";

describe("P4.3c text source documents", () => {
  it("preserves Markdown headings, lists, paragraphs, and stable ordering", () => {
    const blocks = extractMarkdownSourceBlocks([
      "# 张同学",
      "",
      "## 项目与研究",
      "- 项目 A",
      "  跨行说明",
      "- 保留完整要点"
    ].join("\n"));

    expect(blocks.map((block) => [block.blockType, block.text])).toEqual([
      ["heading", "张同学"],
      ["heading", "项目与研究"],
      ["list_item", "项目 A"],
      ["paragraph", "跨行说明"],
      ["list_item", "保留完整要点"]
    ]);
    expect(blocks.map((block) => block.order)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
  });

  it("preserves TXT paragraphs without inventing structure", () => {
    const blocks = extractPlainTextSourceBlocks("个人总结\n保持原文\n\n技能\nTypeScript");
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.rawText)).toEqual(["个人总结\n保持原文", "技能\nTypeScript"]);
    expect(blocks.every((block) => block.blockType === "paragraph")).toBe(true);
  });

  it("batches complete heading groups and refuses to split an oversized semantic item", () => {
    const normalized = extractMarkdownSourceBlocks("# 工作经历\n\n- 第一条\n- 第二条\n\n# 技能\n\nTypeScript").map((block) => ({
      ...block,
      normalizedText: block.text,
      normalizationActions: []
    }));
    const quality = ImportQualityReportV2Schema.parse({
      schemaVersion: "resume-import-quality-v2",
      sourceType: "markdown",
      classification: "markdown",
      textCoverage: 1,
      replacementCharacterRatio: 0,
      abnormalWhitespaceRatio: 0,
      lineFragmentationScore: 0,
      readingOrderConfidence: "high",
      layoutComplexity: "single_column",
      recommendedRoute: "deterministic",
      recommendedPipeline: "text_structure",
      pageCount: 1,
      coordinateCoverage: 0,
      hasUsableTextLayer: true,
      ocrRequiredPages: [],
      thresholds: {
        minimumTextCoverage: 0.45,
        maximumReplacementCharacterRatio: 0.015,
        maximumLineFragmentationScore: 0.88
      },
      warnings: []
    });
    const document = ResumeSourceDocumentV2Schema.parse({
      schemaVersion: "resume-source-document-v2",
      sourceId: "source-text-test",
      sourceKind: "markdown",
      fileName: "resume.md",
      fileHash: "1234567890abcdef",
      pageCount: 1,
      blocks: normalized,
      quality
    });

    const groups = groupSourceDocument(document);
    expect(groups.map((group) => group.blocks.map((block) => block.id))).toEqual([
      normalized.slice(0, 3).map((block) => block.id),
      normalized.slice(3).map((block) => block.id)
    ]);
    const limitBetweenGroups = JSON.stringify(groups[0].blocks).length + 2;
    expect(buildSemanticMappingBatches(document, limitBetweenGroups)).toHaveLength(2);
    expect(() => buildSemanticMappingBatches(document, 20)).toThrow("resume_semantic_group_too_large");
  });
});
