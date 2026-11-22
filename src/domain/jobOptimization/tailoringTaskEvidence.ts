import type { AgentMessageRecord, AgentSession } from "@/agent/contracts/agentSession";
import type { ResumeTailoringDiff } from "@/domain/schemas";
import { TailoringSessionSchema } from "@/services/jobs/tailoringCommands";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";

/** A task-scoped declaration resolved exclusively from persisted session and user records. */
export type TailoringTaskEvidence = {
  diffId: string;
  sessionId: string;
  taskId: string;
  questionPlanId: string;
  questionId: string;
  answerRevision: number;
  sourceMessageId: string;
  questionMessageId?: string;
  confirmationMethod: "explicit_statement" | "answer_to_persisted_question";
  confirmationAnswer?: string;
  questionText?: string;
  confirmedAt: string;
  factText: string;
  targetField: string;
};

export function mayUseTailoringTaskEvidence(diffs: ResumeTailoringDiff[]) {
  return diffs.some((diff) => diff.supportLevel === "user_declared" || (
    Array.isArray(diff.original) && Array.isArray(diff.value) && diff.value.length > diff.original.length
  ));
}

export function resolveTailoringTaskEvidence(input: {
  session: AgentSession;
  messages: AgentMessageRecord[];
  taskId: string;
  jobId: string;
  branchId: string;
  baseRevisionId: string;
  diffs: ResumeTailoringDiff[];
}): TailoringTaskEvidence[] {
  const task = input.session.taskState;
  const parsed = TailoringSessionSchema.safeParse(task?.knownSlots.tailoringSession);
  if (!task || !parsed.success || task.completionStatus === "cancelled" || task.completionStatus === "completed") return [];
  const tailoring = parsed.data;
  if (tailoring.id !== input.taskId || tailoring.job.id !== input.jobId || tailoring.branch.id !== input.branchId
    || tailoring.branch.currentRevisionId !== input.baseRevisionId || task.selectedEntities.resumeId !== input.branchId
    || task.selectedEntities.jobId !== input.jobId || tailoring.profile.id !== tailoring.branch.profileId
    || task.selectedEntities.profileId !== tailoring.profile.id
    || (task.selectedEntities.resumeRevisionId ?? task.selectedEntities.revisionId) !== input.baseRevisionId) return [];
  const plan = tailoring.plan;
  if (!plan.questionPlan || plan.questionPlan.sessionId !== tailoring.id) return [];
  const out: TailoringTaskEvidence[] = [];
  for (const diff of input.diffs) {
    // Only exact, append-only user statements qualify. This deliberately does not
    // authorize a model paraphrase, a replacement of existing content or an
    // unrelated factual addition merely because it contains matching keywords.
    if (diff.operation !== "replace" || !Array.isArray(diff.original) || !Array.isArray(diff.value)) continue;
    const original = diff.original;
    const value = diff.value;
    if (value.length <= original.length || original.some((item, index) => value[index] !== item)) continue;
    const additions = value.slice(original.length);
    const evidence: TailoringTaskEvidence[] = [];
    for (const text of additions) {
      const question = plan.clarificationQuestions?.find((item) =>
        (item.sourceItemIds.includes(diff.target.itemId) || item.relatedItemIds.includes(diff.target.itemId))
        && item.targetFieldPaths.some((path) => path === diff.target.fieldPath || path.endsWith(`.${diff.target.fieldPath}`))
        && item.requirementIds.some((id) => diff.requirementIds.includes(id)));
      const answer = plan.clarificationAnswers?.find((item) => item.questionId === question?.id);
      const receipt = plan.answerReceipts.find((item) => item.questionId === question?.id);
      const message = input.messages.find((item) => item.id === receipt?.answerMessageId);
      const metadataReceipt = message?.metadata?.tailoringAnswerReceipt as Record<string, unknown> | undefined;
      const factText = text.trim();
      const answerText = typeof answer?.answer === "string" ? answer.answer.trim() : "";
      const affirmative = /^(?:是|是的|对|对的|确认|有)[。.!！\s]*$/u.test(answerText);
      const statement = question?.candidateClaim.trim().replace(/[。.!！?？\s]+$/u, "") ?? "";
      const normalizedStatement = statement.replace(/\s+/gu, "");
      const questionMessage = affirmative && message && question && statement.length >= 6
        && factText.replace(/[。.!！\s]+$/u, "") === statement
        ? input.messages.find((item) => item.role === "assistant" && item.sessionId === input.session.id
          && item.branchId === input.session.activeBranchId && item.sequence < message.sequence
          && item.metadata?.tailoringQuestionProjection === true && item.metadata?.questionId === question.id
          && item.metadata?.questionPlanId === plan.questionPlan!.id
          && item.metadata?.questionText === question.question && item.metadata?.questionProjectionState === "resolved"
          && item.metadata?.answerMessageId === message.id && item.content.split("\n").some((line) => line.trim() === question.question.trim())
          && [ `你是否${normalizedStatement}`, `是否${normalizedStatement}` ].includes(
            question.question.replace(/[。.!！?？\s]+/gu, "")))
        : undefined;
      const exactStatement = answerText === factText && !/^(?:是|是的|对|对的|好|好的|可以|可以的|确认|有|嗯|嗯嗯|同意|ok|okay|yes|sure)[。.!！\s]*$/iu.test(answerText);
      if (!question || question.status !== "answered" || !plan.questionPlan.questionIds.includes(question.id)
        || !answer || answer.status !== "accepted" || !answerText || !(exactStatement || questionMessage)
        || !receipt || receipt.disposition !== "answered" || receipt.questionPlanId !== plan.questionPlan.id
        || receipt.questionPlanRevision > plan.questionPlan.revision || answer.resolvedAt !== receipt.consumedAt
        || question.answer !== undefined && question.answer !== answerText
        || question.answeredAt !== undefined && question.answeredAt !== receipt.consumedAt
        || receipt.answerText !== answerText || !message || message.role !== "user" || message.sessionId !== input.session.id
        || message.status !== "complete" || !message.turnId || message.branchId !== input.session.activeBranchId || message.content.trim() !== answerText
        || !metadataReceipt || metadataReceipt.questionId !== receipt.questionId
        || metadataReceipt.questionPlanId !== receipt.questionPlanId || metadataReceipt.questionPlanRevision !== receipt.questionPlanRevision
        || metadataReceipt.answerMessageId !== message.id || metadataReceipt.answerText !== answerText
        || metadataReceipt.disposition !== "answered" || metadataReceipt.consumedAt !== receipt.consumedAt
        || /没有|没用过|没做过|未使用|未做过|不具备|不会|不了解|不确定|尚未|可能|大概|听说|想学|\b(?:maybe|perhaps|not|never|unsure)\b/iu.test(factText)) continue;
      evidence.push({ diffId: tailoringDiffId(diff), sessionId: input.session.id, taskId: tailoring.id,
        questionPlanId: receipt.questionPlanId, questionId: question.id, answerRevision: answer.answerRevision,
        sourceMessageId: message.id, confirmedAt: receipt.consumedAt, factText,
        confirmationMethod: questionMessage ? "answer_to_persisted_question" : "explicit_statement",
        ...(questionMessage ? { questionMessageId: questionMessage.id, questionText: question.question,
          confirmationAnswer: answerText } : {}),
        targetField: `${diff.target.sectionId}.${diff.target.itemId}.${diff.target.fieldPath}` });
    }
    if (evidence.length === additions.length) out.push(...evidence);
  }
  return out;
}
