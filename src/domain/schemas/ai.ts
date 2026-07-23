import { z } from "zod";
import { EntityBaseSchema, RiskLevelSchema } from "./common";
import { MatchEvidenceRefSchema } from "./job";
import { TailoringSuggestionSchema } from "./tailoring";

export const AiTaskSchema = z.enum([
  "health-check",
  "profile-builder",
  "resume-json-mapper",
  "resume-document-mapper",
  "jd-analyzer",
  "evidence-matcher",
  "resume-tailor",
  "resume-tailor-batch",
  "resume-tailor-diff",
  "resume-optimization-planner",
  "fact-guard"
]);

export const AiSuggestionTypeSchema = z.enum([
  "rewrite",
  "compress",
  "prioritize",
  "remove_irrelevant",
  "remove_or_shorten",
  "reorder",
  "hide",
  "show",
  "risk_warning",
  "follow_up_question"
]);

export const AiSuggestionStatusSchema = z.enum([
  "pending_review",
  "accepted",
  "rejected",
  "edited_pending_guard",
  "edited_guarded",
  "blocked_high_risk",
  "stale_blocked",
  "ignored",
  "undone"
]);

export const FactGuardFindingTypeSchema = z.enum([
  "new_number",
  "new_school",
  "new_org",
  "new_company",
  "new_role",
  "new_tool",
  "new_skill",
  "new_award",
  "new_certificate",
  "new_outcome",
  "participation_to_owner",
  "assist_to_independent",
  "know_to_proficient",
  "team_to_individual"
]);

export const FactGuardFindingSchema = z.object({
  type: FactGuardFindingTypeSchema,
  text: z.string().min(1),
  severity: RiskLevelSchema,
  allowed: z.boolean(),
  evidenceRefKey: z.string().optional(),
  message: z.string().min(1)
});

export const FactGuardAiReviewSchema = z.object({
  status: z.enum(["pass", "needs_edit", "blocked_high_risk"]),
  riskLevel: RiskLevelSchema,
  findings: z.array(FactGuardFindingSchema).default([]),
  explanation: z.string().min(1),
  safeRewriteSuggestion: z.string().optional()
});

export const FactGuardResultSchema = z.object({
  status: z.enum(["pass", "needs_edit", "blocked_high_risk", "ai_failed_rule_kept"]),
  ruleFindings: z.array(FactGuardFindingSchema).default([]),
  aiReview: FactGuardAiReviewSchema.optional(),
  riskLevel: RiskLevelSchema,
  allowedEvidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  checkedText: z.string().min(1),
  checkedAt: z.string().datetime({ offset: true }),
  guardVersion: z.string().min(1)
});

export const AiSuggestionSchema = EntityBaseSchema.extend({
  draftId: z.string().min(1),
  targetSectionId: z.string().min(1),
  targetContentItemId: z.string().min(1).optional(),
  // Optional for historical suggestions; every newly generated suggestion binds
  // to a canonical field and an addressable item path.
  targetFieldId: z.string().min(1).optional(),
  targetFieldPath: z.string().min(1).optional(),
  branchId: z.string().min(1).optional(),
  basedOnBranchRevision: z.number().int().min(0).optional(),
  basedOnRevisionId: z.string().min(1).optional(),
  originalTextHash: z.string().min(8).optional(),
  requirementsHash: z.string().min(8).optional(),
  evidenceQuotes: z.array(z.string()).optional(),
  guardPreview: z.object({
    allowed: z.boolean(),
    reasons: z.array(z.string()).default([])
  }).optional(),
  type: AiSuggestionTypeSchema,
  originalText: z.string().min(1),
  suggestedText: z.string().min(1),
  reason: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  usedEvidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  guardResult: FactGuardResultSchema,
  riskLevel: RiskLevelSchema,
  status: AiSuggestionStatusSchema,
  editedText: z.string().optional(),
  promptVersion: z.string().min(1)
});

export const ResumeTailorSuggestionItemSchema = TailoringSuggestionSchema;

export const ResumeTailorOutputSchema = z.object({
  suggestions: z.array(ResumeTailorSuggestionItemSchema).default([])
});

export const FactGuardOutputSchema = FactGuardAiReviewSchema;

export const AiLogStatusSchema = z.enum(["success", "validation_failed", "provider_failed"]);

export const AiLogSchema = EntityBaseSchema.extend({
  task: AiTaskSchema,
  provider: z.string().min(1),
  model: z.string().optional(),
  promptVersion: z.string().min(1),
  inputHash: z.string().optional(),
  inputLength: z.number().int().min(0).optional(),
  outputLength: z.number().int().min(0).optional(),
  latencyMs: z.number().int().min(0).optional(),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  status: AiLogStatusSchema,
  error: z.string().optional(),
  errorCode: z.string().optional()
});

export const AiHealthCheckSchema = z.object({
  status: z.literal("ok"),
  provider: z.string().min(1),
  checkedAt: z.string().datetime({ offset: true })
});

export type AiTask = z.infer<typeof AiTaskSchema>;
export type AiSuggestionType = z.infer<typeof AiSuggestionTypeSchema>;
export type AiSuggestionStatus = z.infer<typeof AiSuggestionStatusSchema>;
export type FactGuardFindingType = z.infer<typeof FactGuardFindingTypeSchema>;
export type FactGuardFinding = z.infer<typeof FactGuardFindingSchema>;
export type FactGuardAiReview = z.infer<typeof FactGuardAiReviewSchema>;
export type FactGuardResult = z.infer<typeof FactGuardResultSchema>;
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
export type ResumeTailorSuggestionItem = z.infer<typeof ResumeTailorSuggestionItemSchema>;
export type ResumeTailorOutput = z.infer<typeof ResumeTailorOutputSchema>;
export type FactGuardOutput = z.infer<typeof FactGuardOutputSchema>;
export type AiLogStatus = z.infer<typeof AiLogStatusSchema>;
export type AiLog = z.infer<typeof AiLogSchema>;
export type AiHealthCheck = z.infer<typeof AiHealthCheckSchema>;
