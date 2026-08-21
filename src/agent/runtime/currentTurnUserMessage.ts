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

/**
 * Strip the conversational wrapper that may precede a pasted job description.
 * The source UserMessage remains unchanged; only the parser-facing target
 * text is normalized, and only when the wrapper occupies its own first line.
 */
export function normalizeExternalJobTargetText(value: string) {
  const normalized = value.trim();
  const lines = normalized.split(/\r?\n/u);
  const firstLine = lines[0]?.trim() ?? "";
  if (lines.length < 2 || !/^(?:我想|我要|希望|请帮我)?\s*(?:应聘|申请|投递)\s*(?:这个|该|目标)?\s*(?:岗位|职位)\s*(?:[:：]\s*(?:[“"「『][^”"」』]{1,80}[”"」』])?)?\s*$/u.test(firstLine)) {
    return normalized;
  }
  return lines.slice(1).join("\n").trim();
}
