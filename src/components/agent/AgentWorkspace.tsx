"use client";

import { History, Pause, Play, RotateCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import {
  TailorExistingResumeWorkflowController,
  tailorExistingResumeWorkflow
} from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import type { AgentArtifactRef } from "@/agent/contracts/agentArtifact";
import {
  createQuickActionIntent,
  type AgentQuickActionId
} from "@/agent/contracts/agentQuickAction";
import type { AgentOption, AgentUiAction, AgentWorkflowControl } from "@/agent/contracts/agentActions";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";
import { getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import { AgentKernel } from "@/agent/kernel/AgentKernel";
import { AgentToolResolver } from "@/agent/kernel/AgentToolResolver";
import { HttpAgentModel } from "@/agent/model/httpAgentModel";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { useWorkspaceMode } from "@/components/layout/WorkspaceModeProvider";
import { ACTIVE_SESSION_KEY } from "@/components/agent/shell/AgentSidebar";
import {
  AgentArtifactDrawer,
  type AgentArtifactDrawerState
} from "./artifacts/AgentArtifactDrawer";
import { AgentComposer } from "./AgentComposer";
import { AgentConfirmationCard } from "./AgentConfirmationCard";
import { AgentConversationTimeline, normalizeAgentMessageText } from "./AgentConversation";
import { AgentHistoryDialog } from "./AgentHistoryDialog";
import { AgentZeroState } from "./workspace/AgentZeroState";
import { AgentWorkspaceLayout } from "./workspace/AgentWorkspaceLayout";
import { AgentWorkflowRenderer } from "./workspace/AgentWorkflowRenderer";

type ResumeSummary = { id: string; profileId: string; name: string; purpose: string; revision: number };
export function AgentWorkspace() {
  return <AgentWorkspaceController />;
}

export function AgentWorkspaceController() {
  const router = useRouter();
  const { setMode } = useWorkspaceMode();
  const dependencies = useMemo(() => {
    const service = new BrowserAgentToolService();
    const registry = createAgentToolRegistry(service);
    const executor = new AgentExecutor(registry);
    const store = new AgentSessionStore();
    return {
      service,
      registry,
      executor,
      store,
      eventBus: new AgentEventBus(),
      kernel: new AgentKernel({
        model: new HttpAgentModel(),
        executor,
        toolResolver: new AgentToolResolver(registry)
      }),
      controller: new TailorExistingResumeWorkflowController(executor)
    };
  }, []);
  const workflowState = useSyncExternalStore(
    dependencies.controller.subscribe,
    dependencies.controller.getSnapshot,
    dependencies.controller.getSnapshot
  );
  const [session, setSession] = useState<AgentSession>(() =>
    AgentRuntime.create(tailorExistingResumeWorkflow.id, tailorExistingResumeWorkflow.initialStep, "AI 求职任务")
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [workflowActive, setWorkflowActive] = useState(false);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimePaused, setRuntimePaused] = useState(false);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [restoredSession, setRestoredSession] = useState(false);
  const [quickTasksOpen, setQuickTasksOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<AgentArtifactDrawerState>("closed");
  const [selectedResume, setSelectedResume] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobText, setJobText] = useState("");
  const [answer, setAnswer] = useState("");
  const [composerDraft, setComposerDraft] = useState("");
  const [floatingAction, setFloatingAction] = useState<AgentUiAction | undefined>();
  const [switchChoice, setSwitchChoice] = useState<Extract<AgentWorkflowControl, { type: "switch_workflow" }> | undefined>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  const previousArtifactCount = useRef(0);

  const restoreSession = useCallback((selected: AgentSession) => {
    setSession(selected);
    setRestoredSession(true);
    setWorkflowActive(selected.workflowState.workflowId === tailorExistingResumeWorkflow.id);
    setHistoryOpen(false);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, selected.id);
    if (selected.workflowState.workflowId === tailorExistingResumeWorkflow.id) {
      const data = selected.workflowState.data;
      dependencies.controller.restore({
        step: selected.workflowState.step,
        profileId: typeof data.profileId === "string" ? data.profileId : undefined,
        resumeId: typeof data.resumeId === "string" ? data.resumeId : undefined,
        jobId: typeof data.jobId === "string" ? data.jobId : undefined,
        revisionId: typeof data.revisionId === "string" ? data.revisionId : undefined
      });
    }
  }, [dependencies.controller]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      dependencies.executor.execute({ toolName: "list_resumes", toolInput: {}, operationId: `list-resumes-${crypto.randomUUID()}` }),
      dependencies.executor.execute({ toolName: "list_profiles", toolInput: {}, operationId: `list-profiles-${crypto.randomUUID()}` }),
      dependencies.store.list()
    ]).then(([resumeResult, profileResult, storedSessions]) => {
      if (!active) return;
      setResumes(readArray(resumeResult.data, "resumes") as ResumeSummary[]);
      readArray(profileResult.data, "profiles");
      setSessions(storedSessions);
      const requestedSessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      const restored = storedSessions.find((item) => item.id === requestedSessionId) ?? storedSessions[0];
      if (restored) {
        setSession(restored);
        setRestoredSession(true);
        if (restored.workflowState.workflowId === tailorExistingResumeWorkflow.id) {
          const data = restored.workflowState.data;
          dependencies.controller.restore({
            step: restored.workflowState.step,
            profileId: typeof data.profileId === "string" ? data.profileId : undefined,
            resumeId: typeof data.resumeId === "string" ? data.resumeId : undefined,
            jobId: typeof data.jobId === "string" ? data.jobId : undefined,
            revisionId: typeof data.revisionId === "string" ? data.revisionId : undefined
          });
          setWorkflowActive(true);
        }
      }
    });
    return () => { active = false; };
  }, [dependencies]);

  useEffect(() => {
    const selectSession = (event: Event) => {
      const sessionId = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      const selected = sessions.find((item) => item.id === sessionId);
      if (selected) restoreSession(selected);
    };
    const newTask = () => {
      dependencies.controller.restore({ step: tailorExistingResumeWorkflow.initialStep });
      setSession(AgentRuntime.create("agent_quick_action", "collecting_intent", "新的 AI 任务"));
      setWorkflowActive(false);
      setRestoredSession(false);
      setQuickTasksOpen(false);
      setDrawerState("closed");
    };
    const openHistory = () => {
      void dependencies.store.list().then((items) => {
        setSessions(items);
        setHistoryOpen(true);
      });
    };
    const syncActiveSession = () => {
      const sessionId = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      if (!sessionId) return;
      void dependencies.store.get(sessionId).then((selected) => {
        if (!selected) return;
        setSession(selected);
        setRestoredSession(true);
        setWorkflowActive(selected.workflowState.workflowId === tailorExistingResumeWorkflow.id);
      });
    };
    const revisionChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ branchId?: string; revisionId?: string }>).detail;
      if (!detail?.revisionId) return;
      const revisionId = detail.revisionId;
      setSession((current) => {
        if (current.workflowState.data.revisionId === revisionId) return current;
        const notified = appendLocalMessage(
          current,
          "assistant",
          "检测到简历已更新。后续步骤会使用最新版本；旧 Revision 不会被静默继续执行。"
        );
        const next = {
          ...notified,
          activeResumeId: detail.branchId ?? notified.activeResumeId,
          workflowState: {
            ...notified.workflowState,
            status: "waiting_for_user" as const,
            data: { ...notified.workflowState.data, revisionId }
          }
        };
        void dependencies.store.save(next);
        return next;
      });
    };
    window.addEventListener("careeradapt-agent-session-select", selectSession);
    window.addEventListener("careeradapt-agent-new-task", newTask);
    window.addEventListener("careeradapt-agent-history-open", openHistory);
    window.addEventListener("careeradapt-agent-sessions-change", syncActiveSession);
    window.addEventListener("careeradapt-agent-revision-change", revisionChanged);
    return () => {
      window.removeEventListener("careeradapt-agent-session-select", selectSession);
      window.removeEventListener("careeradapt-agent-new-task", newTask);
      window.removeEventListener("careeradapt-agent-history-open", openHistory);
      window.removeEventListener("careeradapt-agent-sessions-change", syncActiveSession);
      window.removeEventListener("careeradapt-agent-revision-change", revisionChanged);
    };
  }, [dependencies.controller, dependencies.store, restoreSession, sessions]);

  useEffect(() => {
    if (!workflowActive) return;
    const now = new Date().toISOString();
    const artifactRefs = buildArtifactRefs(workflowState, now);
    const next: AgentSession = {
      ...session,
      activeProfileId: workflowState.profileId ?? session.activeProfileId,
      activeResumeId: workflowState.resumeId ?? session.activeResumeId,
      activeJobId: workflowState.jobId ?? session.activeJobId,
      workflowState: {
        ...session.workflowState,
        workflowId: tailorExistingResumeWorkflow.id,
        step: workflowState.step,
        status: workflowState.error ? "failed" : workflowState.step === "completed" ? "completed" : workflowState.pendingConfirmation ? "waiting_for_confirmation" : workflowState.busy ? "running" : "waiting_for_user",
        data: {
          ...(workflowState.profileId ? { profileId: workflowState.profileId } : {}),
          ...(workflowState.resumeId ? { resumeId: workflowState.resumeId } : {}),
          ...(workflowState.jobId ? { jobId: workflowState.jobId } : {}),
          ...(workflowState.appliedRevisionId ? { revisionId: workflowState.appliedRevisionId } : {})
        }
      },
      artifactRefs,
      updatedAt: now
    };
    void dependencies.store.save(next);
  }, [dependencies.store, session, workflowActive, workflowState]);

  const workflowArtifacts = useMemo(
    () => buildArtifactRefs(workflowState, session.updatedAt),
    [session.updatedAt, workflowState]
  );
  const artifacts = useMemo(() => {
    const merged = new Map<string, AgentArtifactRef>();
    for (const artifact of [...session.artifactRefs, ...workflowArtifacts]) merged.set(artifact.id, artifact);
    return [...merged.values()];
  }, [session.artifactRefs, workflowArtifacts]);

  useEffect(() => {
    if (artifacts.length > previousArtifactCount.current) {
      setDrawerState(window.matchMedia("(min-width: 1200px)").matches ? "pinned" : "open");
    }
    previousArtifactCount.current = artifacts.length;
  }, [artifacts.length]);

  function createAbortController() {
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }

  function handleUiAction(action: AgentUiAction) {
    if (action.type === "open_artifact") {
      setDrawerState("open");
      return;
    }
    setFloatingAction(action);
  }

  async function handleWorkflowControl(
    action: AgentWorkflowControl,
    baseSession: AgentSession = session,
    thinkingMessageId?: string
  ) {
    if (
      action.type === "switch_workflow"
      && action.workflowId === "job_ingestion"
      && isActiveWorkflow(baseSession)
      && baseSession.workflowState.workflowId !== "job_ingestion"
      && action.preserveCurrent
    ) {
      setSwitchChoice(action);
      handleUiAction({ type: "open_job_import_dialog" });
      return replaceThinkingWithAssistant(baseSession, thinkingMessageId, "可以录入岗位。当前任务会先暂存，岗位录入只影响新的岗位流程。", "");
    }

    if (action.type === "pause_workflow") {
      const next = replaceThinkingWithAssistant(baseSession, thinkingMessageId, "任务已暂停。", "");
      setRuntimePaused(true);
      return { ...next, workflowState: { ...next.workflowState, status: "paused" as const } };
    }
    if (action.type === "resume_workflow") {
      const next = replaceThinkingWithAssistant(baseSession, thinkingMessageId, "任务已恢复。", "");
      setRuntimePaused(false);
      return { ...next, workflowState: { ...next.workflowState, status: "waiting_for_user" as const } };
    }
    if (action.type === "cancel_workflow") {
      setSwitchChoice(undefined);
      const next = replaceThinkingWithAssistant(baseSession, thinkingMessageId, "任务已取消。", "");
      return { ...next, workflowState: { ...next.workflowState, status: "completed" as const } };
    }
    if (action.type === "go_back") {
      return replaceThinkingWithAssistant(baseSession, thinkingMessageId, "已返回上一步。", "");
    }

    const workflowId = action.workflowId;
    const definition = getWorkflowDefinition(workflowId);
    const nextWorkflowData: AgentSession["workflowState"]["data"] =
      action.type === "switch_workflow" && action.preserveCurrent
        ? { preservedWorkflowId: baseSession.workflowState.workflowId }
        : {};
    const nextWorkflowState: AgentSession["workflowState"] = {
      workflowId,
      step: definition?.initialStep ?? "collecting_intent",
      status: "waiting_for_user",
      toolCallCount: 0,
      data: nextWorkflowData
    };
    if (workflowId === tailorExistingResumeWorkflow.id) {
      dependencies.controller.restore({ step: tailorExistingResumeWorkflow.initialStep });
      setWorkflowActive(true);
    } else {
      setWorkflowActive(false);
    }
    if (workflowId === "job_ingestion") handleUiAction({ type: "open_job_import_dialog" });
    return {
      ...replaceThinkingWithAssistant(baseSession, thinkingMessageId, workflowStartMessage(workflowId), ""),
      title: workflowTitle(workflowId),
      workflowState: nextWorkflowState
    };
  }

  function handleOption(option: AgentOption) {
    const action = option.action;
    if (action.type === "answer") {
      void sendMessage(String(action.value ?? option.label));
      return;
    }
    if (isUiAction(action)) {
      handleUiAction(action);
      return;
    }
    void handleWorkflowControl(action).then(async (next) => {
      setSession(next);
      await dependencies.store.save(next);
    });
  }

  async function sendMessage(message: string, sessionOverride?: AgentSession) {
    let currentSession = sessionOverride ?? session;
    const previousError = [...currentSession.messages].reverse().find((item) =>
      item.kind === "error_status"
      && item.errorCode
      && item.userMessageId
      && item.status !== "recovered"
    );
    if (previousError) {
      currentSession = upsertAgentErrorStatus(currentSession, {
        userMessageId: previousError.userMessageId!,
        errorCode: previousError.errorCode!,
        status: "retrying",
        content: "正在重新连接 AI 服务，当前任务和输入已保留。"
      });
    }

    const userAlreadyAppended = Boolean(previousError);
    const optimisticBase = userAlreadyAppended
      ? currentSession
      : appendLocalMessage(currentSession, "user", message.trim());
    const latestUserMessage = [...optimisticBase.messages].reverse().find((item) => item.role === "user");
    const thinkingMessageId = `agent-thinking-${crypto.randomUUID()}`;
    const optimistic = appendLocalMessage(optimisticBase, "assistant", "", undefined, {
      id: thinkingMessageId,
      kind: "assistant_thinking",
      type: "assistant_thinking",
      status: "thinking",
      streaming: true,
      parentMessageId: latestUserMessage?.id,
      language: detectMessageLanguage(message)
    });
    const runtimeBase = {
      ...optimistic,
      messages: optimistic.messages.filter((item) => item.id !== thinkingMessageId)
    };

    setSession(optimistic);
    setRuntimeBusy(true);
    setLastUserMessage(message);
    setProviderUnavailable(false);
    await dependencies.store.save(optimistic);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, optimistic.id);
    window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));

    try {
      const routed = routeAgentIntent(message, { activeWorkflowId: runtimeBase.workflowState.workflowId });
      if (routed.kind === "workflow_control") {
        const next = await handleWorkflowControl(routed.action, runtimeBase, thinkingMessageId);
        setSession(next);
        await dependencies.store.save(next);
        return;
      }
      if (routed.kind === "ui_action") {
        handleUiAction(routed.action);
        const next = replaceThinkingWithAssistant(runtimeBase, thinkingMessageId, uiActionStatus(routed.action), message);
        setSession(await dependencies.store.save(next));
        return;
      }
      const finalSession = await consumeAgentStream({
        base: runtimeBase,
        optimistic,
        thinkingMessageId,
        userMessage: message,
        signalController: createAbortController(),
        onUiAction: handleUiAction,
        onWorkflowControl: (action) => void handleWorkflowControl(action, runtimeBase, thinkingMessageId)
      });
      window.localStorage.setItem(ACTIVE_SESSION_KEY, finalSession.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    } catch (error) {
      const userMessageId = previousError?.userMessageId
        ?? latestUserMessage?.id
        ?? [...runtimeBase.messages].reverse().find((item) => item.role === "user")?.id
        ?? `agent-user-${crypto.randomUUID()}`;
      const errorCode = plannerErrorCode(error);
      const fallback = upsertAgentErrorStatus(runtimeBase, {
        userMessageId,
        errorCode,
        status: "failed",
        content: plannerErrorMessage(errorCode)
      });
      setSession(await dependencies.store.save({
        ...fallback,
        messages: fallback.messages.filter((item) => item.id !== thinkingMessageId)
      }));
      setProviderUnavailable(true);
    } finally {
      abortRef.current = undefined;
      setRuntimeBusy(false);
    }
  }

  async function consumeAgentStream(input: {
    base: AgentSession;
    optimistic: AgentSession;
    thinkingMessageId: string;
    userMessage: string;
    signalController: AbortController;
    onUiAction(action: AgentUiAction): void;
    onWorkflowControl(action: AgentWorkflowControl): void;
  }) {
    const pageContext = {
      pathname: window.location.pathname,
      route: window.location.pathname,
      title: "AI 工作台",
      activeProfileId: workflowState.profileId,
      activeResumeId: workflowState.resumeId,
      activeJobId: workflowState.jobId,
      query: {}
    };
    let streamingMessage: AgentMessage | undefined;
    let visible = "";
    let final = input.optimistic;
    const result = await dependencies.kernel.runTurn({
      session: input.base,
      pageContext,
      userMessage: input.userMessage,
      signal: input.signalController.signal,
      emit: (event) => {
      if (event.type === "thinking") {
        final = {
          ...final,
          messages: final.messages.map((message) =>
            message.id === input.thinkingMessageId
              ? { ...message, content: event.label, status: "thinking", updatedAt: new Date().toISOString() }
              : message
          )
        };
        setSession(final);
      }
      if (event.type === "skill_loaded") {
        final = appendActivityMessage(final, {
          id: `agent-skill-${event.skillId}-${crypto.randomUUID()}`,
          content: event.label,
          toolName: "skill_loaded",
          status: "complete",
          metadata: { skillId: event.skillId, activityState: "complete" }
        });
        setSession(final);
      }
      if (event.type === "tool_started") {
        final = upsertActivityMessage(final, {
          id: `agent-tool-${event.operationId}`,
          content: event.userLabel,
          toolName: event.toolName,
          operationId: event.operationId,
          status: "pending",
          metadata: { activityState: "running" }
        });
        setSession(final);
      }
      if (event.type === "tool_result") {
        final = upsertActivityMessage(final, {
          id: `agent-tool-${event.operationId}`,
          content: event.summary,
          toolName: event.toolName,
          operationId: event.operationId,
          status: event.ok ? "complete" : "failed",
          metadata: { activityState: event.ok ? "complete" : "failed", artifactIds: event.artifactIds ?? [] }
        });
        setSession(final);
      }
      if (event.type === "assistant_start") {
        streamingMessage = {
          id: input.thinkingMessageId,
          role: "assistant",
          content: "",
          kind: "assistant_streaming",
          type: "assistant_streaming",
          status: "streaming",
          streaming: true,
          language: "unknown",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        final = {
          ...final,
          messages: final.messages.map((message) =>
            message.id === input.thinkingMessageId ? streamingMessage! : message
          )
        };
        setSession(final);
      }
      if (event.type === "assistant_delta") {
        visible += event.delta;
        final = {
          ...final,
          messages: final.messages.map((message) =>
            message.id === input.thinkingMessageId
              ? {
                  ...(streamingMessage ?? message),
                  content: visible,
                  status: "streaming" as const,
                  streaming: true,
                  updatedAt: new Date().toISOString()
                }
              : message
          )
        };
        setSession(final);
      }
      if (event.type === "ui_action" && isUiAction(event.action)) input.onUiAction(event.action);
      if (event.type === "confirmation_required") {
        const confirmation = event.confirmation as NonNullable<AgentSession["pendingConfirmation"]>;
        final = upsertActivityMessage(final, {
          id: `agent-tool-${confirmation.operationId}`,
          content: "等待你确认后继续",
          toolName: confirmation.toolName,
          operationId: confirmation.operationId,
          status: "pending",
          metadata: { activityState: "waiting_confirmation" }
        });
        final = {
          ...final,
          pendingConfirmation: confirmation,
          workflowState: { ...final.workflowState, status: "waiting_for_confirmation" }
        };
        setSession(final);
      }
      if (event.type === "done") {
        if (isWorkflowControl(event.action)) input.onWorkflowControl(event.action);
        const doneText = typeof event.message === "string" && event.message.trim() ? event.message : visible;
        final = replaceThinkingWithAssistant(final, input.thinkingMessageId, doneText, doneText);
      }
      if (event.type === "error") throw Object.assign(new Error(event.message), { code: event.code });
      }
    });
    final = {
      ...final,
      trajectory: result.trajectory,
      reflection: result.reflection,
      pendingConfirmation: result.pendingConfirmation,
      pendingToolCall: result.pendingCall,
      workflowState: {
        ...final.workflowState,
        status: result.pendingConfirmation ? "waiting_for_confirmation" : final.workflowState.status
      }
    };
    const saved = await dependencies.store.save(normalizeAssistantMessages(final, finalAssistantText(final)));
    setSession(saved);
    return saved;
  }

  async function startQuickAction(actionId: AgentQuickActionId) {
    const workflowId = quickActionWorkflowId(actionId);
    if (workflowId) {
      setRestoredSession(false);
      setQuickTasksOpen(false);
      const next = await handleWorkflowControl({ type: "start_workflow", workflowId });
      const titled = { ...next, title: quickActionTitle(actionId) };
      setSession(titled);
      await dependencies.store.save(titled);
      if (window.location.pathname !== "/ai-workspace") router.push("/ai-workspace");
      return;
    }

    const quickIntent = createQuickActionIntent(actionId, quickTasksOpen ? "quick_tasks" : "zero_state");
    const reuse = session.messages.every((message) => message.role === "system")
      && session.artifactRefs.length === 0;
    const prepared = reuse ? {
      ...session,
      title: quickActionTitle(actionId),
      workflowState: {
        ...session.workflowState,
        workflowId: actionId === "tailor_resume_to_job" ? tailorExistingResumeWorkflow.id : `quick_action:${actionId}`,
        step: actionId === "tailor_resume_to_job" ? tailorExistingResumeWorkflow.initialStep : "collecting_intent",
        status: "waiting_for_user" as const,
        data: {
          ...session.workflowState.data,
          quickActionId: quickIntent.actionId,
          initialIntent: quickIntent.intent
        }
      }
    } : AgentRuntime.create(
      actionId === "tailor_resume_to_job" ? tailorExistingResumeWorkflow.id : `quick_action:${actionId}`,
      actionId === "tailor_resume_to_job" ? tailorExistingResumeWorkflow.initialStep : "collecting_intent",
      quickActionTitle(actionId)
    );
    const next = prepared.workflowState.data.quickActionId ? prepared : {
      ...prepared,
      workflowState: {
        ...prepared.workflowState,
        data: {
          ...prepared.workflowState.data,
          quickActionId: quickIntent.actionId,
          initialIntent: quickIntent.intent
        }
      }
    };
    setSession(next);
    setRestoredSession(false);
    setQuickTasksOpen(false);
    setWorkflowActive(actionId === "tailor_resume_to_job");
    const pendingTurn = sendMessage(quickIntent.intent, next);
    if (window.location.pathname !== "/ai-workspace") router.push("/ai-workspace");
    await pendingTurn;
  }

  async function confirmKernelAction(confirmed: boolean) {
    const call = session.pendingToolCall;
    if (!session.pendingConfirmation || !call) return;
    if (!confirmed) {
      const next = appendLocalMessage({
        ...session,
        pendingConfirmation: undefined,
        pendingToolCall: undefined,
        workflowState: { ...session.workflowState, status: "waiting_for_user" }
      }, "assistant", "已取消这次操作，现有数据没有改变。");
      setSession(await dependencies.store.save(next));
      return;
    }
    setRuntimeBusy(true);
    try {
      const result = await dependencies.executor.execute({
        toolName: call.toolName,
        toolInput: call.input,
        operationId: call.operationId,
        confirmed: true
      });
      const cleared = {
        ...session,
        pendingConfirmation: undefined,
        pendingToolCall: undefined,
        workflowState: { ...session.workflowState, status: result.ok ? "waiting_for_user" as const : "failed" as const }
      };
      const next = upsertActivityMessage(cleared, {
        id: `agent-tool-${call.operationId}`,
        content: result.ok ? "已按你的确认完成这一步。" : "这一步未能完成，现有任务信息已保留。",
        toolName: call.toolName,
        operationId: call.operationId,
        status: result.ok ? "complete" : "failed",
        metadata: { activityState: result.ok ? "complete" : "failed", artifactIds: result.artifactIds }
      });
      setSession(await dependencies.store.save(next));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function upload(file: File): Promise<"ready" | "partial"> {
    const now = new Date().toISOString();
    const uploadId = `resume-upload-${crypto.randomUUID()}`;
    const artifact: AgentArtifactRef = {
      id: `artifact-${uploadId}`,
      kind: "resume_import_review",
      title: `导入核对 · ${file.name}`,
      entityType: "resume_import_draft",
      entityId: uploadId,
      status: "active",
      summary: file.type === "application/pdf"
        ? "文件已接收。当前 Agent Tool 需要已有 PDF 导入流程提供页面文本，已标记为 partial，原导入页仍可继续使用。"
        : "文件已接收，正在通过现有简历解析工具生成待核对草稿。",
      createdAt: now,
      updatedAt: now
    };
    let next = appendLocalMessage({
      ...session,
      title: session.messages.length ? session.title : `导入简历 · ${file.name}`,
      artifactRefs: [...session.artifactRefs, artifact],
      workflowState: {
        ...session.workflowState,
        workflowId: "quick_action:import_existing_resume",
        step: "collecting_intent",
        status: "running",
        data: { ...session.workflowState.data, quickActionId: "import_existing_resume", uploadName: file.name }
      }
    }, "user", `我上传了文件“${file.name}”，请解析并让我核对内容来源。`);
    setSession(next);
    setDrawerState("open");
    const text = file.type === "application/pdf" ? "" : await file.text();
    const result = await dependencies.executor.execute({
      toolName: "parse_resume_file",
      toolInput: { fileName: file.name, mimeType: file.type || "text/plain", text },
      operationId: `parse-resume-${crypto.randomUUID()}`
    });
    const partial = file.type === "application/pdf" || !result.ok;
    next = appendLocalMessage(next, "tool", partial ? "已接收文件，等待 PDF 页面文本接入后继续提取。" : "已提取简历内容，等待你逐项核对。", "parse_resume_file");
    next = appendLocalMessage(next, "assistant", partial
      ? "文件已安全保留，但当前 Agent 接入只能完成部分步骤。下一步需要复用现有 PDF 文本提取结果；我不会跳转页面或假装导入已完成。"
      : "已生成待核对内容。请在右侧产物中查看，并确认下一步。");
    next = {
      ...next,
      workflowState: { ...next.workflowState, status: "waiting_for_user" },
      artifactRefs: next.artifactRefs.map((item) => item.id === artifact.id
        ? { ...item, summary: partial ? artifact.summary : "解析已完成，等待 resume_import_review 渲染器接入逐项核对。", updatedAt: new Date().toISOString() }
        : item)
    };
    setSession(await dependencies.store.save(next));
    window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    return partial ? "partial" : "ready";
  }

  const hasActualUserTask = session.messages.some((message) => message.role === "user");
  const showZeroState = quickTasksOpen || (
    !hasActualUserTask
    && !workflowActive
    && artifacts.length === 0
    && !restoredSession
  );

  const openHistory = async () => {
    setSessions(await dependencies.store.list());
    setHistoryOpen(true);
  };

  return (
    <AgentWorkspaceLayout
      sessionTitle={showZeroState ? "AI 助手" : session.title}
      status={workflowStatusLabel(runtimeBusy ? "running" : session.workflowState.status)}
      artifactCount={artifacts.length}
      onOpenArtifacts={() => setDrawerState("open")}
      onOpenHistory={() => void openHistory()}
    >
      {providerUnavailable ? (
        <div className="agent-offline-banner" role="alert">
          <WifiOff aria-hidden="true" />
          <div><strong>AI 服务暂时不可用</strong><span>任务、会话和上传文件都已保留，不会自动切换模式。</span></div>
          <button type="button" onClick={() => void sendMessage(lastUserMessage)}><RotateCw aria-hidden="true" /> 重试</button>
          <button type="button" onClick={() => setMode("manual")}>切换手动模式</button>
        </div>
      ) : null}

      <div className={drawerState === "pinned" && artifacts.length ? "agent-workspace-body has-pinned-artifacts" : "agent-workspace-body"}>
        <section className="agent-main-column">
          {showZeroState ? (
            <AgentZeroState onSelect={(id) => void startQuickAction(id)} />
          ) : (
            <>
              <div className="agent-conversation-toolbar">
                <button type="button" onClick={() => {
                  const messages = session.messages.filter((m) => m.role !== "system");
                  if (!messages.length) return;
                  const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `ai-conversation-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}>导出对话</button>
                <button
                  type="button"
                  onClick={() => setRuntimePaused((value) => !value)}
                >
                  {runtimePaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {runtimePaused ? "恢复任务" : "暂停任务"}
                </button>
                <button type="button" onClick={() => void openHistory()}>
                  <History aria-hidden="true" /> 历史
                </button>
              </div>
              <AgentConversationTimeline
                messages={session.messages}
                onUndoLastUser={() => {
                  const index = session.messages.findLastIndex((message) => message.role === "user");
                  if (index < 0) return;
                  const next = { ...session, messages: session.messages.slice(0, index), updatedAt: new Date().toISOString() };
                  setSession(next);
                  void dependencies.store.save(next);
                }}
                onRegenerate={lastUserMessage ? () => {
                  const prepared = replaceLastAssistantForRegenerate(session);
                  setSession(prepared);
                  void dependencies.store.save(prepared);
                  void sendMessage(lastUserMessage, prepared);
                } : undefined}
                onEditUserMessage={(message) => setComposerDraft(message.content)}
                onContinueFromMessage={(message) => setComposerDraft(`基于这条回复继续：\n${normalizeAgentMessageText(message.content)}`)}
                onCopyMessage={(message) => void navigator.clipboard?.writeText(normalizeAgentMessageText(message.content))}
                onOption={handleOption}
              >
                {workflowActive ? (
                  <AgentWorkflowRenderer
                    state={workflowState}
                    resumes={resumes}
                    selectedResume={selectedResume}
                    jobTitle={jobTitle}
                    jobCompany={jobCompany}
                    jobText={jobText}
                    answer={answer}
                    onSelectedResumeChange={setSelectedResume}
                    onSelectResume={() => {
                      const resume = resumes.find((item) => item.id === selectedResume);
                      if (resume) dependencies.controller.selectResume(resume.profileId, resume.id);
                    }}
                    onJobTitleChange={setJobTitle}
                    onJobCompanyChange={setJobCompany}
                    onJobTextChange={setJobText}
                    onParseJob={() => void dependencies.controller.parseJob({ title: jobTitle, company: jobCompany, rawText: jobText })}
                    onAnswerChange={setAnswer}
                    onAnswer={(questionId) => dependencies.controller.requestAnswer(questionId, answer)}
                    onAnalyze={() => void dependencies.controller.analyzeFitAndPlan()}
                    onPreview={() => void dependencies.controller.preview()}
                    onConfirm={(confirmed) => void dependencies.controller.confirmPending(confirmed)}
                    onChooseAnotherTask={() => setQuickTasksOpen(true)}
                  />
                ) : null}
                {session.pendingConfirmation && session.pendingToolCall && !workflowState.pendingConfirmation ? (
                  <AgentConfirmationCard
                    busy={runtimeBusy}
                    title={session.pendingConfirmation.title}
                    description={session.pendingConfirmation.description}
                    onCancel={() => void confirmKernelAction(false)}
                    onConfirm={() => void confirmKernelAction(true)}
                  />
                ) : null}
              </AgentConversationTimeline>
            </>
          )}

          <AgentComposer
            disabled={runtimePaused}
            running={runtimeBusy}
            aiStatus={providerUnavailable ? "AI 不可用" : undefined}
            draft={composerDraft}
            onDraftChange={setComposerDraft}
            onSend={sendMessage}
            onUiAction={handleUiAction}
            onUpload={upload}
            onStop={() => abortRef.current?.abort()}
          />
        </section>
        <AgentArtifactDrawer
          artifacts={artifacts}
          state={drawerState}
          workflowState={workflowState}
          onStateChange={setDrawerState}
        />
      </div>

      <AgentHistoryDialog
        open={historyOpen}
        sessions={sessions}
        onClose={() => setHistoryOpen(false)}
        onSelect={restoreSession}
      />
      {switchChoice ? (
        <AgentWorkflowSwitchCard
          onPreserve={() => {
            void handleWorkflowControl({ ...switchChoice, preserveCurrent: true }).then(async (next) => {
              setSwitchChoice(undefined);
              setSession(next);
              await dependencies.store.save(next);
            });
          }}
          onContinue={() => setSwitchChoice(undefined)}
          onCancelAndSwitch={() => {
            void handleWorkflowControl({ ...switchChoice, preserveCurrent: false, type: "switch_workflow" }).then(async (next) => {
              setSwitchChoice(undefined);
              setSession(next);
              await dependencies.store.save(next);
            });
          }}
        />
      ) : null}
      <AgentFloatingAction
        action={floatingAction}
        resumes={resumes}
        onClose={() => setFloatingAction(undefined)}
        onSelectResume={(resume) => {
          setSelectedResume(resume.id);
          setFloatingAction(undefined);
          if (workflowActive) dependencies.controller.selectResume(resume.profileId, resume.id);
        }}
        onSubmitJob={(job) => {
          setJobTitle(job.title);
          setJobCompany(job.company);
          setJobText(job.rawText);
          setFloatingAction(undefined);
          void handleWorkflowControl({ type: "switch_workflow", workflowId: "job_ingestion", preserveCurrent: true }).then(async (next) => {
            setSession(next);
            await dependencies.store.save(next);
          });
        }}
        onWorkflowControl={(action) => {
          setFloatingAction(undefined);
          void handleWorkflowControl(action).then(async (next) => {
            setSession(next);
            await dependencies.store.save(next);
          });
        }}
        onSend={sendMessage}
      />
    </AgentWorkspaceLayout>
  );
}

function AgentWorkflowSwitchCard(props: {
  onPreserve(): void;
  onContinue(): void;
  onCancelAndSwitch(): void;
}) {
  return (
    <div className="agent-modal-backdrop" role="presentation">
      <section className="agent-floating-panel agent-switch-card" role="dialog" aria-modal="true" aria-labelledby="agent-switch-title">
        <header>
          <h2 id="agent-switch-title">切换任务</h2>
          <p>当前还有一个进行中的任务。你可以先暂存它，再录入岗位。</p>
        </header>
        <div className="agent-floating-actions">
          <button className="primary-button" type="button" onClick={props.onPreserve}>暂存当前任务并录入岗位</button>
          <button className="secondary-button" type="button" onClick={props.onContinue}>继续当前任务</button>
          <button className="danger-button" type="button" onClick={props.onCancelAndSwitch}>取消当前任务并切换</button>
        </div>
      </section>
    </div>
  );
}

function AgentFloatingAction(props: {
  action?: AgentUiAction;
  resumes: ResumeSummary[];
  onClose(): void;
  onSelectResume(resume: ResumeSummary): void;
  onSubmitJob(job: { title: string; company: string; rawText: string }): void;
  onWorkflowControl(action: AgentWorkflowControl): void;
  onSend(message: string): void;
}) {
  const [query, setQuery] = useState("");
  const [job, setJob] = useState({ title: "", company: "", rawText: "" });
  if (!props.action) return null;
  const filteredResumes = props.resumes.filter((resume) =>
    `${resume.name} ${resume.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <div className="agent-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="agent-floating-panel" role="dialog" aria-modal="true" aria-labelledby="agent-floating-title">
        <header>
          <h2 id="agent-floating-title">{floatingTitle(props.action)}</h2>
          <button type="button" className="icon-button" aria-label="关闭" onClick={props.onClose}>×</button>
        </header>
        {props.action.type === "open_resume_picker" ? (
          <div className="agent-picker-stack">
            <input aria-label="搜索简历" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索、筛选、最近使用" />
            <div className="agent-picker-list">
              {filteredResumes.map((resume) => (
                <button key={resume.id} type="button" onClick={() => props.onSelectResume(resume)}>
                  <strong>{resume.name || "未命名简历"}</strong>
                  <span>{resume.purpose} · v{resume.revision}</span>
                </button>
              ))}
              {!filteredResumes.length ? <p>暂无可选简历。</p> : null}
            </div>
          </div>
        ) : null}
        {props.action.type === "open_job_import_dialog" ? (
          <form className="agent-picker-stack" onSubmit={(event) => {
            event.preventDefault();
            props.onSubmitJob(job);
          }}>
            <input aria-label="岗位名称" value={job.title} onChange={(event) => setJob({ ...job, title: event.target.value })} placeholder="岗位名称" />
            <input aria-label="公司" value={job.company} onChange={(event) => setJob({ ...job, company: event.target.value })} placeholder="公司" />
            <textarea aria-label="岗位描述" value={job.rawText} onChange={(event) => setJob({ ...job, rawText: event.target.value })} placeholder="粘贴 JD 原文" />
            <div className="agent-floating-actions">
              <button className="secondary-button" type="button" onClick={props.onClose}>取消</button>
              <button className="primary-button" type="submit" disabled={!job.title.trim() || !job.company.trim() || job.rawText.trim().length < 20}>保存并进入岗位录入</button>
            </div>
          </form>
        ) : null}
        {props.action.type === "open_profile_browser" ? (
          <div className="agent-picker-stack">
            <p>资料库选择会保留事实边界。请选择人物、经历范围和事实后继续。</p>
            <button className="primary-button" type="button" onClick={() => props.onWorkflowControl({ type: "start_workflow", workflowId: "build_resume_from_profile" })}>从资料库组装简历</button>
          </div>
        ) : null}
        {props.action.type === "open_tool_palette" ? (
          <div className="agent-picker-list">
            {["选择简历", "导入岗位", "打开资料库", "导出简历"].map((item) => <button key={item} type="button" onClick={() => { props.onClose(); void props.onSend(item); }}>{item}</button>)}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function readArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return [];
  const found = (value as Record<string, unknown>)[key];
  return Array.isArray(found) ? found : [];
}

function appendLocalMessage(
  session: AgentSession,
  role: AgentMessage["role"],
  content: string,
  toolName?: string,
  overrides: Partial<AgentMessage> = {}
): AgentSession {
  const now = new Date().toISOString();
  const message: AgentMessage = {
    id: `agent-message-${crypto.randomUUID()}`,
    role,
    content,
    ...(toolName ? { toolName } : {}),
    createdAt: now,
    ...overrides,
    updatedAt: overrides.updatedAt ?? now
  };
  return {
    ...session,
    messages: [...session.messages, message].slice(-40),
    updatedAt: now
  };
}

function normalizeAssistantMessages(session: AgentSession, assistantText: string): AgentSession {
  const language = detectMessageLanguage(assistantText);
  return {
    ...session,
    messages: session.messages.map((message) => {
      if (message.role === "tool") {
        const activityState = String(message.metadata?.activityState ?? "");
        const status = activityState === "failed"
          ? "failed" as const
          : activityState === "running" || activityState === "waiting_confirmation"
            ? "pending" as const
            : "complete" as const;
        return { ...message, kind: "tool_status" as const, type: "tool_status" as const, status };
      }
      if (message.role !== "assistant" || message.kind === "error_status") return message;
      return {
        ...message,
        content: normalizeAgentMessageText(message.content),
        kind: message.kind ?? "text",
        type: message.type ?? "text",
        status: "complete" as const,
        streaming: false,
        language
      };
    })
  };
}

function appendActivityMessage(
  session: AgentSession,
  activity: Pick<AgentMessage, "id" | "content" | "toolName" | "operationId" | "status" | "metadata">
) {
  const now = new Date().toISOString();
  const message: AgentMessage = {
    id: activity.id,
    role: "tool",
    content: activity.content,
    kind: "tool_status",
    type: "tool_status",
    status: activity.status,
    toolName: activity.toolName,
    operationId: activity.operationId,
    metadata: activity.metadata,
    createdAt: now,
    updatedAt: now
  };
  return { ...session, messages: [...session.messages, message].slice(-40), updatedAt: now };
}

function upsertActivityMessage(
  session: AgentSession,
  activity: Pick<AgentMessage, "id" | "content" | "toolName" | "operationId" | "status" | "metadata">
) {
  const existing = session.messages.some((message) => message.id === activity.id);
  if (!existing) return appendActivityMessage(session, activity);
  const now = new Date().toISOString();
  return {
    ...session,
    messages: session.messages.map((message) =>
      message.id === activity.id
        ? { ...message, ...activity, kind: "tool_status" as const, type: "tool_status" as const, updatedAt: now }
        : message
    ),
    updatedAt: now
  };
}

function detectMessageLanguage(message: string): AgentMessage["language"] {
  if (/[\u4e00-\u9fff]/.test(message)) return "zh";
  if (/[a-z]/i.test(message)) return "en";
  return "unknown";
}

function replaceThinkingWithAssistant(
  session: AgentSession,
  thinkingMessageId: string | undefined,
  content: string,
  languageSource: string
): AgentSession {
  const now = new Date().toISOString();
  const text = normalizeAgentMessageText(content);
  const message: AgentMessage = {
    id: thinkingMessageId ?? `agent-message-${crypto.randomUUID()}`,
    role: "assistant",
    content: text,
    kind: "text",
    type: "text",
    status: "complete",
    streaming: false,
    language: detectMessageLanguage(text || languageSource),
    createdAt: now,
    updatedAt: now
  };
  const replaced = thinkingMessageId
    ? session.messages.map((item) => item.id === thinkingMessageId ? message : item)
    : [...session.messages, message];
  return { ...session, messages: replaced.slice(-40), updatedAt: now };
}

function isUiAction(action: unknown): action is AgentUiAction {
  return Boolean(action && typeof action === "object" && "type" in action && [
    "open_resume_picker",
    "open_job_import_dialog",
    "open_profile_browser",
    "open_tool_palette",
    "open_artifact"
  ].includes(String((action as { type?: unknown }).type)));
}

function isWorkflowControl(action: unknown): action is AgentWorkflowControl {
  return Boolean(action && typeof action === "object" && "type" in action && [
    "start_workflow",
    "switch_workflow",
    "pause_workflow",
    "resume_workflow",
    "cancel_workflow",
    "go_back"
  ].includes(String((action as { type?: unknown }).type)));
}

function isActiveWorkflow(session: AgentSession) {
  return ["running", "waiting_for_user", "waiting_for_confirmation", "paused"].includes(session.workflowState.status);
}

function workflowStartMessage(workflowId: string) {
  if (workflowId === "job_ingestion") return "已进入岗位录入。请补充岗位名称、公司和 JD 原文。";
  if (workflowId === "build_resume_from_profile") return "已进入从资料库组装简历。请选择人物、经历范围和确认事实。";
  if (workflowId === "resume_import") return "已进入简历导入。请上传或选择要解析的简历文件。";
  if (workflowId === tailorExistingResumeWorkflow.id) return "已进入优化已有简历。请先选择一份简历。";
  return "已切换到新的任务。";
}

function workflowTitle(workflowId: string) {
  const titles: Record<string, string> = {
    guided_profile_intake: "整理个人资料",
    resume_import: "导入简历",
    job_ingestion: "录入岗位",
    build_resume_from_profile: "从资料库组装简历",
    tailor_existing_resume: "优化已有简历",
    analyze_job_fit: "分析岗位匹配",
    repair_and_export_resume: "修复并导出简历"
  };
  return titles[workflowId] ?? "AI 求职任务";
}

function uiActionStatus(action: AgentUiAction) {
  if (action.type === "open_resume_picker") return "已打开简历选择窗口。";
  if (action.type === "open_job_import_dialog") return "已打开岗位录入窗口。";
  if (action.type === "open_profile_browser") return "已打开资料库选择窗口。";
  if (action.type === "open_tool_palette") return "已打开当前可用工具。";
  return "已打开任务产物。";
}

function finalAssistantText(session: AgentSession) {
  return [...session.messages].reverse().find((message) => message.role === "assistant")?.content ?? "";
}

function floatingTitle(action: AgentUiAction) {
  if (action.type === "open_resume_picker") return "选择简历";
  if (action.type === "open_job_import_dialog") return "导入岗位";
  if (action.type === "open_profile_browser") return "从资料库选择";
  if (action.type === "open_tool_palette") return "可用工具";
  return "任务产物";
}

export function upsertAgentErrorStatus(
  session: AgentSession,
  input: {
    userMessageId: string;
    errorCode: string;
    status: "failed" | "retrying" | "recovered";
    content: string;
  }
): AgentSession {
  const keyMatches = (message: AgentMessage) =>
    message.kind === "error_status"
    && message.userMessageId === input.userMessageId
    && message.errorCode === input.errorCode;
  const existingIndex = session.messages.findIndex(keyMatches);
  const now = new Date().toISOString();
  if (existingIndex >= 0) {
    return {
      ...session,
      messages: session.messages.map((message, index) => index === existingIndex
        ? { ...message, status: input.status, content: input.content, createdAt: now }
        : message),
      updatedAt: now
    };
  }
  return {
    ...session,
    messages: [...session.messages, {
      id: `agent-error-${crypto.randomUUID()}`,
      role: "assistant" as const,
      kind: "error_status" as const,
      status: input.status,
      errorCode: input.errorCode,
      userMessageId: input.userMessageId,
      content: input.content,
      createdAt: now
    }].slice(-40),
    updatedAt: now
  };
}

export function replaceErrorForRegenerate(session: AgentSession): AgentSession {
  const error = [...session.messages].reverse().find((item) => item.kind === "error_status");
  if (!error?.userMessageId) return session;
  return {
    ...session,
    messages: session.messages.filter((item) =>
      item.id !== error.id && item.id !== error.userMessageId
    ),
    updatedAt: new Date().toISOString()
  };
}

export function replaceLastAssistantForRegenerate(session: AgentSession): AgentSession {
  const error = [...session.messages].reverse().find((item) => item.kind === "error_status");
  if (error?.userMessageId) return replaceErrorForRegenerate(session);
  const index = session.messages.findLastIndex((item) =>
    item.role === "assistant"
    && item.kind !== "error_status"
    && item.kind !== "assistant_thinking"
    && item.kind !== "assistant_streaming"
  );
  if (index < 0) return session;
  return {
    ...session,
    messages: session.messages.filter((_, messageIndex) => messageIndex !== index),
    updatedAt: new Date().toISOString()
  };
}

function plannerErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code ?? "planner_provider_failed");
  }
  return "planner_provider_failed";
}

function plannerErrorMessage(code: string) {
  const messages: Record<string, string> = {
    planner_invalid_json: "AI 返回内容暂时无法处理。任务已保留，可重试。",
    planner_schema_mismatch: "AI 返回内容暂时无法用于下一步。任务已保留，可重试。",
    planner_unregistered_tool: "AI 请求了当前不可用的工具，已安全阻止。",
    planner_confirmation_boundary: "AI 请求越过确认边界，已安全阻止。",
    planner_provider_failed: "AI 服务暂时不可用。任务和已输入内容已保留。",
    planner_timeout: "AI 响应超时。任务和已输入内容已保留。"
  };
  return messages[code] ?? "AI 服务暂时不可用。任务和已输入内容已保留。";
}

function buildArtifactRefs(state: ReturnType<TailorExistingResumeWorkflowController["getSnapshot"]>, now: string) {
  const refs = [];
  if (state.jobGraph) refs.push({
    id: `artifact-job-${state.jobId ?? "pending-review"}`,
    kind: "job_semantic_review" as const,
    title: "岗位语义核对",
    entityType: "job" as const,
    entityId: state.jobId ?? "pending-job-review",
    ...(state.jobId ? { route: `/jobs?jobId=${encodeURIComponent(state.jobId)}` } : {}),
    status: "active" as const,
    createdAt: now,
    updatedAt: now
  });
  if (state.fitAnalysis && state.jobId) refs.push({
    id: `artifact-fit-${state.jobId}`,
    kind: "job_fit_overview" as const,
    title: "匹配概览",
    entityType: "job" as const,
    entityId: state.jobId,
    status: "active" as const,
    createdAt: now,
    updatedAt: now
  });
  if (state.tailoringSession) refs.push({
    id: `artifact-tailoring-${state.resumeId}`,
    kind: "tailoring_diff" as const,
    title: "Tailoring Diff",
    entityType: "tailoring_session" as const,
    entityId: state.resumeId ?? "pending",
    route: state.resumeId ? `/resume?branchId=${encodeURIComponent(state.resumeId)}` : undefined,
    status: "active" as const,
    createdAt: now,
    updatedAt: now
  });
  return refs;
}

function quickActionTitle(actionId: AgentQuickActionId) {
  const titles: Record<AgentQuickActionId, string> = {
    build_profile_from_scratch: "从零整理经历",
    import_existing_resume: "导入现有简历",
    tailor_resume_to_job: "生成岗位定制简历",
    build_resume_from_profile: "从资料库组装简历",
    analyze_job_fit: "分析岗位匹配度",
    repair_and_export_resume: "修复和导出简历"
  };
  return titles[actionId];
}

function quickActionWorkflowId(actionId: AgentQuickActionId) {
  const workflows: Record<AgentQuickActionId, string> = {
    build_profile_from_scratch: "guided_profile_intake",
    import_existing_resume: "resume_import",
    tailor_resume_to_job: tailorExistingResumeWorkflow.id,
    build_resume_from_profile: "build_resume_from_profile",
    analyze_job_fit: "analyze_job_fit",
    repair_and_export_resume: "repair_and_export_resume"
  };
  return workflows[actionId];
}

function workflowStatusLabel(status: AgentSession["workflowState"]["status"]) {
  const labels: Record<AgentSession["workflowState"]["status"], string> = {
    idle: "等待开始",
    running: "处理中…",
    waiting_for_user: "等待你的输入",
    waiting_for_confirmation: "等待确认",
    paused: "已暂停",
    completed: "已完成",
    failed: "需要处理"
  };
  return labels[status];
}
