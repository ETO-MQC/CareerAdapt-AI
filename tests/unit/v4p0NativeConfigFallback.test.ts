import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
function createGatewayHarness(options: { nativeModelConfig?: boolean; hotModel?: boolean; readbackMismatch?: boolean; readbackTimeout?: boolean; failRecovery?: boolean; recoveryReadbackMismatch?: boolean; recoveryBaseUrlMismatch?: boolean; runtimeBusy?: boolean; activityUnavailable?: boolean } = {}) {
  const nativeEnabled = options.nativeModelConfig === true;
  const hermesHome = options.hotModel ? mkdtempSync(path.join(tmpdir(), "careeradapt-model-switch-")) : undefined;
  let currentHealth = createHealth();
  let startCount = 0;
  let modelInfoCount = 0;
  let modelSetCount = 0;
  let modelOptionsCount = 0;
  const startEnvironments: Array<Record<string, string>> = [];
  const children: Array<EventEmitter & { exitCode: number | null }> = [];

  const startCompanion = async (input: { environment?: Record<string, string> }) => {
    startCount += 1;
    const environment = input.environment ?? {};
    if (hermesHome) ensureManagedHermesConfig(hermesHome, {
      provider: environment.AI_PROVIDER || "openai-compatible",
      baseUrl: options.recoveryBaseUrlMismatch && startCount === 2 ? "https://wrong.example/v1" : environment.AI_BASE_URL,
      model: environment.AI_MODEL,
      genericApiKey: SECRET
    });
    startEnvironments.push(environment);
    if (options.failRecovery && environment.AI_MODEL === "next-model") return { ok: false, reason: "hermes_recovery_test_failed" };
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
      ...(hermesHome ? { childEnvironment: { HERMES_HOME: hermesHome } } : {}),
      runtime: { baseUrl: "http://127.0.0.1:18642" },
      // Resolved at runtime from the OS temp dir so no machine-specific path is committed; the
      // harness never spawns a real process, so nothing is written to it.
      logPath: path.join(tmpdir(), "careeradapt-v4p0-hermes-runtime.log")
    };
  };

  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/health/detailed")) return { ok: !options.activityUnavailable, status: options.activityUnavailable ? 503 : 200, json: async () => ({ active_agents: 0, readiness: { checks: { background_queues: { active_api_runs: options.runtimeBusy ? 1 : 0, process_completions: 0, active_delegations: 0 } } } }) };
    if (url.includes("/api/agent/runtime/hermes/health")) return { ok: true, status: 200, json: async () => currentHealth };
    // The gateway does serve these three; capability discovery must see them as supported.
    if (url.endsWith("/v1/capabilities")) return { ok: true, status: 200, json: async () => ({ features: { streaming: true } }) };
    if (url.endsWith("/v1/skills")) return { ok: true, status: 200, json: async () => ({ skills: [] }) };
    if (url.endsWith("/v1/toolsets")) return { ok: true, status: 200, json: async () => ({ toolsets: [] }) };
    if (url.endsWith("/api/model/options")) {
      modelOptionsCount += 1;
      if (options.readbackTimeout && hermesHome && readFileSync(path.join(hermesHome, "config.yaml"), "utf8").includes('default: "next-model"')) {
        throw new DOMException("private endpoint details", "TimeoutError");
      }
      return { ok: true, status: 200, json: async () => ({
      providers: [],
      ...(hermesHome ? {
        model: options.readbackMismatch || (options.recoveryReadbackMismatch && startCount === 2) ? "wrong-model" : JSON.parse(readFileSync(path.join(hermesHome, "config.yaml"), "utf8").match(/^  default: (.+)$/mu)![1]),
        provider: "custom:careeradapt"
      } : {})
    }) };
    }
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
    getModelOptionsCount: () => modelOptionsCount,
    getStartEnvironments: () => startEnvironments,
    getManagedConfig: () => hermesHome ? readFileSync(path.join(hermesHome, "config.yaml"), "utf8") : "",
    setManagedConfig: (content: string) => writeFileSync(path.join(hermesHome!, "config.yaml"), content),
    hermesHome,
    setHealth: (health: ReturnType<typeof createHealth> | Record<string, unknown>) => { currentHealth = health as ReturnType<typeof createHealth>; }
  };
}

describe("V4-P0 native model config 404 fallback", () => {
  const target = { provider: "openai-compatible", baseUrl: "https://provider.example/v1", model: "next-model", apiKey: "", credentialAction: "unchanged" };

  it("rolls back on the captured model readback TimeoutError without numeric code or retry", async () => {
    const harness = createGatewayHarness({ hotModel: true, readbackTimeout: true });
    await harness.supervisor.rendererHostReady();
    const starts = harness.getStartCount();
    const reads = harness.getModelOptionsCount();
    const before = harness.getManagedConfig();
    const applied = await harness.supervisor.updateConfig(target);
    expect(applied.runtimeConfig).toMatchObject({ applyStatus: "rolled_back", verified: false, rollbackOccurred: true });
    expect((await harness.supervisor.getConfig()).lastApplyReceipt).toMatchObject({ reasonCode: "hermes_model_config_timeout", verified: false, rollbackOccurred: true });
    expect(applied.model).toBe("model-before");
    expect(harness.getManagedConfig()).toBe(before);
    expect(harness.getStartCount()).toBe(starts);
    expect(harness.getModelOptionsCount() - reads).toBe(1);
  });

  it("recovers after the current bundled Hermes really saves YAML and preserves all user values", async () => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    const root = path.resolve(".electron-build/hermes-runtime-v4");
    const python = path.join(root, "python/python.exe");
    const pythonEnv = { ...process.env, HERMES_HOME: harness.hermesHome!, PYTHONPATH: [path.join(root, "source"), path.join(root, "site-packages")].join(path.delimiter), PYTHONUTF8: "1" };
    execFileSync(python, ["-c", `from hermes_cli.config import load_config, save_config
c=load_config()
c['model']['temperature']=0.37
c['model']['fallbacks']=[{'provider':'user-provider','model':'keep-model'}]
c['custom_providers'].append({'name':'user-provider','model':'keep-model','base_url':'https://user.example/v1','user_option':True})
c['custom_providers'][0]['user_option']='retained'
c['platform_toolsets']['api_server'].append('user-toolset')
c['platform_toolsets']['telegram']=['user-tools']
c['mcp_servers']['user-server']={'command':'user-command','args':['--keep']}
c['gateway']['user_option']='keep'
c['user_unknown']={'nested':[1,2,3]}
save_config(c)`], { env: pythonEnv, windowsHide: true });
    const saved = harness.getManagedConfig();
    expect(saved).not.toContain("# BEGIN CAREERADAPT MANAGED CONFIG");
    const read = () => JSON.parse(execFileSync(python, ["-c", "import yaml,json,os; print(json.dumps(yaml.safe_load(open(os.path.join(os.environ['HERMES_HOME'],'config.yaml'),encoding='utf-8'))))"], { env: pythonEnv, encoding: "utf8", windowsHide: true }));
    const before = read();
    const starts = harness.getStartCount();
    const result = await harness.supervisor.updateConfig(target);
    expect(result.runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true, restartPerformed: true, active: { provider: "custom:careeradapt", baseUrl: target.baseUrl, model: target.model } });
    expect(harness.getStartCount()).toBe(starts + 1);
    const after = read();
    before.model.default = target.model;
    before.custom_providers[0].model = target.model;
    expect(after).toEqual(before);
    expect(readdirSync(harness.hermesHome!).some(p => p.includes('.recovery-') && readFileSync(path.join(harness.hermesHome!, p), 'utf8') === saved)).toBe(true);
    const hot = await harness.supervisor.updateConfig({ ...target, model: "next-next-model" });
    expect(hot.runtimeConfig).toMatchObject({ applyStatus: "applied", restartPerformed: false });
    expect(read().custom_providers[1].model).toBe("keep-model");
  });

  it.each(["missing", "duplicate", "default_missing", "custom_model_missing"])("recovers %s managed structure without discarding user settings", async (kind) => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    let config = harness.getManagedConfig();
    if (kind === "missing") config = config.replaceAll(/# (?:BEGIN|END) CAREERADAPT MANAGED CONFIG/gu, "# marker removed");
    if (kind === "duplicate") config += "\n# BEGIN CAREERADAPT MANAGED CONFIG\n# empty duplicate\n# END CAREERADAPT MANAGED CONFIG\n";
    if (kind === "default_missing") config = config.replace(/^  default: .+\n/mu, "");
    if (kind === "custom_model_missing") config = config.replace(/^    model: .+\n/mu, "");
    harness.setManagedConfig(config + "\nuser_unknown: keep\n");
    const applied = await harness.supervisor.updateConfig(target);
    expect(applied.runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true, restartPerformed: true });
    expect(harness.getManagedConfig()).toContain("user_unknown: keep");
  });

  it("defers recovery during an active run without touching its config or process", async () => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    harness.setHealth(createHealth({ activeRunId: "active-run" }));
    await harness.supervisor.start();
    const config = harness.getManagedConfig().replaceAll(/# (?:BEGIN|END) CAREERADAPT MANAGED CONFIG/gu, "# marker removed");
    harness.setManagedConfig(config);
    const starts = harness.getStartCount();
    const result = await harness.supervisor.updateConfig(target);
    expect(result.runtimeConfig).toMatchObject({ applyStatus: "deferred", active: { model: "model-before" } });
    expect(result.activeRunId).toBe("active-run");
    expect(harness.getStartCount()).toBe(starts);
    expect(harness.getManagedConfig()).toBe(config);
    harness.setHealth(createHealth({ activeRunId: null }));
    await harness.supervisor.start();
    expect((await harness.supervisor.updateConfig(target)).runtimeConfig).toMatchObject({ applyStatus: "applied" });
  });

  it.each(["start", "readback", "base_url"])("rolls back a recovery %s failure and keeps the original file", async (failure) => {
    const harness = createGatewayHarness({ hotModel: true, failRecovery: failure === "start", recoveryReadbackMismatch: failure === "readback", recoveryBaseUrlMismatch: failure === "base_url" });
    await harness.supervisor.rendererHostReady();
    const config = harness.getManagedConfig().replaceAll(/# (?:BEGIN|END) CAREERADAPT MANAGED CONFIG/gu, "# marker removed");
    harness.setManagedConfig(config);
    const applied = await harness.supervisor.updateConfig(target);
    expect(applied.runtimeConfig).toMatchObject({ applyStatus: "rolled_back", verified: false, rollbackOccurred: true, active: { model: "model-before" } });
    expect(applied.model).toBe("model-before");
    expect(harness.getManagedConfig()).toBe(config);
  });

  it("rejects ambiguous duplicate YAML keys without overwriting the original", async () => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    const config = harness.getManagedConfig().replaceAll(/# (?:BEGIN|END) CAREERADAPT MANAGED CONFIG/gu, "# marker removed") + "\nuser_value: one\nuser_value: two\n";
    harness.setManagedConfig(config);
    const result = await harness.supervisor.updateConfig(target);
    expect(result.runtimeConfig).toMatchObject({ applyStatus: "failed", verified: false });
    expect(result.model).toBe("model-before");
    expect(harness.getManagedConfig()).toBe(config);
  });

  it.each([true, false])("does not restart when real activity is busy/unverifiable (busy=%s)", async busy => {
    const harness = createGatewayHarness({ hotModel: true, runtimeBusy: busy, activityUnavailable: !busy });
    await harness.supervisor.rendererHostReady();
    const config = harness.getManagedConfig().replaceAll(/# (?:BEGIN|END) CAREERADAPT MANAGED CONFIG/gu, "# marker removed");
    harness.setManagedConfig(config);
    const starts = harness.getStartCount();
    const result = await harness.supervisor.updateConfig(target);
    expect(result.runtimeConfig).toMatchObject({ applyStatus: busy ? "deferred" : "failed", active: { model: "model-before" } });
    expect(harness.getStartCount()).toBe(starts);
    expect(harness.getManagedConfig()).toBe(config);
  });

  it("switches the next task model without restarting or stopping an active run", async () => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    harness.setHealth({ ...createHealth(), activeRunId: "ongoing-run" });
    await harness.supervisor.start();
    const starts = harness.getStartCount();
    const beforeConfig = harness.getManagedConfig();
    const applied = await harness.supervisor.updateConfig({
      provider: "openai-compatible", baseUrl: "https://provider.example/v1", model: "next-model",
      apiKey: "", credentialAction: "unchanged"
    });
    expect(harness.getStartCount()).toBe(starts);
    expect(applied.activeRunId).toBe("ongoing-run");
    expect(applied.model).toBe("next-model");
    expect(applied.runtimeConfig).toMatchObject({ applyStatus: "applied", restartPerformed: false, verified: true });
    expect(harness.getManagedConfig().replaceAll("next-model", "model-before")).toBe(beforeConfig);
    expect(harness.getManagedConfig()).not.toContain(SECRET);
  });

  it("restores the old model without restarting when runtime readback disagrees", async () => {
    const harness = createGatewayHarness({ hotModel: true, readbackMismatch: true });
    await harness.supervisor.rendererHostReady();
    const starts = harness.getStartCount();
    const applied = await harness.supervisor.updateConfig({
      provider: "openai-compatible", baseUrl: "https://provider.example/v1", model: "next-model",
      apiKey: "", credentialAction: "unchanged"
    });
    expect(harness.getStartCount()).toBe(starts);
    expect(applied.model).toBe("model-before");
    expect(applied.runtimeConfig).toMatchObject({ applyStatus: "rolled_back", restartPerformed: false, rollbackOccurred: true });
    expect(harness.getManagedConfig()).toContain('default: "model-before"');
    expect(harness.getManagedConfig()).not.toContain("next-model");
  });

  it("restarts when the credential changes even if only the model field also changes", async () => {
    const harness = createGatewayHarness({ hotModel: true });
    await harness.supervisor.rendererHostReady();
    const starts = harness.getStartCount();
    await harness.supervisor.updateConfig({
      provider: "openai-compatible", baseUrl: "https://provider.example/v1", model: "next-model",
      apiKey: "replacement-test-key", credentialAction: "replace"
    });
    expect(harness.getStartCount()).toBeGreaterThan(starts);
  });

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
