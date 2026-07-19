import type {
  ExtractedSourceBlock,
  ResumeImportSourceClassification
} from "@/domain/schemas";
import { createLayoutDocument, type LayoutDocument } from "./layoutDocument";
import { buildLayoutGraph, type LayoutGraph } from "./layoutGraph";
import { LocalDeterministicSemanticResolver, type ResumeSemanticTree } from "./resumeSemanticTree";

export const PDF_LAYOUT_RECONSTRUCTOR_VERSION = "resume-import.pdf-layout.v2";

export type PdfLayoutTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  hasEol?: boolean;
};

export type PdfPageLayoutMetrics = {
  itemCount: number;
  lineCount: number;
  characterCount: number;
  coordinateCoverage: number;
  detectedColumnCount: 1 | 2;
  rightAlignedDateCount: number;
  readingOrderConfidence: "high" | "medium" | "low";
};

export type PdfPageLayoutResult = {
  blocks: ExtractedSourceBlock[];
  rawText: string;
  classification: Extract<ResumeImportSourceClassification, "digital_pdf" | "complex_digital_pdf" | "scanned_pdf">;
  metrics: PdfPageLayoutMetrics;
  warnings: string[];
  layoutDocument: LayoutDocument;
  layoutGraph: LayoutGraph;
  semanticTree: ResumeSemanticTree;
};

type LayoutLine = {
  items: PdfLayoutTextItem[];
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
};

const DATE_ONLY_PATTERN = /^(?:(?:19|20)\d{2}(?:[./\-年]\d{1,2}(?:[./\-月]\d{1,2}日?)?)?|至今|现在|present|current)(?:\s*(?:[-–—~至到]|to)\s*(?:(?:19|20)\d{2}(?:[./\-年]\d{1,2}(?:[./\-月]\d{1,2}日?)?)?|至今|现在|present|current))?$/i;
const SECTION_HEADING_PATTERN = /^(?:个人概述|个人简介|自我评价|求职意向|教育(?:背景|经历)|工作(?:经历|经验)|实习经历|项目经历|科研经历|校园经历|志愿经历|奖项|荣誉|技能|证书|语言|论文|专利|作品集|其他|summary|profile|education|experience|work experience|internships?|projects?|research|skills?|certificates?|awards?|languages?|publications?|patents?|portfolio)\s*[:：]?$/i;
const CONTACT_PATTERN = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|(?:\+?\d[\d\s-]{7,}\d)|https?:\/\/|www\.|github\.com\/|linkedin\.com\/)/i;
const LIST_PATTERN = /^(?:[•●▪◦·]|[-–—]|\d+[.)、]|[A-Za-z][.)])\s*/;

export function reconstructPdfPageLayout(input: {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  items: readonly PdfLayoutTextItem[];
  sourceEngineVersion: string;
}): PdfPageLayoutResult {
  const usableItems = input.items.filter((item) => item.text.trim() && finiteBox(item));
  const coordinateCoverage = input.items.length ? usableItems.length / input.items.length : 0;
  const lines = groupItemsIntoLines(usableItems);
  const medianFontSize = median(lines.map((line) => line.fontSize)) || 10;
  const detectedColumnCount = detectColumnCount(lines, input.pageWidth);
  const rightAlignedDateCount = lines.filter((line) => DATE_ONLY_PATTERN.test(line.text.trim()) && line.x > input.pageWidth * 0.55).length;
  const characterCount = Array.from(lines.map((line) => line.text).join("")).filter((character) => !/\s/.test(character)).length;
  const classification = characterCount < 20 || coordinateCoverage < 0.35
    ? "scanned_pdf"
    : detectedColumnCount === 2
      ? "complex_digital_pdf"
      : "digital_pdf";
  const readingOrderConfidence = classification === "scanned_pdf"
    ? "low"
    : detectedColumnCount === 2
      ? "medium"
      : "high";

  const orderedLines = orderLines(lines, detectedColumnCount, input.pageWidth);
  const layoutDocument = createLayoutDocument({
    pageCount: input.pageNumber,
    fragments: orderedLines.flatMap((line, lineIndex) => {
      const layoutItems = LIST_PATTERN.test(line.text.trim())
        ? [{
            ...line.items[0],
            text: line.text,
            x: line.x,
            y: line.y,
            width: line.width,
            height: line.height,
            fontSize: line.fontSize
          }]
        : mergeLayoutItems(line.items);
      return layoutItems.map((item, itemIndex) => ({
      id: `pdf:${input.pageNumber}:line:${lineIndex}:fragment:${itemIndex}`,
      page: input.pageNumber,
      text: item.text,
      bbox: { x: item.x, y: item.y, width: item.width, height: item.height },
      fontSize: item.fontSize,
      fontWeight: item.fontWeight,
      fontFamily: item.fontFamily,
      color: item.color,
      sourceBlockRef: `pdf:${input.pageNumber}:line:${lineIndex}`,
      lineId: `pdf:${input.pageNumber}:line:${lineIndex}`,
      sourceEngine: "pdfjs" as const
      }));
    })
  });
  const layoutGraph = buildLayoutGraph(layoutDocument);
  const semanticTree = new LocalDeterministicSemanticResolver().resolve({ layoutDocument, layoutGraph });
  const blocks = orderedLines.map((line, order): ExtractedSourceBlock => {
    const blockType = classifyLine(line, medianFontSize);
    return {
      id: `pdf:${input.pageNumber}:line:${order}`,
      page: input.pageNumber,
      text: line.text,
      rawText: line.text,
      blockType,
      position: { x: line.x, y: line.y, width: line.width, height: line.height },
      sourceEngine: "pdfjs",
      sourceEngineVersion: input.sourceEngineVersion,
      extractionConfidence: readingOrderConfidence === "high" ? 0.98 : readingOrderConfidence === "medium" ? 0.82 : 0.35,
      fontSize: line.fontSize,
      sourceKind: classification,
      order
    };
  });
  const warnings = [
    classification === "scanned_pdf" ? `pdf_text_layer_unusable:${input.pageNumber}` : undefined,
    detectedColumnCount === 2 ? `complex_layout:${input.pageNumber}` : undefined,
    coordinateCoverage < 0.9 ? `partial_coordinates:${input.pageNumber}` : undefined
  ].filter((warning): warning is string => Boolean(warning));

  return {
    blocks,
    rawText: blocks.map((block) => block.rawText).join("\n"),
    classification,
    metrics: {
      itemCount: input.items.length,
      lineCount: lines.length,
      characterCount,
      coordinateCoverage,
      detectedColumnCount,
      rightAlignedDateCount,
      readingOrderConfidence
    },
    warnings,
    layoutDocument,
    layoutGraph,
    semanticTree
  };
}

function groupItemsIntoLines(items: readonly PdfLayoutTextItem[]) {
  const sorted = [...items].sort((left, right) => right.y - left.y || left.x - right.x);
  const groups: PdfLayoutTextItem[][] = [];
  for (const item of sorted) {
    const tolerance = Math.max(1.5, Math.min(4, item.height * 0.42));
    const group = groups.find((candidate) => Math.abs(average(candidate.map((entry) => entry.y)) - item.y) <= tolerance);
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map(toLayoutLine).sort((left, right) => right.y - left.y || left.x - right.x);
}

function toLayoutLine(items: PdfLayoutTextItem[]): LayoutLine {
  const ordered = [...items].sort((left, right) => left.x - right.x);
  const x = Math.min(...ordered.map((item) => item.x));
  const right = Math.max(...ordered.map((item) => item.x + item.width));
  const y = average(ordered.map((item) => item.y));
  const height = Math.max(...ordered.map((item) => item.height));
  const fontSize = median(ordered.map((item) => item.fontSize ?? item.height)) || height;
  let text = "";
  let previous: PdfLayoutTextItem | undefined;
  for (const item of ordered) {
    if (previous && shouldInsertSpace(previous, item, fontSize)) text += " ";
    text += item.text.trim();
    previous = item;
  }
  return { items: ordered, text: text.trim(), x, y, width: Math.max(0, right - x), height, fontSize };
}

function shouldInsertSpace(previous: PdfLayoutTextItem, current: PdfLayoutTextItem, fontSize: number) {
  const gap = current.x - (previous.x + previous.width);
  if (gap > Math.max(1.2, fontSize * 0.28)) return true;
  const left = previous.text.at(-1) ?? "";
  const right = current.text.at(0) ?? "";
  return /[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right) && gap > fontSize * 0.08;
}

function mergeLayoutItems(items: readonly PdfLayoutTextItem[]): PdfLayoutTextItem[] {
  const output: PdfLayoutTextItem[] = [];
  for (const item of [...items].sort((left, right) => left.x - right.x)) {
    const previous = output.at(-1);
    if (!previous) {
      output.push({ ...item });
      continue;
    }
    const fontSize = Math.max(previous.fontSize ?? previous.height, item.fontSize ?? item.height);
    const gap = item.x - (previous.x + previous.width);
    const sameStyle = Math.abs((previous.fontSize ?? previous.height) - (item.fontSize ?? item.height)) <= 0.5
      && (previous.fontWeight ?? 400) === (item.fontWeight ?? 400)
      && (previous.fontFamily ?? "") === (item.fontFamily ?? "");
    if (!sameStyle || gap > fontSize * 0.65) {
      output.push({ ...item });
      continue;
    }
    const separator = shouldInsertSpace(previous, item, fontSize) ? " " : "";
    const right = Math.max(previous.x + previous.width, item.x + item.width);
    previous.text = `${previous.text}${separator}${item.text}`;
    previous.width = right - previous.x;
    previous.height = Math.max(previous.height, item.height);
  }
  return output;
}

function detectColumnCount(lines: readonly LayoutLine[], pageWidth: number): 1 | 2 {
  if (lines.length < 8) return 1;
  const candidates = lines.filter((line) => !DATE_ONLY_PATTERN.test(line.text.trim()) && line.width < pageWidth * 0.46);
  const left = candidates.filter((line) => line.x < pageWidth * 0.34);
  const right = candidates.filter((line) => line.x > pageWidth * 0.48);
  if (left.length < 3 || right.length < 3) return 1;
  const overlappingRows = left.filter((leftLine) => right.some((rightLine) => Math.abs(leftLine.y - rightLine.y) <= Math.max(leftLine.height, rightLine.height))).length;
  return overlappingRows >= 2 || (left.length >= 5 && right.length >= 5) ? 2 : 1;
}

function orderLines(lines: readonly LayoutLine[], columns: 1 | 2, pageWidth: number) {
  if (columns === 1) return [...lines].sort((left, right) => right.y - left.y || left.x - right.x);
  const anchors = lines
    .filter((line) => line.width >= pageWidth * 0.62 || SECTION_HEADING_PATTERN.test(line.text.trim()))
    .sort((left, right) => right.y - left.y || left.x - right.x);
  const body = lines.filter((line) => !anchors.includes(line));
  const output: LayoutLine[] = [];
  let upperBound = Number.POSITIVE_INFINITY;
  for (let anchorIndex = 0; anchorIndex <= anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex];
    const lowerBound = anchor?.y ?? Number.NEGATIVE_INFINITY;
    const region = body.filter((line) => line.y < upperBound && line.y > lowerBound);
    const left = region.filter((line) => line.x < pageWidth * 0.48).sort((a, b) => b.y - a.y || a.x - b.x);
    const right = region.filter((line) => line.x >= pageWidth * 0.48).sort((a, b) => b.y - a.y || a.x - b.x);
    output.push(...left, ...right);
    if (anchor) output.push(anchor);
    upperBound = lowerBound;
  }
  return output;
}

function classifyLine(line: LayoutLine, medianFontSize: number): ExtractedSourceBlock["blockType"] {
  const text = line.text.trim();
  if (SECTION_HEADING_PATTERN.test(text) || (text.length <= 42 && line.fontSize >= medianFontSize * 1.22)) return "heading";
  if (DATE_ONLY_PATTERN.test(text)) return "date";
  if (CONTACT_PATTERN.test(text) && text.length <= 180) return "contact";
  if (LIST_PATTERN.test(text)) return "list_item";
  return "paragraph";
}

function finiteBox(item: PdfLayoutTextItem) {
  return [item.x, item.y, item.width, item.height].every(Number.isFinite) && item.width >= 0 && item.height >= 0;
}

function average(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
