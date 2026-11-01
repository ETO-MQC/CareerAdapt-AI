import { afterEach, expect, it, vi } from "vitest";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
afterEach(() => vi.unstubAllGlobals());
const frame = 'event: tool.completed\ndata: {"tool_name":"career.workflow.tailor_resume","tool_call_id":"tool-closure-1","operation_id":"operation-closure-1","status":"completed","result":{"ok":false,"error":{"code":"fact_guard_failed","message":"事实核验失败","recoverable":false}}}\n\n';
function stream() { return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode(frame)); c.close(); } }); }
it("demonstrates that consuming the shared fixture makes a second Response impossible", async () => {
  const shared = stream();
  const first = new Response(shared);
  await expect(first.json()).rejects.toThrow();
  expect(first.bodyUsed).toBe(true);
  expect(() => new Response(shared)).toThrow("Response body object should not be disturbed or locked");
});
it("preserves contradictory-completion assertions with separate status and event responses", async () => {
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    actions.push(request.action);
    if (request.action === "run_status") return Response.json({ ok: true, data: { run_id: "run-closure-official", status: "running" } });
    expect(request.action).toBe("run_events");
    return new Response(stream(), { headers: { "Content-Type": "text/event-stream" } });
  }));
  const events = [];
  for await (const event of new HttpHermesBridgeTransport("/hermes").runEvents!("run-closure-official")) events.push(event);
  expect(actions).toEqual(["run_status", "run_events"]);
  expect(events[0]).toMatchObject({ type: "tool_call_failed", code: "fact_guard_failed", data: { toolFailureLayer: "hermes_tool_protocol", safeDomainErrorCode: "fact_guard_failed", toolResultIsError: true } });
});
