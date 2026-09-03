import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { HermesSupervisor } = require("../../electron/hermesSupervisor.js") as {
  HermesSupervisor: new (options: Record<string, unknown>) => {
    start(settings?: unknown): Promise<Record<string, unknown>>;
    rendererHostReady(settings?: unknown): Promise<Record<string, unknown>>;
    updateConfig(settings?: unknown): Promise<Record<string, unknown>>;
    resetConfig(): Promise<Record<string, unknown>>;
    getConfig(): Promise<Record<string, unknown>>;
    recover(): Promise<Record<string, unknown>>;
    shutdown(): Promise<Record<string, unknown>>;
    applyHealth(health: Record<string, unknown>): void;
    getStatus(): Record<string, unknown>;
    startCompanion: (input: Record<string, unknown>) => Promise<unknown>;
  };
};

const supervisors: Array<InstanceType<typeof HermesSupervisor>> = [];

afterEach(async () => {
  await Promise.all(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
});

function createHealth(overrides: Record<string, unknown> = {}) {
  const careerDomainContracts = Array.from({ length: 56 }, (_, index) => `career.domain.${index}`);
  const productionTools = Array.from({ length: 15 }, (_, index) => `career.production.${index}`);
  return {
    available: true,
    version: "0.19.0",
    provider: "https://provider.example/v1",
    model: "mimo-v2.5-pro",
    providerStatus: "ready",
    runtimeHealth: {
      runtimeAvailable: true,
      companionReady: true,
      providerConfigured: true,
      providerReachable: true,
      providerReady: true,
      mcpConnected: true,
      mcpReady: true,
      mcpToolCount: productionTools.length,
      browserCareerDomainHostConnected: true,
      careerMcpServerReachable: true,
      careerMcpContractCount: productionTools.length,
      hermesMcpRegistered: true,
      hermesMcpToolCount: productionTools.length,
      careerSkillsLoaded: true,
      requiredCareerFacadesMissing: [],
      careerGatewayContracts: careerDomainContracts,
      careerMcpExposedTools: productionTools,
      hermesRegisteredToolsets: ["careeradapt"],
      hermesVisibleTools: productionTools,
      runReady: true
    },
    ...overrides
  };
}

function createHarness(initialHealth = createHealth(), options: Record<string, unknown> = {}) {
  const nativeModelConfigEnabled = options.nativeModelConfig === true;
  const nativeReadbackProvider = typeof options.nativeReadbackProvider === "string" ? options.nativeReadbackProvider : undefined;
  const baseHealth = initialHealth;
  let currentHealth: Record<string, unknown> = initialHealth;
  let nextStartHealth: Record<string, unknown> | undefined;
  let startCount = 0;
  let stopCount = 0;
  let modelSetCount = 0;
  let modelInfoCount = 0;
  const modelSetBodies: Array<Record<string, unknown>> = [];
  const credentialWrites: Array<Record<string, unknown>> = [];
  const customProviderWrites: Array<Record<string, unknown>> = [];
  let modelConfig = {
    provider: "custom:careeradapt",
    model: "mimo-v2.5-pro",
    baseUrl: "https://provider.example/v1"
  };
  const children: Array<EventEmitter & { exitCode: number | null }> = [];
  const startInputs: Array<{ environment?: Record<string, string>; reuseExistingRuntime?: boolean }> = [];
  const startCompanion = async (input: { environment?: Record<string, string> }) => {
    startCount += 1;
    startInputs.push(input);
    const environment = input.environment ?? {};
    const launchHealth = nextStartHealth ?? baseHealth;
    nextStartHealth = undefined;
    currentHealth = {
      ...launchHealth,
      ...(environment.AI_PROVIDER ? { provider: environment.AI_PROVIDER } : {}),
      ...(environment.AI_MODEL ? { model: environment.AI_MODEL } : {}),
      runtimeHealth: {
        ...(launchHealth.runtimeHealth as Record<string, unknown>),
        ...(environment.AI_MODEL ? { model: environment.AI_MODEL } : {})
      }
    };
    if (nativeModelConfigEnabled) {
      modelConfig = {
        provider: nativeReadbackProvider ?? environment.AI_PROVIDER ?? modelConfig.provider,
        model: environment.AI_MODEL ?? modelConfig.model,
        baseUrl: environment.AI_BASE_URL ?? modelConfig.baseUrl
      };
    }
    const child = Object.assign(new EventEmitter(), { exitCode: null as number | null });
    children.push(child);
    return {
      ok: true,
      owned: true,
      child,
      runtime: { baseUrl: "http://127.0.0.1:18642" },
      logPath: "C:/logs/hermes-runtime.log"
    };
  };
  const stopCompanion = async (handle: { child?: EventEmitter & { exitCode: number | null } }) => {
    stopCount += 1;
    const child = handle.child;
    if (!child || child.exitCode !== null) return;
    child.exitCode = 0;
    child.emit("exit", 0, null);
  };
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    if (url.includes("/api/agent/runtime/hermes/health")) return { ok: true, status: 200, json: async () => currentHealth };
    if (nativeModelConfigEnabled && url.endsWith("/api/model/info")) {
      modelInfoCount += 1;
      return { ok: true, status: 200, json: async () => ({ ...modelConfig, capabilities: {} }) };
    }
    if (nativeModelConfigEnabled && url.endsWith("/api/env")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      credentialWrites.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, key: body.key }) };
    }
    if (nativeModelConfigEnabled && url.endsWith("/api/providers/validate")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      const invalid = body.value === "bad-secret";
      return {
        ok: true,
        status: 200,
        json: async () => invalid
          ? { ok: false, reachable: true, message: "API Key 无效" }
          : { ok: true, reachable: true }
      };
    }
    if (nativeModelConfigEnabled && url.endsWith("/api/providers/custom-endpoints/validate")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      const invalid = body.api_key === "bad-secret";
      return {
        ok: true,
        status: 200,
        json: async () => invalid
          ? { ok: false, reachable: true, message: "API Key 无效" }
          : { ok: true, reachable: true, models: [body.model] }
      };
    }
    if (nativeModelConfigEnabled && url.endsWith("/api/providers/custom-endpoints")) {
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
      customProviderWrites.push(body);
      return { ok: true, status: 200, json: async () => ({ ok: true, provider: "custom:careeradapt" }) };
    }
    if (nativeModelConfigEnabled && url.endsWith("/api/model/set")) {
      modelSetCount += 1;
      const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> & { provider?: string; model?: string; base_url?: string };
      modelSetBodies.push(body);
      modelConfig = {
        provider: nativeReadbackProvider ?? body.provider ?? modelConfig.provider,
        model: body.model ?? modelConfig.model,
        baseUrl: body.base_url ?? modelConfig.baseUrl
      };
      return { ok: true, status: 200, json: async () => ({ ok: true, ...modelConfig, base_url: modelConfig.baseUrl }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const supervisor = new HermesSupervisor({
    projectRoot: process.cwd(),
    appBaseUrl: "http://127.0.0.1:3000",
    environment: {
      HERMES_RUNTIME_URL: "http://127.0.0.1:18642",
      API_SERVER_KEY: "local-test-secret",
      AI_BASE_URL: "https://provider.example/v1",
      AI_MODEL: "mimo-v2.5-pro"
    },
    startCompanion,
    stopCompanion,
    fetchImpl,
    careerSyncPollIntervalMs: 0,
    startupSyncTimeoutMs: 15,
    autoRestartDelaysMs: [0],
    ...options
  });
  supervisors.push(supervisor);
  return {
    supervisor,
    children,
    startInputs,
    getStartCount: () => startCount,
    getStopCount: () => stopCount,
    getModelSetCount: () => modelSetCount,
    getModelSetBodies: () => modelSetBodies,
    getCredentialWrites: () => credentialWrites,
    getCustomProviderWrites: () => customProviderWrites,
    getModelInfoCount: () => modelInfoCount,
    setHealth: (health: Record<string, unknown>) => { currentHealth = health; },
    setNextStartHealth: (health: Record<string, unknown>) => { nextStartHealth = health; }
  };
}

describe("Hermes Supervisor lifecycle", () => {
  it("does not launch before renderer MCP READY and reaches Ready once", async () => {
    const harness = createHarness();
    const beforeReady = await harness.supervisor.start();
    expect(beforeReady.overallState).toBe("stopped");
    expect(harness.getStartCount()).toBe(0);

    const ready = await harness.supervisor.rendererHostReady();
    expect(ready).toMatchObject({
      overallState: "ready",
      processReady: true,
      apiReady: true,
      providerReady: true,
      careerMcpReady: true,
      toolSurfaceReady: true,
      runReady: true,
      careerDomainToolCount: 56,
      hermesCareerToolCount: 15,
      requiredCareerFacadesReady: 8,
      requiredCareerFacadesTotal: 8
    });
    expect(harness.getStartCount()).toBe(1);

    const second = await harness.supervisor.start();
    expect(second.overallState).toBe("ready");
    expect(harness.getStartCount()).toBe(1);
  });

  it("settles bounded tool synchronization as degraded instead of deadlocking in starting", async () => {
    const harness = createHarness(createHealth({
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        browserCareerDomainHostConnected: false,
        careerMcpServerReachable: false,
        mcpConnected: false,
        mcpReady: false,
        runReady: false
      }
    }));
    const result = await harness.supervisor.rendererHostReady();
    expect(result.overallState).toBe("degraded");
    expect(result.reasonCode).toBe("career_mcp_sync_timeout");
    expect(harness.getStartCount()).toBe(1);
  });

  it("does not restart-loop on provider configuration errors", async () => {
    const harness = createHarness(createHealth({
      providerStatus: "invalid",
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        providerReady: false,
        providerReachable: false,
        runReady: false
      }
    }));
    const result = await harness.supervisor.rendererHostReady();
    expect(result.overallState).toBe("degraded");
    expect(result.reasonCode).toBe("configuration_required");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(harness.getStartCount()).toBe(1);
  });

  it("auto-recovers one unexpected child crash and keeps the same supervisor owner", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    harness.children[0].exitCode = 1;
    harness.children[0].emit("exit", 1, null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.getStartCount()).toBe(2);
    expect(harness.supervisor.getStatus().overallState).toBe("ready");
  });

  it("uses one controlled restart to repair a Career tool-surface desync", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    harness.supervisor.applyHealth(createHealth({
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        hermesMcpRegistered: true,
        hermesMcpToolCount: 0,
        careerMcpExposedTools: [],
        hermesVisibleTools: []
      }
    }));
    expect(harness.supervisor.getStatus().overallState).toBe("syncing_career_tools");
    await harness.supervisor.recover();
    expect(harness.getStartCount()).toBe(2);
    expect(harness.supervisor.getStatus().overallState).toBe("ready");
  });

  it("applies provider, endpoint, model, and managed credential together", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });

    const config = await harness.supervisor.getConfig();
    expect(config).toMatchObject({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "stealth/ox-alpha",
      apiKeyConfigured: true,
      credentialSource: "managed_config",
      sources: {
        provider: "managed_config",
        baseUrl: "managed_config",
        model: "managed_config",
        credential: "managed_config"
      },
      runtimeConfigWritable: true
    });

    await harness.supervisor.resetConfig();
    const resetConfig = await harness.supervisor.getConfig();
    expect(resetConfig).toMatchObject({
      provider: "custom:careeradapt",
      baseUrl: "https://provider.example/v1",
      model: "mimo-v2.5-pro",
      credentialSource: "missing"
    });
  });

  it("does not reuse a healthy runtime that is outside the Supervisor ownership boundary", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });

    expect(harness.startInputs).toHaveLength(2);
    expect(harness.startInputs.every((input) => input.reuseExistingRuntime === false)).toBe(true);
  });

  it("keeps one runtime-control credential across provider and model changes", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "provider-secret",
      model: "stealth/ox-alpha"
    });

    expect(harness.startInputs).toHaveLength(2);
    expect(harness.startInputs.map((input) => ({
      runtimeKey: input.environment?.API_SERVER_KEY,
      legacyRuntimeKey: input.environment?.HERMES_RUNTIME_API_KEY,
      ambiguousKey: input.environment?.HERMES_API_KEY
    }))).toEqual([
      { runtimeKey: "local-test-secret", legacyRuntimeKey: "local-test-secret", ambiguousKey: "" },
      { runtimeKey: "local-test-secret", legacyRuntimeKey: "local-test-secret", ambiguousKey: "" }
    ]);
  });

  it("only reports an applied configuration after the running runtime reads it back", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    const result = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });
    const runtimeConfig = result.runtimeConfig as { desiredFingerprint?: string; desiredGeneration?: number };

    expect(result.runtimeConfig).toMatchObject({
      applyStatus: "applied",
      verified: true,
      desired: { provider: "openrouter", model: "stealth/ox-alpha" },
      active: { provider: "openrouter", model: "stealth/ox-alpha" },
      activeFingerprint: runtimeConfig.desiredFingerprint,
      activeGeneration: runtimeConfig.desiredGeneration
    });
    expect(result.lastApplyReceipt).toMatchObject({
      applyStatus: "applied",
      verified: true,
      rollbackOccurred: false,
      restartPerformed: true
    });
    expect(harness.getStartCount()).toBe(2);
  });

  it("does not treat the health proxy diagnostic fingerprint as Hermes readback", async () => {
    const harness = createHarness(createHealth({
      provider: "openrouter",
      model: "stealth/ox-alpha",
      providerDiagnostic: {
        provider: "openrouter",
        model: "stealth/ox-alpha",
        credentialConfigured: true,
        credentialSource: "server_env",
        configFingerprint: "health-proxy-before-managed-apply",
        configGeneration: 99
      },
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        model: "stealth/ox-alpha"
      }
    }));

    const result = await harness.supervisor.rendererHostReady({
      provider: "openai-compatible",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });
    const runtimeConfig = result.runtimeConfig as { active?: { provider?: string; model?: string }; applyStatus?: string; verified?: boolean };

    expect(result).toMatchObject({ overallState: "ready", providerReady: true });
    expect(runtimeConfig).toMatchObject({ applyStatus: "applied", verified: true });
    expect(runtimeConfig.active).toMatchObject({ provider: "openrouter", model: "stealth/ox-alpha" });
  });

  it("switches back to the previous provider shape with one controlled restart", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "openrouter-secret",
      model: "stealth/ox-alpha"
    });

    const result = await harness.supervisor.updateConfig({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: "mimo-secret",
      model: "mimo-v2.5-pro"
    });
    const runtimeConfig = result.runtimeConfig as { desiredFingerprint?: string };

    expect(runtimeConfig).toMatchObject({
      applyStatus: "applied",
      verified: true,
      active: { provider: "custom:careeradapt", baseUrl: "https://provider.example/v1", model: "mimo-v2.5-pro" },
      activeFingerprint: runtimeConfig.desiredFingerprint
    });
    expect(harness.getStartCount()).toBe(2);
  });

  it("performs one bounded rollback when the new Provider cannot become ready", async () => {
    const harness = createHarness(createHealth(), {
      environment: {
        HERMES_RUNTIME_URL: "http://127.0.0.1:18642",
        API_SERVER_KEY: "local-test-secret",
        AI_BASE_URL: "https://provider.example/v1",
        AI_MODEL: "mimo-v2.5-pro",
        HERMES_CUSTOM_CAREERADAPT_API_KEY: "initial-secret"
      }
    });
    await harness.supervisor.rendererHostReady();
    harness.setNextStartHealth(createHealth({
      providerStatus: "invalid",
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        providerReady: false,
        providerReachable: false,
        runReady: false
      }
    }));

    const result = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "bad-secret",
      model: "bad/model"
    });
    expect(result.runtimeConfig).toMatchObject({
      applyStatus: "rolled_back",
      verified: false,
      rollbackOccurred: true,
      active: { provider: "custom:careeradapt", model: "mimo-v2.5-pro" },
      desired: { provider: "openrouter", model: "bad/model" },
      activeGeneration: 1,
      desiredGeneration: 2
    });
    expect(result.lastApplyReceipt).toMatchObject({ applyStatus: "rolled_back", verified: false, rollbackOccurred: true });
    expect(harness.getStartCount()).toBe(3);
  });

  it("applies a native model change during an active semantic run without restarting Hermes", async () => {
    const harness = createHarness(createHealth(), { nativeModelConfig: true });
    await harness.supervisor.rendererHostReady();
    harness.supervisor.applyHealth(createHealth({
      activeRunId: "run-1",
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        activeRunId: "run-1",
        runState: "running"
      }
    }));

    const result = await harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });

    expect(harness.getStartCount()).toBe(1);
    expect(result.runtimeConfig).toMatchObject({
      applyStatus: "applied",
      restartPerformed: false,
      active: { provider: "openrouter", model: "stealth/ox-alpha", credentialConfigured: true },
      desired: { provider: "openrouter", model: "stealth/ox-alpha" }
    });
    expect(harness.getModelSetCount()).toBe(1);
  });

  it("accepts Hermes named custom-provider readback as the requested custom identity", async () => {
    const harness = createHarness(createHealth(), { nativeModelConfig: true, nativeReadbackProvider: "custom:careeradapt" });
    await harness.supervisor.rendererHostReady();

    const result = await harness.supervisor.updateConfig({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: "managed-secret",
      model: "custom-model"
    });

    expect(result.runtimeConfig).toMatchObject({
      applyStatus: "applied",
      verified: true,
      restartPerformed: false,
      active: { provider: "custom:careeradapt", model: "custom-model", credentialConfigured: true }
    });
    expect(harness.getStartCount()).toBe(1);
    expect(harness.getStopCount()).toBe(0);
  });

  it("coalesces twenty native model applies into one write without a lifecycle restart", async () => {
    const harness = createHarness(createHealth(), { nativeModelConfig: true });
    await harness.supervisor.rendererHostReady();
    const draft = {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "z-ai/glm-5.3-flash"
    };

    const results = await Promise.all(Array.from({ length: 20 }, () => harness.supervisor.updateConfig(draft)));

    expect(harness.getStartCount()).toBe(1);
    expect(harness.getStopCount()).toBe(0);
    expect(harness.getModelSetCount()).toBe(1);
    expect(harness.getModelSetBodies()).toEqual([expect.objectContaining({
      scope: "main",
      provider: "openrouter",
      model: draft.model,
      base_url: draft.baseUrl,
      api_key: "",
      confirm_expensive_model: true
    })]);
    expect(harness.getCredentialWrites()).toEqual([expect.objectContaining({ key: "OPENROUTER_API_KEY", value: draft.apiKey })]);
    expect(results.every((result) => (result.runtimeConfig as { active?: { model?: string } }).active?.model === draft.model)).toBe(true);
    expect(results.at(-1)?.lastApplyReceipt).toMatchObject({ applyStatus: "applied", restartPerformed: false, verified: true });
  });

  it("does not attach a stale provider diagnostic to the verified active configuration", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    harness.supervisor.applyHealth(createHealth({
      provider: "https://openrouter.ai/api/v1",
      model: "stale/model",
      providerStatus: "invalid",
      providerDiagnostic: {
        provider: "openrouter",
        model: "stale/model",
        credentialConfigured: true,
        credentialSource: "managed_config",
        configFingerprint: "stale-fingerprint",
        configGeneration: 99,
        lastHttpStatus: 401,
        safeErrorCode: "provider_http_401"
      },
      runtimeHealth: {
        ...createHealth().runtimeHealth,
        providerReady: false,
        providerReachable: false,
        providerStatus: "invalid",
        model: "stale/model",
        runReady: false,
        providerDiagnostic: {
          provider: "openrouter",
          model: "stale/model",
          credentialConfigured: true,
          credentialSource: "managed_config",
          configFingerprint: "stale-fingerprint",
          configGeneration: 99,
          lastHttpStatus: 401,
          safeErrorCode: "provider_http_401"
        }
      }
    }));

    expect(harness.supervisor.getStatus()).toMatchObject({
      overallState: "degraded",
      reasonCode: "configuration_desync",
      provider: "custom:careeradapt",
      model: "mimo-v2.5-pro",
      providerReady: false
    });
    expect(harness.supervisor.getStatus().providerDiagnostic).toBeUndefined();
  });

  it("keeps the last active configuration visible while a replacement is applying", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    const originalStartCompanion = harness.supervisor.startCompanion;
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    harness.supervisor.startCompanion = async (input: Record<string, unknown>) => {
      await startGate;
      return originalStartCompanion(input);
    };

    const applyPromise = harness.supervisor.updateConfig({
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "stealth/ox-alpha"
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

   expect(harness.supervisor.getStatus()).toMatchObject({
     model: "mimo-v2.5-pro",
      runtimeConfig: {
        applyStatus: "restarting_runtime",
        active: { model: "mimo-v2.5-pro" },
        desired: { model: "stealth/ox-alpha" }
     }
   });
    expect(["starting", "restarting"]).toContain(harness.supervisor.getStatus().overallState);

    releaseStart();
    await applyPromise;
  });

  it("accepts one configuration mutation while rapid requests share its result", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();
    const originalStartCompanion = harness.supervisor.startCompanion;
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => { releaseStart = resolve; });
    harness.supervisor.startCompanion = async (input: Record<string, unknown>) => {
      await startGate;
      return originalStartCompanion(input);
    };

    const firstDraft = {
      provider: "openrouter",
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "managed-secret",
      model: "first-model"
    };
    const requests = Array.from({ length: 20 }, (_, index) => harness.supervisor.updateConfig({
      ...firstDraft,
      model: index === 0 ? firstDraft.model : "second-model"
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.getStartCount()).toBe(1);

    releaseStart();
    const results = await Promise.all(requests);
    expect(harness.getStartCount()).toBe(2);
    expect(results.every((result) => (result.runtimeConfig as { active?: { model?: string } }).active?.model === "first-model")).toBe(true);
  });

  it("treats an already active configuration as a no-op without restarting", async () => {
    const harness = createHarness();
    await harness.supervisor.rendererHostReady();

    const result = await harness.supervisor.updateConfig();

    expect(harness.getStartCount()).toBe(1);
    expect(result.runtimeConfig).toMatchObject({ applyStatus: "applied", restartPerformed: false, verified: true });
    expect(result.lastApplyReceipt).toMatchObject({ applyStatus: "applied", restartPerformed: false, verified: true });
  });
});
