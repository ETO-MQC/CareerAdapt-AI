import { describe, expect, it } from "vitest";
import {
  ResumeTailoringPlanSchema,
  TailoringQuestionPlanSchema,
  type TailoringClarificationQuestion
} from "@/domain/schemas";
import {
  answerTailoringClarification,
  clarificationAnswerType,
  createTailoringQuestionPlan,
  dedupeClarificationQuestions,
  getActiveTailoringQuestion,
  selectHighValueClarificationQuestions
} from "@/services/jobs/tailoringService";
import { resolveCompoundAnswer } from "@/agent/runtime/CompoundAnswerResolver";

const NOW = "2026-08-02T08:00:00.000Z";

describe("P4.3d authoritative tailoring question plan", () => {
  it("enforces a default budget of three, a hard maximum of five, and allows zero", () => {
    const questions = Array.from({ length: 8 }, (_, index) => question(`q-${index}`, `cluster-${index}`, 100 - index));
    const plan = createTailoringQuestionPlan({ sessionId: "session-budget", questions, now: NOW });
    expect(plan.defaultBudget).toBe(3);
    expect(plan.maximumBudget).toBe(5);
    expect(plan.questionIds).toHaveLength(3);
    expect(plan.frozenAt).toBe(NOW);
    expect(createTailoringQuestionPlan({ sessionId: "session-zero", questions: [], now: NOW })).toMatchObject({
      questionIds: [],
      status: "ready_for_generation",
      activeQuestionId: undefined
    });
    expect(() => TailoringQuestionPlanSchema.parse({
      ...plan,
      maximumBudget: 5,
      questionIds: ["1", "2", "3", "4", "5", "6"]
    })).toThrow(/budget exceeded|Too big/i);
  });

  it("clusters tool-shaped AI evaluation questions globally and selects at most one", () => {
    const tools = ["Java", "Pandas", "RAG", "SQLite", "FastAPI", "Git", "Docker", "Kotlin", "项目经历", "教育经历"];
    const candidates = tools.map((tool, index) => ({
      ...question(`q-${index}`, undefined, 50 - index),
      question: `${tool} 如何用于检查 AI 回答质量和发现错误？`,
      candidateClaim: `使用 ${tool} 评估 AI 输出质量`,
      capability: {
        id: `cap-${index}`,
        label: tool,
        normalizedLabel: tool.toLocaleLowerCase(),
        type: "tool" as const,
        source: "requirement" as const
      }
    }));
    const deduped = dedupeClarificationQuestions(candidates, "job-ai-eval");
    expect(deduped).toHaveLength(1);
    expect(selectHighValueClarificationQuestions(deduped, 3)).toHaveLength(1);
    expect(deduped[0].capabilityCluster).toBe("ai_answer_evaluation");
  });

  it("keeps IDs stable while answering, editing, skipping, and reloading", () => {
    const questions = [question("q-1", "one", 30), question("q-2", "two", 20), question("q-3", "three", 10)];
    const questionPlan = createTailoringQuestionPlan({ sessionId: "session-stable", questions, now: NOW });
    let plan = resumePlan(questions, questionPlan);
    expect(getActiveTailoringQuestion(plan)?.id).toBe("q-1");

    plan = answerTailoringClarification({ plan, question: questions[0], answer: "有真实案例", operationId: "answer-op-q1-v1", now: NOW });
    expect(plan.questionPlan?.questionIds).toEqual(["q-1", "q-2", "q-3"]);
    expect(plan.questionPlan?.activeQuestionId).toBe("q-2");

    const reloaded = ResumeTailoringPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    plan = answerTailoringClarification({ plan: reloaded, question: questions[1], answer: "没有", operationId: "answer-op-q2-v1", now: NOW });
    plan = answerTailoringClarification({ plan, question: questions[0], answer: "更新后的真实案例", operationId: "answer-op-q1-v2", now: NOW });
    plan = answerTailoringClarification({ plan, question: questions[2], answer: "跳过", operationId: "answer-op-q3-v1", now: NOW });

    expect(plan.questionPlan?.questionIds).toEqual(["q-1", "q-2", "q-3"]);
    expect(plan.questionPlan?.status).toBe("ready_for_generation");
    expect(plan.questionPlan?.activeQuestionId).toBeUndefined();
    expect(plan.clarificationAnswers?.find((answer) => answer.questionId === "q-1")?.answerRevision).toBe(2);
    expect(plan.clarificationAnswers?.find((answer) => answer.questionId === "q-2")?.status).toBe("rejected");
    expect(plan.clarificationAnswers?.find((answer) => answer.questionId === "q-3")?.status).toBe("skipped");
  });

  it("treats continue and skip as one current-question skip, and first only with options", () => {
    const current = {
      id: "q-current",
      question: "请选择当前问题的答案",
      answerType: "single_select" as const,
      options: [{ id: "a", label: "第一项", value: "A" }, { id: "b", label: "第二项", value: "B" }]
    };
    expect(resolveCompoundAnswer("继续", [current]).answers).toEqual([
      { questionId: "q-current", answer: "跳过", evidenceQuote: "继续" }
    ]);
    expect(resolveCompoundAnswer("第一个", [current]).answers[0]).toMatchObject({ questionId: "q-current", answer: "A" });
    expect(resolveCompoundAnswer("第一个", [{ ...current, options: undefined }]).answers).toEqual([]);
  });

  it("binds a substantive free-text turn to the one authoritative active question", () => {
    const result = resolveCompoundAnswer("我在真实项目中负责质量验收和迭代复盘。", [{
      id: "q-active",
      question: "你是否处理过模型 badcase 与反馈纠错闭环？",
      answerType: "text"
    }]);
    expect(result).toEqual({
      answers: [{
        questionId: "q-active",
        answer: "我在真实项目中负责质量验收和迭代复盘。",
        evidenceQuote: "我在真实项目中负责质量验收和迭代复盘。"
      }]
    });
  });

  it("classifies evidence-first behavioral questions as evidence text", () => {
    expect(clarificationAnswerType("你是否有评估 AI 回答质量并复盘失败案例的真实经历？")).toBe("text");
  });
});

function question(id: string, capabilityCluster?: string, priorityScore = 0): TailoringClarificationQuestion {
  return {
    id,
    question: `问题 ${id}`,
    shortLabel: `标签 ${id}`,
    requirementIds: [`req-${id}`],
    sourceItemIds: ["item-1"],
    relatedItemIds: ["item-1"],
    candidateClaim: `候选事实 ${id}`,
    targetFieldPaths: ["sections.summary.items.item-1.text"],
    targetPolicy: "summary_once",
    answerType: "text",
    capabilityCluster,
    expectedImpact: "summary",
    priorityScore,
    status: "pending",
    updatedAt: NOW
  };
}

function resumePlan(
  questions: TailoringClarificationQuestion[],
  questionPlan: ReturnType<typeof createTailoringQuestionPlan>
) {
  const selected = new Set(questionPlan.questionIds);
  return ResumeTailoringPlanSchema.parse({
    id: "plan-stable",
    branchId: "branch-1",
    jobId: "job-1",
    intensity: "balanced",
    basedOnBranchRevision: 1,
    claims: [],
    clarificationQuestions: questions.filter((item) => selected.has(item.id)).map((item) => ({
      ...item,
      status: item.id === questionPlan.activeQuestionId ? "active" : "pending"
    })),
    clarificationAnswers: [],
    questionPlan,
    diffs: [],
    estimatedFitScore: 60,
    createdAt: NOW
  });
}
