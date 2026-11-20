import type { AgentRuntimeEvent } from "./agentRuntime";

/** Keep run identity for recovery while excluding provider reasoning from UI and session history. */
export function sanitizeReasoningEvent(event: AgentRuntimeEvent): AgentRuntimeEvent {
  if (event.type !== "reasoning_status") return event;
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown> : undefined;
  const handle = data?.runHandle && typeof data.runHandle === "object" && !Array.isArray(data.runHandle)
    ? data.runHandle as Record<string, unknown> : undefined;
  const safeHandle = handle ? Object.fromEntries(
    ["runId", "hermesSessionId", "careerAgentSessionId", "turnId", "status", "startedAt", "lastEventAt"]
      .flatMap(key => typeof handle[key] === "string" ? [[key, handle[key]]] : [])
  ) : undefined;
  return { type: event.type, sessionId: event.sessionId, turnId: event.turnId, timestamp: event.timestamp,
    ...(event.eventId ? { eventId: event.eventId } : {}), message: "正在分析…",
    ...(safeHandle ? { data: { runHandle: safeHandle } } : {}) };
}
