"use client";

import { History, Pause, Play, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { AgentMessage, AgentMessageReference, AgentSession } from "@/agent/contracts/agentSession";
import type { AgentArtifactAction, AgentUiAction } from "@/agent/contracts/agentActions";
import { createQuickActionIntent, type AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import { useAgentHost } from "@/components/agent/runtime/AgentRuntimeProvider";
import {
  ACTIVE_SESSION_KEY,
  NEW_TASK_SESSION_VALUE
} from "@/components/agent/shell/AgentSidebar";
import { AgentArtifactDrawer, type AgentArtifactDrawerState } from "./artifacts/AgentArtifactDrawer";
import { AgentComposer } from "./AgentComposer";
import { AgentConversationTimeline, normalizeAgentMessageText } from "./AgentConversation";
import { AgentHistoryDialog } from "./AgentHistoryDialog";
import { AgentZeroState } from "./workspace/AgentZeroState";
import { AgentWorkspaceLayout } from "./workspace/AgentWorkspaceLayout";

type ResumeSummary = { id: string; profileId: string; name: string; purpose: string; revision: number };
type SessionComposerDrafts = Record<string, string>;

const AGENT_COMPOSER_DRAFTS_KEY = "careerad-agent-composer-drafts:v1";

export function AgentWorkspace() {
  const host = useAgentHost();
  const snapshot = useSyncExternalStore(host.state.subscribe, host.state.getSnapshot, host.state.getSnapshot);
  const [session, setSession] = useState<AgentSession>(() =>
    snapshot.activeSession ?? AgentRuntime.create("agent_quick_action", "collecting_intent", "AI 求职任务")
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [resumes, setResumes] = useState<ResumeSummary[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drawerState, setDrawerState] = useState<AgentArtifactDrawerState>("closed");
  const [draftsBySession, setDraftsBySession] = useState<SessionComposerDrafts>(readSessionComposerDrafts);
  const draftsBySessionRef = useRef(draftsBySession);
  const [draftReferencesBySession, setDraftReferencesBySession] = useState<Record<string, AgentMessageReference | undefined>>({});
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [floatingAction, setFloatingAction] = useState<AgentUiAction>();
  const initialSessionRef = useRef(session);
  const running = snapshot.turnStatus === "running";
  const paused = snapshot.turnStatus === "paused";
  const draft = draftsBySession[session.id] ?? "";
  const draftReference = draftReferencesBySession[session.id];

  const setSessionDraft = useCallback((value: string) => {
    const next = { ...draftsBySessionRef.current };
    if (value) next[session.id] = value;
    else delete next[session.id];
    draftsBySessionRef.current = next;
    setDraftsBySession(next);
    persistSessionComposerDrafts(next);
  }, [session.id]);

  const setSessionDraftReference = useCallback((reference?: AgentMessageReference) => {
    setDraftReferencesBySession((current) => {
      const next = { ...current };
      if (reference) next[session.id] = reference;
      else delete next[session.id];
      return next;
    });
  }, [session.id]);

  const pageContext = useCallback(() => ({
    pathname: window.location.pathname,
    route: window.location.pathname,
    title: "AI 工作台",
    activeProfileId: session.activeProfileId,
    activeResumeId: session.activeResumeId,
    activeJobId: session.activeJobId,
    query: {}
  }), [session.activeJobId, session.activeProfileId, session.activeResumeId]);

  useEffect(() => host.state.subscribe(() => {
    const current = host.state.getSnapshot();
    if (current.activeSession) setSession(current.activeSession);
    if (current.uiAction) {
      if (current.uiAction.type === "open_artifact") setDrawerState("open");
      else setFloatingAction(current.uiAction);
      host.state.clearUiAction();
    }
  }), [host.state]);

  const restoreSession = useCallback((selected: AgentSession) => {
    host.state.adopt(selected);
    setSession(selected);
    setHistoryOpen(false);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, selected.id);
  }, [host.state]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      host.executor.execute({
        toolName: "list_resumes",
        toolInput: {},
        operationId: `list-resumes-${crypto.randomUUID()}`
      }),
      host.store.list()
    ]).then(([resumeResult, storedSessions]) => {
      if (!active) return;
      setResumes(readArray(resumeResult.data, "resumes") as ResumeSummary[]);
      setSessions(storedSessions);
      const live = host.state.getSnapshot();
      if (live.activeSession && live.turnStatus === "running") {
        setSession(live.activeSession);
        window.localStorage.setItem(ACTIVE_SESSION_KEY, live.activeSession.id);
        return;
      }
      const requested = window.localStorage.getItem(ACTIVE_SESSION_KEY);
      if (requested === NEW_TASK_SESSION_VALUE) {
        const created = AgentRuntime.create("agent_quick_action", "collecting_intent", "新的 AI 任务");
        host.state.adopt(created);
        setSession(created);
        return;
      }
      const restored = storedSessions.find((item) => item.id === requested) ?? storedSessions[0];
      if (restored) restoreSession(restored);
      else host.state.adopt(initialSessionRef.current);
    });
    return () => { active = false; };
  }, [host.executor, host.state, host.store, restoreSession]);

  useEffect(() => {
    const selectSession = (event: Event) => {
      const id = (event as CustomEvent<{ sessionId?: string }>).detail?.sessionId;
      const selected = sessions.find((item) => item.id === id);
      if (selected) restoreSession(selected);
    };
    const newTask = () => {
      const created = AgentRuntime.create("agent_quick_action", "collecting_intent", "新的 AI 任务");
      host.state.adopt(created);
      setSession(created);
      setDrawerState("closed");
      window.localStorage.setItem(ACTIVE_SESSION_KEY, NEW_TASK_SESSION_VALUE);
    };
    const openHistory = () => void host.store.list().then((items) => {
      setSessions(items);
      setHistoryOpen(true);
    });
    window.addEventListener("careeradapt-agent-session-select", selectSession);
    window.addEventListener("careeradapt-agent-new-task", newTask);
    window.addEventListener("careeradapt-agent-history-open", openHistory);
    return () => {
      window.removeEventListener("careeradapt-agent-session-select", selectSession);
      window.removeEventListener("careeradapt-agent-new-task", newTask);
      window.removeEventListener("careeradapt-agent-history-open", openHistory);
    };
  }, [host.state, host.store, restoreSession, sessions]);

  async function dispatchMessage(text: string) {
    setLastUserMessage(text);
    window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
    const result = await host.state.dispatch(
      { type: "message", text, references: draftReference ? [draftReference] : undefined },
      { session, pageContext: pageContext() }
    );
    if (result) {
      setSessionDraftReference(undefined);
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    }
  }

  function dispatchUi(action: AgentUiAction) {
    void host.state.dispatch(
      { type: "ui_control", action },
      { session, pageContext: pageContext() }
    );
  }

  function dispatchArtifactAction(action: AgentArtifactAction) {
    void host.state.dispatch(
      { type: "artifact_action", action },
      { session, pageContext: pageContext() }
    ).then((result) => {
      if (!result) return;
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    });
  }

  function dispatchQuickAction(actionId: AgentQuickActionId) {
    const intent = createQuickActionIntent(actionId);
    setLastUserMessage(intent.intent);
    void host.state.dispatch(
      {
        type: "quick_action",
        actionId: intent.actionId,
        text: intent.intent,
        task: intent.task
      },
      { session, pageContext: pageContext() }
    ).then((result) => {
      if (!result) return;
      setSession(result);
      window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    });
  }

  const workflowView = useMemo(() => taskToWorkflowView(session), [session]);
  const artifacts = snapshot.activeSessionId === session.id ? snapshot.artifacts : session.artifactRefs;
  const showZeroState = session.messages.length === 0 && !running;

  return (
    <AgentWorkspaceLayout
      sessionTitle={session.title}
      status={statusLabel(snapshot.turnStatus)}
      artifactCount={artifacts.length}
      onOpenArtifacts={() => setDrawerState("open")}
      onOpenHistory={() => setHistoryOpen(true)}
    >
      <div className={`agent-workspace-body is-drawer-${drawerState}`}>
        <section className="agent-conversation-panel">
          {showZeroState ? (
            <AgentZeroState onSelect={dispatchQuickAction} />
          ) : (
            <>
              <div className="agent-conversation-toolbar">
                {snapshot.turnStatus === "failed" ? <span><WifiOff aria-hidden="true" />任务已中断，可重试</span> : null}
                <button
                  type="button"
                  onClick={() => {
                    const messages = session.messages.filter((m) => m.role !== "system");
                    if (!messages.length) return;
                    const blob = new Blob([JSON.stringify(messages, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `ai-conversation-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  导出对话
                </button>
                <button
                  type="button"
                  onClick={() => void host.state.dispatch(
                    { type: "ui_control", action: { type: paused ? "resume_workflow" : "pause_workflow", workflowId: session.workflowState.workflowId } },
                    { session, pageContext: pageContext() }
                  )}
                >
                  {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
                  {paused ? "继续任务" : "暂停任务"}
                </button>
                <button type="button" onClick={() => setHistoryOpen(true)}>
                  <History aria-hidden="true" />历史
                </button>
              </div>
              {snapshot.stalled ? (
                <div className="agent-stall-watchdog" role="status">
                  <span>这一步响应时间较长</span>
                  <div>
                    <button type="button" onClick={() => host.state.continueWaiting()}>继续等待</button>
                    <button type="button" onClick={() => host.state.interrupt()}>停止任务</button>
                    <button
                      type="button"
                      disabled={!lastUserMessage || Boolean(session.pendingConfirmation)}
                      onClick={() => void dispatchMessage(lastUserMessage)}
                    >
                      重试
                    </button>
                  </div>
                </div>
              ) : null}
              <AgentConversationTimeline
                key={session.id}
                messages={session.messages}
                onRegenerate={async (message) => {
                  const result = await host.state.dispatch(
                    { type: "regenerate_message", messageId: message.id },
                    { session, pageContext: pageContext() }
                  );
                  if (!result) return;
                  setSession(result);
                  window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
                  window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
                }}
                onEditUserMessage={async (message, content) => {
                  setLastUserMessage(content);
                  const result = await host.state.dispatch(
                    { type: "edit_message", messageId: message.id, text: content },
                    { session, pageContext: pageContext() }
                  );
                  if (!result) return;
                  setSession(result);
                  window.localStorage.setItem(ACTIVE_SESSION_KEY, result.id);
                  window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
                }}
                onContinueFromMessage={(message) => {
                  setSessionDraft("");
                  setSessionDraftReference({
                    messageId: message.id,
                    role: message.role,
                    type: "assistant_message",
                    excerpt: referenceExcerpt(normalizeAgentMessageText(message.content))
                  });
                }}
                onCopyMessage={(message) => void navigator.clipboard?.writeText(normalizeAgentMessageText(message.content))}
                onOption={(option) => void host.state.dispatch(
                  { type: "option", action: option.action },
                  { session, pageContext: pageContext() }
                )}
                confirmation={session.pendingToolCall ? session.pendingConfirmation : undefined}
                confirmationBusy={running}
                onConfirmation={(confirmed) => void host.state.dispatch(
                  { type: "confirmation", confirmed },
                  { session, pageContext: pageContext() }
                )}
              />
            </>
          )}
          <AgentComposer
            disabled={paused}
            running={running}
            draft={draft}
            reference={draftReference}
            onRemoveReference={() => setSessionDraftReference(undefined)}
            onDraftChange={setSessionDraft}
            onSend={dispatchMessage}
            onUiAction={dispatchUi}
            onUpload={async (file) => {
              await host.state.dispatch({ type: "file", file }, { session, pageContext: pageContext() });
              return "ready" as const;
            }}
            onStop={() => host.state.interrupt()}
          />
        </section>
        <AgentArtifactDrawer
          artifacts={artifacts}
          state={drawerState}
          workflowState={workflowView}
          taskState={session.taskState}
          onImportAction={(message) => void dispatchMessage(message)}
          onArtifactAction={dispatchArtifactAction}
          onStateChange={setDrawerState}
        />
      </div>
      <AgentHistoryDialog
        open={historyOpen}
        sessions={sessions}
        onClose={() => setHistoryOpen(false)}
        onSelect={restoreSession}
      />
      <AgentFloatingAction
        action={floatingAction}
        resumes={resumes}
        onClose={() => setFloatingAction(undefined)}
        onSend={(message) => {
          setFloatingAction(undefined);
          void dispatchMessage(message);
        }}
      />
    </AgentWorkspaceLayout>
  );
}

export function readSessionComposerDrafts(): SessionComposerDrafts {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(AGENT_COMPOSER_DRAFTS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] =>
          Boolean(entry[0]) && typeof entry[1] === "string" && entry[1].length <= 8000
        )
        .slice(-100)
    );
  } catch {
    return {};
  }
}

function persistSessionComposerDrafts(drafts: SessionComposerDrafts) {
  try {
    window.localStorage.setItem(AGENT_COMPOSER_DRAFTS_KEY, JSON.stringify(drafts));
  } catch {
    // Draft persistence is best-effort; the in-memory per-session draft remains.
  }
}

function referenceExcerpt(content: string) {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 117)}…` : compact;
}

function AgentFloatingAction(props: {
  action?: AgentUiAction;
  resumes: ResumeSummary[];
  onClose(): void;
  onSend(message: string): void;
}) {
  const [query, setQuery] = useState("");
  const [job, setJob] = useState({ title: "", company: "", rawText: "" });
  if (!props.action) return null;
  const filtered = props.resumes.filter((resume) =>
    `${resume.name} ${resume.purpose}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <div className="agent-modal-backdrop" role="presentation">
      <section className="agent-floating-panel" role="dialog" aria-modal="true" aria-label={floatingTitle(props.action)}>
        <header>
          <h2>{floatingTitle(props.action)}</h2>
          <button type="button" aria-label="关闭" onClick={props.onClose}>×</button>
        </header>
        {props.action.type === "open_resume_picker" ? (
          <div className="agent-picker-stack">
            <input aria-label="搜索简历" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="agent-picker-list">
              {filtered.map((resume) => (
                <button key={resume.id} type="button" onClick={() => props.onSend(`使用简历“${resume.name}”（ID: ${resume.id}）继续当前任务`)}>
                  <strong>{resume.name || "未命名简历"}</strong>
                  <span>{resume.purpose} · v{resume.revision}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {props.action.type === "open_job_import_dialog" ? (
          <form className="agent-picker-stack" onSubmit={(event) => {
            event.preventDefault();
            props.onSend(`录入岗位：${job.title}\n公司：${job.company}\n${job.rawText}`);
          }}>
            <input aria-label="岗位名称" placeholder="例如：高级产品经理" value={job.title} onChange={(event) => setJob({ ...job, title: event.target.value })} />
            <input aria-label="公司" placeholder="例如：CareerAdapt AI" value={job.company} onChange={(event) => setJob({ ...job, company: event.target.value })} />
            <textarea aria-label="岗位描述" placeholder="粘贴完整岗位描述，AI 会提取职责与要求…" value={job.rawText} onChange={(event) => setJob({ ...job, rawText: event.target.value })} />
            <button className="primary-button" type="submit" disabled={!job.title.trim() || !job.company.trim() || job.rawText.trim().length < 20}>
              交给 AI 处理
            </button>
          </form>
        ) : null}
        {props.action.type === "open_profile_browser" ? (
          <button className="primary-button" type="button" onClick={() => props.onSend("打开资料库并基于已确认资料继续当前任务")}>打开资料库</button>
        ) : null}
        {props.action.type === "open_tool_palette" ? (
          <div className="agent-picker-list">
            {["选择简历", "打开岗位录入窗口", "打开资料库", "导出简历"].map((label) => (
              <button key={label} type="button" onClick={() => props.onSend(label)}>{label}</button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function taskToWorkflowView(session: AgentSession): TailorWorkflowViewState {
  const task = session.taskState;
  const slots = task?.knownSlots ?? {};
  const allowedSteps = new Set([
    "select_resume", "collect_job", "analyze_job", "review_job", "analyze_fit",
    "generate_plan", "answer_questions", "preview_changes", "confirm_apply", "completed"
  ]);
  const stage = task?.stage === "clarify_unsupported_facts"
    ? "answer_questions"
    : task?.stage === "quality_result"
      ? "completed"
      : task?.stage;
  return {
    step: allowedSteps.has(stage ?? "") ? stage as TailorWorkflowViewState["step"] : "select_resume",
    busy: session.activeTurn?.status === "running",
    profileId: task?.selectedEntities.profileId,
    resumeId: task?.selectedEntities.resumeId,
    jobId: task?.selectedEntities.jobId,
    jobGraph: slots.graph,
    fitAnalysis: slots.fitAnalysis,
    tailoringSession: slots.tailoringSession,
    diffs: Array.isArray(slots.selectedDiffs) ? slots.selectedDiffs : [],
    confirmedRequirementIds: Array.isArray(slots.confirmedRequirementIds)
      ? slots.confirmedRequirementIds.filter((id): id is string => typeof id === "string")
      : [],
    pendingConfirmation: session.pendingToolCall?.toolName as TailorWorkflowViewState["pendingConfirmation"],
    appliedRevisionId: task?.selectedEntities.revisionId
  };
}

function readArray(value: unknown, key: string) {
  if (!value || typeof value !== "object") return [];
  const found = (value as Record<string, unknown>)[key];
  return Array.isArray(found) ? found : [];
}

function floatingTitle(action: AgentUiAction) {
  if (action.type === "open_resume_picker") return "选择简历";
  if (action.type === "open_job_import_dialog") return "导入岗位";
  if (action.type === "open_profile_browser") return "资料库";
  if (action.type === "open_tool_palette") return "可用工具";
  return "任务产物";
}

function statusLabel(status: ReturnType<ReturnType<typeof useAgentHost>["state"]["getSnapshot"]>["turnStatus"]) {
  const labels = {
    idle: "等待开始",
    running: "处理中…",
    paused: "已暂停",
    waiting_for_confirmation: "等待确认",
    completed: "已完成",
    failed: "需要处理"
  };
  return labels[status];
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
  const now = new Date().toISOString();
  const existing = session.messages.findIndex((message) =>
    message.kind === "error_status"
    && message.userMessageId === input.userMessageId
    && message.errorCode === input.errorCode
  );
  const errorMessage: AgentMessage = {
    id: existing >= 0 ? session.messages[existing].id : `agent-error-${crypto.randomUUID()}`,
    role: "assistant",
    kind: "error_status",
    type: "error",
    status: input.status,
    errorCode: input.errorCode,
    userMessageId: input.userMessageId,
    content: input.content,
    createdAt: existing >= 0 ? session.messages[existing].createdAt : now,
    updatedAt: now
  };
  return {
    ...session,
    messages: existing >= 0
      ? session.messages.map((message, index) => index === existing ? errorMessage : message)
      : [...session.messages, errorMessage],
    updatedAt: now
  };
}

export function replaceErrorForRegenerate(session: AgentSession): AgentSession {
  const error = [...session.messages].reverse().find((message) => message.kind === "error_status");
  if (!error?.userMessageId) return session;
  return {
    ...session,
    messages: session.messages.filter((message) => message.id !== error.id && message.id !== error.userMessageId),
    updatedAt: new Date().toISOString()
  };
}
