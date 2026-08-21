import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";

/**
 * Resolve the persisted UserMessage that owns one logical turn.
 *
 * This is deliberately a lookup, not a second input/context projection. The
 * message id is the durable identity; callers decide what the message means.
 */
export function getUserMessageForTurn(
  session: AgentSession | undefined,
  turnId: string
): AgentMessage | undefined {
  if (!session || !turnId.trim()) return undefined;
  if (!Array.isArray(session.messages)) return undefined;
  const activeTurn = session.activeTurn?.id === turnId ? session.activeTurn : undefined;
  const sourceUserMessageId = activeTurn?.sourceUserMessageId ?? activeTurn?.userMessageId;
  if (sourceUserMessageId) {
    const message = session.messages.find((candidate) =>
      candidate.role === "user" && candidate.id === sourceUserMessageId
    );
    if (message) return message;
  }
  return session.messages.find((candidate) =>
    candidate.role === "user" && candidate.turnId === turnId
  );
}

/**
 * A cheap boundary check used only when a built-in workflow call omitted its
 * target. It does not persist, cache, or transport the message text.
 */
export function isCredibleExternalTargetText(value: string) {
  return value.trim().length >= 240
    && /职责|工作内容|responsibilit/i.test(value)
    && /要求|任职资格|qualification|requirement/i.test(value);
}
