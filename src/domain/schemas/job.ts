import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, RiskLevelSchema, SourceSpanSchema } from "./common";

export const JobSourceSchema = z.enum(["demo", "manual", "imported_text", "url"]);

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
  "risk_or_uncertain"
]);

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
  requirements: z.array(JobRequirementSchema).default([])
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
export type JobRequirementCategory = z.infer<typeof JobRequirementCategorySchema>;
export type Priority = z.infer<typeof PrioritySchema>;
export type MatchLevel = z.infer<typeof MatchLevelSchema>;
export type MatchRisk = z.infer<typeof MatchRiskSchema>;
export type MatchEvidenceRef = z.infer<typeof MatchEvidenceRefSchema>;
export type MatchEvaluation = z.infer<typeof MatchEvaluationSchema>;
export type ManualMatchOverride = z.infer<typeof ManualMatchOverrideSchema>;
export type JobRequirement = z.infer<typeof JobRequirementSchema>;
export type JobDescription = z.infer<typeof JobDescriptionSchema>;
export type RequirementMatch = z.infer<typeof RequirementMatchSchema>;
export type EvidenceMatcherItem = z.infer<typeof EvidenceMatcherItemSchema>;
export type EvidenceMatcherOutput = z.infer<typeof EvidenceMatcherOutputSchema>;
export type MatchOperation = z.infer<typeof MatchOperationSchema>;
