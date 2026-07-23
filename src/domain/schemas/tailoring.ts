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
export const TailoringActionSchema = z.enum(["verified_rewrite", "confirmable_rewrite", "clarification_required", "material_task", "keep", "deprioritize"]);
export const TailoringSectionPolicySchema = z.enum(["summary", "skills", "project", "work", "internship", "ordering"]);
export const TailoringOperationSchema = z.enum(["rewrite", "replace", "add", "remove", "hide", "reorder"]);
export const TailoringSuggestionStatusSchema = z.enum(["ready", "requires_confirmation", "blocked", "no_change_needed"]);
export const TailoringSectionSchema = z.enum([
  "summary", "skills", "project", "work", "internship", "education", "awards", "certificates", "publications", "patents", "ordering"
]);
export const SkillProficiencySchema = z.enum(["proficient", "familiar", "aware", "learning"]);
export const CapabilityEntityTypeSchema = z.enum([
  "tool", "model", "skill", "workflow", "platform", "company", "domain", "material", "unknown"
]);
export const CapabilityEntitySourceSchema = z.enum([
  "job_title", "job_company", "requirement", "keyword", "user_answer"
]);
export const CapabilityEntitySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  normalizedLabel: z.string().min(1),
  type: CapabilityEntityTypeSchema,
  source: CapabilityEntitySourceSchema
}).strict();
export const TailoringTargetPolicySchema = z.enum([
  "summary_once", "skill_once", "specific_item", "material_only"
]);
export const TailoringClaimClassSchema = z.enum(["verified_rewrite", "reasonable_reframe", "user_confirmable_capability", "unsupported_hard_fact"]);
export const ResumeFieldPathSchema = z.enum(["text", "name", "description", "highlights", "visible", "order"]);
export const ResumeFieldPatchOperationSchema = z.enum(["replace", "append", "remove"]);
const ResumeFieldPatchValueSchema = z.union([z.string(), z.array(z.string()), z.boolean(), z.number()]);
const INTERNAL_FIELD_LABEL = /(?:^|[\s；;])(?:组织|职位\/角色|项目名称|开始日期|结束日期|进行中|亮点)：/;

export const ResumeFieldPatchSchema = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  fieldPath: ResumeFieldPathSchema,
  targetIndex: z.number().int().min(0).optional(),
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
  if (patch.targetIndex !== undefined && patch.fieldPath !== "highlights") {
    context.addIssue({ code: "custom", path: ["targetIndex"], message: "targetIndex is only valid for highlights" });
  }
  if (!INTERNAL_FIELD_LABEL.test(before) && INTERNAL_FIELD_LABEL.test(after)) {
    context.addIssue({ code: "custom", path: ["after"], message: "internal field labels cannot be introduced into resume text" });
  }
});

export const ResumeTailoringDiffSchema = z.object({
  target: z.object({
    sectionId: z.string().min(1),
    itemId: z.string().min(1),
    fieldPath: ResumeFieldPathSchema
  }).strict(),
  operation: z.enum(["replace", "reorder", "append", "hide"]),
  original: ResumeFieldPatchValueSchema,
  value: ResumeFieldPatchValueSchema,
  reason: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  targetKeywords: z.array(z.string().min(1)).default([]),
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  supportLevel: z.enum(["verified", "reasonable_inference", "user_declared"])
}).strict();

export const TailoringDiffRejectionReasonSchema = z.enum([
  "target_not_found",
  "path_not_allowed",
  "original_mismatch",
  "blocked_identity_path",
  "invalid_value_type",
  "empty_value",
  "no_op",
  "truncated_output",
  "mechanical_prefix",
  "duplicate_original",
  "invented_metric",
  "responsibility_upgrade",
  "insufficient_evidence",
  "confirmation_required",
  "reorder_membership_changed",
  "append_not_allowed",
  "hide_not_allowed",
  "duplicate_sentence",
  "platform_as_skill",
  "company_as_skill",
  "generic_proficiency_sentence",
  "malformed_chinese_phrase",
  "repeated_claim_target",
  "original_snapshot_mismatch",
  "empty_revision",
  "unsupported_metric",
  "identity_field_changed"
]);

export const TailoringGapSchema = z.object({
  requirementId: z.string().min(1),
  status: z.enum(["covered", "rewriteable", "confirmable", "material_only", "not_applicable", "uncovered"]),
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  candidateItemIds: z.array(z.string().min(1)).default([]),
  missingKeywords: z.array(z.string().min(1)).default([]),
  clarificationQuestionIds: z.array(z.string().min(1)).default([])
}).strict();

export const ClarificationAnswerRecordSchema = z.object({
  questionId: z.string().min(1),
  status: z.enum(["accepted", "rejected", "skipped"]),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]).optional(),
  proficiency: SkillProficiencySchema.optional(),
  resolvedAt: z.string().datetime({ offset: true })
}).strict();

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
  verificationMaterials: z.array(z.string()).optional(),
  hiringSignals: z.array(z.string()).optional(),
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
  evidenceBundle: z.object({
    directEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
    relatedResumeEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
    relatedProfileEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
    confirmableSignals: z.array(z.string())
  }).optional(),
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

export const ResumeTailoringDiffTaskInputSchema = ResumeTailorTaskInputV2Schema.extend({
  target: ResumeTailorTaskInputV2Schema.shape.target.extend({
    fieldPath: ResumeFieldPathSchema
  }).strict(),
  allowedOperation: z.enum(["replace", "reorder", "append", "hide"]),
  requirementDetails: z.record(z.string(), z.array(z.string())).default({})
}).strict();

export const ResumeTailoringDiffModelOutputSchema = z.object({
  diffs: z.array(ResumeTailoringDiffSchema).max(1),
  clarifications: z.array(z.object({
    question: z.string().min(1),
    requirementIds: z.array(z.string().min(1)).min(1),
    answerType: z.enum(["boolean", "proficiency", "multi_select", "text", "url"])
  }).strict()).default([])
}).strict();

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
    currentSectionContext: z.array(z.string()).optional(),
    evidenceBundle: z.object({
      directEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
      relatedResumeEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
      relatedProfileEvidence: z.array(z.object({ value: z.string(), evidenceRefs: z.array(MatchEvidenceRefSchema) })),
      confirmableSignals: z.array(z.string())
    }).optional(),
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
  targetPolicy: TailoringTargetPolicySchema.optional(),
  capability: CapabilityEntitySchema.optional(),
  baseRevisionId: z.string().min(1).optional(),
  originalValue: ResumeFieldPatchValueSchema.optional(),
  originalValueHash: z.string().min(8).optional(),
  suggestedValue: ResumeFieldPatchValueSchema.optional(),
  resolvedValue: ResumeFieldPatchValueSchema.optional(),
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
  groupId: z.string().min(1).optional(),
  sourceItemIds: z.array(z.string().min(1)).min(1),
  relatedItemIds: z.array(z.string().min(1)).min(1),
  candidateClaim: z.string().min(1),
  targetFieldPaths: z.array(z.string().min(1)).min(1),
  capability: CapabilityEntitySchema.optional(),
  targetPolicy: TailoringTargetPolicySchema.optional(),
  answerType: z.enum(["boolean", "proficiency", "text", "url", "multi_select"])
}).strict().transform((question) => ({
  ...question,
  answerType: question.answerType === "proficiency"
    && !["tool", "model", "skill", "workflow"].includes(question.capability?.type ?? "")
      ? "text" as const
      : question.answerType
}));

export const ResumeTailoringPlanSchema = z.object({
  id: z.string().min(1),
  branchId: z.string().min(1),
  jobId: z.string().min(1),
  intensity: TailoringIntensitySchema,
  promptVersion: z.string().min(1).optional(),
  jobContext: TailoringJobContextSchema.optional(),
  basedOnBranchRevision: z.number().int().min(0),
  basedOnRevisionId: z.string().min(1).optional(),
  claims: z.array(TailoringClaimSchema),
  plannerActions: z.array(z.object({
    itemId: z.string().min(1), action: TailoringActionSchema, reason: z.string().min(1),
    suggestedKeywords: z.array(z.string()).default([]), requirementIds: z.array(z.string()).default([]),
    clarificationQuestionIds: z.array(z.string()).default([])
  }).strict()).optional(),
  clarificationQuestions: z.array(TailoringClarificationQuestionSchema).optional(),
  clarificationAnswers: z.array(ClarificationAnswerRecordSchema).optional(),
  gaps: z.array(TailoringGapSchema).optional(),
  diffs: z.array(ResumeTailoringDiffSchema).optional(),
  materialSuggestions: z.array(z.string().min(1)).optional(),
  materialTasks: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), requirementIds: z.array(z.string()).default([]) }).strict()).optional(),
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
export type TailoringAction = z.infer<typeof TailoringActionSchema>;
export type TailoringSectionPolicy = z.infer<typeof TailoringSectionPolicySchema>;
export type TailoringOperation = z.infer<typeof TailoringOperationSchema>;
export type TailoringSuggestionStatus = z.infer<typeof TailoringSuggestionStatusSchema>;
export type TailoringRequirement = z.infer<typeof TailoringRequirementSchema>;
export type TailoringJobContext = z.infer<typeof TailoringJobContextSchema>;
export type ResumeTailorTaskInputV2 = z.infer<typeof ResumeTailorTaskInputV2Schema>;
export type ResumeTailorModelSuggestion = z.infer<typeof ResumeTailorModelSuggestionSchema>;
export type ResumeTailorModelOutput = z.infer<typeof ResumeTailorModelOutputSchema>;
export type ResumeTailoringDiffTaskInput = z.infer<typeof ResumeTailoringDiffTaskInputSchema>;
export type ResumeTailoringDiffModelOutput = z.infer<typeof ResumeTailoringDiffModelOutputSchema>;
export type ResumeTailorBatchInput = z.infer<typeof ResumeTailorBatchInputSchema>;
export type TailoringSuggestion = z.infer<typeof TailoringSuggestionSchema>;
export type TailoringSection = z.infer<typeof TailoringSectionSchema>;
export type SkillProficiency = z.infer<typeof SkillProficiencySchema>;
export type CapabilityEntityType = z.infer<typeof CapabilityEntityTypeSchema>;
export type CapabilityEntitySource = z.infer<typeof CapabilityEntitySourceSchema>;
export type CapabilityEntity = z.infer<typeof CapabilityEntitySchema>;
export type TailoringTargetPolicy = z.infer<typeof TailoringTargetPolicySchema>;
export type TailoringClaimClass = z.infer<typeof TailoringClaimClassSchema>;
export type ResumeFieldPatch = z.infer<typeof ResumeFieldPatchSchema>;
export type ResumeTailoringDiff = z.infer<typeof ResumeTailoringDiffSchema>;
export type TailoringDiffRejectionReason = z.infer<typeof TailoringDiffRejectionReasonSchema>;
export type TailoringGap = z.infer<typeof TailoringGapSchema>;
export type ClarificationAnswerRecord = z.infer<typeof ClarificationAnswerRecordSchema>;
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
    action: z.preprocess((value) => ({ rewrite_from_evidence: "verified_rewrite", propose_confirmable_claim: "confirmable_rewrite", ask_user: "clarification_required", hide_or_deprioritize: "deprioritize" }[String(value)] ?? value), TailoringActionSchema),
    reason: z.string().min(1),
    suggestedKeywords: z.array(z.string().min(1)).default([]),
    relatedRequirementIds: z.array(z.string().min(1)).default([]),
    clarificationQuestions: z.array(z.string().min(1)).default([])
  }).strict()),
  globalNotes: z.string().optional()
}).strict();

export type ResumeTailorPlannerInput = z.infer<typeof ResumeTailorPlannerInputSchema>;
export type ResumeTailorPlannerOutput = z.infer<typeof ResumeTailorPlannerOutputSchema>;
