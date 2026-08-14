import { z } from "zod";
import type { AgentRuntime, AgentRuntimeEvent, AgentRuntimeTurnInput } from "./agentRuntime";
import type { RuntimeUserEvent } from "./RuntimeUserEvent";

export type { RuntimeUserEvent } from "./RuntimeUserEvent";

export const AgentRuntimeIdSchema = z.enum(["native", "hermes"]);
export type AgentRuntimeId = z.infer<typeof AgentRuntimeIdSchema>;

export const AgentRuntimeConfigurationSchema = z.object({
  agentRuntime: AgentRuntimeIdSchema.default("native")
}).strict();
export type AgentRuntimeConfiguration = z.infer<typeof AgentRuntimeConfigurationSchema>;

/** Selects a runtime by configuration without coupling the app to Hermes. */
export class AgentRuntimeRouter {
  private configuration: AgentRuntimeConfiguration;
  private readonly runtimes = new Map<AgentRuntimeId, AgentRuntime>();

  constructor(input: {
    native: AgentRuntime;
    hermes?: AgentRuntime;
    configuration?: Partial<AgentRuntimeConfiguration>;
  }) {
    this.runtimes.set("native", input.native);
    if (input.hermes) this.runtimes.set("hermes", input.hermes);
    this.configuration = AgentRuntimeConfigurationSchema.parse(input.configuration ?? {});
  }

  get configurationSnapshot() {
    return this.configuration;
  }

  configure(configuration: AgentRuntimeConfiguration) {
    this.configuration = AgentRuntimeConfigurationSchema.parse(configuration);
    return this.configuration;
  }

  register(id: AgentRuntimeId, runtime: AgentRuntime) {
    this.runtimes.set(id, runtime);
  }

  resolve(id = this.configuration.agentRuntime) {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      throw Object.assign(new Error(`Agent runtime is unavailable: ${id}`), {
        code: "agent_runtime_unavailable",
        runtimeId: id
      });
    }
    return runtime;
  }

  active() {
    const preferred = this.resolve();
    return preferred.id === "hermes" ? new RoutedAgentRuntime(preferred) : preferred;
  }

  /**
   * Single semantic entry for UI/domain events. The event is preserved as
   * structured metadata; runtimes must not infer a button action from its
   * visible label.
   */
  runUserEvent(event: RuntimeUserEvent, input: AgentRuntimeTurnInput) {
    return this.active().runTurn({
      ...input,
      metadata: {
        ...(input.metadata ?? {}),
        runtimeUserEvent: event
      }
    });
  }
}

/**
 * Hermes recovery is deliberately bounded before the first protocol event.
 * Once a Hermes turn has emitted anything, the router never switches runtimes
 * in the middle of a turn or repeats an authoritative write.
 */
class RoutedAgentRuntime implements AgentRuntime {
  readonly id: string;

  constructor(private readonly preferred: AgentRuntime) {
    this.id = preferred.id;
  }

  capabilities() {
    return this.preferred.capabilities();
  }

  async pause(sessionId: string) {
    await this.preferred.pause(sessionId);
  }

  async interrupt(sessionId: string) {
    await this.preferred.interrupt(sessionId);
  }

  async resume(sessionId: string) {
    await this.preferred.resume(sessionId);
  }

  async recoverBeforeFallback(input: AgentRuntimeTurnInput) {
    await this.preferred.recoverBeforeFallback?.(input);
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    let emitted = false;
    let firstEventAt: string | undefined;
    try {
      for await (const event of this.preferred.runTurn(input)) {
        emitted = true;
        firstEventAt ??= event.timestamp;
        yield decorateRuntimeEvent(event, {
          ...(input.metadata ?? {}),
          preferredRuntime: this.preferred.id,
          attemptedRuntime: this.preferred.id,
          finalRuntime: this.preferred.id,
          fallbackUsed: false,
          firstEventAt
        });
      }
      return;
    } catch (error) {
      if (emitted) {
        const runtimeFailureAt = new Date().toISOString();
        yield {
          type: "turn_failed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: runtimeFailureAt,
          error: {
            code: errorCode(error),
            message: error instanceof Error ? error.message : "当前任务没有完成。",
            recoverable: false
          },
          data: {
            telemetry: {
              preferredRuntime: this.preferred.id,
              attemptedRuntime: this.preferred.id,
              finalRuntime: this.preferred.id,
              fallbackUsed: false,
              firstEventAt,
              runtimeFailureAt,
              fallbackReasonCode: errorCode(error)
            }
          }
        };
        return;
      }
      const fallbackReasonCode = errorCode(error);
      const runtimeFailureAt = new Date().toISOString();
      let recoveryFailureCode: string | undefined;
      try {
        // Hermes may perform one bounded health/session recovery here. The
        // second preferred attempt is safe because the first attempt emitted
        // no protocol event and therefore did not expose an authoritative
        // write or stream to the host.
        await this.preferred.recoverBeforeFallback?.(input);
        for await (const event of this.preferred.runTurn({
          ...input,
          metadata: {
            ...(input.metadata ?? {}),
            runtimeRecoveryAttempted: true,
            runtimeFailureAt,
            fallbackReasonCode
          }
        })) {
          emitted = true;
          firstEventAt ??= event.timestamp;
          yield decorateRuntimeEvent(event, {
            ...(input.metadata ?? {}),
            preferredRuntime: this.preferred.id,
            attemptedRuntime: this.preferred.id,
            finalRuntime: this.preferred.id,
            fallbackUsed: false,
            fallbackReasonCode,
            runtimeFailureAt,
            runtimeRecoveryAttempted: true,
            firstEventAt
          });
        }
        return;
      } catch (error) {
        recoveryFailureCode = errorCode(error);
      }
      // Hermes is the only semantic runtime for a Hermes-selected turn. A
      // failed bounded recovery is surfaced as a recoverable Hermes state;
      // Native must not start a second persona or repeat a semantic write.
      const code = recoveryFailureCode ?? fallbackReasonCode;
      yield {
        type: "turn_failed",
        sessionId: input.sessionId,
        turnId: input.turnId ?? "runtime-turn-unknown",
        timestamp: new Date().toISOString(),
        error: {
          code: "hermes_unavailable_recoverable",
          message: "Hermes 当前不可用，已保留任务 checkpoint。连接恢复后可以从当前步骤重试。",
          recoverable: true
        },
        data: {
          telemetry: {
            preferredRuntime: this.preferred.id,
            attemptedRuntime: this.preferred.id,
            finalRuntime: this.preferred.id,
            fallbackUsed: false,
            fallbackReasonCode,
            runtimeFailureAt,
            recoveryFailureCode: code,
            firstEventAt
          }
        }
      };
    }
  }
}

function decorateRuntimeEvent(event: AgentRuntimeEvent, metadata: Record<string, unknown>): AgentRuntimeEvent {
  const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
  const telemetry = {
    preferredRuntime: runtimeId(metadata.preferredRuntime),
    attemptedRuntime: runtimeId(metadata.attemptedRuntime),
    finalRuntime: runtimeId(metadata.finalRuntime),
    fallbackUsed: metadata.fallbackUsed === true,
    fallbackReasonCode: stringMetadata(metadata.fallbackReasonCode),
    hermesRunId: stringMetadata(metadata.hermesRunId),
    nextHermesRunId: stringMetadata(metadata.nextHermesRunId),
    firstEventAt: stringMetadata(metadata.firstEventAt) ?? event.timestamp,
    runtimeFailureAt: stringMetadata(metadata.runtimeFailureAt),
    executionOwner: metadata.executionOwner,
    runtimeRecoveryAttempted: metadata.runtimeRecoveryAttempted === true,
    recoveryFailureCode: stringMetadata(metadata.recoveryFailureCode)
  };
  return {
    ...event,
    data: {
      ...data,
      ...Object.fromEntries(Object.entries(telemetry).filter(([, value]) => value !== undefined)),
      telemetry: {
        ...(data.telemetry && typeof data.telemetry === "object" && !Array.isArray(data.telemetry) ? data.telemetry as Record<string, unknown> : {}),
        ...Object.fromEntries(Object.entries(telemetry).filter(([, value]) => value !== undefined))
      }
    }
  };
}

function runtimeId(value: unknown): "native" | "hermes" | undefined {
  return value === "native" || value === "hermes" ? value : undefined;
}

function stringMetadata(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "agent_runtime_failed";
}

export function createAgentRuntimeRouter(input: ConstructorParameters<typeof AgentRuntimeRouter>[0]) {
  return new AgentRuntimeRouter(input);
}
