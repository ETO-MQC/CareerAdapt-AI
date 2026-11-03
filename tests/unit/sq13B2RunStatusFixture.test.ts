import { afterEach, expect, it, vi } from "vitest";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";

afterEach(() => vi.unstubAllGlobals());

it.each([true, false])("status available=%s keeps reconciliation semantics and tool failure", async (available) => {
  const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const { action } = JSON.parse(String(init?.body)) as { action: string };
    if (action === "run_status") return available
      ? Response.json({ run_id: "sq13b2", status: "running" })
      : new Response("status offline", { status: 503 });
    expect(action).toBe("run_events");
    return new Response('event: tool.completed\ndata: {"tool_name":"career.workflow.tailor_resume","tool_call_id":"tool-1","status":"completed","result":{"ok":false,"error":{"code":"fact_guard_failed","message":"synthetic","recoverable":false}}}\n\n', { headers: { "Content-Type": "text/event-stream" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  const events = [];
  for await (const event of new HttpHermesBridgeTransport("/hermes").runEvents("sq13b2")) events.push(event);
  const progress = events.filter((event) => event.type === "progress");
  expect(progress).toHaveLength(available ? 0 : 1);
  if (!available) expect(progress[0]).toMatchObject({ data: { reconciliation: "status_unavailable" } });
  expect(events.at(-1)).toMatchObject({ type: "tool_call_failed", code: "fact_guard_failed" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
