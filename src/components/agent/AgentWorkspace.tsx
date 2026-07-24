"use client";

import { ArrowLeft, History, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AgentRuntime, browserAgentPlanner } from "@/agent/runtime/agentRuntime";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { createAgentToolRegistry } from "@/agent/tools/registry";
import {
  TailorExistingResumeWorkflowController,
  tailorExistingResumeWorkflow
} from "@/agent/workflows/tailorExistingResumeWorkflow";
import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { AgentArtifactPanel } from "./AgentArtifactPanel";
import { AgentComposer } from "./AgentComposer";
import { AgentConfirmationCard } from "./AgentConfirmationCard";
import { AgentConversation } from "./AgentConversation";
import { AgentHistoryDialog } from "./AgentHistoryDialog";
import { AgentProgressTimeline } from "./AgentProgressTimeline";
import { AgentQuickStartCards } from "./AgentQuickStartCards";

type ResumeSummary = { id: string; profileId: string; name: string; purpose: string; revision: number };
export function AgentWorkspace() {
  const router = useRouter();
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
  const [selectedResume, setSelectedResume] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [jobCompany, setJobCompany] = useState("");
  const [jobText, setJobText] = useState("");
  const [answer, setAnswer] = useState("");

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
      if (storedSessions[0]) {
        const restored = storedSessions[0];
        setSession(restored);
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

  async function sendMessage(message: string) {
    setRuntimeBusy(true);
    const runtime = new AgentRuntime(session, {
      planner: browserAgentPlanner,
      executor: dependencies.executor,
      persistence: dependencies.store,
      eventBus: dependencies.eventBus,
      toolManifest: dependencies.registry.manifest(),
      maxToolCalls: 12
    });
    try {
      const next = await runtime.turn(message, {
        pathname: "/ai-workspace",
        title: "AI 工作台",
        activeProfileId: workflowState.profileId,
        activeResumeId: workflowState.resumeId,
        activeJobId: workflowState.jobId,
        query: {}
      });
      setSession(next);
    } catch (error) {
      const fallback = appendLocalMessage(session, "assistant", error instanceof Error ? `暂时无法连接规划器：${error.message}` : "暂时无法连接规划器。");
      setSession(await dependencies.store.save(fallback));
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function upload(file: File) {
    if (file.type === "application/pdf") {
      router.push("/resume?import=pdf");
      return;
    }
    const text = await file.text();
    await sendMessage(`我上传了文件“${file.name}”，共 ${text.length} 个字符。请先确认要执行的任务。`);
  }

  const pending = workflowState.pendingConfirmation;
  const firstQuestion = firstClarification(workflowState.tailoringSession);

  return (
    <main className="agent-workspace">
      <header className="agent-workspace-header">
        <div>
          <p className="eyebrow">统一工具编排</p>
          <h1>AI 工作台</h1>
          <p>让 AI 调用现有业务能力；每次写入前由你确认。</p>
        </div>
        <div className="agent-header-actions">
          <span className={`agent-status agent-status-${workflowState.busy ? "running" : workflowState.step === "completed" ? "complete" : "idle"}`}>
            {workflowState.busy ? "处理中…" : workflowState.step === "completed" ? "已完成" : "等待操作"}
          </span>
          <button
            className="secondary-button compact"
            type="button"
            onClick={() => setRuntimePaused((value) => !value)}
          >
            {runtimePaused ? <Play aria-hidden="true" size={16} /> : <Pause aria-hidden="true" size={16} />}
            {runtimePaused ? "恢复" : "暂停"}
          </button>
          <button className="secondary-button compact" type="button" onClick={async () => {
            setSessions(await dependencies.store.list());
            setHistoryOpen(true);
          }}>
            <History aria-hidden="true" size={16} /> 历史记录
          </button>
        </div>
      </header>

      <div className="agent-workspace-grid">
        <section className="agent-main-column">
          {!workflowActive ? (
            <AgentQuickStartCards onSelect={(id) => {
              if (id === "from-profile") {
                router.push("/jobs?source=profile");
                return;
              }
              setWorkflowActive(true);
            }} />
          ) : (
            <section className="agent-task-panel" aria-labelledby="agent-task-title" data-workflow-step={workflowState.step}>
              <div className="agent-section-heading">
                <div>
                  <button className="agent-back-button" type="button" onClick={() => setWorkflowActive(false)}>
                    <ArrowLeft size={16} aria-hidden="true" />
                    <span>返回</span>
                  </button>
                  <p className="eyebrow">当前任务</p>
                  <h2 id="agent-task-title">已有简历适配目标岗位</h2>
                </div>
              </div>
              <AgentProgressTimeline currentStep={workflowState.step} />

              {workflowState.step === "select_resume" ? (
                <form className="agent-task-form" onSubmit={(event) => {
                  event.preventDefault();
                  const resume = resumes.find((item) => item.id === selectedResume);
                  if (resume) dependencies.controller.selectResume(resume.profileId, resume.id);
                }}>
                  <label htmlFor="agent-resume-select">选择已有简历</label>
                  <select id="agent-resume-select" name="resumeId" value={selectedResume} onChange={(event) => setSelectedResume(event.target.value)}>
                    <option value="">请选择…</option>
                    {resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name} · v{resume.revision}</option>)}
                  </select>
                  {resumes.length === 0 ? <p className="agent-inline-note">还没有可用简历，请先在“我的简历”中创建或导入。</p> : null}
                  <button className="primary-button" type="submit" disabled={!selectedResume}>使用这份简历</button>
                </form>
              ) : null}

              {workflowState.step === "collect_job" ? (
                <form className="agent-task-form" onSubmit={(event) => {
                  event.preventDefault();
                  void dependencies.controller.parseJob({ title: jobTitle, company: jobCompany, rawText: jobText });
                }}>
                  <div className="agent-inline-fields">
                    <label>岗位名称<input name="jobTitle" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} autoComplete="off" placeholder="例如：高级产品经理…" /></label>
                    <label>公司<input name="jobCompany" value={jobCompany} onChange={(event) => setJobCompany(event.target.value)} autoComplete="organization" placeholder="例如：目标公司…" /></label>
                  </div>
                  <label htmlFor="agent-jd-input">岗位描述</label>
                  <textarea id="agent-jd-input" name="jobDescription" rows={9} value={jobText} onChange={(event) => setJobText(event.target.value)} placeholder="粘贴完整 JD，系统会保留来源并生成语义核对结果…" />
                  <button className="primary-button" type="submit" disabled={workflowState.busy || jobTitle.trim().length === 0 || jobCompany.trim().length === 0 || jobText.trim().length < 20}>
                    {workflowState.busy ? "解析中…" : "解析岗位"}
                  </button>
                </form>
              ) : null}

              {workflowState.step === "analyze_fit" && !pending ? (
                <div className="agent-next-action">
                  <p>岗位已保存。下一步会只读分析匹配情况，并生成安全改写建议。</p>
                  <button className="primary-button" type="button" disabled={workflowState.busy} onClick={() => void dependencies.controller.analyzeFitAndPlan()}>
                    分析匹配并生成建议
                  </button>
                </div>
              ) : null}

              {workflowState.step === "answer_questions" && firstQuestion ? (
                <form className="agent-task-form" onSubmit={(event) => {
                  event.preventDefault();
                  dependencies.controller.requestAnswer(firstQuestion.id, answer);
                }}>
                  <label htmlFor="agent-question-answer">{firstQuestion.question}</label>
                  <textarea id="agent-question-answer" name="tailoringAnswer" rows={4} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="只填写你能确认的真实经历或能力…" />
                  <button className="primary-button" type="submit" disabled={!answer.trim()}>提交回答</button>
                </form>
              ) : null}

              {workflowState.step === "preview_changes" && !pending ? (
                <div className="agent-next-action">
                  <p>修改差异已显示在右侧。预览会再次执行本地字段与事实边界校验。</p>
                  <button className="primary-button" type="button" disabled={workflowState.busy || workflowState.diffs.length === 0} onClick={() => void dependencies.controller.preview()}>
                    预览将应用的修改
                  </button>
                </div>
              ) : null}

              {workflowState.error ? <p className="agent-error" role="alert">{workflowState.error}</p> : null}
              {pending ? (
                <AgentConfirmationCard
                  busy={workflowState.busy}
                  title={confirmationCopy(pending).title}
                  description={confirmationCopy(pending).description}
                  onCancel={() => void dependencies.controller.confirmPending(false)}
                  onConfirm={() => void dependencies.controller.confirmPending(true)}
                />
              ) : null}
            </section>
          )}
          <AgentConversation messages={session.messages} />
          <AgentComposer disabled={runtimeBusy || runtimePaused} onSend={sendMessage} onUpload={upload} />
        </section>
        <AgentArtifactPanel state={workflowState} />
      </div>

      <AgentHistoryDialog
        open={historyOpen}
        sessions={sessions}
        onClose={() => setHistoryOpen(false)}
        onSelect={(selected) => {
          setSession(selected);
          setHistoryOpen(false);
          if (selected.workflowState.workflowId === tailorExistingResumeWorkflow.id) setWorkflowActive(true);
        }}
      />
    </main>
  );
}

function readArray(value: unknown, key: string) {
  if (typeof value !== "object" || value === null) return [];
  const found = (value as Record<string, unknown>)[key];
  return Array.isArray(found) ? found : [];
}

function appendLocalMessage(session: AgentSession, role: AgentMessage["role"], content: string): AgentSession {
  const now = new Date().toISOString();
  return {
    ...session,
    messages: [...session.messages, { id: `agent-message-${crypto.randomUUID()}`, role, content, createdAt: now }].slice(-40),
    updatedAt: now
  };
}

function firstClarification(session: unknown) {
  if (typeof session !== "object" || session === null) return undefined;
  const plan = (session as Record<string, unknown>).plan;
  if (typeof plan !== "object" || plan === null) return undefined;
  const questions = (plan as Record<string, unknown>).clarificationQuestions;
  if (!Array.isArray(questions) || !questions[0] || typeof questions[0] !== "object") return undefined;
  const question = questions[0] as Record<string, unknown>;
  return { id: String(question.id), question: String(question.question) };
}

function confirmationCopy(name: NonNullable<ReturnType<TailorExistingResumeWorkflowController["getSnapshot"]>["pendingConfirmation"]>) {
  const copy = {
    commit_job: { title: "保存这个岗位？", description: "确认后会把核对结果写入岗位库。你仍可在岗位页继续编辑。" },
    answer_tailoring_question: { title: "使用这项补充信息？", description: "这属于你主动声明的能力信息。确认后只用于当前岗位定制，不会隐式写回个人资料库。" },
    apply_tailoring_changes: { title: "应用这些简历修改？", description: "确认后会创建一个新的 ResumeRevision；来源简历和个人资料库不会被覆盖。" }
  };
  return copy[name];
}

function buildArtifactRefs(state: ReturnType<TailorExistingResumeWorkflowController["getSnapshot"]>, now: string) {
  const refs = [];
  if (state.jobGraph && state.jobId) refs.push({
    id: `artifact-job-${state.jobId}`,
    kind: "job_semantic_review" as const,
    title: "岗位语义核对",
    entityType: "job" as const,
    entityId: state.jobId,
    route: `/jobs?jobId=${encodeURIComponent(state.jobId)}`,
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
