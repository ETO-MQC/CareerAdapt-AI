import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let getHealth: typeof import("@/app/api/agent/runtime/hermes/health/route")["GET"];
beforeEach(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries({ HERMES_RUNTIME_URL: "http://127.0.0.1:18643", API_SERVER_KEY: "control-synthetic",
    AI_PROVIDER: "openai-compatible", HERMES_PROVIDER: "openai-compatible", AI_BASE_URL: "http://127.0.0.1:18644/v1",
    HERMES_BASE_URL: "http://127.0.0.1:18644/v1", AI_API_KEY: "provider-synthetic", HERMES_CUSTOM_CAREERADAPT_API_KEY: "provider-synthetic",
    AI_MODEL: "test-model", HERMES_MODEL: "test-model", CAREERADAPT_HERMES_CONFIG_GENERATION: "1" })) vi.stubEnv(key, value);
  getHealth = (await import("@/app/api/agent/runtime/hermes/health/route")).GET;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function setup(status: () => number, waitForModels?: Promise<void>) {
  const probes: Array<{ authorization: string | null }> = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/health")) return Response.json({ status: "ok", version: "0.19.0" });
    if (url.endsWith("/models")) {
      probes.push({ authorization: new Headers(init?.headers).get("Authorization") });
      await waitForModels;
      return Response.json({ data: [] }, { status: status() });
    }
    return Response.json({}, { status: 503 });
  }));
  const GET = getHealth;
  const read = async () => (await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"))).json();
  return { read, probes };
}

describe("Provider readiness probe", () => {
  it.each([[200, "ready"], [401, "invalid"], [403, "invalid"], [429, "unreachable"], [503, "unreachable"], [404, "unreachable"]])("classifies HTTP %s without mistaking temporary errors for missing configuration", async (httpStatus, expected) => {
    const { read } = await setup(() => httpStatus as number);
    const payload = await read();
    expect(payload.providerStatus).toBe(expected);
    expect(payload.providerDiagnostic).toMatchObject({ credentialConfigured: true, lastHttpStatus: httpStatus });
    expect(JSON.stringify(payload)).not.toContain("provider-synthetic");
  });
  it("returns non-ready health while a cold official tool registry is pending", async () => {
    let release!: () => void;
    const registry = new Promise<void>(resolve => { release = resolve; });
    let toolReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      if (url.endsWith("/models")) return Response.json({ data: [] });
      if (url.endsWith("/v1/toolsets")) { toolReads++; await registry; return Response.json({ object: "list", data: [] }); }
      return Response.json({}, { status: 503 });
    }));
    const GET = getHealth;
    const response = await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"));
    expect((await response.json()).runtimeHealth.runReady).toBe(false);
    expect(toolReads).toBe(1);
    release();
  });
  it("does not let an old generation's slow registry overwrite the new one", async () => {
    let release!: () => void;
    const oldRegistry = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok" });
      if (url.endsWith("/models")) return Response.json({ data: [] });
      if (url.endsWith("/v1/toolsets")) {
        reads++;
        if (reads === 1) { await oldRegistry; return Response.json({ object: "list", data: [{ name: "old", enabled: true, tools: ["old-tool"] }] }); }
        return Response.json({ object: "list", data: [{ name: "new", enabled: true, tools: ["new-tool"] }] });
      }
      return Response.json({}, { status: 503 });
    }));
    const read = async () => (await getHealth(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"))).json();
    await read(); vi.stubEnv("CAREERADAPT_HERMES_CONFIG_GENERATION", "2");
    expect((await read()).runtimeHealth.hermesVisibleTools).toEqual(["new-tool"]);
    release(); await Promise.resolve();
    expect((await read()).runtimeHealth.hermesVisibleTools).toEqual(["new-tool"]);
    expect(reads).toBe(2);
  });
  it("coalesces concurrent probes and caches normal readiness polling", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const { read, probes } = await setup(() => 200, pending);
    const first = read(), second = read();
    await vi.waitFor(() => expect(probes).toHaveLength(1));
    release(); await Promise.all([first, second]);
    await read(); expect(probes).toHaveLength(1);
  });
  it("expires temporary failure cache, preserving the original HTTP evidence", async () => {
    let now = Date.now(), status = 429;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { read, probes } = await setup(() => status);
    expect((await read()).providerDiagnostic.safeErrorCode).toBe("provider_http_429");
    status = 200; now += 59_000;
    expect((await read()).providerStatus).toBe("unreachable"); expect(probes).toHaveLength(1);
    now += 1_001;
    expect((await read()).providerStatus).toBe("ready"); expect(probes).toHaveLength(2);
  });
  it("invalidates immediately when credential, generation or model changes", async () => {
    const { read, probes } = await setup(() => 200);
    await read();
    vi.stubEnv("AI_API_KEY", "new-synthetic"); vi.stubEnv("HERMES_CUSTOM_CAREERADAPT_API_KEY", "new-synthetic");
    await read(); expect(probes).toHaveLength(2);
    expect(probes[1].authorization).toBe("Bearer new-synthetic");
    vi.stubEnv("CAREERADAPT_HERMES_CONFIG_GENERATION", "2"); await read(); expect(probes).toHaveLength(3);
    vi.stubEnv("AI_MODEL", "new-model"); vi.stubEnv("HERMES_MODEL", "new-model"); await read(); expect(probes).toHaveLength(4);
  });
  it("does not make a request after credentials are explicitly cleared", async () => {
    const { read, probes } = await setup(() => 200); await read();
    vi.stubEnv("AI_API_KEY", ""); vi.stubEnv("HERMES_CUSTOM_CAREERADAPT_API_KEY", "");
    expect((await read()).providerStatus).toBe("unconfigured"); expect(probes).toHaveLength(1);
  });
});
