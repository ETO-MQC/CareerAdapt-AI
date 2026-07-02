import { PDF_IMPORT_LIMITS } from "./limits";
import type { PdfImportErrorCode } from "@/domain/schemas";

export type PdfFileDescriptor = {
  name: string;
  size: number;
  type?: string;
};

export type PdfFileValidationResult =
  | {
      ok: true;
      extension: string;
      mimeType: string;
      warnings: string[];
    }
  | {
      ok: false;
      code: PdfImportErrorCode;
      message: string;
    };

export function validatePdfFileDescriptor(file: PdfFileDescriptor): PdfFileValidationResult {
  const extension = getFileExtension(file.name);
  const mimeType = file.type ?? "";
  const warnings: string[] = [];

  if (file.size <= 0) {
    return fail("empty_file", "文件为空，请重新选择一份文本型 PDF。");
  }

  if (file.size > PDF_IMPORT_LIMITS.maxFileBytes) {
    return fail("file_too_large", `PDF 文件不能超过 ${formatBytes(PDF_IMPORT_LIMITS.maxFileBytes)}。`);
  }

  if (extension && extension !== ".pdf") {
    warnings.push("extension_not_pdf");
  }

  if (!mimeType || mimeType === "application/octet-stream") {
    warnings.push("mime_untrusted");
  } else if (mimeType !== "application/pdf") {
    warnings.push("mime_not_pdf");
  }

  return {
    ok: true,
    extension: extension || ".unknown",
    mimeType: mimeType || "application/octet-stream",
    warnings
  };
}

export function validatePdfHeader(bytes: Uint8Array): PdfFileValidationResult {
  if (bytes.byteLength === 0) {
    return fail("empty_file", "文件为空，请重新选择一份文本型 PDF。");
  }

  const header = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 5));
  if (header !== "%PDF-") {
    return fail("not_pdf", "文件头不是 PDF 格式，可能是伪造或损坏文件。");
  }

  return {
    ok: true,
    extension: ".pdf",
    mimeType: "application/pdf",
    warnings: []
  };
}

export function mapPdfJsError(error: unknown): { code: PdfImportErrorCode; message: string } {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  const lower = `${name} ${message}`.toLowerCase();

  if (lower.includes("password") || lower.includes("encrypted")) {
    return {
      code: "encrypted_or_password",
      message: "该 PDF 受密码或加密保护，当前无法提取文本。"
    };
  }

  if (lower.includes("invalid") || lower.includes("corrupt") || lower.includes("missing pdf")) {
    return {
      code: "corrupt_pdf",
      message: "PDF 文件损坏或结构异常，无法完成解析。"
    };
  }

  if (lower.includes("timeout")) {
    return {
      code: "extract_timeout",
      message: "PDF 文本提取超时，请改用粘贴文本或拆分文件。"
    };
  }

  return {
    code: "unknown_error",
    message: "PDF 文本提取失败，请改用粘贴文本或手动创建。"
  };
}

function getFileExtension(fileName: string) {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

function fail(code: PdfImportErrorCode, message: string): PdfFileValidationResult {
  return { ok: false, code, message };
}

function formatBytes(bytes: number) {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}
