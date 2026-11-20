import { expect, it } from "vitest";
import { sanitizeReasoningEvent } from "@/agent/runtime/sanitizeReasoningEvent";

it("removes provider reasoning from UI and persisted events while retaining only run identity", () => {
  const event = sanitizeReasoningEvent({ type: "reasoning_status", sessionId: "session", turnId: "turn",
    timestamp: "2026-11-19T00:00:00.000Z", message: "private reasoning", delta: "private reasoning",
    data: { text: "private reasoning", runHandle: { runId: "run", turnId: "turn", status: "running", secret: "private reasoning" } } });
  expect(event.message).toBe("正在分析…");
  expect(JSON.stringify(event)).not.toContain("private reasoning");
  expect(event.data).toEqual({ runHandle: { runId: "run", turnId: "turn", status: "running" } });
});
