import { z } from "zod";

/**
 * A planning projection over CareerAdapt data.  This module deliberately has
 * no repository, runtime, provider, or persistence dependency.
 */
export const CareerInformationNeedTypeSchema = z.enum([
  "factual_gap",
  "user_preference",
  "target_selection",
  "conflict_resolution",
  "confirmation",
  "optional_enrichment"
]);

export const CareerInteractionImportanceSchema = z.number().min(0).max(1);

export const CareerInformationNeedPriorityFactorsSchema = z.object({
  missingDimensionWeight: z.number().min(0).max(1).default(0),
  careerAssetImportance: z.number().min(0).max(1).default(0),
  expectedArtifactImpact: z.number().min(0).max(1).default(0),
  currentReadinessGap: z.number().min(0).max(1).default(0),
  userEmphasis: z.number().min(0).max(1).default(0),
  recency: z.number().min(0).max(1).default(0),
  jobRelevance: z.number().min(0).max(1).default(0),
  alreadyAskedPenalty: z.number().min(0).max(1).default(0),
  lowValueOptionalPenalty: z.number().min(0).max(1).default(0)
}).strict();

export const CareerInformationNeedSchema = z.object({
  id: z.string().min(1),
  type: CareerInformationNeedTypeSchema,
  targetAssetId: z.string().min(1).optional(),
  dimension: z.string().min(1).optional(),
  importance: CareerInteractionImportanceSchema,
  reason: z.string().min(1),
  answerChangesOutcome: z.boolean(),
  required: z.boolean(),
  alreadyAsked: z.boolean(),
  score: z.number().min(0).max(1).optional(),
  priorityFactors: CareerInformationNeedPriorityFactorsSchema.optional()
}).strict();

export const CareerInteractionQuestionSchema = z.object({
  needId: z.string().min(1),
  question: z.string().min(1).max(800),
  targetAssetId: z.string().min(1).optional(),
  dimension: z.string().min(1).optional()
}).strict();

export const CareerAssetInterviewStatusSchema = z.enum([
  "discovered",
  "enriching",
  "ready",
  "skipped"
]);

export const CareerAssetInterviewStateSchema = z.object({
  candidateId: z.string().min(1),
  identity: z.string().min(1),
  sectionType: z.string().min(1),
  readiness: z.number().min(0).max(1),
  questionBudget: z.number().int().min(0),
  answeredDimensions: z.array(z.string().min(1)).max(40),
  skippedDimensions: z.array(z.string().min(1)).max(40),
  highValueGaps: z.array(z.string().min(1)).max(40),
  interviewStatus: CareerAssetInterviewStatusSchema
}).strict();

export const CareerInteractionKnownContextSchema = z.object({
  person: z.unknown().optional(),
  profile: z.unknown().optional(),
  resumes: z.unknown().optional(),
  job: z.unknown().optional(),
  activeCareerAssets: z.unknown().optional(),
  existingDecisions: z.unknown().optional()
}).strict();

export const CareerInteractionPlanSchema = z.object({
  workflow: z.string().min(1),
  objective: z.string().min(1),
  knownContext: CareerInteractionKnownContextSchema,
  informationNeeds: z.array(CareerInformationNeedSchema).max(100),
  recommendedNextQuestion: CareerInteractionQuestionSchema.optional(),
  canProceedWithoutQuestion: z.boolean(),
  stopReason: z.string().min(1).optional(),
  interactionSummary: z.string().min(1).optional(),
  careerAssetState: z.array(CareerAssetInterviewStateSchema).max(100).default([])
}).strict();

export type CareerInformationNeedType = z.infer<typeof CareerInformationNeedTypeSchema>;
export type CareerInformationNeed = z.infer<typeof CareerInformationNeedSchema>;
export type CareerInformationNeedPriorityFactors = z.infer<typeof CareerInformationNeedPriorityFactorsSchema>;
export type CareerInteractionQuestion = z.infer<typeof CareerInteractionQuestionSchema>;
export type CareerAssetInterviewState = z.infer<typeof CareerAssetInterviewStateSchema>;
export type CareerInteractionKnownContext = z.infer<typeof CareerInteractionKnownContextSchema>;
export type CareerInteractionPlan = z.infer<typeof CareerInteractionPlanSchema>;

export type CareerInformationNeedDraft = Omit<CareerInformationNeed, "importance" | "score" | "priorityFactors"> & {
  importance?: number;
  score?: number;
  priorityFactors?: Partial<CareerInformationNeedPriorityFactors>;
};

/**
 * Information value is intentionally conservative.  A missing field alone
 * is never sufficient: the answer must be both outcome-changing and useful
 * for the current artifact.
 */
export function scoreCareerInformationNeed(
  need: Pick<CareerInformationNeedDraft, "answerChangesOutcome" | "required" | "priorityFactors" | "importance">
) {
  const factors = {
    missingDimensionWeight: 0,
    careerAssetImportance: 0,
    expectedArtifactImpact: 0,
    currentReadinessGap: 0,
    userEmphasis: 0,
    recency: 0,
    jobRelevance: 0,
    alreadyAskedPenalty: 0,
    lowValueOptionalPenalty: 0,
    ...need.priorityFactors
  };
  if (!need.answerChangesOutcome) return 0;
  const positive =
    factors.missingDimensionWeight * 0.2
    + factors.careerAssetImportance * 0.18
    + factors.expectedArtifactImpact * 0.24
    + factors.currentReadinessGap * 0.18
    + factors.userEmphasis * 0.08
    + factors.recency * 0.04
    + factors.jobRelevance * 0.08;
  const requiredBoost = need.required ? 0.08 : 0;
  const score = positive + requiredBoost - factors.alreadyAskedPenalty * 0.35 - factors.lowValueOptionalPenalty * 0.2;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export function rankCareerInformationNeeds(needs: CareerInformationNeedDraft[]) {
  return needs
    .map((need) => {
      const priorityFactors = CareerInformationNeedPriorityFactorsSchema.parse(need.priorityFactors ?? {});
      const score = scoreCareerInformationNeed({
        ...need,
        priorityFactors
      });
      return CareerInformationNeedSchema.parse({
        ...need,
        importance: need.importance ?? score,
        score,
        priorityFactors
      });
    })
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || right.importance - left.importance || left.id.localeCompare(right.id));
}

export function buildCareerInteractionPlan(input: {
  workflow: string;
  objective: string;
  knownContext?: Partial<CareerInteractionKnownContext>;
  informationNeeds?: CareerInformationNeedDraft[];
  recommendedNextQuestion?: CareerInteractionQuestion;
  canProceedWithoutQuestion?: boolean;
  stopReason?: string;
  interactionSummary?: string;
  careerAssetState?: CareerAssetInterviewState[];
}) {
  const informationNeeds = rankCareerInformationNeeds(input.informationNeeds ?? []);
  const recommendedNextQuestion = input.recommendedNextQuestion
    ?? recommendedQuestionForNeeds(informationNeeds);
  const unresolved = informationNeeds.find((need) => !need.alreadyAsked && need.answerChangesOutcome && (need.score ?? 0) > 0);
  return CareerInteractionPlanSchema.parse({
    workflow: input.workflow,
    objective: input.objective,
    knownContext: {
      person: input.knownContext?.person,
      profile: input.knownContext?.profile,
      resumes: input.knownContext?.resumes,
      job: input.knownContext?.job,
      activeCareerAssets: input.knownContext?.activeCareerAssets,
      existingDecisions: input.knownContext?.existingDecisions
    },
    informationNeeds,
    ...(recommendedNextQuestion ? { recommendedNextQuestion } : {}),
    canProceedWithoutQuestion: input.canProceedWithoutQuestion ?? !unresolved,
    ...(input.stopReason ? { stopReason: input.stopReason } : {}),
    ...(input.interactionSummary ? { interactionSummary: input.interactionSummary } : {}),
    careerAssetState: input.careerAssetState ?? []
  });
}

function recommendedQuestionForNeeds(needs: CareerInformationNeed[]) {
  const next = needs.find((need) => !need.alreadyAsked && need.answerChangesOutcome && (need.score ?? 0) > 0);
  if (!next) return undefined;
  return {
    needId: next.id,
    question: next.reason,
    ...(next.targetAssetId ? { targetAssetId: next.targetAssetId } : {}),
    ...(next.dimension ? { dimension: next.dimension } : {})
  };
}
