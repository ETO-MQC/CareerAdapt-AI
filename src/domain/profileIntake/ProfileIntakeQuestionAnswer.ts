import { z } from "zod";

export const ProfileIntakeQuestionAnswerStatusSchema = z.enum(["answered", "skipped"]);

/**
 * Durable answer ledger entry.  `questionId + sourceTurnId` is the exact-once
 * identity; follow-up counts are only a compatibility summary and are never
 * the source of truth for whether a question was answered.
 */
export const ProfileIntakeQuestionAnswerSchema = z.object({
  questionId: z.string().min(1),
  candidateId: z.string().min(1),
  dimension: z.string().min(1),
  sourceTurnId: z.string().min(1),
  answerRevision: z.number().int().min(0),
  status: ProfileIntakeQuestionAnswerStatusSchema,
  capturedAt: z.string().datetime({ offset: true })
}).strict();

export type ProfileIntakeQuestionAnswer = z.infer<typeof ProfileIntakeQuestionAnswerSchema>;

export function questionAnswerIdentity(answer: Pick<ProfileIntakeQuestionAnswer, "questionId" | "sourceTurnId">) {
  return `${answer.questionId}::${answer.sourceTurnId}`;
}

export function appendProfileIntakeQuestionAnswer(
  answers: ProfileIntakeQuestionAnswer[],
  answer: ProfileIntakeQuestionAnswer
) {
  const identity = questionAnswerIdentity(answer);
  if (answers.some((candidate) => questionAnswerIdentity(candidate) === identity)) {
    return { answers, appended: false };
  }
  return {
    answers: [...answers, ProfileIntakeQuestionAnswerSchema.parse(answer)],
    appended: true
  };
}

