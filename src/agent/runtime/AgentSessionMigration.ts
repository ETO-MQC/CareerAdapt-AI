import { AgentSessionSchema, type AgentMessage, type AgentSession } from "@/agent/contracts/agentSession";
import { ensureConversationBranches } from "./activeBranchContext";
import { ResumeTailoringDiffSchema } from "@/domain/schemas";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { stableHashText } from "@/services/security/text";
import { normalizeMessageForFinalAssistant } from "./AgentSessionMessages";
import { canonicalWorkflowId } from "@/agent/workflows/workflowRegistry";

export const CURRENT_AGENT_SESSION_SCHEMA_VERSION = 3;
export const CURRENT_TAILORING_RUNTIME_VERSION = 3;
export const CURRENT_QUESTION_PLAN_VERSION = 2;
const UPGRADE_NOTICE_ID = "agent-system-tailoring-runtime-v3-upgrade";
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
  if (nextTaskState) nextTaskState = migrateCompositionTaskState(nextTaskState);
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
      const answerRevisionHash = hashTailoringAnswers(plan.clarificationAnswers);
      const legacyGenerated = diffs.length > 0 && plan.generationStatus === undefined;
      const generationMatches = legacyGenerated || plan.generationStatus === "completed"
        && plan.generatedDiffsBasedOnQuestionPlanRevision === questionPlan.revision
        && plan.generatedDiffsBasedOnAnswerRevisionHash === answerRevisionHash;
      const generationStatus = generationMatches ? "completed" : plan.generationStatus === "completed" ? "ready_for_regeneration" : plan.generationStatus ?? "not_started";
      if (invalidDiff || (diffs.length > 0 && plan.generationStatus === "completed" && !generationMatches)) {
        knownSlots.tailoringSession = {
          ...tailoring,
          tailoringRuntimeVersion: CURRENT_TAILORING_RUNTIME_VERSION,
          plan: {
            ...plan,
            answerRevisionHash,
            generationStatus: "ready_for_regeneration",
            generatedDiffsBasedOnQuestionPlanRevision: undefined,
            generatedDiffsBasedOnAnswerRevisionHash: undefined,
            diffs: [],
            diffReviews: []
          },
          generatedDiffRevision: 0
        };
        nextTaskState = { ...nextTaskState, stage: "generate_changes", completionStatus: "active" };
      } else {
        knownSlots.tailoringSession = {
          ...tailoring,
          tailoringRuntimeVersion: CURRENT_TAILORING_RUNTIME_VERSION,
          plan: {
            ...plan,
            answerRevisionHash,
            generationStatus,
            ...(legacyGenerated ? {
              generatedDiffsBasedOnQuestionPlanRevision: questionPlan.revision,
              generatedDiffsBasedOnAnswerRevisionHash: answerRevisionHash
            } : {}),
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
  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const legacyBranchId = typeof raw.activeBranchId === "string" ? raw.activeBranchId : "legacy-branch";
  const messages = rawMessages.map((input, index) => {
    let message = migrateLegacyMessage(record(input)) as AgentMessage;
    message = {
      ...message,
      branchId: message.branchId || legacyBranchId,
      parentMessageId: message.parentMessageId ?? (index > 0 ? (rawMessages[index - 1] as Record<string, unknown>)?.id as string | undefined : undefined)
    };
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
      metadata: { migration: "tailoring-runtime-v3" }
    });
  }

  const migrated = AgentSessionSchema.parse({
    ...raw,
    agentSessionSchemaVersion: CURRENT_AGENT_SESSION_SCHEMA_VERSION,
    messages,
    artifactRefs: consolidateTailoringArtifacts(raw.artifactRefs, tailoring, migrationTime, nextTaskState),
    taskState: nextTaskState,
    pendingConfirmation: retiresConfirmation ? undefined : raw.pendingConfirmation,
    pendingToolCall: retiresConfirmation || retiresCall ? undefined : raw.pendingToolCall,
    workflowState: migrateWorkflowState(record(raw.workflowState)),
    turnCheckpoints: Array.isArray(raw.turnCheckpoints)
      ? raw.turnCheckpoints.map((checkpoint) => {
          const value = record(checkpoint);
          return {
            ...value,
            taskStateBefore: migrateCompositionTaskState(record(value.taskStateBefore)),
            ...(value.taskStateAfter ? { taskStateAfter: migrateCompositionTaskState(record(value.taskStateAfter)) } : {}),
            workflowStateBefore: migrateWorkflowState(record(value.workflowStateBefore)),
            ...(value.workflowStateAfter ? { workflowStateAfter: migrateWorkflowState(record(value.workflowStateAfter)) } : {}),
            branchId: typeof value.branchId === "string" ? value.branchId : legacyBranchId,
            toolReceipts: Array.isArray(value.toolReceipts) ? value.toolReceipts : []
          };
        })
      : [],
    activeBranchId: legacyBranchId,
    activeHeadMessageId: typeof raw.activeHeadMessageId === "string"
      ? raw.activeHeadMessageId
      : messages.at(-1)?.id,
    conversationBranches: Array.isArray(raw.conversationBranches) && raw.conversationBranches.length
      ? raw.conversationBranches
      : [{
          id: legacyBranchId,
          headMessageId: messages.at(-1)?.id,
          status: "active",
          createdAt: typeof raw.createdAt === "string" ? raw.createdAt : migrationTime
        }]
  });
  return ensureConversationBranches(migrated);
}

function migrateCompositionTaskState(value: Record<string, unknown>) {
  const workflowId = typeof value.workflowId === "string" ? value.workflowId : undefined;
  const canonical = workflowId ? canonicalWorkflowId(workflowId) : workflowId;
  if (canonical !== "compose_resume") return value;
  const knownSlots = { ...record(value.knownSlots) };
  const legacyResult = record(knownSlots.resumeFromProfileResult);
  const migratedLegacyCompletion = value.completionStatus === "completed"
    && value.stage === "completed"
    && Object.keys(legacyResult).length > 0;
  const selectedEntities = { ...record(value.selectedEntities) };
  if (migratedLegacyCompletion) {
    // Preserve the old branch's terminal result as a migration marker. It is
    // intentionally not relabeled as a canonical compose_resume tool result;
    // the completion guard accepts this marker only for already-completed
    // legacy sessions, while all new writes use compose_resume.
    knownSlots.resumeCompositionLegacyResult = legacyResult;
    knownSlots.resumeCompositionMigration = "legacy_build_resume_from_profile";
    for (const key of ["profileId", "resumeId", "revisionId"] as const) {
      if (!selectedEntities[key] && typeof legacyResult[key] === "string") selectedEntities[key] = legacyResult[key];
    }
    if (selectedEntities.resumeRevisionId === undefined && typeof legacyResult.revisionId === "string") {
      selectedEntities.resumeRevisionId = legacyResult.revisionId;
    }
    if (selectedEntities.profileVersion === undefined && typeof legacyResult.profileVersion === "number") {
      selectedEntities.profileVersion = legacyResult.profileVersion;
    }
  }
  const stage = value.stage === "select_facts" || value.stage === "review_resume_plan"
    ? "review_composition"
    : value.stage === "completed" && knownSlots.resumeCompositionResult
      ? "resume_ready"
      : migratedLegacyCompletion
        ? "resume_ready"
      : value.stage;
  const compositionIsTerminal = Boolean(
    knownSlots.resumeCompositionResult
    || migratedLegacyCompletion
    || value.completionStatus === "completed"
    || stage === "resume_ready"
  );
  if (compositionIsTerminal) {
    delete knownSlots.resumeCompositionPendingInformationNeed;
  } else if (!knownSlots.resumeCompositionPendingInformationNeed && !knownSlots.resumeCompositionTargetDirection) {
    knownSlots.resumeCompositionPendingInformationNeed = {
      informationNeedId: "target_direction",
      question: "这份通用简历主要准备投什么方向？如果暂时没有明确方向，我先按互联网技术 / AI 应用通用版整理。",
      status: "pending"
    };
  }
  return {
    ...value,
    workflowId: "compose_resume",
    stage,
    activeGoal: value.activeGoal === "create_resume_from_profile" ? "compose_resume" : value.activeGoal,
    knownSlots,
    selectedEntities
  };
}

function migrateWorkflowState(value: Record<string, unknown>) {
  if (!Object.keys(value).length) return value;
  const workflowId = typeof value.workflowId === "string" ? canonicalWorkflowId(value.workflowId) : value.workflowId;
  const step = value.step === "select_facts" || value.step === "review_resume_plan"
    ? "review_composition"
    : value.step === "completed" && workflowId === "compose_resume"
      ? "resume_ready"
      : value.step;
  return { ...value, workflowId, step };
}

function hashTailoringAnswers(value: unknown) {
  const answers = Array.isArray(value) ? value.map(record)
    .sort((left, right) => String(left.questionId ?? "").localeCompare(String(right.questionId ?? "")))
    .map((answer) => ({
      questionId: answer.questionId,
      status: answer.status,
      answer: answer.answer,
      proficiency: answer.proficiency,
      answerRevision: answer.answerRevision
    })) : [];
  return stableHashText(JSON.stringify(answers));
}

function consolidateTailoringArtifacts(
  value: unknown,
  tailoring: Record<string, unknown>,
  migrationTime: string,
  taskState?: Record<string, unknown>
) {
  const artifacts = Array.isArray(value) ? value.map(record) : [];
  const standaloneFit = taskState?.workflowId === "analyze_job_fit" || taskState?.rootGoal === "analyze_job_fit";
  if (standaloneFit) {
    return artifacts.map((artifact) => artifact.kind === "tailoring_workspace"
      ? {
          ...artifact,
          id: `job-fit:${String(artifact.entityId ?? "pending-job-fit")}`,
          kind: "job_fit_overview",
          title: "岗位匹配分析",
          entityType: "job"
        }
      : artifact);
  }
  const legacy = artifacts.filter((artifact) => artifact.kind === "job_fit_overview" || artifact.kind === "tailoring_diff" || artifact.kind === "tailoring_workspace");
  if (!legacy.length && !tailoring.id) return value;
  const tailoringSessionId = typeof tailoring.id === "string" && tailoring.id
    ? tailoring.id
    : String(legacy[0]?.entityId ?? "legacy-tailoring-session");
  const existing = legacy[0] ?? {};
  const createdAt = legacy.map((artifact) => artifact.createdAt).filter((date): date is string => typeof date === "string").sort()[0] ?? migrationTime;
  const workspace = {
    ...existing,
    id: `tailoring-workspace:${tailoringSessionId}`,
    kind: "tailoring_workspace",
    title: "岗位定制工作区",
    entityType: "tailoring_session",
    entityId: tailoringSessionId,
    status: "active",
    createdAt,
    updatedAt: migrationTime
  };
  return [
    ...artifacts.filter((artifact) => !["job_fit_overview", "tailoring_diff", "tailoring_workspace"].includes(String(artifact.kind))),
    workspace
  ];
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
  const options = Array.isArray(message.options)
    ? message.options.map((option) => migrateLegacyOption(record(option)))
    : undefined;
  if (!options) return message;
  return {
    ...message,
    options,
    optionSet: message.optionSet ?? {
      optionSetId: `legacy-option-set-${String(message.id ?? "message")}`,
      optionSetRevision: 0,
      sourceMessageId: String(message.id ?? "legacy-message"),
      state: "active"
    }
  };
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
