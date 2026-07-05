import { z } from "zod";
import { AiSuggestionSchema } from "./ai";
import { EntityBaseSchema } from "./common";

export const JobAdaptationSectionTypeSchema = z.enum([
  "experience",
  "skills",
  "summary",
  "ordering_note",
  "risk_note"
]);

export const JobAdaptationSectionTextSchema = z.object({
  sectionId: z.string().min(1),
  sectionType: JobAdaptationSectionTypeSchema,
  sourceRef: z.string().optional(),
  originalText: z.string().min(1),
  text: z.string().min(1),
  order: z.number().int().min(0),
  updatedAt: z.string().datetime({ offset: true })
});

export const JobAdaptationSnapshotSchema = EntityBaseSchema.extend({
  draftId: z.string().min(1),
  revision: z.number().int().min(0),
  source: z.enum(["created", "suggestions_generated", "suggestion_applied", "suggestion_rejected", "suggestion_ignored", "suggestion_edited", "guard_rerun", "undo"]),
  operationId: z.string().min(1),
  sectionTexts: z.array(JobAdaptationSectionTextSchema),
  appliedSuggestionIds: z.array(z.string().min(1)).default([])
});

export const JobAdaptationDraftSchema = EntityBaseSchema.extend({
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  branchId: z.string().min(1).optional(),
  sourceBranchId: z.string().min(1).optional(),
  sourceRevisionId: z.string().min(1).optional(),
  sourceBranchRevision: z.number().int().min(0).optional(),
  profileVersion: z.number().int().min(1),
  jobVersion: z.string().min(1),
  matcherVersion: z.string().min(1),
  requirementMatchIds: z.array(z.string().min(1)).min(1),
  sourceMatchSetHash: z.string().min(8),
  revision: z.number().int().min(0),
  status: z.enum(["draft", "ai_partial", "ai_completed", "stale_blocked", "error"]),
  appliedSuggestionIds: z.array(z.string().min(1)).default([]),
  sectionTexts: z.array(JobAdaptationSectionTextSchema).default([]),
  snapshots: z.array(JobAdaptationSnapshotSchema).default([]),
  lastGuardedAt: z.string().datetime({ offset: true }).optional(),
  lastAiError: z.string().optional()
});

export const SuggestionOperationSchema = EntityBaseSchema.extend({
  operationId: z.string().min(1),
  draftId: z.string().min(1),
  suggestionId: z.string().optional(),
  type: z.enum(["create_draft", "generate", "accept", "reject", "ignore", "edit", "rerun_guard", "undo"]),
  expectedRevision: z.number().int().min(0),
  beforeRevision: z.number().int().min(0).optional(),
  afterRevision: z.number().int().min(0).optional(),
  snapshotId: z.string().optional(),
  occurredAt: z.string().datetime({ offset: true })
});

export const JobAdaptationBundleSchema = z.object({
  draft: JobAdaptationDraftSchema,
  suggestions: z.array(AiSuggestionSchema).default([])
});

export type JobAdaptationSectionType = z.infer<typeof JobAdaptationSectionTypeSchema>;
export type JobAdaptationSectionText = z.infer<typeof JobAdaptationSectionTextSchema>;
export type JobAdaptationSnapshot = z.infer<typeof JobAdaptationSnapshotSchema>;
export type JobAdaptationDraft = z.infer<typeof JobAdaptationDraftSchema>;
export type SuggestionOperation = z.infer<typeof SuggestionOperationSchema>;
export type JobAdaptationBundle = z.infer<typeof JobAdaptationBundleSchema>;
