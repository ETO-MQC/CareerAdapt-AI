/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("fs");
const path = require("path");
const {
  applyEnvironment,
  hermesConfigurationFingerprint,
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
    this.lastRequestedSettings = {};
    this.currentFingerprint = undefined;
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
      reasonCode: "hermes_renderer_not_ready",
      updatedAt: new Date().toISOString(),
      runtimeUrl: this.environment.HERMES_RUNTIME_URL,
      appUrl: this.appBaseUrl,
      version: typeof manifest.hermesVersion === "string" ? manifest.hermesVersion : undefined,
      model: firstValue(this.environment.AI_MODEL, this.environment.HERMES_MODEL, manifest.model),
      provider: firstValue(this.environment.AI_BASE_URL, this.environment.OPENAI_BASE_URL, manifest.providerBaseUrl),
      careerDomainToolCount: 0,
      hermesCareerToolCount: 0,
      requiredCareerFacadesReady: 0,
      requiredCareerFacadesTotal: REQUIRED_CAREER_FACADES,
      restartAttempt: 0,
      uptimeMs: 0,
      logPath: this.logPath,
      latestLifecycleEntries: [],
      capabilities: undefined,
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

  async start(requestedSettings) {
    if (!this.rendererReady) {
      this.publish({ overallState: "stopped", reasonCode: "hermes_renderer_not_ready" });
      return this.getStatus();
    }
    const requestedEnvironment = environmentFromHermesSettings(requestedSettings);
    const targetEnvironment = { ...this.baseEnvironment, ...requestedEnvironment };
    const targetFingerprint = hermesConfigurationFingerprint(targetEnvironment);
    const sameConfiguration = this.currentFingerprint !== undefined && this.currentFingerprint === targetFingerprint;

    if (this.lifecyclePromise) return this.lifecyclePromise;
    if (this.snapshot.processReady && sameConfiguration && !isTerminalState(this.snapshot.overallState)) {
      return this.enqueue("hermes_status_refresh", () => this.synchronizeCareerReadiness());
    }

    this.lifecyclePromise = this.enqueue("hermes_start", () => this.startInternal(targetEnvironment, {
      targetFingerprint,
      requestedSettings: requestedEnvironment
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
      const requestedEnvironment = environmentFromHermesSettings(requestedSettings);
      const targetFingerprint = hermesConfigurationFingerprint({ ...this.baseEnvironment, ...requestedEnvironment });
      if (this.currentFingerprint && targetFingerprint !== this.currentFingerprint) {
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
        targetFingerprint: this.currentFingerprint,
        requestedSettings: this.lastRequestedSettings,
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
          targetFingerprint: this.currentFingerprint,
          requestedSettings: this.lastRequestedSettings
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
          targetFingerprint: this.currentFingerprint,
          requestedSettings: this.lastRequestedSettings
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
          targetFingerprint: this.currentFingerprint,
          requestedSettings: this.lastRequestedSettings,
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
    const manifest = readJsonFile(path.join(this.hermesRuntimeRoot || "", "runtime-manifest.json"));
    const configPath = this.hermesHome ? path.join(this.hermesHome, "config.yaml") : undefined;
    return {
      provider: this.snapshot.provider,
      baseUrl: firstValue(this.environment.AI_BASE_URL, this.environment.OPENAI_BASE_URL, manifest.providerBaseUrl),
      model: this.snapshot.model,
      apiKeyConfigured: Boolean(firstValue(this.environment.AI_API_KEY, this.environment.OPENAI_API_KEY, this.environment.HERMES_API_KEY, this.environment.HERMES_RUNTIME_API_KEY)),
      version: this.snapshot.version,
      configPath,
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

  hasActiveSemanticRun() {
    return Boolean(this.snapshot.activeRunId)
      && this.snapshot.processReady
      && !["stopped", "stopping", "restarting"].includes(this.snapshot.overallState);
  }

  deferMaintenance(reasonCode) {
    this.maintenancePending = true;
    this.maintenanceReasonCode = safeReason(reasonCode);
    this.publish({
      maintenancePending: true,
      maintenanceReasonCode: this.maintenanceReasonCode,
      reasonCode: this.maintenanceReasonCode
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
      lockedFields: [
        "API server host",
        "runtime authentication",
        "CareerAdapt production MCP",
        "CareerAdapt tool surface",
        "bundled runtime paths"
      ]
    };
  }

  async updateConfig(settings) {
    return this.start(settings);
  }

  async resetConfig() {
    this.lastRequestedSettings = {};
    this.environment = { ...this.baseEnvironment };
    this.currentFingerprint = undefined;
    return this.start({});
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
    this.environment = { ...targetEnvironment };
    this.lastRequestedSettings = { ...(options.requestedSettings || {}) };
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
      model: firstValue(this.environment.AI_MODEL, this.environment.HERMES_MODEL),
      provider: firstValue(this.environment.AI_BASE_URL, this.environment.OPENAI_BASE_URL)
    }, "Hermes start requested");

    if (this.handle?.owned) await this.stopCompanion(this.handle, options.stopReason || {
      requestedBy: "hermes_supervisor",
      reasonCode: "hermes_start_replacement",
      sourceComponent: "HermesSupervisor.startInternal",
      requestedAt: new Date().toISOString()
    });
    this.handle = undefined;
    this.currentFingerprint = undefined;
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
        watchMcpBridge: false
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
    this.currentFingerprint = options.targetFingerprint || handle.configurationFingerprint || hermesConfigurationFingerprint(this.environment);
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
    return this.synchronizeCareerReadiness();
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
    const processReady = this.snapshot.processReady && !isExited(this.handle?.child);
    const apiReady = processReady && (root.available === true || runtimeHealth.runtimeAvailable === true);
    const providerReady = runtimeHealth.providerReady === true
      || (runtimeHealth.providerConfigured === true && runtimeHealth.providerReachable === true && Boolean(stringValue(root.model) || stringValue(runtimeHealth.model)));
    const careerMcpReady = runtimeHealth.browserCareerDomainHostConnected === true
      && runtimeHealth.careerMcpServerReachable === true
      && runtimeHealth.mcpConnected === true;
    const requiredMissing = arrayOfStrings(runtimeHealth.requiredCareerFacadesMissing);
    const toolSurfaceReady = runtimeHealth.hermesMcpRegistered === true
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
    const reasonCode = healthReason({ root, runtimeHealth, providerStatus, apiReady, careerMcpReady, toolSurfaceReady, runReady });
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
      model: stringValue(root.model) || stringValue(runtimeHealth.model) || this.snapshot.model,
      provider: stringValue(root.provider) || this.snapshot.provider,
      runtimeUrl: stringValue(root.runtimeUrl) || this.snapshot.runtimeUrl,
      appUrl: stringValue(root.appUrl) || this.appBaseUrl,
      activeRunId,
      careerDomainToolCount,
      hermesCareerToolCount,
      requiredCareerFacadesReady: requiredReady,
      requiredCareerFacadesTotal: REQUIRED_CAREER_FACADES,
      providerStatus,
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
    if (ready) {
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
      lastExit: { code: details.code, signal: details.signal }
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
      this.publish({ overallState: "stopped", processReady: false, apiReady: false, providerReady: false, careerMcpReady: false, toolSurfaceReady: false, runReady: false, careerSkillsReady: false, activeRunId: undefined, reasonCode: reason, lastStopReason: stopReason }, "Hermes stopped");
      return this.getStatus();
    }
    const handle = this.handle;
    this.publish({ overallState: "stopping", reasonCode: reason, lastStopReason: stopReason }, "Hermes stopping");
    handle.supervisorStopping = true;
    await this.stopCompanion(handle, stopReason);
    if (this.handle === handle) this.handle = undefined;
    this.processStartedAt = undefined;
    this.publish({ overallState: "stopped", processReady: false, apiReady: false, providerReady: false, careerMcpReady: false, toolSurfaceReady: false, runReady: false, careerSkillsReady: false, activeRunId: undefined, reasonCode: reason, lastStopReason: stopReason }, "Hermes stopped");
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

function environmentFromHermesSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const settings = value;
  const read = (name) => typeof settings[name] === "string" ? settings[name].trim().slice(0, 20_000) : "";
  const baseUrl = read("baseUrl");
  const apiKey = read("apiKey");
  const model = read("model");
  return {
    ...(baseUrl ? { AI_BASE_URL: baseUrl } : {}),
    ...(apiKey ? { AI_API_KEY: apiKey } : {}),
    ...(model ? { AI_MODEL: model } : {})
  };
}

function healthReason(input) {
  const { root, runtimeHealth, providerStatus, apiReady, careerMcpReady, toolSurfaceReady, runReady } = input;
  const rawDirect = stringValue(runtimeHealth.runReadySafeErrorCode) || stringValue(runtimeHealth.safeErrorCode) || stringValue(root.reason);
  const direct = rawDirect ? safeReason(rawDirect) : undefined;
  if (providerStatus === "invalid" || providerStatus === "unconfigured") return direct || "configuration_required";
  if (!apiReady) return direct || "hermes_api_unreachable";
  if (!careerMcpReady) return direct || "career_mcp_sync_pending";
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
    "careerSkillsLoaded",
    "runReady",
    "runReadySafeErrorCode",
    "safeErrorCode",
    "lastCheckedAt"
  ]) {
    if (record[key] !== undefined) result[key] = record[key];
  }
  result.requiredCareerFacadesMissing = arrayOfStrings(record.requiredCareerFacadesMissing);
  result.careerGatewayContracts = arrayOfStrings(record.careerGatewayContracts);
  result.careerMcpExposedTools = arrayOfStrings(record.careerMcpExposedTools);
  result.hermesRegisteredToolsets = arrayOfStrings(record.hermesRegisteredToolsets);
  result.hermesVisibleTools = arrayOfStrings(record.hermesVisibleTools);
  return result;
}

function isTerminalState(state) {
  return ["stopped", "unavailable"].includes(state);
}

function isConfigurationReason(value) {
  return /auth|permission|forbidden|invalid[_-](?:model|provider|config|url)|provider_(?:invalid|unconfigured|auth)|configuration_required|config_or_provider/u.test(String(value || "").toLowerCase());
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
  isConfigurationReason
};
