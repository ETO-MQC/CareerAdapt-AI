import { NextRequest } from "next/server";
import { POST } from "@/app/api/agent/runtime/hermes/route";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyHermesRunFailure, companionHealthFailure } from "@/agent/runtime/hermes/hermesRunReliability";
import { HttpHermesBridgeTransport, mapOfficialHermesEvent } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { createHermesControlSnapshot, hermesControlFeedback, humanHermesReason, providerCredentialFeedback, type HermesSupervisorSnapshot } from "@/services/agent/hermesControl";

const credential = { available: true, configured: true, source: "secure_store" as const };
function degraded(overrides: Partial<HermesSupervisorSnapshot> = {}): HermesSupervisorSnapshot {
  return { overallState: "degraded", processReady: true, apiReady: false, providerReady: false,
    careerMcpReady: true, toolSurfaceReady: false, runReady: false, careerSkillsReady: false,
    reasonCode: "hermes_companion_unreachable", updatedAt: new Date().toISOString(), restartAttempt: 0,
    uptimeMs: 0, careerDomainToolCount: 0, hermesCareerToolCount: 0, requiredCareerFacadesReady: 0,
    requiredCareerFacadesTotal: 7, latestLifecycleEntries: [], credentialConfigured: true,
    credentialSource: "secure_store", runtimeConfig: { applyStatus: "idle", rollbackOccurred: false }, ...overrides };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("R2-OBS-01 evidence-based error propagation", () => {
  it.each([
    [{ code: "auth_failed" }, "control_plane", "runtime_control_auth"],
    [{ code: "auth_failed", failureLayer: "provider", httpStatus: 401 }, "provider", "provider_auth"],
    [{ code: "provider_http_401" }, "provider", "provider_auth"]
  ] as const)("preserves structured auth evidence through the real Next run boundary: %j", async (error, layer, category) => {
    vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:18643");
    vi.stubEnv("API_SERVER_KEY", "synthetic-control");
    vi.stubEnv("HERMES_RUNTIME_PROTOCOL", "official");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error }, { status: 401 })));
    const response = await POST(new NextRequest("http://localhost/api/agent/runtime/hermes", { method: "POST", body: JSON.stringify({ action: "run_start", sessionId: "anonymous-session", userMessage: "hello" }) }));
    expect((await response.json()).error.diagnostics).toMatchObject({ failureLayer: layer, safeErrorCategory: category, httpStatus: 401 });
  });

  it.each([200, 401])("preserves restored secure-store provenance through the actual health route with Provider HTTP %s", async (providerHttpStatus) => {
    vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:18643");
    vi.stubEnv("API_SERVER_KEY", "r2-control-synthetic");
    vi.stubEnv("AI_PROVIDER", "openai-compatible");
    vi.stubEnv("HERMES_PROVIDER", "openai-compatible");
    vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:18644/v1");
    vi.stubEnv("HERMES_BASE_URL", "http://127.0.0.1:18644/v1");
    vi.stubEnv("AI_API_KEY", "r2-provider-synthetic");
    vi.stubEnv("HERMES_CUSTOM_CAREERADAPT_API_KEY", "r2-provider-synthetic");
    vi.stubEnv("AI_MODEL", "r2-test");
    vi.stubEnv("HERMES_MODEL", "r2-test");
    vi.stubEnv("CAREERADAPT_CREDENTIAL_SOURCE", "secure_store");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/health")) return Response.json({ status: "ok", version: "0.19.0" });
      if (url.endsWith("/models")) return Response.json({ data: [{ id: "r2-test" }] }, { status: providerHttpStatus });
      return Response.json({}, { status: 503 });
    }));
    const { GET } = await import("@/app/api/agent/runtime/hermes/health/route");
    const response = await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.runtimeHealth).toMatchObject({ companionReady: true, providerReady: providerHttpStatus === 200,
      providerDiagnostic: { credentialConfigured: true, credentialSource: "secure_store", lastHttpStatus: providerHttpStatus } });
    expect(JSON.stringify(payload)).not.toContain("r2-provider-synthetic");
  });
  it("exports an allowlisted exception type without its sensitive message", () => {
    expect(companionHealthFailure(Object.assign(new Error("private-key"), { name: "ZodError" })))
      .toMatchObject({ safeErrorCode: "hermes_health_check_failed", upstreamErrorCode: "ZodError", safeErrorCategory: "unknown" });
    expect(JSON.stringify(companionHealthFailure(new TypeError("private-key")))).not.toContain("private-key");
    expect(companionHealthFailure({ name: "private-key" }).upstreamErrorCode).toBeUndefined();
  });
  it("keeps restored storage, unreachable Companion and ready MCP independent", () => {
    const snapshot = createHermesControlSnapshot({ environment: "electron", supervisor: degraded() });
    expect(snapshot).toMatchObject({ ready: false, apiReady: false, providerReady: false, careerMcpReady: true,
      diagnosticReasonCode: "hermes_companion_unreachable", runtimeConfig: { applyStatus: "idle" },
      providerDiagnostic: { credentialConfigured: true, credentialSource: "secure_store" } });
    expect(providerCredentialFeedback(credential)).toContain("已安全保存");
    expect(hermesControlFeedback(snapshot)).toContain("Companion 不可达");
    expect(hermesControlFeedback(snapshot)).not.toMatch(/无效|额度不足|429/);
  });
  it("retains configured storage when Provider authentication actually fails", () => {
    const failure = mapOfficialHermesEvent("run.failed", { code: "provider_http_401", http_status: 401 });
    expect(failure).toMatchObject({ code: "hermes_provider_auth_failed", data: { diagnostics: { failureLayer: "provider", httpStatus: 401, safeErrorCategory: "provider_auth" } } });
    expect(providerCredentialFeedback(credential)).toContain("已安全保存");
  });
  it("classifies an actual structured Provider 429 without claiming quota exhaustion", () => {
    expect(mapOfficialHermesEvent("run.failed", { code: "provider_http_429", http_status: 429 })).toMatchObject({
      data: { diagnostics: { httpStatus: 429, failureLayer: "provider", safeErrorCategory: "provider_rate_limit" } }
    });
    expect(humanHermesReason("provider_http_429")).toContain("不能确定额度已耗尽");
  });
  it("preserves Provider status across a bridge HTTP 502 envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: {
      code: "provider_http_429", httpStatus: 429, failureLayer: "provider", message: "request rejected"
    } }), { status: 502 })));
    await expect(new HttpHermesBridgeTransport().getRun("r2-run")).rejects.toMatchObject({
      diagnostics: { httpStatus: 429, failureLayer: "provider", safeErrorCategory: "provider_rate_limit" }
    });
  });
  it("preserves Provider diagnostics when the event-stream endpoint returns an error envelope", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: {
      code: "provider_http_429", diagnostics: { httpStatus: 429, failureLayer: "provider", safeErrorCategory: "provider_rate_limit" }
    } }), { status: 502 })));
    await expect(new HttpHermesBridgeTransport().runEvents("r2-run")[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      diagnostics: { httpStatus: 429, failureLayer: "provider", safeErrorCategory: "provider_rate_limit" }
    });
  });
  it("does not label a control-plane 401 as Provider auth", () => {
    expect(classifyHermesRunFailure({ code: "gateway_auth_failed", httpStatus: 401, failureLayer: "control_plane" })).toMatchObject({ safeErrorCategory: "runtime_control_auth", failureLayer: "control_plane" });
    expect(classifyHermesRunFailure({ code: "bridge_failed", httpStatus: 401, failureLayer: "bridge_http" }).safeErrorCategory).not.toBe("provider_auth");
  });
  it.each([[true, false], [false, true]])("projects Provider=%s and MCP=%s separately", (providerReady, careerMcpReady) => {
    const snapshot = createHermesControlSnapshot({ environment: "electron", supervisor: degraded({ apiReady: true, providerReady, careerMcpReady }) });
    expect(snapshot).toMatchObject({ providerReady, careerMcpReady, ready: false });
  });
  it("retains safe domain tool code and redacts failure message", () => {
    const secret = "sk-r2-test-secret-value";
    const event = mapOfficialHermesEvent("tool.completed", { tool_name: "career_write", result: { ok: false, code: "revision_conflict", message: `Authorization: Bearer ${secret}` } });
    expect(event).toMatchObject({ type: "tool_call_failed", code: "revision_conflict" });
    expect(JSON.stringify(event)).not.toContain(secret);
  });
  it("never infers credentials, HTTP status or timeout from unknown free text", () => {
    expect(classifyHermesRunFailure({ code: "unexpected_failure", message: "API key invalid; provider timeout HTTP 429" })).toMatchObject({ safeErrorCategory: "unknown", safeErrorCode: "unexpected_failure" });
    expect(classifyHermesRunFailure({ code: "unexpected_failure", message: "HTTP 401" }).httpStatus).toBeUndefined();
    expect(classifyHermesRunFailure({ code: "unexpected_failure", httpStatus: 401 }).safeErrorCategory).not.toBe("provider_auth");
  });
  it.each(["credential_store_read_failed", "credential_store_unavailable", "provider_credential_missing"])("classifies credential evidence %s separately", (code) => {
    expect(classifyHermesRunFailure({ code })).toMatchObject({ safeErrorCode: code, safeErrorCategory: "credential_unavailable", retryable: false });
  });
  it.each([["provider_timeout", "provider", "provider_timeout"], ["hermes_run_events_timeout", "bridge_http", "request_timeout"], ["provider_connection_failed", "provider", "transport_failure"]] as const)("keeps %s stage", (code, failureLayer, safeErrorCategory) => {
    expect(classifyHermesRunFailure({ code, failureLayer })).toMatchObject({ safeErrorCategory, failureLayer });
  });
  it("exports only allowlisted network evidence from a sensitive exception", () => {
    const error = Object.assign(new Error("Authorization: Bearer private-opaque-key"), { cause: { code: "ECONNREFUSED", headers: { Authorization: "private-opaque-key" } } });
    const diagnostics = companionHealthFailure(error);
    expect(diagnostics).toMatchObject({ safeErrorCode: "hermes_companion_unreachable", upstreamErrorCode: "ECONNREFUSED", failureLayer: "companion" });
    expect(JSON.stringify(diagnostics)).not.toContain("private-opaque-key");
    expect(companionHealthFailure(new Error("API Key HTTP 429"))).toMatchObject({ safeErrorCode: "hermes_health_check_failed", safeErrorCategory: "unknown" });
  });
  it("keeps an explicit health timeout separate from credential failure", () => {
    expect(companionHealthFailure(new DOMException("private timeout text", "TimeoutError"))).toMatchObject({
      safeErrorCode: "hermes_companion_unreachable", upstreamErrorCode: "TimeoutError", failureLayer: "companion"
    });
  });
  it("redacts quoted credential configuration in diagnostics", () => {
    const diagnostics = classifyHermesRunFailure({ code: "unexpected_failure", message: '{"apiKey":"opaque-value", "Authorization":"Bearer opaque-header"}' });
    expect(JSON.stringify(diagnostics)).not.toMatch(/opaque-value|opaque-header/);
  });
  it("preserves safe network evidence in the actual health route without blaming Provider", async () => {
    vi.stubEnv("HERMES_RUNTIME_URL", "http://127.0.0.1:18642");
    vi.stubEnv("API_SERVER_KEY", "r2-control-synthetic");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url === "http://127.0.0.1:18642/health") throw Object.assign(new TypeError("fetch failed with private-key"), { cause: { code: "ECONNREFUSED" } });
      return new Response(JSON.stringify({}), { status: 503 });
    }));
    const { GET } = await import("@/app/api/agent/runtime/hermes/health/route");
    const response = await GET(new Request("http://127.0.0.1:3000/api/agent/runtime/hermes/health"));
    const payload = await response.json();
    expect(response.status).toBe(503);
    expect(payload).toMatchObject({ available: false, reason: "hermes_companion_unreachable", providerStatus: "unknown",
      runtimeHealth: { companionReady: false, providerReady: false, runtimeFailureDiagnostics: {
        failureLayer: "companion", upstreamErrorCode: "ECONNREFUSED"
      } } });
    expect(JSON.stringify(payload)).not.toContain("private-key");
  });
  it("uses actual apply receipt even with normal stored credentials", () => {
    const snapshot = createHermesControlSnapshot({ environment: "electron", supervisor: degraded({ runtimeConfig: { applyStatus: "failed", rollbackOccurred: false } }) });
    expect(snapshot.runtimeConfig.applyStatus).toBe("failed");
    expect(hermesControlFeedback(snapshot)).toContain("Companion 不可达");
    expect(providerCredentialFeedback(credential)).toContain("已安全保存");
  });
});
