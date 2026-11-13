import { createElement } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentRuntimeProvider, useAgentHost } from "@/components/agent/runtime/AgentRuntimeProvider";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("settles a persisted shell as failed when runtime dispatch throws", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false }, { status: 503 })));
  vi.spyOn(BrowserAgentToolService.prototype, "prepareAvailableRuntimeContext").mockImplementation(async session => ({
    session, resetContext: false, suppressConversationHistory: false, hermesSessionId: "synthetic-hermes"
  }));
  vi.spyOn(HermesCareerAgentRuntime.prototype, "runTurn").mockImplementation(async function* () {
    throw new Error("synthetic dispatch failure");
  });
  const hook = renderHook(() => useAgentHost(), { wrapper: ({ children }) => createElement(AgentRuntimeProvider, null, children) });
  try {
    const host = hook.result.current;
    const session = AgentRuntime.createConversationSession();
    await host.state.adoptDurably(session);
    await expect(host.runTurn({ sessionId: session.id, session, userMessage: "测试发送", pageContext: { query: {} } })).rejects.toThrow("synthetic dispatch failure");
    const stored = await host.store.get(session.id);
    expect(stored?.activeTurn?.status).toBe("failed");
    expect(stored?.messages.some(message => message.role === "assistant" && message.streaming)).toBe(false);
  } finally { hook.unmount(); }
});

it("rejects a competing user turn before persisting it while the first turn runs", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false }, { status: 503 })));
  vi.spyOn(BrowserAgentToolService.prototype, "prepareAvailableRuntimeContext").mockImplementation(async session => ({
    session, resetContext: false, suppressConversationHistory: false, hermesSessionId: "synthetic-hermes"
  }));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(HermesCareerAgentRuntime.prototype, "runTurn").mockImplementation(async function* (input) {
    await held;
    yield { type: "turn_completed", sessionId: input.sessionId, turnId: input.turnId!, timestamp: new Date().toISOString(), message: "完成" };
  });
  const hook = renderHook(() => useAgentHost(), { wrapper: ({ children }) => createElement(AgentRuntimeProvider, null, children) });
  try {
    const host = hook.result.current;
    const session = AgentRuntime.createConversationSession();
    await host.state.adoptDurably(session);
    const first = host.runTurn({ sessionId: session.id, session, userMessage: "第一条", pageContext: { query: {} } });
    await waitFor(() => expect(host.state.getSnapshot().activeSession?.activeTurn?.status).toBe("running"));
    await expect(host.runTurn({ sessionId: session.id, session, userMessage: "第二条", pageContext: { query: {} } })).rejects.toMatchObject({ code: "agent_turn_in_progress" });
    await expect(host.runUserEvent({ type: "text_message", text: "好" }, { session, pageContext: { query: {} } })).rejects.toMatchObject({ code: "agent_turn_in_progress" });
    expect((await host.store.get(session.id))?.messages.filter(message => message.role === "user").map(message => message.content)).toEqual(["第一条"]);
    release();
    await first;
  } finally { release(); hook.unmount(); }
});
