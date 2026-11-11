import type { AgentSession, HermesRunHandle } from "@/agent/contracts/agentSession";
import { AgentGoalCompletionGuard } from "@/agent/kernel/AgentGoalCompletionGuard";

/** A presentation projection, never a writable workflow or completion authority. */
export type BusinessWorkflowProgress = {
  state: "idle" | "submitted" | "processing" | "awaiting_input" | "awaiting_review"
    | "awaiting_confirmation" | "committing" | "completed" | "partial" | "blocked" | "failed" | "cancelled";
  label: string;
  detail?: string;
  runtimeStatus?: HermesRunHandle["status"];
};

const toolLabels: Record<string, string> = {
  "career.workflow.precise_edit": "正在准备所选字段的修改",
  "career.workflow.material_intake": "正在读取材料",
  "career.workflow.profile_intake_turn": "正在整理经历",
  "career.workflow.profile_intake_finalize": "正在准备最终审核",
  "career.workflow.job_intake": "正在解析岗位",
  "career.workflow.job_fit": "正在匹配已有经历",
  "career.workflow.tailor_resume": "正在处理岗位简历提案",
  "career.workflow.compose_resume": "正在处理通用简历",
  "career.workflow.profile_to_resume": "正在整理简历内容",
  "career.workflow.resume_export": "正在准备预览或导出"
};

export function unresolvedBusinessToolFailures(session: AgentSession) {
  return (session.activeTurn?.toolFailures ?? []).filter(failure =>
    !session.messages.some(message => message.turnId === session.activeTurn?.id
      && message.operationId === failure.operationId && message.status === "complete")
  );
}

export function businessFailureRecovery(code?: string, category?: unknown): string {
  if (category === "provider_rate_limit" || code === "provider_rate_limit") {
    return "服务暂时不可用，输入和已有草稿已保留。请稍后主动重试；不会自动重试或切换模型。";
  }
  if (category === "provider_timeout" || category === "request_timeout"
    || code === "provider_timeout" || code === "hermes_run_start_timeout") {
    return "任务暂时中断，已有进度已保留。继续前需要核对运行状态和保存回执。";
  }
  if (code && /(?:(?:^|_)stale(?:_|$)|_conflict$)/u.test(code)) {
    return "数据已发生变化，请重新读取当前版本并审核后再确认。不会自动重复保存。";
  }
  if (code && /(?:fact_guard|blocked_high_risk|claim_safety)/u.test(code)) {
    return "部分内容需要核对来源。原始事实和提案已保留，请审核后继续。";
  }
  return "具体操作尚未完成，输入和已有进度已保留。请核对结果后从当前步骤继续。";
}

export function projectBusinessWorkflowProgress(session: AgentSession): BusinessWorkflowProgress {
  const turn = session.activeTurn;
  const run = session.hermesRun?.turnId === turn?.id ? session.hermesRun : undefined;
  const runtimeStatus = run?.status;
  const view = (state: BusinessWorkflowProgress["state"], label: string, detail?: string): BusinessWorkflowProgress =>
    ({ state, label, ...(detail ? { detail } : {}), ...(runtimeStatus ? { runtimeStatus } : {}) });
  const task = session.taskState;
  const facade = object(turn?.workflowCheckpoint?.facadeObservation);
  const kind = facade.kind;
  const live = run ? ["queued", "running", "stopping", "waiting_for_approval"].includes(run.status)
    : turn?.status === "running";
  const failures = unresolvedBusinessToolFailures(session);
  const failure = failures.at(-1);
  const diagnostics = turn?.runtimeFailureDiagnostics ?? {};
  const code = failure?.code ?? turn?.lastSafeErrorCode;
  const interaction = task?.workflowUserInputCheckpoint;
  const exportFailed = kind === "resume_export" || ["career.workflow.resume_export", "career.export.resume", "export_resume"].includes(failure?.toolName ?? "");
  const provenTask = task && new AgentGoalCompletionGuard().evaluate(task).canFinish;
  const completedTask = provenTask && task.completionStatus === "completed";
  const predecessor = object(task?.knownSlots.committedPredecessor);
  const committedPredecessor = predecessor.persistenceVerified === true && typeof predecessor.resumeId === "string" && typeof predecessor.revisionId === "string";

  if (run?.status === "stopping") return view("processing", "正在核对取消结果", "停止请求已发送，尚未确认最终状态。");
  if (run?.status === "cancelled") return view(completedTask || committedPredecessor ? "partial" : "cancelled", "本次运行已取消", "已保存的内容和候选仍然保留，取消不会撤销已完成的保存。");
  if (turn?.status === "aborted" && !run) return view("blocked", "本次任务已中断", "远端最终状态尚未确认，请先核对运行状态和已有结果。");
  if (session.pendingConfirmation?.status === "pending" || facade.status === "waiting_for_confirmation"
    || task?.completionStatus === "waiting_for_confirmation") {
    const tool = session.pendingConfirmation?.toolName ?? facade.toolName;
    const label = tool === "career.workflow.compose_resume" ? "等待你确认：创建通用简历"
      : tool === "career.workflow.job_intake" ? "等待你确认：保存岗位" : "等待你明确确认";
    return view("awaiting_confirmation", label, "确认前不会正式保存；确认提交后仍需等待保存回执。");
  }
  if (failure || run?.status === "failed" || turn?.status === "failed") {
    return view(exportFailed || completedTask || committedPredecessor ? "partial" : "failed",
      exportFailed ? "导出未完成" : committedPredecessor ? "简历已保存，岗位匹配尚未完成"
        : task?.knownSlots.jobPersistenceVerified === true ? "岗位已保存，但本轮回答未完整结束"
        : task?.workflowId === "analyze_job_fit" ? "岗位匹配没有完成" : "当前操作未完成",
      exportFailed
        ? "已确认的简历版本仍保留，可以单独重新导出。"
        : `${completedTask ? "已完成的业务结果仍保留。" : ""}${businessFailureRecovery(code, diagnostics.safeErrorCategory)}`);
  }
  if (task?.workflowId === "precise_resume_edit") {
    const slot = object(task.knownSlots.preciseResumeEdit);
    if (object(slot.outcome).revisionId) return view("completed", "所选字段已保存", `版本：${String(object(slot.outcome).revisionId)}`);
    if (task.completionStatus === "cancelled") return view("cancelled", "修改已取消", "原文保持不变。");
    if (task.completionStatus === "failed") return view("blocked", "正式保存未完成", "提案已保留。核对原版本后可明确重试；版本变化需重新审核。");
  }
  const compositionWriteFailure = object(task?.knownSlots.resumeCompositionWriteFailure);
  if (typeof compositionWriteFailure.code === "string") {
    return view("blocked", "正式保存未完成", businessFailureRecovery(compositionWriteFailure.code));
  }
  if (facade.status === "review_ready" || kind === "profile_intake_final_review"
    || interaction?.state === "active" && interaction.kind === "review_decision") {
    return view("awaiting_review", "等待你审核", "请核对提案和来源，当前结果尚未正式保存。");
  }
  if (facade.status === "failed" || facade.status === "partial" || facade.status === "recoverable_failure") {
    return view(facade.status === "partial" ? "partial" : "blocked", "需要处理后继续",
      businessFailureRecovery(object(facade.safeError).code as string | undefined));
  }
  if (facade.status === "waiting_for_user" || task?.completionStatus === "waiting_for_user"
    || interaction?.state === "active") {
    const candidates = task?.knownSlots.profileIntakeReviewProjection;
    return candidates ? view("awaiting_review", "候选已生成，等待核对", "候选尚未写入正式资料库。")
      : view("awaiting_input", "等待你补充或选择", "已有输入已保留，请完成当前问题后继续。");
  }
  if (live) {
    const activity = session.messages.findLast(message => message.turnId === turn?.id
      && message.status === "pending" && Boolean(message.toolName));
    const writing = object(task?.knownSlots.artifactWriteCheckpoint).status === "write_pending";
    if (writing) return view("committing", "正在正式保存", "请等待保存回执。");
    if (activity) return view("processing", toolLabels[activity.toolName!] ?? "正在执行业务操作");
    return view(run?.status === "queued" ? "submitted" : "processing", run?.status === "queued" ? "任务已接收" : "正在处理当前任务");
  }
  if (session.messages.some(message => message.turnId === turn?.id && message.toolName && message.status === "pending")) {
    return view("processing", "正在核对操作结果", "本轮回复已结束，仍在等待已启动操作的回执。");
  }
  const provenFacade = facade.status === "completed" && facade.hasCompletedReceipt === true;
  if ((provenTask && task.completionStatus === "completed") || !task && provenFacade) {
    if (kind === "resume_review") return view("completed", "只读审阅已完成", "审阅没有修改简历正文或创建正式版本。");
    if (kind === "job_intake") return facade.savedJobId
      ? view("completed", "岗位已正式保存")
      : view("completed", "岗位解析已完成", "这是临时分析结果，尚未正式保存岗位。");
    if (kind === "resume_export") return view("completed", "预览或导出已准备", "请打开实际生成的结果查看。");
    return view("completed", "当前业务步骤已完成", "结果由业务回执核验。");
  }
  if (task?.completionStatus === "failed") return view("blocked", "任务需要处理后继续", businessFailureRecovery(code));
  if (task?.completionStatus === "cancelled") return view("cancelled", "业务任务已取消");
  if (turn) return view("awaiting_input", "本轮回复已结束", "尚无业务完成回执，可补充信息或核对当前结果。");
  return view("idle", "尚未开始");
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
