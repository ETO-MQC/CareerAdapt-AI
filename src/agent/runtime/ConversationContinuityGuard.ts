import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";

export const AGENT_TERMINAL_STATES = [
  "WAITING_FOR_USER",
  "WAITING_FOR_CONFIRMATION",
  "COMPLETED",
  "RECOVERABLE_FAILURE",
  "TERMINAL_FAILURE"
] as const;

export type AgentTerminalState = (typeof AGENT_TERMINAL_STATES)[number];

export type ConversationContinuityDecision =
  | { ok: true; terminalState: AgentTerminalState }
  | { ok: false; reasonCode: "agent_conversation_dead_end"; message: string };

/**
 * Checks only the turn requested by the caller. Historical sessions may not
 * carry terminal-state metadata, so continuity is enforced at each newly
 * settled assistant turn instead of invalidating old conversations on load.
 */
export function evaluateConversationContinuity(
  session: AgentSession,
  turnId = session.activeTurn?.id
): ConversationContinuityDecision {
  if (!turnId || session.activeTurn?.id !== turnId || session.activeTurn.status === "running") {
    return { ok: true, terminalState: "COMPLETED" };
  }
  const assistant = [...session.messages].reverse().find((message) =>
    message.role === "assistant"
      && message.turnId === turnId
      && message.metadata?.retracted !== true
      && message.kind !== "assistant_thinking"
      && message.kind !== "assistant_streaming"
      && message.status !== "thinking"
      && message.status !== "streaming"
  );
  if (!assistant) return deadEnd();

  const declared = terminalState(assistant);
  if (declared && isLegalTerminalState(declared, assistant, session)) {
    return { ok: true, terminalState: declared };
  }
  const inferred = inferTerminalState(assistant, session);
  if (inferred && isLegalTerminalState(inferred, assistant, session)) {
    return { ok: true, terminalState: inferred };
  }
  return deadEnd();
}

export function withTerminalState(message: AgentMessage, state: AgentTerminalState): AgentMessage {
  return {
    ...message,
    metadata: { ...message.metadata, terminalState: state }
  };
}

function terminalState(message: AgentMessage): AgentTerminalState | undefined {
  const value = message.metadata?.terminalState;
  return typeof value === "string" && (AGENT_TERMINAL_STATES as readonly string[]).includes(value)
    ? value as AgentTerminalState
    : undefined;
}

function inferTerminalState(message: AgentMessage, session: AgentSession): AgentTerminalState | undefined {
  if (session.pendingConfirmation || session.taskState?.completionStatus === "waiting_for_confirmation") {
    return "WAITING_FOR_CONFIRMATION";
  }
  if (message.status === "failed" || message.kind === "error_status" || hasRetryOption(message)) {
    return "RECOVERABLE_FAILURE";
  }
  if (session.taskState?.completionStatus === "waiting_for_user" && hasUserPrompt(message)) {
    return "WAITING_FOR_USER";
  }
  if (
    session.taskState?.completionStatus === "completed"
    && (session.artifactRefs.length > 0 || /下一步|查看|预览|已完成|已保存/iu.test(message.content))
  ) {
    return "COMPLETED";
  }
  return undefined;
}

function isLegalTerminalState(state: AgentTerminalState, message: AgentMessage, session: AgentSession) {
  if (state === "WAITING_FOR_USER") return hasUserPrompt(message);
  if (state === "WAITING_FOR_CONFIRMATION") return Boolean(session.pendingConfirmation) || hasUserPrompt(message) || /确认|同意|继续/iu.test(message.content);
  if (state === "COMPLETED") {
    return message.metadata?.isolatedConversationalTurn === true
      || session.taskState?.rootGoal === "conversation"
      || session.taskState?.rootGoal === "career_exploration"
      || session.taskState?.completionStatus === "completed"
      || session.artifactRefs.length > 0
      || /已完成|已保存|查看|预览/iu.test(message.content);
  }
  if (state === "RECOVERABLE_FAILURE") return message.status === "failed" || message.kind === "error_status" || hasRetryOption(message);
  return message.status === "failed" || message.kind === "error_status";
}

function hasUserPrompt(message: AgentMessage) {
  return Boolean(message.options?.length) || /[？?]/u.test(message.content) || /请选择|请告诉我|请补充|可以回复/iu.test(message.content);
}

function hasRetryOption(message: AgentMessage) {
  return Boolean(message.options?.some((option) => option.action.type === "retry_current_step"));
}

function deadEnd(): ConversationContinuityDecision {
  return {
    ok: false,
    reasonCode: "agent_conversation_dead_end",
    message: "当前回答没有留下问题、选项、结果或可恢复操作。"
  };
}
