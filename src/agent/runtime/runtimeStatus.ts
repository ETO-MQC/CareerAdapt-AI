import { runtimeHealthStatus, type RuntimeHealth } from "./runtimeHealth";
import { classifyHermesRunFailure, type HermesRunFailureInput } from "./hermes/hermesRunReliability";
import type { HermesSupervisorSnapshot } from "@/services/agent/hermesControl";
import type { AbortTrace, BridgeRequestTrace, RuntimeFailureSnapshot } from "./hermes/hermesIncidentTrace";

export type RuntimeStatus = "ready" | "starting" | "degraded" | "unavailable";

export type RuntimeStatusSnapshot = {
  preferredRuntime: "native" | "hermes";
  activeRuntime: "native" | "hermes";
  status: RuntimeStatus;
  reason?: string;
  supervisorState?: HermesSupervisorSnapshot["overallState"];
  supervisorOwned?: boolean;
  processReady?: boolean;
  apiReady?: boolean;
  providerReady?: boolean;
  careerMcpReady?: boolean;
  toolSurfaceReady?: boolean;
  runReady?: boolean;
  careerSkillsReady?: boolean;
  reasonCode?: string;
  runtimeUrl?: string;
  activeRunId?: string;
  uptimeMs?: number;
  restartAttempt?: number;
  careerDomainToolCount?: number;
  hermesCareerToolCount?: number;
  requiredCareerFacadesReady?: number;
  requiredCareerFacadesTotal?: number;
  latestLifecycleEntries?: HermesSupervisorSnapshot["latestLifecycleEntries"];
  supervisorSnapshot?: HermesSupervisorSnapshot;
  failureTimeSupervisorSnapshot?: HermesSupervisorSnapshot;
  runtimeFailureSnapshot?: RuntimeFailureSnapshot;
  bridgeRequestTraces?: BridgeRequestTrace[];
  abortTraces?: AbortTrace[];
  version?: string;
  provider?: string;
  model?: string;
  contextWindow?: number;
  toolCalling?: "verified" | "unverified" | "unsupported" | "unknown";
  mcpServer?: string;
  mcpConnected?: boolean;
  discoveredToolCount?: number;
  health?: RuntimeHealth;
  roadshowMode?: boolean;
  skillCount?: number;
  resumePreviewAvailable?: boolean;
  pdfExportAvailable?: boolean;
  lastTurn?: {
    turnId: string;
    runtimeId: string;
    latencyMs?: number;
    firstTokenLatencyMs?: number;
    mcpLatencyMs?: number;
    tailoringLatencyMs?: number;
    pdfLatencyMs?: number;
    structuredOutputValid?: boolean;
    fallbackUsed: boolean;
    autonomousRecoveries?: number;
  };
};

export class RuntimeStatusStore {
  private snapshot: RuntimeStatusSnapshot;
  private readonly listeners = new Set<() => void>();
  private supervisorOwned = false;

  constructor(initial: RuntimeStatusSnapshot) {
    this.snapshot = initial;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  update(patch: Partial<RuntimeStatusSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  recordMcp(status: { connected: boolean; discoveredToolCount: number; reason?: string }) {
    const health = this.snapshot.health;
    const nextHealth = health ? {
      ...health,
      mcpConnected: status.connected,
      mcpReady: status.connected ? health.mcpReady : false,
      mcpToolCount: status.discoveredToolCount,
      browserCareerDomainHostConnected: status.connected,
      careerMcpServerReachable: status.connected,
      careerMcpContractCount: status.discoveredToolCount,
      runReady: status.connected ? health.runReady : false,
      lastCheckedAt: new Date().toISOString()
    } : undefined;
    this.update({
      mcpServer: "careeradapt",
      mcpConnected: status.connected,
      discoveredToolCount: status.discoveredToolCount,
      ...(nextHealth ? {
        activeRuntime: this.snapshot.preferredRuntime === "hermes" ? "hermes" : "native",
        ...(this.supervisorOwned ? {} : { status: runtimeHealthStatus(nextHealth) }),
        health: nextHealth
      } : {}),
      ...(status.reason ? { reason: status.reason } : {})
    });
  }

  recordHealth(health: RuntimeHealth) {
    const processReady = health.companionReady ?? health.runtimeAvailable;
    const providerReady = health.providerReady ?? (health.providerConfigured && health.providerReachable && Boolean(health.model));
    const careerMcpReady = health.browserCareerDomainHostConnected
      && health.careerMcpServerReachable
      && health.mcpConnected;
    const toolSurfaceReady = health.hermesMcpRegistered
      && health.hermesMcpToolCount > 0
      && health.requiredCareerFacadesMissing.length === 0;
    this.update({
      activeRuntime: this.snapshot.preferredRuntime === "hermes" ? "hermes" : "native",
      activeRunId: health.activeRunId ?? health.hermesRunId,
      ...(this.supervisorOwned ? {} : { status: runtimeHealthStatus(health) }),
      ...(this.supervisorOwned ? {} : { reason: health.safeErrorCode }),
      ...(this.supervisorOwned ? {} : {
        processReady,
        apiReady: health.runtimeAvailable,
        providerReady,
        careerMcpReady,
        toolSurfaceReady,
        runReady: health.runReady ?? true,
        careerSkillsReady: health.careerSkillsLoaded,
        reasonCode: health.safeErrorCode,
        careerDomainToolCount: health.careerGatewayContracts.length,
        hermesCareerToolCount: health.careerMcpExposedTools.length || health.hermesMcpToolCount,
        requiredCareerFacadesReady: Math.max(0, health.hermesCareerFacadeCount),
        requiredCareerFacadesTotal: health.hermesCareerFacadeCount + health.requiredCareerFacadesMissing.length
      }),
      model: health.model,
      contextWindow: health.contextWindow,
      toolCalling: health.toolCallingAvailable ? "verified" : "unverified",
      mcpServer: "careeradapt",
      mcpConnected: health.mcpConnected,
      discoveredToolCount: health.mcpToolCount,
      skillCount: health.careerSkillsLoaded ? 6 : 0,
      health
    });
  }

  recordRunFailure(input: HermesRunFailureInput & { safeErrorCode?: string; safeErrorMessage?: string }) {
    const diagnostics = classifyHermesRunFailure({
      ...input,
      code: input.code ?? input.safeErrorCode,
      message: input.message ?? input.safeErrorMessage
    });
    const health = this.snapshot.health;
    const capturedAt = new Date().toISOString();
    const failureSupervisor = this.snapshot.failureTimeSupervisorSnapshot ?? this.snapshot.supervisorSnapshot;
    const runtimeFailureSnapshot = this.snapshot.runtimeFailureSnapshot ?? {
      capturedAt,
      supervisor: failureSupervisor
        ? {
            overallState: failureSupervisor.overallState,
            processReady: failureSupervisor.processReady,
            apiReady: failureSupervisor.apiReady,
            providerReady: failureSupervisor.providerReady,
            careerMcpReady: failureSupervisor.careerMcpReady,
            toolSurfaceReady: failureSupervisor.toolSurfaceReady,
            runReady: failureSupervisor.runReady,
            reasonCode: failureSupervisor.reasonCode,
            activeRunId: failureSupervisor.activeRunId,
            restartAttempt: failureSupervisor.restartAttempt,
            capturedAt,
            maintenancePending: failureSupervisor.maintenancePending
          }
        : {
            overallState: "degraded",
            processReady: this.snapshot.processReady === true,
            apiReady: this.snapshot.apiReady === true,
            providerReady: this.snapshot.providerReady === true,
            careerMcpReady: this.snapshot.careerMcpReady === true,
            toolSurfaceReady: this.snapshot.toolSurfaceReady === true,
            runReady: false,
            reasonCode: diagnostics.safeErrorCode,
            activeRunId: diagnostics.hermesRunId,
            restartAttempt: this.snapshot.restartAttempt ?? 0,
            capturedAt
          },
      ...(health ? { runtimeHealth: health } : {}),
      run: {
        runId: diagnostics.hermesRunId ?? this.snapshot.activeRunId,
        status: "failed",
        updatedAt: capturedAt
      }
    } satisfies RuntimeFailureSnapshot;
    const nextHealth = health ? {
      ...health,
      runReady: false,
      runReadyCheckedAt: new Date().toISOString(),
      runReadySafeErrorCode: diagnostics.safeErrorCode,
      runtimeFailureDiagnostics: diagnostics,
      lastCheckedAt: new Date().toISOString()
    } : undefined;
    this.update({
      activeRuntime: "hermes",
      status: this.supervisorOwned ? "degraded" : "unavailable",
      reason: diagnostics.safeErrorCode,
      runReady: false,
      runtimeFailureSnapshot,
      ...(nextHealth ? { health: nextHealth } : {})
    });
  }

  recordSupervisorStatus(snapshot: HermesSupervisorSnapshot) {
    this.supervisorOwned = true;
    const status = supervisorRuntimeStatus(snapshot.overallState);
    const previous = this.snapshot.supervisorSnapshot;
    const failureTimeSupervisorSnapshot = this.snapshot.failureTimeSupervisorSnapshot
      ?? (previous?.runReady === true && snapshot.runReady === false ? snapshot : undefined);
    this.update({
      preferredRuntime: "hermes",
      activeRuntime: "hermes",
      status,
      reason: snapshot.reasonCode,
      supervisorState: snapshot.overallState,
      supervisorOwned: true,
      processReady: snapshot.processReady,
      apiReady: snapshot.apiReady,
      providerReady: snapshot.providerReady,
      careerMcpReady: snapshot.careerMcpReady,
      toolSurfaceReady: snapshot.toolSurfaceReady,
      runReady: snapshot.runReady,
      careerSkillsReady: snapshot.careerSkillsReady,
      reasonCode: snapshot.reasonCode,
      runtimeUrl: snapshot.runtimeUrl,
      activeRunId: snapshot.activeRunId,
      version: snapshot.version,
      provider: snapshot.provider,
      model: snapshot.model,
      uptimeMs: snapshot.uptimeMs,
      restartAttempt: snapshot.restartAttempt,
      careerDomainToolCount: snapshot.careerDomainToolCount,
      hermesCareerToolCount: snapshot.hermesCareerToolCount,
      requiredCareerFacadesReady: snapshot.requiredCareerFacadesReady,
      requiredCareerFacadesTotal: snapshot.requiredCareerFacadesTotal,
      latestLifecycleEntries: snapshot.latestLifecycleEntries,
      supervisorSnapshot: snapshot,
      ...(failureTimeSupervisorSnapshot ? { failureTimeSupervisorSnapshot } : {}),
      mcpConnected: snapshot.careerMcpReady,
      discoveredToolCount: snapshot.hermesCareerToolCount
    });
  }

  recordAbortTrace(trace: AbortTrace) {
    this.update({ abortTraces: [...(this.snapshot.abortTraces ?? []), trace].slice(-32) });
  }

  recordBridgeRequestTraces(traces: BridgeRequestTrace[]) {
    this.update({ bridgeRequestTraces: traces.slice(-80) });
  }

  recordTurn(input: {
    turnId: string;
    runtimeId: string;
    data?: unknown;
  }) {
    const data = input.data && typeof input.data === "object" && !Array.isArray(input.data)
      ? input.data as Record<string, unknown>
      : {};
    const telemetry = data.telemetry && typeof data.telemetry === "object" && !Array.isArray(data.telemetry)
      ? data.telemetry as Record<string, unknown>
      : data;
    const effectiveRuntimeId = telemetry.fallbackUsed === true ? "native" : input.runtimeId;
    this.update({
      activeRuntime: effectiveRuntimeId === "hermes" ? "hermes" : "native",
      lastTurn: {
        turnId: input.turnId,
        runtimeId: effectiveRuntimeId,
        latencyMs: numberValue(telemetry.latencyMs),
        firstTokenLatencyMs: numberValue(telemetry.firstTokenLatencyMs),
        mcpLatencyMs: numberValue(telemetry.mcpLatencyMs),
        tailoringLatencyMs: numberValue(telemetry.tailoringLatencyMs),
        pdfLatencyMs: numberValue(telemetry.pdfLatencyMs),
        structuredOutputValid: typeof telemetry.structuredOutputValid === "boolean" ? telemetry.structuredOutputValid : undefined,
        fallbackUsed: telemetry.fallbackUsed === true,
        autonomousRecoveries: numberValue(telemetry.autonomousRecoveries)
      }
    });
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function supervisorRuntimeStatus(state: HermesSupervisorSnapshot["overallState"]): RuntimeStatus {
  if (state === "ready") return "ready";
  if (state === "degraded") return "degraded";
  if (["starting", "api_ready", "syncing_career_tools", "restarting", "stopping"].includes(state)) return "starting";
  return "unavailable";
}
