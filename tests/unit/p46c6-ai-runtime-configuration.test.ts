import { afterEach, describe, expect, it, vi } from "vitest";
import { requestHermesConfigUpdate } from "@/services/agent/hermesControl";
import {
  normalizeAiRuntimeConfigDraft,
  runtimeConfigFingerprintPayload,
  validateAiRuntimeConfigDraft,
  type AiRuntimeConfigActive
} from "@/services/agent/aiRuntimeConfiguration";
import type { HermesControlResult } from "@/services/agent/hermesControl";

const active: AiRuntimeConfigActive = {
  provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1",
  model: "stealth/ox-alpha",
  credentialConfigured: true,
  credentialSource: "managed_config",
  configFingerprint: "active-fingerprint",
  configGeneration: 4,
  source: "runtime_readback",
  lastAppliedAt: new Date().toISOString()
};

function appliedResult(): HermesControlResult {
  return {
    ok: true,
    snapshot: {
      overallState: "ready",
      processReady: true,
      apiReady: true,
      providerReady: true,
      careerMcpReady: true,
      toolSurfaceReady: true,
      runReady: true,
      careerSkillsReady: true,
      updatedAt: new Date().toISOString(),
      restartAttempt: 0,
      uptimeMs: 1,
      careerDomainToolCount: 56,
      hermesCareerToolCount: 15,
      requiredCareerFacadesReady: 8,
      requiredCareerFacadesTotal: 8,
      latestLifecycleEntries: [],
      runtimeConfig: {
        active,
        desired: active,
        activeFingerprint: active.configFingerprint,
        desiredFingerprint: active.configFingerprint,
        activeGeneration: active.configGeneration,
        desiredGeneration: active.configGeneration,
        applyStatus: "applied",
        restartPerformed: true,
        verified: true,
        rollbackOccurred: false
      }
    },
    receipt: {
      action: "update_config",
      requestedAt: new Date().toISOString(),
      accepted: true,
      executed: true,
      previousState: "running",
      nextState: "running",
      safeReasonCode: "configuration_applied",
      controlOwner: "electron_supervisor",
      applyStatus: "applied",
      desiredFingerprint: active.configFingerprint,
      activeFingerprint: active.configFingerprint,
      restartPerformed: true,
      verified: true,
      rollbackOccurred: false
    }
  };
}

afterEach(() => {
  localStorage.clear();
  delete window.careerAdaptDesktop;
  vi.restoreAllMocks();
});

describe("P4.6c unified AI runtime configuration", () => {
  it("keeps provider identity separate from the endpoint URL in the canonical fingerprint", () => {
    const parsed = JSON.parse(runtimeConfigFingerprintPayload({
      provider: "https://openrouter.ai/api/v1",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "stealth/ox-alpha",
      apiKey: "never-persisted-in-this-test-result"
    })) as { provider: string; baseUrl: string };

    expect(parsed.provider).toBe("openrouter");
    expect(parsed.provider).not.toMatch(/^https?:\/\//u);
    expect(parsed.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("rejects an invalid endpoint before persistence or runtime command", () => {
    const result = validateAiRuntimeConfigDraft(normalizeAiRuntimeConfigDraft({
      provider: "openai-compatible",
      baseUrl: "ftp://not-an-http-provider",
      apiKey: "secret",
      model: "model",
      credentialAction: "replace"
    }));

    expect(result).toBe("provider_base_url_protocol_invalid");
    expect(localStorage.getItem("careeradapt-ai-settings")).toBeNull();
  });

  it("marks web configuration changes as renderer-ready for the Supervisor", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(appliedResult()), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    await requestHermesConfigUpdate({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "web-secret",
      model: "stealth/ox-alpha",
      credentialAction: "replace"
    });

    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      action: "update_config",
      rendererReady: true
    });
  });
});
