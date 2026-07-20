import { z } from "zod";
import { MatchEvidenceRefSchema } from "./job";
import { ResumeItemV2Schema } from "./resumeV2";

export const ClaimSupportLevelSchema = z.enum([
  "verified",
  "reasonable_inference",
  "user_declared",
  "unsupported_hard_fact"
]);
export const ClaimDecisionSchema = z.enum(["auto_applicable", "requires_confirmation", "blocked"]);
export const ClaimSyncScopeSchema = z.enum(["resume_only", "resume_and_profile", "rejected"]);
export const TailoringIntensitySchema = z.enum(["conservative", "balanced", "proactive"]);
export const TailoringSectionPolicySchema = z.enum(["summary", "skills", "project", "work", "internship", "ordering"]);
export const TailoringOperationSchema = z.enum(["rewrite", "replace", "add", "remove", "hide", "reorder"]);
export const TailoringSuggestionStatusSchema = z.enum(["ready", "requires_confirmation", "blocked", "no_change_needed"]);
export const TailoringSectionSchema = z.enum([
  "summary", "skills", "project", "work", "internship", "education", "awards", "certificates", "publications", "patents", "ordering"
]);
export const SkillProficiencySchema = z.enum(["proficient", "familiar", "aware", "learning"]);

export const TailoringRequirementSchema = z.object({
  requirementId: z.string().min(1),
  description: z.string().min(1),
  priority: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  relevanceScore: z.number().min(0)
}).strict();

export const TailoringJobContextSchema = z.object({
  title: z.string().min(1),
  company: z.string().optional(),
  rawText: z.string().min(1),
  roleMission: z.string().optional(),
  responsibilities: z.array(z.string()).default([]),
  mustHave: z.array(z.string()).default([]),
  niceToHave: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([])
}).strict();

export const ResumeTailorTaskInputV2Schema = z.object({
  draftId: z.string().min(1),
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  intensity: TailoringIntensitySchema,
  jobContext: TailoringJobContextSchema,
  target: z.object({
    sectionType: TailoringSectionPolicySchema,
    sectionId: z.string().min(1),
    itemId: z.string().min(1).optional(),
    fieldPath: z.string().min(1)
  }).strict(),
  currentContent: z.object({
    structuredItem: ResumeItemV2Schema,
    fieldValue: z.union([z.string(), z.array(z.string())]),
    renderedText: z.string()
  }).strict(),
  relevantRequirements: z.array(TailoringRequirementSchema).min(1).max(4),
  allowedEvidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  allowedFacts: z.array(z.object({
    value: z.string().min(1),
    evidenceRefs: z.array(MatchEvidenceRefSchema).default([])
  }).strict()).default([]),
  retryContext: z.object({ previousWasNoOp: z.literal(true) }).optional()
}).strict();

export const TailoringSuggestionSchema = z.object({
  id: z.string().min(1),
  intensity: TailoringIntensitySchema,
  operation: TailoringOperationSchema,
  targetSectionType: TailoringSectionPolicySchema,
  targetSectionId: z.string().min(1),
  targetItemId: z.string().min(1).optional(),
  targetFieldPath: z.string().min(1),
  before: z.union([z.string(), z.array(z.string())]),
  after: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  changedFields: z.array(z.string().min(1)).min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
  targetKeywords: z.array(z.string().min(1)).default([]),
  coveredKeywordsBefore: z.array(z.string().min(1)).default([]),
  coveredKeywordsAfter: z.array(z.string().min(1)).default([]),
  claimSupportLevel: ClaimSupportLevelSchema,
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  rationale: z.string().min(1),
  riskLevel: z.enum(["low", "medium", "high"]),
  metrics: z.object({ textChangeRatio: z.number().min(0).max(1), keywordGain: z.number().int().min(0) }).strict(),
  status: TailoringSuggestionStatusSchema
}).strict();

export const TailoringClaimSchema = z.object({
  id: z.string().min(1),
  section: TailoringSectionSchema,
  targetContentItemId: z.string().min(1).optional(),
  targetFieldPath: z.string().min(1).optional(),
  currentText: z.string().default(""),
  proposedText: z.string().min(1),
  reason: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
  requirementIds: z.array(z.string().min(1)).optional(),
  supportLevel: ClaimSupportLevelSchema,
  decision: ClaimDecisionSchema,
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  syncScope: ClaimSyncScopeSchema.default("resume_only"),
  proficiency: SkillProficiencySchema.optional(),
  confirmed: z.boolean().default(false)
}).strict();

export const ResumeTailoringPlanSchema = z.object({
  id: z.string().min(1),
  branchId: z.string().min(1),
  jobId: z.string().min(1),
  intensity: TailoringIntensitySchema,
  promptVersion: z.string().min(1).optional(),
  jobContext: TailoringJobContextSchema.optional(),
  basedOnBranchRevision: z.number().int().min(0),
  claims: z.array(TailoringClaimSchema),
  suggestions: z.array(TailoringSuggestionSchema).optional(),
  invalidOutputCodes: z.array(z.enum(["invalid_ai_output", "no_change_needed"])).optional(),
  estimatedFitScore: z.number().min(0).max(100),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const ClaimConfirmationSchema = z.object({
  claimId: z.string().min(1),
  accepted: z.boolean(),
  syncScope: ClaimSyncScopeSchema.default("resume_only"),
  proficiency: SkillProficiencySchema.optional(),
  editedText: z.string().min(1).optional()
}).strict();

export type ClaimSupportLevel = z.infer<typeof ClaimSupportLevelSchema>;
export type ClaimDecision = z.infer<typeof ClaimDecisionSchema>;
export type ClaimSyncScope = z.infer<typeof ClaimSyncScopeSchema>;
export type TailoringIntensity = z.infer<typeof TailoringIntensitySchema>;
export type TailoringSectionPolicy = z.infer<typeof TailoringSectionPolicySchema>;
export type TailoringOperation = z.infer<typeof TailoringOperationSchema>;
export type TailoringSuggestionStatus = z.infer<typeof TailoringSuggestionStatusSchema>;
export type TailoringRequirement = z.infer<typeof TailoringRequirementSchema>;
export type TailoringJobContext = z.infer<typeof TailoringJobContextSchema>;
export type ResumeTailorTaskInputV2 = z.infer<typeof ResumeTailorTaskInputV2Schema>;
export type TailoringSuggestion = z.infer<typeof TailoringSuggestionSchema>;
export type TailoringSection = z.infer<typeof TailoringSectionSchema>;
export type SkillProficiency = z.infer<typeof SkillProficiencySchema>;
export type TailoringClaim = z.infer<typeof TailoringClaimSchema>;
export type ResumeTailoringPlan = z.infer<typeof ResumeTailoringPlanSchema>;
export type ClaimConfirmation = z.infer<typeof ClaimConfirmationSchema>;
