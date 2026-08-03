import { AgentSessionSchema, type AgentMessage, type AgentSession } from "@/agent/contracts/agentSession";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { normalizeMessageForFinalAssistant } from "./AgentSessionMessages";

export const CURRENT_AGENT_SESSION_SCHEMA_VERSION = 2;
export const CURRENT_TAILORING_RUNTIME_VERSION = 2;
export const CURRENT_QUESTION_PLAN_VERSION = 2;
const UPGRADE_NOTICE_ID = "agent-system-tailoring-runtime-v2-upgrade";
const RETIRED_TAILORING_MUTATIONS = new Set(["answer_tailoring_question", "review_tailoring_diff"]);

export function migrateAgentSessionToCurrentSchema(value: AgentSession | Record<string, unknown>, migrationTime = new Date().toISOString()): AgentSession {
  const raw = value as Record<string, unknown>;
  const taskState = record(raw.taskState);
  const knownSlots = { ...record(taskState.knownSlots) };
  const selectedEntities = { ...record(taskState.selectedEntities) };
  const pendingConfirmation = record(raw.pendingConfirmation);
  const pendingToolCall = record(raw.pendingToolCall);
  const retiresConfirmation = RETIRED_TAILORING_MUTATIONS.has(String(pendingConfirmation.toolName ?? ""));
  const retiresCall = RETIRED_TAILORING_MUTATIONS.has(String(pendingToolCall.toolName ?? ""));
  let tailoringRecovered = retiresConfirmation || retiresCall;

  let nextTaskState: Record<string, unknown> | undefined = Object.keys(taskState).length
    ? { ...taskState, knownSlots, selectedEntities }
    : undefined;
  const tailoring = record(knownSlots.tailoringSession);
  const plan = record(tailoring.plan);
  const questionPlan = record(plan.questionPlan);
  const clarificationQuestions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];

  if (Object.keys(tailoring).length) {
    if (isValidCurrentQuestionPlan(questionPlan)) {
      const diffs = Array.isArray(plan.diffs) ? plan.diffs : [];
      const reviews = Array.isArray(plan.diffReviews) ? plan.diffReviews.map(record) : [];
      const byId = new Map(reviews.flatMap((review) => typeof review.diffId === "string" ? [[review.diffId, review]] : []));
      let invalidDiff = false;
      const migratedReviews = diffs.flatMap((rawDiff) => {
        const parsed = ResumeTailoringDiffSchema.safeParse(rawDiff);
        if (!parsed.success) {
          invalidDiff = true;
          return [];
        }
        const diffId = tailoringDiffId(parsed.data);
        return [byId.get(diffId) ?? { diffId, status: "suggested", updatedAt: migrationTime }];
      });
      if (invalidDiff) {
        knownSlots.tailoringSession = {
          ...tailoring,
          tailoringRuntimeVersion: CURRENT_TAILORING_RUNTIME_VERSION,
          plan: { ...plan, diffs: [], diffReviews: [] },
          generatedDiffRevision: 0
        };
        nextTaskState = { ...nextTaskState, stage: "generate_changes", completionStatus: "active" };
      } else {
        knownSlots.tailoringSession = {
          ...tailoring,
          tailoringRuntimeVersion: CURRENT_TAILORING_RUNTIME_VERSION,
          plan: {
            ...plan,
            questionPlan: { ...questionPlan, questionPlanVersion: CURRENT_QUESTION_PLAN_VERSION },
            diffReviews: migratedReviews
          }
        };
      }
    } else if (clarificationQuestions.length) {
      tailoringRecovered = true;
      delete knownSlots.tailoringSession;
      for (const key of ["questionPlan", "activeQuestionId", "answeredQuestionIds", "skippedQuestionIds", "currentClarification", "selectedDiffs", "selectedDiffIds", "rejectedDiffIds", "remainingDiffCount"]) delete knownSlots[key];
      const fitFresh = Boolean(knownSlots.fitAnalysis)
        && dependencyMatches(record(record(taskState.dependencySnapshots).fitResult), selectedEntities);
      nextTaskState = {
        ...nextTaskState,
        knownSlots,
        selectedEntities: { ...selectedEntities, tailoringSessionId: undefined },
        stage: fitFresh ? "generate_plan" : "analyze_fit",
        activeGoal: fitFresh ? "create_tailored_resume" : "analyze_job_fit",
        completionStatus: "active"
      };
    }
  }

  if (retiresConfirmation || retiresCall) {
    delete knownSlots.pendingConfirmation;
    if (nextTaskState) nextTaskState = { ...nextTaskState, knownSlots };
  }

  const activeTurn = record(raw.activeTurn);
  const messages = (Array.isArray(raw.messages) ? raw.messages : []).map((input) => {
    let message = migrateLegacyMessage(record(input)) as AgentMessage;
    const isNormalAssistant = message.role === "assistant"
      && message.status === "complete"
      && (message.kind === undefined || message.kind === "text")
      && (message.type === undefined || message.type === "text");
    if (isNormalAssistant) message = normalizeMessageForFinalAssistant(message);
    const metadata = { ...(message.metadata ?? {}) };
    if (message.role === "user" && metadata.executionState === "running") {
      const stillActive = activeTurn.status === "running" && message.id === activeTurn.userMessageId;
      if (!stillActive) metadata.executionState = "complete";
    }
    if (message.role === "tool" && (message.status === "pending" || metadata.activityState === "running")) {
      const retired = RETIRED_TAILORING_MUTATIONS.has(message.toolName ?? "");
      const turnStillActive = activeTurn.status === "running" && message.turnId === activeTurn.id;
      if (retired || !turnStillActive) {
        message = { ...message, status: "recovered", content: retired ? "旧版岗位定制操作已恢复，不会自动执行。" : message.content };
        metadata.activityState = "recovered";
        metadata.recoveryReason = retired ? "superseded_tailoring_mutation" : "inactive_historical_turn";
      }
    }
    return { ...message, metadata: Object.keys(metadata).length ? metadata : undefined };
  });

  if (tailoringRecovered && !messages.some((message) => message.id === UPGRADE_NOTICE_ID)) {
    messages.push({
      id: UPGRADE_NOTICE_ID,
      role: "system",
      content: "旧版岗位定制会话已升级，当前问题和核对状态已恢复。",
      kind: "system_notice",
      type: "system_notice",
      status: "complete",
      createdAt: migrationTime,
      updatedAt: migrationTime,
      metadata: { migration: "tailoring-runtime-v2" }
    });
  }

  return AgentSessionSchema.parse({
    ...raw,
    agentSessionSchemaVersion: CURRENT_AGENT_SESSION_SCHEMA_VERSION,
    messages,
    taskState: nextTaskState,
    pendingConfirmation: retiresConfirmation ? undefined : raw.pendingConfirmation,
    pendingToolCall: retiresConfirmation || retiresCall ? undefined : raw.pendingToolCall,
    turnCheckpoints: Array.isArray(raw.turnCheckpoints) ? raw.turnCheckpoints : []
  });
}

function isValidCurrentQuestionPlan(value: Record<string, unknown>) {
  return typeof value.id === "string"
    && typeof value.revision === "number"
    && Array.isArray(value.questionIds)
    && value.questionIds.length <= 5
    && value.questionIds.every((id) => typeof id === "string")
    && (!value.activeQuestionId || value.questionIds.includes(String(value.activeQuestionId)));
}

function dependencyMatches(snapshot: Record<string, unknown>, selected: Record<string, unknown>) {
  if (!snapshot.profileId || !snapshot.resumeId || !snapshot.jobId) return false;
  return ["profileId", "resumeId", "jobId", "profileVersion", "resumeRevisionId", "resumeHash", "jobRevision", "jobGraphHash"]
    .every((key) => snapshot[key] === undefined || selected[key] === undefined || snapshot[key] === selected[key]);
}

function migrateLegacyMessage(message: Record<string, unknown>) {
  if (!Array.isArray(message.options)) return message;
  return { ...message, options: message.options.map((option) => migrateLegacyOption(record(option))) };
}

function migrateLegacyOption(option: Record<string, unknown>) {
  if (option.label && option.action) return option;
  const { title, value, description, field, ...rest } = option;
  const label = typeof option.label === "string" ? option.label : typeof title === "string" ? title : typeof description === "string" ? description : typeof value === "string" ? value : undefined;
  if (!label) return option;
  const id = typeof option.id === "string" ? option.id : `option-${label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 40) || "choice"}`;
  return { ...rest, id, label, action: { type: "answer", field: typeof field === "string" ? field : "choice", value: typeof value === "string" ? value : label } };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
