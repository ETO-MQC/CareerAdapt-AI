import type {
  AgentTaskState,
  WorkflowUserInputCheckpoint,
  WorkflowUserInputCheckpointKind,
  WorkflowInteraction
} from "@/agent/contracts/agentSession";
import { WorkflowUserInputCheckpointSchema } from "@/agent/contracts/agentSession";
import { stableHashText } from "@/services/security/text";

export const TARGET_REQUIRED_PROMPT = "我还没有拿到要定制的岗位信息。\n你可以直接粘贴岗位描述，或者选择已经保存的岗位。";

/**
 * Derive the persisted checkpoint projection used by Host and UI. This is a
 * projection of TaskState, not a second workflow machine.
 */
export function deriveWorkflowUserInputCheckpoint(
  state: AgentTaskState,
  now = state.updatedAt
): WorkflowUserInputCheckpoint | undefined {
  const waiting = state.completionStatus === "waiting_for_user"
    || state.completionStatus === "waiting_for_confirmation";
  if (!waiting) return undefined;

  const derived = checkpointProjection(state);
  if (!derived) return undefined;
  const previous = state.workflowUserInputCheckpoint;
  const sameProjection = previous
    && previous.checkpointId === derived.checkpointId
    && previous.kind === derived.kind
    && previous.workflowId === derived.workflowId
    && previous.stage === derived.stage
    && stableJson(previous.promptProjection) === stableJson(derived.promptProjection)
    && stableJson(previous.allowedInput) === stableJson(derived.allowedInput);
  return WorkflowUserInputCheckpointSchema.parse({
    ...derived,
    createdAt: sameProjection ? previous.createdAt : now,
    revision: sameProjection ? previous.revision : (previous?.revision ?? -1) + 1
  });
}

export function workflowUserInputCheckpointFor(
  state: AgentTaskState | undefined
) {
  return state?.workflowUserInputCheckpoint;
}

/** The active checkpoint is the persisted WorkflowInteraction authority. */
export function activeWorkflowInteractionFor(
  state: AgentTaskState | undefined
): WorkflowInteraction | undefined {
  const interaction = state?.workflowUserInputCheckpoint;
  return interaction?.state === "active" ? interaction : undefined;
}

function checkpointProjection(state: AgentTaskState): Omit<WorkflowUserInputCheckpoint, "createdAt" | "revision"> | undefined {
  const pendingConfirmation = record(state.knownSlots.pendingConfirmation);
  if (state.completionStatus === "waiting_for_confirmation" || Object.keys(pendingConfirmation).length > 0) {
    const operationId = stringValue(pendingConfirmation.operationId) ?? `stage:${state.stage}`;
    const toolName = stringValue(pendingConfirmation.toolName);
    return base(state, `confirmation:${operationId}`, "confirmation", {
      text: toolName === "apply_tailoring_changes"
        ? "岗位简历预览已生成，确认后我会创建独立岗位简历。"
        : "这一步需要你的明确确认。",
      operationId,
      toolName
    }, { type: "confirmation", values: ["confirm", "reject"] });
  }

  if (state.pendingDecision?.type === "job_target_persistence") {
    return base(state, `target-persistence:${state.selectedEntities.targetSnapshotId ?? state.stage}`, "target_persistence_choice", {
      text: "是否将这份外部岗位保存到岗位列表？",
      options: state.pendingDecision.options
    }, { type: "choice", options: state.pendingDecision.options });
  }

  const precondition = preconditionProjection(state);
  if (precondition) return precondition;

  if (state.stage === "choose_resume_source") {
    const candidates = generalResumeCandidates(state);
    if (state.knownSlots.resumeSelectionRequired || candidates.length > 1) {
      return base(state, `resume-choice:${stringValue(state.knownSlots.resumeCandidateSetRevision) ?? hashCandidates(candidates)}`, "resume_choice", {
        text: "请选择用于岗位定制的通用简历。",
        options: candidates.map(candidateProjection)
      }, { type: "resume", options: candidates.map(candidateProjection) });
    }
  }

  if (state.stage === "choose_job") {
    const candidates = arrayRecords(state.knownSlots.jobCandidates);
    if (candidates.length > 1 || Boolean(state.knownSlots.jobSelectionError)) {
      return base(state, `job-choice:${stringValue(state.knownSlots.jobCandidateSetRevision) ?? hashCandidates(candidates)}`, "job_choice", {
        text: "请选择要继续定制的岗位。",
        options: candidates.map(candidateProjection)
      }, { type: "job", options: candidates.map(candidateProjection) });
    }
  }

  const clarification = clarificationProjection(state);
  if (clarification) {
    return base(state, `clarification:${clarification.questionPlanId}:${clarification.questionPlanRevision}:${clarification.questionId}`, "clarification", clarification.promptProjection, {
      type: "text",
      questionId: clarification.questionId,
      answerType: clarification.answerType,
      options: clarification.options
    });
  }

  if (state.stage === "preview_changes" || state.stage === "review_composition" || state.stage === "final_review") {
    return base(state, `review:${state.workflowId}:${state.stage}:${state.updatedAt}`, "review_decision", {
      text: "请检查当前结果并告诉我下一步如何处理。"
    }, { type: "review_decision", values: ["confirm", "edit", "continue"] });
  }

  if (state.completionStatus === "waiting_for_user") {
    const intakeQuestion = stringValue(record(state.knownSlots.intakeFollowUpQuestion).question)
      ?? stringValue(record(state.knownSlots.intakeActiveQuestion).question);
    return base(state, `input:${state.workflowId}:${state.stage}`, "clarification", {
      text: intakeQuestion ?? "请继续补充当前步骤需要的信息。"
    }, { type: "text" });
  }
  return undefined;
}

function clarificationProjection(state: AgentTaskState) {
  const tailoring = record(state.knownSlots.tailoringSession);
  const plan = record(tailoring.plan);
  const questionPlan = record(state.knownSlots.questionPlan ?? plan.questionPlan);
  const questionId = stringValue(state.knownSlots.activeQuestionId ?? questionPlan.activeQuestionId);
  const questionPlanId = stringValue(questionPlan.id);
  const questionPlanRevision = numberValue(questionPlan.revision);
  const questions = arrayRecords(plan.clarificationQuestions);
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!questionId || !questionPlanId || questionPlanRevision === undefined || !question) return undefined;
  const questionText = stringValue(question.question);
  if (!questionText) return undefined;
  const options = arrayRecords(question.options).flatMap((option) => {
    const value = stringValue(option.value);
    const label = stringValue(option.label);
    return value && label ? [{ id: String(option.id ?? value), label, value }] : [];
  });
  return {
    questionPlanId,
    questionPlanRevision,
    questionId,
    answerType: stringValue(question.answerType) ?? "text",
    options,
    promptProjection: {
      text: questionText,
      questionId,
      questionPlanId,
      questionPlanRevision,
      tailoringSessionId: stringValue(questionPlan.sessionId) ?? state.selectedEntities.tailoringSessionId,
      questionCount: Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds.length : 0,
      options
    }
  };
}

function preconditionProjection(state: AgentTaskState) {
  const facadeCheckpoint = record(state.knownSlots.facadeCheckpoint);
  if (facadeCheckpoint.kind === "career_context" && state.completionStatus === "waiting_for_user") {
    const candidates = arrayRecords(state.knownSlots.profileCandidates).map(candidateProjection);
    if (candidates.length) {
      return base(state, `profile-choice:${stringValue(state.knownSlots.profileCandidateSetRevision) ?? hashCandidates(candidates)}`, "profile_choice", {
        text: "请选择用于岗位定制的个人资料。",
        options: candidates
      }, { type: "profile", options: candidates });
    }
    return base(state, `profile-import:${state.workflowId}:${state.stage}`, "import_prompt", {
      text: "当前还没有可用于岗位定制的个人资料。你可以选择已有资料，或先导入一份简历。"
    }, { type: "profile_import", actions: ["select_profile", "import_resume"] });
  }
  const failure = record(state.knownSlots.canonicalWorkflowFailure);
  const code = stringValue(failure.code) ?? stringValue(record(state.knownSlots.facadeCheckpoint).safeErrorCode);
  if (!code) return undefined;
  const operationId = stringValue(failure.operationId) ?? `stage:${state.stage}`;
  if (code === "target_required") {
    const options = [
      { id: "paste_target", label: "粘贴岗位描述", value: "paste_target" },
      { id: "select_saved_job", label: "选择已有岗位", value: "select_saved_job" }
    ];
    return base(state, `target-input:${operationId}`, "target_input", {
      text: TARGET_REQUIRED_PROMPT,
      options
    }, { type: "target_input", options });
  }
  if (code === "multiple_resume_sources" || code === "needs_resume_choice") {
    const candidates = generalResumeCandidates(state).map(candidateProjection);
    return base(state, `resume-choice:${stringValue(state.knownSlots.resumeCandidateSetRevision) ?? hashCandidates(candidates)}`, "resume_choice", {
      text: "请选择用于岗位定制的通用简历。",
      options: candidates
    }, { type: "resume", options: candidates });
  }
  if (code === "job_required") {
    const candidates = arrayRecords(state.knownSlots.jobCandidates).map(candidateProjection);
    return base(state, `job-choice:${stringValue(state.knownSlots.jobCandidateSetRevision) ?? hashCandidates(candidates)}`, "job_choice", {
      text: candidates.length ? "请选择要继续定制的岗位。" : "请选择已经保存的岗位，或直接粘贴岗位描述。",
      options: candidates
    }, { type: "job", options: candidates });
  }
  if (code === "needs_profile" || code === "career_session_binding_required" || code === "needs_profile_choice" || code === "profile_required") {
    const candidates = arrayRecords(state.knownSlots.profileCandidates).map(candidateProjection);
    if (candidates.length) {
      return base(state, `profile-choice:${stringValue(state.knownSlots.profileCandidateSetRevision) ?? hashCandidates(candidates)}`, "profile_choice", {
        text: "请选择用于岗位定制的个人资料。",
        options: candidates
      }, { type: "profile", options: candidates });
    }
    return base(state, `profile-import:${state.workflowId}:${state.stage}`, "import_prompt", {
      text: "当前还没有可用于岗位定制的个人资料。你可以选择已有资料，或先导入一份简历。"
    }, { type: "profile_import", actions: ["select_profile", "import_resume"] });
  }
  if (code === "clarification_required") {
    return base(state, `clarification:${operationId}`, "clarification", {
      text: "请补充当前岗位定制中尚未确认的信息。"
    }, { type: "text" });
  }
  if (code === "confirmation_required") {
    return base(state, `confirmation:${operationId}`, "confirmation", {
      text: "这一步需要你的明确确认。"
    }, { type: "confirmation", values: ["confirm", "reject"] });
  }
  if (code === "review_required") {
    return base(state, `review:${operationId}`, "review_decision", {
      text: "请检查当前结果并告诉我下一步如何处理。"
    }, { type: "review_decision", values: ["confirm", "edit", "continue"] });
  }
  return undefined;
}

function generalResumeCandidates(state: AgentTaskState) {
  return arrayRecords(state.knownSlots.resumeCandidates)
    .filter((candidate) => candidate.purpose === "general" && candidate.status !== "archived" && candidate.healthy !== false);
}

function candidateProjection(candidate: Record<string, unknown>) {
  return {
    id: stringValue(candidate.id) ?? "unknown",
    label: stringValue(candidate.name) ?? stringValue(candidate.title) ?? "未命名选项",
    value: stringValue(candidate.id) ?? "unknown",
    company: stringValue(candidate.company),
    purpose: stringValue(candidate.purpose)
  };
}

function base(
  state: AgentTaskState,
  checkpointId: string,
  kind: WorkflowUserInputCheckpointKind,
  promptProjection: Record<string, unknown>,
  allowedInput: Record<string, unknown>
) {
  const prompt = stringValue(promptProjection.text);
  if (!prompt) throw new Error("workflow_interaction_prompt_missing");
  return {
    interactionId: `workflow-interaction:${checkpointId}`,
    checkpointId,
    kind,
    state: "active" as const,
    workflowId: state.workflowId,
    stage: state.stage,
    prompt,
    options: interactionOptions(promptProjection, allowedInput),
    promptProjection,
    allowedInput
  } as Omit<WorkflowUserInputCheckpoint, "createdAt" | "revision">;
}

function interactionOptions(
  promptProjection: Record<string, unknown>,
  allowedInput: Record<string, unknown>
) {
  const values = Array.isArray(promptProjection.options)
    ? promptProjection.options
    : Array.isArray(allowedInput.options)
      ? allowedInput.options
      : Array.isArray(allowedInput.values)
        ? allowedInput.values
        : [];
  return values.flatMap((option, index): Record<string, unknown>[] => {
    if (typeof option === "string" && option.trim()) {
      return [{ id: `workflow-interaction-option-${index}`, label: option, value: option }];
    }
    return option && typeof option === "object" && !Array.isArray(option)
      ? [option as Record<string, unknown>]
      : [];
  });
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is Record<string, unknown> => Boolean(candidate && typeof candidate === "object" && !Array.isArray(candidate)))
    : [];
}

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hashCandidates(candidates: Record<string, unknown>[]) {
  return stableHashText(stableJson(candidates.map(candidateProjection)));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
