import { nanoid } from "nanoid";
import type {
  AgentRuntime,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeTurnInput
} from "./agentRuntime";
import type { RuntimeTurnTelemetry } from "./runtimeTelemetry";

export type NativeCareerAgentRuntimeDependencies = {
  runTurn(input: AgentRuntimeTurnInput): Promise<unknown> | unknown;
  pause?(sessionId: string): Promise<void> | void;
  interrupt?(sessionId: string): Promise<void> | void;
  resume?(sessionId: string): Promise<void> | void;
  capabilities?: Partial<AgentRuntimeCapabilities>;
};

/**
 * Native adapter for CareerAdapt's current AgentHost/AgentKernel stack.
 * The adapter owns the runtime contract; callers do not need to know whether
 * the implementation is a browser host, a desktop host, or a future worker.
 */
export class NativeCareerAgentRuntime implements AgentRuntime {
  readonly id = "native" as const;

  constructor(private readonly dependencies: NativeCareerAgentRuntimeDependencies) {}

  capabilities(): AgentRuntimeCapabilities {
    return {
      streaming: true,
      interruptible: Boolean(this.dependencies.interrupt),
      resumable: Boolean(this.dependencies.resume),
      toolCalls: true,
      approvals: true,
      offline: false,
      runtimeVersion: "native-career-runtime",
      ...this.dependencies.capabilities
    };
  }

  async interrupt(sessionId: string) {
    await this.dependencies.interrupt?.(sessionId);
  }

  async pause(sessionId: string) {
    await this.dependencies.pause?.(sessionId);
  }

  async resume(sessionId: string) {
    await this.dependencies.resume?.(sessionId);
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const turnId = input.turnId ?? `runtime-turn-${nanoid(12)}`;
    const normalizedInput = { ...input, turnId };
    const startedAt = Date.now();
    const telemetryEnabled = input.metadata?.telemetry === true || input.metadata?.fallbackUsed === true;
    yield this.event(normalizedInput, "reasoning_status", { message: "正在处理当前任务…" });
    yield this.event(normalizedInput, "progress", { message: "已接收当前输入，正在准备下一步…" });
    try {
      const result = await this.dependencies.runTurn(normalizedInput);
      if (isAsyncIterable<AgentRuntimeEvent>(result)) {
        for await (const event of result) yield event;
        return;
      }
      if (Array.isArray(result) && result.every((item) => isRuntimeEvent(item))) {
        for (const event of result) yield event;
        return;
      }
      yield this.event(normalizedInput, "turn_completed", {
        data: telemetryEnabled
          ? { ...(result && typeof result === "object" ? result as Record<string, unknown> : { result }), telemetry: nativeTelemetry(normalizedInput, startedAt, "completed") }
          : result
      });
    } catch (error) {
      const code = error instanceof Error && "code" in error && typeof error.code === "string"
        ? error.code
        : "native_runtime_turn_failed";
      yield this.event(normalizedInput, "turn_failed", {
        error: {
          code,
          message: error instanceof Error ? error.message : "当前任务没有完成。",
          recoverable: /temporar|timeout|network|unavailable/i.test(code)
        },
        ...(telemetryEnabled ? { data: { telemetry: nativeTelemetry(normalizedInput, startedAt, "failed") } } : {})
      });
    }
  }

  private event(
    input: AgentRuntimeTurnInput,
    type: AgentRuntimeEvent["type"],
    partial: Pick<AgentRuntimeEvent, "message" | "delta" | "data" | "error"> = {}
  ): AgentRuntimeEvent {
    return {
      type,
      sessionId: input.sessionId,
      turnId: input.turnId ?? "runtime-turn-unknown",
      timestamp: new Date().toISOString(),
      ...partial
    };
  }
}

function nativeTelemetry(
  input: AgentRuntimeTurnInput,
  startedAt: number,
  completionStatus: RuntimeTurnTelemetry["completionStatus"]
): RuntimeTurnTelemetry {
  return {
    runtimeId: "native",
    turnId: input.turnId ?? "runtime-turn-unknown",
    ...(typeof input.metadata?.model === "string" ? { model: input.metadata.model } : {}),
    latencyMs: Math.max(0, Date.now() - startedAt),
    toolCalls: 0,
    toolFailures: 0,
    autonomousRecoveries: 0,
    fallbackUsed: input.metadata?.fallbackUsed === true,
    artifactUpdates: 0,
    completionStatus
  };
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return Boolean(value && typeof value === "object" && Symbol.asyncIterator in value);
}

function isRuntimeEvent(value: unknown): value is AgentRuntimeEvent {
  return Boolean(
    value
    && typeof value === "object"
    && "type" in value
    && "sessionId" in value
    && "turnId" in value
  );
}
