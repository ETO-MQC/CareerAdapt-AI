import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent/runtime/hermes/route";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { branchSessionFromEditedUserMessage } from "@/agent/runtime/AgentHostStore";
import { activeBranchMessages } from "@/agent/runtime/activeBranchContext";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import { HttpHermesBridgeTransport, mapOfficialHermesEvent, type HermesBridgeTransport, type HermesTurnRequest } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { createRunStopReason } from "@/agent/runtime/hermes/hermesIncidentTrace";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { createElement } from "react";
import { renderHook } from "@testing-library/react";
import { AgentRuntimeProvider, useAgentHost } from "@/components/agent/runtime/AgentRuntimeProvider";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function runtime(transport: HermesBridgeTransport) {
  return new HermesCareerAgentRuntime({ transport, careerToolGateway: new CareerToolGateway(new AgentToolRegistry([])) });
}
function transport(overrides: Partial<HermesBridgeTransport> = {}): HermesBridgeTransport {
  return { health: async () => ({ available: true }),
    startRun: async () => ({ runId: "run", status: "started" }),
    getRun: async () => ({ run_id: "run", status: "completed" }),
    approveRun: async () => ({ run_id: "run", status: "running" }),
    runEvents: async function* () { yield { type: "turn_completed", message: "done" }; },
    stopRun: async () => ({ run_id: "run", status: "cancelled" }), ...overrides };
}

it("closes the persisted Host turn when a new or edited request fails before Run creation", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false }, { status: 503 })));
  const session = AgentRuntime.createConversationSession("preflight unavailable");
  const startRun = vi.fn();
  const agent = runtime(transport({ health: async () => ({ available: false, reason: "hermes_companion_unreachable" }), startRun }));
  const events = [];
  for await (const event of agent.runTurn({ sessionId: session.id, turnId: "preflight-turn", userMessage: "edited request", pageContext: { query: {} }, session })) events.push(event);
  expect(startRun).not.toHaveBeenCalled();
  expect(events).toContainEqual(expect.objectContaining({ type: "turn_failed", error: expect.objectContaining({ code: "hermes_unavailable_before_turn", recoverable: true }) }));
  expect(events.some(event => event.type === "turn_completed")).toBe(false);
  const hook = renderHook(() => useAgentHost(), { wrapper: ({ children }) => createElement(AgentRuntimeProvider, null, children) });
  try {
    const host = hook.result.current;
    await host.state.adoptDurably(session);
    const shell = await host.state.beginRuntimeShell({ session, userMessage: "edited request", runtimeId: "hermes" });
    for (const event of events) await host.state.applyRuntimeEvent({ ...event, turnId: shell.turnId }, shell.assistantMessageId);
    expect(host.state.getSnapshot().activeSession?.activeTurn?.status).toBe("failed");
    const persisted = await host.store.get(session.id);
    expect(persisted?.activeTurn?.status).toBe("failed");
  } finally { hook.unmount(); }
});

it("captures real constructed Hermes histories and remote identities after editing, preserving the original branch", async () => {
  const base = AgentRuntime.createConversationSession("test");
  const now = new Date().toISOString();
  const original = { ...base, activeBranchId: "root", activeHeadMessageId: "answer",
    conversationBranches: [{ id: "root", status: "active" as const, createdAt: now, headMessageId: "answer" }],
    messages: [
      { id: "shared", branchId: "root", role: "user" as const, content: "shared context", createdAt: now },
      { id: "question", branchId: "root", parentMessageId: "shared", role: "user" as const, content: "old question", createdAt: now },
      { id: "tool", branchId: "root", role: "tool" as const, content: "old tool result", createdAt: now },
      { id: "answer", branchId: "root", role: "assistant" as const, content: "old answer", createdAt: now }
    ] };
  const edited = branchSessionFromEditedUserMessage(original, "question", "new question")!;
  const requests: HermesTurnRequest[] = [];
  const agent = runtime(transport({ startRun: async request => { requests.push(request); return { runId: "run", status: "started" }; } }));
  for (const session of [original, edited]) {
    for await (const event of agent.runTurn({ sessionId: session.id, turnId: crypto.randomUUID(), userMessage: "new question", pageContext: { query: {} }, session })) void event;
  }
  expect(requests[0].conversationHistory).toEqual([{ role: "user", content: "shared context" }, { role: "user", content: "old question" }, { role: "assistant", content: "old answer" }]);
  expect(requests[1].conversationHistory).toEqual([{ role: "user", content: "shared context" }]);
  expect(requests[1].sessionId).not.toBe(requests[0].sessionId);
  expect(activeBranchMessages(original).map(message => message.content)).toContain("old tool result");
  expect(original.messages).toHaveLength(4);
});

it.each(["completed", "running"] as const)("stops a %s Run without starting a replacement", async status => {
  const stop = vi.fn(async () => ({ run_id: "run", status: "cancelled" as const }));
  const start = vi.fn();
  const agent = runtime(transport({ startRun: start, stopRun: stop,
    getRun: vi.fn().mockResolvedValueOnce({ run_id: "run", status }).mockResolvedValue({ run_id: "run", status: "cancelled" }) }));
  expect((await agent.stopCurrentRun("run", createRunStopReason({ requestedBy: "user", reasonCode: "user_interrupt", sourceComponent: "test" }))).status).toBe(status === "completed" ? "completed" : "cancelled");
  expect(stop).toHaveBeenCalledTimes(status === "completed" ? 0 : 1);
  expect(start).not.toHaveBeenCalled();
});

it("recognizes exact missing Run evidence through Next and HTTP, terminates observation, and never repeats stop", async () => {
  vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:18643");
  vi.stubEnv("HERMES_RUNTIME_PROTOCOL", "official");
  vi.stubEnv("API_SERVER_KEY", "synthetic-control");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Run not found: run" }, { status: 404 })));
  const response = await POST(new NextRequest("http://localhost/api/agent/runtime/hermes", { method: "POST", body: JSON.stringify({ action: "run_status", runId: "run" }) }));
  const payload = await response.json();
  expect(payload.error.code).toBe("hermes_run_not_found");
  const fetch = vi.fn(async () => Response.json(payload, { status: 404 }));
  vi.stubGlobal("fetch", fetch);
  const http = new HttpHermesBridgeTransport();
  const agent = runtime(http);
  const reason = createRunStopReason({ requestedBy: "user", reasonCode: "user_interrupt", sourceComponent: "test" });
  expect(await agent.stopCurrentRun("run", reason)).toMatchObject({ status: "failed", error: { code: "hermes_run_not_found" } });
  const calls = fetch.mock.calls.length;
  await agent.stopCurrentRun("run", reason);
  expect(fetch).toHaveBeenCalledTimes(calls);
  const events = [];
  for await (const event of http.runEvents("run")) events.push(event);
  expect(events).toEqual([expect.objectContaining({ type: "turn_failed", code: "hermes_run_not_found", recoverable: true })]);
});

it("does not classify unrelated HTTP 404 as a missing Run", async () => {
  vi.stubEnv("API_SERVER_KEY", "synthetic-control");
  vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:18643");
  vi.stubEnv("HERMES_RUNTIME_PROTOCOL", "official");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "route not found" }, { status: 404 })));
  const response = await POST(new NextRequest("http://localhost/api/agent/runtime/hermes", { method: "POST", body: JSON.stringify({ action: "run_status", runId: "run" }) }));
  expect((await response.json()).error.code).toBe("hermes_run_status_failed");
});

it("maps a completed tool invocation carrying a domain error to failure", () => {
  expect(mapOfficialHermesEvent("tool.completed", { tool_name: "career.profile.get", tool_call_id: "call", result: { isError: true, structuredContent: { ok: false, error: { code: "entity_not_available", message: "unavailable" } } } })).toMatchObject({ type: "tool_call_failed" });
});

it("waits for the stopped old operation before preparing an edit and fences its late result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false }, { status: 503 })));
  const hook = renderHook(() => useAgentHost(), { wrapper: ({ children }) => createElement(AgentRuntimeProvider, null, children) });
  try {
    const host = hook.result.current;
    const session = AgentRuntime.createConversationSession("running edit");
    const now = new Date().toISOString();
    session.messages = [{ id: "user", role: "user", content: "old", createdAt: now },
      { id: "assistant", role: "assistant", content: "old answer", turnId: "old-turn", createdAt: now }];
    session.activeTurn = { id: "old-turn", sessionId: session.id, status: "running", startedAt: now };
    session.hermesRun = { runId: "old-run", hermesSessionId: "remote", careerAgentSessionId: session.id,
      turnId: "old-turn", status: "running", startedAt: now, lastEventAt: now };
    await host.state.adoptDurably(session);
    host.state.claimTurnOperation({ sessionId: session.id, operationId: "old-operation", kind: "user_turn", turnId: "old-turn" });
    let finish!: () => void;
    const old = new Promise<void>(resolve => { finish = resolve; }).then(() => host.state.finishTurnOperation("old-operation"));
    host.state.attachTurnOperation("old-operation", old);
    const stop = vi.spyOn(host.hermesRuntime, "stopCurrentRun").mockImplementation(async () => {
      finish(); return { run_id: "old-run", status: "cancelled" };
    });
    const event = { type: "edit_message" as const, messageId: "user", text: "new" };
    const prepare = vi.spyOn(host.state, "prepareRuntimeUserEvent").mockImplementation(async input => ({
      session: input.session!, event, userMessage: "new", executionOwner: "deterministic_transition",
      deterministicTransitionApplied: true, deterministicTerminal: true
    }));
    const result = await host.runUserEvent(event, { session, pageContext: { query: {} } });
    expect(stop).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(result?.hermesRun?.status).toBe("cancelled");
    await host.state.applyRuntimeEvent({ sessionId: session.id, turnId: "old-turn", type: "text_delta", delta: "late old answer", timestamp: now }, "assistant");
    expect(host.state.getSnapshot().activeSession?.messages.some(message => message.content.includes("late old answer"))).toBe(false);
  } finally { hook.unmount(); }
});
