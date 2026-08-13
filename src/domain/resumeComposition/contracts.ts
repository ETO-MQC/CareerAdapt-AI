import { z } from "zod";
import { ResumeItemV2Schema, type ResumeItemV2 } from "@/domain/schemas/resumeV2";

const StringListSchema = z.array(z.string().trim().min(1)).default([]);

export const ResumeCompositionModeSchema = z.enum(["general", "job_specific"]);
export type ResumeCompositionMode = z.infer<typeof ResumeCompositionModeSchema>;

export const ResumeCompositionTargetContextSchema = z.object({
  targetDirection: z.string().trim().min(1).max(160).optional(),
  targetAudience: z.string().trim().min(1).max(160).optional(),
  companyType: z.string().trim().min(1).max(160).optional()
}).strict();
export type ResumeCompositionTargetContext = z.infer<typeof ResumeCompositionTargetContextSchema>;

/**
 * A composition preference is a user answer, not a CareerProfile fact. Keep
 * its identity explicit so a resumed turn cannot be mistaken for a new root
 * task or silently merged into the profile library.
 */
export const ResumeCompositionInformationNeedSchema = z.object({
  informationNeedId: z.string().min(1),
  question: z.string().min(1),
  status: z.enum(["pending", "answered", "skipped", "superseded"])
}).strict();
export type ResumeCompositionInformationNeed = z.infer<typeof ResumeCompositionInformationNeedSchema>;

export const ResumeCompositionAnswerSchema = z.object({
  informationNeedId: z.string().min(1),
  value: z.string().trim().min(1).max(2_000),
  source: z.literal("user_message"),
  capturedAt: z.string().datetime({ offset: true })
}).strict();
export type ResumeCompositionAnswer = z.infer<typeof ResumeCompositionAnswerSchema>;

export const ResumeClaimClassificationSchema = z.enum([
  "SUPPORTED",
  "DERIVED_PRESENTATION",
  "NEEDS_USER_CONFIRMATION",
  "UNSUPPORTED"
]);
export type ResumeClaimClassification = z.infer<typeof ResumeClaimClassificationSchema>;

export const ResumeEvidenceNodeTypeSchema = z.enum([
  "education",
  "career_asset",
  "skill",
  "tool",
  "method",
  "outcome",
  "award",
  "leadership",
  "evidence"
]);

export const ResumeEvidenceNodeSchema = z.object({
  id: z.string().min(1),
  type: ResumeEvidenceNodeTypeSchema,
  value: z.string().min(1),
  sourceAssetIds: StringListSchema,
  factIds: StringListSchema,
  sourceTurnIds: StringListSchema,
  confirmationStatus: z.enum(["confirmed", "unconfirmed", "needs_confirmation"]),
  ownershipStrength: z.number().int().min(0).max(6),
  sourceExcerpts: StringListSchema
}).strict();
export type ResumeEvidenceNode = z.infer<typeof ResumeEvidenceNodeSchema>;

export const ResumeEvidenceEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  relation: z.enum(["supports", "appears_in", "derived_from", "related_to"])
}).strict();
export type ResumeEvidenceEdge = z.infer<typeof ResumeEvidenceEdgeSchema>;

export const ResumeSkillEvidenceSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  sourceAssetIds: StringListSchema,
  factIds: StringListSchema,
  evidenceNodeIds: StringListSchema,
  evidenceCount: z.number().int().min(1)
}).strict();
export type ResumeSkillEvidence = z.infer<typeof ResumeSkillEvidenceSchema>;

export const ResumeEvidenceRecoveryCandidateSchema = z.object({
  id: z.string().min(1),
  sourceAssetId: z.string().min(1),
  field: z.string().min(1),
  proposedValue: z.string().min(1),
  status: z.enum(["safe_recovery", "needs_confirmation", "irrelevant"]),
  factIds: StringListSchema,
  reason: z.string().min(1)
}).strict();
export type ResumeEvidenceRecoveryCandidate = z.infer<typeof ResumeEvidenceRecoveryCandidateSchema>;

export const ResumeEvidenceGraphSchema = z.object({
  schemaVersion: z.literal("resume-evidence-graph-v1"),
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  nodes: z.array(ResumeEvidenceNodeSchema),
  edges: z.array(ResumeEvidenceEdgeSchema),
  skillMatrix: z.array(ResumeSkillEvidenceSchema),
  recoveryCandidates: z.array(ResumeEvidenceRecoveryCandidateSchema),
  sourceAssetIds: StringListSchema,
  excludedAssetIds: StringListSchema
}).strict();
export type ResumeEvidenceGraph = z.infer<typeof ResumeEvidenceGraphSchema>;

export const ResumeKeywordCoverageSchema = z.object({
  keyword: z.string().min(1),
  status: z.enum(["SUPPORTED", "POTENTIALLY_SUPPORTED", "UNSUPPORTED"]),
  finalStatus: z.enum(["PRESENT", "MISSING_BUT_SUPPORTED", "CORRECTLY_ABSENT", "ADJACENT_CONFIRMATION_REQUIRED"]).optional(),
  sourceAssetIds: StringListSchema,
  factIds: StringListSchema,
  reason: z.string().min(1),
  question: z.string().min(1).optional()
}).strict();
export type ResumeKeywordCoverage = z.infer<typeof ResumeKeywordCoverageSchema>;

/** A deterministic recovery is allowed, but it must remain observable. */
export const ResumeWritingExecutionSchema = z.object({
  mode: z.enum(["ai", "deterministic_fallback"]),
  provider: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  promptVersion: z.string().trim().min(1).optional(),
  attemptCount: z.number().int().min(1),
  latencyMs: z.number().int().min(0).optional(),
  fallbackReason: z.string().trim().min(1).optional(),
  inputContextHash: z.string().min(8),
  outputHash: z.string().min(8).optional()
}).strict();
export type ResumeWritingExecution = z.infer<typeof ResumeWritingExecutionSchema>;

export const ResumeAssetResumeScoreSchema = z.object({
  targetRelevance: z.number().min(0).max(1),
  evidenceStrength: z.number().min(0).max(1),
  demonstratedComplexity: z.number().min(0).max(1),
  outcomeStrength: z.number().min(0).max(1),
  specificity: z.number().min(0).max(1),
  uniqueness: z.number().min(0).max(1),
  technicalDepth: z.number().min(0).max(1),
  recency: z.number().min(0).max(1),
  ownershipStrength: z.number().min(0).max(1),
  redundancy: z.number().min(0).max(1),
  weakEvidencePenalty: z.number().min(0).max(1),
  requirementCoverage: z.number().min(0).max(1).optional(),
  mustHaveCoverage: z.number().min(0).max(1).optional(),
  jdSemanticRelevance: z.number().min(0).max(1).optional(),
  total: z.number().min(0).max(1)
}).strict();
export type ResumeAssetResumeScore = z.infer<typeof ResumeAssetResumeScoreSchema>;

export const ResumeClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  classification: ResumeClaimClassificationSchema,
  sourceAssetIds: StringListSchema,
  factIds: StringListSchema,
  sourceTurnIds: StringListSchema,
  evidenceNodeIds: StringListSchema,
  reason: z.string().min(1),
  guardStatus: z.enum(["pass", "needs_edit", "blocked", "not_run"]).default("not_run")
}).strict();
export type ResumeClaim = z.infer<typeof ResumeClaimSchema>;

export const ResumeBlueprintAssetSchema = z.object({
  sourceAssetId: z.string().min(1),
  sectionType: z.string().min(1),
  title: z.string().min(1),
  sourceFactIds: StringListSchema,
  evidenceNodeIds: StringListSchema,
  relevance: z.number().min(0).max(1),
  inclusionReason: z.string().min(1),
  bulletPlan: StringListSchema,
  explicitTools: StringListSchema,
  score: ResumeAssetResumeScoreSchema.optional()
}).strict();
export const ResumeBlueprintExcludedAssetSchema = z.object({
  sourceAssetId: z.string().min(1),
  title: z.string().min(1),
  relevance: z.number().min(0).max(1),
  reason: z.string().min(1),
  score: ResumeAssetResumeScoreSchema.optional()
}).strict();
export type ResumeBlueprintExcludedAsset = z.infer<typeof ResumeBlueprintExcludedAssetSchema>;

export const ResumeBlueprintSchema = z.object({
  schemaVersion: z.literal("resume-blueprint-v1"),
  mode: ResumeCompositionModeSchema,
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  jobId: z.string().min(1).optional(),
  targetRole: z.string().min(1).optional(),
  targetDirection: z.string().trim().min(1).max(160).optional(),
  targetAudience: z.string().trim().min(1).max(160).optional(),
  companyType: z.string().trim().min(1).max(160).optional(),
  summaryPlan: z.string().min(1).optional(),
  skillGroups: z.record(z.string(), StringListSchema),
  sections: z.array(z.object({
    sectionType: z.string().min(1),
    assetIds: StringListSchema,
    maxItems: z.number().int().min(0),
    priority: z.number().min(0).max(1)
  }).strict()),
  assets: z.array(ResumeBlueprintAssetSchema),
  excludedAssets: z.array(ResumeBlueprintExcludedAssetSchema).default([]),
  informationNeeds: z.array(z.object({
    id: z.string().min(1),
    question: z.string().min(1),
    reason: z.string().min(1),
    optional: z.literal(true)
  }).strict()).max(2),
  keywordCoverage: z.array(ResumeKeywordCoverageSchema),
  pageBudget: z.object({
    targetPages: z.number().int().min(1),
    maxProjects: z.number().int().min(0),
    maxBulletsPerProject: z.number().int().min(1),
    estimatedPageCount: z.number().min(0)
  }).strict()
}).strict();
export type ResumeBlueprint = z.infer<typeof ResumeBlueprintSchema>;

export const CareerResumeWritingSkillGroupSchema = z.object({
  category: z.string().trim().min(1),
  skills: StringListSchema
}).strict();
export type CareerResumeWritingSkillGroup = z.infer<typeof CareerResumeWritingSkillGroupSchema>;

export const CareerResumeWritingAssetSchema = z.object({
  sourceAssetId: z.string().min(1),
  title: z.string().trim().min(1),
  role: z.string().trim().min(1).optional(),
  techStack: StringListSchema,
  highlights: z.array(z.string().trim().min(1)).max(4).default([])
}).strict();
export type CareerResumeWritingAsset = z.infer<typeof CareerResumeWritingAssetSchema>;

export const CareerResumeWritingOutputSchema = z.object({
  summary: z.string().trim().min(1).max(500).optional(),
  assets: z.array(CareerResumeWritingAssetSchema).max(12).default([]),
  skillGroups: z.array(CareerResumeWritingSkillGroupSchema).max(8).default([])
}).strict();
export type CareerResumeWritingOutput = z.infer<typeof CareerResumeWritingOutputSchema>;

export const ResumeCompiledItemSchema = z.object({
  sourceAssetId: z.string().min(1),
  data: ResumeItemV2Schema,
  claimIds: StringListSchema,
  factIds: StringListSchema,
  sourceBlockIds: StringListSchema,
  sourceExcerpt: z.string().min(1).optional()
}).strict();
export type ResumeCompiledItem = z.infer<typeof ResumeCompiledItemSchema>;

export const ResumeCompositionMetricsSchema = z.object({
  sourceAssets: z.number().int().min(0),
  selectedAssets: z.number().int().min(0),
  derivedSkills: z.number().int().min(0),
  questionsAsked: z.number().int().min(0).max(2),
  supportedClaims: z.number().int().min(0),
  derivedPresentationClaims: z.number().int().min(0),
  needsConfirmationClaims: z.number().int().min(0),
  unsupportedClaims: z.number().int().min(0),
  bulletsGenerated: z.number().int().min(0),
  duplicateBullets: z.number().int().min(0),
  fillerBullets: z.number().int().min(0),
  lowDensityBullets: z.number().int().min(0).default(0),
  paragraphHeavyItems: z.number().int().min(0),
  pageOverflow: z.boolean(),
  onePageReasonable: z.boolean(),
  bulletRepairCount: z.number().int().min(0).default(0),
  bulletRejectedCount: z.number().int().min(0).default(0),
  repairPassCount: z.number().int().min(0).default(0),
  unsupportedClaimsBlocked: z.number().int().min(0).default(0),
  atsRepairPassCount: z.number().int().min(0).default(0),
  compressionPassCount: z.number().int().min(0).default(0),
  profileFactsAddedFromTailoring: z.number().int().min(0).default(0)
}).strict();
export type ResumeCompositionMetrics = z.infer<typeof ResumeCompositionMetricsSchema>;

export const ResumeReviewResultSchema = z.object({
  status: z.enum(["PASS", "NEEDS_REVIEW"]),
  findings: z.array(z.string().min(1)),
  atsCoverage: z.array(ResumeKeywordCoverageSchema),
  metrics: ResumeCompositionMetricsSchema,
  revisedBulletCount: z.number().int().min(0)
}).strict();
export type ResumeReviewResult = z.infer<typeof ResumeReviewResultSchema>;

export const ResumeCompositionTelemetrySchema = z.object({
  writerMode: z.enum(["ai", "deterministic_fallback"]).optional(),
  writerProvider: z.string().min(1).optional(),
  writerModel: z.string().min(1).optional(),
  writerLatencyMs: z.number().int().min(0).optional(),
  writerFallbackReason: z.string().min(1).optional(),
  targetContext: ResumeCompositionTargetContextSchema.optional(),
  selectedAssetCount: z.number().int().min(0).optional(),
  selectedProjectCount: z.number().int().min(0).optional(),
  bulletCount: z.number().int().min(0).optional(),
  bulletRepairCount: z.number().int().min(0).optional(),
  bulletRejectedCount: z.number().int().min(0).optional(),
  evidenceKeywordSupportedCount: z.number().int().min(0).optional(),
  evidenceKeywordPotentialCount: z.number().int().min(0).optional(),
  evidenceKeywordUnsupportedCount: z.number().int().min(0).optional(),
  finalKeywordPresentCount: z.number().int().min(0).optional(),
  finalKeywordMissingSupportedCount: z.number().int().min(0).optional(),
  reviewStatus: z.enum(["PASS", "NEEDS_REVIEW"]).optional(),
  pageCount: z.number().min(0).optional(),
  pageCountSource: z.enum(["blueprint_estimate", "rendered_export"]).optional(),
  compressionPassCount: z.number().int().min(0).optional(),
  profileFactsAddedFromTailoring: z.number().int().min(0).optional(),
  resumeBranchId: z.string().min(1).optional(),
  resumeRevisionId: z.string().min(1).optional()
}).strict();
export type ResumeCompositionTelemetry = z.infer<typeof ResumeCompositionTelemetrySchema>;

export const ResumeCompositionProposalSchema = z.object({
  mode: ResumeCompositionModeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  selectedAssetTitles: StringListSchema,
  derivedSkillNames: StringListSchema,
  bulletCount: z.number().int().min(0),
  informationNeeds: ResumeBlueprintSchema.shape.informationNeeds,
  contactReminder: z.boolean().default(false),
  actions: z.array(z.enum(["generate", "supplement", "adjust", "cancel"]))
}).strict();
export type ResumeCompositionProposal = z.infer<typeof ResumeCompositionProposalSchema>;

export const ResumeCompositionResultSchema = z.object({
  schemaVersion: z.literal("resume-composition-v1"),
  mode: ResumeCompositionModeSchema,
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  jobId: z.string().min(1).optional(),
  targetDirection: z.string().trim().min(1).max(160).optional(),
  targetAudience: z.string().trim().min(1).max(160).optional(),
  companyType: z.string().trim().min(1).max(160).optional(),
  evidenceGraph: ResumeEvidenceGraphSchema,
  blueprint: ResumeBlueprintSchema,
  items: z.array(ResumeCompiledItemSchema),
  claims: z.array(ResumeClaimSchema),
  reviewResult: ResumeReviewResultSchema,
  proposal: ResumeCompositionProposalSchema,
  metrics: ResumeCompositionMetricsSchema,
  keywordCoverage: z.array(ResumeKeywordCoverageSchema),
  informationNeeds: ResumeBlueprintSchema.shape.informationNeeds,
  skillGroups: z.array(CareerResumeWritingSkillGroupSchema).default([]),
  sourceResumeId: z.string().min(1).optional(),
  writingExecution: ResumeWritingExecutionSchema.optional(),
  writingOutput: CareerResumeWritingOutputSchema.optional(),
  telemetry: ResumeCompositionTelemetrySchema.optional()
}).strict();
export type ResumeCompositionResult = z.infer<typeof ResumeCompositionResultSchema>;

/** Exact proposal artifact committed after confirmation; persisted in appMeta. */
export const ResumeCompositionCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  mode: ResumeCompositionModeSchema,
  jobId: z.string().min(1).optional(),
  sourceResumeId: z.string().min(1).optional(),
  targetContext: ResumeCompositionTargetContextSchema,
  evidenceGraphHash: z.string().min(8),
  blueprint: ResumeBlueprintSchema,
  writingExecution: ResumeWritingExecutionSchema,
  writingOutput: CareerResumeWritingOutputSchema,
  reviewResult: ResumeReviewResultSchema,
  compositionResult: z.lazy(() => ResumeCompositionResultSchema),
  createdAt: z.string().datetime({ offset: true }),
  contentHash: z.string().min(8),
  sourceBranchId: z.string().min(1).optional(),
  sourceRevisionId: z.string().min(1).optional(),
  sourceContentHash: z.string().min(8).optional(),
  sourcePresentationHash: z.string().min(8).optional()
}).strict();
export type ResumeCompositionCheckpoint = z.infer<typeof ResumeCompositionCheckpointSchema>;

export type ResumeCompositionItemData = ResumeItemV2;
