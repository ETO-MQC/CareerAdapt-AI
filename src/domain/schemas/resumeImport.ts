import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";
import { ResumeRenderSectionTypeSchema } from "./resumeRender";

export const ImportedResumeDraftStatusSchema = z.enum([
  "extracting",
  "reviewing",
  "confirming",
  "confirmed",
  "failed",
  "cancelled"
]);

export const ImportedResumeConfidenceSchema = z.enum(["high", "medium", "low"]);

export const ImportedResumeMappingTraceSchema = z.object({
  sourcePaths: z.array(z.string().min(1)).min(1),
  sourceValues: z.array(z.unknown()).min(1),
  confidenceLevel: ImportedResumeConfidenceSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean()
});

export const ImportedResumeSourceStatusSchema = z.enum([
  "located",
  "ambiguous",
  "unlocated",
  "user_confirmed_modified"
]);

export const ImportedResumeSectionTypeSchema = z.union([
  ResumeRenderSectionTypeSchema,
  z.literal("unknown")
]);

export const ImportedResumeWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  itemId: z.string().min(1).optional(),
  sectionId: z.string().min(1).optional(),
  pageNumber: z.number().int().min(1).optional()
});

export const ImportedResumePageRefSchema = z.object({
  pageNumber: z.number().int().min(1),
  quote: z.string().min(1)
});

export const ImportedResumeFieldSchema = z.object({
  value: z.string().min(1),
  pageRefs: z.array(ImportedResumePageRefSchema).default([]),
  confidence: ImportedResumeConfidenceSchema,
  sourceStatus: ImportedResumeSourceStatusSchema,
  userEdited: z.boolean().default(false),
  mapping: ImportedResumeMappingTraceSchema.optional()
});

export const ImportedResumeItemSchema = z.object({
  id: z.string().min(1),
  rawText: z.string().min(1),
  normalizedText: z.string().min(1),
  included: z.boolean(),
  order: z.number().int().min(0),
  pageRefs: z.array(ImportedResumePageRefSchema).default([]),
  confidence: ImportedResumeConfidenceSchema,
  sourceStatus: ImportedResumeSourceStatusSchema,
  userEdited: z.boolean().default(false),
  mapping: ImportedResumeMappingTraceSchema.optional()
});

export const ImportedResumeCategorySchema = z.enum([
  "summary",
  "education",
  "work",
  "project",
  "campus",
  "award",
  "skill",
  "certificate",
  "language",
  "custom"
]);

export const ImportedResumeSectionSchema = z.object({
  id: z.string().min(1),
  sectionType: ImportedResumeSectionTypeSchema,
  category: ImportedResumeCategorySchema.optional(),
  detectedTitle: z.string().min(1),
  included: z.boolean(),
  order: z.number().int().min(0),
  confidence: ImportedResumeConfidenceSchema,
  items: z.array(ImportedResumeItemSchema).default([]),
  mapping: ImportedResumeMappingTraceSchema.optional()
});

export const ImportedResumePageSchema = z.object({
  pageNumber: z.number().int().min(1),
  rawText: z.string(),
  normalizedText: z.string(),
  charStart: z.number().int().min(0).optional(),
  charEnd: z.number().int().min(0).optional()
});

export const ImportedResumeSourceSchema = z.object({
  sourceSessionId: z.string().min(1).optional(),
  rawInputId: z.string().min(1).optional(),
  fileName: z.string().min(1),
  mimeType: z.enum([
    "application/pdf",
    "application/json",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "text/plain"
  ]),
  fileHash: z.string().min(16),
  normalizedTextHash: z.string().min(8).optional(),
  pageCount: z.number().int().min(1),
  extractedAt: IsoDateStringSchema
});

export const StructuredResumeValueSchema = z.union([
  z.string().min(1),
  z.object({
    value: z.string().min(1),
    mapping: ImportedResumeMappingTraceSchema
  })
]);

export const StructuredResumeDraftItemSchema = z.union([
  z.string().min(1),
  z.object({
    text: z.string().min(1).optional(),
    organization: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    startDate: z.string().min(1).optional(),
    endDate: z.string().min(1).optional(),
    current: z.boolean().optional(),
    highlights: z.array(z.string().min(1)).optional(),
    included: z.boolean().optional(),
    mapping: ImportedResumeMappingTraceSchema.optional()
  }).refine((item) => Boolean(item.text || item.organization || item.role || item.highlights?.length), {
    message: "structured resume item requires text or structured content"
  })
]);

export const StructuredResumeDraftSchema = z.object({
  schemaVersion: z.literal("structured-resume-draft-v1").optional(),
  basics: z.object({
    name: StructuredResumeValueSchema.optional(),
    email: StructuredResumeValueSchema.optional(),
    phone: StructuredResumeValueSchema.optional(),
    location: StructuredResumeValueSchema.optional(),
    summary: StructuredResumeValueSchema.optional(),
    links: z.array(StructuredResumeValueSchema).optional()
  }).default({}),
  sections: z.array(z.object({
    title: z.string().min(1),
    sectionType: ImportedResumeSectionTypeSchema.default("unknown"),
    category: ImportedResumeCategorySchema.optional(),
    included: z.boolean().optional(),
    items: z.array(StructuredResumeDraftItemSchema).default([]),
    mapping: ImportedResumeMappingTraceSchema.optional()
  })).default([])
}).strict();

export const ImportedResumeDraftSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("resume-import-v1"),
  importId: z.string().min(1),
  revision: z.number().int().min(0),
  status: ImportedResumeDraftStatusSchema,
  source: ImportedResumeSourceSchema,
  basics: z.object({
    name: ImportedResumeFieldSchema.optional(),
    email: ImportedResumeFieldSchema.optional(),
    phone: ImportedResumeFieldSchema.optional(),
    location: ImportedResumeFieldSchema.optional(),
    links: z.array(ImportedResumeFieldSchema).default([]),
    targetRole: ImportedResumeFieldSchema.optional(),
    summary: ImportedResumeFieldSchema.optional()
  }),
  sections: z.array(ImportedResumeSectionSchema).default([]),
  pages: z.array(ImportedResumePageSchema).default([]),
  unclassifiedBlocks: z.array(z.object({
    sourcePath: z.string().min(1),
    sourceValue: z.unknown(),
    reason: z.string().min(1)
  })).default([]),
  warnings: z.array(ImportedResumeWarningSchema).default([]),
  parserVersion: z.string().min(1),
  confirmedProfileId: z.string().min(1).optional(),
  confirmedBranchId: z.string().min(1).optional(),
  confirmedRevisionId: z.string().min(1).optional(),
  confirmedAt: IsoDateStringSchema.optional()
}).superRefine((draft, ctx) => {
  const itemIds = new Set<string>();
  for (const section of draft.sections) {
    for (const item of section.items) {
      if (itemIds.has(item.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["sections"],
          message: "imported resume item ids must be unique"
        });
      }
      itemIds.add(item.id);
    }
  }
});

export const ImportMergeDecisionSchema = z.object({
  target: z.enum(["name", "email", "phone", "location", "summary", "link"]),
  importedValue: z.string().min(1),
  action: z.enum(["keep_existing", "use_imported", "keep_both"])
});

export const ImportedResumeConfirmResultSchema = z.object({
  profileId: z.string().min(1),
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  idempotent: z.boolean()
});

export const ResumeJsonMapperOutputSchema = z.object({
  structuredDraft: StructuredResumeDraftSchema,
  unclassifiedBlocks: z.array(z.object({
    sourcePath: z.string().min(1),
    sourceValue: z.unknown(),
    reason: z.string().min(1)
  })).default([])
});

export type ImportedResumeDraftStatus = z.infer<typeof ImportedResumeDraftStatusSchema>;
export type ImportedResumeConfidence = z.infer<typeof ImportedResumeConfidenceSchema>;
export type ImportedResumeMappingTrace = z.infer<typeof ImportedResumeMappingTraceSchema>;
export type ImportedResumeCategory = z.infer<typeof ImportedResumeCategorySchema>;
export type ImportedResumeSourceStatus = z.infer<typeof ImportedResumeSourceStatusSchema>;
export type ImportedResumeSectionType = z.infer<typeof ImportedResumeSectionTypeSchema>;
export type ImportedResumeWarning = z.infer<typeof ImportedResumeWarningSchema>;
export type ImportedResumePageRef = z.infer<typeof ImportedResumePageRefSchema>;
export type ImportedResumeField = z.infer<typeof ImportedResumeFieldSchema>;
export type ImportedResumeItem = z.infer<typeof ImportedResumeItemSchema>;
export type ImportedResumeSection = z.infer<typeof ImportedResumeSectionSchema>;
export type ImportedResumePage = z.infer<typeof ImportedResumePageSchema>;
export type ImportedResumeSource = z.infer<typeof ImportedResumeSourceSchema>;
export type ImportedResumeDraft = z.infer<typeof ImportedResumeDraftSchema>;
export type StructuredResumeDraft = z.infer<typeof StructuredResumeDraftSchema>;
export type ImportMergeDecision = z.infer<typeof ImportMergeDecisionSchema>;
export type ImportedResumeConfirmResult = z.infer<typeof ImportedResumeConfirmResultSchema>;
export type ResumeJsonMapperOutput = z.infer<typeof ResumeJsonMapperOutputSchema>;
