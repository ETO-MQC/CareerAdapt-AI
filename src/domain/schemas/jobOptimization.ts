import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, RiskLevelSchema } from "./common";
import { MatchEvidenceRefSchema } from "./job";

export const RequirementBlockMatchLevelSchema = z.enum(["strong", "partial", "weak", "none", "needs_confirmation"]);
export const RequirementBlockMatchSourceSchema = z.enum(["deterministic", "ai_assisted", "user_confirmed"]);
export const RequirementCoverageStatusSchema = z.enum(["covered", "partial", "weak", "uncovered", "needs_confirmation"]);
export const ResumeBlockSuggestionKindSchema = z.enum([
  "rewrite",
  "compress",
  "prioritize",
  "remove_irrelevant",
  "reorder",
  "hide",
  "show"
]);

export const RequirementBlockMatchSchema = EntityBaseSchema.extend({
  jobId: z.string().min(1),
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  currentRevisionId: z.string().min(1),
  requirementsHash: z.string().min(8),
  requirementId: z.string().min(1),
  contentItemId: z.string().min(1).optional(),
  matchLevel: RequirementBlockMatchLevelSchema,
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  evidenceFactIds: z.array(z.string().min(1)).default([]),
  evidenceQuotes: z.array(z.string()).default([]),
  reason: z.string().min(1),
  source: RequirementBlockMatchSourceSchema,
  isStale: z.boolean().default(false),
  createdAt: IsoDateStringSchema,
  updatedAt: IsoDateStringSchema
});

export const RequirementCoverageSummarySchema = z.object({
  requirementId: z.string().min(1),
  coverageStatus: RequirementCoverageStatusSchema,
  bestMatchLevel: RequirementBlockMatchLevelSchema,
  matchedContentItemIds: z.array(z.string().min(1)).default([]),
  evidenceCount: z.number().int().min(0),
  hasFactGap: z.boolean(),
  reasons: z.array(z.string()).default([])
});

export const JobOptimizationSummarySchema = z.object({
  jobId: z.string().min(1),
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  currentRevisionId: z.string().min(1),
  requirementsHash: z.string().min(8),
  totalRequirements: z.number().int().min(0),
  strong: z.number().int().min(0),
  partial: z.number().int().min(0),
  weak: z.number().int().min(0),
  none: z.number().int().min(0),
  needsConfirmation: z.number().int().min(0),
  generatedSuggestions: z.number().int().min(0).default(0),
  pendingSuggestions: z.number().int().min(0).default(0),
  acceptedSuggestions: z.number().int().min(0).default(0),
  rejectedSuggestions: z.number().int().min(0).default(0),
  staleSuggestions: z.number().int().min(0).default(0),
  blockedSuggestions: z.number().int().min(0).default(0)
});

export const ResumeBlockSuggestionPreviewSchema = EntityBaseSchema.extend({
  jobId: z.string().min(1),
  branchId: z.string().min(1),
  basedOnBranchRevision: z.number().int().min(0),
  basedOnRevisionId: z.string().min(1),
  requirementsHash: z.string().min(8),
  requirementIds: z.array(z.string().min(1)).min(1),
  contentItemId: z.string().min(1),
  originalText: z.string().min(1),
  originalTextHash: z.string().min(8),
  suggestedText: z.string().min(1),
  suggestionKind: ResumeBlockSuggestionKindSchema,
  rationale: z.string().min(1),
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  evidenceFactIds: z.array(z.string().min(1)).default([]),
  evidenceQuotes: z.array(z.string()).default([]),
  riskLevel: RiskLevelSchema,
  guardPreview: z.object({
    allowed: z.boolean(),
    reasons: z.array(z.string()).default([])
  }),
  status: z.enum(["pending", "accepted", "rejected", "ignored", "stale", "blocked"]),
  generatedAt: IsoDateStringSchema,
  decidedAt: IsoDateStringSchema.optional()
});

export type RequirementBlockMatchLevel = z.infer<typeof RequirementBlockMatchLevelSchema>;
export type RequirementBlockMatchSource = z.infer<typeof RequirementBlockMatchSourceSchema>;
export type RequirementCoverageStatus = z.infer<typeof RequirementCoverageStatusSchema>;
export type RequirementBlockMatch = z.infer<typeof RequirementBlockMatchSchema>;
export type RequirementCoverageSummary = z.infer<typeof RequirementCoverageSummarySchema>;
export type JobOptimizationSummary = z.infer<typeof JobOptimizationSummarySchema>;
export type ResumeBlockSuggestionKind = z.infer<typeof ResumeBlockSuggestionKindSchema>;
export type ResumeBlockSuggestionPreview = z.infer<typeof ResumeBlockSuggestionPreviewSchema>;
