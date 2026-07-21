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
export const TailoringClaimClassSchema = z.enum(["verified_rewrite", "reasonable_reframe", "user_confirmable_capability", "unsupported_hard_fact"]);
export const ResumeFieldPathSchema = z.enum(["text", "name", "description", "highlights", "visible", "order"]);
export const ResumeFieldPatchOperationSchema = z.enum(["replace", "append", "remove"]);
const ResumeFieldPatchValueSchema = z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]);
const INTERNAL_FIELD_LABEL = /(?:^|[\s；;])(?:组织|职位\/角色|项目名称|开始日期|结束日期|进行中|亮点)：/;

export const ResumeFieldPatchSchema = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  fieldPath: ResumeFieldPathSchema,
  operation: ResumeFieldPatchOperationSchema,
  before: ResumeFieldPatchValueSchema,
  after: ResumeFieldPatchValueSchema
}).strict().superRefine((patch, context) => {
  const expected = patch.fieldPath === "highlights" ? "array"
    : patch.fieldPath === "visible" ? "boolean"
      : patch.fieldPath === "order" ? "number"
        : "string";
  for (const key of ["before", "after"] as const) {
    const value = patch[key];
    const actual = Array.isArray(value) ? "array" : typeof value;
    if (actual !== expected) context.addIssue({ code: "custom", path: [key], message: `${patch.fieldPath} patch requires ${expected}` });
  }
  const before = Array.isArray(patch.before) ? patch.before.join("\n") : String(patch.before);
  const after = Array.isArray(patch.after) ? patch.after.join("\n") : String(patch.after);
  if (!INTERNAL_FIELD_LABEL.test(before) && INTERNAL_FIELD_LABEL.test(after)) {
    context.addIssue({ code: "custom", path: ["after"], message: "internal field labels cannot be introduced into resume text" });
  }
});

export const ConfirmableClaimSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  claimText: z.string().min(1),
  finalTextByProficiency: z.object({
    proficient: z.string().min(1),
    familiar: z.string().min(1),
    aware: z.string().min(1),
    learning: z.string().min(1)
  }).strict().optional(),
  sourceItemIds: z.array(z.string().min(1)).min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
  targetPatches: z.array(ResumeFieldPatchSchema).min(1),
  claimType: z.enum(["tool", "skill", "workflow", "experience_reframe", "material"])
}).strict();

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

export const ResumeTailorModelSuggestionSchema = z.object({
  after: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  rationale: z.string().min(1),
  requirementIds: z.array(z.string()).optional(),
  targetKeywords: z.array(z.string()).optional(),
  claimSupportLevel: z.enum(["verified", "reasonable_inference", "user_declared"]).optional()
}).passthrough();

export const ResumeTailorModelOutputSchema = z.object({
  suggestions: z.array(ResumeTailorModelSuggestionSchema)
}).passthrough();

export const ResumeTailorBatchInputSchema = z.object({
  draftId: z.string().min(1), profileId: z.string().min(1), jobId: z.string().min(1),
  intensity: TailoringIntensitySchema,
  compactJobContext: z.object({
    title: z.string().min(1), roleMission: z.string().optional(),
    topResponsibilities: z.array(z.string()).max(4), targetKeywords: z.array(z.string()).max(16)
  }).strict(),
  targets: z.array(z.object({
    itemId: z.string().min(1), sectionType: TailoringSectionPolicySchema, sectionId: z.string().min(1), fieldPath: z.string().min(1),
    structuredItem: ResumeItemV2Schema, before: z.union([z.string(), z.array(z.string())]), renderedText: z.string(),
    relevantRequirements: z.array(TailoringRequirementSchema).min(1).max(4),
    allowedEvidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
    allowedFacts: z.array(z.object({ value: z.string().min(1), evidenceRefs: z.array(MatchEvidenceRefSchema).default([]) }).strict()).default([])
  }).strict()).min(1).max(6)
}).strict();

export const ResumeTailorBatchModelOutputSchema = z.object({
  suggestions: z.array(ResumeTailorModelSuggestionSchema.extend({ itemId: z.string().min(1) }).passthrough())
}).passthrough();

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
  label: z.string().min(1).optional(),
  claimText: z.string().min(1).optional(),
  finalTextByProficiency: ConfirmableClaimSchema.shape.finalTextByProficiency,
  sourceItemIds: z.array(z.string().min(1)).optional(),
  targetPatches: z.array(ResumeFieldPatchSchema).min(1).optional(),
  claimType: ConfirmableClaimSchema.shape.claimType.optional(),
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
  resolvedText: z.string().min(1).optional(),
  confirmed: z.boolean().default(false)
}).strict();

export const TailoringClarificationQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).min(1),
  relatedItemIds: z.array(z.string().min(1)).min(1),
  candidateClaim: z.string().min(1),
  targetFieldPaths: z.array(z.string().min(1)).min(1),
  answerType: z.enum(["boolean", "proficiency", "text", "url", "multi_select"])
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
  clarificationQuestions: z.array(TailoringClarificationQuestionSchema).optional(),
  materialSuggestions: z.array(z.string().min(1)).optional(),
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
export type ResumeTailorModelSuggestion = z.infer<typeof ResumeTailorModelSuggestionSchema>;
export type ResumeTailorModelOutput = z.infer<typeof ResumeTailorModelOutputSchema>;
export type ResumeTailorBatchInput = z.infer<typeof ResumeTailorBatchInputSchema>;
export type TailoringSuggestion = z.infer<typeof TailoringSuggestionSchema>;
export type TailoringSection = z.infer<typeof TailoringSectionSchema>;
export type SkillProficiency = z.infer<typeof SkillProficiencySchema>;
export type TailoringClaimClass = z.infer<typeof TailoringClaimClassSchema>;
export type ResumeFieldPatch = z.infer<typeof ResumeFieldPatchSchema>;
export type ConfirmableClaim = z.infer<typeof ConfirmableClaimSchema>;
export type TailoringClaim = z.infer<typeof TailoringClaimSchema>;
export type TailoringClarificationQuestion = z.infer<typeof TailoringClarificationQuestionSchema>;
export type ResumeTailoringPlan = z.infer<typeof ResumeTailoringPlanSchema>;
export type ClaimConfirmation = z.infer<typeof ClaimConfirmationSchema>;

// --- Phase 1: Planner schemas ---
export const ResumeTailorPlannerInputSchema = z.object({
  jobContext: TailoringJobContextSchema,
  requirements: z.array(z.object({
    id: z.string().min(1),
    description: z.string().min(1),
    priority: z.string().min(1),
    category: z.string().min(1),
    keywords: z.array(z.string().min(1)).default([])
  }).strict()),
  sections: z.array(z.object({
    sectionType: z.string().min(1),
    itemId: z.string(),
    currentText: z.string().min(1),
    relevantRequirementIds: z.array(z.string().min(1)).default([])
  }).strict())
}).strict();

export const ResumeTailorPlannerOutputSchema = z.object({
  assessments: z.array(z.object({
    itemId: z.string().min(1),
    action: z.enum(["keep", "rewrite_from_evidence", "propose_confirmable_claim", "ask_user", "hide_or_deprioritize"]),
    reason: z.string().min(1),
    suggestedKeywords: z.array(z.string().min(1)).default([]),
    relatedRequirementIds: z.array(z.string().min(1)).default([]),
    clarificationQuestions: z.array(z.string().min(1)).default([])
  }).strict()),
  globalNotes: z.string().optional()
}).strict();

export type ResumeTailorPlannerInput = z.infer<typeof ResumeTailorPlannerInputSchema>;
export type ResumeTailorPlannerOutput = z.infer<typeof ResumeTailorPlannerOutputSchema>;
