import { deriveAgentTurnLifecycle } from "@/agent/runtime/agentTurnLifecycle";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { AgentHostSnapshot } from "@/agent/runtime/AgentHostStore";
import type { RuntimeStatusSnapshot } from "@/agent/runtime/runtimeStatus";

const labels = {
  idle: "AI 就绪", queued: "等待执行", running: "正在处理", waiting_for_user: "等待你回答",
  waiting_for_approval: "等待授权", waiting_for_confirmation: "等待确认", paused: "已暂停",
  stopping: "正在停止", completed: "已完成", failed: "执行失败", cancelled: "已停止", unavailable: "Agent 不可用"
} as const;

/** Read-only UI projection. Host/Runtime remain the only lifecycle owners. */
export function agentRunPresentation(input: {
  session: AgentSession;
  turnStatus: AgentHostSnapshot["turnStatus"];
  runtimeStatus: RuntimeStatusSnapshot["status"];
  stopping?: boolean;
}) {
  const { session, turnStatus } = input;
  const run = session.hermesRun;
  const currentRun = run && (!session.activeTurn || run.turnId === session.activeTurn.id) ? run : undefined;
  const lifecycle = deriveAgentTurnLifecycle(session);
  let state: keyof typeof labels;
  if (input.stopping || currentRun?.status === "stopping") state = "stopping";
  else if (lifecycle === "WAITING_FOR_CONFIRMATION") state = "waiting_for_confirmation";
  else if (lifecycle === "RUNNING") state = currentRun?.status === "queued" ? "queued" : "running";
  else if (lifecycle === "WAITING_FOR_USER") state = "waiting_for_user";
  else if (lifecycle === "STOPPED") state = currentRun?.status === "cancelled" ? "cancelled" : "paused";
  else if (lifecycle === "FAILED") state = "failed";
  else if (lifecycle === "COMPLETED") state = "completed";
  else if (currentRun?.status === "queued") state = "queued";
  else if (currentRun?.status === "running") state = "running";
  else if (currentRun?.status === "waiting_for_approval") state = "waiting_for_approval";
  else if (currentRun?.status === "cancelled") state = "cancelled";
  else if (turnStatus === "running") state = "running";
  else if (!session.taskState && turnStatus === "waiting_for_confirmation") state = "waiting_for_confirmation";
  else if (!session.taskState && turnStatus === "waiting_for_user") state = "waiting_for_user";
  else if (!session.taskState && turnStatus === "completed") state = "completed";
  else if (turnStatus === "paused") state = "paused";
  else if (turnStatus === "failed" || currentRun?.status === "failed") state = "failed";
  else state = input.runtimeStatus === "unavailable" ? "unavailable" : "idle";
  return { state, label: labels[state], canStop: ["queued", "running", "waiting_for_approval"].includes(state) };
}
