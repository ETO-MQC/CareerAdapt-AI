"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, CircleMinus, LoaderCircle } from "lucide-react";
import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import type { BusinessWorkflowProgress } from "@/agent/runtime/businessWorkflowProgress";

/** Read-only presentation inputs; this component never decides whether a write succeeded. */
export const AgentActivityContext = createContext<{
  messages: AgentMessage[];
  progress?: BusinessWorkflowProgress;
  session?: Pick<AgentSession, "activeTurn" | "turnCheckpoints" | "hermesRun">;
}>({ messages: [] });

const toolLabels: Record<string, string> = {
  "career.workflow.job_intake": "整理岗位信息并核对保存结果",
  "career.workflow.job_fit": "分析岗位要求与已有经历",
  "career.workflow.material_intake": "读取并整理材料",
  "career.workflow.profile_intake_turn": "整理个人经历",
  "career.workflow.profile_intake_finalize": "准备资料审核",
  "career.workflow.precise_edit": "准备所选字段的修改",
  "career.workflow.tailor_resume": "准备岗位简历优化",
  "career.workflow.compose_resume": "生成通用简历提案",
  "career.workflow.profile_to_resume": "整理简历内容",
  "career.workflow.resume_export": "准备预览或导出",
  parse_job_description: "分析岗位要求",
  commit_job: "保存岗位",
  list_jobs: "检查是否已有相同岗位",
  get_job: "读取岗位信息",
  get_active_profile: "读取资料库",
  list_profiles: "读取资料库",
  get_profile: "读取资料库",
  get_agent_task_context: "读取当前任务进度",
  "career.system.current_task": "读取当前任务进度",
  "career.system.runtime_status": "检查服务状态",
  "career.system.last_failure": "核对上一步处理结果",
  "career.material.prepare": "准备材料审核",
  "career.context.retrieve": "读取相关经历与岗位信息",
  "career.profile.list": "读取资料库",
  "career.profile.active": "读取资料库",
  "career.profile.get": "读取资料库",
  "career.profile.search_facts": "查找相关经历",
  "career.profile.commit_intake": "保存已确认的资料",
  "career.profile.reconcile_intake": "核对资料差异",
  "career.profile.review_intake": "准备资料审核",
  "career.profile.capture_intake": "整理个人经历",
  "career.profile.synthesize_intake": "整理个人经历",
  "career.profile.resolve_intake_conflict": "核对资料冲突",
  "career.resume.list": "读取简历列表",
  "career.resume.get": "读取简历内容",
  "career.resume.get_revision": "读取简历版本",
  "career.resume.prepare_precise_edit": "准备所选字段的修改",
  "career.resume.apply_precise_edit": "保存已确认的修改",
  "career.job.list": "检查是否已有相同岗位",
  "career.job.get": "读取岗位信息",
  "career.job.parse": "分析岗位要求",
  "career.job.commit": "保存岗位",
  "career.job.analyze_fit": "分析岗位匹配",
  "career.tailoring.create_session": "生成简历提案",
  "career.tailoring.generate_changes": "生成简历修改建议",
  "career.tailoring.apply_changes": "保存已确认的修改",
  "career.preview.review_diff": "核对简历修改差异",
  "career.preview.apply_changes": "保存已确认的修改",
  "career.export.resume": "准备预览或导出",
  list_resumes: "读取简历列表",
  get_resume: "读取简历内容",
  parse_resume_file: "提取可核对的简历内容",
  analyze_job_fit: "分析岗位匹配",
  create_tailoring_session: "生成简历提案",
  apply_tailoring_changes: "保存已确认的修改",
  create_resume_from_profile: "生成通用简历",
  export_resume: "准备预览或导出",
  skill_loaded: "准备当前任务所需的方法"
};

export function activityLabel(message: AgentMessage) {
  // Never use activity content: it may contain tool arguments, errors or reasoning.
  const name = message.toolName ?? "";
  const label = toolLabels[name];
  if (message.metadata?.businessCommitted === true && /job_intake|commit_job/.test(name)) return "已保存岗位";
  return label ?? (message.metadata?.presentationThinking ? "思考与整理任务" : "处理当前任务");
}

export function AgentActivityCard({ messages, identityKey }: { messages: AgentMessage[]; identityKey: string }) {
  const context = useContext(AgentActivityContext);
  const turnId = messages[0]?.turnId;
  const transcript = context.messages.filter(message => turnId ? message.turnId === turnId : messages.some(item => item.id === message.id));
  const turn = turnId && context.session?.activeTurn?.id === turnId ? context.session.activeTurn : undefined;
  const latestTurnId = context.session?.activeTurn?.id ?? context.messages.findLast(message => message.turnId)?.turnId;
  const progress = turnId && turnId === latestTurnId && context.progress?.state !== "idle" ? context.progress : undefined;
  const active = ["submitted", "processing", "committing"].includes(progress?.state ?? "");
  const lastReply = transcript.findLast(message => message.role === "assistant" && !message.toolName && !message.metadata?.activityState);
  const pending = messages.some(message => message.status === "pending" || message.metadata?.activityState === "running")
    || Boolean(lastReply && (lastReply.streaming || ["assistant_thinking", "assistant_streaming"].includes(lastReply.kind ?? lastReply.type ?? "") || ["thinking", "streaming"].includes(lastReply.status ?? "")));
  const running = progress ? active : pending;
  const cancelled = progress ? progress.state === "cancelled" : transcript.some(message => message.metadata?.interrupted === true);
  const failed = progress ? ["failed", "blocked", "partial"].includes(progress.state)
    : messages.some(message => message.status === "failed" || message.metadata?.activityState === "failed")
      || transcript.some(message => (message.kind === "error_status" || message.type === "error") && message.metadata?.errorStatus !== "recovered");
  const waiting = progress && ["awaiting_input", "awaiting_review", "awaiting_confirmation"].includes(progress.state);
  const phase = running ? "running" : cancelled ? "cancelled" : failed ? "failed" : waiting ? "waiting" : "complete";
  const savedJob = messages.some(message => message.metadata?.businessCommitted === true && /job_intake|commit_job|career\.job\.commit/.test(message.toolName ?? ""));
  const label = progress?.label ?? (running ? "正在处理当前任务" : cancelled ? "已取消" : failed ? "处理未完成，请核对后重试" : savedJob ? "已保存岗位" : messages.every(message => message.metadata?.presentationThinking) ? "本轮回复已结束" : `已完成 ${messages.length} 个任务步骤`);
  const checkpoint = context.session?.turnCheckpoints.find(item => item.turnId === turnId);
  const run = turnId && context.session?.hermesRun?.turnId === turnId ? context.session.hermesRun : undefined;
  const start = turn?.startedAt ?? checkpoint?.createdAt ?? transcript[0]?.createdAt ?? messages[0]?.createdAt;
  const end = turn?.completedAt ?? checkpoint?.completedAt ?? run?.lastEventAt ?? transcript.at(-1)?.createdAt;
  const approximate = !turn?.completedAt && !checkpoint?.completedAt && !run;
  return <ActivityDetails key={`${identityKey}-${phase}`} messages={messages} running={running} phase={phase}
    label={label} start={start} end={end} approximate={approximate} detail={progress?.detail?.startsWith("版本：") ? undefined : progress?.detail} />;
}

function ActivityDetails({ messages, running, phase, label, start, end, detail, approximate }: {
  messages: AgentMessage[]; running: boolean; phase: string; label: string; start?: string; end?: string; detail?: string; approximate: boolean;
}) {
  const [open, setOpen] = useState(running);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  const startMs = Date.parse(start ?? "");
  const endMs = running ? now : Date.parse(end ?? "");
  const seconds = Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : undefined;
  const duration = seconds !== undefined && seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
  return <details className={`agent-tool-status-row is-${phase}`} open={open}
    onToggle={event => setOpen(event.currentTarget.open)} aria-label="任务过程">
    <summary role="status">
      <span className="agent-tool-status-icon" aria-hidden="true">
        <LoaderCircle className={`is-running is-spinning${running ? " is-visible" : ""}`} />
        <AlertCircle className={`is-failed${phase === "failed" ? " is-visible" : ""}`} />
        <Clock3 className={`is-waiting${phase === "waiting" ? " is-visible" : ""}`} />
        <CircleMinus className={`is-cancelled${phase === "cancelled" ? " is-visible" : ""}`} />
        <CheckCircle2 className={`is-complete${phase === "complete" ? " is-visible" : ""}`} />
      </span>
      <strong>{label}</strong>
      {seconds !== undefined ? <small className="agent-activity-duration">{running ? "已用时" : approximate ? "用时约" : "用时"} {duration}</small> : null}
      <ChevronDown className="agent-activity-chevron" aria-hidden="true" />
    </summary>
    {detail ? <p className="agent-activity-detail">{detail}</p> : null}
    <ul className="agent-tool-activity-list">
      {messages.map(message => {
        const state = message.metadata?.activityState ?? message.status;
        const pending = state === "running" || state === "pending" || message.metadata?.presentationThinking === true && running;
        const status = state === "failed" ? "未完成" : pending ? running ? "进行中" : "结果待核对" : "已完成";
        return <li key={message.id} className={state === "failed" ? "is-failed" : pending && running ? "is-running" : "is-complete"}>
          <strong>{status}</strong><span>{message.metadata?.presentationThinking && running ? "正在思考" : activityLabel(message)}</span>
        </li>;
      })}
    </ul>
  </details>;
}
