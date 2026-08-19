import { encodeAiSettingsForHeader, readAiSettings, type AiSettings } from "@/services/storage/aiSettings";

export type HermesLifecycleState =
  | "stopped"
  | "starting"
  | "api_ready"
  | "syncing_career_tools"
  | "ready"
  | "degraded"
  | "restarting"
  | "unavailable"
  | "stopping";

export type HermesRuntimeEnvironment = "web" | "electron";
export type HermesControlOwner = "external_environment" | "electron_supervisor" | "none";
export type HermesServiceState = "stopped" | "starting" | "running" | "stopping" | "unavailable";
export type HermesApiState = "unreachable" | "reachable";
export type HermesProviderState = "unknown" | "checking" | "ready" | "auth_error" | "config_error" | "unreachable";
export type HermesRunState = "none" | "queued" | "running" | "waiting_for_user" | "stopping" | "completed" | "failed";
export type HermesControlStatus = "ready" | "starting" | "configuration_required" | "stopping" | "stopped" | "unavailable" | "degraded";
export type HermesCredentialSource = "server_env" | "managed_config" | "custom_header" | "default" | "missing" | "unknown";

export type HermesControlCapabilities = {
  environment: HermesRuntimeEnvironment;
  controlOwner: HermesControlOwner;
  canStartService: boolean;
  canStopService: boolean;
  canRestartService: boolean;
  canRecoverService: boolean;
  canReconnect: boolean;
  canStopCurrentRun: boolean;
  canTestProvider: boolean;
  unsupportedReason?: string;
};

export type HermesProviderDiagnostic = {
  provider?: string;
  model?: string;
  credentialConfigured: boolean;
  credentialSource: HermesCredentialSource;
  lastCheckedAt?: string;
  lastHttpStatus?: number;
  safeErrorCode?: string;
};

export type HermesStorageDiagnostic = {
  storageEnvironment: HermesRuntimeEnvironment;
  storageOrigin: string;
  storagePartition: string;
  activeProfileSource: string;
};

export type HermesControlHealthInput = {
  available?: boolean;
  runtimeId?: string;
  activeRunId?: string;
  hermesRunId?: string;
  runState?: HermesRunState;
  version?: string;
  reason?: string;
  provider?: string;
  model?: string;
  providerStatus?: string;
  runtimeUrl?: string;
  appUrl?: string;
  credentialConfigured?: boolean;
  credentialSource?: HermesCredentialSource;
  providerDiagnostic?: HermesProviderDiagnostic;
  runtimeHealth?: {
    runtimeAvailable?: boolean;
    companionReady?: boolean;
    providerConfigured?: boolean;
    providerReachable?: boolean;
    providerReady?: boolean;
    providerStatus?: string;
    model?: string;
    activeRunId?: string;
    hermesRunId?: string;
    runReady?: boolean;
    runState?: HermesRunState;
    mcpConnected?: boolean;
    mcpReady?: boolean;
    browserCareerDomainHostConnected?: boolean;
    careerMcpServerReachable?: boolean;
    hermesMcpRegistered?: boolean;
    hermesMcpToolCount?: number;
    hermesCareerFacadeCount?: number;
    requiredCareerFacadesMissing?: string[];
    careerMcpContractCount?: number;
    careerSkillsLoaded?: boolean;
    providerDiagnostic?: HermesProviderDiagnostic;
  };
};

export type HermesProviderTestResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  credentialConfigured: boolean;
  credentialSource: HermesCredentialSource;
  checkedAt: string;
  httpStatus?: number;
  safeErrorCode?: string;
  message?: string;
};

export type HermesControlAction =
  | "start"
  | "stop"
  | "restart"
  | "recover"
  | "reconnect"
  | "test_provider"
  | "stop_current_run"
  | "update_config"
  | "reset_config";

export type HermesControlActionReceipt = {
  action: HermesControlAction;
  requestedAt: string;
  accepted: boolean;
  executed: boolean;
  previousState: HermesServiceState;
  nextState: HermesServiceState;
  safeReasonCode: string;
  controlOwner: HermesControlOwner;
};

export type HermesControlSnapshot = {
  environment: HermesRuntimeEnvironment;
  supervisorExpected: boolean;
  controlOwner: HermesControlOwner;
  serviceState: HermesServiceState;
  apiState: HermesApiState;
  providerState: HermesProviderState;
  careerIntegration: {
    mcpReady: boolean;
    toolSurfaceReady: boolean;
    requiredToolCount: number;
    requiredToolTotal: number;
  };
  runState: HermesRunState;
  apiReady: boolean;
  providerReady: boolean;
  careerMcpReady: boolean;
  toolSurfaceReady: boolean;
  runReady: boolean;
  ready: boolean;
  status: HermesControlStatus;
  provider?: string;
  model?: string;
  careerDomainToolCount?: number;
  hermesCareerToolCount?: number;
  careerSkillsReady?: boolean;
  careerSkills?: string[];
  runtimeUrl?: string;
  appUrl?: string;
  version?: string;
  activeRunId?: string;
  providerDiagnostic: HermesProviderDiagnostic;
  storage: HermesStorageDiagnostic;
  capabilities: HermesControlCapabilities;
  safeReasonCode?: string;
  diagnosticReasonCode?: string;
  updatedAt: string;
};

export type HermesSupervisorSnapshot = {
  overallState: HermesLifecycleState;
  processReady: boolean;
  apiReady: boolean;
  providerReady: boolean;
  careerMcpReady: boolean;
  toolSurfaceReady: boolean;
  runReady: boolean;
  careerSkillsReady: boolean;
  reasonCode?: string;
  updatedAt: string;
  runtimeUrl?: string;
  appUrl?: string;
  version?: string;
  model?: string;
  provider?: string;
  activeRunId?: string;
  restartAttempt: number;
  uptimeMs: number;
  careerDomainToolCount: number;
  hermesCareerToolCount: number;
  requiredCareerFacadesReady: number;
  requiredCareerFacadesTotal: number;
  providerStatus?: string;
  credentialConfigured?: boolean;
  credentialSource?: HermesCredentialSource;
  providerDiagnostic?: HermesProviderDiagnostic;
  runState?: HermesRunState;
  careerSkills?: string[];
  missingRequiredCareerTools?: string[];
  hermesRegisteredToolsets?: string[];
  hermesVisibleTools?: string[];
  startupFailure?: string;
  lastExit?: { code?: number | null; signal?: string | null };
  lastStopReason?: {
    requestedBy: string;
    reasonCode: string;
    sourceComponent: string;
    sessionId?: string;
    logicalTurnId?: string;
    runId?: string;
    requestedAt?: string;
    incidentTraceId?: string;
  };
  health?: Record<string, unknown>;
  capabilities?: {
    supportedEndpoints: string[];
    features: Record<string, unknown>;
  };
  latestLifecycleEntries: Array<{
    at: string;
    message: string;
    state: HermesLifecycleState;
    reasonCode?: string;
  }>;
  logPath?: string;
  maintenancePending?: boolean;
  maintenanceReasonCode?: string;
  failureTimeSnapshot?: {
    capturedAt: string;
    reasonCode?: string;
    activeRunId?: string;
    runReady: boolean;
    overallState: HermesLifecycleState;
  };
};

export type HermesControlResult = {
  ok: boolean;
  reason?: string;
  runtimeUrl?: string;
  snapshot?: HermesSupervisorSnapshot;
  controlSnapshot?: HermesControlSnapshot;
  receipt?: HermesControlActionReceipt;
};

export type HermesStartSettings = Pick<AiSettings, "baseUrl" | "apiKey" | "model" | "provider">;

export type HermesLogs = {
  logPath?: string;
  latestLifecycleEntries: HermesSupervisorSnapshot["latestLifecycleEntries"];
  recentLogLines: string[];
  currentSnapshot?: HermesSupervisorSnapshot;
  failureTimeSnapshot?: HermesSupervisorSnapshot["failureTimeSnapshot"];
};

export type HermesConfigSnapshot = {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKeyConfigured: boolean;
  credentialSource?: HermesCredentialSource;
  providerDiagnostic?: HermesProviderDiagnostic;
  version?: string;
  configPath?: string;
  capabilities?: HermesSupervisorSnapshot["capabilities"];
  locked: Record<string, boolean>;
};

export type HermesConfigSchema = {
  version?: string;
  bundledRuntime: boolean;
  adminConfigWritable: boolean;
  supportedEndpoints: string[];
  unsupportedEndpoints: string[];
  supportedFields: Array<{ key: string; label: string; editable: boolean; secret?: boolean }>;
  lockedFields: string[];
};

export function readHermesStartSettings(): HermesStartSettings {
  return readAiSettings();
}

export function hermesRuntimeEnvironment(): HermesRuntimeEnvironment {
  return typeof window !== "undefined" && Boolean(window.careerAdaptDesktop) ? "electron" : "web";
}

export function createInitialHermesControlSnapshot(
  environment: HermesRuntimeEnvironment = hermesRuntimeEnvironment(),
  now = new Date().toISOString()
): HermesControlSnapshot {
  const controlOwner = environment === "electron" ? "electron_supervisor" : "external_environment";
  const serviceState = environment === "electron" ? "stopped" : "unavailable";
  return {
    environment,
    supervisorExpected: environment === "electron",
    controlOwner,
    serviceState,
    apiState: "unreachable",
    providerState: "unknown",
    careerIntegration: { mcpReady: false, toolSurfaceReady: false, requiredToolCount: 0, requiredToolTotal: 8 },
    runState: "none",
    apiReady: false,
    providerReady: false,
    careerMcpReady: false,
    toolSurfaceReady: false,
    runReady: false,
    ready: false,
    status: environment === "electron" ? "stopped" : "unavailable",
    providerDiagnostic: { credentialConfigured: false, credentialSource: "unknown" },
    storage: defaultStorageDiagnostic(environment),
    capabilities: createHermesControlCapabilities(environment, controlOwner, "none"),
    updatedAt: now
  };
}

export function createHermesControlSnapshot(input: {
  environment?: HermesRuntimeEnvironment;
  previous?: HermesControlSnapshot;
  supervisor?: HermesSupervisorSnapshot;
  health?: HermesControlHealthInput;
  providerTest?: HermesProviderTestResult;
  runState?: HermesRunState;
  activeProfileSource?: string;
} = {}): HermesControlSnapshot {
  const environment = input.environment ?? input.previous?.environment ?? hermesRuntimeEnvironment();
  const previous = input.previous;
  const supervisor = input.supervisor;
  const health = input.health;
  const runtimeHealth = health?.runtimeHealth;
  const controlOwner = environment === "electron" ? "electron_supervisor" : "external_environment";
  const apiReady = supervisor?.apiReady
    ?? (health?.available === true || runtimeHealth?.runtimeAvailable === true);
  const serviceState = supervisor
    ? serviceStateFromSupervisor(supervisor)
    : apiReady
      ? "running"
      : previous?.serviceState === "starting"
        ? "starting"
        : "unavailable";
  const activeRunId = supervisor?.activeRunId
    ?? health?.activeRunId
    ?? health?.hermesRunId
    ?? runtimeHealth?.activeRunId
    ?? runtimeHealth?.hermesRunId;
  const providerState = input.providerTest
    ? providerStateFromProviderTest(input.providerTest)
    : supervisor
      ? providerStateFromHealth({
          providerStatus: supervisor.providerStatus,
          providerDiagnostic: supervisor.providerDiagnostic,
          credentialConfigured: supervisor.credentialConfigured,
          credentialSource: supervisor.credentialSource,
          provider: supervisor.provider,
          model: supervisor.model
        }, previous?.providerState === "auth_error" || previous?.providerState === "config_error" ? previous.providerState : supervisor.providerReady ? "ready" : previous?.providerState)
      : providerStateFromHealth(health, previous?.providerState);
  const providerReady = supervisor?.providerReady
    ?? runtimeHealth?.providerReady
    ?? (runtimeHealth?.providerConfigured === true && runtimeHealth.providerReachable === true && Boolean(health?.model || runtimeHealth?.model));
  const careerMcpReady = supervisor?.careerMcpReady
    ?? runtimeHealth?.mcpReady
    ?? (runtimeHealth?.mcpConnected === true
      && runtimeHealth?.browserCareerDomainHostConnected === true
      && runtimeHealth?.careerMcpServerReachable === true);
  const requiredMissing = runtimeHealth?.requiredCareerFacadesMissing ?? [];
  const requiredToolTotal = supervisor?.requiredCareerFacadesTotal
    ?? Math.max(8, (runtimeHealth?.hermesCareerFacadeCount ?? 0) + requiredMissing.length);
  const requiredToolCount = supervisor?.requiredCareerFacadesReady
    ?? Math.max(0, requiredToolTotal - requiredMissing.length);
  const toolSurfaceReady = supervisor?.toolSurfaceReady
    ?? (runtimeHealth?.hermesMcpRegistered === true
      && (runtimeHealth?.hermesMcpToolCount ?? 0) > 0
      && requiredMissing.length === 0);
  const runReady = supervisor?.runReady
    ?? runtimeHealth?.runReady
    ?? (apiReady && providerReady && toolSurfaceReady);
  const runState = input.runState
    ?? health?.runState
    ?? runtimeHealth?.runState
    ?? supervisor?.runState
    ?? (activeRunId ? previous?.runState === "stopping" ? "stopping" : "running" : "none");
  const providerDiagnostic = mergeProviderDiagnostic(
    previous?.providerDiagnostic,
    health?.providerDiagnostic,
    runtimeHealth?.providerDiagnostic,
    supervisor?.providerDiagnostic,
    input.providerTest,
    {
      provider: health?.provider ?? supervisor?.provider ?? previous?.provider,
      model: health?.model ?? runtimeHealth?.model ?? supervisor?.model,
      credentialConfigured: health?.credentialConfigured
        ?? supervisor?.credentialConfigured
        ?? previous?.providerDiagnostic.credentialConfigured
        ?? false,
      credentialSource: health?.credentialSource
        ?? supervisor?.credentialSource
        ?? previous?.providerDiagnostic.credentialSource
        ?? "unknown"
    }
  );
  const resolvedProviderReady = providerReady && providerState === "ready";
  const ready = apiReady && resolvedProviderReady && careerMcpReady && toolSurfaceReady && runReady;
  const status = controlStatus({ ready, serviceState, apiReady, providerState });
  const diagnosticReasonCode = input.providerTest?.safeErrorCode
    ?? health?.reason
    ?? supervisor?.reasonCode
    ?? previous?.diagnosticReasonCode;
  const safeReasonCode = input.providerTest?.safeErrorCode
    ?? (providerState === "auth_error" ? "provider_auth_invalid" : undefined)
    ?? (providerState === "config_error" ? "configuration_required" : undefined)
    ?? (status === "ready" && diagnosticReasonCode === "health_endpoint_ready" ? undefined : diagnosticReasonCode)
    ?? previous?.safeReasonCode;
  const snapshot: HermesControlSnapshot = {
    environment,
    supervisorExpected: environment === "electron",
    controlOwner,
    serviceState,
    apiState: apiReady ? "reachable" : "unreachable",
    providerState,
    careerIntegration: {
      mcpReady: careerMcpReady,
      toolSurfaceReady,
      requiredToolCount,
      requiredToolTotal
    },
    runState,
    apiReady,
    providerReady: resolvedProviderReady,
    careerMcpReady,
    toolSurfaceReady,
    runReady,
    ready,
    status,
    provider: health?.provider ?? supervisor?.provider ?? previous?.provider,
    model: health?.model ?? runtimeHealth?.model ?? supervisor?.model ?? previous?.model,
    careerDomainToolCount: supervisor?.careerDomainToolCount ?? runtimeHealth?.careerMcpContractCount ?? previous?.careerDomainToolCount,
    hermesCareerToolCount: supervisor?.hermesCareerToolCount ?? runtimeHealth?.hermesMcpToolCount ?? previous?.hermesCareerToolCount,
    careerSkillsReady: supervisor?.careerSkillsReady ?? runtimeHealth?.careerSkillsLoaded ?? previous?.careerSkillsReady,
    ...(supervisor?.careerSkills ?? previous?.careerSkills ? { careerSkills: supervisor?.careerSkills ?? previous?.careerSkills } : {}),
    runtimeUrl: health?.runtimeUrl ?? supervisor?.runtimeUrl ?? previous?.runtimeUrl,
    appUrl: health?.appUrl ?? supervisor?.appUrl ?? previous?.appUrl,
    version: health?.version ?? supervisor?.version ?? previous?.version,
    ...(activeRunId ? { activeRunId } : {}),
    providerDiagnostic,
    storage: {
      ...(previous?.storage ?? defaultStorageDiagnostic(environment)),
      ...(input.activeProfileSource ? { activeProfileSource: input.activeProfileSource } : {})
    },
    capabilities: createHermesControlCapabilities(environment, controlOwner, runState),
    ...(safeReasonCode ? { safeReasonCode } : {}),
    ...(diagnosticReasonCode ? { diagnosticReasonCode } : {}),
    updatedAt: new Date().toISOString()
  };
  return snapshot;
}

export function createHermesControlSnapshotFromSupervisor(
  supervisor: HermesSupervisorSnapshot,
  previous?: HermesControlSnapshot
) {
  return createHermesControlSnapshot({ environment: "electron", previous, supervisor });
}

export function createHermesControlSnapshotFromHealth(
  health: HermesControlHealthInput,
  previous?: HermesControlSnapshot,
  environment: HermesRuntimeEnvironment = previous?.environment ?? hermesRuntimeEnvironment()
) {
  return createHermesControlSnapshot({ environment, previous, health });
}

export function applyHermesProviderTest(
  snapshot: HermesControlSnapshot,
  result: HermesProviderTestResult
) {
  return createHermesControlSnapshot({
    environment: snapshot.environment,
    previous: snapshot,
    providerTest: result,
    health: {
      available: snapshot.apiReady,
      provider: result.provider ?? snapshot.provider,
      model: result.model ?? snapshot.model,
      credentialConfigured: result.credentialConfigured,
      credentialSource: result.credentialSource,
      activeRunId: snapshot.activeRunId,
      runtimeUrl: snapshot.runtimeUrl,
      appUrl: snapshot.appUrl,
      runtimeHealth: {
        runtimeAvailable: snapshot.apiReady,
        providerReady: result.ok,
        runReady: snapshot.runReady,
        mcpReady: snapshot.careerMcpReady,
        mcpConnected: snapshot.careerMcpReady,
        browserCareerDomainHostConnected: snapshot.careerMcpReady,
        careerMcpServerReachable: snapshot.careerMcpReady,
        hermesMcpRegistered: snapshot.toolSurfaceReady,
        hermesMcpToolCount: snapshot.careerIntegration.requiredToolCount,
        hermesCareerFacadeCount: snapshot.careerIntegration.requiredToolCount,
        requiredCareerFacadesMissing: snapshot.careerIntegration.requiredToolTotal > snapshot.careerIntegration.requiredToolCount
          ? Array.from({ length: snapshot.careerIntegration.requiredToolTotal - snapshot.careerIntegration.requiredToolCount }, (_, index) => `missing-${index + 1}`)
          : []
      }
    }
  });
}

export function updateHermesControlRunState(
  snapshot: HermesControlSnapshot,
  runState: HermesRunState,
  activeRunId?: string
) {
  return createHermesControlSnapshot({
    environment: snapshot.environment,
    previous: snapshot,
    runState,
    health: {
      available: snapshot.apiReady,
      ...(activeRunId ? { activeRunId } : {}),
      provider: snapshot.provider,
      model: snapshot.model,
      credentialConfigured: snapshot.providerDiagnostic.credentialConfigured,
      credentialSource: snapshot.providerDiagnostic.credentialSource,
      providerDiagnostic: snapshot.providerDiagnostic,
      runtimeHealth: {
        runtimeAvailable: snapshot.apiReady,
        providerConfigured: snapshot.providerDiagnostic.credentialConfigured,
        providerReachable: snapshot.providerState === "ready",
        providerReady: snapshot.providerReady,
        providerStatus: snapshot.providerState === "ready" ? "ready" : undefined,
        model: snapshot.model,
        runReady: runState === "stopping" ? false : snapshot.runReady,
        mcpReady: snapshot.careerMcpReady,
        mcpConnected: snapshot.careerMcpReady,
        browserCareerDomainHostConnected: snapshot.careerMcpReady,
        careerMcpServerReachable: snapshot.careerMcpReady,
        hermesMcpRegistered: snapshot.toolSurfaceReady,
        hermesMcpToolCount: snapshot.hermesCareerToolCount ?? snapshot.careerIntegration.requiredToolCount,
        hermesCareerFacadeCount: snapshot.careerIntegration.requiredToolCount,
        requiredCareerFacadesMissing: snapshot.careerIntegration.requiredToolTotal > snapshot.careerIntegration.requiredToolCount
          ? Array.from({ length: snapshot.careerIntegration.requiredToolTotal - snapshot.careerIntegration.requiredToolCount }, (_, index) => `missing-${index + 1}`)
          : []
      }
    }
  });
}

export function createHermesControlCapabilities(
  environment: HermesRuntimeEnvironment,
  controlOwner: HermesControlOwner,
  runState: HermesRunState
): HermesControlCapabilities {
  const supportsServiceControl = environment === "electron" && controlOwner === "electron_supervisor";
  return {
    environment,
    controlOwner,
    canStartService: supportsServiceControl,
    canStopService: supportsServiceControl,
    canRestartService: supportsServiceControl,
    canRecoverService: supportsServiceControl,
    canReconnect: true,
    canStopCurrentRun: ["queued", "running", "waiting_for_user", "stopping"].includes(runState),
    canTestProvider: true,
    ...(supportsServiceControl ? {} : { unsupportedReason: "当前为 Web 调试模式，Hermes 服务进程由外部环境管理。进程启动/停止/重启仅在桌面版可直接控制。" })
  };
}

export function hermesControlStatusLabel(snapshot: HermesControlSnapshot) {
  if (snapshot.ready) return "Hermes Ready";
  if (snapshot.status === "configuration_required") return "需要配置";
  if (snapshot.apiState === "reachable" && (snapshot.providerState === "unknown" || snapshot.providerState === "checking")) return "Hermes API 已连接";
  if (snapshot.status === "starting") return "启动中";
  if (snapshot.status === "stopping") return "正在停止";
  if (snapshot.status === "stopped") return "已停止";
  if (snapshot.status === "unavailable") return "不可用";
  return "等待检查";
}

export function hermesControlFeedback(snapshot: HermesControlSnapshot) {
  if (snapshot.ready) return "Hermes Ready：API、Provider、Career MCP、工具面和 Run 均已就绪。";
  if (snapshot.status === "configuration_required") return "Hermes API 已连接，但 Provider 需要配置或认证修复。";
  if (snapshot.apiState === "reachable") return "Hermes API 已连接；Provider、Career MCP 或 Run 仍需单独检查。";
  if (snapshot.environment === "web") return "当前为 Web 调试模式，Hermes 服务进程由外部环境管理。";
  return `Hermes 状态：${hermesControlStatusLabel(snapshot)}。`;
}

function serviceStateFromSupervisor(snapshot: HermesSupervisorSnapshot): HermesServiceState {
  if (snapshot.overallState === "stopped") return "stopped";
  if (["starting", "api_ready", "syncing_career_tools", "restarting"].includes(snapshot.overallState)) return "starting";
  if (snapshot.overallState === "stopping") return "stopping";
  if (snapshot.overallState === "unavailable") return "unavailable";
  return snapshot.processReady ? "running" : "unavailable";
}

function providerStateFromHealth(health: HermesControlHealthInput | undefined, previous?: HermesProviderState): HermesProviderState {
  const runtimeHealth = health?.runtimeHealth;
  const diagnostic = runtimeHealth?.providerDiagnostic ?? health?.providerDiagnostic;
  const status = runtimeHealth?.providerStatus ?? health?.providerStatus;
  if (diagnostic?.lastHttpStatus === 401 || diagnostic?.lastHttpStatus === 403 || diagnostic?.safeErrorCode === "provider_http_401" || diagnostic?.safeErrorCode === "provider_http_403") return "auth_error";
  if (status === "ready" || runtimeHealth?.providerReady === true) return "ready";
  if (status === "unconfigured") return "config_error";
  if (status === "unreachable" || runtimeHealth?.providerReachable === false) return "unreachable";
  if (status === "invalid") return previous === "auth_error" ? "auth_error" : "config_error";
  if (previous === "auth_error" || previous === "config_error") return previous;
  if (previous === "ready") return "ready";
  return "unknown";
}

function providerStateFromProviderTest(result: HermesProviderTestResult): HermesProviderState {
  if (result.ok) return "ready";
  if (result.safeErrorCode === "provider_http_401" || result.safeErrorCode === "provider_http_403" || result.httpStatus === 401 || result.httpStatus === 403) return "auth_error";
  if (result.safeErrorCode === "missing_ai_config" || result.safeErrorCode === "provider_protocol_mismatch" || result.safeErrorCode === "provider_http_400" || result.safeErrorCode === "provider_http_404" || result.safeErrorCode === "provider_http_422") return "config_error";
  if (result.safeErrorCode?.startsWith("provider_")) return "unreachable";
  return "unknown";
}

function controlStatus(input: { ready: boolean; serviceState: HermesServiceState; apiReady: boolean; providerState: HermesProviderState }): HermesControlStatus {
  if (input.ready) return "ready";
  if (input.providerState === "auth_error" || input.providerState === "config_error") return "configuration_required";
  if (input.serviceState === "stopping") return "stopping";
  if (input.serviceState === "starting") return "starting";
  if (input.serviceState === "stopped") return "stopped";
  if (input.serviceState === "unavailable" && !input.apiReady) return "unavailable";
  return "degraded";
}

function mergeProviderDiagnostic(
  ...values: Array<{
    provider?: string;
    model?: string;
    credentialConfigured?: boolean;
    credentialSource?: HermesCredentialSource;
    lastCheckedAt?: string;
    checkedAt?: string;
    lastHttpStatus?: number;
    httpStatus?: number;
    safeErrorCode?: string;
  } | undefined>
): HermesProviderDiagnostic {
  const result: HermesProviderDiagnostic = { credentialConfigured: false, credentialSource: "unknown" };
  for (const value of values) {
    if (!value) continue;
    if (typeof value.provider === "string") result.provider = value.provider;
    if (typeof value.model === "string") result.model = value.model;
    if (typeof value.credentialConfigured === "boolean") result.credentialConfigured = value.credentialConfigured;
    if (value.credentialSource) result.credentialSource = value.credentialSource;
    if (typeof value.lastCheckedAt === "string") result.lastCheckedAt = value.lastCheckedAt;
    if (typeof value.checkedAt === "string") result.lastCheckedAt = value.checkedAt;
    if (typeof value.lastHttpStatus === "number") result.lastHttpStatus = value.lastHttpStatus;
    if (typeof value.httpStatus === "number") result.lastHttpStatus = value.httpStatus;
    if (typeof value.safeErrorCode === "string") result.safeErrorCode = value.safeErrorCode;
  }
  return result;
}

function defaultStorageDiagnostic(environment: HermesRuntimeEnvironment): HermesStorageDiagnostic {
  if (typeof window === "undefined") {
    return {
      storageEnvironment: environment,
      storageOrigin: "server-context",
      storagePartition: environment === "electron" ? "electron-default-session" : "web-default-session",
      activeProfileSource: "not_observed"
    };
  }
  return {
    storageEnvironment: environment,
    storageOrigin: window.location.origin,
    storagePartition: environment === "electron" ? "electron-default-session" : "web-default-session",
    activeProfileSource: "current-local-workspace"
  };
}

/** Starts or reuses the local Hermes companion without exposing credentials to the browser. */
export async function requestHermesStart(): Promise<HermesControlResult> {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("start");
  const settings = readAiSettings();
  return window.careerAdaptDesktop!.startHermes(settings);
}

export async function notifyHermesRendererReady(settings?: HermesStartSettings) {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.notifyHermesRendererReady(settings);
}

export async function getHermesStatus() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.getHermesStatus();
}

export function subscribeHermesStatus(listener: (snapshot: HermesSupervisorSnapshot) => void) {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return () => undefined;
  return window.careerAdaptDesktop.subscribeHermesStatus(listener);
}

export async function requestHermesStop() {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("stop");
  return window.careerAdaptDesktop!.stopHermes();
}

export async function requestHermesRestart(options?: { auto?: boolean; reason?: string }) {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("restart");
  return window.careerAdaptDesktop!.restartHermes(options);
}

export async function requestHermesRecover() {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("recover");
  return window.careerAdaptDesktop!.recoverHermes();
}

export async function getHermesLogs() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.getHermesLogs();
}

export async function openHermesLogs() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.openHermesLogs();
}

export async function getHermesConfig() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.getHermesConfig();
}

export async function getHermesConfigSchema() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.getHermesConfigSchema();
}

export async function requestHermesConfigUpdate(settings: HermesStartSettings) {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("update_config");
  return window.careerAdaptDesktop!.updateHermesConfig(settings);
}

export async function requestHermesConfigReset() {
  if (hermesRuntimeEnvironment() === "web") return unsupportedControlResult("reset_config");
  return window.careerAdaptDesktop!.resetHermesConfig();
}

export async function requestHermesProviderTest(settings = readAiSettings()): Promise<HermesProviderTestResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (hasCustomSettings(settings)) headers["x-ai-config"] = encodeAiSettingsForHeader(settings);
  const response = await fetch("/api/ai/test", { method: "POST", headers });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const configuration = asRecord(payload.configuration);
  const sources = asRecord(configuration.sources);
  const diagnostics = asRecord(payload.diagnostics);
  const http = asRecord(diagnostics.http);
  const safeErrorCode = typeof payload.code === "string" ? payload.code : undefined;
  const configured = typeof configuration.credentialPresent === "boolean"
    ? configuration.credentialPresent
    : Boolean(settings.apiKey.trim());
  const credentialSource = credentialSourceValue(sources.credential)
    ?? (settings.apiKey.trim() ? "custom_header" : "unknown");
  const httpStatus = numberValue(http.statusCode)
    ?? (safeErrorCode?.startsWith("provider_http_") ? Number(safeErrorCode.slice("provider_http_".length)) : undefined);
  return {
    ok: response.ok && payload.ok === true,
    provider: typeof payload.provider === "string" ? payload.provider : typeof configuration.provider === "string" ? configuration.provider : settings.provider,
    model: typeof payload.model === "string" ? payload.model : typeof configuration.model === "string" ? configuration.model : settings.model || undefined,
    credentialConfigured: configured,
    credentialSource,
    checkedAt: new Date().toISOString(),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(safeErrorCode ? { safeErrorCode } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {})
  };
}

function unsupportedControlResult(action: HermesControlAction): HermesControlResult {
  const snapshot = createInitialHermesControlSnapshot("web");
  return {
    ok: false,
    reason: "control_not_supported_in_web",
    controlSnapshot: snapshot,
    receipt: {
      action,
      requestedAt: new Date().toISOString(),
      accepted: false,
      executed: false,
      previousState: snapshot.serviceState,
      nextState: snapshot.serviceState,
      safeReasonCode: "control_not_supported_in_web",
      controlOwner: "external_environment"
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}

function credentialSourceValue(value: unknown): HermesCredentialSource | undefined {
  return value === "server_env" || value === "managed_config" || value === "custom_header" || value === "default" || value === "missing" || value === "unknown"
    ? value
    : undefined;
}

function hasCustomSettings(settings: HermesStartSettings) {
  return Boolean(settings.apiKey.trim() || settings.baseUrl.trim() || settings.model.trim());
}
