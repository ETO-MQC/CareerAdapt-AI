"use client";

import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentPageContext } from "@/agent/contracts/agentContext";
import type { AgentStreamEvent } from "@/agent/runtime/agentSse";
import type { AgentKernel } from "@/agent/kernel/AgentKernel";
import type { AgentExecutor } from "@/agent/runtime/agentExecutor";
import type { AgentSessionStore } from "@/services/agent/agentSessionStore";
import type { AgentOption, AgentUiAction, AgentWorkflowControl } from "@/agent/contracts/agentActions";
import { AgentTaskStateReducer } from "./AgentTaskStateReducer";
import { appendAgentMessage, replaceAgentThinking, upsertAgentActivity } from "./AgentSessionMessages";
import { routeAgentIntent } from "./agentIntentRouter";
import {
  projectTaskStateIntoSession,
  projectTaskStateToWorkflowState
} from "./projectTaskStateToWorkflowState";

export type AgentHostInput =
  | { type: "message"; text: string }
  | { type: "file"; file: File }
  | { type: "option"; action: AgentOption["action"] }
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
};

export class AgentHostStore {
  private snapshot: AgentHostSnapshot = {
    turnStatus: "idle",
    streamEvents: [],
    artifacts: [],
    stalled: false
  };
  private readonly listeners = new Set<() => void>();
  private activeController?: AbortController;
  private stallTimer?: ReturnType<typeof setTimeout>;
  private runGeneration = 0;

  constructor(private readonly dependencies: {
    kernel: AgentKernel;
    executor: AgentExecutor;
    persistence: AgentSessionStore;
    stallThresholdMs?: number;
  }) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  adopt(session: AgentSession) {
    if (this.snapshot.activeSessionId === session.id && this.snapshot.turnStatus === "running") return;
    const recoverable = recoverOrphanedThinking(session);
    if (recoverable !== session) void this.dependencies.persistence.save(recoverable);
    this.patch({
      activeSessionId: recoverable.id,
      activeSession: recoverable,
      activeTask: recoverable.taskState,
      pendingConfirmation: recoverable.pendingConfirmation,
      artifacts: recoverable.artifactRefs,
      turnStatus: recoverable.pendingConfirmation ? "waiting_for_confirmation" : "idle",
      stalled: false
    });
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
    const session = context.session ?? this.snapshot.activeSession;
    if (!session) throw new Error("agent_session_required");
    if (input.type === "confirmation") {
      return this.resolveConfirmation(input.confirmed, context.pageContext);
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
      return this.startTurn({
        session,
        userMessage: `导入简历文件：${input.file.name}`,
        pageContext: context.pageContext
      });
    }
    if (input.type === "option") {
      if (input.action.type === "answer") {
        return this.startTurn({
          session,
          userMessage: String(input.action.value ?? ""),
          pageContext: context.pageContext
        });
      }
      return this.dispatch({ type: "ui_control", action: input.action }, context);
    }
    if (input.type === "ui_control") {
      if (isUiAction(input.action)) {
        this.patch({ uiAction: input.action });
        return session;
      }
      return this.applyWorkflowControl(session, input.action);
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
      pageContext: context.pageContext
    });
  }

  clearUiAction() {
    this.patch({ uiAction: undefined });
  }

  async startTurn(input: {
    session: AgentSession;
    userMessage: string;
    pageContext: AgentPageContext;
  }) {
    const previousGeneration = this.runGeneration;
    if (this.activeController) {
      this.activeController.abort();
      const interrupted = completeTurn(this.snapshot.activeSession ?? input.session, "aborted");
      input.session = appendAgentMessage(interrupted, "system", "上一轮已中断；已完成的步骤会保留，并按你的新意图重新规划。", {
        kind: "system_notice",
        type: "system_notice",
        status: "complete"
      });
    }
    this.runGeneration = previousGeneration + 1;
    const generation = this.runGeneration;
    const controller = new AbortController();
    this.activeController = controller;
    const now = new Date().toISOString();
    const turnId = `agent-turn-${crypto.randomUUID()}`;
    const userMessageId = `agent-user-${crypto.randomUUID()}`;
    const thinkingMessageId = `agent-thinking-${crypto.randomUUID()}`;
    let current = appendAgentMessage(input.session, "user", input.userMessage.trim(), {
      id: userMessageId,
      turnId,
      status: "complete"
    });
    current = appendAgentMessage(current, "assistant", "正在规划下一步", {
      id: thinkingMessageId,
      turnId,
      kind: "assistant_thinking",
      type: "assistant_thinking",
      status: "thinking",
      streaming: true,
      parentMessageId: userMessageId
    });
    const reducer = new AgentTaskStateReducer();
    const taskState = reducer.reduce(current.taskState ?? reducer.create(current), {
      type: "user_message",
      message: input.userMessage
    });
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
    return this.consume({
      generation,
      controller,
      current,
      thinkingMessageId,
      turnId,
      pageContext: input.pageContext,
      userMessage: input.userMessage
    });
  }

  async resolveConfirmation(confirmed: boolean, pageContext: AgentPageContext) {
    const session = this.snapshot.activeSession;
    const confirmation = session?.pendingConfirmation;
    const call = session?.pendingToolCall;
    if (!session || !confirmation || !call) return session;
    const turnId = call.turnId ?? confirmation.turnId ?? session.activeTurn?.id ?? `agent-turn-${crypto.randomUUID()}`;
    let current: AgentSession = {
      ...session,
      pendingConfirmation: undefined,
      pendingToolCall: undefined
    };
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
    if (current.taskState) {
      const taskState = new AgentTaskStateReducer().reduce(current.taskState, {
          type: "confirmation_accepted",
          toolName: call.toolName
        });
      current = projectTaskStateIntoSession(current, taskState);
    }
    const result = await this.dependencies.executor.execute({
      toolName: call.toolName,
      toolInput: call.input,
      operationId: call.operationId,
      confirmed: true
    });
    current = upsertAgentActivity(current, {
      id: `agent-tool-${call.operationId}`,
      turnId,
      content: result.ok ? "已按你的确认完成这一步。" : "这一步未能完成，现有任务信息已保留。",
      toolName: call.toolName,
      operationId: call.operationId,
      status: result.ok ? "complete" : "failed",
      metadata: { activityState: result.ok ? "complete" : "failed", artifactIds: result.artifactIds }
    });
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
    return this.consume({
      generation,
      controller,
      current,
      thinkingMessageId,
      turnId,
      pageContext,
      resume: internal
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
    resume?: {
      reason: "tool_observation" | "confirmation_rejected" | "external_event";
      toolName?: string;
      observation: unknown;
    };
  }) {
    let current = input.current;
    let visible = "";
    const onEvent = async (event: AgentStreamEvent) => {
      if (input.generation !== this.runGeneration) return;
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
        if (event.ok && ["analyze_job_fit", "create_tailoring_session", "preview_tailoring_changes", "apply_tailoring_changes"].includes(event.toolName)) {
          const now = new Date().toISOString();
          const artifactId = event.artifactIds?.[0] ?? `agent-artifact-${event.toolName}-${event.operationId}`;
          const descriptor = artifactDescriptor(event.toolName);
          if (descriptor) {
            current = {
              ...current,
              artifactRefs: [
                ...current.artifactRefs.filter((artifact) => artifact.id !== artifactId),
                {
                  id: artifactId,
                  kind: descriptor.kind,
                  title: descriptor.title,
                  entityType: descriptor.entityType,
                  entityId: current.taskState?.selectedEntities.resumeId
                    ?? current.taskState?.selectedEntities.jobId
                    ?? `pending-${event.operationId}`,
                  route: descriptor.route,
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
        current = replaceAgentThinking(current, input.thinkingMessageId, event.message?.trim() || visible, input.turnId);
      }
      if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
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
            taskEventAlreadyReduced: true,
            signal: input.controller.signal,
            emit: onEvent
          });
      if (input.generation !== this.runGeneration) return this.snapshot.activeSession;
      const outcome = result.pendingConfirmation
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
        pendingConfirmation: result.pendingConfirmation ? { ...result.pendingConfirmation, turnId: input.turnId } : undefined,
        pendingToolCall: result.pendingCall ? { ...result.pendingCall, turnId: input.turnId } : undefined,
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
      current = await this.dependencies.persistence.save(current);
      this.patchSession(current, {
        turnStatus: outcome === "waiting_for_confirmation" ? "waiting_for_confirmation" : outcome === "failed" ? "failed" : "completed",
        pendingConfirmation: current.pendingConfirmation
      });
      return current;
    } catch (error) {
      if (input.controller.signal.aborted) return this.snapshot.activeSession;
      current = completeTurn(current, "failed");
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
      }
    }
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
    "open_artifact"
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

function isProgressEvent(event: AgentStreamEvent) {
  return [
    "assistant_delta",
    "thinking",
    "tool_started",
    "tool_result",
    "confirmation_required"
  ].includes(event.type);
}

function settleThinkingMessages(session: AgentSession, turnId: string) {
  let changed = false;
  const messages = session.messages.map((message) => {
    if (
      message.turnId === turnId
      && message.kind === "assistant_thinking"
      && (message.status === "thinking" || message.streaming)
    ) {
      changed = true;
      return {
        ...message,
        content: "这一步已中断，可重试或继续任务。",
        kind: "system_notice" as const,
        type: "system_notice" as const,
        status: "recovered" as const,
        streaming: false,
        updatedAt: new Date().toISOString()
      };
    }
    return message;
  });
  return changed ? { ...session, messages } : session;
}

function recoverOrphanedThinking(session: AgentSession) {
  if (session.activeTurn?.status !== "running") return session;
  const settled = settleThinkingMessages(session, session.activeTurn.id);
  return {
    ...settled,
    activeTurn: {
      ...session.activeTurn,
      status: "aborted" as const,
      completedAt: new Date().toISOString()
    }
  };
}

function artifactDescriptor(toolName: string): {
  kind: AgentArtifactRef["kind"];
  title: string;
  entityType: AgentArtifactRef["entityType"];
  route?: string;
} | undefined {
  if (toolName === "analyze_job_fit") {
    return { kind: "job_fit_overview", title: "岗位匹配分析", entityType: "job" };
  }
  if (toolName === "create_tailoring_session" || toolName === "preview_tailoring_changes") {
    return { kind: "tailoring_diff", title: "简历定制修改预览", entityType: "tailoring_session" };
  }
  if (toolName === "apply_tailoring_changes") {
    return { kind: "quality_result", title: "定制简历质量结果", entityType: "resume_branch", route: "/resume" };
  }
  return undefined;
}
