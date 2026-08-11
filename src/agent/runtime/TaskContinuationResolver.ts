import type { AgentTaskState } from "@/agent/contracts/agentSession";
import {
  ResumeCompositionAnswerSchema,
  type ResumeCompositionInformationNeed
} from "@/domain/resumeComposition/contracts";

export type TaskContinuation = {
  consumed: boolean;
  goal?: string;
  intent?: "continue";
  slotUpdates?: Record<string, unknown>;
};

const ACTIVE_TAILORING_STAGES = new Set([
  "choose_resume_source",
  "analyze_fit",
  "generate_plan",
  "clarify_unsupported_facts",
  "preview_changes",
  "confirm_apply",
  "quality_result"
]);

export class TaskContinuationResolver {
  resolve(state: AgentTaskState, message: string): TaskContinuation {
    return resolveContinuationIntent(state, message);
  }
}

export function resolveContinuationIntent(state: AgentTaskState, message: string): TaskContinuation {
    const text = message.trim();
    if (!text || !isContinuable(state)) return { consumed: false };

    if (isResumeCompositionTask(state)) {
      const compositionContinuation = resolveResumeCompositionContinuation(state, text);
      if (compositionContinuation) return compositionContinuation;
    }

    if (state.rootGoal === "create_resume_from_profile" && state.workflowId !== "compose_resume") {
      const candidates = Array.isArray(state.knownSlots.profileItemCandidates)
        ? state.knownSlots.profileItemCandidates.map(objectValue).filter((item) => Array.isArray(item.factIds) && item.factIds.length > 0)
        : [];
      const selected = selectProfileFactIds(text, candidates);
      if (selected.length) {
        return {
          consumed: true,
          intent: "continue",
          slotUpdates: { selectedFactIds: selected }
        };
      }
    }

    if (/换.*(第二|2).*(简历)?|第二份简历/.test(text)) {
      return {
        consumed: true,
        slotUpdates: { resumeSelectionPreference: "second", resumeSelectionRequested: true }
      };
    }
    if (/^(?:继续|生成吧|按这些生成)$/u.test(text) && state.knownSlots.tailoringSession) {
      const plan = objectValue(objectValue(state.knownSlots.tailoringSession).plan);
      const questionPlan = objectValue(plan.questionPlan);
      const activeQuestionId = stringValue(questionPlan.activeQuestionId) ?? stringValue(state.knownSlots.activeQuestionId);
      if (activeQuestionId) {
        return {
          consumed: true,
          intent: "continue",
          slotUpdates: { tailoringContinuation: "answer_current_question" }
        };
      }
      if (tailoringGenerationIsStale(plan, questionPlan, state)) {
        return {
          consumed: true,
          intent: "continue",
          slotUpdates: { tailoringContinuation: "generate_changes", tailoringWorkspaceView: "fit" }
        };
      }
      if (typeof state.knownSlots.remainingDiffCount === "number" && state.knownSlots.remainingDiffCount > 0) {
        return {
          consumed: true,
          intent: "continue",
          slotUpdates: { tailoringContinuation: "review_changes", tailoringWorkspaceView: "diffs" }
        };
      }
    }
    if (/还是.*(刚才|之前).*(岗位|职位)|刚才那个岗位/.test(text)) {
      return {
        consumed: true,
        slotUpdates: { reuseSelectedJob: true }
      };
    }
    if (
      /基于这些建议.*(创建|生成).*(定制|岗位).*简历|采用这些建议|按刚才的继续|就用这个|生成吧|继续|就按这些改/.test(text)
    ) {
      return {
        consumed: true,
        goal: "create_tailored_resume",
        intent: "continue",
        slotUpdates: /(?:然后|并且|再).*(?:导出|下载).*(?:PDF|简历)/i.test(text)
          ? { orderedContinuation: ["apply_tailoring_changes", "export_resume"] }
          : undefined
      };
    }
    return { consumed: false };
}

function isContinuable(state: AgentTaskState) {
  return state.completionStatus !== "failed"
    && state.completionStatus !== "cancelled"
    && (
      state.workflowId === "tailor_existing_resume"
      || state.rootGoal === "create_tailored_resume"
      || state.rootGoal === "apply_to_job"
      || state.rootGoal === "create_resume_from_profile"
      || state.rootGoal === "compose_resume"
      || state.workflowId === "compose_resume"
      || ACTIVE_TAILORING_STAGES.has(state.stage)
  );
}

export function deriveNextLegalStage(state: AgentTaskState) {
  if (isResumeCompositionTask(state)) {
    if (!state.selectedEntities.profileId) return "select_profile_scope";
    if (state.knownSlots.resumeCompositionDecision === "generate" && state.knownSlots.resumeCompositionCheckpoint) {
      return "confirm_create";
    }
    return "review_composition";
  }
  if (state.rootGoal === "create_resume_from_profile") {
    if (!state.selectedEntities.profileId) return "select_profile_scope";
    if (!hasValue(state.knownSlots.selectedFactIds)) return "select_facts";
    return "review_resume_plan";
  }
  if (state.stage === "quality_result") return "quality_result";
  if (state.knownSlots.tailoringSession) {
    const plan = objectValue(objectValue(state.knownSlots.tailoringSession).plan);
    const questionPlan = objectValue(plan.questionPlan);
    if (stringValue(questionPlan.activeQuestionId) ?? stringValue(state.knownSlots.activeQuestionId)) return "clarify_unsupported_facts";
    if (hasUnresolvedClarifications(state)) return "clarify_unsupported_facts";
    if (tailoringGenerationIsStale(plan, questionPlan, state)) return "generate_changes";
    if (state.stage === "confirm_apply") return "confirm_apply";
    if (typeof state.knownSlots.remainingDiffCount === "number" && state.knownSlots.remainingDiffCount > 0) return "preview_changes";
    return "preview_changes";
  }
  if (state.stage === "confirm_apply") return "confirm_apply";
  if (state.stage === "preview_changes") return "preview_changes";
  if (state.lastObservation && state.selectedEntities.resumeId && state.selectedEntities.jobId) {
    return "generate_plan";
  }
  return state.stage;
}

const TARGET_DIRECTION_QUESTION = "这份通用简历主要准备投什么方向？如果暂时没有明确方向，我先按互联网技术 / AI 应用通用版整理。";

function isResumeCompositionTask(state: AgentTaskState) {
  return state.workflowId === "compose_resume";
}

function resolveResumeCompositionContinuation(state: AgentTaskState, text: string): TaskContinuation | undefined {
  const compact = text.replace(/[\s。！!？?，,、：:；;]+$/gu, "");
  if (/^(?:直接生成|生成吧|按这个生成|确认生成|就按这个生成)$/u.test(compact)) {
    return {
      consumed: true,
      intent: "continue",
      slotUpdates: {
        resumeCompositionDecision: "generate",
        resumeCompositionExplicitConfirmation: true,
        resumeCompositionPendingInformationNeed: pendingTargetDirectionNeed("skipped")
      }
    };
  }
  if (/^(?:调整方向|换个方向|修改方向)$/u.test(compact)) {
    return {
      consumed: true,
      intent: "continue",
      slotUpdates: {
        resumeCompositionDecision: "adjust_direction",
        resumeCompositionExplicitConfirmation: undefined,
        resumeCompositionPendingInformationNeed: pendingTargetDirectionNeed("pending")
      }
    };
  }
  if (/^(?:继续补充资料|补充资料|继续补充)$/u.test(compact)) {
    return {
      consumed: true,
      intent: "continue",
      slotUpdates: {
        resumeCompositionDecision: "supplement",
        resumeCompositionExplicitConfirmation: undefined,
        resumeCompositionPendingInformationNeed: pendingTargetDirectionNeed("pending")
      }
    };
  }

  const pendingNeed = objectValue(state.knownSlots.resumeCompositionPendingInformationNeed);
  const explicitlyAnswersDirection = pendingNeed.informationNeedId === "target_direction"
    && (pendingNeed.status === "pending"
      || /用于|方向|秋招|春招|求职|投递|互联网|AI|技术|产品|数据|运营/u.test(text));
  if (!explicitlyAnswersDirection || /^(?:我想|我要|请|帮我|可以|好的)$/u.test(compact)) return undefined;

  const answer = ResumeCompositionAnswerSchema.parse({
    informationNeedId: "target_direction",
    value: text,
    source: "user_message",
    capturedAt: new Date().toISOString()
  });
  const previousAnswers = Array.isArray(state.knownSlots.resumeCompositionAnswers)
    ? state.knownSlots.resumeCompositionAnswers
    : [];
  return {
    consumed: true,
    intent: "continue",
    slotUpdates: {
      resumeCompositionAnswers: [...previousAnswers, answer].slice(-8),
      resumeCompositionLastAnswer: answer,
      resumeCompositionTargetDirection: text,
      resumeCompositionMode: "general",
      resumeCompositionDecision: undefined,
      resumeCompositionExplicitConfirmation: undefined,
      resumeCompositionPendingInformationNeed: pendingTargetDirectionNeed("answered"),
      resumeCompositionCheckpoint: undefined,
      resumeCompositionProposal: undefined,
      resumeCompositionBlueprint: undefined,
      resumeCompositionEvidenceGraph: undefined,
      resumeCompositionReviewResult: undefined
    }
  };
}

function pendingTargetDirectionNeed(status: ResumeCompositionInformationNeed["status"]): ResumeCompositionInformationNeed {
  return {
    informationNeedId: "target_direction",
    question: TARGET_DIRECTION_QUESTION,
    status
  };
}

function selectProfileFactIds(text: string, candidates: Array<Record<string, unknown>>) {
  if (!candidates.length) return [];
  if (/全部|所有|都用|完整资料|全量/.test(text)) return candidates.map((candidate) => String(candidate.id));
  const requested = [...text.matchAll(/(?:第|#)\s*(\d+)/g)].map((match) => Number(match[1]) - 1);
  if (!requested.length) return [];
  return [...new Set(requested.filter((index) => index >= 0 && index < candidates.length).map((index) => String(candidates[index].id)))];
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

export function hasUnresolvedClarifications(state: AgentTaskState) {
  const session = objectValue(state.knownSlots.tailoringSession);
  const plan = objectValue(session.plan);
  const questionPlan = objectValue(plan.questionPlan);
  const plannedIds = Array.isArray(questionPlan.questionIds)
    ? questionPlan.questionIds.filter((id): id is string => typeof id === "string")
    : [];
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
  const answeredIds = new Set(
    answers
      .map((answer) => stringValue(objectValue(answer).questionId))
      .filter((id): id is string => Boolean(id))
  );
  const unresolved = questions.some((question) => {
    const id = stringValue(objectValue(question).id);
    return Boolean(id && !answeredIds.has(id));
  });
  return unresolved || plannedIds.some((id) => !answeredIds.has(id));
}

function tailoringGenerationIsStale(plan: Record<string, unknown>, questionPlan: Record<string, unknown>, state?: AgentTaskState) {
  const generationStatus = plan.generationStatus ?? state?.knownSlots.tailoringGenerationStatus;
  if (!generationStatus && plan.generatedDiffsBasedOnQuestionPlanRevision === undefined && plan.generatedDiffsBasedOnAnswerRevisionHash === undefined) return false;
  if (generationStatus !== "completed") return true;
  if (typeof plan.generatedDiffsBasedOnQuestionPlanRevision !== "number"
    || plan.generatedDiffsBasedOnQuestionPlanRevision !== questionPlan.revision) return true;
  return typeof plan.answerRevisionHash !== "string"
    || typeof plan.generatedDiffsBasedOnAnswerRevisionHash !== "string"
    || plan.answerRevisionHash !== plan.generatedDiffsBasedOnAnswerRevisionHash;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
