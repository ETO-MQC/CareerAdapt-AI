import { nanoid } from "nanoid";
import type {
  AgentRuntime,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeTurnInput
} from "../agentRuntime";
import type { HermesRunHandle } from "../../contracts/agentSession";
import type { CareerToolGateway } from "../../tools/CareerToolGateway";
import { logicalToolOperationId, type HermesBridgeEvent, type HermesBridgeTransport, type HermesRunStatus, type HermesRunTraceContext } from "./HermesBridgeTransport";
import { resolveCareerSessionBinding } from "../careerSessionBinding";
import { HermesCareerToolCatalog } from "./HermesCareerToolCatalog";
import {
  classifyHermesRunFailure,
  createHermesRunFailure,
  type HermesRunFailureInput
} from "./hermesRunReliability";
import {
  abortTraceFromSignal,
  createIncidentTraceId,
  createRunStopReason,
  type RunStopReason
} from "./hermesIncidentTrace";
import type { RuntimeCausalChainEntry, SecondaryRecoveryFailure } from "./hermesIncidentTrace";
import { getUserMessageForTurn } from "../currentTurnUserMessage";

type TurnCounters = {
  toolCalls: number;
  toolFailures: number;
  autonomousRecoveries: number;
  artifactUpdates: number;
  firstTokenLatencyMs?: number;
  mcpLatencyMs: number;
  tailoringLatencyMs: number;
  pdfLatencyMs: number;
  structuredOutputValid?: boolean;
  recoveryCount: number;
  lastEventType?: string;
  lastTool?: string;
  lastOperationId?: string;
  lastSubstantiveEventAt: number;
  toolStartedAt?: number;
};

export type HermesLongRunPolicy = {
  observerHeartbeatMs?: number;
  statusPollMs?: number;
  hardDeadlineMs?: number;
};

function sourceUserMessageIdForTurn(
  session: AgentRuntimeTurnInput["session"],
  turnId?: string
) {
  return turnId ? getUserMessageForTurn(session, turnId)?.id : undefined;
}

/**
 * Server/local Hermes adapter.  It owns protocol translation and tool
 * callbacks, but deliberately contains no WorkspaceRepository or browser
 * persistence access.
 */
export class HermesCareerAgentRuntime implements AgentRuntime {
  readonly id = "hermes" as const;
  private readonly sessions = new Map<string, string>();
  private readonly activeRuns = new Map<string, HermesRunHandle>();
  private readonly controlledStops = new Map<string, RunStopReason>();

  constructor(private readonly dependencies: {
    transport: HermesBridgeTransport;
    careerToolGateway: CareerToolGateway;
    capabilities?: Partial<AgentRuntimeCapabilities>;
    /** @deprecated accepted for source compatibility; production does not use local run policy. */
    longRunPolicy?: HermesLongRunPolicy;
    /** Explicit test/compatibility hook for pre-P4.6f transports only. */
    allowLegacyCompatibility?: boolean;
    legacyCompatibilityAdapter?: (dependencies: {
      transport: HermesBridgeTransport;
      careerToolGateway: CareerToolGateway;
      sessions: Map<string, string>;
    }) => {
      runTurn(input: AgentRuntimeTurnInput, counters: TurnCounters, startedAt: number): AsyncIterable<AgentRuntimeEvent>;
    };
  }) {}

  capabilities(): AgentRuntimeCapabilities {
    return {
      streaming: true,
      interruptible: true,
      resumable: true,
      toolCalls: true,
      approvals: true,
      offline: false,
      runtimeVersion: "hermes-career-runs-v2",
      ...this.dependencies.capabilities
    };
  }

  health(signal?: AbortSignal) {
    return this.dependencies.transport.health(signal);
  }

  getDiagnostics() {
    return this.dependencies.transport.getDiagnostics?.() ?? { bridgeRequestTraces: [] };
  }

  async pause(sessionId: string) {
    const handle = this.activeRuns.get(sessionId);
    if (handle) {
      const reason = createRunStopReason({
        requestedBy: "agent_runtime_provider",
        reasonCode: "hermes_run_paused",
        sourceComponent: "HermesCareerAgentRuntime.pause",
        sessionId,
        logicalTurnId: handle.turnId,
        runId: handle.runId
      });
      await this.stopRemoteRun(handle, reason);
    }
  }

  async interrupt(sessionId: string, reason?: RunStopReason) {
    const handle = this.activeRuns.get(sessionId);
    if (handle) await this.stopRemoteRun(handle, reason ?? createRunStopReason({
      requestedBy: "agent_runtime_provider",
      reasonCode: "user_interrupt",
      sourceComponent: "HermesCareerAgentRuntime.interrupt",
      sessionId,
      logicalTurnId: handle.turnId,
      runId: handle.runId
    }));
  }

  /**
   * A model apply changes Hermes' default for future sessions. Release only
   * the transport binding so the next semantic turn opens a fresh Hermes
   * session; CareerAdapt's persisted messages, workflow, checkpoints, and
   * artifacts remain owned by AgentHostStore.
   */
  releaseSessionBinding(sessionId: string) {
    this.sessions.delete(sessionId);
    this.activeRuns.delete(sessionId);
  }

  async stopCurrentRun(runId: string, reason: RunStopReason): Promise<HermesRunStatus> {
    const transport = this.dependencies.transport;
    if (!transport.getRun || !transport.stopRun) throw hermesError("hermes_run_stop_unavailable", "当前 Hermes 运行时不支持停止 Run。");
    const activeHandle = [...this.activeRuns.values()].find((candidate) => candidate.runId === runId);
    if (activeHandle) {
      await this.stopRemoteRun(activeHandle, reason);
    } else {
      const status = await transport.getRun(runId, undefined, this.traceContext({
        incidentTraceId: reason.incidentTraceId,
        logicalTurnId: reason.logicalTurnId,
        sessionId: reason.sessionId,
        turnId: reason.logicalTurnId,
        runId
      }));
      if (isTerminalRunStatus(status.status)) return status;
      this.controlledStops.set(runId, reason);
      await transport.stopRun(runId, undefined, this.traceContext({
        incidentTraceId: reason.incidentTraceId,
        logicalTurnId: reason.logicalTurnId,
        sessionId: reason.sessionId,
        turnId: reason.logicalTurnId,
        runId,
        stopReason: reason
      }));
    }
    let status = await transport.getRun(runId, undefined, this.traceContext({
      incidentTraceId: reason.incidentTraceId,
      logicalTurnId: reason.logicalTurnId,
      sessionId: reason.sessionId,
      turnId: reason.logicalTurnId,
      runId
    }));
    for (let attempt = 0; attempt < 4 && !isTerminalRunStatus(status.status); attempt += 1) {
      await delay(150);
      status = await transport.getRun(runId, undefined, this.traceContext({
        incidentTraceId: reason.incidentTraceId,
        logicalTurnId: reason.logicalTurnId,
        sessionId: reason.sessionId,
        turnId: reason.logicalTurnId,
        runId
      }));
    }
    if (!isTerminalRunStatus(status.status)) throw hermesError("hermes_run_stop_reconcile_timeout", "Hermes Run 停止请求已发出，但状态尚未进入终态。");
    return status;
  }

  async resume() {
    // Resume is represented by the next runTurn's session resume handshake.
  }

  async approve(sessionId: string, approved: boolean) {
    const handle = this.activeRuns.get(sessionId);
    if (!handle || !this.dependencies.transport.approveRun) {
      throw hermesError("hermes_run_approval_unavailable", "当前没有可确认的 Hermes run。");
    }
    const status = await this.dependencies.transport.approveRun(handle.runId, approved ? "once" : "deny", undefined, this.traceContext({ sessionId, turnId: handle.turnId, runId: handle.runId }));
    const next = touchRunHandle(handle, normalizeRunStatus(status.status));
    this.activeRuns.set(sessionId, next);
    return next;
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const turnId = input.turnId ?? `hermes-turn-${nanoid(12)}`;
    const incidentTraceId = typeof input.metadata?.incidentTraceId === "string" && input.metadata.incidentTraceId.trim()
      ? input.metadata.incidentTraceId
      : createIncidentTraceId();
    const attemptTraceId = typeof input.metadata?.attemptTraceId === "string" && input.metadata.attemptTraceId.trim()
      ? input.metadata.attemptTraceId
      : `${incidentTraceId}:attempt-1`;
    const normalized: AgentRuntimeTurnInput = {
      ...input,
      turnId,
      metadata: { ...(input.metadata ?? {}), incidentTraceId, attemptTraceId }
    };
    const startedAt = Date.now();
    const counters: TurnCounters = {
      toolCalls: 0,
      toolFailures: 0,
      autonomousRecoveries: 0,
      artifactUpdates: 0,
      mcpLatencyMs: 0,
      tailoringLatencyMs: 0,
      pdfLatencyMs: 0,
      recoveryCount: 0,
      lastSubstantiveEventAt: startedAt
    };

    if (!supportsRuns(this.dependencies.transport)) {
      // Compatibility is deliberately isolated here. Production transports
      // use the official /v1/runs path below and never execute browser tools;
      // only explicit non-production test/compatibility fixtures may exercise
      // the old loop. Product composition never supplies this hook.
      if (process.env.NODE_ENV === "production"
        || this.dependencies.allowLegacyCompatibility !== true
        || !this.dependencies.legacyCompatibilityAdapter) {
        throw hermesError("hermes_runs_unsupported", "Hermes transport does not expose the official /v1/runs API.");
      }
      yield* this.dependencies.legacyCompatibilityAdapter({
        transport: this.dependencies.transport,
        careerToolGateway: this.dependencies.careerToolGateway,
        sessions: this.sessions
      }).runTurn(normalized, counters, startedAt);
      return;
    }

    const transport = this.dependencies.transport;
    const binding = resolveCareerSessionBinding({
      sessionId: input.sessionId,
      session: input.session,
      pageContext: input.pageContext
    });
    const persisted = input.session?.hermesRun;
    const attachable = Boolean(
      persisted
      && persisted.careerAgentSessionId === input.sessionId
      && ["queued", "running", "waiting_for_approval", "stopping"].includes(persisted.status)
      && !input.userMessage.trim()
      && input.metadata?.reattachRunId === persisted.runId
      && persisted.turnId === turnId
    );

    // Host single-flight plus this guard prevent a second semantic run for the
    // same session. Recovery may reattach this run once, never resubmit input.
    if (!attachable && persisted && !isTerminalRunStatus(persisted.status)) {
      throw createHermesRunFailure({
        code: "hermes_active_run_conflict",
        message: "当前对话已有一个运行中的回答。",
        failureLayer: "run_start",
        hermesRunId: persisted.runId,
        hermesSessionId: persisted.hermesSessionId,
        requestedTurnId: turnId,
        runStartKind: "new",
        runPhase: "before_run_start",
        incidentTraceId,
        attemptTraceId,
        retryable: false
      });
    }

    const health = attachable ? undefined : await transport.health(input.signal);
    const runtimeAvailable = Boolean(attachable) || Boolean(health?.runtimeHealth?.runtimeAvailable ?? health?.available);
    if (!attachable && !runtimeAvailable) {
      throw createHermesRunFailure({
        code: "hermes_unavailable_before_turn",
        message: health?.reason ?? "Hermes runtime is unavailable.",
        failureLayer: "companion",
        companionConnected: false,
        providerStatus: health?.providerStatus,
        mcpConnected: health?.mcpConnected,
        hermesSessionId: typeof input.metadata?.hermesSessionId === "string" ? input.metadata.hermesSessionId : undefined,
        requestedTurnId: turnId,
        runStartKind: "new",
        runPhase: "before_run_start",
        incidentTraceId,
        attemptTraceId,
        retryable: true
      });
    }

    const hermesSessionId = attachable
      ? persisted!.hermesSessionId
      : typeof input.metadata?.hermesSessionId === "string" && input.metadata.hermesSessionId.trim()
        ? input.metadata.hermesSessionId
      : this.sessions.get(input.sessionId) ?? `hermes-${input.sessionId}`;
    this.sessions.set(input.sessionId, hermesSessionId);

    let handle: HermesRunHandle = attachable
      ? persisted!
      : {
          runId: "",
          hermesSessionId,
          careerAgentSessionId: input.sessionId,
          turnId,
          status: "queued",
          startedAt: new Date(startedAt).toISOString(),
          lastEventAt: new Date().toISOString()
        };
    let runStartedSuccessfully = attachable;
    let transportReattachAttempted = false;
    let eventCursor: string | undefined;
    const seenEventIds = new Set<string>();
    let terminalSeen = false;

    try {
      if (!attachable) {
        const started = await transport.startRun!({
          sessionId: hermesSessionId,
          turnId,
          userMessage: input.userMessage,
          pageContext: input.pageContext,
          // The official Hermes server owns model/tool execution. CareerAdapt
          // sends no executable callback contract or second tool loop here.
          toolContracts: [],
          careerSessionBinding: binding,
          incidentTraceId,
          logicalTurnId: turnId,
          attemptTraceId,
          attachments: input.attachments,
          conversationHistory: conversationHistory(input),
          metadata: {
            ...(safeMetadata(input.metadata) ?? {}),
            requireCareerSessionBinding: Boolean(binding)
          }
        }, input.signal);
        if (!started.runId || !["started", "queued", "running"].includes(started.status)) {
          throw createHermesRunFailure({
            code: "hermes_run_start_invalid_response",
            message: "Hermes run_start 返回了无法识别的运行句柄。",
            failureLayer: "response",
            hermesSessionId,
            requestedTurnId: turnId,
            runStartKind: "new",
            runPhase: "before_run_start",
            incidentTraceId,
            attemptTraceId,
            retryable: false
          });
        }
        handle = {
          ...handle,
          runId: started.runId,
          status: started.status === "queued" ? "queued" : "running",
          lastEventAt: new Date().toISOString()
        };
        runStartedSuccessfully = true;
      }

      this.activeRuns.set(input.sessionId, handle);
      yield this.event(normalized, attachable ? "turn_resumed" : "progress", {
        message: attachable ? "已重新连接当前回答。" : "正在回复…",
        data: {
          runHandle: handle,
          hermesSessionId,
          runStartedSuccessfully,
          transportReattachAttempted,
          incidentTraceId,
          attemptTraceId
        }
      });

      while (!terminalSeen) {
        try {
          for await (const bridgeEvent of transport.runEvents(handle.runId, input.signal, this.traceContext({
            incidentTraceId,
            traceId: attemptTraceId,
            logicalTurnId: turnId,
            sessionId: input.sessionId,
            turnId,
            runId: handle.runId,
            ...(eventCursor ? { eventCursor } : {})
          }))) {
            if (bridgeEvent.eventId && seenEventIds.has(bridgeEvent.eventId)) continue;
            if (bridgeEvent.eventId) {
              seenEventIds.add(bridgeEvent.eventId);
              eventCursor = bridgeEvent.eventId;
            }
            counters.lastEventType = bridgeEvent.type;
            if ("toolName" in bridgeEvent && typeof bridgeEvent.toolName === "string") counters.lastTool = bridgeEvent.toolName;
            if ("operationId" in bridgeEvent && typeof bridgeEvent.operationId === "string") counters.lastOperationId = bridgeEvent.operationId;
            if (bridgeEvent.type === "text_delta" && counters.firstTokenLatencyMs === undefined) {
              counters.firstTokenLatencyMs = Math.max(0, Date.now() - startedAt);
            }
            if (bridgeEvent.type === "tool_call_started") counters.toolCalls += 1;
            if (bridgeEvent.type === "tool_call_failed") counters.toolFailures += 1;
            if (bridgeEvent.type === "artifact_updated") counters.artifactUpdates += 1;
            handle = touchRunHandle(handle, statusForBridgeEvent(bridgeEvent, handle.status));
            this.activeRuns.set(input.sessionId, handle);

            if (bridgeEvent.type === "turn_failed") {
              // A failed event is not complete until the authoritative status
              // endpoint has been read once. The event remains the primary
              // cause; a failed readback is recorded as a secondary transport
              // diagnostic without replacing it.
              let authoritative: HermesRunStatus | undefined;
              let readbackFailure: unknown;
              try {
                authoritative = await transport.getRun(handle.runId, input.signal, this.traceContext({
                  incidentTraceId,
                  traceId: attemptTraceId,
                  logicalTurnId: turnId,
                  sessionId: input.sessionId,
                  turnId,
                  runId: handle.runId
                }));
              } catch (error) {
                readbackFailure = error;
              }
              const failure = classifyHermesRunFailure({
                code: bridgeEvent.code,
                message: bridgeEvent.message,
                httpStatus: runStatusHttpStatus(authoritative),
                failureLayer: "provider",
                hermesSessionId,
                hermesRunId: handle.runId,
                sessionId: input.sessionId,
                requestedTurnId: turnId,
                runStartKind: "reattach",
                runPhase: "after_run_start",
                providerStatus: health?.providerStatus,
                provider: safeRunStatusString(authoritative?.provider),
                model: safeRunStatusString(authoritative?.model),
                lastHermesEventType: authoritative?.last_event ?? bridgeEvent.type,
                toolName: counters.lastTool,
                mcpConnected: health?.mcpConnected,
                incidentTraceId,
                attemptTraceId,
                retryable: false
              });
              handle = touchRunHandle(handle, authoritative ? normalizeRunStatus(authoritative.status) : "failed");
              this.activeRuns.delete(input.sessionId);
              const mapped = this.mapBridgeEvent(normalized, bridgeEvent, counters, startedAt);
              if (mapped) {
                terminalSeen = true;
                yield {
                  ...mapped,
                  error: {
                    code: failure.safeErrorCode,
                    message: failure.safeErrorMessage,
                    recoverable: false
                  },
                  data: mergeEventData(mapped.data, {
                    runHandle: handle,
                    runId: handle.runId,
                    hermesSessionId,
                    terminalStatus: authoritative?.status ?? "failed",
                    provider: safeRunStatusString(authoritative?.provider),
                    model: safeRunStatusString(authoritative?.model),
                    lastHermesEventType: authoritative?.last_event ?? bridgeEvent.type,
                    diagnostics: {
                      ...failure,
                      ...(readbackFailure ? {
                        terminalReadback: "failed",
                        terminalReadbackCategory: "transport_failure"
                      } : { terminalReadback: "authoritative" })
                    },
                    incidentTraceId,
                    attemptTraceId,
                    transportReattachAttempted,
                    telemetry: this.telemetry(normalized, counters, "failed", startedAt)
                  })
                };
              }
              break;
            }

            const mapped = this.mapBridgeEvent(normalized, bridgeEvent, counters, startedAt);
            if (mapped) {
              yield {
                ...mapped,
                data: mergeEventData(mapped.data, {
                  runHandle: handle,
                  runId: handle.runId,
                  hermesSessionId,
                  incidentTraceId,
                  attemptTraceId,
                  transportReattachAttempted
                })
              };
            }
            if (bridgeEvent.type === "approval_required") return;
            if (bridgeEvent.type === "turn_completed") {
              terminalSeen = true;
              this.activeRuns.delete(input.sessionId);
              break;
            }
          }

          if (terminalSeen) break;

          // A clean stream end without a terminal event still requires one
          // authoritative status read before deciding whether to reattach.
          const status = await transport.getRun(handle.runId, input.signal, this.traceContext({
            incidentTraceId,
            traceId: attemptTraceId,
            logicalTurnId: turnId,
            sessionId: input.sessionId,
            turnId,
            runId: handle.runId
          }));
          handle = touchRunHandle(handle, normalizeRunStatus(status.status));
          this.activeRuns.set(input.sessionId, handle);
          if (isTerminalRunStatus(status.status)) {
            const terminalBridgeEvent = status.status === "completed"
              ? {
                  type: "turn_completed" as const,
                  message: safeRunStatusString(status.output),
                  data: { output: safeRunStatusString(status.output), lastHermesEventType: status.last_event }
                }
              : {
                  type: "turn_failed" as const,
                  code: status.status === "cancelled" ? this.cancellationCode(handle.runId) : "hermes_run_failed",
                  message: safeRunErrorMessage(status.error),
                  recoverable: false
                };
            if (terminalBridgeEvent.type === "turn_completed") {
              terminalSeen = true;
              this.activeRuns.delete(input.sessionId);
              yield this.event(normalized, "turn_completed", {
                message: terminalBridgeEvent.message,
                data: {
                  ...terminalBridgeEvent.data,
                  runHandle: handle,
                  incidentTraceId,
                  attemptTraceId,
                  transportReattachAttempted,
                  telemetry: this.telemetry(normalized, counters, "completed", startedAt)
                }
              });
            } else {
              terminalSeen = true;
              this.activeRuns.delete(input.sessionId);
              const failure = classifyHermesRunFailure({
                code: terminalBridgeEvent.code,
                message: terminalBridgeEvent.message,
                httpStatus: runStatusHttpStatus(status),
                failureLayer: "provider",
                hermesSessionId,
                hermesRunId: handle.runId,
                sessionId: input.sessionId,
                requestedTurnId: turnId,
                runStartKind: "reattach",
                runPhase: "after_run_start",
                provider: safeRunStatusString(status.provider),
                model: safeRunStatusString(status.model),
                lastHermesEventType: status.last_event ?? "run.failed",
                toolName: counters.lastTool,
                incidentTraceId,
                attemptTraceId,
                retryable: false
              });
              yield this.event(normalized, "turn_failed", {
                error: { code: failure.safeErrorCode, message: failure.safeErrorMessage, recoverable: false },
                data: {
                  runHandle: handle,
                  runId: handle.runId,
                  hermesSessionId,
                  terminalStatus: status.status,
                  provider: safeRunStatusString(status.provider),
                  model: safeRunStatusString(status.model),
                  lastHermesEventType: status.last_event ?? "run.failed",
                  diagnostics: failure,
                  incidentTraceId,
                  attemptTraceId,
                  transportReattachAttempted,
                  telemetry: this.telemetry(normalized, counters, "failed", startedAt)
                }
              });
            }
            break;
          }
          if (!transportReattachAttempted) {
            transportReattachAttempted = true;
            counters.recoveryCount += 1;
            counters.autonomousRecoveries += 1;
            continue;
          }
          throw createHermesRunFailure({
            code: "hermes_run_events_incomplete",
            message: "Hermes 事件流在终态前结束。",
            failureLayer: "bridge_http",
            hermesSessionId,
            hermesRunId: handle.runId,
            sessionId: input.sessionId,
            requestedTurnId: turnId,
            runStartKind: "reattach",
            runPhase: "after_run_start",
            incidentTraceId,
            attemptTraceId,
            retryable: false
          });
        } catch (error) {
          if (input.signal?.aborted) {
            yield this.event(normalized, "turn_paused", {
              message: "连接已断开，当前回答仍可重新连接。",
              data: {
                runHandle: handle,
                incidentTraceId,
                attemptTraceId,
                abortTrace: abortTraceFromSignal(input.signal, {
                  incidentTraceId,
                  sessionId: input.sessionId,
                  turnId,
                  runId: handle.runId
                })
              }
            });
            return;
          }
          if (error instanceof Error && "code" in error && error.code === "hermes_run_events_incomplete") throw error;
          if (!transportReattachAttempted) {
            transportReattachAttempted = true;
            counters.recoveryCount += 1;
            counters.autonomousRecoveries += 1;
            continue;
          }
          const source = error && typeof error === "object" && !Array.isArray(error)
            ? error as { diagnostics?: Partial<HermesRunFailureInput>; httpStatus?: number }
            : {};
          const sourceDiagnostics = source.diagnostics ?? {};
          throw createHermesRunFailure({
            ...sourceDiagnostics,
            code: errorCode(error),
            message: error instanceof Error ? error.message : "Hermes 事件连接失败。",
            httpStatus: sourceDiagnostics.httpStatus ?? source.httpStatus,
            failureLayer: sourceDiagnostics.failureLayer ?? "bridge_http",
            hermesSessionId,
            hermesRunId: handle.runId,
            sessionId: input.sessionId,
            requestedTurnId: turnId,
            runStartKind: "reattach",
            runPhase: "after_run_start",
            incidentTraceId,
            attemptTraceId,
            retryable: sourceDiagnostics.retryable ?? false
          });
        }
      }
    } catch (error) {
      const source = error && typeof error === "object" && !Array.isArray(error)
        ? error as { diagnostics?: Partial<HermesRunFailureInput>; httpStatus?: number }
        : {};
      const sourceDiagnostics = source.diagnostics ?? {};
      const failure = classifyHermesRunFailure({
        ...sourceDiagnostics,
        code: errorCode(error),
        message: error instanceof Error ? error.message : "Hermes 本轮任务没有完成。",
        httpStatus: sourceDiagnostics.httpStatus ?? source.httpStatus,
        failureLayer: sourceDiagnostics.failureLayer ?? (runStartedSuccessfully ? "bridge_http" : "run_start"),
        hermesSessionId,
        hermesRunId: runStartedSuccessfully ? handle.runId : sourceDiagnostics.hermesRunId,
        sessionId: input.sessionId,
        requestedTurnId: turnId,
        runStartKind: attachable ? "reattach" : "new",
        runPhase: runStartedSuccessfully ? "after_run_start" : "before_run_start",
        incidentTraceId,
        attemptTraceId,
        provider: sourceDiagnostics.provider,
        model: sourceDiagnostics.model,
        lastHermesEventType: sourceDiagnostics.lastHermesEventType ?? counters.lastEventType,
        retryable: sourceDiagnostics.retryable ?? false
      });
      if (!runStartedSuccessfully) throw createHermesRunFailure(failure);
      this.activeRuns.delete(input.sessionId);
      yield this.event(normalized, "turn_failed", {
        error: { code: failure.safeErrorCode, message: failure.safeErrorMessage, recoverable: false },
        data: {
          runHandle: handle.runId ? handle : undefined,
          runId: handle.runId || undefined,
          hermesSessionId,
          terminalStatus: "failed",
          lastHermesEventType: counters.lastEventType,
          diagnostics: failure,
          incidentTraceId,
          attemptTraceId,
          transportReattachAttempted,
          telemetry: this.telemetry(normalized, counters, "failed", startedAt)
        }
      });
    }
  }

  private diagnostics(
    handle: HermesRunHandle | undefined,
    counters: TurnCounters,
    safeErrorCode: string,
    primaryCausalChain?: RuntimeCausalChainEntry[],
    secondaryRecoveryFailures?: SecondaryRecoveryFailure[]
  ) {
    return {
      runId: handle?.runId,
      hermesSessionId: handle?.hermesSessionId,
      requestedTurnId: handle?.turnId,
      lastEventType: counters.lastEventType,
      lastTool: counters.lastTool,
      lastOperationId: counters.lastOperationId,
      safeErrorCode,
      runHandle: handle,
      ...(primaryCausalChain?.length ? { primaryCausalChain: primaryCausalChain.slice(-48) } : {}),
      ...(secondaryRecoveryFailures?.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice(-16) } : {})
    };
  }

  private stopReason(input: AgentRuntimeTurnInput, requestedBy: RunStopReason["requestedBy"], reasonCode: string, runId?: string) {
    return createRunStopReason({
      requestedBy,
      reasonCode,
      sourceComponent: "HermesCareerAgentRuntime",
      sessionId: input.sessionId,
      logicalTurnId: input.turnId,
      runId,
      incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined
    });
  }

  private traceContext(input: HermesRunTraceContext): HermesRunTraceContext {
    return input;
  }

  private async stopRemoteRun(handle: HermesRunHandle, reason: RunStopReason, signal?: AbortSignal) {
    this.controlledStops.set(handle.runId, reason);
    if (this.dependencies.transport.stopRun) {
      await this.dependencies.transport.stopRun(handle.runId, signal, {
        incidentTraceId: reason.incidentTraceId,
        logicalTurnId: reason.logicalTurnId,
        sessionId: reason.sessionId,
        turnId: handle.turnId,
        runId: handle.runId,
        stopReason: reason
      });
    }
    return reason;
  }

  private cancellationCode(runId: string) {
    const reason = this.controlledStops.get(runId);
    if (!reason) return "hermes_run_cancelled_upstream";
    if (reason.reasonCode === "user_interrupt" || reason.requestedBy === "user") return "hermes_run_stopped_by_user";
    if (reason.reasonCode === "hermes_run_stopped_for_restart" || reason.reasonCode === "runtime_restart") return "hermes_run_stopped_for_restart";
    return "hermes_run_cancelled";
  }

  private normalizeCancellationEvent(event: HermesBridgeEvent, handle: HermesRunHandle): HermesBridgeEvent {
    if (event.type !== "turn_failed" || event.code !== "hermes_run_cancelled") return event;
    const code = this.cancellationCode(handle.runId);
    return {
      ...event,
      code,
      message: code === "hermes_run_cancelled_upstream"
        ? "Hermes 上游报告本轮任务已取消。"
        : event.message
    };
  }

  private async settleRemoteRun(
    runId: string,
    requestedTurnId: string | undefined,
    sessionId: string,
    signal?: AbortSignal,
    stopReason?: RunStopReason
  ) {
    const transport = this.dependencies.transport;
    if (!transport.getRun || !transport.stopRun) return;
    const reason = stopReason ?? createRunStopReason({
      requestedBy: "run_reconciliation",
      reasonCode: "hermes_run_reconciliation",
      sourceComponent: "HermesCareerAgentRuntime.settleRemoteRun",
      sessionId,
      logicalTurnId: requestedTurnId,
      runId
    });
    let status = await transport.getRun(runId, signal, {
      incidentTraceId: reason.incidentTraceId,
      logicalTurnId: reason.logicalTurnId,
      sessionId,
      turnId: requestedTurnId,
      runId
    });
    if (isTerminalRunStatus(status.status)) return;
    this.controlledStops.set(runId, reason);
    await transport.stopRun(runId, signal, {
      incidentTraceId: reason.incidentTraceId,
      logicalTurnId: reason.logicalTurnId,
      sessionId,
      turnId: requestedTurnId,
      runId,
      stopReason: reason
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await delay(150, signal);
      status = await transport.getRun(runId, signal, {
        incidentTraceId: reason.incidentTraceId,
        logicalTurnId: reason.logicalTurnId,
        sessionId,
        turnId: requestedTurnId,
        runId
      });
      if (isTerminalRunStatus(status.status)) return;
    }
    throw createHermesRunFailure({
      code: "hermes_active_run_conflict",
      message: "上一个 Hermes run 尚未结束，当前任务没有重复提交。",
      failureLayer: "run_start",
      hermesRunId: runId,
      requestedTurnId,
      retryable: true,
      mcpConnected: true,
      hermesSessionId: sessionId,
      incidentTraceId: reason.incidentTraceId
    });
  }

  private mapBridgeEvent(input: AgentRuntimeTurnInput, event: HermesBridgeEvent, counters: TurnCounters, startedAt: number) {
    if (event.type === "progress") return this.event(input, "progress", { eventId: event.eventId, message: event.message, data: event.data });
    if (event.type === "reasoning_status") return this.event(input, "reasoning_status", { eventId: event.eventId, message: event.message, data: event.data });
    if (event.type === "text_delta") return this.event(input, "text_delta", { eventId: event.eventId, delta: event.delta });
    if (event.type === "tool_call_started") {
      counters.toolCalls += 1;
      return this.event(input, "tool_call_started", {
        eventId: event.eventId,
        toolName: event.toolName,
        operationId: event.operationId,
        data: {
          toolCallId: event.toolCallId,
          ...this.toolDiagnostics(input, event.toolName),
          ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}),
          logicalToolOperationId: this.bridgeLogicalOperationId(input, event)
        }
      });
    }
    if (event.type === "tool_call_completed") return this.event(input, "tool_call_completed", {
      eventId: event.eventId,
      toolName: event.toolName,
      operationId: event.operationId,
      data: {
        toolCallId: event.toolCallId,
        ...this.toolDiagnostics(input, event.toolName),
        ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}),
        logicalToolOperationId: this.bridgeLogicalOperationId(input, event)
      }
    });
    if (event.type === "tool_call_failed") {
      counters.toolFailures += 1;
      return this.event(input, "tool_call_failed", {
        eventId: event.eventId,
        toolName: event.toolName,
        operationId: event.operationId,
        error: { code: event.code, message: event.message, recoverable: event.recoverable },
        data: {
          ...this.toolDiagnostics(input, event.toolName),
          ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}),
          logicalToolOperationId: this.bridgeLogicalOperationId(input, event)
        }
      });
    }
    if (event.type === "approval_required") return this.event(input, "approval_required", {
      eventId: event.eventId,
      toolName: event.toolName,
      operationId: event.operationId,
      message: event.message,
      data: { ...this.toolDiagnostics(input, event.toolName), ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) }
    });
    if (event.type === "artifact_updated") {
      counters.artifactUpdates += 1;
      return this.event(input, "artifact_updated", { eventId: event.eventId, data: event.data, ...(event.artifactId ? { operationId: event.artifactId } : {}) });
    }
    if (event.type === "turn_completed") return this.event(input, "turn_completed", {
      eventId: event.eventId,
      message: event.message,
      data: {
        ...(event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {}),
        telemetry: this.telemetry(input, counters, "completed", startedAt)
      }
    });
    if (event.type === "turn_failed") return this.event(input, "turn_failed", {
      eventId: event.eventId,
      error: { code: event.code, message: event.message, recoverable: event.recoverable },
      data: {
        ...(event.data && typeof event.data === "object" && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {}),
        telemetry: this.telemetry(input, counters, "failed", startedAt)
      }
    });
    return undefined;
  }

  private bridgeLogicalOperationId(
    input: AgentRuntimeTurnInput,
    event: Extract<HermesBridgeEvent, { type: "tool_call_requested" | "tool_call_started" | "tool_call_completed" | "tool_call_failed" }>
  ) {
    if (event.logicalToolOperationId) return event.logicalToolOperationId;
    const catalog = new HermesCareerToolCatalog(this.dependencies.careerToolGateway.listContracts());
    const stableToolName = catalog.stableNameForRequestedName(event.toolName) ?? event.toolName;
    return logicalToolOperationId({
      toolCallId: event.toolCallId,
      operationId: event.operationId,
      turnId: input.turnId,
      stableToolName,
      preferStableToolName: true
    });
  }

  private toolDiagnostics(input: AgentRuntimeTurnInput, requestedHermesToolName?: string) {
    if (!requestedHermesToolName) return {};
    const stableCareerToolName = new HermesCareerToolCatalog(this.dependencies.careerToolGateway.listContracts())
      .stableNameForRequestedName(requestedHermesToolName);
    return {
      requestedHermesToolName,
      ...(stableCareerToolName ? { stableCareerToolName } : {}),
      sourceUserMessageId: sourceUserMessageIdForTurn(input.session, input.turnId)
    };
  }

  private telemetry(input: AgentRuntimeTurnInput, counters: TurnCounters, completionStatus: "completed" | "failed", startedAt: number) {
    return {
      runtimeId: this.id,
      turnId: input.turnId ?? "hermes-turn-unknown",
      model: typeof input.metadata?.model === "string" ? input.metadata.model : undefined,
      latencyMs: Math.max(0, Date.now() - startedAt),
      firstTokenLatencyMs: counters.firstTokenLatencyMs,
      mcpLatencyMs: counters.mcpLatencyMs,
      tailoringLatencyMs: counters.tailoringLatencyMs,
      pdfLatencyMs: counters.pdfLatencyMs,
      structuredOutputValid: counters.structuredOutputValid,
      toolCalls: counters.toolCalls,
      toolFailures: counters.toolFailures,
      autonomousRecoveries: counters.autonomousRecoveries,
      recoveryCount: counters.recoveryCount,
      fallbackUsed: input.metadata?.fallbackUsed === true,
      artifactUpdates: counters.artifactUpdates,
      completionStatus
    };
  }

  private async executeGatewayTool(
    name: string,
    input: unknown,
    context: Parameters<CareerToolGateway["execute"]>[2],
    counters: TurnCounters
  ) {
    const startedAt = Date.now();
    try {
      return await this.dependencies.careerToolGateway.execute(name, input, context);
    } finally {
      const elapsed = Math.max(0, Date.now() - startedAt);
      counters.mcpLatencyMs += elapsed;
      if (name.startsWith("career.tailoring.")) counters.tailoringLatencyMs += elapsed;
      if (name === "career.export.resume") counters.pdfLatencyMs += elapsed;
    }
  }

  private event(input: AgentRuntimeTurnInput, type: AgentRuntimeEvent["type"], partial: Partial<AgentRuntimeEvent> = {}) {
    return {
      type,
      sessionId: input.sessionId,
      turnId: input.turnId ?? "hermes-turn-unknown",
      timestamp: new Date().toISOString(),
      ...partial
    } satisfies AgentRuntimeEvent;
  }
}

function conversationHistory(input: AgentRuntimeTurnInput) {
  const currentUserMessageId = typeof input.metadata?.runtimeShellUserMessageId === "string"
    ? input.metadata.runtimeShellUserMessageId
    : undefined;
  return (input.session?.messages ?? [])
    .filter((message) => (message.role === "user" || message.role === "assistant")
      && message.id !== currentUserMessageId
      && message.kind !== "assistant_thinking"
      && message.kind !== "assistant_streaming"
      && message.content.trim())
    .slice(-24)
    .map((message) => ({ role: message.role as "user" | "assistant", content: message.content.slice(0, 8_000) }));
}

function touchRunHandle(handle: HermesRunHandle, status: HermesRunHandle["status"]): HermesRunHandle {
  return { ...handle, status, lastEventAt: new Date().toISOString() };
}

function statusForBridgeEvent(event: HermesBridgeEvent, current: HermesRunHandle["status"]): HermesRunHandle["status"] {
  if (event.type === "turn_completed") return "completed";
  if (event.type === "turn_failed") return event.code === "hermes_run_cancelled" ? "cancelled" : "failed";
  if (event.type === "approval_required") return "waiting_for_approval";
  return current === "queued" ? "running" : current;
}

function normalizeRunStatus(status: string): HermesRunHandle["status"] {
  if (status === "started") return "running";
  if (["queued", "running", "waiting_for_approval", "stopping", "completed", "failed", "cancelled"].includes(status)) {
    return status as HermesRunHandle["status"];
  }
  return "running";
}

function isTerminalRunStatus(status: HermesRunHandle["status"] | string) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function mergeEventData(current: unknown, extra: Record<string, unknown>) {
  return current && typeof current === "object" && !Array.isArray(current)
    ? { ...current as Record<string, unknown>, ...extra }
    : extra;
}

function delay(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new Error("hermes_transport_detached"), { code: "hermes_transport_detached" }));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(Object.assign(new Error("hermes_transport_detached"), { code: "hermes_transport_detached" }));
    }, { once: true });
  });
}

function supportsRuns(transport: HermesBridgeTransport): transport is HermesBridgeTransport & Required<Pick<
  HermesBridgeTransport,
  "startRun" | "getRun" | "runEvents"
>> {
  return typeof transport.startRun === "function"
    && typeof transport.getRun === "function"
    && typeof transport.runEvents === "function";
}

function safeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (["model", "hermesSessionId", "reattachRunId", "requireCareerSessionBinding", "fallbackUsed", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackReasonCode", "runtimeFailureAt", "runtimeRecoveryAttempted", "runtimeRecoveryKind", "transportReattachAttempted", "semanticRetryAttempted", "semanticRetryUserMessage", "attemptNumber", "primaryFailureCode", "workflowId", "workflowStage", "rootGoal", "confirmed", "confirmationCount", "runtimeId", "executionOwner", "nextHermesRunId", "incidentTraceId", "logicalTurnId", "attemptTraceId", "recoveryReason", "taskId"].includes(key)
      && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      result[key] = value;
      continue;
    }
    if (key === "runtimeUserEvent" && value && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeRuntimeUserEvent(value as Record<string, unknown>);
    }
  }
  return result;
}

function sanitizeRuntimeUserEvent(value: Record<string, unknown>) {
  const type = typeof value.type === "string" ? value.type : "unknown";
  const action = value.action && typeof value.action === "object" && !Array.isArray(value.action)
    ? value.action as Record<string, unknown>
    : undefined;
  return {
    type,
    ...(typeof value.text === "string" ? { text: value.text.slice(0, 8_000) } : {}),
    ...(typeof value.actionId === "string" ? { actionId: value.actionId } : {}),
    ...(action ? { action } : {}),
    ...(typeof value.confirmed === "boolean" ? { confirmed: value.confirmed } : {}),
    ...(typeof value.messageId === "string" ? { messageId: value.messageId } : {}),
    ...(typeof value.sourceMessageId === "string" ? { sourceMessageId: value.sourceMessageId } : {})
  };
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "hermes_turn_failed";
}

function hermesError(code: string, message: string, retryable?: boolean) {
  return Object.assign(new Error(message), { code, ...(retryable === undefined ? {} : { retryable }) });
}

function safeRunStatusString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 360) : undefined;
}

function safeRunErrorMessage(value: HermesRunStatus["error"]) {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const message = value.message ?? value.error;
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Hermes run failed.";
}

function runStatusHttpStatus(status?: HermesRunStatus) {
  if (!status) return undefined;
  const record = status as Record<string, unknown>;
  const error = status.error && typeof status.error === "object" && !Array.isArray(status.error)
    ? status.error as Record<string, unknown>
    : {};
  const candidates = [
    record.http_status,
    record.httpStatus,
    record.status_code,
    record.statusCode,
    error.http_status,
    error.httpStatus,
    error.status_code,
    error.statusCode
  ];
  const explicit = candidates.find((candidate): candidate is number => typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599);
  if (explicit !== undefined) return explicit;
  const message = safeRunErrorMessage(status.error);
  const match = message.match(/(?:HTTP|status|code)\s*[:=]?\s*(4\d{2}|5\d{2})\b/iu);
  return match ? Number(match[1]) : undefined;
}
