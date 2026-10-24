import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/agent/runtime/hermes/control/route";
import { resolveEffectiveAiConfiguration } from "@/ai/providers/effectiveConfiguration";

const mocks = vi.hoisted(() => ({ updateConfig: vi.fn(), stop: vi.fn(), getStatus: vi.fn() }));
vi.mock("@/server/agent/webHermesSupervisor", () => ({
  webHermesControlEnabled: () => process.env.NODE_ENV !== "production" && process.env.HERMES_WEB_CONTROL_ENABLED === "true",
  getWebHermesSupervisor: () => ({ ...mocks, getConfig: async () => ({}), getConfigSchema: async () => ({}) })
}));

const secret = "unit-test-write-only-key";
const active = { provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", model: "test-model", credentialConfigured: true };
function snapshot(configured = true) {
  return { overallState: "ready", processReady: true, runtimeConfig: {
    active: { ...active, credentialConfigured: configured }, applyStatus: "applied", verified: true, restartPerformed: true
  } };
}
function request(action = "set_credential", origin: string | undefined = "http://127.0.0.1:3000") {
  return new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/control", {
    method: "POST", headers: { "Content-Type": "application/json", host: "127.0.0.1:3000", ...(origin ? { Origin: origin } : {}) },
    body: JSON.stringify({ action, credential: { apiKey: secret, provider: active.provider, baseUrl: active.baseUrl, model: active.model } })
  });
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("HERMES_WEB_CONTROL_ENABLED", "true");
  vi.stubEnv("AI_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  mocks.getStatus.mockReturnValue(snapshot());
  mocks.updateConfig.mockResolvedValue(snapshot());
  mocks.stop.mockResolvedValue(snapshot(false));
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("development Web write-only credentials", () => {
  it("passes a replacement key to the local Supervisor only, never back in the response", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(secret);
    expect(JSON.parse(text)).toMatchObject({ ok: true, available: true, source: "session_memory" });
    expect(mocks.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: secret, credentialAction: "replace" }));
  });
  it("describes credential presence without returning the key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", secret);
    const response = await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/control"));
    expect(await response.text()).not.toContain(secret);
  });
  it.each([undefined, "null", "https://untrusted.example", "http://127.0.0.1:4000"])("rejects invalid Origin %s before accessing credentials", async (origin) => {
    const input = request("set_credential", origin);
    if (origin === undefined) input.headers.delete("origin");
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
  it("never enables credential writes in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request())).status).toBe(409);
    expect(mocks.updateConfig).not.toHaveBeenCalled();
  });
  it("clears the runtime without resurrecting the old credential via rollback", async () => {
    mocks.updateConfig.mockResolvedValue(snapshot(false));
    const response = await POST(request("clear_credential"));
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(mocks.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "", credentialAction: "clear" }));
    expect(await response.json()).toMatchObject({ ok: true, configured: false });
  });
  it("resolves the updated provider-specific key for AI routes instead of a stale generic key", () => {
    const config = resolveEffectiveAiConfiguration(undefined, {
      AI_PROVIDER: "openrouter", AI_BASE_URL: active.baseUrl,
      AI_API_KEY: "old-generic-key", OPENROUTER_API_KEY: secret
    });
    expect(config.apiKey).toBe(secret);
  });
});
