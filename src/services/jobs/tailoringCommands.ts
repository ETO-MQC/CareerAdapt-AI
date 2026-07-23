import { z } from "zod";
import {
  CareerProfileSchema,
  JdSemanticAssignmentSchema,
  JobDescriptionSchema,
  JobRequirementGraphV4Schema,
  ResumeBranchSchema,
  ResumeTailorTaskInputV2Schema,
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
import { stableHashText } from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { answerTailoringClarification, createTailoringPlan } from "./tailoringService";

const OperationIdSchema = z.string().min(8).max(160);

export const TailoringSessionSchema = z.object({
  id: z.string().min(1),
  operationId: OperationIdSchema,
  profile: CareerProfileSchema,
  branch: ResumeBranchSchema,
  job: JobDescriptionSchema,
  plan: ResumeTailoringPlanSchema,
  taskInputs: z.array(ResumeTailorTaskInputV2Schema),
  gaps: z.array(TailoringGapSchema),
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
  const plan = ResumeTailoringPlanSchema.parse({ ...planned.plan, gaps });
  const session = TailoringSessionSchema.parse({
    id: `tailoring-session-${stableHashText(parsed.operationId)}`,
    operationId: parsed.operationId,
    profile: parsed.profile,
    branch: parsed.branch,
    job: parsed.job,
    plan,
    taskInputs: planned.taskInputs,
    gaps,
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
  const clarifications = [...(parsed.session.plan.clarificationQuestions ?? [])];

  for (const taskInput of parsed.session.taskInputs) {
    assertNotCancelled(input.signal);
    if (!taskInput.target.itemId) continue;
    const request = ResumeTailoringDiffTaskInputSchema.parse({
      ...taskInput,
      target: {
        ...taskInput.target,
        fieldPath: taskInput.target.fieldPath.split(".").at(-1)
      },
      allowedOperation: "replace",
      requirementDetails: {}
    });
    let first: ResumeTailoringDiffModelOutput | undefined;
    try {
      first = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(request, input.signal));
    } catch {
      warnings.push(`invalid_ai_output:${taskInput.target.itemId}`);
    }
    const firstValidation = validateEachTailoringDiffLocally({ branch: parsed.session.branch, diffs: first?.diffs ?? [] });
    accepted.push(...firstValidation.appliedDiffs);
    warnings.push(...firstValidation.warnings);
    if (first) appendClarifications(clarifications, request, first, parsed.operationId);

    if (!first || firstValidation.rejectedDiffs.length || (!first.diffs.length && !first.clarifications.length)) {
      const retryRequest = ResumeTailoringDiffTaskInputSchema.parse({ ...request, retryContext: { previousWasNoOp: true } });
      let retried: ResumeTailoringDiffModelOutput | undefined;
      try {
        retried = ResumeTailoringDiffModelOutputSchema.parse(await input.generate(retryRequest, input.signal));
      } catch {
        warnings.push(`invalid_ai_output_after_retry:${taskInput.target.itemId}`);
      }
      if (!retried) {
        rejected.push(...firstValidation.rejectedDiffs);
        continue;
      }
      const retryValidation = validateEachTailoringDiffLocally({ branch: parsed.session.branch, diffs: retried.diffs });
      accepted.push(...retryValidation.appliedDiffs);
      rejected.push(...retryValidation.rejectedDiffs);
      warnings.push(...retryValidation.warnings);
      appendClarifications(clarifications, retryRequest, retried, parsed.operationId);
    }
  }

  const dedupedDiffs = dedupeDiffs(accepted);
  const plan = ResumeTailoringPlanSchema.parse({
    ...parsed.session.plan,
    diffs: dedupedDiffs,
    clarificationQuestions: clarifications
  });
  return {
    operationId: parsed.operationId,
    session: TailoringSessionSchema.parse({ ...parsed.session, plan }),
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
  const plan = answerTailoringClarification({
    plan: parsed.session.plan,
    question,
    answer: parsed.answer,
    proficiency: parsed.proficiency,
    branch: parsed.session.branch
  });
  return { operationId: parsed.operationId, session: TailoringSessionSchema.parse({ ...parsed.session, plan }) };
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

function appendClarifications(
  target: NonNullable<TailoringSession["plan"]["clarificationQuestions"]>,
  request: ResumeTailoringDiffTaskInput,
  output: ResumeTailoringDiffModelOutput,
  operationId: string
) {
  for (const [index, clarification] of output.clarifications.entries()) {
    const itemId = request.target.itemId;
    if (!itemId) continue;
    const id = `tailoring-question-${stableHashText(`${operationId}:${itemId}:${index}:${clarification.question}`)}`;
    if (target.some((item) => item.id === id)) continue;
    target.push({
      id,
      question: clarification.question,
      requirementIds: clarification.requirementIds,
      sourceItemIds: [itemId],
      relatedItemIds: [itemId],
      candidateClaim: clarification.question,
      targetFieldPaths: [request.target.fieldPath],
      answerType: clarification.answerType
    });
  }
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
