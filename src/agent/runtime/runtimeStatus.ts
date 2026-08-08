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
  lastTurn?: {
    turnId: string;
    runtimeId: string;
    latencyMs?: number;
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
    this.update({
      mcpServer: "careeradapt",
      mcpConnected: status.connected,
      discoveredToolCount: status.discoveredToolCount,
      ...(status.reason ? { reason: status.reason } : {})
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
        fallbackUsed: telemetry.fallbackUsed === true,
        autonomousRecoveries: numberValue(telemetry.autonomousRecoveries)
      }
    });
  }
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
