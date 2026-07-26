import type { AgentTaskState } from "@/agent/contracts/agentSession";

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

    if (/换.*(第二|2).*(简历)?|第二份简历/.test(text)) {
      return {
        consumed: true,
        slotUpdates: { resumeSelectionPreference: "second", resumeSelectionRequested: true }
      };
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
        intent: "continue"
      };
    }
    return { consumed: false };
}

function isContinuable(state: AgentTaskState) {
  return state.completionStatus !== "failed"
    && state.completionStatus !== "cancelled"
    && (
      state.workflowId === "tailor_existing_resume"
      || state.goal === "create_tailored_resume"
      || state.goal === "apply_to_job"
      || ACTIVE_TAILORING_STAGES.has(state.stage)
    );
}

export function deriveNextLegalStage(state: AgentTaskState) {
  if (state.stage === "quality_result") return "quality_result";
  if (state.knownSlots.tailoringSession) {
    if (hasUnresolvedClarifications(state)) return "clarify_unsupported_facts";
    if (state.stage === "confirm_apply") return "confirm_apply";
    return "preview_changes";
  }
  if (state.stage === "confirm_apply") return "confirm_apply";
  if (state.stage === "preview_changes") return "preview_changes";
  if (state.lastObservation && state.selectedEntities.resumeId && state.selectedEntities.jobId) {
    return "generate_plan";
  }
  return state.stage;
}

export function hasUnresolvedClarifications(state: AgentTaskState) {
  const session = objectValue(state.knownSlots.tailoringSession);
  const plan = objectValue(session.plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
  const answeredIds = new Set(
    answers
      .map((answer) => stringValue(objectValue(answer).questionId))
      .filter((id): id is string => Boolean(id))
  );
  return questions.some((question) => {
    const id = stringValue(objectValue(question).id);
    return Boolean(id && !answeredIds.has(id));
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
