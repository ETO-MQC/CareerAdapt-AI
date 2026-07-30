import { describe, expect, it } from "vitest";
import { analyzeImportQuality, normalizeExtractedSourceBlocks } from "@/domain/resumeImport/normalizer";
import {
  createSensitiveTextTokenizer,
  redactSensitiveTextForModel,
  restoreSensitivePlaceholders
} from "@/services/security/text";

describe("unified resume import normalizer", () => {
  it("cleans only mechanical text defects and preserves names, dates and numbers", () => {
    const [block] = normalizeExtractedSourceBlocks([{
      id: "block-1",
      text: "陈\u200B同学　2024-03 31 个样本\r\n\r\n\r\n•  数据清洗",
      rawText: "陈\u200B同学　2024-03 31 个样本\r\n\r\n\r\n•  数据清洗",
      blockType: "paragraph",
      order: 0
    }]);

    expect(block.rawText).toContain("2024-03 31");
    expect(block.normalizedText).toContain("陈同学 2024-03 31 个样本");
    expect(block.normalizedText).toContain("• 数据清洗");
    expect(block.normalizationActions).toEqual(expect.arrayContaining([
      "normalize_line_endings",
      "remove_zero_width_characters",
      "replace_full_width_spaces",
      "collapse_repeated_blank_lines"
    ]));
  });

  it("routes severely damaged text layers to the future OCR boundary", () => {
    const blocks = normalizeExtractedSourceBlocks([{
      id: "broken",
      page: 1,
      text: "� � � � �",
      rawText: "� � � � �",
      blockType: "text_block",
      order: 0
    }]);
    const report = analyzeImportQuality({ sourceType: "text_pdf", blocks });
    expect(report.recommendedRoute).toBe("ocr_ai");
    expect(report.readingOrderConfidence).toBe("low");
    expect(report.warnings.join(" ")).toContain("禁止让 AI 猜测原文");
  });

  it("detects multi-column positioned blocks without changing their facts", () => {
    const blocks = normalizeExtractedSourceBlocks([
      { id: "left-1", page: 1, text: "工作经历", rawText: "工作经历", blockType: "heading", position: { x: 40, y: 700, width: 100, height: 18 }, order: 0 },
      { id: "left-2", page: 1, text: "示例科技", rawText: "示例科技", blockType: "text_block", position: { x: 40, y: 660, width: 120, height: 16 }, order: 1 },
      { id: "right-1", page: 1, text: "技能", rawText: "技能", blockType: "heading", position: { x: 340, y: 700, width: 80, height: 18 }, order: 2 },
      { id: "right-2", page: 1, text: "TypeScript", rawText: "TypeScript", blockType: "text_block", position: { x: 340, y: 660, width: 110, height: 16 }, order: 3 }
    ]);
    expect(analyzeImportQuality({ sourceType: "text_pdf", blocks }).layoutComplexity).toBe("multi_column");
    expect(blocks.map((block) => block.normalizedText)).toEqual(["工作经历", "示例科技", "技能", "TypeScript"]);
  });

  it("uses stable sensitive placeholders and restores them locally", () => {
    const redacted = redactSensitiveTextForModel("邮箱 a@example.com，备用 a@example.com，电话 13800000000");
    expect(redacted.text).toContain("[EMAIL_1]");
    expect(redacted.text.match(/\[EMAIL_1\]/g)).toHaveLength(2);
    expect(redacted.text).toContain("[PHONE_1]");
    expect(restoreSensitivePlaceholders({ value: "[EMAIL_1] / [PHONE_1]" }, redacted.restorationMap)).toEqual({
      value: "a@example.com / 13800000000"
    });
  });

  it("keeps placeholders stable across source blocks and only protects authoritative names", () => {
    const tokenizer = createSensitiveTextTokenizer({ highConfidenceNames: ["张三"] });
    const first = tokenizer.tokenize("张三 13800000000 某省某地市金水区某路某号");
    const second = tokenizer.tokenize("联系人张三，电话 13800000000；工作地点某地");

    expect(first.text).toContain("[NAME_1]");
    expect(second.text).toContain("[NAME_1]");
    expect(first.text).toContain("[PHONE_1]");
    expect(second.text).toContain("[PHONE_1]");
    expect(first.text).toContain("[ADDRESS_1]");
    expect(second.text).toContain("工作地点某地");
    expect(second.text).not.toContain("[ADDRESS_");
    expect(tokenizer.restorationMap).toMatchObject({
      "[NAME_1]": "张三",
      "[PHONE_1]": "13800000000"
    });
  });

  it("does not guess a Chinese name when no authoritative candidate is supplied", () => {
    const redacted = redactSensitiveTextForModel("李明在北京大学完成项目，北京是期望城市。");
    expect(redacted.text).toBe("李明在北京大学完成项目，北京是期望城市。");
    expect(redacted.restorationMap).toEqual({});
  });
});
