import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/resume-import/vision/route";

vi.mock("server-only", () => ({}));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai-compatible"); vi.stubEnv("AI_BASE_URL", "https://vision.example/v1");
  vi.stubEnv("AI_API_KEY", "test-vision-secret"); vi.stubEnv("AI_MODEL", "test-vision-model");
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function request(image = png, timeout?: string) {
  return new NextRequest("http://localhost/api/resume-import/vision", {
    method: "POST", body: JSON.stringify({ image, pageNumber: 1 }), headers: { "Content-Type": "application/json",
      ...(timeout === undefined ? {} : { "x-resume-import-timeout-seconds": timeout }) }
  });
}
describe("resume vision extraction boundary", () => {
  it.each([[undefined, 480_000], ["720", 720_000]])("uses the independent vision budget: %s", async (header, expectedMs) => {
    const timer = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"text":"Python"}' } }] })));
    expect((await POST(request(png, header))).status).toBe(200);
    expect(timer).toHaveBeenCalledWith(expectedMs);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
  });
  it("rejects an unbounded timeout without contacting the provider", async () => {
    expect((await POST(request(png, "99999999"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("sends real image content to the selected model and returns validated source text only", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: "个人技能\nPython" }) } }] })));
    const response = await POST(request());
    expect(await response.json()).toMatchObject({ ok: true, text: "个人技能\nPython", model: "test-vision-model" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1].content).toEqual(expect.arrayContaining([{ type: "image_url", image_url: { url: png } }]));
    expect(body.messages[0].content).toContain("untrusted data");
    expect(body.model).toBe("test-vision-model");
  });
  it("rejects remote URLs rather than fetching user-supplied locations", async () => {
    expect((await POST(request("http://localhost/private"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects a non-image payload even if it is labelled PNG", async () => {
    expect((await POST(request("data:image/png;base64,aGVsbG8="))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("reports unsupported visual input with recovery instructions and no raw provider body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: "secret-upstream-message" } }), { status: 400 }));
    const response = await POST(request());
    const text = await response.text();
    expect(response.status).toBe(502);
    expect(text).toContain("支持图像输入"); expect(text).not.toContain("secret-upstream-message");
    expect(text).not.toContain("test-vision-secret");
  });
  it("rejects invalid extraction JSON instead of accepting arbitrary invented fields", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"name":"invented"}' } }] })));
    expect(await (await POST(request())).json()).toMatchObject({ ok: false, code: "vision_invalid_output" });
  });
});
