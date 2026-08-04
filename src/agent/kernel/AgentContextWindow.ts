import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import type { AgentModelMessage } from "@/agent/model/agentModel";
import { buildActiveBranchContext } from "@/agent/runtime/activeBranchContext";

const RECENT_MEANINGFUL_MESSAGES = 16;
const SUMMARY_TRIGGER_MESSAGES = 32;
const SUMMARY_BATCH_MESSAGES = 16;

export type AgentContextWindowResult = {
  messages: AgentModelMessage[];
  conversationSummary: string;
  summaryChanged: boolean;
  diagnostics: ReturnType<typeof buildActiveBranchContext>["diagnostics"];
};

export class AgentContextWindow {
  build(session: AgentSession, userMessage: string): AgentContextWindowResult {
    const branchContext = buildActiveBranchContext(session);
    const branchSession = {
      ...session,
      messages: branchContext.messages,
      conversationSummary: branchContext.conversationSummary
    };
    const meaningful = branchContext.messages.filter(isMeaningful);
    const recent = meaningful.slice(-RECENT_MEANINGFUL_MESSAGES);
    const older = meaningful.slice(0, -RECENT_MEANINGFUL_MESSAGES);
    const retrieved = retrieveRelevantOlderTurns(older, userMessage, 4, recent.at(-1)?.turnId);
    const messages = dedupeMessages([...retrieved, ...recent]).map(toModelMessage);
    if (!messages.length || messages.at(-1)?.role !== "user" || messages.at(-1)?.content !== userMessage) {
      messages.push({ role: "user", content: userMessage });
    }
    const nextSummary = updateSummary(branchSession, meaningful);
    return {
      messages,
      conversationSummary: nextSummary,
      summaryChanged: nextSummary !== branchContext.conversationSummary,
      diagnostics: branchContext.diagnostics
    };
  }
}

function isMeaningful(message: AgentMessage) {
  return (message.role === "user" || message.role === "assistant" || message.role === "tool")
    && message.metadata?.retracted !== true
    && message.kind !== "assistant_thinking"
    && message.kind !== "assistant_streaming"
    && Boolean(message.content.trim());
}

function retrieveRelevantOlderTurns(messages: AgentMessage[], query: string, limit: number, currentTurnId?: string) {
  const queryTerms = terms(query);
  if (!queryTerms.size) return [];
  return messages
    .map((message, index) => ({
      message,
      index,
      score: [...terms(message.content)].reduce((sum, term) => sum + Number(queryTerms.has(term)), 0)
        + Number(Boolean(currentTurnId && message.turnId === currentTurnId)) * 8
        + Number(/不是|更正|纠正|改成|不要|确认|决定/.test(message.content)) * 5
        + Number(/[？?]\s*$/.test(message.content)) * 3
        + Number(Boolean(message.metadata?.entityId || message.metadata?.jobId || message.metadata?.resumeId)) * 4
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || right.index - left.index)
    .slice(0, limit)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.message);
}

function terms(value: string) {
  return new Set(value.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? []);
}

function dedupeMessages(messages: AgentMessage[]) {
  return [...new Map(messages.map((message) => [message.id, message])).values()];
}

function toModelMessage(message: AgentMessage): AgentModelMessage {
  return {
    role: message.role as "user" | "assistant" | "tool",
    content: message.content,
    name: message.toolName,
    toolCallId: message.operationId
  };
}

function updateSummary(session: AgentSession, messages: AgentMessage[]) {
  if (messages.length < SUMMARY_TRIGGER_MESSAGES) return session.conversationSummary;
  const summarizedTurns = countSummaryEntries(session.conversationSummary);
  const eligible = messages.slice(0, -RECENT_MEANINGFUL_MESSAGES);
  if (eligible.length - summarizedTurns < SUMMARY_BATCH_MESSAGES) return session.conversationSummary;
  const decisions = eligible.filter((message) => message.role === "user" && /确认|决定|选择|用|不要|改成/.test(message.content)).slice(-8);
  const corrections = eligible.filter((message) => message.role === "user" && /不是|更正|纠正|改成/.test(message.content)).slice(-8);
  const unresolved = eligible.filter((message) => /[？?]\s*$/.test(message.content)).slice(-6);
  const outcomes = eligible.filter((message) => message.role === "assistant" && /已完成|已保存|已创建|未能|失败/.test(message.content)).slice(-8);
  const marker = `[summary-through:${eligible.length}]`;
  const body = [
    `当前目标：${session.taskState?.rootGoal ?? session.memory?.currentGoal ?? session.title}`,
    `当前子任务：${session.taskState?.activeGoal ?? session.taskState?.rootGoal ?? session.title}`,
    `当前阶段：${session.taskState?.stage ?? session.workflowState.step}`,
    `已选实体：${JSON.stringify(session.taskState?.selectedEntities ?? {
      profileId: session.activeProfileId,
      resumeId: session.activeResumeId,
      jobId: session.activeJobId
    })}`,
    section("重要决定", decisions),
    section("确认更正", corrections),
    section("未解决问题", unresolved),
    section("完成结果", outcomes)
  ].filter(Boolean).join("\n");
  return `${marker}\n${body.slice(-(6000 - marker.length - 1))}`;
}

function countSummaryEntries(summary: string) {
  const marker = /^\[summary-through:(\d+)]/.exec(summary);
  if (marker) return Number(marker[1]);
  return 0;
}

function section(label: string, messages: AgentMessage[]) {
  if (!messages.length) return "";
  return `${label}：\n${messages.map((message) => `- ${message.content.replace(/\s+/g, " ").slice(0, 220)}`).join("\n")}`;
}
