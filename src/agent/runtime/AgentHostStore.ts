"use client";

import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import {
  deriveAgentSessionTitle,
  shouldAutoNameAgentSession,
  type AgentMessageReference,
  type AgentSession,
  type AgentTaskState
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
  AgentWorkflowControl
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
import { classifyTurnIntent, type TurnIntentDecision } from "./AgentTurnIntent";
import { stableHashText } from "@/services/security/text";
import type { AgentQuickActionId, QuickActionIntent } from "@/agent/contracts/agentQuickAction";
import {
  resolveCompoundAnswer,
  unresolvedTailoringQuestions,
  type CompoundAnswerResolution
} from "./CompoundAnswerResolver";

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
    if (JSON.stringify(recoverable) !== JSON.stringify(session)) void this.dependencies.persistence.save(recoverable);
    this.patch({
      activeSessionId: recoverable.id,
      activeSession: recoverable,
      activeTask: recoverable.taskState,
      pendingConfirmation: recoverable.pendingConfirmation,
      artifacts: recoverable.artifactRefs,
      turnStatus: recoverable.pendingConfirmation ? "waiting_for_confirmation" : "idle",
      stalled: false,
      pendingInputCount: pendingInputs.length
    });
    if (pendingInputs.length && !recoverable.pendingConfirmation) void this.drainPendingInput(recoverable.id);
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
      return this.startTurn({
        session: edited,
        userMessage: input.text.trim(),
        userMessageId: input.messageId,
        assistantMessageId,
        appendUserMessage: false,
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
        assistantMessageId: input.messageId,
        appendUserMessage: false,
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
      if (input.action.type === "select_entity") {
        return this.resolveTypedEntitySelection(session, input.action, context.pageContext);
      }
      if (input.action.type === "retry_current_step") {
        return this.startTurn({ session, userMessage: "重试当前步骤", pageContext: context.pageContext });
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
    const checkpointedSession = turnDecision.toolScope === "domain" || turnDecision.taskMutation !== "preserve"
      ? withTurnCheckpoint(input.session, turnId, userMessageId, now)
      : input.session;
    let current = input.appendUserMessage === false
      ? {
          ...checkpointedSession,
          messages: checkpointedSession.messages.map((message) =>
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
      : appendAgentMessage(current, "assistant", "正在规划下一步", {
          id: thinkingMessageId,
          turnId,
          kind: "assistant_thinking",
          type: "assistant_thinking",
          status: "thinking",
          streaming: true,
          parentMessageId: userMessageId
        });
    const reducer = new AgentTaskStateReducer();
    let kernelUserMessage = input.userMessage;
    const presentedQuestion = presentedActiveTailoringQuestion(input.session);
    let deterministicTailoringAnswer = false;
    let taskState = current.taskState ?? reducer.create(current);
    if (turnDecision.taskMutation !== "preserve") {
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
      const intakeRecoverySource = findRecoverableProfileIntakeSource(
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
        turnIntent: intakeRecoverySource ? "clarification_answer" : turnDecision.intent
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
      current = await this.dependencies.persistence.save(current);
      this.activeController = undefined;
      this.patchSession(current, { turnStatus: "completed", activeTurnId: turnId });
      return current;
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
      turnDecision
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
      save_profile_only: "仅保存资料库",
      generate_general_resume: "生成一份通用简历"
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
    const execution = this.resolveArtifactActionOnce(session, action, pageContext, revision)
      .finally(() => this.artifactActionExecutions.delete(executionKey));
    this.artifactActionExecutions.set(executionKey, execution);
    return execution;
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
            const descriptor = artifactDescriptor(event.toolName);
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
            emit: onEvent
          })
        : await this.dependencies.kernel.runTurn({
            session: current,
            pageContext: input.pageContext,
            userMessage: input.userMessage ?? "",
            references: input.references,
            turnId: input.turnId,
            turnIntent: input.turnDecision?.intent,
            toolScope: input.turnDecision?.toolScope,
            taskEventAlreadyReduced: true,
            signal: input.controller.signal,
            emit: onEvent
          });
      if (input.generation !== this.runGeneration) return this.snapshot.activeSession;
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
      current = settleThinkingMessages(current, input.turnId);
      current = settleUserExecutionState(current, input.turnId, outcome === "failed" ? "failed" : outcome === "aborted" ? "aborted" : "complete");
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
        errorCode: errorCode(error)
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
      && message.content.trim().length >= 24
      && !/从零.*(?:整理|梳理).*(?:经历|资料)/i.test(message.content)
      && /项目|实习|比赛|竞赛|经历|负责|开发|组织|课题|工作|活动|获奖/i.test(message.content)
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
      save_profile_only: "仅保存资料库",
      generate_general_resume: "生成一份通用简历"
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

function attachTaskStateOptions(session: AgentSession, state: AgentTaskState) {
  const assistantIndex = session.messages.findLastIndex((message) =>
    message.role === "assistant" && message.status === "complete" && message.metadata?.retracted !== true
  );
  if (assistantIndex < 0) return session;
  let options: AgentOption[] | undefined;
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
  }
  if (!options?.length && !metadata) return session;
  return {
    ...session,
    messages: session.messages.map((message, index) => index === assistantIndex ? {
      ...message,
      options: options?.length ? options : message.options,
      metadata: { ...message.metadata, ...metadata }
    } : message)
  };
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
    taskStateBefore: structuredClone(taskState),
    workflowStateBefore: structuredClone(session.workflowState),
    selectedEntitiesBefore: structuredClone(taskState.selectedEntities),
    artifactRefsBefore: structuredClone(session.artifactRefs),
    pendingConfirmationBefore: session.pendingConfirmation ? structuredClone(session.pendingConfirmation) : undefined,
    pendingToolCallBefore: session.pendingToolCall ? structuredClone(session.pendingToolCall) : undefined,
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
  const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === messageId);
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
    updatedAt: now
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
  const userIndex = session.messages
    .slice(0, targetIndex)
    .findLastIndex((message) => message.role === "user");
  const userMessage = userIndex >= 0 ? session.messages[userIndex] : undefined;
  if (!userMessage?.content.trim()) return undefined;
  const now = new Date().toISOString();
  const checkpoint = session.turnCheckpoints.findLast((item) => item.userMessageId === userMessage.id);
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
    return { session: notice, userMessageId: userMessage.id, userMessage: userMessage.content, blocked: true as const };
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
    userMessage: userMessage.content
  };
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
        content: "正在规划下一步",
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

function artifactDescriptor(toolName: string): {
  kind: AgentArtifactRef["kind"];
  title: string;
  entityType: AgentArtifactRef["entityType"];
  route?: string;
} | undefined {
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

function attachConfirmedToolArtifact(
  session: AgentSession,
  toolName: string,
  operationId: string,
  result: { ok: boolean; data?: unknown; artifactIds?: string[] }
) {
  const descriptor = artifactDescriptor(toolName);
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
      : action.type === "resume_import_review_decision"
        ? state.knownSlots.expectedDraftRevision
        : action.type === "tailoring_answer_edit" || action.type === "tailoring_regenerate" || action.type === "tailoring_diff_decision"
          ? objectValue(state.knownSlots.tailoringSession).revision
          : state.knownSlots.expectedReconciliationRevision;
  return typeof value === "number" ? value : undefined;
}

function artifactActionEntityId(action: AgentArtifactAction) {
  if (action.type === "profile_intake_candidate_decision") return action.candidateId;
  if (action.type === "profile_intake_candidate_edit") return action.candidateId;
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
      : action.type === "profile_intake_candidate_decision" || action.type === "resume_import_review_decision"
        ? action.decision
        : action.resolution;
  const editedValueHash = action.type === "tailoring_diff_decision" && action.editedValue !== undefined
    ? stableHashText(JSON.stringify(action.editedValue))
    : action.type === "profile_intake_candidate_edit"
      ? stableHashText(JSON.stringify(action.fieldPatch))
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
  if (action.type === "profile_intake_candidate_decision") {
    const candidates = Array.isArray(state.knownSlots.intakeCandidates)
      ? state.knownSlots.intakeCandidates.map(objectValue)
      : [];
    if (
      state.stage !== "review_facts"
      || !candidates.some((candidate) =>
        candidate.id === action.candidateId
        && (
          action.decision === "reject"
          || (candidate.needsNormalization !== true && candidate.canAccept !== false)
        )
      )
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
    if (
      state.stage !== "review_facts"
      || !candidate
      || state.knownSlots.intakeImportId !== action.importId
      || state.knownSlots.expectedIntakeDraftRevision !== action.expectedDraftRevision
    ) return undefined;
    const sourceQuote = typeof candidate.sourceQuote === "string" ? candidate.sourceQuote : undefined;
    const source = objectValue(state.knownSlots.latestIntakeSource ?? state.knownSlots.latestIntakeClarification);
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
          sourceQuote
        }
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
  if (action.type === "profile_intake_candidate_decision") {
    return action.decision === "accept" ? "已采用这项经历候选。" : "已忽略这项经历候选。";
  }
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
