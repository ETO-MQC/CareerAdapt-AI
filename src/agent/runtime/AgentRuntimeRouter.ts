import { z } from "zod";
import type { AgentRuntime, AgentRuntimeEvent, AgentRuntimeTurnInput } from "./agentRuntime";
import type { RuntimeUserEvent } from "./RuntimeUserEvent";
import type { RunStopReason } from "./hermes/hermesIncidentTrace";
import { isCareerDomainPreconditionCode } from "./careerContextBindingResolver";

export type { RuntimeUserEvent } from "./RuntimeUserEvent";

export const AgentRuntimeIdSchema = z.enum(["native", "hermes"]);
export type AgentRuntimeId = z.infer<typeof AgentRuntimeIdSchema>;

export const AgentRuntimeConfigurationSchema = z.object({
  agentRuntime: AgentRuntimeIdSchema.default("hermes")
}).strict();
export type AgentRuntimeConfiguration = z.infer<typeof AgentRuntimeConfigurationSchema>;

/**
 * Thin compatibility registry. Production constructs this with Hermes only;
 * the optional Native entry exists for deterministic/unit harnesses and old
 * persisted integrations. It is never selected as a failure fallback.
 */
export class AgentRuntimeRouter {
  private configuration: AgentRuntimeConfiguration;
  private readonly runtimes = new Map<AgentRuntimeId, AgentRuntime>();

  constructor(input: {
    native?: AgentRuntime;
    hermes?: AgentRuntime;
    configuration?: Partial<AgentRuntimeConfiguration>;
  }) {
    if (input.native) this.runtimes.set("native", input.native);
    if (input.hermes) this.runtimes.set("hermes", input.hermes);
    const defaultRuntime = input.hermes ? "hermes" : input.native ? "native" : "hermes";
    this.configuration = AgentRuntimeConfigurationSchema.parse({
      agentRuntime: input.configuration?.agentRuntime ?? defaultRuntime
    });
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
    return new RoutedAgentRuntime(this.resolve());
  }

  /** Structured UI events are forwarded without becoming prompt text. */
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
 * One semantic owner per turn. This adapter only decorates the stable event
 * protocol and converts an exception into a terminal event; it never retries,
 * re-prompts, executes tools, or switches to another runtime.
 */
class RoutedAgentRuntime implements AgentRuntime {
  readonly id: string;

  constructor(private readonly runtime: AgentRuntime) {
    this.id = runtime.id;
  }

  capabilities() {
    return this.runtime.capabilities();
  }

  pause(sessionId: string) {
    return this.runtime.pause(sessionId);
  }

  interrupt(sessionId: string, reason?: RunStopReason) {
    return this.runtime.interrupt(sessionId, reason);
  }

  releaseSessionBinding(sessionId: string) {
    this.runtime.releaseSessionBinding?.(sessionId);
  }

  resume(sessionId: string) {
    return this.runtime.resume(sessionId);
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    let emitted = false;
    let firstEventAt: string | undefined;
    try {
      for await (const event of this.runtime.runTurn(input)) {
        emitted = true;
        firstEventAt ??= event.timestamp;
        yield decorateRuntimeEvent(event, {
          ...(input.metadata ?? {}),
          preferredRuntime: this.runtime.id,
          attemptedRuntime: this.runtime.id,
          finalRuntime: this.runtime.id,
          fallbackUsed: false,
          firstEventAt
        });
      }
    } catch (error) {
      const failureAt = new Date().toISOString();
      const code = errorCode(error);
      if (isCareerDomainPreconditionCode(code)) {
        yield decorateRuntimeEvent({
          type: "turn_completed",
          sessionId: input.sessionId,
          turnId: input.turnId ?? "runtime-turn-unknown",
          timestamp: failureAt,
          message: careerDomainWaitingMessage(code),
          data: { safeErrorCode: code, waitingForUser: true, domainFailure: true }
        }, {
          ...(input.metadata ?? {}),
          preferredRuntime: this.runtime.id,
          attemptedRuntime: this.runtime.id,
          finalRuntime: this.runtime.id,
          fallbackUsed: false,
          firstEventAt
        });
        return;
      }
      // The runtime owns whether a remote run was created. If it throws after
      // emitting, preserve the same turn and expose one terminal failure.
      yield decorateRuntimeEvent({
        type: "turn_failed",
        sessionId: input.sessionId,
        turnId: input.turnId ?? "runtime-turn-unknown",
        timestamp: failureAt,
        error: {
          code,
          message: safeErrorMessage(error),
          recoverable: Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true)
        },
        data: {
          diagnostics: diagnosticsFromError(error),
          telemetry: {
            preferredRuntime: this.runtime.id,
            attemptedRuntime: this.runtime.id,
            finalRuntime: this.runtime.id,
            fallbackUsed: false,
            incidentTraceId: stringMetadata(input.metadata?.incidentTraceId),
            attemptTraceId: stringMetadata(input.metadata?.attemptTraceId),
            firstEventAt,
            runtimeFailureAt: failureAt,
            emittedBeforeFailure: emitted
          }
        }
      }, {
        ...(input.metadata ?? {}),
        preferredRuntime: this.runtime.id,
        attemptedRuntime: this.runtime.id,
        finalRuntime: this.runtime.id,
        fallbackUsed: false,
        firstEventAt,
        runtimeFailureAt: failureAt
      });
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
    fallbackUsed: false,
    incidentTraceId: stringMetadata(metadata.incidentTraceId),
    attemptTraceId: stringMetadata(metadata.attemptTraceId),
    hermesRunId: stringMetadata(metadata.hermesRunId),
    firstEventAt: stringMetadata(metadata.firstEventAt) ?? event.timestamp,
    runtimeFailureAt: stringMetadata(metadata.runtimeFailureAt),
    executionOwner: metadata.executionOwner,
    transportReattachAttempted: metadata.transportReattachAttempted === true,
    semanticRetryAttempted: false
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

function safeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
      .replace(/Bearer\s+[^\s,;]+/giu, "Bearer [redacted]")
      .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/gu, "[redacted-key]")
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 360);
  }
  return "本轮回答失败。当前对话已保留，你可以重试。";
}

function diagnosticsFromError(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { diagnostics?: unknown; code?: unknown };
  return value.diagnostics && typeof value.diagnostics === "object" && !Array.isArray(value.diagnostics)
    ? value.diagnostics as Record<string, unknown>
    : typeof value.code === "string" ? { safeErrorCode: value.code } : undefined;
}

function careerDomainWaitingMessage(code: string) {
  if (/target_required/i.test(code)) return "我还没有拿到要定制的岗位信息。\n你可以直接粘贴岗位描述，或者选择已经保存的岗位。";
  if (code === "needs_profile" || code === "career_session_binding_required") return "当前还没有可用于定制的个人资料。你可以选择已有资料，或先导入一份简历。";
  if (code === "needs_profile_choice") return "当前有多份可用的个人资料，请先选择一份。";
  if (code === "needs_resume_choice" || code === "multiple_resume_sources") return "当前有多份可用的通用简历，请先选择一份。";
  if (code === "job_required") return "请选择已经保存的岗位，或直接粘贴岗位描述。";
  if (code === "clarification_required") return "请补充当前岗位定制中尚未确认的信息。";
  if (code === "confirmation_required") return "这一步需要你的明确确认。";
  if (code === "review_required") return "请检查当前结果并告诉我下一步如何处理。";
  return "请按下方问题或选项补充当前岗位定制所需的信息。";
}

export function createAgentRuntimeRouter(input: ConstructorParameters<typeof AgentRuntimeRouter>[0]) {
  return new AgentRuntimeRouter(input);
}
