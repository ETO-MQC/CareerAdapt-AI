import { isRoadshowReady, runtimeHealthStatus, type RuntimeHealth } from "./runtimeHealth";

export type RuntimeStatus = "ready" | "starting" | "unavailable";

export type RuntimeStatusSnapshot = {
  preferredRuntime: "native" | "hermes";
  activeRuntime: "native" | "hermes";
  status: RuntimeStatus;
  reason?: string;
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
      mcpToolCount: status.discoveredToolCount,
      browserCareerDomainHostConnected: status.connected,
      careerMcpServerReachable: status.connected,
      careerMcpContractCount: status.discoveredToolCount,
      lastCheckedAt: new Date().toISOString()
    } : undefined;
    this.update({
      mcpServer: "careeradapt",
      mcpConnected: status.connected,
      discoveredToolCount: status.discoveredToolCount,
      ...(nextHealth ? {
        activeRuntime: isRoadshowReady(nextHealth) ? "hermes" : "native",
        status: runtimeHealthStatus(nextHealth),
        health: nextHealth
      } : {}),
      ...(status.reason ? { reason: status.reason } : {})
    });
  }

  recordHealth(health: RuntimeHealth) {
    const ready = isRoadshowReady(health);
    this.update({
      activeRuntime: ready ? "hermes" : "native",
      status: runtimeHealthStatus(health),
      reason: health.safeErrorCode,
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
