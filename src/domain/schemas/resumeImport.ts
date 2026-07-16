import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";
import { ResumeRenderSectionTypeSchema } from "./resumeRender";
import { isCanonicalFieldId } from "@/domain/resumeFields";
import { CustomFieldValueSchema, FlexibleSectionV2Schema, ResumeItemV2Schema, ResumeSectionTypeV2Schema } from "./resumeV2";
import { ResumeJsonV2MappingTraceSchema } from "./resumeJsonV2";

export const ImportedResumeDraftStatusSchema = z.enum([
  "extracting",
  "reviewing",
  "confirming",
  "confirmed",
  "failed",
  "cancelled"
]);

export const ImportedResumeConfidenceSchema = z.enum(["high", "medium", "low"]);

export const ResumeSourceKindSchema = z.enum([
  "standard_json",
  "external_json",
  "docx",
  "digital_pdf",
  "complex_digital_pdf",
  "text_pdf",
  "scanned_pdf",
  "image"
]);

export const ResumeImportSourceClassificationSchema = z.enum([
  "standard_json",
  "external_json",
  "docx",
  "digital_pdf",
  "complex_digital_pdf",
  "scanned_pdf",
  "image"
]);

export const ResumeImportPipelineRouteSchema = z.enum([
  "standard_json",
  "deterministic_json",
  "docx_structure",
  "digital_pdf_layout",
  "ocr_local",
  "manual_review"
]);

export const ResumeSourceEngineSchema = z.enum([
  "json_mapper",
  "docx_xml",
  "pdfjs",
  "opendataloader",
  "paddleocr_vl",
  "plain_text"
]);

export const ExtractedSourceBlockTypeSchema = z.enum([
  "paragraph",
  "heading",
  "list_item",
  "table_cell",
  "table_row",
  "contact",
  "date",
  "image_region",
  "text_block",
  "unknown"
]);

export const ResumeSourceBoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0)
}).strict();

export const ResumeSourceRangeSchema = z.object({
  blockId: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0)
}).strict().refine((range) => range.end > range.start, {
  message: "source range end must be greater than start"
});

export const ExtractedSourceBlockSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().min(1).optional(),
  sourcePath: z.string().min(1).optional(),
  text: z.string(),
  rawText: z.string(),
  blockType: ExtractedSourceBlockTypeSchema,
  position: ResumeSourceBoundingBoxSchema.optional(),
  parentId: z.string().min(1).optional(),
  rowIndex: z.number().int().min(0).optional(),
  columnIndex: z.number().int().min(0).optional(),
  sourceEngine: ResumeSourceEngineSchema.optional(),
  sourceEngineVersion: z.string().min(1).optional(),
  extractionConfidence: z.number().min(0).max(1).optional(),
  fontSize: z.number().positive().optional(),
  sourceKind: ResumeImportSourceClassificationSchema.optional(),
  order: z.number().int().min(0)
});

export const NormalizedSourceBlockSchema = ExtractedSourceBlockSchema.extend({
  normalizedText: z.string(),
  normalizationActions: z.array(z.string()).default([])
});

export const ResumeSourceBlockV2Schema = NormalizedSourceBlockSchema.extend({
  sourceKind: ResumeImportSourceClassificationSchema,
  sourceEngine: ResumeSourceEngineSchema,
  sourceEngineVersion: z.string().min(1),
  extractionConfidence: z.number().min(0).max(1),
  position: ResumeSourceBoundingBoxSchema.optional()
}).strict();

export const ImportQualityReportSchema = z.object({
  sourceType: ResumeSourceKindSchema,
  textCoverage: z.number().min(0).max(1),
  replacementCharacterRatio: z.number().min(0).max(1),
  abnormalWhitespaceRatio: z.number().min(0).max(1),
  lineFragmentationScore: z.number().min(0).max(1),
  readingOrderConfidence: z.enum(["high", "medium", "low"]),
  layoutComplexity: z.enum(["single_column", "multi_column", "table", "unknown"]),
  recommendedRoute: z.enum(["deterministic", "ai_text", "ocr_ai"]),
  warnings: z.array(z.string()).default([])
});

export const ImportQualityReportV2Schema = ImportQualityReportSchema.extend({
  schemaVersion: z.literal("resume-import-quality-v2"),
  classification: ResumeImportSourceClassificationSchema,
  recommendedPipeline: ResumeImportPipelineRouteSchema,
  pageCount: z.number().int().min(1),
  coordinateCoverage: z.number().min(0).max(1),
  hasUsableTextLayer: z.boolean(),
  ocrRequiredPages: z.array(z.number().int().min(1)).default([]),
  thresholds: z.object({
    minimumTextCoverage: z.number().min(0).max(1),
    maximumReplacementCharacterRatio: z.number().min(0).max(1),
    maximumLineFragmentationScore: z.number().min(0).max(1)
  }).strict()
}).strict();

export const ImportedResumeDatePrecisionSchema = z.enum(["year", "month", "day"]);
export const ImportedResumeFieldReviewStatusSchema = z.enum([
  "auto_selected",
  "needs_review",
  "accepted",
  "rejected",
  "edited"
]);

export const ImportedResumeDateValueSchema = z.object({
  rawText: z.string().min(1),
  value: z.string().regex(/^\d{4}(?:-\d{2})?$/).optional(),
  precision: ImportedResumeDatePrecisionSchema.optional(),
  sourcePrecision: ImportedResumeDatePrecisionSchema.optional(),
  businessPrecision: z.literal("month").optional(),
  current: z.boolean().default(false),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  sourceQuote: z.string().min(1),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean()
}).strict().superRefine((value, ctx) => {
  if (!value.current && (!value.value || !value.precision)) {
    ctx.addIssue({ code: "custom", message: "non-current dates require a normalized value and precision" });
  }
  if (value.current && value.value) {
    ctx.addIssue({ code: "custom", path: ["value"], message: "current dates must not fabricate a normalized end date" });
  }
  if (!value.current && value.sourcePrecision && value.precision && value.sourcePrecision !== value.precision) {
    ctx.addIssue({ code: "custom", path: ["sourcePrecision"], message: "sourcePrecision must match legacy precision" });
  }
});

export const ImportedResumeFieldCandidateSchema = z.object({
  id: z.string().min(1),
  targetFieldId: z.string().refine(isCanonicalFieldId, "targetFieldId must exist in the canonical field catalog"),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  sourceRanges: z.array(ResumeSourceRangeSchema).optional(),
  sectionId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  itemLabel: z.string().min(1).optional(),
  sourceQuote: z.string().min(1),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  userConfirmed: z.boolean().default(false),
  reviewStatus: ImportedResumeFieldReviewStatusSchema.default("needs_review"),
  mappingReason: z.string().min(1),
  dateValue: ImportedResumeDateValueSchema.optional()
}).strict();

export const ResumeOcrProgressStageSchema = z.enum([
  "checking_engine",
  "uploading",
  "rendering_pages",
  "recognizing",
  "normalizing",
  "completed"
]);

export const ResumeOcrBlockSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().min(1),
  text: z.string(),
  rawText: z.string(),
  blockType: ExtractedSourceBlockTypeSchema,
  position: ResumeSourceBoundingBoxSchema.optional(),
  order: z.number().int().min(0),
  confidence: z.number().min(0).max(1)
}).strict();

export const ResumeOcrSuccessResponseSchema = z.object({
  ok: z.literal(true),
  engine: z.literal("paddleocr-vl-local"),
  engineVersion: z.string().min(1),
  modelName: z.string().min(1),
  elapsedMs: z.number().int().min(0),
  pageCount: z.number().int().min(1),
  text: z.string(),
  blocks: z.array(ResumeOcrBlockSchema),
  warnings: z.array(z.string()).default([])
}).strict();

export const ResumeOcrHealthResponseSchema = z.object({
  ok: z.boolean(),
  engine: z.literal("paddleocr-vl-local"),
  configured: z.boolean(),
  modelAvailable: z.boolean(),
  runtimeAvailable: z.boolean(),
  device: z.string().min(1).optional(),
  message: z.string().min(1)
}).strict();

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

export const ImportedResumeSectionTypeSchema = z.union([ResumeRenderSectionTypeSchema, ResumeSectionTypeV2Schema, z.literal("unknown")]);

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
  sourceBlockIds: z.array(z.string().min(1)).default([]),
  sourceRanges: z.array(ResumeSourceRangeSchema).optional(),
  sourceQuote: z.string().min(1).optional(),
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
  sourceBlockIds: z.array(z.string().min(1)).default([]),
  sourceRanges: z.array(ResumeSourceRangeSchema).optional(),
  itemLabel: z.string().min(1).optional(),
  structuredItem: ResumeItemV2Schema.optional(),
  structuredMappingTrace: z.array(ResumeJsonV2MappingTraceSchema).default([]),
  sourceQuote: z.string().min(1).optional(),
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

export const ImportTargetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    profileId: z.string().min(1)
  }),
  z.object({
    mode: z.literal("new"),
    profileName: z.string().trim().min(1).max(120),
    createGeneralResume: z.boolean().default(true)
  })
]);

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

const ImportedResumeUnclassifiedBlockSchema = z.union([
  z.object({
    sourcePath: z.string().min(1),
    sourceValue: z.unknown(),
    reason: z.string().min(1)
  }).strict(),
  z.object({
    sourceBlockId: z.string().min(1),
    sourceRange: ResumeSourceRangeSchema,
    text: z.string().min(1),
    reason: z.string().min(1)
  }).strict()
]);

const ImportedResumeDraftBaseSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("resume-import-v1"),
  importId: z.string().min(1),
  revision: z.number().int().min(0),
  status: ImportedResumeDraftStatusSchema,
  source: ImportedResumeSourceSchema,
  sourceKind: ResumeSourceKindSchema.default("text_pdf"),
  sourceBlocks: z.array(NormalizedSourceBlockSchema).default([]),
  qualityReport: ImportQualityReportSchema.optional(),
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
  unclassifiedBlocks: z.array(ImportedResumeUnclassifiedBlockSchema).default([]),
  warnings: z.array(ImportedResumeWarningSchema).default([]),
  parserVersion: z.string().min(1),
  confirmedProfileId: z.string().min(1).optional(),
  confirmedBranchId: z.string().min(1).optional(),
  confirmedRevisionId: z.string().min(1).optional(),
  confirmedAt: IsoDateStringSchema.optional()
});

function validateImportedResumeItemIds(draft: { sections: Array<{ items: Array<{ id: string }> }> }, ctx: z.RefinementCtx) {
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
}

export const ImportedResumeDraftV1Schema = ImportedResumeDraftBaseSchema.superRefine(validateImportedResumeItemIds);

const MappingSourceShape = {
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  sourceQuote: z.string().min(1)
};

export const MappingDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("canonical_field"),
    targetFieldId: z.string().refine(isCanonicalFieldId, "targetFieldId must exist in the canonical field catalog"),
    ...MappingSourceShape,
    confidence: z.number().min(0).max(1),
    needsConfirmation: z.boolean(),
    mappingReason: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal("custom_field"),
    sectionId: z.string().min(1),
    proposedField: CustomFieldValueSchema,
    ...MappingSourceShape,
    confidence: z.number().min(0).max(1),
    needsConfirmation: z.boolean(),
    mappingReason: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal("custom_section"),
    proposedSection: FlexibleSectionV2Schema,
    ...MappingSourceShape,
    confidence: z.number().min(0).max(1),
    needsConfirmation: z.boolean(),
    mappingReason: z.string().min(1)
  }).strict(),
  z.object({
    kind: z.literal("unclassified"),
    reason: z.string().min(1),
    ...MappingSourceShape
  }).strict()
]);

export const ImportedResumeDraftV2Schema = ImportedResumeDraftBaseSchema.omit({
  schemaVersion: true,
  sourceBlocks: true,
  qualityReport: true
}).extend({
  schemaVersion: z.literal("resume-import-v2"),
  sourceBlocks: z.array(ResumeSourceBlockV2Schema).default([]),
  qualityReport: ImportQualityReportV2Schema,
  mappingDecisions: z.array(MappingDecisionSchema).default([]),
  fieldCandidates: z.array(ImportedResumeFieldCandidateSchema).default([])
}).strict().superRefine(validateImportedResumeItemIds);

export const ImportedResumeDraftSchema = z.union([
  ImportedResumeDraftV2Schema,
  ImportedResumeDraftV1Schema
]);

export const ImportMergeDecisionSchema = z.object({
  target: z.enum(["name", "email", "phone", "location", "summary", "link"]),
  importedValue: z.string().min(1),
  action: z.enum(["keep_existing", "use_imported", "keep_both"])
});

export const ImportedResumeBranchConfirmResultSchema = z.object({
  profileId: z.string().min(1),
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  idempotent: z.boolean()
});

export const ImportedResumeProfileOnlyConfirmResultSchema = z.object({
  profileId: z.string().min(1),
  branchId: z.undefined().optional(),
  revisionId: z.undefined().optional(),
  presentationRevision: z.undefined().optional(),
  idempotent: z.boolean()
});

export const ImportedResumeConfirmResultSchema = z.union([
  ImportedResumeBranchConfirmResultSchema,
  ImportedResumeProfileOnlyConfirmResultSchema
]);

export const ResumeJsonMapperOutputSchema = z.object({
  structuredDraft: StructuredResumeDraftSchema,
  unclassifiedBlocks: z.array(z.object({
    sourcePath: z.string().min(1),
    sourceValue: z.unknown(),
    reason: z.string().min(1)
  })).default([]),
  mappingDecisions: z.array(MappingDecisionSchema).optional()
});

export type ImportedResumeDraftStatus = z.infer<typeof ImportedResumeDraftStatusSchema>;
export type ResumeSourceKind = z.infer<typeof ResumeSourceKindSchema>;
export type ResumeImportSourceClassification = z.infer<typeof ResumeImportSourceClassificationSchema>;
export type ResumeImportPipelineRoute = z.infer<typeof ResumeImportPipelineRouteSchema>;
export type ResumeSourceEngine = z.infer<typeof ResumeSourceEngineSchema>;
export type ExtractedSourceBlock = z.infer<typeof ExtractedSourceBlockSchema>;
export type NormalizedSourceBlock = z.infer<typeof NormalizedSourceBlockSchema>;
export type ResumeSourceBlockV2 = z.infer<typeof ResumeSourceBlockV2Schema>;
export type ResumeSourceRange = z.infer<typeof ResumeSourceRangeSchema>;
export type ImportQualityReport = z.infer<typeof ImportQualityReportSchema>;
export type ImportQualityReportV2 = z.infer<typeof ImportQualityReportV2Schema>;
export type ImportedResumeDateValue = z.infer<typeof ImportedResumeDateValueSchema>;
export type ImportedResumeFieldReviewStatus = z.infer<typeof ImportedResumeFieldReviewStatusSchema>;
export type ImportedResumeFieldCandidate = z.infer<typeof ImportedResumeFieldCandidateSchema>;
export type ResumeOcrProgressStage = z.infer<typeof ResumeOcrProgressStageSchema>;
export type ResumeOcrBlock = z.infer<typeof ResumeOcrBlockSchema>;
export type ResumeOcrSuccessResponse = z.infer<typeof ResumeOcrSuccessResponseSchema>;
export type ResumeOcrHealthResponse = z.infer<typeof ResumeOcrHealthResponseSchema>;
export type ImportTarget = z.infer<typeof ImportTargetSchema>;
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
export type ImportedResumeDraftV1 = z.infer<typeof ImportedResumeDraftV1Schema>;
export type ImportedResumeDraft = z.infer<typeof ImportedResumeDraftSchema>;
export type ImportedResumeDraftV2 = z.infer<typeof ImportedResumeDraftV2Schema>;
export type MappingDecision = z.infer<typeof MappingDecisionSchema>;
export type StructuredResumeDraft = z.infer<typeof StructuredResumeDraftSchema>;
export type ImportMergeDecision = z.infer<typeof ImportMergeDecisionSchema>;
export type ImportedResumeConfirmResult = z.infer<typeof ImportedResumeConfirmResultSchema>;
export type ImportedResumeBranchConfirmResult = z.infer<typeof ImportedResumeBranchConfirmResultSchema>;
export type ImportedResumeProfileOnlyConfirmResult = z.infer<typeof ImportedResumeProfileOnlyConfirmResultSchema>;
export type ResumeJsonMapperOutput = z.infer<typeof ResumeJsonMapperOutputSchema>;
