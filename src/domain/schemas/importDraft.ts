import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, SourceSpanSchema } from "./common";
import { ExperienceTypeSchema } from "./profile";
import { JobRequirementCategorySchema } from "./job";

export const RawInputKindSchema = z.enum(["resume_text", "job_jd"]);

export const DraftStatusSchema = z.enum([
  "empty",
  "raw_saving",
  "raw_saved",
  "privacy_pending",
  "analyzing",
  "ai_validated",
  "editing",
  "manual_mode",
  "confirming",
  "committed",
  "error"
]);

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const JdDraftPrioritySchema = z.enum(["must", "important", "nice_to_have", "uncertain"]);

export const RawInputDocumentSchema = EntityBaseSchema.extend({
  kind: RawInputKindSchema,
  rawText: z.string().min(1),
  inputHash: z.string().min(16),
  title: z.string().optional()
});

export const DraftSourceFieldSchema = z.object({
  value: z.string().min(1),
  sourceQuote: z.string().min(1),
  sourceSpan: SourceSpanSchema.optional(),
  confidenceLevel: ConfidenceLevelSchema,
  confidenceReason: z.string().min(1),
  needsConfirmation: z.boolean()
});

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
});

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
});

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
});

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

export const JdAnalyzerOutputSchema = z.object({
  title: DraftSourceFieldSchema.optional(),
  company: DraftSourceFieldSchema.optional(),
  industry: DraftSourceFieldSchema.optional(),
  location: DraftSourceFieldSchema.optional(),
  workType: DraftSourceFieldSchema.optional(),
  requirements: z.array(JdAnalyzerRequirementSchema).default([]),
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
  manualRequirements: z.array(JdAnalyzerRequirementSchema).default([]),
  riskNotes: z.array(z.string()).default([]),
  saveError: z.string().optional(),
  lastAutosavedAt: IsoDateStringSchema.optional(),
  committedJobId: z.string().optional(),
  committedAt: IsoDateStringSchema.optional()
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
export type DraftStatus = z.infer<typeof DraftStatusSchema>;
export type ConfidenceLevel = z.infer<typeof ConfidenceLevelSchema>;
export type JdDraftPriority = z.infer<typeof JdDraftPrioritySchema>;
export type RawInputDocument = z.infer<typeof RawInputDocumentSchema>;
export type DraftSourceField = z.infer<typeof DraftSourceFieldSchema>;
export type ProfileBuilderFact = z.infer<typeof ProfileBuilderFactSchema>;
export type ProfileBuilderExperience = z.infer<typeof ProfileBuilderExperienceSchema>;
export type ProfileBuilderOutput = z.infer<typeof ProfileBuilderOutputSchema>;
export type ProfileImportDraft = z.infer<typeof ProfileImportDraftSchema>;
export type JdAnalyzerRequirement = z.infer<typeof JdAnalyzerRequirementSchema>;
export type JdAnalyzerOutput = z.infer<typeof JdAnalyzerOutputSchema>;
export type JobAnalysisDraft = z.infer<typeof JobAnalysisDraftSchema>;
export type DraftCommit = z.infer<typeof DraftCommitSchema>;
