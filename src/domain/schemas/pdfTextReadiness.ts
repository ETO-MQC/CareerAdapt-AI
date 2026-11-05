import { z } from "zod";

export const PdfTextReadinessSchema = z.object({
  version: z.literal("pdf-text-1"),
  snapshotHash: z.string().min(8),
  revisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  templateId: z.string().min(1),
  pageCount: z.number().int().min(0),
  failureCode: z.literal("pdf_text_extraction_failed").optional(),
  textLayer: z.enum(["pass", "needs_review", "unknown"]),
  contentParity: z.enum(["pass", "needs_review", "unknown"]),
  readingOrder: z.enum(["pass", "needs_review", "unknown"]),
  extractedCharacters: z.number().int().min(0),
  expectedCharacters: z.number().int().min(0),
  thirdPartyAts: z.literal("unknown")
}).strict();
export type PdfTextReadiness = z.infer<typeof PdfTextReadinessSchema>;

