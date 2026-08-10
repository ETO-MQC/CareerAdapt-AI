import { z } from "zod";
import type { AgentRuntime, AgentRuntimeEvent, AgentRuntimeTurnInput } from "./agentRuntime";

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
  private readonly fallbackRuntime: AgentRuntime;

  constructor(input: {
    native: AgentRuntime;
    hermes?: AgentRuntime;
    configuration?: Partial<AgentRuntimeConfiguration>;
  }) {
    this.runtimes.set("native", input.native);
    this.fallbackRuntime = input.native;
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
    return preferred.id === "hermes"
      ? new RoutedAgentRuntime(preferred, this.fallbackRuntime)
      : preferred;
  }
}

/**
 * Fallback is deliberately decided before the first protocol event.  Once a
 * Hermes turn has emitted anything, the router never switches runtimes in the
 * middle of a turn or repeats an authoritative write.
 */
class RoutedAgentRuntime implements AgentRuntime {
  readonly id: string;
  private current: AgentRuntime;

  constructor(
    private readonly preferred: AgentRuntime,
    private readonly fallback: AgentRuntime
  ) {
    this.id = preferred.id;
    this.current = preferred;
  }

  capabilities() {
    return this.preferred.capabilities();
  }

  async pause(sessionId: string) {
    await this.current.pause(sessionId);
  }

  async interrupt(sessionId: string) {
    await this.current.interrupt(sessionId);
  }

  async resume(sessionId: string) {
    await this.current.resume(sessionId);
  }

  async recoverBeforeFallback(input: AgentRuntimeTurnInput) {
    await this.preferred.recoverBeforeFallback?.(input);
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    let emitted = false;
    try {
      for await (const event of this.preferred.runTurn(input)) {
        emitted = true;
        yield event;
      }
      return;
    } catch (error) {
      if (emitted) {
        yield {
          type: "turn_failed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: new Date().toISOString(),
          error: {
            code: errorCode(error),
            message: error instanceof Error ? error.message : "当前任务没有完成。",
            recoverable: false
          }
        };
        return;
      }
      const fallbackReasonCode = errorCode(error);
      const runtimeFailureAt = new Date().toISOString();
      try {
        // Hermes may perform one bounded health/session recovery here. It is
        // deliberately outside the event loop so a failed preflight cannot
        // become an unbounded retry or duplicate a write.
        await this.preferred.recoverBeforeFallback?.(input);
      } catch {
        // The original reason remains authoritative for diagnostics; Native
        // fallback is still the legal recovery path.
      }
      this.current = this.fallback;
      const fallbackMetadata = {
        ...(input.metadata ?? {}),
        fallbackUsed: true,
        preferredRuntime: this.preferred.id,
        attemptedRuntime: this.preferred.id,
        finalRuntime: this.fallback.id,
        fallbackReasonCode,
        runtimeFailureAt
      };
      for await (const event of this.fallback.runTurn({
        ...input,
        metadata: fallbackMetadata
      })) {
        emitted = true;
        yield {
          ...event,
          data: {
            ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}),
            ...fallbackMetadata
          }
        };
      }
    }
  }
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "agent_runtime_failed";
}

export function createAgentRuntimeRouter(input: ConstructorParameters<typeof AgentRuntimeRouter>[0]) {
  return new AgentRuntimeRouter(input);
}
