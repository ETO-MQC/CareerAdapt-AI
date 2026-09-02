"use client";

import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import {
  AgentSessionSchema,
  HermesRunHandleSchema,
  type AgentMessageReference,
  type AgentSession,
  type AgentTaskState,
  type AgentOptionSet,
  type AgentTurn,
  type AgentRegenerationTarget,
  type AgentTurnCheckpoint,
  type WorkflowUserInputCheckpoint
} from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import type { AgentRuntimeEvent } from "@/agent/runtime/agentRuntime";
import { isHermesRuntimeFailureCode } from "@/agent/runtime/hermes/hermesRunReliability";
import { isCareerDomainPreconditionCode } from "@/agent/runtime/careerContextBindingResolver";
import {
  abortSourceForReason,
  createIncidentTraceId,
  createRunStopReason,
  AbortTraceSchema,
  RuntimeCausalChainEntrySchema,
  RuntimeAttemptSchema,
  RuntimeFailureSnapshotSchema,
  RunStopReasonSchema,
  SecondaryRecoveryFailureSchema,
  EventStreamDiagnosticSchema,
  type AbortTrace,
  type RuntimeAttempt,
  type RunStopReason
} from "@/agent/runtime/hermes/hermesIncidentTrace";
import type { AgentKernel } from "@/agent/kernel/AgentKernel";
import { evaluateGroundedResumeOutput } from "@/agent/kernel/GroundedResumeOutputGate";
import { AgentGoalCompletionGuard } from "@/agent/kernel/AgentGoalCompletionGuard";
import {
  evaluateConversationContinuity,
  withTerminalState,
  type AgentTerminalState
} from "./ConversationContinuityGuard";
import type { AgentExecutor } from "@/agent/runtime/agentExecutor";
import type { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type {
  AgentArtifactAction,
  AgentOption,
  AgentUiAction,
  AgentWorkflowControl,
  ProfileIntakeSection
} from "@/agent/contracts/agentActions";
import { AgentTaskStateReducer, dependencySnapshot, normalizeAgentTaskState } from "./AgentTaskStateReducer";
import { getUserMessageForTurn } from "./currentTurnUserMessage";
import { appendAgentMessage, replaceAgentThinking, upsertAgentActivity } from "./AgentSessionMessages";
import { migrateAgentSessionToCurrentSchema } from "./AgentSessionMigration";
import { routeAgentIntent } from "./agentIntentRouter";
import {
  projectTaskStateIntoSession,
  projectTaskStateToWorkflowState
} from "./projectTaskStateToWorkflowState";
import { agentAttachmentStore, type AgentAttachmentRef } from "@/services/agent/AgentAttachmentStore";
import { agentImportProgressBus } from "@/services/agent/AgentImportProgressBus";
import {
  classifyProfileIntakeTurn,
  classifyTurnIntent,
  isProfileIntakeDraftRequest,
  type ActiveQuestionTurnResolution,
  type TurnIntentDecision
} from "./AgentTurnIntent";
import { stableHashText } from "@/services/security/text";
import { ensureConversationBranches, forkConversationBranch, withActiveBranchHead } from "./activeBranchContext";
import { createQuickActionIntent, type AgentQuickActionId, type QuickActionIntent } from "@/agent/contracts/agentQuickAction";
import {
  resolveCompoundAnswer,
  unresolvedTailoringQuestions,
  type CompoundAnswerResolution
} from "./CompoundAnswerResolver";
import {
  ProfileIntakeReviewProjectionSchema,
  profileIntakeReviewProgress
} from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { ProfileIntakeSourceTurnSchema, type ProfileIntakeSourceTurn } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import { ProfileIntakeNextTurnPlanSchema } from "@/domain/profileIntake/ProfileIntakeNextTurnPlan";
import {
  buildConversationIntakeArtifact,
  buildConversationIntakeReviewProjectionFromDraft
} from "@/domain/profileIntake/ConversationIntakeAdapter";
import { ImportedResumeDraftSchema, type ImportedResumeDraft } from "@/domain/schemas";
import { JobTargetSnapshotSchema } from "@/domain/schemas/jobTarget";
import { jobTargetSnapshotHash } from "@/domain/jobTarget/jobTargetSnapshot";
import { activeWorkflowInteractionFor, TARGET_REQUIRED_PROMPT } from "./workflowUserInputCheckpoint";
export { activeWorkflowInteractionFor } from "./workflowUserInputCheckpoint";
import { createProfileIntakeInterviewPlan } from "@/domain/profileIntake/ProfileIntakeCompleteness";
import { appendProfileIntakeQuestionAnswer } from "@/domain/profileIntake/ProfileIntakeQuestionAnswer";
import {
  resolveQuickActionPrerequisites,
  type QuickActionPrerequisiteResolution,
  type QuickActionWorkflowResolution
} from "@/agent/workflows/QuickActionWorkflowSupervisor";
import { buildQuickActionContextSnapshot, quickActionProfileCountSummary, quickActionProfileLabel, quickActionSectionCount } from "@/agent/workflows/QuickActionContextSnapshot";
import { QuickActionContextSnapshotSchema, type QuickActionContextSnapshot } from "@/agent/contracts/quickActionContext";
import { defaultAgentTaskTitle, refineAgentTaskTitle } from "@/agent/services/AgentTaskTitleService";
import { WorkspaceRepository } from "@/services/storage/repositories";
import {
  ResumeCompositionCheckpointSchema,
  type ResumeCompositionCheckpoint
} from "@/domain/resumeComposition/contracts";
import {
  profileIntakeItemLabel,
  resolveProfileIntakeInterviewSupervisor,
  targetQuestion
} from "@/agent/workflows/ProfileIntakeInterviewSupervisor";
import {
  ProfileIntakeFinalizationSupervisor,
  profileIntakePersistenceReceipt
} from "@/agent/workflows/ProfileIntakeFinalizationSupervisor";
import { AuthoritativeConversationAlignmentGuard } from "@/agent/kernel/AuthoritativeConversationAlignmentGuard";
import { TurnController, type SessionExecution, type SessionExecutionStatus, type TurnControllerState, type TurnOperationClaim, type TurnOperationKind } from "./TurnController";
import type { AgentToolResult } from "@/agent/contracts/agentTool";
import type { CareerSessionBinding } from "./careerSessionBinding";
import { resolveCareerSessionBinding } from "./careerSessionBinding";
import {
  normalizeResumeCompositionConfirmationText,
  type ConfirmResumeCompositionCommand,
  type RuntimeUserEvent
} from "./RuntimeUserEvent";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import type { TailoringSession } from "@/services/jobs/tailoringCommands";
import { consumeTailoringQuestionAnswer, isTailoringQuestionPlanComplete } from "@/services/jobs/tailoringService";
import { isTailoringQuestionPaused, normalizeTailoringStage } from "@/agent/workflows/tailoringStage";
import { advanceTailoringWorkflow, type TailoringWorkflowBoundary } from "@/agent/workflows/tailoringWorkflowDriver";
import { isTailoringWorkflowId } from "@/agent/workflows/workflowRegistry";
import {
  ResumeArtifactReceiptSchema,
  ResumeArtifactWriteCheckpointSchema,
  resumeArtifactWriteCheckpointId,
  type ResumeArtifactReceipt,
  type ResumeArtifactWriteCheckpoint
} from "@/agent/contracts/resumeArtifactWrite";

const TAILORING_APPLY_FAILURE_MESSAGE = "已采用的修改仍保留，但岗位简历写入没有完成。可以从当前步骤重试。";

export type AgentHostInput =
  | { type: "message"; text: string; references?: AgentMessageReference[] }
  | { type: "edit_message"; messageId: string; text: string }
  | { type: "regenerate_message"; messageId: string }
  | { type: "quick_action"; actionId: AgentQuickActionId; text: string; task: QuickActionIntent["task"] }
  | { type: "composer_submit"; text?: string; files: File[] }
  | { type: "resume_import_consent"; attachmentId: string; mode: "ai" | "local" }
  | { type: "option"; action: AgentOption["action"] }
  | { type: "artifact_action"; action: AgentArtifactAction }
  | { type: "confirmation"; confirmed: boolean }
  | { type: "ui_control"; action: AgentUiAction | AgentWorkflowControl }
  | { type: "external_event"; observation: unknown; toolName?: string };

export type PreparedRuntimeUserEvent = {
  session: AgentSession;
  event: RuntimeUserEvent;
  turnId?: string;
  userMessage: string;
  executionOwner?: AgentTurn["executionOwner"];
  deterministicTransitionApplied: boolean;
  deterministicTerminal?: boolean;
  prePersistedUserMessageId?: string;
  tailoringAnswerBinding?: TailoringAnswerBinding;
};

export type AgentStartTurnInput = {
  session: AgentSession;
  userMessage: string;
  turnId?: string;
  runtimeId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  appendUserMessage?: boolean;
  pageContext: AgentPageContext;
  attachment?: AgentAttachmentRef;
  references?: AgentMessageReference[];
  typedTask?: QuickActionIntent["task"];
  supersede?: boolean;
  regenerateNarrationOnly?: boolean;
  updateExistingUserMessage?: boolean;
  sourceTurnId?: string;
  regeneratedFromMessageId?: string;
  regenerationTarget?: AgentRegenerationTarget;
  retryWorkflowStep?: boolean;
  operationId?: string;
  operationKind?: TurnOperationKind;
  operationClaimed?: boolean;
  runtimeDiagnostics?: Partial<Pick<NonNullable<AgentSession["activeTurn"]>, "preferredRuntime" | "attemptedRuntime" | "finalRuntime" | "fallbackUsed" | "fallbackReasonCode" | "hermesRunId" | "firstEventAt" | "runtimeFailureAt" | "incidentTraceId" | "runtimeAttempts" | "turnStartSnapshot" | "runtimeFailureSnapshot" | "previousRuntimeIncidents" | "cancellation" | "abortTraces" | "recoveryAttempted">>;
};

export type TailoringAnswerBinding = {
  checkpointId: string;
  questionId: string;
  questionPlanId: string;
  questionPlanRevision: number;
  answer: string;
};

export type TailoringQuestionProjection = {
  interactionId: string;
  checkpointId: string;
  interactionRevision: number;
  questionPlanId: string;
  questionPlanRevision: number;
  questionId: string;
  questionText: string;
  position: number;
  count: number;
  answerType: string;
  options: AgentOption[];
  allowSkip: true;
  tailoringSessionId: string;
  messageId: string;
  projectionRevision: string;
};

type WorkflowInteractionConsumption = {
  session: AgentSession;
  turnId: string;
  userMessageId?: string;
  applied: boolean;
};

export type SafeWorkflowCheckpoint = {
  source: "authoritative_task_state" | "latest_committed_transition" | "last_hermes_run" | "previous_turn";
  taskState: AgentTaskState;
  workflowState: AgentSession["workflowState"];
  selectedEntities: AgentTaskState["selectedEntities"];
  artifactRefs: AgentArtifactRef[];
  pendingConfirmation?: AgentSession["pendingConfirmation"];
  pendingToolCall?: AgentSession["pendingToolCall"];
  checkpoint?: AgentTurnCheckpoint;
};

/**
 * Return the last state that can be resumed without guessing a write. The
 * current task projection wins over turn history: a failed model turn may not
 * have produced a new checkpoint, while the selected resume/job/stage is still
 * an authoritative and safe continuation point.
 */
export function resolveLastSafeWorkflowCheckpoint(session: AgentSession): SafeWorkflowCheckpoint | undefined {
  const current = session.taskState;
  if (current && isSafeCurrentTaskState(current)) {
    return {
      source: "authoritative_task_state",
      taskState: structuredClone(current),
      workflowState: structuredClone(session.workflowState),
      selectedEntities: structuredClone(current.selectedEntities),
      artifactRefs: structuredClone(session.artifactRefs),
      pendingConfirmation: session.pendingConfirmation ? structuredClone(session.pendingConfirmation) : undefined,
      pendingToolCall: session.pendingToolCall ? structuredClone(session.pendingToolCall) : undefined
    };
  }
  const committed = session.turnCheckpoints.findLast((checkpoint) =>
    Boolean(checkpoint.taskStateAfter && isSafeCurrentTaskState(checkpoint.taskStateAfter))
  );
  if (committed?.taskStateAfter) {
    return checkpointToSafeWorkflowCheckpoint(committed, "latest_committed_transition");
  }
  const hermesCheckpoint = session.hermesRun
    ? session.turnCheckpoints.findLast((checkpoint) =>
        checkpoint.turnId === session.hermesRun?.turnId
          && Boolean(checkpoint.taskStateAfter && isSafeCurrentTaskState(checkpoint.taskStateAfter))
      )
    : undefined;
  if (hermesCheckpoint?.taskStateAfter) return checkpointToSafeWorkflowCheckpoint(hermesCheckpoint, "last_hermes_run");
  const previous = session.turnCheckpoints.findLast((checkpoint) =>
    isSafeCurrentTaskState(checkpoint.taskStateBefore)
  );
  return previous ? checkpointToSafeWorkflowCheckpoint(previous, "previous_turn", false) : undefined;
}

function isSafeCurrentTaskState(taskState: AgentTaskState) {
  const selected = taskState.selectedEntities;
  const hasResumeAndJob = Boolean(selected.resumeId && selected.jobId);
  const hasTailoringEntities = Boolean(selected.profileId && selected.resumeId && selected.jobId);
  const hasProfileOrResume = Boolean(selected.profileId || selected.resumeId);
  if (hasResumeAndJob && taskState.stage === "analyze_fit") return true;
  if (
    hasTailoringEntities
    && taskState.workflowId === "tailor_existing_resume"
    && taskState.stage === "generate_plan"
    && taskState.knownSlots.fitAnalysis
  ) return true;
  return hasProfileOrResume
    && !["cancelled", "failed"].includes(taskState.completionStatus)
    && taskState.workflowId !== "agent_quick_action";
}

function checkpointToSafeWorkflowCheckpoint(
  checkpoint: AgentTurnCheckpoint,
  source: SafeWorkflowCheckpoint["source"],
  useAfter = true
): SafeWorkflowCheckpoint {
  const taskState = useAfter && checkpoint.taskStateAfter ? checkpoint.taskStateAfter : checkpoint.taskStateBefore;
  const workflowState = useAfter && checkpoint.workflowStateAfter ? checkpoint.workflowStateAfter : checkpoint.workflowStateBefore;
  return {
    source,
    taskState: structuredClone(taskState),
    workflowState: structuredClone(workflowState),
    selectedEntities: structuredClone(useAfter && checkpoint.taskStateAfter ? checkpoint.taskStateAfter.selectedEntities : checkpoint.selectedEntitiesBefore),
    artifactRefs: structuredClone(useAfter && checkpoint.artifactRefsAfter ? checkpoint.artifactRefsAfter : checkpoint.artifactRefsBefore),
    pendingConfirmation: (useAfter ? checkpoint.pendingConfirmationAfter : checkpoint.pendingConfirmationBefore)
      ? structuredClone(useAfter ? checkpoint.pendingConfirmationAfter : checkpoint.pendingConfirmationBefore)
      : undefined,
    pendingToolCall: (useAfter ? checkpoint.pendingToolCallAfter : checkpoint.pendingToolCallBefore)
      ? structuredClone(useAfter ? checkpoint.pendingToolCallAfter : checkpoint.pendingToolCallBefore)
      : undefined,
    checkpoint
  };
}

export type AgentHostSnapshot = {
  activeSessionId?: string;
  activeSession?: AgentSession;
  activeTask?: AgentTaskState;
  turnStatus: "idle" | "running" | "paused" | "waiting_for_confirmation" | "waiting_for_user" | "completed" | "failed";
  controllerState: TurnControllerState;
  activeTurnId?: string;
  startedAt?: string;
  lastProgressAt?: string;
  stalled: boolean;
  pendingConfirmation?: AgentSession["pendingConfirmation"];
  streamEvents: AgentStreamEvent[];
  artifacts: AgentArtifactRef[];
  currentObservation?: unknown;
  uiAction?: AgentUiAction;
  pendingInputCount: number;
};

type PendingUserInput = {
  sessionId: string;
  userMessage: string;
  userMessageId: string;
  pageContext: AgentPageContext;
  references?: AgentMessageReference[];
};

export class AgentHostStore {
  private snapshot: AgentHostSnapshot = {
    turnStatus: "idle",
    controllerState: "idle",
    streamEvents: [],
    artifacts: [],
    stalled: false,
    pendingInputCount: 0
  };
  private readonly listeners = new Set<() => void>();
  /** One Codex-style lifecycle owner; the old execution API is retained as methods on this object. */
  private readonly executionCoordinator = new TurnController();
  private readonly stallTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly confirmationExecutions = new Map<string, Promise<AgentSession | undefined>>();
  private readonly resumeCompositionExecutions = new Map<string, Promise<AgentSession | undefined>>();
  private readonly artifactActionExecutions = new Map<string, Promise<AgentSession | undefined>>();
  private readonly tailoringArtifactActionQueues = new Map<string, Promise<AgentSession | undefined>>();
  private readonly workflowInteractionExecutions = new Map<string, Promise<WorkflowInteractionConsumption>>();
  private readonly pendingInputs = new Map<string, PendingUserInput[]>();
  private runtimeEventQueue: Promise<void> = Promise.resolve();
  private streamCheckpointTimer?: ReturnType<typeof setTimeout>;
  private streamCheckpointInFlight?: Promise<void>;
  private streamCheckpointQueued = false;
  private streamCheckpointSessionId?: string;
  private streamCheckpointAssistantId?: string;
  private streamCheckpointPersistedLength = 0;

  constructor(private readonly dependencies: {
    /** Native kernel is retained only for legacy/unit harnesses. Production
     * semantic turns are delegated to Hermes through the runtime boundary. */
    kernel?: AgentKernel;
    executor: AgentExecutor;
    persistence: AgentSessionStore;
    repository?: WorkspaceRepository;
    stallThresholdMs?: number;
  }) {
    agentImportProgressBus.subscribe((progress) => {
      const sessionId = this.snapshot.activeSessionId;
      if (!sessionId || !this.executionCoordinator.isRunning(sessionId)) return;
      this.markProgress(sessionId);
      const activeSession = this.snapshot.activeSession;
      const progressedSession = activeSession
        ? {
            ...activeSession,
            messages: activeSession.messages.map((message) =>
              message.toolName === "prepare_resume_import" && message.status === "pending"
                ? {
                    ...message,
                    content: progress.message,
                    updatedAt: progress.at
                  }
                : message
            ),
            updatedAt: progress.at
          }
        : undefined;
      this.patch({
        activeSession: progressedSession ?? activeSession,
        currentObservation: {
          toolName: "prepare_resume_import",
          stage: progress.stage,
          message: progress.message,
          heartbeat: progress.heartbeat
        }
      });
      if (progressedSession && !progress.heartbeat) {
        void this.dependencies.persistence.save(progressedSession);
      }
    });
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  /**
   * Return the persisted UserMessage that opened the requested LogicalTurn.
   * This method intentionally performs no intent or target interpretation.
   */
  getUserMessageForTurn(turnId: string) {
    return getUserMessageForTurn(this.snapshot.activeSession, turnId);
  }

  getExecution(sessionId: string) {
    return this.executionCoordinator.get(sessionId);
  }

  getExecutionRegistry() {
    return this.executionCoordinator.executions;
  }

  getTurnControllerState(sessionId = this.snapshot.activeSessionId) {
    return sessionId ? this.executionCoordinator.getState(sessionId) : "idle" as const;
  }

  getTurnOperation(operationId: string) {
    return this.executionCoordinator.getOperation(operationId);
  }

  claimTurnOperation(input: {
    sessionId: string;
    operationId: string;
    kind: TurnOperationKind;
    turnId?: string;
  }): TurnOperationClaim {
    const claim = this.executionCoordinator.claim(input);
    if (claim.accepted || this.snapshot.activeSessionId === input.sessionId) {
      this.patch({ controllerState: this.executionCoordinator.getState(input.sessionId) });
    }
    return claim;
  }

  attachTurnOperation(operationId: string, promise: Promise<unknown>) {
    const operation = this.executionCoordinator.attachOperationPromise(operationId, promise);
    if (operation && this.snapshot.activeSessionId === operation.sessionId) {
      this.patch({ controllerState: operation.state });
    }
    return operation;
  }

  finishTurnOperation(operationId: string, status?: SessionExecutionStatus) {
    const operation = this.executionCoordinator.getOperation(operationId);
    if (!operation) return;
    const current = this.snapshot.activeSession?.id === operation.sessionId ? this.snapshot.activeSession : undefined;
    const terminalStatus: SessionExecutionStatus = status
      ?? (current?.activeTurn?.status === "failed" || this.snapshot.turnStatus === "failed"
      ? "failed"
      : "completed");
    const finished = this.executionCoordinator.finish(operation.sessionId, terminalStatus, undefined, operationId);
    if (this.snapshot.activeSessionId === operation.sessionId) {
      this.patch({ controllerState: this.executionCoordinator.getState(operation.sessionId) });
    }
    return finished;
  }

  setTurnOperationState(operationId: string, state: TurnControllerState) {
    const operation = this.executionCoordinator.setOperationState(operationId, state);
    if (operation && this.snapshot.activeSessionId === operation.sessionId) {
      this.patch({ controllerState: operation.state });
    }
    return operation;
  }

  async rebindSessionCareerContext(sessionId: string, context: { personId: string; profileId: string }, reread = true) {
    const stored = await this.dependencies.persistence.get(sessionId);
    const current = this.snapshot.activeSession?.id === sessionId ? this.snapshot.activeSession : stored;
    if (!current) throw new Error("agent_session_required");
    const profile = await this.getCareerRepository().getProfile(context.profileId);
    if (!profile || profile.personId !== context.personId || profile.archivedAt) throw new Error("career_context_target_invalid");
    const nextTaskState = reread && current.taskState
      ? {
          ...current.taskState,
          knownSlots: {
            ...current.taskState.knownSlots,
            targetProfileId: profile.id,
            targetProfileName: profile.name,
            expectedProfileVersion: profile.version,
            acknowledgedActiveProfileId: profile.id
          },
          selectedEntities: {
            ...current.taskState.selectedEntities,
            profileId: profile.id,
            profileVersion: profile.version
          },
          updatedAt: new Date().toISOString()
        }
      : current.taskState;
    const next = AgentSessionSchema.parse({
      ...current,
      personId: context.personId,
      activeProfileId: profile.id,
      profileVersionNumber: profile.profileVersionNumber ?? 1,
      profileRevision: profile.version,
      taskState: nextTaskState,
      updatedAt: new Date().toISOString()
    });
    const saved = await this.dependencies.persistence.save(next);
    this.patchSession(saved);
    return saved;
  }

  private getCareerRepository() {
    return this.dependencies.repository
      ?? (typeof this.dependencies.persistence.getWorkspaceRepository === "function"
        ? this.dependencies.persistence.getWorkspaceRepository()
        : new WorkspaceRepository());
  }

  private hasExplicitCareerRepository() {
    return Boolean(
      this.dependencies.repository
      || typeof this.dependencies.persistence.getWorkspaceRepository === "function"
    );
  }

  private async isCanonicalCareerAdaptJsonAttachment(attachment: AgentAttachmentRef) {
    if (attachment.mimeType !== "application/json" && !attachment.fileName.toLowerCase().endsWith(".json")) return false;
    try {
      const { adaptResumeJsonToV2 } = await import("@/domain/resumeImport/jsonV2Adapter");
      const { file } = agentAttachmentStore.resolve(attachment.id);
      const adapted = adaptResumeJsonToV2(JSON.parse(await file.text()));
      return adapted.ok && adapted.sourceKind === "v2";
    } catch {
      return false;
    }
  }

  private async readQuickActionContext(session?: AgentSession) {
    return buildQuickActionContextSnapshot(this.getCareerRepository(), session);
  }

  adopt(session: AgentSession) {
    const migrated = migrateAgentSessionToCurrentSchema(session);
    const liveSession = this.snapshot.activeSession;
    const isStaleSameSession = liveSession?.id === migrated.id
      && (
        liveSession.sessionRevision > migrated.sessionRevision
        || (
          liveSession.sessionRevision === migrated.sessionRevision
          && liveSession.updatedAt > migrated.updatedAt
        )
      );
    if (isStaleSameSession) return;
    const liveExecution = this.executionCoordinator.get(session.id);
    // An execution record is created before async preflight starts. During that
    // window its promise has not been attached yet, so checking only `promise`
    // incorrectly treats a live turn as an orphan when the user switches tasks
    // and comes back. Keep the persisted running shell intact while the
    // session-scoped execution is still active.
    const hasLiveExecution = Boolean(liveExecution?.promise) || liveExecution?.status === "running";
    const hasRecoverableHermesRun = Boolean(
      migrated.activeTurn
      && migrated.hermesRun
      && migrated.activeTurn.id === migrated.hermesRun.turnId
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(migrated.hermesRun.status)
      && migrated.taskState?.completionStatus !== "completed"
      && migrated.taskState?.completionStatus !== "failed"
    );
    const hasRecoverableArtifactWrite = Boolean(artifactWriteCheckpointFromSession(migrated));
    const canResumePersistedTurn = hasLiveExecution || hasRecoverableHermesRun || hasRecoverableArtifactWrite;
    const recoveredThinking = enforceExactlyOneFinal(canResumePersistedTurn ? migrated : recoverOrphanedThinking(migrated));
    const { session: recoverable, pendingInputs } = recoverPersistedQueuedInputs(recoveredThinking);
    if (pendingInputs.length) this.pendingInputs.set(recoverable.id, pendingInputs);
    const restorable = recoverable.taskState
      ? attachTaskStateOptions(recoverable, recoverable.taskState)
      : recoverable;
    const withRestorePrompt = appendIntakeRestorePrompt(restorable);
    // A live execution owns the latest session state. Do not write a stale
    // restore/migration projection back over it while the user is switching
    // tasks; the running turn will persist its authoritative result.
    if (!canResumePersistedTurn && JSON.stringify(withRestorePrompt) !== JSON.stringify(session)) {
      void this.dependencies.persistence.save(withRestorePrompt);
    }
    const execution = this.executionCoordinator.get(withRestorePrompt.id);
    this.patch({
      activeSessionId: withRestorePrompt.id,
      activeSession: withRestorePrompt,
      activeTask: withRestorePrompt.taskState,
      pendingConfirmation: withRestorePrompt.pendingConfirmation,
      artifacts: withRestorePrompt.artifactRefs,
      turnStatus: execution?.status ?? sessionTurnStatus(withRestorePrompt),
      activeTurnId: execution?.activeTurnId ?? withRestorePrompt.activeTurn?.id,
      startedAt: execution?.startedAt ?? withRestorePrompt.activeTurn?.startedAt,
      lastProgressAt: execution?.lastProgressAt,
      stalled: execution?.stalled ?? false,
      streamEvents: execution?.streamEvents ?? [],
      pendingInputCount: pendingInputs.length
    });
    if (hasRecoverableArtifactWrite && this.hasExplicitCareerRepository()) {
      void this.reconcileDurableArtifactWrite(withRestorePrompt);
    }
    if (pendingInputs.length && !withRestorePrompt.pendingConfirmation && !execution?.promise) void this.drainPendingInput(withRestorePrompt.id);
  }

  async adoptDurably(session: AgentSession) {
    this.adopt(session);
    const adopted = this.snapshot.activeSession;
    if (!adopted || adopted.id !== session.id) return adopted;
    const saved = await this.dependencies.persistence.save(adopted);
    const current = this.snapshot.activeSession;
    if (current?.id === adopted.id && current.updatedAt === adopted.updatedAt) this.patchSession(saved);
    return saved;
  }

  async persistActiveSessionSnapshot() {
    await this.flushStreamingCheckpoint();
    const current = this.snapshot.activeSession;
    if (!current) return undefined;
    const saved = await this.dependencies.persistence.save(current);
    const latest = this.snapshot.activeSession;
    if (latest?.id === current.id && latest.updatedAt === current.updatedAt) this.patchSession(saved);
    return saved;
  }

  private async reconcileDurableArtifactWrite(session: AgentSession) {
    const checkpoint = artifactWriteCheckpointFromSession(session);
    if (!checkpoint) return;
    const repository = this.getCareerRepository();
    try {
      const receipt = await repository.getResumeArtifactReceipt(checkpoint.operationId);
      if (receipt) {
        const verification = await repository.verifyResumeArtifactReceipt(receipt);
        if (verification.ok) {
          await this.repairTailoringSuccess(session, receipt);
          return;
        }
      }
      await this.repairTailoringWriteRecovery(session, checkpoint, receipt ? "artifact_receipt_readback_failed" : undefined);
    } catch {
      // Recovery remains a user-visible retry state. Never turn an uncertain
      // repository read into a false success.
      await this.repairTailoringWriteRecovery(session, checkpoint, "artifact_recovery_read_failed");
    }
  }

  private async repairTailoringSuccess(session: AgentSession, receipt: ResumeArtifactReceipt) {
    const current = this.snapshot.activeSession;
    if (!current || current.id !== session.id || current.updatedAt !== session.updatedAt) return;
    const turnId = current.activeTurn?.id ?? `artifact-recovery-${receipt.operationId}`;
    const observation = {
      operationId: receipt.operationId,
      resultResumeId: receipt.resultResumeId,
      resultResumeRevisionId: receipt.resultResumeRevisionId,
      revisionId: receipt.resultResumeRevisionId,
      qualityResult: {
        status: "passed",
        factGuard: "passed",
        revisionCreated: true,
        repositoryReadBackVerified: true,
        resumeListVisibilityVerified: true,
        acceptedDiffIds: receipt.acceptedDiffIds,
        acceptedDiffCount: receipt.acceptedDiffCount,
        changedFieldPaths: receipt.changedFieldPaths,
        beforeContentHash: receipt.beforeContentHash,
        afterContentHash: receipt.afterContentHash,
        artifactReceipt: receipt,
        receipt: { operationId: receipt.operationId, status: "completed" }
      },
      artifactReceipt: receipt,
      receipt: { operationId: receipt.operationId, status: "completed" }
    };
    let repaired = current;
    if (current.taskState) {
      repaired = projectTaskStateIntoSession(repaired, new AgentTaskStateReducer().reduce(current.taskState, {
        type: "tool_observation",
        toolName: "apply_tailoring_changes",
        observation
      }));
    }
    repaired = withTailoringResultArtifact(repaired, receipt);
    const acceptedCount = receipt.acceptedDiffCount;
    repaired = projectDeterministicAssistantMessage(
      repaired,
      turnId,
      `已生成岗位定制简历，并应用了 ${acceptedCount} 项已确认修改。`,
      `agent-artifact-recovery-${receipt.operationId}`
    );
    const assistantId = repaired.messages.findLast((message) => message.role === "assistant" && message.turnId === turnId)?.id;
    repaired = withOpenArtifactOption(repaired, assistantId, receipt.resultResumeId);
    repaired = updateArtifactWriteDiagnostics(repaired, {
      operationId: receipt.operationId,
      checkpointId: artifactWriteCheckpointFromSession(repaired)?.checkpointId,
      status: "write_completed",
      sourceResumeId: receipt.sourceResumeId,
      resultResumeId: receipt.resultResumeId,
      resultResumeRevisionId: receipt.resultResumeRevisionId,
      resultRevisionId: receipt.resultResumeRevisionId,
      acceptedDiffCount: receipt.acceptedDiffCount,
      changedFieldPaths: receipt.changedFieldPaths,
      repositoryReadBackVerified: true,
      resumeListVisibilityVerified: true
    });
    repaired = {
      ...repaired,
      activeTurn: repaired.activeTurn
        ? { ...repaired.activeTurn, status: "completed", completedAt: new Date().toISOString(), visibleAssistantMessageId: assistantId }
        : repaired.activeTurn,
      workflowState: repaired.taskState && repaired.workflowState
        ? projectTaskStateToWorkflowState(repaired.taskState, { ...repaired.workflowState, status: "completed" })
        : repaired.workflowState
    };
    const saved = await this.dependencies.persistence.save(repaired);
    const latest = this.snapshot.activeSession;
    if (latest?.id === session.id && latest.updatedAt === current.updatedAt) {
      this.patchSession(saved, { turnStatus: "completed", activeTurnId: turnId, uiAction: resumePreviewUiAction(saved) });
    }
  }

  private async repairTailoringWriteRecovery(
    session: AgentSession,
    checkpoint: ResumeArtifactWriteCheckpoint,
    overrideCode?: string
  ) {
    const current = this.snapshot.activeSession;
    if (!current || current.id !== session.id || current.updatedAt !== session.updatedAt) return;
    const code = overrideCode ?? checkpoint.safeErrorCode ?? "artifact_write_interrupted_before_commit";
    const message = code === "artifact_write_interrupted_before_commit"
      ? "岗位简历生成在写入前被中断，已保留所有确认内容，可以直接重试。"
      : "岗位简历写入结果仍需重新校验，已保留所有确认内容，可以从当前步骤重试。";
    const turnId = current.activeTurn?.id ?? `artifact-recovery-${checkpoint.operationId}`;
    const failedCheckpoint: ResumeArtifactWriteCheckpoint = {
      ...checkpoint,
      checkpointId: checkpoint.checkpointId || resumeArtifactWriteCheckpointId(checkpoint.operationId),
      status: "write_failed",
      safeErrorCode: code,
      updatedAt: new Date().toISOString()
    };
    if (this.hasExplicitCareerRepository()) {
      await this.getCareerRepository().saveResumeArtifactWriteCheckpoint(failedCheckpoint).catch(() => undefined);
    }
    let repaired = current;
    if (current.taskState) {
      const taskState = {
        ...current.taskState,
        activeGoal: "confirm_apply",
        stage: "confirm_apply",
        completionStatus: "waiting_for_user" as const,
        knownSlots: {
          ...current.taskState.knownSlots,
          tailoringApplyFailure: {
            code,
            message,
            recoverable: true,
            operationId: checkpoint.operationId
          },
          artifactWriteCheckpoint: {
            ...failedCheckpoint
          }
        },
        updatedAt: new Date().toISOString()
      };
      repaired = projectTaskStateIntoSession(repaired, taskState);
    }
    const alreadyNarrated = repaired.messages.some((candidate) =>
      candidate.role === "assistant"
      && candidate.content === message
      && (
        candidate.metadata?.artifactRecoveryOperationId === checkpoint.operationId
        || candidate.metadata?.deterministicTransactionMessage === true
      )
    );
    if (!alreadyNarrated) {
      repaired = projectDeterministicAssistantMessage(repaired, turnId, message, `agent-artifact-recovery-${checkpoint.operationId}`);
      const assistant = repaired.messages.findLast((candidate) => candidate.role === "assistant" && candidate.turnId === turnId);
      repaired = withTailoringRetryOption(repaired, assistant?.id);
    }
    repaired = updateArtifactWriteDiagnostics(repaired, {
      operationId: checkpoint.operationId,
      checkpointId: checkpoint.checkpointId,
      status: checkpoint.status,
      sourceResumeId: checkpoint.sourceResumeId,
      safeErrorCode: code,
      acceptedDiffCount: checkpoint.acceptedDiffIds.length,
      changedFieldPaths: checkpoint.changedFieldPaths,
      repositoryReadBackVerified: false,
      resumeListVisibilityVerified: false
    });
    repaired = {
      ...repaired,
      activeTurn: repaired.activeTurn
        ? { ...repaired.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
        : repaired.activeTurn,
      workflowState: repaired.taskState && repaired.workflowState
        ? projectTaskStateToWorkflowState(repaired.taskState, { ...repaired.workflowState, status: "waiting_for_user" })
        : repaired.workflowState
    };
    const saved = await this.dependencies.persistence.save(repaired);
    const latest = this.snapshot.activeSession;
    if (latest?.id === session.id && latest.updatedAt === current.updatedAt) {
      this.patchSession(saved, { turnStatus: "waiting_for_user", activeTurnId: turnId, currentObservation: { safeErrorCode: code } });
    }
  }

  setPaused(paused: boolean) {
    this.patch({ turnStatus: paused ? "paused" : "idle" });
  }

  setBusy(busy: boolean) {
    this.patch({ turnStatus: busy ? "running" : "idle" });
  }

  /**
   * External runtimes (Hermes today, companions later) need the same durable
   * task boundary as the native Host path. Resolve only the deterministic
   * task route here; the runtime still owns all model work and narration.
   */
  async prepareRuntimeTask(input: {
    session: AgentSession;
    userMessage: string;
    references?: AgentMessageReference[];
  }) {
    if (!input.userMessage.trim()) return input.session;
    const currentSession = this.snapshot.activeSession?.id === input.session.id
      ? this.snapshot.activeSession
      : input.session;
    const current = currentSession.taskState
      ? attachTaskStateOptions(currentSession, currentSession.taskState)
      : currentSession;
    const decision = classifyTurnIntent({
      text: input.userMessage,
      references: input.references,
      taskState: current.taskState
    });
    if (!decision.newTask || decision.taskMutation === "preserve") return current;
    const reducer = new AgentTaskStateReducer();
    let taskState = current.taskState ?? reducer.create(current, undefined, {
      workflowId: decision.newTask.workflowId,
      step: decision.newTask.stage
    });
    const mutation = current.taskState && decision.taskMutation === "continue"
      ? "new_active_task" as const
      : "new_root_task" as const;
    taskState = reducer.reduce(taskState, {
      type: mutation,
      ...decision.newTask
    });
    let prepared = projectTaskStateIntoSession(current, taskState);
    if (taskState.workflowId === "compose_resume") {
      const snapshot = await this.readQuickActionContext(current);
      if (snapshot.activeProfile && snapshot.activePerson) {
        const profile = snapshot.activeProfile;
        taskState = {
          ...taskState,
          selectedEntities: {
            ...taskState.selectedEntities,
            profileId: profile.id,
            profileVersion: profile.profileRevision
          },
          knownSlots: {
            ...taskState.knownSlots,
            targetProfileId: profile.id,
            targetProfileName: snapshot.activePerson.displayName,
            expectedProfileVersion: profile.profileRevision,
            acknowledgedActiveProfileId: profile.id
          },
          updatedAt: new Date().toISOString()
        };
        prepared = {
          ...projectTaskStateIntoSession(current, taskState),
          personId: current.personId ?? snapshot.activePerson.id,
          activeProfileId: current.activeProfileId ?? profile.id,
          profileVersionNumber: current.profileVersionNumber ?? profile.profileVersionNumber,
          profileRevision: current.profileRevision ?? profile.profileRevision
        };
      }
    }
    const saved = await this.dependencies.persistence.save(prepared);
    this.patchSession(saved, {
      activeTask: saved.taskState,
      currentObservation: { type: "runtime_task_prepared", workflowId: taskState.workflowId, stage: taskState.stage }
    });
    return saved;
  }

  /**
   * Apply only the deterministic part of a semantic UI event before handing
   * the continuation to the selected runtime. This is the host's boundary:
   * candidate/revision validation and durable state transitions happen here;
   * narration, tool choice, and the next workflow step do not.
   */
  async prepareRuntimeUserEvent(input: {
    session: AgentSession;
    event: RuntimeUserEvent;
    pageContext: AgentPageContext;
  }): Promise<PreparedRuntimeUserEvent> {
    const current = this.snapshot.activeSession?.id === input.session.id
      ? this.snapshot.activeSession
      : input.session;
    if (input.event.type === "text_message") {
      const confirmationMode = normalizeResumeCompositionConfirmationText(input.event.text);
      if (
        confirmationMode
        && current.taskState?.workflowId === "compose_resume"
        && hasResumeCompositionCheckpointForConfirmation(current)
      ) {
        const prepared = await this.applyRuntimeAnswer(current, {
          type: "answer",
          field: "resume-composition-decision",
          value: input.event.text
        });
        const command = buildResumeCompositionConfirmationCommand(prepared.session, confirmationMode);
        if (command) {
          return {
            session: prepared.session,
            event: command,
            turnId: prepared.turnId,
            userMessage: "",
            executionOwner: "deterministic_transition",
            deterministicTransitionApplied: prepared.applied,
            deterministicTerminal: true
          };
        }
      }
      const checkpointPrepared = await this.prepareWorkflowCheckpointTextInput(
        current,
        input.event.text,
        current.taskState?.workflowUserInputCheckpoint
      );
      if (checkpointPrepared) return checkpointPrepared;
      const tailoringProjection = getActiveTailoringQuestionProjection(current);
      if (tailoringProjection) {
        return this.applyTailoringTextAnswer(current, input.event.text, tailoringProjection);
      }
      return {
        session: current,
        event: input.event,
        userMessage: input.event.text,
        deterministicTransitionApplied: false
      };
    }
    if (input.event.type === "quick_action_started") {
      const initialized = await this.initializeQuickActionTask(current, {
        type: "quick_action",
        actionId: input.event.actionId,
        text: input.event.text,
        task: input.event.task
      });
      return {
        session: initialized,
        event: input.event,
        userMessage: input.event.text,
        executionOwner: "deterministic_transition",
        deterministicTransitionApplied: true
      };
    }
    if (input.event.type === "entity_selected") {
      const prepared = await this.applyTypedEntitySelection(current, input.event.action, {
        continueAfter: false
      });
      return {
        session: prepared.session,
        event: input.event,
        turnId: prepared.turnId,
        userMessage: "",
        executionOwner: "deterministic_transition",
        deterministicTransitionApplied: prepared.applied
      };
    }
    if (input.event.type === "option_selected") {
      const action = input.event.action;
      if (action.type === "select_entity") {
        const prepared = await this.applyTypedEntitySelection(current, action, { continueAfter: false });
        return {
          session: prepared.session,
          event: { type: "entity_selected", action },
          turnId: prepared.turnId,
          userMessage: "",
          executionOwner: "deterministic_transition",
          deterministicTransitionApplied: prepared.applied
        };
      }
      if (action.type === "task_decision") {
        const prepared = await this.applyTaskDecision(current, action);
        return {
          session: prepared.session,
          event: input.event,
          turnId: prepared.turnId,
          userMessage: "",
          executionOwner: "deterministic_transition",
          deterministicTransitionApplied: prepared.applied,
          // Target persistence is a Host-owned checkpoint. It must never
          // fall through to Hermes with an empty user message, even when an
          // older persisted session needs its apply input reconstructed.
          deterministicTerminal: action.decisionType === "job_target_persistence"
            ? prepared.applied
            : Boolean(prepared.session.pendingConfirmation)
        };
      }
      if (action.type === "answer") {
        const prepared = await this.applyRuntimeAnswer(current, action);
        const confirmationMode = action.field === "resume-composition-decision"
          ? normalizeResumeCompositionConfirmationText(action.value)
          : undefined;
        const command = confirmationMode
          ? buildResumeCompositionConfirmationCommand(prepared.session, confirmationMode)
          : undefined;
        if (command) {
          return {
            session: prepared.session,
            event: command,
            turnId: prepared.turnId,
            userMessage: "",
            executionOwner: "deterministic_transition",
            deterministicTransitionApplied: prepared.applied,
            deterministicTerminal: true
          };
        }
        return {
          session: prepared.session,
          event: input.event,
          turnId: prepared.turnId,
          userMessage: "",
          executionOwner: "deterministic_transition",
          deterministicTransitionApplied: prepared.applied,
          deterministicTerminal: prepared.deterministicTerminal
        };
      }
      if (action.type === "retry_current_step") {
        const prepared = await this.prepareRetryWorkflowStep(current);
        const retryMessage = prepared.session.messages.find((message) =>
          message.role === "user" && message.id === prepared.session.activeTurn?.userMessageId
        )?.content ?? "继续当前步骤";
        return {
          session: prepared.session,
          event: { type: "retry", action },
          turnId: prepared.turnId,
          userMessage: retryMessage,
          executionOwner: "deterministic_transition",
          deterministicTransitionApplied: prepared.applied
        };
      }
    }
    return {
      session: current,
      event: input.event,
      userMessage: "",
      deterministicTransitionApplied: false
    };
  }

  private async prepareWorkflowCheckpointTextInput(
    session: AgentSession,
    value: string,
    checkpoint: WorkflowUserInputCheckpoint | undefined
  ): Promise<PreparedRuntimeUserEvent | undefined> {
    if (!checkpoint || !value.trim()) return undefined;
    const text = value.trim().slice(0, 8_000);
    if (/^(?:需要什么|缺什么|还需要什么|什么信息)[？?。！!]?$/u.test(text)) {
      return this.answerWorkflowCheckpointQuestion(session, text, checkpoint);
    }
    if (checkpoint.kind === "clarification") {
      const projection = getActiveTailoringQuestionProjection(session);
      return projection ? this.applyTailoringTextAnswer(session, text, projection) : undefined;
    }
    if (checkpoint.kind === "resume_choice" || checkpoint.kind === "job_choice") {
      const option = checkpointOptionForText(checkpoint, text);
      const candidateSetRevision = stringValue(
        session.taskState?.knownSlots[checkpoint.kind === "resume_choice" ? "resumeCandidateSetRevision" : "jobCandidateSetRevision"]
      );
      if (!option || !candidateSetRevision) return undefined;
      const action = {
        type: "select_entity" as const,
        entityType: checkpoint.kind === "resume_choice" ? "resume" as const : "job" as const,
        entityId: option.value,
        candidateSetRevision
      };
      const prepared = await this.applyTypedEntitySelection(session, action, {
        continueAfter: false,
        userMessage: text
      });
      if (!prepared.applied) return undefined;
      return {
        session: prepared.session,
        event: { type: "entity_selected", action },
        turnId: prepared.turnId,
        userMessage: "",
        executionOwner: "deterministic_transition",
        deterministicTransitionApplied: true
      };
    }
    if (checkpoint.kind === "target_persistence_choice") {
      const option = checkpointOptionForText(checkpoint, text);
      if (option?.value !== "session_only" && option?.value !== "save_job") return undefined;
      const prepared = await this.applyTaskDecision(session, {
        type: "task_decision",
        decisionType: "job_target_persistence",
        option: option.value
      }, { userMessage: text });
      if (!prepared.applied) return undefined;
      return {
        session: prepared.session,
        event: {
          type: "option_selected",
          action: {
            type: "task_decision",
            decisionType: "job_target_persistence",
            option: option.value
          }
        },
        turnId: prepared.turnId,
        userMessage: "",
        executionOwner: "deterministic_transition",
        deterministicTransitionApplied: true,
        deterministicTerminal: true
      };
    }
    if (checkpoint.kind === "confirmation") {
      const confirmed = /^(?:确认|确定|同意|继续|确认并继续|是|好)[。！!]?$/u.test(text)
        ? true
        : /^(?:取消|不同意|拒绝|不确认|否)[。！!]?$/u.test(text)
          ? false
          : undefined;
      if (confirmed === undefined || !session.pendingConfirmation) return undefined;
      const persisted = await this.persistWorkflowCheckpointUserMessage(session, text, checkpoint);
      return {
        session: persisted.session,
        event: { type: "confirmation", confirmed },
        turnId: persisted.turnId,
        userMessage: "",
        executionOwner: "deterministic_transition",
        deterministicTransitionApplied: true
      };
    }
    if (checkpoint.kind === "review_decision") {
      const persisted = await this.persistWorkflowCheckpointUserMessage(session, text, checkpoint);
      return {
        session: persisted.session,
        event: { type: "text_message", text },
        turnId: persisted.turnId,
        userMessage: text,
        executionOwner: "runtime_continuation",
        deterministicTransitionApplied: true,
        prePersistedUserMessageId: persisted.userMessageId
      };
    }
    return undefined;
  }

  private async persistWorkflowCheckpointUserMessage(
    session: AgentSession,
    text: string,
    checkpoint: WorkflowUserInputCheckpoint
  ) {
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    let current = withTurnCheckpoint(supersedeActiveOptionSets(session), turnId, userMessageId, now);
    current = appendAgentMessage(current, "user", text, {
      id: userMessageId,
      turnId,
      status: "complete",
      metadata: {
        executionOwner: "deterministic_transition",
        workflowCheckpointId: checkpoint.checkpointId,
        workflowCheckpointKind: checkpoint.kind,
        executionState: "running"
      }
    });
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "hermes",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "hermes",
        finalRuntime: current.activeTurn?.finalRuntime ?? "hermes",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        executionOwner: "deterministic_transition",
        status: "running",
        startedAt: now
      }
    };
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, { turnStatus: "running", activeTurnId: turnId });
    return { session: saved, turnId, userMessageId };
  }

  private async answerWorkflowCheckpointQuestion(
    session: AgentSession,
    text: string,
    checkpoint: WorkflowUserInputCheckpoint
  ): Promise<PreparedRuntimeUserEvent> {
    const persisted = await this.persistWorkflowCheckpointUserMessage(session, text, checkpoint);
    const now = new Date().toISOString();
    const options = Array.isArray(checkpoint.promptProjection.options)
      ? checkpoint.promptProjection.options
        .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object" && !Array.isArray(option)))
        .map((option) => stringValue(option.label))
        .filter((label): label is string => Boolean(label))
      : [];
    const response = [
      checkpoint.promptProjection.text,
      ...(options.length ? [`可选操作：${options.join("、")}`] : [])
    ].join("\n\n");
    const assistantMessageId = `agent-checkpoint-answer-${crypto.randomUUID()}`;
    let current = appendAgentMessage(persisted.session, "assistant", response, {
      id: assistantMessageId,
      turnId: persisted.turnId,
      kind: "text",
      type: "text",
      status: "complete",
      parentMessageId: persisted.userMessageId,
      metadata: {
        executionOwner: "deterministic_transition",
        workflowCheckpointId: checkpoint.checkpointId,
        checkpointQuestionAnswered: true
      }
    });
    current = {
      ...current,
      activeTurn: current.activeTurn
        ? { ...current.activeTurn, status: "waiting_for_user", completedAt: now }
        : current.activeTurn
    };
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "waiting_for_user",
      activeTurnId: persisted.turnId,
      currentObservation: { type: "workflow_checkpoint_explained", checkpointId: checkpoint.checkpointId }
    });
    return {
      session: saved,
      event: { type: "text_message", text: "" },
      turnId: persisted.turnId,
      userMessage: "",
      executionOwner: "deterministic_transition",
      deterministicTransitionApplied: true,
      deterministicTerminal: true,
      prePersistedUserMessageId: persisted.userMessageId
    };
  }

  /** Continue a validated event through deterministic/native infrastructure
   * when the configured environment is native-only. */
  continueRuntimeEvent(input: {
    session: AgentSession;
    event: RuntimeUserEvent;
    pageContext: AgentPageContext;
    turnId: string;
    runtimeDiagnostics?: Partial<Pick<AgentTurn, "preferredRuntime" | "attemptedRuntime" | "finalRuntime" | "fallbackUsed" | "fallbackReasonCode" | "hermesRunId" | "nextHermesRunId" | "firstEventAt" | "runtimeFailureAt">>;
  }) {
    return this.resume(
      input.session,
      {
        reason: "external_event",
        observation: { type: input.event.type, event: input.event }
      },
      input.pageContext,
      input.turnId,
      {
        executionOwner: "runtime_continuation",
        runtimeDiagnostics: input.runtimeDiagnostics
      }
    );
  }

  /**
   * Commit the exact, already-reviewed composition checkpoint. This is a
   * Host-owned terminal continuation: it never calls resume(), Hermes, or a
   * model-generated tool selection.
   */
  executeConfirmedResumeComposition(input: {
    session: AgentSession;
    command: ConfirmResumeCompositionCommand;
    pageContext: AgentPageContext;
    turnId?: string;
  }) {
    const operationId = resumeCompositionConfirmationOperationId(input.command);
    const running = this.resumeCompositionExecutions.get(operationId);
    if (running) return running;
    const execution = this.executeConfirmedResumeCompositionOnce(input, operationId)
      .finally(() => this.resumeCompositionExecutions.delete(operationId));
    this.resumeCompositionExecutions.set(operationId, execution);
    return execution;
  }

  private async executeConfirmedResumeCompositionOnce(
    input: {
      session: AgentSession;
      command: ConfirmResumeCompositionCommand;
      pageContext: AgentPageContext;
      turnId?: string;
    },
    operationId: string
  ) {
    let current = this.snapshot.activeSession?.id === input.session.id
      ? this.snapshot.activeSession
      : input.session;
    const turnId = input.turnId ?? current.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
    this.markProgress(current.id);

    let validation: Awaited<ReturnType<AgentHostStore["validateResumeCompositionCheckpoint"]>>;
    try {
      validation = await this.validateResumeCompositionCheckpoint(current, input.command, input.pageContext);
    } catch (error) {
      return this.finishResumeCompositionWriteFailure(
        current,
        turnId,
        operationId,
        input.command,
        safeErrorCode(error),
        errorMessage(error)
      );
    }
    if (validation.kind === "already_committed") {
      const completedAt = new Date().toISOString();
      current = {
        ...settleUserExecutionState(current, turnId, "complete"),
        activeTurn: current.activeTurn
          ? { ...current.activeTurn, status: "completed", completedAt }
          : current.activeTurn
      };
      current = completeTurnCheckpoint(current, turnId, completedAt);
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, {
        turnStatus: "completed",
        activeTurnId: turnId,
        uiAction: resumePreviewUiAction(saved),
        currentObservation: {
          toolName: "career.workflow.compose_resume",
          operationId,
          checkpointId: input.command.checkpointId,
          idempotent: true
        }
      });
      return saved;
    }
    if (validation.kind !== "valid") {
      return this.recoverStaleResumeComposition(
        current,
        input.command,
        turnId,
        operationId,
        validation
      );
    }

    let result: AgentToolResult;
    try {
      const retryFailedOperation = current.taskState?.knownSlots.resumeCompositionWriteFailureOperationId === operationId;
      result = await this.dependencies.executor.execute({
        toolName: "career.workflow.compose_resume",
        toolInput: validation.toolInput,
        operationId,
        confirmed: true,
        confirmationCount: 1,
        logicalTurnId: turnId,
        ...(retryFailedOperation ? { retryFailedOperation: true } : {}),
        careerSessionBinding: validation.binding,
        requireSessionBinding: true
      });
    } catch (error) {
      return this.finishResumeCompositionWriteFailure(
        current,
        turnId,
        operationId,
        input.command,
        safeErrorCode(error),
        errorMessage(error)
      );
    }

    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId,
      content: result.ok ? "已按确认写入隔离的简历版本。" : "简历写入没有完成，已保留当前组装方案。",
      toolName: "career.workflow.compose_resume",
      operationId,
      status: result.ok ? "complete" : "failed",
      metadata: {
        activityState: result.ok ? "complete" : "failed",
        confirmedWrite: {
          toolName: "career.workflow.compose_resume",
          operationId,
          checkpointId: input.command.checkpointId,
          confirmed: true,
          confirmationCount: 1,
          careerSessionBinding: validation.binding,
          sourceFingerprint: input.command.sourceFingerprint
        },
        diagnostic: confirmedToolDiagnostic("career.workflow.compose_resume", result)
      }
    });

    if (!result.ok) {
      return this.finishResumeCompositionWriteFailure(
        current,
        turnId,
        operationId,
        input.command,
        result.error?.code ?? "resume_composition_write_failed",
        result.error?.message ?? "简历写入没有完成，当前组装方案已保留，可以重试。"
      );
    }

    current = applyRuntimeFacadeCheckpoint(
      current,
      "career.workflow.compose_resume",
      mergeAuthoritativeResumeCompositionCheckpoint(result.data, validation.checkpoint)
    );
    current = clearResumeCompositionWriteFailure(current);
    current = attachConfirmedToolArtifact(
      current,
      "compose_resume",
      operationId,
      {
        ...result,
        data: runtimeArtifactResultData("career.workflow.compose_resume", result.data)
      }
    );
    const completedAt = new Date().toISOString();
    current = appendAgentMessage(current, "assistant", "已按你的确认生成隔离的简历版本，可以打开预览。", {
      kind: "text",
      type: "text",
      status: "complete",
      turnId,
      metadata: {
        confirmedWriteCompleted: true,
        confirmedWrite: {
          toolName: "career.workflow.compose_resume",
          operationId,
          checkpointId: input.command.checkpointId,
          confirmed: true,
          confirmationCount: 1,
          careerSessionBinding: validation.binding,
          sourceFingerprint: input.command.sourceFingerprint
        }
      }
    });
    current = {
      ...settleUserExecutionState(current, turnId, "complete"),
      activeTurn: current.activeTurn
        ? { ...current.activeTurn, status: "completed", completedAt }
        : current.activeTurn,
      workflowState: current.taskState && current.workflowState
        ? projectTaskStateToWorkflowState(current.taskState, { ...current.workflowState, status: "completed" })
        : current.workflowState
    };
    current = completeTurnCheckpoint(current, turnId, completedAt);
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "completed",
      activeTurnId: turnId,
      uiAction: resumePreviewUiAction(saved),
      currentObservation: objectValue(result.data)
    });
    return saved;
  }

  private async validateResumeCompositionCheckpoint(
    session: AgentSession,
    command: ConfirmResumeCompositionCommand,
    pageContext: AgentPageContext
  ): Promise<
    | { kind: "valid"; checkpoint: ResumeCompositionCheckpoint; binding: CareerSessionBinding; toolInput: Record<string, unknown> }
    | { kind: "already_committed" }
    | { kind: "stale"; code: string; message: string; refreshable: boolean; binding?: CareerSessionBinding }
  > {
    try {
      resolveCareerSessionBinding({
        sessionId: session.id,
        session,
        pageContext
      });
    } catch {
      return {
        kind: "stale",
        code: "career_session_binding_context_mismatch",
        message: "页面上下文与当前任务绑定不一致，未写入简历；请回到当前任务后重试。",
        refreshable: false
      };
    }
    const task = session.taskState;
    const knownSlots = task?.knownSlots ?? {};
    const knownResult = objectValue(knownSlots.resumeCompositionResult);
    if (task?.workflowId === "compose_resume" && task.stage === "resume_ready" && stringValue(knownResult.resumeId)) {
      return { kind: "already_committed" };
    }
    const binding = careerSessionBindingForSession(session);
    if (!binding) {
      return {
        kind: "stale",
        code: "needs_profile",
        message: "当前还没有可用于生成简历的个人资料。你可以选择已有资料，或先导入一份简历。",
        refreshable: false
      };
    }
    if (
      !task
      || task.workflowId !== "compose_resume"
      || task.knownSlots.resumeCompositionDecision !== "generate"
      || task.knownSlots.resumeCompositionExplicitConfirmation !== true
      || !["confirm_create", "resume_ready"].includes(task.stage)
    ) {
      return {
        kind: "stale",
        code: "resume_composition_confirmation_state_invalid",
        message: "当前组装确认状态已变化，未写入简历；请重新查看最新方案后确认。",
        refreshable: false,
        binding
      };
    }
    const stateCheckpoint = objectValue(knownSlots.resumeCompositionCheckpoint);
    if (
      stringValue(stateCheckpoint.checkpointId) !== command.checkpointId
      || stringValue(stateCheckpoint.contentHash) !== command.contentHash
      || stringValue(stateCheckpoint.profileId) !== command.profileId
      || (numberValue(stateCheckpoint.profileRevision) ?? numberValue(stateCheckpoint.expectedProfileRevision)) !== command.expectedProfileRevision
      || stringValue(stateCheckpoint.mode) !== command.mode
      || (stringValue(stateCheckpoint.jobId) ?? undefined) !== (command.jobId ?? undefined)
    ) {
      return {
        kind: "stale",
        code: "resume_composition_checkpoint_state_mismatch",
        message: "组装方案与当前确认状态不一致，未写入简历；请重新生成方案。",
        refreshable: true,
        binding
      };
    }
    if (binding.profileId !== command.profileId || binding.profileRevision !== command.expectedProfileRevision) {
      return {
        kind: "stale",
        code: "resume_composition_profile_stale",
        message: "个人资料版本已变化，原组装方案已失效，未写入简历；请重新生成方案。",
        refreshable: false,
        binding
      };
    }
    const branchMode = command.branchMode;
    if (branchMode !== "create_new" && branchMode !== "update_existing") {
      return {
        kind: "stale",
        code: "resume_composition_branch_mode_invalid",
        message: "简历分支模式无效，未写入简历；请重新选择创建或更新方式。",
        refreshable: false,
        binding
      };
    }
    if (
      branchMode === "update_existing"
      && task.knownSlots.resumeCompositionBranchModeSource !== "user_explicit"
    ) {
      return {
        kind: "stale",
        code: "resume_composition_update_selection_required",
        message: "更新现有简历需要先明确选择目标简历，未写入简历；请重新选择后确认。",
        refreshable: false,
        binding
      };
    }

    const repository = this.getCareerRepository();
    const profile = await repository.getProfile(command.profileId);
    if (
      !profile
      || profile.personId !== binding.personId
      || profile.version !== binding.profileRevision
      || (profile.profileVersionNumber ?? binding.profileVersionNumber) !== binding.profileVersionNumber
    ) {
      return {
        kind: "stale",
        code: "resume_composition_profile_stale",
        message: "个人资料版本已变化，原组装方案已失效，未写入简历；请重新生成方案。",
        refreshable: false,
        binding
      };
    }

    const stored = await repository.getResumeCompositionCheckpoint(command.checkpointId);
    if (!stored || stored.contentHash !== command.contentHash) {
      return {
        kind: "stale",
        code: "resume_composition_checkpoint_stale",
        message: "组装 checkpoint 已变化或失效，未写入简历；请重新生成方案。",
        refreshable: true,
        binding
      };
    }
    const checkpoint = ResumeCompositionCheckpointSchema.parse(stored);
    if (
      checkpoint.profileId !== command.profileId
      || checkpoint.profileRevision !== command.expectedProfileRevision
      || checkpoint.mode !== command.mode
      || (checkpoint.jobId ?? undefined) !== (command.mode === "job_specific" ? stringValue(stateCheckpoint.jobId) : undefined)
      || (checkpoint.sourceResumeId ?? undefined) !== (command.sourceResumeId ?? undefined)
    ) {
      return {
        kind: "stale",
        code: "resume_composition_checkpoint_binding_mismatch",
        message: "组装 checkpoint 的资料或岗位绑定已变化，未写入简历；请重新生成方案。",
        refreshable: true,
        binding
      };
    }
    if (command.mode === "job_specific") {
      const sourceBranchId = checkpoint.sourceBranchId ?? checkpoint.sourceResumeId;
      if (!sourceBranchId || !command.sourceFingerprint) {
        return {
          kind: "stale",
          code: "resume_composition_source_fingerprint_missing",
          message: "岗位简历来源版本无法核验，未写入简历；请重新生成岗位方案。",
          refreshable: true,
          binding
        };
      }
      const source = await repository.getResumeSourceFingerprint(sourceBranchId);
      if (
        !source
        || source.branchId !== command.sourceFingerprint.branchId
        || source.revisionId !== command.sourceFingerprint.revisionId
        || source.contentHash !== command.sourceFingerprint.contentHash
        || source.presentationHash !== command.sourceFingerprint.presentationHash
        || checkpoint.sourceBranchId !== command.sourceFingerprint.branchId
        || checkpoint.sourceRevisionId !== command.sourceFingerprint.revisionId
        || checkpoint.sourceContentHash !== command.sourceFingerprint.contentHash
        || checkpoint.sourcePresentationHash !== command.sourceFingerprint.presentationHash
      ) {
        return {
          kind: "stale",
          code: "resume_composition_source_stale",
          message: "来源通用简历已变化，原岗位方案已失效，未写入简历；请重新生成方案。",
          refreshable: true,
          binding
        };
      }
    }

    return {
      kind: "valid",
      checkpoint,
      binding,
      toolInput: {
        profileId: checkpoint.profileId,
        expectedProfileRevision: checkpoint.profileRevision,
        mode: checkpoint.mode,
        ...(checkpoint.jobId ? { jobId: checkpoint.jobId } : {}),
        ...(checkpoint.sourceResumeId ? { sourceResumeId: checkpoint.sourceResumeId } : {}),
        checkpointId: checkpoint.checkpointId,
        generalResumeMode: branchMode
      }
    };
  }

  private async recoverStaleResumeComposition(
    session: AgentSession,
    command: ConfirmResumeCompositionCommand,
    turnId: string,
    operationId: string,
    validation: Extract<Awaited<ReturnType<AgentHostStore["validateResumeCompositionCheckpoint"]>>, { kind: "stale" }>
  ) {
    let current = session;
    if (validation.refreshable && validation.binding) {
      try {
        const staleCheckpoint = objectRecordValue(session.taskState?.knownSlots.resumeCompositionCheckpoint);
        const targetContext = objectRecordValue(staleCheckpoint.targetContext);
        const refreshed = await this.dependencies.executor.execute({
          toolName: "career.workflow.compose_resume",
          toolInput: {
            profileId: validation.binding.profileId,
            expectedProfileRevision: validation.binding.profileRevision,
            mode: command.mode,
            ...(command.jobId ? { jobId: command.jobId } : {}),
            ...(command.sourceResumeId ? { sourceResumeId: command.sourceResumeId } : {}),
            ...(stringValue(targetContext.targetDirection) ? { targetDirection: stringValue(targetContext.targetDirection) } : {}),
            ...(stringValue(targetContext.targetAudience) ? { targetAudience: stringValue(targetContext.targetAudience) } : {}),
            ...(stringValue(targetContext.companyType) ? { companyType: stringValue(targetContext.companyType) } : {})
          },
          operationId: `${operationId}-refresh`,
          confirmed: false,
          confirmationCount: 0,
          careerSessionBinding: validation.binding,
          requireSessionBinding: true
        });
        if (refreshed.ok) {
          current = applyRuntimeFacadeCheckpoint(current, "career.workflow.compose_resume", refreshed.data);
          current = clearResumeCompositionConfirmation(current, "review_composition");
          current = appendAgentMessage(current, "assistant", "原组装方案已失效，我已重新生成一份方案，请重新确认后再写入简历。", {
            kind: "text",
            type: "text",
            status: "complete",
            turnId,
            metadata: {
              resumeCompositionRecovery: true,
              staleCode: validation.code,
              refreshedCheckpoint: true
            }
          });
          return this.finishResumeCompositionWaiting(current, turnId, operationId, validation.code);
        }
      } catch {
        // Fall through to the safe review state below. A refresh failure must
        // never turn the stale checkpoint into a write attempt.
      }
    }
    current = clearResumeCompositionConfirmation(current, "review_composition");
    current = appendAgentMessage(current, "assistant", validation.message, {
      kind: "error_status",
      type: "error",
      status: "complete",
      turnId,
      metadata: {
        resumeCompositionRecovery: true,
        staleCode: validation.code,
        refreshedCheckpoint: false
      }
    });
    return this.finishResumeCompositionWaiting(current, turnId, operationId, validation.code);
  }

  private async finishResumeCompositionWriteFailure(
    session: AgentSession,
    turnId: string,
    operationId: string,
    command: ConfirmResumeCompositionCommand,
    code: string,
    message: string
  ) {
    let current = session;
    const existingFailure = current.messages.some((item) =>
      objectRecordValue(item.metadata?.confirmedWrite).operationId === operationId
      && item.metadata?.confirmedWriteFailure === true
    );
    if (!existingFailure) {
      current = appendAgentMessage(current, "assistant", `${message} 当前 checkpoint 已保留，可以重试保存。`, {
        kind: "error_status",
        type: "error",
        status: "complete",
        turnId,
        metadata: {
          confirmedWriteFailure: true,
          confirmedWrite: {
            toolName: "career.workflow.compose_resume",
            operationId,
            checkpointId: command.checkpointId,
            confirmed: true,
            confirmationCount: 1,
            errorCode: code
          }
        }
      });
    }
    if (current.taskState) {
      current = projectTaskStateIntoSession(current, {
        ...current.taskState,
        knownSlots: {
          ...current.taskState.knownSlots,
          resumeCompositionWriteFailure: { code, operationId },
          resumeCompositionWriteFailureOperationId: operationId
        },
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      });
    }
    return this.finishResumeCompositionWaiting(current, turnId, operationId, code);
  }

  private async finishResumeCompositionWaiting(
    session: AgentSession,
    turnId: string,
    operationId: string,
    code: string
  ) {
    const now = new Date().toISOString();
    let current: AgentSession = {
      ...settleUserExecutionState(session, turnId, "complete"),
      activeTurn: session.activeTurn
        ? { ...session.activeTurn, status: "waiting_for_user" as const, completedAt: now }
        : session.activeTurn,
      ...(session.taskState && session.workflowState
        ? { workflowState: projectTaskStateToWorkflowState(session.taskState, { ...session.workflowState, status: "waiting_for_user" }) }
        : {})
    };
    current = completeTurnCheckpoint(current, turnId, now);
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "waiting_for_user",
      activeTurnId: turnId,
      currentObservation: {
        toolName: "career.workflow.compose_resume",
        operationId,
        safeErrorCode: code,
        checkpointId: stringValue(saved.taskState?.knownSlots.resumeCompositionCheckpoint && objectValue(saved.taskState.knownSlots.resumeCompositionCheckpoint).checkpointId)
      }
    });
    return saved;
  }

  /** Runtime-owned bridge for events whose deterministic operation is itself
   * the action (approval, artifact review, regenerate, or workflow control). */
  dispatchRuntimeUserEvent(input: {
    session: AgentSession;
    event: RuntimeUserEvent;
    pageContext: AgentPageContext;
  }) {
    const { event } = input;
    if (event.type === "confirm_resume_composition") {
      return this.executeConfirmedResumeComposition({
        session: input.session,
        command: event,
        pageContext: input.pageContext,
        turnId: input.session.activeTurn?.id
      });
    }
    if (event.type === "confirmation") {
      return this.dispatch({ type: "confirmation", confirmed: event.confirmed }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "artifact_action") {
      return this.dispatch({ type: "artifact_action", action: event.action }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "regenerate") {
      return this.dispatch({ type: "regenerate_message", messageId: event.messageId }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "edit_message") {
      return this.dispatch({ type: "edit_message", messageId: event.messageId, text: event.text }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "workflow_control") {
      return this.dispatch({ type: "ui_control", action: event.action }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "retry") {
      return this.dispatch({ type: "option", action: event.action ?? { type: "retry_current_step" } }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "option_selected") {
      return this.dispatch({ type: "option", action: event.action }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "entity_selected") {
      return this.dispatch({ type: "option", action: event.action }, { session: input.session, pageContext: input.pageContext });
    }
    if (event.type === "text_message") {
      return this.dispatch({ type: "message", text: event.text, references: event.references }, { session: input.session, pageContext: input.pageContext });
    }
    return this.dispatch({
      type: "quick_action",
      actionId: event.actionId,
      text: event.text,
      task: event.task
    }, { session: input.session, pageContext: input.pageContext });
  }

  /**
   * Publish a runtime-owned conversation shell before an external runtime
   * performs network or model work. Native turns already use startTurn; this
   * path is for Hermes (and future companion runtimes) so the UI never waits
   * for the first model token before showing progress.
   */
  async beginRuntimeShell(input: {
    session: AgentSession;
    userMessage: string;
    runtimeId: string;
    turnId?: string;
    signal?: AbortSignal;
    userMessageId?: string;
    appendUserMessage?: boolean;
    runtimeDiagnostics?: Partial<Pick<NonNullable<AgentSession["activeTurn"]>, "preferredRuntime" | "attemptedRuntime" | "finalRuntime" | "executionOwner" | "fallbackUsed" | "fallbackReasonCode" | "hermesRunId" | "nextHermesRunId" | "firstEventAt" | "runtimeFailureAt" | "incidentTraceId" | "runtimeAttempts" | "primaryCausalChain" | "secondaryRecoveryFailures" | "transportReattachAttempted" | "semanticRetryAttempted" | "runtimeRestartAttempted" | "turnStartSnapshot" | "runtimeFailureSnapshot" | "previousRuntimeIncidents" | "runtimeFailureDiagnostics" | "cancellation" | "abortTraces" | "recoveryAttempted">>;
  }) {
    if (input.signal?.aborted) {
      return {
        session: input.session,
        turnId: input.turnId ?? input.session.activeTurn?.id ?? `runtime-turn-${crypto.randomUUID()}`,
        userMessageId: input.userMessageId ?? input.session.activeTurn?.userMessageId ?? `agent-user-${crypto.randomUUID()}`,
        assistantMessageId: input.session.activeTurn?.visibleAssistantMessageId ?? `agent-thinking-${crypto.randomUUID()}`
      };
    }
    const now = new Date().toISOString();
    const turnId = input.turnId ?? `runtime-turn-${crypto.randomUUID()}`;
    const incidentTraceId = input.runtimeDiagnostics?.incidentTraceId ?? createIncidentTraceId();
    const appendUserMessage = Boolean(input.userMessage.trim()) && input.appendUserMessage !== false;
    const reusableAssistant = !input.userMessage.trim()
      ? input.session.messages.findLast((message) =>
          message.role === "assistant"
          && message.turnId === turnId
          && !isWorkflowInteractionMessage(message)
          && message.metadata?.retracted !== true
        )
      : undefined;
    const userMessageId = input.userMessage.trim()
      ? input.userMessageId ?? (input.appendUserMessage === false
        ? input.session.activeTurn?.sourceUserMessageId ?? input.session.activeTurn?.userMessageId ?? `agent-user-${crypto.randomUUID()}`
        : `agent-user-${crypto.randomUUID()}`)
      : input.session.activeTurn?.sourceUserMessageId ?? input.session.activeTurn?.userMessageId ?? `agent-user-${crypto.randomUUID()}`;
    const assistantMessageId = reusableAssistant?.id ?? `agent-thinking-${crypto.randomUUID()}`;
    const inheritedRuntimeSnapshot = input.runtimeDiagnostics?.runtimeFailureSnapshot;
    const previousRuntimeIncidents = [
      ...(input.runtimeDiagnostics?.previousRuntimeIncidents ?? []),
      ...(inheritedRuntimeSnapshot ? [inheritedRuntimeSnapshot] : [])
    ].slice(-16);
    const runtimeDiagnostics = { ...(input.runtimeDiagnostics ?? {}) };
    delete runtimeDiagnostics.runtimeFailureSnapshot;
    delete runtimeDiagnostics.previousRuntimeIncidents;
    let current = appendUserMessage
      ? withTurnCheckpoint(input.session, turnId, userMessageId, now)
      : input.session;
    current = appendUserMessage
      ? appendAgentMessage(current, "user", input.userMessage.trim(), {
          id: userMessageId,
          turnId,
          status: "complete",
          metadata: { executionState: "running", runtimeId: input.runtimeId }
        })
      : current;
    if (appendUserMessage && current.taskState) {
      // Persist the UserMessage and capture its same-turn target before any
      // Hermes event can request a Career facade. This is context binding,
      // not intent routing; Hermes still chooses the next tool/action.
      const taskState = new AgentTaskStateReducer().reduce(current.taskState, {
        type: "user_message",
        message: input.userMessage.trim(),
        sessionId: current.id,
        messageId: userMessageId,
        turnId,
        capturedAt: now,
        turnIntent: "continue_current_task"
      });
      current = projectTaskStateIntoSession(current, taskState);
    }
    current = reusableAssistant
      ? {
          ...current,
          messages: current.messages.map((message) => message.id === reusableAssistant.id
            ? {
                ...message,
                content: "正在回复…",
                kind: "assistant_thinking" as const,
                type: "assistant_thinking" as const,
                status: "thinking" as const,
                streaming: true,
                parentMessageId: userMessageId,
                metadata: { ...message.metadata, runtimeId: input.runtimeId, retracted: false },
                updatedAt: now
              }
            : message),
          updatedAt: now
        }
      : appendAgentMessage(current, "assistant", "正在回复…", {
          id: assistantMessageId,
          turnId,
          kind: "assistant_thinking",
          type: "assistant_thinking",
          status: "thinking",
          streaming: true,
          parentMessageId: userMessageId,
          metadata: { runtimeId: input.runtimeId }
        });
    current = {
      ...current,
      runtimeId: input.runtimeId,
      activeTurn: {
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        runtimeId: input.runtimeId,
        preferredRuntime: input.runtimeDiagnostics?.preferredRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        attemptedRuntime: input.runtimeDiagnostics?.attemptedRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        finalRuntime: input.runtimeDiagnostics?.finalRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        executionOwner: input.runtimeDiagnostics?.executionOwner ?? (input.userMessage.trim() ? input.runtimeId as "native" | "hermes" : "runtime_continuation"),
        fallbackUsed: false,
        incidentTraceId,
        visibleAssistantMessageId: assistantMessageId,
        workflowCheckpoint: current.taskState ? {
          workflowId: current.taskState.workflowId,
          stage: current.taskState.stage,
          selectedEntities: current.taskState.selectedEntities
        } : undefined,
        ...(previousRuntimeIncidents.length ? { previousRuntimeIncidents } : {}),
        toolFailures: [],
        ...runtimeDiagnostics,
        status: "running",
        startedAt: now
      }
    };
    if (input.signal?.aborted) return { session: current, turnId, userMessageId, assistantMessageId };
    const saved = await this.dependencies.persistence.save(current);
    if (input.signal?.aborted) {
      const latest = typeof this.dependencies.persistence.get === "function"
        ? await this.dependencies.persistence.get(current.id)
        : undefined;
      const stopped = settleThinkingMessages(
        completeTurn(latest ?? saved, "aborted"),
        turnId
      );
      const committed = await this.dependencies.persistence.save(stopped);
      this.patchSession(committed, { turnStatus: "paused", activeTurnId: turnId });
      return {
        session: committed,
        turnId,
        userMessageId,
        assistantMessageId
      };
    }
    this.patchSession(saved, {
      turnStatus: "running",
      activeTurnId: turnId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      currentObservation: { runtimeId: input.runtimeId, message: "正在回复…" }
    });
    return { session: saved, turnId, userMessageId, assistantMessageId };
  }

  async applyRuntimeEvent(event: AgentRuntimeEvent, assistantMessageId: string) {
    const queued = this.runtimeEventQueue.then(() => this.applyRuntimeEventNow(event, assistantMessageId));
    this.runtimeEventQueue = queued.then(() => undefined, () => undefined);
    return queued;
  }

  private scheduleStreamingCheckpoint(session: AgentSession, assistantMessageId: string) {
    const assistant = session.messages.find((message) => message.id === assistantMessageId);
    if (!assistant || session.activeTurn?.status !== "running") return;
    this.streamCheckpointSessionId = session.id;
    this.streamCheckpointAssistantId = assistantMessageId;
    const meaningfulDelta = assistant.content.length - this.streamCheckpointPersistedLength;
    if (meaningfulDelta >= 1200) {
      void this.flushStreamingCheckpoint();
      return;
    }
    if (this.streamCheckpointTimer) return;
    this.streamCheckpointTimer = setTimeout(() => {
      this.streamCheckpointTimer = undefined;
      void this.flushStreamingCheckpoint();
    }, 750);
  }

  private async flushStreamingCheckpoint() {
    if (this.streamCheckpointTimer) {
      clearTimeout(this.streamCheckpointTimer);
      this.streamCheckpointTimer = undefined;
    }
    if (this.streamCheckpointInFlight) {
      this.streamCheckpointQueued = true;
      await this.streamCheckpointInFlight;
      if (this.streamCheckpointQueued) {
        this.streamCheckpointQueued = false;
        await this.flushStreamingCheckpoint();
      }
      return;
    }
    const sessionId = this.streamCheckpointSessionId;
    if (!sessionId || this.snapshot.activeSessionId !== sessionId) return;
    const current = this.snapshot.activeSession;
    if (!current || current.id !== sessionId || current.activeTurn?.status !== "running") return;
    const assistantId = this.streamCheckpointAssistantId;
    const assistant = assistantId ? current.messages.find((message) => message.id === assistantId) : undefined;
    if (!assistant || assistant.content.length <= this.streamCheckpointPersistedLength) return;
    const before = current;
    this.streamCheckpointInFlight = (async () => {
      try {
        const saved = await this.dependencies.persistence.save(before);
        this.streamCheckpointPersistedLength = assistant.content.length;
        const latest = this.snapshot.activeSession;
        if (latest?.id === before.id && latest.updatedAt === before.updatedAt) this.patchSession(saved);
      } catch {
        // The next bounded checkpoint or terminal save retries the snapshot.
      } finally {
        this.streamCheckpointInFlight = undefined;
      }
    })();
    await this.streamCheckpointInFlight;
    if (this.streamCheckpointQueued) {
      this.streamCheckpointQueued = false;
      await this.flushStreamingCheckpoint();
    }
  }

  private clearStreamingCheckpoint() {
    if (this.streamCheckpointTimer) clearTimeout(this.streamCheckpointTimer);
    this.streamCheckpointTimer = undefined;
    this.streamCheckpointSessionId = undefined;
    this.streamCheckpointAssistantId = undefined;
    this.streamCheckpointPersistedLength = 0;
    this.streamCheckpointQueued = false;
  }

  private async applyRuntimeEventNow(event: AgentRuntimeEvent, assistantMessageId: string) {
    const current = this.snapshot.activeSession;
    if (!current || current.id !== event.sessionId) return undefined;
    const assistant = current.messages.find((message) => message.id === assistantMessageId);
    // Runtime events are quarantined unless they belong to the visible
    // assistant shell for the same logical turn. This prevents a late Hermes
    // event or a restarted run from mutating the next user turn.
    if (
      !current.activeTurn
      || current.activeTurn.id !== event.turnId
      || assistant?.turnId !== event.turnId
    ) return undefined;
    if (event.eventId && current.activeTurn.projectedHermesEventIds?.includes(event.eventId)) return current;
    let next = current;
    if (event.eventId) {
      next = {
        ...next,
        activeTurn: next.activeTurn
          ? {
              ...next.activeTurn,
              projectedHermesEventIds: [...(next.activeTurn.projectedHermesEventIds ?? []), event.eventId].slice(-512)
            }
          : next.activeTurn
      };
    }
    let lateTailoringRecovery = false;
    const runHandleResult = HermesRunHandleSchema.safeParse(objectValue(event.data).runHandle);
    next = applyRuntimeEventDiagnostics(next, event, runHandleResult.success ? runHandleResult.data.runId : undefined);
    if (runHandleResult.success) next = { ...next, hermesRun: runHandleResult.data };
    if (
      next.taskState?.knownSlots.canonicalWorkflowFailure
      && !["turn_completed", "turn_failed"].includes(event.type)
    ) {
      const persisted = await this.dependencies.persistence.save(next);
      this.patchSession(persisted, {
        turnStatus: "waiting_for_user",
        activeTurnId: event.turnId,
        currentObservation: { type: "canonical_workflow_failure_settled" }
      });
      return persisted;
    }
    const activeTailoringProjection = getActiveTailoringQuestionProjection(next);
    if (event.type === "progress" || event.type === "reasoning_status") {
      if (!activeTailoringProjection && (!assistant || assistant.metadata?.runtimeTextStarted !== true)) {
        next = replaceRuntimeShellMessage(next, assistantMessageId, event.message ?? "正在回复…", event, true);
      }
      const persisted = runHandleResult.success ? await this.dependencies.persistence.save(next) : next;
      this.patchSession(persisted, { currentObservation: { runtimeId: "hermes", message: event.message } });
      return persisted;
    }
    if (event.type === "turn_paused" || event.type === "turn_resumed") {
      if (activeTailoringProjection) {
        next = projectTaskStateIntoSession(next, normalizeAgentTaskState(next.taskState!));
        next = projectActiveTailoringQuestionToChat(next, next.taskState!);
        next = {
          ...next,
          activeTurn: next.activeTurn
            ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
            : next.activeTurn
        };
      }
      const persisted = runHandleResult.success || activeTailoringProjection
        ? await this.dependencies.persistence.save(next)
        : next;
      this.patchSession(persisted, {
        turnStatus: activeTailoringProjection ? "waiting_for_user" : "running",
        activeTurnId: event.turnId,
        currentObservation: activeTailoringProjection ? { type: "tailoring_question_waiting", message: "等待你的补充说明。" } : event.data ?? event.message
      });
      return persisted;
    }
    if (event.type === "text_delta") {
      if (activeTailoringProjection && (assistant?.metadata?.retracted === true || next.activeTurn?.status === "waiting_for_user")) {
        const persisted = runHandleResult.success ? await this.dependencies.persistence.save(next) : next;
        this.patchSession(persisted, { turnStatus: "waiting_for_user", activeTurnId: event.turnId, currentObservation: { type: "stale_text_delta_ignored" } });
        return persisted;
      }
      next = replaceRuntimeShellMessage(next, assistantMessageId, `${assistant?.content ?? ""}${event.delta ?? ""}`, event, true);
      this.scheduleStreamingCheckpoint(next, assistantMessageId);
    }
    if (["tool_call_started", "tool_call_requested", "tool_call_completed", "tool_call_failed"].includes(event.type)) {
      const operationId = event.operationId ?? `runtime-tool-${crypto.randomUUID()}`;
      const logicalToolOperationId = stringValue(objectValue(event.data).logicalToolOperationId);
      const eventData = objectValue(event.data);
      const eventRunId = stringValue(objectValue(eventData.runHandle).runId)
        ?? stringValue(eventData.runId);
      if (isCanonicalTailorFacadeToolName(event.toolName, eventData)) {
        const reducer = new AgentTaskStateReducer();
        const baseline = next.taskState ?? reducer.create(next, "generate_job_specific_resume", {
          workflowId: "tailor_resume",
          step: "choose_resume_source"
        });
        const currentStage = normalizeTailoringStage(baseline.stage) ?? "choose_resume_source";
        const promoted = reducer.reduce(baseline, {
          type: "authoritative_workflow_selected",
          rootGoal: "generate_job_specific_resume",
          workflowId: "tailor_resume",
          stage: currentStage,
          completionType: "transactional"
        });
        next = projectTaskStateIntoSession(next, promoted);
      }
      const eventResult = objectValue(eventData.result ?? eventData);
      const structuredResult = objectValue(eventResult.structuredContent);
      const projectedResult = typeof structuredResult.ok === "boolean" ? structuredResult : eventResult;
      const resultDiagnostics = objectValue(projectedResult.diagnostics ?? eventResult.diagnostics ?? eventData.diagnostics);
      const resultExplicitlyFailed = projectedResult.ok === false
        || eventData.isError === true
        || eventData.is_error === true
        || Object.keys(objectValue(projectedResult.error)).length > 0
        || Boolean(stringValue(eventResult.safeErrorCode) || stringValue(resultDiagnostics.safeErrorCode));
      const contradictoryCompletion = event.type === "tool_call_completed"
        && (resultExplicitlyFailed
          || resultDiagnostics.toolResultIsError === true
          || Boolean(stringValue(resultDiagnostics.safeDomainErrorCode) && stringValue(resultDiagnostics.safeDomainErrorCode) !== "none"));
      const effectiveFailure = event.type === "tool_call_failed" || contradictoryCompletion;
      const status = effectiveFailure ? "failed" : event.type === "tool_call_completed" ? "complete" : "pending";
      next = upsertAgentActivity(next, {
        id: `agent-tool-${logicalToolOperationId ?? operationId}`,
        turnId: event.turnId,
        content: effectiveFailure
          ? event.error?.message ?? "Career 工具执行失败。"
          : event.type === "tool_call_completed" ? "Career 工具执行完成。" : `正在调用 ${event.toolName ?? "Career 工具"}…`,
        toolName: event.toolName,
        operationId,
        status,
        metadata: {
          runtimeId: "hermes",
          activityState: status,
          ...(logicalToolOperationId ? { logicalToolOperationId } : {}),
          ...(eventRunId ? { hermesRunId: eventRunId } : {}),
          transportOperationIds: [operationId],
          operationId,
          ...(event.error?.code ? { safeErrorCode: event.error.code } : {}),
          ...(effectiveFailure && event.toolName ? { requestedToolName: event.toolName } : {}),
          ...(Object.keys(resultDiagnostics).length ? { toolFailureDiagnostics: resultDiagnostics } : {}),
          ...(objectValue(event.data).requestedHermesToolName && typeof objectValue(event.data).requestedHermesToolName === "string"
            ? { requestedHermesToolName: objectValue(event.data).requestedHermesToolName }
            : {}),
          ...(objectValue(event.data).stableCareerToolName && typeof objectValue(event.data).stableCareerToolName === "string"
            ? { stableCareerToolName: objectValue(event.data).stableCareerToolName }
            : {})
        }
      });
      if (event.type === "tool_call_completed") {
        next = markTailoringAnswerConsumed(next, event.turnId, operationId);
        // Bridge callbacks carry `{ result, contract }`, while a few runtime
        // adapters emit the safe tool result directly in `data`. Accept both
        // shapes so the canonical TaskState is reduced exactly once either
        // way; a progress-shaped event still has no `ok` flag and is ignored.
        const result = typeof structuredResult.ok === "boolean" ? structuredResult : eventResult;
        const contract = objectValue(eventData.contract);
        if (result.ok === true && !contradictoryCompletion) {
          next = applyRuntimeFacadeCheckpoint(next, event.toolName ?? "", result.data);
          const sourceToolName = runtimeArtifactSourceToolName(
            event.toolName ?? "",
            stringValue(contract.sourceToolName)
          );
          if (next.taskState && !event.toolName?.startsWith("career.workflow.")) {
            const observedTask = new AgentTaskStateReducer().reduce(next.taskState, {
              type: "tool_observation",
              toolName: sourceToolName,
              observation: result.data,
              artifactIds: Array.isArray(result.artifacts)
                ? result.artifacts.flatMap((artifact) => {
                    const id = stringValue(objectValue(artifact).id);
                    return id ? [id] : [];
                  })
                : []
            });
            next = projectTaskStateIntoSession(next, observedTask);
          }
          next = attachConfirmedToolArtifact(next, sourceToolName, operationId, {
            ok: true,
            data: runtimeArtifactResultData(event.toolName ?? "", result.data),
            artifactIds: Array.isArray(result.artifacts)
              ? result.artifacts.flatMap((artifact) => {
                  const id = stringValue(objectValue(artifact).id);
                  return id ? [id] : [];
                })
              : []
          });
          // The official Hermes API emits tool lifecycle events separately
          // from the browser bridge result. If the terminal narration wins
          // that race, the task projection is still authoritative, but its
          // actionable options were computed before the facade checkpoint
          // arrived. Re-project them after accepting the result so a waiting
          // composition never becomes a dead-end.
          if (next.taskState) next = attachTaskStateOptions(next, next.taskState);
          if (getActiveTailoringQuestionProjection(next)) {
            next = projectActiveTailoringQuestionToChat(next, next.taskState!);
            next = {
              ...next,
              activeTurn: next.activeTurn
                ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
                : next.activeTurn
            };
          }
        } else if (result.ok === false || contradictoryCompletion) {
          if (event.toolName?.startsWith("career.workflow.") && result.data !== undefined) {
            next = applyRuntimeFacadeCheckpoint(next, event.toolName, result.data);
          }
          const failureToolName = runtimeArtifactSourceToolName(event.toolName ?? "", stringValue(contract.sourceToolName));
          const errorCode = stringValue(objectValue(result.error).code)
            ?? stringValue(resultDiagnostics.safeDomainErrorCode)
            ?? "career_tool_failed";
          const errorMessage = stringValue(objectValue(result.error).message);
          const canonicalWorkflowValidationFailure = isCanonicalWorkflowValidationFailure(
            event.toolName,
            errorCode,
            resultDiagnostics
          );
          const recoverable = canonicalWorkflowValidationFailure || objectValue(result.error).recoverable !== false;
          if (next.taskState) next = projectTaskStateIntoSession(next, new AgentTaskStateReducer().reduce(next.taskState, {
            type: "tool_failure",
            toolName: failureToolName,
            operationId,
            errorCode,
            message: errorMessage,
            recoverable
          }));
          next = recordRuntimeToolFailure(next, {
            toolName: failureToolName,
            operationId,
            code: errorCode,
            message: errorMessage,
            recoverable,
            diagnostics: Object.keys(resultDiagnostics).length ? resultDiagnostics : undefined,
            occurredAt: event.timestamp
          });
          if (canonicalWorkflowValidationFailure && next.taskState) {
            const taskState = {
              ...next.taskState,
              knownSlots: {
                ...next.taskState.knownSlots,
                canonicalWorkflowFailure: {
                  code: errorCode,
                  operationId,
                  recoverable: true
                }
              },
              completionStatus: "waiting_for_user" as const,
              updatedAt: new Date().toISOString()
            };
            next = projectTaskStateIntoSession(next, normalizeAgentTaskState(taskState));
            next = replaceRuntimeShellMessage(
              next,
              assistantMessageId,
              runtimeFailureRecoveryText(errorCode, next.taskState, resultDiagnostics),
              { ...event, error: { code: errorCode, message: "当前输入还没有完成。", recoverable: true } },
              false,
              false
            );
            next = attachTaskStateOptions(next, next.taskState!);
            next = {
              ...next,
              activeTurn: next.activeTurn
                ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
                : next.activeTurn
            };
            lateTailoringRecovery = true;
          }
          if (next.taskState?.knownSlots.tailoringApplyFailure && next.activeTurn?.status !== "running") {
            next = replaceRuntimeShellMessage(next, assistantMessageId, TAILORING_APPLY_FAILURE_MESSAGE, {
              ...event,
              error: { code: errorCode, message: TAILORING_APPLY_FAILURE_MESSAGE, recoverable: true }
            }, false, true);
            next = withRetryCurrentStepOption(next, assistantMessageId);
            next = {
              ...next,
              activeTurn: next.activeTurn
                ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
                : next.activeTurn
            };
            lateTailoringRecovery = true;
          }
        }
      }
      if (event.type === "tool_call_failed") {
        const failedResult = objectValue(objectValue(event.data).result);
        if (event.toolName?.startsWith("career.workflow.") && failedResult.data !== undefined) {
          next = applyRuntimeFacadeCheckpoint(next, event.toolName, failedResult.data);
        }
        const failureToolName = runtimeArtifactSourceToolName(event.toolName ?? "", stringValue(objectValue(event.data).stableCareerToolName));
        const failureDiagnostics = objectValue(
          objectValue(event.data).diagnostics
            ?? failedResult.diagnostics
            ?? objectValue(failedResult.error).diagnostics
        );
        const errorCode = event.error?.code
          ?? stringValue(failureDiagnostics.safeDomainErrorCode)
          ?? "career_tool_failed";
        const canonicalWorkflowValidationFailure = isCanonicalWorkflowValidationFailure(
          event.toolName,
          errorCode,
          failureDiagnostics
        );
        if (next.taskState) next = projectTaskStateIntoSession(next, new AgentTaskStateReducer().reduce(next.taskState, {
          type: "tool_failure",
          toolName: failureToolName,
          operationId,
          errorCode,
          message: event.error?.message,
          recoverable: canonicalWorkflowValidationFailure || event.error?.recoverable
        }));
        next = recordRuntimeToolFailure(next, {
          toolName: failureToolName,
          operationId,
          code: errorCode,
          message: event.error?.message,
          recoverable: event.error?.recoverable,
          diagnostics: Object.keys(failureDiagnostics).length
            ? failureDiagnostics
            : undefined,
          occurredAt: event.timestamp
        });
        if (canonicalWorkflowValidationFailure && next.taskState) {
          const taskState = {
            ...next.taskState,
            knownSlots: {
              ...next.taskState.knownSlots,
              canonicalWorkflowFailure: {
                code: errorCode,
                operationId,
                recoverable: true
              }
            },
            completionStatus: "waiting_for_user" as const,
            updatedAt: new Date().toISOString()
          };
          next = projectTaskStateIntoSession(next, normalizeAgentTaskState(taskState));
          next = replaceRuntimeShellMessage(
            next,
            assistantMessageId,
            runtimeFailureRecoveryText(errorCode, next.taskState, failureDiagnostics),
            { ...event, error: { code: errorCode, message: "当前输入还没有完成。", recoverable: true } },
            false,
            false
          );
          next = attachTaskStateOptions(next, next.taskState!);
          next = {
            ...next,
            activeTurn: next.activeTurn
              ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
              : next.activeTurn
          };
          lateTailoringRecovery = true;
        }
        if (next.taskState?.knownSlots.tailoringApplyFailure && next.activeTurn?.status !== "running") {
          next = replaceRuntimeShellMessage(next, assistantMessageId, TAILORING_APPLY_FAILURE_MESSAGE, event, false, true);
          next = withRetryCurrentStepOption(next, assistantMessageId);
          next = {
            ...next,
            activeTurn: next.activeTurn
              ? { ...next.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString() }
              : next.activeTurn
          };
          lateTailoringRecovery = true;
        }
        next = {
          ...next,
          activeTurn: next.activeTurn
            ? {
                ...next.activeTurn,
                lastFailedTool: failureToolName,
                lastFailedOperationId: operationId,
                lastSafeErrorCode: event.error?.code ?? "career_tool_failed"
              }
            : next.activeTurn
        };
      }
    }
    if (event.type === "approval_required") {
      const data = objectValue(event.data);
      const contract = objectValue(data.contract);
      const sourceToolName = stringValue(contract.sourceToolName) ?? event.toolName ?? "career_tool";
      const operationId = event.operationId ?? `runtime-approval-${crypto.randomUUID()}`;
      next = {
        ...next,
        pendingConfirmation: {
          id: `confirmation-${operationId}`,
          turnId: event.turnId,
          operationId,
          toolName: sourceToolName,
          title: "确认执行 Career 操作",
          description: event.message ?? "这项操作需要你的明确确认后才能继续。",
          destructive: contract.safetyClass === "DESTRUCTIVE",
          status: "pending",
          requestedAt: new Date().toISOString()
        },
        pendingToolCall: {
          turnId: event.turnId,
          toolName: sourceToolName,
          operationId,
          input: objectValue(data.input)
        },
          ...(next.workflowState ? { workflowState: { ...next.workflowState, status: "waiting_for_confirmation" as const } } : {})
      };
    }
    if (event.type === "turn_completed" || event.type === "turn_failed") {
      if (next.taskState) {
        next = projectTaskStateIntoSession(next, normalizeAgentTaskState(next.taskState));
        const questionState = getActiveTailoringQuestionProjection(next);
        if (questionState) next = projectActiveTailoringQuestionToChat(next, next.taskState!);
      }
      const tailoringQuestionWaiting = Boolean(getActiveTailoringQuestionProjection(next));
      const domainFailureWaiting = isCareerDomainPreconditionCode(event.error?.code)
        || objectValue(event.data).domainFailure === true
        && objectValue(event.data).waitingForUser === true;
      const completionDecision = next.taskState ? new AgentGoalCompletionGuard().evaluate(next.taskState) : undefined;
      const completionNeedsRecovery = event.type === "turn_completed"
        && Boolean(completionDecision && !completionDecision.canFinish);
      const completionBlocked = !domainFailureWaiting && completionDecision?.reason === "blocked";
      const completionWaiting = domainFailureWaiting
        || completionNeedsRecovery
        || completionDecision?.reason === "waiting_for_user"
        || completionDecision?.reason === "waiting_for_confirmation"
        || tailoringQuestionWaiting;
      const completionWaitingForConfirmation = completionDecision?.reason === "waiting_for_confirmation";
      const tailoringRecovery = Boolean(next.taskState?.knownSlots.tailoringApplyFailure);
      const tailoringQuestionRecovery = next.taskState?.knownSlots.lastSafeErrorCode === "tailoring_questions_incomplete";
      const canonicalWorkflowFailure = Boolean(next.taskState?.knownSlots.canonicalWorkflowFailure);
      const terminalDiagnostics = objectValue(
        objectValue(event.data).diagnostics
          ?? objectValue(event.data).toolFailureDiagnostics
          ?? next.taskState?.knownSlots.canonicalWorkflowFailure
      );
      const candidate = canonicalWorkflowFailure
        ? runtimeFailureRecoveryText(
            stringValue(terminalDiagnostics.safeDomainErrorCode)
              ?? stringValue(terminalDiagnostics.code)
              ?? event.error?.code,
            next.taskState,
            terminalDiagnostics
          )
        : completionNeedsRecovery && completionDecision
        ? completionGuardRecoveryText(completionDecision, next.taskState)
        : tailoringRecovery
        ? "已采用的修改仍保留，但岗位简历写入没有完成。可以从当前步骤重试。"
        : tailoringQuestionWaiting && next.taskState
          ? formatCurrentTailoringQuestion(next.taskState)
        : tailoringQuestionRecovery && next.taskState
          ? formatCurrentTailoringQuestion(next.taskState)
        : event.type === "turn_failed"
        ? runtimeFailureRecoveryText(
            event.error?.code,
            next.taskState,
            objectValue(objectValue(event.data).diagnostics ?? objectValue(event.data).toolFailureDiagnostics)
          )
        : event.message ?? next.messages.find((message) => message.id === assistantMessageId)?.content ?? "当前任务已完成。";
      const grounding = next.taskState
        ? evaluateGroundedResumeOutput({ text: candidate, taskState: next.taskState, artifactRefs: next.artifactRefs })
        : { allowed: true as const };
      const blocked = !canonicalWorkflowFailure && !tailoringQuestionWaiting && !completionWaiting && !tailoringRecovery && !tailoringQuestionRecovery && !grounding.allowed;
      const terminalFailed = !canonicalWorkflowFailure && !tailoringQuestionWaiting && ((event.type === "turn_failed" && !tailoringRecovery && !tailoringQuestionRecovery) || blocked || completionBlocked);
      const terminalWaiting = !terminalFailed && (canonicalWorkflowFailure || tailoringRecovery || tailoringQuestionRecovery || tailoringQuestionWaiting || completionWaiting);
      const text = blocked ? grounding.recoveryText : candidate;
      if (!tailoringQuestionWaiting) next = replaceRuntimeShellMessage(next, assistantMessageId, text, event, false, terminalFailed);
      if ((terminalFailed || terminalWaiting || tailoringRecovery) && !domainFailureWaiting && !tailoringQuestionWaiting) next = withRetryCurrentStepOption(next, assistantMessageId);
      if (next.taskState) next = attachTaskStateOptions(next, next.taskState);
      next = {
        ...next,
        runtimeId: "hermes",
        activeTurn: next.activeTurn
          ? {
              ...next.activeTurn,
              runtimeId: "hermes",
               status: terminalFailed
                 ? "failed"
                 : terminalWaiting && !completionWaitingForConfirmation && !next.pendingConfirmation
                   ? "waiting_for_user"
                   : terminalWaiting || next.pendingConfirmation ? "waiting_for_confirmation" : "completed",
                completedAt: terminalFailed || terminalWaiting || !next.pendingConfirmation ? new Date().toISOString() : undefined
            }
          : undefined,
        // Hermes owns the conversational turn, not the durable career workflow
        // state. Keep the existing workflow status here unless the runtime has
        // raised an approval boundary; native workflow execution remains the
        // only path that can mark a workflow completed or failed.
        ...(next.pendingConfirmation && next.workflowState
          ? { workflowState: { ...next.workflowState, status: "waiting_for_confirmation" as const } }
          : {})
      };
      const isolatedConversationalTurn = isIsolatedRuntimeTurn(next, event.turnId);
      next = markTurnTerminalState(
        next,
        event.turnId,
         terminalFailed
           ? "failed"
           : terminalWaiting && !completionWaitingForConfirmation && !next.pendingConfirmation
             ? "waiting_for_user"
          : terminalWaiting || next.pendingConfirmation
            ? "waiting_for_confirmation"
            : "completed",
        isolatedConversationalTurn
      );
      this.clearStreamingCheckpoint();
      const saved = await this.dependencies.persistence.save(next);
      this.patchSession(saved, {
         turnStatus: terminalFailed
           ? "failed"
           : terminalWaiting && !completionWaitingForConfirmation && !saved.pendingConfirmation
             ? "waiting_for_user"
             : terminalWaiting || saved.pendingConfirmation ? "waiting_for_confirmation" : "completed",
        activeTurnId: event.turnId,
        currentObservation: event.error ?? { runtimeId: "hermes", message: event.message, grounded: !blocked },
         uiAction: event.type === "turn_completed" && !blocked && !terminalWaiting && !terminalFailed ? resumePreviewUiAction(saved) : undefined
      });
      return saved;
    }
    if (
      getActiveTailoringQuestionProjection(next)
      && ["tool_call_completed", "tool_call_failed"].includes(event.type)
    ) {
      const saved = await this.dependencies.persistence.save(next);
      this.patchSession(saved, {
        turnStatus: "waiting_for_user",
        activeTurnId: event.turnId,
        currentObservation: { type: "tailoring_question_waiting", message: "等待你的补充说明。" }
      });
      return saved;
    }
    this.patchSession(next, {
      currentObservation: event.data ?? event.message,
      ...(lateTailoringRecovery ? { turnStatus: "waiting_for_user" as const, activeTurnId: event.turnId } : {})
    });
    return next;
  }

  interrupt(sessionId = this.snapshot.activeSessionId, reason?: RunStopReason) {
    if (!sessionId) return;
    const activeSession = this.snapshot.activeSession;
    const activeTurn = activeSession?.id === sessionId ? activeSession.activeTurn : undefined;
    const abortTrace: AbortTrace = {
      abortSource: abortSourceForReason(reason ?? { abortSource: "user_interrupt" }),
      ...(reason?.reasonCode ? { abortReason: reason.reasonCode } : { abortReason: "user_interrupt" }),
      sessionId,
      turnId: activeTurn?.id,
      runId: activeSession?.hermesRun?.runId,
      abortedAt: new Date().toISOString(),
      incidentTraceId: activeTurn?.incidentTraceId
    };
    this.executionCoordinator.interrupt(sessionId, abortTrace);
    const pauseLike = !reason || reason.reasonCode === "workflow_paused" || reason.reasonCode === "user_interrupt";
    this.patch({
      controllerState: "interrupting",
      ...(pauseLike
        ? { turnStatus: "paused" as const }
        : {})
    });
    if (activeSession && activeTurn) {
      const next = {
        ...activeSession,
        activeTurn: {
          ...activeTurn,
          ...(reason ? { cancellation: reason } : {}),
          abortTraces: [...(activeTurn.abortTraces ?? []), abortTrace].slice(-32)
        }
      };
      void this.dependencies.persistence.save(next).then((saved) => {
        const current = this.snapshot.activeSession;
        if (current?.id === saved.id && current.activeTurn?.id === activeTurn.id) this.patchSession(saved);
      });
    }
  }

  continueWaiting() {
    if (this.snapshot.activeSessionId) this.markProgress(this.snapshot.activeSessionId);
  }

  async dispatch(
    input: AgentHostInput,
    context: { session?: AgentSession; pageContext: AgentPageContext }
  ): Promise<AgentSession | undefined> {
    const requestedSession = context.session ?? this.snapshot.activeSession;
    const session = requestedSession && this.snapshot.activeSession?.id === requestedSession.id
      ? this.snapshot.activeSession
      : requestedSession;
    if (!session) throw new Error("agent_session_required");
    if (input.type === "confirmation") {
      return this.resolveConfirmation(input.confirmed, context.pageContext, session);
    }
    if (input.type === "artifact_action") {
      const active = this.snapshot.activeSession?.id === session.id
        ? this.snapshot.activeSession
        : session;
      return this.resolveArtifactAction(active, input.action, context.pageContext);
    }
    if (input.type === "edit_message") {
      const assistantMessageId = findBranchAssistantMessageId(session, input.messageId);
      const correctionBase = session.pendingConfirmation && session.pendingToolCall
        ? invalidatePendingConfirmationForCorrection(session)
        : session;
      const edited = branchSessionFromEditedUserMessage(correctionBase, input.messageId, input.text);
      if (!edited) return session;
      const {
        userMessageId: editedUserMessageId,
        assistantMessageId: editedAssistantMessageId,
        appendUserMessage,
        updateExistingUserMessage,
        ...editedSession
      } = edited;
      let replaySession: AgentSession = editedSession as AgentSession;
      if (session.taskState?.workflowId === "guided_profile_intake") {
        await this.supersedeProfileIntakeTurnsAfterEdit(session, input.messageId);
        replaySession = await this.restoreProfileIntakeDraftForBranch(session, replaySession, input.messageId);
      }
      const resolvedAssistantMessageId = appendUserMessage
        ? editedAssistantMessageId
        : editedAssistantMessageId ?? assistantMessageId;
      return this.startTurn({
        session: replaySession,
        userMessage: input.text.trim(),
        userMessageId: editedUserMessageId ?? input.messageId,
        assistantMessageId: resolvedAssistantMessageId,
        appendUserMessage,
        updateExistingUserMessage,
        pageContext: context.pageContext,
        supersede: true
      });
    }
    if (input.type === "regenerate_message") {
      const regenerationBase = session.pendingConfirmation && session.pendingToolCall
        ? invalidatePendingConfirmationForCorrection(session)
        : session;
      const prepared = prepareSessionForAssistantRegeneration(regenerationBase, input.messageId);
      if (!prepared) return session;
      if (prepared.blocked) {
        const saved = await this.dependencies.persistence.save(prepared.session);
        this.patchSession(saved);
        return saved;
      }
      return this.startTurn({
        session: prepared.session,
        userMessage: prepared.userMessage,
        userMessageId: prepared.userMessageId,
        assistantMessageId: prepared.assistantMessageId,
        appendUserMessage: false,
        updateExistingUserMessage: prepared.updateExistingUserMessage,
        regenerateNarrationOnly: prepared.regenerateNarrationOnly,
        sourceTurnId: prepared.sourceTurnId,
        regeneratedFromMessageId: prepared.regeneratedFromMessageId,
        regenerationTarget: prepared.regenerationTarget,
        retryWorkflowStep: prepared.retryWorkflowStep,
        operationId: `regenerate:${session.id}:${input.messageId}:${session.taskState?.updatedAt ?? session.updatedAt}`,
        operationKind: "regenerate",
        pageContext: context.pageContext,
        supersede: true
      });
    }
    if (input.type === "external_event") {
      if (input.toolName === "confirm_resume_import" && session.taskState?.workflowId === "resume_import") {
        return this.resolveExternalResumeImportConfirmation(session, input.observation);
      }
      const turnId = session.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
      return this.resume(session, {
        reason: "external_event",
        toolName: input.toolName,
        observation: input.observation
      }, context.pageContext, turnId);
    }
    if (input.type === "composer_submit") {
      const files = input.files.filter((file) => Boolean(file && typeof file.arrayBuffer === "function"));
      if (!files.length && !input.text?.trim()) return session;
      const registered: AgentAttachmentRef[] = [];
      try {
        for (const file of files) registered.push(await agentAttachmentStore.register(file));
      } catch (error) {
        for (const attachment of registered) agentAttachmentStore.release(attachment.id);
        throw error;
      }
      if (!registered.length) {
        return this.startTurn({ session, userMessage: input.text?.trim() ?? "", pageContext: context.pageContext });
      }
      const primary = registered[0];
      const { readResumeImportSemanticPreference } = await import("@/services/preferences/resumeImportAi");
      const needsConsent = readResumeImportSemanticPreference() === "unset"
        && !(await this.isCanonicalCareerAdaptJsonAttachment(primary));
      return this.resolveDirectImportAttachment(session, primary, context.pageContext, {
        userMessage: input.text?.trim() ?? "",
        attachmentRefs: registered,
        requestConsent: needsConsent
      });
    }
    if (input.type === "resume_import_consent") {
      const { ref } = agentAttachmentStore.resolve(input.attachmentId);
      const consentAttachmentIds = Array.isArray(session.taskState?.knownSlots.resumeImportAttachmentIds)
        ? session.taskState.knownSlots.resumeImportAttachmentIds.filter((id): id is string => typeof id === "string")
        : [input.attachmentId];
      const consentAttachmentRefs = consentAttachmentIds.flatMap((id) => {
        try { return [agentAttachmentStore.resolve(id).ref]; } catch { return []; }
      });
      if (input.mode === "ai" || input.mode === "local") {
        const currentUserMessage = [...session.messages].reverse().find((message) => message.role === "user");
        return this.resolveDirectImportAttachment(session, ref, context.pageContext, {
          userMessage: currentUserMessage?.content ?? "",
          appendUserMessage: false,
          attachmentRefs: consentAttachmentRefs.length ? consentAttachmentRefs : [ref],
          requestConsent: false
        });
      }
      return session;
    }
    if (input.type === "option") {
      if (input.action.type === "quick_action_decision") {
        return this.resolveQuickActionDecision(session, input.action, context.pageContext);
      }
      if (input.action.type === "quick_action_shortcut") {
        const intent = createQuickActionIntent(input.action.actionId, "quick_tasks");
        return this.dispatch({ type: "quick_action", actionId: intent.actionId, text: intent.intent, task: intent.task }, context);
      }
      if (input.action.type === "task_decision") {
        return this.resolveTaskDecision(session, input.action, context.pageContext);
      }
      if (input.action.type === "answer") {
        if (input.action.field === "profile-intake-section") return session;
        if (input.action.field.startsWith("tailoring-question:")) {
          const prepared = await this.prepareRuntimeUserEvent({
            session,
            event: { type: "option_selected", action: input.action },
            pageContext: context.pageContext
          });
          return prepared.session;
        }
        const answerValue = input.action.value;
        return this.startTurn({
          session,
          userMessage: String(answerValue ?? ""),
          pageContext: context.pageContext
        });
      }
      if (input.action.type === "profile_intake_section_select") {
        return this.resolveProfileIntakeSectionSelection(session, input.action);
      }
      if (input.action.type === "select_entity") {
        return this.resolveTypedEntitySelection(session, input.action, context.pageContext);
      }
      if (input.action.type === "retry_current_step") {
        return this.retryCurrentWorkflowStep(
          session,
          context.pageContext,
          `retry:${session.id}:${session.activeTurn?.id ?? session.taskState?.stage ?? "workflow"}:${session.taskState?.updatedAt ?? session.updatedAt}`
        );
      }
      if (input.action.type === "new_tailoring_task") {
        return this.startTurn({
          session,
          userMessage: "新建岗位定制任务",
          pageContext: context.pageContext,
          typedTask: { rootGoal: "create_tailored_resume", workflowId: "tailor_existing_resume", stage: "select_resume" },
          supersede: true
        });
      }
      return this.dispatch({ type: "ui_control", action: input.action }, context);
    }
    if (input.type === "ui_control") {
      if (input.action.type === "select_tailoring_question" && session.taskState) {
        const selectedQuestionId = input.action.questionId;
        const plan = objectValue(objectValue(session.taskState.knownSlots.tailoringSession).plan);
        const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions.map(objectValue) : [];
        if (questions.some((question) => question.id === selectedQuestionId)) {
          const updated = projectTaskStateIntoSession(session, {
            ...session.taskState,
            knownSlots: { ...session.taskState.knownSlots, selectedQuestionId },
            updatedAt: new Date().toISOString()
          });
          const saved = await this.dependencies.persistence.save(updated);
          this.patchSession(saved);
          return saved;
        }
      }
      if (isUiAction(input.action)) {
        this.patch({ uiAction: input.action });
        return session;
      }
      return this.applyWorkflowControl(session, input.action);
    }
    if (input.type === "quick_action") {
      // The typed task boundary is durable before context reads, prerequisite
      // checks, or any model/runtime work. A reload cannot fall back to
      // agent_quick_action/collecting_intent after the card was clicked.
      const initialized = await this.initializeQuickActionTask(session, input);
      const quickContext = await this.readQuickActionContext(initialized);
      const preparedSession = await this.prepareQuickActionSession(initialized, input.actionId, quickContext);
      if (input.actionId === "build_profile_from_scratch") {
        return this.resolveProfileIntakeQuickAction(preparedSession, input, quickContext);
      }
      if (input.actionId === "import_existing_resume") {
        return this.resolveResumeImportQuickAction(preparedSession, input, quickContext);
      }
      const localPrerequisites = await this.resolveQuickActionPrerequisites(input);
      if (localPrerequisites) {
        return this.resolveQuickActionLocally(preparedSession, input, localPrerequisites, quickContext);
      }
      return this.startTurn({
        session: preparedSession,
        userMessage: input.text,
        pageContext: context.pageContext,
        typedTask: input.task,
        supersede: true
      });
    }
    if (session.pendingConfirmation && /^(?:确认|确定|同意|继续|确认并继续)[。！!]?$/u.test(input.text.trim())) {
      return this.resolveConfirmation(true, context.pageContext, session);
    }
    if (session.pendingConfirmation && /^(?:取消|不同意|拒绝|不确认)[。！!]?$/u.test(input.text.trim())) {
      return this.resolveConfirmation(false, context.pageContext, session);
    }
    const routed = routeAgentIntent(input.text, {
      activeWorkflowId: session.taskState?.workflowId ?? session.workflowState?.workflowId
    });
    if (routed.kind === "ui_action") {
      this.patch({ uiAction: routed.action });
      return session;
    }
    if (routed.kind === "workflow_control") {
      return this.applyWorkflowControl(session, routed.action);
    }
    return this.startTurn({
      session,
      userMessage: input.text,
      pageContext: context.pageContext,
      references: input.references
    });
  }

  private async initializeQuickActionTask(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>
  ) {
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(reducer.create(session, undefined, {
      workflowId: input.task.workflowId,
      step: input.task.stage
    }), {
      type: "new_root_task",
      goal: input.task.rootGoal,
      workflowId: input.task.workflowId,
      stage: input.task.stage
    });
    const initialized = projectTaskStateIntoSession(session, taskState);
    const saved = await this.dependencies.persistence.save(initialized);
    // Publish the durable boundary immediately. The remaining quick-action
    // preflight may still read local context, but a reply typed during that
    // window must bind to this canonical task rather than the old shell.
    this.patchSession(saved, {
      turnStatus: sessionTurnStatus(saved),
      activeTask: saved.taskState,
      activeTurnId: saved.activeTurn?.id,
      pendingConfirmation: saved.pendingConfirmation,
      artifacts: saved.artifactRefs
    });
    return saved;
  }

  private async resolveExternalResumeImportConfirmation(session: AgentSession, rawObservation: unknown) {
    const observation = objectValue(rawObservation);
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(session.taskState!, {
      type: "tool_observation",
      toolName: "commit_resume_import",
      observation
    });
    const now = new Date().toISOString();
    let current = projectTaskStateIntoSession(
      appendAgentMessage(session, "assistant", "已确认导入，并将资料与通用简历保存到本地工作区。", {
        id: `agent-import-confirmed-${String(observation.importId ?? session.id)}`,
        kind: "text",
        type: "text",
        status: "complete",
        metadata: { externalEvent: "confirm_resume_import", importId: observation.importId }
      }),
      taskState
    );
    const branchId = stringValue(observation.branchId ?? observation.resumeId);
    if (branchId) {
      const artifactId = `agent-artifact-import-complete-${branchId}`;
      current = {
        ...current,
        artifactRefs: [
          ...current.artifactRefs.filter((artifact) => artifact.kind !== "quality_result"),
          {
            id: artifactId,
            kind: "quality_result",
            title: "导入完成",
            entityType: "resume_branch",
            entityId: branchId,
            route: `/resume?branchId=${encodeURIComponent(branchId)}`,
            status: "active",
            summary: "已确认导入并创建通用简历。",
            createdAt: now,
            updatedAt: now
          }
        ]
      };
    }
    current = {
      ...current,
      activeTurn: current.activeTurn
        ? { ...current.activeTurn, status: "completed", completedAt: now }
        : current.activeTurn,
      updatedAt: now
    };
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, { turnStatus: "completed", currentObservation: observation });
    return saved;
  }

  private async resolveQuickActionLocally(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>,
    resolution: (QuickActionWorkflowResolution | QuickActionPrerequisiteResolution) & object,
    contextSnapshot?: QuickActionContextSnapshot
  ) {
    const now = new Date().toISOString();
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.create(session, undefined, {
      workflowId: input.task.workflowId,
      step: input.task.stage
    });
    taskState = reducer.reduce(taskState, {
      type: "new_root_task",
      goal: input.task.rootGoal,
      workflowId: input.task.workflowId,
      stage: input.task.stage
    });
    taskState = {
      ...taskState,
      completionStatus: "waiting_for_user",
      updatedAt: now
    };
    let current = projectTaskStateIntoSession(session, taskState);
    if (contextSnapshot && current.titleOrigin !== "user") {
      current = {
        ...current,
        title: refineAgentTaskTitle(input.actionId, contextSnapshot),
        titleOrigin: "deterministic",
        updatedAt: now
      };
    }
    current = ensureConversationBranches(current);
    const userMessage = appendAgentMessage(current, "user", input.text.trim(), {
      id: `agent-user-${crypto.randomUUID()}`,
      status: "complete",
      metadata: { executionState: "complete", quickActionSupervisor: true }
    });
    current = appendAgentMessage(userMessage, "assistant", resolution.assistantText, {
      kind: "text",
      type: "text",
      status: "complete",
      options: resolution.options ?? (resolution.uiAction ? [{
        id: "resume-import-upload",
        label: "上传简历文件",
        action: resolution.uiAction
      }] : undefined),
      metadata: {
        quickActionSupervisor: true,
        modelCalls: resolution.modelCalls,
        profileReads: resolution.profileReads,
        resumeReads: resolution.resumeReads ?? 0,
        jobReads: resolution.jobReads,
        quickActionContext: contextSnapshot
      }
    });
    this.patchSession(current, {
      turnStatus: "idle",
      uiAction: resolution.uiAction,
      currentObservation: {
        type: "quick_action_fast_path",
        actionId: input.actionId,
        modelCalls: resolution.modelCalls,
        profileReads: resolution.profileReads,
        resumeReads: resolution.resumeReads ?? 0,
        jobReads: resolution.jobReads
      }
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "idle",
      uiAction: resolution.uiAction,
      currentObservation: {
        type: "quick_action_fast_path",
        actionId: input.actionId,
        modelCalls: resolution.modelCalls,
        profileReads: resolution.profileReads,
        resumeReads: resolution.resumeReads ?? 0,
        jobReads: resolution.jobReads
      }
    });
    return saved;
  }

  private async prepareQuickActionSession(
    session: AgentSession,
    actionId: AgentQuickActionId,
    snapshot: QuickActionContextSnapshot
  ) {
    const patch: Partial<AgentSession> = {};
    if (session.titleOrigin !== "user") {
      patch.title = snapshot.activeProfile ? refineAgentTaskTitle(actionId, snapshot) : defaultAgentTaskTitle(actionId);
      patch.titleOrigin = "deterministic";
    }
    if (!session.activeProfileId && snapshot.activePerson && snapshot.activeProfile) {
      if (!session.personId) patch.personId = snapshot.activePerson.id;
      patch.activeProfileId = snapshot.activeProfile.id;
      patch.profileVersionNumber = snapshot.activeProfile.profileVersionNumber;
      patch.profileRevision = snapshot.activeProfile.profileRevision;
    }
    let prepared = Object.keys(patch).length
      ? { ...session, ...patch, updatedAt: new Date().toISOString() }
      : session;
    // The canonical TaskState was persisted before this context read. Bind the
    // resolved Profile into that same state before any model/runtime call so a
    // composition turn cannot carry a session-level Profile with an unbound
    // task-level Profile.
    if (prepared.taskState && snapshot.activeProfile) {
      const profile = snapshot.activeProfile;
      const nextTaskState: AgentTaskState = {
        ...prepared.taskState,
        selectedEntities: {
          ...prepared.taskState.selectedEntities,
          profileId: profile.id,
          profileVersion: profile.profileRevision
        },
        knownSlots: {
          ...prepared.taskState.knownSlots,
          ...(prepared.taskState.workflowId === "compose_resume" ? {
            targetProfileId: profile.id,
            expectedProfileVersion: profile.profileRevision,
            acknowledgedActiveProfileId: profile.id
          } : {})
        },
        updatedAt: new Date().toISOString()
      };
      prepared = projectTaskStateIntoSession(prepared, nextTaskState);
    }
    return prepared;
  }

  /**
   * Profile Intake starts from a local, typed target binding. The model is not
   * involved in choosing a Profile and therefore cannot move this action into
   * a shadow interview branch.
   */
  private async resolveProfileIntakeQuickAction(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>,
    snapshot: QuickActionContextSnapshot
  ) {
    // P4.3h test/migration callers may provide only the legacy deterministic
    // get_active_profile tool. Production supplies WorkspaceRepository above;
    // this adapter preserves those callers without reintroducing a planner or
    // an implicit first-profile choice.
    if (!snapshot.activeProfile && !this.hasExplicitCareerRepository()) {
      try {
        const result = await this.dependencies.executor.execute({
          toolName: "get_active_profile",
          toolInput: {},
          operationId: `quick-profile-context-${crypto.randomUUID()}`
        });
        if (result.ok && result.data && typeof result.data === "object") {
          const value = result.data as Record<string, unknown>;
          const profileId = typeof value.profileId === "string" ? value.profileId : undefined;
          if (value.selected === true && profileId) {
            const displayName = typeof value.name === "string" && value.name.trim() ? value.name : "当前人物";
            const profileRevision = typeof value.version === "number" ? value.version : 0;
            const personId = typeof value.personId === "string" ? value.personId : `legacy-person-${profileId}`;
            snapshot = QuickActionContextSnapshotSchema.parse({
              activePerson: { id: personId, displayName, currentProfileId: profileId },
              activeProfile: {
                id: profileId,
                personId,
                displayName,
                profileVersionNumber: typeof value.profileVersionNumber === "number" ? Math.max(1, value.profileVersionNumber) : 1,
                profileVersionLabel: typeof value.profileVersionLabel === "string" ? value.profileVersionLabel : undefined,
                profileRevision,
                createdAt: new Date().toISOString(),
                itemCount: 0,
                profileCountsBySection: emptyQuickActionCounts()
              },
              profileVersionNumber: typeof value.profileVersionNumber === "number" ? Math.max(1, value.profileVersionNumber) : 1,
              profileRevision,
              profileCountsBySection: emptyQuickActionCounts(),
              profileItemCount: 0,
              resumeSummaries: [],
              jobSummaries: []
            });
          }
        }
      } catch {
        // The repository-backed snapshot remains the authoritative fallback.
      }
    }
    const now = new Date().toISOString();
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.create(session, undefined, {
      workflowId: "guided_profile_intake",
      step: "resolve_profile_target"
    });
    taskState = reducer.reduce(taskState, {
      type: "new_root_task",
      goal: input.task.rootGoal,
      workflowId: "guided_profile_intake",
      stage: "resolve_profile_target"
    });
    const activeProfile = snapshot.activeProfile;
    const activePerson = snapshot.activePerson;
    const selected = Boolean(activeProfile && activePerson);
    if (selected) {
      taskState = {
        ...taskState,
        workflowId: "guided_profile_intake",
        stage: "collect_experience",
        completionStatus: "waiting_for_user",
        knownSlots: {
          ...taskState.knownSlots,
          targetProfileId: activeProfile!.id,
          targetProfileName: activePerson!.displayName,
          expectedProfileVersion: activeProfile!.profileRevision,
          acknowledgedActiveProfileId: activeProfile!.id,
          profileIntakeQuickActionResolved: true,
          intakeFirstQuestionId: "education-background"
        },
        selectedEntities: {
          ...taskState.selectedEntities,
          profileId: activeProfile!.id,
          profileVersion: activeProfile!.profileRevision
        },
        updatedAt: now
      };
    }
    if (!selected) taskState = { ...taskState, completionStatus: "waiting_for_user", updatedAt: now };
    let current = projectTaskStateIntoSession(session, taskState);
    if (selected) {
      current = {
        ...current,
        personId: activePerson!.id,
        activeProfileId: activeProfile!.id,
        profileVersionNumber: activeProfile!.profileVersionNumber,
        profileRevision: activeProfile!.profileRevision
      };
    }
    current = appendAgentMessage(current, "user", input.text.trim(), {
      id: `agent-user-${crypto.randomUUID()}`,
      status: "complete",
      metadata: { executionState: "complete", quickActionSupervisor: true, modelCalls: 0 }
    });
    const profileLabel = quickActionProfileLabel(snapshot);
    const assistantText = selected
      ? snapshot.profileItemCount > 0
        ? `当前使用“${profileLabel}”，已有教育 ${quickActionSectionCount(snapshot, "education")} 项、项目 ${quickActionSectionCount(snapshot, "project")} 项、技能 ${quickActionSectionCount(snapshot, "skills")} 项。\n你准备继续补充、查看、修改，还是归档已有内容？`
        : `当前“${profileLabel}”还没有经历资料，我们先从你的身份或教育背景开始。若先从教育背景开始，请告诉我你的姓名、学校、专业和学历；只写你确认过的内容即可。`
      : "开始整理经历前，需要先选择或创建一个个人资料库。请选择资料库后，我会立即进入第一步访谈。";
    current = appendAgentMessage(current, "assistant", assistantText, {
      kind: "text",
      type: "text",
      status: "complete",
      options: selected && snapshot.profileItemCount > 0
        ? [
            { id: "profile-intake-continue", label: "继续补充", action: { type: "quick_action_decision", decision: "continue_profile_intake" } },
            { id: "profile-intake-view", label: "查看资料", action: { type: "quick_action_decision", decision: "view_profile" } },
            { id: "profile-intake-edit", label: "修改已有", action: { type: "quick_action_decision", decision: "edit_profile" } },
            { id: "profile-intake-archive", label: "归档资料", action: { type: "quick_action_decision", decision: "archive_profile" } }
          ]
        : selected ? undefined : [{
            id: "profile-intake-select-or-create-profile",
            label: "选择或创建个人资料库",
            action: { type: "open_profile_browser" }
          }],
      metadata: {
        quickActionSupervisor: true,
        deterministicBoundary: "profile_intake_target",
        modelCalls: 0,
        profileReads: 1,
        authoritativeStage: taskState.stage,
        quickActionContext: snapshot
      }
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "idle",
      uiAction: selected ? undefined : { type: "open_profile_browser" },
      currentObservation: {
        type: "quick_action_fast_path",
        actionId: input.actionId,
        modelCalls: 0,
        profileReads: 1,
        authoritativeStage: taskState.stage,
        targetProfileId: selected ? activeProfile!.id : undefined,
        quickActionContext: snapshot
      }
    });
    return saved;
  }

  private async resolveResumeImportQuickAction(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>,
    snapshot: QuickActionContextSnapshot
  ) {
    const now = new Date().toISOString();
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.reduce(reducer.create(session, undefined, {
      workflowId: "resume_import",
      step: "resolve_target"
    }), {
      type: "new_root_task",
      goal: input.task.rootGoal,
      workflowId: "resume_import",
      stage: "resolve_target"
    });
    taskState = { ...taskState, completionStatus: "waiting_for_user", updatedAt: now };
    let current = projectTaskStateIntoSession(session, taskState);
    if (snapshot.activePerson && snapshot.activeProfile) {
      current = {
        ...current,
        personId: snapshot.activePerson.id,
        activeProfileId: snapshot.activeProfile.id,
        profileVersionNumber: snapshot.activeProfile.profileVersionNumber,
        profileRevision: snapshot.activeProfile.profileRevision
      };
    }
    current = appendAgentMessage(current, "user", input.text.trim(), {
      id: `agent-user-${crypto.randomUUID()}`,
      status: "complete",
      metadata: { executionState: "complete", quickActionSupervisor: true }
    });
    current = appendAgentMessage(current, "assistant", importTargetPrompt(snapshot), {
      kind: "text",
      type: "text",
      status: "complete",
      options: importTargetOptions(snapshot),
      metadata: {
        quickActionSupervisor: true,
        quickActionKind: "resume_import_target",
        modelCalls: 0,
        profileReads: 1,
        resumeReads: 0,
        jobReads: 0,
        quickActionContext: snapshot
      }
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "idle",
      currentObservation: {
        type: "quick_action_fast_path",
        actionId: input.actionId,
        modelCalls: 0,
        profileReads: 1,
        resumeReads: 0,
        jobReads: 0,
        quickActionContext: snapshot
      }
    });
    return saved;
  }

  private async resolveDirectImportAttachment(
    session: AgentSession,
    attachment: AgentAttachmentRef,
    pageContext: AgentPageContext,
    options: {
      userMessage?: string;
      attachmentRefs?: AgentAttachmentRef[];
      appendUserMessage?: boolean;
      requestConsent?: boolean;
    } = {}
  ) {
    const snapshot = await this.readQuickActionContext(session);
    const reducer = new AgentTaskStateReducer();
    let taskState = session.taskState ?? reducer.create(session, undefined, {
      workflowId: "resume_import",
      step: "resolve_target"
    });
    if (taskState.workflowId !== "resume_import") {
      taskState = reducer.reduce(taskState, {
        type: "new_root_task",
        goal: "import_resume",
        workflowId: "resume_import",
        stage: "resolve_target"
      });
    }
    const targetProfileId = typeof taskState.knownSlots.targetProfileId === "string"
      ? taskState.knownSlots.targetProfileId
      : undefined;
    const targetAlreadyResolved = taskState.knownSlots.quickActionImportTargetRequired === false && Boolean(targetProfileId);
    const visibleAttachmentRefs = options.attachmentRefs ?? [attachment];
    taskState = reducer.reduce(taskState, { type: "attachment_selected", attachment });
    taskState = {
      ...taskState,
      stage: targetAlreadyResolved ? "prepare_import" : "resolve_target",
      completionStatus: options.requestConsent ? "waiting_for_user" : targetAlreadyResolved ? "active" : "waiting_for_user",
        knownSlots: {
          ...taskState.knownSlots,
          quickActionImportTargetRequired: !targetAlreadyResolved,
          resumeImportConsentAttachmentId: options.requestConsent ? attachment.id : undefined,
          resumeImportAttachmentIds: visibleAttachmentRefs.map((ref) => ref.id)
        },
      updatedAt: new Date().toISOString()
    };
    let current = projectTaskStateIntoSession(session, taskState);
    const visibleMessage = options.userMessage ?? "";
    if (options.appendUserMessage !== false) {
      current = appendAgentMessage(current, "user", visibleMessage, {
        id: `agent-user-${crypto.randomUUID()}`,
        status: "complete",
        metadata: {
          executionState: options.requestConsent ? "complete" : "running",
          attachments: visibleAttachmentRefs.map((ref) => ({ fileName: ref.fileName, mimeType: ref.mimeType, size: ref.size })),
          attachmentId: attachment.id
        }
      });
    }
    if (options.requestConsent) {
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, {
        turnStatus: "waiting_for_user",
        uiAction: { type: "request_resume_import_consent", attachmentId: attachment.id },
        currentObservation: { type: "resume_import_consent_required", attachmentId: attachment.id }
      });
      void pageContext;
      return saved;
    }
    if (targetAlreadyResolved && targetProfileId) {
      const targetProfile = await this.getCareerRepository().getProfile(targetProfileId);
      if (!targetProfile) {
        agentAttachmentStore.releaseMany(visibleAttachmentRefs.map((ref) => ref.id));
        return current;
      }
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, {
        turnStatus: "idle",
        currentObservation: { type: "import_target_resolved", targetProfileId, quickActionContext: snapshot }
      });
      const userMessage = [...saved.messages].reverse().find((message) => message.role === "user");
      const started = this.startTurn({
        session: saved,
        userMessage: visibleMessage || userMessage?.content || "",
        userMessageId: userMessage?.id,
        appendUserMessage: false,
        pageContext,
        supersede: true
      });
      agentAttachmentStore.releaseMany(visibleAttachmentRefs.filter((ref) => ref.id !== attachment.id).map((ref) => ref.id));
      return started;
    }
    current = appendAgentMessage(current, "assistant", importTargetPrompt(snapshot), {
      kind: "text",
      type: "text",
      status: "complete",
      options: importTargetOptions(snapshot),
      metadata: {
        quickActionSupervisor: true,
        quickActionKind: "resume_import_target",
        attachmentId: attachment.id,
        quickActionContext: snapshot
      }
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: "idle",
      currentObservation: { type: "import_target_required", attachmentId: attachment.id, quickActionContext: snapshot }
    });
    void pageContext;
    return saved;
  }

  private async resolveQuickActionDecision(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "quick_action_decision" }>,
    pageContext: AgentPageContext
  ) {
    if (["continue_profile_intake", "view_profile", "edit_profile", "archive_profile"].includes(action.decision)) {
      if (action.decision === "view_profile" || action.decision === "edit_profile") {
        this.patch({ uiAction: { type: "open_profile_browser" } });
        return session;
      }
      const profileId = session.activeProfileId ?? session.taskState?.selectedEntities.profileId;
      if (!profileId) return session;
      if (action.decision === "archive_profile") {
        await this.getCareerRepository().archiveProfileVersion(profileId);
        const updated = replaceLatestQuickActionAssistant(session, "当前版本已归档。你可以在人物与版本选择器中切换到其他版本。", undefined);
        const saved = await this.dependencies.persistence.save(updated);
        this.patchSession(saved, { turnStatus: "idle", uiAction: undefined });
        return saved;
      }
      const next = replaceLatestQuickActionAssistant(session, "好的，我们继续补充已确认的经历。请告诉我下一段教育、工作、项目或技能信息。", undefined);
      return this.startTurn({
        session: next,
        userMessage: "继续补充经历",
        pageContext,
        supersede: true
      });
    }

    if (action.decision === "cancel_import") {
      const attachmentIds = Array.isArray(session.taskState?.knownSlots.resumeImportAttachmentIds)
        ? session.taskState.knownSlots.resumeImportAttachmentIds.filter((id): id is string => typeof id === "string")
        : typeof session.taskState?.knownSlots.resumeImportConsentAttachmentId === "string"
          ? [session.taskState.knownSlots.resumeImportConsentAttachmentId]
          : [];
      agentAttachmentStore.releaseMany(attachmentIds);
      const cancelled = replaceLatestQuickActionAssistant(session, "已取消本次导入，未开始提取；如果继续导入，请重新选择文件。", undefined);
      const saved = await this.dependencies.persistence.save(cancelled);
      this.patchSession(saved, { turnStatus: "idle", uiAction: undefined });
      return saved;
    }

    const snapshot = await this.readQuickActionContext(session);
    if (!snapshot.activeProfile || !snapshot.activePerson) {
      agentAttachmentStore.releaseMany(
        Array.isArray(session.taskState?.knownSlots.resumeImportAttachmentIds)
          ? session.taskState.knownSlots.resumeImportAttachmentIds.filter((id): id is string => typeof id === "string")
          : []
      );
      return session;
    }
    let targetProfile = await this.getCareerRepository().getProfile(snapshot.activeProfile.id);
    if (!targetProfile) {
      agentAttachmentStore.releaseMany(
        Array.isArray(session.taskState?.knownSlots.resumeImportAttachmentIds)
          ? session.taskState.knownSlots.resumeImportAttachmentIds.filter((id): id is string => typeof id === "string")
          : []
      );
      return session;
    }
    if (action.decision === "import_new_version") {
      targetProfile = await this.getCareerRepository().createProfileVersion({ profileId: targetProfile.id, reason: "resume_import" });
    } else if (action.decision === "import_new_person") {
      const created = await this.getCareerRepository().createPerson("新人物", "resume_import");
      targetProfile = created.profile;
    }
    const targetLabel = `${targetProfile.name} · V${targetProfile.profileVersionNumber ?? 1}`;
    const reducer = new AgentTaskStateReducer();
    const base = session.taskState ?? reducer.create(session, undefined, {
      workflowId: "resume_import",
      step: "prepare_import"
    });
    const nextTaskState = {
      ...base,
      workflowId: "resume_import",
      stage: "prepare_import",
      knownSlots: {
        ...base.knownSlots,
        importTargetIntent: "existing",
        importTarget: { mode: "existing", profileId: targetProfile.id },
        targetProfileId: targetProfile.id,
        targetProfileName: targetProfile.name,
        expectedProfileVersion: targetProfile.version,
        quickActionImportTargetRequired: false
      },
      selectedEntities: {
        ...base.selectedEntities,
        profileId: targetProfile.id,
        profileVersion: targetProfile.version
      },
      completionStatus: base.attachment ? "active" as const : "waiting_for_user" as const,
      updatedAt: new Date().toISOString()
    };
    let current = projectTaskStateIntoSession(session, nextTaskState);
    current = {
      ...current,
      personId: targetProfile.personId,
      activeProfileId: targetProfile.id,
      profileVersionNumber: targetProfile.profileVersionNumber,
      profileRevision: targetProfile.version
    };
    const attachmentReady = Boolean(current.taskState?.attachment);
    current = replaceLatestQuickActionAssistant(
      current,
      attachmentReady
        ? `已更新导入目标为“${targetLabel}”，将先比对已有事实；完全重复项不会重复新增，近似重复和字段冲突会在核对页让你选择，不会静默覆盖。`
        : `已更新导入目标为“${targetLabel}”。请上传简历文件；导入后会先比对已有事实，不会静默覆盖。`,
      attachmentReady ? undefined : [{ id: "resume-import-upload", label: "上传简历文件", action: { type: "open_resume_upload" } }]
    );
    const saved = await this.dependencies.persistence.save(current);
    if (!attachmentReady) {
      this.patchSession(saved, { turnStatus: "idle", uiAction: { type: "open_resume_upload" } });
      return saved;
    }
    const retainedAttachmentId = saved.taskState?.attachment?.id;
    const retainedAttachmentIds = Array.isArray(saved.taskState?.knownSlots.resumeImportAttachmentIds)
      ? saved.taskState.knownSlots.resumeImportAttachmentIds.filter((id): id is string => typeof id === "string")
      : [];
    agentAttachmentStore.releaseMany(retainedAttachmentIds.filter((id) => id !== retainedAttachmentId));
    const originalUserMessage = [...saved.messages].reverse().find((message) => message.role === "user");
    return this.startTurn({
      session: saved,
      userMessage: originalUserMessage?.content ?? "",
      userMessageId: originalUserMessage?.id,
      appendUserMessage: false,
      pageContext,
      supersede: true
    });
  }

  private async retryCurrentWorkflowStep(session: AgentSession, pageContext: AgentPageContext, operationId?: string) {
    const isProfileIntake = session.taskState?.workflowId === "guided_profile_intake";
    const journal = isProfileIntake
      ? await this.dependencies.persistence.listProfileIntakeSourceTurns?.(session.id) ?? []
      : [];
    const recoverableJournal = journal
      .filter((turn) => turn.processingStatus !== "superseded")
      .findLast((turn) => ["failed", "partial", "structuring", "journaled"].includes(turn.processingStatus));
    const safe = resolveLastSafeWorkflowCheckpoint(session);
    const originalTurnId = session.activeTurn?.id ?? safe?.checkpoint?.turnId;
    const sourceMessage = recoverableJournal
      ? session.messages.find((message) => message.id === recoverableJournal.messageId)
      : [...session.messages].reverse().find((message) => message.role === "user" && message.content.trim() && (!originalTurnId || message.turnId === originalTurnId))
        ?? [...session.messages].reverse().find((message) => message.role === "user" && message.content.trim());
    if (!sourceMessage && !safe) return session;
    const checkpoint = sourceMessage
      ? session.turnCheckpoints.findLast((item) => item.userMessageId === sourceMessage.id)
      : undefined;
    if (!safe && !checkpoint && isFailedDomainTask(session)) {
      const blocked = appendAgentMessage(
        session,
        "assistant",
        "当前失败状态没有找到可验证的安全继续点。请重新选择岗位或简历后继续，我不会重复未知写入。",
        {
          kind: "error_status",
          type: "error",
          status: "failed",
          errorCode: "workflow_safe_state_missing",
          metadata: { terminalState: "RECOVERABLE_FAILURE", recoveryBlocked: "safe_state_missing" }
        }
      );
      const saved = await this.dependencies.persistence.save(blocked);
      this.patchSession(saved, { turnStatus: "failed" });
      return saved;
    }
    const tailoringSession = session.taskState?.knownSlots.tailoringSession as TailoringSession | undefined;
    const tailoringFailure = objectValue(session.taskState?.knownSlots.canonicalWorkflowFailure);
    const tailoringGenerationRetry = Boolean(
      session.taskState
      && tailoringSession
      && ["tailor_resume", "tailor_existing_resume"].includes(session.taskState.workflowId)
      && isTailoringQuestionPlanComplete(tailoringSession.plan)
      && (
        session.taskState.stage === "generate_changes"
        || (session.taskState.stage === "clarify_unsupported_facts" && tailoringFailure.code === "tailoring_questions_incomplete")
      )
    );
    const retryTaskState = tailoringGenerationRetry
      ? {
          ...session.taskState!,
          stage: "generate_changes" as const,
          activeGoal: "generate_tailoring_changes" as const,
          completionStatus: "active" as const,
          knownSlots: {
            ...session.taskState!.knownSlots,
            tailoringSession,
            questionPlan: tailoringSession!.plan.questionPlan,
            activeQuestionId: undefined,
            currentClarification: undefined,
            canonicalWorkflowFailure: undefined
          },
          workflowUserInputCheckpoint: undefined,
          updatedAt: new Date().toISOString()
        }
      : undefined;
    const restored = safe
      ? {
          ...session,
          taskState: retryTaskState ?? { ...safe.taskState, completionStatus: "active" as const, updatedAt: new Date().toISOString() },
          workflowState: safe.workflowState,
          artifactRefs: safe.artifactRefs,
          activeProfileId: safe.selectedEntities.profileId,
          activeResumeId: safe.selectedEntities.resumeId,
          activeJobId: safe.selectedEntities.jobId,
          pendingConfirmation: safe.pendingConfirmation,
          pendingToolCall: safe.pendingToolCall,
          activeTurn: undefined,
          updatedAt: new Date().toISOString()
        }
      : checkpoint
      ? {
          ...session,
          taskState: checkpoint.taskStateBefore,
          workflowState: checkpoint.workflowStateBefore,
          artifactRefs: checkpoint.artifactRefsBefore,
          activeProfileId: checkpoint.selectedEntitiesBefore.profileId,
          activeResumeId: checkpoint.selectedEntitiesBefore.resumeId,
          activeJobId: checkpoint.selectedEntitiesBefore.jobId,
          pendingConfirmation: checkpoint.pendingConfirmationBefore,
          pendingToolCall: checkpoint.pendingToolCallBefore,
          activeTurn: undefined,
          updatedAt: new Date().toISOString()
        }
      : retryTaskState
      ? {
          ...session,
          taskState: retryTaskState,
          workflowState: projectTaskStateToWorkflowState(retryTaskState, session.workflowState),
          activeProfileId: retryTaskState.selectedEntities.profileId,
          activeResumeId: retryTaskState.selectedEntities.resumeId,
          activeJobId: retryTaskState.selectedEntities.jobId,
          pendingConfirmation: undefined,
          pendingToolCall: undefined,
          activeTurn: undefined,
          updatedAt: new Date().toISOString()
        }
      : session;
    if (recoverableJournal) {
      await this.dependencies.persistence.updateProfileIntakeSourceTurn?.(
        { sessionId: recoverableJournal.sessionId, messageId: recoverableJournal.messageId, turnId: recoverableJournal.turnId },
        { processingStatus: "superseded" }
      );
    }
    return this.startTurn({
      session: restored,
      userMessage: recoverableJournal?.exactSourceText ?? sourceMessage?.content ?? "继续当前步骤",
      turnId: originalTurnId,
      userMessageId: sourceMessage?.id,
      appendUserMessage: false,
      pageContext,
      supersede: true,
      retryWorkflowStep: true,
      operationId: operationId ?? `retry:${session.id}:${originalTurnId ?? session.taskState?.stage ?? "workflow"}`,
      operationKind: "retry"
    });
  }

  private async supersedeProfileIntakeTurnsAfterEdit(session: AgentSession, messageId: string) {
    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return;
    const abandonedMessageIds = new Set(session.messages.slice(targetIndex).map((message) => message.id));
    const sourceTurns = await this.dependencies.persistence.listProfileIntakeSourceTurns?.(session.id) ?? [];
    for (const sourceTurn of sourceTurns) {
      if (sourceTurn.processingStatus === "superseded" || !abandonedMessageIds.has(sourceTurn.messageId)) continue;
      await this.dependencies.persistence.updateProfileIntakeSourceTurn?.(
        { sessionId: sourceTurn.sessionId, messageId: sourceTurn.messageId, turnId: sourceTurn.turnId },
        { processingStatus: "superseded" }
      );
    }
  }

  /**
   * A branch fork also needs a draft checkpoint.  The conversation branch
   * alone would hide old messages from the model while leaving their derived
   * candidates in the shared intake draft.  Rebase the existing draft to the
   * pre-edit source turns before replaying the edited answer.
   */
  private async restoreProfileIntakeDraftForBranch(
    session: AgentSession,
    branched: AgentSession,
    messageId: string
  ) {
    const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === messageId);
    const importId = checkpoint ? stringValue(checkpoint.taskStateBefore.knownSlots.intakeImportId) : undefined;
    const getDraft = this.dependencies.persistence.getImportedResumeDraft;
    const saveDraft = this.dependencies.persistence.saveImportedResumeDraft;
    if (!checkpoint || !importId || typeof getDraft !== "function" || typeof saveDraft !== "function") return branched;
    const draft = await getDraft.call(this.dependencies.persistence, importId);
    if (!draft || draft.sourceKind !== "conversation") return branched;
    const targetIndex = session.messages.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return branched;
    const sourceTurns = await this.dependencies.persistence.listProfileIntakeSourceTurns?.(session.id) ?? [];
    const priorTurns = sourceTurns.filter((turn) => {
      const sourceIndex = session.messages.findIndex((message) => message.id === turn.messageId);
      return sourceIndex >= 0 && sourceIndex < targetIndex && turn.processingStatus !== "superseded";
    });
    const priorTurnIds = new Set(priorTurns.map((turn) => turn.turnId));
    const retainedItems = draft.sections.flatMap((section) => section.items).filter((item) =>
      item.conversationEvidence?.some((evidence) => priorTurnIds.has(evidence.turnId))
    );
    const retainedIds = new Set(retainedItems.map((item) => item.id));
    const sections = draft.sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => retainedIds.has(item.id))
      }))
      .filter((section) => section.items.length);
    const priorText = priorTurns.map((turn) => turn.exactSourceText).join("\n");
    const now = new Date().toISOString();
    const rebased = {
      ...draft,
      sections,
      pages: [{
        pageNumber: 1,
        rawText: priorText || "（此分支尚未记录新的经历原文）",
        normalizedText: priorText || "（此分支尚未记录新的经历原文）",
        charStart: 0,
        charEnd: (priorText || "（此分支尚未记录新的经历原文）").length
      }],
      warnings: draft.warnings.filter((warning) => !warning.itemId || retainedIds.has(warning.itemId)),
      ...(draft.intakeSession ? {
        intakeSession: {
          ...draft.intakeSession,
          reviewedCandidateIds: draft.intakeSession.reviewedCandidateIds.filter((id) => retainedIds.has(id)),
          lastSourceMessageId: priorTurns.at(-1)?.messageId,
          lastSourceTurnId: priorTurns.at(-1)?.turnId,
          autosavedAt: now,
          resumeToken: stableHashText(`${draft.importId}:${branched.activeBranchId}:${now}`)
        }
      } : {}),
      updatedAt: now
    } satisfies ImportedResumeDraft;
    const savedDraft = await saveDraft.call(this.dependencies.persistence, rebased, draft.revision);
    const projection = retainedItems.length
      ? buildConversationIntakeReviewProjectionFromDraft(savedDraft)
      : undefined;
    const knownSlots: AgentTaskState["knownSlots"] = {
      ...checkpoint.taskStateBefore.knownSlots,
      intakeImportId: savedDraft.importId,
      expectedIntakeDraftRevision: savedDraft.revision,
      intakeDraftBranchId: branched.activeBranchId,
      ...(projection ? {
        profileIntakeReviewProjection: projection,
        intakeCandidates: projection.candidates,
        intakeArtifact: buildConversationIntakeArtifact(savedDraft, projection.followUpQuestion),
        intakeSession: savedDraft.intakeSession
      } : {})
    };
    if (!projection) {
      delete knownSlots.profileIntakeReviewProjection;
      delete knownSlots.intakeCandidates;
      delete knownSlots.intakeArtifact;
      delete knownSlots.intakeSession;
      delete knownSlots.finalReviewRevision;
    }
    delete knownSlots.latestIntakeSource;
    const rebasedState: AgentTaskState = {
      ...checkpoint.taskStateBefore,
      knownSlots,
      stage: projection && projection.candidates.some((candidate) =>
        candidate.status === "proposed" || candidate.status === "uncertain" || candidate.status === "failed"
      ) ? "review_facts" : "collect_experience",
      completionStatus: "waiting_for_user",
      updatedAt: now
    };
    return projectTaskStateIntoSession(branched, rebasedState);
  }

  private async resolveProfileIntakeBoundary(input: {
    current: AgentSession;
    taskState: AgentTaskState;
    turnId: string;
    userMessageId: string;
    thinkingMessageId: string;
    now: string;
    controller: AbortController;
    userMessage: string;
    profileIntakeTurnKind?: TurnIntentDecision["profileIntakeTurnKind"];
  }): Promise<AgentSession | undefined> {
    const source = objectValue(input.taskState.knownSlots.latestIntakeSource);
    if (
      input.taskState.stage === "structure_facts"
      && (source.sourceKind === "career_narrative" || source.sourceKind === "follow_up_answer")
      && source.retracted !== true
    ) {
      return this.captureProfileIntakeAtHostBoundary(input, source);
    }
    const finalization = new ProfileIntakeFinalizationSupervisor();
    const decision = finalization.decide({
      text: input.userMessage,
      stage: input.taskState.stage,
      reviewProjection: input.taskState.knownSlots.profileIntakeReviewProjection,
      explicitCommit: input.taskState.knownSlots.profileIntakeExplicitCommit === true
    });
    if (decision.shouldSynthesize) {
      return this.finalizeProfileIntakeAtHostBoundary(input, decision);
    }
    if (
      input.taskState.stage === "final_review"
      && /^(?:完成整理|先到这里|结束访谈)[。！!]?$/u.test(input.userMessage.trim())
    ) {
      let current = projectTaskStateIntoSession(input.current, {
        ...input.taskState,
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      });
      current = replaceAgentThinking(
        current,
        input.thinkingMessageId,
        "本次整理已进入最终批量审核。请先核对当前事实；确认无误后说“确认”或选择保存操作。",
        input.turnId
      );
      current = attachTaskStateOptions(current, {
        ...input.taskState,
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      });
      return this.finishLocalProfileIntakeTurn(current, {
        ...input.taskState,
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      }, input, "waiting_for_user");
    }
    if (
      finalization.isExplicitSaveIntent(input.userMessage)
      && decision.shouldReconcile
      && input.taskState.stage !== "resolve_conflicts"
    ) {
      return this.finalizeProfileIntakeAtHostBoundary(input, decision);
    }
    if (finalization.isExplicitSaveIntent(input.userMessage) && decision.projection?.finalSynthesis) {
      let current = projectTaskStateIntoSession(input.current, {
        ...input.taskState,
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      });
      current = replaceAgentThinking(current, input.thinkingMessageId, "最终资料草稿还没有全部采用。请先在这一次最终审核中选择“全部采用”，再确认写入资料库。", input.turnId);
      current = attachTaskStateOptions(current, input.taskState);
      return this.finishLocalProfileIntakeTurn(current, input.taskState, input, "waiting_for_user");
    }
    return undefined;
  }

  /**
   * Intake meta/reference turns are deliberately answered at the host
   * boundary.  They do not journal a source turn, invoke semantic extraction,
   * or enter the generic agent kernel, so a phrase such as “什么工作？” cannot
   * manufacture a second candidate.
   */
  private async resolveProfileIntakeConversationBoundary(input: {
    current: AgentSession;
    taskState: AgentTaskState;
    turnId: string;
    userMessageId: string;
    thinkingMessageId: string;
    now: string;
    userMessage: string;
    profileIntakeTurnKind?: TurnIntentDecision["profileIntakeTurnKind"];
    activeQuestionResolution?: ActiveQuestionTurnResolution;
  }): Promise<AgentSession | undefined> {
    if (
      input.taskState.workflowId !== "guided_profile_intake"
      || !["collect_experience", "structure_facts", "review_facts"].includes(input.taskState.stage)
      || !["profile_state_question", "interview_control"].includes(input.profileIntakeTurnKind ?? "")
    ) return undefined;
    const command = input.userMessage.trim().replace(/[。！!？?\s]+$/gu, "");
    const draftRequested = isProfileIntakeDraftRequest(input.userMessage) || command === "先看看";
    const active = currentProfileIntakeQuestion(input.taskState);
    const targetLabel = active?.candidateLabel ?? "这段经历";
    const question = active?.question;
    if (
      input.profileIntakeTurnKind === "profile_state_question"
      && input.activeQuestionResolution?.kind === "reference_question"
      && input.activeQuestionResolution.reason === "previous_answer_satisfies_active_dimension"
    ) {
      const advanced = await this.advanceProfileIntakeQuestionFromReference(input, input.activeQuestionResolution);
      if (advanced) return advanced;
    }
    if (
      input.profileIntakeTurnKind === "interview_control"
      && input.activeQuestionResolution?.kind === "skip"
    ) {
      const advanced = await this.advanceProfileIntakeQuestionFromReference(input, input.activeQuestionResolution);
      if (advanced) return advanced;
    }
    let content: string;
    if (draftRequested) {
      content = formatProfileIntakeDraftSummary(input.taskState);
      if (question) {
        content += `\n\n当前仍在确认“${targetLabel}”：${question}`;
      }
      content += "\n\n你可以继续补充，也可以说“完成整理”进入最终审核。";
    } else if (question && input.profileIntakeTurnKind === "profile_state_question") {
      content = `我指的是“${targetLabel}”。刚才想确认的是：${question}`;
    } else if (question) {
      content = `可以继续。当前先确认“${targetLabel}”：${question}`;
    } else {
      content = "可以继续补充下一段真实经历；如果暂时没有其他内容，也可以说“完成整理”。";
    }
    const boundaryPlan = ProfileIntakeNextTurnPlanSchema.parse({
      action: draftRequested ? "show_draft" : "answer_reference",
      ...(active?.candidateId ? { candidateId: active.candidateId } : {}),
      candidateLabel: targetLabel,
      ...(question ? { question } : {}),
      ...(draftRequested ? { draftSummary: content } : {}),
      capturedAssetLabels: []
    });
    const nextTaskState = {
      ...input.taskState,
      knownSlots: {
        ...input.taskState.knownSlots,
        profileIntakeNextTurnPlan: boundaryPlan
      },
      completionStatus: "waiting_for_user",
      updatedAt: new Date().toISOString()
    } satisfies AgentTaskState;
    let current = projectTaskStateIntoSession(input.current, nextTaskState);
    current = replaceAgentThinking(current, input.thinkingMessageId, content, input.turnId);
    current = attachTaskStateOptions(current, nextTaskState);
    return this.finishLocalProfileIntakeTurn(current, nextTaskState, input, "waiting_for_user");
  }

  private async advanceProfileIntakeQuestionFromReference(
    input: {
      current: AgentSession;
      taskState: AgentTaskState;
      turnId: string;
      userMessageId: string;
      thinkingMessageId: string;
      now: string;
      userMessage: string;
      profileIntakeTurnKind?: TurnIntentDecision["profileIntakeTurnKind"];
      activeQuestionResolution?: ActiveQuestionTurnResolution;
    },
    resolution: ActiveQuestionTurnResolution
  ): Promise<AgentSession | undefined> {
    const importId = stringValue(input.taskState.knownSlots.intakeImportId);
    const source = objectValue(input.taskState.knownSlots.latestIntakeSource);
    const sourceTurnId = resolution.kind === "skip"
      ? input.turnId
      : resolution.resolvedBySourceTurnId ?? stringValue(source.turnId);
    const candidateId = resolution.candidateId;
    const dimension = resolution.dimension;
    if (!importId || !sourceTurnId || !resolution.activeQuestionId || !candidateId || !dimension) return undefined;
    const repository = this.dependencies.repository;
    if (!repository) return undefined;
    const draft = await repository.getImportedResumeDraft(importId);
    if (!draft?.intakeSession) return undefined;
    const recorded = appendProfileIntakeQuestionAnswer(draft.intakeSession.questionAnswers ?? [], {
      questionId: resolution.activeQuestionId,
      candidateId,
      dimension,
      sourceTurnId,
      answerRevision: draft.revision + 1,
      status: resolution.kind === "skip" ? "skipped" : "answered",
      capturedAt: input.now
    });
    const hasRecordedIdentity = recorded.answers.some((answer) =>
      answer.questionId === resolution.activeQuestionId
      && answer.sourceTurnId === sourceTurnId
    );
    if (!recorded.appended && !hasRecordedIdentity) return undefined;
    const provisionalItems = draft.sections.flatMap((section) => section.items.flatMap((item) =>
      item.userConfirmed !== false && item.structuredItem ? [item.structuredItem] : []
    ));
    const sourceEvidenceByCandidate = Object.fromEntries(draft.sections.flatMap((section) => section.items.map((item) => [
      item.id,
      [...new Set([
        ...(item.conversationEvidence ?? []).map((evidence) => evidence.sourceQuote),
        ...(item.sourceQuote ? [item.sourceQuote] : []),
        ...(item.rawText ? [item.rawText] : [])
      ].filter((value): value is string => Boolean(value && value.trim())))]
    ]))) as Record<string, string[]>;
    const nextRevision = draft.revision + 1;
    const interviewPlan = createProfileIntakeInterviewPlan(provisionalItems, nextRevision, {
      followUpCounts: draft.intakeSession.followUpCounts,
      questionAnswers: recorded.answers,
      sourceEvidenceByCandidate
    });
    const nextDraft = ImportedResumeDraftSchema.parse({
      ...draft,
      intakeSession: {
        ...draft.intakeSession,
        questionAnswers: recorded.answers,
        activeQuestionId: interviewPlan.activeQuestionId,
        autosavedAt: input.now,
        resumeToken: stableHashText(`${draft.importId}:${nextRevision}:reference-advance`)
      }
    });
    const saved = await repository.saveImportedResumeDraft(nextDraft, draft.revision);
    const nextQuestion = interviewPlan.activeQuestion;
    const followUpQuestion = nextQuestion?.question;
    const projection = buildConversationIntakeReviewProjectionFromDraft(saved, followUpQuestion ? [followUpQuestion] : []);
    const artifact = buildConversationIntakeArtifact(saved, followUpQuestion, interviewPlan);
    const nextTurnPlan = ProfileIntakeNextTurnPlanSchema.parse(nextQuestion
      ? {
          action: "ask_follow_up",
          questionId: nextQuestion.questionId,
          questionRevision: nextQuestion.questionRevision,
          candidateId: nextQuestion.candidateId,
          candidateLabel: nextQuestion.candidateLabel,
          sectionType: nextQuestion.sectionType,
          dimension: nextQuestion.dimension,
          question: targetQuestion(nextQuestion.question, nextQuestion.candidateLabel),
          acknowledgement: resolution.kind === "skip"
            ? "好的，我先跳过这项细节，后面不再重复询问。"
            : `明白了，你刚才已经说明了${profileIntakeDimensionLabel(dimension)}。`,
          capturedAssetLabels: provisionalItems.map(profileIntakeItemLabel)
        }
      : {
          action: "offer_finish",
          question: "目前没有必须重复确认的细节了。你可以继续补充其他经历，或完成整理。",
          capturedAssetLabels: provisionalItems.map(profileIntakeItemLabel)
        });
    const nextTaskState: AgentTaskState = {
      ...input.taskState,
      knownSlots: {
        ...input.taskState.knownSlots,
        intakeImportId: saved.importId,
        expectedIntakeDraftRevision: saved.revision,
        intakeSession: saved.intakeSession,
        intakeInterviewPlan: interviewPlan,
        intakeActiveQuestion: interviewPlan.activeQuestion,
        activeQuestionId: interviewPlan.activeQuestionId,
        intakeFollowUpQuestion: followUpQuestion,
        profileIntakeNextTurnPlan: nextTurnPlan,
        profileIntakeReviewProjection: projection,
        intakeCandidates: projection.candidates,
        intakeArtifact: artifact,
        profileIntakePhase: "clarifying"
      },
      stage: "collect_experience",
      completionStatus: "waiting_for_user",
      updatedAt: input.now
    };
    const nextLabel = nextQuestion?.candidateLabel ?? "下一段经历";
    const content = resolution.kind === "skip"
      ? followUpQuestion
        ? `好的，我先跳过“${profileIntakeDimensionLabel(dimension)}”，后面不再重复询问。\n\n接下来我想确认“${nextLabel}”：${targetQuestion(nextQuestion!.question, nextLabel)}`
        : "好的，我先跳过这项细节，后面不再重复询问。\n\n目前可以继续补充其他经历，或完成整理。"
      : followUpQuestion
        ? `明白了。你上一条回答已经覆盖了“${profileIntakeDimensionLabel(dimension)}”，我不再重复这个问题。\n\n接下来我想确认“${nextLabel}”：${targetQuestion(nextQuestion!.question, nextLabel)}`
        : "明白了。你上一条回答已经覆盖了这项细节，我不再重复这个问题。\n\n目前可以继续补充其他经历，或完成整理。";
    let current = projectTaskStateIntoSession(input.current, nextTaskState);
    current = attachProfileIntakeArtifact(current, {
      ok: true,
      artifactIds: [],
      data: {
        importId: saved.importId,
        expectedDraftRevision: saved.revision,
        interviewPlan,
        nextTurnPlan,
        artifactPayload: artifact,
        reviewProjection: projection,
        intakeSession: saved.intakeSession
      }
    }, "已推进访谈问题");
    current = replaceAgentThinking(current, input.thinkingMessageId, content, input.turnId);
    current = attachTaskStateOptions(current, nextTaskState);
    return this.finishLocalProfileIntakeTurn(current, nextTaskState, input, "waiting_for_user");
  }

  private async captureProfileIntakeAtHostBoundary(
    input: {
      current: AgentSession;
      taskState: AgentTaskState;
      turnId: string;
      userMessageId: string;
      thinkingMessageId: string;
      now: string;
      controller: AbortController;
    },
    source: Record<string, unknown>
  ) {
    const sessionId = stringValue(source.sessionId) ?? input.current.id;
    const messageId = stringValue(source.messageId) ?? input.userMessageId;
    const sourceTurnId = stringValue(source.turnId) ?? input.turnId;
    const exactSourceText = stringValue(source.exactSourceQuote);
    const capturedAt = stringValue(source.capturedAt) ?? input.now;
    const targetProfileId = stringValue(input.taskState.knownSlots.targetProfileId)
      ?? stringValue(source.targetProfileId);
    let expectedProfileVersion = numberValue(input.taskState.knownSlots.expectedProfileVersion)
      ?? numberValue(source.expectedProfileVersion);
    if (!exactSourceText || !targetProfileId || expectedProfileVersion === undefined) {
      const failedState = new AgentTaskStateReducer().reduce(input.taskState, {
        type: "failed",
        errorCode: "profile_intake_target_unresolved"
      });
      let current = projectTaskStateIntoSession(input.current, failedState);
      current = replaceAgentThinking(current, input.thinkingMessageId, "还没有确定要写入的个人资料库。请选择或创建资料库后，我会保留这段回答并继续当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, failedState, input, "failed");
    }
    const targetScopedAnswer = source.sourceKind === "follow_up_answer";
    const sourceIdentity = { sessionId, messageId, turnId: sourceTurnId } as const;
    const persistence = this.dependencies.persistence;
    let journal = await persistence.getProfileIntakeSourceTurn?.(sourceIdentity);
    if (!journal) {
      journal = ProfileIntakeSourceTurnSchema.parse({
        ...sourceIdentity,
        exactSourceText,
        sourceHash: stringValue(source.sourceContentHash) ?? stableHashText(exactSourceText),
        capturedAt,
        branchId: input.current.activeBranchId,
        workflowStage: "structure_facts",
        turnClassification: source.sourceKind === "follow_up_answer"
          ? "follow_up_answer"
          : source.sourceKind === "career_narrative"
            ? "career_narrative"
            : "unknown",
        ...(targetScopedAnswer ? {
          activeQuestionId: stringValue(source.intakeQuestionId) ?? stringValue(input.taskState.knownSlots.activeQuestionId),
          activeCandidateId: stringValue(source.intakeCandidateId) ?? stringValue(objectValue(input.taskState.knownSlots.intakeActiveQuestion).candidateId),
          expectedAnswerDimension: stringValue(source.intakeDimension) ?? stringValue(objectValue(input.taskState.knownSlots.intakeActiveQuestion).dimension)
        } : {}),
        processingStatus: "journaled",
        candidateIds: []
      });
      await persistence.saveProfileIntakeSourceTurn?.(journal);
    }
    const operationId = `profile-intake-capture-${input.current.id}-${sourceTurnId}`.replace(/[^\w-]/g, "-").slice(0, 160);
    const attempt = (journal?.attempt ?? 0) + 1;
    await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
      processingStatus: "structuring",
      attempt,
      operationId,
      safeErrorCode: undefined,
      lastErrorCode: undefined
    });
    let captureState = input.taskState;
    let result: Awaited<ReturnType<AgentExecutor["execute"]>> | undefined;
    const captureInput = {
      sessionId,
      messageId,
      turnId: sourceTurnId,
      text: exactSourceText,
      capturedAt,
      targetProfileId,
        expectedProfileVersion,
        acknowledgedActiveProfileId: stringValue(input.taskState.knownSlots.acknowledgedActiveProfileId),
        intakeQuestionId: source.sourceKind === "follow_up_answer" ? stringValue(source.intakeQuestionId) : undefined,
        intakeCandidateId: source.sourceKind === "follow_up_answer" ? stringValue(source.intakeCandidateId) : undefined,
        intakeDimension: source.sourceKind === "follow_up_answer"
          ? stringValue(source.intakeDimension) ?? stringValue(objectValue(input.taskState.knownSlots.intakeActiveQuestion).dimension)
          : undefined,
        importId: stringValue(input.taskState.knownSlots.intakeImportId),
      expectedDraftRevision: numberValue(input.taskState.knownSlots.expectedIntakeDraftRevision),
      sourceContentHash: stringValue(source.sourceContentHash),
      retry: journal?.processingStatus === "failed"
    } satisfies Record<string, unknown>;
    const executeCapture = () => this.dependencies.executor.execute({
      toolName: "capture_profile_intake",
      toolInput: captureInput,
      operationId,
      signal: input.controller.signal
    });
    try {
      result = await executeCapture();
      if (!result.ok && isStaleProfileError(result.error?.code)) {
        const refreshed = await this.dependencies.executor.execute({
          toolName: "get_profile",
          toolInput: { profileId: targetProfileId },
          operationId: `${operationId}-refresh-profile`.slice(0, 160),
          signal: input.controller.signal
        });
        const refreshedProfile = objectValue(objectValue(refreshed.data).profile);
        const refreshedVersion = refreshed.ok ? numberValue(refreshedProfile.version) : undefined;
        if (refreshedVersion !== undefined) {
          expectedProfileVersion = refreshedVersion;
          captureInput.expectedProfileVersion = refreshedVersion;
          captureState = {
            ...input.taskState,
            knownSlots: { ...input.taskState.knownSlots, expectedProfileVersion: refreshedVersion },
            selectedEntities: { ...input.taskState.selectedEntities, profileVersion: refreshedVersion },
            updatedAt: new Date().toISOString()
          };
          result = await executeCapture();
        }
      }
    } catch (error) {
      const code = safeErrorCode(error);
      await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
        ...profileIntakeSourceTurnDiagnosticPatch({
          processingStatus: "failed",
          extractionStatus: "failed",
          safeErrorCode: code,
          candidateCount: 0,
          quarantinedCount: 0,
          operationId,
          attempt
        })
      });
      const failedState = new AgentTaskStateReducer().reduce(input.taskState, { type: "failed", errorCode: code });
      let current = projectTaskStateIntoSession(input.current, failedState);
      current = replaceAgentThinking(current, input.thinkingMessageId, "这段回答已经保留在本地，但结构化整理暂时没有完成。请使用“重新执行当前步骤”继续。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, failedState, input, "failed");
    }
    if (!result?.ok) {
      const code = result?.error?.code ?? "profile_intake_capture_failed";
      await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
        ...profileIntakeSourceTurnDiagnosticPatch({
          processingStatus: "failed",
          extractionStatus: "failed",
          safeErrorCode: code,
          candidateCount: 0,
          quarantinedCount: 0,
          operationId,
          attempt
        })
      });
      const failedState = new AgentTaskStateReducer().reduce(input.taskState, { type: "failed", errorCode: code });
      let current = projectTaskStateIntoSession(input.current, failedState);
      current = replaceAgentThinking(current, input.thinkingMessageId, "这段回答已经保留在本地，但结构化整理暂时没有完成。请使用“重新执行当前步骤”继续。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, failedState, input, "failed");
    }
    const reducer = new AgentTaskStateReducer();
    const nextState = reducer.reduce(captureState, {
      type: "tool_observation",
      toolName: result.toolName,
      observation: result.data,
      artifactIds: result.artifactIds
    });
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(nextState.knownSlots.profileIntakeReviewProjection);
    const candidateIds = projection.success ? projection.data.candidates.map((candidate) => candidate.id) : [];
    const processingStatus: ProfileIntakeSourceTurn["processingStatus"] = projection.success
      && projection.data.extractionStatus === "failed"
      ? "partial"
      : projection.success && projection.data.extractionStatus === "partial"
        ? "partial"
        : "structured";
    const safeDiagnostics = objectValue(objectValue(result.data).safeDiagnostics);
    const quarantinedFields = Array.isArray(safeDiagnostics.quarantinedFields)
      ? safeDiagnostics.quarantinedFields.filter((field: unknown): field is string => typeof field === "string").slice(0, 40)
      : [];
    await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
      importId: stringValue(objectValue(result.data).importId),
      candidateIds,
      ...profileIntakeSourceTurnDiagnosticPatch({
        processingStatus,
        extractionStatus: captureExtractionStatus(String(projection.success ? projection.data.extractionStatus : "failed")),
        safeErrorCode: stringValue(objectValue(objectValue(result.data).safeDiagnostics).safeErrorCode),
        provider: stringValue(objectValue(objectValue(result.data).safeDiagnostics).provider),
        model: stringValue(objectValue(objectValue(result.data).safeDiagnostics).model),
        semanticTask: stringValue(safeDiagnostics.semanticTask),
        patchStage: stringValue(safeDiagnostics.patchStage) as ProfileIntakeSourceTurn["patchStage"],
        schemaStage: stringValue(safeDiagnostics.schemaStage) as ProfileIntakeSourceTurn["schemaStage"],
        groundingStage: stringValue(safeDiagnostics.groundingStage),
        repositoryStage: stringValue(safeDiagnostics.repositoryStage) as ProfileIntakeSourceTurn["repositoryStage"],
        attempt: numberValue(safeDiagnostics.attempt) ?? attempt,
        latencyMs: numberValue(safeDiagnostics.latencyMs),
        candidateCount: numberValue(safeDiagnostics.candidateCount) ?? candidateIds.length,
        quarantinedCount: numberValue(safeDiagnostics.quarantinedCount)
          ?? numberValue(safeDiagnostics.quarantinedCandidateCount)
          ?? 0,
        quarantinedFields,
        operationId
      })
    });
    let current = projectTaskStateIntoSession(input.current, nextState);
    current = reconcileTaskArtifacts(current, nextState);
    current = attachProfileIntakeArtifact(current, result, "访谈整理进度");
    const narration = captureProfileIntakeNarration(
      objectValue(result.data),
      projection.success ? projection.data : undefined,
      nextState
    );
    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId: input.turnId,
      content: narration.split("\n\n")[0] ?? "已更新本地整理草稿。",
      toolName: "capture_profile_intake",
      operationId,
      status: "complete",
      metadata: { activityState: "complete", directBoundary: true, artifactIds: result.artifactIds }
    });
    current = replaceAgentThinking(current, input.thinkingMessageId, narration, input.turnId);
    current = attachTaskStateOptions(current, nextState);
    return this.finishLocalProfileIntakeTurn(current, nextState, input, "waiting_for_user");
  }

  private async finishLocalProfileIntakeTurn(
    current: AgentSession,
    taskState: AgentTaskState,
    input: { turnId: string; userMessageId: string; now: string },
    outcome: "waiting_for_user" | "completed" | "failed"
  ) {
    if (taskState.workflowId === "guided_profile_intake") current = ensureConversationBranches(current);
    current = projectTaskStateIntoSession(current, taskState);
    current = settleThinkingMessages(current, input.turnId);
    current = settleUserExecutionState(current, input.turnId, outcome === "failed" ? "failed" : "complete");
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: input.turnId,
        sessionId: current.id,
        sourceUserMessageId: input.userMessageId,
        userMessageId: input.userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        executionOwner: current.activeTurn?.executionOwner ?? "deterministic_transition",
        status: outcome,
        startedAt: input.now,
        completedAt: new Date().toISOString()
      }
    };
    current = completeTurnCheckpoint(current, input.turnId, new Date().toISOString());
    return this.dependencies.persistence.save(current);
  }

  private async finalizeProfileIntakeAtHostBoundary(
    input: {
      current: AgentSession;
      taskState: AgentTaskState;
      turnId: string;
      userMessageId: string;
      thinkingMessageId: string;
      now: string;
      controller: AbortController;
    },
    initialDecision: ReturnType<ProfileIntakeFinalizationSupervisor["decide"]>
  ) {
    const reducer = new AgentTaskStateReducer();
    let state = input.taskState;
    let current = input.current;
    const targetProfileId = stringValue(state.knownSlots.targetProfileId);
    let expectedProfileVersion = numberValue(state.knownSlots.expectedProfileVersion);
    const importId = stringValue(state.knownSlots.intakeImportId) ?? initialDecision.projection?.importId;
    let expectedDraftRevision = numberValue(state.knownSlots.expectedIntakeDraftRevision)
      ?? initialDecision.projection?.draftRevision;
    let expectedReconciliationRevision: number | undefined;
    const persistence = this.dependencies.persistence;
    // Keep the finalization identity stable across a recoverable UI/provider
    // failure.  The draft and reconciliation revisions are the operation
    // boundary; a new retry turn must not become a second Profile write.
    const operationPrefix = `profile-intake-finalize-${current.id}-${importId ?? "pending"}-${expectedDraftRevision ?? "pending"}`
      .replace(/[^\w-]/g, "-")
      .slice(0, 120);
    if (!targetProfileId || expectedProfileVersion === undefined || !importId || expectedDraftRevision === undefined) {
      state = reducer.reduce(state, { type: "failed", errorCode: "profile_intake_finalization_state_missing" });
      current = projectTaskStateIntoSession(current, state);
      current = replaceAgentThinking(current, input.thinkingMessageId, "当前整理状态还不完整，未执行保存；已有核对内容和原始回答仍然保留。请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, state, input, "failed");
    }

    const sourceTurns = (await persistence.listProfileIntakeSourceTurns?.(current.id) ?? [])
      .filter((turn) => !turn.branchId || turn.branchId === current.activeBranchId);
    const hasUnprocessedSource = sourceTurns.some((turn) =>
      turn.processingStatus !== "superseded"
      && ["journaled", "structuring", "failed"].includes(turn.processingStatus)
    );
    if (hasUnprocessedSource) {
      state = { ...state, stage: "review_facts", completionStatus: "waiting_for_user", updatedAt: new Date().toISOString() };
      current = projectTaskStateIntoSession(current, state);
      current = replaceAgentThinking(current, input.thinkingMessageId, "还有一段原始回答尚未完成整理，我会先保留它；完成当前步骤后再执行保存。", input.turnId);
      return this.finishLocalProfileIntakeTurn(current, state, input, "waiting_for_user");
    }

    const executeRaw = async (toolName: string, toolInput: Record<string, unknown>, operationId: string, confirmed = false) => {
      try {
        return await this.dependencies.executor.execute({
          toolName,
          toolInput,
          operationId: operationId.slice(0, 160),
          confirmed,
          signal: input.controller.signal
        });
      } catch {
        return undefined;
      }
    };
    const refreshDraftRevision = async () => {
      const getDraft = this.dependencies.persistence.getImportedResumeDraft;
      if (typeof getDraft !== "function" || !importId) return false;
      const latest = await getDraft.call(this.dependencies.persistence, importId);
      if (!latest || latest.sourceKind !== "conversation") return false;
      expectedDraftRevision = latest.revision;
      const latestProjection = buildConversationIntakeReviewProjectionFromDraft(latest);
      state = {
        ...state,
        knownSlots: {
          ...state.knownSlots,
          intakeImportId: latest.importId,
          expectedIntakeDraftRevision: latest.revision,
          profileIntakeReviewProjection: latestProjection,
          intakeCandidates: latestProjection.candidates,
          intakeArtifact: buildConversationIntakeArtifact(latest, latestProjection.followUpQuestion),
          intakeSession: latest.intakeSession
        },
        updatedAt: new Date().toISOString()
      };
      return true;
    };
    const execute = async (toolName: string, toolInput: Record<string, unknown>, operationId: string, confirmed = false) => {
      let result = await executeRaw(toolName, toolInput, operationId, confirmed);
      if (!result?.ok && isStaleProfileError(result?.error?.code) && targetProfileId) {
        const refreshed = await executeRaw("get_profile", { profileId: targetProfileId }, `${operationId}-refresh-profile`);
        const refreshedProfile = objectValue(objectValue(refreshed?.data).profile);
        const refreshedVersion = refreshed?.ok ? numberValue(refreshedProfile.version) : undefined;
        if (refreshedVersion !== undefined) {
          expectedProfileVersion = refreshedVersion;
          state = {
            ...state,
            knownSlots: { ...state.knownSlots, expectedProfileVersion: refreshedVersion },
            selectedEntities: { ...state.selectedEntities, profileVersion: refreshedVersion },
            updatedAt: new Date().toISOString()
          };
          result = await executeRaw(toolName, { ...toolInput, expectedProfileVersion: refreshedVersion }, operationId, confirmed);
        }
      } else if (!result?.ok && isStaleDraftError(result?.error?.code) && await refreshDraftRevision()) {
        const refreshedInput = { ...toolInput, expectedDraftRevision };
        if (toolName === "commit_profile_intake") {
          const refreshedReconciliation = await executeRaw("reconcile_profile_intake", {
            importId,
            expectedDraftRevision,
            targetProfileId,
            expectedProfileVersion,
            acknowledgedActiveProfileId: stringValue(state.knownSlots.acknowledgedActiveProfileId)
          }, `${operationId}-refresh-reconcile`);
          const refreshedPlanRevision = refreshedReconciliation?.ok
            ? numberValue(objectValue(refreshedReconciliation.data).expectedPlanRevision)
            : undefined;
          if (refreshedPlanRevision !== undefined) {
            expectedReconciliationRevision = refreshedPlanRevision;
            result = await executeRaw(toolName, {
              ...refreshedInput,
              expectedReconciliationRevision: refreshedPlanRevision
            }, operationId, confirmed);
          }
        } else {
          result = await executeRaw(toolName, refreshedInput, operationId, confirmed);
        }
      }
      return result;
    };

    if (initialDecision.shouldSynthesize) {
      const synthesisOperationId = `${operationPrefix}-synthesis-${expectedDraftRevision}`;
      const synthesis = await execute("synthesize_profile_intake", {
        importId,
        expectedDraftRevision
      }, synthesisOperationId);
      if (!synthesis?.ok) {
        const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: synthesis?.error?.code ?? "profile_intake_synthesis_failed" });
        current = projectTaskStateIntoSession(current, stateAfterFailure);
        current = replaceAgentThinking(current, input.thinkingMessageId, "最终资料综合暂时没有完成；原始回答和本地整理草稿仍然保留，请重试当前步骤。", input.turnId);
        current = withRetryCurrentStepOption(current, input.thinkingMessageId);
        return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
      }
      state = reducer.reduce(state, {
        type: "tool_observation",
        toolName: synthesis.toolName,
        observation: synthesis.data,
        artifactIds: synthesis.artifactIds
      });
      expectedDraftRevision = numberValue(objectValue(synthesis.data).expectedDraftRevision) ?? expectedDraftRevision + 1;
      state.knownSlots.expectedIntakeDraftRevision = expectedDraftRevision;
      current = projectTaskStateIntoSession(current, state);
      current = reconcileTaskArtifacts(current, state);
      current = attachProfileIntakeArtifact(current, synthesis, "最终资料草稿");
      current = upsertAgentActivity(current, {
        id: `agent-tool-${synthesisOperationId}`,
        turnId: input.turnId,
        content: "已完成本次访谈的最终综合，进入一次性最终审核。",
        toolName: synthesis.toolName,
        operationId: synthesisOperationId,
        status: "complete",
        metadata: { activityState: "complete", directBoundary: true, finalSynthesis: true, artifactIds: synthesis.artifactIds }
      });
      current = replaceAgentThinking(current, input.thinkingMessageId, "已根据本次完整访谈整理出一份最终资料草稿。请在最终审核中一次性核对、编辑或忽略；确认后才会写入个人资料库。", input.turnId);
      current = attachTaskStateOptions(current, state);
      return this.finishLocalProfileIntakeTurn(current, state, input, "waiting_for_user");
    }

    const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
    const unresolvedCandidates = projection.success
      ? projection.data.candidates.filter((candidate) => !["accepted", "ignored"].includes(candidate.status))
      : [];
    if (!projection.success || unresolvedCandidates.length) {
      state = {
        ...state,
        stage: "review_facts",
        completionStatus: "waiting_for_user",
        updatedAt: new Date().toISOString()
      };
      current = projectTaskStateIntoSession(current, state);
      current = replaceAgentThinking(current, input.thinkingMessageId, "我已自动采用来源明确的内容；剩余候选还需要你核对后才能保存。请在核对卡片上确认或忽略它们。", input.turnId);
      current = attachTaskStateOptions(current, state);
      return this.finishLocalProfileIntakeTurn(current, state, input, "waiting_for_user");
    }

    // Persist the phase boundary before any reconciliation or Profile write.
    // A reload during the commit lane must show that the final review has
    // already been accepted but verification is still in progress.
    const committingAt = new Date().toISOString();
    const existingIntakeSession = objectValue(state.knownSlots.intakeSession);
    state = {
      ...state,
      knownSlots: {
        ...state.knownSlots,
        profileIntakePhase: "committing",
        ...(Object.keys(existingIntakeSession).length
          ? { intakeSession: { ...existingIntakeSession, phase: "committing", autosavedAt: committingAt } }
          : {})
      },
      updatedAt: committingAt
    };
    current = projectTaskStateIntoSession(current, state);
    current = await persistence.save(current);
    this.patchSession(current, { turnStatus: "running", currentObservation: { type: "profile_intake_committing" } });

    const reconcileOperationId = `${operationPrefix}-reconcile-${importId}-${expectedDraftRevision}`;
    const reconciliation = await execute("reconcile_profile_intake", {
      importId,
      expectedDraftRevision,
      targetProfileId,
      expectedProfileVersion,
      acknowledgedActiveProfileId: stringValue(state.knownSlots.acknowledgedActiveProfileId)
    }, reconcileOperationId);
    if (!reconciliation?.ok) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: reconciliation?.error?.code ?? "profile_intake_reconcile_failed" });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "保存前的资料对账暂时没有完成，核对内容和原始回答仍然保留。请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: reconciliation.toolName,
      observation: reconciliation.data,
      artifactIds: reconciliation.artifactIds
    });
    current = upsertAgentActivity(current, {
      id: `agent-tool-${reconcileOperationId}`,
      turnId: input.turnId,
      content: "已完成保存前的资料对账。",
      toolName: reconciliation.toolName,
      operationId: reconcileOperationId,
      status: "complete",
      metadata: { activityState: "complete", directBoundary: true }
    });
    const reconciliationSummary = objectValue(objectValue(reconciliation.data).summary);
    const unresolvedCount = typeof reconciliationSummary.requiresReview === "number" ? reconciliationSummary.requiresReview : 0;
    if (unresolvedCount > 0) {
      current = projectTaskStateIntoSession(current, state);
      current = replaceAgentThinking(current, input.thinkingMessageId, `对账发现 ${unresolvedCount} 项真实资料冲突。我不会替你猜测，请只核对冲突卡片；处理完后会沿用这次明确的保存意图继续。`, input.turnId);
      current = attachTaskStateOptions(current, state);
      return this.finishLocalProfileIntakeTurn(current, state, input, "waiting_for_user");
    }

    expectedReconciliationRevision = numberValue(state.knownSlots.expectedIntakeReconciliationRevision)
      ?? numberValue(objectValue(reconciliation.data).expectedPlanRevision);
    if (expectedReconciliationRevision === undefined) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: "profile_intake_reconciliation_revision_missing" });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "资料对账结果缺少可验证版本，未执行保存。已有内容仍然保留，请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    const commitOperationId = `${operationPrefix}-commit-${importId}-${expectedDraftRevision}-${expectedReconciliationRevision}`;
    const commit = await execute("commit_profile_intake", {
      importId,
      expectedDraftRevision,
      expectedReconciliationRevision,
      targetProfileId,
      expectedProfileVersion,
      acknowledgedActiveProfileId: stringValue(state.knownSlots.acknowledgedActiveProfileId)
    }, commitOperationId, true);
    if (!commit?.ok) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: commit?.error?.code ?? "profile_intake_commit_failed" });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "资料库写入没有成功，未显示完成结论；核对内容和原始回答仍然保留。请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: commit.toolName,
      observation: commit.data,
      artifactIds: commit.artifactIds
    });
    current = upsertAgentActivity(current, {
      id: `agent-tool-${commitOperationId}`,
      turnId: input.turnId,
      content: "已写入个人资料库，正在读取结果核验。",
      toolName: commit.toolName,
      operationId: commitOperationId,
      status: "complete",
      metadata: { activityState: "complete", directBoundary: true }
    });
    const commitValue = objectValue(commit.data);
    const committedProfileId = stringValue(commitValue.profileId);
    const committedVersion = numberValue(commitValue.profileVersion);
    if (!committedProfileId || committedVersion === undefined) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: "profile_commit_receipt_invalid" });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "写入结果缺少可验证的资料库版本，因此我不会宣称保存完成。请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    const verifyOperationId = `${commitOperationId}-verify`;
    const verificationResult = await execute("get_profile", { profileId: committedProfileId }, verifyOperationId);
    const verificationValue = objectValue(verificationResult?.ok ? verificationResult.data : undefined);
    const verifiedProfile = objectValue(verificationValue.profile);
    const verified = verificationResult?.ok === true
      && verifiedProfile.id === committedProfileId
      && numberValue(verifiedProfile.version) === committedVersion;
    if (!verified) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: "profile_commit_verification_failed" });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "资料库写入后的读取核验没有完成，因此我不会显示已保存结论。写入结果已保留，请重新执行当前步骤核验。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    state = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "get_profile",
      observation: verificationResult!.data,
      artifactIds: verificationResult!.artifactIds
    });
    const verifiedItemCount = Array.isArray(verifiedProfile.items) ? verifiedProfile.items.length : 0;
    const receipt = profileIntakePersistenceReceipt({
      operationId: commitOperationId,
      commit: commitValue,
      verification: { ...verifiedProfile, verifiedItemCount },
      verifiedAt: new Date().toISOString()
    });
    state = {
      ...state,
      knownSlots: {
        ...state.knownSlots,
        profilePersistenceReceipt: receipt,
        profileCommitResult: commitValue,
        profileCommitVerification: {
          profileId: committedProfileId,
          profileVersion: committedVersion,
          profileName: stringValue(verifiedProfile.name),
          verifiedAt: new Date().toISOString()
        }
      },
      completionStatus: "waiting_for_user",
      stage: "profile_complete",
      updatedAt: new Date().toISOString()
    };
    const verifiedProfileName = stringValue(verifiedProfile.name) ?? "当前人物";
    const receiptText = `已写入‘${verifiedProfileName} · V${committedVersion}’个人资料库。本次新增 ${numberValue(commitValue.committedItemCount) ?? 0} 项经历、${numberValue(commitValue.committedFactCount) ?? 0} 条事实，读取核验通过。接下来你可以继续补充经历、生成通用简历，或暂时完成。`;
    const alignment = new AuthoritativeConversationAlignmentGuard().validate({
      text: receiptText,
      taskState: state,
      observations: [
        { toolName: reconciliation.toolName, value: reconciliation.data },
        { toolName: commit.toolName, value: commit.data },
        { toolName: "get_profile", value: verificationResult.data }
      ],
      reviewProjection: state.knownSlots.profileIntakeReviewProjection,
      persistenceReceipt: receipt
    });
    if (!alignment.aligned) {
      const stateAfterFailure = reducer.reduce(state, { type: "failed", errorCode: alignment.safeErrorCode });
      current = projectTaskStateIntoSession(current, stateAfterFailure);
      current = replaceAgentThinking(current, input.thinkingMessageId, "保存结果已保留，但完成结论尚未通过一致性核验；我不会显示未经验证的保存声明。请重新执行当前步骤。", input.turnId);
      current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      return this.finishLocalProfileIntakeTurn(current, stateAfterFailure, input, "failed");
    }
    for (const sourceTurn of sourceTurns) {
      if (sourceTurn.processingStatus !== "superseded" && sourceTurn.processingStatus !== "structured") {
        await persistence.updateProfileIntakeSourceTurn?.(
          { sessionId: sourceTurn.sessionId, messageId: sourceTurn.messageId, turnId: sourceTurn.turnId },
          { processingStatus: "structured", lastErrorCode: undefined }
        );
      }
    }
    current = projectTaskStateIntoSession(current, state);
    current = upsertAgentActivity(current, {
      id: `agent-tool-${verifyOperationId}`,
      turnId: input.turnId,
      content: "已读取个人资料库并核验写入版本。",
      toolName: "get_profile",
      operationId: verifyOperationId,
      status: "complete",
      metadata: { activityState: "complete", directBoundary: true, persistenceReceipt: receipt }
    });
    current = replaceAgentThinking(
      current,
      input.thinkingMessageId,
      receiptText,
      input.turnId
    );
    current = attachPendingDecisionOptions(current, {
      type: "profile_intake_post_save",
      options: ["save_profile_only", "generate_general_resume", "finish"]
    });
    return this.finishLocalProfileIntakeTurn(current, state, input, "waiting_for_user");
  }

  private async resolveQuickActionPrerequisites(
    input: Extract<AgentHostInput, { type: "quick_action" }>
  ): Promise<QuickActionPrerequisiteResolution | undefined> {
    try {
      const [profiles, resumes, jobs] = await Promise.all([
        this.dependencies.executor.execute({
          toolName: "list_profiles",
          toolInput: {},
          operationId: `quick-prerequisite-profiles-${crypto.randomUUID()}`
        }),
        this.dependencies.executor.execute({
          toolName: "list_resumes",
          toolInput: {},
          operationId: `quick-prerequisite-resumes-${crypto.randomUUID()}`
        }),
        this.dependencies.executor.execute({
          toolName: "list_jobs",
          toolInput: {},
          operationId: `quick-prerequisite-jobs-${crypto.randomUUID()}`
        })
      ]);
      return resolveQuickActionPrerequisites({
        actionId: input.actionId,
        workflowId: input.task.workflowId,
        profiles: readToolArray(profiles, "profiles"),
        resumes: readToolArray(resumes, "resumes"),
        jobs: readToolArray(jobs, "jobs")
      });
    } catch {
      // A precondition read must not hide the general workflow if the read tool
      // itself is unavailable. The next Host turn remains the recovery path.
      return undefined;
    }
  }

  private async resolveProfileIntakeSectionSelection(
    session: AgentSession,
    action: {
      type: "profile_intake_section_select";
      section: ProfileIntakeSection;
      sourceMessageId: string;
      optionSetRevision: number;
    }
  ) {
    const state = session.taskState;
    const source = session.messages.find((message) => message.id === action.sourceMessageId);
    const plan = objectValue(state?.knownSlots.intakeInterviewPlan);
    const suggested = Array.isArray(plan.suggestedNextSections)
      ? plan.suggestedNextSections.filter((section): section is string => typeof section === "string")
      : [];
    if (
      !state
      || state.workflowId !== "guided_profile_intake"
      || state.stage !== "collect_experience"
      || state.knownSlots.intakeRequestedSection
      || !source
      || source.role !== "assistant"
      || (source.branchId ?? session.activeBranchId) !== session.activeBranchId
      || source.optionSet?.state !== "active"
      || source.optionSet.sourceMessageId !== source.id
      || source.optionSet.optionSetRevision !== action.optionSetRevision
      || !source.options?.some((option) => option.action.type === "profile_intake_section_select" && option.action.section === action.section)
      || !suggested.includes(action.section)
    ) {
      return session;
    }
    const now = new Date().toISOString();
    const nextKnownSlots = { ...state.knownSlots };
    delete nextKnownSlots.intakeActiveQuestion;
    delete nextKnownSlots.activeQuestionId;
    const nextTaskState: AgentTaskState = {
      ...state,
      knownSlots: {
        ...nextKnownSlots,
        intakeRequestedSection: action.section
      },
      completionStatus: "waiting_for_user",
      updatedAt: now
    };
    const label = profileIntakeSectionLabel(action.section);
    let current = projectTaskStateIntoSession(session, nextTaskState);
    current = {
      ...current,
      messages: current.messages.map((message) => message.id === source.id
        ? {
            ...message,
            options: undefined,
            optionSet: {
              ...message.optionSet!,
              state: "resolved" as const,
              resolvedOptionId: `profile-intake-section-${action.section}`,
              resolvedValue: label,
              resolvedAt: now
            },
            metadata: {
              ...message.metadata,
              typedActionResolution: {
                actionType: "profile_intake_section_select",
                section: action.section,
                label: `已选择：${label}`,
                resolvedAt: now
              }
            },
            updatedAt: now
          }
        : message)
    };
    current = appendAgentMessage(current, "assistant", profileIntakeSectionPrompt(action.section), {
      kind: "text",
      type: "text",
      status: "complete",
      metadata: { deterministicBoundary: "profile_intake_section_select", requestedSection: action.section },
      parentMessageId: source.id
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, { turnStatus: "idle" });
    return saved;
  }

  clearUiAction() {
    this.patch({ uiAction: undefined });
  }

  /**
   * Claim the turn before entering the asynchronous implementation. This is
   * intentionally a non-async wrapper: the operation receipt is installed in
   * the controller before the first await or network request.
   */
  startTurn(input: AgentStartTurnInput): Promise<AgentSession | undefined> {
    const operationId = input.operationId ?? `turn-start:${input.session.id}:${crypto.randomUUID()}`;
    const operationKind = input.operationKind
      ?? (input.regenerateNarrationOnly ? "regenerate"
        : input.retryWorkflowStep ? "retry" : "user_turn");
    if (input.operationClaimed) {
      const claimed = this.executionCoordinator.getOperation(operationId);
      if (!claimed) throw new Error("turn_operation_claim_missing");
      if (claimed.cancelled) return Promise.resolve(this.snapshot.activeSession);
      const execution = this.startTurnOnce({ ...input, operationId, operationKind });
      this.attachTurnOperation(operationId, execution);
      return execution;
    }
    const claim = this.claimTurnOperation({ sessionId: input.session.id, operationId, kind: operationKind, turnId: input.turnId });
    if (!claim.accepted) {
      if (claim.existing) {
        return claim.operation.promise as Promise<AgentSession | undefined>;
      }
      if (!input.supersede) return this.enqueueUserInput(input);
      this.executionCoordinator.interrupt(input.session.id, createRunStopReason({
        requestedBy: "agent_runtime_provider",
        reasonCode: "new_turn_superseded",
        sourceComponent: "AgentHostStore.startTurn",
        sessionId: input.session.id,
        logicalTurnId: claim.operation.turnId ?? input.session.activeTurn?.id,
        runId: input.session.hermesRun?.runId,
        incidentTraceId: input.session.activeTurn?.incidentTraceId
      }));
      return claim.operation.promise.then(() => {
        if (this.snapshot.activeSessionId === input.session.id
          && (this.snapshot.turnStatus === "paused" || this.snapshot.activeSession?.workflowState?.status === "paused")) {
          return this.snapshot.activeSession;
        }
        return this.startTurn({
          ...input,
          operationId,
          operationKind
        });
      });
    }
    const execution = this.startTurnOnce({ ...input, operationId, operationKind });
    this.attachTurnOperation(operationId, execution);
    return execution;
  }

  private async startTurnOnce(input: AgentStartTurnInput) {
    if (input.session.pendingConfirmation && input.session.pendingToolCall) {
      input.session = invalidatePendingConfirmationForCorrection(input.session);
    }
    input.session = supersedeActiveOptionSets(input.session);
    const existingExecution = this.executionCoordinator.get(input.session.id);
    if (existingExecution?.promise && existingExecution.status === "running") {
      if (!input.supersede) {
        return this.enqueueUserInput(input);
      }
      input.session = this.clearQueuedInputs(input.session);
      input.session = await this.dependencies.persistence.save(input.session);
      this.patchSession(input.session);
      this.executionCoordinator.interrupt(input.session.id, createRunStopReason({
        requestedBy: "agent_runtime_provider",
        reasonCode: "new_turn_superseded",
        sourceComponent: "AgentHostStore.startTurn",
        sessionId: input.session.id,
        logicalTurnId: existingExecution.activeTurnId ?? input.session.activeTurn?.id,
        runId: input.session.hermesRun?.runId,
        incidentTraceId: input.session.activeTurn?.incidentTraceId
      }));
      await existingExecution.promise;
      const interrupted = completeTurn(input.session, "aborted");
      input.session = appendAgentMessage(interrupted, "system", "上一轮已中断；已完成的步骤会保留，并按你的新意图重新规划。", {
        kind: "system_notice",
        type: "system_notice",
        status: "complete"
      });
    }
    const now = new Date().toISOString();
    const turnId = input.turnId ?? `agent-turn-${crypto.randomUUID()}`;
    const incidentTraceId = input.runtimeDiagnostics?.incidentTraceId ?? createIncidentTraceId();
    const inheritedRuntimeSnapshot = input.runtimeDiagnostics?.runtimeFailureSnapshot;
    const previousRuntimeIncidents = [
      ...(input.runtimeDiagnostics?.previousRuntimeIncidents ?? []),
      ...(inheritedRuntimeSnapshot ? [inheritedRuntimeSnapshot] : [])
    ].slice(-16);
    const runtimeDiagnostics = { ...(input.runtimeDiagnostics ?? {}) };
    delete runtimeDiagnostics.runtimeFailureSnapshot;
    delete runtimeDiagnostics.previousRuntimeIncidents;
    const turnOperation = input.operationId ? this.executionCoordinator.getOperation(input.operationId) : undefined;
    const executionRecord = this.executionCoordinator.begin({
      sessionId: input.session.id,
      activeTurnId: turnId,
      startedAt: now,
      pendingInputCount: this.pendingInputs.get(input.session.id)?.length ?? 0,
      operationId: input.operationId,
      controller: turnOperation?.controller
    });
    const generation = executionRecord.generation;
    const controller = executionRecord.controller;
    const userMessageId = input.userMessageId ?? `agent-user-${crypto.randomUUID()}`;
    const thinkingMessageId = input.assistantMessageId ?? `agent-thinking-${crypto.randomUUID()}`;
    if (input.retryWorkflowStep && input.session.taskState?.workflowId === "guided_profile_intake" && input.sourceTurnId) {
      const sourceJournal = await this.dependencies.persistence.listProfileIntakeSourceTurns?.(input.session.id) ?? [];
      const matched = sourceJournal.find((turn) =>
        turn.turnId === input.sourceTurnId
        && turn.messageId === (input.userMessageId ?? turn.messageId)
        && turn.processingStatus !== "superseded"
      );
      if (matched) {
        await this.dependencies.persistence.updateProfileIntakeSourceTurn?.(
          { sessionId: matched.sessionId, messageId: matched.messageId, turnId: matched.turnId },
          { processingStatus: "superseded" }
        );
      }
    }
    const classifiedTurn = classifyTurnIntent({
      text: input.userMessage,
      references: input.references,
      taskState: input.session.taskState
    });
    const compositionRetryInitialInstruction = input.retryWorkflowStep
      && input.session.taskState?.workflowId === "compose_resume"
      && /(?:个人资料库|资料库).*(?:通用)?简历|(?:整理|生成|创建|组装).*(?:通用)?简历/iu.test(input.userMessage);
    const tailoringRetryInitialInstruction = input.retryWorkflowStep
      && input.session.taskState?.workflowId === "tailor_existing_resume";
    const turnDecision: TurnIntentDecision = input.typedTask
      ? {
          intent: "new_domain_task",
          confidence: "high",
          taskMutation: "replace",
          toolScope: "domain",
          newTask: {
            goal: input.typedTask.rootGoal,
            workflowId: input.typedTask.workflowId,
            stage: input.typedTask.stage
          }
        }
      : tailoringRetryInitialInstruction
        ? {
            intent: "continue_current_task",
            confidence: "high",
            taskMutation: "recover",
            toolScope: "domain"
          }
        : compositionRetryInitialInstruction
        ? {
            intent: "new_domain_task",
            confidence: "high",
            taskMutation: "continue",
            toolScope: "domain"
          }
        : classifiedTurn;
    const checkpointedSession = !input.regenerateNarrationOnly
      && (turnDecision.toolScope === "domain" || turnDecision.taskMutation !== "preserve")
      ? withTurnCheckpoint(input.session, turnId, userMessageId, now)
      : input.session;
    const reducer = new AgentTaskStateReducer();
    const initialTaskState = input.typedTask && !input.regenerateNarrationOnly
      ? reducer.reduce(input.session.taskState ?? reducer.create(input.session, undefined, {
          workflowId: turnDecision.newTask!.workflowId,
          step: turnDecision.newTask!.stage
        }), {
          type: "new_root_task",
          ...turnDecision.newTask!
        })
      : input.session.taskState;
    const canonicalShell = initialTaskState
      ? projectTaskStateIntoSession(checkpointedSession, initialTaskState)
      : checkpointedSession;
    let current = input.appendUserMessage === false
      ? {
          ...canonicalShell,
          messages: input.updateExistingUserMessage === false
            ? canonicalShell.messages
            : canonicalShell.messages.map((message) =>
                message.id === userMessageId
                  ? {
                      ...message,
                      turnId,
                      status: "complete" as const,
                      metadata: { ...message.metadata, executionState: "running" },
                      updatedAt: now
                    }
                  : message
              ),
          updatedAt: now
        }
      : appendAgentMessage(canonicalShell, "user", input.userMessage.trim(), {
          id: userMessageId,
          turnId,
          status: "complete",
          references: input.references?.length ? input.references : undefined,
          metadata: {
            executionState: "running",
            ...(input.runtimeId ? { runtimeId: input.runtimeId } : {})
          }
        });
    current = input.assistantMessageId
      ? replaceMessageWithThinking(current, input.assistantMessageId, userMessageId, turnId, now)
      : appendAgentMessage(current, "assistant", "正在准备当前步骤", {
          id: thinkingMessageId,
          turnId,
          kind: "assistant_thinking",
          type: "assistant_thinking",
          status: "thinking",
          streaming: true,
          parentMessageId: userMessageId,
          metadata: {
            sourceTurnId: input.sourceTurnId,
            regeneratedFromMessageId: input.regeneratedFromMessageId
          }
        });
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
        preferredRuntime: current.activeTurn?.preferredRuntime ?? input.runtimeDiagnostics?.preferredRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? input.runtimeDiagnostics?.attemptedRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        finalRuntime: current.activeTurn?.finalRuntime ?? input.runtimeDiagnostics?.finalRuntime ?? (input.runtimeId === "hermes" ? "hermes" : "native"),
        fallbackUsed: current.activeTurn?.fallbackUsed ?? input.runtimeDiagnostics?.fallbackUsed ?? false,
        incidentTraceId: current.activeTurn?.incidentTraceId ?? incidentTraceId,
        ...(previousRuntimeIncidents.length ? { previousRuntimeIncidents } : {}),
        ...(input.regenerationTarget ? { regenerationTarget: input.regenerationTarget } : {}),
        status: "running",
        startedAt: now,
        ...runtimeDiagnostics
      },
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {})
    };
    // Publish the local turn shell before any async preflight so the conversation
    // can show the user's message and the assistant's running state immediately.
    this.patchSession(current, {
      turnStatus: "running",
      activeTurnId: turnId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      currentObservation: undefined
    });
    // Persist the conversation shell before any async preflight (notably the
    // guided profile-intake capture). A route/task switch can unmount the
    // workspace and restore from storage while this turn is still running.
    // Without this checkpoint, the latest user message and thinking message
    // exist only in memory and cannot be restored from another task view.
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current, {
      turnStatus: "running",
      activeTurnId: turnId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      currentObservation: undefined
    });
    let kernelUserMessage = input.userMessage;
    const presentedQuestion = presentedActiveTailoringQuestion(input.session);
    let deterministicTailoringAnswer = false;
    let taskState = current.taskState;
    if (!taskState && turnDecision.newTask && turnDecision.taskMutation !== "preserve" && !input.regenerateNarrationOnly) {
      taskState = reducer.create(current, turnDecision.newTask.goal, {
        workflowId: turnDecision.newTask.workflowId,
        step: turnDecision.newTask.stage
      });
    }
    const shouldReduceProfileIntakeControl = input.session.taskState?.workflowId === "guided_profile_intake"
      && turnDecision.profileIntakeTurnKind === "interview_control";
    if (taskState && (turnDecision.taskMutation !== "preserve" || shouldReduceProfileIntakeControl) && !input.regenerateNarrationOnly) {
      if (turnDecision.taskMutation === "replace" && turnDecision.newTask) {
        taskState = reducer.reduce(taskState, {
          type: "new_root_task",
          ...turnDecision.newTask
        });
      }
      if (turnDecision.taskMutation === "continue" && turnDecision.newTask) {
        taskState = reducer.reduce(taskState, {
          type: "new_active_task",
          ...turnDecision.newTask
        });
      }
      if (turnDecision.taskMutation === "recover") {
        taskState = {
          ...taskState,
          completionStatus: "active",
          updatedAt: new Date().toISOString()
        };
      }
      const intakeRecoverySource = input.retryWorkflowStep
        ? undefined
        : findRecoverableProfileIntakeSource(
            input.session,
            taskState,
            input.userMessage,
            true
          );
      if (intakeRecoverySource && taskState.stage !== "collect_experience") {
        taskState = reducer.reduce(taskState, { type: "restart_profile_intake" });
      }
      taskState = reducer.reduce(taskState, {
        type: "user_message",
        message: intakeRecoverySource?.content ?? input.userMessage,
        sessionId: current.id,
        messageId: intakeRecoverySource?.messageId ?? userMessageId,
        turnId: intakeRecoverySource?.turnId ?? turnId,
        capturedAt: intakeRecoverySource?.capturedAt ?? now,
        turnIntent: intakeRecoverySource ? "clarification_answer" : turnDecision.intent,
        profileIntakeTurnKind: intakeRecoverySource ? "career_narrative" : turnDecision.profileIntakeTurnKind
      });
    }
    if (input.userMessage.trim() && taskState) current = projectTaskStateIntoSession(current, taskState);
    if (input.attachment) {
      if (!taskState) throw new Error("attachment_requires_workflow_task");
      taskState = reducer.reduce(taskState, {
        type: "attachment_selected",
        attachment: input.attachment
      });
    }
    if (!input.regenerateNarrationOnly && taskState?.workflowId === "guided_profile_intake") {
      const conversationBoundary = await this.resolveProfileIntakeConversationBoundary({
        current,
        taskState,
        turnId,
        userMessageId,
        thinkingMessageId,
        now,
        userMessage: input.userMessage,
        profileIntakeTurnKind: turnDecision.profileIntakeTurnKind,
        activeQuestionResolution: turnDecision.activeQuestionResolution
      });
      if (conversationBoundary) {
        this.executionCoordinator.finish(conversationBoundary.id, "completed", generation);
        this.patchSession(conversationBoundary, {
          turnStatus: "completed",
          activeTurnId: turnId,
          currentObservation: conversationBoundary.taskState?.lastObservation
        });
        return conversationBoundary;
      }
      if (["career_narrative", "follow_up_answer"].includes(turnDecision.profileIntakeTurnKind ?? "")) {
        const processingText = input.userMessage.trim().length >= 80
          ? "正在整理你刚才提到的多段经历…"
          : "正在整理你刚才的回答…";
        current = replaceAgentThinking(current, thinkingMessageId, processingText, turnId, { preserveThinking: true });
        current = await this.dependencies.persistence.save(current);
        this.patchSession(current, {
          turnStatus: "running",
          activeTurnId: turnId,
          lastProgressAt: new Date().toISOString(),
          currentObservation: { stage: "profile_intake_structuring", message: processingText }
        });
      }
    }
    const compound = presentedQuestion && taskState && !/^(?:继续|生成吧|按这些生成)$/u.test(input.userMessage.trim())
      ? resolveCompoundAnswer(input.userMessage, unresolvedTailoringQuestions(taskState))
      : { answers: [] };
    if (compound.answers.length && taskState) {
      const applied: CompoundAnswerResolution["answers"] = [];
      for (const mapping of compound.answers) {
        const unresolved = unresolvedTailoringQuestions(taskState);
        if (!unresolved.some((question) => question.id === mapping.questionId)) continue;
        const tailoringSession = taskState.knownSlots.tailoringSession;
        const operationId = `compound-answer-${turnId}-${mapping.questionId}`.slice(0, 160);
        const result = await this.dependencies.executor.execute({
          toolName: "answer_tailoring_question",
          toolInput: {
            session: tailoringSession,
            questionId: mapping.questionId,
            answer: mapping.answer,
            proficiency: mapping.proficiency
          },
          operationId,
          signal: controller.signal
        });
        if (!result.ok) break;
        taskState = reducer.reduce(taskState, {
          type: "tool_observation",
          toolName: result.toolName,
          observation: result.data,
          artifactIds: result.artifactIds
        });
        applied.push(mapping);
      }
      deterministicTailoringAnswer = applied.length > 0;
      taskState = {
        ...taskState,
        knownSlots: {
          ...taskState.knownSlots,
          compoundAnswerResolution: {
            answers: applied,
            unmatchedText: compound.unmatchedText
          }
        },
        updatedAt: new Date().toISOString()
      };
      kernelUserMessage = compound.unmatchedText
        ?? "已按顺序记录这条消息中的澄清回答，请继续当前流程。";
    }
    if (deterministicTailoringAnswer && !compound.unmatchedText && taskState) {
      current = projectTaskStateIntoSession(current, taskState);
      if (taskState.stage === "clarify_unsupported_facts") {
        current = replaceAgentThinking(current, thinkingMessageId, formatCurrentTailoringQuestion(taskState), turnId);
        current = attachTaskStateOptions(current, taskState);
      } else {
        const operationId = `generate-after-answer-${turnId}`.slice(0, 160);
        const generated = await this.dependencies.executor.execute({
          toolName: "generate_tailoring_changes",
          toolInput: { session: taskState.knownSlots.tailoringSession },
          operationId,
          signal: controller.signal
        });
        if (generated.ok) {
          taskState = reducer.reduce(taskState, {
            type: "tool_observation",
            toolName: generated.toolName,
            observation: generated.data,
            artifactIds: generated.artifactIds
          });
          current = projectTaskStateIntoSession(current, taskState);
          current = upsertAgentActivity(current, {
            id: `agent-tool-${operationId}`,
            turnId,
            content: "已生成定制修改，等待逐项核对。",
            toolName: generated.toolName,
            operationId,
            status: "complete",
            metadata: { activityState: "complete", artifactIds: generated.artifactIds }
          });
          current = replaceAgentThinking(current, thinkingMessageId, "已根据全部回答生成修改建议。请在任务产物中逐项采用、编辑或忽略。", turnId);
        } else {
          current = replaceAgentThinking(current, thinkingMessageId, generated.error?.message ?? "生成修改时遇到问题，请重试当前步骤。", turnId);
        }
      }
      current = settleUserExecutionState(current, turnId, "complete");
      current = {
        ...current,
        activeTurn: {
          ...current.activeTurn,
          id: turnId,
          sessionId: current.id,
          sourceUserMessageId: userMessageId,
          userMessageId,
          status: taskState.completionStatus === "waiting_for_user" ? "waiting_for_user" : "completed",
          startedAt: now,
          completedAt: new Date().toISOString()
        }
      };
      current = completeTurnCheckpoint(current, turnId, new Date().toISOString());
      current = await this.dependencies.persistence.save(current);
      this.executionCoordinator.finish(current.id, "completed", generation);
      this.patchSession(current, { turnStatus: "completed", activeTurnId: turnId });
      return current;
    }
    if (
      !input.regenerateNarrationOnly
      && taskState?.workflowId === "guided_profile_intake"
      && typeof this.dependencies.executor.execute === "function"
    ) {
      const boundary = await this.resolveProfileIntakeBoundary({
        current,
        taskState,
        turnId,
        userMessageId,
        thinkingMessageId,
        now,
        controller,
        userMessage: input.userMessage,
        profileIntakeTurnKind: turnDecision.profileIntakeTurnKind
      });
      if (boundary) {
        this.executionCoordinator.finish(boundary.id, boundary.taskState?.completionStatus === "failed" ? "failed" : "completed", generation);
        this.patchSession(boundary, {
          turnStatus: boundary.taskState?.completionStatus === "failed" ? "failed" : "completed",
          activeTurnId: turnId,
          currentObservation: boundary.taskState?.lastObservation
        });
        return boundary;
      }
    }
    current = {
      ...(taskState ? projectTaskStateIntoSession(current, taskState) : current),
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        status: "running",
        startedAt: now
      }
    };
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current, {
      turnStatus: "running",
      activeTurnId: turnId,
      startedAt: now,
      lastProgressAt: now,
      stalled: false,
      streamEvents: [],
      currentObservation: undefined
    });
    const execution = this.consume({
      generation,
      controller,
      current,
      thinkingMessageId,
      turnId,
      pageContext: input.pageContext,
      userMessage: kernelUserMessage,
      references: input.references,
      turnDecision,
      narrationOnly: input.regenerateNarrationOnly
    });
    const trackedExecution = execution.finally(() => {
      this.executionCoordinator.finish(current.id, undefined, generation);
      if (this.snapshot.activeSessionId === current.id) {
        this.patch({ controllerState: this.executionCoordinator.getState(current.id) });
      }
    });
    this.executionCoordinator.attachPromise(current.id, trackedExecution);
    return trackedExecution;
  }

  async resolveConfirmation(confirmed: boolean, pageContext: AgentPageContext, requestedSession?: AgentSession) {
    const session = requestedSession && this.snapshot.activeSession?.id === requestedSession.id
      ? this.snapshot.activeSession
      : requestedSession ?? this.snapshot.activeSession;
    const operationId = session?.pendingConfirmation?.operationId;
    if (!operationId || !session) return session;
    const executionKey = `${session.id}:${operationId}`;
    const running = this.confirmationExecutions.get(executionKey);
    if (running) return running;
    const execution = this.resolveConfirmationOnce(confirmed, pageContext, session)
      .finally(() => this.confirmationExecutions.delete(executionKey));
    this.confirmationExecutions.set(executionKey, execution);
    return execution;
  }

  private async resolveConfirmationOnce(confirmed: boolean, pageContext: AgentPageContext, requestedSession: AgentSession) {
    const session = this.snapshot.activeSession?.id === requestedSession.id
      ? this.snapshot.activeSession
      : requestedSession;
    const confirmation = session?.pendingConfirmation;
    const call = session?.pendingToolCall;
    if (!session || !confirmation || !call) return session;
    this.markProgress(session.id);
    const turnId = call.turnId ?? confirmation.turnId ?? session.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
    let current: AgentSession = {
      ...markConfirmationResolution(session, confirmed ? "confirmed" : "rejected"),
      pendingConfirmation: undefined,
      pendingToolCall: undefined
    };
    current = settleWorkflowInteractionMessages(current);
    this.patchSession(current, { turnStatus: "running" });
    if (!confirmed) {
      current = {
        ...current,
        taskState: current.taskState
          ? new AgentTaskStateReducer().reduce(current.taskState, {
              type: "confirmation_rejected",
              toolName: call.toolName
            })
          : current.taskState
      };
      if (current.taskState) current = projectTaskStateIntoSession(current, current.taskState);
      current = await this.dependencies.persistence.save(current);
      return this.resume(current, {
        reason: "confirmation_rejected",
        toolName: call.toolName,
        observation: { rejected: true, changed: false }
      }, pageContext, turnId);
    }

    this.patch({ turnStatus: "running" });
    if (
      confirmation.dependencyExpectation
      && current.taskState
      && !dependencyExpectationMatches(
        confirmation.dependencyExpectation,
        current.taskState.selectedEntities
      )
    ) {
      const invalidated = new AgentTaskStateReducer().reduce(
        current.taskState,
        { type: "dependencies_invalidated" }
      );
      current = projectTaskStateIntoSession(
        appendAgentMessage(current, "system", "上游资料或版本已变化，这次确认已失效。请重新规划后再应用。", {
          kind: "system_notice",
          type: "system_notice",
          status: "complete"
        }),
        invalidated
      );
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, { turnStatus: "idle" });
      return current;
    }
    const dependencyChanges = await this.readDependencyChanges(
      confirmation.operationId,
      confirmation.dependencyExpectation
    );
    if (dependencyChanges.length && current.taskState) {
      const reducer = new AgentTaskStateReducer();
      let taskState = current.taskState;
      for (const change of dependencyChanges) {
        taskState = reducer.reduce(taskState, change);
      }
      taskState = reducer.reduce(taskState, { type: "dependencies_invalidated" });
      current = projectTaskStateIntoSession(
        appendAgentMessage(current, "system", "上游资料或版本已变化，这次确认已失效。请重新分析并生成预览。", {
          kind: "system_notice",
          type: "system_notice",
          status: "complete"
        }),
        taskState
      );
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, { turnStatus: "idle" });
      return current;
    }
    if (current.taskState) {
      const taskState = new AgentTaskStateReducer().reduce(current.taskState, {
          type: "confirmation_accepted",
          toolName: call.toolName
        });
      current = projectTaskStateIntoSession(current, taskState);
    }
    const careerSessionBinding = current.personId && current.activeProfileId
      && current.profileVersionNumber !== undefined && current.profileRevision !== undefined
      ? {
          agentSessionId: current.id,
          personId: current.personId,
          profileId: current.activeProfileId,
          profileVersionNumber: current.profileVersionNumber,
          profileRevision: current.profileRevision
        }
      : undefined;
    if (call.toolName === "apply_tailoring_changes" && current.taskState) {
      const applyInput = objectRecordValue(confirmation.validatedInput ?? call.input);
      const applySession = objectRecordValue(applyInput.session);
      const applyBranch = objectRecordValue(applySession.branch);
      const applyJob = objectRecordValue(applySession.job);
      const profileId = stringRecordValue(applyBranch.profileId)
        ?? current.taskState.selectedEntities.profileId
        ?? current.activeProfileId;
      const profile = profileId && this.hasExplicitCareerRepository()
        ? await this.getCareerRepository().getProfile(profileId)
        : undefined;
      const expectedProfileRevision = profile?.version
        ?? current.profileRevision
        ?? numberValue(current.taskState.selectedEntities.profileVersion)
        ?? 0;
      const now = new Date().toISOString();
      const acceptedDiffIds = Array.isArray(current.taskState.knownSlots.acceptedDiffIds)
        ? current.taskState.knownSlots.acceptedDiffIds.filter((value): value is string => typeof value === "string")
        : Array.isArray(current.taskState.knownSlots.selectedDiffIds)
          ? current.taskState.knownSlots.selectedDiffIds.filter((value): value is string => typeof value === "string")
          : [];
      const checkpoint: ResumeArtifactWriteCheckpoint = {
        schemaVersion: 1,
        operationId: call.operationId,
        checkpointId: resumeArtifactWriteCheckpointId(call.operationId),
        workflowId: current.taskState.workflowId,
        profileId: profileId ?? current.taskState.selectedEntities.profileId ?? "unknown-profile",
        expectedProfileRevision,
        sourceResumeId: stringRecordValue(applyBranch.id) ?? current.taskState.selectedEntities.resumeId ?? "unknown-resume",
        sourceResumeRevisionId: stringRecordValue(applyBranch.currentRevisionId) ?? current.taskState.selectedEntities.resumeRevisionId,
        jobId: stringRecordValue(applyJob.id) ?? current.taskState.selectedEntities.jobId ?? "unknown-job",
        ...(stringRecordValue(objectRecordValue(applySession.targetSnapshot).sourceType) ? { targetSourceType: stringRecordValue(objectRecordValue(applySession.targetSnapshot).sourceType) } : {}),
        ...(stringRecordValue(objectRecordValue(applySession.targetSnapshot).id) ? { targetSnapshotId: stringRecordValue(objectRecordValue(applySession.targetSnapshot).id) } : {}),
        ...(numberValue(objectRecordValue(applySession.targetSnapshot).version) !== undefined ? { targetSnapshotVersion: numberValue(objectRecordValue(applySession.targetSnapshot).version) } : {}),
        ...(stringRecordValue(objectRecordValue(applySession.targetSnapshot).rawTextHash) ? { targetSnapshotHash: stringRecordValue(objectRecordValue(applySession.targetSnapshot).rawTextHash) } : {}),
        ...(stringRecordValue(objectRecordValue(applySession.targetSnapshot).sourceJobId) ? { savedJobId: stringRecordValue(objectRecordValue(applySession.targetSnapshot).sourceJobId) } : {}),
        ...(current.taskState.knownSlots.jobPersistenceDecision === "ask" || current.taskState.knownSlots.jobPersistenceDecision === "save" || current.taskState.knownSlots.jobPersistenceDecision === "session_only"
          ? { jobPersistenceDecision: current.taskState.knownSlots.jobPersistenceDecision }
          : {}),
        workflowFacade: "career.workflow.tailor_resume",
        acceptedDiffIds,
        changedFieldPaths: [],
        status: "write_pending",
        createdAt: now,
        updatedAt: now
      };
      current = {
        ...current,
        taskState: {
          ...current.taskState,
          knownSlots: {
            ...current.taskState.knownSlots,
            artifactWriteCheckpoint: checkpoint
          },
          updatedAt: now
        }
      };
      current = updateArtifactWriteDiagnostics(current, {
        operationId: call.operationId,
        checkpointId: checkpoint.checkpointId,
        status: checkpoint.status,
        sourceResumeId: checkpoint.sourceResumeId,
        acceptedDiffCount: acceptedDiffIds.length,
        changedFieldPaths: [],
        repositoryReadBackVerified: false,
        resumeListVisibilityVerified: false
      });
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, { currentObservation: { type: "artifact_write_pending", operationId: call.operationId } });
    }
    const result = await this.dependencies.executor.execute({
      toolName: call.toolName,
      toolInput: confirmation.validatedInput ?? call.input,
      operationId: call.operationId,
      confirmed: true,
      ...(careerSessionBinding ? { careerSessionBinding, requireSessionBinding: true } : {})
    });
    if (result.ok && typeof this.dependencies.kernel?.invalidateObservationsAfter === "function") {
      this.dependencies.kernel.invalidateObservationsAfter(call.toolName);
    }
    current = upsertAgentActivity(current, {
      id: `agent-tool-${call.operationId}`,
      turnId,
      content: result.ok ? "已按你的确认完成这一步。" : "这一步未能完成，现有任务信息已保留。",
      toolName: call.toolName,
      operationId: call.operationId,
      status: result.ok ? "complete" : "failed",
      metadata: {
        activityState: result.ok ? "complete" : "failed",
        artifactIds: result.artifactIds,
        diagnostic: confirmedToolDiagnostic(call.toolName, result)
      }
    });
    if (call.toolName === "apply_tailoring_changes") {
      const reducer = new AgentTaskStateReducer();
      const hasDurableProof = result.ok && isAuthoritativeTailoringApplyResult(result.data);
      const failureCode = result.ok
        ? "artifact_commit_visibility_verification_failed"
        : result.error?.code ?? "tailoring_apply_verification_failed";
      if (hasDurableProof) {
        current = projectTaskStateIntoSession(current, reducer.reduce(current.taskState!, {
          type: "tool_observation",
          toolName: result.toolName,
          observation: result.data,
          artifactIds: result.artifactIds
        }));
        current = attachConfirmedToolArtifact(current, call.toolName, call.operationId, result);
      } else {
        current = projectTaskStateIntoSession(current, reducer.reduce(current.taskState!, {
          type: "tool_failure",
          toolName: call.toolName,
          operationId: call.operationId,
          errorCode: failureCode,
          message: result.ok
            ? "岗位简历写入结果未通过回读校验。"
            : result.error?.message,
          recoverable: result.ok ? true : result.error?.retryable !== false
        }));
      }
      const receipt = result.ok
        ? ResumeArtifactReceiptSchema.safeParse(
            objectRecordValue(result.data).artifactReceipt
              ?? objectRecordValue(objectRecordValue(result.data).qualityResult).artifactReceipt
          )
        : undefined;
      if (hasDurableProof && receipt?.success && current.taskState) {
        const checkpoint = artifactWriteCheckpointFromSession(current);
        current = {
          ...current,
          taskState: {
            ...current.taskState,
            knownSlots: {
              ...current.taskState.knownSlots,
              ...(checkpoint ? {
                artifactWriteCheckpoint: {
                  ...checkpoint,
                  status: "write_completed" as const,
                  resultResumeId: receipt.data.resultResumeId,
                  resultResumeRevisionId: receipt.data.resultResumeRevisionId,
                  changedFieldPaths: receipt.data.changedFieldPaths,
                  updatedAt: receipt.data.completedAt
                }
              } : {})
            }
          }
        };
        current = updateArtifactWriteDiagnostics(current, {
          operationId: receipt.data.operationId,
          checkpointId: checkpoint?.checkpointId,
          status: "write_completed",
          sourceResumeId: receipt.data.sourceResumeId,
          resultResumeId: receipt.data.resultResumeId,
          resultResumeRevisionId: receipt.data.resultResumeRevisionId,
          resultRevisionId: receipt.data.resultResumeRevisionId,
          acceptedDiffCount: receipt.data.acceptedDiffCount,
          changedFieldPaths: receipt.data.changedFieldPaths,
          repositoryReadBackVerified: true,
          resumeListVisibilityVerified: true
        });
      } else if (current.taskState) {
        current = updateArtifactWriteDiagnostics(current, {
          operationId: call.operationId,
          checkpointId: artifactWriteCheckpointFromSession(current)?.checkpointId,
          status: "visibility_verification_failed",
          sourceResumeId: artifactWriteCheckpointFromSession(current)?.sourceResumeId,
          safeErrorCode: failureCode,
          acceptedDiffCount: numberValue(current.taskState.knownSlots.acceptedDiffCount),
          changedFieldPaths: [],
          repositoryReadBackVerified: false,
          resumeListVisibilityVerified: false
        });
      }
      const failed = Boolean(current.taskState?.knownSlots.tailoringApplyFailure)
        || !hasDurableProof;
      if (failed && current.taskState) {
        const checkpoint = artifactWriteCheckpointFromSession(current);
        current = {
          ...current,
          taskState: {
            ...current.taskState,
            knownSlots: {
              ...current.taskState.knownSlots,
              ...(checkpoint ? {
                artifactWriteCheckpoint: {
                  ...checkpoint,
                  status: result.ok ? "visibility_verification_failed" : "write_failed",
                  safeErrorCode: failureCode,
                  updatedAt: new Date().toISOString()
                }
              } : {})
            }
          }
        };
      }
      const assistantText = failed
        ? TAILORING_APPLY_FAILURE_MESSAGE
        : `已生成岗位定制简历，并应用了 ${numberValue(objectValue(objectValue(result.data).qualityResult).acceptedDiffCount) ?? current.taskState?.knownSlots.acceptedDiffCount ?? 0} 项已确认修改。`;
      current = projectDeterministicAssistantMessage(current, turnId, assistantText, `agent-confirmation-${call.operationId}`);
      const assistantId = current.messages.findLast((message) => message.role === "assistant" && message.turnId === turnId)?.id;
      if (failed) {
        current = withRetryCurrentStepOption(current, assistantId);
        current = {
          ...current,
          activeTurn: current.activeTurn
            ? { ...current.activeTurn, status: "waiting_for_user", completedAt: new Date().toISOString(), visibleAssistantMessageId: assistantId }
            : current.activeTurn,
          workflowState: current.taskState && current.workflowState
            ? projectTaskStateToWorkflowState(current.taskState, { ...current.workflowState, status: "waiting_for_user" })
            : current.workflowState
        };
        const saved = await this.dependencies.persistence.save(current);
        this.patchSession(saved, { turnStatus: "waiting_for_user", activeTurnId: turnId, currentObservation: current.taskState?.knownSlots.tailoringApplyFailure });
        return saved;
      }
      if (receipt?.success) current = withOpenArtifactOption(current, assistantId, receipt.data.resultResumeId);
      current = {
        ...current,
        activeTurn: current.activeTurn
          ? { ...current.activeTurn, status: "completed", completedAt: new Date().toISOString(), visibleAssistantMessageId: assistantId }
          : current.activeTurn,
        workflowState: current.taskState && current.workflowState
          ? projectTaskStateToWorkflowState(current.taskState, { ...current.workflowState, status: "completed" })
          : current.workflowState
      };
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, { turnStatus: "completed", activeTurnId: turnId, currentObservation: current.taskState?.knownSlots.qualityResult });
      return saved;
    }
    if (result.ok) {
      if (call.toolName.startsWith("career.workflow.")) {
        current = applyRuntimeFacadeCheckpoint(current, call.toolName, result.data);
        current = attachConfirmedToolArtifact(
          current,
          runtimeArtifactSourceToolName(call.toolName),
          call.operationId,
          {
            ...result,
            data: runtimeArtifactResultData(call.toolName, result.data)
          }
        );
      } else {
        current = attachConfirmedToolArtifact(current, call.toolName, call.operationId, result);
      }
    }
    if (!result.ok && current.taskState) {
      current = projectTaskStateIntoSession(current, {
        ...current.taskState,
        completionStatus: "failed",
        updatedAt: new Date().toISOString()
      });
    }
    const workflowResult = result.ok && call.toolName.startsWith("career.workflow.")
      ? objectValue(result.data)
      : undefined;
    if (workflowResult?.status === "completed") {
      const completedAt = new Date().toISOString();
      current = appendAgentMessage(current, "assistant", "已按你的确认完成当前 Career 工作流。结果已保存，可继续查看预览或下一步。", {
        kind: "text",
        type: "text",
        status: "complete",
        turnId,
        metadata: { runtimeId: "hermes", workflowConfirmationCompleted: true }
      });
      current = {
        ...current,
        activeTurn: current.activeTurn
          ? { ...current.activeTurn, status: "completed", completedAt }
          : current.activeTurn,
        workflowState: current.taskState && current.workflowState
          ? projectTaskStateToWorkflowState(current.taskState, { ...current.workflowState, status: "completed" })
          : current.workflowState
      };
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, { turnStatus: "completed", activeTurnId: turnId, currentObservation: workflowResult });
      return saved;
    }
    current = await this.dependencies.persistence.save(current);
    return this.resume(current, {
      reason: "tool_observation",
      toolName: call.toolName,
      observation: result.ok ? result.data : { error: result.error }
    }, pageContext, turnId);
  }

  private async readDependencyChanges(
    operationId: string,
    expectation?: Record<string, unknown>
  ) {
    if (!expectation) return [];
    const changes: Array<{
      type: "entity_revision";
      entityType: "profile" | "resume" | "job";
      entityId: string;
      revisionId?: string;
      version?: string | number;
      hash?: string;
    }> = [];
    const profileId = stringRecordValue(expectation.profileId);
    if (profileId && expectation.profileVersion !== undefined) {
      const result = await this.dependencies.executor.execute({
        toolName: "get_profile",
        toolInput: { profileId },
        operationId: dependencyCheckOperationId(operationId, "profile")
      });
      const profile = objectRecordValue(objectRecordValue(result.data).profile);
      const version = scalarRecordValue(profile.version);
      if (!result.ok || version !== expectation.profileVersion) {
        changes.push({ type: "entity_revision", entityType: "profile", entityId: profileId, version });
      }
    }
    const resumeId = stringRecordValue(expectation.resumeId);
    if (
      resumeId
      && (expectation.resumeRevisionId !== undefined || expectation.resumeHash !== undefined)
    ) {
      const result = await this.dependencies.executor.execute({
        toolName: "get_resume",
        toolInput: { resumeId },
        operationId: dependencyCheckOperationId(operationId, "resume")
      });
      const value = objectRecordValue(result.data);
      const resume = objectRecordValue(value.resume);
      const revisionId = stringRecordValue(resume.currentRevisionId ?? value.resumeRevisionId);
      const hash = stringRecordValue(value.resumeHash ?? resume.resumeHash);
      if (
        !result.ok
        || expectation.resumeRevisionId !== undefined && revisionId !== expectation.resumeRevisionId
        || expectation.resumeHash !== undefined && hash !== expectation.resumeHash
      ) {
        changes.push({
          type: "entity_revision",
          entityType: "resume",
          entityId: resumeId,
          revisionId,
          hash
        });
      }
    }
    const jobId = stringRecordValue(expectation.jobId);
    if (
      jobId
      && (expectation.jobRevision !== undefined || expectation.jobGraphHash !== undefined)
    ) {
      const result = await this.dependencies.executor.execute({
        toolName: "get_job",
        toolInput: { jobId },
        operationId: dependencyCheckOperationId(operationId, "job")
      });
      const value = objectRecordValue(result.data);
      const job = objectRecordValue(value.job);
      const version = scalarRecordValue(value.jobRevision ?? job.updatedAt);
      const hash = stringRecordValue(value.jobGraphHash ?? job.jobGraphHash);
      if (
        !result.ok
        || expectation.jobRevision !== undefined && version !== expectation.jobRevision
        || expectation.jobGraphHash !== undefined && hash !== expectation.jobGraphHash
      ) {
        changes.push({
          type: "entity_revision",
          entityType: "job",
          entityId: jobId,
          version,
          hash
        });
      }
    }
    return changes;
  }

  private async resolveTaskDecision(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "task_decision" }>,
    pageContext: AgentPageContext
  ) {
    const prepared = await this.applyTaskDecision(session, action);
    if (!prepared.applied) return prepared.session;
    if (action.decisionType === "job_target_persistence" && prepared.session.pendingConfirmation) {
      return prepared.session;
    }
    return this.resume(prepared.session, {
      reason: "external_event",
      observation: {
        type: "task_decision",
        decisionType: action.decisionType,
        option: action.option
      }
    }, pageContext, prepared.turnId);
  }

  private async applyTaskDecision(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "task_decision" }>,
    options: { userMessage?: string } = {}
  ): Promise<{ session: AgentSession; turnId: string; applied: boolean }> {
    if (
      session.taskState?.pendingDecision?.type !== action.decisionType
      || !session.taskState.pendingDecision.options.includes(action.option)
    ) {
      return { session, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
    }
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const decisionLabels: Record<typeof action.option, string> = {
      profile: "使用个人资料库生成岗位简历",
      existing_resume: "使用现有简历（路线 B）",
      session_only: "仅用于本次定制",
      save_job: "保存到岗位列表",
      switch_to_active: "写入当前活动资料库",
      keep_original: "继续写入原资料库",
      save_profile_only: action.decisionType === "profile_intake_post_save" ? "继续补充经历" : "仅保存资料库",
      generate_general_resume: "生成一份通用简历",
      finish: "暂时完成"
    };
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(session.taskState, {
      type: "decision_selected",
      decisionType: action.decisionType,
      option: action.option
    });
    const now = new Date().toISOString();
    let current = withTurnCheckpoint(session, turnId, userMessageId, now);
    if (options.userMessage) {
      current = appendAgentMessage(current, "user", options.userMessage, {
        id: userMessageId,
        turnId,
        status: "complete",
        metadata: {
          executionOwner: "deterministic_transition",
          checkpointDecisionType: action.decisionType,
          checkpointDecisionOption: action.option,
          executionState: "running"
        }
      });
    }
    current = markTypedTaskDecisionResolution(current, {
      turnId,
      decisionType: action.decisionType,
      decisionOption: action.option,
      label: decisionLabels[action.option]
    });
    current = projectTaskStateIntoSession(current, taskState);
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        executionOwner: "deterministic_transition",
        status: "running",
        startedAt: now
      }
    };
    if (action.decisionType === "job_target_persistence") {
      if (action.option === "save_job") {
        current = await this.persistExternalTargetJob(current, turnId);
      }
      if (current.taskState?.knownSlots.jobPersistenceDecision === "session_only"
        || current.taskState?.knownSlots.jobPersistenceDecision === "save"
          && Boolean(current.taskState.knownSlots.savedJobId)) {
        current = this.prepareExternalTargetApplyConfirmation(current, turnId);
      }
    }
    if (current.taskState) current = attachTaskStateOptions(current, current.taskState);
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current);
    return { session: current, turnId, applied: true };
  }

  private async persistExternalTargetJob(session: AgentSession, turnId: string) {
    const state = session.taskState;
    if (!state) return session;
    const tailoringSession = objectValue(state.knownSlots.tailoringSession);
    const snapshotValue = objectValue(state.knownSlots.targetSnapshot ?? tailoringSession.targetSnapshot);
    if (!Object.keys(snapshotValue).length) return session;
    const snapshot = JobTargetSnapshotSchema.parse(snapshotValue);
    if (snapshot.sourceJobId) {
      const targetHash = jobTargetSnapshotHash(snapshot);
      const alreadySavedState = {
        ...state,
        selectedEntities: {
          ...state.selectedEntities,
          jobId: snapshot.sourceJobId,
          savedJobId: snapshot.sourceJobId,
          targetSnapshotId: snapshot.id,
          targetSnapshotVersion: snapshot.version,
          targetSnapshotHash: targetHash
        },
        knownSlots: {
          ...state.knownSlots,
          savedJobId: snapshot.sourceJobId,
          targetSnapshot: snapshot,
          targetSourceType: snapshot.sourceType,
          targetSnapshotId: snapshot.id,
          targetSnapshotVersion: snapshot.version,
          targetSnapshotHash: targetHash,
          jobPersistenceDecision: "save"
        },
        updatedAt: new Date().toISOString()
      };
      return projectTaskStateIntoSession(session, alreadySavedState);
    }
    if (!snapshot.requirementGraph) throw new Error("job_target_snapshot_graph_missing");
    const operationId = `job-target-save-${snapshot.id}-${snapshot.version}`.slice(0, 160);
    const result = await this.dependencies.executor.execute({
      toolName: "commit_job",
      toolInput: {
        title: snapshot.title ?? "未命名岗位",
        company: snapshot.company ?? "未填写公司",
        rawText: snapshot.rawText,
        graph: snapshot.requirementGraph
      },
      operationId,
      confirmed: true,
      confirmationCount: 1
    });
    if (!result.ok) {
      const failedState = new AgentTaskStateReducer().reduce(state, {
        type: "tool_failure",
        toolName: "commit_job",
        operationId,
        errorCode: result.error?.code ?? "job_target_save_failed",
        message: result.error?.message,
        recoverable: result.error?.retryable !== false
      });
      return projectTaskStateIntoSession(
        appendAgentMessage(session, "assistant", result.error?.message ?? "岗位保存没有完成，当前定制进度已保留。", {
          id: `job-target-save-failed-${operationId}`,
          kind: "error_status",
          type: "error",
          status: "failed",
          metadata: { jobTargetPersistence: "save", operationId, safeErrorCode: result.error?.code ?? "job_target_save_failed" }
        }),
        failedState
      );
    }
    const value = objectRecordValue(result.data);
    const committedJob = objectRecordValue(value.jobDescription ?? value.job);
    const savedJobId = stringRecordValue(value.jobId ?? committedJob.id);
    if (!savedJobId) throw new Error("job_target_save_receipt_missing_job_id");
    const savedJobRevision = scalarRecordValue(value.jobRevision ?? committedJob.updatedAt) ?? snapshot.sourceJobRevision;
    const persistedSnapshot = JobTargetSnapshotSchema.parse({
      ...snapshot,
      sourceJobId: savedJobId,
      ...(savedJobRevision !== undefined ? { sourceJobRevision: savedJobRevision } : {})
    });
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.reduce(state, {
      type: "tool_observation",
      toolName: "commit_job",
      observation: result.data,
      artifactIds: result.artifactIds
    });
    const nextTailoringSession = {
      ...tailoringSession,
      targetSnapshot: persistedSnapshot,
      ...(Object.keys(committedJob).length ? { job: committedJob } : {})
    };
    taskState = {
      ...taskState,
      selectedEntities: {
        ...taskState.selectedEntities,
        jobId: savedJobId,
        savedJobId,
        ...(savedJobRevision !== undefined ? { jobRevision: savedJobRevision } : {}),
        targetSnapshotId: persistedSnapshot.id,
        targetSnapshotVersion: persistedSnapshot.version,
        targetSnapshotHash: jobTargetSnapshotHash(persistedSnapshot)
      },
      knownSlots: {
        ...taskState.knownSlots,
        targetSnapshot: persistedSnapshot,
        targetSourceType: persistedSnapshot.sourceType,
        targetSnapshotId: persistedSnapshot.id,
        targetSnapshotVersion: persistedSnapshot.version,
        targetSnapshotHash: jobTargetSnapshotHash(persistedSnapshot),
        savedJobId,
        jobPersistenceDecision: "save",
        tailoringSession: nextTailoringSession
      },
      updatedAt: new Date().toISOString()
    };
    let current = projectTaskStateIntoSession(session, taskState);
    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId,
      content: "已保存岗位目标，并关联到本次定制。",
      toolName: "commit_job",
      operationId,
      status: "complete",
      metadata: {
        activityState: "complete",
        targetSourceType: persistedSnapshot.sourceType,
        targetSnapshotId: persistedSnapshot.id,
        savedJobId
      }
    });
    return current;
  }

  private prepareExternalTargetApplyConfirmation(session: AgentSession, turnId: string) {
    const state = session.taskState;
    if (!state) return session;
    const pending = objectValue(state.knownSlots.pendingTargetApplyInput);
    let applyInputSource = pending;
    if (!Object.keys(applyInputSource).length) {
      // Older persisted sessions can reach this checkpoint after the
      // transient pending input was dropped. The reviewed result is still
      // durable in the task state, so rebuild only this deterministic apply
      // payload instead of opening an unscoped Hermes turn.
      if (
        !isTailoringWorkflowId(state.workflowId)
        || normalizeTailoringStage(state.stage) !== "confirm_apply"
      ) return session;
      const tailoringSession = objectValue(state.knownSlots.tailoringSession);
      const selectedDiffs = Array.isArray(state.knownSlots.selectedDiffs)
        ? state.knownSlots.selectedDiffs
        : [];
      if (!Object.keys(tailoringSession).length || !selectedDiffs.length) return session;
      const confirmedRequirementIds = Array.isArray(state.knownSlots.confirmedRequirementIds)
        ? state.knownSlots.confirmedRequirementIds.filter((value): value is string => typeof value === "string")
        : [];
      applyInputSource = { selectedDiffs, confirmedRequirementIds };
    }
    const operationId = stringValue(state.knownSlots.pendingTargetApplyOperationId)
      ?? `tailoring-apply-${turnId}`.slice(0, 160);
    const applyInput = {
      ...applyInputSource,
      session: state.knownSlots.tailoringSession
    };
    const reducer = new AgentTaskStateReducer();
    let nextState = reducer.reduce(state, {
      type: "confirmation_requested",
      toolName: "apply_tailoring_changes",
      operationId
    });
    nextState = {
      ...nextState,
      knownSlots: {
        ...nextState.knownSlots,
        pendingTargetApplyInput: undefined,
        pendingTargetApplyOperationId: undefined
      },
      updatedAt: new Date().toISOString()
    };
    let current = projectTaskStateIntoSession(session, nextState);
    const requestedAt = new Date().toISOString();
    current = {
      ...current,
      pendingConfirmation: {
        id: `confirmation-${operationId}`,
        turnId,
        operationId,
        toolName: "apply_tailoring_changes",
        title: "应用这些简历修改？",
        description: "确认后会生成岗位定制简历；只应用已采用的修改，来源简历和个人资料库不会被覆盖。",
        destructive: false,
        validatedInput: applyInput,
        dependencyExpectation: dependencySnapshot(nextState),
        status: "pending",
        requestedAt
      },
      pendingToolCall: {
        turnId,
        toolName: "apply_tailoring_changes",
        operationId,
        input: applyInput
      },
      activeTurn: current.activeTurn
        ? { ...current.activeTurn, id: turnId, status: "waiting_for_confirmation", completedAt: undefined }
        : current.activeTurn
    };
    return current;
  }

  private async applyRuntimeAnswer(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "answer" }>
  ): Promise<{ session: AgentSession; turnId: string; applied: boolean; deterministicTerminal?: boolean }> {
    if (action.field === "profile-intake-section") {
      return { session, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
    }
    if (action.field.startsWith("tailoring-question:")) {
      const questionId = action.field.slice("tailoring-question:".length);
      const projection = getActiveTailoringQuestionProjection(session);
      if (
        !projection
        || projection.questionId !== questionId
        || presentedActiveTailoringQuestion(session) !== questionId
        || !workflowInteractionActionMatches(projection, action)
      ) {
        return { session, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
      }
      const answerValue = action.value;
      const valid = projection.options.some((option) =>
        option.action.type === "answer" && option.action.value === answerValue
      );
      if (!valid) return { session, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
      const consumed = await this.consumeWorkflowInteraction(session, projection, answerValue as string, {
        optionField: action.field,
        optionValue: answerValue
      });
      return {
        session: consumed.session,
        turnId: consumed.turnId,
        applied: consumed.applied,
        deterministicTerminal: consumed.applied
      };
    }
    const answerValue = action.value;
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const text = String(answerValue ?? "").slice(0, 8_000);
    let current = withTurnCheckpoint(supersedeActiveOptionSets(session), turnId, userMessageId, now);
    current = appendAgentMessage(current, "user", text, {
      id: userMessageId,
      turnId,
      status: "complete",
      metadata: {
        executionOwner: "deterministic_transition",
        optionField: action.field,
        optionValue: answerValue
      }
    });
    if (current.taskState) {
      const taskState = new AgentTaskStateReducer().reduce(current.taskState, {
        type: "user_message",
        message: text,
        sessionId: current.id,
        messageId: userMessageId,
        turnId,
        capturedAt: now,
        turnIntent: "continue_current_task"
      });
      current = projectTaskStateIntoSession(current, taskState);
    }
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        executionOwner: "deterministic_transition",
        status: "running",
        startedAt: now,
        completedAt: undefined
      }
    };
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved);
    return { session: saved, turnId, applied: true };
  }

  private async applyTailoringTextAnswer(
    session: AgentSession,
    value: string,
    projection: TailoringQuestionProjection
  ): Promise<PreparedRuntimeUserEvent> {
    const text = value.trim().slice(0, 8_000);
    const consumed = await this.consumeWorkflowInteraction(session, projection, text, {});
    const answerWasCommitted = consumed.applied || consumed.session.messages.some((message) =>
      message.id === consumed.userMessageId
      && message.role === "user"
      && message.metadata?.answerPayload === true
    );
    if (!answerWasCommitted) {
      throw Object.assign(new Error("tailoring_answer_not_committed"), { code: "tailoring_answer_not_committed" });
    }
    return {
      session: consumed.session,
      event: { type: "text_message", text },
      turnId: consumed.turnId,
      userMessage: "",
      executionOwner: "deterministic_transition",
      deterministicTransitionApplied: answerWasCommitted,
      deterministicTerminal: answerWasCommitted,
      prePersistedUserMessageId: consumed.userMessageId,
      tailoringAnswerBinding: undefined
    };
  }

  private async consumeWorkflowInteraction(
    session: AgentSession,
    projection: TailoringQuestionProjection,
    answer: string,
    options: { optionField?: string; optionValue?: unknown }
  ) {
    const executionKey = `${session.id}:${projection.interactionId}:${projection.interactionRevision}`;
    const running = this.workflowInteractionExecutions.get(executionKey);
    if (running) {
      const settled = await running;
      return {
        session: settled.session,
        turnId: settled.turnId,
        userMessageId: settled.userMessageId,
        applied: false
      };
    }
    const execution = this.consumeWorkflowInteractionOnce(session, projection, answer, options)
      .finally(() => this.workflowInteractionExecutions.delete(executionKey));
    this.workflowInteractionExecutions.set(executionKey, execution);
    return execution;
  }

  private async consumeWorkflowInteractionOnce(
    requestedSession: AgentSession,
    projection: TailoringQuestionProjection,
    answer: string,
    options: { optionField?: string; optionValue?: unknown }
  ) {
    const liveSession = this.snapshot.activeSession?.id === requestedSession.id
      ? this.snapshot.activeSession
      : requestedSession;
    const persistedSession = typeof this.dependencies.persistence.get === "function"
      ? await this.dependencies.persistence.get(requestedSession.id)
      : undefined;
    const authoritative = persistedSession
      && (
        persistedSession.sessionRevision > liveSession.sessionRevision
        || (
          persistedSession.sessionRevision === liveSession.sessionRevision
          && persistedSession.updatedAt > liveSession.updatedAt
        )
      )
      ? persistedSession
      : liveSession;
    const activeProjection = getActiveTailoringQuestionProjection(authoritative);
    if (
      !activeProjection
      || activeProjection.interactionId !== projection.interactionId
      || activeProjection.checkpointId !== projection.checkpointId
      || activeProjection.interactionRevision !== projection.interactionRevision
      || activeProjection.questionId !== projection.questionId
      || presentedActiveTailoringQuestion(authoritative) !== projection.questionId
    ) {
      return {
        session: authoritative,
        turnId: authoritative.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`,
        userMessageId: authoritative.activeTurn?.userMessageId,
        applied: false
      };
    }
    let resolvedInteraction = activeWorkflowInteractionFor(authoritative.taskState);
    const text = answer.trim().slice(0, 8_000);
    let answerBase = authoritative;
    let answerProjection = activeProjection;
    let turnId = authoritative.activeTurn?.id
      ?? authoritative.messages.find((message) => message.id === projection.messageId)?.turnId
      ?? `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    let turnUserMessageId = authoritative.activeTurn?.sourceUserMessageId
      ?? authoritative.activeTurn?.userMessageId
      ?? authoritative.messages.find((message) => message.id === projection.messageId)?.parentMessageId
      ?? userMessageId;
    let now = new Date().toISOString();
    let canonicalAnswer: AgentSession | undefined;
    let answerWasCommitted = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        if (!canonicalAnswer) break;
        const retryProjection = getActiveTailoringQuestionProjection(canonicalAnswer);
        if (
          !retryProjection
          || retryProjection.interactionId !== projection.interactionId
          || retryProjection.checkpointId !== projection.checkpointId
          || retryProjection.interactionRevision !== projection.interactionRevision
          || retryProjection.questionId !== projection.questionId
          || presentedActiveTailoringQuestion(canonicalAnswer) !== projection.questionId
        ) break;
        answerBase = canonicalAnswer;
        answerProjection = retryProjection;
        resolvedInteraction = activeWorkflowInteractionFor(answerBase.taskState);
        const retryInteractionMessage = answerBase.messages.find((message) => message.id === answerProjection.messageId);
        turnId = answerBase.activeTurn?.id
          ?? retryInteractionMessage?.turnId
          ?? turnId;
        turnUserMessageId = answerBase.activeTurn?.sourceUserMessageId
          ?? answerBase.activeTurn?.userMessageId
          ?? retryInteractionMessage?.parentMessageId
          ?? userMessageId;
        now = new Date().toISOString();
      }
      let attemptSession = withTurnCheckpoint(supersedeActiveOptionSets(answerBase), turnId, userMessageId, now);
      attemptSession = appendAgentMessage(attemptSession, "user", text, {
        id: userMessageId,
        turnId,
        status: "complete",
        metadata: {
          executionOwner: "deterministic_transition",
          answerPayload: true,
          tailoringQuestionId: answerProjection.questionId,
          tailoringQuestionPlanId: answerProjection.questionPlanId,
          tailoringQuestionPlanRevision: answerProjection.questionPlanRevision,
          workflowInteractionId: answerProjection.interactionId,
          workflowCheckpointId: answerProjection.checkpointId,
          workflowInteractionRevision: answerProjection.interactionRevision,
          ...(options.optionField ? { optionField: options.optionField } : {}),
          ...(options.optionValue !== undefined ? { optionValue: options.optionValue } : {}),
          executionState: "running"
        }
      });
      attemptSession = this.consumeTailoringQuestionAnswerLocally(attemptSession, answerProjection, text, userMessageId, now);
      // Commit the answer and plan before the Driver is allowed to inspect the
      // next stage. This is the read-after-write boundary: the Driver must not
      // run against the object captured before Q3 was consumed.
      attemptSession = {
        ...attemptSession,
        activeTurn: {
          ...attemptSession.activeTurn,
          id: turnId,
          sessionId: attemptSession.id,
          sourceUserMessageId: turnUserMessageId,
          userMessageId: turnUserMessageId,
          executionOwner: "deterministic_transition",
          status: "running",
          startedAt: attemptSession.activeTurn?.startedAt ?? now,
          completedAt: undefined
        }
      };
      const committedAnswer = await this.dependencies.persistence.save(attemptSession);
      canonicalAnswer = typeof this.dependencies.persistence.get === "function"
        ? await this.dependencies.persistence.get(committedAnswer.id)
        : committedAnswer;
      if (!canonicalAnswer) throw new Error("tailoring_answer_canonical_read_missing");
      answerWasCommitted = canonicalAnswer.messages.some((message) =>
        message.id === userMessageId
        && message.role === "user"
        && message.metadata?.answerPayload === true
      );
      if (answerWasCommitted) break;
    }
    if (!canonicalAnswer) throw new Error("tailoring_answer_canonical_read_missing");
    if (!answerWasCommitted) {
      // WorkspaceRepository can return the newer stored snapshot when this
      // turn lost its compare-and-swap race. Do not let that unchanged
      // snapshot enter the Driver as if the answer had been consumed.
      this.patchSession(canonicalAnswer, {
        turnStatus: sessionTurnStatus(canonicalAnswer),
        activeTurnId: canonicalAnswer.activeTurn?.id
      });
      return { session: canonicalAnswer, turnId, userMessageId, applied: false };
    }
    let current = canonicalAnswer;
    this.patchSession(current, { turnStatus: "running", activeTurnId: turnId });
    if (typeof this.dependencies.executor.execute !== "function") {
      const nextQuestionState = current.taskState ? getActiveTailoringQuestionProjection(current.taskState) : undefined;
      if (nextQuestionState && current.taskState) {
        current = projectActiveTailoringQuestionToChat(current, current.taskState);
        current = {
          ...current,
          activeTurn: {
            ...current.activeTurn,
            id: turnId,
            sessionId: current.id,
            sourceUserMessageId: turnUserMessageId,
            userMessageId: turnUserMessageId,
            executionOwner: "deterministic_transition",
            status: "waiting_for_user",
            startedAt: current.activeTurn?.startedAt ?? now,
            completedAt: now
          }
        };
        current = settleUserExecutionState(current, turnId, "complete");
        current = completeTurnCheckpoint(current, turnId, new Date().toISOString());
        const saved = await this.dependencies.persistence.save(current);
        this.patchSession(saved, { turnStatus: "waiting_for_user", activeTurnId: turnId });
        return { session: saved, turnId, userMessageId, applied: true };
      }
      current = {
        ...current,
        activeTurn: {
          ...current.activeTurn,
          id: turnId,
          sessionId: current.id,
          sourceUserMessageId: userMessageId,
          userMessageId,
          executionOwner: "deterministic_transition",
          status: "completed",
          startedAt: now,
          completedAt: now
        }
      };
      current = settleUserExecutionState(current, turnId, "complete");
      current = completeTurnCheckpoint(current, turnId, new Date().toISOString());
      const saved = await this.dependencies.persistence.save(current);
      this.patchSession(saved, { turnStatus: "completed", activeTurnId: turnId });
      return { session: saved, turnId, userMessageId, applied: true };
    }
    const driver = await advanceTailoringWorkflow({
      taskState: current.taskState!,
      tailoringSession: objectValue(current.taskState!.knownSlots.tailoringSession) as TailoringSession,
      operationId: `tailoring-driver-${turnId}`.slice(0, 160),
      resolvedInteraction,
      execute: ({ toolName, toolInput, operationId, signal }) => this.dependencies.executor.execute({
        toolName,
        toolInput,
        operationId,
        signal
      })
    });
    current = projectTaskStateIntoSession(current, driver.taskState);
    current = upsertTailoringDriverOutput(current, driver, turnId);
    current = {
      ...current,
      activeTurn: {
          ...current.activeTurn,
          id: turnId,
          sessionId: current.id,
          sourceUserMessageId: turnUserMessageId,
          userMessageId: turnUserMessageId,
          runtimeId: undefined,
        preferredRuntime: "native",
        attemptedRuntime: "native",
        finalRuntime: "native",
        fallbackUsed: false,
        executionOwner: "deterministic_transition",
        visibleAssistantMessageId: undefined,
        status: driver.kind === "WAITING_FOR_CONFIRMATION"
          ? "waiting_for_confirmation"
          : driver.kind === "WAITING_FOR_USER"
            ? "waiting_for_user"
            : driver.kind === "RECOVERABLE_FAILURE" ? "failed" : "completed",
        startedAt: current.activeTurn?.startedAt ?? now,
        completedAt: driver.kind === "WAITING_FOR_CONFIRMATION" ? undefined : new Date().toISOString()
      }
    };
    if (driver.kind === "WAITING_FOR_USER" && driver.interactionKind === "clarification") {
      current = projectActiveTailoringQuestionToChat(current, driver.taskState);
    } else if (driver.kind === "WAITING_FOR_USER") {
      current = attachTaskStateOptions(current, driver.taskState);
    }
    current = settleUserExecutionState(current, turnId, driver.kind === "RECOVERABLE_FAILURE" ? "failed" : "complete");
    current = completeTurnCheckpoint(current, turnId, new Date().toISOString());
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: driver.kind === "WAITING_FOR_CONFIRMATION"
        ? "waiting_for_confirmation"
        : driver.kind === "WAITING_FOR_USER"
          ? "waiting_for_user"
          : driver.kind === "RECOVERABLE_FAILURE" ? "failed" : "completed",
      activeTurnId: turnId,
      currentObservation: driver.kind === "RECOVERABLE_FAILURE"
        ? { type: "tailoring_driver_failure", ...driver.error }
        : { type: "tailoring_interaction_consumed", interactionId: projection.interactionId }
    });
    return { session: saved, turnId, userMessageId, applied: true };
  }

  private consumeTailoringQuestionAnswerLocally(
    session: AgentSession,
    projection: TailoringQuestionProjection,
    answer: string | string[] | boolean,
    answerMessageId: string,
    now: string
  ) {
    if (!session.taskState) throw new Error("tailoring_question_task_state_missing");
    const tailoringSession = objectValue(session.taskState.knownSlots.tailoringSession);
    const branch = tailoringSession.branch && typeof tailoringSession.branch === "object" && !Array.isArray(tailoringSession.branch)
      ? tailoringSession.branch as never
      : undefined;
    const consumed = consumeTailoringQuestionAnswer({
      session: tailoringSession,
      questionId: projection.questionId,
      answer,
      answerMessageId,
      branch,
      operationId: `tailoring-answer-${answerMessageId}`,
      now
    });
    const taskState = normalizeAgentTaskState(new AgentTaskStateReducer().reduce(session.taskState, {
      type: "tool_observation",
      toolName: "answer_tailoring_question",
      observation: { session: consumed.session }
    }));
    let next = projectTaskStateIntoSession(session, taskState);
    next = settleTailoringQuestionProjection(next, consumed.receipt, now);
    return {
      ...next,
      messages: next.messages.map((message) => message.id === answerMessageId
        ? {
            ...message,
            metadata: {
              ...message.metadata,
              executionOwner: "deterministic_transition",
              answerPayload: true,
              tailoringQuestionId: consumed.receipt.questionId,
              tailoringQuestionPlanId: consumed.receipt.questionPlanId,
              tailoringQuestionPlanRevision: consumed.receipt.questionPlanRevision,
              tailoringAnswerReceipt: consumed.receipt,
              executionState: "complete",
              answerConsumedAt: consumed.receipt.consumedAt,
              answerOperationId: `tailoring-answer-${answerMessageId}`
            },
            updatedAt: now
          }
        : message),
      updatedAt: now
    };
  }

  private async prepareRetryWorkflowStep(session: AgentSession) {
    const safe = resolveLastSafeWorkflowCheckpoint(session);
    const turnId = session.activeTurn?.id ?? safe?.checkpoint?.turnId ?? `agent-retry-${crypto.randomUUID()}`;
    if (!safe) return { session, turnId, applied: false };
    const userMessageId = session.activeTurn?.userMessageId
      ?? safe.checkpoint?.userMessageId
      ?? [...session.messages].reverse().find((message) => message.role === "user" && message.turnId === turnId)?.id
      ?? `agent-user-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const restoredTask = {
      ...structuredClone(safe.taskState),
      ...(safe.taskState.workflowId === "tailor_existing_resume"
        && normalizeTailoringStage(safe.taskState.stage)
        ? { stage: normalizeTailoringStage(safe.taskState.stage) }
        : {}),
      completionStatus: "active" as const,
      updatedAt: now
    };
    let restored = projectTaskStateIntoSession({
      ...session,
      workflowState: structuredClone(safe.workflowState),
      artifactRefs: structuredClone(safe.artifactRefs),
      pendingConfirmation: safe.pendingConfirmation ? structuredClone(safe.pendingConfirmation) : undefined,
      pendingToolCall: safe.pendingToolCall ? structuredClone(safe.pendingToolCall) : undefined,
      activeProfileId: safe.selectedEntities.profileId,
      activeResumeId: safe.selectedEntities.resumeId,
      activeJobId: safe.selectedEntities.jobId,
      activeTurn: undefined,
      updatedAt: now
    }, restoredTask);
    restored = withTurnCheckpoint(restored, turnId, userMessageId, now);
    restored = {
      ...restored,
      activeTurn: {
        ...restored.activeTurn,
        id: turnId,
        sessionId: restored.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: restored.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: restored.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: restored.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: restored.activeTurn?.fallbackUsed ?? false,
        executionOwner: "deterministic_transition",
        status: "running",
        startedAt: now
      }
    };
    const saved = await this.dependencies.persistence.save(restored);
    this.patchSession(saved, { turnStatus: "running", currentObservation: { type: "safe_checkpoint_restored", source: safe.source } });
    return { session: saved, turnId, applied: true };
  }

  private resolveArtifactAction(
    session: AgentSession,
    action: AgentArtifactAction,
    pageContext: AgentPageContext
  ) {
    const revision = artifactActionRevision(session.taskState, action);
    const executionKey = artifactActionOperationId(session, action, revision);
    const running = this.artifactActionExecutions.get(executionKey);
    if (running) return running;
    const resolve = async () => {
      // Multiple inline review cards can be clicked before React has rendered
      // the first result. Re-read the host's canonical session at the queue
      // boundary so each decision is applied to the revision produced by the
      // preceding decision instead of saving three stale snapshots.
      const isTailoringReviewAction = action.type === "tailoring_diff_decision"
        || action.type === "tailoring_diff_stage_decision"
        || action.type === "tailoring_diff_submit";
      const current = isTailoringReviewAction
        ? this.snapshot.activeSession?.id === session.id
          ? this.snapshot.activeSession
          : typeof this.dependencies.persistence.get === "function"
            ? await this.dependencies.persistence.get(session.id) ?? session
            : session
        : session;
      const currentRevision = artifactActionRevision(current.taskState, action);
      return action.type === "tailoring_diff_stage_decision"
        ? this.resolveTailoringDiffStageDecision(current, action, pageContext, currentRevision)
        : action.type === "tailoring_diff_submit"
          ? this.resolveTailoringDiffSubmit(current, action, pageContext, currentRevision)
        : action.type === "profile_intake_retry_extraction"
        ? this.resolveProfileIntakeExtractionRetry(current, action, pageContext, currentRevision)
        : action.type === "profile_intake_extraction_recovery"
        ? this.resolveProfileIntakeExtractionRecovery(current, action, pageContext, currentRevision)
        : this.resolveArtifactActionOnce(current, action, pageContext, currentRevision);
    };
    const isTailoringReviewAction = action.type === "tailoring_diff_decision"
      || action.type === "tailoring_diff_stage_decision"
      || action.type === "tailoring_diff_submit";
    const previous = isTailoringReviewAction
      ? this.tailoringArtifactActionQueues.get(session.id)
      : undefined;
    const execution = (previous ? previous.catch(() => undefined).then(resolve) : resolve())
      .finally(() => this.artifactActionExecutions.delete(executionKey));
    this.artifactActionExecutions.set(executionKey, execution);
    if (!isTailoringReviewAction) return execution;
    const queuedExecution = execution.finally(() => {
      if (this.tailoringArtifactActionQueues.get(session.id) === queuedExecution) {
        this.tailoringArtifactActionQueues.delete(session.id);
      }
    });
    this.tailoringArtifactActionQueues.set(session.id, queuedExecution);
    return queuedExecution;
  }

  private async resolveTailoringDiffStageDecision(
    session: AgentSession,
    action: Extract<AgentArtifactAction, { type: "tailoring_diff_stage_decision" }>,
    pageContext: AgentPageContext,
    revision: number | undefined
  ) {
    const taskState = session.taskState;
    const tailoring = objectValue(taskState?.knownSlots.tailoringSession);
    const plan = objectValue(tailoring.plan);
    const diffs = Array.isArray(plan.diffs) ? plan.diffs.map(objectValue) : [];
    const diff = diffs.find((candidate) => {
      try {
        return tailoringDiffId(candidate as never) === action.diffId;
      } catch {
        return false;
      }
    });
    const currentGeneratedDiffRevision = typeof (tailoring.generatedDiffRevision ?? plan.generatedDiffRevision) === "number"
      ? tailoring.generatedDiffRevision ?? plan.generatedDiffRevision
      : 0;
    if (
      !taskState
      || revision === undefined
      || !diff
      || (action.decision === "edit" && action.editedValue === undefined)
      || action.generatedDiffRevision !== undefined
        && currentGeneratedDiffRevision !== undefined
        && String(action.generatedDiffRevision) !== String(currentGeneratedDiffRevision)
    ) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: revision === undefined ? "missing_revision" : "invalid_target",
        message: revision === undefined
          ? "当前产物版本不可用，请刷新后重试。"
          : action.generatedDiffRevision !== undefined
            && currentGeneratedDiffRevision !== undefined
            && String(action.generatedDiffRevision) !== String(currentGeneratedDiffRevision)
            ? "修改建议已经更新，请重新选择后重试。"
            : "这项修改已失效，请刷新产物后重试。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved, { turnStatus: "waiting_for_user" });
      void pageContext;
      return saved;
    }

    const prior = Array.isArray(taskState.knownSlots.tailoringDraftDiffReviews)
      ? taskState.knownSlots.tailoringDraftDiffReviews.map(objectValue)
      : [];
    const now = new Date().toISOString();
    const nextReview = {
      diffId: action.diffId,
      decision: action.decision,
      status: action.decision === "accept" ? "accepted" : action.decision === "edit" ? "edited" : "rejected",
      ...(action.editedValue !== undefined ? { editedValue: action.editedValue } : {}),
      ...(currentGeneratedDiffRevision !== undefined
        ? { generatedDiffRevision: currentGeneratedDiffRevision }
        : {}),
      updatedAt: now
    };
    const nextDraftReviews = [
      ...prior.filter((review) => review.diffId !== action.diffId),
      nextReview
    ];
    let current = projectTaskStateIntoSession(session, {
      ...taskState,
      knownSlots: {
        ...taskState.knownSlots,
        tailoringDraftDiffReviews: nextDraftReviews,
        tailoringReviewSubmittedDiffRevision: undefined
      },
      updatedAt: now
    });
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: "已暂存这项选择；点击“提交本次选择”后统一处理。",
      retryable: false
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, { turnStatus: "waiting_for_user" });
    void pageContext;
    return saved;
  }

  private async resolveTailoringDiffSubmit(
    session: AgentSession,
    action: Extract<AgentArtifactAction, { type: "tailoring_diff_submit" }>,
    pageContext: AgentPageContext,
    revision: number | undefined
  ) {
    const taskState = session.taskState;
    const staged = Array.isArray(action.reviews)
      ? action.reviews.map((review) => ({ ...review }))
      : Array.isArray(taskState?.knownSlots.tailoringDraftDiffReviews)
      ? taskState.knownSlots.tailoringDraftDiffReviews.map(objectValue)
      : [];
    const currentTailoringSession = objectValue(taskState?.knownSlots.tailoringSession);
    const currentPlan = objectValue(currentTailoringSession.plan);
    const currentGeneratedDiffRevision = typeof (currentTailoringSession.generatedDiffRevision ?? currentPlan.generatedDiffRevision) === "number"
      ? currentTailoringSession.generatedDiffRevision ?? currentPlan.generatedDiffRevision
      : 0;
    const staleStagedChoice = currentGeneratedDiffRevision !== undefined && staged.some((review) =>
      review.generatedDiffRevision !== undefined
      && String(review.generatedDiffRevision) !== String(currentGeneratedDiffRevision)
    );
    if (!taskState || revision === undefined || !staged.length || staleStagedChoice) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: revision === undefined ? "missing_revision" : "invalid_target",
        message: revision === undefined
          ? "当前产物版本不可用，请刷新后重试。"
          : staleStagedChoice
            ? "修改建议已经更新，请重新选择后再提交。"
            : "请先选择至少一项修改，再提交本次选择。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved, { turnStatus: "waiting_for_user" });
      void pageContext;
      return saved;
    }

    const allDiffIds = Array.isArray(currentPlan.diffs)
      ? currentPlan.diffs.map((diff) => tailoringDiffId(diff as never))
      : [];
    const resolvedDiffIds = new Set(
      (Array.isArray(currentPlan.diffReviews) ? currentPlan.diffReviews.map(objectValue) : [])
        .filter((review) => ["accepted", "edited", "rejected"].includes(String(review.status)))
        .map((review) => stringValue(review.diffId))
        .filter((diffId): diffId is string => Boolean(diffId))
    );
    staged.forEach((review) => {
      const diffId = stringValue(review.diffId);
      if (diffId) resolvedDiffIds.add(diffId);
    });
    const unresolvedDiffCount = allDiffIds.filter((diffId) => !resolvedDiffIds.has(diffId)).length;
    if (unresolvedDiffCount > 0) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: "invalid_target",
        message: `还有 ${unresolvedDiffCount} 项修改未完成选择，请先逐项选择“采用、编辑后采用”或“忽略”。`,
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved, { turnStatus: "waiting_for_user" });
      void pageContext;
      return saved;
    }

    this.executionCoordinator.interrupt(session.id);
    await this.executionCoordinator.get(session.id)?.promise;
    const currentTurn = session.activeTurn;
    const preserveArtifactTurn = currentTurn?.status === "waiting_for_user";
    const turnId = preserveArtifactTurn && currentTurn.id
      ? currentTurn.id
      : `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = preserveArtifactTurn && currentTurn.userMessageId
      ? currentTurn.userMessageId
      : `agent-user-${crypto.randomUUID()}`;
    const operationId = artifactActionOperationId(session, action, revision);
    const startedAt = new Date().toISOString();
    const actionSession = beginDeterministicArtifactTurn(session, turnId, userMessageId, startedAt);
    const runningSession = withArtifactActionFeedback(actionSession, action, {
      result: "handled",
      message: `正在统一提交 ${staged.length} 项选择…`,
      running: true,
      retryable: false,
      operationId
    });
    this.patchSession(runningSession, { turnStatus: "running" });
    const persistedRunning = await this.dependencies.persistence.save(runningSession);
    let current = persistedRunning;
    let currentTaskState = persistedRunning.taskState!;
    const reducer = new AgentTaskStateReducer();
    for (const [index, stagedReview] of staged.entries()) {
      const diffId = stringValue(stagedReview.diffId);
      const decision = stagedReview.decision;
      if (!diffId || !["accept", "edit", "reject"].includes(String(decision))) {
        const failed = withArtifactActionFeedback(settleDeterministicArtifactSession(current, turnId), action, {
          result: "invalid_target",
          message: "有一项暂存选择已失效，请刷新修改预览后重试。",
          retryable: true,
          operationId
        });
        const saved = await this.dependencies.persistence.save(failed);
        this.patchSession(saved, { turnStatus: "waiting_for_user" });
        void pageContext;
        return saved;
      }
      const reviewOperationId = `${operationId}-diff-${index}-${stableHashText(diffId).slice(0, 12)}`.slice(0, 160);
      const result = await this.dependencies.executor.execute({
        toolName: "review_tailoring_diff",
        toolInput: {
          session: currentTaskState.knownSlots.tailoringSession,
          diffId,
          decision,
          ...(stagedReview.editedValue !== undefined ? { editedValue: stagedReview.editedValue } : {})
        },
        operationId: reviewOperationId
      });
      if (!result.ok) {
        const failed = withArtifactActionFeedback(settleDeterministicArtifactSession(current, turnId), action, {
          result: "rejected",
          message: result.error?.message ?? "统一提交修改选择没有完成，请重试。",
          retryable: true,
          safeErrorCode: result.error?.code ?? "tailoring_review_submit_failed",
          operationId
        });
        const saved = await this.dependencies.persistence.save(failed);
        this.patchSession(saved, { turnStatus: "waiting_for_user" });
        void pageContext;
        return saved;
      }
      currentTaskState = reducer.reduce(currentTaskState, {
        type: "tool_observation",
        toolName: result.toolName,
        observation: result.data,
        artifactIds: result.artifactIds
      });
      current = projectTaskStateIntoSession(current, currentTaskState);
    }

    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId,
      content: `已统一提交 ${staged.length} 项岗位修改选择。`,
      toolName: "review_tailoring_diff",
      operationId,
      status: "complete",
      metadata: {
        activityState: "complete",
        artifactActionType: action.type,
        batch: true,
        itemCount: staged.length
      }
    });
    const generatedDiffRevisionValue = objectValue(currentTaskState.knownSlots.tailoringSession).generatedDiffRevision
      ?? objectValue(objectValue(currentTaskState.knownSlots.tailoringSession).plan).generatedDiffRevision;
    const generatedDiffRevision = typeof generatedDiffRevisionValue === "number" ? generatedDiffRevisionValue : 0;
    currentTaskState = {
      ...currentTaskState,
      knownSlots: {
        ...currentTaskState.knownSlots,
        tailoringDraftDiffReviews: [],
        tailoringReviewSubmittedDiffRevision: generatedDiffRevision
      },
      updatedAt: new Date().toISOString()
    };
    current = projectTaskStateIntoSession(current, currentTaskState);
    const tailoringBoundary = await advanceTailoringWorkflow({
      taskState: currentTaskState,
      tailoringSession: objectValue(currentTaskState.knownSlots.tailoringSession) as TailoringSession,
      operationId,
      execute: ({ toolName, toolInput, operationId: driverOperationId, signal }) => this.dependencies.executor.execute({
        toolName,
        toolInput,
        operationId: driverOperationId,
        signal
      })
    });
    currentTaskState = tailoringBoundary.taskState;
    current = projectTaskStateIntoSession(current, currentTaskState);
    current = upsertTailoringDriverOutput(current, tailoringBoundary, turnId, staged.length);
    if (tailoringBoundary.kind === "WAITING_FOR_CONFIRMATION") {
      const persistenceDecision = stringValue(currentTaskState.knownSlots.jobPersistenceDecision) ?? "ask";
      const targetSnapshotValue = objectValue(currentTaskState.knownSlots.targetSnapshot ?? objectValue(currentTaskState.knownSlots.tailoringSession).targetSnapshot);
      if (persistenceDecision === "save" && Object.keys(targetSnapshotValue).length) {
        current = await this.persistExternalTargetJob(current, turnId);
      }
      current = this.prepareExternalTargetApplyConfirmation(current, turnId);
      currentTaskState = current.taskState ?? currentTaskState;
    }
    current = settleDeterministicArtifactSession(current, turnId);
    if (
      tailoringBoundary.kind === "WAITING_FOR_USER" && tailoringBoundary.interactionKind === "target_persistence_choice"
      || current.pendingConfirmation
    ) {
      current = attachTaskStateOptions(current, current.taskState ?? currentTaskState);
    }
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: tailoringBoundary.kind === "WAITING_FOR_CONFIRMATION"
        ? `已提交 ${staged.length} 项选择，新的岗位简历预览已生成。`
        : tailoringBoundary.kind === "WAITING_FOR_USER"
          && (numberValue(tailoringBoundary.taskState.knownSlots.remainingDiffCount) ?? 0) > 0
          ? `已提交 ${staged.length} 项选择，还有 ${numberValue(tailoringBoundary.taskState.knownSlots.remainingDiffCount) ?? 0} 项待核对，请在右侧产物栏继续处理。`
          : tailoringBoundary.kind === "WAITING_FOR_USER"
            && (numberValue(tailoringBoundary.taskState.knownSlots.acceptedDiffCount) ?? 0) === 0
            ? `已提交 ${staged.length} 项选择，目前没有可应用的修改，请在右侧重新选择。`
          : `已提交 ${staged.length} 项选择，当前结果已更新。`,
      retryable: false,
      operationId
    });
    currentTaskState = current.taskState ?? currentTaskState;
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, {
      turnStatus: saved.pendingConfirmation
        ? "waiting_for_confirmation"
        : tailoringBoundary.kind === "RECOVERABLE_FAILURE"
          ? "failed"
          : tailoringBoundary.kind === "WAITING_FOR_USER"
            ? "waiting_for_user"
            : "completed"
    });
    void pageContext;
    return saved;
  }

  private async resolveProfileIntakeExtractionRetry(
    session: AgentSession,
    action: Extract<AgentArtifactAction, { type: "profile_intake_retry_extraction" }>,
    pageContext: AgentPageContext,
    revision: number | undefined
  ) {
    const execution = artifactActionExecution(session.taskState, action);
    if (!execution || revision === undefined) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: revision === undefined ? "missing_revision" : "invalid_target",
        message: "当前失败整理已更新，请刷新后重试。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved, { turnStatus: "idle" });
      return saved;
    }
    this.executionCoordinator.interrupt(session.id);
    await this.executionCoordinator.get(session.id)?.promise;
    const operationId = artifactActionOperationId(session, action, revision);
    const runningSession = withArtifactActionFeedback(session, action, {
      result: "handled",
      message: "正在重新识别原始回答…",
      running: true,
      retryable: false
    });
    this.patchSession(runningSession, { turnStatus: "running" });
    const result = await this.dependencies.executor.execute({
      toolName: execution.toolName,
      toolInput: execution.toolInput,
      operationId
    });
    if (!result.ok) {
      const failed = withArtifactActionFeedback(session, action, {
        result: "rejected",
        message: result.error?.message ?? "重新识别没有完成，请稍后重试。",
        retryable: true,
        safeErrorCode: result.error?.code ?? "profile_intake_retry_failed"
      });
      const saved = await this.dependencies.persistence.save(failed);
      this.patchSession(saved, { turnStatus: "idle" });
      void pageContext;
      return saved;
    }
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(session.taskState!, {
      type: "tool_observation",
      toolName: result.toolName,
      observation: result.data,
      artifactIds: result.artifactIds
    });
    let current = projectTaskStateIntoSession(session, taskState);
    const observation = objectValue(result.data);
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(observation.reviewProjection);
    const usableCount = typeof observation.usableCandidateCount === "number"
      ? observation.usableCandidateCount
      : projection.success ? projection.data.reviewProgress.valid : 0;
    const section = projection.success ? retrySectionLabel(projection.data) : "相关";
    const retryMessage = usableCount === 1
      ? `已重新识别出 1 项${section}经历，请核对。`
      : `已重新识别出 ${usableCount} 项${section}经历，请核对。`;
    const retryTurnId = `agent-retry-${stableHashText(operationId).slice(0, 24)}`;
    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId: retryTurnId,
      content: "已自动保存重新识别结果。",
      toolName: result.toolName,
      operationId,
      status: "complete",
      metadata: {
        activityState: "complete",
        artifactActionType: action.type,
        retry: true,
        artifactIds: result.artifactIds
      }
    });
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: retryMessage,
      retryable: false
    });
    const retryMessageId = `agent-retry-message-${stableHashText(operationId).slice(0, 32)}`;
    if (!current.messages.some((message) => message.id === retryMessageId)) {
      current = appendAgentMessage(current, "assistant", retryMessage, {
        id: retryMessageId,
        kind: "text",
        type: "text",
        status: "complete",
        language: "zh",
        metadata: { profileIntakeRetry: true, retry: true, operationId }
      });
    }
    current = attachTaskStateOptions(current, taskState);
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current, { turnStatus: "idle" });
    void pageContext;
    return current;
  }

  private async resolveProfileIntakeExtractionRecovery(
    session: AgentSession,
    action: Extract<AgentArtifactAction, { type: "profile_intake_extraction_recovery" }>,
    pageContext: AgentPageContext,
    revision: number | undefined
  ) {
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(session.taskState?.knownSlots.profileIntakeReviewProjection);
    if (
      !projection.success
      || revision === undefined
      || projection.data.importId !== action.importId
      || projection.data.draftRevision !== action.expectedDraftRevision
      || projection.data.sourceMessageId !== action.sourceMessageId
      || projection.data.extractionStatus !== "failed"
    ) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: revision === undefined ? "missing_revision" : "invalid_target",
        message: "当前失败整理已更新，请刷新后重试。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved, { turnStatus: "idle" });
      return saved;
    }
    const nextStatus = action.decision === "manual_review" ? "manual_review" as const : "preserved" as const;
    const preservedCandidates = action.decision === "preserve_source"
      ? projection.data.candidates.map((candidate) => candidate.status === "failed"
          ? {
              ...candidate,
              status: "ignored" as const,
              decision: "reject" as const,
              needsConfirmation: false,
              uncertainFields: [],
              reason: "用户选择保留原文，未将未确认内容写入资料库。"
            }
          : candidate)
      : projection.data.candidates;
    const nextProjection = ProfileIntakeReviewProjectionSchema.parse({
      ...projection.data,
      candidates: preservedCandidates,
      reviewProgress: profileIntakeReviewProgress(preservedCandidates),
      extractionStatus: nextStatus,
      ...(action.decision === "preserve_source" ? { finalReviewRevision: projection.data.draftRevision } : {}),
      failedExtraction: {
        ...projection.data.failedExtraction,
        code: action.decision === "manual_review" ? "manual_review_requested" : "source_preserved",
        message: action.decision === "manual_review"
          ? "原文已保留，可继续在对话中补充结构化字段。"
          : "原文已保留，本轮不会把未确认内容写入资料库。",
        actions: ["retry"]
      }
    });
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(session.taskState!, {
      type: "slot_answer",
      slot: "profileIntakeReviewProjection",
      value: nextProjection
    });
    let current = projectTaskStateIntoSession(session, {
      ...taskState,
      knownSlots: {
        ...taskState.knownSlots,
        profileIntakeReviewProjection: nextProjection,
        intakeCandidates: nextProjection.candidates
      },
      stage: action.decision === "manual_review" ? "collect_experience" : "collect_experience",
      completionStatus: "waiting_for_user",
      updatedAt: new Date().toISOString()
    });
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: action.decision === "manual_review" ? "已切换为手动整理，原文仍保留。" : "已保留原文，未确认内容不会进入资料库。",
      retryable: true
    });
    current = appendAgentMessage(current, "assistant", action.decision === "manual_review"
      ? "原文已经保留。你可以直接补充这段经历的名称、角色、主要工作或结果，我会继续做同一张核对卡。"
      : "原文已经保留，未确认内容不会进入资料库。之后仍可重新解析。", {
      id: `agent-profile-intake-recovery-${action.importId}-${action.decision}-${revision}`,
      kind: "text",
      type: "text",
      status: "complete",
      language: "zh",
      metadata: { profileIntakeRecovery: action.decision }
    });
    const saved = await this.dependencies.persistence.save(current);
    this.patchSession(saved, { turnStatus: "idle" });
    void pageContext;
    return saved;
  }

  private async resolveArtifactActionOnce(
    session: AgentSession,
    action: AgentArtifactAction,
    pageContext: AgentPageContext,
    revision: number | undefined
  ) {
    const execution = artifactActionExecution(session.taskState, action);
    if (!execution || revision === undefined) {
      const rejected = withArtifactActionFeedback(session, action, {
        result: revision === undefined ? "missing_revision" : "invalid_target",
        message: revision === undefined ? "当前产物版本不可用，请刷新后重试。" : "这项修改已失效，请刷新产物后重试。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(rejected);
      this.patchSession(saved);
      return saved;
    }
    this.executionCoordinator.interrupt(session.id);
    await this.executionCoordinator.get(session.id)?.promise;
    const currentTurn = session.activeTurn;
    const preserveArtifactTurn = action.type === "tailoring_diff_decision" && currentTurn?.status === "waiting_for_user";
    const turnId = preserveArtifactTurn
      ? currentTurn.id
      : `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = preserveArtifactTurn && currentTurn.userMessageId
      ? currentTurn.userMessageId
      : `agent-user-${crypto.randomUUID()}`;
    const operationId = artifactActionOperationId(session, action, revision);
    const actionSession = beginDeterministicArtifactTurn(
      session,
      turnId,
      userMessageId,
      new Date().toISOString()
    );
    const runningSession = withArtifactActionFeedback(actionSession, action, {
      result: "handled",
      message: "正在保存这项核对…",
      running: true,
      retryable: false
    });
    this.patchSession(runningSession);
    // saveAgentSession returns the CAS-accepted, hydrated snapshot with the
    // incremented sessionRevision. Continue from that value; continuing from
    // runningSession makes the final save look stale to WorkspaceRepository,
    // which silently returns the pre-action snapshot and makes the button
    // appear to do nothing in a real browser.
    const persistedRunning = await this.dependencies.persistence.save(runningSession);
    const executionSession = persistedRunning;
    const result = await this.dependencies.executor.execute({
      toolName: execution.toolName,
      toolInput: execution.toolInput,
      operationId
    });
    if (!result.ok) {
      const failed = withArtifactActionFeedback(settleDeterministicArtifactSession(executionSession, turnId), action, {
        result: "rejected",
        message: result.error?.message ?? "这项核对没有保存成功，请重试。",
        retryable: true,
        safeErrorCode: result.error?.code ?? "artifact_action_failed",
        operationId
      });
      const saved = await this.dependencies.persistence.save(failed);
      this.patchSession(saved);
      return saved;
    }
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.reduce(executionSession.taskState!, {
      type: "tool_observation",
      toolName: result.toolName,
      observation: result.data,
      artifactIds: result.artifactIds
    });
    if (action.type === "tailoring_answer_edit" || action.type === "tailoring_regenerate") {
      taskState = {
        ...taskState,
        knownSlots: {
          ...taskState.knownSlots,
          tailoringDraftDiffReviews: [],
          tailoringReviewSubmittedDiffRevision: undefined
        },
        updatedAt: new Date().toISOString()
      };
    }
    let current = projectTaskStateIntoSession(executionSession, taskState);
    const observation = objectValue(result.data);
    if (observation.idempotent !== true) {
      current = upsertAgentActivity(current, {
        id: `agent-tool-${operationId}`,
        turnId,
        content: artifactActionCompletedLabel(action),
        toolName: result.toolName,
        operationId,
        status: "complete",
        metadata: { activityState: "complete", artifactActionType: action.type, artifactIds: result.artifactIds }
      });
    }
    let tailoringBoundary: TailoringWorkflowBoundary | undefined;
    if (action.type === "tailoring_diff_decision") {
      tailoringBoundary = await advanceTailoringWorkflow({
          taskState,
          tailoringSession: objectValue(taskState.knownSlots.tailoringSession) as TailoringSession,
          operationId,
          resolvedInteraction: activeWorkflowInteractionFor(executionSession.taskState),
        execute: ({ toolName, toolInput, operationId: driverOperationId, signal }) => this.dependencies.executor.execute({
          toolName,
          toolInput,
          operationId: driverOperationId,
          signal
        })
      });
      taskState = tailoringBoundary.taskState;
      current = projectTaskStateIntoSession(current, taskState);
      current = upsertTailoringDriverOutput(current, tailoringBoundary, turnId);
      if (tailoringBoundary.kind === "WAITING_FOR_CONFIRMATION") {
        const persistenceDecision = stringValue(taskState.knownSlots.jobPersistenceDecision) ?? "ask";
        const targetSnapshotValue = objectValue(taskState.knownSlots.targetSnapshot ?? objectValue(taskState.knownSlots.tailoringSession).targetSnapshot);
        if (persistenceDecision === "save" && Object.keys(targetSnapshotValue).length) {
          current = await this.persistExternalTargetJob(current, turnId);
        }
        current = this.prepareExternalTargetApplyConfirmation(current, turnId);
        taskState = current.taskState ?? taskState;
      }
    }
    current = settleDeterministicArtifactSession(current, turnId);
    const diffFieldNames = action.type === "tailoring_diff_decision"
      ? tailoringDiffFieldNames(executionSession.taskState, action.diffId)
      : undefined;
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: artifactActionCompletedLabel(action).replace(/[。.]$/u, ""),
      retryable: false,
      operationId,
      fieldNames: diffFieldNames
    });
    taskState = current.taskState ?? taskState;
    if (
      action.type === "profile_intake_reconciliation_decision"
      && taskState.workflowId === "guided_profile_intake"
      && taskState.stage === "confirm_commit"
      && taskState.knownSlots.profileIntakeExplicitCommit === true
    ) {
      const finalizeTurnId = current.activeTurn?.id ?? turnId;
      const finalizeThinkingId = `agent-profile-intake-finalize-${operationId}`;
      current = appendAgentMessage(current, "assistant", "正在沿用已确认的保存意图完成写入核验…", {
        id: finalizeThinkingId,
        turnId: finalizeTurnId,
        kind: "assistant_thinking",
        type: "assistant_thinking",
        status: "thinking",
        streaming: true
      });
      const decision = new ProfileIntakeFinalizationSupervisor().decide({
        text: "确认",
        stage: taskState.stage,
        reviewProjection: taskState.knownSlots.profileIntakeReviewProjection,
        explicitCommit: true
      });
      const finalized = await this.finalizeProfileIntakeAtHostBoundary({
        current,
        taskState,
        turnId: finalizeTurnId,
        userMessageId: current.activeTurn?.userMessageId ?? `agent-user-${operationId}`,
        thinkingMessageId: finalizeThinkingId,
        now: new Date().toISOString(),
        controller: new AbortController()
      }, decision);
      this.patchSession(finalized, { turnStatus: finalized?.taskState?.completionStatus === "failed" ? "failed" : "completed" });
      return finalized;
    }
    if (shouldNarrateProfileIntakeContinuation(session.taskState, action, taskState)) {
      current = upsertProfileIntakeContinuation(
        current,
        profileIntakeContinuationNarration(taskState),
        turnId,
        operationId,
        currentTurn?.id
      );
    }
    // Artifact decisions can create a typed task decision without another
    // model turn (for example, accepting the last intake candidate). Keep
    // that decision visible immediately instead of leaving the user with an
    // apparently inert chat after the artifact is closed.
    if (taskState.pendingDecision) {
      current = attachPendingDecisionOptions(current, taskState.pendingDecision);
    }
    current = attachTaskStateOptions(current, current.taskState ?? taskState);
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current, { turnStatus: current.pendingConfirmation ? "waiting_for_confirmation" : "completed" });
    void pageContext;
    return current;
  }

  private async resolveTypedEntitySelection(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "select_entity" }>,
    pageContext: AgentPageContext
  ) {
    const prepared = await this.applyTypedEntitySelection(session, action, { continueAfter: true });
    if (!prepared.applied) return prepared.session;
    return this.resume(prepared.session, {
      reason: "external_event",
      observation: { type: "entity_selected", entityType: action.entityType, entityId: action.entityId }
    }, pageContext, prepared.turnId);
  }

  private async applyTypedEntitySelection(
    session: AgentSession,
    action: Extract<AgentOption["action"], { type: "select_entity" }>,
    options: { continueAfter: boolean; userMessage?: string }
  ): Promise<{ session: AgentSession; turnId: string; applied: boolean }> {
    if (!session.taskState) return { session, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
    const candidatesKey = action.entityType === "job" ? "jobCandidates" : "resumeCandidates";
    const revisionKey = action.entityType === "job" ? "jobCandidateSetRevision" : "resumeCandidateSetRevision";
    const candidates = Array.isArray(session.taskState.knownSlots[candidatesKey])
      ? (session.taskState.knownSlots[candidatesKey] as unknown[]).map(objectValue)
      : [];
    const candidate = candidates.find((item) => item.id === action.entityId);
    if (!candidate || session.taskState.knownSlots[revisionKey] !== action.candidateSetRevision) {
      const stale = withArtifactActionFeedback(session, { type: "resume_import_review_decision", decision: "ignore_uncertain" }, {
        result: "stale",
        message: "候选列表已更新，请重新选择。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(stale);
      this.patchSession(saved);
      return { session: saved, turnId: `agent-turn-${crypto.randomUUID()}`, applied: false };
    }
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.reduce(session.taskState, {
      type: "entity_revision",
      entityType: action.entityType,
      entityId: action.entityId,
      revisionId: action.entityType === "resume" ? stringValue(candidate.currentRevisionId) : undefined,
      version: typeof candidate.revision === "number" || typeof candidate.revision === "string" ? candidate.revision : stringValue(candidate.updatedAt)
    });
    taskState = {
      ...taskState,
      stage: action.entityType === "job" && taskState.selectedEntities.profileId && taskState.selectedEntities.resumeId
        ? "analyze_fit"
        : action.entityType === "resume" && taskState.selectedEntities.jobId
          ? "analyze_fit"
          : action.entityType === "resume" ? "choose_job" : taskState.stage,
      completionStatus: "active",
      updatedAt: new Date().toISOString()
    };
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const label = action.entityType === "job"
      ? `${String(candidate.title ?? "岗位")}${candidate.company ? ` · ${String(candidate.company)}` : ""}`
      : String(candidate.name ?? "简历");
    let current = withTurnCheckpoint(supersedeActiveOptionSets(session), turnId, userMessageId, taskState.updatedAt);
    current = appendAgentMessage(current, "user", options.userMessage ?? label, {
      id: userMessageId,
      turnId,
      status: "complete",
      metadata: {
        executionState: options.userMessage ? "running" : "complete",
        executionOwner: "deterministic_transition",
        selectedEntityType: action.entityType,
        selectedEntityId: action.entityId
      }
    });
    current = projectTaskStateIntoSession(current, taskState);
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: userMessageId,
        userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        executionOwner: "deterministic_transition",
        status: "running",
        startedAt: taskState.updatedAt
      }
    };
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current);
    if (!options.continueAfter) return { session: current, turnId, applied: true };
    return { session: current, turnId, applied: true };
  }

  private async resume(
    session: AgentSession,
    internal: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    },
    pageContext: AgentPageContext,
    turnId: string,
    options: {
      executionOwner?: AgentTurn["executionOwner"];
      runtimeDiagnostics?: Partial<Pick<AgentTurn, "preferredRuntime" | "attemptedRuntime" | "finalRuntime" | "executionOwner" | "fallbackUsed" | "fallbackReasonCode" | "hermesRunId" | "nextHermesRunId" | "firstEventAt" | "runtimeFailureAt">>;
    } = {}
  ) {
    const existing = this.executionCoordinator.get(session.id);
    if (existing?.promise) {
      this.executionCoordinator.interrupt(session.id, createRunStopReason({
        requestedBy: "agent_runtime_provider",
        reasonCode: "new_turn_superseded",
        sourceComponent: "AgentHostStore.resume",
        sessionId: session.id,
        logicalTurnId: existing.activeTurnId ?? turnId,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
      await existing.promise;
    }
    const startedAt = new Date().toISOString();
    const executionRecord = this.executionCoordinator.begin({ sessionId: session.id, activeTurnId: turnId, startedAt });
    const controller = executionRecord.controller;
    const generation = executionRecord.generation;
    const thinkingMessageId = `agent-thinking-${crypto.randomUUID()}`;
    let current = appendAgentMessage(session, "assistant", "正在根据确认结果继续…", {
      id: thinkingMessageId,
      turnId,
      kind: "assistant_thinking",
      type: "assistant_thinking",
      status: "thinking",
      streaming: true
    });
    current = {
      ...current,
      activeTurn: {
        ...current.activeTurn,
        id: turnId,
        sessionId: current.id,
        sourceUserMessageId: current.activeTurn?.sourceUserMessageId ?? current.activeTurn?.userMessageId,
        userMessageId: current.activeTurn?.userMessageId,
        preferredRuntime: current.activeTurn?.preferredRuntime ?? "native",
        attemptedRuntime: current.activeTurn?.attemptedRuntime ?? "native",
        finalRuntime: current.activeTurn?.finalRuntime ?? "native",
        fallbackUsed: current.activeTurn?.fallbackUsed ?? false,
        ...options.runtimeDiagnostics,
        executionOwner: options.executionOwner ?? options.runtimeDiagnostics?.executionOwner ?? current.activeTurn?.executionOwner ?? "runtime_continuation",
        status: "running",
        startedAt: current.activeTurn?.startedAt ?? startedAt
      }
    };
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current, {
      turnStatus: "running",
      activeTurnId: turnId,
      currentObservation: internal.observation
    });
    const execution = this.consume({
      generation,
      controller,
      current,
      thinkingMessageId,
      turnId,
      pageContext,
      resume: internal
    });
    const trackedExecution = execution.finally(() => {
      this.executionCoordinator.finish(current.id, undefined, generation);
      if (this.snapshot.activeSessionId === current.id) {
        this.patch({ controllerState: this.executionCoordinator.getState(current.id) });
      }
    });
    this.executionCoordinator.attachPromise(current.id, trackedExecution);
    return trackedExecution;
  }

  private async consume(input: {
    generation: number;
    controller: AbortController;
    current: AgentSession;
    thinkingMessageId: string;
    turnId: string;
    pageContext: AgentPageContext;
    userMessage?: string;
    references?: AgentMessageReference[];
    turnDecision?: TurnIntentDecision;
    narrationOnly?: boolean;
    resume?: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    };
  }) {
    let current = input.current;
    let visible = "";
    let activeStreamId: string | undefined;
    let activeIterationId: string | undefined;
    let finalDone = false;
    const onEvent = async (event: AgentStreamEvent) => {
      if (!this.executionCoordinator.isCurrent(input.current.id, input.generation)) return;
      if ("turnId" in event && event.turnId && event.turnId !== input.turnId) return;
      if (isProgressEvent(event)) this.markProgress(input.current.id);
      const execution = this.executionCoordinator.appendStreamEvent(input.current.id, event);
      if (this.snapshot.activeSessionId === input.current.id) {
        this.patch({ streamEvents: execution?.streamEvents ?? [event] });
      }
      if (event.type === "thinking") {
        current = {
          ...current,
          messages: current.messages.map((message) => message.id === input.thinkingMessageId
            ? { ...message, content: event.label, updatedAt: new Date().toISOString() }
            : message)
        };
      }
      if (event.type === "skill_loaded") {
        current = upsertAgentActivity(current, {
          id: `agent-skill-${input.turnId}-${event.skillId}`,
          turnId: input.turnId,
          content: event.label,
          toolName: "skill_loaded",
          status: "complete",
          metadata: { skillId: event.skillId, activityState: "complete" }
        });
      }
      if (event.type === "tool_started") {
        current = upsertAgentActivity(current, {
          id: `agent-tool-${event.operationId}`,
          turnId: input.turnId,
          content: event.userLabel,
          toolName: event.toolName,
          operationId: event.operationId,
          status: "pending",
          metadata: { activityState: "running" }
        });
      }
      if (event.type === "tool_result") {
        current = upsertAgentActivity(current, {
          id: `agent-tool-${event.operationId}`,
          turnId: input.turnId,
          content: event.summary,
          toolName: event.toolName,
          operationId: event.operationId,
          status: event.ok ? "complete" : "failed",
          metadata: { activityState: event.ok ? "complete" : "failed", artifactIds: event.artifactIds ?? [] }
        });
        if (event.ok && event.toolName === "parse_job_description") {
          const now = new Date().toISOString();
          const artifactId = event.artifactIds?.[0] ?? `agent-artifact-parse_job_description-${event.operationId}`;
          current = {
            ...current,
            artifactRefs: [
              ...current.artifactRefs.filter((artifact) => artifact.id !== artifactId),
              {
                id: artifactId,
                kind: "job_semantic_review",
                title: "岗位语义核对",
                entityType: "job",
                entityId: `pending-${event.operationId}`,
                status: "active",
                summary: event.summary,
                createdAt: now,
                updatedAt: now
              }
            ]
          };
        }
        if (event.ok && event.toolName === "prepare_resume_import") {
          const now = new Date().toISOString();
          const artifactId = event.artifactIds?.[0] ?? `agent-artifact-prepare_resume_import-${event.operationId}`;
          const observation = objectValue(this.snapshot.currentObservation);
          const taskObservation = objectValue(current.taskState?.lastObservation);
          const result = objectValue(taskObservation.value ?? observation);
          const importId = stringValue(result.importId) ?? `pending-${event.operationId}`;
          current = {
            ...current,
            artifactRefs: [
              ...current.artifactRefs.filter((artifact) => artifact.id !== artifactId),
              {
                id: artifactId,
                kind: "resume_import_review",
                title: "简历导入核对",
                entityType: "resume_import_draft",
                entityId: importId,
                status: "active",
                summary: event.summary,
                createdAt: now,
                updatedAt: now
              }
            ]
          };
        }
        if (event.ok && event.toolName === "capture_profile_intake") {
          const now = new Date().toISOString();
          const artifactId = event.artifactIds?.[0] ?? `agent-artifact-capture_profile_intake-${event.operationId}`;
          const taskObservation = objectValue(current.taskState?.lastObservation);
          const result = objectValue(taskObservation.value);
          const importId = stringValue(result.importId) ?? `pending-${event.operationId}`;
          current = {
            ...current,
            artifactRefs: [
              ...current.artifactRefs.filter((artifact) => artifact.id !== artifactId),
              {
                id: artifactId,
                kind: "profile_intake_review",
                title: "经历核对",
                entityType: "profile_intake_draft",
                entityId: importId,
                status: "active",
                summary: event.summary,
                createdAt: now,
                updatedAt: now
              }
            ]
          };
        }
        if (event.ok && ["analyze_job_fit", "create_tailoring_session", "answer_tailoring_question", "generate_tailoring_changes", "review_tailoring_diff", "preview_tailoring_changes", "apply_tailoring_changes", "create_resume_from_profile", "compose_resume", "export_resume"].includes(event.toolName)) {
          const now = new Date().toISOString();
            const descriptor = artifactDescriptor(
              event.toolName,
              current.taskState?.workflowId ?? current.workflowState?.workflowId,
              current.taskState?.rootGoal
            );
            if (descriptor) {
            const lastObservation = objectRecordValue(current.taskState?.lastObservation);
            const observation = objectRecordValue(lastObservation.value);
            const observationResume = objectRecordValue(observation.resume);
            const entityId = descriptor.kind === "tailoring_workspace"
              ? stringRecordValue(objectRecordValue(observation.session).id)
                ?? stringRecordValue(objectRecordValue(current.taskState?.knownSlots.tailoringSession).id)
                ?? `pending:${current.taskState?.selectedEntities.jobId ?? event.operationId}`
              : descriptor.entityType === "job"
              ? stringRecordValue(observation.jobId)
                ?? current.taskState?.selectedEntities.jobId
                ?? stringRecordValue(observation.resumeId)
                ?? `pending-${event.operationId}`
              : descriptor.entityType === "resume_branch"
                ? resumeArtifactEntityId(observation, current)
                : stringRecordValue(observation.resumeId)
                  ?? stringRecordValue(observation.branchId)
                  ?? stringRecordValue(observationResume.id)
                  ?? current.taskState?.selectedEntities.resumeId
                  ?? current.taskState?.selectedEntities.jobId
                  ?? `pending-${event.operationId}`;
            if (entityId) {
              const artifactId = descriptor.kind === "tailoring_workspace"
                ? `tailoring-workspace:${entityId}`
                : event.artifactIds?.[0] ?? `agent-artifact-${event.toolName}-${event.operationId}`;
              const route = event.toolName === "export_resume" && typeof observation.route === "string"
                ? observation.route
                : descriptor.route;
              current = {
                ...current,
                artifactRefs: [
                  ...current.artifactRefs.filter((artifact) => descriptor.kind === "tailoring_workspace"
                    ? !["tailoring_workspace", "job_fit_overview", "tailoring_diff"].includes(artifact.kind)
                    : artifact.id !== artifactId),
                  {
                    id: artifactId,
                    kind: descriptor.kind,
                    title: descriptor.title,
                    entityType: descriptor.entityType,
                    entityId,
                    route,
                    status: "active",
                    summary: event.summary,
                    createdAt: now,
                    updatedAt: now
                  }
                ]
              };
            }
          }
        }
        if (this.snapshot.activeSessionId === input.current.id) {
          this.patch({ currentObservation: { toolName: event.toolName, summary: event.summary } });
        }
        await this.dependencies.persistence.save(current);
      }
      if (event.type === "assistant_start") {
        if (finalDone) return;
        if (activeStreamId || activeIterationId) return;
        activeStreamId = event.streamId;
        activeIterationId = event.iterationId;
        visible = "";
        current = {
          ...current,
          messages: current.messages.map((message) => message.id === input.thinkingMessageId
            ? {
                ...message,
                turnId: input.turnId,
                content: "",
                kind: "assistant_streaming" as const,
                type: "assistant_streaming" as const,
                status: "streaming" as const,
                streaming: true,
                updatedAt: new Date().toISOString()
              }
            : message)
        };
      }
      if (event.type === "assistant_delta") {
        if (finalDone || !matchesActiveStream(event, activeStreamId, activeIterationId)) return;
        visible += event.delta;
        current = {
          ...current,
          messages: current.messages.map((message) => message.id === input.thinkingMessageId
            ? { ...message, content: visible, status: "streaming" as const, streaming: true, updatedAt: new Date().toISOString() }
            : message)
        };
      }
      if (event.type === "confirmation_required") {
        const confirmation = { ...event.confirmation as NonNullable<AgentSession["pendingConfirmation"]>, turnId: input.turnId };
        current = {
          ...current,
          messages: current.messages.map((message) => message.id === input.thinkingMessageId
            ? {
                ...message,
                content: confirmation.description || "请核对这一步，确认后我会自动继续。",
                kind: "text" as const,
                type: "text" as const,
                status: "complete" as const,
                streaming: false,
                updatedAt: new Date().toISOString()
              }
            : message),
          pendingConfirmation: confirmation,
          ...(current.workflowState
            ? { workflowState: { ...current.workflowState, status: "waiting_for_confirmation" as const } }
            : {})
        };
      }
      if (event.type === "done") {
        if (finalDone || !matchesActiveStream(event, activeStreamId, activeIterationId)) return;
        finalDone = true;
        current = replaceAgentThinking(current, input.thinkingMessageId, event.message?.trim() || visible, input.turnId);
      }
      if (event.type === "error") {
        current = replaceAgentThinking(current, input.thinkingMessageId, event.message, input.turnId);
        current = {
          ...current,
          messages: current.messages.map((message) => message.id === input.thinkingMessageId
            ? {
                ...message,
                kind: "error_status" as const,
                type: "error" as const,
                status: "failed" as const,
                errorCode: event.code
              }
              : message)
        };
        current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      }
      this.patchSession(current);
    };

    try {
      const kernel = this.dependencies.kernel;
      if (!kernel) throw new Error("agent_kernel_disabled_for_production");
      const result = input.resume
        ? await kernel.resumeTurn({
            session: current,
            pageContext: input.pageContext,
            reason: input.resume.reason,
            observation: input.resume.observation,
            toolName: input.resume.toolName,
            signal: input.controller.signal,
            emit: onEvent,
            profileIntakeSourceTurns: await this.dependencies.persistence.listProfileIntakeSourceTurns?.(current.id)
          })
        : await kernel.runTurn({
            session: current,
            pageContext: input.pageContext,
            userMessage: input.userMessage ?? "",
            references: input.references,
            turnId: input.turnId,
            turnIntent: input.turnDecision?.intent,
            profileIntakeTurnKind: input.turnDecision?.profileIntakeTurnKind,
            toolScope: input.turnDecision?.toolScope,
            narrationOnly: input.narrationOnly,
            taskEventAlreadyReduced: true,
            profileIntakeSourceTurns: await this.dependencies.persistence.listProfileIntakeSourceTurns?.(current.id),
            signal: input.controller.signal,
            emit: onEvent
          });
      if (input.controller.signal.aborted) return this.snapshot.activeSession;
      if (!this.executionCoordinator.isCurrent(input.current.id, input.generation)) return this.dependencies.persistence.get(input.current.id);
      if (result.protocolDiagnostics?.length) {
        await this.persistProtocolDiagnostics(current, input.turnId, result.protocolDiagnostics);
      }
      const isolatedConversationalTurn = input.turnDecision?.intent === "casual_side_turn"
        || input.turnDecision?.intent === "reference_followup";
      const hasRecoverableRecoveryText = result.text?.includes("重新执行当前步骤") === true;
      let outcome: "waiting_for_confirmation" | "waiting_for_user" | "failed" | "aborted" | "completed" = isolatedConversationalTurn
        ? result.trajectory.outcome === "aborted" ? "aborted" : "completed"
        : result.pendingConfirmation
        ? "waiting_for_confirmation"
        : result.taskState?.completionStatus === "waiting_for_confirmation"
          ? "waiting_for_confirmation"
          : result.taskState?.completionStatus === "waiting_for_user"
            ? "waiting_for_user"
            : result.taskState?.completionStatus === "failed"
              ? "failed"
        : result.trajectory.outcome === "failed"
          ? "failed"
          : result.trajectory.outcome === "aborted"
            ? "aborted"
            : result.trajectory.outcome === "waiting_for_user"
              ? "waiting_for_user"
              : "completed";
      if (!isolatedConversationalTurn && hasRecoverableRecoveryText) outcome = "failed";
      const settledTaskState = result.taskState
        ? reconcileTaskStateCompletionStatus(result.taskState, outcome, isolatedConversationalTurn)
        : undefined;
      current = {
        ...current,
        trajectory: result.trajectory,
        reflection: result.reflection,
        conversationSummary: result.conversationSummary ?? current.conversationSummary,
        conversationSummaryBranchId: current.activeBranchId,
        taskState: settledTaskState ?? current.taskState,
        pendingConfirmation: isolatedConversationalTurn
          ? current.pendingConfirmation
          : result.pendingConfirmation
            ? { ...result.pendingConfirmation, turnId: input.turnId }
            : undefined,
        pendingToolCall: isolatedConversationalTurn
          ? current.pendingToolCall
          : result.pendingCall
            ? { ...result.pendingCall, turnId: input.turnId }
            : undefined,
        activeTurn: {
          ...current.activeTurn!,
          id: input.turnId,
          status: outcome,
          completedAt: outcome === "waiting_for_confirmation" ? undefined : new Date().toISOString()
        },
        workflowState: settledTaskState
          ? projectTaskStateToWorkflowState(settledTaskState, current.workflowState)
          : current.workflowState
      };
      const importedId = settledTaskState?.rootGoal === "import_resume"
        ? stringValue(settledTaskState.knownSlots.importId)
        : undefined;
      if (importedId) {
        current = {
          ...current,
          artifactRefs: current.artifactRefs.map((artifact) =>
            artifact.kind === "resume_import_review" && artifact.entityId.startsWith("pending-")
              ? { ...artifact, entityId: importedId, updatedAt: new Date().toISOString() }
              : artifact
          )
        };
      }
      if (settledTaskState) current = reconcileTaskArtifacts(current, settledTaskState);
      if (settledTaskState?.pendingDecision) {
        current = attachPendingDecisionOptions(current, settledTaskState.pendingDecision);
      }
      if (settledTaskState) current = attachTaskStateOptions(current, settledTaskState);
      if (result.text?.includes("重新执行当前步骤")) {
        current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      }
      current = settleThinkingMessages(current, input.turnId);
      current = markTurnTerminalState(current, input.turnId, outcome, isolatedConversationalTurn);
      const continuity = evaluateConversationContinuity(current, input.turnId);
      if (!continuity.ok) {
        current = replaceTurnWithContinuityRecovery(current, input.turnId, continuity.reasonCode);
        outcome = "failed";
      }
      current = settleUserExecutionState(current, input.turnId, outcome === "failed" ? "failed" : outcome === "aborted" ? "aborted" : "complete");
      current = completeTurnCheckpoint(current, input.turnId, new Date().toISOString());
      current = await this.dependencies.persistence.save(current);
      this.executionCoordinator.setStatus(
        current.id,
        outcome === "waiting_for_confirmation"
          ? "waiting_for_confirmation"
          : outcome === "waiting_for_user"
            ? "waiting_for_user"
            : outcome === "failed"
              ? "failed"
              : "completed"
      );
      this.patchSession(current, {
        turnStatus: outcome === "waiting_for_confirmation" ? "waiting_for_confirmation" : outcome === "failed" ? "failed" : "completed",
        pendingConfirmation: current.pendingConfirmation,
        uiAction: outcome === "completed" ? resumePreviewUiAction(current) : undefined
      });
      this.notifyBackgroundCompletion(current, outcome === "failed" ? "failed" : outcome === "waiting_for_user" ? "waiting_for_user" : outcome === "waiting_for_confirmation" ? "waiting_for_confirmation" : "completed");
      return current;
    } catch (error) {
      if (input.controller.signal.aborted) return this.snapshot.activeSession;
      current = completeTurn(current, "failed");
      current = settleUserExecutionState(current, input.turnId, "failed");
      current = appendAgentMessage(current, "assistant", "本轮回答暂时中断，当前进度和输入已保留。", {
        turnId: input.turnId,
        kind: "error_status",
        type: "error",
        status: "failed",
        errorCode: errorCode(error),
        metadata: {
          terminalState: "RECOVERABLE_FAILURE",
          ...(isHermesRuntimeFailureCode(errorCode(error))
            ? { runtimeFailurePresentation: "topbar" }
            : {})
        },
        options: [{ id: "retry-current-step", label: "重新执行当前步骤", action: { type: "retry_current_step" } }]
      });
      current = await this.dependencies.persistence.save(current);
      this.executionCoordinator.setStatus(current.id, "failed");
      this.patchSession(current, { turnStatus: "failed" });
      this.notifyBackgroundCompletion(current, "failed");
      return current;
    } finally {
      if (this.executionCoordinator.isCurrent(input.current.id, input.generation)) {
        this.executionCoordinator.finish(input.current.id, undefined, input.generation);
        if (this.snapshot.activeSessionId === input.current.id) {
          this.patch({ controllerState: this.executionCoordinator.getState(input.current.id) });
        }
        this.clearStallTimer(input.current.id);
        const activeForSession = this.snapshot.activeSession?.id === input.current.id
          ? this.snapshot.activeSession
          : current;
        const settled = settleThinkingMessages(activeForSession, input.turnId);
        if (settled !== activeForSession) {
          void this.dependencies.persistence.save(settled);
          this.patchSession(settled, { stalled: false });
        } else {
          if (this.snapshot.activeSessionId === input.current.id) this.patch({ stalled: false });
        }
        void this.drainPendingInput(input.current.id);
      }
    }
  }

  private async persistProtocolDiagnostics(
    session: AgentSession,
    turnId: string,
    diagnostics: Array<{
      provider?: string;
      model?: string;
      providerResponseShape?: string[];
      markerKinds: string[];
      requestedToolName?: string;
      unknownToolNames?: string[];
      allowedToolNames: string[];
      argumentShape?: Record<string, string>;
      stopReason?: string;
      nativeToolCallsPresent: boolean;
      safeErrorCode?: string;
      repairPath?: string;
      providerErrorCode?: string;
      providerHttpStatus?: number;
      retryable?: boolean;
      recoveryAttempted?: boolean;
    }>
  ) {
    const save = this.dependencies.persistence.saveAgentProtocolDiagnostic;
    if (typeof save !== "function") return;
    for (const diagnostic of diagnostics) {
      try {
        await save.call(this.dependencies.persistence, {
          provider: diagnostic.provider,
          model: diagnostic.model,
          providerResponseShape: diagnostic.providerResponseShape,
          workflowId: session.taskState?.workflowId ?? session.workflowState?.workflowId,
          stage: session.taskState?.stage ?? session.workflowState?.step,
          sessionId: session.id,
          activeBranchId: session.activeBranchId,
          turnId,
          stopReason: diagnostic.stopReason,
          nativeToolCallsPresent: diagnostic.nativeToolCallsPresent,
          markerKinds: diagnostic.markerKinds,
          requestedToolName: diagnostic.requestedToolName,
          unknownToolNames: diagnostic.unknownToolNames,
          allowedToolNames: diagnostic.allowedToolNames,
          argumentShape: diagnostic.argumentShape,
          repairPath: diagnostic.repairPath ?? "none",
          safeErrorCode: diagnostic.safeErrorCode ?? "protocol_observed",
          providerErrorCode: diagnostic.providerErrorCode,
          providerHttpStatus: diagnostic.providerHttpStatus,
          retryable: diagnostic.retryable,
          recoveryAttempted: diagnostic.recoveryAttempted ?? Boolean(diagnostic.repairPath && diagnostic.repairPath !== "none")
        });
      } catch {
        // Diagnostics must never turn a recovered workflow into a failed turn.
      }
    }
  }

  private async enqueueUserInput(input: {
    session: AgentSession;
    userMessage: string;
    pageContext: AgentPageContext;
    references?: AgentMessageReference[];
  }) {
    const session = this.snapshot.activeSession?.id === input.session.id
      ? this.snapshot.activeSession
      : input.session;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const queued = appendAgentMessage(session, "user", input.userMessage.trim(), {
      id: userMessageId,
      status: "pending",
      references: input.references?.length ? input.references : undefined,
      metadata: {
        executionState: "queued",
        queuedPageContext: input.pageContext
      }
    });
    const saved = await this.dependencies.persistence.save(queued);
    const queue = this.pendingInputs.get(session.id) ?? [];
    queue.push({
      sessionId: session.id,
      userMessage: input.userMessage,
      userMessageId,
      pageContext: input.pageContext,
      references: input.references
    });
    this.pendingInputs.set(session.id, queue);
    this.patchSession(saved, { pendingInputCount: queue.length });
    return saved;
  }

  private async drainPendingInput(sessionId: string) {
    if (this.executionCoordinator.isRunning(sessionId)) return;
    const queue = this.pendingInputs.get(sessionId);
    const next = queue?.shift();
    if (!next) {
      this.pendingInputs.delete(sessionId);
      this.executionCoordinator.setPendingInputCount(sessionId, 0);
      if (this.snapshot.activeSessionId === sessionId) this.patch({ pendingInputCount: 0 });
      return;
    }
    if (!queue?.length) this.pendingInputs.delete(sessionId);
    const session = typeof this.dependencies.persistence.get === "function"
      ? await this.dependencies.persistence.get(sessionId)
      : this.snapshot.activeSession?.id === sessionId
        ? this.snapshot.activeSession
        : undefined;
    if (!session) return;
    this.executionCoordinator.setPendingInputCount(sessionId, queue?.length ?? 0);
    if (this.snapshot.activeSessionId === sessionId) this.patch({ pendingInputCount: queue?.length ?? 0 });
    await this.startTurn({
      session,
      userMessage: next.userMessage,
      userMessageId: next.userMessageId,
      appendUserMessage: false,
      pageContext: next.pageContext,
      references: next.references
    });
  }

  private clearQueuedInputs(session: AgentSession) {
    const queuedIds = new Set((this.pendingInputs.get(session.id) ?? []).map((input) => input.userMessageId));
    if (!queuedIds.size) return session;
    this.pendingInputs.delete(session.id);
    this.executionCoordinator.setPendingInputCount(session.id, 0);
    if (this.snapshot.activeSessionId === session.id) this.patch({ pendingInputCount: 0 });
    return {
      ...session,
      messages: session.messages.map((message) => queuedIds.has(message.id)
        ? {
            ...message,
            status: "complete" as const,
            metadata: { ...message.metadata, executionState: "superseded" }
          }
        : message)
    };
  }

  private patchSession(session: AgentSession, patch: Partial<AgentHostSnapshot> = {}) {
    if (this.snapshot.activeSessionId !== session.id && this.snapshot.activeSessionId !== undefined) return;
    this.patch({
      activeSessionId: session.id,
      activeSession: session,
      activeTask: session.taskState,
      pendingConfirmation: session.pendingConfirmation,
      artifacts: session.artifactRefs,
      ...patch
    });
  }

  private notifyBackgroundCompletion(session: AgentSession, status: SessionExecution["status"]) {
    if (typeof window === "undefined" || this.snapshot.activeSessionId === session.id) return;
    if (!["completed", "failed", "waiting_for_confirmation", "waiting_for_user"].includes(status)) return;
    window.dispatchEvent(new CustomEvent("careeradapt-agent-background-complete", {
      detail: { sessionId: session.id, title: session.title, status }
    }));
  }

  private async applyWorkflowControl(session: AgentSession, action: AgentWorkflowControl) {
    if (!session.taskState || !session.workflowState) return session;
    if (action.type === "cancel_workflow") {
      this.interrupt(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "workflow_cancelled",
        sourceComponent: "AgentHostStore.applyWorkflowControl",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
      const current = await this.dependencies.persistence.save({
        ...completeTurn(session, "aborted"),
        workflowState: { ...session.workflowState, status: "completed" },
        taskState: session.taskState
          ? { ...session.taskState, completionStatus: "cancelled", updatedAt: new Date().toISOString() }
          : session.taskState
      });
      this.patchSession(current, { turnStatus: "completed" });
      return current;
    }
    if (action.type === "pause_workflow") {
      this.interrupt(session.id, createRunStopReason({
        requestedBy: "user",
        reasonCode: "workflow_paused",
        sourceComponent: "AgentHostStore.applyWorkflowControl",
        sessionId: session.id,
        logicalTurnId: session.activeTurn?.id,
        runId: session.hermesRun?.runId,
        incidentTraceId: session.activeTurn?.incidentTraceId
      }));
      const current = await this.dependencies.persistence.save({
        ...session,
        workflowState: { ...session.workflowState, status: "paused" }
      });
      this.patchSession(current, { turnStatus: "paused" });
      return current;
    }
    if (action.type === "resume_workflow") {
      this.patch({ turnStatus: "idle" });
      return session;
    }
    if (action.type === "go_back") {
      const current = await this.dependencies.persistence.save({
        ...session,
        workflowState: { ...session.workflowState, status: "waiting_for_user" }
      });
      this.patchSession(current, { turnStatus: "idle" });
      return current;
    }
    // Explicit UI workflow buttons may seed TaskState, but execution remains
    // owned by the next AgentHost turn.
    const reducer = new AgentTaskStateReducer();
    const current = await this.dependencies.persistence.save({
      ...session,
      workflowState: {
        workflowId: action.workflowId,
        step: "collecting_intent",
        status: "waiting_for_user",
        toolCallCount: 0,
        data: {}
      },
      taskState: reducer.create({
        ...session,
        workflowState: {
          workflowId: action.workflowId,
          step: "collecting_intent",
          status: "waiting_for_user",
          toolCallCount: 0,
          data: {}
        }
      })
    });
    this.patchSession(current, { turnStatus: "idle" });
    return current;
  }

  private patch(patch: Partial<AgentHostSnapshot>) {
    const sessionId = patch.activeSessionId ?? this.snapshot.activeSessionId;
    const controllerState = patch.controllerState
      ?? (sessionId ? this.executionCoordinator.getState(sessionId) : this.snapshot.controllerState);
    this.snapshot = { ...this.snapshot, ...patch, controllerState };
    for (const listener of this.listeners) listener();
  }

  private markProgress(sessionId = this.snapshot.activeSessionId) {
    if (!sessionId) return;
    const execution = this.executionCoordinator.get(sessionId);
    if (!execution) return;
    const now = new Date().toISOString();
    this.executionCoordinator.markProgress(sessionId, now);
    if (this.snapshot.activeSessionId === sessionId) this.patch({ lastProgressAt: now, stalled: false });
    this.clearStallTimer(sessionId);
    if (!this.executionCoordinator.isRunning(sessionId)) return;
    this.scheduleStallCheck(sessionId);
  }

  private scheduleStallCheck(sessionId: string) {
    const thresholdMs = this.dependencies.stallThresholdMs ?? 30_000;
    const execution = this.executionCoordinator.get(sessionId);
    if (!execution) return;
    const lastProgressAt = execution.lastProgressAt;
    const elapsedMs = lastProgressAt
      ? Math.max(0, Date.now() - Date.parse(lastProgressAt))
      : thresholdMs;
    const remainingMs = Math.max(0, thresholdMs - elapsedMs);
    this.stallTimers.set(sessionId, setTimeout(() => {
      const current = this.executionCoordinator.get(sessionId);
      if (!current || current.status !== "running") return;
      const latestProgressAt = current.lastProgressAt;
      const latestElapsedMs = latestProgressAt
        ? Math.max(0, Date.now() - Date.parse(latestProgressAt))
        : thresholdMs;
      if (latestElapsedMs >= thresholdMs) {
        this.executionCoordinator.markStalled(sessionId, true);
        if (this.snapshot.activeSessionId === sessionId) this.patch({ stalled: true });
      } else {
        this.clearStallTimer(sessionId);
        this.scheduleStallCheck(sessionId);
      }
    }, remainingMs));
  }

  private clearStallTimer(sessionId: string) {
    const timer = this.stallTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.stallTimers.delete(sessionId);
  }
}

function isUiAction(action: AgentUiAction | AgentWorkflowControl): action is AgentUiAction {
  return [
    "open_resume_picker",
    "open_resume_upload",
    "open_job_import_dialog",
    "open_profile_browser",
    "open_tool_palette",
    "request_resume_import_consent",
    "open_import_review",
    "open_artifact",
    "select_tailoring_question"
  ].includes(action.type);
}

function completeTurn(session: AgentSession, status: "failed" | "aborted") {
  if (!session.activeTurn) return session;
  return {
    ...session,
    activeTurn: {
      ...session.activeTurn,
      status,
      completedAt: new Date().toISOString()
    }
  };
}

function sessionTurnStatus(session: AgentSession): AgentHostSnapshot["turnStatus"] {
  if (session.pendingConfirmation) return "waiting_for_confirmation";
  if (session.workflowState?.status === "paused") return "paused";
  if (session.activeTurn?.status === "running") return "running";
  if (session.taskState?.completionStatus === "waiting_for_user") return "waiting_for_user";
  if (session.taskState?.completionStatus === "failed") return "failed";
  if (session.activeTurn?.status === "completed") return "completed";
  return "idle";
}

function errorCode(value: unknown) {
  return typeof value === "object" && value && "code" in value ? String(value.code) : "agent_runtime_failed";
}

function readToolArray(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== "object") return [];
  const result = value as { ok?: unknown; data?: unknown };
  if (result.ok === false || !result.data || typeof result.data !== "object") return [];
  const rows = (result.data as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows : [];
}

function emptyQuickActionCounts() {
  return {
    basics: 0,
    education: 0,
    work: 0,
    internship: 0,
    project: 0,
    research: 0,
    campus: 0,
    volunteer: 0,
    skills: 0,
    certificates: 0,
    awards: 0,
    languages: 0,
    publications: 0,
    patents: 0,
    other: 0
  };
}

function importTargetPrompt(snapshot: QuickActionContextSnapshot) {
  const label = quickActionProfileLabel(snapshot) ?? "当前人物与版本";
  return `准备导入到“${label}”。当前资料库已有 ${quickActionProfileCountSummary(snapshot)}。\n导入后会先比对已有事实；完全重复项不会重复新增，近似重复和字段冲突会在核对页让你选择，不会静默覆盖。`;
}

function importTargetOptions(snapshot: QuickActionContextSnapshot): AgentOption[] {
  const currentVersion = snapshot.activeProfile?.profileVersionNumber;
  const nextVersion = currentVersion ? currentVersion + 1 : undefined;
  return [
    ...(currentVersion
      ? [{ id: "resume-import-current", label: `合并到当前 V${currentVersion}`, action: { type: "quick_action_decision" as const, decision: "import_current_version" as const } }]
      : [{ id: "resume-import-select-context", label: "选择人物与版本", action: { type: "open_profile_browser" as const } }]),
    ...(nextVersion
      ? [{ id: "resume-import-new-version", label: `基于当前资料新建 V${nextVersion}`, action: { type: "quick_action_decision" as const, decision: "import_new_version" as const } }]
      : []),
    { id: "resume-import-new-person", label: "新建人物", action: { type: "quick_action_decision", decision: "import_new_person" } },
    { id: "resume-import-cancel", label: "取消", action: { type: "quick_action_decision", decision: "cancel_import" } }
  ];
}

function replaceLatestQuickActionAssistant(
  session: AgentSession,
  content: string,
  options?: AgentOption[]
) {
  const index = [...session.messages].findLastIndex((message) =>
    message.role === "assistant" && message.metadata?.quickActionKind === "resume_import_target"
  );
  if (index < 0) return appendAgentMessage(session, "assistant", content, {
    kind: "text",
    type: "text",
    status: "complete",
    options
  });
  const now = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message, messageIndex) => messageIndex === index
      ? {
          ...message,
          content,
          options,
          optionSet: options?.length ? activeOptionSetForMessage(session, message.id, "quick-action") : undefined,
          metadata: {
            ...message.metadata,
            quickActionResolution: "resolved",
            resolvedAt: now
          },
          updatedAt: now
        }
      : message),
    updatedAt: now
  };
}

export function findRecoverableProfileIntakeSource(
  session: AgentSession,
  taskState: AgentTaskState,
  currentMessage: string,
  allowEmptyCollectionCommitRecovery = false
) {
  const atEmptyCollectionBoundary = (
    taskState.stage === "collect_experience"
    && !taskState.knownSlots.latestIntakeSource
  );
  const recoveringCompletedIntake = (
    taskState.stage === "profile_complete"
    || taskState.stage === "resume_ready"
    || (
      taskState.completionStatus === "failed"
      && Boolean(taskState.knownSlots.profileCommitResult)
    )
  );
  const command = currentMessage.trim();
  const retryCommand = /^重试刚才[。！!]?$/i.test(command);
  const explicitCommitCommand = /^(?:导入|写入|保存|确认(?:导入|写入|保存)?|确认并(?:导入|写入|保存))[。！!]?$/u.test(command);
  if (
    taskState.workflowId !== "guided_profile_intake"
    || (!atEmptyCollectionBoundary && !recoveringCompletedIntake)
    || (
      !retryCommand
      && !(
        explicitCommitCommand
        && (recoveringCompletedIntake || (atEmptyCollectionBoundary && allowEmptyCollectionCommitRecovery))
      )
    )
  ) {
    return undefined;
  }
  const source = session.messages
    .filter((message) =>
      message.role === "user"
      && message.metadata?.retracted !== true
      && message.content.trim().length >= 2
      && classifyProfileIntakeTurn({ text: message.content, stage: "collect_experience" }) === "career_narrative"
    )
    .sort((left, right) =>
      profileIntakeRecoveryScore(right.content) - profileIntakeRecoveryScore(left.content)
    )[0];
  if (!source) return undefined;
  return {
    content: source.content,
    messageId: source.id,
    turnId: source.turnId,
    capturedAt: source.createdAt
  };
}

function profileIntakeRecoveryScore(content: string) {
  const concepts = [
    /项目/u,
    /实习/u,
    /比赛|竞赛/u,
    /负责/u,
    /开发/u,
    /组织|活动/u,
    /课题|实验室/u,
    /获奖/u
  ];
  return content.trim().length
    + concepts.reduce((score, pattern) => score + (pattern.test(content) ? 200 : 0), 0);
}

function dependencyCheckOperationId(operationId: string, entity: "profile" | "resume" | "job") {
  const suffix = `-dependency-${entity}`;
  return `${operationId.slice(0, 160 - suffix.length)}${suffix}`;
}

function objectRecordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function isAuthoritativeTailoringApplyResult(value: unknown) {
  const result = objectRecordValue(value);
  const quality = objectRecordValue(result.qualityResult);
  const receipt = ResumeArtifactReceiptSchema.safeParse(result.artifactReceipt ?? quality.artifactReceipt);
  return quality.status === "passed"
    && quality.factGuard === "passed"
    && quality.revisionCreated === true
    && quality.repositoryReadBackVerified === true
    && quality.resumeListVisibilityVerified === true
    && receipt.success
    && receipt.data.status === "completed";
}

function stringRecordValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

function scalarRecordValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function confirmedToolDiagnostic(
  toolName: string,
  result: {
    ok: boolean;
    data?: unknown;
    error?: { code?: string; retryable?: boolean };
  }
) {
  if (!result.ok) {
    return {
      ok: false,
      errorCode: result.error?.code ?? "agent_tool_failed",
      retryable: result.error?.retryable === true
    };
  }
  if (toolName !== "commit_profile_intake") return { ok: true };
  const receipt = objectRecordValue(result.data);
  return {
    ok: true,
    profileId: stringRecordValue(receipt.profileId),
    profileVersion: scalarRecordValue(receipt.profileVersion),
    committedItemCount: scalarRecordValue(receipt.committedItemCount),
    committedFactCount: scalarRecordValue(receipt.committedFactCount),
    idempotent: receipt.idempotent === true
  };
}

function isProgressEvent(event: AgentStreamEvent) {
  return [
    "assistant_start",
    "assistant_delta",
    "thinking",
    "tool_started",
    "tool_result",
    "artifact",
    "confirmation_required",
    "heartbeat"
  ].includes(event.type);
}

function matchesActiveStream(
  event: Extract<AgentStreamEvent, { type: "assistant_delta" | "done" }>,
  activeStreamId?: string,
  activeIterationId?: string
) {
  if (event.streamId && activeStreamId && event.streamId !== activeStreamId) return false;
  if (event.iterationId && activeIterationId && event.iterationId !== activeIterationId) return false;
  // Identified deltas must follow an identified start. Legacy unscoped events
  // remain accepted for route compatibility outside AgentKernel.
  if ((event.streamId || event.iterationId) && !activeStreamId && !activeIterationId) return false;
  return true;
}

function attachPendingDecisionOptions(
  session: AgentSession,
  decision: NonNullable<AgentTaskState["pendingDecision"]>
) {
  const options = taskDecisionOptions(decision);
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant"
      && message.kind !== "assistant_thinking"
      && !isWorkflowInteractionMessage(message)
  );
  if (assistantIndex < 0) return session;
  return {
    ...session,
    messages: session.messages.map((message, index) =>
      index === assistantIndex
        ? { ...message, options, optionSet: activeOptionSetForMessage(session, message.id, "decision") }
        : message
    )
  };
}

function taskDecisionOptions(
  decision: NonNullable<AgentTaskState["pendingDecision"]>
): AgentOption[] {
  return decision.options.map((option) => ({
    id: `decision-${decision.type}-${option}`,
    label: {
      profile: "使用个人资料库",
      existing_resume: "使用现有简历",
      session_only: "仅用于本次定制",
      save_job: "保存到岗位列表",
      switch_to_active: "写入当前资料库",
      keep_original: "继续写入原资料库",
      save_profile_only: decision.type === "profile_intake_post_save" ? "继续补充经历" : "仅保存资料库",
      generate_general_resume: "生成一份通用简历",
      finish: "暂时完成"
    }[option],
    action: {
      type: "task_decision",
      decisionType: decision.type,
      option
    }
  }));
}

function activeOptionSetForMessage(session: AgentSession, messageId: string, prefix = "agent-options"): AgentOptionSet {
  const existing = session.messages.find((message) => message.id === messageId)?.optionSet;
  const revision = existing?.state === "active" && existing.sourceMessageId === messageId
    ? existing.optionSetRevision
    : Math.max(-1, ...session.messages.map((message) => message.optionSet?.optionSetRevision ?? -1)) + 1;
  return {
    optionSetId: existing?.state === "active" && existing.sourceMessageId === messageId
      ? existing.optionSetId
      : `${prefix}-${messageId}-${revision}`,
    optionSetRevision: revision,
    sourceMessageId: messageId,
    state: "active"
  };
}

function supersedeActiveOptionSets(session: AgentSession) {
  const now = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message) => message.optionSet?.state === "active" && !isWorkflowInteractionMessage(message)
      ? {
          ...message,
          options: undefined,
          optionSet: { ...message.optionSet, state: "superseded" as const, resolvedAt: now },
          updatedAt: now
        }
      : message)
  };
}

function settleTailoringQuestionProjection(
  session: AgentSession,
  receipt: { questionPlanId: string; questionId: string; disposition: string; answerMessageId: string; consumedAt: string },
  now: string
) {
  const settled = {
    ...session,
    messages: session.messages.map((message) => {
      const isQuestion = message.role === "assistant"
        && message.metadata?.tailoringQuestionProjection === true
        && message.metadata?.questionPlanId === receipt.questionPlanId
        && message.metadata?.questionId === receipt.questionId;
      if (!isQuestion) return message;
      return {
        ...message,
        options: message.options?.map((option) => ({ ...option, disabled: true })),
        optionSet: message.optionSet
          ? {
              ...message.optionSet,
              state: "resolved" as const,
              resolvedValue: receipt.disposition,
              resolvedAt: receipt.consumedAt
            }
          : undefined,
        metadata: {
          ...message.metadata,
          questionProjectionState: "resolved",
          workflowInteractionState: "resolved",
          interactionResolvedAt: receipt.consumedAt,
          tailoringAnswerDisposition: receipt.disposition,
          answerMessageId: receipt.answerMessageId,
          answerConsumedAt: receipt.consumedAt
        },
        updatedAt: now
      };
    }),
    updatedAt: now
  };
  const state = settled.taskState;
  if (!state) return settled;
  const previous = objectValue(state.knownSlots.workflowInteractionDiagnostics);
  const previousActive = objectValue(previous.activeWorkflowInteraction);
  const history = Array.isArray(previous.interactionTransitionHistory)
    ? previous.interactionTransitionHistory.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    : [];
  const diagnostics = {
    activeWorkflowInteraction: undefined,
    interactionTransitionHistory: [
      ...history,
      {
        type: "resolved",
        interactionId: previousActive.interactionId ?? `workflow-interaction:clarification:${receipt.questionPlanId}:${receipt.questionId}`,
        checkpointId: previousActive.checkpointId,
        kind: "clarification",
        revision: previousActive.revision,
        messageId: previousActive.messageId,
        answerMessageId: receipt.answerMessageId,
        at: receipt.consumedAt
      }
    ].slice(-32),
    questionProjectionWriters: {
      count: 1,
      owners: ["TailoringWorkflowDriver"],
      invariant: "passed"
    }
  } satisfies Record<string, unknown>;
  return projectTaskStateIntoSession(settled, {
    ...state,
    knownSlots: {
      ...state.knownSlots,
      workflowInteractionDiagnostics: diagnostics
    }
  });
}

export function getActiveTailoringQuestionProjection(
  sessionOrState: AgentSession | AgentTaskState | undefined
): TailoringQuestionProjection | undefined {
  const state: AgentTaskState | undefined = sessionOrState && "taskState" in sessionOrState
    ? sessionOrState.taskState
    : sessionOrState as AgentTaskState | undefined;
  if (!state) return undefined;
  const workflowCheckpoint = state.workflowUserInputCheckpoint?.kind === "clarification"
    ? state.workflowUserInputCheckpoint
    : undefined;
  if (!workflowCheckpoint && state.stage !== "clarify_unsupported_facts") return undefined;
  const checkpointPrompt = objectValue(workflowCheckpoint?.promptProjection);
  const checkpointAllowed = objectValue(workflowCheckpoint?.allowedInput);
  const tailoringSession = objectValue(state.knownSlots.tailoringSession);
  const plan = objectValue(tailoringSession.plan);
  const questionPlan = objectValue(state.knownSlots.questionPlan ?? plan.questionPlan);
  const questionPlanId = stringValue(checkpointPrompt.questionPlanId) ?? stringValue(questionPlan.id);
  const questionPlanRevision = numberValue(checkpointPrompt.questionPlanRevision) ?? numberValue(questionPlan.revision);
  const questionId = stringValue(checkpointPrompt.questionId)
    ?? stringValue(state.knownSlots.activeQuestionId ?? questionPlan.activeQuestionId);
  const tailoringSessionId = stringValue(checkpointPrompt.tailoringSessionId)
    ?? stringValue(questionPlan.sessionId)
    ?? stringValue(tailoringSession.id)
    ?? state.selectedEntities.tailoringSessionId;
  const questionIds = Array.isArray(questionPlan.questionIds)
    ? questionPlan.questionIds.filter((id): id is string => typeof id === "string")
    : [];
  const questions = Array.isArray(plan.clarificationQuestions)
    ? plan.clarificationQuestions.map(objectValue)
    : [];
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!questionPlanId || questionPlanRevision === undefined || !questionId || !tailoringSessionId) return undefined;
  const questionText = stringValue(checkpointPrompt.text) ?? stringValue(question?.question);
  if (!questionText) return undefined;
  const checkpointOptions = Array.isArray(checkpointAllowed.options)
    ? checkpointAllowed.options.map(objectValue)
    : undefined;
  const questionOptions = question && Array.isArray(question.options) ? question.options : undefined;
  const checkpointId = workflowCheckpoint?.checkpointId
    ?? `clarification:${questionPlanId}:${questionPlanRevision}:${questionId}`;
  const interactionId = workflowCheckpoint?.interactionId
    ?? `workflow-interaction:${checkpointId}`;
  const interactionRevision = workflowCheckpoint?.revision ?? 0;
  const bindAnswer = (value: string): AgentOption["action"] => ({
    type: "answer",
    field: `tailoring-question:${questionId}`,
    value,
    interactionId,
    checkpointId,
    interactionRevision
  });
  const options = checkpointOptions?.length
    ? checkpointOptions.flatMap((option, index): AgentOption[] => {
        const label = stringValue(option.label);
        const value = stringValue(option.value);
        if (!label || !value) return [];
        return [{
          id: `tailoring-question-${questionId}-${String(option.id ?? index)}`,
          label,
          action: bindAnswer(value)
        }];
      })
    : questionOptions
    ? questionOptions.map(objectValue).flatMap((option, index): AgentOption[] => {
        const label = stringValue(option.label);
        const value = stringValue(option.value);
        if (!label || !value) return [];
        return [{
          id: `tailoring-question-${questionId}-${String(option.id ?? index)}`,
          label,
          action: bindAnswer(value)
        }];
      })
    : [];
  const position = Math.max(0, questionIds.indexOf(questionId)) + 1;
  const projectionRevision = `${questionPlanId}:${questionPlanRevision}:${questionId}`;
  return {
    interactionId,
    checkpointId,
    interactionRevision,
    questionPlanId,
    questionPlanRevision,
    questionId,
    questionText,
    position,
    count: numberValue(checkpointPrompt.questionCount) ?? questionIds.length,
    answerType: stringValue(question?.answerType) ?? stringValue(checkpointAllowed.answerType) ?? "text",
    options,
    allowSkip: true,
    tailoringSessionId,
    messageId: `agent-tailoring-question-${projectionRevision}`,
    projectionRevision
  };
}

export function projectActiveTailoringQuestionToChat(
  session: AgentSession,
  state: AgentTaskState = session.taskState as AgentTaskState
) {
  const projection = getActiveTailoringQuestionProjection(state);
  if (!projection) return session;
  const now = new Date().toISOString();
  const stableMetadata = {
    tailoringQuestionProjection: true,
    workflowInteractionProjection: true,
    tailoringQuestionId: projection.questionId,
    questionId: projection.questionId,
    questionPlanId: projection.questionPlanId,
    questionPlanRevision: projection.questionPlanRevision,
    questionText: projection.questionText,
    questionPosition: projection.position,
    questionCount: projection.count,
    answerType: projection.answerType,
    allowSkip: projection.allowSkip,
    tailoringSessionId: projection.tailoringSessionId,
    questionProjectionRevision: projection.projectionRevision,
    workflowInteractionId: projection.interactionId,
    workflowCheckpointId: projection.checkpointId,
    workflowInteractionRevision: projection.interactionRevision,
    workflowInteractionKind: "clarification",
    workflowInteractionState: "active",
    questionProjectionState: "active"
  } satisfies Record<string, unknown>;
  const withSettledProgress = {
    ...session,
    messages: session.messages.map((message) => {
      const belongsToCurrentTurn = message.turnId === session.activeTurn?.id;
      const isProgressShell = message.role === "assistant"
        && message.metadata?.tailoringQuestionProjection !== true
        && belongsToCurrentTurn
        && (message.streaming || message.status === "thinking" || message.status === "streaming" || message.kind === "assistant_thinking" || message.kind === "assistant_streaming");
      return isProgressShell
        ? {
            ...message,
            streaming: false,
            status: "recovered" as const,
            metadata: { ...message.metadata, retracted: true, questionProjectionSuperseded: true },
            updatedAt: now
          }
        : message;
    }),
    updatedAt: now
  };
  const existing = withSettledProgress.messages.find((message) =>
    message.id === projection.messageId
    || message.role === "assistant"
      && isWorkflowInteractionMessage(message)
      && message.metadata?.questionProjectionRevision === projection.projectionRevision
    || message.role === "assistant"
      && message.metadata?.tailoringQuestionId === projection.questionId
      && message.metadata?.questionPlanId === projection.questionPlanId
      && message.metadata?.questionPlanRevision === projection.questionPlanRevision
  );
  const current = existing
    ? {
        ...withSettledProgress,
        messages: withSettledProgress.messages.map((message) => message.id === existing.id
          ? {
              ...message,
              ...(message.metadata?.retracted === true ? {
                status: "complete" as const,
                streaming: false,
                metadata: { ...message.metadata, retracted: false }
              } : {}),
              ...(!message.options?.length && projection.options.length ? {
                options: projection.options,
                optionSet: activeOptionSetForMessage(withSettledProgress, existing.id, "tailoring-question")
              } : {}),
              metadata: { ...message.metadata, ...stableMetadata, retracted: false }
            }
          : message),
        updatedAt: now
      }
    : appendAgentMessage(
        withSettledProgress,
        "assistant",
        formatTailoringQuestionProjection(projection),
        {
          id: projection.messageId,
          turnId: session.activeTurn?.id ?? `tailoring-question-${projection.projectionRevision}`,
          kind: "text",
          type: "text",
          status: "complete",
          streaming: false,
          options: projection.options.length ? projection.options : undefined,
          parentMessageId: session.activeTurn?.userMessageId,
          metadata: stableMetadata
        }
      );
  const withDiagnostics = updateWorkflowInteractionDiagnostics(
    current,
    state,
    projection,
    existing?.id ?? projection.messageId
  );
  return existing ? withActiveBranchHead(withDiagnostics, existing.id) : withDiagnostics;
}

function isWorkflowInteractionMessage(message: AgentSession["messages"][number]) {
  return message.metadata?.workflowInteractionProjection === true
    || message.metadata?.tailoringQuestionProjection === true
    || typeof message.metadata?.workflowInteractionId === "string";
}

function projectActiveTailoringWorkflowInteractionToChat(
  session: AgentSession,
  state: AgentTaskState,
  interaction: NonNullable<ReturnType<typeof activeWorkflowInteractionFor>>
) {
  const withPreviousResolved = settleWorkflowInteractionMessages(session, interaction.interactionId);
  const existing = withPreviousResolved.messages.find((message) =>
    message.role === "assistant"
    && isWorkflowInteractionMessage(message)
    && message.metadata?.workflowInteractionId === interaction.interactionId
    && message.metadata?.workflowInteractionRevision === interaction.revision
  );
  const reusableReview = interaction.kind === "review_decision"
    ? withPreviousResolved.messages.findLast((message) =>
        message.role === "assistant" && message.metadata?.workflowInteractionKind === "review_decision"
      )
    : undefined;
  const target = existing ?? reusableReview;
  const messageId = target?.id ?? `workflow-interaction-${interaction.interactionId}`;
  const now = new Date().toISOString();
  const decisionOptions = interaction.kind === "target_persistence_choice"
    && state.pendingDecision?.type === "job_target_persistence"
    ? taskDecisionOptions(state.pendingDecision)
    : undefined;
  const projected = target
    ? withActiveBranchHead({
        ...withPreviousResolved,
        messages: withPreviousResolved.messages.map((message) => message.id === target.id
          ? {
              ...message,
              turnId: session.activeTurn?.id,
              content: interaction.prompt,
              kind: "text" as const,
              type: "text" as const,
              status: "complete" as const,
              options: interaction.kind === "target_persistence_choice"
                ? decisionOptions
                : interaction.kind === "confirmation"
                  ? undefined
                  : message.options,
              optionSet: interaction.kind === "target_persistence_choice"
                ? activeOptionSetForMessage(withPreviousResolved, message.id, "decision")
                : interaction.kind === "confirmation"
                  ? undefined
                  : message.optionSet,
              metadata: {
                ...(message.metadata ?? {}),
                workflowInteractionProjection: true,
                workflowInteractionId: interaction.interactionId,
                workflowCheckpointId: interaction.checkpointId,
                workflowInteractionRevision: interaction.revision,
                workflowInteractionKind: interaction.kind,
                workflowInteractionState: interaction.state
              },
              updatedAt: now
            }
          : message),
        updatedAt: now
      }, messageId)
    : appendAgentMessage(withPreviousResolved, "assistant", interaction.prompt, {
        id: messageId,
        turnId: session.activeTurn?.id,
        kind: "text",
        type: "text",
        status: "complete",
        metadata: {
          workflowInteractionProjection: true,
          workflowInteractionId: interaction.interactionId,
          workflowCheckpointId: interaction.checkpointId,
          workflowInteractionRevision: interaction.revision,
          workflowInteractionKind: interaction.kind,
          workflowInteractionState: interaction.state
        },
        ...(decisionOptions ? {
          options: decisionOptions,
          optionSet: activeOptionSetForMessage(withPreviousResolved, messageId, "decision")
        } : {})
      });
  return updateWorkflowInteractionBoundaryDiagnostics(projected, state, interaction, messageId);
}

function settleWorkflowInteractionMessages(session: AgentSession, keepInteractionId?: string) {
  const now = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (
        !isWorkflowInteractionMessage(message)
        || message.metadata?.workflowInteractionState !== "active"
        || message.metadata.workflowInteractionId === keepInteractionId
      ) return message;
      return {
        ...message,
        options: message.options?.map((option) => ({ ...option, disabled: true })),
        optionSet: message.optionSet?.state === "active"
          ? { ...message.optionSet, state: "resolved" as const, resolvedAt: now }
          : message.optionSet,
        metadata: {
          ...message.metadata,
          workflowInteractionState: "resolved",
          workflowInteractionResolvedAt: now,
          ...(message.metadata.tailoringQuestionProjection === true ? { questionProjectionState: "resolved" } : {})
        },
        updatedAt: now
      };
    }),
    updatedAt: now
  };
}

function updateWorkflowInteractionBoundaryDiagnostics(
  session: AgentSession,
  state: AgentTaskState,
  interaction: NonNullable<ReturnType<typeof activeWorkflowInteractionFor>>,
  messageId: string
) {
  const previous = objectValue(state.knownSlots.workflowInteractionDiagnostics);
  const previousActive = objectValue(previous.activeWorkflowInteraction);
  const history = Array.isArray(previous.interactionTransitionHistory)
    ? previous.interactionTransitionHistory.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    : [];
  const sameActive = previousActive.interactionId === interaction.interactionId
    && previousActive.revision === interaction.revision;
  const transition = sameActive ? undefined : {
    type: previousActive.interactionId || history.at(-1)?.type === "resolved" ? "next_created" : "created",
    interactionId: interaction.interactionId,
    checkpointId: interaction.checkpointId,
    kind: interaction.kind,
    revision: interaction.revision,
    messageId,
    at: new Date().toISOString()
  };
  return projectTaskStateIntoSession(session, {
    ...state,
    knownSlots: {
      ...state.knownSlots,
      workflowInteractionDiagnostics: {
        activeWorkflowInteraction: {
          interactionId: interaction.interactionId,
          kind: interaction.kind,
          revision: interaction.revision,
          state: interaction.state,
          messageId,
          checkpointId: interaction.checkpointId
        },
        interactionTransitionHistory: transition ? [...history, transition].slice(-32) : history,
        questionProjectionWriters: {
          count: 1,
          owners: ["TailoringWorkflowDriver"],
          invariant: "passed"
        }
      }
    }
  });
}

function updateWorkflowInteractionDiagnostics(
  session: AgentSession,
  state: AgentTaskState,
  projection: TailoringQuestionProjection,
  messageId: string
) {
  const previous = objectValue(state.knownSlots.workflowInteractionDiagnostics);
  const previousActive = objectValue(previous.activeWorkflowInteraction);
  const history = Array.isArray(previous.interactionTransitionHistory)
    ? previous.interactionTransitionHistory.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    : [];
  const sameActive = previousActive.interactionId === projection.interactionId
    && previousActive.revision === projection.interactionRevision;
  const transition = sameActive ? undefined : {
    type: previousActive.interactionId || history.at(-1)?.type === "resolved" ? "next_created" : "created",
    interactionId: projection.interactionId,
    checkpointId: projection.checkpointId,
    kind: "clarification",
    revision: projection.interactionRevision,
    messageId,
    at: new Date().toISOString()
  };
  const diagnostics = {
    activeWorkflowInteraction: {
      interactionId: projection.interactionId,
      kind: "clarification",
      revision: projection.interactionRevision,
      state: "active",
      messageId,
      checkpointId: projection.checkpointId
    },
    interactionTransitionHistory: transition ? [...history, transition].slice(-32) : history,
    questionProjectionWriters: {
      count: 1,
      owners: ["TailoringWorkflowDriver"],
      invariant: "passed"
    }
  } satisfies Record<string, unknown>;
  return projectTaskStateIntoSession(session, {
    ...state,
    knownSlots: {
      ...state.knownSlots,
      workflowInteractionDiagnostics: diagnostics
    }
  });
}

function formatTailoringQuestionProjection(projection: TailoringQuestionProjection) {
  return [
    "已记录。",
    `问题 ${projection.position}/${projection.count}：`,
    projection.questionText,
    "你可以直接补充说明，或回复“跳过”。"
  ].join("\n\n");
}

export function attachTaskStateOptions(session: AgentSession, state: AgentTaskState) {
  const normalizedState = normalizeAgentTaskState(state);
  if (normalizedState !== state) {
    session = projectTaskStateIntoSession(session, normalizedState);
    state = normalizedState;
  }
  if (
    (state.workflowUserInputCheckpoint?.kind === "clarification" || state.stage === "clarify_unsupported_facts")
    && getActiveTailoringQuestionProjection(state)
  ) {
    const normalizedState = normalizeAgentTaskState(state);
    const normalizedSession = session.taskState === state
      ? session
      : projectTaskStateIntoSession(session, normalizedState);
    return projectActiveTailoringQuestionToChat(normalizedSession, normalizedState);
  }
  const activeInteraction = activeWorkflowInteractionFor(state);
  if (
    activeInteraction
    && isTailoringWorkflowId(state.workflowId)
    && activeInteraction.kind !== "clarification"
  ) {
    return projectActiveTailoringWorkflowInteractionToChat(session, state, activeInteraction);
  }
  const recoverableCompositionProposal = state.workflowId === "compose_resume"
    && Boolean(state.knownSlots.resumeCompositionProposal)
    && !state.knownSlots.resumeCompositionResult;
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant"
      && message.kind !== "assistant_thinking"
      && !isWorkflowInteractionMessage(message)
      && message.metadata?.retracted !== true
      && (
        message.status === "complete"
        || recoverableCompositionProposal && message.status === "failed"
      )
  );
  if (assistantIndex < 0) return session;
  let options: AgentOption[] | undefined;
  let optionSet: AgentOptionSet | undefined;
  let metadata: Record<string, unknown> | undefined;
  if (
    state.workflowId === "compose_resume"
    && state.knownSlots.resumeCompositionProposal
    && !state.knownSlots.resumeCompositionResult
  ) {
    options = [
      { id: "resume-composition-generate", label: "直接生成", action: { type: "answer", field: "resume-composition-decision", value: "直接生成" } },
      { id: "resume-composition-adjust", label: "调整方向", action: { type: "answer", field: "resume-composition-decision", value: "调整方向" } },
      { id: "resume-composition-supplement", label: "继续补充资料", action: { type: "answer", field: "resume-composition-decision", value: "继续补充资料" } }
    ];
    metadata = {
      resumeCompositionProposal: true,
      resumeCompositionInformationNeedId: "target_direction"
    };
  } else if (state.workflowUserInputCheckpoint?.kind === "target_input") {
    options = [
      { id: "target-paste", label: "粘贴岗位描述", action: { type: "open_job_import_dialog" as const } },
      { id: "target-saved-job", label: "选择已有岗位", action: { type: "open_job_import_dialog" as const } }
    ];
    metadata = { workflowCheckpointKind: "target_input" };
  } else if (state.workflowUserInputCheckpoint?.kind === "profile_choice") {
    options = [{ id: "profile-select", label: "选择已有资料", action: { type: "open_profile_browser" as const } }];
    metadata = { workflowCheckpointKind: "profile_choice" };
  } else if (state.workflowUserInputCheckpoint?.kind === "import_prompt") {
    options = [
      { id: "profile-select", label: "选择已有资料", action: { type: "open_profile_browser" as const } },
      { id: "profile-import", label: "导入一份简历", action: { type: "open_resume_upload" as const } }
    ];
    metadata = { workflowCheckpointKind: "import_prompt" };
  } else if (state.workflowUserInputCheckpoint?.kind === "job_choice" || state.stage === "choose_job") {
    options = entityOptions(state, "job");
  } else if (
    state.workflowUserInputCheckpoint?.kind === "resume_choice"
    || state.stage === "choose_resume_source" && state.knownSlots.resumeSelectionRequired
  ) {
    options = entityOptions(state, "resume");
  } else if (state.stage === "clarify_unsupported_facts") {
    const sessionValue = objectValue(state.knownSlots.tailoringSession);
    const plan = objectValue(sessionValue.plan);
    const questionPlan = objectValue(plan.questionPlan);
    const questionId = stringValue(questionPlan.activeQuestionId);
    const questionIds = Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds.filter((id): id is string => typeof id === "string") : [];
    const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions.map(objectValue) : [];
    const question = questions.find((item) => item.id === questionId);
    if (questionId && question) {
      metadata = {
        tailoringQuestionId: questionId,
        questionPlanId: questionPlan.id,
        questionPlanRevision: questionPlan.revision,
        questionPosition: Math.max(0, questionIds.indexOf(questionId)) + 1,
        questionCount: questionIds.length
      };
      options = Array.isArray(question.options)
        ? question.options.map(objectValue).flatMap((option, index) => typeof option.value === "string" && typeof option.label === "string" ? [{
            id: `tailoring-question-${questionId}-${String(option.id ?? index)}`,
            label: option.label,
            action: { type: "answer" as const, field: `tailoring-question:${questionId}`, value: option.value }
          }] : [])
        : undefined;
    }
  } else if (
    state.workflowId === "guided_profile_intake"
    && state.stage === "collect_experience"
    && !state.knownSlots.intakeRequestedSection
    && (
          !state.knownSlots.intakeActiveQuestion
          || ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection).success
            && (() => {
              const projection = ProfileIntakeReviewProjectionSchema.parse(state.knownSlots.profileIntakeReviewProjection);
              return projection.candidates.every((candidate) =>
                candidate.status === "accepted" || candidate.status === "ignored"
              );
            })()
    )
  ) {
    const plan = objectValue(state.knownSlots.intakeInterviewPlan);
    const suggested = Array.isArray(plan.suggestedNextSections)
      ? plan.suggestedNextSections.filter((section): section is string => typeof section === "string")
      : [];
    const sectionLabels: Record<string, string> = {
      internship: "实习经历",
      project: "项目经历",
      campus: "校园经历",
      skills: "技能或证书",
      awards: "奖项经历",
      certificates: "证书经历",
      finish: "完成整理"
    };
    const existingOptionSet = session.messages[assistantIndex].optionSet;
    const optionSetRevision = existingOptionSet?.state === "active"
      && existingOptionSet.sourceMessageId === session.messages[assistantIndex].id
      ? existingOptionSet.optionSetRevision
      : Math.max(-1, ...session.messages.map((message) => message.optionSet?.optionSetRevision ?? -1)) + 1;
    const optionSetId = existingOptionSet?.state === "active"
      && existingOptionSet.sourceMessageId === session.messages[assistantIndex].id
      ? existingOptionSet.optionSetId
      : `profile-intake-sections-${session.messages[assistantIndex].id}-${optionSetRevision}`;
    const hasAuthoritativeProjection = ProfileIntakeReviewProjectionSchema.safeParse(
      state.knownSlots.profileIntakeReviewProjection
    ).success;
    const nextSection = suggested.find((section) => section !== "finish" && sectionLabels[section]);
    const optionSections = hasAuthoritativeProjection
      ? [
          ...(nextSection ? [{ section: nextSection, label: "换一个方向" }] : []),
          ...(suggested.includes("finish") ? [{ section: "finish", label: "完成整理" }] : [])
        ]
      : suggested.map((section) => ({ section, label: sectionLabels[section] }));
    options = optionSections.flatMap(({ section, label }) => label
      ? [{
          id: `profile-intake-section-${section}`,
          label,
          action: {
            type: "profile_intake_section_select" as const,
            section: section as ProfileIntakeSection,
            sourceMessageId: session.messages[assistantIndex].id,
            optionSetRevision
          }
        }]
      : []);
    if (options.length) {
      optionSet = {
        optionSetId,
        optionSetRevision,
        sourceMessageId: session.messages[assistantIndex].id,
        state: "active"
      };
      metadata = { profileIntakeSectionOptions: true };
    }
  }
  const shouldClearResolvedProfileOptions = state.workflowId === "guided_profile_intake"
    && (state.stage !== "collect_experience" || Boolean(state.knownSlots.intakeRequestedSection));
  const currentMessage = session.messages[assistantIndex];
  const hasActiveOptionSet = session.messages.some((message) =>
    message.optionSet?.state === "active" && !isWorkflowInteractionMessage(message)
  );
  const preservingPendingDecisionOptions = Boolean(state.pendingDecision && currentMessage.options?.length);
  if (options?.length && !optionSet) optionSet = activeOptionSetForMessage(session, currentMessage.id, "agent-options");
  if (!options?.length && !metadata && !shouldClearResolvedProfileOptions && !hasActiveOptionSet && !preservingPendingDecisionOptions) return session;
  const now = new Date().toISOString();
  const expireCurrent = !options?.length && !preservingPendingDecisionOptions;
  return {
    ...session,
    messages: session.messages.map((message, index) => {
      if (index === assistantIndex) {
        const currentOptionSet = options?.length
          ? optionSet ?? message.optionSet
          : preservingPendingDecisionOptions
            ? message.optionSet ?? activeOptionSetForMessage(session, message.id, "decision")
            : expireCurrent && message.optionSet?.state === "active"
              ? { ...message.optionSet, state: "superseded" as const, resolvedAt: now }
              : message.optionSet;
        return {
          ...message,
          options: expireCurrent ? undefined : options?.length
            ? [
                ...options,
                ...(message.options ?? []).filter((candidate) => !options.some((option) => option.id === candidate.id))
              ]
            : message.options,
          optionSet: currentOptionSet,
          metadata: { ...message.metadata, ...metadata }
        };
      }
      if (message.role !== "assistant" || isWorkflowInteractionMessage(message) || message.metadata?.retracted === true || !message.optionSet) return message;
      return {
        ...message,
        options: undefined,
        optionSet: message.optionSet?.state === "resolved"
          ? message.optionSet
          : message.optionSet
            ? { ...message.optionSet, state: "superseded" as const, resolvedAt: now }
            : undefined
      };
    })
  };
}

function careerSessionBindingForSession(session: AgentSession): CareerSessionBinding | undefined {
  if (
    !session.personId
    || !session.activeProfileId
    || session.profileVersionNumber === undefined
    || session.profileRevision === undefined
  ) return undefined;
  return {
    agentSessionId: session.id,
    personId: session.personId,
    profileId: session.activeProfileId,
    profileVersionNumber: session.profileVersionNumber,
    profileRevision: session.profileRevision
  };
}

function buildResumeCompositionConfirmationCommand(
  session: AgentSession,
  confirmationMode: "create_new" | "update_existing"
): ConfirmResumeCompositionCommand | undefined {
  const task = session.taskState;
  if (!task || task.workflowId !== "compose_resume") return undefined;
  const checkpoint = objectRecordValue(task.knownSlots.resumeCompositionCheckpoint);
  const checkpointId = stringRecordValue(checkpoint.checkpointId);
  const contentHash = stringRecordValue(checkpoint.contentHash);
  const profileId = stringRecordValue(checkpoint.profileId) ?? task.selectedEntities.profileId;
  const expectedProfileRevision = numberValue(checkpoint.profileRevision)
    ?? numberValue(checkpoint.expectedProfileRevision)
    ?? (typeof task.selectedEntities.profileVersion === "number" ? task.selectedEntities.profileVersion : undefined);
  const mode = stringRecordValue(checkpoint.mode) ?? stringRecordValue(task.knownSlots.resumeCompositionMode);
  if (
    !checkpointId
    || !contentHash
    || !profileId
    || expectedProfileRevision === undefined
    || (mode !== "general" && mode !== "job_specific")
    || task.knownSlots.resumeCompositionDecision !== "generate"
    || task.knownSlots.resumeCompositionExplicitConfirmation !== true
  ) return undefined;
  const sourceFingerprint = mode === "job_specific"
    && stringRecordValue(checkpoint.sourceBranchId)
    && stringRecordValue(checkpoint.sourceRevisionId)
    && stringRecordValue(checkpoint.sourceContentHash)
    && stringRecordValue(checkpoint.sourcePresentationHash)
    ? {
        branchId: stringRecordValue(checkpoint.sourceBranchId)!,
        revisionId: stringRecordValue(checkpoint.sourceRevisionId)!,
        contentHash: stringRecordValue(checkpoint.sourceContentHash)!,
        presentationHash: stringRecordValue(checkpoint.sourcePresentationHash)!
      }
    : undefined;
  const taskBranchMode = task.knownSlots.resumeCompositionBranchMode;
  const branchMode = taskBranchMode === "update_existing"
    ? "update_existing"
    : taskBranchMode === "create_new"
      ? "create_new"
      : confirmationMode;
  return {
    type: "confirm_resume_composition",
    sessionId: session.id,
    checkpointId,
    contentHash,
    profileId,
    expectedProfileRevision,
    mode,
    branchMode,
    ...(stringRecordValue(checkpoint.jobId) ? { jobId: stringRecordValue(checkpoint.jobId) } : {}),
    ...(stringRecordValue(checkpoint.sourceResumeId) ? { sourceResumeId: stringRecordValue(checkpoint.sourceResumeId) } : {}),
    ...(sourceFingerprint ? { sourceFingerprint } : {})
  };
}

function hasResumeCompositionCheckpointForConfirmation(session: AgentSession) {
  const checkpoint = objectRecordValue(session.taskState?.knownSlots.resumeCompositionCheckpoint);
  return Boolean(
    stringRecordValue(checkpoint.checkpointId)
    && stringRecordValue(checkpoint.contentHash)
    && stringRecordValue(checkpoint.profileId)
    && (numberValue(checkpoint.profileRevision) ?? numberValue(checkpoint.expectedProfileRevision)) !== undefined
    && (stringRecordValue(checkpoint.mode) === "general" || stringRecordValue(checkpoint.mode) === "job_specific")
  );
}

function clearResumeCompositionWriteFailure(session: AgentSession) {
  if (!session.taskState) return session;
  const knownSlots = { ...session.taskState.knownSlots };
  delete knownSlots.resumeCompositionWriteFailure;
  delete knownSlots.resumeCompositionWriteFailureOperationId;
  return projectTaskStateIntoSession(session, {
    ...session.taskState,
    knownSlots,
    updatedAt: new Date().toISOString()
  });
}

function resumeCompositionConfirmationOperationId(command: ConfirmResumeCompositionCommand) {
  return `resume-composition-confirm-${stableHashText(JSON.stringify({
    sessionId: command.sessionId,
    checkpointId: command.checkpointId,
    contentHash: command.contentHash,
    branchMode: command.branchMode,
    action: "confirmed_write"
  })).slice(4, 28)}`;
}

function clearResumeCompositionConfirmation(session: AgentSession, stage: "review_composition") {
  if (!session.taskState) return session;
  const knownSlots = { ...session.taskState.knownSlots };
  delete knownSlots.resumeCompositionDecision;
  delete knownSlots.resumeCompositionExplicitConfirmation;
  return projectTaskStateIntoSession(session, {
    ...session.taskState,
    stage,
    completionStatus: "waiting_for_user",
    knownSlots,
    updatedAt: new Date().toISOString()
  });
}

function mergeAuthoritativeResumeCompositionCheckpoint(
  facadeValue: unknown,
  persisted: ResumeCompositionCheckpoint
) {
  const facade = objectRecordValue(facadeValue);
  const workflowCheckpoint = objectRecordValue(facade.workflowCheckpoint);
  return {
    ...facade,
    workflowCheckpoint: {
      ...workflowCheckpoint,
      kind: "resume_composition",
      checkpointId: persisted.checkpointId,
      profileId: persisted.profileId,
      expectedProfileRevision: persisted.profileRevision,
      mode: persisted.mode,
      ...(persisted.jobId ? { jobId: persisted.jobId } : {}),
      ...(persisted.sourceResumeId ? { sourceResumeId: persisted.sourceResumeId } : {}),
      contentHash: persisted.contentHash,
      sourceBranchId: persisted.sourceBranchId,
      sourceRevisionId: persisted.sourceRevisionId,
      sourceContentHash: persisted.sourceContentHash,
      sourcePresentationHash: persisted.sourcePresentationHash,
      compositionResult: objectRecordValue(workflowCheckpoint.compositionResult).schemaVersion
        ? workflowCheckpoint.compositionResult
        : persisted.compositionResult
    }
  };
}

function appendIntakeRestorePrompt(session: AgentSession) {
  const state = session.taskState;
  if (!state || state.workflowId !== "guided_profile_intake" || state.completionStatus === "completed") return session;
  const intakeSession = objectValue(state.knownSlots.intakeSession);
  const resumeToken = stringValue(intakeSession.resumeToken);
  if (
    !resumeToken
    || session.messages.some((message) => message.metadata?.intakeRestorePrompt === true)
  ) {
    return session;
  }
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
  const section = stringValue(intakeSession.lastCompletedSection)
    ?? (projection.success
      ? projection.data.candidates.findLast((candidate) => candidate.status === "accepted" || candidate.status === "ignored")?.sectionType
      : undefined);
  if (!section) return session;
  const label = section === "education" ? "教育背景" : profileIntakeNarrativeSectionLabel(section);
  return appendAgentMessage(session, "assistant", `上次已整理到${label}，要继续吗？`, {
    kind: "text",
    type: "text",
    status: "complete",
    language: "zh",
    metadata: {
      intakeRestorePrompt: true,
      intakeRestoreToken: resumeToken,
      autosavedAt: intakeSession.autosavedAt
    }
  });
}

function entityOptions(state: AgentTaskState, entityType: "job" | "resume"): AgentOption[] | undefined {
  const candidatesKey = entityType === "job" ? "jobCandidates" : "resumeCandidates";
  const revisionKey = entityType === "job" ? "jobCandidateSetRevision" : "resumeCandidateSetRevision";
  const revision = stringValue(state.knownSlots[revisionKey]);
  const candidates = Array.isArray(state.knownSlots[candidatesKey]) ? state.knownSlots[candidatesKey].map(objectValue) : [];
  if (!revision) return undefined;
  const baseLabels = candidates.map((candidate) => entityType === "job"
    ? `${String(candidate.title ?? "未命名岗位")}${candidate.company ? ` · ${String(candidate.company)}` : ""}`
    : String(candidate.name ?? "未命名简历"));
  const counts = new Map(baseLabels.map((label) => [label, baseLabels.filter((item) => item === label).length]));
  return candidates.flatMap((candidate, index) => {
    const id = stringValue(candidate.id);
    if (!id) return [];
    const base = baseLabels[index];
    const detail = typeof candidate.source === "string" && candidate.source
      ? candidate.source
      : typeof candidate.updatedAt === "string"
        ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(candidate.updatedAt))
        : id.slice(-6);
    return [{
      id: `select-${entityType}-${id}`,
      label: (counts.get(base) ?? 0) > 1 ? `${base} · ${detail}` : base,
      action: { type: "select_entity" as const, entityType, entityId: id, candidateSetRevision: revision }
    }];
  });
}

function checkpointOptionForText(
  checkpoint: WorkflowUserInputCheckpoint,
  text: string
): (Record<string, unknown> & { value: string }) | undefined {
  const normalized = text.trim().toLocaleLowerCase("zh-CN");
  const allowedInput = objectValue(checkpoint.allowedInput);
  const options = Array.isArray(allowedInput.options)
    ? allowedInput.options.flatMap((candidate) => {
        if (typeof candidate === "string") return [{ value: candidate, label: candidate }];
        return candidate && typeof candidate === "object" && !Array.isArray(candidate)
          ? [candidate as Record<string, unknown>]
          : [];
      })
    : [];
  const matched = options.find((option) => [option.value, option.id, option.label]
    .some((candidate) => typeof candidate === "string" && candidate.trim().toLocaleLowerCase("zh-CN") === normalized));
  return typeof matched?.value === "string" ? { ...matched, value: matched.value } : undefined;
}

type ConfirmationResolution = "confirmed" | "rejected" | "superseded";

function markConfirmationResolution(
  session: AgentSession,
  resolution: ConfirmationResolution
) {
  const confirmation = session.pendingConfirmation;
  if (!confirmation) return session;
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant"
    && message.kind !== "assistant_thinking"
    && (!confirmation.turnId || message.turnId === confirmation.turnId)
  );
  if (assistantIndex < 0) return session;
  const resolvedAt = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            metadata: {
              ...message.metadata,
              confirmationResolution: resolution,
              confirmationResolvedAt: resolvedAt,
              confirmationToolName: confirmation.toolName
            },
            updatedAt: resolvedAt
          }
        : message
    )
  };
}

function invalidatePendingConfirmationForCorrection(session: AgentSession) {
  const call = session.pendingToolCall;
  let current = markConfirmationResolution(session, "superseded");
  if (current.taskState && call) {
    const taskState = new AgentTaskStateReducer().reduce(current.taskState, {
      type: "confirmation_superseded",
      toolName: call.toolName
    });
    current = projectTaskStateIntoSession(current, taskState);
  }
  return {
    ...current,
    pendingConfirmation: undefined,
    pendingToolCall: undefined
  };
}

function dependencyExpectationMatches(
  expectation: Record<string, unknown>,
  current: AgentTaskState["selectedEntities"]
) {
  for (const key of [
    "profileId",
    "profileVersion",
    "resumeId",
    "resumeRevisionId",
    "resumeHash",
    "jobId",
    "jobRevision",
    "jobGraphHash",
    "tailoringSessionId"
  ] as const) {
    const expected = expectation[key];
    if (expected !== undefined && current[key] !== undefined && expected !== current[key]) {
      return false;
    }
  }
  return true;
}

function settleThinkingMessages(session: AgentSession, turnId: string) {
  let changed = false;
  const hasFinal = session.messages.some((message) =>
    message.turnId === turnId
    && message.role === "assistant"
    && message.status === "complete"
    && message.kind !== "assistant_thinking"
    && message.kind !== "assistant_streaming"
  );
  const messages = session.messages.map((message) => {
    if (
      message.turnId === turnId
      && (
        message.kind === "assistant_thinking"
        || message.kind === "assistant_streaming"
        || message.status === "thinking"
        || message.status === "streaming"
        || message.streaming
      )
    ) {
      changed = true;
      return {
        ...message,
        content: hasFinal ? message.content : "这一步已中断，可重试或继续任务。",
        kind: "system_notice" as const,
        type: "system_notice" as const,
        status: "recovered" as const,
        streaming: false,
        metadata: hasFinal ? { ...message.metadata, retracted: true } : message.metadata,
        updatedAt: new Date().toISOString()
      };
    }
    return message;
  });
  return changed ? { ...session, messages } : session;
}

function markTurnTerminalState(
  session: AgentSession,
  turnId: string,
  outcome: "waiting_for_confirmation" | "waiting_for_user" | "failed" | "aborted" | "completed",
  isolatedConversationalTurn = false
) {
  const terminalState: AgentTerminalState = outcome === "waiting_for_confirmation"
    ? "WAITING_FOR_CONFIRMATION"
    : outcome === "waiting_for_user"
      ? "WAITING_FOR_USER"
      : outcome === "failed" || outcome === "aborted"
        ? "RECOVERABLE_FAILURE"
        : "COMPLETED";
  const index = session.messages.findLastIndex((message) =>
    message.role === "assistant"
      && message.turnId === turnId
      && message.kind !== "assistant_thinking"
      && message.kind !== "assistant_streaming"
      && !isWorkflowInteractionMessage(message)
  );
  if (index < 0) return session;
  return {
    ...session,
    messages: session.messages.map((message, messageIndex) =>
      messageIndex === index
        ? withTerminalState(
            isolatedConversationalTurn
              ? { ...message, metadata: { ...message.metadata, isolatedConversationalTurn: true } }
              : message,
            terminalState
          )
        : message
    )
  };
}

function reconcileTaskStateCompletionStatus(
  taskState: AgentTaskState,
  outcome: "waiting_for_confirmation" | "waiting_for_user" | "failed" | "aborted" | "completed",
  isolatedConversationalTurn: boolean
) {
  if (isolatedConversationalTurn) return taskState;
  const completionStatus = outcome === "waiting_for_confirmation"
    ? "waiting_for_confirmation" as const
    : outcome === "waiting_for_user"
      ? "waiting_for_user" as const
      : outcome === "failed" || outcome === "aborted"
        ? "failed" as const
        : undefined;
  if (!completionStatus || taskState.completionStatus === completionStatus) return taskState;
  return {
    ...taskState,
    completionStatus,
    updatedAt: new Date().toISOString()
  };
}

function isIsolatedRuntimeTurn(session: AgentSession, turnId: string) {
  const user = session.messages.findLast((message) =>
    message.role === "user" && message.turnId === turnId && message.content.trim()
  );
  if (!user) return false;
  const decision = classifyTurnIntent({ text: user.content, taskState: session.taskState });
  return decision.intent === "casual_side_turn" || decision.intent === "reference_followup";
}

function replaceTurnWithContinuityRecovery(
  session: AgentSession,
  turnId: string,
  reasonCode: "agent_conversation_dead_end"
) {
  const index = session.messages.findLastIndex((message) =>
    message.role === "assistant"
      && message.turnId === turnId
      && !isWorkflowInteractionMessage(message)
      && message.metadata?.retracted !== true
  );
  const option: AgentOption = {
    id: "retry-current-step-dead-end",
    label: "重新执行当前步骤",
    action: { type: "retry_current_step" }
  };
  const content = "当前回答没有留下可继续的结果或问题；已有任务状态已保留。请重新执行当前步骤。";
  const next = index < 0
    ? appendAgentMessage(session, "assistant", content, {
        turnId,
        kind: "error_status",
        type: "error",
        status: "failed",
        errorCode: reasonCode,
        metadata: { terminalState: "RECOVERABLE_FAILURE", deadEndDetected: true },
        options: [option]
      })
    : {
        ...session,
        messages: session.messages.map((message, messageIndex) => messageIndex === index
          ? {
              ...message,
              content,
              kind: "error_status" as const,
              type: "error" as const,
              status: "failed" as const,
              streaming: false,
              errorCode: reasonCode,
              options: [option],
              optionSet: activeOptionSetForMessage(session, message.id, "recovery"),
              metadata: { ...message.metadata, terminalState: "RECOVERABLE_FAILURE", deadEndDetected: true }
            }
          : message)
      };
  return {
    ...next,
    activeTurn: next.activeTurn
      ? { ...next.activeTurn, status: "failed" as const, completedAt: new Date().toISOString() }
      : next.activeTurn,
    currentObservation: { safeErrorCode: reasonCode }
  };
}

function settleUserExecutionState(
  session: AgentSession,
  turnId: string,
  executionState: "complete" | "aborted" | "failed" | "recoverable" | "queued"
) {
  return {
    ...session,
    messages: session.messages.map((message) => message.role === "user" && message.turnId === turnId
      ? { ...message, metadata: { ...message.metadata, executionState }, updatedAt: new Date().toISOString() }
      : message)
  };
}

function beginDeterministicArtifactTurn(
  session: AgentSession,
  turnId: string,
  userMessageId: string,
  startedAt: string
) {
  const taskState = session.taskState ?? new AgentTaskStateReducer().create(session);
  const checkpointed = withTurnCheckpoint(session, turnId, userMessageId, startedAt);
  return {
    ...checkpointed,
    runtimeId: session.runtimeId,
    activeTurn: {
      id: turnId,
      sessionId: session.id,
      sourceUserMessageId: userMessageId,
      userMessageId,
      runtimeId: session.runtimeId,
      preferredRuntime: session.activeTurn?.preferredRuntime ?? "hermes",
      attemptedRuntime: session.activeTurn?.attemptedRuntime ?? "hermes",
      finalRuntime: session.activeTurn?.finalRuntime ?? "hermes",
      executionOwner: "deterministic_transition" as const,
      fallbackUsed: false,
      workflowCheckpoint: {
        workflowId: taskState.workflowId,
        stage: taskState.stage,
        selectedEntities: taskState.selectedEntities
      },
      toolFailures: [],
      status: "running" as const,
      startedAt
    }
  };
}

function settleDeterministicArtifactSession(session: AgentSession, turnId: string) {
  const effectiveTurnId = session.activeTurn?.id ?? turnId;
  const settled = settleThinkingMessages(session, effectiveTurnId);
  const now = new Date().toISOString();
  const waitingForConfirmation = Boolean(settled.pendingConfirmation);
  return {
    ...settled,
    activeTurn: settled.activeTurn
      ? {
          ...settled.activeTurn,
          status: waitingForConfirmation ? "waiting_for_confirmation" as const : "waiting_for_user" as const,
          completedAt: waitingForConfirmation ? undefined : now
        }
      : settled.activeTurn
  };
}

function tailoringDiffFieldNames(state: AgentTaskState | undefined, diffId: string) {
  const tailoring = objectValue(state?.knownSlots.tailoringSession);
  const plan = objectValue(tailoring.plan);
  const diffs = Array.isArray(plan.diffs) ? plan.diffs.map(objectValue) : [];
  const diff = diffs.find((candidate) => {
    try {
      return tailoringDiffId(candidate as never) === diffId;
    } catch {
      return false;
    }
  });
  if (!diff) return ["tailoring.diff"];
  const target = objectValue(diff.target);
  const sectionId = stringValue(target.sectionId) ?? "resume";
  const fieldPath = stringValue(target.fieldPath) ?? "content";
  return [sectionId + "." + fieldPath];
}

function presentedActiveTailoringQuestion(session: AgentSession) {
  const projection = getActiveTailoringQuestionProjection(session);
  if (!projection) return undefined;
  const assistant = session.messages.findLast((message) =>
    message.role === "assistant"
      && message.metadata?.retracted !== true
      && (isWorkflowInteractionMessage(message) || message.metadata?.tailoringQuestionId === projection.questionId)
      && message.metadata?.tailoringQuestionId === projection.questionId
      && message.metadata?.questionPlanId === projection.questionPlanId
      && message.metadata?.questionPlanRevision === projection.questionPlanRevision
      && (message.metadata?.workflowInteractionId === undefined || message.metadata.workflowInteractionId === projection.interactionId)
      && (message.metadata?.workflowCheckpointId === undefined || message.metadata.workflowCheckpointId === projection.checkpointId)
      && (message.metadata?.workflowInteractionRevision === undefined || message.metadata.workflowInteractionRevision === projection.interactionRevision)
      && (message.status === "complete" || message.metadata?.tailoringQuestionProjection === true)
  );
  return assistant ? projection.questionId : undefined;
}

function formatCurrentTailoringQuestion(state: AgentTaskState) {
  const projection = getActiveTailoringQuestionProjection(state);
  return projection ? formatTailoringQuestionProjection(projection) : "请补充当前问题。";
}

function workflowInteractionActionMatches(
  projection: TailoringQuestionProjection,
  action: Extract<AgentOption["action"], { type: "answer" }>
) {
  const hasBinding = Boolean(action.interactionId || action.checkpointId || action.interactionRevision !== undefined);
  if (!hasBinding) return true;
  return action.interactionId === projection.interactionId
    && action.checkpointId === projection.checkpointId
    && action.interactionRevision === projection.interactionRevision;
}

function upsertTailoringDriverOutput(
  session: AgentSession,
  boundary: TailoringWorkflowBoundary,
  turnId: string,
  submittedCount?: number
) {
  if (boundary.kind === "WAITING_FOR_USER" && boundary.interactionKind === "clarification") return session;
  if (boundary.kind === "WAITING_FOR_USER" && boundary.interactionKind === "review_decision") {
    const interaction = activeWorkflowInteractionFor(boundary.taskState);
    if (!interaction) throw new Error("tailoring_review_interaction_missing");
    const existing = session.messages.findLast((message) =>
      message.role === "assistant" && message.metadata?.workflowInteractionKind === "review_decision"
    );
    const messageId = existing?.id ?? `tailoring-review-interaction-${session.id}`;
    const now = new Date().toISOString();
    const remainingDiffCount = numberValue(boundary.taskState.knownSlots.remainingDiffCount) ?? 0;
    const acceptedDiffCount = numberValue(boundary.taskState.knownSlots.acceptedDiffCount) ?? 0;
    const content = submittedCount === undefined
      ? "已生成岗位修改建议，请在右侧选择后提交本次选择。"
      : remainingDiffCount > 0
        ? `已提交 ${submittedCount} 项岗位修改选择，还有 ${remainingDiffCount} 项待核对，请在右侧产物栏继续处理。`
        : acceptedDiffCount > 0
          ? `已提交 ${submittedCount} 项岗位修改选择，新的岗位简历预览已生成，请确认后创建。`
          : `已提交 ${submittedCount} 项岗位修改选择，目前没有可应用的修改，请在右侧重新选择。`;
    const nextMessage = {
      ...(existing ?? {}),
      id: messageId,
      branchId: existing?.branchId ?? session.activeBranchId ?? "legacy-branch",
      turnId,
      role: "assistant" as const,
      content,
      kind: "text" as const,
      type: "text" as const,
      status: "complete" as const,
      metadata: {
        ...(existing?.metadata ?? {}),
        workflowInteractionProjection: true,
        workflowInteractionId: interaction.interactionId,
        workflowCheckpointId: interaction.checkpointId,
        workflowInteractionRevision: interaction.revision,
        workflowInteractionKind: interaction.kind,
        workflowInteractionState: interaction.state
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    return withActiveBranchHead({
      ...session,
      messages: existing
        ? session.messages.map((message) => message.id === existing.id ? nextMessage : message)
        : [...session.messages, nextMessage],
      updatedAt: now
    }, messageId);
  }
  if (boundary.kind === "WAITING_FOR_CONFIRMATION" && submittedCount !== undefined) {
    const existing = session.messages.findLast((message) =>
      message.role === "assistant" && message.metadata?.workflowInteractionKind === "review_decision"
    );
    if (existing) {
      const now = new Date().toISOString();
      const nextMessage = {
        ...existing,
        turnId,
        content: `已提交 ${submittedCount} 项岗位修改选择，新的岗位简历预览已生成，请确认后创建。`,
        updatedAt: now,
        metadata: {
          ...(existing.metadata ?? {}),
          workflowInteractionState: "resolved"
        }
      };
      return withActiveBranchHead({
        ...session,
        messages: session.messages.map((message) => message.id === existing.id ? nextMessage : message),
        updatedAt: now
      }, existing.id);
    }
  }
  if (boundary.kind === "RECOVERABLE_FAILURE") {
    const messageId = `tailoring-driver-failure-${boundary.error.operationId}`;
    if (session.messages.some((message) => message.id === messageId)) return session;
    return appendAgentMessage(session, "assistant", boundary.error.message, {
      id: messageId,
      turnId,
      kind: "error_status",
      type: "error",
      status: "failed",
      errorCode: boundary.error.code,
      options: [{
        id: "tailoring-driver-retry",
        label: "重新执行当前步骤",
        action: { type: "retry_current_step" }
      }],
      metadata: {
        terminalState: "RECOVERABLE_FAILURE",
        tailoringDriver: true,
        workflowStage: boundary.error.stage
      }
    });
  }
  return session;
}

function recoverOrphanedThinking(session: AgentSession) {
  const orphanTurnIds = new Set(session.messages.flatMap((message) =>
    message.turnId && (
      message.kind === "assistant_thinking"
      || message.kind === "assistant_streaming"
      || message.status === "thinking"
      || message.status === "streaming"
      || message.streaming
    )
      ? [message.turnId]
      : []
  ));
  let settled = session;
  for (const turnId of orphanTurnIds) settled = settleThinkingMessages(settled, turnId);
  if (session.activeTurn?.status !== "running") return settled;
  return {
    ...settled,
    activeTurn: {
      ...session.activeTurn,
      status: "aborted" as const,
      completedAt: new Date().toISOString()
    }
  };
}

function recoverPersistedQueuedInputs(session: AgentSession): {
  session: AgentSession;
  pendingInputs: PendingUserInput[];
} {
  const pendingInputs: PendingUserInput[] = [];
  let changed = false;
  const messages = session.messages.map((message) => {
    if (message.role !== "user" || message.metadata?.executionState !== "queued") return message;
    const queuedPageContext = parseQueuedPageContext(message.metadata.queuedPageContext);
    if (queuedPageContext) {
      pendingInputs.push({
        sessionId: session.id,
        userMessage: message.content,
        userMessageId: message.id,
        pageContext: queuedPageContext,
        references: message.references
      });
      return message;
    }
    changed = true;
    return {
      ...message,
      status: "recovered" as const,
      metadata: {
        ...message.metadata,
        executionState: "recoverable",
        recoveryReason: "queued_execution_context_unavailable"
      }
    };
  });
  if (!changed) return { session, pendingInputs };
  const now = new Date().toISOString();
  return {
    pendingInputs,
    session: appendAgentMessage({
      ...session,
      messages,
      updatedAt: now
    }, "assistant", "检测到刷新前尚未执行的排队消息。由于无法安全恢复当时页面上下文，消息已保留；请点击或重新发送以继续。", {
      kind: "system_notice",
      type: "system_notice",
      status: "recovered"
    })
  };
}

function parseQueuedPageContext(value: unknown): AgentPageContext | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.pathname !== "string" || !record.pathname.startsWith("/")) return undefined;
  if (!record.query || typeof record.query !== "object" || Array.isArray(record.query)) return undefined;
  const query = record.query as Record<string, unknown>;
  if (Object.values(query).some((entry) =>
    typeof entry !== "string"
    && !(Array.isArray(entry) && entry.every((item) => typeof item === "string"))
  )) return undefined;
  return { pathname: record.pathname, query: query as AgentPageContext["query"] };
}

function enforceExactlyOneFinal(session: AgentSession) {
  const finalIdsByTurn = new Map<string, string[]>();
  for (const message of session.messages) {
    if (
      message.turnId
      && message.role === "assistant"
      && message.status === "complete"
      && message.kind !== "assistant_thinking"
      && message.kind !== "assistant_streaming"
      && !isWorkflowInteractionMessage(message)
      && message.metadata?.retracted !== true
    ) {
      finalIdsByTurn.set(message.turnId, [...(finalIdsByTurn.get(message.turnId) ?? []), message.id]);
    }
  }
  const duplicateIds = new Set(
    [...finalIdsByTurn.values()].flatMap((ids) => ids.length > 1 ? ids.slice(0, -1) : [])
  );
  if (!duplicateIds.size) return session;
  return {
    ...session,
    messages: session.messages.map((message) =>
      duplicateIds.has(message.id)
        ? { ...message, metadata: { ...message.metadata, retracted: true } }
        : message
    )
  };
}

function withTurnCheckpoint(session: AgentSession, turnId: string, userMessageId: string, createdAt: string) {
  // A plain conversation has no workflow transaction to checkpoint. Creating
  // a synthetic task here would make every greeting look like a job flow.
  if (!session.taskState || !session.workflowState) return session;
  const taskState = session.taskState;
  const checkpoint = {
    turnId,
    userMessageId,
    branchId: session.activeBranchId,
    taskStateBefore: structuredClone(taskState),
    workflowStateBefore: structuredClone(session.workflowState),
    selectedEntitiesBefore: structuredClone(taskState.selectedEntities),
    artifactRefsBefore: structuredClone(session.artifactRefs),
    pendingConfirmationBefore: session.pendingConfirmation ? structuredClone(session.pendingConfirmation) : undefined,
    pendingToolCallBefore: session.pendingToolCall ? structuredClone(session.pendingToolCall) : undefined,
    toolReceipts: [],
    createdAt
  };
  return {
    ...session,
    turnCheckpoints: [...session.turnCheckpoints.filter((item) => item.userMessageId !== userMessageId), checkpoint].slice(-100)
  };
}

export function branchSessionFromEditedUserMessage(
  session: AgentSession,
  messageId: string,
  nextContent: string
) {
  const content = nextContent.trim();
  const targetIndex = session.messages.findIndex((message) =>
    message.id === messageId && message.role === "user"
  );
  if (targetIndex < 0 || !content) return undefined;
  const target = session.messages[targetIndex];
  const assistantMessageId = session.messages
    .slice(targetIndex + 1)
    .find((message) => message.role === "assistant")?.id;
  const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === messageId);
  if (session.conversationBranches.length || session.taskState?.workflowId === "guided_profile_intake") {
    const branch = forkConversationBranch(session, {
      forkedFromMessageId: target.parentMessageId,
      headMessageId: target.parentMessageId
    });
    const branchId = branch.activeBranchId;
    const now = new Date().toISOString();
    const nextTaskState = checkpoint?.taskStateBefore
      ? {
          ...checkpoint.taskStateBefore,
          knownSlots: checkpoint.taskStateBefore.workflowId === "guided_profile_intake"
            ? { ...checkpoint.taskStateBefore.knownSlots, intakeDraftBranchId: branchId }
            : checkpoint.taskStateBefore.knownSlots,
          updatedAt: now
        }
      : session.taskState;
    return {
      ...branch,
      ...(checkpoint ? {
        taskState: nextTaskState,
        workflowState: checkpoint.workflowStateBefore,
        artifactRefs: checkpoint.artifactRefsBefore,
        activeProfileId: checkpoint.selectedEntitiesBefore.profileId,
        activeResumeId: checkpoint.selectedEntitiesBefore.resumeId,
        activeJobId: checkpoint.selectedEntitiesBefore.jobId,
        pendingConfirmation: checkpoint.pendingConfirmationBefore,
        pendingToolCall: checkpoint.pendingToolCallBefore
      } : {}),
      conversationSummary: "",
      conversationSummaryBranchId: branchId,
      activeTurn: undefined,
      updatedAt: now,
      userMessageId: `agent-user-${crypto.randomUUID()}`,
      appendUserMessage: true,
      updateExistingUserMessage: false,
      assistantMessageId: undefined
    };
  }
  const now = new Date().toISOString();
  const contentChanged = target.content !== content;
  const revisions = contentChanged
    ? [
        ...(target.revisions ?? []),
        {
          id: `agent-message-revision-${crypto.randomUUID()}`,
          content: target.content,
          createdAt: target.updatedAt ?? target.createdAt
        }
      ].slice(-20)
    : target.revisions;
  return {
    ...session,
    ...(checkpoint ? {
      taskState: checkpoint.taskStateBefore,
      workflowState: checkpoint.workflowStateBefore,
      artifactRefs: checkpoint.artifactRefsBefore,
      activeProfileId: checkpoint.selectedEntitiesBefore.profileId,
      activeResumeId: checkpoint.selectedEntitiesBefore.resumeId,
      activeJobId: checkpoint.selectedEntitiesBefore.jobId,
      pendingConfirmation: checkpoint.pendingConfirmationBefore,
      pendingToolCall: checkpoint.pendingToolCallBefore
    } : {}),
    messages: session.messages.map((message, index) => {
      if (index === targetIndex) {
        return {
          ...message,
          content,
          revisions,
          status: "complete" as const,
          metadata: {
            ...message.metadata,
            retracted: false,
            ...(contentChanged ? { editedAt: now } : {})
          },
          updatedAt: now
        };
      }
      if (index > targetIndex && !isWorkflowInteractionMessage(message)) {
        return {
          ...message,
          metadata: { ...message.metadata, retracted: true },
          updatedAt: now
        };
      }
      return message;
    }),
    conversationSummary: "",
    pendingConfirmation: checkpoint?.pendingConfirmationBefore,
    pendingToolCall: checkpoint?.pendingToolCallBefore,
    activeTurn: undefined,
    updatedAt: now,
    userMessageId: messageId,
    appendUserMessage: false,
    updateExistingUserMessage: true,
    assistantMessageId
  };
}

function buildRegenerationTarget(
  session: AgentSession,
  messageId: string,
  prepared: { sourceTurnId?: string; userMessageId: string }
): AgentRegenerationTarget {
  const targetIndex = session.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
  if (targetIndex < 0) throw new Error("regeneration_target_assistant_missing");
  const target = session.messages[targetIndex];
  const parent = session.messages.find((message) => message.id === prepared.userMessageId && message.role === "user");
  if (!parent) throw new Error("regeneration_parent_user_missing");
  const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === parent.id);
  const targetTurnId = target.turnId
    ?? prepared.sourceTurnId
    ?? parent.turnId
    // Legacy persisted messages may predate turn ids. Keep the target bound to
    // the assistant message instead of inventing a new user semantic turn.
    ?? `legacy-turn:${target.id}`;
  const baseCheckpointId = checkpoint
    ? `${checkpoint.turnId}:${checkpoint.userMessageId}:${checkpoint.createdAt}`
    : `session:${session.sessionRevision}`;
  const baseVersion = checkpoint?.completedAt ?? checkpoint?.createdAt ?? session.sessionRevision;
  return {
    targetAssistantMessageId: target.id,
    targetTurnId,
    parentUserMessageId: parent.id,
    baseCheckpointId,
    baseVersion
  };
}

export function prepareSessionForAssistantRegeneration(
  session: AgentSession,
  messageId: string
) {
  const targetIndex = session.messages.findIndex((message) =>
    message.id === messageId && message.role === "assistant"
  );
  if (targetIndex < 0) return undefined;
  const target = session.messages[targetIndex];
  const userIndex = session.messages
    .slice(0, targetIndex)
    .findLastIndex((message) => message.role === "user");
  const userMessage = userIndex >= 0 ? session.messages[userIndex] : undefined;
  if (!userMessage?.content.trim()) return undefined;
  const now = new Date().toISOString();
  const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === userMessage.id);
  const safe = resolveLastSafeWorkflowCheckpoint(session);
  if (isFailedWorkflowAnswer(target, session, checkpoint)) {
    if (!checkpoint && !safe && isFailedDomainTask(session)) {
      const notice = appendAgentMessage(session, "assistant", "当前失败状态没有找到可验证的安全继续点，请重新选择岗位或简历后继续。", {
        kind: "error_status",
        type: "error",
        status: "failed",
        errorCode: "workflow_safe_state_missing",
        metadata: { terminalState: "RECOVERABLE_FAILURE", recoveryBlocked: "safe_state_missing", sourceMessageId: messageId }
      });
      return {
        session: notice,
        userMessageId: userMessage.id,
        userMessage: userMessage.content,
        blocked: true as const,
        assistantMessageId: undefined,
        updateExistingUserMessage: false,
        regenerateNarrationOnly: false,
        sourceTurnId: undefined,
        regeneratedFromMessageId: undefined
      };
    }
    const restored = {
      ...session,
      ...(safe ? {
        taskState: { ...safe.taskState, completionStatus: "active" as const, updatedAt: now },
        workflowState: safe.workflowState,
        artifactRefs: safe.artifactRefs,
        activeProfileId: safe.selectedEntities.profileId,
        activeResumeId: safe.selectedEntities.resumeId,
        activeJobId: safe.selectedEntities.jobId,
        pendingConfirmation: safe.pendingConfirmation,
        pendingToolCall: safe.pendingToolCall
      } : checkpoint ? {
        taskState: checkpoint.taskStateBefore,
        workflowState: checkpoint.workflowStateBefore,
        artifactRefs: checkpoint.artifactRefsBefore,
        activeProfileId: checkpoint.selectedEntitiesBefore.profileId,
        activeResumeId: checkpoint.selectedEntitiesBefore.resumeId,
        activeJobId: checkpoint.selectedEntitiesBefore.jobId,
        pendingConfirmation: checkpoint.pendingConfirmationBefore,
        pendingToolCall: checkpoint.pendingToolCallBefore
      } : {}),
      activeTurn: undefined,
      updatedAt: now
    };
    return {
      session: restored,
      userMessageId: userMessage.id,
      userMessage: userMessage.content,
      assistantMessageId: target.id,
      updateExistingUserMessage: false,
        regenerateNarrationOnly: false,
        retryWorkflowStep: true,
        sourceTurnId: target.turnId,
        regeneratedFromMessageId: target.id,
        regenerationTarget: buildRegenerationTarget(session, messageId, {
          sourceTurnId: target.turnId,
          userMessageId: userMessage.id
        })
    };
  }
  if (session.conversationBranches.length) {
    const forked = forkConversationBranch(session, {
      forkedFromMessageId: userMessage.id,
      headMessageId: userMessage.id
    });
    const restoredTaskState = checkpoint?.taskStateAfter ?? checkpoint?.taskStateBefore ?? session.taskState;
    const restored = {
      ...forked,
      ...(restoredTaskState ? { taskState: restoredTaskState } : {}),
      workflowState: checkpoint?.workflowStateAfter ?? checkpoint?.workflowStateBefore ?? forked.workflowState,
      artifactRefs: checkpoint?.artifactRefsAfter ?? checkpoint?.artifactRefsBefore ?? forked.artifactRefs,
      activeProfileId: restoredTaskState?.selectedEntities.profileId,
      activeResumeId: restoredTaskState?.selectedEntities.resumeId,
      activeJobId: restoredTaskState?.selectedEntities.jobId,
      pendingConfirmation: undefined,
      pendingToolCall: undefined,
      activeTurn: undefined,
      conversationSummary: "",
      conversationSummaryBranchId: forked.activeBranchId,
      updatedAt: now
    };
    return {
      session: restored,
      userMessageId: userMessage.id,
      userMessage: userMessage.content,
      assistantMessageId: undefined,
      updateExistingUserMessage: false,
      regenerateNarrationOnly: true,
      sourceTurnId: target.turnId,
      regeneratedFromMessageId: target.id,
      regenerationTarget: buildRegenerationTarget(session, messageId, {
        sourceTurnId: target.turnId,
        userMessageId: userMessage.id
      })
    };
  }
  if (!checkpoint && isUnsafeLegacyDomainRegeneration(session, targetIndex)) {
    const notice = appendAgentMessage(session, "assistant", "该历史步骤发生在旧版任务状态中，无法安全重生成。可以从当前步骤重试，或新建一个岗位定制任务。", {
      kind: "system_notice",
      type: "system_notice",
      status: "complete",
      options: [
        { id: "retry-current-tailoring-step", label: "从当前步骤重试", action: { type: "retry_current_step" } },
        { id: "new-tailoring-task", label: "新建岗位定制任务", action: { type: "new_tailoring_task" } }
      ],
      metadata: { regenerationBlocked: "legacy_domain_checkpoint_missing", sourceMessageId: messageId }
    });
    return {
      session: notice,
      userMessageId: userMessage.id,
      userMessage: userMessage.content,
      blocked: true as const,
      assistantMessageId: undefined,
      updateExistingUserMessage: false,
      regenerateNarrationOnly: false,
      sourceTurnId: undefined,
      regeneratedFromMessageId: undefined
    };
  }
  return {
    session: {
      ...session,
      ...(checkpoint ? {
        taskState: checkpoint.taskStateBefore,
        workflowState: checkpoint.workflowStateBefore,
        artifactRefs: checkpoint.artifactRefsBefore,
        activeProfileId: checkpoint.selectedEntitiesBefore.profileId,
        activeResumeId: checkpoint.selectedEntitiesBefore.resumeId,
        activeJobId: checkpoint.selectedEntitiesBefore.jobId,
        pendingConfirmation: checkpoint.pendingConfirmationBefore,
        pendingToolCall: checkpoint.pendingToolCallBefore
      } : {}),
      messages: session.messages.map((message, index) =>
        index > userIndex && index !== targetIndex && !isWorkflowInteractionMessage(message)
          ? {
              ...message,
              metadata: { ...message.metadata, retracted: true },
              updatedAt: now
            }
          : message
      ),
      conversationSummary: "",
      pendingConfirmation: checkpoint?.pendingConfirmationBefore,
      pendingToolCall: checkpoint?.pendingToolCallBefore,
      activeTurn: undefined,
      updatedAt: now
    },
    userMessageId: userMessage.id,
    userMessage: userMessage.content,
    regenerateNarrationOnly: true,
    assistantMessageId: messageId,
    updateExistingUserMessage: true,
    sourceTurnId: undefined,
    regeneratedFromMessageId: undefined,
    regenerationTarget: buildRegenerationTarget(session, messageId, {
      userMessageId: userMessage.id
    })
  };
}

function isFailedWorkflowAnswer(
  target: AgentSession["messages"][number],
  session: AgentSession,
  checkpoint: AgentSession["turnCheckpoints"][number] | undefined
) {
  return target.status === "failed"
    || target.kind === "error_status"
    || target.type === "error"
    || Boolean(target.errorCode)
    || session.taskState?.completionStatus === "failed"
    || checkpoint?.taskStateAfter?.completionStatus === "failed"
    || checkpoint?.workflowStateAfter?.status === "failed";
}

function isFailedDomainTask(session: AgentSession) {
  const state = session.taskState;
  return Boolean(
    state
      && state.completionStatus === "failed"
      && !["conversation", "agent_quick_action"].includes(state.rootGoal)
  );
}

function shouldNarrateProfileIntakeContinuation(
  previousState: AgentTaskState | undefined,
  action: AgentArtifactAction,
  nextState: AgentTaskState
) {
  if (nextState.workflowId !== "guided_profile_intake" || nextState.stage !== "collect_experience") return false;
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(nextState.knownSlots.profileIntakeReviewProjection);
  if (!projection.success) {
    if (action.type === "profile_intake_candidate_decision") return action.decision === "accept";
    return action.type === "profile_intake_candidate_edit" && previousState?.stage === "review_facts";
  }
  return (action.type === "profile_intake_candidate_decision" || action.type === "profile_intake_candidate_edit")
    && projection.data.reviewProgress.proposed === 0
    && projection.data.reviewProgress.uncertain === 0;
}

function upsertProfileIntakeContinuation(
  session: AgentSession,
  content: string,
  turnId: string,
  operationId: string,
  previousTurnId?: string,
) {
  const activeTurnAssistant = (previousTurnId ?? session.activeTurn?.id)
    ? session.messages.findLast((message) =>
        message.role === "assistant"
        && message.turnId === (previousTurnId ?? session.activeTurn?.id)
        && message.metadata?.intakeRestorePrompt !== true
      )
    : undefined;
  const existingContinuation = activeTurnAssistant
    ?? session.messages.findLast((message) =>
      message.role === "assistant" && message.metadata?.profileIntakeContinuation === true
    );

  if (!existingContinuation) {
    return appendAgentMessage(session, "assistant", content, {
      id: `agent-profile-intake-continuation-${operationId}`,
      turnId,
      kind: "text",
      type: "text",
      status: "complete",
      language: "zh",
      metadata: { profileIntakeContinuation: true }
    });
  }

  const replaced = replaceAgentThinking(session, existingContinuation.id, content, turnId);
  return {
    ...replaced,
    messages: replaced.messages.map((message) => message.id === existingContinuation.id
      ? { ...message, metadata: { ...message.metadata, profileIntakeContinuation: true } }
      : message)
  };
}

function profileIntakeContinuationNarration(taskState?: AgentTaskState) {
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(taskState?.knownSlots.profileIntakeReviewProjection);
  const plan = objectValue(taskState?.knownSlots.intakeInterviewPlan);
  const suggestedNextSections = Array.isArray(plan.suggestedNextSections)
    ? plan.suggestedNextSections.filter((section): section is string => typeof section === "string")
    : [];
  const activeQuestion = objectValue(plan.activeQuestion);
  const next = resolveProfileIntakeInterviewSupervisor({
    acceptedItems: projection.success
      ? projection.data.candidates.flatMap((candidate) =>
          candidate.status === "accepted" && candidate.structuredItem ? [candidate.structuredItem] : []
        )
      : [],
    activeQuestion: typeof activeQuestion.question === "string" && typeof activeQuestion.candidateId === "string"
      ? {
          question: activeQuestion.question,
          candidateId: activeQuestion.candidateId,
          ...(typeof activeQuestion.candidateLabel === "string" ? { candidateLabel: activeQuestion.candidateLabel } : {}),
          ...(typeof activeQuestion.sectionType === "string" ? { sectionType: activeQuestion.sectionType as never } : {}),
          ...(typeof activeQuestion.dimension === "string" ? { dimension: activeQuestion.dimension } : {})
        }
      : projection.success && projection.data.followUpQuestion
        ? (() => {
            const candidate = projection.data.candidates.find((item) => item.structuredItem);
            return candidate ? {
              question: projection.data.followUpQuestion!,
              candidateId: candidate.id,
              candidateLabel: profileIntakeItemLabel(candidate.structuredItem!)
            } : undefined;
          })()
        : undefined,
    unresolvedCandidateIds: projection.success
      ? projection.data.candidates
          .filter((candidate) => candidate.status === "proposed" || candidate.status === "uncertain" || candidate.status === "failed")
          .map((candidate) => candidate.id)
      : [],
    suggestedNextSections
  });
  const completed = projection.success
    ? projection.data.candidates.findLast((candidate) => candidate.status === "accepted" || candidate.status === "ignored")
    : undefined;
  const completedPrefix = completed
    ? completed.sectionType === "education" ? "教育背景已更新到本次临时整理。" : `${profileIntakeNarrativeSectionLabel(completed.sectionType)}已更新到本次临时整理。`
    : "这项经历已更新到本次临时整理。";
  if (next.type === "ask_follow_up") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "ask_next_section") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "offer_finish") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "commit") return `${completedPrefix}\n\n本次整理已准备完成。`;
  return "先核对上面的经历卡片；确认或忽略后，我再继续整理下一段。";
}

function currentProfileIntakeQuestion(taskState: AgentTaskState) {
  const nextPlan = ProfileIntakeNextTurnPlanSchema.safeParse(taskState.knownSlots.profileIntakeNextTurnPlan);
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(taskState.knownSlots.profileIntakeReviewProjection);
  const interviewPlan = objectValue(taskState.knownSlots.intakeInterviewPlan);
  const active = nextPlan.success && nextPlan.data.candidateId && nextPlan.data.question
    ? nextPlan.data
    : objectValue(interviewPlan.activeQuestion);
  const question = stringValue(active.question)
    ?? stringValue(taskState.knownSlots.intakeFollowUpQuestion);
  if (!question) return undefined;
  const candidateId = stringValue(active.candidateId);
  const candidate = projection.success
    ? projection.data.candidates.find((item) => item.id === candidateId)
      ?? projection.data.candidates.find((item) => item.structuredItem)
    : undefined;
  const candidateLabel = stringValue(active.candidateLabel)
    ?? (candidate?.structuredItem ? profileIntakeItemLabel(candidate.structuredItem) : undefined)
    ?? "这段经历";
  return {
    candidateId: candidateId ?? candidate?.id,
    candidateLabel,
    question: targetQuestion(question, candidateLabel)
  };
}

function formatProfileIntakeDraftSummary(taskState: AgentTaskState) {
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(taskState.knownSlots.profileIntakeReviewProjection);
  if (!projection.success || projection.data.candidates.length === 0) {
    return "目前还没有形成可供核对的经历草稿。你可以先从教育背景或一段项目经历说起。";
  }
  const lines = projection.data.candidates
    .filter((candidate) => candidate.status !== "failed")
    .slice(0, 12)
    .map((candidate) => {
      const label = candidate.structuredItem ? profileIntakeItemLabel(candidate.structuredItem) : candidate.sourceQuote.slice(0, 48);
      const status = candidate.status === "accepted" ? "已确认" : candidate.status === "ignored" ? "已忽略" : "待继续核对";
      return `- ${label}（${status}）`;
    });
  return `目前已整理 ${lines.length} 项经历：\n${lines.join("\n")}`;
}

function captureProfileIntakeNarration(
  result: Record<string, unknown>,
  projection: ReturnType<typeof ProfileIntakeReviewProjectionSchema.parse> | undefined,
  state: AgentTaskState
) {
  if (projection?.extractionStatus === "failed") {
    return "原始回答已保留，但这次没有完成可靠结构化。你可以补充名称、角色、主要工作和结果，或重新执行当前步骤。";
  }
  const nextPlan = ProfileIntakeNextTurnPlanSchema.safeParse(result.nextTurnPlan);
  const labels = nextPlan.success && nextPlan.data.capturedAssetLabels.length
    ? nextPlan.data.capturedAssetLabels
    : projection?.candidates
        .filter((candidate) => candidate.status !== "failed" && candidate.structuredItem)
        .slice(-8)
        .map((candidate) => profileIntakeItemLabel(candidate.structuredItem!)) ?? [];
  const newLabels = [...new Set(labels)].slice(-8);
  const acknowledgement = nextPlan.success && nextPlan.data.acknowledgement
    ? nextPlan.data.acknowledgement
    : newLabels.length
      ? `已记下 ${newLabels.join("、")}，保留在本地整理草稿中。`
      : "已保留这段回答，并更新了本地整理草稿。";
  const candidate = nextPlan.success && nextPlan.data.candidateId && projection
    ? projection.candidates.find((item) => item.id === nextPlan.data.candidateId)
    : undefined;
  const interpretation = candidate?.professionalText
    ? `目前的整理是：${candidate.professionalText.slice(0, 220)}`
    : undefined;
  const question = nextPlan.success && nextPlan.data.question
    ? nextPlan.data.question
    : currentProfileIntakeQuestion(state)?.question
      ?? "还想继续补充一段经历，还是完成整理？";
  return [acknowledgement, interpretation, question].filter(Boolean).join("\n\n");
}

function retrySectionLabel(projection: ReturnType<typeof ProfileIntakeReviewProjectionSchema.parse>) {
  const section = projection.candidates.find((candidate) => candidate.status !== "failed")?.sectionType;
  return section === "education"
    ? "教育"
    : section === "project"
      ? "项目"
      : section === "internship"
        ? "实习"
        : section === "work"
          ? "工作"
          : section === "research"
            ? "研究"
            : "相关";
}

function profileIntakeNarrativeSectionLabel(section: string) {
  return ({
    work: "工作经历",
    internship: "实习经历",
    project: "项目经历",
    research: "研究经历",
    campus: "校园经历",
    volunteer: "志愿经历",
    awards: "奖项经历",
    skills: "技能",
    certificates: "证书",
    languages: "语言能力"
  } as Record<string, string>)[section] ?? "这项经历";
}

function profileIntakeDimensionLabel(dimension: string) {
  const labels: Record<string, string> = {
    identity: "经历名称",
    time: "时间",
    role: "角色",
    action: "具体工作",
    tools_methods: "方法或工具",
    challenge: "关键问题",
    scope: "规模范围",
    result: "结果或交付物",
    collaboration: "协作职责",
    evidence: "可核验依据",
    degree: "学位",
    major: "专业",
    coursework_honors: "相关课程或荣誉",
    method: "研究方法",
    sample_scope: "样本或范围",
    publication: "公开成果",
    issuer: "颁发机构",
    level_rank: "级别或名次",
    proficiency: "熟练程度",
    applied_evidence: "应用证据",
    credential_status: "凭证或状态",
    test_score: "考试成绩",
    author_role: "作者角色",
    publisher: "发表平台",
    patent_identity: "专利信息",
    portfolio_output: "作品产出"
  };
  return labels[dimension] ?? "这项细节";
}

function profileIntakeSectionLabel(section: ProfileIntakeSection) {
  return {
    internship: "实习经历",
    project: "项目经历",
    campus: "校园经历",
    skills: "技能或证书",
    awards: "奖项经历",
    certificates: "证书经历",
    finish: "完成整理"
  }[section];
}

function profileIntakeSectionPrompt(section: ProfileIntakeSection) {
  if (section === "finish") return "好的，我们先完成本次经历整理。请在右侧核对当前草稿，确认后即可保存。";
  const subject = section === "project"
    ? "项目名称、你承担的角色、主要工作和结果"
    : "这段经历的名称、你承担的角色、主要工作和结果";
  return `好的，我们继续补充${profileIntakeSectionLabel(section)}。\n请告诉我${subject}。`;
}

function isUnsafeLegacyDomainRegeneration(session: AgentSession, targetIndex: number) {
  const state = session.taskState;
  if (!state || !["create_tailored_resume", "apply_to_job", "apply_to_external_job", "generate_job_specific_resume", "analyze_job_fit"].includes(state.rootGoal)) return false;
  const laterVisibleMessages = session.messages.slice(targetIndex + 1).some((message) => message.metadata?.retracted !== true);
  return laterVisibleMessages && !["select_resume", "choose_resume_source", "choose_job"].includes(state.stage);
}

function findBranchAssistantMessageId(session: AgentSession, userMessageId: string) {
  const userIndex = session.messages.findIndex((message) =>
    message.id === userMessageId && message.role === "user"
  );
  if (userIndex < 0) return undefined;
  return session.messages
    .slice(userIndex + 1)
    .find((message) => message.role === "assistant")
    ?.id;
}

function replaceMessageWithThinking(
  session: AgentSession,
  assistantMessageId: string,
  userMessageId: string,
  turnId: string,
  now: string
) {
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== assistantMessageId) return message;
      const revisions = message.content.trim() && message.kind !== "assistant_thinking"
        ? [
            ...(message.revisions ?? []),
            {
              id: `agent-message-revision-${crypto.randomUUID()}`,
              content: message.content,
              createdAt: message.updatedAt ?? message.createdAt
            }
          ].slice(-20)
        : message.revisions;
      return {
        ...message,
        turnId,
        content: "正在准备当前步骤",
        kind: "assistant_thinking" as const,
        type: "assistant_thinking" as const,
        status: "thinking" as const,
        streaming: true,
        parentMessageId: userMessageId,
        revisions,
        metadata: { ...message.metadata, retracted: false, regeneratedAt: now },
        updatedAt: now
      };
    }),
    updatedAt: now
  };
}

function artifactDescriptor(toolName: string, workflowId?: string, rootGoal?: string): {
  kind: AgentArtifactRef["kind"];
  title: string;
  entityType: AgentArtifactRef["entityType"];
  route?: string;
} | undefined {
  if (["capture_profile_intake", "synthesize_profile_intake"].includes(toolName)) {
    return { kind: "profile_intake_review", title: toolName === "synthesize_profile_intake" ? "最终资料草稿" : "经历核对", entityType: "profile_intake_draft" };
  }
  if (toolName === "prepare_resume_import") {
    return { kind: "resume_import_review", title: "简历导入核对", entityType: "resume_import_draft" };
  }
  if (toolName === "analyze_job_fit" && (workflowId === "analyze_job_fit" || rootGoal === "analyze_job_fit")) {
    return { kind: "job_fit_overview", title: "岗位匹配分析", entityType: "job" };
  }
  if (["analyze_job_fit", "create_tailoring_session", "answer_tailoring_question", "generate_tailoring_changes", "review_tailoring_diff", "preview_tailoring_changes", "apply_tailoring_changes"].includes(toolName)) {
    return { kind: "tailoring_workspace", title: "岗位定制工作区", entityType: "tailoring_session" };
  }

  if (["create_resume_from_profile", "ensure_general_resume_from_profile", "compose_resume"].includes(toolName)) {
    return { kind: "quality_result", title: "通用简历创建结果", entityType: "resume_branch", route: "/resume" };
  }
  if (toolName === "export_resume") {
    return { kind: "pdf_preview", title: "PDF 导出预览", entityType: "export", route: "/resume" };
  }
  return undefined;
}

function markTypedTaskDecisionResolution(
  session: AgentSession,
  resolution: {
    turnId: string;
    decisionType: string;
    decisionOption: string;
    label: string;
  }
) {
  let marked = false;
  const messages = [...session.messages].reverse().map((message) => {
    if (marked || message.role !== "assistant" || message.kind === "assistant_thinking") return message;
    marked = true;
    return {
      ...message,
      metadata: {
        ...message.metadata,
        typedActionResolution: {
          turnId: resolution.turnId,
          decisionType: resolution.decisionType,
          decisionOption: resolution.decisionOption,
          label: resolution.label
        }
      }
    };
  }).reverse();
  return { ...session, messages };
}

function attachProfileIntakeArtifact(
  session: AgentSession,
  result: { ok: boolean; data?: unknown; artifactIds?: string[] },
  title: string
) {
  if (!result.ok) return session;
  const value = objectRecordValue(result.data);
  const importId = stringRecordValue(value.importId);
  if (!importId) return session;
  const existing = session.artifactRefs.find((artifact) => artifact.kind === "profile_intake_review");
  const now = new Date().toISOString();
  const artifactId = result.artifactIds?.[0] ?? existing?.id ?? `agent-artifact-profile-intake-${importId}`;
  return {
    ...session,
    artifactRefs: [
      ...session.artifactRefs.filter((artifact) => artifact.kind !== "profile_intake_review"),
      {
        id: artifactId,
        kind: "profile_intake_review" as const,
        title,
        entityType: "profile_intake_draft" as const,
        entityId: importId,
        status: "active" as const,
        summary: typeof value.message === "string" ? value.message : undefined,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
    ]
  };
}

function reconcileTaskArtifacts(session: AgentSession, taskState: AgentTaskState) {
  const exportResult = objectRecordValue(taskState.knownSlots.exportResult);
  const jobId = taskState.selectedEntities.jobId;
  const resumeId = taskState.selectedEntities.resumeId;
  const artifactRefs = session.artifactRefs.map((artifact) => {
      if (artifact.kind === "pdf_preview") {
        return {
          ...artifact,
          entityId: stringRecordValue(exportResult.branchId) ?? resumeId ?? artifact.entityId,
          route: typeof exportResult.route === "string" ? exportResult.route : artifact.route,
          updatedAt: new Date().toISOString()
        };
      }
      if (artifact.kind === "job_fit_overview") {
        return {
          ...artifact,
          entityId: jobId ?? artifact.entityId,
          updatedAt: new Date().toISOString()
        };
      }
      return artifact;
    });
  if (
    (taskState.workflowId === "analyze_job_fit" || taskState.rootGoal === "analyze_job_fit")
    && taskState.knownSlots.fitAnalysis !== undefined
  ) {
    const existing = artifactRefs.find((artifact) => artifact.kind === "job_fit_overview")
      ?? artifactRefs.find((artifact) => artifact.kind === "tailoring_workspace");
    const now = new Date().toISOString();
    const entityId = jobId ?? existing?.entityId ?? "pending-job-fit";
    return {
      ...session,
      artifactRefs: [
        ...artifactRefs.filter((artifact) => !["tailoring_workspace", "job_fit_overview"].includes(artifact.kind)),
        {
          id: `job-fit:${entityId}`,
          kind: "job_fit_overview" as const,
          title: "岗位匹配分析",
          entityType: "job" as const,
          entityId,
          status: "active" as const,
          summary: existing?.summary,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
      ]
    };
  }
  if (
    taskState.workflowId === "compose_resume"
    && taskState.knownSlots.resumeCompositionResult !== undefined
    && resumeId
  ) {
    const existing = artifactRefs.find((artifact) => artifact.kind === "quality_result");
    const now = new Date().toISOString();
    return {
      ...session,
      artifactRefs: [
        ...artifactRefs.filter((artifact) => artifact.kind !== "quality_result"),
        {
          id: existing?.id ?? `resume-composition:${resumeId}`,
          kind: "quality_result" as const,
          title: "通用简历预览",
          entityType: "resume_branch" as const,
          entityId: resumeId,
          route: `/resume?branchId=${encodeURIComponent(resumeId)}`,
          status: "active" as const,
          summary: existing?.summary ?? "已创建独立 ResumeRevision，可继续查看预览。",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
      ]
    };
  }
  const tailoringSessionId = stringRecordValue(objectRecordValue(taskState.knownSlots.tailoringSession).id);
  if (!tailoringSessionId) return { ...session, artifactRefs };
  const existingWorkspace = artifactRefs.find((artifact) => artifact.kind === "tailoring_workspace")
    ?? artifactRefs.find((artifact) => artifact.kind === "tailoring_diff" || artifact.kind === "job_fit_overview");
  const now = new Date().toISOString();
  return {
    ...session,
    artifactRefs: [
      ...artifactRefs.filter((artifact) => !["tailoring_workspace", "tailoring_diff", "job_fit_overview"].includes(artifact.kind)),
      {
        id: `tailoring-workspace:${tailoringSessionId}`,
        kind: "tailoring_workspace" as const,
        title: "岗位定制工作区",
        entityType: "tailoring_session" as const,
        entityId: tailoringSessionId,
        status: "active" as const,
        summary: existingWorkspace?.summary,
        createdAt: existingWorkspace?.createdAt ?? now,
        updatedAt: now
      }
    ]
  };
}

function completeTurnCheckpoint(session: AgentSession, turnId: string, completedAt: string) {
  const checkpointIndex = session.turnCheckpoints.findLastIndex((checkpoint) => checkpoint.turnId === turnId);
  if (checkpointIndex < 0 || !session.taskState) return session;
  const checkpoint = session.turnCheckpoints[checkpointIndex];
  const toolReceipts = session.messages
    .filter((message) => message.turnId === turnId && message.role === "tool" && message.toolName && message.operationId)
    .map((message) => ({
      toolName: message.toolName!,
      operationId: message.operationId!,
      status: message.status === "failed" ? "failed" as const : message.status === "recovered" ? "recovered" as const : "complete" as const
    }));
  const updated = {
    ...checkpoint,
    taskStateAfter: structuredClone(session.taskState),
    workflowStateAfter: structuredClone(session.workflowState),
    artifactRefsAfter: structuredClone(session.artifactRefs),
    pendingConfirmationAfter: session.pendingConfirmation ? structuredClone(session.pendingConfirmation) : undefined,
    pendingToolCallAfter: session.pendingToolCall ? structuredClone(session.pendingToolCall) : undefined,
    toolReceipts,
    completedAt
  };
  return {
    ...session,
    turnCheckpoints: session.turnCheckpoints.map((item, index) => index === checkpointIndex ? updated : item)
  };
}

function attachConfirmedToolArtifact(
  session: AgentSession,
  toolName: string,
  operationId: string,
  result: { ok: boolean; data?: unknown; artifactIds?: string[] }
) {
  const descriptor = artifactDescriptor(
    toolName,
    session.taskState?.workflowId ?? session.workflowState?.workflowId,
    session.taskState?.rootGoal
  );
  if (!result.ok || !descriptor) return session;
  const value = objectRecordValue(result.data);
  const compositionResumeId = descriptor.entityType === "resume_branch"
    ? resumeArtifactEntityId(value, session)
    : undefined;
  const entityId = descriptor.kind === "tailoring_workspace"
    ? stringRecordValue(objectRecordValue(value.session).id)
      ?? stringRecordValue(objectRecordValue(value.session).sessionId)
      ?? stringRecordValue(objectRecordValue(value.session).tailoringSessionId)
      ?? stringRecordValue(objectRecordValue(session.taskState?.knownSlots.tailoringSession).id)
      ?? `pending:${session.taskState?.selectedEntities.jobId ?? toolName}`
    : descriptor.entityType === "job"
    ? stringRecordValue(value.jobId)
      ?? session.taskState?.selectedEntities.jobId
      ?? stringRecordValue(value.resumeId)
      ?? `pending-${toolName}`
    : compositionResumeId;
  if (!entityId) return session;
  const now = new Date().toISOString();
  const artifactId = descriptor.kind === "tailoring_workspace"
    ? `tailoring-workspace:${entityId}`
    : result.artifactIds?.[0] ?? `agent-artifact-${toolName}-${operationId}`;
  const route = toolName === "export_resume" && typeof value.route === "string"
    ? value.route
    : descriptor.route;
  const resolvedResumeBranch = descriptor.entityType === "resume_branch"
    && !entityId.startsWith("pending-");
  const next = {
    ...session,
    artifactRefs: [
      ...session.artifactRefs.filter((artifact) => descriptor.kind === "tailoring_workspace"
        ? !["tailoring_workspace", "job_fit_overview", "tailoring_diff"].includes(artifact.kind)
        : artifact.id !== artifactId
          && !(resolvedResumeBranch
            && artifact.kind === descriptor.kind
            && artifact.entityType === descriptor.entityType
            && artifact.entityId.startsWith("pending-"))),
      {
        id: artifactId,
        kind: descriptor.kind,
        title: descriptor.title,
        entityType: descriptor.entityType,
        entityId,
        route,
        status: "active" as const,
        summary: typeof value.message === "string" ? value.message : undefined,
        createdAt: now,
        updatedAt: now
      }
    ]
  };
  if (toolName === "apply_tailoring_changes") {
    const receipt = ResumeArtifactReceiptSchema.safeParse(
      value.artifactReceipt ?? objectRecordValue(value.qualityResult).artifactReceipt
    );
    if (receipt.success) return withTailoringResultArtifact(next, receipt.data);
  }
  return next;
}

function artifactActionRevision(
  state: AgentTaskState | undefined,
  action: AgentArtifactAction
) {
  if (!state) return undefined;
  const value = action.type === "profile_intake_candidate_decision" || action.type === "profile_intake_final_review_decision"
    ? state.knownSlots.expectedIntakeDraftRevision
    : action.type === "profile_intake_candidate_edit"
      ? state.knownSlots.expectedIntakeDraftRevision
      : action.type === "profile_intake_retry_extraction" || action.type === "profile_intake_extraction_recovery"
        ? state.knownSlots.expectedIntakeDraftRevision
      : action.type === "resume_import_review_decision"
        ? state.knownSlots.expectedDraftRevision
        : action.type === "tailoring_answer_edit" || action.type === "tailoring_regenerate"
          || action.type === "tailoring_diff_decision"
          || action.type === "tailoring_diff_stage_decision"
          || action.type === "tailoring_diff_submit"
          ? objectValue(state.knownSlots.tailoringSession).revision
          : action.type === "profile_intake_reconciliation_decision"
            ? state.knownSlots.expectedIntakeReconciliationRevision
            : state.knownSlots.expectedReconciliationRevision;
  return typeof value === "number" ? value : undefined;
}

function artifactActionEntityId(action: AgentArtifactAction) {
  if (action.type === "profile_intake_candidate_decision") return action.candidateId;
  if (action.type === "profile_intake_final_review_decision") return "final-review";
  if (action.type === "profile_intake_candidate_edit") return action.candidateId;
  if (action.type === "profile_intake_retry_extraction" || action.type === "profile_intake_extraction_recovery") return action.sourceMessageId;
  if (action.type === "profile_intake_reconciliation_decision") return action.incomingItemId;
  if (action.type === "resume_import_reconciliation_decision") return action.incomingItemId;
  if (action.type === "tailoring_answer_edit") return action.questionId;
  if (action.type === "tailoring_regenerate") return "regenerate";
  if (action.type === "tailoring_diff_stage_decision") return action.diffId;
  if (action.type === "tailoring_diff_submit") return "submit";
  if (action.type === "tailoring_diff_decision") return action.diffId;
  return "review";
}

function artifactActionOperationId(session: AgentSession, action: AgentArtifactAction, revision: number | undefined) {
  const tailoringSessionId = stringValue(objectValue(session.taskState?.knownSlots.tailoringSession).id) ?? "none";
  if (action.type === "tailoring_answer_edit") {
    const tailoringSession = objectValue(session.taskState?.knownSlots.tailoringSession);
    const plan = objectValue(tailoringSession.plan);
    const questionPlan = objectValue(plan.questionPlan);
    const previous = Array.isArray(plan.clarificationAnswers)
      ? plan.clarificationAnswers.map(objectValue).find((answer) => answer.questionId === action.questionId)
      : undefined;
    const sameAnswer = previous
      && JSON.stringify(previous.answer) === JSON.stringify(action.answer)
      && previous.proficiency === action.proficiency;
    const answerRevision = sameAnswer
      ? previous.answerRevision
      : (typeof previous?.answerRevision === "number" ? previous.answerRevision : 0) + 1;
    const answerHash = stableHashText(JSON.stringify(action.answer));
    return [
      "artifact-answer-edit", session.id, tailoringSessionId,
      String(revision ?? "missing"), String(questionPlan.revision ?? "missing"),
      action.questionId, String(answerRevision), answerHash, action.proficiency ?? "none"
    ].join("-").replace(/[^\w-]/g, "-").slice(0, 160);
  }
  const decision = action.type === "tailoring_diff_decision" || action.type === "tailoring_diff_stage_decision"
    ? action.decision
    : action.type === "tailoring_diff_submit"
      ? "submit"
    : action.type === "tailoring_regenerate"
      ? "regenerate"
      : action.type === "profile_intake_candidate_edit"
        ? "edit"
      : action.type === "profile_intake_retry_extraction"
        ? "retry-extraction"
      : action.type === "profile_intake_extraction_recovery"
        ? action.decision
      : action.type === "profile_intake_candidate_decision" || action.type === "profile_intake_final_review_decision" || action.type === "resume_import_review_decision"
        ? action.decision
        : action.type === "profile_intake_reconciliation_decision"
          ? action.resolution
        : action.resolution;
  const editedValueHash = (action.type === "tailoring_diff_decision" || action.type === "tailoring_diff_stage_decision") && action.editedValue !== undefined
    ? stableHashText(JSON.stringify(action.editedValue))
      : action.type === "profile_intake_candidate_edit"
       ? stableHashText(JSON.stringify({
           editedLabel: action.editedLabel ?? null,
           fieldPatch: action.fieldPatch ?? null,
           sectionType: action.sectionType ?? null,
           userCorrection: action.userCorrection ?? false
         }))
      : action.type === "profile_intake_extraction_recovery"
        ? stableHashText(action.decision)
    : "none";
  if (action.type === "tailoring_diff_decision" || action.type === "tailoring_diff_stage_decision") {
    const tailoringSession = objectValue(session.taskState?.knownSlots.tailoringSession);
    return [
      "artifact-tailoring-diff",
      session.id,
      tailoringSessionId,
      String(tailoringSession.generatedDiffRevision ?? 0),
      "diff",
      action.diffId,
      "decision",
      decision,
      "value",
      editedValueHash
    ].join("-").replace(/[^\w-]/g, "-").slice(0, 160);
  }
  if (action.type === "tailoring_diff_submit") {
    const staged = Array.isArray(action.reviews)
      ? action.reviews
      : Array.isArray(session.taskState?.knownSlots.tailoringDraftDiffReviews)
        ? session.taskState.knownSlots.tailoringDraftDiffReviews
      : [];
    return [
      "artifact-tailoring-submit",
      session.id,
      tailoringSessionId,
      String(revision ?? "missing"),
      stableHashText(JSON.stringify(staged))
    ].join("-").replace(/[^\w-]/g, "-").slice(0, 160);
  }
  const actionIdentity =
    `${artifactActionEntityId(action)}-${decision}-${editedValueHash}`;
  return ["artifact-action", session.id, tailoringSessionId, String(revision ?? "missing"), actionIdentity]
    .join("-").replace(/[^\w-]/g, "-").slice(0, 160);
}

function withArtifactActionFeedback(
  session: AgentSession,
  action: AgentArtifactAction,
  feedback: {
    result: "handled" | "rejected" | "stale" | "invalid_target" | "missing_revision" | "missing_diff_review";
    message: string;
    running?: boolean;
    retryable: boolean;
    safeErrorCode?: string;
    fieldNames?: string[];
    operationId?: string;
    hash?: string;
  }
) {
  if (!session.taskState) return session;
  const entityId = artifactActionEntityId(action);
  const fieldNames = feedback.fieldNames
    ?? (action.type === "profile_intake_candidate_edit" ? Object.keys(action.fieldPatch ?? {}) : []);
  const operationId = feedback.operationId
    ?? artifactActionOperationId(session, action, artifactActionRevision(session.taskState, action));
  const hash = feedback.hash
    ?? stableHashText(JSON.stringify({ actionType: action.type, entityId, operationId, fieldNames }));
  const timestamp = new Date().toISOString();
  return projectTaskStateIntoSession(session, {
    ...session.taskState,
    knownSlots: {
      ...session.taskState.knownSlots,
      artifactActionFeedback: {
        ...feedback,
        actionType: action.type,
        entityId,
        id: entityId,
        operationId,
        hash,
        fieldNames,
        stage: session.taskState.stage,
        safeErrorCode: feedback.safeErrorCode ?? (feedback.result === "rejected" ? "artifact_action_rejected" : undefined),
        timestamp,
        updatedAt: timestamp
      }
    },
    updatedAt: timestamp
  });
}

function resumeArtifactEntityId(value: Record<string, unknown>, session: AgentSession) {
  const observationResume = objectRecordValue(value.resume);
  return stringRecordValue(value.resumeId)
    ?? stringRecordValue(value.branchId)
    ?? stringRecordValue(observationResume.id)
    ?? (
      session.taskState?.workflowId === "compose_resume"
      && session.taskState.stage === "resume_ready"
        ? session.taskState.selectedEntities.resumeId
        : undefined
    );
}

function runtimeArtifactSourceToolName(stableName: string, declaredSource?: string) {
  const facadeSources: Record<string, string> = {
    "career.workflow.profile_intake_turn": "capture_profile_intake",
    "career.workflow.profile_intake_finalize": "synthesize_profile_intake",
    "career.workflow.resume_import": "prepare_resume_import",
    "career.workflow.job_fit": "analyze_job_fit",
    "career.workflow.tailor_resume": "create_tailoring_session",
    "career.workflow.profile_to_resume": "ensure_general_resume_from_profile",
    "career.workflow.compose_resume": "compose_resume",
    "career.workflow.resume_export": "export_resume"
  };
  const stableSources: Record<string, string> = {
    "career.system.runtime_status": "get_agent_runtime_status",
    "career.system.current_task": "get_agent_current_task",
    "career.system.last_failure": "get_agent_last_failure",
    "career.profile.list": "list_profiles",
    "career.profile.active": "get_active_profile",
    "career.profile.get": "get_profile",
    "career.profile.search_facts": "search_profile_facts",
    "career.profile.capture_intake": "capture_profile_intake",
    "career.profile.synthesize_intake": "synthesize_profile_intake",
    "career.profile.review_intake": "review_profile_intake",
    "career.profile.reconcile_intake": "reconcile_profile_intake",
    "career.profile.resolve_intake_conflict": "resolve_profile_intake_conflict",
    "career.profile.commit_intake": "commit_profile_intake",
    "career.resume.list": "list_resumes",
    "career.resume.get": "get_resume",
    "career.resume.get_revision": "get_resume_revision",
    "career.resume.recommend_source": "recommend_resume_source",
    "career.resume.create_from_profile": "create_resume_from_profile",
    "career.resume.create_job_from_profile": "create_job_resume_from_profile",
    "career.resume.ensure_general_from_profile": "ensure_general_resume_from_profile",
    "career.job.list": "list_jobs",
    "career.job.get": "get_job",
    "career.job.parse": "parse_job_description",
    "career.job.commit": "commit_job",
    "career.job.analyze_fit": "analyze_job_fit",
    "career.tailoring.create_session": "create_tailoring_session",
    "career.tailoring.answer_question": "answer_tailoring_question",
    "career.tailoring.generate_changes": "generate_tailoring_changes",
    "career.tailoring.review_diff": "review_tailoring_diff",
    "career.tailoring.preview_changes": "preview_tailoring_changes",
    "career.tailoring.apply_changes": "apply_tailoring_changes",
    "career.preview.review_diff": "review_tailoring_diff",
    "career.preview.apply_changes": "apply_tailoring_changes",
    "career.export.resume": "export_resume",
    "career.resume.build_evidence_graph": "build_resume_evidence_graph",
    "career.resume.plan_composition": "plan_resume_composition",
    "career.resume.review_composition": "review_resume_composition",
    "career.resume.compose": "compose_resume"
  };
  return facadeSources[stableName] ?? stableSources[stableName] ?? declaredSource ?? stableName;
}

function isCanonicalTailorFacadeToolName(toolName: string | undefined, data: Record<string, unknown>) {
  const candidate = stringValue(data.stableCareerToolName) ?? toolName;
  return candidate === "career.workflow.tailor_resume"
    || candidate === "career_workflow_tailor_resume"
    || candidate?.endsWith("__career_workflow_tailor_resume") === true
    || candidate?.endsWith("_career_workflow_tailor_resume") === true;
}

function isCanonicalWorkflowValidationFailure(
  toolName: string | undefined,
  code: string,
  diagnostics: Record<string, unknown>
) {
  return isCanonicalTailorFacadeToolName(toolName, diagnostics)
    && (diagnostics.failureScope === "career_workflow"
      || diagnostics.failureScope === "career_context"
      || diagnostics.toolFailureLayer === "gateway_validation")
    && /schema_validation_failed|target_required/i.test(code);
}

function runtimeArtifactResultData(stableName: string, value: unknown) {
  if (!stableName.startsWith("career.workflow.")) return value;
  const facade = objectValue(value);
  const checkpoint = objectValue(facade.workflowCheckpoint);
  const keyByFacade: Record<string, string> = {
    "career.workflow.profile_intake_turn": "understood",
    "career.workflow.profile_intake_finalize": "synthesis",
    "career.workflow.resume_import": "import",
    "career.workflow.job_fit": "result",
    "career.workflow.tailor_resume": "session",
    "career.workflow.profile_to_resume": "result",
    "career.workflow.compose_resume": "compositionResult",
    "career.workflow.resume_export": "result"
  };
  return checkpoint[keyByFacade[stableName] ?? "result"] ?? checkpoint;
}

/**
 * Runs execute Career workflow facades outside the native AgentKernel. Keep
 * the durable task projection in sync with the facade's explicit checkpoint;
 * otherwise a successful Hermes workflow would leave the old prerequisite
 * stage (or a stale failed status) in IndexedDB even though the artifact was
 * produced.
 */
function applyRuntimeFacadeCheckpoint(session: AgentSession, toolName: string, value: unknown): AgentSession {
  if (!toolName.startsWith("career.workflow.") || !session.taskState) return session;
  const facade = objectRecordValue(value);
  const checkpoint = objectRecordValue(facade.workflowCheckpoint);
  const facadeWorkflowStage = stringRecordValue(facade.workflowStage);
  const status = stringRecordValue(facade.status);
  if (!status || !Object.prototype.hasOwnProperty.call(checkpoint, "kind")) return session;
  const task = session.taskState;
  const result = objectRecordValue(checkpoint.result);
  const importData = objectRecordValue(checkpoint.import);
  const understood = objectRecordValue(checkpoint.understood);
  const synthesis = objectRecordValue(checkpoint.synthesis);
  const importArtifactPayload = objectRecordValue(importData.artifactPayload);
  const importReviewSummary = objectRecordValue(importData.reviewSummary ?? importArtifactPayload);
  const importNeedsReview = numberValue(importReviewSummary.needsReviewCount)
    ?? numberValue(importData.needsConfirmationCount)
    ?? 0;
  const sessionData = objectRecordValue(checkpoint.session);
  const normalizedSessionData = stringRecordValue(sessionData.id)
    ? sessionData
    : stringRecordValue(sessionData.sessionId)
      ? { ...sessionData, id: stringRecordValue(sessionData.sessionId) }
      : stringRecordValue(sessionData.tailoringSessionId)
        ? { ...sessionData, id: stringRecordValue(sessionData.tailoringSessionId) }
        : sessionData;
  const targetSnapshotData = objectRecordValue(checkpoint.targetSnapshot ?? normalizedSessionData.targetSnapshot);
  const targetSnapshotId = stringRecordValue(checkpoint.targetSnapshotId ?? targetSnapshotData.id);
  const targetSnapshotVersion = numberValue(checkpoint.targetSnapshotVersion ?? targetSnapshotData.version);
  const targetSnapshotHash = stringRecordValue(checkpoint.targetSnapshotHash ?? targetSnapshotData.rawTextHash);
  const savedJobId = stringRecordValue(checkpoint.savedJobId ?? targetSnapshotData.sourceJobId);
  const hasExternalTargetSnapshot = Boolean(targetSnapshotId || Object.keys(targetSnapshotData).length);
  const tailoringBranch = objectRecordValue(normalizedSessionData.branch);
  const tailoringSourceResumeId = task.workflowId === "tailor_existing_resume"
    ? task.selectedEntities.sourceResumeId
      ?? stringRecordValue(tailoringBranch.id)
      ?? stringRecordValue(checkpoint.resumeId)
    : undefined;
  const tailoringSourceResumeRevisionId = task.workflowId === "tailor_existing_resume"
    ? task.selectedEntities.sourceResumeRevisionId
      ?? stringRecordValue(tailoringBranch.currentRevisionId)
    : undefined;
  const selectedEntities = {
    ...task.selectedEntities,
    ...(stringRecordValue(checkpoint.profileId) ? { profileId: stringRecordValue(checkpoint.profileId) } : {}),
    ...(stringRecordValue(checkpoint.resumeId) ? { resumeId: stringRecordValue(checkpoint.resumeId) } : {}),
    ...(stringRecordValue(checkpoint.jobId) && !hasExternalTargetSnapshot ? { jobId: stringRecordValue(checkpoint.jobId) } : {}),
    ...(stringRecordValue(result.profileId) ? { profileId: stringRecordValue(result.profileId) } : {}),
    ...(stringRecordValue(result.resumeId) ? { resumeId: stringRecordValue(result.resumeId) } : {}),
    ...(stringRecordValue(result.jobId) && !hasExternalTargetSnapshot ? { jobId: stringRecordValue(result.jobId) } : {}),
    ...(stringRecordValue(importData.importId) ? { revisionId: stringRecordValue(importData.importId) } : {}),
    ...(checkpoint.kind === "tailoring_session" && stringRecordValue(tailoringBranch.id) && !task.selectedEntities.resultResumeId
      ? {
          resumeId: stringRecordValue(tailoringBranch.id),
          sourceResumeId: stringRecordValue(tailoringBranch.id),
          sourceResumeRevisionId: stringRecordValue(tailoringBranch.currentRevisionId)
        }
      : {}),
    ...(stringRecordValue(sessionData.jobId) && !hasExternalTargetSnapshot ? { jobId: stringRecordValue(sessionData.jobId) } : {}),
    ...(targetSnapshotId ? { targetSnapshotId } : {}),
    ...(targetSnapshotVersion !== undefined ? { targetSnapshotVersion } : {}),
    ...(targetSnapshotHash ? { targetSnapshotHash } : {}),
    ...(savedJobId ? { savedJobId, jobId: savedJobId } : {}),
    ...(checkpoint.kind === "tailoring_session" && stringRecordValue(normalizedSessionData.id)
      ? { tailoringSessionId: stringRecordValue(normalizedSessionData.id) }
      : {}),
    ...(tailoringSourceResumeId
      ? {
          resumeId: tailoringSourceResumeId,
          sourceResumeId: tailoringSourceResumeId,
          ...(tailoringSourceResumeRevisionId ? { sourceResumeRevisionId: tailoringSourceResumeRevisionId } : {})
        }
      : {})
  };
  const tailoringFitCompleted = toolName === "career.workflow.job_fit"
    && task.workflowId === "tailor_existing_resume"
    && status === "completed";
  const completionStatus = tailoringFitCompleted
    ? "active" as const
    : status === "completed"
      ? "completed" as const
      : status === "waiting_for_user"
        ? "waiting_for_user" as const
        : status === "waiting_for_confirmation"
          ? "waiting_for_confirmation" as const
          : status === "failed"
            ? "failed" as const
            : "active" as const;
  const stage = tailoringFitCompleted
    ? "generate_plan"
    : toolName === "career.workflow.job_fit" && completionStatus === "completed"
      ? "completed"
      : toolName === "career.workflow.profile_to_resume" && completionStatus === "completed"
        ? "resume_ready"
        : toolName === "career.workflow.compose_resume" && completionStatus === "completed"
          ? "resume_ready"
          : toolName === "career.workflow.compose_resume" && completionStatus === "waiting_for_confirmation"
            ? "review_composition"
            : toolName === "career.workflow.resume_export" && completionStatus === "completed"
              ? "export_ready"
              : toolName === "career.workflow.resume_import"
                ? "import_review"
                : toolName === "career.workflow.profile_intake_finalize"
                  ? "final_review"
                  : toolName === "career.workflow.tailor_resume"
                    ? normalizeTailoringStage(facadeWorkflowStage ?? "")
                      ?? (isTailoringQuestionPaused(normalizedSessionData) ? "clarify_unsupported_facts" : "generate_changes")
                    : task.stage;
  const knownSlots: Record<string, unknown> = {
    ...task.knownSlots,
    facadeCheckpoint: { ...checkpoint, status },
    ...(checkpoint.kind === "job_fit" ? { fitAnalysis: result } : {}),
    ...(checkpoint.kind === "profile_to_resume" ? { resumeResult: result } : {}),
    ...(checkpoint.kind === "resume_composition" ? {
      resumeCompositionCheckpoint: checkpoint,
      resumeCompositionProposal: checkpoint.proposal,
      resumeCompositionBlueprint: checkpoint.blueprint,
      resumeCompositionMetrics: checkpoint.metrics,
      resumeCompositionInformationNeeds: checkpoint.informationNeeds,
      ...(completionStatus === "completed" ? {
        resumeCompositionResult: Object.keys(result).length
          ? { ...objectRecordValue(checkpoint.compositionResult), ...result }
          : checkpoint.compositionResult
      } : {})
    } : {}),
    ...(checkpoint.kind === "resume_export" ? { exportResult: result } : {}),
    ...(checkpoint.kind === "tailoring_session" ? {
      ...(Object.prototype.hasOwnProperty.call(checkpoint, "fitAnalysis") ? { fitAnalysis: checkpoint.fitAnalysis } : {}),
      tailoringSession: normalizedSessionData,
      questionPlan: objectRecordValue(objectRecordValue(normalizedSessionData.plan).questionPlan),
      activeQuestionId: stringRecordValue(objectRecordValue(objectRecordValue(normalizedSessionData.plan).questionPlan).activeQuestionId)
    } : {}),
    ...(hasExternalTargetSnapshot ? {
      targetSnapshot: targetSnapshotData,
      targetSourceType: stringRecordValue(checkpoint.targetSourceType ?? targetSnapshotData.sourceType) ?? "pasted_jd",
      ...(stringRecordValue(checkpoint.jobPersistenceDecision) ? { jobPersistenceDecision: stringRecordValue(checkpoint.jobPersistenceDecision) } : {})
    } : {}),
    ...(checkpoint.kind === "profile_intake_turn" ? {
      intakeImportId: understood.importId,
      expectedIntakeDraftRevision: understood.expectedDraftRevision,
      profileIntakeCaptureResult: understood,
      profileIntakeProviderStatus: understood.providerStatus,
      profileIntakeExtractionStatus: understood.extractionStatus,
      profileIntakePersistenceStatus: understood.persistenceStatus,
      profileIntakePersistenceReceipt: understood.persistenceReceipt,
      intakeSession: understood.intakeSession,
      profileIntakeNextTurnPlan: understood.nextTurnPlan,
      profileIntakeReviewProjection: understood.reviewProjection,
      intakeCandidates: understood.candidates,
      intakeArtifact: understood.artifactPayload,
      intakeInterviewPlan: understood.interviewPlan,
      intakeFollowUpQuestion: understood.followUpQuestion,
      profileIntakePhase: "clarifying"
    } : {}),
    ...(checkpoint.kind === "profile_intake_final_review" ? {
      intakeImportId: synthesis.importId,
      expectedIntakeDraftRevision: synthesis.expectedDraftRevision,
      profileIntakeFinalSynthesis: synthesis.finalSynthesis,
      profileIntakeReviewProjection: synthesis.reviewProjection,
      intakeCandidates: synthesis.candidates,
      intakeArtifact: synthesis.artifactPayload,
      intakeSession: synthesis.intakeSession,
      intakeInterviewPlan: synthesis.interviewPlan,
      profileIntakePersistenceReceipt: synthesis.persistenceReceipt,
      profileIntakePhase: "ready_for_review",
      finalReviewRevision: synthesis.expectedDraftRevision
    } : {}),
    ...(checkpoint.kind === "resume_import_review" ? {
      importId: importData.importId,
      expectedDraftRevision: importData.expectedDraftRevision,
      importReviewSummary: importData.reviewSummary ?? importArtifactPayload,
      importArtifact: Object.keys(importArtifactPayload).length
        ? importArtifactPayload
        : {
            sourceFile: importData.fileName ?? importData.sourceFile ?? task.attachment?.fileName,
            sourceType: importData.sourceType ?? importData.sourceKind,
            ...(Array.isArray(importData.warnings) ? { warnings: importData.warnings } : {})
          },
      reviewStatus: importNeedsReview > 0
        ? "needs_review"
        : "reviewed"
    } : {})
  };
  if (checkpoint.kind === "career_context" || checkpoint.kind === "tailoring_source_selection") {
    const profileCandidates = Array.isArray(checkpoint.profileCandidates) ? checkpoint.profileCandidates : [];
    const resumeCandidates = Array.isArray(checkpoint.resumeCandidates) ? checkpoint.resumeCandidates : [];
    const contextBindingState = stringRecordValue(checkpoint.contextBindingState);
    if (contextBindingState) knownSlots.careerContextBindingState = contextBindingState;
    if (profileCandidates.length) {
      knownSlots.profileCandidates = profileCandidates;
      knownSlots.profileCandidateSetRevision = stableHashText(JSON.stringify(profileCandidates));
    }
    if (resumeCandidates.length) {
      knownSlots.resumeCandidates = resumeCandidates;
      knownSlots.resumeSelectionRequired = true;
      knownSlots.resumeCandidateSetRevision = stableHashText(JSON.stringify(resumeCandidates));
    } else if (checkpoint.kind === "tailoring_source_selection") {
      delete knownSlots.resumeCandidates;
      delete knownSlots.resumeSelectionRequired;
      delete knownSlots.resumeCandidateSetRevision;
    }
    const sourceRoute = stringRecordValue(checkpoint.sourceRoute);
    if (sourceRoute) knownSlots.sourceRoute = sourceRoute === "profile" ? "profile_to_job_resume" : sourceRoute;
    const profileRoute = stringRecordValue(checkpoint.profileRoute);
    if (profileRoute) knownSlots.profileRoute = profileRoute;
  }
  if (checkpoint.kind === "resume_composition" && completionStatus === "completed") {
    delete knownSlots.resumeCompositionPendingInformationNeed;
  } else if (checkpoint.kind === "resume_composition") {
    delete knownSlots.resumeCompositionResult;
  }
  const authoritativeActiveQuestionId = stringValue(
    knownSlots.activeQuestionId
    ?? objectValue(knownSlots.questionPlan).activeQuestionId
  );
  const effectiveCompletionStatus = stage === "clarify_unsupported_facts" && authoritativeActiveQuestionId
    ? "waiting_for_user" as const
    : completionStatus;
  const nextSession = {
    ...session,
    taskState: {
      ...task,
      stage,
      selectedEntities,
      knownSlots,
      artifacts: [...new Set([...task.artifacts, ...session.artifactRefs.map((artifact) => artifact.id)])],
      completionStatus: effectiveCompletionStatus,
      lastObservation: { source: "career_workflow_facade", toolName, status, checkpoint },
      updatedAt: new Date().toISOString()
    }
  };
  return projectTaskStateIntoSession(nextSession, normalizeAgentTaskState(nextSession.taskState));
}

function artifactActionExecution(
  state: AgentTaskState | undefined,
  action: AgentArtifactAction
): { toolName: string; toolInput: Record<string, unknown>; decision: string } | undefined {
  if (!state) return undefined;
  if (action.type === "tailoring_diff_decision") {
    const session = objectValue(state.knownSlots.tailoringSession);
    const plan = objectValue(session.plan);
    const reviews = Array.isArray(plan.diffReviews) ? plan.diffReviews.map(objectValue) : [];
    if (!reviews.some((review) => review.diffId === action.diffId)) return undefined;
    return {
      toolName: "review_tailoring_diff",
      decision: action.decision,
      toolInput: {
        session: state.knownSlots.tailoringSession,
        diffId: action.diffId,
        decision: action.decision,
        editedValue: action.editedValue
      }
    };
  }
  if (action.type === "tailoring_diff_stage_decision" || action.type === "tailoring_diff_submit") return undefined;
  if (action.type === "tailoring_answer_edit") {
    const session = objectValue(state.knownSlots.tailoringSession);
    const plan = objectValue(session.plan);
    const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers.map(objectValue) : [];
    if (!answers.some((answer) => answer.questionId === action.questionId)) return undefined;
    return {
      toolName: "answer_tailoring_question",
      decision: "edit",
      toolInput: {
        session: state.knownSlots.tailoringSession,
        questionId: action.questionId,
        answer: action.answer,
        proficiency: action.proficiency
      }
    };
  }
  if (action.type === "tailoring_regenerate") {
    const session = objectValue(state.knownSlots.tailoringSession);
    const plan = objectValue(session.plan);
    const questionPlan = objectValue(plan.questionPlan);
    const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
    const activeQuestionId = questionPlan.activeQuestionId;
    const answeredIds = new Set(answers.map((answer) => objectValue(answer).questionId).filter((id): id is string => typeof id === "string"));
    const questionIds = Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds.filter((id): id is string => typeof id === "string") : [];
    if (activeQuestionId || questionIds.some((id) => !answeredIds.has(id))) return undefined;
    const generationStatus = plan.generationStatus;
    const generationReady = generationStatus === "ready_for_regeneration" || generationStatus === "not_started" || generationStatus === undefined;
    const markerMatches = plan.generationStatus === "completed"
      && plan.generatedDiffsBasedOnQuestionPlanRevision === questionPlan.revision
      && plan.generatedDiffsBasedOnAnswerRevisionHash === plan.answerRevisionHash;
    if (!generationReady && markerMatches) return undefined;
    return {
      toolName: "generate_tailoring_changes",
      decision: "regenerate",
      toolInput: { session: state.knownSlots.tailoringSession }
    };
  }
  if (action.type === "profile_intake_retry_extraction") {
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
    const source = objectValue(state.knownSlots.latestIntakeSource);
    if (
      !projection.success
      || state.stage !== "review_facts"
      || projection.data.importId !== action.importId
      || projection.data.draftRevision !== action.expectedDraftRevision
      || projection.data.sourceMessageId !== action.sourceMessageId
      || projection.data.extractionStatus !== "failed"
      || source.messageId !== action.sourceMessageId
      || typeof source.sessionId !== "string"
      || typeof source.turnId !== "string"
      || typeof source.exactSourceQuote !== "string"
      || typeof source.capturedAt !== "string"
      || typeof state.knownSlots.targetProfileId !== "string"
      || typeof state.knownSlots.expectedProfileVersion !== "number"
    ) return undefined;
    return {
      toolName: "capture_profile_intake",
      decision: "retry",
      toolInput: {
        sessionId: source.sessionId,
        messageId: source.messageId,
        turnId: source.turnId,
        text: source.exactSourceQuote,
        capturedAt: source.capturedAt,
        sourceContentHash: source.sourceContentHash,
        targetProfileId: state.knownSlots.targetProfileId,
        expectedProfileVersion: state.knownSlots.expectedProfileVersion,
        acknowledgedActiveProfileId: state.knownSlots.acknowledgedActiveProfileId,
        importId: action.importId,
        expectedDraftRevision: action.expectedDraftRevision,
        retry: true
      }
    };
  }
  if (action.type === "profile_intake_final_review_decision") {
    const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
    if (
      !projection.success
      || !projection.data.finalSynthesis
      || state.stage !== "final_review"
      || state.knownSlots.intakeImportId !== action.importId
      || state.knownSlots.expectedIntakeDraftRevision !== action.expectedDraftRevision
    ) return undefined;
    return {
      toolName: "review_profile_intake",
      decision: action.decision,
      toolInput: {
        importId: action.importId,
        expectedDraftRevision: action.expectedDraftRevision,
        decision: action.decision
      }
    };
  }
  if (action.type === "profile_intake_candidate_decision") {
    const candidates = Array.isArray(state.knownSlots.intakeCandidates)
      ? state.knownSlots.intakeCandidates.map(objectValue)
      : [];
    const candidate = candidates.find((item) => item.id === action.candidateId);
    const accepted = candidate?.decision === "accept" || candidate?.included === true;
    const finalProjection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
    const finalReview = state.stage === "final_review" && finalProjection.success && Boolean(finalProjection.data.finalSynthesis);
    if (
      !finalReview && state.stage !== "review_facts" && !(state.stage === "collect_experience" && action.decision === "reopen")
      || !candidate
      || action.decision === "accept" && (accepted || candidate.needsNormalization === true || candidate.canAccept === false)
      || action.decision === "reject" && !accepted && candidate.decision === "reject"
      || action.decision === "reopen" && !accepted
      || typeof state.knownSlots.intakeImportId !== "string"
      || typeof state.knownSlots.expectedIntakeDraftRevision !== "number"
    ) {
      return undefined;
    }
    return {
      toolName: "review_profile_intake",
      decision: action.decision,
      toolInput: {
        importId: state.knownSlots.intakeImportId,
        expectedDraftRevision: state.knownSlots.expectedIntakeDraftRevision,
        candidateId: action.candidateId,
        decision: action.decision
      }
    };
  }
  if (action.type === "profile_intake_candidate_edit") {
    const candidates = Array.isArray(state.knownSlots.intakeCandidates)
      ? state.knownSlots.intakeCandidates.map(objectValue)
      : [];
    const candidate = candidates.find((item) => item.id === action.candidateId);
    const candidateAccepted = candidate?.decision === "accept" || candidate?.included === true;
    const finalProjection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
    const finalReview = state.stage === "final_review" && finalProjection.success && Boolean(finalProjection.data.finalSynthesis);
    if (
      (!finalReview && state.stage !== "review_facts" && !(state.stage === "collect_experience" && candidateAccepted))
      || !candidate
      || state.knownSlots.intakeImportId !== action.importId
      || state.knownSlots.expectedIntakeDraftRevision !== action.expectedDraftRevision
    ) return undefined;
    const sourceQuote = typeof candidate.sourceQuote === "string" ? candidate.sourceQuote : undefined;
    const source = objectValue(state.knownSlots.latestIntakeSource);
    if (action.userCorrection !== true && (!sourceQuote || typeof source.sessionId !== "string" || typeof source.messageId !== "string" || typeof source.turnId !== "string" || typeof source.capturedAt !== "string")) return undefined;
    return {
      toolName: "review_profile_intake",
      decision: "accept",
      toolInput: {
        importId: action.importId,
        expectedDraftRevision: action.expectedDraftRevision,
         candidateId: action.candidateId,
         decision: "accept",
         ...(action.sectionType ? { sectionType: action.sectionType } : {}),
         ...(action.userCorrection === true ? { userCorrection: true } : {}),
         ...(action.editedLabel ? { editedLabel: action.editedLabel } : {}),
         ...(action.fieldPatch ? { structuredPatch: action.fieldPatch } : {}),
         ...(action.userCorrection === true ? {} : {
           evidence: {
             sessionId: source.sessionId,
             messageId: source.messageId,
             turnId: source.turnId,
             capturedAt: source.capturedAt,
             sourceQuote,
             sourceContentHash: typeof source.sourceContentHash === "string" ? source.sourceContentHash : undefined
           }
         })
       }
    };
  }
  if (action.type === "profile_intake_reconciliation_decision") {
    if (
      state.stage !== "resolve_conflicts"
      || typeof state.knownSlots.intakeImportId !== "string"
      || typeof state.knownSlots.expectedIntakeReconciliationRevision !== "number"
    ) return undefined;
    const reconciliation = objectValue(state.knownSlots.intakeReconciliation);
    const unresolved = Array.isArray(reconciliation.unresolved)
      ? reconciliation.unresolved.map(objectValue)
      : [];
    if (!unresolved.some((item) => item.incomingItemId === action.incomingItemId)) return undefined;
    return {
      toolName: "resolve_profile_intake_conflict",
      decision: action.resolution,
      toolInput: {
        importId: state.knownSlots.intakeImportId,
        expectedPlanRevision: state.knownSlots.expectedIntakeReconciliationRevision,
        incomingItemId: action.incomingItemId,
        resolution: action.resolution,
        targetProfileId: state.knownSlots.targetProfileId
      }
    };
  }
  if (action.type === "resume_import_review_decision") {
    if (
      state.stage !== "import_review"
      || typeof state.knownSlots.importId !== "string"
      || typeof state.knownSlots.expectedDraftRevision !== "number"
    ) {
      return undefined;
    }
    return {
      toolName: "review_resume_import",
      decision: action.decision,
      toolInput: {
        importId: state.knownSlots.importId,
        expectedDraftRevision: state.knownSlots.expectedDraftRevision,
        decision: action.decision
      }
    };
  }
  if (action.type === "profile_intake_extraction_recovery") return undefined;
  if (
    state.stage !== "resolve_conflicts"
    || typeof state.knownSlots.importId !== "string"
    || typeof state.knownSlots.expectedReconciliationRevision !== "number"
  ) {
    return undefined;
  }
  const reconciliation = objectValue(state.knownSlots.importReconciliation);
  const unresolved = Array.isArray(reconciliation.unresolved)
    ? reconciliation.unresolved.map(objectValue)
    : [];
  if (!unresolved.some((item) => item.incomingItemId === action.incomingItemId)) return undefined;
  return {
    toolName: "resolve_resume_reconciliation",
    decision: action.resolution,
    toolInput: {
      importId: state.knownSlots.importId,
      expectedPlanRevision: state.knownSlots.expectedReconciliationRevision,
      incomingItemId: action.incomingItemId,
      resolution: action.resolution
    }
  };
}

function artifactActionCompletedLabel(action: AgentArtifactAction) {
  if (action.type === "tailoring_diff_stage_decision") return "已暂存这项岗位修改选择。";
  if (action.type === "tailoring_diff_submit") return "已统一提交岗位修改选择。";
  if (action.type === "tailoring_diff_decision") {
    return action.decision === "accept" ? "已采用这项修改。" : action.decision === "edit" ? "已采用编辑后的修改。" : "已忽略这项修改。";
  }
  if (action.type === "tailoring_answer_edit") return "已更新这项回答；原修改建议已标记为需要重新生成。";
  if (action.type === "tailoring_regenerate") return "已重新生成修改建议。";
  if (action.type === "profile_intake_candidate_edit") return "已保存这项类型化字段编辑，并保留原始来源证据。";
  if (action.type === "profile_intake_retry_extraction") return "已重新整理这段原始回答。";
  if (action.type === "profile_intake_extraction_recovery") {
    return action.decision === "manual_review" ? "已切换为手动整理，并保留原始回答。" : "已保留原始回答，未确认内容不会写入资料库。";
  }
  if (action.type === "profile_intake_final_review_decision") return "已一次性采用最终资料草稿，仍未写入资料库。";
  if (action.type === "profile_intake_candidate_decision") {
    return action.decision === "accept"
      ? "已采用，仍保留在本地整理草稿中。"
      : action.decision === "reopen"
        ? "已撤销采用，可以重新核对这项经历。"
        : "已忽略这项经历候选。";
  }
  if (action.type === "profile_intake_reconciliation_decision") return "已记录这项资料冲突的处理决定。";
  if (action.type === "resume_import_review_decision") {
    return action.decision === "accept_all" ? "已采用来源明确的导入内容。" : "已忽略不确定的导入内容。";
  }
  return "已记录这项资料冲突的处理决定。";
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function recordRuntimeToolFailure(
  session: AgentSession,
  failure: {
    toolName: string;
    operationId: string;
    code: string;
    message?: string;
    recoverable?: boolean;
    diagnostics?: Record<string, unknown>;
    occurredAt: string;
  }
) {
  if (!session.activeTurn) return session;
  const prior = session.activeTurn.toolFailures ?? [];
  const alreadyRecorded = prior.some((item) => item.toolName === failure.toolName && item.operationId === failure.operationId);
  return {
    ...session,
    activeTurn: {
      ...session.activeTurn,
      toolFailures: alreadyRecorded ? prior : [...prior, failure].slice(-32),
      lastFailedTool: failure.toolName,
      lastFailedOperationId: failure.operationId,
      lastSafeErrorCode: failure.code
    }
  };
}

function markTailoringAnswerConsumed(session: AgentSession, turnId: string, operationId: string) {
  const userMessageId = session.activeTurn?.id === turnId ? session.activeTurn.userMessageId : undefined;
  if (!userMessageId) return session;
  const userMessage = session.messages.find((message) => message.id === userMessageId);
  if (userMessage?.role !== "user" || userMessage.metadata?.answerPayload !== true) return session;
  return {
    ...session,
    messages: session.messages.map((message) => message.id === userMessageId
      ? {
          ...message,
          metadata: {
            ...message.metadata,
            executionState: "complete",
            answerOperationId: operationId,
            answerConsumedAt: new Date().toISOString()
          },
          updatedAt: new Date().toISOString()
        }
      : message)
  };
}

function replaceRuntimeShellMessage(
  session: AgentSession,
  messageId: string,
  content: string,
  event: AgentRuntimeEvent,
  streaming = false,
  failed = false
) {
  const now = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message) => message.id === messageId && !isWorkflowInteractionMessage(message)
      ? {
          ...message,
          turnId: event.turnId,
          content,
          kind: failed ? "error_status" as const : streaming ? "assistant_streaming" as const : "text" as const,
          type: failed ? "error" as const : streaming ? "assistant_streaming" as const : "text" as const,
          status: failed ? "failed" as const : streaming ? "streaming" as const : "complete" as const,
          streaming,
           ...(failed && event.error?.code ? { errorCode: event.error.code } : {}),
           metadata: {
             ...message.metadata,
             runtimeId: "hermes",
             ...(failed && isHermesRuntimeFailureCode(event.error?.code)
               ? { runtimeFailurePresentation: "topbar" }
               : {}),
             ...(event.type === "text_delta" ? { runtimeTextStarted: true } : {})
           },
          updatedAt: now
        }
      : message),
    updatedAt: now
  };
}

function projectDeterministicAssistantMessage(
  session: AgentSession,
  turnId: string,
  content: string,
  messageId: string
) {
  const existing = session.messages.findLast((message) =>
    message.role === "assistant"
    && message.turnId === turnId
    && !isWorkflowInteractionMessage(message)
    && message.metadata?.retracted !== true
  );
  if (existing) {
    return {
      ...session,
      messages: session.messages.map((message) => message.id === existing.id
        ? {
            ...message,
            content,
            kind: "text" as const,
            type: "text" as const,
            status: "complete" as const,
            streaming: false,
            metadata: { ...message.metadata, runtimeId: "hermes", deterministicTransactionMessage: true },
            updatedAt: new Date().toISOString()
          }
        : message),
      updatedAt: new Date().toISOString()
    };
  }
  return appendAgentMessage(session, "assistant", content, {
    id: messageId,
    turnId,
    kind: "text",
    type: "text",
    status: "complete",
    metadata: { runtimeId: "hermes", deterministicTransactionMessage: true }
  });
}

function applyRuntimeEventDiagnostics(session: AgentSession, event: AgentRuntimeEvent, hermesRunId?: string) {
  if (!session.activeTurn) return session;
  const data = objectValue(event.data);
  const telemetry = objectValue(data.telemetry);
  const runtime = (value: unknown): "native" | "hermes" | undefined =>
    value === "native" || value === "hermes" ? value : undefined;
  const fallbackUsed = data.fallbackUsed === true || telemetry.fallbackUsed === true;
  const fallbackReasonCode = stringValue(data.fallbackReasonCode) ?? stringValue(telemetry.fallbackReasonCode);
  const runtimeFailureAt = stringValue(data.runtimeFailureAt) ?? stringValue(telemetry.runtimeFailureAt);
  const executionOwner = data.executionOwner === "native" || data.executionOwner === "hermes" || data.executionOwner === "deterministic_transition" || data.executionOwner === "runtime_continuation"
    ? data.executionOwner
    : telemetry.executionOwner === "native" || telemetry.executionOwner === "hermes" || telemetry.executionOwner === "deterministic_transition" || telemetry.executionOwner === "runtime_continuation"
      ? telemetry.executionOwner
      : undefined;
  const nextHermesRunId = stringValue(data.nextHermesRunId) ?? stringValue(telemetry.nextHermesRunId);
  const runtimeFailureDiagnostics = data.diagnostics && typeof data.diagnostics === "object" && !Array.isArray(data.diagnostics)
    ? data.diagnostics as Record<string, unknown>
    : undefined;
  const eventStream = EventStreamDiagnosticSchema.safeParse(data.eventStream ?? telemetry.eventStream);
  const incidentTraceId = stringValue(data.incidentTraceId)
    ?? stringValue(telemetry.incidentTraceId)
    ?? session.activeTurn.incidentTraceId
    ?? createIncidentTraceId();
  const failureSnapshotCandidate = data.failureSnapshot ?? telemetry.failureSnapshot;
  const failureSnapshot = RuntimeFailureSnapshotSchema.safeParse(failureSnapshotCandidate);
  const observedLogicalTurnId = stringValue(data.logicalTurnId) ?? stringValue(telemetry.logicalTurnId);
  const expectedRunId = hermesRunId ?? session.activeTurn.hermesRunId;
  const snapshotRunId = failureSnapshot.success ? failureSnapshot.data.run.runId : undefined;
  const snapshotBelongsToCurrentIncident = (!observedLogicalTurnId || observedLogicalTurnId === session.activeTurn.id)
    && (!expectedRunId || !snapshotRunId || expectedRunId === snapshotRunId);
  const stopReason = RunStopReasonSchema.safeParse(data.stopReason ?? telemetry.stopReason);
  const abortTrace = AbortTraceSchema.safeParse(data.abortTrace ?? telemetry.abortTrace);
  const causalChainCandidate = data.primaryCausalChain
    ?? telemetry.primaryCausalChain
    ?? runtimeFailureDiagnostics?.primaryCausalChain;
  const primaryCausalChain = Array.isArray(causalChainCandidate)
    ? causalChainCandidate.flatMap((entry) => {
        const parsed = RuntimeCausalChainEntrySchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }).slice(-48)
    : undefined;
  const secondaryFailureCandidate = data.secondaryRecoveryFailures
    ?? telemetry.secondaryRecoveryFailures
    ?? runtimeFailureDiagnostics?.secondaryRecoveryFailures;
  const secondaryRecoveryFailures = Array.isArray(secondaryFailureCandidate)
    ? secondaryFailureCandidate.flatMap((entry) => {
        const parsed = SecondaryRecoveryFailureSchema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      }).slice(-16)
    : undefined;
  const nextRuntimeAttempts = updateRuntimeAttempts(session.activeTurn.runtimeAttempts, {
    event,
    data,
    telemetry,
    incidentTraceId,
    hermesRunId
  });
  const nextAbortTraces = abortTrace.success
    ? [...(session.activeTurn.abortTraces ?? []), abortTrace.data].slice(-32)
    : session.activeTurn.abortTraces;
  const nextRuntimeFailureSnapshot = session.activeTurn.runtimeFailureSnapshot
    ?? (failureSnapshot.success && snapshotBelongsToCurrentIncident ? failureSnapshot.data : undefined);
  const previousRuntimeIncidents = failureSnapshot.success && !snapshotBelongsToCurrentIncident
    ? [...(session.activeTurn.previousRuntimeIncidents ?? []), failureSnapshot.data].slice(-16)
    : session.activeTurn.previousRuntimeIncidents;
  const previousHermesRunId = session.activeTurn.hermesRunId;
  const observedNextHermesRunId = nextHermesRunId
    ?? (hermesRunId && previousHermesRunId && hermesRunId !== previousHermesRunId ? hermesRunId : undefined);
  const mergedPrimaryCausalChain = primaryCausalChain
    ? [...(session.activeTurn.primaryCausalChain ?? []), ...primaryCausalChain]
      .filter((entry, index, entries) => entries.findIndex((candidate) =>
        candidate.event === entry.event
        && candidate.at === entry.at
        && candidate.runId === entry.runId
        && candidate.attemptTraceId === entry.attemptTraceId
      ) === index)
      .slice(-48)
    : session.activeTurn.primaryCausalChain;
  const mergedSecondaryRecoveryFailures = secondaryRecoveryFailures
    ? [...(session.activeTurn.secondaryRecoveryFailures ?? []), ...secondaryRecoveryFailures]
      .filter((entry, index, entries) => entries.findIndex((candidate) =>
        candidate.code === entry.code
        && candidate.capturedAt === entry.capturedAt
        && candidate.runId === entry.runId
        && candidate.operation === entry.operation
      ) === index)
      .slice(-16)
    : session.activeTurn.secondaryRecoveryFailures;
  return {
    ...session,
    activeTurn: {
      ...session.activeTurn,
      incidentTraceId,
      preferredRuntime: runtime(data.preferredRuntime) ?? runtime(telemetry.preferredRuntime) ?? session.activeTurn.preferredRuntime,
      attemptedRuntime: runtime(data.attemptedRuntime) ?? runtime(telemetry.attemptedRuntime) ?? session.activeTurn.attemptedRuntime,
      finalRuntime: runtime(data.finalRuntime) ?? runtime(telemetry.finalRuntime) ?? session.activeTurn.finalRuntime ?? "hermes",
      executionOwner: executionOwner ?? session.activeTurn.executionOwner,
      fallbackUsed: fallbackUsed || session.activeTurn.fallbackUsed === true,
      fallbackReasonCode: fallbackReasonCode ?? session.activeTurn.fallbackReasonCode,
      hermesRunId: hermesRunId ?? session.activeTurn.hermesRunId,
      nextHermesRunId: observedNextHermesRunId ?? (session.activeTurn.executionOwner === "deterministic_transition" ? hermesRunId : session.activeTurn.nextHermesRunId),
      firstEventAt: session.activeTurn.firstEventAt ?? event.timestamp,
      runtimeFailureAt: runtimeFailureAt ?? (event.type === "turn_failed" ? event.timestamp : session.activeTurn.runtimeFailureAt),
      runtimeAttempts: nextRuntimeAttempts,
      ...(eventStream.success ? { eventStream: eventStream.data } : {}),
      ...(previousRuntimeIncidents ? { previousRuntimeIncidents } : {}),
      ...(failureSnapshot.success && !session.activeTurn.runtimeFailureSnapshot ? { runtimeFailureSnapshot: failureSnapshot.data } : {}),
      ...(stopReason.success ? { cancellation: stopReason.data } : {}),
      ...(nextAbortTraces ? { abortTraces: nextAbortTraces } : {}),
      ...(mergedPrimaryCausalChain ? { primaryCausalChain: mergedPrimaryCausalChain } : {}),
      ...(mergedSecondaryRecoveryFailures ? { secondaryRecoveryFailures: mergedSecondaryRecoveryFailures } : {}),
      ...(data.recoveryAttempted === true || telemetry.recoveryAttempted === true || data.transportReattachAttempted === true || telemetry.transportReattachAttempted === true || data.semanticRetryAttempted === true || telemetry.semanticRetryAttempted === true ? { recoveryAttempted: true } : {}),
      ...(data.transportReattachAttempted === true || telemetry.transportReattachAttempted === true ? { transportReattachAttempted: true } : {}),
      ...(data.semanticRetryAttempted === true || telemetry.semanticRetryAttempted === true ? { semanticRetryAttempted: true } : {}),
      ...(data.runtimeRestartAttempted === true || telemetry.runtimeRestartAttempted === true ? { runtimeRestartAttempted: true } : {}),
      ...(runtimeFailureDiagnostics && event.type === "turn_failed"
        ? { runtimeFailureDiagnostics }
        : {}),
      ...(nextRuntimeFailureSnapshot && !session.activeTurn.runtimeFailureSnapshot
        ? { runtimeFailureSnapshot: nextRuntimeFailureSnapshot }
        : {})
    }
  };
}

function updateRuntimeAttempts(
  attempts: RuntimeAttempt[] | undefined,
  input: {
    event: AgentRuntimeEvent;
    data: Record<string, unknown>;
    telemetry: Record<string, unknown>;
    incidentTraceId: string;
    hermesRunId?: string;
  }
) {
  const { event, data, telemetry, incidentTraceId, hermesRunId } = input;
  const runHandle = objectValue(data.runHandle);
  const runId = hermesRunId ?? stringValue(runHandle.runId) ?? stringValue(data.runId) ?? stringValue(telemetry.runId);
  const traceId = stringValue(data.traceId)
    ?? stringValue(data.attemptTraceId)
    ?? stringValue(telemetry.traceId)
    ?? stringValue(telemetry.attemptTraceId)
    ?? (runId ? `${incidentTraceId}:${runId}` : undefined);
  if (!traceId) return attempts;
  const current = [...(attempts ?? [])];
  const index = current.findIndex((attempt) =>
    attempt.traceId === traceId
    || (runId && attempt.runId === runId)
  );
  const existing = index >= 0 ? current[index] : undefined;
  if (!runId && !existing) return attempts;
  const status = runtimeAttemptStatus(event, data, telemetry, existing?.status);
  const stopReason = RunStopReasonSchema.safeParse(data.stopReason ?? telemetry.stopReason);
  const cancellationOwner = stringValue(data.cancellationOwner)
    ?? stringValue(telemetry.cancellationOwner)
    ?? (stopReason.success ? stopReason.data.requestedBy : undefined)
    ?? (event.error?.code === "hermes_run_cancelled_upstream" ? "upstream" : undefined);
  const diagnostics = objectValue(data.diagnostics);
  const attemptNumber = numberValue(data.attemptNumber)
    ?? numberValue(telemetry.attemptNumber)
    ?? existing?.attemptNumber
    ?? Math.max(1, ...current.map((attempt) => attempt.attemptNumber + 1));
  const runStartStatus = stringValue(data.runStartStatus) ?? stringValue(telemetry.runStartStatus);
  const terminalStatus = event.type === "turn_completed"
    ? "completed"
    : event.type === "turn_failed" || event.type === "turn_interrupted"
      ? event.error?.code?.includes("cancel") || data.cancellationOwner || telemetry.cancellationOwner ? "cancelled" : "failed"
      : undefined;
  const recoveryKind = stringValue(data.recoveryKind) ?? stringValue(telemetry.recoveryKind);
  const attempt = RuntimeAttemptSchema.parse({
    ...(existing ?? {
      attemptNumber,
      traceId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      status: "requested"
    }),
    ...(runId ? { runId } : {}),
    ...(stringValue(data.hermesSessionId) || stringValue(diagnostics.hermesSessionId) ? { hermesSessionId: stringValue(data.hermesSessionId) ?? stringValue(diagnostics.hermesSessionId) } : {}),
    status,
    ...(runStartStatus === "started" || runStartStatus === "queued" || runStartStatus === "running" ? { runStartStatus } : {}),
    ...(terminalStatus ? { terminalStatus } : {}),
    lastEventType: event.type,
    ...(existing?.startRequestedAt ? {} : { startRequestedAt: stringValue(data.runStartRequestedAt) ?? stringValue(telemetry.runStartRequestedAt) ?? event.timestamp }),
    ...(existing?.runStartedAt ? {} : { runStartedAt: stringValue(data.runStartedAt) ?? stringValue(telemetry.runStartedAt) ?? event.timestamp }),
    ...(existing?.firstEventAt ? {} : { firstEventAt: event.timestamp }),
    ...(event.type === "turn_completed" || event.type === "turn_failed" || event.type === "turn_interrupted" ? { terminalAt: event.timestamp } : {}),
    ...(event.error?.code || stringValue(data.safeErrorCode) || stringValue(diagnostics.safeErrorCode)
      ? { failureCode: event.error?.code ?? stringValue(data.safeErrorCode) ?? stringValue(diagnostics.safeErrorCode) }
      : {}),
    ...(stringValue(diagnostics.failureLayer) ? { failureLayer: stringValue(diagnostics.failureLayer) } : {}),
    ...(typeof diagnostics.retryable === "boolean" ? { retryable: diagnostics.retryable } : {}),
    ...(stringValue(data.recoveryReason) ? { recoveryReason: stringValue(data.recoveryReason) } : {}),
    ...(recoveryKind === "reattach" || recoveryKind === "retry" || recoveryKind === "restart" ? { recoveryKind } : {}),
    ...(cancellationOwner ? { cancellationOwner } : {}),
    ...(stopReason.success ? { stopReason: stopReason.data } : {})
  });
  if (index >= 0) current[index] = attempt;
  else current.push(attempt);
  return current.slice(-8);
}

function runtimeAttemptStatus(
  event: AgentRuntimeEvent,
  data: Record<string, unknown>,
  telemetry: Record<string, unknown>,
  existing?: RuntimeAttempt["status"]
): RuntimeAttempt["status"] {
  if (event.type === "turn_completed") return "completed";
  if (event.type === "turn_failed" || event.type === "turn_interrupted") {
    return event.error?.code?.includes("cancel") || data.cancellationOwner || telemetry.cancellationOwner ? "cancelled" : "failed";
  }
  if (event.type === "approval_required" || event.type === "approval_requested") return "waiting_for_approval";
  if (event.type === "turn_paused") return "paused";
  if (event.type === "turn_resumed") return "running";
  if (event.type === "progress" || event.type === "reasoning_status" || event.type === "text_delta" || event.type.startsWith("tool_")) return "running";
  return existing ?? "requested";
}

function runtimeFailureRecoveryText(code?: string, taskState?: AgentTaskState, diagnostics?: Record<string, unknown>) {
  const failureLayer = stringValue(diagnostics?.toolFailureLayer);
  const safeErrorCategory = stringValue(diagnostics?.safeErrorCategory);
  if (/target_required/i.test(code ?? "")) return TARGET_REQUIRED_PROMPT;
  if (isCareerDomainPreconditionCode(code)) {
    if (code === "needs_profile" || code === "career_session_binding_required") {
      return "当前还没有可用于定制的个人资料。你可以选择已有资料，或先导入一份简历。";
    }
    if (code === "needs_profile_choice") return "当前有多份可用的个人资料，请先选择一份。";
    if (code === "needs_resume_choice" || code === "multiple_resume_sources") return "当前有多份可用的通用简历，请先选择一份。";
    if (code === "job_required") return "请选择已经保存的岗位，或直接粘贴岗位描述。";
    if (code === "clarification_required") return "请补充当前岗位定制中尚未确认的信息。";
    if (code === "confirmation_required") return "这一步需要你的明确确认。";
    if (code === "review_required") return "请检查当前结果并告诉我下一步如何处理。";
    return "请按下方问题或选项补充当前岗位定制所需的信息。";
  }
  if (
    diagnostics?.failureScope === "career_workflow"
    && (failureLayer === "gateway_validation" || /schema_validation_failed|target_required/i.test(code ?? ""))
  ) {
    return "这一步还没有完成。已保留当前岗位、简历和来源上下文，请按当前问题补充后继续。";
  }
  if (failureLayer === "mcp_transport" || /mcp_(?:bridge_)?(?:transport|unavailable|timeout)/i.test(code ?? "")) {
    return "这一步暂时没有返回结果。已保留当前任务和输入，确认工作区连接后可从当前步骤重试。";
  }
  if (safeErrorCategory === "provider_auth"
    || safeErrorCategory === "provider_request_invalid"
    || safeErrorCategory === "model_not_found"
    || safeErrorCategory === "context_overflow"
    || safeErrorCategory === "provider_timeout") {
    return "本轮回答失败。当前对话已保留，你可以稍后重试。";
  }
  if (isHermesRuntimeFailureCode(code)) {
    return "本轮回答失败。当前对话已保留，你可以重试。";
  }
  if (failureLayer === "fact_guard" || /fact_guard|ungrounded|unsupported_fact/i.test(code ?? "")) {
    return "这次简历修改没有通过事实核验，因此没有写入。已保留当前岗位与修改预览，请补充可确认的真实依据后继续。";
  }
  if (failureLayer === "provider" || /provider|model|ai_/i.test(code ?? "")) {
    return "这一步暂时没有完成。已保留当前岗位、简历和任务进度，可以稍后从当前步骤重试。";
  }
  if (code === "career_workflow_in_progress") {
    return "当前操作正在进行中；没有并行提交新的写入。请等待当前步骤完成后再继续。";
  }
  if (code === "agent_tool_not_allowed") {
    return "简历组装流程刚才没有完成，当前方向和已完成步骤已保留。请从当前步骤继续，我不会把未确认内容显示为简历。";
  }
  if (
    (taskState?.workflowId === "tailor_existing_resume" || taskState?.workflowId === "tailor_resume")
    && normalizeTailoringStage(taskState.stage) === "generate_plan"
    && taskState.knownSlots.fitAnalysis
    && taskState.selectedEntities.profileId
    && taskState.selectedEntities.resumeId
    && (taskState.selectedEntities.jobId || taskState.selectedEntities.targetSnapshotId || taskState.knownSlots.targetSnapshot)
  ) {
    return "岗位和简历已保留，定制计划生成过程中出现临时问题。可以直接重试此步骤。";
  }
  return "刚才的岗位分析步骤没有完成。已保留你选中的岗位，我正在从这里继续。";
}

function completionGuardRecoveryText(
  decision: { canFinish: boolean; requiredNextStage?: string },
  taskState?: AgentTaskState
) {
  const rootGoal = taskState?.rootGoal;
  const requiredNextStage = decision.requiredNextStage ?? taskState?.stage ?? "current_step";
  if (rootGoal === "generate_job_specific_resume" || rootGoal === "apply_to_external_job" || rootGoal === "create_tailored_resume") {
    return `岗位简历还没有形成可确认的完成凭证（当前步骤：${requiredNextStage}）。已保留岗位、来源简历和任务进度，请从当前步骤继续；不会把未确认内容当作正式简历。`;
  }
  return `当前任务尚未形成可确认的完成凭证（当前步骤：${requiredNextStage}）。已保留任务进度，请从当前步骤继续。`;
}

function resumePreviewUiAction(session: AgentSession): AgentUiAction | undefined {
  const taskState = session.taskState;
  const tailoringReceipt = taskState
    ? ResumeArtifactReceiptSchema.safeParse(
        taskState.knownSlots.artifactReceipt
          ?? objectRecordValue(taskState.knownSlots.qualityResult).artifactReceipt
      )
    : undefined;
  if (
    taskState?.workflowId === "compose_resume"
    && taskState.knownSlots.resumeCompositionResult
  ) {
    const artifact = session.artifactRefs.findLast((candidate) =>
      candidate.kind === "quality_result"
        && candidate.entityId === taskState.selectedEntities.resumeId
    );
    return artifact ? { type: "open_artifact", artifactId: artifact.id } : undefined;
  }
  if (!tailoringReceipt?.success) return undefined;
  const artifact = session.artifactRefs.findLast((candidate) =>
    candidate.kind === "quality_result"
      && candidate.entityId === tailoringReceipt.data.resultResumeId
  );
  return artifact ? { type: "open_artifact", artifactId: artifact.id } : undefined;
}

function artifactWriteCheckpointFromSession(session: AgentSession) {
  const candidate = session.taskState?.knownSlots.artifactWriteCheckpoint;
  const parsed = ResumeArtifactWriteCheckpointSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function withTailoringResultArtifact(session: AgentSession, receipt: ResumeArtifactReceipt) {
  const now = new Date().toISOString();
  return {
    ...session,
    artifactRefs: [
      ...session.artifactRefs.filter((artifact) => !(
        artifact.kind === "quality_result"
        && artifact.entityType === "resume_branch"
        && artifact.entityId === receipt.resultResumeId
      )),
      {
        id: `tailoring-result:${receipt.resultResumeId}`,
        kind: "quality_result" as const,
        title: "岗位简历生成结果",
        entityType: "resume_branch" as const,
        entityId: receipt.resultResumeId,
        route: `/resume?branchId=${encodeURIComponent(receipt.resultResumeId)}`,
        status: "active" as const,
        summary: "已生成独立岗位简历，可继续查看预览。",
        createdAt: now,
        updatedAt: now
      }
    ]
  };
}

function withOpenArtifactOption(session: AgentSession, messageId: string | undefined, resultResumeId: string) {
  if (!messageId) return session;
  const artifact = session.artifactRefs.findLast((candidate) =>
    candidate.kind === "quality_result" && candidate.entityId === resultResumeId
  );
  if (!artifact) return session;
  const option: AgentOption = {
    id: "open-job-resume",
    label: "打开岗位简历",
    action: { type: "open_artifact", artifactId: artifact.id }
  };
  return {
    ...session,
    messages: session.messages.map((message) => message.id === messageId && !isWorkflowInteractionMessage(message)
      ? { ...message, options: [option], optionSet: undefined }
      : message)
  };
}

function withTailoringRetryOption(session: AgentSession, messageId?: string) {
  if (!messageId) return session;
  const option: AgentOption = {
    id: "retry-tailoring-write",
    label: "重新生成岗位简历",
    action: { type: "retry_current_step" }
  };
  return {
    ...session,
    messages: session.messages.map((message) => message.id === messageId
      ? {
          ...message,
          options: [option],
          optionSet: activeOptionSetForMessage(session, message.id, "recovery")
        }
      : message)
  };
}

function updateArtifactWriteDiagnostics(
  session: AgentSession,
  input: {
    operationId: string;
    checkpointId?: string;
    status: string;
    sourceResumeId?: string;
    resultResumeId?: string;
    resultResumeRevisionId?: string;
    resultRevisionId?: string;
    safeErrorCode?: string;
    acceptedDiffCount?: number;
    changedFieldPaths?: string[];
    repositoryReadBackVerified: boolean;
    resumeListVisibilityVerified: boolean;
  }
) {
  if (!session.activeTurn) return session;
  const targetSnapshot = objectRecordValue(
    session.taskState?.knownSlots.targetSnapshot
      ?? objectRecordValue(session.taskState?.knownSlots.tailoringSession).targetSnapshot
  );
  const targetSourceType = stringRecordValue(targetSnapshot.sourceType);
  const targetSnapshotId = stringRecordValue(targetSnapshot.id);
  const targetSnapshotVersion = numberValue(targetSnapshot.version);
  const targetSnapshotHash = stringRecordValue(session.taskState?.knownSlots.targetSnapshotHash)
    ?? stringRecordValue(targetSnapshot.rawTextHash);
  const savedJobId = stringRecordValue(session.taskState?.knownSlots.savedJobId)
    ?? stringRecordValue(targetSnapshot.sourceJobId);
  const jobPersistenceDecision = session.taskState?.knownSlots.jobPersistenceDecision === "ask"
    || session.taskState?.knownSlots.jobPersistenceDecision === "save"
    || session.taskState?.knownSlots.jobPersistenceDecision === "session_only"
    ? session.taskState.knownSlots.jobPersistenceDecision
    : undefined;
  return {
    ...session,
    activeTurn: {
      ...session.activeTurn,
      runtimeFailureDiagnostics: {
        ...session.activeTurn.runtimeFailureDiagnostics,
        lastArtifactWrite: {
          operationId: input.operationId,
          ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
          status: input.status,
          ...(input.sourceResumeId ? { sourceResumeId: input.sourceResumeId } : {}),
          ...(input.resultResumeId ? { resultResumeId: input.resultResumeId } : {}),
          ...(input.resultResumeRevisionId ? { resultResumeRevisionId: input.resultResumeRevisionId } : {}),
          ...(input.resultRevisionId ? { resultRevisionId: input.resultRevisionId } : {}),
          ...(input.safeErrorCode ? { safeErrorCode: input.safeErrorCode } : {}),
          ...(typeof input.acceptedDiffCount === "number" ? { acceptedDiffCount: input.acceptedDiffCount } : {}),
          ...(input.changedFieldPaths ? { changedFieldPaths: input.changedFieldPaths } : {}),
          repositoryReadBackVerified: input.repositoryReadBackVerified,
          resumeListVisibilityVerified: input.resumeListVisibilityVerified,
          ...(targetSourceType ? { targetSourceType } : {}),
          ...(targetSnapshotId ? { targetSnapshotId } : {}),
          ...(targetSnapshotVersion !== undefined ? { targetSnapshotVersion } : {}),
          ...(targetSnapshotHash ? { targetSnapshotHash } : {}),
          ...(savedJobId ? { savedJobId } : {}),
          ...(jobPersistenceDecision ? { jobPersistenceDecision } : {}),
          workflowFacade: session.taskState?.workflowId === "tailor_existing_resume"
            ? "career.workflow.tailor_resume"
            : undefined
        }
      }
    }
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "profile_intake_capture_failed";
}

function errorMessage(error: unknown) {
  const code = safeErrorCode(error);
  if (/^provider_(?:dns_failed|connection_failed|tls_failed|tls_certificate_invalid|timeout|unavailable)|^provider_http_(?:408|425|429|5\d\d)$/u.test(code)) {
    return "AI 简历撰写服务连接失败，本次没有写入简历。你可以在连接恢复后重试，当前生成计划已保留。";
  }
  return error instanceof Error && error.message
    ? error.message
    : "简历写入没有完成，当前组装方案已保留，可以重试保存。";
}

function captureExtractionStatus(value: string): "structured_ai" | "structured_local" | "partial" | "failed" {
  if (value === "structured_local") return "structured_local";
  if (value === "structured_ai" || value === "structured") return "structured_ai";
  if (value === "partial") return "partial";
  return "failed";
}

function profileIntakeSourceTurnDiagnosticPatch(input: {
  processingStatus: ProfileIntakeSourceTurn["processingStatus"];
  extractionStatus?: "structured_ai" | "structured_local" | "partial" | "failed";
  safeErrorCode?: string;
  provider?: string;
  model?: string;
  attempt?: number;
  latencyMs?: number;
  candidateCount: number;
  quarantinedCount: number;
  operationId: string;
  semanticTask?: string;
  patchStage?: ProfileIntakeSourceTurn["patchStage"];
  schemaStage?: ProfileIntakeSourceTurn["schemaStage"];
  groundingStage?: string;
  repositoryStage?: ProfileIntakeSourceTurn["repositoryStage"];
  quarantinedFields?: string[];
}) {
  return {
    processingStatus: input.processingStatus,
    extractionStatus: input.extractionStatus,
    safeErrorCode: input.safeErrorCode,
    provider: input.provider,
    model: input.model,
    attempt: input.attempt,
    latencyMs: input.latencyMs,
    candidateCount: input.candidateCount,
    quarantinedCount: input.quarantinedCount,
    operationId: input.operationId,
    semanticTask: input.semanticTask,
    patchStage: input.patchStage,
    schemaStage: input.schemaStage,
    groundingStage: input.groundingStage,
    repositoryStage: input.repositoryStage,
    quarantinedFields: input.quarantinedFields ?? [],
    lastErrorCode: input.safeErrorCode
  } satisfies Partial<Omit<ProfileIntakeSourceTurn, "sessionId" | "messageId" | "turnId">>;
}

function isStaleProfileError(code: string | undefined) {
  return code === "profile_intake_stale_profile"
    || code === "profile_from_profile_stale"
    || code === "profile_intake_stale_revision"
    || code === "stale_revision";
}

function isStaleDraftError(code: string | undefined) {
  return code === "profile_intake_stale_revision"
    || code === "resume_import_stale_revision"
    || code === "stale_revision";
}

function withRetryCurrentStepOption(session: AgentSession, messageId?: string) {
  const index = messageId
    ? session.messages.findIndex((message) => message.id === messageId)
    : session.messages.findLastIndex((message) => message.role === "assistant");
  if (index < 0) return session;
  const option: AgentOption = {
    id: "retry-current-turn",
    label: "重新执行当前步骤",
    action: { type: "retry_current_step" }
  };
  return {
    ...session,
    messages: session.messages.map((message, messageIndex) => messageIndex === index
      ? {
          ...message,
          options: [
            ...(message.options ?? []).filter((candidate) => ![option.id, "retry-current-profile-intake-step"].includes(candidate.id)),
            option
          ],
          optionSet: activeOptionSetForMessage(session, message.id, "recovery")
        }
      : message)
  };
}
