import {
  ImportQualityReportSchema,
  NormalizedSourceBlockSchema,
  type ExtractedSourceBlock,
  type ImportQualityReport,
  type NormalizedSourceBlock,
  type ResumeJsonMapperOutput,
  type ResumeSourceKind
} from "@/domain/schemas";

export const RESUME_IMPORT_CLEANER_VERSION = "resume-import.cleaner.v1";

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeExtractedSourceBlocks(blocks: ExtractedSourceBlock[]): NormalizedSourceBlock[] {
  const ordered = restoreReadingOrder(blocks);
  const edgeCounts = countRepeatedPageEdges(ordered);

  return ordered.map((block, order) => {
    const actions: string[] = [];
    let text = block.rawText;
    text = replaceTracked(text, /\r\n?/g, "\n", "normalize_line_endings", actions);
    text = replaceTracked(text, ZERO_WIDTH, "", "remove_zero_width_characters", actions);
    text = replaceTracked(text, /\u00A0/g, " ", "replace_non_breaking_spaces", actions);
    text = replaceTracked(text, /\u3000/g, " ", "replace_full_width_spaces", actions);
    text = replaceTracked(text, CONTROL_CHARACTERS, "", "remove_non_printable_characters", actions);
    text = replaceTracked(text, /^[●▪◦·]\s*/gm, "• ", "normalize_bullets", actions);
    text = replaceTracked(text, /[ \t]{2,}/g, " ", "collapse_repeated_spaces", actions);
    text = replaceTracked(text, /\n{3,}/g, "\n\n", "collapse_repeated_blank_lines", actions);
    text = joinObviousFragments(text, actions).trim();

    const edgeKey = normalizedEdgeKey(text);
    if (edgeKey && (edgeCounts.get(edgeKey) ?? 0) >= 2 && isPageEdgeBlock(block, ordered)) {
      text = "";
      actions.push("remove_repeated_page_header_or_footer");
    }

    return NormalizedSourceBlockSchema.parse({
      ...block,
      order,
      text: block.text || block.rawText,
      normalizedText: text,
      normalizationActions: actions
    });
  });
}

export function analyzeImportQuality(input: {
  sourceType: ResumeSourceKind;
  blocks: NormalizedSourceBlock[];
}): ImportQualityReport {
  const raw = input.blocks.map((block) => block.rawText).join("\n");
  const normalized = input.blocks.map((block) => block.normalizedText).join("\n");
  const rawLength = Math.max(1, Array.from(raw).length);
  const visibleLength = Array.from(normalized).filter((char) => !/\s/.test(char)).length;
  const replacementCharacterRatio = countMatches(raw, /�/g) / rawLength;
  const abnormalWhitespaceRatio = countMatches(raw, /[\u00A0\u2000-\u200D\u2060\u3000\uFEFF]| {3,}/g) / rawLength;
  const lineFragmentationScore = calculateLineFragmentation(input.blocks);
  const layoutComplexity = detectLayoutComplexity(input.blocks);
  const severeDamage = replacementCharacterRatio > 0.015
    || countMatches(raw, CONTROL_CHARACTERS) / rawLength > 0.02
    || lineFragmentationScore > 0.88
    || visibleLength < 20;
  const readingOrderConfidence = severeDamage
    ? "low"
    : layoutComplexity === "single_column" && lineFragmentationScore < 0.35
      ? "high"
      : "medium";
  const recommendedRoute = severeDamage
    ? "ocr_ai"
    : readingOrderConfidence === "high" && input.sourceType !== "external_json"
      ? "deterministic"
      : "ai_text";
  const warnings = [
    severeDamage ? "文本层可信度过低，禁止让 AI 猜测原文；请改用原 PDF 或后续 OCR。" : undefined,
    layoutComplexity === "multi_column" ? "检测到多栏布局，已按坐标恢复阅读顺序，请重点核对跨栏内容。" : undefined,
    layoutComplexity === "table" ? "检测到表格结构，已保留单元格来源路径。" : undefined,
    lineFragmentationScore > 0.6 ? "文本碎片化程度较高，建议查看原始提取内容。" : undefined
  ].filter((warning): warning is string => Boolean(warning));

  return ImportQualityReportSchema.parse({
    sourceType: input.sourceType,
    textCoverage: Math.min(1, visibleLength / Math.max(1, rawLength * 0.75)),
    replacementCharacterRatio,
    abnormalWhitespaceRatio,
    lineFragmentationScore,
    readingOrderConfidence,
    layoutComplexity,
    recommendedRoute,
    warnings
  });
}

export function normalizedBlocksToText(blocks: NormalizedSourceBlock[]) {
  return blocks.map((block) => block.normalizedText).filter(Boolean).join("\n");
}

export function mapNormalizedBlocksToReviewDraft(blocks: NormalizedSourceBlock[]): ResumeJsonMapperOutput {
  const usable = blocks.filter((block) => block.normalizedText.trim());
  return {
    structuredDraft: {
      schemaVersion: "structured-resume-draft-v1",
      basics: {},
      sections: usable.length ? [{
        title: "待确认内容",
        sectionType: "unknown",
        category: "custom",
        included: false,
        items: usable.map((block) => ({
          text: block.normalizedText,
          included: false,
          mapping: {
            sourcePaths: [block.id],
            sourceValues: [block.normalizedText],
            confidenceLevel: "low",
            confidenceReason: "Mock 映射仅保留来源块，需人工指定栏目。",
            needsConfirmation: true
          }
        }))
      }] : []
    },
    unclassifiedBlocks: usable.map((block) => ({
      sourcePath: block.id,
      sourceValue: block.normalizedText,
      reason: "Mock 映射未推断栏目，来源内容已保留。"
    }))
  };
}

function restoreReadingOrder(blocks: ExtractedSourceBlock[]) {
  const pages = new Map<number, ExtractedSourceBlock[]>();
  for (const block of blocks) {
    const page = block.page ?? 1;
    pages.set(page, [...(pages.get(page) ?? []), block]);
  }
  return [...pages.entries()].sort(([left], [right]) => left - right).flatMap(([, pageBlocks]) => {
    const hasReconstructedReadingOrder = pageBlocks.length > 0
      && pageBlocks.every((block) => block.sourceEngine === "pdfjs" && block.id.startsWith("pdf:"));
    if (hasReconstructedReadingOrder) {
      return [...pageBlocks].sort((left, right) => left.order - right.order);
    }
    if (pageBlocks.filter((block) => block.position).length < 2) {
      return [...pageBlocks].sort((left, right) => left.order - right.order);
    }
    const positioned = pageBlocks.filter((block) => block.position);
    const minX = Math.min(...positioned.map((block) => block.position!.x));
    const maxRight = Math.max(...positioned.map((block) => block.position!.x + block.position!.width));
    const midpoint = minX + (maxRight - minX) / 2;
    const hasColumns = positioned.some((block) => block.position!.x < midpoint * 0.9)
      && positioned.some((block) => block.position!.x > midpoint * 1.05);
    return [...pageBlocks].sort((left, right) => {
      const a = left.position;
      const b = right.position;
      if (!a || !b) return left.order - right.order;
      if (hasColumns) {
        const columnA = a.x + a.width / 2 < midpoint ? 0 : 1;
        const columnB = b.x + b.width / 2 < midpoint ? 0 : 1;
        if (columnA !== columnB) return columnA - columnB;
      }
      return Math.abs(a.y - b.y) > 3 ? b.y - a.y : a.x - b.x;
    });
  });
}

function joinObviousFragments(text: string, actions: string[]) {
  const lines = text.split("\n");
  const output: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const previous = output.at(-1);
    const joinLatinHyphen = previous && /[A-Za-z]-$/.test(previous) && /^[A-Za-z]/.test(trimmed);
    const joinSingleCharacters = previous && Array.from(previous).length === 1 && Array.from(trimmed).length === 1;
    if (joinLatinHyphen) {
      output[output.length - 1] = previous.slice(0, -1) + trimmed;
      if (!actions.includes("join_hyphenated_line_break")) actions.push("join_hyphenated_line_break");
    } else if (joinSingleCharacters) {
      output[output.length - 1] = previous + trimmed;
      if (!actions.includes("join_single_character_fragments")) actions.push("join_single_character_fragments");
    } else {
      output.push(trimmed);
    }
  }
  return output.join("\n");
}

function calculateLineFragmentation(blocks: NormalizedSourceBlock[]) {
  const lines = blocks.flatMap((block) => block.normalizedText.split("\n")).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return 1;
  const fragments = lines.filter((line) => Array.from(line).length <= 2).length;
  return Math.min(1, fragments / lines.length);
}

function detectLayoutComplexity(blocks: NormalizedSourceBlock[]): ImportQualityReport["layoutComplexity"] {
  if (blocks.some((block) => block.blockType === "table_cell")) return "table";
  const positioned = blocks.filter((block) => block.position);
  if (positioned.length < 4) return positioned.length ? "single_column" : "unknown";
  const minX = Math.min(...positioned.map((block) => block.position!.x));
  const maxRight = Math.max(...positioned.map((block) => block.position!.x + block.position!.width));
  const width = Math.max(1, maxRight - minX);
  const left = positioned.filter((block) => block.position!.x < minX + width * 0.4);
  const right = positioned.filter((block) => block.position!.x > minX + width * 0.55);
  return left.length >= 2 && right.length >= 2 ? "multi_column" : "single_column";
}

function countRepeatedPageEdges(blocks: ExtractedSourceBlock[]) {
  const counts = new Map<string, number>();
  for (const block of blocks.filter((item) => item.page)) {
    if (!isPageEdgeBlock(block, blocks)) continue;
    const key = normalizedEdgeKey(block.rawText);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function isPageEdgeBlock(block: ExtractedSourceBlock, blocks: ExtractedSourceBlock[]) {
  const pageBlocks = blocks.filter((item) => (item.page ?? 1) === (block.page ?? 1));
  const index = pageBlocks.findIndex((item) => item.id === block.id);
  return index === 0 || index === pageBlocks.length - 1;
}

function normalizedEdgeKey(text: string) {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length >= 2 && value.length <= 80 ? value : "";
}

function replaceTracked(text: string, pattern: RegExp, replacement: string, action: string, actions: string[]) {
  const next = text.replace(pattern, replacement);
  if (next !== text) actions.push(action);
  return next;
}

function countMatches(text: string, pattern: RegExp) {
  return Array.from(text.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))).length;
}
