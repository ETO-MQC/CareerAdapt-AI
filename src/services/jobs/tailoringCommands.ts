import { z } from "zod";
import {
  CareerProfileSchema,
  JdSemanticAssignmentSchema,
  JobDescriptionSchema,
  JobRequirementGraphV4Schema,
  JobTargetSnapshotSchema,
  ResumeBranchSchema,
  ResumeTailorTaskInputV2Schema,
  ResumeTailoringDiffModelOutputSchema,
  ResumeTailoringDiffTaskInputSchema,
  ResumeTailoringPlanSchema,
  TailoringGapSchema,
  TailoringIntensitySchema,
  type ResumeTailoringDiff,
  type ResumeTailoringDiffModelOutput,
  type ResumeTailoringDiffTaskInput,
  type ResumeTailorTaskInputV2,
  type TailoringRequirement,
  type TailoringRetryReasonCode,
  type TailoringUserDeclaration
} from "@/domain/schemas";
import {
  analyzeJobDescriptionV4,
  analyzeKeywordAndCapabilityGaps,
  dedupeTailoringDiffs,
  validateEachTailoringDiffLocally
} from "@/domain/jobOptimization";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { stableHashText } from "@/services/security/text";
import { consumeTailoringQuestionAnswer, createTailoringPlan, createTailoringQuestionPlan, isTailoringQuestionPlanComplete, tailoringAnswerRevisionHash } from "./tailoringService";
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
  targetSnapshot: JobTargetSnapshotSchema.optional(),
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
  targetSnapshot: JobTargetSnapshotSchema.optional(),
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
  proficiency: z.enum(["proficient", "familiar", "aware", "learning"]).optional(),
  answerMessageId: z.string().min(1).optional()
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

/**
 * The review ledger is the only source of truth for what may be applied.
 * selectedDiffs remains in the transport contract for compatibility, but it
 * is deliberately not trusted at the write boundary.
 */
export function reviewedTailoringDiffs(session: TailoringSession) {
  const reviews = new Map((session.plan.diffReviews ?? []).map((review) => [review.diffId, review]));
  return (session.plan.diffs ?? []).flatMap((diff) => {
    const review = reviews.get(tailoringDiffId(diff));
    if (!review || (review.status !== "accepted" && review.status !== "edited")) return [];
    return [{
      ...diff,
      value: review.status === "edited" ? review.editedValue! : diff.value
    }];
  });
}

export function tailoringReviewCounts(session: TailoringSession) {
  const reviews = new Map((session.plan.diffReviews ?? []).map((review) => [review.diffId, review]));
  const diffs = session.plan.diffs ?? [];
  const acceptedDiffIds = diffs.flatMap((diff) => reviews.get(tailoringDiffId(diff))?.status === "accepted" ? [tailoringDiffId(diff)] : []);
  const editedDiffIds = diffs.flatMap((diff) => reviews.get(tailoringDiffId(diff))?.status === "edited" ? [tailoringDiffId(diff)] : []);
  const rejectedDiffIds = diffs.flatMap((diff) => reviews.get(tailoringDiffId(diff))?.status === "rejected" ? [tailoringDiffId(diff)] : []);
  const remainingDiffCount = diffs.filter((diff) => reviews.get(tailoringDiffId(diff))?.status === "suggested").length;
  return {
    acceptedDiffIds,
    editedDiffIds,
    rejectedDiffIds,
    acceptedDiffCount: acceptedDiffIds.length + editedDiffIds.length,
    remainingDiffCount
  };
}

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
    ...(parsed.targetSnapshot ? { targetSnapshot: parsed.targetSnapshot } : {}),
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
  signal?: AbortSignal;
}) {
  const parsed = GenerateTailoringDiffsCommandInputSchema.parse({ operationId: input.operationId, session: input.session });
  const accepted: ResumeTailoringDiff[] = [];
  const rejected: Array<{ diff: ResumeTailoringDiff; reasonCode: string }> = [];
  const warnings: string[] = [];
  const generationDiagnostics: Array<{ code: string; targetItemId?: string; detail?: string }> = [];
  let providerCallCount = 0;
  let retryCount = 0;
  if (!isTailoringQuestionPlanComplete(parsed.session.plan)) {
    throw commandError("tailoring_questions_incomplete");
  }
  const clarifications = [...(parsed.session.plan.clarificationQuestions ?? [])];
  const answerContext = buildTailoringAnswerContext(parsed.session);

  const selectedRequirementIds = new Set<string>();
  const requests = prioritizeTailoringTargets(parsed.session.taskInputs).flatMap((taskInput) => {
    if (!taskInput.target.itemId) return [];
    const request = ResumeTailoringDiffTaskInputSchema.parse({
      ...taskInput,
      target: {
        ...taskInput.target,
        fieldPath: taskInput.target.fieldPath.split(".").at(-1)
      },
      allowedOperation: "replace",
      requirementDetails: requirementDetailsFor(taskInput.relevantRequirements),
      evidenceBundle: mergeAnswerContext(taskInput.evidenceBundle, answerContext),
      wholeResumeContext: {
        ...(taskInput.wholeResumeContext ?? {}),
        alreadySelectedRequirementIds: [...selectedRequirementIds].slice(0, 8)
      }
    });
    taskInput.relevantRequirements.forEach((requirement) => selectedRequirementIds.add(requirement.requirementId));
    return [request];
  });

  for (const request of requests) {
    assertNotCancelled(input.signal);
    let first: ResumeTailoringDiffModelOutput | undefined;
    let firstValidation = validateEachTailoringDiffLocally({
      branch: parsed.session.branch,
      diffs: [],
      forbiddenTerms: answerContext.forbiddenTerms,
      confirmedUserDeclarations: answerContext.confirmedUserDeclarations,
      requirementTexts: request.relevantRequirements.map((item) => item.description)
    });
    providerCallCount += 1;
    try {
      first = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(request, input.signal));
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "schema validation failed";
      warnings.push(`invalid_ai_output:${request.target.itemId}`);
      generationDiagnostics.push({ code: "invalid_ai_output", targetItemId: request.target.itemId, detail });
    }
    firstValidation = validateEachTailoringDiffLocally({
      branch: parsed.session.branch,
      diffs: first?.diffs ?? [],
      forbiddenTerms: answerContext.forbiddenTerms,
      confirmedUserDeclarations: answerContext.confirmedUserDeclarations,
      requirementTexts: request.relevantRequirements.map((item) => item.description)
    });
    if (firstValidation.appliedDiffs.length) accepted.push(...firstValidation.appliedDiffs);
    warnings.push(...firstValidation.warnings);

    const firstReasonCodes = retryReasonCodes(first, firstValidation);
    if (firstValidation.rejectedDiffs.length || !first) {
      retryCount += 1;
      generationDiagnostics.push(...firstValidation.rejectedDiffs.map((item) => ({ code: `rejected_${item.reasonCode}`, targetItemId: request.target.itemId })));
      const retryRequest = ResumeTailoringDiffTaskInputSchema.parse({ ...request, retryContext: { reasonCodes: firstReasonCodes, attempt: 1 } });
      let retried: ResumeTailoringDiffModelOutput | undefined;
      providerCallCount += 1;
      try {
        retried = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(retryRequest, input.signal));
      } catch (error) {
        const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 160) : "schema validation failed";
        warnings.push(`invalid_ai_output_after_retry:${request.target.itemId}`);
        generationDiagnostics.push({ code: "invalid_ai_output_after_retry", targetItemId: request.target.itemId, detail });
      }
      if (!retried) {
        rejected.push(...firstValidation.rejectedDiffs);
        continue;
      }
      const retryValidation = validateEachTailoringDiffLocally({
        branch: parsed.session.branch,
        diffs: retried.diffs,
        forbiddenTerms: answerContext.forbiddenTerms,
        confirmedUserDeclarations: answerContext.confirmedUserDeclarations,
        requirementTexts: request.relevantRequirements.map((item) => item.description)
      });
      accepted.push(...retryValidation.appliedDiffs);
      rejected.push(...retryValidation.rejectedDiffs);
      warnings.push(...retryValidation.warnings);
      generationDiagnostics.push(...retryValidation.rejectedDiffs.map((item) => ({ code: `rejected_after_retry_${item.reasonCode}`, targetItemId: request.target.itemId })));
      if (!retried.diffs.length && retried.clarifications.length) {
        generationDiagnostics.push({ code: "insufficient_evidence_after_question_plan", targetItemId: request.target.itemId });
      }
    } else if (!first.diffs.length) {
      generationDiagnostics.push({
        code: first.clarifications.length ? "insufficient_evidence_after_question_plan" : "no_change_needed",
        targetItemId: request.target.itemId
      });
    }
  }

  const dedupeResult = dedupeTailoringDiffs(accepted);
  const dedupedDiffs = dedupeResult.appliedDiffs;
  rejected.push(...dedupeResult.rejectedDiffs);
  generationDiagnostics.push(...dedupeResult.rejectedDiffs.map((item) => ({ code: `rejected_${item.reasonCode}`, targetItemId: item.diff.target.itemId })));
  const generatedAnswerRevisionHash = tailoringAnswerRevisionHash(parsed.session.plan);
  const generatedQuestionPlanRevision = parsed.session.plan.questionPlan?.revision;
  const plan = ResumeTailoringPlanSchema.parse({
    ...parsed.session.plan,
    diffs: dedupedDiffs,
    generationStatus: "completed",
    answerRevisionHash: generatedAnswerRevisionHash,
    generatedDiffsBasedOnQuestionPlanRevision: generatedQuestionPlanRevision,
    generatedDiffsBasedOnAnswerRevisionHash: generatedAnswerRevisionHash,
    generationDiagnostics: generationDiagnostics,
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
    warnings: [...new Set(warnings)],
    generationStats: {
      selectedTargetCount: requests.length,
      providerCallCount,
      retryCount,
      acceptedDiffCount: dedupedDiffs.length
    }
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
  const consumed = consumeTailoringQuestionAnswer({
    session: parsed.session as unknown as Record<string, unknown>,
    questionId: question.id,
    answer: parsed.answer,
    proficiency: parsed.proficiency,
    branch: parsed.session.branch,
    operationId: parsed.operationId,
    answerMessageId: parsed.answerMessageId ?? `answer-message-${parsed.operationId}`
  });
  const session = TailoringSessionSchema.parse(consumed.session);
  return {
    operationId: parsed.operationId,
    session
  };
}

export function prioritizeTailoringTargets(taskInputs: TailoringSession["taskInputs"]) {
  const remaining = [...taskInputs];
  const selected: TailoringSession["taskInputs"] = [];
  const coveredRequirementIds = new Set<string>();
  const coveredKeywords = new Set<string>();
  while (remaining.length && selected.length < 6) {
    const ranked = remaining.map((taskInput) => ({
      taskInput,
      score: tailoringTargetScore(taskInput, coveredRequirementIds, coveredKeywords)
    })).sort((left, right) => right.score - left.score || stableTargetKey(left.taskInput).localeCompare(stableTargetKey(right.taskInput)));
    const next = ranked[0].taskInput;
    selected.push(next);
    remaining.splice(remaining.indexOf(next), 1);
    next.relevantRequirements.forEach((requirement) => {
      coveredRequirementIds.add(requirement.requirementId);
      requirement.keywords.forEach((keyword) => coveredKeywords.add(keyword.toLocaleLowerCase()));
    });
  }
  return selected;
}

function tailoringTargetScore(
  taskInput: TailoringSession["taskInputs"][number],
  coveredRequirementIds: Set<string>,
  coveredKeywords: Set<string>
) {
  const sectionScore: Record<string, number> = {
    project: 34,
    work: 32,
    internship: 29,
    summary: 12,
    skills: 10,
    ordering: 0
  };
  const evidence = taskInput.evidenceBundle;
  const evidenceScore = (evidence?.directEvidence.length ?? 0) * 18
    + (evidence?.relatedResumeEvidence.length ?? 0) * 12
    + (evidence?.relatedProfileEvidence.length ?? 0) * 7
    + (evidence?.confirmedUserDeclarations.length ?? 0) * 9
    + Math.min(taskInput.allowedEvidenceRefs.length, 6) * 2;
  const requirementsScore = taskInput.relevantRequirements.reduce((total, requirement) => {
    const priority = requirement.priority === "must" ? 34 : requirement.priority === "high" ? 28 : requirement.priority === "medium" ? 17 : 9;
    const coveragePenalty = coveredRequirementIds.has(requirement.requirementId) ? 24 : 0;
    const keywordRedundancy = requirement.keywords.filter((keyword) => coveredKeywords.has(keyword.toLocaleLowerCase())).length * 3;
    const evidenceNeed = requirement.evidenceNeed ? 5 : 0;
    return total + priority + Math.min(24, requirement.relevanceScore * 2) + evidenceNeed - coveragePenalty - keywordRedundancy;
  }, 0);
  const specificityScore = [taskInput.currentContent.structuredItem, taskInput.currentContent.fieldValue]
    .map((value) => JSON.stringify(value).length)
    .reduce((total, length) => total + Math.min(8, Math.floor(length / 80)), 0);
  const redundancyPenalty = taskInput.target.sectionType === "summary" && coveredRequirementIds.size > 0 ? 14 : 0;
  return (sectionScore[taskInput.target.sectionType] ?? 0) + evidenceScore + requirementsScore + specificityScore - redundancyPenalty;
}

function stableTargetKey(taskInput: TailoringSession["taskInputs"][number]) {
  return `${taskInput.target.sectionType}:${taskInput.target.itemId ?? taskInput.target.sectionId}:${taskInput.target.fieldPath}`;
}

function requirementDetailsFor(requirements: TailoringRequirement[]) {
  return Object.fromEntries(requirements.map((requirement) => [requirement.requirementId, {
    requirementId: requirement.requirementId,
    detailClauses: requirement.detailClauses ?? [],
    semanticAliases: requirement.semanticAliases ?? [],
    hardConstraint: requirement.hardConstraint ?? false,
    ...(requirement.parentGroupId ? { parentGroupId: requirement.parentGroupId } : {}),
    ...(requirement.evidenceNeed ? { evidenceExpectation: requirement.evidenceNeed } : {})
  }]));
}

function buildTailoringAnswerContext(session: TailoringSession) {
  const questions = new Map((session.plan.clarificationQuestions ?? []).map((question) => [question.id, question]));
  const declarations: {
    confirmedUserDeclarations: TailoringUserDeclaration[];
    negativeUserDeclarations: TailoringUserDeclaration[];
    uncertainUserDeclarations: TailoringUserDeclaration[];
    forbiddenTerms: string[];
  } = {
    confirmedUserDeclarations: [],
    negativeUserDeclarations: [],
    uncertainUserDeclarations: [],
    forbiddenTerms: []
  };
  for (const answer of session.plan.clarificationAnswers ?? []) {
    const question = questions.get(answer.questionId);
    if (!question) continue;
    const value = answerValueForDeclaration(answer.answer, question.candidateClaim);
    const declaration = {
      questionId: answer.questionId,
      value,
      requirementIds: question.requirementIds,
      ...(answer.proficiency ? { proficiency: answer.proficiency } : {})
    } satisfies TailoringUserDeclaration;
    if (answer.status === "accepted") declarations.confirmedUserDeclarations.push(declaration);
    if (answer.status === "rejected") declarations.negativeUserDeclarations.push(declaration);
    if (answer.status === "uncertain" || answer.status === "skipped") declarations.uncertainUserDeclarations.push(declaration);
    if (answer.status !== "accepted") {
      declarations.forbiddenTerms.push(value, question.candidateClaim, ...forbiddenTermTokens(value), ...forbiddenTermTokens(question.candidateClaim));
    }
  }
  declarations.forbiddenTerms = [...new Set(declarations.forbiddenTerms.map((value) => value.trim()).filter((value) => value.length > 1))];
  return declarations;
}

function forbiddenTermTokens(value: string) {
  return value.split(/[^\p{L}\p{N}+#.-]+/u).map((item) => item.trim()).filter((item) => item.length > 1);
}

function answerValueForDeclaration(answer: string | string[] | boolean | undefined, fallback: string) {
  if (typeof answer === "string" && answer.trim()) return answer.trim();
  if (Array.isArray(answer) && answer.length) return answer.join("、");
  if (answer === true) return fallback;
  return fallback;
}

function mergeAnswerContext(
  evidenceBundle: ResumeTailorTaskInputV2["evidenceBundle"],
  answerContext: ReturnType<typeof buildTailoringAnswerContext>
) {
  const hasAnswerContext = answerContext.confirmedUserDeclarations.length
    || answerContext.negativeUserDeclarations.length
    || answerContext.uncertainUserDeclarations.length;
  if (!evidenceBundle && !hasAnswerContext) return undefined;
  return {
    directEvidence: evidenceBundle?.directEvidence ?? [],
    relatedResumeEvidence: evidenceBundle?.relatedResumeEvidence ?? [],
    relatedProfileEvidence: evidenceBundle?.relatedProfileEvidence ?? [],
    confirmableSignals: evidenceBundle?.confirmableSignals ?? [],
    confirmedUserDeclarations: [
      ...(evidenceBundle?.confirmedUserDeclarations ?? []),
      ...answerContext.confirmedUserDeclarations
    ],
    negativeUserDeclarations: [
      ...(evidenceBundle?.negativeUserDeclarations ?? []),
      ...answerContext.negativeUserDeclarations
    ],
    uncertainUserDeclarations: [
      ...(evidenceBundle?.uncertainUserDeclarations ?? []),
      ...answerContext.uncertainUserDeclarations
    ]
  };
}

function retryReasonCodes(
  output: ResumeTailoringDiffModelOutput | undefined,
  validation: ReturnType<typeof validateEachTailoringDiffLocally>
): TailoringRetryReasonCode[] {
  const allowed = new Set<string>([
    "invalid_ai_output", "no_op", "mechanical_prefix", "duplicate_original", "truncated_output",
    "responsibility_upgrade", "invented_metric", "duplicate_sentence", "generic_proficiency_sentence",
    "malformed_chinese_phrase", "insufficient_evidence"
  ]);
  const codes: TailoringRetryReasonCode[] = validation.rejectedDiffs
    .map((item) => item.reasonCode)
    .filter((code) => allowed.has(code))
    .map((code) => code as TailoringRetryReasonCode);
  if (!codes.length && output?.clarifications.length) codes.push("insufficient_evidence");
  if (!codes.length) codes.push("invalid_ai_output");
  return [...new Set(codes)].slice(0, 4);
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
  const selectedDiffs = reviewedTailoringDiffs(session);
  const counts = tailoringReviewCounts(session);
  return {
    operationId,
    session,
    selectedDiffs,
    selectedDiffIds: [...counts.acceptedDiffIds, ...counts.editedDiffIds],
    acceptedDiffIds: counts.acceptedDiffIds,
    editedDiffIds: counts.editedDiffIds,
    rejectedDiffIds: counts.rejectedDiffIds,
    acceptedDiffCount: counts.acceptedDiffCount,
    remainingDiffCount: counts.remainingDiffCount,
    idempotent
  };
}

export function previewTailoringChangesCommand(input: z.input<typeof PreviewTailoringChangesCommandInputSchema>, signal?: AbortSignal) {
  assertNotCancelled(signal);
  const parsed = PreviewTailoringChangesCommandInputSchema.parse(input);
  const reviewed = reviewedTailoringDiffs(parsed.session);
  const answerContext = buildTailoringAnswerContext(parsed.session);
  return {
    operationId: parsed.operationId,
    ...validateEachTailoringDiffLocally({
      branch: parsed.session.branch,
      diffs: reviewed,
      confirmedRequirementIds: parsed.confirmedRequirementIds,
      explicitlyAcceptedDiffs: reviewed,
      allowUnconfirmed: false,
      forbiddenTerms: answerContext.forbiddenTerms,
      confirmedUserDeclarations: answerContext.confirmedUserDeclarations,
      requirementTexts: parsed.session.plan.clarificationQuestions?.map((question) => question.requirementText ?? question.candidateClaim) ?? []
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
  const selectedDiffs = reviewedTailoringDiffs(parsed.session);
  if (selectedDiffs.length === 0) throw commandError("tailoring_no_selected_changes");
  const answerContext = buildTailoringAnswerContext(parsed.session);
  const finalValidation = validateEachTailoringDiffLocally({
    branch: parsed.session.branch,
    diffs: selectedDiffs,
    confirmedRequirementIds: parsed.confirmedRequirementIds,
    explicitlyAcceptedDiffs: selectedDiffs,
    allowUnconfirmed: false,
    submissionSafe: true,
    forbiddenTerms: answerContext.forbiddenTerms,
    confirmedUserDeclarations: answerContext.confirmedUserDeclarations,
    requirementTexts: parsed.session.plan.clarificationQuestions?.map((question) => question.requirementText ?? question.candidateClaim) ?? []
  });
  if (finalValidation.rejectedDiffs.length || finalValidation.patches.length !== selectedDiffs.length) {
    throw commandError("tailoring_apply_validation_failed");
  }
  const result = await input.repository.applyTailoringDiffs({
    branchId: parsed.session.branch.id,
    jobId: parsed.session.job.id,
    diffs: selectedDiffs,
    confirmedRequirementIds: parsed.confirmedRequirementIds,
    operationId: parsed.operationId,
    expectedBranchRevision: parsed.session.branch.revision,
    expectedRevisionId: parsed.session.branch.currentRevisionId ?? ""
  });
  assertNotCancelled(input.signal);
  if (
    !result.revision
    || result.appliedDiffs.length !== selectedDiffs.length
    || result.beforeContentHash === result.afterContentHash
  ) {
    throw commandError("tailoring_apply_verification_failed");
  }
  return {
    ...result,
    operationId: parsed.operationId,
    acceptedDiffIds: result.appliedDiffs.map(tailoringDiffId),
    acceptedDiffCount: result.appliedDiffs.length
  };
}

function assertNotCancelled(signal?: AbortSignal) {
  if (signal?.aborted) throw commandError("operation_cancelled");
}

function commandError(code: string) {
  return Object.assign(new Error(code), { code });
}
