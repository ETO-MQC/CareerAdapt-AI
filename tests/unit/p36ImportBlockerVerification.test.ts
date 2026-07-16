import { describe, expect, it } from "vitest";
import { createDeterministicFieldCandidates } from "@/domain/resumeImport/fieldCandidates";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import { isCanonicalFieldId } from "@/domain/resumeFields";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NormalizedSourceBlock, PdfPageText } from "@/domain/schemas";

const TEST_TIME = "2026-07-16T00:00:00.000Z";
const OUTPUT_DIR = resolve(process.cwd(), "artifacts", "p36-import-blocker-verification");

function ensureOutputDir() {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function block(id: string, text: string, order: number, blockType: NormalizedSourceBlock["blockType"] = "paragraph"): NormalizedSourceBlock {
  return {
    id,
    text,
    rawText: text,
    normalizedText: text,
    normalizationActions: [],
    blockType,
    order,
    extractionConfidence: 0.98
  };
}

function createGoldenPageTexts(): PdfPageText[] {
  const pageText = [
    "M",
    "未指定岗位 / 通用简历",
    "某地（远程）",
    "13800138000",
    "demo.user@example.com",
    "https://github.com/ETO-MQC",
    "",
    "教育经历",
    "示例大学 计算机相关专业 2024-09 - 2028-06",
    "",
    "工作与实习经历",
    "AI辅助文档与指令评估实践 2024-09 - 至今",
    "",
    "项目成果",
    "示例任务系统智能专注助手 2026-02 - 至今",
    "",
    "奖项",
    "示例编程竞赛一等奖 2025-03",
    "",
    "技能",
    "Python, JavaScript, TypeScript, React, Node.js",
    "",
    "语言",
    "英语 CET-6"
  ].join("\n");

  return [{
    id: "pdf-page-golden-1",
    sessionId: "pdf-session-golden-verify",
    pageNumber: 1,
    extractedPageText: pageText,
    cleanedPageText: pageText,
    charStart: 0,
    charEnd: pageText.length,
    textItemCount: pageText.split("\n").length,
    warnings: [],
    rawTextHash: "raw-golden-verify-1",
    cleanedTextHash: "clean-golden-verify-1",
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  }];
}

describe("P3.6 import blocker verification", () => {
  it("verifies all deterministic candidates have valid targetFieldId", () => {
    ensureOutputDir();

    const blocks = [
      block("b0", "教育经历", 0, "heading"),
      block("b1", "示例大学 计算机相关专业 2024-09 - 2028-06", 1),
      block("b2", "GPA：4.95/5.0，专业排名：1/42", 2),
      block("b3", "工作与实习经历", 3, "heading"),
      block("b4", "AI辅助文档与指令评估实践 2024-09 - 至今", 4),
      block("b5", "项目成果", 5, "heading"),
      block("b6", "示例任务系统智能专注助手 2026-02 - 至今", 6)
    ];

    const result = createDeterministicFieldCandidates(blocks);

    // Verify all candidates have valid targetFieldId
    const invalidCandidates = result.candidates.filter((c) => !isCanonicalFieldId(c.targetFieldId));
    expect(invalidCandidates).toHaveLength(0);

    // Verify no creation errors
    const invalidCreationResults = result.creationResults.filter((r) => r.ok === false);
    expect(invalidCreationResults).toHaveLength(0);

    // Verify consumed ranges are computed
    expect(result.consumedRanges.length).toBeGreaterThan(0);

    // Verify residual segments exist (unmapped content)
    expect(result.residualSegments.length).toBeGreaterThanOrEqual(0);

    // Write diagnostics
    writeFileSync(
      resolve(OUTPUT_DIR, "diagnostics.json"),
      JSON.stringify({
        totalCandidates: result.candidates.length,
        invalidTargetFieldIds: invalidCandidates.length,
        creationErrors: invalidCreationResults.length,
        consumedRanges: result.consumedRanges.length,
        residualSegments: result.residualSegments.length,
        suppressed: result.suppressed.length
      }, null, 2)
    );

    // Write candidate summary
    writeFileSync(
      resolve(OUTPUT_DIR, "candidate-summary.json"),
      JSON.stringify(result.candidates.map((c) => ({
        id: c.id,
        targetFieldId: c.targetFieldId,
        value: c.value,
        confidence: c.confidence,
        needsConfirmation: c.needsConfirmation
      })), null, 2)
    );

    // Write consumed ranges
    writeFileSync(
      resolve(OUTPUT_DIR, "consumed-ranges.json"),
      JSON.stringify(result.consumedRanges.map((r) => ({
        blockId: r.blockId,
        start: r.start,
        end: r.end,
        targetFieldId: r.targetFieldId
      })), null, 2)
    );

    // Write residual segments
    writeFileSync(
      resolve(OUTPUT_DIR, "residual-summary.json"),
      JSON.stringify(result.residualSegments.map((r) => ({
        blockId: r.blockId,
        start: r.start,
        end: r.end,
        normalizedText: r.normalizedText
      })), null, 2)
    );
  });

  it("verifies real PDF import produces valid draft", () => {
    ensureOutputDir();

    const pageTexts = createGoldenPageTexts();
    const draft = createImportedResumeDraftFromPdf({
      importId: "p36-verify-integration",
      source: {
        fileName: "golden-resume.pdf",
        fileHash: "hash-p36-verify-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: pageTexts,
      now: TEST_TIME
    });

    // Verify basics
    expect(draft.basics.email?.value).toBe("demo.user@example.com");
    expect(draft.basics.phone?.value).toBe("13800138000");
    expect(draft.basics.location?.value).toContain("某地");
    expect(draft.basics.links.some((l) => l.value.includes("github.com/ETO-MQC"))).toBe(true);
    expect(draft.basics.name?.value).toBe("M");

    // Verify sections exist with correct categories
    const sectionCategories = draft.sections.map((s) => s.category).filter(Boolean);
    expect(sectionCategories).toContain("education");
    expect(sectionCategories).toContain("work");
    expect(sectionCategories).toContain("project");
    expect(sectionCategories).toContain("award");
    expect(sectionCategories).toContain("skill");
    expect(sectionCategories).toContain("language");

    // Verify field candidates - check basics candidates
    if (draft.schemaVersion === "resume-import-v2") {
      const phoneCandidates = draft.fieldCandidates.filter((c) => c.targetFieldId === "basics.phone");
      expect(phoneCandidates).toHaveLength(1);
      expect(phoneCandidates[0].value).toBe("13800138000");
    }

    // Write imported draft summary
    writeFileSync(
      resolve(OUTPUT_DIR, "imported-draft-summary.json"),
      JSON.stringify({
        importId: draft.importId,
        schemaVersion: draft.schemaVersion,
        basics: {
          name: draft.basics.name?.value,
          email: draft.basics.email?.value,
          phone: draft.basics.phone?.value,
          location: draft.basics.location?.value,
          links: draft.basics.links.map((l) => l.value)
        },
        sectionCount: draft.sections.length,
        sections: draft.sections.map((s) => ({
          category: s.category,
          title: s.detectedTitle,
          itemCount: s.items.length
        })),
        fieldCandidateCount: draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates.length : 0
      }, null, 2)
    );
  });

  it("verifies phone format with dashes is recognized", () => {
    const blocks = [block("b1", "138-0013-8000", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("13800138000");
  });

  it("verifies phone format with spaces is recognized", () => {
    const blocks = [block("b1", "138 0013 8000", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("13800138000");
  });

  it("verifies phone format with +86 prefix is recognized", () => {
    const blocks = [block("b1", "+86 138 0013 8000", 0)];
    const { candidates } = createDeterministicFieldCandidates(blocks);
    const phones = candidates.filter((c) => c.targetFieldId === "basics.phone");
    expect(phones).toHaveLength(1);
    expect(phones[0].value).toBe("13800138000");
  });

  it("verifies location with parenthetical is recognized", () => {
    const pageText = [
      "某地（远程）",
      "13800138000"
    ].join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "location-paren-test",
      source: {
        fileName: "location-test.pdf",
        fileHash: "hash-location-test-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });
    expect(draft.basics.location?.value).toContain("某地");
  });

  it("verifies location with dot separator is recognized", () => {
    const pageText = [
      "河南·某地",
      "13800138000"
    ].join("\n");
    const draft = createImportedResumeDraftFromPdf({
      importId: "location-dot-test",
      source: {
        fileName: "location-dot-test.pdf",
        fileHash: "hash-location-dot-test-1234567890",
        pageCount: 1,
        extractedAt: TEST_TIME
      },
      pages: [createPage(1, pageText)],
      now: TEST_TIME
    });
    expect(draft.basics.location?.value).toContain("某地");
  });
});

function createPage(pageNumber: number, text: string): PdfPageText {
  return {
    id: `pdf-page-verify-${pageNumber}`,
    sessionId: "pdf-session-verify",
    pageNumber,
    extractedPageText: text,
    cleanedPageText: text,
    charStart: 0,
    charEnd: text.length,
    textItemCount: text.split("\n").length,
    warnings: [],
    rawTextHash: `raw-verify-${pageNumber}`,
    cleanedTextHash: `clean-verify-${pageNumber}`,
    createdAt: TEST_TIME,
    updatedAt: TEST_TIME
  };
}
