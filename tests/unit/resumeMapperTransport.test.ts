import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/ai/structured/route";

vi.mock("server-only", () => ({}));
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai-compatible"); vi.stubEnv("AI_BASE_URL", "https://example.test/v1");
  vi.stubEnv("AI_API_KEY", "dummy-test-key"); vi.stubEnv("AI_MODEL", "test-model");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function request(timeout?: string, signal?: AbortSignal) {
  return new NextRequest("http://localhost/api/ai/structured", { method: "POST", signal,
    headers: timeout === undefined ? {} : { "x-resume-import-timeout-seconds": timeout }, body: JSON.stringify({
    task: "resume-document-mapper", input: { rawText: JSON.stringify([{ id: "b1", text: "Python" }]), inputHash: "test-mapper-transport" }
  }) });
}
describe("resume mapper transport boundary", () => {
  it("returns both failed attempts as redacted JSON with actual numeric-field types", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      resume: { schemaVersion: "careeradapt-resume-v2", basics: { name: "PRIVATE_NAME" }, sections: [{ sectionType: "education",
        items: [{ school: "PRIVATE_SCHOOL", gpa: "3.8/4", rankPosition: "3/50" }] }] }, sourceRefs: []
    }) }, finish_reason: "stop" }] })));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    const result = await response.json();
    expect(response.status).toBe(422); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.meta.responseSnapshots.map((snapshot: { attempt: number }) => snapshot.attempt)).toEqual([1, 2]);
    expect(result.meta.failedIssues).toContainEqual(expect.objectContaining({ expected: "number", received: "string" }));
    expect(result.meta.responseSnapshots[1].json).toContain('"gpa": "3.8/4"');
    expect(JSON.stringify(result)).not.toContain("PRIVATE_");
  });
  it("still cancels immediately during a long configured wait", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => {
      controller.abort(); throw new DOMException("Cancelled", "AbortError");
    }));
    const response = await POST(request("1200", controller.signal));
    expect(response.status).toBe(499);
    expect((await response.json()).error.code).toBe("request_cancelled");
  });
  it("shares the batch budget with format-repair retry rather than restarting the timeout", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    const timer = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn()
      .mockImplementationOnce(async () => {
        clock.mockReturnValue(201000);
        return new Response(JSON.stringify({ choices: [{ message: { content: "invalid JSON" } }] }));
      })
      .mockResolvedValueOnce(new Response('{"error":{"message":"test"}}', { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect((await response.json()).error.code).toBe("provider_http_429");
    expect(timer.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([600000, 400000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it.each([[undefined, 600_000], ["900", 900_000]])("uses the default or requested mapping budget: %s", async (header, expectedMs) => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const timer = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"message":"test"}}', { status: 429 })));
    await POST(request(header));
    expect(timer).toHaveBeenCalledWith(expectedMs);
  });
  it.each(["0", "1801", "NaN", "Infinity", "90.5"])("rejects invalid mapping budgets before the model call: %s", async (timeout) => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request(timeout));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts a five-minute response within the new budget and still validates sources/schema", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      clock.mockReturnValue(startedAt + 300000);
      const body = JSON.parse(String(init?.body)); expect(body.stream).toBe(true);
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(body).not.toHaveProperty("chat_template_kwargs");
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify({
        resume: { schemaVersion: "careeradapt-resume-v2", basics: {}, sections: [
          { sectionType: "skills", title: "技能", items: [{ sectionType: "skills", name: "Python" }] }
        ] }, sourceRefs: [{ path: "/sections/0/items/0", blockIds: ["b1"] }]
      }) }, finish_reason: "stop" }] })}\r\n\r\n`, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).output.resume.sections[0].items[0].name).toBe("Python");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("keeps an HTTP error at 70 seconds instead of misclassifying it using the old 60-second budget", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    vi.stubGlobal("fetch", vi.fn(async () => {
      clock.mockReturnValue(startedAt + 70_000);
      return new Response('{"error":{"message":"Rate limited"}}', { status: 429 });
    }));
    const response = await POST(request());
    expect((await response.json()).error.code).toBe("provider_http_429");
  });
});
