import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, RiskLevelSchema, SourceSpanSchema } from "./common";
import { JobRequirementGraphV3Schema } from "./jobOptimizationV3";
import { JobRequirementGraphV4Schema } from "./jobOptimizationV4";

export const JobSourceSchema = z.enum(["demo", "manual", "imported_text", "url"]);

export const JobWorkflowErrorCodeSchema = z.enum([
  "empty_input",
  "text_too_short",
  "schema_validation_failed",
  "ai_invalid_output",
  "repository_save_failed",
  "revision_conflict",
  "unknown_error"
]);

export const JobWorkflowStageSchema = z.enum(["input", "parse", "validate", "save"]);

export const JobWorkflowErrorStateSchema = z.object({
  code: JobWorkflowErrorCodeSchema,
  stage: JobWorkflowStageSchema,
  message: z.string().min(1),
  retryable: z.boolean()
});

export const JobRequirementCategorySchema = z.enum([
  "responsibility",
  "required_skill",
  "preferred_skill",
  "experience",
  "education",
  "certificate",
  "language",
  "tool",
  "other",
  "must_have",
  "core_skill",
  "soft_skill",
  "nice_to_have",
  "verification_material",
  "risk_or_uncertain"
]);

export type JobRequirementCategory = z.infer<typeof JobRequirementCategorySchema>;

const jobRequirementCategoryAliases: Record<string, JobRequirementCategory> = {
  responsibility: "responsibility",
  hard_constraint: "must_have",
  must_have: "must_have",
  required_skill: "required_skill",
  core_competency: "core_skill",
  core_skill: "core_skill",
  tool_or_technology: "tool",
  tool: "tool",
  experience_depth: "experience",
  experience: "experience",
  education: "education",
  certificate: "certificate",
  language: "language",
  soft_skill: "soft_skill",
  domain_knowledge: "other",
  preferred: "preferred_skill",
  preferred_skill: "preferred_skill",
  nice_to_have: "nice_to_have",
  verification_material: "verification_material",
  uncertain: "risk_or_uncertain",
  risk_or_uncertain: "risk_or_uncertain",
  other: "other"
};

export function normalizeJobRequirementCategory(...values: unknown[]): JobRequirementCategory {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = jobRequirementCategoryAliases[value.trim().toLowerCase()];
    if (normalized) return normalized;
  }
  return "risk_or_uncertain";
}

export const PrioritySchema = z.enum(["high", "medium", "low", "must", "important", "nice_to_have", "uncertain"]);

export const JobRequirementSchema = EntityBaseSchema.extend({
  category: JobRequirementCategorySchema,
  description: z.string().min(1),
  priority: PrioritySchema,
  hardConstraint: z.boolean(),
  sourceSpan: SourceSpanSchema,
  keywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1)
});

export const JobDescriptionSchema = EntityBaseSchema.extend({
  title: z.string().min(1),
  company: z.string().min(1),
  industry: z.string().optional(),
  location: z.string().optional(),
  workType: z.string().optional(),
  rawText: z.string().min(1),
  source: JobSourceSchema,
  parsedAt: IsoDateStringSchema.optional(),
  requirements: z.array(JobRequirementSchema).default([]),
  requirementGraph: z.union([JobRequirementGraphV3Schema, JobRequirementGraphV4Schema]).optional(),
  analysisStatus: z.enum(["validated", "needs_review"]).optional(),
  analysisIssues: z.array(z.string().min(1)).optional()
});

export const CommittedJobDescriptionSchema = JobDescriptionSchema.extend({
  requirements: z.array(JobRequirementSchema).min(1)
});

export const MatchLevelSchema = z.enum(["strong", "weak", "transferable", "none"]);

export const MatchRiskSchema = z.enum([
  "source_missing",
  "hard_constraint_gap",
  "ownership_risk",
  "team_to_individual_risk",
  "skill_level_risk",
  "number_risk",
  "new_fact_risk",
  "stale_match",
  "low_confidence"
]);

export const ExperienceFactEvidenceRefSchema = z.object({
  type: z.literal("experience_fact"),
  experienceId: z.string().min(1),
  factId: z.string().min(1),
  factQuote: z.string().min(1),
  factText: z.string().min(1)
});

export const SkillFactEvidenceRefSchema = z.object({
  type: z.literal("skill_fact"),
  skillId: z.string().min(1),
  factId: z.string().min(1),
  factQuote: z.string().min(1),
  factText: z.string().min(1)
});

export const CertificateFactEvidenceRefSchema = z.object({
  type: z.literal("certificate_fact"),
  certificateId: z.string().min(1),
  factId: z.string().min(1),
  factQuote: z.string().min(1),
  factText: z.string().min(1)
});

export const EvidenceFileEvidenceRefSchema = z.object({
  type: z.literal("evidence_file"),
  evidenceId: z.string().min(1),
  linkedFactId: z.string().min(1),
  factQuote: z.string().min(1),
  factText: z.string().min(1)
});

export const MatchEvidenceRefSchema = z.discriminatedUnion("type", [
  ExperienceFactEvidenceRefSchema,
  SkillFactEvidenceRefSchema,
  CertificateFactEvidenceRefSchema,
  EvidenceFileEvidenceRefSchema
]);

export const MatchEvaluationSourceSchema = z.enum(["rule", "ai", "manual"]);

export const MatchEvaluationSchema = z.object({
  source: MatchEvaluationSourceSchema,
  matchLevel: MatchLevelSchema,
  riskLevel: RiskLevelSchema,
  risks: z.array(MatchRiskSchema).default([]),
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  explanation: z.string().min(1),
  evaluatedAt: IsoDateStringSchema
});

export const ManualMatchOverrideSchema = EntityBaseSchema.extend({
  previousEvaluation: MatchEvaluationSchema,
  nextEvaluation: MatchEvaluationSchema.extend({
    source: z.literal("manual")
  }),
  reason: z.string().min(1),
  overriddenAt: IsoDateStringSchema
});

export const RequirementMatchSchema = EntityBaseSchema.extend({
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  /** The general resume explicitly selected when this match was created. */
  sourceResumeBranchId: z.string().min(1).optional(),
  /** The exact formal branch revision used to scope candidate facts. */
  sourceResumeBranchRevision: z.number().int().min(0).optional(),
  /** The exact ResumeRevision snapshot used when the match was created. */
  sourceResumeRevisionId: z.string().min(1).optional(),
  profileVersion: z.number().int().min(1),
  jobVersion: z.string().min(1),
  matcherVersion: z.string().min(1),
  candidateSetHash: z.string().min(8),
  isStale: z.boolean(),
  requirementId: z.string().min(1),
  requirementQuote: SourceSpanSchema,
  ruleEvaluation: MatchEvaluationSchema.extend({
    source: z.literal("rule")
  }),
  aiEvaluation: MatchEvaluationSchema.extend({
    source: z.literal("ai")
  }).optional(),
  manualOverride: ManualMatchOverrideSchema.optional(),
  effectiveEvaluation: MatchEvaluationSchema.optional()
});

export const EvidenceMatcherItemSchema = z.object({
  requirementId: z.string().min(1),
  matchLevel: MatchLevelSchema,
  riskLevel: RiskLevelSchema,
  risks: z.array(MatchRiskSchema).default([]),
  evidenceRefs: z.array(MatchEvidenceRefSchema).default([]),
  explanation: z.string().min(1)
});

export const EvidenceMatcherOutputSchema = z.object({
  evaluations: z.array(EvidenceMatcherItemSchema).default([])
});

export const MatchOperationSchema = EntityBaseSchema.extend({
  requirementMatchId: z.string().min(1),
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  operationId: z.string().min(1),
  type: z.enum(["rule_evaluation", "ai_evaluation", "manual_override", "mark_stale"]),
  beforeEvaluation: MatchEvaluationSchema.optional(),
  afterEvaluation: MatchEvaluationSchema.optional(),
  reason: z.string().optional(),
  occurredAt: IsoDateStringSchema
});

export type JobSource = z.infer<typeof JobSourceSchema>;
export type JobWorkflowErrorCode = z.infer<typeof JobWorkflowErrorCodeSchema>;
export type JobWorkflowStage = z.infer<typeof JobWorkflowStageSchema>;
export type JobWorkflowErrorState = z.infer<typeof JobWorkflowErrorStateSchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type MatchLevel = z.infer<typeof MatchLevelSchema>;
export type MatchRisk = z.infer<typeof MatchRiskSchema>;
export type MatchEvidenceRef = z.infer<typeof MatchEvidenceRefSchema>;
export type MatchEvaluation = z.infer<typeof MatchEvaluationSchema>;
export type ManualMatchOverride = z.infer<typeof ManualMatchOverrideSchema>;
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type JobDescription = z.infer<typeof JobDescriptionSchema>;
export type CommittedJobDescription = z.infer<typeof CommittedJobDescriptionSchema>;
export type RequirementMatch = z.infer<typeof RequirementMatchSchema>;
export type EvidenceMatcherItem = z.infer<typeof EvidenceMatcherItemSchema>;
export type EvidenceMatcherOutput = z.infer<typeof EvidenceMatcherOutputSchema>;
export type MatchOperation = z.infer<typeof MatchOperationSchema>;
