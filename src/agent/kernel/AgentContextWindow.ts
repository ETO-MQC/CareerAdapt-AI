import type { AgentMessage, AgentSession } from "@/agent/contracts/agentSession";
import type { AgentModelMessage } from "@/agent/model/agentModel";

const RECENT_MEANINGFUL_MESSAGES = 16;
const SUMMARY_TRIGGER_MESSAGES = 32;
const SUMMARY_BATCH_MESSAGES = 16;

export type AgentContextWindowResult = {
  messages: AgentModelMessage[];
  conversationSummary: string;
  summaryChanged: boolean;
};

export class AgentContextWindow {
  build(session: AgentSession, userMessage: string): AgentContextWindowResult {
    const meaningful = session.messages.filter(isMeaningful);
    const recent = meaningful.slice(-RECENT_MEANINGFUL_MESSAGES);
    const older = meaningful.slice(0, -RECENT_MEANINGFUL_MESSAGES);
    const retrieved = retrieveRelevantOlderTurns(older, userMessage, 4);
    const messages = dedupeMessages([...retrieved, ...recent]).map(toModelMessage);
    if (!messages.length || messages.at(-1)?.role !== "user" || messages.at(-1)?.content !== userMessage) {
      messages.push({ role: "user", content: userMessage });
    }
    const nextSummary = updateSummary(session.conversationSummary, meaningful);
    return {
      messages,
      conversationSummary: nextSummary,
      summaryChanged: nextSummary !== session.conversationSummary
    };
  }
}

function isMeaningful(message: AgentMessage) {
  return (message.role === "user" || message.role === "assistant")
    && message.metadata?.retracted !== true
    && message.kind !== "assistant_thinking"
    && message.kind !== "assistant_streaming"
    && Boolean(message.content.trim());
}

function retrieveRelevantOlderTurns(messages: AgentMessage[], query: string, limit: number) {
  const queryTerms = terms(query);
  if (!queryTerms.size) return [];
  return messages
    .map((message, index) => ({
      message,
      index,
      score: [...terms(message.content)].reduce((sum, term) => sum + Number(queryTerms.has(term)), 0)
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
  return { role: message.role as "user" | "assistant", content: message.content };
}

function updateSummary(current: string, messages: AgentMessage[]) {
  if (messages.length < SUMMARY_TRIGGER_MESSAGES) return current;
  const summarizedTurns = countSummaryEntries(current);
  const eligible = messages.slice(0, -RECENT_MEANINGFUL_MESSAGES);
  if (eligible.length - summarizedTurns < SUMMARY_BATCH_MESSAGES) return current;
  const additions = eligible.slice(summarizedTurns).map((message) =>
    `${message.role === "user" ? "用户" : "助手"}：${message.content.replace(/\s+/g, " ").slice(0, 220)}`
  );
  const previousBody = current.replace(/^\[summary-through:\d+]\n?/, "");
  const marker = `[summary-through:${eligible.length}]`;
  const body = [previousBody, ...additions].filter(Boolean).join("\n");
  return `${marker}\n${body.slice(-(6000 - marker.length - 1))}`;
}

function countSummaryEntries(summary: string) {
  const marker = /^\[summary-through:(\d+)]/.exec(summary);
  if (marker) return Number(marker[1]);
  return summary ? summary.split("\n").filter((line) => /^(用户|助手)：/.test(line)).length : 0;
}
