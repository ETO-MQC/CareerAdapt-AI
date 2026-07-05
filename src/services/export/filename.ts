export const PDF_MIME_TYPE = "application/pdf";
export const MAX_PDF_FILENAME_LENGTH = 120;

const WINDOWS_ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001F]/g;
const TRAILING_DOTS_OR_SPACES = /[. ]+$/g;

export function buildResumePdfFileName(input: {
  candidateName?: string | null;
  jobTitle?: string | null;
  templateName?: string | null;
  date?: Date | string;
}) {
  const datePart = formatExportDate(input.date);
  const parts = [
    sanitizeFileNamePart(input.candidateName, "CareerAdapt"),
    sanitizeFileNamePart(input.jobTitle, "Resume"),
    sanitizeFileNamePart(input.templateName, "Template"),
    datePart
  ];
  return normalizePdfFileName(parts.join("_"));
}

export function normalizePdfFileName(input: string) {
  const withoutExtension = stripPdfExtension(input)
    .replace(WINDOWS_ILLEGAL_FILENAME_CHARS, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(TRAILING_DOTS_OR_SPACES, "")
    .replace(/^_+|_+$/g, "");
  const safeBase = withoutExtension || "CareerAdapt_Resume";
  const maxBaseLength = MAX_PDF_FILENAME_LENGTH - ".pdf".length;
  const truncated = Array.from(safeBase).slice(0, maxBaseLength).join("").replace(TRAILING_DOTS_OR_SPACES, "") || "CareerAdapt_Resume";
  return `${truncated}.pdf`;
}

export function assertSafePdfFileName(fileName: string) {
  if (!isSafePdfFileName(fileName)) {
    throw new Error("unsafe_pdf_filename");
  }
}

export function isSafePdfFileName(fileName: string) {
  return fileName.length > 0
    && fileName.length <= MAX_PDF_FILENAME_LENGTH
    && fileName.endsWith(".pdf")
    && !fileName.endsWith(".pdf.pdf")
    && !/[\\/:*?"<>|\u0000-\u001F]/.test(fileName)
    && !fileName.includes("..")
    && fileName === normalizePdfFileName(fileName);
}

export function contentDispositionAttachment(fileName: string) {
  assertSafePdfFileName(fileName);
  const fallback = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_") || "resume.pdf";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function sanitizeFileNamePart(value: string | null | undefined, fallback: string) {
  const stripped = stripPdfExtension(value ?? "")
    .replace(WINDOWS_ILLEGAL_FILENAME_CHARS, "_")
    .replace(/\s+/g, "")
    .replace(/_+/g, "_")
    .replace(TRAILING_DOTS_OR_SPACES, "")
    .replace(/^_+|_+$/g, "");
  return stripped || fallback;
}

function stripPdfExtension(value: string) {
  return value.trim().replace(/(?:\.pdf)+$/i, "");
}

function formatExportDate(date: Date | string | undefined) {
  const resolved = typeof date === "string" ? new Date(date) : date ?? new Date();
  if (Number.isNaN(resolved.getTime())) {
    return "19700101";
  }
  const year = resolved.getFullYear();
  const month = `${resolved.getMonth() + 1}`.padStart(2, "0");
  const day = `${resolved.getDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function encodeRFC5987(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}
