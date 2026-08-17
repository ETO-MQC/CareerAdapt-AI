import { z } from "zod";
import type { AgentRuntime, AgentRuntimeEvent, AgentRuntimeRecoveryPlan, AgentRuntimeTurnInput } from "./agentRuntime";
import type { RuntimeUserEvent } from "./RuntimeUserEvent";
import { isRetryableHermesRunFailure } from "./hermes/hermesRunReliability";
import type { RunStopReason } from "./hermes/hermesIncidentTrace";
import { isCareerDomainPreconditionCode } from "./careerContextBindingResolver";

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

  async interrupt(sessionId: string, reason?: RunStopReason) {
    await this.preferred.interrupt(sessionId, reason);
  }

  async resume(sessionId: string) {
    await this.preferred.resume(sessionId);
  }

  async recoverBeforeFallback(input: AgentRuntimeTurnInput) {
    return this.preferred.recoverBeforeFallback?.(input);
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
        const failureCode = postStartRuntimeErrorCode(errorCode(error));
        if (isCareerDomainPreconditionCode(errorCode(error))) {
          yield {
            type: "turn_completed",
            sessionId: input.sessionId,
            turnId: input.turnId ?? "runtime-turn-unknown",
            timestamp: runtimeFailureAt,
            message: careerDomainWaitingMessage(errorCode(error)),
            data: { safeErrorCode: errorCode(error), waitingForUser: true, domainFailure: true }
          };
          return;
        }
        yield {
          type: "turn_failed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: runtimeFailureAt,
          error: {
            code: failureCode,
            message: error instanceof Error ? error.message : "当前任务没有完成。",
            recoverable: false
          },
          data: {
            telemetry: {
              preferredRuntime: this.preferred.id,
              attemptedRuntime: this.preferred.id,
              finalRuntime: this.preferred.id,
              fallbackUsed: false,
              incidentTraceId: stringMetadata(input.metadata?.incidentTraceId),
              attemptTraceId: stringMetadata(input.metadata?.attemptTraceId),
              firstEventAt,
              runtimeFailureAt,
               fallbackReasonCode: failureCode
            }
          }
        };
        return;
      }
      const fallbackReasonCode = errorCode(error);
      const runtimeFailureAt = new Date().toISOString();
      const initialFailureDiagnostics = diagnosticsFromError(error);
      if (isCareerDomainPreconditionCode(fallbackReasonCode)) {
        yield {
          type: "turn_completed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: runtimeFailureAt,
          message: careerDomainWaitingMessage(fallbackReasonCode),
          data: {
            safeErrorCode: fallbackReasonCode,
            waitingForUser: true,
            domainFailure: true,
            diagnostics: initialFailureDiagnostics,
            telemetry: {
              preferredRuntime: this.preferred.id,
              attemptedRuntime: this.preferred.id,
              finalRuntime: this.preferred.id,
              fallbackUsed: false,
              incidentTraceId: stringMetadata(input.metadata?.incidentTraceId),
              attemptTraceId: stringMetadata(input.metadata?.attemptTraceId),
              firstEventAt
            }
          }
        };
        return;
      }
      if (!isRetryableHermesRunFailure(error)) {
        yield {
          type: "turn_failed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: runtimeFailureAt,
          error: {
            code: fallbackReasonCode,
            message: safeErrorMessage(error),
            recoverable: false
          },
          data: {
            diagnostics: initialFailureDiagnostics,
            telemetry: {
              preferredRuntime: this.preferred.id,
              attemptedRuntime: this.preferred.id,
              finalRuntime: this.preferred.id,
              fallbackUsed: false,
              incidentTraceId: stringMetadata(input.metadata?.incidentTraceId),
              attemptTraceId: stringMetadata(input.metadata?.attemptTraceId),
              fallbackReasonCode,
              runtimeFailureAt,
              firstEventAt
            }
          }
        };
        return;
      }
      let recoveryFailureCode: string | undefined;
      let recoveryFailureDiagnostics: Record<string, unknown> | undefined;
      try {
        // Hermes may perform one bounded health/session recovery here. The
        // second preferred attempt is safe because the first attempt emitted
        // no protocol event and therefore did not expose an authoritative
        // write or stream to the host.
        const recoveryPlan: AgentRuntimeRecoveryPlan = await this.preferred.recoverBeforeFallback?.(input) ?? { kind: "retry" };
        const recoveryAttemptTraceId = nextAttemptTraceId(input.metadata);
        const recoveryInput = {
          ...input,
          userMessage: recoveryPlan.kind === "reattach" ? "" : input.userMessage,
          metadata: {
            ...(input.metadata ?? {}),
            ...(recoveryAttemptTraceId ? { attemptTraceId: recoveryAttemptTraceId } : {}),
            runtimeRecoveryAttempted: true,
            runtimeFailureAt,
            fallbackReasonCode,
            runtimeRecoveryKind: recoveryPlan.kind,
            primaryFailureCode: fallbackReasonCode,
            ...(recoveryPlan.kind === "reattach"
              ? { reattachRunId: recoveryPlan.runId, transportReattachAttempted: true }
              : {
                  reattachRunId: undefined,
                  semanticRetryAttempted: true,
                  semanticRetryUserMessage: input.userMessage
                })
          }
        };
        for await (const event of this.preferred.runTurn(recoveryInput)) {
          emitted = true;
          firstEventAt ??= event.timestamp;
          yield decorateRuntimeEvent(event, {
            ...(recoveryInput.metadata ?? {}),
            preferredRuntime: this.preferred.id,
            attemptedRuntime: this.preferred.id,
            finalRuntime: this.preferred.id,
            fallbackUsed: false,
            incidentTraceId: stringMetadata(input.metadata?.incidentTraceId),
            attemptTraceId: stringMetadata(recoveryInput.metadata?.attemptTraceId),
            fallbackReasonCode,
            runtimeFailureAt,
            runtimeRecoveryAttempted: true,
            runtimeRecoveryKind: recoveryPlan.kind,
            transportReattachAttempted: recoveryPlan.kind === "reattach",
            semanticRetryAttempted: recoveryPlan.kind === "retry",
            firstEventAt
          });
        }
        return;
      } catch (error) {
        recoveryFailureCode = errorCode(error);
        recoveryFailureDiagnostics = diagnosticsFromError(error);
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
          diagnostics: {
            initialFailure: initialFailureDiagnostics,
            ...(recoveryFailureDiagnostics ? { recoveryFailure: recoveryFailureDiagnostics } : {}),
            primaryCausalChain: [
              {
                event: "primary_failure",
                component: "RoutedAgentRuntime",
                at: runtimeFailureAt,
                attemptTraceId: stringMetadata(input.metadata?.attemptTraceId),
                detail: fallbackReasonCode
              },
              ...(recoveryFailureCode ? [{
                event: "recovery_failure",
                component: "RoutedAgentRuntime",
                at: new Date().toISOString(),
                attemptTraceId: stringMetadata(nextAttemptTraceId(input.metadata)),
                detail: recoveryFailureCode
              }] : [])
            ]
          },
          telemetry: {
            preferredRuntime: this.preferred.id,
            attemptedRuntime: this.preferred.id,
            finalRuntime: this.preferred.id,
            fallbackUsed: false,
            fallbackReasonCode,
            runtimeFailureAt,
            recoveryFailureCode: code,
            primaryFailureCode: fallbackReasonCode,
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
    incidentTraceId: stringMetadata(metadata.incidentTraceId),
    attemptTraceId: stringMetadata(metadata.attemptTraceId),
    hermesRunId: stringMetadata(metadata.hermesRunId),
    nextHermesRunId: stringMetadata(metadata.nextHermesRunId),
    firstEventAt: stringMetadata(metadata.firstEventAt) ?? event.timestamp,
    runtimeFailureAt: stringMetadata(metadata.runtimeFailureAt),
    executionOwner: metadata.executionOwner,
    runtimeRecoveryAttempted: metadata.runtimeRecoveryAttempted === true,
    runtimeRecoveryKind: metadata.runtimeRecoveryKind,
    transportReattachAttempted: metadata.transportReattachAttempted === true,
    semanticRetryAttempted: metadata.semanticRetryAttempted === true,
    primaryFailureCode: stringMetadata(metadata.primaryFailureCode),
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

function nextAttemptTraceId(metadata?: Record<string, unknown>) {
  const current = stringMetadata(metadata?.attemptTraceId);
  if (!current) return undefined;
  const match = current.match(/^(.*):attempt-(\d+)$/u);
  if (match) return `${match[1]}:attempt-${Number(match[2]) + 1}`;
  return `${current}:recovery-1`;
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string"
    ? error.code
    : "agent_runtime_failed";
}

function postStartRuntimeErrorCode(code: string) {
  return code === "hermes_unavailable_before_turn"
    || code === "mcp_unavailable_before_turn"
    || code.startsWith("hermes_run_start_")
    ? "hermes_run_failed_after_start"
    : code;
}

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 360);
  }
  return "Hermes 当前不可用，已保留任务 checkpoint。";
}

function careerDomainWaitingMessage(code: string) {
  if (code === "needs_profile" || code === "career_session_binding_required") {
    return "当前还没有可用于定制的个人资料。你可以选择已有资料，或先导入一份简历。";
  }
  if (code === "needs_profile_choice") return "当前有多份可用的个人资料，请先选择一份。";
  if (code === "needs_resume_choice") return "当前有多份可用的通用简历，请先选择一份。";
  return "当前步骤需要你的选择或补充信息后才能继续。";
}

function diagnosticsFromError(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { diagnostics?: unknown; code?: unknown };
  return value.diagnostics && typeof value.diagnostics === "object" && !Array.isArray(value.diagnostics)
    ? value.diagnostics as Record<string, unknown>
    : typeof value.code === "string" ? { safeErrorCode: value.code } : undefined;
}

export function createAgentRuntimeRouter(input: ConstructorParameters<typeof AgentRuntimeRouter>[0]) {
  return new AgentRuntimeRouter(input);
}
