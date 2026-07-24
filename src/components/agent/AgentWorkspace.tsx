"use client";

import { History, Pause, Play, RotateCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentRuntime, browserAgentPlanner } from "@/agent/runtime/agentRuntime";
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
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { useWorkspaceMode } from "@/components/layout/WorkspaceModeProvider";
import { ACTIVE_SESSION_KEY } from "@/components/agent/shell/AgentSidebar";
import {
  AgentArtifactDrawer,
  type AgentArtifactDrawerState
} from "./artifacts/AgentArtifactDrawer";
import { AgentComposer } from "./AgentComposer";
import { AgentConversationTimeline } from "./AgentConversation";
import { AgentHistoryDialog } from "./AgentHistoryDialog";
import { AgentZeroState } from "./workspace/AgentZeroState";
import { AgentWorkspaceLayout } from "./workspace/AgentWorkspaceLayout";
import { AgentWorkflowRenderer } from "./workspace/AgentWorkflowRenderer";

type ResumeSummary = { id: string; profileId: string; name: string; purpose: string; revision: number };
export function AgentWorkspace() {
  return <AgentWorkspaceController />;
}

export function AgentWorkspaceController() {
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
  const runtimeRef = useRef<AgentRuntime | undefined>(undefined);
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
    window.addEventListener("careeradapt-agent-revision-change", revisionChanged);
    return () => {
      window.removeEventListener("careeradapt-agent-session-select", selectSession);
      window.removeEventListener("careeradapt-agent-new-task", newTask);
      window.removeEventListener("careeradapt-agent-history-open", openHistory);
      window.removeEventListener("careeradapt-agent-revision-change", revisionChanged);
    };
  }, [dependencies.controller, dependencies.store, restoreSession, sessions]);

  useEffect(() => {
    if (!workflowActive) return;
    const now = new Date().toISOString();
    const artifactRefs = buildArtifactRefs(workflowState, now);
    const next: AgentSession = {
      ...session,
      activeProfileId: workflowState.profileId,
      activeResumeId: workflowState.resumeId,
      activeJobId: workflowState.jobId,
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
        content: "正在重新连接规划器，任务与已输入内容保持不变。"
      });
      setSession(currentSession);
      await dependencies.store.save(currentSession);
    }
    setRuntimeBusy(true);
    setLastUserMessage(message);
    setProviderUnavailable(false);
    const runtime = new AgentRuntime(currentSession, {
      planner: browserAgentPlanner,
      executor: dependencies.executor,
      persistence: dependencies.store,
      eventBus: dependencies.eventBus,
      toolManifest: dependencies.registry.manifest(),
      maxToolCalls: 12
    });
    runtimeRef.current = runtime;
    try {
      const next = await runtime.turn(message, {
        pathname: window.location.pathname,
        route: window.location.pathname,
        title: "AI 工作台",
        activeProfileId: workflowState.profileId,
        activeResumeId: workflowState.resumeId,
        activeJobId: workflowState.jobId,
        query: {}
      }, { appendUserMessage: !previousError });
      const recovered = previousError
        ? upsertAgentErrorStatus(next, {
          userMessageId: previousError.userMessageId!,
          errorCode: previousError.errorCode!,
          status: "recovered",
          content: "规划器已恢复，任务继续执行。"
        })
        : next;
      setSession(await dependencies.store.save(recovered));
      window.localStorage.setItem(ACTIVE_SESSION_KEY, next.id);
      window.dispatchEvent(new CustomEvent("careeradapt-agent-sessions-change"));
    } catch (error) {
      const snapshot = runtime.getSnapshot();
      const userMessageId = previousError?.userMessageId
        ?? [...snapshot.messages].reverse().find((item) => item.role === "user")?.id
        ?? `agent-user-${crypto.randomUUID()}`;
      const errorCode = plannerErrorCode(error);
      const fallback = upsertAgentErrorStatus(snapshot, {
        userMessageId,
        errorCode,
        status: "failed",
        content: plannerErrorMessage(errorCode)
      });
      setSession(await dependencies.store.save(fallback));
      setProviderUnavailable(true);
    } finally {
      runtimeRef.current = undefined;
      setRuntimeBusy(false);
    }
  }

  async function startQuickAction(actionId: AgentQuickActionId) {
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
    await sendMessage(quickIntent.intent, next);
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
                <button type="button" onClick={() => setQuickTasksOpen(true)}>快捷任务</button>
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
                  const prepared = replaceErrorForRegenerate(session);
                  setSession(prepared);
                  void dependencies.store.save(prepared);
                  void sendMessage(lastUserMessage, prepared);
                } : undefined}
                onOption={(value) => void sendMessage(value)}
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
              </AgentConversationTimeline>
            </>
          )}

          <AgentComposer
            disabled={runtimePaused}
            running={runtimeBusy}
            aiStatus={providerUnavailable ? "AI 不可用" : undefined}
            onSend={sendMessage}
            onUpload={upload}
            onStop={() => runtimeRef.current?.abort()}
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
    </AgentWorkspaceLayout>
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
  toolName?: string
): AgentSession {
  const now = new Date().toISOString();
  return {
    ...session,
    messages: [...session.messages, {
      id: `agent-message-${crypto.randomUUID()}`,
      role,
      content,
      ...(toolName ? { toolName } : {}),
      createdAt: now
    }].slice(-40),
    updatedAt: now
  };
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

function plannerErrorCode(error: unknown) {
  if (typeof error === "object" && error && "code" in error) {
    return String((error as { code?: unknown }).code ?? "planner_provider_failed");
  }
  return "planner_provider_failed";
}

function plannerErrorMessage(code: string) {
  const messages: Record<string, string> = {
    planner_invalid_json: "规划器返回的 JSON 无法解析。任务已保留，可重试。",
    planner_schema_mismatch: "规划器输出结构仍不受支持。任务已保留，可重试。",
    planner_unregistered_tool: "规划器请求了未注册工具，已安全阻止。",
    planner_confirmation_boundary: "规划器尝试越过确认边界，已安全阻止。",
    planner_provider_failed: "AI 服务暂时不可用。任务和已输入内容已保留。",
    planner_timeout: "规划器响应超时。任务和已输入内容已保留。"
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
