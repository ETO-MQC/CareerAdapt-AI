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
  "user_input",
  "ai_suggestion",
  "evidence",
  "system"
]);

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
  createdAt: IsoDateStringSchema
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
export type FactCategory = z.infer<typeof FactCategorySchema>;
export type FactProvenance = z.infer<typeof FactProvenanceSchema>;
export type FactStatement = z.infer<typeof FactStatementSchema>;
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
