import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";

export function appendAgentMessage(
  session: AgentSession,
  role: AgentMessage["role"],
  content: string,
  options: Partial<AgentMessage> = {}
) {
  const now = new Date().toISOString();
  const message: AgentMessage = {
    id: options.id ?? `agent-message-${crypto.randomUUID()}`,
    role,
    content,
    createdAt: options.createdAt ?? now,
    ...options,
    updatedAt: options.updatedAt ?? now
  };
  return { ...session, messages: [...session.messages, message], updatedAt: now };
}

export function upsertAgentActivity(
  session: AgentSession,
  activity: Pick<AgentMessage, "id" | "turnId" | "content" | "toolName" | "operationId" | "status" | "metadata">
) {
  const now = new Date().toISOString();
  const existing = session.messages.some((message) => message.id === activity.id);
  if (!existing) {
    return appendAgentMessage(session, "tool", activity.content, {
      ...activity,
      kind: "tool_status",
      type: "tool_status",
      createdAt: now,
      updatedAt: now
    });
  }
  return {
    ...session,
    messages: session.messages.map((message) => message.id === activity.id
      ? { ...message, ...activity, kind: "tool_status" as const, type: "tool_status" as const, updatedAt: now }
      : message),
    updatedAt: now
  };
}

export function replaceAgentThinking(
  session: AgentSession,
  messageId: string,
  content: string,
  turnId?: string
) {
  const now = new Date().toISOString();
  const existing = session.messages.find((item) => item.id === messageId);
  const message: AgentMessage = {
    ...existing,
    id: messageId,
    turnId,
    role: "assistant",
    content,
    kind: "text",
    type: "text",
    status: "complete",
    streaming: false,
    language: detectLanguage(content),
    metadata: { ...existing?.metadata, retracted: false },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  return {
    ...session,
    messages: session.messages.some((item) => item.id === messageId)
      ? session.messages.map((item) => item.id === messageId ? message : item)
      : [...session.messages, message],
    updatedAt: now
  };
}

export function detectLanguage(value: string): AgentMessage["language"] {
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  if (/[a-z]/i.test(value)) return "en";
  return "unknown";
}
