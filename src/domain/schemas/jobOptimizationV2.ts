import { z } from "zod";
import { BranchFactRefSchema } from "./branch";
import { IsoDateStringSchema, SourceSpanSchema } from "./common";
import { MatchEvidenceRefSchema, MatchRiskSchema } from "./job";
import { ResumeSectionTypeV2Schema } from "./resumeV2";

export const JobRequirementKindV2Schema = z.enum([
  "responsibility", "hard_constraint", "core_competency", "tool_or_technology",
  "experience_depth", "education", "language", "soft_skill", "domain_knowledge",
  "preferred", "risk_or_uncertain"
]);
export const JobRequirementPriorityV2Schema = z.enum(["must", "high", "medium", "nice_to_have", "uncertain"]);

export const JobRequirementNodeV2Schema = z.object({
  id: z.string().min(1),
  kind: JobRequirementKindV2Schema,
  statement: z.string().min(1),
  normalizedIntent: z.string().min(1),
  priority: JobRequirementPriorityV2Schema,
  hardConstraint: z.boolean(),
  competency: z.string().min(1).optional(),
  domain: z.string().min(1).optional(),
  minimumYears: z.number().min(0).optional(),
  seniority: z.string().min(1).optional(),
  exactKeywords: z.array(z.string().min(1)).default([]),
  semanticAliases: z.array(z.string().min(1)).default([]),
  sourceSpan: SourceSpanSchema,
  sourceSpans: z.array(SourceSpanSchema).min(1),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  parentRequirementId: z.string().min(1).optional(),
  relatedRequirementIds: z.array(z.string().min(1)).default([])
}).strict();

export const JobRequirementGraphV2Schema = z.object({
  schemaVersion: z.literal("job-requirement-graph-v2"),
  nodes: z.array(JobRequirementNodeV2Schema),
  unclassifiedSourceSpans: z.array(SourceSpanSchema).default([]),
  analyzedAt: IsoDateStringSchema,
  analyzerVersion: z.string().min(1)
}).strict();

export const CandidateEvidenceSourceTypeSchema = z.enum([
  "experience_highlight", "experience_description", "skill", "certificate",
  "education", "project_outcome", "custom_fact"
]);
export const CandidateEvidenceUnitSchema = z.object({
  id: z.string().min(1), sourceType: CandidateEvidenceSourceTypeSchema,
  sectionType: ResumeSectionTypeV2Schema, itemId: z.string().min(1), fieldPath: z.string().min(1),
  text: z.string().min(1), normalizedText: z.string().min(1),
  factRefs: z.array(BranchFactRefSchema).default([]), sourceBlockIds: z.array(z.string().min(1)).default([]),
  supportLevel: z.enum(["verified", "user_declared"]).default("verified"),
  organization: z.string().min(1).optional(), role: z.string().min(1).optional(), dateRange: z.string().min(1).optional(),
  confirmed: z.literal(true)
}).strict().superRefine((unit, context) => {
  if (unit.supportLevel === "verified" && unit.factRefs.length === 0) context.addIssue({ code: "custom", path: ["factRefs"], message: "verified evidence requires fact references" });
});

export const EvidenceRecallCandidateSchema = z.object({
  evidenceUnitId: z.string().min(1), score: z.number().min(0), reasons: z.array(z.string().min(1)).min(1)
}).strict();
export const RequirementEvidenceRecallSchema = z.object({
  requirementId: z.string().min(1), candidates: z.array(EvidenceRecallCandidateSchema)
}).strict();

export const RequirementEvidenceMatchLevelV2Schema = z.enum([
  "direct", "strong_transferable", "partial", "weak", "none", "needs_confirmation"
]);
export const RequirementEvidenceEvaluationV2Schema = z.object({
  requirementId: z.string().min(1), matchLevel: RequirementEvidenceMatchLevelV2Schema,
  evidenceUnitIds: z.array(z.string().min(1)).default([]), evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  coveredAspects: z.array(z.string()).default([]), missingAspects: z.array(z.string()).default([]),
  risks: z.array(MatchRiskSchema).default([]), explanation: z.string().min(1), confidence: z.number().min(0).max(1)
}).strict();
export const RequirementEvidenceMatrixV2Schema = z.object({
  schemaVersion: z.literal("requirement-evidence-matrix-v2"),
  evaluations: z.array(RequirementEvidenceEvaluationV2Schema), evaluatedAt: IsoDateStringSchema
}).strict();

export const JobCoverageReportV2Schema = z.object({
  overallCoverage: z.number().min(0).max(100),
  subScores: z.object({ hardConstraints: z.number(), coreCompetencies: z.number(), responsibilities: z.number(), preferredQualifications: z.number(), terminologyCoverage: z.number() }),
  coveredRequirementIds: z.array(z.string()), partialRequirementIds: z.array(z.string()), uncoveredRequirementIds: z.array(z.string()), confirmationRequirementIds: z.array(z.string()),
  coveredRequirementDescriptions: z.array(z.string()).default([]),
  partialRequirementDescriptions: z.array(z.string()).default([]),
  uncoveredRequirementDescriptions: z.array(z.string()).default([]),
  blockingGaps: z.array(z.string()), improvementOpportunities: z.array(z.string()),
  scoreVersion: z.string().min(1), scoreExplanation: z.string().min(1)
}).strict();

export const ResumeOptimizationActionTypeV2Schema = z.enum([
  "prioritize_item", "reorder_item", "rewrite_highlight", "shorten_highlight", "hide_item",
  "show_item", "adjust_target_role", "add_follow_up_question", "no_change"
]);
export const ResumeOptimizationPlanV2Schema = z.object({
  id: z.string().min(1), branchId: z.string().min(1), jobId: z.string().min(1),
  basedOnBranchRevision: z.number().int().min(0), basedOnRevisionId: z.string().min(1), requirementsHash: z.string().min(8),
  executiveSummary: z.string().min(1),
  actions: z.array(z.object({
    id: z.string().min(1), type: ResumeOptimizationActionTypeV2Schema,
    targetItemId: z.string().min(1).optional(), targetFieldPath: z.string().min(1).optional(),
    requirementIds: z.array(z.string().min(1)), evidenceUnitIds: z.array(z.string().min(1)), evidenceRefs: z.array(MatchEvidenceRefSchema),
    currentText: z.string().min(1).optional(), proposedIntent: z.string().min(1), reason: z.string().min(1),
    expectedImpact: z.enum(["hard_constraint", "core_match", "clarity", "relevance", "brevity", "risk_reduction"]),
    riskLevel: z.enum(["low", "medium", "high"]), status: z.literal("proposed")
  }).strict()),
  factGaps: z.array(z.object({ requirementId: z.string().min(1), question: z.string().min(1), reason: z.string().min(1) }).strict()),
  createdAt: IsoDateStringSchema
}).strict();

export type JobRequirementNodeV2 = z.infer<typeof JobRequirementNodeV2Schema>;
export type JobRequirementGraphV2 = z.infer<typeof JobRequirementGraphV2Schema>;
export type CandidateEvidenceUnit = z.infer<typeof CandidateEvidenceUnitSchema>;
export type RequirementEvidenceRecall = z.infer<typeof RequirementEvidenceRecallSchema>;
export type RequirementEvidenceEvaluationV2 = z.infer<typeof RequirementEvidenceEvaluationV2Schema>;
export type RequirementEvidenceMatrixV2 = z.infer<typeof RequirementEvidenceMatrixV2Schema>;
export type JobCoverageReportV2 = z.infer<typeof JobCoverageReportV2Schema>;
export type ResumeOptimizationPlanV2 = z.infer<typeof ResumeOptimizationPlanV2Schema>;
