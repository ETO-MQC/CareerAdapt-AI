/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const {
  applyEnvironment,
  hermesConfigurationFingerprint,
  loadCareerAdaptEnvironment,
  startHermesCompanion,
  stopHermesCompanion
} = require("./hermesCompanion");

const STARTUP_TIMEOUT_MS = 60_000;
// Career tool discovery is a readiness deadline, not a run liveness deadline.
// A healthy long run must never be stopped because this boot-time check is slow.
const STARTUP_SYNC_TIMEOUT_MS = 60_000;
const HEALTH_TIMEOUT_MS = 12_000;
const STABLE_READY_WINDOW_MS = 60_000;
const AUTO_RESTART_DELAYS_MS = [1_000, 3_000, 10_000];
const CAREER_SYNC_POLL_INTERVAL_MS = 750;
const MAX_LIFECYCLE_ENTRIES = 80;
const MAX_LOG_TAIL_LINES = 100;
const REQUIRED_CAREER_FACADES = 8;
const DEFAULT_PROVIDER_BASE_URL = "https://api.openai.com/v1";

const LIFECYCLE_STATES = [
  "stopped",
  "starting",
  "api_ready",
  "syncing_career_tools",
  "ready",
  "degraded",
  "restarting",
  "unavailable",
  "stopping"
];

/**
 * The only Electron-side owner of the bundled Hermes process.
 *
 * The class deliberately knows about process ownership and safe lifecycle
 * diagnostics only. CareerAdapt session/checkpoint persistence remains in the
 * renderer Host and server-side Gateway.
 */
class HermesSupervisor {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.appBaseUrl = String(options.appBaseUrl || "http://127.0.0.1:3000").replace(/\/$/u, "");
    this.runtimeCwd = options.runtimeCwd || this.projectRoot;
    this.requireBundledRuntime = options.requireBundledRuntime === true;
    this.appPath = options.appPath || this.projectRoot;
    this.hermesRuntimeRoot = options.hermesRuntimeRoot;
    this.hermesHome = options.hermesHome;
    this.logPath = options.logPath || path.join(this.projectRoot, ".next", "dev", "logs", "hermes-runtime.log");
    this.baseEnvironment = { ...(options.environment || process.env) };
    this.initialBaseEnvironment = { ...this.baseEnvironment };
    this.environment = { ...this.baseEnvironment };
    this.broadcast = typeof options.broadcast === "function" ? options.broadcast : () => undefined;
    this.startCompanion = options.startCompanion || startHermesCompanion;
    this.stopCompanion = options.stopCompanion || stopHermesCompanion;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.rendererReady = false;
    this.handle = undefined;
    this.lifecyclePromise = undefined;
    this.commandQueue = Promise.resolve();
    this.autoRestartTimer = undefined;
    this.stableReadyTimer = undefined;
    this.restartAttempt = 0;
    this.startupTimeoutMs = options.startupTimeoutMs || STARTUP_TIMEOUT_MS;
    this.startupSyncTimeoutMs = options.startupSyncTimeoutMs || STARTUP_SYNC_TIMEOUT_MS;
    this.healthTimeoutMs = options.healthTimeoutMs || HEALTH_TIMEOUT_MS;
    this.careerSyncPollIntervalMs = options.careerSyncPollIntervalMs ?? CAREER_SYNC_POLL_INTERVAL_MS;
    this.stableReadyWindowMs = options.stableReadyWindowMs || STABLE_READY_WINDOW_MS;
    this.autoRestartDelaysMs = options.autoRestartDelaysMs || AUTO_RESTART_DELAYS_MS;
    this.runtimeConfigState = {
      active: undefined,
      desired: undefined,
      applyStatus: "idle",
      reasonCode: undefined,
      restartPerformed: false,
      verified: false,
      rollbackOccurred: false,
      lastApplyReceipt: undefined
    };
    this.runtimeProcessState = {
      activeEnvironment: undefined,
      activeSettings: undefined,
      requestedSettings: {},
      credentialAction: undefined,
      pendingTargetFingerprint: undefined,
      observedConfiguration: undefined,
      observedProviderDiagnostic: undefined,
      rollbackInProgress: false
    };
    this.configurationMutationPromise = undefined;
    this.timeline = [];
    this.capabilities = undefined;
    this.maintenancePending = false;
    this.maintenanceReasonCode = undefined;
    this.failureTimeSnapshot = undefined;
    this.snapshot = this.createInitialSnapshot();
  }

  createInitialSnapshot() {
    const manifest = readJsonFile(path.join(this.hermesRuntimeRoot || "", "runtime-manifest.json"));
    return {
      overallState: "stopped",
      processReady: false,
      apiReady: false,
      providerReady: false,
      careerMcpReady: false,
      toolSurfaceReady: false,
      runReady: false,
      careerSkillsReady: false,
      runState: "none",
      reasonCode: "hermes_renderer_not_ready",
      updatedAt: new Date().toISOString(),
      runtimeUrl: this.environment.HERMES_RUNTIME_URL,
      appUrl: this.appBaseUrl,
      version: typeof manifest.hermesVersion === "string" ? manifest.hermesVersion : undefined,
      model: undefined,
      provider: undefined,
      credentialConfigured: false,
      credentialSource: "unknown",
      careerDomainToolCount: 0,
      hermesCareerToolCount: 0,
      requiredCareerFacadesReady: 0,
      requiredCareerFacadesTotal: REQUIRED_CAREER_FACADES,
      restartAttempt: 0,
      uptimeMs: 0,
      logPath: this.logPath,
      latestLifecycleEntries: [],
      capabilities: undefined,
      runtimeConfig: this.runtimeConfigSnapshot(),
      lastApplyReceipt: undefined,
      maintenancePending: false,
      maintenanceReasonCode: undefined,
      failureTimeSnapshot: undefined
    };
  }

  getStatus() {
    const current = this.snapshot;
    const uptimeMs = current.processReady && this.processStartedAt
      ? Math.max(0, Date.now() - this.processStartedAt)
      : 0;
    return {
      ...current,
      uptimeMs,
      restartAttempt: this.restartAttempt,
      latestLifecycleEntries: [...this.timeline]
    };
  }

  async rendererHostReady(requestedSettings) {
    const duplicateReady = this.rendererReady;
    this.rendererReady = true;
    if (!duplicateReady) this.publish({ reasonCode: "renderer_mcp_ready" }, "Renderer MCP/domain host READY");
    return this.ensureStarted(requestedSettings);
  }

  async start(requestedSettings, options = {}) {
    if (!this.rendererReady) {
      this.publish({ overallState: "stopped", reasonCode: "hermes_renderer_not_ready" });
      return this.getStatus();
    }
    const requestedEnvironment = this.applyCredentialIntent(
      environmentFromHermesSettings(requestedSettings),
      requestedSettings
    );
    const targetEnvironment = this.withManifestDefaults({ ...this.baseEnvironment, ...requestedEnvironment });
    const targetFingerprint = hermesConfigurationFingerprint(targetEnvironment);
    const sameConfiguration = this.runtimeConfigState.active?.configFingerprint !== undefined && this.runtimeConfigState.active.configFingerprint === targetFingerprint;

    this.stageDesiredConfiguration(targetEnvironment, requestedEnvironment);

    if (this.lifecyclePromise) return this.lifecyclePromise;
    if (this.snapshot.processReady && sameConfiguration && !options.forceRestart && !isTerminalState(this.snapshot.overallState)) {
      return this.enqueue("hermes_status_refresh", () => this.synchronizeCareerReadiness());
    }

    this.lifecyclePromise = this.enqueue("hermes_start", () => this.startInternal(targetEnvironment, {
      targetFingerprint,
      requestedSettings: requestedEnvironment,
      credentialAction: requestedSettings?.credentialAction
    }));
    try {
      return await this.lifecyclePromise;
    } finally {
      this.lifecyclePromise = undefined;
    }
  }

  async ensureStarted(requestedSettings) {
    return this.startIfStopped(requestedSettings);
  }

  async startIfStopped(requestedSettings) {
    if (!this.rendererReady) {
      this.publish({ overallState: "stopped", reasonCode: "hermes_renderer_not_ready" });
      return this.getStatus();
    }
    if (this.lifecyclePromise) return this.lifecyclePromise;
    if (this.snapshot.processReady && this.handle && !isExited(this.handle.child) && !isTerminalState(this.snapshot.overallState)) {
      const requestedEnvironment = this.applyCredentialIntent(
        environmentFromHermesSettings(requestedSettings),
        requestedSettings
      );
      const targetFingerprint = hermesConfigurationFingerprint(this.withManifestDefaults({ ...this.baseEnvironment, ...requestedEnvironment }));
      if (this.runtimeConfigState.active?.configFingerprint && targetFingerprint !== this.runtimeConfigState.active.configFingerprint) {
        if (this.hasActiveSemanticRun()) return this.deferMaintenance("hermes_configuration_update_deferred_active_run");
        return this.start(requestedSettings);
      }
      return this.getStatus();
    }
    return this.start(requestedSettings);
  }

  async stop() {
    this.cancelAutoRestart();
    return this.enqueue("hermes_stop", () => this.stopInternal("user_stop", {
      requestedBy: "user",
      reasonCode: "user_stop",
      sourceComponent: "HermesSupervisor.stop",
      requestedAt: new Date().toISOString()
    }));
  }

  async restartExplicitly(options = {}) {
    return this.restart({ ...options, explicit: true });
  }

  async restart(options = {}) {
    this.cancelAutoRestart();
    if (this.lifecyclePromise) {
      if (options.auto) return this.lifecyclePromise.then(() => this.restart(options));
      return this.lifecyclePromise;
    }
    this.lifecyclePromise = this.enqueue("hermes_restart", async () => {
      if (!options.auto) this.restartAttempt = 0;
      this.publish({ overallState: "restarting", reasonCode: options.reason || "hermes_restart_requested" }, options.reason || "Hermes restart requested");
      await this.stopInternal("planned_restart", {
        requestedBy: options.auto ? "hermes_supervisor" : "user",
        reasonCode: options.reason || "runtime_restart",
        sourceComponent: "HermesSupervisor.restart",
        requestedAt: new Date().toISOString()
      });
      return this.startInternal(this.environment, {
        targetFingerprint: this.runtimeConfigState.active?.configFingerprint,
        requestedSettings: this.runtimeProcessState.requestedSettings,
        credentialAction: this.runtimeProcessState.credentialAction,
        preserveRestartAttempt: options.auto === true
      });
    });
    try {
      return await this.lifecyclePromise;
    } finally {
      this.lifecyclePromise = undefined;
    }
  }

  async recover() {
    if (!this.rendererReady) return this.getStatus();
    if (this.lifecyclePromise) return this.lifecyclePromise;
    this.lifecyclePromise = this.enqueue("hermes_recover", async () => {
      if (this.hasActiveSemanticRun()) return this.deferMaintenance("hermes_recovery_deferred_active_run");
      const configurationError = isConfigurationReason(this.snapshot.reasonCode);
      if (configurationError) {
        this.publish({ overallState: "degraded", reasonCode: "configuration_required" }, "Recovery requires configuration");
        return this.getStatus();
      }
      if (!this.snapshot.processReady || !this.handle || isExited(this.handle.child)) {
        return this.startInternal(this.environment, {
          targetFingerprint: this.runtimeConfigState.active?.configFingerprint,
          requestedSettings: this.runtimeProcessState.requestedSettings,
          credentialAction: this.runtimeProcessState.credentialAction
        });
      }
      if (!this.snapshot.apiReady) {
        await this.stopInternal("api_unreachable_recovery", {
          requestedBy: "runtime_recovery",
          reasonCode: "hermes_api_unreachable_recovery",
          sourceComponent: "HermesSupervisor.recover",
          requestedAt: new Date().toISOString()
        });
        return this.startInternal(this.environment, {
          targetFingerprint: this.runtimeConfigState.active?.configFingerprint,
          requestedSettings: this.runtimeProcessState.requestedSettings,
          credentialAction: this.runtimeProcessState.credentialAction
        });
      }
      if (this.snapshot.careerMcpReady && !this.snapshot.toolSurfaceReady) {
        this.publish({ overallState: "restarting", reasonCode: "career_tool_surface_desync" }, "Career tool surface desync; one controlled reload requested");
        await this.stopInternal("career_tool_surface_resync", {
          requestedBy: "runtime_recovery",
          reasonCode: "career_tool_surface_resync",
          sourceComponent: "HermesSupervisor.recover",
          requestedAt: new Date().toISOString()
        });
        return this.startInternal(this.environment, {
          targetFingerprint: this.runtimeConfigState.active?.configFingerprint,
          requestedSettings: this.runtimeProcessState.requestedSettings,
          credentialAction: this.runtimeProcessState.credentialAction,
          preserveRestartAttempt: true
        });
      }
      return this.synchronizeCareerReadiness();
    });
    try {
      return await this.lifecyclePromise;
    } finally {
      this.lifecyclePromise = undefined;
    }
  }

  async getLogs() {
    const recentLogLines = readSafeLogTail(this.logPath, [
      this.environment.AI_API_KEY,
      this.environment.OPENAI_API_KEY,
      this.environment.HERMES_API_KEY,
      this.environment.HERMES_RUNTIME_API_KEY,
      this.environment.API_SERVER_KEY
    ], MAX_LOG_TAIL_LINES);
    return {
      logPath: this.logPath,
      latestLifecycleEntries: [...this.timeline],
      recentLogLines,
      currentSnapshot: this.getStatus(),
      failureTimeSnapshot: this.failureTimeSnapshot
    };
  }

  async getConfig() {
    const configPath = this.hermesHome ? path.join(this.hermesHome, "config.yaml") : undefined;
    const active = this.runtimeConfigState.active;
    const desired = this.runtimeConfigState.desired;
    return {
      ...(active ? {
        provider: active.provider,
        baseUrl: active.baseUrl,
        model: active.model,
        apiKeyConfigured: active.credentialConfigured,
        credentialSource: active.credentialSource,
        sources: {
          provider: activeConfigurationFieldSource(this.runtimeProcessState.activeSettings),
          baseUrl: activeConfigurationFieldSource(this.runtimeProcessState.activeSettings),
          model: activeConfigurationFieldSource(this.runtimeProcessState.activeSettings),
          credential: active.credentialSource
        },
        providerDiagnostic: this.snapshot.providerDiagnostic,
        active
      } : { apiKeyConfigured: false }),
      ...(desired ? {
        desired,
        desiredFingerprint: desired.configFingerprint,
        desiredGeneration: desired.configGeneration
      } : {}),
      ...(active ? {
        activeFingerprint: active.configFingerprint,
        activeGeneration: active.configGeneration
      } : {}),
      applyStatus: this.runtimeConfigState.applyStatus,
      lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt,
      version: this.snapshot.version,
      configPath,
      runtimeConfigWritable: true,
      capabilities: this.capabilities,
      locked: {
        apiServerHost: true,
        apiAuthentication: true,
        careerAdaptProductionMcp: true,
        careerAdaptToolSurface: true,
        bundledRuntimePaths: true
      }
    };
  }

 runtimeConfigSnapshot() {
   return {
      ...(this.runtimeConfigState.active ? { active: this.runtimeConfigState.active } : {}),
      ...(this.runtimeConfigState.desired ? { desired: this.runtimeConfigState.desired } : {}),
      ...(this.runtimeConfigState.active ? { activeFingerprint: this.runtimeConfigState.active.configFingerprint, activeGeneration: this.runtimeConfigState.active.configGeneration } : {}),
      ...(this.runtimeConfigState.desired ? { desiredFingerprint: this.runtimeConfigState.desired.configFingerprint, desiredGeneration: this.runtimeConfigState.desired.configGeneration } : {}),
      applyStatus: this.runtimeConfigState.applyStatus,
      restartPerformed: this.runtimeConfigState.restartPerformed,
      verified: this.runtimeConfigState.verified,
      rollbackOccurred: this.runtimeConfigState.rollbackOccurred,
      ...(this.runtimeConfigState.reasonCode ? { reasonCode: this.runtimeConfigState.reasonCode } : {}),
      updatedAt: new Date().toISOString()
    };
  }

  withManifestDefaults(environment) {
    const manifest = readJsonFile(path.join(this.hermesRuntimeRoot || "", "runtime-manifest.json"));
    return {
      ...environment,
      ...(!firstValue(environment.AI_BASE_URL, environment.HERMES_BASE_URL, environment.OPENAI_BASE_URL) && firstValue(manifest.providerBaseUrl)
        ? { AI_BASE_URL: manifest.providerBaseUrl }
        : {}),
      ...(!firstValue(environment.AI_MODEL, environment.HERMES_MODEL, environment.HERMES_INFERENCE_MODEL) && firstValue(manifest.model)
        ? { AI_MODEL: manifest.model }
        : {})
    };
  }

  stageDesiredConfiguration(environment, requestedEnvironment = {}) {
    const fingerprint = hermesConfigurationFingerprint(environment);
    if (this.runtimeConfigState.desired?.configFingerprint === fingerprint) return this.runtimeConfigState.desired;
    const desiredGeneration = (this.runtimeConfigState.desired?.configGeneration ?? this.runtimeConfigState.active?.configGeneration ?? 0) + 1;
    const source = Object.keys(requestedEnvironment).length > 0 ? "managed_config" : "environment";
    this.runtimeConfigState.desired = configurationValue(environment, fingerprint, desiredGeneration, source);
    this.runtimeProcessState.pendingTargetFingerprint = fingerprint;
    if (this.snapshot) this.publish({ runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes desired configuration staged");
    return this.runtimeConfigState.desired;
  }

  applyCredentialIntent(requestedEnvironment, requestedSettings) {
    const settings = requestedSettings && typeof requestedSettings === "object" && !Array.isArray(requestedSettings)
      ? requestedSettings
      : {};
    if (settings.credentialAction === "clear") {
      return {
        ...requestedEnvironment,
        AI_API_KEY: "",
        OPENAI_API_KEY: "",
        HERMES_API_KEY: ""
      };
    }
    if (settings.credentialAction === "unchanged"
      && !firstValue(settings.apiKey)
      && this.runtimeProcessState.activeEnvironment
      && this.runtimeConfigState.active?.credentialConfigured) {
      const activeKey = providerCredential(this.runtimeProcessState.activeEnvironment);
      if (activeKey) return { ...requestedEnvironment, AI_API_KEY: activeKey };
    }
    return requestedEnvironment;
  }

 setConfigurationApplyStatus(status, reasonCode, options = {}) {
    this.runtimeConfigState.applyStatus = status;
    this.runtimeConfigState.reasonCode = reasonCode ? safeReason(reasonCode) : undefined;
    if (options.restartPerformed !== undefined) this.runtimeConfigState.restartPerformed = options.restartPerformed;
    if (options.verified !== undefined) this.runtimeConfigState.verified = options.verified;
    if (options.rollbackOccurred !== undefined) this.runtimeConfigState.rollbackOccurred = options.rollbackOccurred;
    this.publish({ runtimeConfig: this.runtimeConfigSnapshot(), lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt }, `Hermes configuration ${status}`);
  }

  commitActiveConfiguration(targetEnvironment, options = {}) {
   const fingerprint = options.targetFingerprint || hermesConfigurationFingerprint(targetEnvironment);
   const generation = options.targetGeneration
      ?? (this.runtimeConfigState.desired?.configFingerprint === fingerprint
        ? this.runtimeConfigState.desired.configGeneration
        : (this.runtimeConfigState.active?.configGeneration ?? 0) + 1);
   const source = options.source || "runtime_readback";
   const credentialSourceOverride = options.credentialSourceOverride
     ?? (firstValue(options.requestedSettings?.AI_API_KEY) ? "managed_config" : undefined)
      ?? (source === "runtime_readback" && this.runtimeConfigState.desired?.source === "managed_config" && !options.rollback
       ? "managed_config"
       : undefined);
    this.runtimeConfigState.active = configurationValue({
     ...targetEnvironment,
      ...(this.runtimeProcessState.observedConfiguration?.provider ? { AI_PROVIDER: this.runtimeProcessState.observedConfiguration.provider } : {}),
      ...(this.runtimeProcessState.observedConfiguration?.model ? { AI_MODEL: this.runtimeProcessState.observedConfiguration.model } : {})
   }, fingerprint, generation, source, new Date().toISOString(),
     credentialSourceOverride);
    this.runtimeProcessState.activeEnvironment = { ...targetEnvironment };
    this.runtimeProcessState.activeSettings = { ...(options.requestedSettings || {}) };
    this.runtimeProcessState.pendingTargetFingerprint = undefined;
    this.runtimeConfigState.verified = true;
   if (!options.rollback) {
      this.runtimeConfigState.applyStatus = "applied";
      this.runtimeConfigState.reasonCode = undefined;
   }
   this.publish({
      provider: this.runtimeConfigState.active.provider,
      model: this.runtimeConfigState.active.model,
      credentialConfigured: this.runtimeConfigState.active.credentialConfigured,
      credentialSource: this.runtimeConfigState.active.credentialSource,
      providerDiagnostic: this.runtimeProcessState.observedProviderDiagnostic || this.snapshot.providerDiagnostic,
     runtimeConfig: this.runtimeConfigSnapshot()
   }, "Hermes active configuration verified");
    return this.runtimeConfigState.active;
  }

  configurationReadbackMatches(targetFingerprint, targetGeneration) {
    const diagnosticFingerprint = this.runtimeProcessState.observedProviderDiagnostic?.configFingerprint;
    if (diagnosticFingerprint && diagnosticFingerprint !== targetFingerprint) return false;
    const diagnosticGeneration = this.runtimeProcessState.observedProviderDiagnostic?.configGeneration;
    if (diagnosticGeneration !== undefined && targetGeneration !== undefined && diagnosticGeneration !== targetGeneration) return false;
    const expected = configurationValue(this.environment, targetFingerprint, targetGeneration || 0, "runtime_readback");
    if (this.runtimeProcessState.observedConfiguration?.provider && this.runtimeProcessState.observedConfiguration.provider !== expected.provider) return false;
    if (this.runtimeProcessState.observedConfiguration?.model && expected.model && this.runtimeProcessState.observedConfiguration.model !== expected.model) return false;
    return true;
  }

  hasActiveSemanticRun() {
    return Boolean(this.snapshot.activeRunId)
      && this.snapshot.processReady
      && !["stopped", "stopping", "restarting"].includes(this.snapshot.overallState);
  }

 deferMaintenance(reasonCode) {
   this.maintenancePending = true;
   this.maintenanceReasonCode = safeReason(reasonCode);
    this.runtimeConfigState.applyStatus = "deferred";
    this.runtimeConfigState.reasonCode = this.maintenanceReasonCode;
    this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(false, false, this.maintenanceReasonCode, "deferred");
   this.publish({
     maintenancePending: true,
     maintenanceReasonCode: this.maintenanceReasonCode,
     reasonCode: this.maintenanceReasonCode,
      lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt,
     runtimeConfig: this.runtimeConfigSnapshot()
    }, `Hermes maintenance deferred while semantic run ${this.snapshot.activeRunId || "is active"}`);
    return this.getStatus();
  }

  async getConfigSchema() {
    return {
      version: this.snapshot.version,
      bundledRuntime: true,
      adminConfigWritable: false,
      supportedEndpoints: [
        "/v1/capabilities",
        "/v1/skills",
        "/v1/toolsets",
        "/api/model/options"
      ],
      unsupportedEndpoints: ["/api/config", "/api/config/defaults", "/api/config/schema"],
      supportedFields: [
        { key: "provider", label: "提供商", editable: true },
        { key: "baseUrl", label: "Provider Base URL", editable: true },
        { key: "model", label: "模型", editable: true },
        { key: "apiKey", label: "API Key", editable: true, secret: true }
      ],
      runtimeConfigWritable: true,
      lockedFields: [
        "API server host",
        "runtime authentication",
        "CareerAdapt production MCP",
        "CareerAdapt tool surface",
        "bundled runtime paths"
      ]
    };
  }

 async updateConfig(settings, options = {}) {
    if (this.configurationMutationPromise) return this.configurationMutationPromise;
    const operation = Promise.resolve().then(() => this.updateConfigInternal(settings, options));
    this.configurationMutationPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.configurationMutationPromise === operation) this.configurationMutationPromise = undefined;
    }
  }

  async updateConfigInternal(settings, options = {}) {
   const pendingLifecycle = this.lifecyclePromise;
    if (pendingLifecycle) await pendingLifecycle;
    const requestedEnvironment = this.applyCredentialIntent(
      environmentFromHermesSettings(settings),
      settings
    );
    const targetEnvironment = this.withManifestDefaults({ ...this.baseEnvironment, ...requestedEnvironment });
    const targetFingerprint = hermesConfigurationFingerprint(targetEnvironment);
    const previous = this.captureHealthyConfiguration();
    this.stageDesiredConfiguration(targetEnvironment, requestedEnvironment);
    const validationReason = validateHermesConfigSettings(settings);
   if (validationReason) {
     this.setConfigurationApplyStatus("validating");
     this.setConfigurationApplyStatus("failed", validationReason, { verified: false, rollbackOccurred: false });
      this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(false, false, validationReason);
      this.publish({ lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes configuration validation failed");
     return this.getStatus();
   }
   if (this.hasActiveSemanticRun()) return this.deferMaintenance("hermes_configuration_update_deferred_active_run");
    const activeFingerprint = this.runtimeConfigState.active?.configFingerprint;
    const sameConfiguration = activeFingerprint !== undefined && activeFingerprint === targetFingerprint;
    if (sameConfiguration && this.snapshot.overallState === "ready" && this.snapshot.providerReady === true && options.forceRestart !== true) {
      this.setConfigurationApplyStatus("applied", undefined, { restartPerformed: false, verified: true, rollbackOccurred: false });
      this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(true, false, undefined);
      this.publish({ lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes configuration already active");
      return this.getStatus();
    }
   this.setConfigurationApplyStatus("saving");
   this.setConfigurationApplyStatus("restarting_runtime", undefined, {
      restartPerformed: activeFingerprint !== undefined && (options.forceRestart === true || activeFingerprint !== targetFingerprint),
     verified: false,
     rollbackOccurred: false
   });
   const snapshot = await this.start(settings, options);
   const applied = snapshot.overallState === "ready"
      && this.runtimeConfigState.active?.configFingerprint === targetFingerprint;
   if (applied) {
     this.setConfigurationApplyStatus("applied", undefined, { verified: true, rollbackOccurred: false });
      this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(true, false, undefined);
      this.publish({ lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes configuration applied");
     return this.getStatus();
   }

    const reasonCode = safeReason(snapshot.reasonCode || "hermes_configuration_apply_failed");
    if (previous && (isConfigurationReason(reasonCode) || snapshot.providerReady !== true)) {
      return this.rollbackToHealthy(previous, reasonCode);
    }
   this.setConfigurationApplyStatus("failed", reasonCode, { verified: false });
    this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(false, false, reasonCode);
    this.publish({ lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes configuration failed");
    return this.getStatus();
  }

 captureHealthyConfiguration() {
    if (!this.runtimeConfigState.active || this.snapshot.overallState !== "ready" || this.snapshot.providerReady !== true) return undefined;
   return {
      environment: { ...(this.runtimeProcessState.activeEnvironment || this.environment) },
      settings: { ...(this.runtimeProcessState.activeSettings || this.runtimeProcessState.requestedSettings) },
      fingerprint: this.runtimeConfigState.active.configFingerprint,
      generation: this.runtimeConfigState.active.configGeneration,
      credentialSource: this.runtimeConfigState.active.credentialSource
    };
  }

 createApplyReceipt(verified, rollbackOccurred, reasonCode, applyStatus) {
   return {
     applyStatus: applyStatus || (rollbackOccurred ? "rolled_back" : verified ? "applied" : "failed"),
      desiredFingerprint: this.runtimeConfigState.desired?.configFingerprint,
      activeFingerprint: this.runtimeConfigState.active?.configFingerprint,
      restartPerformed: this.runtimeConfigState.restartPerformed,
      verified,
      rollbackOccurred,
      ...(reasonCode ? { reasonCode } : {})
    };
  }

  async rollbackToHealthy(previous, reasonCode) {
    if (this.runtimeProcessState.rollbackInProgress) return this.getStatus();
    this.runtimeProcessState.rollbackInProgress = true;
    const failedDesiredConfiguration = this.runtimeConfigState.desired;
    this.runtimeConfigState.desired = this.runtimeConfigState.active;
    this.setConfigurationApplyStatus("restarting_runtime", "config_apply_rollback_requested", {
      restartPerformed: true,
      verified: false,
      rollbackOccurred: true
    });
    try {
      const snapshot = await this.startInternal(previous.environment, {
        targetFingerprint: previous.fingerprint,
        targetGeneration: previous.generation,
        requestedSettings: previous.settings,
        credentialSourceOverride: previous.credentialSource,
        allowActiveRun: true,
        preserveDesired: true,
        rollback: true
      });
     const restored = snapshot.overallState === "ready"
        && this.runtimeConfigState.active?.configFingerprint === previous.fingerprint;
     if (!restored) {
       this.runtimeConfigState.desired = failedDesiredConfiguration;
       this.setConfigurationApplyStatus("failed", "config_rollback_failed", { verified: false, rollbackOccurred: true });
        this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(false, true, "config_rollback_failed");
        this.publish({ lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes configuration rollback failed");
       return this.getStatus();
     }
     this.runtimeConfigState.desired = failedDesiredConfiguration;
     this.setConfigurationApplyStatus("rolled_back", "config_apply_rolled_back", { verified: false, rollbackOccurred: true });
      this.runtimeConfigState.lastApplyReceipt = this.createApplyReceipt(false, true, reasonCode);
     this.publish({
        lastApplyReceipt: this.runtimeConfigState.lastApplyReceipt,
        reasonCode: "config_apply_rolled_back",
        runtimeConfig: this.runtimeConfigSnapshot()
      }, "Hermes restored previous healthy configuration");
      return this.getStatus();
   } finally {
      this.runtimeConfigState.desired = failedDesiredConfiguration;
      this.runtimeProcessState.rollbackInProgress = false;
    }
  }

  async reloadConfigFromEnvironment() {
    const pendingLifecycle = this.lifecyclePromise;
    if (pendingLifecycle) await pendingLifecycle;
    const fileEnvironment = loadCareerAdaptEnvironment(this.projectRoot, {});
    const providerKeys = [
      "AI_PROVIDER",
      "AI_BASE_URL",
      "AI_API_KEY",
      "AI_MODEL",
      "HERMES_PROVIDER",
      "HERMES_BASE_URL",
      "HERMES_API_KEY",
      "HERMES_MODEL",
      "HERMES_INFERENCE_MODEL"
    ];
    this.baseEnvironment = { ...this.initialBaseEnvironment };
    for (const key of providerKeys) {
      if (Object.prototype.hasOwnProperty.call(fileEnvironment, key)) this.baseEnvironment[key] = fileEnvironment[key];
    }
    this.runtimeProcessState.requestedSettings = {};
    this.runtimeProcessState.credentialAction = undefined;
    this.environment = { ...this.baseEnvironment };
    this.runtimeConfigState.desired = undefined;
    return this.updateConfig(undefined, { forceRestart: true });
  }

  async resetConfig() {
    const pendingLifecycle = this.lifecyclePromise;
    if (pendingLifecycle) await pendingLifecycle;
    this.runtimeProcessState.requestedSettings = {};
    this.runtimeProcessState.credentialAction = undefined;
    this.environment = { ...this.baseEnvironment };
    this.runtimeConfigState.desired = undefined;
    return this.updateConfig(undefined, { forceRestart: true });
  }

  async shutdown() {
    this.rendererReady = false;
    this.cancelAutoRestart();
    return this.enqueue("hermes_shutdown", () => this.stopInternal("application_shutdown", {
      requestedBy: "application_shutdown",
      reasonCode: "application_shutdown",
      sourceComponent: "HermesSupervisor.shutdown",
      requestedAt: new Date().toISOString()
    }));
  }

  enqueue(_name, operation) {
    const next = this.commandQueue.then(operation, operation);
    this.commandQueue = next.catch(() => undefined);
    return next;
  }

  async startInternal(targetEnvironment, options = {}) {
    if (!options.allowActiveRun && this.hasActiveSemanticRun()) {
      return this.deferMaintenance("hermes_start_deferred_active_run");
    }
    const targetFingerprint = options.targetFingerprint || this.runtimeProcessState.pendingTargetFingerprint || hermesConfigurationFingerprint(targetEnvironment);
   const targetGeneration = options.targetGeneration
      ?? (this.runtimeConfigState.desired?.configFingerprint === targetFingerprint
        ? this.runtimeConfigState.desired.configGeneration
        : this.runtimeConfigState.active?.configGeneration ?? 0);
    const previousCredentialSource = this.runtimeConfigState.active?.credentialSource;
    this.environment = { ...targetEnvironment };
   this.runtimeProcessState.requestedSettings = { ...(options.requestedSettings || {}) };
   this.runtimeProcessState.credentialAction = options.credentialAction;
   this.runtimeProcessState.observedConfiguration = undefined;
   this.runtimeProcessState.observedProviderDiagnostic = undefined;
   this.runtimeProcessState.pendingTargetFingerprint = targetFingerprint;
    this.runtimeConfigState.verified = false;
    process.env.CAREERADAPT_HERMES_CONFIG_GENERATION = String(targetGeneration);
    applyProviderEnvironment(this.environment);
    applyEnvironment(this.environment);
    this.publish({
      overallState: "starting",
      processReady: false,
      apiReady: false,
      providerReady: false,
      careerMcpReady: false,
      toolSurfaceReady: false,
      runReady: false,
      careerSkillsReady: false,
      reasonCode: "hermes_start_requested",
      runtimeUrl: this.environment.HERMES_RUNTIME_URL,
      provider: this.runtimeConfigState.active?.provider,
      model: this.runtimeConfigState.active?.model,
      credentialConfigured: this.runtimeConfigState.active?.credentialConfigured ?? false,
      credentialSource: this.runtimeConfigState.active?.credentialSource ?? "unknown",
      providerDiagnostic: undefined,
      runtimeConfig: this.runtimeConfigSnapshot()
    }, "Hermes start requested");

    if (this.handle?.owned) await this.stopCompanion(this.handle, options.stopReason || {
      requestedBy: "hermes_supervisor",
      reasonCode: "hermes_start_replacement",
      sourceComponent: "HermesSupervisor.startInternal",
      requestedAt: new Date().toISOString()
   });
   this.handle = undefined;
    let handle;
    try {
      handle = await this.startCompanion({
        projectRoot: this.projectRoot,
        appBaseUrl: this.appBaseUrl,
        environment: { ...this.environment },
        hermesHome: this.hermesHome || this.environment.HERMES_HOME,
        hermesRuntimeRoot: this.hermesRuntimeRoot || this.environment.HERMES_RUNTIME_ROOT,
        runtimeCwd: this.runtimeCwd,
        logPath: this.logPath,
        allowProviderKeyFallback: true,
        requireBundledRuntime: this.requireBundledRuntime,
        timeoutMs: this.startupTimeoutMs,
        watchMcpBridge: false,
        // A healthy process on the preferred port may belong to a previous
        // Web Supervisor or an external launcher. Reusing it would make the
        // new provider credentials/model look applied while Hermes still
        // serves the old process environment. The Supervisor must own and
        // verify the instance it reports as active.
        reuseExistingRuntime: false
      });
    } catch (error) {
      const reasonCode = safeReason(error instanceof Error ? error.message : "hermes_companion_start_failed");
      this.publish({
        overallState: isConfigurationReason(reasonCode) ? "degraded" : "unavailable",
        processReady: false,
        apiReady: false,
        providerReady: false,
        careerMcpReady: false,
        toolSurfaceReady: false,
        runReady: false,
        careerSkillsReady: false,
        reasonCode,
        startupFailure: error instanceof Error ? error.message : "hermes_companion_start_failed"
      }, `Hermes start threw: ${reasonCode}`);
      return this.getStatus();
    }
    if (!handle?.ok) {
      const reasonCode = companionFailureReason(handle);
      this.publish({
        overallState: isConfigurationReason(reasonCode) ? "degraded" : "unavailable",
        processReady: false,
        apiReady: false,
        providerReady: false,
        careerMcpReady: false,
        toolSurfaceReady: false,
        runReady: false,
        careerSkillsReady: false,
        reasonCode,
        startupFailure: handle?.startupFailure
      }, `Hermes start settled: ${reasonCode}`);
      return this.getStatus();
    }

   this.handle = handle;
   this.processStartedAt = Date.now();
    if (handle.runtime?.baseUrl) {
      this.environment.HERMES_RUNTIME_URL = handle.runtime.baseUrl;
      applyEnvironment({ HERMES_RUNTIME_URL: handle.runtime.baseUrl });
    }
    this.attachUnexpectedExit(handle);
    this.publish({
      overallState: "api_ready",
      processReady: true,
      apiReady: true,
      runtimeUrl: handle.runtime?.baseUrl || this.environment.HERMES_RUNTIME_URL,
      reasonCode: "hermes_api_ready",
      logPath: handle.logPath || this.logPath
    }, "Hermes API ready");
    await this.discoverCapabilities();
    const snapshot = await this.synchronizeCareerReadiness();
    const readbackFingerprint = options.targetFingerprint || this.runtimeProcessState.pendingTargetFingerprint || handle.configurationFingerprint || hermesConfigurationFingerprint(this.environment);
    if (snapshot.overallState === "ready" && this.configurationReadbackMatches(readbackFingerprint, targetGeneration)) {
      this.commitActiveConfiguration(this.environment, {
        targetFingerprint: readbackFingerprint,
        targetGeneration,
        requestedSettings: options.requestedSettings,
        credentialSourceOverride: options.credentialSourceOverride
          || (options.credentialAction === "clear" ? "missing" : undefined)
          || (options.credentialAction === "unchanged" ? previousCredentialSource : undefined),
        source: "runtime_readback",
        rollback: options.rollback
     });
     if (options.rollback) {
        this.runtimeConfigState.applyStatus = "rolled_back";
        this.runtimeConfigState.reasonCode = "config_apply_rolled_back";
        this.runtimeConfigState.rollbackOccurred = true;
        this.publish({ runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes rollback readback verified");
      }
    } else if (snapshot.overallState === "ready") {
      this.publish({
        overallState: "degraded",
        providerReady: false,
        runReady: false,
        reasonCode: "configuration_desync"
      }, "Hermes configuration readback mismatch");
    }
    return this.getStatus();
  }

  async synchronizeCareerReadiness() {
    if (!this.handle || !this.snapshot.processReady) return this.getStatus();
    this.publish({ overallState: "syncing_career_tools", reasonCode: "career_tool_surface_syncing" }, "Synchronizing Career tool surface");
    const startedAt = Date.now();
    let lastHealth;
    while (Date.now() - startedAt < this.startupSyncTimeoutMs) {
      lastHealth = await this.readAppHealth().catch((error) => ({
        available: false,
        reason: error instanceof Error ? "hermes_health_proxy_unreachable" : "hermes_health_proxy_unreachable"
      }));
      this.applyHealth(lastHealth);
      if (!this.handle || !this.snapshot.processReady) return this.getStatus();
      if (this.snapshot.overallState === "ready" || isConfigurationReason(this.snapshot.reasonCode)) return this.getStatus();
      if (this.isCareerReadinessComplete()) return this.getStatus();
      await delay(this.careerSyncPollIntervalMs);
    }
    const timeoutReason = this.snapshot.providerReady
      ? (this.snapshot.careerMcpReady ? "hermes_tool_surface_sync_timeout" : "career_mcp_sync_timeout")
      : this.snapshot.reasonCode || "hermes_provider_not_ready";
    this.publish({
      overallState: "degraded",
      reasonCode: safeReason(timeoutReason),
      processReady: this.snapshot.processReady,
      apiReady: this.snapshot.apiReady,
      careerSkillsReady: false,
      maintenancePending: this.hasActiveSemanticRun(),
      maintenanceReasonCode: this.hasActiveSemanticRun() ? "hermes_tool_surface_sync_timeout" : undefined
    }, `Hermes readiness deadline settled: ${timeoutReason}`);
    return this.getStatus();
  }

  isCareerReadinessComplete() {
    return this.snapshot.processReady
      && this.snapshot.apiReady
      && this.snapshot.providerReady
      && this.snapshot.careerMcpReady
      && this.snapshot.toolSurfaceReady
      && this.snapshot.runReady;
  }

  async readAppHealth() {
    const runtimeApiKey = firstValue(
      this.environment.HERMES_RUNTIME_API_KEY,
      this.environment.HERMES_API_KEY,
      this.environment.API_SERVER_KEY,
      this.environment.AI_API_KEY
    );
    const response = await this.fetchImpl(`${this.appBaseUrl}/api/agent/runtime/hermes/health`, {
      method: "GET",
      headers: runtimeApiKey ? { Authorization: `Bearer ${runtimeApiKey}`, Accept: "application/json" } : { Accept: "application/json" },
      signal: AbortSignal.timeout(this.healthTimeoutMs),
      cache: "no-store"
    });
    const payload = await response.json().catch(() => ({}));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("hermes_health_invalid_response");
    return payload;
  }

  applyHealth(health) {
    const root = asRecord(health);
    const runtimeHealth = asRecord(root.runtimeHealth);
    const providerStatus = stringValue(root.providerStatus) || stringValue(runtimeHealth.providerStatus);
   const providerDiagnostic = safeProviderDiagnostic(root.providerDiagnostic || runtimeHealth.providerDiagnostic);
    const expectedConfiguration = this.runtimeConfigState.desired || this.runtimeConfigState.active;
   const observedProvider = normalizeProviderIdentity(stringValue(root.provider) || stringValue(runtimeHealth.provider), this.environment);
   const observedModel = stringValue(root.model) || stringValue(runtimeHealth.model);
    const diagnosticConfigurationMismatch = Boolean(expectedConfiguration && providerDiagnostic && (
      (providerDiagnostic.configFingerprint && providerDiagnostic.configFingerprint !== expectedConfiguration.configFingerprint)
      || (providerDiagnostic.configGeneration !== undefined && providerDiagnostic.configGeneration !== expectedConfiguration.configGeneration)
   ));
    const observedConfigurationMismatch = Boolean(expectedConfiguration && (
      (observedProvider && observedProvider !== expectedConfiguration.provider)
      || (observedModel && expectedConfiguration.model && observedModel !== expectedConfiguration.model)
   ));
   const configurationDesync = diagnosticConfigurationMismatch || observedConfigurationMismatch;
    this.runtimeProcessState.observedConfiguration = { provider: observedProvider, model: observedModel };
    this.runtimeProcessState.observedProviderDiagnostic = configurationDesync ? undefined : providerDiagnostic;
    const providerAuthInvalid = !configurationDesync && (providerDiagnostic?.safeErrorCode === "provider_http_401"
      || providerDiagnostic?.safeErrorCode === "provider_http_403"
      || (providerStatus === "invalid" && providerDiagnostic?.lastHttpStatus === 401));
    const processReady = this.snapshot.processReady && !isExited(this.handle?.child);
    const apiReady = processReady && (root.available === true || runtimeHealth.runtimeAvailable === true);
    const providerReady = !configurationDesync && !providerAuthInvalid && (runtimeHealth.providerReady === true
      || (runtimeHealth.providerConfigured === true && runtimeHealth.providerReachable === true && Boolean(stringValue(root.model) || stringValue(runtimeHealth.model))));
    const careerMcpReady = runtimeHealth.browserCareerDomainHostConnected === true
      && runtimeHealth.careerMcpServerReachable === true
      && runtimeHealth.mcpConnected === true;
    const requiredMissing = arrayOfStrings(runtimeHealth.requiredCareerFacadesMissing);
    const contractReady = runtimeHealth.careerToolContractReady !== false;
    const toolSurfaceReady = contractReady
      && runtimeHealth.hermesMcpRegistered === true
      && Number(runtimeHealth.hermesMcpToolCount || 0) > 0
      && requiredMissing.length === 0;
    const runReady = runtimeHealth.runReady !== false && apiReady && providerReady && toolSurfaceReady;
    const careerSkillsReady = runtimeHealth.careerSkillsLoaded === true;
    const careerDomainToolCount = arrayOfStrings(runtimeHealth.careerGatewayContracts).length
      || Number(runtimeHealth.careerMcpContractCount || 0);
    const hermesCareerToolCount = arrayOfStrings(runtimeHealth.careerMcpExposedTools).length
      || Number(runtimeHealth.hermesMcpToolCount || 0);
    const reportedFacadeCount = Number(runtimeHealth.hermesCareerFacadeCount);
    const requiredReady = requiredMissing.length > 0
      ? Math.max(0, REQUIRED_CAREER_FACADES - requiredMissing.length)
      : Math.min(REQUIRED_CAREER_FACADES, Number.isFinite(reportedFacadeCount) && reportedFacadeCount > 0 ? reportedFacadeCount : REQUIRED_CAREER_FACADES);
    const reasonCode = configurationDesync
      ? "configuration_desync"
      : healthReason({ root, runtimeHealth, providerStatus, apiReady, careerMcpReady, toolSurfaceReady, runReady });
    const ready = processReady && apiReady && providerReady && careerMcpReady && toolSurfaceReady && runReady;
    const overallState = ready
      ? "ready"
      : !apiReady
        ? "degraded"
        : !providerReady && isConfigurationReason(reasonCode)
          ? "degraded"
          : careerMcpReady && !toolSurfaceReady
            ? "syncing_career_tools"
            : "degraded";
    const reportedActiveRunId = stringValue(root.activeRunId)
      || stringValue(root.hermesRunId)
      || stringValue(runtimeHealth.activeRunId)
      || stringValue(runtimeHealth.hermesRunId);
    const hasReportedActiveRunId = ["activeRunId", "hermesRunId"].some((key) => Object.prototype.hasOwnProperty.call(root, key))
      || ["activeRunId", "hermesRunId"].some((key) => Object.prototype.hasOwnProperty.call(runtimeHealth, key));
    const activeRunId = hasReportedActiveRunId ? reportedActiveRunId : this.snapshot.activeRunId;
    const runState = normalizeRunState(stringValue(root.runState) || stringValue(runtimeHealth.runState))
      || (activeRunId ? "running" : "none");
    const previousRunReady = this.snapshot.runReady;
    if (previousRunReady === true && runReady === false && !this.failureTimeSnapshot) {
      this.failureTimeSnapshot = {
        capturedAt: new Date().toISOString(),
        reasonCode,
        activeRunId,
        runReady: false,
        overallState
      };
    }
    this.publish({
      overallState,
      processReady,
      apiReady,
      providerReady,
      careerMcpReady,
      toolSurfaceReady,
      runReady,
      careerSkillsReady,
      reasonCode,
      version: stringValue(root.version) || this.snapshot.version,
      model: this.runtimeConfigState.active?.model,
      provider: this.runtimeConfigState.active?.provider,
      runtimeUrl: stringValue(root.runtimeUrl) || this.snapshot.runtimeUrl,
      appUrl: stringValue(root.appUrl) || this.appBaseUrl,
      activeRunId,
      careerDomainToolCount,
      hermesCareerToolCount,
      requiredCareerFacadesReady: requiredReady,
      requiredCareerFacadesTotal: REQUIRED_CAREER_FACADES,
      providerStatus,
      credentialConfigured: this.runtimeConfigState.active?.credentialConfigured ?? false,
      credentialSource: this.runtimeConfigState.active?.credentialSource ?? "unknown",
      providerDiagnostic: this.runtimeConfigState.active && !configurationDesync ? providerDiagnostic : undefined,
      runtimeConfig: this.runtimeConfigSnapshot(),
      runState,
      careerSkills: arrayOfStrings(runtimeHealth.careerSkillsLoaded ? ["careeradapt"] : []),
      missingRequiredCareerTools: requiredMissing,
      hermesRegisteredToolsets: arrayOfStrings(runtimeHealth.hermesRegisteredToolsets),
      hermesVisibleTools: arrayOfStrings(runtimeHealth.hermesVisibleTools),
      health: sanitizeHealth(runtimeHealth),
      capabilities: this.capabilities,
      maintenancePending: this.maintenancePending,
      maintenanceReasonCode: this.maintenanceReasonCode,
      ...(this.failureTimeSnapshot ? { failureTimeSnapshot: this.failureTimeSnapshot } : {})
    }, ready ? "Hermes READY" : `Hermes readiness: ${reasonCode || overallState}`);
    if (ready && this.runtimeConfigState.applyStatus !== "deferred") {
      this.maintenancePending = false;
      this.maintenanceReasonCode = undefined;
      this.publish({ maintenancePending: false, maintenanceReasonCode: undefined });
      this.armStableReadyTimer();
    }
  }

  async discoverCapabilities() {
    const runtimeUrl = this.handle?.runtime?.baseUrl || this.snapshot.runtimeUrl;
    if (!runtimeUrl) return;
    const runtimeApiKey = firstValue(this.environment.HERMES_RUNTIME_API_KEY, this.environment.HERMES_API_KEY, this.environment.API_SERVER_KEY, this.environment.AI_API_KEY);
    const endpoints = ["/v1/capabilities", "/v1/skills", "/v1/toolsets", "/api/model/options"];
    const supported = [];
    const features = {};
    for (const endpoint of endpoints) {
      try {
        const response = await this.fetchImpl(`${runtimeUrl}${endpoint}`, {
          method: "GET",
          headers: runtimeApiKey ? { Authorization: `Bearer ${runtimeApiKey}`, Accept: "application/json" } : { Accept: "application/json" },
          signal: AbortSignal.timeout(2_000),
          cache: "no-store"
        });
        if (!response.ok) continue;
        const payload = await response.json().catch(() => ({}));
        supported.push(endpoint);
        if (endpoint === "/v1/capabilities") Object.assign(features, asRecord(asRecord(payload).features));
      } catch {
        // Capability discovery is diagnostic. API readiness is determined by
        // the official health endpoint and does not depend on every optional
        // discovery request.
      }
    }
    this.capabilities = { supportedEndpoints: supported, features };
    this.publish({ capabilities: this.capabilities }, "Hermes capability discovery complete");
  }

  attachUnexpectedExit(handle) {
    const child = handle?.child;
    if (!child || typeof child.once !== "function") return;
    child.once("exit", (code, signal) => {
      if (this.handle !== handle || handle.stopping || this.snapshot.overallState === "stopping" || this.snapshot.overallState === "restarting") return;
      void this.handleUnexpectedExit({ code, signal });
    });
  }

  async handleUnexpectedExit(details) {
    const reasonCode = "hermes_process_crashed";
    const configurationError = isConfigurationReason(this.snapshot.reasonCode)
      || this.snapshot.providerStatus === "invalid"
      || this.snapshot.providerStatus === "unconfigured";
   this.handle = undefined;
    this.publish({
      overallState: "degraded",
      processReady: false,
      apiReady: false,
      providerReady: false,
      careerMcpReady: false,
      toolSurfaceReady: false,
      runReady: false,
      careerSkillsReady: false,
      reasonCode,
      lastExit: { code: details.code, signal: details.signal },
      runtimeConfig: this.runtimeConfigSnapshot()
    }, `Unexpected Hermes child exit code=${details.code ?? "none"}`);
    if (!this.rendererReady || configurationError) {
      this.publish({ overallState: "unavailable", reasonCode: configurationError ? "configuration_required" : reasonCode });
      return;
    }
    if (this.restartAttempt >= this.autoRestartDelaysMs.length) {
      this.publish({ overallState: "unavailable", reasonCode: "hermes_restart_circuit_open" }, "Hermes restart circuit opened");
      return;
    }
    const delayMs = this.autoRestartDelaysMs[this.restartAttempt];
    this.restartAttempt += 1;
    this.publish({ overallState: "restarting", reasonCode, restartAttempt: this.restartAttempt }, `Scheduled Hermes recovery attempt ${this.restartAttempt} in ${delayMs}ms`);
    this.autoRestartTimer = setTimeout(() => {
      this.autoRestartTimer = undefined;
      void this.restart({ auto: true, reason: reasonCode }).catch((error) => {
        this.publish({ overallState: "unavailable", reasonCode: safeReason(error instanceof Error ? error.message : "hermes_restart_failed") });
      });
    }, delayMs);
  }

 async stopInternal(reason, stopReason) {
   if (!this.handle) {
      this.runtimeConfigState.active = undefined;
      this.runtimeConfigState.applyStatus = "idle";
      this.runtimeConfigState.verified = false;
      this.runtimeProcessState.activeEnvironment = undefined;
      this.runtimeProcessState.activeSettings = undefined;
      this.publish({ overallState: "stopped", processReady: false, apiReady: false, providerReady: false, careerMcpReady: false, toolSurfaceReady: false, runReady: false, careerSkillsReady: false, activeRunId: undefined, reasonCode: reason, lastStopReason: stopReason, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes stopped");
      return this.getStatus();
    }
    const handle = this.handle;
    this.publish({ overallState: "stopping", reasonCode: reason, lastStopReason: stopReason }, "Hermes stopping");
    handle.supervisorStopping = true;
    await this.stopCompanion(handle, stopReason);
   if (this.handle === handle) this.handle = undefined;
   this.processStartedAt = undefined;
    this.runtimeConfigState.active = undefined;
    this.runtimeConfigState.applyStatus = "idle";
    this.runtimeConfigState.verified = false;
    this.runtimeProcessState.activeEnvironment = undefined;
    this.runtimeProcessState.activeSettings = undefined;
    this.publish({ overallState: "stopped", processReady: false, apiReady: false, providerReady: false, careerMcpReady: false, toolSurfaceReady: false, runReady: false, careerSkillsReady: false, activeRunId: undefined, reasonCode: reason, lastStopReason: stopReason, runtimeConfig: this.runtimeConfigSnapshot() }, "Hermes stopped");
    this.maintenancePending = false;
    this.maintenanceReasonCode = undefined;
    return this.getStatus();
  }

  publish(patch = {}, timelineMessage) {
    if (timelineMessage) {
      this.timeline.push({ at: new Date().toISOString(), message: timelineMessage, state: patch.overallState || this.snapshot.overallState, reasonCode: patch.reasonCode });
      if (this.timeline.length > MAX_LIFECYCLE_ENTRIES) this.timeline.splice(0, this.timeline.length - MAX_LIFECYCLE_ENTRIES);
    }
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: new Date().toISOString(),
      latestLifecycleEntries: [...this.timeline],
      restartAttempt: this.restartAttempt,
      logPath: this.snapshot.logPath || this.logPath
    };
    this.broadcast(this.getStatus());
  }

  armStableReadyTimer() {
    if (this.stableReadyTimer) clearTimeout(this.stableReadyTimer);
    this.stableReadyTimer = setTimeout(() => {
      this.restartAttempt = 0;
      this.publish({ restartAttempt: 0 }, "Hermes stable ready window reached; restart budget reset");
    }, this.stableReadyWindowMs);
  }

  cancelAutoRestart() {
    if (this.autoRestartTimer) clearTimeout(this.autoRestartTimer);
    if (this.stableReadyTimer) clearTimeout(this.stableReadyTimer);
    this.autoRestartTimer = undefined;
    this.stableReadyTimer = undefined;
  }
}

function configurationValue(environment, configFingerprint, configGeneration, source, lastAppliedAt, credentialSourceOverride) {
  const apiKey = providerCredential(environment);
  return {
    provider: normalizeProviderIdentity(firstValue(environment.HERMES_PROVIDER, environment.AI_PROVIDER), environment),
    baseUrl: firstValue(environment.HERMES_BASE_URL, environment.AI_BASE_URL, environment.OPENAI_BASE_URL) || DEFAULT_PROVIDER_BASE_URL,
    baseUrlHostPath: safeBaseUrlHostPath(firstValue(environment.HERMES_BASE_URL, environment.AI_BASE_URL, environment.OPENAI_BASE_URL) || DEFAULT_PROVIDER_BASE_URL),
    model: firstValue(environment.HERMES_MODEL, environment.AI_MODEL, environment.HERMES_INFERENCE_MODEL) || "",
    credentialConfigured: Boolean(apiKey),
    credentialSource: credentialSourceOverride || (source === "managed_config" && apiKey
      ? "managed_config"
      : apiKey
        ? "server_env"
        : "missing"),
    configFingerprint,
    configGeneration,
    source,
    ...(lastAppliedAt ? { lastAppliedAt } : {})
  };
}

function safeBaseUrlHostPath(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return `${url.host}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return "invalid-url";
  }
}

function providerCredential(environment) {
  return firstValue(environment.AI_API_KEY, environment.OPENAI_API_KEY, environment.HERMES_API_KEY);
}

function activeConfigurationFieldSource(settings) {
  return settings && Object.keys(settings).length > 0 ? "managed_config" : "server_env";
}

function validateHermesConfigSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return undefined;
  const provider = typeof settings.provider === "string" ? settings.provider.trim() : "";
  const baseUrl = typeof settings.baseUrl === "string" ? settings.baseUrl.trim() : "";
  const apiKey = typeof settings.apiKey === "string" ? settings.apiKey.trim() : "";
  if (/^https?:\/\//iu.test(provider)) return "provider_identity_must_not_be_url";
  if (baseUrl) {
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "provider_base_url_protocol_invalid";
    } catch {
      return "provider_base_url_invalid";
    }
  }
  if (settings.credentialAction === "clear" && apiKey) return "credential_clear_conflict";
  if (settings.credentialAction === "replace" && !apiKey) return "credential_replace_missing";
  return undefined;
}

function normalizeProviderIdentity(provider, environment) {
  const candidate = firstValue(provider);
  if (candidate && !/^https?:\/\//iu.test(candidate)) return candidate.toLowerCase();
  const baseUrl = firstValue(environment?.HERMES_BASE_URL, environment?.AI_BASE_URL, environment?.OPENAI_BASE_URL);
  try {
    const hostname = new URL(baseUrl || "").hostname.toLowerCase();
    if (hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai")) return "openrouter";
  } catch {
    // The boundary validator reports an invalid provider endpoint.
  }
  return "openai-compatible";
}

function applyProviderEnvironment(environment) {
  for (const key of ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "HERMES_PROVIDER", "HERMES_BASE_URL", "HERMES_API_KEY", "HERMES_MODEL", "HERMES_INFERENCE_MODEL", "OPENAI_BASE_URL", "OPENAI_API_KEY"]) {
    process.env[key] = Object.prototype.hasOwnProperty.call(environment, key) && typeof environment[key] === "string"
      ? environment[key]
      : "";
  }
}

function environmentFromHermesSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const settings = value;
  const read = (name) => typeof settings[name] === "string" ? settings[name].trim().slice(0, 20_000) : "";
  const baseUrl = read("baseUrl");
  const apiKey = read("apiKey");
  const model = read("model");
  const provider = read("provider");
  const credentialAction = settings.credentialAction;
  return {
    ...(provider ? { AI_PROVIDER: provider, HERMES_PROVIDER: provider } : {}),
    ...(baseUrl ? { AI_BASE_URL: baseUrl, HERMES_BASE_URL: baseUrl } : {}),
    ...(apiKey ? { AI_API_KEY: apiKey } : credentialAction === "clear" ? {
      AI_API_KEY: "",
      OPENAI_API_KEY: "",
      HERMES_API_KEY: ""
    } : {}),
    ...(model ? { AI_MODEL: model, HERMES_MODEL: model, HERMES_INFERENCE_MODEL: model } : {})
  };
}

function healthReason(input) {
  const { root, runtimeHealth, providerStatus, apiReady, careerMcpReady, toolSurfaceReady, runReady } = input;
  const providerDiagnostic = safeProviderDiagnostic(root.providerDiagnostic || runtimeHealth.providerDiagnostic);
  const rawDirect = stringValue(runtimeHealth.runReadySafeErrorCode) || stringValue(runtimeHealth.safeErrorCode) || stringValue(root.reason);
  const direct = rawDirect ? safeReason(rawDirect) : undefined;
  if ((providerStatus === "invalid" || providerStatus === "unconfigured") && (providerDiagnostic?.lastHttpStatus === 401 || providerDiagnostic?.lastHttpStatus === 403 || providerDiagnostic?.safeErrorCode === "provider_http_401" || providerDiagnostic?.safeErrorCode === "provider_http_403")) {
    return "provider_auth_invalid";
  }
  if (providerStatus === "invalid" || providerStatus === "unconfigured") {
    return direct || "configuration_required";
  }
  if (!apiReady) return direct || "hermes_api_unreachable";
  if (!careerMcpReady) return direct || "career_mcp_sync_pending";
  if (runtimeHealth.careerToolContractReady === false) return direct || "career_tool_contract_mismatch";
  if (!toolSurfaceReady) return direct || "hermes_tool_surface_sync_pending";
  if (!runReady) return direct || "hermes_run_not_ready";
  return direct;
}

function sanitizeHealth(value) {
  const record = asRecord(value);
  const result = {};
  for (const key of [
    "runtimeId",
    "activeRunId",
    "hermesRunId",
    "runtimeAvailable",
    "companionReady",
    "providerConfigured",
    "providerReachable",
    "providerReady",
    "provider",
    "providerStatus",
    "runState",
    "model",
    "toolCallingCapability",
    "toolCallingAvailable",
    "toolCallInFlight",
    "mcpConnected",
    "mcpReady",
    "mcpToolCount",
    "browserCareerDomainHostConnected",
    "careerMcpServerReachable",
    "careerMcpContractCount",
    "hermesMcpRegistered",
    "hermesMcpToolCount",
    "hermesCareerFacadeCount",
    "careerToolContractReady",
    "careerToolContractVersion",
    "careerToolContractReason",
    "careerSkillsLoaded",
    "runReady",
    "runReadySafeErrorCode",
    "safeErrorCode",
    "lastCheckedAt"
  ]) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  const providerDiagnostic = safeProviderDiagnostic(record.providerDiagnostic);
  if (providerDiagnostic) result.providerDiagnostic = providerDiagnostic;
  result.requiredCareerFacadesMissing = arrayOfStrings(record.requiredCareerFacadesMissing);
  result.careerGatewayContracts = arrayOfStrings(record.careerGatewayContracts);
  result.careerMcpExposedTools = arrayOfStrings(record.careerMcpExposedTools);
  result.hermesRegisteredToolsets = arrayOfStrings(record.hermesRegisteredToolsets);
  result.hermesVisibleTools = arrayOfStrings(record.hermesVisibleTools);
  result.careerToolContractMismatches = Array.isArray(record.careerToolContractMismatches)
    ? record.careerToolContractMismatches
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => {
        const candidate = item;
        return {
          ...(typeof candidate.toolName === "string" ? { toolName: candidate.toolName } : {}),
          ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
          ...(typeof candidate.publishedContractVersion === "string" ? { publishedContractVersion: candidate.publishedContractVersion } : {}),
          ...(typeof candidate.publishedSchemaHash === "string" ? { publishedSchemaHash: candidate.publishedSchemaHash } : {}),
          ...(typeof candidate.expectedSchemaHash === "string" ? { expectedSchemaHash: candidate.expectedSchemaHash } : {})
        };
      })
    : [];
  return result;
}

function isTerminalState(state) {
  return ["stopped", "unavailable"].includes(state);
}

function isConfigurationReason(value) {
  return /auth|permission|forbidden|invalid[_-](?:model|provider|config|url)|provider_(?:invalid|unconfigured|auth)|configuration_(?:required|desync)|config_or_provider/u.test(String(value || "").toLowerCase());
}

function safeReason(value) {
  const normalized = String(value || "hermes_unavailable").replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 160);
  return normalized || "hermes_unavailable";
}

function companionFailureReason(handle) {
  const stage = stringValue(handle?.startupFailure?.stage);
  if (stage === "api_server_startup") return "hermes_startup_timeout";
  if (stage === "config_or_provider_initialization") return "provider_invalid_config";
  return safeReason(handle?.reason || "hermes_companion_start_failed");
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeRunState(value) {
  if (value === "started") return "running";
  if (value === "waiting_for_approval") return "waiting_for_user";
  if (value === "cancelled") return "completed";
  return ["none", "queued", "running", "waiting_for_user", "stopping", "completed", "failed"].includes(value) ? value : undefined;
}

function safeProviderDiagnostic(value) {
  const record = asRecord(value);
  const credentialSource = ["server_env", "managed_config", "custom_header", "default", "missing", "unknown"].includes(record.credentialSource)
    ? record.credentialSource
    : undefined;
  if (typeof record.credentialConfigured !== "boolean" && !credentialSource && typeof record.safeErrorCode !== "string") return undefined;
  return {
    ...(typeof record.provider === "string" ? { provider: normalizeProviderIdentity(record.provider, { AI_BASE_URL: record.provider }) } : {}),
    ...(typeof record.model === "string" ? { model: record.model.slice(0, 160) } : {}),
    credentialConfigured: record.credentialConfigured === true,
    credentialSource: credentialSource || "unknown",
    ...(typeof record.configFingerprint === "string" ? { configFingerprint: record.configFingerprint.slice(0, 160) } : {}),
    ...(typeof record.configGeneration === "number" && Number.isInteger(record.configGeneration) ? { configGeneration: record.configGeneration } : {}),
    ...(typeof record.lastCheckedAt === "string" ? { lastCheckedAt: record.lastCheckedAt } : {}),
    ...(typeof record.lastHttpStatus === "number" && Number.isInteger(record.lastHttpStatus) ? { lastHttpStatus: record.lastHttpStatus } : {}),
    ...(typeof record.safeErrorCode === "string" ? { safeErrorCode: safeReason(record.safeErrorCode) } : {})
  };
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()) : [];
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

function isExited(child) {
  return Boolean(child && child.exitCode !== null && child.exitCode !== undefined);
}

function readJsonFile(filePath) {
  if (!filePath) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function readSafeLogTail(filePath, secrets, limit) {
  try {
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean).slice(-limit);
    return lines.map((line) => redact(line, secrets));
  } catch {
    return [];
  }
}

function redact(value, secrets) {
  let safe = String(value);
  for (const secret of secrets.filter((item) => typeof item === "string" && item.length >= 8)) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [REDACTED]");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  AUTO_RESTART_DELAYS_MS,
  HermesSupervisor,
  LIFECYCLE_STATES,
  REQUIRED_CAREER_FACADES,
  environmentFromHermesSettings,
  hermesConfigurationFingerprint,
  isConfigurationReason
};
