import type { PdfPageText, RawInputSourcePage } from "@/domain/schemas";
import { PDF_IMPORT_LIMITS } from "./limits";

export type PdfTextPageInput = {
  pageNumber: number;
  rawText: string;
  textItemCount: number;
  warnings?: string[];
};

export type PdfTextPreparationResult =
  | {
      ok: true;
      pages: Array<PdfTextPageInput & { cleanedText: string; warnings: string[] }>;
      combinedText: string;
      sourcePages: RawInputSourcePage[];
      hasPromptInjectionRisk: boolean;
      warnings: string[];
    }
  | {
      ok: false;
      code: "no_text_layer" | "empty_extracted_text" | "text_too_long" | "text_item_limit_exceeded" | "page_text_too_long";
      message: string;
    };

const promptInjectionPattern = /(system|developer|ignore (all )?(previous|above) instructions|忽略(以上|所有)?(规则|指令)|添加不存在|编造|虚构经历|越过规则)/i;

export function preparePdfText(pages: PdfTextPageInput[]): PdfTextPreparationResult {
  const totalTextItems = pages.reduce((sum, page) => sum + page.textItemCount, 0);
  if (totalTextItems > PDF_IMPORT_LIMITS.maxTextItemsTotal) {
    return {
      ok: false,
      code: "text_item_limit_exceeded",
      message: `PDF 文本对象超过 ${PDF_IMPORT_LIMITS.maxTextItemsTotal} 个，请拆分或改用粘贴文本。`
    };
  }

  const initiallyCleaned = pages.map((page) => ({
    ...page,
    cleanedText: cleanPdfPageText(page.rawText),
    warnings: createPageWarnings(page)
  }));

  const oversizedPage = initiallyCleaned.find((page) => page.cleanedText.length > PDF_IMPORT_LIMITS.maxPageTextChars);
  if (oversizedPage) {
    return {
      ok: false,
      code: "page_text_too_long",
      message: `第 ${oversizedPage.pageNumber} 页提取文本超过 ${PDF_IMPORT_LIMITS.maxPageTextChars} 字符，请拆分后再导入。`
    };
  }

  if (initiallyCleaned.length === 0 || initiallyCleaned.every((page) => page.textItemCount === 0)) {
    return {
      ok: false,
      code: "no_text_layer",
      message: "该 PDF 没有可提取文本层，当前不支持 OCR。"
    };
  }

  const pagesWithoutChrome = removeRepeatedPageChrome(initiallyCleaned);
  const nonEmptyLength = pagesWithoutChrome.reduce((sum, page) => sum + page.cleanedText.trim().length, 0);

  if (nonEmptyLength === 0) {
    return {
      ok: false,
      code: "empty_extracted_text",
      message: "PDF 文本提取结果为空，请改用粘贴文本或手动创建。"
    };
  }

  const { combinedText, sourcePages } = joinPdfPages(pagesWithoutChrome);

  if (combinedText.length > PDF_IMPORT_LIMITS.maxExtractedTextChars) {
    return {
      ok: false,
      code: "text_too_long",
      message: `提取文本超过 ${PDF_IMPORT_LIMITS.maxExtractedTextChars} 字符，请删减后再解析。`
    };
  }

  return {
    ok: true,
    pages: pagesWithoutChrome,
    combinedText,
    sourcePages,
    hasPromptInjectionRisk: detectPromptInjectionRisk(combinedText),
    warnings: pagesWithoutChrome.flatMap((page) => page.warnings)
  };
}

export function cleanPdfPageText(rawText: string) {
  return rawText
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/([\p{L}])-\n([\p{L}])/gu, "$1$2")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectPromptInjectionRisk(text: string) {
  return promptInjectionPattern.test(text);
}

export function combinePdfPageTexts(pages: Array<{ pageNumber: number; cleanedText?: string; cleanedPageText?: string }>) {
  return joinPdfPages(pages.map((page) => ({
    pageNumber: page.pageNumber,
    cleanedText: page.cleanedPageText ?? page.cleanedText ?? ""
  }))).combinedText;
}

export function buildPageTextRecords(input: {
  sessionId: string;
  pages: Array<PdfTextPageInput & { cleanedText: string; warnings: string[] }>;
  hashes: Array<{ rawTextHash: string; cleanedTextHash: string }>;
  now: string;
}): PdfPageText[] {
  let cursor = 0;

  return input.pages.map((page, index) => {
    const start = cursor;
    const end = start + page.cleanedText.length;
    cursor = end + pageSeparator(page.pageNumber).length;

    return {
      id: `pdf-page-${input.sessionId}-${page.pageNumber}`,
      sessionId: input.sessionId,
      pageNumber: page.pageNumber,
      extractedPageText: page.rawText,
      cleanedPageText: page.cleanedText,
      charStart: start,
      charEnd: end,
      textItemCount: page.textItemCount,
      warnings: page.warnings,
      rawTextHash: input.hashes[index]?.rawTextHash ?? "missing-raw-hash",
      cleanedTextHash: input.hashes[index]?.cleanedTextHash ?? "missing-cleaned-hash",
      createdAt: input.now,
      updatedAt: input.now
    };
  });
}

function removeRepeatedPageChrome<T extends PdfTextPageInput & { cleanedText: string; warnings: string[] }>(pages: T[]): T[] {
  if (pages.length < 2) {
    return pages;
  }

  const firstLines = countRepeatedEdgeLines(pages, "first");
  const lastLines = countRepeatedEdgeLines(pages, "last");

  return pages.map((page) => {
    const lines = page.cleanedText.split("\n");
    const nextWarnings = [...page.warnings];
    let nextLines = lines;

    const firstLine = normalizedEdgeLine(nextLines.find((line) => line.trim().length > 0) ?? "");
    if (firstLine && (firstLines.get(firstLine) ?? 0) >= 2) {
      nextLines = removeFirstMatchingLine(nextLines, firstLine);
      nextWarnings.push(`removed_repeated_header:${page.pageNumber}`);
    }

    const lastLine = normalizedEdgeLine([...nextLines].reverse().find((line) => line.trim().length > 0) ?? "");
    if (lastLine && (lastLines.get(lastLine) ?? 0) >= 2) {
      nextLines = removeLastMatchingLine(nextLines, lastLine);
      nextWarnings.push(`removed_repeated_footer:${page.pageNumber}`);
    }

    return {
      ...page,
      cleanedText: nextLines.join("\n").trim(),
      warnings: nextWarnings
    };
  });
}

function countRepeatedEdgeLines<T extends { cleanedText: string }>(pages: T[], edge: "first" | "last") {
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = page.cleanedText.split("\n");
    const candidate = edge === "first"
      ? lines.find((line) => line.trim().length > 0)
      : [...lines].reverse().find((line) => line.trim().length > 0);
    const normalized = normalizedEdgeLine(candidate ?? "");
    if (normalized) {
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return counts;
}

function normalizedEdgeLine(line: string) {
  const normalized = line.trim().replace(/\s+/g, " ");
  return normalized.length >= 2 && normalized.length <= 80 ? normalized : "";
}

function removeFirstMatchingLine(lines: string[], normalized: string) {
  const index = lines.findIndex((line) => normalizedEdgeLine(line) === normalized);
  return index >= 0 ? [...lines.slice(0, index), ...lines.slice(index + 1)] : lines;
}

function removeLastMatchingLine(lines: string[], normalized: string) {
  const index = [...lines].reverse().findIndex((line) => normalizedEdgeLine(line) === normalized);
  if (index < 0) {
    return lines;
  }
  const originalIndex = lines.length - 1 - index;
  return [...lines.slice(0, originalIndex), ...lines.slice(originalIndex + 1)];
}

function joinPdfPages<T extends { pageNumber: number; cleanedText: string }>(pages: T[]) {
  let combinedText = "";
  const sourcePages: RawInputSourcePage[] = [];

  for (const page of pages) {
    if (combinedText.length > 0) {
      combinedText += pageSeparator(page.pageNumber);
    }

    const start = combinedText.length;
    combinedText += page.cleanedText;
    const end = combinedText.length;
    sourcePages.push({
      pageNumber: page.pageNumber,
      start,
      end
    });
  }

  return { combinedText, sourcePages };
}

function pageSeparator(pageNumber: number) {
  return `\n\n--- PDF Page ${pageNumber} ---\n\n`;
}

function createPageWarnings(page: PdfTextPageInput) {
  const warnings: string[] = [...(page.warnings ?? [])];
  if (page.textItemCount === 0 || page.rawText.trim().length < PDF_IMPORT_LIMITS.minTextCharsPerPage) {
    warnings.push(`low_text_density:${page.pageNumber}`);
  }
  if (page.textItemCount > PDF_IMPORT_LIMITS.maxTextItemsPerPage) {
    warnings.push(`text_item_density:${page.pageNumber}`);
  }
  return warnings;
}
