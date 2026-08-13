import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import { withActiveBranchHead } from "./activeBranchContext";

export function appendAgentMessage(
  session: AgentSession,
  role: AgentMessage["role"],
  content: string,
  options: Partial<AgentMessage> = {}
) {
  const now = new Date().toISOString();
  const messageId = options.id ?? `agent-message-${crypto.randomUUID()}`;
  const hasExplicitOptionSet = Object.prototype.hasOwnProperty.call(options, "optionSet");
  const optionSet = !hasExplicitOptionSet && options.options?.length
    ? {
        optionSetId: `agent-options-${messageId}`,
        optionSetRevision: Math.max(-1, ...session.messages.map((message) => message.optionSet?.optionSetRevision ?? -1)) + 1,
        sourceMessageId: messageId,
        state: "active" as const
      }
    : undefined;
  const message: AgentMessage = {
    id: messageId,
    branchId: options.branchId ?? session.activeBranchId ?? "legacy-branch",
    role,
    content,
    parentMessageId: options.parentMessageId ?? session.activeHeadMessageId,
    createdAt: options.createdAt ?? now,
    ...options,
    ...(optionSet ? { optionSet } : {}),
    updatedAt: options.updatedAt ?? now
  };
  return withActiveBranchHead({ ...session, messages: [...session.messages, message], updatedAt: now }, message.id);
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
  return withActiveBranchHead({
    ...session,
    messages: session.messages.map((message) => message.id === activity.id
      ? { ...message, ...activity, kind: "tool_status" as const, type: "tool_status" as const, updatedAt: now }
      : message),
    updatedAt: now
  }, activity.id);
}

export function replaceAgentThinking(
  session: AgentSession,
  messageId: string,
  content: string,
  turnId?: string
) {
  const now = new Date().toISOString();
  const existing = session.messages.find((item) => item.id === messageId);
  const message = normalizeMessageForFinalAssistant({
    ...existing,
    id: messageId,
    branchId: existing?.branchId ?? session.activeBranchId ?? "legacy-branch",
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
  } as AgentMessage);
  return withActiveBranchHead({
    ...session,
    messages: session.messages.some((item) => item.id === messageId)
      ? session.messages.map((item) => item.id === messageId ? message : item)
      : [...session.messages, message],
    updatedAt: now
  }, message.id);
}

export function normalizeMessageForFinalAssistant(message: AgentMessage): AgentMessage {
  const rest = { ...message } as Record<string, unknown>;
  for (const key of ["errorCode", "userMessageId", "confirmationResolution", "confirmationResolvedAt", "confirmationToolName"]) delete rest[key];
  const metadata = { ...(message.metadata ?? {}) };
  for (const key of [
    "retry", "retryCount", "retryMetadata", "confirmationResolution",
    "confirmationResolvedAt", "confirmationToolName", "activityState",
    "staleActivity", "errorType", "streamId", "iterationId"
  ]) delete metadata[key];
  return {
    ...rest,
    role: "assistant",
    kind: "text",
    type: "text",
    status: "complete",
    streaming: false,
    metadata: Object.keys(metadata).length ? metadata : undefined
  } as AgentMessage;
}

export function detectLanguage(value: string): AgentMessage["language"] {
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  if (/[a-z]/i.test(value)) return "en";
  return "unknown";
}
