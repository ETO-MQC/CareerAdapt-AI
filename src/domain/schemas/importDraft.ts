import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, PdfLocatorStatusSchema, PdfSourceLocatorSchema, SourceSpanSchema } from "./common";
import { ExperienceTypeSchema } from "./profile";
import { JobRequirementCategorySchema } from "./job";
import { JobRequirementGraphV3Schema } from "./jobOptimizationV3";
import { JobRequirementGraphV4Schema } from "./jobOptimizationV4";

export const RawInputKindSchema = z.enum(["resume_text", "resume_pdf_text", "job_jd"]);

export const PdfImportStatusSchema = z.enum([
  "idle",
  "validating",
  "extracting",
  "extracted",
  "awaiting_privacy_confirmation",
  "parsing",
  "draft_ready",
  "failed",
  "cancelled",
  "committed",
  "interrupted"
]);

export const PdfImportErrorCodeSchema = z.enum([
  "not_pdf",
  "mime_extension_mismatch",
  "empty_file",
  "file_too_large",
  "page_limit_exceeded",
  "text_item_limit_exceeded",
  "page_text_too_long",
  "extract_timeout",
  "encrypted_or_password",
  "corrupt_pdf",
  "no_text_layer",
  "empty_extracted_text",
  "extract_interrupted",
  "extract_cancelled",
  "text_too_long",
  "ai_failed",
  "schema_validation_failed",
  "unknown_error"
]);

export const DraftStatusSchema = z.enum([
  "empty",
  "raw_saving",
  "raw_saved",
  "privacy_pending",
  "analyzing",
  "ai_validated",
  "needs_review",
  "editing",
  "manual_mode",
  "confirming",
  "committed",
  "discarded",
  "error"
]);

export const JobAnalysisRunStatusSchema = z.enum([
  "saved", "local_analyzing", "ai_analyzing", "validating", "review_ready",
  "local_ready_ai_failed", "interrupted", "committed", "discarded"
]);

export const JobAnalysisRunSchema = z.object({
  id: z.string().min(1), startedAt: IsoDateStringSchema, finishedAt: IsoDateStringSchema.optional(),
  status: JobAnalysisRunStatusSchema, provider: z.string().optional(), model: z.string().optional(),
  analyzerVersion: z.string().min(1), graphHash: z.string().optional(), semanticEnrichmentHash: z.string().optional(),
  sourceUnitCount: z.number().int().min(0).optional(), assignmentCount: z.number().int().min(0).optional(), errorCode: z.string().optional()
}).strict();

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const JdDraftPriorityV2Schema = z.enum(["must", "high", "medium", "nice_to_have", "uncertain"]);

export type JdDraftPriorityV2 = z.infer<typeof JdDraftPriorityV2Schema>;

export function normalizeJdPriority(value: unknown): JdDraftPriorityV2 {
  if (value === "must" || value === "high" || value === "medium" || value === "nice_to_have" || value === "uncertain") {
    return value;
  }
  if (value === "important") return "high";
  if (value === "low") return "medium";
  return "uncertain";
}

/** Reads legacy persisted values while exposing only the canonical V2 priority. */
export const JdDraftPrioritySchema = z.preprocess(normalizeJdPriority, JdDraftPriorityV2Schema);

export const RawInputSourceTextKindSchema = z.enum([
  "plain_text",
  "pdf_cleaned_text",
  "pdf_user_edited_text"
]);

export const RawInputSourcePageSchema = z.object({
  pageNumber: z.number().int().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  rawTextHash: z.string().min(8).optional(),
  cleanedTextHash: z.string().min(8).optional()
}).refine((page) => page.end >= page.start, {
  message: "raw input source page end must be greater than or equal to start"
});

export const RawInputDocumentSchema = EntityBaseSchema.extend({
  kind: RawInputKindSchema,
  rawText: z.string().min(1),
  inputHash: z.string().min(16),
  title: z.string().optional(),
  sourceSessionId: z.string().min(1).optional(),
  sourceTextKind: RawInputSourceTextKindSchema.optional(),
  normalizedTextHash: z.string().min(8).optional(),
  aiInputHash: z.string().min(8).optional(),
  privacyConfirmedAiInputHash: z.string().min(8).optional(),
  userEditedAiText: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  fileSize: z.number().int().min(0).optional(),
  mimeType: z.string().optional(),
  pageCount: z.number().int().min(1).optional(),
  sourcePages: z.array(RawInputSourcePageSchema).optional()
});

export const PdfPageTextSchema = EntityBaseSchema.extend({
  sessionId: z.string().min(1),
  pageNumber: z.number().int().min(1),
  extractedPageText: z.string(),
  cleanedPageText: z.string(),
  charStart: z.number().int().min(0),
  charEnd: z.number().int().min(0),
  textItemCount: z.number().int().min(0),
  warnings: z.array(z.string()).default([]),
  rawTextHash: z.string().min(8),
  cleanedTextHash: z.string().min(8)
}).refine((page) => page.charEnd >= page.charStart, {
  message: "pdf page charEnd must be greater than or equal to charStart"
});

export const PdfImportSessionSchema = EntityBaseSchema.extend({
  status: PdfImportStatusSchema,
  fileName: z.string().min(1),
  fileSize: z.number().int().min(0),
  mimeType: z.string(),
  extension: z.string().min(1),
  fileHash: z.string().min(16),
  pageCount: z.number().int().min(0).default(0),
  textLength: z.number().int().min(0).default(0),
  normalizedTextHash: z.string().min(8).optional(),
  aiInputHash: z.string().min(8).optional(),
  sourceTextKind: RawInputSourceTextKindSchema.optional(),
  rawInputId: z.string().min(1).optional(),
  draftId: z.string().min(1).optional(),
  errorCode: PdfImportErrorCodeSchema.optional(),
  errorMessage: z.string().optional(),
  extractionVersion: z.string().min(1),
  hasPromptInjectionRisk: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  interruptedAt: IsoDateStringSchema.optional(),
  committedProfileId: z.string().min(1).optional(),
  committedAt: IsoDateStringSchema.optional()
});

const PdfSourceMappingFieldsSchema = z.object({
  sourceLocatorStatus: PdfLocatorStatusSchema.optional(),
  sourceLocator: PdfSourceLocatorSchema.optional(),
  sourceMatchCount: z.number().int().min(0).optional()
});

export const DraftSourceFieldSchema = z.object({
  value: z.string().min(1),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean()
}).merge(PdfSourceMappingFieldsSchema);

export const ProfileBuilderBasicInfoSchema = z.object({
  name: DraftSourceFieldSchema.optional(),
  phone: DraftSourceFieldSchema.optional(),
  email: DraftSourceFieldSchema.optional(),
  location: DraftSourceFieldSchema.optional(),
  summary: DraftSourceFieldSchema.optional(),
  links: z.array(DraftSourceFieldSchema).default([])
});

export const ProfileBuilderFactSchema = EntityBaseSchema.extend({
  statement: z.string().min(1),
  category: z.enum([
    "basic",
    "education",
    "experience",
    "skill",
    "certificate",
    "achievement",
    "language",
    "other"
  ]),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean(),
  confirmedByUser: z.boolean().default(false)
}).merge(PdfSourceMappingFieldsSchema);

export const ProfileBuilderExperienceSchema = EntityBaseSchema.extend({
  type: ExperienceTypeSchema,
  organization: DraftSourceFieldSchema,
  role: DraftSourceFieldSchema,
  startDate: DraftSourceFieldSchema.optional(),
  endDate: DraftSourceFieldSchema.optional(),
  facts: z.array(ProfileBuilderFactSchema).default([]),
  tags: z.array(z.string()).default([]),
  confirmedByUser: z.boolean().default(false)
});

export const ProfileBuilderSkillSchema = EntityBaseSchema.extend({
  name: DraftSourceFieldSchema,
  level: z.enum(["basic", "familiar", "proficient"]).optional(),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean(),
  confirmedByUser: z.boolean().default(false)
}).merge(PdfSourceMappingFieldsSchema);

export const ProfileBuilderCertificateSchema = EntityBaseSchema.extend({
  name: DraftSourceFieldSchema,
  issuer: DraftSourceFieldSchema.optional(),
  issuedAt: DraftSourceFieldSchema.optional(),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean(),
  confirmedByUser: z.boolean().default(false)
}).merge(PdfSourceMappingFieldsSchema);

export const ProfileBuilderOutputSchema = z.object({
  basics: ProfileBuilderBasicInfoSchema,
  experiences: z.array(ProfileBuilderExperienceSchema).default([]),
  skills: z.array(ProfileBuilderSkillSchema).default([]),
  certificates: z.array(ProfileBuilderCertificateSchema).default([]),
  unclassifiedBlocks: z.array(z.string()).default([])
});

export const ProfileImportDraftSchema = EntityBaseSchema.extend({
  rawInputId: z.string().min(1),
  revision: z.number().int().min(0),
  status: DraftStatusSchema,
  promptVersion: z.string().min(1),
  attemptCount: z.number().int().min(0).default(0),
  builderOutput: ProfileBuilderOutputSchema.optional(),
  manualSections: ProfileBuilderOutputSchema.optional(),
  pendingFacts: z.array(ProfileBuilderFactSchema).default([]),
  saveError: z.string().optional(),
  privacyConfirmedAiInputHash: z.string().min(8).optional(),
  lastAutosavedAt: IsoDateStringSchema.optional(),
  committedProfileId: z.string().optional(),
  committedAt: IsoDateStringSchema.optional()
});

export const JdAnalyzerRequirementSchema = EntityBaseSchema.extend({
  category: JobRequirementCategorySchema,
  description: z.string().min(1),
  priority: JdDraftPrioritySchema,
  hardConstraint: z.boolean(),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  keywords: z.array(z.string()).default([]),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean(),
  confirmedByUser: z.boolean().default(false)
});

export const JdUnitAssignmentSchema = z.object({
  sourceUnitId: z.string().min(1),
  verdict: z.enum(["accept", "override"]),
  disposition: z.enum(["heading", "context", "group_wrapper", "metadata", "requirement", "requirement_detail", "verification_material", "hiring_signal", "excluded", "unclassified"]).optional(),
  section: z.enum(["responsibility", "required", "preferred", "verification", "role_profile", "unknown"]).optional(),
  kind: z.enum(["responsibility", "hard_constraint", "core_competency", "tool_or_technology", "experience_depth", "education", "language", "soft_skill", "domain_knowledge", "preferred", "risk_or_uncertain"]).optional(),
  priority: z.enum(["must", "high", "medium", "nice_to_have", "uncertain"]).optional(),
  hardConstraint: z.boolean().optional(),
  parentUnitId: z.string().min(1).nullable().optional(),
  groupRelation: z.enum(["all_of", "any_of", "preferred_any_of", "examples", "evidence_bundle", "topic_list"]).optional(),
  normalizedIntent: z.string().min(1).optional(),
  exactKeywords: z.array(z.string().min(1)).optional(),
  semanticAliases: z.array(z.string().min(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().min(1).optional()
}).strict();

export const JdGroupAdjustmentSchema = z.object({
  groupId: z.string().min(1),
  relation: z.enum(["all_of", "any_of", "preferred_any_of", "evidence_bundle"]).optional(),
  parentUnitId: z.string().min(1).optional(),
  reason: z.string().min(1).optional()
}).strict();

/** Compact protocol returned directly by the model. */
export const JdAnalyzerModelOutputSchema = z.object({
  unitAssignments: z.array(JdUnitAssignmentSchema),
  groupAdjustments: z.array(JdGroupAdjustmentSchema).default([]),
  roleMission: z.string().min(1).optional(),
  level: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  riskNotes: z.array(z.string()).default([])
}).strict();

export const JdAnalyzerOutputSchema = z.object({
  title: DraftSourceFieldSchema.optional(),
  company: DraftSourceFieldSchema.optional(),
  industry: DraftSourceFieldSchema.optional(),
  location: DraftSourceFieldSchema.optional(),
  workType: DraftSourceFieldSchema.optional(),
  requirements: z.array(JdAnalyzerRequirementSchema).default([]),
  unitAssignments: z.array(JdUnitAssignmentSchema).optional(),
  groupAdjustments: z.array(JdGroupAdjustmentSchema).optional(),
  roleMission: z.string().min(1).optional(),
  level: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  riskNotes: z.array(z.string()).default([])
});

export const JobAnalysisDraftSchema = EntityBaseSchema.extend({
  rawInputId: z.string().min(1),
  revision: z.number().int().min(0),
  title: z.string().min(1),
  company: z.string().min(1),
  status: DraftStatusSchema,
  promptVersion: z.string().min(1),
  attemptCount: z.number().int().min(0).default(0),
  analyzerOutput: JdAnalyzerOutputSchema.optional(),
  requirementGraph: z.union([JobRequirementGraphV3Schema, JobRequirementGraphV4Schema]).optional(),
  analysisIssues: z.array(z.string().min(1)).optional(),
  manualRequirements: z.array(JdAnalyzerRequirementSchema).default([]),
  riskNotes: z.array(z.string()).default([]),
  saveError: z.string().optional(),
  lastAutosavedAt: IsoDateStringSchema.optional(),
  committedJobId: z.string().optional(),
  committedAt: IsoDateStringSchema.optional(),
  analysisRunStatus: JobAnalysisRunStatusSchema.optional(),
  analysisRuns: z.array(JobAnalysisRunSchema).max(10).optional()
});

export const DraftCommitKindSchema = z.enum(["profile", "job"]);

export const DraftCommitSchema = EntityBaseSchema.extend({
  commitId: z.string().min(1),
  draftId: z.string().min(1),
  kind: DraftCommitKindSchema,
  entityId: z.string().min(1),
  expectedRevision: z.number().int().min(0)
});

export type RawInputKind = z.infer<typeof RawInputKindSchema>;
export type PdfImportStatus = z.infer<typeof PdfImportStatusSchema>;
export type PdfImportErrorCode = z.infer<typeof PdfImportErrorCodeSchema>;
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
export type JobAnalysisRunStatus = z.infer<typeof JobAnalysisRunStatusSchema>;
export type JobAnalysisRun = z.infer<typeof JobAnalysisRunSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type JdDraftPriority = z.infer<typeof JdDraftPrioritySchema>;
export type RawInputSourceTextKind = z.infer<typeof RawInputSourceTextKindSchema>;
export type RawInputSourcePage = z.infer<typeof RawInputSourcePageSchema>;
export type RawInputDocument = z.infer<typeof RawInputDocumentSchema>;
export type PdfPageText = z.infer<typeof PdfPageTextSchema>;
export type PdfImportSession = z.infer<typeof PdfImportSessionSchema>;
export type DraftSourceField = z.infer<typeof DraftSourceFieldSchema>;
export type ProfileBuilderFact = z.infer<typeof ProfileBuilderFactSchema>;
export type ProfileBuilderExperience = z.infer<typeof ProfileBuilderExperienceSchema>;
export type ProfileBuilderSkill = z.infer<typeof ProfileBuilderSkillSchema>;
export type ProfileBuilderCertificate = z.infer<typeof ProfileBuilderCertificateSchema>;
export type ProfileBuilderOutput = z.infer<typeof ProfileBuilderOutputSchema>;
export type ProfileImportDraft = z.infer<typeof ProfileImportDraftSchema>;
export type JdAnalyzerRequirement = z.infer<typeof JdAnalyzerRequirementSchema>;
export type JdUnitAssignment = z.infer<typeof JdUnitAssignmentSchema>;
export type JdAnalyzerModelOutput = z.infer<typeof JdAnalyzerModelOutputSchema>;
export type JdAnalyzerOutput = z.infer<typeof JdAnalyzerOutputSchema>;
export type JobAnalysisDraft = z.infer<typeof JobAnalysisDraftSchema>;
export type DraftCommit = z.infer<typeof DraftCommitSchema>;
