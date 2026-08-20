import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/agent/runtime/hermes/control/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Web Hermes control route", () => {
  it("keeps process control disabled outside an explicitly enabled dev server", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("HERMES_WEB_CONTROL_ENABLED", "false");

    const response = await POST(new Request(
      "http://127.0.0.1:3000/api/agent/runtime/hermes/control",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start" })
      }
    ));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "web_control_disabled" }
    });
  });

  it("rejects non-loopback callers before loading the local Supervisor", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HERMES_WEB_CONTROL_ENABLED", "true");

    const response = await POST(new Request(
      "http://192.168.1.20:3000/api/agent/runtime/hermes/control",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "192.168.1.20:3000"
        },
        body: JSON.stringify({ action: "start" })
      }
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "web_control_local_only" }
    });
  });

  it("accepts the browser's 127.0.0.1 origin when Next normalizes request.url to localhost", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HERMES_WEB_CONTROL_ENABLED", "true");

    const response = await POST(new Request(
      "http://localhost:3000/api/agent/runtime/hermes/control",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:3000",
          origin: "http://127.0.0.1:3000"
        },
        body: JSON.stringify({ action: "stop" })
      }
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      receipt: {
        action: "stop",
        accepted: true,
        executed: true,
        controlOwner: "web_supervisor"
      }
    });
  });
});
