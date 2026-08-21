export type CompoundAnswerValue = string | string[] | boolean;

export type CompoundAnswerResolution = {
  answers: Array<{
    questionId: string;
    answer: CompoundAnswerValue;
    evidenceQuote: string;
    proficiency?: "proficient" | "familiar" | "aware" | "learning";
  }>;
  unmatchedText?: string;
};

export type PendingCompoundQuestion = {
  id: string;
  question: string;
  answerType: "boolean" | "single_select" | "proficiency" | "multi_select" | "text" | "url";
  options?: Array<{ id: string; label: string; value: string }>;
};

const DIMENSIONS = [
  { question: /数据库|database|存储/i, evidence: /SQLite|MySQL|PostgreSQL|MongoDB|数据库|存储/i },
  { question: /上线|发布|部署|production/i, evidence: /上线|发布|部署|production/i },
  { question: /Kotlin/i, evidence: /Kotlin/i },
  { question: /Java/i, evidence: /Java(?!Script)/i },
  { question: /框架|framework/i, evidence: /FastAPI|Spring|React|Vue|框架/i },
  { question: /链接|地址|url/i, evidence: /https?:\/\/\S+/i }
] as const;

export function resolveCompoundAnswer(
  message: string,
  unresolvedQuestions: readonly PendingCompoundQuestion[]
): CompoundAnswerResolution {
  // Conversational tailoring exposes one authoritative question at a time.
  // Multi-question matching is intentionally unavailable in the default flow.
  const visibleQuestions = unresolvedQuestions.slice(0, 1);
  const authoritative = new Map(visibleQuestions.map((question) => [question.id, question]));
  const remaining = new Set(authoritative.keys());
  const answers: CompoundAnswerResolution["answers"] = [];
  const unmatched: string[] = [];
  const clauses = splitClauses(message);

  if (clauses.length === 1 && visibleQuestions[0]) {
    const evidenceQuote = message.trim();
    const parsed = parseAnswer(visibleQuestions[0], evidenceQuote);
    if (parsed) {
      return { answers: [{ questionId: visibleQuestions[0].id, evidenceQuote, ...parsed }] };
    }
  }

  for (const clause of clauses) {
    const candidates = [...remaining]
      .map((id) => authoritative.get(id)!)
      .map((question) => ({ question, score: matchScore(question, clause) }))
      .sort((left, right) => right.score - left.score);
    if (!candidates.length) {
      unmatched.push(clause);
      continue;
    }
    const question = candidates[0].question;
    const parsed = parseAnswer(question, clause);
    if (!parsed) {
      unmatched.push(clause);
      continue;
    }
    answers.push({ questionId: question.id, evidenceQuote: clause, ...parsed });
    remaining.delete(question.id);
  }

  return {
    answers,
    unmatchedText: unmatched.length ? unmatched.join("。") : undefined
  };
}

export function unresolvedTailoringQuestions(taskState: {
  knownSlots: Record<string, unknown>;
}): PendingCompoundQuestion[] {
  const session = objectValue(taskState.knownSlots.tailoringSession);
  const plan = objectValue(session.plan);
  const questionPlan = objectValue(plan.questionPlan);
  const activeQuestionId = stringValue(questionPlan.activeQuestionId)
    ?? stringValue(taskState.knownSlots.activeQuestionId);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
  const receipts = Array.isArray(plan.answerReceipts) ? plan.answerReceipts : [];
  const answered = new Set([
    ...answers.map((answer) => stringValue(objectValue(answer).questionId)),
    ...receipts.map((receipt) => stringValue(objectValue(receipt).questionId))
  ].filter(Boolean));
  return questions.flatMap((value) => {
    const question = objectValue(value);
    const id = stringValue(question.id);
    const text = stringValue(question.question);
    const answerType = question.answerType;
    if (
      !id || !text || answered.has(id) || id !== activeQuestionId
      || !["boolean", "single_select", "proficiency", "multi_select", "text", "url"].includes(String(answerType))
    ) return [];
    const options = Array.isArray(question.options)
      ? question.options.map(objectValue).flatMap((option) => {
          const optionId = stringValue(option.id);
          const label = stringValue(option.label);
          const value = stringValue(option.value);
          return optionId && label && value ? [{ id: optionId, label, value }] : [];
        })
      : undefined;
    return [{ id, question: text, answerType: answerType as PendingCompoundQuestion["answerType"], options }];
  });
}

function splitClauses(message: string) {
  return message
    .split(/[。！？!?；;，,\n]+/u)
    .map((part) => part.trim().replace(/^[，,。.；;]+|[，,。.；;]+$/gu, ""))
    .filter(Boolean);
}

function matchScore(question: PendingCompoundQuestion, clause: string) {
  let score = 0;
  for (const dimension of DIMENSIONS) {
    if (dimension.question.test(question.question) && dimension.evidence.test(clause)) score += 4;
  }
  const questionTokens = new Set(question.question.match(/[A-Za-z][A-Za-z0-9+#.-]*|[\u4e00-\u9fff]{2,}/g) ?? []);
  for (const token of questionTokens) {
    if (token.length > 1 && clause.toLocaleLowerCase().includes(token.toLocaleLowerCase())) score += 1;
  }
  return score;
}

function parseAnswer(question: PendingCompoundQuestion, evidenceQuote: string) {
  if (/^(?:跳过|继续)$/u.test(evidenceQuote.trim())) return { answer: "跳过" };
  if (/^不确定$/u.test(evidenceQuote.trim())) return { answer: "不确定" };
  if (/^(?:第一个|第1个|1)$/u.test(evidenceQuote.trim())) {
    const first = question.options?.[0];
    return first ? { answer: first.value } : undefined;
  }
  if (question.answerType === "boolean") {
    if (/没有|未曾|未正式|没(?:有)?|不曾|否/u.test(evidenceQuote)) return { answer: false };
    if (/有|是|已|正式|上线|发布|部署/u.test(evidenceQuote)) {
      return { answer: evidenceQuote.length > 3 ? evidenceQuote : true };
    }
    if (evidenceQuote.length >= 4 && evidenceQuote.length <= 160) return { answer: evidenceQuote };
    return undefined;
  }
  if (question.answerType === "proficiency") {
    if (/熟练|精通/u.test(evidenceQuote)) return { answer: "熟练", proficiency: "proficient" as const };
    if (/熟悉|经常使用/u.test(evidenceQuote)) return { answer: "熟悉", proficiency: "familiar" as const };
    if (/了解|接触过/u.test(evidenceQuote)) return { answer: "了解", proficiency: "aware" as const };
    if (/学习|刚开始/u.test(evidenceQuote)) return { answer: "正在学习", proficiency: "learning" as const };
    return undefined;
  }
  const url = evidenceQuote.match(/https?:\/\/\S+/i)?.[0];
  if (question.answerType === "url") return url ? { answer: url } : undefined;
  const knownValue = evidenceQuote.match(/\b(?:SQLite|MySQL|PostgreSQL|MongoDB|FastAPI|Spring|React|Vue|Kotlin|Java)\b/i)?.[0];
  if (knownValue) return { answer: knownValue };
  return evidenceQuote.length <= 160 ? { answer: evidenceQuote } : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
