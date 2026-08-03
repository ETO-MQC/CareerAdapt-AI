import { z } from "zod";
import {
  CareerProfileSchema,
  JdSemanticAssignmentSchema,
  JobDescriptionSchema,
  JobRequirementGraphV4Schema,
  ResumeBranchSchema,
  ResumeTailorTaskInputV2Schema,
  ResumeTailoringDiffSchema,
  ResumeTailoringDiffModelOutputSchema,
  ResumeTailoringDiffTaskInputSchema,
  ResumeTailoringPlanSchema,
  TailoringGapSchema,
  TailoringIntensitySchema,
  type ResumeTailoringDiff,
  type ResumeTailoringDiffModelOutput,
  type ResumeTailoringDiffTaskInput
} from "@/domain/schemas";
import {
  analyzeJobDescriptionV4,
  analyzeKeywordAndCapabilityGaps,
  validateEachTailoringDiffLocally
} from "@/domain/jobOptimization";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { stableHashText } from "@/services/security/text";
import { answerTailoringClarification, createTailoringPlan, createTailoringQuestionPlan, tailoringAnswerRevisionHash } from "./tailoringService";
import { tailoringDiffId } from "./tailoringDiffId";

export { tailoringDiffId } from "./tailoringDiffId";

const OperationIdSchema = z.string().min(8).max(160);

export const TailoringSessionSchema = z.object({
  tailoringRuntimeVersion: z.number().int().min(1).default(2),
  id: z.string().min(1),
  operationId: OperationIdSchema,
  profile: CareerProfileSchema,
  branch: ResumeBranchSchema,
  job: JobDescriptionSchema,
  plan: ResumeTailoringPlanSchema,
  taskInputs: z.array(ResumeTailorTaskInputV2Schema),
  gaps: z.array(TailoringGapSchema),
  revision: z.number().int().min(1).default(1),
  generatedDiffRevision: z.number().int().min(0).default(0),
  createdAt: z.string().datetime({ offset: true })
}).strict();

export const AnalyzeJobCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  rawText: z.string().min(20).max(24_000),
  aiAssignments: z.array(JdSemanticAssignmentSchema).optional()
}).strict();

export const AnalyzeJobCommandOutputSchema = z.object({
  operationId: OperationIdSchema,
  graph: JobRequirementGraphV4Schema,
  needsReview: z.boolean()
}).strict();

export const CreateTailoringSessionCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  profile: CareerProfileSchema,
  branch: ResumeBranchSchema,
  job: JobDescriptionSchema,
  intensity: TailoringIntensitySchema.optional()
}).strict();

export const CreateTailoringSessionCommandOutputSchema = z.object({
  operationId: OperationIdSchema,
  session: TailoringSessionSchema
}).strict();

export const GenerateTailoringDiffsCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  session: TailoringSessionSchema
}).strict();

export const AnswerTailoringQuestionCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  session: TailoringSessionSchema,
  questionId: z.string().min(1),
  answer: z.union([z.string(), z.array(z.string()), z.boolean()]),
  proficiency: z.enum(["proficient", "familiar", "aware", "learning"]).optional()
}).strict();

export const ReviewTailoringDiffCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  session: TailoringSessionSchema,
  diffId: z.string().min(1),
  decision: z.enum(["accept", "edit", "reject"]),
  editedValue: z.union([z.string().min(1), z.array(z.string().min(1))]).optional()
}).strict();

export const PreviewTailoringChangesCommandInputSchema = z.object({
  operationId: OperationIdSchema,
  session: TailoringSessionSchema,
  selectedDiffs: z.array(z.unknown()),
  confirmedRequirementIds: z.array(z.string()).default([])
}).strict();

export const ApplyTailoringSessionCommandInputSchema = PreviewTailoringChangesCommandInputSchema;

export type TailoringSession = z.infer<typeof TailoringSessionSchema>;

export function analyzeJobCommand(input: z.input<typeof AnalyzeJobCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = AnalyzeJobCommandInputSchema.parse(input);
  const result = analyzeJobDescriptionV4({ rawText: parsed.rawText, aiAssignments: parsed.aiAssignments });
  assertNotCancelled(signal);
  return AnalyzeJobCommandOutputSchema.parse({
    operationId: parsed.operationId,
    graph: result.graph,
    needsReview: result.graph.needsReview || result.ledger.status === "needs_review" || !result.validation.valid
  });
}

export function createTailoringSessionCommand(input: z.input<typeof CreateTailoringSessionCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = CreateTailoringSessionCommandInputSchema.parse(input);
  const planned = createTailoringPlan({
    profile: parsed.profile,
    branch: parsed.branch,
    job: parsed.job,
    intensity: parsed.intensity,
    operationId: parsed.operationId
  });
  if (!planned.plan || !planned.taskInputs) throw commandError("tailoring_plan_unavailable");
  const gaps = analyzeKeywordAndCapabilityGaps({
    job: parsed.job,
    branch: parsed.branch,
    clarificationQuestions: planned.plan.clarificationQuestions
  });
  const sessionId = `tailoring-session-${stableHashText(parsed.operationId)}`;
  const selectedQuestions = planned.plan.clarificationQuestions ?? [];
  const questionPlan = createTailoringQuestionPlan({
    sessionId,
    questions: selectedQuestions,
    now: planned.plan.createdAt
  });
  const selectedIds = new Set(questionPlan.questionIds);
  const plan = ResumeTailoringPlanSchema.parse({
    ...planned.plan,
    gaps,
    clarificationQuestions: selectedQuestions
      .filter((question) => selectedIds.has(question.id))
      .map((question) => ({
        ...question,
        status: question.id === questionPlan.activeQuestionId ? "active" : "pending"
      })),
    questionPlan,
    diffs: []
  });
  const session = TailoringSessionSchema.parse({
    id: sessionId,
    operationId: parsed.operationId,
    profile: parsed.profile,
    branch: parsed.branch,
    job: parsed.job,
    plan,
    taskInputs: planned.taskInputs,
    gaps,
    revision: 1,
    generatedDiffRevision: 0,
    createdAt: new Date().toISOString()
  });
  return CreateTailoringSessionCommandOutputSchema.parse({ operationId: parsed.operationId, session });
}

export async function generateTailoringDiffsCommand(input: {
  operationId: string;
  session: TailoringSession;
  generate: (request: ResumeTailoringDiffTaskInput, signal?: AbortSignal) => Promise<ResumeTailoringDiffModelOutput>;
  generateConsolidated?: (requests: ResumeTailoringDiffTaskInput[], signal?: AbortSignal) => Promise<{ diffs: ResumeTailoringDiff[] }>;
  signal?: AbortSignal;
}) {
  const parsed = GenerateTailoringDiffsCommandInputSchema.parse({ operationId: input.operationId, session: input.session });
  const accepted: ResumeTailoringDiff[] = [];
  const rejected: Array<{ diff: ResumeTailoringDiff; reasonCode: string }> = [];
  const warnings: string[] = [];
  if (parsed.session.plan.questionPlan?.status === "asking") {
    throw commandError("tailoring_questions_incomplete");
  }
  const clarifications = [...(parsed.session.plan.clarificationQuestions ?? [])];

  const requests = prioritizeTailoringTargets(parsed.session.taskInputs).flatMap((taskInput) => {
    if (!taskInput.target.itemId) return [];
    return [ResumeTailoringDiffTaskInputSchema.parse({
      ...taskInput,
      target: {
        ...taskInput.target,
        fieldPath: taskInput.target.fieldPath.split(".").at(-1)
      },
      allowedOperation: "replace",
      requirementDetails: {}
    })];
  });

  if (input.generateConsolidated && requests.length) {
    let output: { diffs: ResumeTailoringDiff[] } | undefined;
    try {
      const generated = await input.generateConsolidated(requests, input.signal);
      output = { diffs: generated.diffs.map((diff) => ResumeTailoringDiffSchema.parse(diff)) };
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "unknown";
      warnings.push(`invalid_consolidated_ai_output:${detail}`);
    }
    const validation = validateEachTailoringDiffLocally({ branch: parsed.session.branch, diffs: output?.diffs ?? [] });
    accepted.push(...validation.appliedDiffs);
    rejected.push(...validation.rejectedDiffs);
    warnings.push(...validation.warnings);
  } else for (const request of requests) {
    assertNotCancelled(input.signal);
    let first: ResumeTailoringDiffModelOutput | undefined;
    try {
      first = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(request, input.signal));
    } catch {
      warnings.push(`invalid_ai_output:${request.target.itemId}`);
    }
    const firstValidation = validateEachTailoringDiffLocally({ branch: parsed.session.branch, diffs: first?.diffs ?? [] });
    accepted.push(...firstValidation.appliedDiffs);
    warnings.push(...firstValidation.warnings);

    if (!first || firstValidation.rejectedDiffs.length || (!first.diffs.length && !first.clarifications.length)) {
      const retryRequest = ResumeTailoringDiffTaskInputSchema.parse({ ...request, retryContext: { previousWasNoOp: true } });
      let retried: ResumeTailoringDiffModelOutput | undefined;
      try {
        retried = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(retryRequest, input.signal));
      } catch {
        warnings.push(`invalid_ai_output_after_retry:${request.target.itemId}`);
      }
      if (!retried) {
        rejected.push(...firstValidation.rejectedDiffs);
        continue;
      }
      const retryValidation = validateEachTailoringDiffLocally({ branch: parsed.session.branch, diffs: retried.diffs });
      accepted.push(...retryValidation.appliedDiffs);
      rejected.push(...retryValidation.rejectedDiffs);
      warnings.push(...retryValidation.warnings);
    }
  }

  const dedupedDiffs = dedupeDiffs(accepted);
  const generatedAnswerRevisionHash = tailoringAnswerRevisionHash(parsed.session.plan);
  const generatedQuestionPlanRevision = parsed.session.plan.questionPlan?.revision;
  const plan = ResumeTailoringPlanSchema.parse({
    ...parsed.session.plan,
    diffs: dedupedDiffs,
    generationStatus: "completed",
    answerRevisionHash: generatedAnswerRevisionHash,
    generatedDiffsBasedOnQuestionPlanRevision: generatedQuestionPlanRevision,
    generatedDiffsBasedOnAnswerRevisionHash: generatedAnswerRevisionHash,
    diffReviews: dedupedDiffs.map((diff) => ({
      diffId: tailoringDiffId(diff),
      status: "suggested",
      updatedAt: new Date().toISOString()
    })),
    clarificationQuestions: clarifications,
    questionPlan: parsed.session.plan.questionPlan
      ? { ...parsed.session.plan.questionPlan, status: "completed" }
      : undefined
  });
  return {
    operationId: parsed.operationId,
    session: TailoringSessionSchema.parse({
      ...parsed.session,
      plan,
      revision: parsed.session.revision + 1,
      generatedDiffRevision: parsed.session.generatedDiffRevision + 1
    }),
    appliedDiffs: dedupedDiffs,
    rejectedDiffs: rejected,
    warnings: [...new Set(warnings)]
  };
}

export function answerTailoringQuestionCommand(input: z.input<typeof AnswerTailoringQuestionCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = AnswerTailoringQuestionCommandInputSchema.parse(input);
  const question = parsed.session.plan.clarificationQuestions?.find((item) => item.id === parsed.questionId);
  if (!question) throw commandError("tailoring_question_not_found");
  const previouslyAnswered = parsed.session.plan.clarificationAnswers?.some((record) => record.questionId === question.id);
  if (parsed.session.plan.questionPlan?.activeQuestionId !== question.id && !previouslyAnswered) {
    throw commandError("tailoring_question_not_active");
  }
  const plan = answerTailoringClarification({
    plan: parsed.session.plan,
    question,
    answer: parsed.answer,
    proficiency: parsed.proficiency,
    branch: parsed.session.branch,
    operationId: parsed.operationId
  });
  return {
    operationId: parsed.operationId,
    session: TailoringSessionSchema.parse({
      ...parsed.session,
      plan,
      revision: plan === parsed.session.plan ? parsed.session.revision : parsed.session.revision + 1
    })
  };
}

function prioritizeTailoringTargets(taskInputs: TailoringSession["taskInputs"]) {
  const sectionPriority: Record<string, number> = {
    summary: 0,
    skills: 1,
    project: 2,
    work: 3,
    internship: 4,
    ordering: 5
  };
  return [...taskInputs]
    .sort((left, right) => {
      const sectionDelta = (sectionPriority[left.target.sectionType] ?? 9) - (sectionPriority[right.target.sectionType] ?? 9);
      if (sectionDelta) return sectionDelta;
      const relevanceDelta = Math.max(...right.relevantRequirements.map((item) => item.relevanceScore))
        - Math.max(...left.relevantRequirements.map((item) => item.relevanceScore));
      return relevanceDelta || String(left.target.itemId).localeCompare(String(right.target.itemId));
    })
    .slice(0, 6);
}

export function reviewTailoringDiffCommand(input: z.input<typeof ReviewTailoringDiffCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = ReviewTailoringDiffCommandInputSchema.parse(input);
  const diff = parsed.session.plan.diffs?.find((item) => tailoringDiffId(item) === parsed.diffId);
  if (!diff) throw commandError("tailoring_diff_not_found");
  if (parsed.decision === "edit" && parsed.editedValue === undefined) throw commandError("tailoring_diff_edit_missing");
  const before = parsed.session.plan.diffReviews ?? [];
  const existing = before.find((item) => item.diffId === parsed.diffId);
  const nextStatus = parsed.decision === "accept" ? "accepted" as const : parsed.decision === "edit" ? "edited" as const : "rejected" as const;
  if (existing?.status === nextStatus && JSON.stringify(existing.editedValue) === JSON.stringify(parsed.decision === "edit" ? parsed.editedValue : undefined)) {
    return reviewTailoringDiffResult(parsed.operationId, parsed.session, true);
  }
  const review = {
    diffId: parsed.diffId,
    status: nextStatus,
    editedValue: parsed.decision === "edit" ? parsed.editedValue : undefined,
    updatedAt: new Date().toISOString()
  };
  const known = new Map(before.map((item) => [item.diffId, item]));
  known.set(parsed.diffId, review);
  const diffReviews = (parsed.session.plan.diffs ?? []).map((item) =>
    known.get(tailoringDiffId(item)) ?? {
      diffId: tailoringDiffId(item),
      status: "suggested" as const,
      updatedAt: review.updatedAt
    }
  );
  const plan = ResumeTailoringPlanSchema.parse({ ...parsed.session.plan, diffReviews });
  return reviewTailoringDiffResult(parsed.operationId, TailoringSessionSchema.parse({ ...parsed.session, plan, revision: parsed.session.revision + 1 }), false);
}

function reviewTailoringDiffResult(operationId: string, session: TailoringSession, idempotent: boolean) {
  const reviews = session.plan.diffReviews ?? [];
  const byId = new Map(reviews.map((review) => [review.diffId, review]));
  const selectedDiffs = (session.plan.diffs ?? []).flatMap((item) => {
    const resolved = byId.get(tailoringDiffId(item));
    if (!resolved || resolved.status === "suggested" || resolved.status === "rejected") return [];
    return [{ ...item, value: resolved.status === "edited" ? resolved.editedValue! : item.value }];
  });
  return {
    operationId,
    session,
    selectedDiffs,
    selectedDiffIds: reviews.filter((item) => item.status === "accepted" || item.status === "edited").map((item) => item.diffId),
    rejectedDiffIds: reviews.filter((item) => item.status === "rejected").map((item) => item.diffId),
    remainingDiffCount: reviews.filter((item) => item.status === "suggested").length,
    idempotent
  };
}

export function previewTailoringChangesCommand(input: z.input<typeof PreviewTailoringChangesCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = PreviewTailoringChangesCommandInputSchema.parse(input);
  return {
    operationId: parsed.operationId,
    ...validateEachTailoringDiffLocally({
      branch: parsed.session.branch,
      diffs: parsed.selectedDiffs as ResumeTailoringDiff[],
      confirmedRequirementIds: parsed.confirmedRequirementIds,
      allowUnconfirmed: false
    })
  };
}

export async function applyTailoringSessionCommand(input: {
  repository: WorkspaceRepository;
  operationId: string;
  session: TailoringSession;
  selectedDiffs: ResumeTailoringDiff[];
  confirmedRequirementIds?: string[];
  signal?: AbortSignal;
}) {
  assertNotCancelled(input.signal);
  const parsed = ApplyTailoringSessionCommandInputSchema.parse({
    operationId: input.operationId,
    session: input.session,
    selectedDiffs: input.selectedDiffs,
    confirmedRequirementIds: input.confirmedRequirementIds ?? []
  });
  const result = await input.repository.applyTailoringDiffs({
    branchId: parsed.session.branch.id,
    jobId: parsed.session.job.id,
    diffs: input.selectedDiffs,
    confirmedRequirementIds: parsed.confirmedRequirementIds,
    operationId: parsed.operationId,
    expectedBranchRevision: parsed.session.branch.revision,
    expectedRevisionId: parsed.session.branch.currentRevisionId ?? ""
  });
  assertNotCancelled(input.signal);
  return { operationId: parsed.operationId, ...result };
}

function dedupeDiffs(diffs: ResumeTailoringDiff[]) {
  const seen = new Set<string>();
  return diffs.filter((diff) => {
    const key = `${diff.target.itemId}:${diff.target.fieldPath}:${diff.operation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw commandError("operation_cancelled");
}

function commandError(code: string) {
  return Object.assign(new Error(code), { code });
}
