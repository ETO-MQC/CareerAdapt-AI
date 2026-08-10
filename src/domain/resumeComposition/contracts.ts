import { z } from "zod";
import { ResumeItemV2Schema, type ResumeItemV2 } from "@/domain/schemas/resumeV2";

const StringListSchema = z.array(z.string().trim().min(1)).default([]);

export const ResumeCompositionModeSchema = z.enum(["general", "job_specific"]);
export type ResumeCompositionMode = z.infer<typeof ResumeCompositionModeSchema>;

/**
 * A composition preference is a user answer, not a CareerProfile fact. Keep
 * its identity explicit so a resumed turn cannot be mistaken for a new root
 * task or silently merged into the profile library.
 */
export const ResumeCompositionInformationNeedSchema = z.object({
  informationNeedId: z.string().min(1),
  question: z.string().min(1),
  status: z.enum(["pending", "answered", "superseded"])
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
  sourceAssetIds: StringListSchema,
  factIds: StringListSchema,
  reason: z.string().min(1),
  question: z.string().min(1).optional()
}).strict();
export type ResumeKeywordCoverage = z.infer<typeof ResumeKeywordCoverageSchema>;

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
  explicitTools: StringListSchema
}).strict();

export const ResumeBlueprintSchema = z.object({
  schemaVersion: z.literal("resume-blueprint-v1"),
  mode: ResumeCompositionModeSchema,
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  jobId: z.string().min(1).optional(),
  targetRole: z.string().min(1).optional(),
  summaryPlan: z.string().min(1).optional(),
  skillGroups: z.record(z.string(), StringListSchema),
  sections: z.array(z.object({
    sectionType: z.string().min(1),
    assetIds: StringListSchema,
    maxItems: z.number().int().min(0),
    priority: z.number().min(0).max(1)
  }).strict()),
  assets: z.array(ResumeBlueprintAssetSchema),
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
  paragraphHeavyItems: z.number().int().min(0),
  pageOverflow: z.boolean(),
  onePageReasonable: z.boolean()
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

export const ResumeCompositionProposalSchema = z.object({
  mode: ResumeCompositionModeSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  selectedAssetTitles: StringListSchema,
  derivedSkillNames: StringListSchema,
  bulletCount: z.number().int().min(0),
  informationNeeds: ResumeBlueprintSchema.shape.informationNeeds,
  actions: z.array(z.enum(["generate", "supplement", "adjust", "cancel"]))
}).strict();
export type ResumeCompositionProposal = z.infer<typeof ResumeCompositionProposalSchema>;

export const ResumeCompositionResultSchema = z.object({
  schemaVersion: z.literal("resume-composition-v1"),
  mode: ResumeCompositionModeSchema,
  profileId: z.string().min(1),
  profileRevision: z.number().int().min(1),
  jobId: z.string().min(1).optional(),
  evidenceGraph: ResumeEvidenceGraphSchema,
  blueprint: ResumeBlueprintSchema,
  items: z.array(ResumeCompiledItemSchema),
  claims: z.array(ResumeClaimSchema),
  reviewResult: ResumeReviewResultSchema,
  proposal: ResumeCompositionProposalSchema,
  metrics: ResumeCompositionMetricsSchema,
  keywordCoverage: z.array(ResumeKeywordCoverageSchema),
  informationNeeds: ResumeBlueprintSchema.shape.informationNeeds,
  sourceResumeId: z.string().min(1).optional()
}).strict();
export type ResumeCompositionResult = z.infer<typeof ResumeCompositionResultSchema>;

export type ResumeCompositionItemData = ResumeItemV2;
