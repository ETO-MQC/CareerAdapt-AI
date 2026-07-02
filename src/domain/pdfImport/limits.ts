export const PDF_IMPORT_LIMITS = {
  maxFileBytes: 8 * 1024 * 1024,
  maxPages: 5,
  maxExtractedTextChars: 60_000,
  maxAiInputChars: 24_000,
  maxPageTextChars: 20_000,
  maxTextItemsPerPage: 4_000,
  maxTextItemsTotal: 12_000,
  extractionTimeoutMs: 30_000,
  minTextCharsPerPage: 8
} as const;

export const PDF_IMPORT_EXTRACTION_VERSION = "pdf-import.v1";
