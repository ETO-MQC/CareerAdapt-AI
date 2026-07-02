import { z } from "zod";

export const IsoDateStringSchema = z.string().datetime({ offset: true });

export const EntityBaseSchema = z.object({
  id: z.string().min(1),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});

export const RiskLevelSchema = z.enum(["low", "medium", "high"]);

export const FactSourceTypeSchema = z.enum([
  "demo",
  "imported_text",
  "pdf_import",
  "user_input",
  "ai_suggestion",
  "evidence",
  "system"
]);

export const PdfLocatorStatusSchema = z.enum(["located", "ambiguous", "unlocated"]);

export const PdfSourceLocatorSchema = z.object({
  pageNumber: z.number().int().min(1),
  pageStart: z.number().int().min(0),
  pageEnd: z.number().int().min(0),
  globalStart: z.number().int().min(0),
  globalEnd: z.number().int().min(0)
}).refine((locator) => locator.pageEnd >= locator.pageStart && locator.globalEnd >= locator.globalStart, {
  message: "source locator end must be greater than or equal to start"
});

export const FactCategorySchema = z.enum([
  "basic",
  "education",
  "experience",
  "skill",
  "certificate",
  "achievement",
  "language",
  "other"
]);

export const FactProvenanceSchema = z.object({
  sourceType: FactSourceTypeSchema,
  sourceId: z.string().min(1),
  sourceText: z.string().min(1),
  confidence: z.number().min(0).max(1),
  confirmedByUser: z.boolean(),
  riskLevel: RiskLevelSchema,
  createdAt: IsoDateStringSchema,
  sourceInputId: z.string().min(1).optional(),
  sourceSessionId: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  pageNumber: z.number().int().min(1).optional(),
  pageRange: z.object({
    startPage: z.number().int().min(1),
    endPage: z.number().int().min(1)
  }).refine((range) => range.endPage >= range.startPage, {
    message: "pageRange endPage must be greater than or equal to startPage"
  }).optional(),
  sourceQuote: z.string().min(1).optional(),
  sourceLocatorStatus: PdfLocatorStatusSchema.optional(),
  sourceLocator: PdfSourceLocatorSchema.optional()
}).superRefine((provenance, context) => {
  if (provenance.sourceType !== "pdf_import") {
    return;
  }

  if (!provenance.sourceSessionId) {
    context.addIssue({
      code: "custom",
      path: ["sourceSessionId"],
      message: "pdf_import provenance must include sourceSessionId"
    });
  }

  if (!provenance.sourceQuote) {
    context.addIssue({
      code: "custom",
      path: ["sourceQuote"],
      message: "pdf_import provenance must include sourceQuote"
    });
  }

  if (!provenance.sourceLocatorStatus) {
    context.addIssue({
      code: "custom",
      path: ["sourceLocatorStatus"],
      message: "pdf_import provenance must include sourceLocatorStatus"
    });
    return;
  }

  if (provenance.sourceLocatorStatus === "located") {
    if (!provenance.sourceLocator) {
      context.addIssue({
        code: "custom",
        path: ["sourceLocator"],
        message: "located pdf_import provenance must include sourceLocator"
      });
    }

    if (!provenance.pageNumber) {
      context.addIssue({
        code: "custom",
        path: ["pageNumber"],
        message: "located pdf_import provenance must include pageNumber"
      });
    }

    if (provenance.pageNumber && provenance.sourceLocator && provenance.pageNumber !== provenance.sourceLocator.pageNumber) {
      context.addIssue({
        code: "custom",
        path: ["pageNumber"],
        message: "located pdf_import pageNumber must match sourceLocator.pageNumber"
      });
    }
    return;
  }

  if (provenance.sourceLocator || provenance.pageNumber || provenance.pageRange) {
    context.addIssue({
      code: "custom",
      path: ["sourceLocator"],
      message: "ambiguous or unlocated pdf_import provenance must not include page locator fields"
    });
  }
});

export const FactStatementSchema = EntityBaseSchema.extend({
  statement: z.string().min(1),
  category: FactCategorySchema,
  provenance: z.array(FactProvenanceSchema).min(1),
  confirmedByUser: z.boolean(),
  riskLevel: RiskLevelSchema
});

export const SourceSpanSchema = z.object({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  text: z.string().min(1)
}).refine((span) => span.end >= span.start, {
  message: "source span end must be greater than or equal to start"
});

export type EntityBase = z.infer<typeof EntityBaseSchema>;
export type RiskLevel = z.infer<typeof RiskLevelSchema>;
export type FactSourceType = z.infer<typeof FactSourceTypeSchema>;
export type PdfLocatorStatus = z.infer<typeof PdfLocatorStatusSchema>;
export type PdfSourceLocator = z.infer<typeof PdfSourceLocatorSchema>;
export type FactCategory = z.infer<typeof FactCategorySchema>;
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;
export type FactStatement = z.infer<typeof FactStatementSchema>;
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
