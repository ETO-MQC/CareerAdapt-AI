"use client";

import { PDF_IMPORT_LIMITS } from "@/domain/pdfImport/limits";
import type { ExtractedSourceBlock } from "@/domain/schemas";
import { encodeAiSettingsForHeader, readAiSettings } from "@/services/storage/aiSettings";
import { readDocumentRecognitionPreferences } from "@/services/preferences/documentRecognition";
import { DEFAULT_VISION_TIMEOUT_SECONDS, RESUME_IMPORT_TIMEOUT_HEADER } from "@/domain/resumeImport/timeouts";

export async function extractResumeVision(file: File, signal?: AbortSignal, onProgress?: (message: string) => void) {
  if (file.size > PDF_IMPORT_LIMITS.maxFileBytes) throw new Error("简历文件不能超过 8 MB。");
  const images = await renderResumeImages(file, signal);
  const timeoutSeconds = readDocumentRecognitionPreferences().visionTimeoutSeconds ?? DEFAULT_VISION_TIMEOUT_SECONDS;
  const blocks: ExtractedSourceBlock[] = [];
  const emptyPages: number[] = [];
  for (let index = 0; index < images.length; index++) {
    signal?.throwIfAborted();
    onProgress?.(`AI 正在读取简历图像（${index + 1}/${images.length}），本页最长等待 ${timeoutSeconds / 60} 分钟…`);
    const response = await fetch("/api/resume-import/vision", {
      method: "POST", headers: { "Content-Type": "application/json", "x-ai-config": encodeAiSettingsForHeader(readAiSettings()),
        [RESUME_IMPORT_TIMEOUT_HEADER]: String(timeoutSeconds) },
      body: JSON.stringify({ pageNumber: index + 1, image: images[index] }), signal
    });
    const result = await response.json() as { ok?: boolean; text?: string; message?: string; provider?: string; model?: string };
    if (!response.ok || !result.ok || typeof result.text !== "string") {
      throw new Error(result.message ?? "AI 图像识别失败，请重试或使用本地 OCR。");
    }
    const paragraphs = result.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    if (!paragraphs.length) emptyPages.push(index + 1);
    paragraphs.forEach((text, order) => blocks.push({
      id: `vision:p${index + 1}:b${order}`, page: index + 1, sourcePath: `pages[${index}].lines[${order}]`,
      text, rawText: text, blockType: "paragraph", order: blocks.length,
      sourceEngine: "vision_ai", sourceEngineVersion: `${result.provider}/${result.model}`,
      sourceKind: file.type === "application/pdf" || /\.pdf$/iu.test(file.name) ? "scanned_pdf" : "image",
      extractionConfidence: 0.5
    }));
  }
  if (!blocks.length) throw new Error("AI 未从页面读到可用文字，请检查清晰度或使用本地 OCR。");
  return { blocks, pageCount: images.length, emptyPages };
}

export async function renderResumeImages(file: File, signal?: AbortSignal): Promise<string[]> {
  signal?.throwIfAborted();
  if (file.type === "application/pdf" || /\.pdf$/iu.test(file.name)) {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
    const loading = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
    const abort = () => { void loading.destroy(); };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > PDF_IMPORT_LIMITS.maxPages) throw new Error("当前最多导入 5 页简历，请拆分后重试。");
      const images: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) {
        signal?.throwIfAborted();
        const page = await pdf.getPage(index);
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1800 / Math.max(original.width, original.height)) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
        try {
          await page.render({ canvas, viewport }).promise;
          images.push(canvas.toDataURL("image/jpeg", 0.9));
        } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
      }
      return images;
    } finally { signal?.removeEventListener("abort", abort); await loading.destroy(); }
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.ceil(bitmap.width * scale); canvas.height = Math.ceil(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前环境无法读取图像，请重新选择文件。");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [canvas.toDataURL("image/jpeg", 0.9)];
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
