import { z } from "zod";
import { MatchEvidenceRefSchema } from "./job";

export const ClaimSupportLevelSchema = z.enum([
  "verified",
  "reasonable_inference",
  "user_declared",
  "unsupported_hard_fact"
]);
export const ClaimDecisionSchema = z.enum(["auto_applicable", "requires_confirmation", "blocked"]);
export const ClaimSyncScopeSchema = z.enum(["resume_only", "resume_and_profile", "rejected"]);
export const TailoringIntensitySchema = z.enum(["conservative", "balanced", "proactive"]);
export const TailoringSectionSchema = z.enum([
  "summary", "skills", "project", "work", "internship", "education", "awards", "certificates", "publications", "patents", "ordering"
]);
export const SkillProficiencySchema = z.enum(["proficient", "familiar", "aware", "learning"]);

export const TailoringClaimSchema = z.object({
  id: z.string().min(1),
  section: TailoringSectionSchema,
  targetContentItemId: z.string().min(1).optional(),
  currentText: z.string().default(""),
  proposedText: z.string().min(1),
  reason: z.string().min(1),
  keywords: z.array(z.string().min(1)).default([]),
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
  basedOnBranchRevision: z.number().int().min(0),
  claims: z.array(TailoringClaimSchema),
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
export type TailoringSection = z.infer<typeof TailoringSectionSchema>;
export type SkillProficiency = z.infer<typeof SkillProficiencySchema>;
export type TailoringClaim = z.infer<typeof TailoringClaimSchema>;
export type ResumeTailoringPlan = z.infer<typeof ResumeTailoringPlanSchema>;
export type ClaimConfirmation = z.infer<typeof ClaimConfirmationSchema>;
