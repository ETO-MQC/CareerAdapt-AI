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

/** Starts or reuses the local Hermes companion without exposing credentials to the browser. */
export async function requestHermesStart(): Promise<HermesControlResult> {
  const settings = readAiSettings();
  const customSettings = hasCustomSettings(settings) ? settings : undefined;
  if (typeof window !== "undefined" && window.careerAdaptDesktop) {
    return window.careerAdaptDesktop.startHermes(settings);
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (customSettings) headers["x-ai-config"] = encodeAiSettingsForHeader(customSettings);
  const response = await fetch("/api/agent/runtime/hermes/control", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "start" })
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    data?: { runtimeUrl?: string };
    error?: { code?: string; message?: string };
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error?.message || "Hermes 启动失败，请查看运行日志。", { cause: payload.error?.code });
  }
  return {
    ok: true,
    ...(payload.data?.runtimeUrl ? { runtimeUrl: payload.data.runtimeUrl } : {})
  };
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
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.stopHermes();
}

export async function requestHermesRestart(options?: { auto?: boolean; reason?: string }) {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.restartHermes(options);
}

export async function requestHermesRecover() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.recoverHermes();
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
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.updateHermesConfig(settings);
}

export async function requestHermesConfigReset() {
  if (typeof window === "undefined" || !window.careerAdaptDesktop) return undefined;
  return window.careerAdaptDesktop.resetHermesConfig();
}

function hasCustomSettings(settings: HermesStartSettings) {
  return Boolean(settings.apiKey.trim() || settings.baseUrl.trim() || settings.model.trim());
}
