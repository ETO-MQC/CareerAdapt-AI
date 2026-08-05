"use client";

import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import {
  deriveAgentSessionTitle,
  shouldAutoNameAgentSession,
  type AgentMessageReference,
  type AgentSession,
  type AgentTaskState,
  type AgentOptionSet
} from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import type { AgentKernel } from "@/agent/kernel/AgentKernel";
import type { AgentExecutor } from "@/agent/runtime/agentExecutor";
import type { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type {
  AgentArtifactAction,
  AgentOption,
  AgentUiAction,
  AgentWorkflowControl,
  ProfileIntakeSection
} from "@/agent/contracts/agentActions";
import { AgentTaskStateReducer, dependencySnapshot } from "./AgentTaskStateReducer";
import { appendAgentMessage, replaceAgentThinking, upsertAgentActivity } from "./AgentSessionMessages";
import { migrateAgentSessionToCurrentSchema } from "./AgentSessionMigration";
import { routeAgentIntent } from "./agentIntentRouter";
import {
  projectTaskStateIntoSession,
  projectTaskStateToWorkflowState
} from "./projectTaskStateToWorkflowState";
import { agentAttachmentStore, type AgentAttachmentRef } from "@/services/agent/AgentAttachmentStore";
import { agentImportProgressBus } from "@/services/agent/AgentImportProgressBus";
import { classifyProfileIntakeTurn, classifyTurnIntent, type TurnIntentDecision } from "./AgentTurnIntent";
import { stableHashText } from "@/services/security/text";
import { ensureConversationBranches, forkConversationBranch } from "./activeBranchContext";
import type { AgentQuickActionId, QuickActionIntent } from "@/agent/contracts/agentQuickAction";
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
import {
  buildConversationIntakeArtifact,
  buildConversationIntakeReviewProjectionFromDraft
} from "@/domain/profileIntake/ConversationIntakeAdapter";
import type { ImportedResumeDraft } from "@/domain/schemas";
import {
  resolveQuickActionPrerequisites,
  resolveQuickActionWorkflow,
  type QuickActionPrerequisiteResolution,
  type QuickActionWorkflowResolution
} from "@/agent/workflows/QuickActionWorkflowSupervisor";
import { resolveProfileIntakeInterviewSupervisor } from "@/agent/workflows/ProfileIntakeInterviewSupervisor";
import {
  ProfileIntakeFinalizationSupervisor,
  profileIntakePersistenceReceipt
} from "@/agent/workflows/ProfileIntakeFinalizationSupervisor";
import { AuthoritativeConversationAlignmentGuard } from "@/agent/kernel/AuthoritativeConversationAlignmentGuard";

export type AgentHostInput =
  | { type: "message"; text: string; references?: AgentMessageReference[] }
  | { type: "edit_message"; messageId: string; text: string }
  | { type: "regenerate_message"; messageId: string }
  | { type: "quick_action"; actionId: AgentQuickActionId; text: string; task: QuickActionIntent["task"] }
  | { type: "file"; file: File }
  | { type: "option"; action: AgentOption["action"] }
  | { type: "artifact_action"; action: AgentArtifactAction }
  | { type: "confirmation"; confirmed: boolean }
  | { type: "ui_control"; action: AgentUiAction | AgentWorkflowControl }
  | { type: "external_event"; observation: unknown; toolName?: string };

export type AgentHostSnapshot = {
  activeSessionId?: string;
  activeSession?: AgentSession;
  activeTask?: AgentTaskState;
  turnStatus: "idle" | "running" | "paused" | "waiting_for_confirmation" | "completed" | "failed";
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
    streamEvents: [],
    artifacts: [],
    stalled: false,
    pendingInputCount: 0
  };
  private readonly listeners = new Set<() => void>();
  private activeController?: AbortController;
  private activeExecution?: Promise<AgentSession | undefined>;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private runGeneration = 0;
  private readonly confirmationExecutions = new Map<string, Promise<AgentSession | undefined>>();
  private readonly artifactActionExecutions = new Map<string, Promise<AgentSession | undefined>>();
  private readonly pendingInputs = new Map<string, PendingUserInput[]>();

  constructor(private readonly dependencies: {
    kernel: AgentKernel;
    executor: AgentExecutor;
    persistence: AgentSessionStore;
    stallThresholdMs?: number;
  }) {
    agentImportProgressBus.subscribe((progress) => {
      if (this.snapshot.turnStatus !== "running") return;
      this.markProgress();
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

  adopt(session: AgentSession) {
    if (this.snapshot.turnStatus === "running") return;
    const migrated = migrateAgentSessionToCurrentSchema(session);
    const recoveredThinking = enforceExactlyOneFinal(recoverOrphanedThinking(migrated));
    const { session: recoverable, pendingInputs } = recoverPersistedQueuedInputs(recoveredThinking);
    if (pendingInputs.length) this.pendingInputs.set(recoverable.id, pendingInputs);
    const restorable = recoverable.taskState
      ? attachTaskStateOptions(recoverable, recoverable.taskState)
      : recoverable;
    const withRestorePrompt = appendIntakeRestorePrompt(restorable);
    if (JSON.stringify(withRestorePrompt) !== JSON.stringify(session)) void this.dependencies.persistence.save(withRestorePrompt);
    this.patch({
      activeSessionId: withRestorePrompt.id,
      activeSession: withRestorePrompt,
      activeTask: withRestorePrompt.taskState,
      pendingConfirmation: withRestorePrompt.pendingConfirmation,
      artifacts: withRestorePrompt.artifactRefs,
      turnStatus: withRestorePrompt.pendingConfirmation ? "waiting_for_confirmation" : "idle",
      stalled: false,
      pendingInputCount: pendingInputs.length
    });
    if (pendingInputs.length && !withRestorePrompt.pendingConfirmation) void this.drainPendingInput(withRestorePrompt.id);
  }

  setPaused(paused: boolean) {
    this.patch({ turnStatus: paused ? "paused" : "idle" });
  }

  setBusy(busy: boolean) {
    this.patch({ turnStatus: busy ? "running" : "idle" });
  }

  interrupt() {
    this.activeController?.abort();
  }

  continueWaiting() {
    this.markProgress();
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
      return this.resolveConfirmation(input.confirmed, context.pageContext);
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
         retryWorkflowStep: prepared.retryWorkflowStep,
         pageContext: context.pageContext,
        supersede: true
      });
    }
    if (input.type === "external_event") {
      const turnId = session.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
      return this.resume(session, {
        reason: "external_event",
        toolName: input.toolName,
        observation: input.observation
      }, context.pageContext, turnId);
    }
    if (input.type === "file") {
      const attachment = await agentAttachmentStore.register(input.file);
      return this.startTurn({
        session,
        userMessage: `导入简历文件：${input.file.name}`,
        pageContext: context.pageContext,
        attachment
      });
    }
    if (input.type === "option") {
      if (input.action.type === "task_decision") {
        return this.resolveTaskDecision(session, input.action, context.pageContext);
      }
      if (input.action.type === "answer") {
        if (input.action.field === "profile-intake-section") return session;
        const answerValue = input.action.value;
        if (input.action.field.startsWith("tailoring-question:")) {
          const questionId = input.action.field.slice("tailoring-question:".length);
          if (presentedActiveTailoringQuestion(session) !== questionId) return session;
          const tailoring = objectValue(session.taskState?.knownSlots.tailoringSession);
          const plan = objectValue(tailoring.plan);
          const question = (Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions.map(objectValue) : [])
            .find((item) => item.id === questionId);
          const valid = Array.isArray(question?.options)
            && question.options.map(objectValue).some((option) => option.value === answerValue);
          if (!valid) return session;
        }
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
        return this.retryCurrentWorkflowStep(session, context.pageContext);
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
      if (input.actionId === "build_profile_from_scratch") {
        return this.resolveProfileIntakeQuickAction(session, input);
      }
      const localQuickAction = resolveQuickActionWorkflow(input.actionId);
      if (localQuickAction) {
        return this.resolveQuickActionLocally(session, input, localQuickAction);
      }
      const localPrerequisites = await this.resolveQuickActionPrerequisites(input);
      if (localPrerequisites) {
        return this.resolveQuickActionLocally(session, input, localPrerequisites);
      }
      return this.startTurn({
        session,
        userMessage: input.text,
        pageContext: context.pageContext,
        typedTask: input.task,
        supersede: true
      });
    }
    if (session.pendingConfirmation && /^(?:确认|确定|同意|继续|确认并继续)[。！!]?$/u.test(input.text.trim())) {
      return this.resolveConfirmation(true, context.pageContext);
    }
    if (session.pendingConfirmation && /^(?:取消|不同意|拒绝|不确认)[。！!]?$/u.test(input.text.trim())) {
      return this.resolveConfirmation(false, context.pageContext);
    }
    const routed = routeAgentIntent(input.text, {
      activeWorkflowId: session.taskState?.workflowId ?? session.workflowState.workflowId
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

  private async resolveQuickActionLocally(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>,
    resolution: (QuickActionWorkflowResolution | QuickActionPrerequisiteResolution) & object
  ) {
    const now = new Date().toISOString();
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.create(session);
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
        jobReads: resolution.jobReads
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

  /**
   * Profile Intake starts from a local, typed target binding. The model is not
   * involved in choosing a Profile and therefore cannot move this action into
   * a shadow interview branch.
   */
  private async resolveProfileIntakeQuickAction(
    session: AgentSession,
    input: Extract<AgentHostInput, { type: "quick_action" }>
  ) {
    const now = new Date().toISOString();
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.create(session);
    taskState = reducer.reduce(taskState, {
      type: "new_root_task",
      goal: input.task.rootGoal,
      workflowId: "guided_profile_intake",
      stage: "resolve_profile_target"
    });
    let activeResult: Awaited<ReturnType<AgentExecutor["execute"]>> | undefined;
    try {
      activeResult = await this.dependencies.executor.execute({
        toolName: "get_active_profile",
        toolInput: {},
        operationId: `quick-profile-target-${session.id}-${stableHashText(input.actionId)}`.slice(0, 160)
      });
    } catch {
      activeResult = undefined;
    }
    const active = activeResult?.ok ? objectValue(activeResult.data) : {};
    const soleProfile = Array.isArray(active.availableProfiles) && active.availableProfiles.length === 1
      ? objectValue(active.availableProfiles[0])
      : undefined;
    const profileId = stringValue(active.profileId) ?? stringValue(soleProfile?.id);
    const profileVersion = numberValue(active.version) ?? numberValue(soleProfile?.version);
    const selected = Boolean(profileId && profileVersion !== undefined && (active.selected === true || soleProfile));
    if (selected) {
      taskState = reducer.reduce(taskState, {
        type: "tool_observation",
        toolName: "get_active_profile",
        observation: activeResult!.data,
        artifactIds: activeResult!.artifactIds
      });
      taskState = {
        ...taskState,
        workflowId: "guided_profile_intake",
        stage: "collect_experience",
        completionStatus: "waiting_for_user",
        knownSlots: {
          ...taskState.knownSlots,
          targetProfileId: profileId,
          targetProfileName: stringValue(active.name),
          expectedProfileVersion: profileVersion,
          acknowledgedActiveProfileId: profileId,
          profileIntakeQuickActionResolved: true,
          intakeFirstQuestionId: "education-background"
        },
        selectedEntities: {
          ...taskState.selectedEntities,
          profileId,
          profileVersion
        },
        updatedAt: now
      };
    }
    if (!selected) taskState = { ...taskState, completionStatus: "waiting_for_user", updatedAt: now };
    let current = projectTaskStateIntoSession(session, taskState);
    if (selected) current = { ...current, activeProfileId: profileId };
    current = appendAgentMessage(current, "user", input.text.trim(), {
      id: `agent-user-${crypto.randomUUID()}`,
      status: "complete",
      metadata: { executionState: "complete", quickActionSupervisor: true, modelCalls: 0 }
    });
    const assistantText = selected
      ? "好的，我们从教育背景开始。请告诉我学校、专业、学历，以及大致的入学和毕业时间；只写你确认过的内容即可。"
      : "开始整理经历前，需要先选择或创建一个个人资料库。请选择资料库后，我会立即进入第一步访谈。";
    current = appendAgentMessage(current, "assistant", assistantText, {
      kind: "text",
      type: "text",
      status: "complete",
      options: selected ? undefined : [{
        id: "profile-intake-select-or-create-profile",
        label: "选择或创建个人资料库",
        action: { type: "open_profile_browser" }
      }],
      metadata: {
        quickActionSupervisor: true,
        deterministicBoundary: "profile_intake_target",
        modelCalls: 0,
        profileReads: 1,
        authoritativeStage: taskState.stage
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
        targetProfileId: selected ? profileId : undefined
      }
    });
    return saved;
  }

  private async retryCurrentWorkflowStep(session: AgentSession, pageContext: AgentPageContext) {
    const journal = await this.dependencies.persistence.listProfileIntakeSourceTurns?.(session.id) ?? [];
    const recoverableJournal = journal
      .filter((turn) => turn.processingStatus !== "superseded")
      .findLast((turn) => ["failed", "partial", "structuring", "journaled"].includes(turn.processingStatus));
    const sourceMessage = recoverableJournal
      ? session.messages.find((message) => message.id === recoverableJournal.messageId)
      : [...session.messages].reverse().find((message) => message.role === "user" && message.content.trim());
    if (!sourceMessage) return session;
    const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === sourceMessage.id);
    const restored = checkpoint
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
      : session;
    if (recoverableJournal) {
      await this.dependencies.persistence.updateProfileIntakeSourceTurn?.(
        { sessionId: recoverableJournal.sessionId, messageId: recoverableJournal.messageId, turnId: recoverableJournal.turnId },
        { processingStatus: "superseded" }
      );
    }
    return this.startTurn({
      session: restored,
      userMessage: recoverableJournal?.exactSourceText ?? sourceMessage.content,
      pageContext,
      supersede: true,
      retryWorkflowStep: true
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
    return undefined;
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
        activeQuestionId: stringValue(source.intakeQuestionId) ?? stringValue(input.taskState.knownSlots.activeQuestionId),
        processingStatus: "journaled",
        candidateIds: []
      });
      await persistence.saveProfileIntakeSourceTurn?.(journal);
    }
    await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
      processingStatus: "structuring",
      lastErrorCode: undefined
    });
    const operationId = `profile-intake-capture-${input.current.id}-${sourceTurnId}`.replace(/[^\w-]/g, "-").slice(0, 160);
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
        processingStatus: "failed",
        lastErrorCode: code
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
        processingStatus: "failed",
        lastErrorCode: code
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
    await persistence.updateProfileIntakeSourceTurn?.(sourceIdentity, {
      processingStatus,
      importId: stringValue(objectValue(result.data).importId),
      candidateIds,
      lastErrorCode: undefined
    });
    let current = projectTaskStateIntoSession(input.current, nextState);
    current = reconcileTaskArtifacts(current, nextState);
    current = upsertAgentActivity(current, {
      id: `agent-tool-${operationId}`,
      turnId: input.turnId,
      content: "已保留原始回答并生成经历核对卡片。",
      toolName: "capture_profile_intake",
      operationId,
      status: "complete",
      metadata: { activityState: "complete", directBoundary: true, artifactIds: result.artifactIds }
    });
    const answer = projection.success && projection.data.extractionStatus === "failed"
      ? "原始回答已保留，但本次没有完成可靠结构化。你可以补充名称、角色、主要工作和结果，或重新执行当前步骤。"
      : nextState.stage === "collect_experience" && projection.success && projection.data.followUpQuestion
        ? `我已先把这段回答记录并生成核对卡片。${projection.data.followUpQuestion}`
        : "我已把这段回答记录并生成经历核对卡片，请先核对卡片中的事实。";
    current = replaceAgentThinking(current, input.thinkingMessageId, answer, input.turnId);
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
        id: input.turnId,
        sessionId: current.id,
        userMessageId: input.userMessageId,
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

    for (const candidateId of initialDecision.autoAcceptCandidateIds) {
      const operationId = `${operationPrefix}-review-${candidateId}-${expectedDraftRevision}`;
      const result = await execute("review_profile_intake", {
        importId,
        expectedDraftRevision,
        candidateId,
        decision: "accept"
      }, operationId);
      if (!result?.ok) continue;
      state = reducer.reduce(state, {
        type: "tool_observation",
        toolName: result.toolName,
        observation: result.data,
        artifactIds: result.artifactIds
      });
      expectedDraftRevision = numberValue(objectValue(result.data).expectedDraftRevision) ?? expectedDraftRevision + 1;
      state.knownSlots.expectedIntakeDraftRevision = expectedDraftRevision;
      current = upsertAgentActivity(current, {
        id: `agent-tool-${operationId}`,
        turnId: input.turnId,
        content: "已自动采用来源明确且无冲突的经历候选。",
        toolName: result.toolName,
        operationId,
        status: "complete",
        metadata: { activityState: "complete", directBoundary: true, automaticSafeAcceptance: true }
      });
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
          verifiedAt: new Date().toISOString()
        }
      },
      completionStatus: "waiting_for_user",
      stage: "profile_complete",
      updatedAt: new Date().toISOString()
    };
    const receiptText = `已保存到个人资料库。资料库版本：${committedVersion}；本次新增 ${numberValue(commitValue.committedItemCount) ?? 0} 项经历、${numberValue(commitValue.committedFactCount) ?? 0} 条事实，读取核验通过。接下来你可以继续补充经历、生成通用简历，或暂时完成。`;
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

  async startTurn(input: {
    session: AgentSession;
    userMessage: string;
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
    retryWorkflowStep?: boolean;
  }) {
    if (input.session.pendingConfirmation && input.session.pendingToolCall) {
      input.session = invalidatePendingConfirmationForCorrection(input.session);
    }
    if (this.activeController) {
      if (!input.supersede) {
        return this.enqueueUserInput(input);
      }
      const previousGeneration = this.runGeneration;
      input.session = this.clearQueuedInputs(input.session);
      input.session = await this.dependencies.persistence.save(input.session);
      this.patchSession(input.session);
      this.activeController.abort();
      await this.activeExecution;
      const interrupted = completeTurn(this.snapshot.activeSession ?? input.session, "aborted");
      input.session = appendAgentMessage(interrupted, "system", "上一轮已中断；已完成的步骤会保留，并按你的新意图重新规划。", {
        kind: "system_notice",
        type: "system_notice",
        status: "complete"
      });
      this.runGeneration = previousGeneration + 1;
    } else {
      this.runGeneration += 1;
    }
    const generation = this.runGeneration;
    const controller = new AbortController();
    this.activeController = controller;
    const now = new Date().toISOString();
    const turnId = `agent-turn-${crypto.randomUUID()}`;
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
      : classifiedTurn;
    const checkpointedSession = !input.regenerateNarrationOnly
      && (turnDecision.toolScope === "domain" || turnDecision.taskMutation !== "preserve")
      ? withTurnCheckpoint(input.session, turnId, userMessageId, now)
      : input.session;
    let current = input.appendUserMessage === false
      ? {
          ...checkpointedSession,
          messages: input.updateExistingUserMessage === false
            ? checkpointedSession.messages
            : checkpointedSession.messages.map((message) =>
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
      : appendAgentMessage(checkpointedSession, "user", input.userMessage.trim(), {
          id: userMessageId,
          turnId,
          status: "complete",
          references: input.references?.length ? input.references : undefined,
          metadata: { executionState: "running" }
        });
    if (shouldAutoNameAgentSession(current)) {
      const firstUserMessage = current.messages.find((message) => message.role === "user" && message.content.trim());
      if (firstUserMessage) {
        current = {
          ...current,
          title: deriveAgentSessionTitle(firstUserMessage.content)
        };
      }
    }
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
    const reducer = new AgentTaskStateReducer();
    let kernelUserMessage = input.userMessage;
    const presentedQuestion = presentedActiveTailoringQuestion(input.session);
    let deterministicTailoringAnswer = false;
    let taskState = current.taskState ?? reducer.create(current);
    const shouldReduceProfileIntakeControl = input.session.taskState?.workflowId === "guided_profile_intake"
      && turnDecision.profileIntakeTurnKind === "interview_control";
    if ((turnDecision.taskMutation !== "preserve" || shouldReduceProfileIntakeControl) && !input.regenerateNarrationOnly) {
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
    if (input.attachment) {
      taskState = reducer.reduce(taskState, {
        type: "attachment_selected",
        attachment: input.attachment
      });
    }
    const compound = presentedQuestion && !/^(?:继续|生成吧|按这些生成)$/u.test(input.userMessage.trim())
      ? resolveCompoundAnswer(input.userMessage, unresolvedTailoringQuestions(taskState))
      : { answers: [] };
    if (compound.answers.length) {
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
    if (deterministicTailoringAnswer && !compound.unmatchedText) {
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
          id: turnId,
          sessionId: current.id,
          userMessageId,
          status: taskState.completionStatus === "waiting_for_user" ? "waiting_for_user" : "completed",
          startedAt: now,
          completedAt: new Date().toISOString()
        }
      };
      current = completeTurnCheckpoint(current, turnId, new Date().toISOString());
      current = await this.dependencies.persistence.save(current);
      this.activeController = undefined;
      this.patchSession(current, { turnStatus: "completed", activeTurnId: turnId });
      return current;
    }
    if (
      !input.regenerateNarrationOnly
      && taskState.workflowId === "guided_profile_intake"
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
        this.activeController = undefined;
        this.patchSession(boundary, {
          turnStatus: boundary.taskState?.completionStatus === "failed" ? "failed" : "completed",
          activeTurnId: turnId,
          currentObservation: boundary.taskState?.lastObservation
        });
        return boundary;
      }
    }
    current = {
      ...projectTaskStateIntoSession(current, taskState),
      activeTurn: {
        id: turnId,
        sessionId: current.id,
        userMessageId,
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
    this.activeExecution = execution;
    return execution.finally(() => {
      if (this.activeExecution === execution) this.activeExecution = undefined;
    });
  }

  async resolveConfirmation(confirmed: boolean, pageContext: AgentPageContext) {
    const operationId = this.snapshot.activeSession?.pendingConfirmation?.operationId;
    if (!operationId) return this.snapshot.activeSession;
    const running = this.confirmationExecutions.get(operationId);
    if (running) return running;
    const execution = this.resolveConfirmationOnce(confirmed, pageContext)
      .finally(() => this.confirmationExecutions.delete(operationId));
    this.confirmationExecutions.set(operationId, execution);
    return execution;
  }

  private async resolveConfirmationOnce(confirmed: boolean, pageContext: AgentPageContext) {
    const session = this.snapshot.activeSession;
    const confirmation = session?.pendingConfirmation;
    const call = session?.pendingToolCall;
    if (!session || !confirmation || !call) return session;
    this.markProgress();
    const turnId = call.turnId ?? confirmation.turnId ?? session.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
    let current: AgentSession = {
      ...markConfirmationResolution(session, confirmed ? "confirmed" : "rejected"),
      pendingConfirmation: undefined,
      pendingToolCall: undefined
    };
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
    const result = await this.dependencies.executor.execute({
      toolName: call.toolName,
      toolInput: confirmation.validatedInput ?? call.input,
      operationId: call.operationId,
      confirmed: true
    });
    if (result.ok && typeof this.dependencies.kernel.invalidateObservationsAfter === "function") {
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
    if (result.ok) current = attachConfirmedToolArtifact(current, call.toolName, call.operationId, result);
    if (!result.ok && current.taskState) {
      current = projectTaskStateIntoSession(current, {
        ...current.taskState,
        completionStatus: "failed",
        updatedAt: new Date().toISOString()
      });
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
    if (
      session.taskState?.pendingDecision?.type !== action.decisionType
      || !session.taskState.pendingDecision.options.includes(action.option)
    ) {
      return session;
    }
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const decisionLabels: Record<typeof action.option, string> = {
      profile: "使用个人资料库生成岗位简历",
      existing_resume: "使用现有简历（路线 B）",
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
    let current = markTypedTaskDecisionResolution(session, {
      turnId,
      decisionType: action.decisionType,
      decisionOption: action.option,
      label: decisionLabels[action.option]
    });
    current = projectTaskStateIntoSession(current, taskState);
    current = await this.dependencies.persistence.save(current);
    return this.resume(current, {
      reason: "external_event",
      observation: {
        type: "task_decision",
        decisionType: action.decisionType,
        option: action.option
      }
    }, pageContext, turnId);
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
    const execution = (
      action.type === "profile_intake_retry_extraction"
        ? this.resolveProfileIntakeExtractionRetry(session, action, pageContext, revision)
        : action.type === "profile_intake_extraction_recovery"
        ? this.resolveProfileIntakeExtractionRecovery(session, action, pageContext, revision)
        : this.resolveArtifactActionOnce(session, action, pageContext, revision)
    ).finally(() => this.artifactActionExecutions.delete(executionKey));
    this.artifactActionExecutions.set(executionKey, execution);
    return execution;
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
    this.activeController?.abort();
    await this.activeExecution;
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
        retryable: true
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
    this.activeController?.abort();
    await this.activeExecution;
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const operationId = artifactActionOperationId(session, action, revision);
    const runningSession = withArtifactActionFeedback(session, action, {
      result: "handled",
      message: "正在保存这项核对…",
      running: true,
      retryable: false
    });
    this.patchSession(runningSession);
    const result = await this.dependencies.executor.execute({
      toolName: execution.toolName,
      toolInput: execution.toolInput,
      operationId
    });
    if (!result.ok) {
      const failed = withArtifactActionFeedback(session, action, {
        result: "rejected",
        message: result.error?.message ?? "这项核对没有保存成功，请重试。",
        retryable: true
      });
      const saved = await this.dependencies.persistence.save(failed);
      this.patchSession(saved);
      return saved;
    }
    const reducer = new AgentTaskStateReducer();
    let taskState = reducer.reduce(session.taskState!, {
      type: "tool_observation",
      toolName: result.toolName,
      observation: result.data,
      artifactIds: result.artifactIds
    });
    let current = projectTaskStateIntoSession(session, taskState);
    current = attachTaskStateOptions(current, taskState);
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
    if (action.type === "tailoring_diff_decision" && observation.remainingDiffCount === 0) {
      const confirmationTurnId = session.activeTurn?.id ?? turnId;
      const previewOperationId = `${operationId}-preview`.slice(0, 160);
      const preview = await this.dependencies.executor.execute({
        toolName: "preview_tailoring_changes",
        toolInput: {
          session: observation.session,
          selectedDiffs: observation.selectedDiffs ?? [],
          confirmedRequirementIds: taskState.knownSlots.confirmedRequirementIds ?? []
        },
        operationId: previewOperationId
      });
      if (preview.ok) {
        taskState = reducer.reduce(taskState, {
          type: "tool_observation",
          toolName: preview.toolName,
          observation: preview.data,
          artifactIds: preview.artifactIds
        });
        const applyOperationId = `${operationId}-apply`.slice(0, 160);
        const applyInput = {
          session: observation.session,
          selectedDiffs: observation.selectedDiffs ?? [],
          confirmedRequirementIds: taskState.knownSlots.confirmedRequirementIds ?? []
        };
        taskState = reducer.reduce(taskState, {
          type: "confirmation_requested",
          toolName: "apply_tailoring_changes",
          operationId: applyOperationId
        });
        current = projectTaskStateIntoSession(current, taskState);
        const requestedAt = new Date().toISOString();
        current = {
          ...current,
          pendingConfirmation: {
            id: `confirmation-${applyOperationId}`,
            turnId: confirmationTurnId,
            operationId: applyOperationId,
            toolName: "apply_tailoring_changes",
            title: "应用这些简历修改？",
            description: "确认后会创建岗位专属简历版本；来源简历和个人资料库不会被覆盖。",
            destructive: false,
            validatedInput: applyInput,
            dependencyExpectation: dependencySnapshot(taskState),
            status: "pending",
            requestedAt
          },
          pendingToolCall: {
            turnId: confirmationTurnId,
            toolName: "apply_tailoring_changes",
            operationId: applyOperationId,
            input: applyInput
          },
          activeTurn: current.activeTurn
            ? {
                ...current.activeTurn,
                status: "waiting_for_confirmation",
                completedAt: undefined
              }
            : current.activeTurn
        };
      }
    }
    current = withArtifactActionFeedback(current, action, {
      result: "handled",
      message: artifactActionCompletedLabel(action).replace(/[。.]$/u, ""),
      retryable: false
    });
    if (
      action.type === "profile_intake_reconciliation_decision"
      && taskState.workflowId === "guided_profile_intake"
      && taskState.stage === "confirm_commit"
      && taskState.knownSlots.profileIntakeExplicitCommit === true
    ) {
      const finalizeTurnId = session.activeTurn?.id ?? turnId;
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
        userMessageId: session.activeTurn?.userMessageId ?? `agent-user-${operationId}`,
        thinkingMessageId: finalizeThinkingId,
        now: new Date().toISOString(),
        controller: new AbortController()
      }, decision);
      this.patchSession(finalized, { turnStatus: finalized?.taskState?.completionStatus === "failed" ? "failed" : "completed" });
      return finalized;
    }
    if (shouldNarrateProfileIntakeContinuation(session.taskState, action, taskState)) {
      current = appendAgentMessage(current, "assistant", profileIntakeContinuationNarration(taskState), {
        id: `agent-profile-intake-continuation-${operationId}`,
        turnId,
        kind: "text",
        type: "text",
        status: "complete",
        language: "zh",
        metadata: { profileIntakeContinuation: true }
      });
    }
    // Artifact decisions can create a typed task decision without another
    // model turn (for example, accepting the last intake candidate). Keep
    // that decision visible immediately instead of leaving the user with an
    // apparently inert chat after the artifact is closed.
    if (taskState.pendingDecision) {
      current = attachPendingDecisionOptions(current, taskState.pendingDecision);
    }
    current = attachTaskStateOptions(current, taskState);
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
    if (!session.taskState) return session;
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
      return saved;
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
    const label = action.entityType === "job"
      ? `${String(candidate.title ?? "岗位")}${candidate.company ? ` · ${String(candidate.company)}` : ""}`
      : String(candidate.name ?? "简历");
    let current = appendAgentMessage(session, "user", label, {
      turnId,
      status: "complete",
      metadata: { executionState: "complete", selectedEntityType: action.entityType, selectedEntityId: action.entityId }
    });
    current = projectTaskStateIntoSession(current, taskState);
    current = await this.dependencies.persistence.save(current);
    this.patchSession(current);
    return this.resume(current, {
      reason: "external_event",
      observation: { type: "entity_selected", entityType: action.entityType, entityId: action.entityId }
    }, pageContext, turnId);
  }

  private async resume(
    session: AgentSession,
    internal: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    },
    pageContext: AgentPageContext,
    turnId: string
  ) {
    this.activeController?.abort();
    await this.activeExecution;
    const controller = new AbortController();
    this.activeController = controller;
    const generation = ++this.runGeneration;
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
        id: turnId,
        sessionId: current.id,
        userMessageId: current.activeTurn?.userMessageId,
        status: "running",
        startedAt: current.activeTurn?.startedAt ?? new Date().toISOString()
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
    this.activeExecution = execution;
    return execution.finally(() => {
      if (this.activeExecution === execution) this.activeExecution = undefined;
    });
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
      if (input.generation !== this.runGeneration) return;
      if ("turnId" in event && event.turnId && event.turnId !== input.turnId) return;
      if (isProgressEvent(event)) this.markProgress();
      this.patch({ streamEvents: [...this.snapshot.streamEvents, event].slice(-200) });
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
        if (event.ok && ["analyze_job_fit", "create_tailoring_session", "answer_tailoring_question", "generate_tailoring_changes", "review_tailoring_diff", "preview_tailoring_changes", "apply_tailoring_changes", "create_resume_from_profile", "export_resume"].includes(event.toolName)) {
          const now = new Date().toISOString();
            const descriptor = artifactDescriptor(
              event.toolName,
              current.taskState?.workflowId ?? current.workflowState.workflowId,
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
              : stringRecordValue(observation.resumeId)
                ?? stringRecordValue(observation.branchId)
                ?? stringRecordValue(observationResume.id)
                ?? current.taskState?.selectedEntities.resumeId
                ?? current.taskState?.selectedEntities.jobId
                ?? `pending-${event.operationId}`;
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
        this.patch({ currentObservation: { toolName: event.toolName, summary: event.summary } });
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
          workflowState: { ...current.workflowState, status: "waiting_for_confirmation" }
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
      const result = input.resume
        ? await this.dependencies.kernel.resumeTurn({
            session: current,
            pageContext: input.pageContext,
            reason: input.resume.reason,
            observation: input.resume.observation,
            toolName: input.resume.toolName,
            signal: input.controller.signal,
            emit: onEvent,
            profileIntakeSourceTurns: await this.dependencies.persistence.listProfileIntakeSourceTurns?.(current.id)
          })
        : await this.dependencies.kernel.runTurn({
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
      if (input.generation !== this.runGeneration) return this.snapshot.activeSession;
      if (result.protocolDiagnostics?.length) {
        await this.persistProtocolDiagnostics(current, input.turnId, result.protocolDiagnostics);
      }
      const isolatedConversationalTurn = input.turnDecision?.intent === "casual_side_turn"
        || input.turnDecision?.intent === "reference_followup";
      const outcome = isolatedConversationalTurn
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
      current = {
        ...current,
        trajectory: result.trajectory,
        reflection: result.reflection,
        conversationSummary: result.conversationSummary ?? current.conversationSummary,
        conversationSummaryBranchId: current.activeBranchId,
        taskState: result.taskState ?? current.taskState,
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
        workflowState: result.taskState
          ? projectTaskStateToWorkflowState(result.taskState, current.workflowState)
          : current.workflowState
      };
      const importedId = result.taskState?.rootGoal === "import_resume"
        ? stringValue(result.taskState.knownSlots.importId)
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
      if (result.taskState) current = reconcileTaskArtifacts(current, result.taskState);
      if (result.taskState?.pendingDecision) {
        current = attachPendingDecisionOptions(current, result.taskState.pendingDecision);
      }
      if (result.taskState) current = attachTaskStateOptions(current, result.taskState);
      if (result.text?.includes("重新执行当前步骤")) {
        current = withRetryCurrentStepOption(current, input.thinkingMessageId);
      }
      current = settleThinkingMessages(current, input.turnId);
      current = settleUserExecutionState(current, input.turnId, outcome === "failed" ? "failed" : outcome === "aborted" ? "aborted" : "complete");
      current = completeTurnCheckpoint(current, input.turnId, new Date().toISOString());
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, {
        turnStatus: outcome === "waiting_for_confirmation" ? "waiting_for_confirmation" : outcome === "failed" ? "failed" : "completed",
        pendingConfirmation: current.pendingConfirmation
      });
      return current;
    } catch (error) {
      if (input.controller.signal.aborted) return this.snapshot.activeSession;
      current = completeTurn(current, "failed");
      current = settleUserExecutionState(current, input.turnId, "failed");
      current = appendAgentMessage(current, "assistant", "AI 任务暂时中断，当前进度和输入已保留。", {
        turnId: input.turnId,
        kind: "error_status",
        type: "error",
        status: "failed",
        errorCode: errorCode(error),
        options: [{ id: "retry-current-step", label: "重新执行当前步骤", action: { type: "retry_current_step" } }]
      });
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, { turnStatus: "failed" });
      return current;
    } finally {
      if (input.generation === this.runGeneration) {
        this.activeController = undefined;
        this.clearStallTimer();
        const settled = settleThinkingMessages(this.snapshot.activeSession ?? current, input.turnId);
        if (settled !== (this.snapshot.activeSession ?? current)) {
          void this.dependencies.persistence.save(settled);
          this.patchSession(settled, { stalled: false });
        } else {
          this.patch({ stalled: false });
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
          workflowId: session.taskState?.workflowId ?? session.workflowState.workflowId,
          stage: session.taskState?.stage ?? session.workflowState.step,
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
    if (this.activeController) return;
    const queue = this.pendingInputs.get(sessionId);
    const next = queue?.shift();
    if (!next) {
      this.pendingInputs.delete(sessionId);
      this.patch({ pendingInputCount: 0 });
      return;
    }
    if (!queue?.length) this.pendingInputs.delete(sessionId);
    const session = this.snapshot.activeSession;
    if (!session || session.id !== sessionId) return;
    this.patch({ pendingInputCount: queue?.length ?? 0 });
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
    this.patch({ pendingInputCount: 0 });
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
    this.patch({
      activeSessionId: session.id,
      activeSession: session,
      activeTask: session.taskState,
      pendingConfirmation: session.pendingConfirmation,
      artifacts: session.artifactRefs,
      ...patch
    });
  }

  private async applyWorkflowControl(session: AgentSession, action: AgentWorkflowControl) {
    if (action.type === "cancel_workflow") {
      this.interrupt();
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
      this.interrupt();
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
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private markProgress() {
    const now = new Date().toISOString();
    this.patch({ lastProgressAt: now, stalled: false });
    this.clearStallTimer();
    if (!this.activeController) return;
    this.scheduleStallCheck();
  }

  private scheduleStallCheck() {
    const thresholdMs = this.dependencies.stallThresholdMs ?? 30_000;
    const lastProgressAt = this.snapshot.lastProgressAt;
    const elapsedMs = lastProgressAt
      ? Math.max(0, Date.now() - Date.parse(lastProgressAt))
      : thresholdMs;
    const remainingMs = Math.max(0, thresholdMs - elapsedMs);
    this.stallTimer = setTimeout(() => {
      if (!this.activeController || this.snapshot.turnStatus !== "running") return;
      const latestProgressAt = this.snapshot.lastProgressAt;
      const latestElapsedMs = latestProgressAt
        ? Math.max(0, Date.now() - Date.parse(latestProgressAt))
        : thresholdMs;
      if (latestElapsedMs >= thresholdMs) {
        this.patch({ stalled: true });
      } else {
        this.clearStallTimer();
        this.scheduleStallCheck();
      }
    }, remainingMs);
  }

  private clearStallTimer() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = undefined;
  }
}

function isUiAction(action: AgentUiAction | AgentWorkflowControl): action is AgentUiAction {
  return [
    "open_resume_picker",
    "open_resume_upload",
    "open_job_import_dialog",
    "open_profile_browser",
    "open_tool_palette",
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
  const options: AgentOption[] = decision.options.map((option) => ({
    id: `decision-${decision.type}-${option}`,
    label: {
      profile: "使用个人资料库",
      existing_resume: "使用现有简历",
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
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant" && message.kind !== "assistant_thinking"
  );
  if (assistantIndex < 0) return session;
  return {
    ...session,
    messages: session.messages.map((message, index) =>
      index === assistantIndex ? { ...message, options } : message
    )
  };
}

export function attachTaskStateOptions(session: AgentSession, state: AgentTaskState) {
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant"
      && message.kind !== "assistant_thinking"
      && message.status === "complete"
      && message.metadata?.retracted !== true
  );
  if (assistantIndex < 0) return session;
  let options: AgentOption[] | undefined;
  let optionSet: AgentOptionSet | undefined;
  let metadata: Record<string, unknown> | undefined;
  if (state.stage === "choose_job") {
    options = entityOptions(state, "job");
  } else if (state.stage === "choose_resume_source" && state.knownSlots.resumeSelectionRequired) {
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
  if (!options?.length && !metadata && !shouldClearResolvedProfileOptions) return session;
  return {
    ...session,
    messages: session.messages.map((message, index) => {
      if (index === assistantIndex) {
        return {
          ...message,
          options: options?.length ? options : message.options,
          optionSet: optionSet ?? message.optionSet,
          metadata: { ...message.metadata, ...metadata }
        };
      }
      if (message.role !== "assistant" || !isProfileSectionOptionSet(message)) return message;
      return {
        ...message,
        options: undefined,
        optionSet: message.optionSet?.state === "resolved"
          ? message.optionSet
          : message.optionSet
            ? { ...message.optionSet, state: "superseded" as const }
            : undefined
      };
    })
  };
}

function appendIntakeRestorePrompt(session: AgentSession) {
  const state = session.taskState;
  if (!state || state.workflowId !== "guided_profile_intake" || state.completionStatus === "completed") return session;
  const intakeSession = objectValue(state.knownSlots.intakeSession);
  const resumeToken = stringValue(intakeSession.resumeToken);
  if (!resumeToken || session.messages.some((message) => message.metadata?.intakeRestoreToken === resumeToken)) return session;
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

function presentedActiveTailoringQuestion(session: AgentSession) {
  const state = session.taskState;
  if (!state || state.stage !== "clarify_unsupported_facts") return undefined;
  const tailoring = objectValue(state.knownSlots.tailoringSession);
  const plan = objectValue(tailoring.plan);
  const questionPlan = objectValue(plan.questionPlan);
  const activeQuestionId = stringValue(questionPlan.activeQuestionId);
  if (!activeQuestionId) return undefined;
  const assistant = session.messages.findLast((message) =>
    message.role === "assistant" && message.metadata?.retracted !== true && message.status === "complete"
  );
  return assistant?.metadata?.tailoringQuestionId === activeQuestionId
    && assistant.metadata.questionPlanId === questionPlan.id
    && assistant.metadata.questionPlanRevision === questionPlan.revision
      ? activeQuestionId
      : undefined;
}

function formatCurrentTailoringQuestion(state: AgentTaskState) {
  const tailoring = objectValue(state.knownSlots.tailoringSession);
  const plan = objectValue(tailoring.plan);
  const questionPlan = objectValue(plan.questionPlan);
  const questionId = stringValue(questionPlan.activeQuestionId);
  const questionIds = Array.isArray(questionPlan.questionIds) ? questionPlan.questionIds : [];
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions.map(objectValue) : [];
  const question = questions.find((item) => item.id === questionId);
  const position = Math.max(0, questionIds.indexOf(questionId)) + 1;
  const options = Array.isArray(question?.options)
    ? question.options.map(objectValue).flatMap((option, index) => typeof option.label === "string" ? [`${index + 1}. ${option.label}`] : [])
    : [];
  return [
    "已记录。",
    `问题 ${position}/${questionIds.length}：`,
    String(question?.question ?? "请补充当前问题。"),
    options.length ? options.join("\n") : "",
    "你可以直接补充说明，或回复“跳过”。"
  ].filter(Boolean).join("\n\n");
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
  const taskState = session.taskState ?? new AgentTaskStateReducer().create(session);
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
      if (index > targetIndex) {
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
  if (isFailedWorkflowAnswer(target, session, checkpoint)) {
    const restored = {
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
      regeneratedFromMessageId: target.id
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
      regeneratedFromMessageId: target.id
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
        index > userIndex && index !== targetIndex
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
    regeneratedFromMessageId: undefined
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

function isProfileSectionOptionSet(message: AgentSession["messages"][number]) {
  return message.options?.some((option) => option.action.type === "profile_intake_section_select")
    || message.metadata?.profileIntakeSectionOptions === true
    || message.optionSet?.optionSetId.startsWith("profile-intake-sections-");
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
    activeQuestion: typeof activeQuestion.question === "string"
      ? { question: activeQuestion.question }
      : projection.success && projection.data.followUpQuestion
        ? { question: projection.data.followUpQuestion }
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
    ? completed.sectionType === "education" ? "教育背景已经记录并自动保存。" : `${profileIntakeNarrativeSectionLabel(completed.sectionType)}已经记录并自动保存。`
    : "这项经历已经记录并自动保存。";
  if (next.type === "ask_follow_up") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "ask_next_section") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "offer_finish") return `${completedPrefix}\n\n${next.question}`;
  if (next.type === "commit") return `${completedPrefix}\n\n本次整理已准备完成。`;
  return "先核对上面的经历卡片；确认或忽略后，我再继续整理下一段。";
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
  if (!state || !["create_tailored_resume", "apply_to_job", "analyze_job_fit"].includes(state.rootGoal)) return false;
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
  if (toolName === "analyze_job_fit" && (workflowId === "analyze_job_fit" || rootGoal === "analyze_job_fit")) {
    return { kind: "job_fit_overview", title: "岗位匹配分析", entityType: "job" };
  }
  if (["analyze_job_fit", "create_tailoring_session", "answer_tailoring_question", "generate_tailoring_changes", "review_tailoring_diff", "preview_tailoring_changes", "apply_tailoring_changes"].includes(toolName)) {
    return { kind: "tailoring_workspace", title: "岗位定制工作区", entityType: "tailoring_session" };
  }

  if (toolName === "create_resume_from_profile") {
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
    session.taskState?.workflowId ?? session.workflowState.workflowId,
    session.taskState?.rootGoal
  );
  if (!result.ok || !descriptor) return session;
  const value = objectRecordValue(result.data);
  const observationResume = objectRecordValue(value.resume);
  const entityId = descriptor.kind === "tailoring_workspace"
    ? stringRecordValue(objectRecordValue(value.session).id)
      ?? stringRecordValue(objectRecordValue(session.taskState?.knownSlots.tailoringSession).id)
      ?? `pending:${session.taskState?.selectedEntities.jobId ?? toolName}`
    : descriptor.entityType === "job"
    ? stringRecordValue(value.jobId)
      ?? session.taskState?.selectedEntities.jobId
      ?? stringRecordValue(value.resumeId)
      ?? `pending-${toolName}`
    : stringRecordValue(value.resumeId)
      ?? stringRecordValue(value.branchId)
      ?? stringRecordValue(observationResume.id)
      ?? session.taskState?.selectedEntities.resumeId
      ?? session.taskState?.selectedEntities.jobId
      ?? `pending-${toolName}`;
  const now = new Date().toISOString();
  const artifactId = descriptor.kind === "tailoring_workspace"
    ? `tailoring-workspace:${entityId}`
    : result.artifactIds?.[0] ?? `agent-artifact-${toolName}-${operationId}`;
  const route = toolName === "export_resume" && typeof value.route === "string"
    ? value.route
    : descriptor.route;
  return {
    ...session,
    artifactRefs: [
      ...session.artifactRefs.filter((artifact) => descriptor.kind === "tailoring_workspace"
        ? !["tailoring_workspace", "job_fit_overview", "tailoring_diff"].includes(artifact.kind)
        : artifact.id !== artifactId),
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
}

function artifactActionRevision(
  state: AgentTaskState | undefined,
  action: AgentArtifactAction
) {
  if (!state) return undefined;
  const value = action.type === "profile_intake_candidate_decision"
    ? state.knownSlots.expectedIntakeDraftRevision
    : action.type === "profile_intake_candidate_edit"
      ? state.knownSlots.expectedIntakeDraftRevision
      : action.type === "profile_intake_retry_extraction" || action.type === "profile_intake_extraction_recovery"
        ? state.knownSlots.expectedIntakeDraftRevision
      : action.type === "resume_import_review_decision"
        ? state.knownSlots.expectedDraftRevision
        : action.type === "tailoring_answer_edit" || action.type === "tailoring_regenerate" || action.type === "tailoring_diff_decision"
          ? objectValue(state.knownSlots.tailoringSession).revision
          : action.type === "profile_intake_reconciliation_decision"
            ? state.knownSlots.expectedIntakeReconciliationRevision
            : state.knownSlots.expectedReconciliationRevision;
  return typeof value === "number" ? value : undefined;
}

function artifactActionEntityId(action: AgentArtifactAction) {
  if (action.type === "profile_intake_candidate_decision") return action.candidateId;
  if (action.type === "profile_intake_candidate_edit") return action.candidateId;
  if (action.type === "profile_intake_retry_extraction" || action.type === "profile_intake_extraction_recovery") return action.sourceMessageId;
  if (action.type === "profile_intake_reconciliation_decision") return action.incomingItemId;
  if (action.type === "resume_import_reconciliation_decision") return action.incomingItemId;
  if (action.type === "tailoring_answer_edit") return action.questionId;
  if (action.type === "tailoring_regenerate") return "regenerate";
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
  const decision = action.type === "tailoring_diff_decision"
    ? action.decision
    : action.type === "tailoring_regenerate"
      ? "regenerate"
      : action.type === "profile_intake_candidate_edit"
        ? "edit"
      : action.type === "profile_intake_retry_extraction"
        ? "retry-extraction"
      : action.type === "profile_intake_extraction_recovery"
        ? action.decision
      : action.type === "profile_intake_candidate_decision" || action.type === "resume_import_review_decision"
        ? action.decision
        : action.type === "profile_intake_reconciliation_decision"
          ? action.resolution
        : action.resolution;
  const editedValueHash = action.type === "tailoring_diff_decision" && action.editedValue !== undefined
    ? stableHashText(JSON.stringify(action.editedValue))
    : action.type === "profile_intake_candidate_edit"
      ? stableHashText(JSON.stringify(action.fieldPatch))
      : action.type === "profile_intake_extraction_recovery"
        ? stableHashText(action.decision)
    : "none";
  return ["artifact-action", session.id, tailoringSessionId, String(revision ?? "missing"), artifactActionEntityId(action), decision, editedValueHash]
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
  }
) {
  if (!session.taskState) return session;
  return projectTaskStateIntoSession(session, {
    ...session.taskState,
    knownSlots: {
      ...session.taskState.knownSlots,
      artifactActionFeedback: {
        ...feedback,
        actionType: action.type,
        entityId: artifactActionEntityId(action),
        updatedAt: new Date().toISOString()
      }
    },
    updatedAt: new Date().toISOString()
  });
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
  if (action.type === "profile_intake_candidate_decision") {
    const candidates = Array.isArray(state.knownSlots.intakeCandidates)
      ? state.knownSlots.intakeCandidates.map(objectValue)
      : [];
    const candidate = candidates.find((item) => item.id === action.candidateId);
    const accepted = candidate?.decision === "accept" || candidate?.included === true;
    if (
      state.stage !== "review_facts" && !(state.stage === "collect_experience" && action.decision === "reopen")
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
    if (
      (state.stage !== "review_facts" && !(state.stage === "collect_experience" && candidateAccepted))
      || !candidate
      || state.knownSlots.intakeImportId !== action.importId
      || state.knownSlots.expectedIntakeDraftRevision !== action.expectedDraftRevision
    ) return undefined;
    const sourceQuote = typeof candidate.sourceQuote === "string" ? candidate.sourceQuote : undefined;
    const source = objectValue(state.knownSlots.latestIntakeSource);
    if (!sourceQuote || typeof source.sessionId !== "string" || typeof source.messageId !== "string" || typeof source.turnId !== "string" || typeof source.capturedAt !== "string") return undefined;
    return {
      toolName: "review_profile_intake",
      decision: "accept",
      toolInput: {
        importId: action.importId,
        expectedDraftRevision: action.expectedDraftRevision,
        candidateId: action.candidateId,
        decision: "accept",
        structuredPatch: action.fieldPatch,
        evidence: {
          sessionId: source.sessionId,
          messageId: source.messageId,
          turnId: source.turnId,
          capturedAt: source.capturedAt,
          sourceQuote,
          sourceContentHash: typeof source.sourceContentHash === "string" ? source.sourceContentHash : undefined
        }
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
  if (action.type === "profile_intake_candidate_decision") {
    return action.decision === "accept"
      ? "已采用这项经历候选。"
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
    id: "retry-current-profile-intake-step",
    label: "重新执行当前步骤",
    action: { type: "retry_current_step" }
  };
  return {
    ...session,
    messages: session.messages.map((message, messageIndex) => messageIndex === index
      ? { ...message, options: [option] }
      : message)
  };
}
