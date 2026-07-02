"use client";

import type { PdfImportErrorCode } from "@/domain/schemas";
import { PDF_IMPORT_LIMITS } from "@/domain/pdfImport/limits";
import { mapPdfJsError } from "@/domain/pdfImport/validation";

export type BrowserPdfExtractedPage = {
  pageNumber: number;
  rawText: string;
  textItemCount: number;
  warnings: string[];
};

export type BrowserPdfExtractionResult =
  | {
      ok: true;
      pageCount: number;
      pages: BrowserPdfExtractedPage[];
    }
  | {
      ok: false;
      code: PdfImportErrorCode;
      message: string;
    };

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  width?: number;
  transform?: number[];
};

type PdfDocumentProxy = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
    cleanup(): void;
  }>;
  destroy(): Promise<void>;
};

export async function extractTextFromPdfBuffer(
  buffer: ArrayBuffer,
  signal?: AbortSignal
): Promise<BrowserPdfExtractionResult> {
  if (signal?.aborted) {
    return {
      ok: false,
      code: "extract_cancelled",
      message: "PDF 文本提取已取消。"
    };
  }

  let loadingTask: { promise: Promise<unknown>; destroy(): Promise<void> } | undefined;
  let document: PdfDocumentProxy | undefined;
  let timeoutReached = false;
  let cleanedUp = false;
  let abort: (() => void) | undefined;
  const timeout = setTimeout(() => {
    timeoutReached = true;
    void loadingTask?.destroy();
  }, PDF_IMPORT_LIMITS.extractionTimeoutMs);

  try {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();

    loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      useWorkerFetch: false,
      isEvalSupported: false,
      stopAtErrors: true
    }) as unknown as { promise: Promise<unknown>; destroy(): Promise<void> };

    abort = () => {
      void loadingTask?.destroy();
    };
    signal?.addEventListener("abort", abort, { once: true });

    document = await loadingTask.promise as PdfDocumentProxy;

    if (signal?.aborted) {
      await cleanupDocument(document);
      cleanedUp = true;
      return {
        ok: false,
        code: "extract_cancelled",
        message: "PDF 文本提取已取消。"
      };
    }

    const pageCount = document.numPages;

    if (pageCount > PDF_IMPORT_LIMITS.maxPages) {
      await cleanupDocument(document);
      cleanedUp = true;
      return {
        ok: false,
        code: "page_limit_exceeded",
        message: `当前最多支持 ${PDF_IMPORT_LIMITS.maxPages} 页文本型 PDF。`
      };
    }

    const pages: BrowserPdfExtractedPage[] = [];
    let totalTextItemCount = 0;
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (signal?.aborted) {
        await cleanupDocument(document);
        cleanedUp = true;
        return {
          ok: false,
          code: "extract_cancelled",
          message: "PDF 文本提取已取消。"
        };
      }

      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      totalTextItemCount += textContent.items.length;

      if (textContent.items.length > PDF_IMPORT_LIMITS.maxTextItemsPerPage || totalTextItemCount > PDF_IMPORT_LIMITS.maxTextItemsTotal) {
        page.cleanup();
        await cleanupDocument(document);
        cleanedUp = true;
        return {
          ok: false,
          code: "text_item_limit_exceeded",
          message: "PDF 文本对象数量超过当前导入限制，请拆分后再导入。"
        };
      }

      const rawText = textContent.items.map((item) => {
        const text = typeof item.str === "string" ? item.str : "";
        return item.hasEOL ? `${text}\n` : `${text} `;
      }).join("").replace(/[ \t]+\n/g, "\n").trim();

      if (rawText.length > PDF_IMPORT_LIMITS.maxPageTextChars) {
        page.cleanup();
        await cleanupDocument(document);
        cleanedUp = true;
        return {
          ok: false,
          code: "page_text_too_long",
          message: `第 ${pageNumber} 页提取文本超过 ${PDF_IMPORT_LIMITS.maxPageTextChars} 字符，请拆分后再导入。`
        };
      }

      pages.push({
        pageNumber,
        rawText,
        textItemCount: textContent.items.length,
        warnings: detectLayoutWarnings(textContent.items, pageNumber)
      });
      page.cleanup();
    }

    await cleanupDocument(document);
    cleanedUp = true;

    return {
      ok: true,
      pageCount,
      pages
    };
  } catch (error) {
    if (timeoutReached) {
      return {
        ok: false,
        code: "extract_timeout",
        message: "PDF 文本提取超时，请改用粘贴文本或拆分文件。"
      };
    }

    if (signal?.aborted) {
      return {
        ok: false,
        code: "extract_cancelled",
        message: "PDF 文本提取已取消。"
      };
    }

    const mapped = mapPdfJsError(error);
    return {
      ok: false,
      ...mapped
    };
  } finally {
    clearTimeout(timeout);
    if (abort) {
      signal?.removeEventListener("abort", abort);
    }
    if (document && !cleanedUp) {
      await cleanupDocument(document).catch(() => undefined);
    }
    if (loadingTask && !cleanedUp) {
      await loadingTask.destroy().catch(() => undefined);
    }
  }
}

async function cleanupDocument(document: { destroy(): Promise<void> }) {
  await document.destroy();
}

function detectLayoutWarnings(items: PdfTextItem[], pageNumber: number) {
  if (items.length < 6) {
    return [];
  }

  const positioned = items
    .map((item) => ({
      x: typeof item.transform?.[4] === "number" ? item.transform[4] : undefined,
      y: typeof item.transform?.[5] === "number" ? item.transform[5] : undefined,
      width: item.width ?? 0
    }))
    .filter((item): item is { x: number; y: number; width: number } => item.x !== undefined && item.y !== undefined);

  if (positioned.length < 6) {
    return [];
  }

  const minX = Math.min(...positioned.map((item) => item.x));
  const maxX = Math.max(...positioned.map((item) => item.x + item.width));
  const width = maxX - minX;

  if (width <= 0) {
    return [];
  }

  const leftItems = positioned.filter((item) => item.x < minX + width * 0.45);
  const rightItems = positioned.filter((item) => item.x > minX + width * 0.55);
  const leftY = new Set(leftItems.map((item) => Math.round(item.y / 4) * 4));
  const overlappingRows = rightItems.filter((item) => leftY.has(Math.round(item.y / 4) * 4)).length;

  if (leftItems.length >= 2 && rightItems.length >= 2 && overlappingRows >= 2) {
    return [`complex_layout:${pageNumber}`];
  }

  return [];
}
