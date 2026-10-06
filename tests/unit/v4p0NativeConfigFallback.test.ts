import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * V4-P0 blocker verification: does the native-model-config 404 fallback actually work?
 *
 * The bundled Hermes gateway exposes neither /api/model/info nor /api/model/set (they exist
 * only in the dashboard server). These tests pin the observed production behaviour so the
 * restart fallback can be formalised instead of guessed at, and so no regression silently
 * turns the fallback into a broken path.
 */

const require = createRequire(import.meta.url);
const { HermesSupervisor } = require("../../electron/hermesSupervisor.js") as {
  HermesSupervisor: new (options: Record<string, unknown>) => {
    start(settings?: unknown): Promise<Record<string, unknown>>;
    rendererHostReady(settings?: unknown): Promise<Record<string, unknown>>;
    updateConfig(settings?: unknown): Promise<Record<string, unknown>>;
    getConfig(): Promise<Record<string, unknown>>;
    getStatus(): Record<string, unknown>;
    shutdown(): Promise<Record<string, unknown>>;
  };
};
const { ensureManagedHermesConfig } = require("../../electron/hermesCompanion.js") as {
  ensureManagedHermesConfig: (hermesHome: string, values: Record<string, unknown>) => string;
};

const supervisors: Array<InstanceType<typeof HermesSupervisor>> = [];
const SECRET = "unit-test-provider-secret";

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
});

function createHealth(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    version: "0.19.0",
    provider: "https://provider.example/v1",
    model: "model-before",
    providerStatus: "ready",
    runtimeHealth: {
      runtimeAvailable: true,
      companionReady: true,
      providerConfigured: true,
      providerReachable: true,
      providerReady: true,
      mcpConnected: true,
      mcpReady: true,
      mcpToolCount: 15,
      browserCareerDomainHostConnected: true,
      careerMcpServerReachable: true,
      careerMcpContractCount: 56,
      hermesMcpRegistered: true,
      hermesMcpToolCount: 15,
      careerSkillsLoaded: true,
      requiredCareerFacadesMissing: [],
      careerGatewayContracts: Array.from({ length: 56 }, (_, index) => `career.domain.${index}`),
      careerMcpExposedTools: Array.from({ length: 15 }, (_, index) => `career.production.${index}`),
      hermesRegisteredToolsets: ["careeradapt"],
      hermesVisibleTools: Array.from({ length: 15 }, (_, index) => `career.production.${index}`),
      runReady: true
    },
    ...overrides
  };
}

/**
 * Mirrors production: the gateway answers /api/model/info and /api/model/set with 404, exactly
 * as api_server.py's route table does, and the companion starts with the requested environment.
 */
function createGatewayHarness(options: { nativeModelConfig?: boolean } = {}) {
  const nativeEnabled = options.nativeModelConfig === true;
  let currentHealth = createHealth();
  let startCount = 0;
  let modelInfoCount = 0;
  let modelSetCount = 0;
  const startEnvironments: Array<Record<string, string>> = [];
  const children: Array<EventEmitter & { exitCode: number | null }> = [];

  const startCompanion = async (input: { environment?: Record<string, string> }) => {
    startCount += 1;
    const environment = input.environment ?? {};
    startEnvironments.push(environment);
    currentHealth = {
      ...currentHealth,
      ...(environment.AI_BASE_URL ? { provider: environment.AI_BASE_URL } : {}),
      ...(environment.AI_MODEL ? { model: environment.AI_MODEL } : {})
    };
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    children.push(child);
    return {
      ok: true,
      owned: true,
      child,
      runtime: { baseUrl: "http://127.0.0.1:18642" },
      // Resolved at runtime from the OS temp dir so no machine-specific path is committed; the
      // harness never spawns a real process, so nothing is written to it.
      logPath: path.join(tmpdir(), "careeradapt-v4p0-hermes-runtime.log")
    };
  };

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    if (url.includes("/api/agent/runtime/hermes/health")) return { ok: true, status: 200, json: async () => currentHealth };
    // The gateway does serve these three; capability discovery must see them as supported.
    if (url.endsWith("/v1/capabilities")) return { ok: true, status: 200, json: async () => ({ features: { streaming: true } }) };
    if (url.endsWith("/v1/skills")) return { ok: true, status: 200, json: async () => ({ skills: [] }) };
    if (url.endsWith("/v1/toolsets")) return { ok: true, status: 200, json: async () => ({ toolsets: [] }) };
    if (url.endsWith("/api/model/options")) return { ok: true, status: 200, json: async () => ({ providers: [] }) };
    if (url.endsWith("/api/model/info")) {
      modelInfoCount += 1;
      if (nativeEnabled) return { ok: true, status: 200, json: async () => ({ provider: "openrouter", model: "model-before", base_url: "https://provider.example/v1", capabilities: {} }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (url.endsWith("/api/model/set")) {
      modelSetCount += 1;
      return nativeEnabled
        ? { ok: true, status: 200, json: async () => ({ ok: true, model: "model-after" }) }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    void init;
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const supervisor = new HermesSupervisor({
    projectRoot: process.cwd(),
    appBaseUrl: "http://127.0.0.1:3000",
    environment: {
      HERMES_RUNTIME_URL: "http://127.0.0.1:18642",
      API_SERVER_KEY: "local-test-secret",
      AI_BASE_URL: "https://provider.example/v1",
      AI_MODEL: "model-before",
      AI_API_KEY: SECRET
    },
    startCompanion,
    stopCompanion: async () => undefined,
    fetchImpl,
    careerSyncPollIntervalMs: 0,
    startupSyncTimeoutMs: 15,
    autoRestartDelaysMs: [0]
  });
  supervisors.push(supervisor);

  return {
    supervisor,
    getStartCount: () => startCount,
    getModelInfoCount: () => modelInfoCount,
    getModelSetCount: () => modelSetCount,
    getStartEnvironments: () => startEnvironments,
    setHealth: (health: ReturnType<typeof createHealth> | Record<string, unknown>) => { currentHealth = health as ReturnType<typeof createHealth>; }
  };
}

describe("V4-P0 native model config 404 fallback", () => {
  it("probes /api/model/info and marks native model config unsupported on 404", async () => {
    const harness = createGatewayHarness();
    await harness.supervisor.rendererHostReady();

    expect(harness.getModelInfoCount(), "capability discovery must probe the native endpoint").toBeGreaterThan(0);

    // `nativeModelConfig` is reported under capabilities.features and only when true; the
    // definitive signal that the gateway does not serve the native endpoints is that they are
    // absent from supportedEndpoints.
    const config = (await harness.supervisor.getConfig()) as Record<string, unknown>;
    const capabilities = config.capabilities as {
      supportedEndpoints?: string[];
      unsupportedEndpoints?: string[];
      features?: Record<string, unknown>;
    };

    // The gateway serves these four; it does not serve /api/model/info or /api/model/set.
    expect(capabilities?.supportedEndpoints ?? []).toEqual([
      "/v1/capabilities",
      "/v1/skills",
      "/v1/toolsets",
      "/api/model/options"
    ]);
    expect(capabilities?.supportedEndpoints ?? []).not.toContain("/api/model/info");
    expect(capabilities?.features?.nativeModelConfig ?? false).toBe(false);
    expect(config.runtimeConfigWritable, "settings stay writable through the restart fallback").toBe(true);
  });

  it("applies a new provider and model through the restart fallback and verifies it", async () => {
    const harness = createGatewayHarness();
    await harness.supervisor.rendererHostReady();
    const startsBefore = harness.getStartCount();

    const applied = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://provider-after.example/v1",
      apiKey: SECRET,
      model: "model-after"
    });

    expect(applied.overallState).toBe("ready");
    expect(
      harness.getStartCount(),
      "the fallback must restart the companion so the new binding is picked up"
    ).toBeGreaterThan(startsBefore);
    expect(harness.getModelSetCount(), "the fallback must not call the missing /api/model/set").toBe(0);

    const runtimeConfig = applied.runtimeConfig as Record<string, unknown>;
    expect(runtimeConfig.applyStatus).toBe("applied");
    expect(runtimeConfig.verified).toBe(true);

    const receipt = applied.lastApplyReceipt as Record<string, unknown>;
    expect(receipt.applyStatus).toBe("applied");
    expect(receipt.verified).toBe(true);
    expect(receipt.restartPerformed).toBe(true);

    // The new binding must reach the restarted companion environment.
    const lastEnvironment = harness.getStartEnvironments().at(-1) ?? {};
    expect(lastEnvironment.AI_MODEL).toBe("model-after");
    expect(lastEnvironment.AI_BASE_URL).toBe("https://provider-after.example/v1");
  });

  it("never writes the raw credential into the persisted config", async () => {
    const harness = createGatewayHarness();
    await harness.supervisor.rendererHostReady();

    const applied = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://provider-after.example/v1",
      apiKey: SECRET,
      model: "model-after"
    });

    // The credential is tracked as a source, never echoed back to the caller.
    const config = (await harness.supervisor.getConfig()) as Record<string, unknown>;
    expect(config.apiKeyConfigured, "the credential must be reported as configured, not returned").toBe(true);
    expect(config.credentialSource).toBeTruthy();
    const serialized = JSON.stringify({ applied, config });
    expect(serialized, "neither the apply result nor getConfig may echo the raw credential").not.toContain(SECRET);
  });
  it("falls back to a restart when provider validation is missing even though model info exists", async () => {
    // Production reality: the gateway serves neither /api/model/* nor /api/providers/*. Even if a
    // future build exposes model info, the missing validation endpoint must still degrade to the
    // single-restart fallback instead of failing the apply.
    const harness = createGatewayHarness({ nativeModelConfig: true });
    await harness.supervisor.rendererHostReady();
    const startsBefore = harness.getStartCount();

    const applied = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://provider-after.example/v1",
      apiKey: SECRET,
      model: "model-after"
    });

    expect(applied.overallState).toBe("ready");
    expect(
      harness.getStartCount(),
      "the missing validation endpoint must degrade to a restart, not fail the apply"
    ).toBeGreaterThan(startsBefore);
    expect((applied.runtimeConfig as Record<string, unknown>).applyStatus).toBe("applied");
    expect((applied.runtimeConfig as Record<string, unknown>).verified).toBe(true);
    expect(JSON.stringify(applied)).not.toContain(SECRET);
  });

  it("never writes the raw provider key into config.yaml", () => {
    const hermesHome = mkdtempSync(path.join(tmpdir(), "careeradapt-v4p0-config-"));
    try {
      // Two binding branches are covered: a known provider (OpenRouter, recognised by hostname
      // at hermesProviderBinding.js:16) and a custom provider. Neither may carry the value.
      ensureManagedHermesConfig(hermesHome, {
        provider: "openrouter",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "model-after",
        genericApiKey: SECRET,
        appBaseUrl: "http://127.0.0.1:3000",
        runtimeUrl: "http://127.0.0.1:18642"
      });
      const knownProviderYaml = readFileSync(path.join(hermesHome, "config.yaml"), "utf8");

      ensureManagedHermesConfig(hermesHome, {
        provider: "my-company-gateway",
        baseUrl: "https://provider.example/v1",
        model: "model-after",
        genericApiKey: SECRET,
        appBaseUrl: "http://127.0.0.1:3000",
        runtimeUrl: "http://127.0.0.1:18642"
      });
      const customProviderYaml = readFileSync(path.join(hermesHome, "config.yaml"), "utf8");

      // The requirement is that config.yaml cannot carry the key, not merely that the API
      // response omits it. ensureManagedHermesConfig writes a fixed allowlist of scalars and
      // records only the credential env var name, so the raw value has no path into the file.
      expect(knownProviderYaml, "config.yaml must not contain the raw provider key").not.toContain(SECRET);
      expect(customProviderYaml, "config.yaml must not contain the raw provider key").not.toContain(SECRET);
      expect(knownProviderYaml).toMatch(/injected into Hermes as OPENROUTER_API_KEY/u);
      expect(knownProviderYaml).toMatch(/never stored here/u);
      expect(knownProviderYaml).toContain("openrouter");
      // The custom-provider branch emits key_env, and it must be the env var name, not a value.
      expect(customProviderYaml).toMatch(/key_env: HERMES_CUSTOM_CAREERADAPT_API_KEY/u);
      expect(customProviderYaml, "key_env must never carry a value").not.toMatch(/key_env: [^\n]*unit-test/u);
      // Provider coordinates are expected to be recorded; only the credential is withheld.
      expect(knownProviderYaml).toContain("model-after");
      expect(customProviderYaml).toContain("provider.example");
    } finally {
      rmSync(hermesHome, { recursive: true, force: true });
    }
  });
});
