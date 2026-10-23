import { z } from "zod";

/**
 * V4-P2-C：Agent 能力结果分类。
 *
 * 项目里此前同时存在四套并行的结果词汇：`ok/error.retryable`（Executor）、
 * `receipt.status`（Gateway）、`CareerWorkflowStatus`（Facade）和
 * `pending_confirmation`（tailoring 诊断）。`retryable_failure` 与
 * `permanent_failure` 作为**结果状态**此前完全不存在，无法被认证。
 *
 * 本模块不新增第四套行为语义，而是把既有结果**归一**到唯一的五分类，
 * 让 UI、Agent 与 Hermes MCP 面对同一份可断言的能力结果。
 * 既有字段与状态机全部保留；本分类是纯派生读模型。
 */
export const AgentCapabilityOutcomeSchema = z.enum([
  "success",
  "pending_confirmation",
  "retryable_failure",
  "permanent_failure",
  "resumed_idempotent"
]);

export type AgentCapabilityOutcome = z.infer<typeof AgentCapabilityOutcomeSchema>;

export const AGENT_CAPABILITY_OUTCOMES = [
  "success",
  "pending_confirmation",
  "retryable_failure",
  "permanent_failure",
  "resumed_idempotent"
] as const satisfies readonly AgentCapabilityOutcome[];

/**
 * 需要用户显式确认才能继续的工具错误码。这些码在既有实现中散落在
 * Executor 抛出的 `agent_confirmation_required`、Gateway receipt 的
 * `confirmation_required` 和 MCP 边界投影三处。
 */
export const AGENT_CONFIRMATION_ERROR_CODES = [
  "agent_confirmation_required",
  "confirmation_required",
  "career_agent_waiting_for_confirmation",
  "user_confirmation_required_for_submitted",
  "duplicate_decision_required"
] as const;

export type AgentCapabilityOutcomeDetail = {
  outcome: AgentCapabilityOutcome;
  /** 归一依据，便于技术诊断而不必反推整条调用链。 */
  reason: string;
  /** 归一后的稳定错误码（成功类为 undefined）。 */
  code?: string;
  /** 是否可由用户/系统在不改变意图的前提下重试。 */
  retryable: boolean;
  /** 是否需要用户动作才能推进。 */
  requiresUserAction: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function readBoolean(source: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = source?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function isConfirmationCode(code: string | undefined): boolean {
  if (!code) return false;
  return (AGENT_CONFIRMATION_ERROR_CODES as readonly string[]).includes(code);
}

function detail(
  outcome: AgentCapabilityOutcome,
  reason: string,
  extra: { code?: string; retryable?: boolean; requiresUserAction?: boolean } = {}
): AgentCapabilityOutcomeDetail {
  return {
    outcome,
    reason,
    ...(extra.code ? { code: extra.code } : {}),
    retryable: extra.retryable ?? outcome === "retryable_failure",
    requiresUserAction: extra.requiresUserAction
      ?? (outcome === "pending_confirmation" || outcome === "retryable_failure")
  };
}

/**
 * 归一 Executor 层的 `AgentToolResult`。
 *
 * `pending_confirmation` 优先于失败判定：`AgentExecutor` 的确认闸是抛异常而
 * 不是返回失败结果，因此在「未确认即执行」这一真实场景里，成功与失败都不是
 * 正确答案。
 */
export function classifyAgentToolResult(result: {
  ok: boolean;
  error?: { code?: string; retryable?: boolean };
  data?: unknown;
  receipt?: { status?: string };
}): AgentCapabilityOutcomeDetail {
  const receiptStatus = result.receipt?.status;
  const code = result.error?.code;

  if (!result.ok || receiptStatus === "failed" || receiptStatus === "confirmation_required") {
    if (isConfirmationCode(code) || receiptStatus === "confirmation_required") {
      return detail("pending_confirmation", `confirmation_gate:${code ?? receiptStatus}`, {
        code: code ?? "agent_confirmation_required",
        retryable: false,
        requiresUserAction: true
      });
    }
    const retryable = result.error?.retryable === true;
    return detail(retryable ? "retryable_failure" : "permanent_failure", `tool_error:${code ?? "unknown"}`, {
      code,
      retryable
    });
  }

  const data = asRecord(result.data);
  const status = typeof data?.status === "string" ? data.status : undefined;
  if (status === "waiting_for_confirmation") {
    return detail("pending_confirmation", "workflow_status:waiting_for_confirmation", {
      code: status,
      retryable: false,
      requiresUserAction: true
    });
  }
  if (status && status !== "completed" && status !== "success") {
    // `waiting_for_user` / `review_ready` 需要用户输入；`working` 表示未完成。
    const needsUser = status === "waiting_for_user" || status === "review_ready";
    return detail("retryable_failure", `workflow_status:${status}`, { code: status, requiresUserAction: needsUser });
  }
  if (readBoolean(data, "idempotent") === true) {
    return detail("resumed_idempotent", "repository_idempotent_replay", { retryable: false });
  }
  return detail("success", "tool_completed", { retryable: false, requiresUserAction: false });
}

/**
 * 归一 Facade 层的 `CareerWorkflowStatus`。Facade 是模型与 Hermes 看到的
 * 最高层结果面，必须与 Executor 层落在同一套五分类上。
 */
export function classifyCareerWorkflowStatus(status: string): AgentCapabilityOutcomeDetail {
  switch (status) {
    case "completed":
      return detail("success", "workflow_completed", { retryable: false, requiresUserAction: false });
    case "waiting_for_confirmation":
      return detail("pending_confirmation", "workflow_waiting_for_confirmation", {
        retryable: false,
        requiresUserAction: true
      });
    case "waiting_for_user":
    case "review_ready":
    case "working":
    case "partial":
    case "recoverable_failure":
      return detail("retryable_failure", `workflow_${status}`, { requiresUserAction: true });
    case "failed":
      return detail("permanent_failure", "workflow_failed", { retryable: false, requiresUserAction: false });
    default:
      // 未知状态必须可见而不是被折叠成成功。
      return detail("permanent_failure", `workflow_status_unknown:${status}`, { retryable: false });
  }
}

/** 用于报告的稳定标签。 */
export const AGENT_CAPABILITY_OUTCOME_LABELS: Record<AgentCapabilityOutcome, string> = {
  success: "成功",
  pending_confirmation: "待用户确认",
  retryable_failure: "可重试失败",
  permanent_failure: "不可重试失败",
  resumed_idempotent: "重放幂等结果"
};