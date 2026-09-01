import { encodeAiSettingsForHeader, hasStoredAiSettings, readAiSettings, type AiSettings } from "@/services/storage/aiSettings";
import type {
  AiRuntimeConfigActive,
  AiRuntimeConfigApplyReceipt,
  AiRuntimeConfigApplyStatus,
  AiRuntimeConfigDesired,
  AiRuntimeConfigState
} from "./aiRuntimeConfiguration";
import { normalizeAiProviderIdentity } from "./aiRuntimeConfiguration";
import { runtimeConfigFingerprint } from "./aiRuntimeConfiguration";

export type {
  AiRuntimeConfigActive,
  AiRuntimeConfigApplyReceipt,
  AiRuntimeConfigApplyStatus,
  AiRuntimeConfigDesired,
  AiRuntimeConfigDraft,
  AiRuntimeConfigState,
  AiRuntimeConfigSource,
  AiRuntimeConfigValue
} from "./aiRuntimeConfiguration";

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
export type HermesControlOwner = "external_environment" | "electron_supervisor" | "web_supervisor" | "none";
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
  configFingerprint?: string;
  configGeneration?: number;
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

export type CandidateProviderTestResult = {
  ok: boolean;
  provider?: string;
  model?: string;
  credentialConfigured: boolean;
  credentialSource: HermesCredentialSource;
  configFingerprint?: string;
  checkedAt: string;
  latencyMs?: number;
  httpStatus?: number;
  safeErrorCode?: string;
  message?: string;
};

/** Backwards-compatible name for callers that only need the candidate result. */
export type HermesProviderTestResult = CandidateProviderTestResult;

export type HermesControlAction =
  | "start"
  | "stop"
  | "restart"
  | "recover"
  | "reconnect"
  | "test_provider"
  | "stop_current_run"
  | "update_config"
  | "reload_config"
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
  applyStatus?: AiRuntimeConfigApplyStatus;
  desiredFingerprint?: string;
  activeFingerprint?: string;
  restartPerformed?: boolean;
  verified?: boolean;
  rollbackOccurred?: boolean;
  reasonCode?: string;
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
  runtimeConfig: AiRuntimeConfigState;
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
  runtimeConfig?: AiRuntimeConfigState;
  lastApplyReceipt?: AiRuntimeConfigApplyReceipt;
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

export type HermesStartSettings = AiSettings;

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
  sources?: {
    provider: HermesCredentialSource;
    baseUrl: HermesCredentialSource;
    model: HermesCredentialSource;
    credential: HermesCredentialSource;
  };
  providerDiagnostic?: HermesProviderDiagnostic;
  active?: AiRuntimeConfigActive;
  desired?: AiRuntimeConfigDesired;
  activeFingerprint?: string;
  desiredFingerprint?: string;
  activeGeneration?: number;
  desiredGeneration?: number;
  applyStatus?: AiRuntimeConfigApplyStatus;
  lastApplyReceipt?: AiRuntimeConfigApplyReceipt;
  version?: string;
  configPath?: string;
  runtimeConfigWritable?: boolean;
  capabilities?: HermesSupervisorSnapshot["capabilities"];
  locked: Record<string, boolean>;
};

export type HermesConfigSchema = {
  version?: string;
  bundledRuntime: boolean;
  adminConfigWritable: boolean;
  runtimeConfigWritable?: boolean;
  supportedEndpoints: string[];
  unsupportedEndpoints: string[];
  supportedFields: Array<{ key: string; label: string; editable: boolean; secret?: boolean }>;
  lockedFields: string[];
};

export function readHermesStartSettings(): HermesStartSettings | undefined {
  return hasStoredAiSettings() ? readAiSettings() : undefined;
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
    runtimeConfig: { applyStatus: "idle", rollbackOccurred: false },
    storage: defaultStorageDiagnostic(environment),
    capabilities: createHermesControlCapabilities(environment, controlOwner, "none"),
    updatedAt: now
  };
}

type HermesControlProjection = {
  apiReady: boolean;
  serviceState: HermesServiceState;
  activeRunId?: string;
  providerState: HermesProviderState;
  providerReady: boolean;
  careerMcpReady: boolean;
  requiredMissing: string[];
  requiredToolTotal: number;
  requiredToolCount: number;
  toolSurfaceReady: boolean;
  runReady: boolean;
  runState: HermesRunState;
  provider?: string;
  model?: string;
  providerDiagnostic: HermesProviderDiagnostic;
  careerDomainToolCount?: number;
  hermesCareerToolCount?: number;
  careerSkillsReady?: boolean;
  careerSkills?: string[];
  runtimeUrl?: string;
  appUrl?: string;
  version?: string;
  runtimeConfig: AiRuntimeConfigState;
  diagnosticReasonCode?: string;
};

export function createHermesControlSnapshot(input: {
  environment?: HermesRuntimeEnvironment;
  controlOwner?: HermesControlOwner;
  previous?: HermesControlSnapshot;
  supervisor?: HermesSupervisorSnapshot;
  health?: HermesControlHealthInput;
  runState?: HermesRunState;
  activeProfileSource?: string;
} = {}): HermesControlSnapshot {
  const environment = input.environment ?? input.previous?.environment ?? hermesRuntimeEnvironment();
  const previous = input.previous;
  const controlOwner = input.controlOwner
    ?? (input.supervisor
      ? environment === "electron" ? "electron_supervisor" : "web_supervisor"
      : environment === "electron"
        ? "electron_supervisor"
        : previous?.controlOwner === "web_supervisor" ? "web_supervisor" : "external_environment");
  const projection = input.supervisor
    ? projectSupervisorSnapshot(input.supervisor, previous)
    : projectHealthSnapshot(input.health, previous);
  const runState = input.runState ?? projection.runState;
  const resolvedProviderReady = projection.providerReady && projection.providerState === "ready";
  const ready = projection.apiReady
    && resolvedProviderReady
    && projection.careerMcpReady
    && projection.toolSurfaceReady
    && projection.runReady;
  const status = controlStatus({
    ready,
    serviceState: projection.serviceState,
    apiReady: projection.apiReady,
    providerState: projection.providerState
  });
  const safeReasonCode = (projection.providerState === "auth_error" ? "provider_auth_invalid" : undefined)
    ?? (projection.providerState === "config_error" ? "configuration_required" : undefined)
    ?? (status === "ready" && projection.diagnosticReasonCode === "health_endpoint_ready" ? undefined : projection.diagnosticReasonCode)
    ?? (input.supervisor ? undefined : previous?.safeReasonCode);
  return {
    environment,
    supervisorExpected: controlOwner === "electron_supervisor" || controlOwner === "web_supervisor",
    controlOwner,
    serviceState: projection.serviceState,
    apiState: projection.apiReady ? "reachable" : "unreachable",
    providerState: projection.providerState,
    careerIntegration: {
      mcpReady: projection.careerMcpReady,
      toolSurfaceReady: projection.toolSurfaceReady,
      requiredToolCount: projection.requiredToolCount,
      requiredToolTotal: projection.requiredToolTotal
    },
    runState,
    apiReady: projection.apiReady,
    providerReady: resolvedProviderReady,
    careerMcpReady: projection.careerMcpReady,
    toolSurfaceReady: projection.toolSurfaceReady,
    runReady: projection.runReady,
    ready,
    status,
    ...(projection.provider ? { provider: projection.provider } : {}),
    model: projection.model,
    careerDomainToolCount: projection.careerDomainToolCount,
    hermesCareerToolCount: projection.hermesCareerToolCount,
    careerSkillsReady: projection.careerSkillsReady,
    ...(projection.careerSkills ? { careerSkills: projection.careerSkills } : {}),
    runtimeUrl: projection.runtimeUrl,
    appUrl: projection.appUrl,
    version: projection.version,
    ...(projection.activeRunId ? { activeRunId: projection.activeRunId } : {}),
    providerDiagnostic: projection.providerDiagnostic,
    runtimeConfig: projection.runtimeConfig,
    storage: {
      ...(previous?.storage ?? defaultStorageDiagnostic(environment)),
      ...(input.activeProfileSource ? { activeProfileSource: input.activeProfileSource } : {})
    },
    capabilities: createHermesControlCapabilities(environment, controlOwner, runState),
    ...(safeReasonCode ? { safeReasonCode } : {}),
    ...(projection.diagnosticReasonCode ? { diagnosticReasonCode: projection.diagnosticReasonCode } : {}),
    updatedAt: new Date().toISOString()
  };
}

function projectSupervisorSnapshot(supervisor: HermesSupervisorSnapshot, previous?: HermesControlSnapshot): HermesControlProjection {
  const active = supervisor.runtimeConfig?.active;
  const providerState = providerStateFromHealth({
    providerStatus: supervisor.providerStatus,
    providerDiagnostic: supervisor.providerDiagnostic,
    credentialConfigured: supervisor.credentialConfigured,
    credentialSource: supervisor.credentialSource,
    provider: supervisor.provider,
    model: supervisor.model
  }, previous?.providerState === "auth_error" || previous?.providerState === "config_error"
    ? previous.providerState
    : supervisor.providerReady ? "ready" : previous?.providerState);
  const provider = active?.provider ?? supervisor.provider;
  return {
    apiReady: supervisor.apiReady,
    serviceState: serviceStateFromSupervisor(supervisor),
    activeRunId: supervisor.activeRunId,
    providerState,
    providerReady: supervisor.providerReady,
    careerMcpReady: supervisor.careerMcpReady,
    requiredMissing: [],
    requiredToolTotal: supervisor.requiredCareerFacadesTotal,
    requiredToolCount: supervisor.requiredCareerFacadesReady,
    toolSurfaceReady: supervisor.toolSurfaceReady,
    runReady: supervisor.runReady,
    runState: supervisor.runState ?? (supervisor.activeRunId ? previous?.runState === "stopping" ? "stopping" : "running" : "none"),
    ...(provider ? { provider: normalizeAiProviderIdentity(provider, undefined) } : {}),
    model: active?.model ?? supervisor.model,
    providerDiagnostic: mergeProviderDiagnostic(
      supervisor.providerDiagnostic,
      active ? {
        provider: active.provider,
        model: active.model,
        credentialConfigured: active.credentialConfigured,
        credentialSource: active.credentialSource,
        configFingerprint: active.configFingerprint,
        configGeneration: active.configGeneration
      } : undefined,
      {
        ...(provider ? { provider } : {}),
        model: active?.model ?? supervisor.model,
        credentialConfigured: active?.credentialConfigured ?? supervisor.credentialConfigured ?? false,
        credentialSource: active?.credentialSource ?? supervisor.credentialSource ?? "unknown"
      }
    ),
    careerDomainToolCount: supervisor.careerDomainToolCount,
    hermesCareerToolCount: supervisor.hermesCareerToolCount,
    careerSkillsReady: supervisor.careerSkillsReady,
    ...((supervisor.careerSkills ?? previous?.careerSkills) ? { careerSkills: supervisor.careerSkills ?? previous?.careerSkills } : {}),
    runtimeUrl: supervisor.runtimeUrl,
    appUrl: supervisor.appUrl,
    version: supervisor.version,
    runtimeConfig: supervisor.runtimeConfig ?? previous?.runtimeConfig ?? { applyStatus: "idle", rollbackOccurred: false },
    diagnosticReasonCode: supervisor.reasonCode ?? previous?.diagnosticReasonCode
  };
}

function projectHealthSnapshot(health: HermesControlHealthInput | undefined, previous?: HermesControlSnapshot): HermesControlProjection {
  const runtimeHealth = health?.runtimeHealth;
  const apiReady = health?.available === true || runtimeHealth?.runtimeAvailable === true;
  const activeRunId = health?.activeRunId
    ?? health?.hermesRunId
    ?? runtimeHealth?.activeRunId
    ?? runtimeHealth?.hermesRunId;
  const providerState = providerStateFromHealth(health, previous?.providerState);
  const providerReady = runtimeHealth?.providerReady
    ?? (runtimeHealth?.providerConfigured === true && runtimeHealth.providerReachable === true && Boolean(health?.model || runtimeHealth?.model));
  const careerMcpReady = runtimeHealth?.mcpReady
    ?? (runtimeHealth?.mcpConnected === true
      && runtimeHealth?.browserCareerDomainHostConnected === true
      && runtimeHealth?.careerMcpServerReachable === true);
  const requiredMissing = runtimeHealth?.requiredCareerFacadesMissing ?? [];
  const requiredToolTotal = Math.max(8, (runtimeHealth?.hermesCareerFacadeCount ?? 0) + requiredMissing.length);
  const toolSurfaceReady = runtimeHealth?.hermesMcpRegistered === true
    && (runtimeHealth?.hermesMcpToolCount ?? 0) > 0
    && requiredMissing.length === 0;
  const runReady = runtimeHealth?.runReady
    ?? (apiReady && providerReady && toolSurfaceReady);
  const reportedProvider = health?.provider ?? previous?.provider;
  const provider = reportedProvider ? normalizeAiProviderIdentity(reportedProvider, undefined) : undefined;
  return {
    apiReady,
    serviceState: apiReady ? "running" : previous?.serviceState === "starting" ? "starting" : "unavailable",
    activeRunId,
    providerState,
    providerReady,
    careerMcpReady,
    requiredMissing,
    requiredToolTotal,
    requiredToolCount: Math.max(0, requiredToolTotal - requiredMissing.length),
    toolSurfaceReady,
    runReady,
    runState: health?.runState
      ?? runtimeHealth?.runState
      ?? (activeRunId ? previous?.runState === "stopping" ? "stopping" : "running" : "none"),
    ...(provider ? { provider } : {}),
    model: health?.model ?? runtimeHealth?.model ?? previous?.model,
    providerDiagnostic: mergeProviderDiagnostic(
      previous?.providerDiagnostic,
      health?.providerDiagnostic,
      runtimeHealth?.providerDiagnostic,
      {
        ...(provider ? { provider } : {}),
        model: health?.model ?? runtimeHealth?.model,
        credentialConfigured: health?.credentialConfigured ?? previous?.providerDiagnostic.credentialConfigured ?? false,
        credentialSource: health?.credentialSource ?? previous?.providerDiagnostic.credentialSource ?? "unknown"
      }
    ),
    careerDomainToolCount: runtimeHealth?.careerMcpContractCount ?? previous?.careerDomainToolCount,
    hermesCareerToolCount: runtimeHealth?.hermesMcpToolCount ?? previous?.hermesCareerToolCount,
    careerSkillsReady: runtimeHealth?.careerSkillsLoaded ?? previous?.careerSkillsReady,
    ...(previous?.careerSkills ? { careerSkills: previous.careerSkills } : {}),
    runtimeUrl: health?.runtimeUrl ?? previous?.runtimeUrl,
    appUrl: health?.appUrl ?? previous?.appUrl,
    version: health?.version ?? previous?.version,
    runtimeConfig: previous?.runtimeConfig ?? { applyStatus: "idle", rollbackOccurred: false },
    diagnosticReasonCode: health?.reason ?? previous?.diagnosticReasonCode
  };
}

export function createHermesControlSnapshotFromSupervisor(
  supervisor: HermesSupervisorSnapshot,
  previous?: HermesControlSnapshot,
  environment: HermesRuntimeEnvironment = "electron"
) {
  return createHermesControlSnapshot({
    environment,
    controlOwner: environment === "electron" ? "electron_supervisor" : "web_supervisor",
    previous,
    supervisor
  });
}

export function createHermesControlSnapshotFromHealth(
  health: HermesControlHealthInput,
  previous?: HermesControlSnapshot,
  environment: HermesRuntimeEnvironment = previous?.environment ?? hermesRuntimeEnvironment()
) {
  return createHermesControlSnapshot({ environment, previous, health });
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
  const supportsServiceControl = (environment === "electron" && controlOwner === "electron_supervisor")
    || (environment === "web" && controlOwner === "web_supervisor");
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
    ...(supportsServiceControl || environment === "electron"
      ? {}
      : { unsupportedReason: "当前 Web 调试模式未授予本地 Supervisor 控制权；可使用重新检测，或启用 HERMES_WEB_CONTROL_ENABLED 后重启开发服务。" })
  };
}

export function hermesControlStatusLabel(snapshot: HermesControlSnapshot) {
  if (["validating", "testing", "saving", "restarting_runtime", "verifying"].includes(snapshot.runtimeConfig.applyStatus)) return "正在应用模型…";
  if (snapshot.runtimeConfig.applyStatus === "deferred") return "等待应用配置";
  if (snapshot.ready) return "Ready";
  if (snapshot.status === "configuration_required") return "需要配置";
  if (snapshot.apiState === "reachable" && (snapshot.providerState === "unknown" || snapshot.providerState === "checking")) return "Hermes API 已连接";
  if (snapshot.status === "starting") return "启动中";
  if (snapshot.status === "stopping") return "正在停止";
  if (snapshot.status === "stopped") return "已停止";
  if (snapshot.status === "unavailable") return "不可用";
  return "等待检查";
}

export function hermesControlFeedback(snapshot: HermesControlSnapshot) {
  const reasonCode = snapshot.safeReasonCode ?? snapshot.diagnosticReasonCode;
  if (["validating", "testing", "saving", "restarting_runtime", "verifying"].includes(snapshot.runtimeConfig.applyStatus)) return "正在应用模型…";
  if (snapshot.runtimeConfig.applyStatus === "rolled_back") return "新配置未通过检查，已恢复原来的模型。";
  if (snapshot.runtimeConfig.applyStatus === "failed") return humanHermesReason(reasonCode) ?? "配置未应用，请检查 API 地址、模型和 API Key。";
  if (snapshot.ready) return "AI Agent 已就绪。";
  if (reasonCode) return humanHermesReason(reasonCode) ?? "AI Agent 当前不可用，请查看开发者诊断。";
  if (snapshot.status === "configuration_required") return "API Key 无效或没有模型权限。";
  if (snapshot.apiState === "reachable" && !snapshot.careerMcpReady) return "Career 工具连接失败。";
  if (snapshot.apiState === "reachable") return "AI Agent 正在检查运行条件。";
  if (snapshot.controlOwner === "external_environment") return "当前为 Web 调试模式，Hermes 服务进程由外部环境管理。";
  if (snapshot.controlOwner === "web_supervisor") return "Web Supervisor 正在管理 Hermes 服务进程。";
  return "AI Agent 当前不可用，请查看开发者诊断。";
}

function humanHermesReason(reasonCode?: string) {
  if (!reasonCode) return undefined;
  if (["provider_auth_invalid", "provider_http_401", "provider_http_403"].includes(reasonCode)) return "API Key 无效或没有模型权限。";
  if (["provider_model_not_found", "configuration_desync"].includes(reasonCode)) return "未找到这个模型，请检查模型名称。";
  if (["hermes_api_unreachable", "provider_dns_failed", "provider_connection_failed", "provider_timeout"].includes(reasonCode)) return "无法连接 API 地址，请检查地址和网络。";
  if (["career_mcp_sync_pending", "career_tool_contract_mismatch", "hermes_tool_surface_sync_pending"].includes(reasonCode)) return "Career 工具连接失败。";
  if (["hermes_companion_start_failed", "hermes_process_crashed", "hermes_restart_circuit_open"].includes(reasonCode)) return "AI Agent 启动失败。";
  return undefined;
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
    configFingerprint?: string;
    configGeneration?: number;
  } | undefined>
): HermesProviderDiagnostic {
  const result: HermesProviderDiagnostic = { credentialConfigured: false, credentialSource: "unknown" };
  for (const value of values) {
    if (!value) continue;
    if (typeof value.provider === "string") result.provider = normalizeAiProviderIdentity(value.provider, value.provider);
    if (typeof value.model === "string") result.model = value.model;
    if (typeof value.credentialConfigured === "boolean") result.credentialConfigured = value.credentialConfigured;
    if (value.credentialSource) result.credentialSource = value.credentialSource;
    if (typeof value.lastCheckedAt === "string") result.lastCheckedAt = value.lastCheckedAt;
    if (typeof value.checkedAt === "string") result.lastCheckedAt = value.checkedAt;
    if (typeof value.lastHttpStatus === "number") result.lastHttpStatus = value.lastHttpStatus;
    if (typeof value.httpStatus === "number") result.lastHttpStatus = value.httpStatus;
    if (typeof value.safeErrorCode === "string") result.safeErrorCode = value.safeErrorCode;
    if (typeof value.configFingerprint === "string") result.configFingerprint = value.configFingerprint;
    if (typeof value.configGeneration === "number") result.configGeneration = value.configGeneration;
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
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("start", { rendererReady: true });
  const settings = readAiSettings();
  return window.careerAdaptDesktop!.startHermes(hasStoredAiSettings() ? settings : undefined);
}

export async function notifyHermesRendererReady(settings?: HermesStartSettings) {
  if (typeof window === "undefined") return undefined;
  if (window.careerAdaptDesktop) return window.careerAdaptDesktop.notifyHermesRendererReady(settings);
  const result = await requestWebHermesControl("start", { rendererReady: true, settings });
  return result.reason === "web_control_disabled" ? undefined : result;
}

export async function getHermesStatus() {
  if (typeof window === "undefined") return undefined;
  if (window.careerAdaptDesktop) return window.careerAdaptDesktop.getHermesStatus();
  try {
    const response = await fetch(WEB_HERMES_CONTROL_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return undefined;
    const payload = await response.json() as { snapshot?: HermesSupervisorSnapshot };
    return payload.snapshot;
  } catch {
    // A web Hermes supervisor may be unavailable during startup or after a
    // server restart. Status observation is best-effort and must not create
    // an unhandled browser rejection.
    return undefined;
  }
}

export function subscribeHermesStatus(listener: (snapshot: HermesSupervisorSnapshot) => void) {
  if (typeof window === "undefined") return () => undefined;
  if (window.careerAdaptDesktop) return window.careerAdaptDesktop.subscribeHermesStatus(listener);
  let stopped = false;
  let timer: number | undefined;
  let consecutiveFailures = 0;
  const poll = async () => {
    if (stopped) return;
    const snapshot = await getHermesStatus();
    if (snapshot && !stopped) {
      consecutiveFailures = 0;
      listener(snapshot);
    } else {
      consecutiveFailures += 1;
    }
    if (!stopped) {
      const delay = snapshot
        ? 2_000
        : Math.min(30_000, 2_000 * (2 ** Math.min(consecutiveFailures, 4)));
      timer = window.setTimeout(() => { void poll(); }, delay);
    }
  };
  void poll();
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

export async function requestHermesStop() {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("stop");
  return window.careerAdaptDesktop!.stopHermes();
}

export async function requestHermesRestart(options?: { auto?: boolean; reason?: string }) {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("restart", { options });
  return window.careerAdaptDesktop!.restartHermes(options);
}

export async function requestHermesRecover() {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("recover");
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
  if (typeof window === "undefined") return undefined;
  if (window.careerAdaptDesktop) return window.careerAdaptDesktop.getHermesConfig();
  const payload = await requestWebHermesView();
  return payload?.config;
}

export async function getHermesConfigSchema() {
  if (typeof window === "undefined") return undefined;
  if (window.careerAdaptDesktop) return window.careerAdaptDesktop.getHermesConfigSchema();
  const payload = await requestWebHermesView();
  return payload?.configSchema;
}

export async function requestHermesConfigUpdate(settings: HermesStartSettings) {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("update_config", { rendererReady: true, settings });
  return window.careerAdaptDesktop!.updateHermesConfig(settings);
}

export async function requestHermesEnvironmentReload() {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("reload_config", { rendererReady: true });
  return window.careerAdaptDesktop!.reloadHermesConfig();
}

export async function requestHermesConfigReset() {
  if (hermesRuntimeEnvironment() === "web") return requestWebHermesControl("reset_config", { rendererReady: true });
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
  const configFingerprint = typeof payload.configFingerprint === "string"
    ? payload.configFingerprint
    : typeof configuration.configFingerprint === "string"
      ? configuration.configFingerprint
      : await runtimeConfigFingerprint({
          provider: typeof configuration.provider === "string" ? configuration.provider : settings.provider,
          baseUrl: settings.baseUrl,
          model: typeof configuration.model === "string" ? configuration.model : settings.model,
          apiKey: settings.apiKey
        });
  const httpStatus = numberValue(http.statusCode)
    ?? (safeErrorCode?.startsWith("provider_http_") ? Number(safeErrorCode.slice("provider_http_".length)) : undefined);
  const latencyMs = numberValue(payload.latencyMs);
  return {
    ok: response.ok && payload.ok === true,
    provider: normalizeAiProviderIdentity(
      typeof payload.provider === "string" ? payload.provider : typeof configuration.provider === "string" ? configuration.provider : settings.provider,
      settings.baseUrl
    ),
    model: typeof payload.model === "string" ? payload.model : typeof configuration.model === "string" ? configuration.model : settings.model || undefined,
    credentialConfigured: configured,
    credentialSource,
    configFingerprint,
    checkedAt: new Date().toISOString(),
    ...(latencyMs === undefined ? {} : { latencyMs }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(safeErrorCode ? { safeErrorCode } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {})
  };
}

function unsupportedControlResult(action: HermesControlAction, reason = "web_control_disabled"): HermesControlResult {
  const snapshot = createInitialHermesControlSnapshot("web");
  return {
    ok: false,
    reason,
    controlSnapshot: snapshot,
    receipt: {
      action,
      requestedAt: new Date().toISOString(),
      accepted: false,
      executed: false,
      previousState: snapshot.serviceState,
      nextState: snapshot.serviceState,
      safeReasonCode: reason,
      controlOwner: "external_environment"
    }
  };
}

const WEB_HERMES_CONTROL_ENDPOINT = "/api/agent/runtime/hermes/control";

async function requestWebHermesControl(
  action: HermesControlAction,
  input: { rendererReady?: boolean; options?: { auto?: boolean; reason?: string }; settings?: HermesStartSettings } = {}
): Promise<HermesControlResult> {
  const settings = input.settings ?? (action === "start" ? readAiSettings() : undefined);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings && (input.settings !== undefined || hasCustomSettings(settings))) {
    headers["x-ai-config"] = encodeAiSettingsForHeader(settings);
  }
  const response = await fetch(WEB_HERMES_CONTROL_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      action,
      ...(input.rendererReady ? { rendererReady: true } : {}),
      ...(input.options ? { options: input.options } : {})
    }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok && payload.error && typeof payload.error === "object" && !Array.isArray(payload.error)) {
    const error = payload.error as Record<string, unknown>;
    return unsupportedControlResult(action, typeof error.code === "string" ? error.code : "web_control_failed");
  }
  return payload as HermesControlResult;
}

async function requestWebHermesView() {
  const response = await fetch(WEB_HERMES_CONTROL_ENDPOINT, { cache: "no-store" });
  if (!response.ok) return undefined;
  return await response.json() as {
    config?: HermesConfigSnapshot;
    configSchema?: HermesConfigSchema;
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
  return Boolean(settings.apiKey.trim()
    || settings.baseUrl.trim()
    || settings.model.trim()
    || settings.provider !== "openai-compatible"
    || settings.credentialAction === "clear");
}
