import { z } from "zod";
import { EntityBaseSchema, FactProvenanceSchema } from "./common";
import { ResumeSectionTypeV2Schema } from "./resumeV2";

export const ProfileReconciliationStateSchema = z.enum([
  "exact_duplicate",
  "evidence_extension",
  "compatible_update",
  "likely_duplicate",
  "conflict",
  "new_fact",
  "keep_separate"
]);

export const ProfileReconciliationResolutionSchema = z.enum([
  "keep_existing",
  "use_imported",
  "keep_both_as_distinct",
  "edit_value",
  "defer"
]);

export const ProfileReconciliationEntityTypeSchema = z.union([
  z.literal("basic"),
  ResumeSectionTypeV2Schema
]);

export const ProfileReconciliationFieldRelationSchema = z.enum([
  "equal",
  "equivalent",
  "missing_existing",
  "missing_incoming",
  "different",
  "conflicting"
]);

export const ProfileReconciliationFieldComparisonSchema = z.object({
  field: z.string().min(1),
  existingValue: z.string().optional(),
  incomingValue: z.string().optional(),
  relation: ProfileReconciliationFieldRelationSchema,
  authoritative: z.boolean()
}).strict();

export const ProfileReconciliationCandidateSchema = z.object({
  incomingItemId: z.string().min(1),
  sourceItemId: z.string().min(1),
  entityType: ProfileReconciliationEntityTypeSchema,
  displayLabel: z.string().min(1),
  canonicalKey: z.string().min(1),
  normalizedFields: z.record(z.string(), z.string()),
  factStatements: z.array(z.string().min(1)).default([]),
  sourceBlockIds: z.array(z.string().min(1)).default([]),
  sourceProvenance: z.array(FactProvenanceSchema).default([])
}).strict();

export const ProfileReconciliationDecisionSchema = z.object({
  incomingItemId: z.string().min(1),
  state: ProfileReconciliationStateSchema,
  existingEntityId: z.string().min(1).optional(),
  existingStructuredItemId: z.string().min(1).optional(),
  existingFactIds: z.array(z.string().min(1)).default([]),
  confidence: z.number().min(0).max(1),
  reasonCode: z.enum([
    "exact_canonical_identity",
    "same_fact_new_evidence",
    "same_source_already_represented",
    "structured_identity_match",
    "compatible_missing_fields",
    "near_identity_match",
    "authoritative_field_conflict",
    "no_safe_match",
    "user_keep_separate"
  ]),
  fieldComparisons: z.array(ProfileReconciliationFieldComparisonSchema).default([]),
  sourceProvenance: z.array(FactProvenanceSchema).default([]),
  requiresUserConfirmation: z.boolean(),
  conflictId: z.string().min(1).optional(),
  resolution: ProfileReconciliationResolutionSchema.optional(),
  editedValue: z.string().min(1).optional()
}).strict().superRefine((decision, context) => {
  if (decision.resolution === "edit_value" && !decision.editedValue) {
    context.addIssue({
      code: "custom",
      path: ["editedValue"],
      message: "edit_value requires editedValue"
    });
  }
});

export const ProfileReconciliationConflictSchema = z.object({
  id: z.string().min(1),
  incomingItemId: z.string().min(1),
  existingEntityId: z.string().min(1),
  fields: z.array(ProfileReconciliationFieldComparisonSchema)
    .min(1),
  supportedResolutions: z.array(ProfileReconciliationResolutionSchema).min(1),
  resolution: ProfileReconciliationResolutionSchema.optional(),
  editedValue: z.string().min(1).optional()
}).strict();

export const ProfileReconciliationReviewUnitSchema = z.object({
  id: z.string().min(1),
  incomingItemId: z.string().min(1),
  kind: z.enum(["likely_duplicate", "conflict", "unclassified"]),
  conflictId: z.string().min(1).optional(),
  resolved: z.boolean()
}).strict();

export const ProfileReconciliationSummarySchema = z.object({
  newFacts: z.number().int().min(0),
  existing: z.number().int().min(0),
  mergedEvidence: z.number().int().min(0),
  compatibleUpdates: z.number().int().min(0),
  likelyDuplicates: z.number().int().min(0),
  conflicts: z.number().int().min(0),
  unclassified: z.number().int().min(0),
  requiresReview: z.number().int().min(0)
}).strict();

export const ProfileReconciliationPlanSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("profile-reconciliation-v1"),
  importId: z.string().min(1),
  draftRevision: z.number().int().min(0),
  profileId: z.string().min(1),
  profileVersion: z.number().int().min(1),
  revision: z.number().int().min(0),
  status: z.enum(["ready", "needs_review", "resolved", "committed", "stale"]),
  sourceFileHash: z.string().min(1),
  sourceContentHash: z.string().min(1).optional(),
  candidates: z.array(ProfileReconciliationCandidateSchema),
  decisions: z.array(ProfileReconciliationDecisionSchema),
  conflicts: z.array(ProfileReconciliationConflictSchema),
  reviewUnits: z.array(ProfileReconciliationReviewUnitSchema),
  summary: ProfileReconciliationSummarySchema
}).strict().superRefine((plan, context) => {
  const candidateIds = new Set(plan.candidates.map((candidate) => candidate.incomingItemId));
  const decisionIds = plan.decisions.map((decision) => decision.incomingItemId);
  if (decisionIds.length !== candidateIds.size || decisionIds.some((id) => !candidateIds.has(id))) {
    context.addIssue({
      code: "custom",
      path: ["decisions"],
      message: "every reconciliation candidate must have exactly one decision"
    });
  }
  if (new Set(decisionIds).size !== decisionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["decisions"],
      message: "reconciliation decisions must be unique by incomingItemId"
    });
  }
  const unresolved = plan.reviewUnits.filter((unit) => !unit.resolved).length;
  if (plan.summary.requiresReview !== unresolved) {
    context.addIssue({
      code: "custom",
      path: ["summary", "requiresReview"],
      message: "requiresReview must equal unresolved review units"
    });
  }
});

export type ProfileReconciliationState = z.infer<typeof ProfileReconciliationStateSchema>;
export type ProfileReconciliationResolution = z.infer<typeof ProfileReconciliationResolutionSchema>;
export type ProfileReconciliationFieldRelation = z.infer<typeof ProfileReconciliationFieldRelationSchema>;
export type ProfileReconciliationCandidate = z.infer<typeof ProfileReconciliationCandidateSchema>;
export type ProfileReconciliationDecision = z.infer<typeof ProfileReconciliationDecisionSchema>;
export type ProfileReconciliationConflict = z.infer<typeof ProfileReconciliationConflictSchema>;
export type ProfileReconciliationReviewUnit = z.infer<typeof ProfileReconciliationReviewUnitSchema>;
export type ProfileReconciliationSummary = z.infer<typeof ProfileReconciliationSummarySchema>;
export type ProfileReconciliationPlan = z.infer<typeof ProfileReconciliationPlanSchema>;
