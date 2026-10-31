import { afterEach, expect, it, vi } from "vitest";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";

afterEach(() => vi.unstubAllGlobals());

it.each(["completed", "failed", "cancelled"] as const)("recovers authoritative %s without opening SSE or starting another Run", async status => {
  const transport = new HttpHermesBridgeTransport();
  vi.spyOn(transport, "getRun").mockResolvedValue({ run_id: "original", status, output: "original answer" });
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const events = [];
  for await (const event of transport.runEvents("original")) events.push(event);
  expect(events).toHaveLength(1);
  expect(events[0].type).toBe(status === "completed" ? "turn_completed" : "turn_failed");
  expect(fetch).not.toHaveBeenCalled();
});

it("unreachable status does not invent a terminal or start a Run", async () => {
  const transport = new HttpHermesBridgeTransport();
  vi.spyOn(transport, "getRun").mockRejectedValue(new Error("offline"));
  const iterator = transport.runEvents("original")[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ type: "progress", data: { reconciliation: "status_unavailable" } });
  await iterator.return?.();
});

it("reconciles completion while an SSE read remains pending", async () => {
  const transport = new HttpHermesBridgeTransport();
  const status = vi.spyOn(transport, "getRun")
    .mockResolvedValueOnce({ run_id: "original", status: "running" })
    .mockResolvedValue({ run_id: "original", status: "completed", output: "recovered answer" });
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => new Response(new ReadableStream({
    start(controller) { init.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true }); }
  }), { headers: { "content-type": "text/event-stream" } })));
  const iterator = transport.runEvents("original")[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toMatchObject({ type: "turn_completed", message: "recovered answer" });
  await iterator.next();
  expect(status).toHaveBeenCalledTimes(2);
});

it.each([
  ["running", "completed"], ["running", "failed"], ["running", "cancelled"],
  ["cancelled", "completed"], ["completed", "running"], ["failed", "running"], ["completed", "completed"]
] as const)("Repository reconciles %s / %s atomically and preserves terminal ownership", async (hostStatus, runtimeStatus) => {
  const db = new CareerAdaptDb(`terminal-${crypto.randomUUID()}`);
  try {
    const repository = new WorkspaceRepository(db);
    const session = AgentRuntime.createConversationSession("terminal");
    session.hermesRun = { runId: "original", hermesSessionId: "runtime-session", careerAgentSessionId: session.id,
      turnId: "turn", status: hostStatus, startedAt: "2026-10-31T00:00:00.000Z", lastEventAt: "2026-10-31T00:00:00.000Z" };
    const saved = await repository.saveAgentSession(session);
    const incoming = { ...saved, hermesRun: { ...saved.hermesRun!, status: runtimeStatus } };
    const result = await repository.saveAgentSession(incoming);
    const expected = hostStatus === "running" ? runtimeStatus : hostStatus;
    expect(result.hermesRun?.status).toBe(expected);
    expect((await repository.getAgentSession(saved.id))?.hermesRun?.status).toBe(expected);
    expect((await repository.saveAgentSession(result)).hermesRun?.status).toBe(expected);
    expect(await db.profiles.count()).toBe(0);
    expect(await db.resumeBranches.count()).toBe(0);
    expect(await db.resumeRevisions.count()).toBe(0);
    if (hostStatus !== "running" && hostStatus !== runtimeStatus) {
      const late = { ...incoming, sessionRevision: result.sessionRevision + 10,
        messages: [{ id: "late-answer", role: "assistant" as const, content: "must not persist", createdAt: "2026-10-31T00:00:01.000Z" }] };
      await repository.saveAgentSession(late);
      expect(await db.agentMessages.get("late-answer")).toBeUndefined();
    }
  } finally { await db.delete(); }
});
