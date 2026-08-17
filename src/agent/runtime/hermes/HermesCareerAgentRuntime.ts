import { nanoid } from "nanoid";
import type {
  AgentRuntime,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeRecoveryPlan,
  AgentRuntimeTurnInput
} from "../agentRuntime";
import type { HermesRunHandle } from "../../contracts/agentSession";
import type { CareerToolGateway, CareerToolContract } from "../../tools/CareerToolGateway";
import { logicalToolOperationId, type HermesBridgeEvent, type HermesBridgeTransport, type HermesRunTraceContext } from "./HermesBridgeTransport";
import { resolveCareerSessionBinding, type CareerSessionBinding } from "../careerSessionBinding";
import { hermesProductionToolNames, HermesCareerToolCatalog, projectCareerContractsForHermes } from "./HermesCareerToolCatalog";
import { isRoadshowReady } from "../runtimeHealth";
import { isCareerSystemStatusQuestion } from "../../kernel/AgentToolResolver";
import {
  createHermesRunFailure,
  isRetryableHermesRunFailure,
  withHermesRunFailureDiagnostics
} from "./hermesRunReliability";
import {
  abortTraceFromSignal,
  createIncidentTraceId,
  createRunStopReason,
  type RunStopReason
} from "./hermesIncidentTrace";
import type { RuntimeCausalChainEntry, SecondaryRecoveryFailure } from "./hermesIncidentTrace";

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

const DEFAULT_HERMES_LONG_RUN_POLICY: Required<HermesLongRunPolicy> = {
  observerHeartbeatMs: 45_000,
  statusPollMs: 1_000,
  hardDeadlineMs: 30 * 60_000
};

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
  private readonly longRunPolicy: Required<HermesLongRunPolicy>;

  constructor(private readonly dependencies: {
    transport: HermesBridgeTransport;
    careerToolGateway: CareerToolGateway;
    capabilities?: Partial<AgentRuntimeCapabilities>;
    longRunPolicy?: HermesLongRunPolicy;
  }) {
    this.longRunPolicy = {
      ...DEFAULT_HERMES_LONG_RUN_POLICY,
      ...(dependencies.longRunPolicy ?? {})
    };
  }

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

  async recoverBeforeFallback(input: AgentRuntimeTurnInput): Promise<AgentRuntimeRecoveryPlan> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
      const health = await this.dependencies.transport.health(signal);
      if (!(health.runtimeHealth?.runtimeAvailable ?? health.available)) {
        throw createHermesRunFailure({
          code: "hermes_companion_unavailable",
          message: health.reason ?? "Hermes recovery health check failed.",
          failureLayer: "companion",
          companionConnected: false,
          providerStatus: health.providerStatus,
          mcpConnected: health.mcpConnected,
          retryable: true
        });
      }
      const existingSession = this.sessions.get(input.sessionId);
      // Official /v1/runs sessions are resumed by the run/session_id itself;
      // calling the legacy `/sessions/resume` endpoint here can turn a
      // transient run_start failure into a false session-not-found failure.
      if (existingSession && this.dependencies.transport.resumeSession && !supportsRuns(this.dependencies.transport)) {
        await this.dependencies.transport.resumeSession({ sessionId: existingSession }, signal);
      }
      const persisted = input.session?.hermesRun;
      if (!persisted || !supportsRuns(this.dependencies.transport)) return { kind: "retry" };
      try {
        const status = await this.dependencies.transport.getRun(persisted.runId, signal, this.traceContext({
          incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
          traceId: typeof input.metadata?.attemptTraceId === "string" ? input.metadata.attemptTraceId : undefined,
          logicalTurnId: input.turnId,
          sessionId: input.sessionId,
          turnId: input.turnId,
          runId: persisted.runId
        }));
        return isTerminalRunStatus(status.status)
          ? { kind: "retry" }
          : { kind: "reattach", runId: persisted.runId };
      } catch (error) {
        if (isMissingRemoteRunError(error)) return { kind: "retry" };
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
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
    const normalized = { ...input, turnId, metadata: { ...(input.metadata ?? {}), incidentTraceId, attemptTraceId } };
    const recoveryKind = input.metadata?.runtimeRecoveryKind === "reattach" || input.metadata?.runtimeRecoveryKind === "retry"
      ? input.metadata.runtimeRecoveryKind
      : undefined;
    const semanticRetryUserMessage = typeof input.metadata?.semanticRetryUserMessage === "string"
      ? input.metadata.semanticRetryUserMessage
      : undefined;
    const primaryFailureCode = typeof input.metadata?.primaryFailureCode === "string"
      ? input.metadata.primaryFailureCode
      : undefined;
    const active = this.activeRuns.get(input.sessionId);
    if (active && active.turnId !== turnId && ["queued", "running", "waiting_for_approval", "stopping"].includes(active.status)) {
      await this.settleRemoteRun(
        active.runId,
        turnId,
        input.sessionId,
        input.signal,
        this.stopReason(normalized, "run_reconciliation", "hermes_run_reconciliation")
      );
      this.activeRuns.delete(input.sessionId);
    }
    const startedAt = Date.now();
    const counters: TurnCounters = {
      toolCalls: 0,
      toolFailures: 0,
      autonomousRecoveries: 0,
      artifactUpdates: 0,
      mcpLatencyMs: 0,
      tailoringLatencyMs: 0,
      pdfLatencyMs: 0
      , recoveryCount: 0,
      lastSubstantiveEventAt: startedAt
    };
    const primaryCausalChain: RuntimeCausalChainEntry[] = [];
    const secondaryRecoveryFailures: SecondaryRecoveryFailure[] = [];
    let eventCursor = typeof input.metadata?.eventCursor === "string" ? input.metadata.eventCursor : undefined;
    let recoveryPerformed = input.metadata?.runtimeRecoveryAttempted === true;
    let transportReattachPerformed = input.metadata?.transportReattachAttempted === true;
    const recordCausal = (event: string, component: string, detail?: string, runId?: string) => {
      primaryCausalChain.push({
        event,
        component,
        at: new Date().toISOString(),
        ...(runId ? { runId } : {}),
        attemptTraceId,
        ...(detail ? { detail: detail.slice(0, 360) } : {})
      });
      if (primaryCausalChain.length > 48) primaryCausalChain.splice(0, primaryCausalChain.length - 48);
    };
    const recordSecondaryFailure = (error: unknown, operation: string, runId?: string) => {
      const diagnostics = error && typeof error === "object" && !Array.isArray(error)
        ? (error as { diagnostics?: { httpStatus?: unknown } }).diagnostics
        : undefined;
      const status = diagnostics && typeof diagnostics.httpStatus === "number" ? diagnostics.httpStatus : undefined;
      secondaryRecoveryFailures.push({
        code: errorCode(error),
        message: error instanceof Error ? error.message.slice(0, 360) : "Hermes recovery operation failed.",
        operation,
        capturedAt: new Date().toISOString(),
        ...(runId ? { runId } : {}),
        attemptTraceId,
        ...(status ? { httpStatus: status } : {})
      });
      if (secondaryRecoveryFailures.length > 16) secondaryRecoveryFailures.splice(0, secondaryRecoveryFailures.length - 16);
    };
    let runStartedSuccessfully = false;
    if (primaryFailureCode) recordCausal("primary_failure", "AgentRuntimeRouter", primaryFailureCode);
    let emitted = false;
    if (!supportsRuns(this.dependencies.transport)) {
      yield* this.runLegacyAdapterTurn(normalized, counters, startedAt);
      return;
    }
    try {
      const binding = resolveCareerSessionBinding({
        sessionId: input.sessionId,
        session: input.session,
        pageContext: input.pageContext
      });
      const requireSessionBinding = input.metadata?.requireCareerSessionBinding === true || Boolean(input.session);
      if (requireSessionBinding && !binding) {
        throw hermesError("career_session_binding_required", "当前 Hermes 任务缺少固定的人物与资料版本。");
      }
      const health = await this.dependencies.transport.health(input.signal);
      const runtimeAvailable = health.runtimeHealth?.runtimeAvailable ?? health.available;
      if (!runtimeAvailable) throw hermesError("hermes_unavailable_before_turn", health.reason ?? "Hermes runtime is unavailable.");
      const runStartRecoveryMayBypassCachedFailure = health.runtimeHealth
        && input.metadata?.runtimeRecoveryAttempted === true
        && isRoadshowReady({ ...health.runtimeHealth, runReady: true });
      if (health.runtimeHealth && !isRoadshowReady(health.runtimeHealth) && !runStartRecoveryMayBypassCachedFailure) {
        throw hermesError("hermes_career_registry_not_ready", `CareerAdapt MCP 尚未完成 Hermes 注册（缺少：${health.runtimeHealth.requiredCareerFacadesMissing.join("、") || "运行时契约"}）。`);
      }
      if (health.mcpConnected === false) {
        throw hermesError("mcp_unavailable_before_turn", "CareerAdapt MCP is not connected to the active browser workspace.");
      }
      const persisted = input.session?.hermesRun;
      const persistedVisibleAssistantId = input.session?.activeTurn?.visibleAssistantMessageId;
      const visibleAssistantBelongsToTurn = Boolean((input.session?.messages ?? []).some((message) =>
        message.role === "assistant"
        && message.turnId === persisted?.turnId
        && (!persistedVisibleAssistantId || message.id === persistedVisibleAssistantId)
        && message.metadata?.retracted !== true
      ));
      const attachable = persisted
        && persisted.careerAgentSessionId === input.sessionId
        && ["queued", "running", "waiting_for_approval", "stopping"].includes(persisted.status)
        && !input.userMessage.trim()
        && input.metadata?.reattachRunId === persisted.runId
        && persisted.turnId === turnId
        && visibleAssistantBelongsToTurn;
      const hermesSessionId = attachable
        ? persisted.hermesSessionId
        : typeof input.metadata?.hermesSessionId === "string"
          ? input.metadata.hermesSessionId
          : this.sessions.get(input.sessionId) ?? `hermes-${input.sessionId}`;
      this.sessions.set(input.sessionId, hermesSessionId);
      if (!attachable && persisted && !isTerminalRunStatus(persisted.status) && recoveryKind !== "retry" && recoveryKind !== "reattach") {
        await this.settleRemoteRun(
          persisted.runId,
          turnId,
          input.sessionId,
          input.signal,
          this.stopReason(normalized, "run_reconciliation", "hermes_run_reconciliation")
        );
      }
      const runStartRequestedAt = attachable ? undefined : new Date().toISOString();
      if (!attachable) recordCausal("run_start_requested", "HermesCareerAgentRuntime", recoveryKind === "retry" ? "semantic retry creates a new remote run" : undefined, persisted?.runId);
      if (attachable) recordCausal("run_reattach_requested", "HermesCareerAgentRuntime", "reattach uses the persisted run id", persisted.runId);
      const started = attachable
        ? undefined
        : await (async () => {
            try {
              const startedRun = await this.dependencies.transport.startRun!({
                sessionId: hermesSessionId,
                turnId,
                userMessage: semanticRetryUserMessage ?? input.userMessage,
                pageContext: input.pageContext,
                toolContracts: allowedCareerToolContracts(this.dependencies.careerToolGateway, input) as unknown as Array<Record<string, unknown>>,
                careerSessionBinding: binding,
                incidentTraceId,
                logicalTurnId: turnId,
                attemptTraceId,
                attachments: input.attachments,
                conversationHistory: conversationHistory(input),
                metadata: {
                  ...(safeMetadata(input.metadata) ?? {}),
                  requireCareerSessionBinding: requireSessionBinding
                }
              }, input.signal);
              if (!startedRun?.runId || !["started", "queued", "running"].includes(startedRun.status)) {
                throw createHermesRunFailure({
                  code: "hermes_run_start_invalid_response",
                  message: "Hermes run_start 返回了无法识别的运行句柄。",
                  failureLayer: "response",
                  hermesSessionId,
                  requestedTurnId: turnId,
                  runStartKind: "new",
                  incidentTraceId,
                  attemptTraceId,
                  retryable: false
                });
              }
              runStartedSuccessfully = true;
              recordCausal("run_start_succeeded", "HermesCareerAgentRuntime", `remote status=${startedRun.status}`, startedRun.runId);
              return startedRun;
            } catch (error) {
              throw withHermesRunFailureDiagnostics(error, {
                hermesSessionId,
                requestedTurnId: turnId,
                runStartKind: "new",
                companionConnected: runtimeAvailable,
                providerStatus: health.providerStatus,
                mcpConnected: health.mcpConnected,
                incidentTraceId,
                attemptTraceId,
                runPhase: "before_run_start"
              });
            }
          })();
      runStartedSuccessfully = attachable || runStartedSuccessfully;
      if (attachable) recordCausal("run_reattach_succeeded", "HermesCareerAgentRuntime", undefined, persisted.runId);
      let handle: HermesRunHandle = attachable
        ? persisted
        : {
            runId: started!.runId,
            hermesSessionId,
            careerAgentSessionId: input.sessionId,
            turnId,
            status: started!.status === "queued" ? "queued" : "running",
            startedAt: new Date(startedAt).toISOString(),
            lastEventAt: new Date().toISOString()
          };
      this.activeRuns.set(input.sessionId, handle);
      emitted = true;
      yield this.event(normalized, attachable ? "turn_resumed" : "progress", {
        message: attachable ? "已重新连接 Hermes 任务。" : "Hermes 长任务已启动。",
        data: {
          runHandle: handle,
          ...(runStartRequestedAt ? { runStartRequestedAt } : {}),
          ...(started ? { runStartedAt: new Date().toISOString(), runStartStatus: started.status } : {}),
          ...(typeof input.metadata?.attemptNumber === "number" ? { attemptNumber: input.metadata.attemptNumber } : {}),
          hermesSessionId,
          ...(typeof input.metadata?.recoveryReason === "string" ? { recoveryReason: input.metadata.recoveryReason } : {}),
          ...(primaryFailureCode ? { primaryFailureCode } : {}),
          recoveryAttempted: recoveryPerformed,
          transportReattachAttempted: attachable || transportReattachPerformed,
          semanticRetryAttempted: input.metadata?.semanticRetryAttempted === true,
          ...(recoveryKind ? { recoveryKind } : {}),
          primaryCausalChain: primaryCausalChain.slice(),
          ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {})
        }
      });
      let terminalSeen = false;
      let streamFailed = false;
      for (let reconnectAttempt = 0; reconnectAttempt < 3 && !terminalSeen; reconnectAttempt += 1) {
        try {
        for await (const bridgeEvent of eventsWithHeartbeat(this.dependencies.transport, handle.runId, input.signal, this.traceContext({
          incidentTraceId,
          traceId: attemptTraceId,
          logicalTurnId: turnId,
          sessionId: input.sessionId,
          turnId,
          runId: handle.runId,
          ...(eventCursor ? { eventCursor } : {})
        }), this.longRunPolicy.observerHeartbeatMs)) {
          const heartbeat = bridgeEvent.type === "progress"
            && bridgeEvent.data && typeof bridgeEvent.data === "object" && !Array.isArray(bridgeEvent.data)
            && (bridgeEvent.data as Record<string, unknown>).heartbeat === true;
          const quietForMs = Math.max(0, Date.now() - counters.lastSubstantiveEventAt);
          const watchdog = heartbeat
            ? {
                event: "run_watchdog_check",
                runId: handle.runId,
                quietForMs,
                runStatus: handle.status,
                runtimeHealthy: runtimeAvailable,
                action: "continue_waiting"
              } as const
            : undefined;
          if (heartbeat) {
            recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", `action=${watchdog?.action ?? "continue_waiting"}`, handle.runId);
          } else {
            counters.lastSubstantiveEventAt = Date.now();
          }
          handle = touchRunHandle(handle, statusForBridgeEvent(bridgeEvent, handle.status));
          if (bridgeEvent.eventId) eventCursor = bridgeEvent.eventId;
          this.activeRuns.set(input.sessionId, handle);
          counters.lastEventType = bridgeEvent.type;
        if (bridgeEvent.type === "text_delta" && counters.firstTokenLatencyMs === undefined) {
          counters.firstTokenLatencyMs = Math.max(0, Date.now() - startedAt);
        }
        if (bridgeEvent.type === "turn_completed") {
          const completionData = bridgeEvent.data && typeof bridgeEvent.data === "object" && !Array.isArray(bridgeEvent.data)
            ? bridgeEvent.data as Record<string, unknown>
            : undefined;
          if (typeof completionData?.structuredOutputValid === "boolean") {
            counters.structuredOutputValid = completionData.structuredOutputValid;
          }
        }
        if ("toolName" in bridgeEvent && typeof bridgeEvent.toolName === "string") counters.lastTool = bridgeEvent.toolName;
        if ("operationId" in bridgeEvent && typeof bridgeEvent.operationId === "string") counters.lastOperationId = bridgeEvent.operationId;
        if (bridgeEvent.type === "tool_call_started") counters.toolStartedAt = Date.now();
        if (bridgeEvent.type === "tool_call_completed" || bridgeEvent.type === "tool_call_failed") counters.toolStartedAt = undefined;
          const normalizedBridgeEvent = normalizePostStartBridgeEvent(
            this.normalizeCancellationEvent(bridgeEvent, handle),
            runStartedSuccessfully
          );
          const event = this.mapBridgeEvent(normalized, normalizedBridgeEvent, counters, startedAt);
        if (event) yield {
          ...event,
          data: mergeEventData(event.data, {
            runHandle: handle,
            incidentTraceId,
            traceId: attemptTraceId,
            ...(watchdog ? { watchdog } : {}),
            primaryCausalChain: primaryCausalChain.slice(),
            ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {}),
            ...(recoveryPerformed ? { recoveryAttempted: true } : {}),
            ...(attachable || transportReattachPerformed ? { transportReattachAttempted: true } : {}),
            ...(input.metadata?.semanticRetryAttempted === true ? { semanticRetryAttempted: true } : {}),
            ...(this.controlledStops.has(handle.runId) ? { stopReason: this.controlledStops.get(handle.runId) } : {})
          })
        };
        if (bridgeEvent.type === "approval_required") return;
        if (bridgeEvent.type === "turn_completed" || bridgeEvent.type === "turn_failed") {
          terminalSeen = true;
          if (bridgeEvent.type === "turn_completed") {
            yield this.event(normalized, "turn_completed", {
              data: {
                ...(bridgeEvent.data && typeof bridgeEvent.data === "object" ? bridgeEvent.data as Record<string, unknown> : {}),
                runHandle: handle,
                primaryCausalChain: primaryCausalChain.slice(),
                ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {}),
                telemetry: this.telemetry(normalized, counters, "completed", startedAt)
              },
              message: bridgeEvent.message
            });
          }
          break;
        }
      }
        } catch (error) {
        if (input.signal?.aborted) {
          const abortTrace = abortTraceFromSignal(input.signal, { incidentTraceId, sessionId: input.sessionId, turnId, runId: handle.runId });
          yield this.event(normalized, "turn_paused", { message: "页面连接已断开，Hermes 任务仍在运行。", data: {
            runHandle: handle,
            primaryCausalChain: primaryCausalChain.slice(),
            ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {}),
            ...(abortTrace ? { abortTrace } : {})
          } });
          return;
        }
        streamFailed = true;
        recoveryPerformed = true;
        transportReattachPerformed = true;
        counters.recoveryCount += 1;
        counters.autonomousRecoveries += 1;
        counters.lastEventType = errorCode(error);
        recordCausal("run_events_disconnected", "HermesCareerAgentRuntime", errorCode(error), handle.runId);
        }
        if (!terminalSeen && reconnectAttempt < 2) {
          try {
            const status = await this.dependencies.transport.getRun(handle.runId, input.signal, this.traceContext({ incidentTraceId, traceId: attemptTraceId, sessionId: input.sessionId, turnId, runId: handle.runId }));
            handle = touchRunHandle(handle, normalizeRunStatus(status.status));
            this.activeRuns.set(input.sessionId, handle);
            const runStatus = normalizeRunStatus(status.status);
            const watchdog = {
              event: "run_watchdog_check",
              runId: handle.runId,
              quietForMs: Math.max(0, Date.now() - counters.lastSubstantiveEventAt),
              runStatus,
              runtimeHealthy: runtimeAvailable,
              action: isTerminalRunStatus(runStatus) ? "observe_terminal" : "reattach_events"
            } as const;
            recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", `action=${watchdog.action}`, handle.runId);
            if (isTerminalRunStatus(runStatus)) {
              terminalSeen = true;
              if (runStatus === "completed") {
                yield this.event(normalized, "turn_completed", {
                  message: status.output,
                  data: {
                    runHandle: handle,
                    incidentTraceId,
                    traceId: attemptTraceId,
                    watchdog,
                    ...(recoveryPerformed ? { recoveryAttempted: true } : {}),
                    ...(transportReattachPerformed ? { transportReattachAttempted: true } : {}),
                    primaryCausalChain: primaryCausalChain.slice(),
                    telemetry: this.telemetry(normalized, counters, "completed", startedAt)
                  }
                });
              } else {
                const transientFailure = runStatus === "failed" && isTransientUpstreamFailure(status.error);
                const failureCode = runStatus === "cancelled" ? this.cancellationCode(handle.runId) : "hermes_run_failed";
                yield this.event(normalized, "turn_failed", {
                  error: {
                    code: failureCode,
                    message: status.error ?? "Hermes run failed.",
                    recoverable: runStatus === "cancelled" || transientFailure
                  },
                  data: {
                    ...this.diagnostics(handle, counters, failureCode === "hermes_run_cancelled" ? "hermes_run_cancelled" : failureCode, primaryCausalChain, secondaryRecoveryFailures),
                    incidentTraceId,
                    traceId: attemptTraceId,
                    watchdog,
                    ...(recoveryPerformed ? { recoveryAttempted: true } : {}),
                    ...(transportReattachPerformed ? { transportReattachAttempted: true } : {}),
                    diagnostics: {
                      retryable: runStatus === "cancelled" || transientFailure,
                      ...(runStatus === "cancelled" ? {} : { upstreamErrorCode: status.error }),
                      runPhase: "after_run_start"
                    }
                  }
                });
              }
              break;
            }
            transportReattachPerformed = true;
            recoveryPerformed = true;
            yield this.event(normalized, "progress", {
              message: "Hermes 事件连接已恢复，任务没有重复提交。",
              data: {
                runHandle: handle,
                recovery: "event_stream_reattach",
                reconnectAttempt: reconnectAttempt + 1,
                watchdog,
                recoveryAttempted: recoveryPerformed,
                transportReattachAttempted: true,
                ...(eventCursor ? { eventCursor } : {}),
                primaryCausalChain: primaryCausalChain.slice()
              }
            });
          } catch (statusError) {
            recordSecondaryFailure(statusError, "run_status_reattach", handle.runId);
            recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", "status check failed; continue observing without stopping", handle.runId);
            if (isMissingRemoteRunError(statusError)) {
              terminalSeen = true;
              const primaryCode = primaryFailureCode ?? "hermes_run_events_failed";
              yield this.event(normalized, "turn_failed", {
                error: {
                  code: primaryCode,
                  message: "Hermes 旧 run 已无法读取；原始失败保留为主因，当前读取失败已记录为次生恢复失败。",
                  recoverable: true
                },
                data: {
                  ...this.diagnostics(handle, counters, primaryCode, primaryCausalChain, secondaryRecoveryFailures),
                  incidentTraceId,
                  traceId: attemptTraceId,
                  recoveryAttempted: true,
                  transportReattachAttempted: true
                }
              });
              break;
            }
            yield this.event(normalized, "progress", {
              message: "Hermes 状态检查暂时失败，任务仍保留并继续等待。",
              data: {
                runHandle: handle,
                recovery: "status_check_retry",
                recoveryAttempted: recoveryPerformed,
                watchdog: {
                  event: "run_watchdog_check",
                  runId: handle.runId,
                  quietForMs: Math.max(0, Date.now() - counters.lastSubstantiveEventAt),
                  runStatus: handle.status,
                  runtimeHealthy: runtimeAvailable,
                  action: "continue_waiting"
                },
                primaryCausalChain: primaryCausalChain.slice(),
                secondaryRecoveryFailures: secondaryRecoveryFailures.slice()
              }
            });
          }
        }
      }
      if (!terminalSeen) {
        for (;;) {
          if (input.signal?.aborted) {
            const abortTrace = abortTraceFromSignal(input.signal, { incidentTraceId, sessionId: input.sessionId, turnId, runId: handle.runId });
            yield this.event(normalized, "turn_paused", { message: "页面连接已断开，Hermes 任务仍在运行。", data: {
              runHandle: handle,
              primaryCausalChain: primaryCausalChain.slice(),
              ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {}),
              ...(abortTrace ? { abortTrace } : {})
            } });
            return;
          }
          if (Date.now() - startedAt >= this.longRunPolicy.hardDeadlineMs) {
            counters.lastEventType = counters.lastEventType ?? "hermes_overall_budget_checkpoint";
            recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", "hard deadline reached; preserve the live run", handle.runId);
            yield this.event(normalized, "turn_paused", {
              message: "Hermes 仍在处理较长内容；前台等待已达到安全检查点，任务未被停止，可稍后重新连接。",
              data: {
                ...this.diagnostics(handle, counters, "hermes_overall_budget_checkpoint", primaryCausalChain, secondaryRecoveryFailures),
                incidentTraceId,
                attemptTraceId,
                traceId: attemptTraceId,
                recoveryAttempted: recoveryPerformed,
                watchdog: {
                  event: "run_watchdog_check",
                  runId: handle.runId,
                  quietForMs: Math.max(0, Date.now() - counters.lastSubstantiveEventAt),
                  runStatus: handle.status,
                  runtimeHealthy: runtimeAvailable,
                  action: "continue_waiting"
                }
              }
            });
            return;
          }
          let status;
          try {
            status = await this.dependencies.transport.getRun(handle.runId, input.signal, this.traceContext({ incidentTraceId, traceId: attemptTraceId, sessionId: input.sessionId, turnId, runId: handle.runId }));
          } catch (statusError) {
            recordSecondaryFailure(statusError, "run_status_poll", handle.runId);
            recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", "status check failed; no stop requested", handle.runId);
            if (isMissingRemoteRunError(statusError)) {
              terminalSeen = true;
              const primaryCode = primaryFailureCode ?? "hermes_run_events_failed";
              yield this.event(normalized, "turn_failed", {
                error: {
                  code: primaryCode,
                  message: "Hermes run 状态不可读取；原始失败保留为主因，状态读取失败已记录为次生恢复失败。",
                  recoverable: true
                },
                data: {
                  ...this.diagnostics(handle, counters, primaryCode, primaryCausalChain, secondaryRecoveryFailures),
                  incidentTraceId,
                  attemptTraceId,
                  recoveryAttempted: true,
                  transportReattachAttempted: true
                }
              });
              break;
            }
            await delay(this.longRunPolicy.statusPollMs, input.signal);
            continue;
          }
          handle = touchRunHandle(handle, normalizeRunStatus(status.status));
          this.activeRuns.set(input.sessionId, handle);
          counters.lastEventType = status.last_event ?? counters.lastEventType;
          const watchdog = {
            event: "run_watchdog_check",
            runId: handle.runId,
            quietForMs: Math.max(0, Date.now() - counters.lastSubstantiveEventAt),
            runStatus: handle.status,
            runtimeHealthy: runtimeAvailable,
            action: isTerminalRunStatus(handle.status) ? "observe_terminal" : "continue_waiting"
          } as const;
          recordCausal("run_watchdog_check", "HermesCareerAgentRuntime", `action=${watchdog.action}`, handle.runId);
          if (status.status === "completed") {
            terminalSeen = true;
            yield this.event(normalized, "turn_completed", {
              message: status.output,
              data: {
                runHandle: handle,
                incidentTraceId,
                traceId: attemptTraceId,
                recovery: streamFailed ? "status_poll" : undefined,
                watchdog,
                primaryCausalChain: primaryCausalChain.slice(),
                ...(secondaryRecoveryFailures.length ? { secondaryRecoveryFailures: secondaryRecoveryFailures.slice() } : {}),
                telemetry: this.telemetry(normalized, counters, "completed", startedAt)
              }
            });
            break;
          }
          if (status.status === "failed" || status.status === "cancelled") {
            terminalSeen = true;
            const transientFailure = status.status === "failed" && isTransientUpstreamFailure(status.error);
            const failureCode = status.status === "cancelled" ? this.cancellationCode(handle.runId) : "hermes_run_failed";
            yield this.event(normalized, "turn_failed", {
              error: { code: failureCode, message: status.error ?? "Hermes run failed.", recoverable: status.status === "cancelled" || transientFailure },
              data: {
                ...this.diagnostics(handle, counters, failureCode === "hermes_run_cancelled" ? "hermes_run_cancelled" : failureCode, primaryCausalChain, secondaryRecoveryFailures),
                incidentTraceId,
                attemptTraceId,
                traceId: attemptTraceId,
                watchdog,
                diagnostics: {
                  retryable: status.status === "cancelled" || transientFailure,
                  ...(status.status === "cancelled" ? {} : { upstreamErrorCode: status.error }),
                  runPhase: "after_run_start"
                }
              }
            });
            break;
          }
          if (status.status === "waiting_for_approval") {
            yield this.event(normalized, "approval_required", { message: "Hermes 任务正在等待确认。", data: { runHandle: handle } });
            break;
          }
          await delay(this.longRunPolicy.statusPollMs, input.signal);
        }
      }
      if (!terminalSeen) {
        const error = hermesError("hermes_stream_incomplete", "Hermes stream 在完成事件前结束，当前任务没有被重复提交。");
        if (!emitted) throw error;
        yield this.event(normalized, "turn_failed", {
          error: { code: error.code, message: error.message, recoverable: true },
          data: { ...this.diagnostics(handle, counters, error.code, primaryCausalChain, secondaryRecoveryFailures), incidentTraceId, attemptTraceId, traceId: attemptTraceId }
        });
      }
    } catch (error) {
      // Before the first RuntimeEvent, the router may perform one bounded
      // Hermes recovery retry. Once a turn has emitted anything, the failure
      // is terminal for this runtime and must not be replayed as Native.
      if (!emitted) throw error;
      const safeErrorCode = runStartedSuccessfully
        ? postStartHermesErrorCode(errorCode(error))
        : errorCode(error);
      if (runStartedSuccessfully && safeErrorCode !== errorCode(error)) {
        recordCausal("run_failed_after_start", "HermesCareerAgentRuntime", `${errorCode(error)} -> ${safeErrorCode}`, this.activeRuns.get(input.sessionId)?.runId);
      }
      yield this.event(normalized, "turn_failed", {
        error: {
          code: safeErrorCode,
          message: error instanceof Error ? error.message : "Hermes turn failed.",
          recoverable: isRetryableHermesRunFailure(error)
        },
        data: {
          ...this.diagnostics(this.activeRuns.get(input.sessionId), counters, safeErrorCode, primaryCausalChain, secondaryRecoveryFailures),
          incidentTraceId,
          attemptTraceId,
          traceId: attemptTraceId,
          ...(recoveryPerformed ? { recoveryAttempted: true } : {}),
          ...(transportReattachPerformed ? { transportReattachAttempted: true } : {}),
          ...(input.metadata?.semanticRetryAttempted === true ? { semanticRetryAttempted: true } : {}),
          telemetry: this.telemetry(normalized, counters, "failed", startedAt)
        }
      });
    }
  }

  private async *runLegacyAdapterTurn(
    input: AgentRuntimeTurnInput,
    counters: TurnCounters,
    startedAt: number
  ): AsyncGenerator<AgentRuntimeEvent> {
    input = { ...input, metadata: { ...(input.metadata ?? {}), hermesProtocol: "legacy" } };
    const binding = resolveCareerSessionBinding({ sessionId: input.sessionId, session: input.session, pageContext: input.pageContext });
    const requireSessionBinding = input.metadata?.requireCareerSessionBinding === true || Boolean(input.session);
    const health = await this.dependencies.transport.health(input.signal);
    if (!(health.runtimeHealth?.runtimeAvailable ?? health.available)) {
      throw hermesError("hermes_unavailable_before_turn", health.reason ?? "Hermes runtime is unavailable.");
    }
    if (health.runtimeHealth && !isRoadshowReady(health.runtimeHealth)) {
      throw hermesError("hermes_career_registry_not_ready", "CareerAdapt MCP 尚未完成 Hermes 注册。");
    }
    const existing = this.sessions.get(input.sessionId);
    const opened = existing
      ? await this.dependencies.transport.resumeSession({ sessionId: existing }, input.signal)
      : await this.dependencies.transport.createSession({ sessionId: input.sessionId }, input.signal);
    this.sessions.set(input.sessionId, opened.sessionId);
    let emitted = false;
    for await (const bridgeEvent of this.dependencies.transport.turn({
      sessionId: opened.sessionId,
      turnId: input.turnId ?? `hermes-turn-${nanoid(12)}`,
      userMessage: input.userMessage,
      pageContext: input.pageContext,
      toolContracts: allowedCareerToolContracts(this.dependencies.careerToolGateway, input, false) as unknown as Array<Record<string, unknown>>,
      careerSessionBinding: binding,
      incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
      logicalTurnId: input.turnId,
      metadata: safeMetadata(input.metadata)
    }, input.signal)) {
      emitted = true;
      if (bridgeEvent.type === "tool_call_requested") {
        yield this.event(input, "tool_call_requested", {
          toolName: bridgeEvent.toolName,
          operationId: bridgeEvent.operationId,
          data: { toolCallId: bridgeEvent.toolCallId, logicalToolOperationId: this.bridgeLogicalOperationId(input, bridgeEvent), input: bridgeEvent.input }
        });
        yield* this.executeToolCall(input, opened.sessionId, bridgeEvent, counters, binding, requireSessionBinding);
        continue;
      }
      if (bridgeEvent.type === "turn_completed") {
        const completion = bridgeEvent.data && typeof bridgeEvent.data === "object" && !Array.isArray(bridgeEvent.data)
          ? bridgeEvent.data as Record<string, unknown>
          : {};
        if (typeof completion.structuredOutputValid === "boolean") counters.structuredOutputValid = completion.structuredOutputValid;
        yield this.event(input, "turn_completed", {
          message: bridgeEvent.message,
          data: { ...completion, telemetry: this.telemetry(input, counters, "completed", startedAt) }
        });
        continue;
      }
      if (bridgeEvent.type === "text_delta" && counters.firstTokenLatencyMs === undefined) {
        counters.firstTokenLatencyMs = Math.max(0, Date.now() - startedAt);
      }
      const event = this.mapBridgeEvent(input, bridgeEvent, counters, startedAt);
      if (event) yield event;
    }
    if (!emitted) throw hermesError("hermes_stream_incomplete", "Hermes adapter stream ended before the first event.");
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

  private async *executeToolCall(
    input: AgentRuntimeTurnInput,
    hermesSessionId: string,
    request: Extract<HermesBridgeEvent, { type: "tool_call_requested" }>,
    counters: TurnCounters,
    binding: CareerSessionBinding | undefined,
    requireSessionBinding: boolean
  ): AsyncGenerator<AgentRuntimeEvent> {
    counters.toolCalls += 1;
    const catalog = new HermesCareerToolCatalog(this.dependencies.careerToolGateway.listContracts());
    const requestedHermesToolName = request.toolName;
    const stableToolName = catalog.stableNameForRequestedName(requestedHermesToolName) ?? requestedHermesToolName;
    const logicalOperationId = request.logicalToolOperationId ?? logicalToolOperationId({
      ...request,
      turnId: input.turnId,
      stableToolName
    });
    if (!isAllowedCareerTool(input, stableToolName, catalog)) {
      const code = "agent_tool_not_allowed";
      counters.toolFailures += 1;
      // Return a structured observation to the bridge so Hermes can refresh
      // the legal tool set and replan. Emitting only a UI failure leaves the
      // external run waiting for a callback and turns a repairable mismatch
      // into a stuck runtime.
      await this.dependencies.transport.toolCallback({
        sessionId: hermesSessionId,
        turnId: input.turnId ?? "hermes-turn-unknown",
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        operationId: request.operationId,
        incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
        attemptTraceId: typeof input.metadata?.attemptTraceId === "string" ? input.metadata.attemptTraceId : undefined,
        logicalToolOperationId: logicalOperationId,
        careerSessionBinding: binding,
        result: {
          ok: false,
          error: {
            code,
            category: "validation",
            recoverable: true,
            retryHint: "刷新当前工作流阶段允许的工具后重新规划；不要重复或并行提交写入。"
          }
        }
      }, input.signal);
      yield this.event(input, "tool_call_failed", {
        toolName: request.toolName,
        operationId: request.operationId,
        error: { code, message: "当前组合工作流步骤不允许该 Career 工具。", recoverable: true },
        data: { safeErrorCode: code, logicalToolOperationId: logicalOperationId, workflowId: input.metadata?.workflowId, workflowStage: input.metadata?.workflowStage, requestedHermesToolName, stableCareerToolName: stableToolName }
      });
      return;
    }
    let contract: CareerToolContract;
    try {
      contract = this.dependencies.careerToolGateway.getContract(stableToolName);
    } catch (error) {
      counters.toolFailures += 1;
      const code = errorCode(error) === "hermes_turn_failed" ? "mcp_tool_not_found" : errorCode(error);
      await this.dependencies.transport.toolCallback({
        sessionId: hermesSessionId,
        turnId: input.turnId ?? "hermes-turn-unknown",
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        operationId: request.operationId,
        incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
        attemptTraceId: typeof input.metadata?.attemptTraceId === "string" ? input.metadata.attemptTraceId : undefined,
        logicalToolOperationId: logicalOperationId,
        careerSessionBinding: binding,
        result: {
          ok: false,
          error: {
            code,
            category: "not_found",
            recoverable: true,
            retryHint: "刷新 CareerAdapt MCP 工具发现后重新规划，不要重复已完成写入。"
          }
        }
      }, input.signal);
      yield this.event(input, "tool_call_failed", {
        toolName: request.toolName,
        operationId: request.operationId,
        error: { code, message: "CareerAdapt MCP 工具未找到，正在刷新工具发现。", recoverable: true },
        data: { toolCallId: request.toolCallId, logicalToolOperationId: logicalOperationId, discoveryRefreshRequired: true, requestedHermesToolName, stableCareerToolName: stableToolName }
      });
      return;
    }
    const confirmed = input.metadata?.confirmed === true;
    const confirmationCount = typeof input.metadata?.confirmationCount === "number" ? input.metadata.confirmationCount : undefined;
    if (requiresConfirmation(contract) && !confirmed && (confirmationCount ?? 0) < 1) {
      counters.toolFailures += 1;
      const approval = this.event(input, "approval_required", {
        toolName: request.toolName,
        operationId: request.operationId,
        message: "这项 Career 操作需要用户确认后才能继续。",
        data: { toolCallId: request.toolCallId, logicalToolOperationId: logicalOperationId, input: request.input, contract }
      });
      yield approval;
      await this.dependencies.transport.toolCallback({
        sessionId: hermesSessionId,
        turnId: input.turnId ?? "hermes-turn-unknown",
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        operationId: request.operationId,
        incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
        attemptTraceId: typeof input.metadata?.attemptTraceId === "string" ? input.metadata.attemptTraceId : undefined,
        logicalToolOperationId: logicalOperationId,
        careerSessionBinding: binding,
        result: { ok: false, error: { code: "approval_required", recoverable: false } }
      }, input.signal);
      return;
    }

    yield this.event(input, "tool_call_started", {
      toolName: request.toolName,
      operationId: request.operationId,
      data: { toolCallId: request.toolCallId, logicalToolOperationId: logicalOperationId, requestedHermesToolName, stableCareerToolName: stableToolName }
    });
    let result = await this.executeGatewayTool(stableToolName, request.input, {
      operationId: request.operationId,
      logicalToolOperationId: logicalOperationId,
      incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
      signal: input.signal,
      confirmed,
      confirmationCount,
      careerSessionBinding: binding,
      requireSessionBinding
    }, counters);
    if (!result.ok && shouldRetryRead(contract, result)) {
      counters.autonomousRecoveries += 1;
      result = await this.executeGatewayTool(stableToolName, request.input, {
        operationId: request.operationId,
        logicalToolOperationId: logicalOperationId,
        incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
        signal: input.signal,
        confirmed,
        confirmationCount,
        careerSessionBinding: binding,
        requireSessionBinding
      }, counters);
    }
    if (!result.ok && result.error?.category === "stale_revision") {
      counters.autonomousRecoveries += 1;
      const reread = await rereadStaleDependencies(
        this.dependencies.careerToolGateway,
        request.input,
        binding,
        requireSessionBinding,
        input.signal
      );
      result = {
        ...result,
        error: {
          ...result.error,
          recoverable: true,
          retryHint: reread > 0
            ? "已重新读取最新依赖；请基于最新 revision 重新生成合法请求。不会自动重复这次写入。"
            : "请重新读取最新 revision 后再生成请求；不会自动重复这次写入。"
        }
      };
    }
    if (!result.ok && result.error?.category === "not_found") {
      counters.autonomousRecoveries += 1;
      const discoveredToolCount = this.dependencies.careerToolGateway.listContracts().length;
      result = {
        ...result,
        error: {
          ...result.error,
          recoverable: true,
          retryHint: `已刷新 Career 工具发现（${discoveredToolCount} 个工具）；请重新规划，不会重复已完成写入。`
        }
      };
    }
    if (!result.ok && result.error?.category === "validation") {
      result = {
        ...result,
        error: {
          ...result.error,
          retryHint: "当前输入未通过校验；已保留任务状态，请修正当前参数后重试。不会自动提交写入。"
        }
      };
    }
    await this.dependencies.transport.toolCallback({
      sessionId: hermesSessionId,
      turnId: input.turnId ?? "hermes-turn-unknown",
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      operationId: request.operationId,
      incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
      attemptTraceId: typeof input.metadata?.attemptTraceId === "string" ? input.metadata.attemptTraceId : undefined,
      logicalToolOperationId: logicalOperationId,
      careerSessionBinding: binding,
      result: safeToolResult(result)
    }, input.signal);
    if (result.ok) {
      yield this.event(input, "tool_call_completed", {
        toolName: request.toolName,
        operationId: request.operationId,
        data: {
          toolCallId: request.toolCallId,
          logicalToolOperationId,
          result: safeToolResult(result),
          artifacts: result.artifacts,
          requestedHermesToolName,
          stableCareerToolName: stableToolName
        }
      });
      return;
    }
    counters.toolFailures += 1;
    yield this.event(input, "tool_call_failed", {
      toolName: request.toolName,
      operationId: request.operationId,
      error: {
        code: result.error?.code ?? "career_tool_failed",
        message: result.error?.message ?? "Career tool failed.",
        recoverable: result.error?.recoverable ?? false
      },
      data: { toolCallId: request.toolCallId, logicalToolOperationId, result: safeToolResult(result), safeErrorCode: result.error?.code, requestedHermesToolName, stableCareerToolName: stableToolName }
    });
  }

  private mapBridgeEvent(input: AgentRuntimeTurnInput, event: HermesBridgeEvent, counters: TurnCounters, startedAt: number) {
    if (event.type === "progress") return this.event(input, "progress", { message: event.message, data: event.data });
    if (event.type === "reasoning_status") return this.event(input, "reasoning_status", { message: event.message, data: event.data });
    if (event.type === "text_delta") return this.event(input, "text_delta", { delta: event.delta });
    if (event.type === "tool_call_started") {
      counters.toolCalls += 1;
      return this.event(input, "tool_call_started", {
        toolName: event.toolName,
        operationId: event.operationId,
        data: {
          toolCallId: event.toolCallId,
          logicalToolOperationId: this.bridgeLogicalOperationId(input, event),
          ...this.toolDiagnostics(event.toolName),
          ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {})
        }
      });
    }
    if (event.type === "tool_call_completed") return this.event(input, "tool_call_completed", {
      toolName: event.toolName,
      operationId: event.operationId,
      data: {
        toolCallId: event.toolCallId,
        logicalToolOperationId: this.bridgeLogicalOperationId(input, event),
        ...this.toolDiagnostics(event.toolName),
        ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {})
      }
    });
    if (event.type === "tool_call_failed") {
      counters.toolFailures += 1;
      return this.event(input, "tool_call_failed", {
        toolName: event.toolName,
        operationId: event.operationId,
        error: { code: event.code, message: event.message, recoverable: event.recoverable },
        data: { logicalToolOperationId: this.bridgeLogicalOperationId(input, event), ...this.toolDiagnostics(event.toolName), ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) }
      });
    }
    if (event.type === "approval_required") return this.event(input, "approval_required", {
      toolName: event.toolName,
      operationId: event.operationId,
      message: event.message,
      data: { ...this.toolDiagnostics(event.toolName), ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) }
    });
    if (event.type === "artifact_updated") {
      counters.artifactUpdates += 1;
      return this.event(input, "artifact_updated", { data: event.data, ...(event.artifactId ? { operationId: event.artifactId } : {}) });
    }
    if (event.type === "turn_failed") return this.event(input, "turn_failed", {
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
      stableToolName
    });
  }

  private toolDiagnostics(requestedHermesToolName?: string) {
    if (!requestedHermesToolName) return {};
    const stableCareerToolName = new HermesCareerToolCatalog(this.dependencies.careerToolGateway.listContracts())
      .stableNameForRequestedName(requestedHermesToolName);
    return {
      requestedHermesToolName,
      ...(stableCareerToolName ? { stableCareerToolName } : {})
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

function isMissingRemoteRunError(error: unknown) {
  const candidate = error && typeof error === "object" && !Array.isArray(error)
    ? error as { code?: unknown; httpStatus?: unknown; diagnostics?: { httpStatus?: unknown } }
    : {};
  const status = candidate.httpStatus ?? candidate.diagnostics?.httpStatus;
  return status === 404
    || (candidate.code === "hermes_run_status_failed" && status === undefined);
}

function postStartHermesErrorCode(code: string) {
  if (code === "hermes_unavailable_before_turn" || code === "mcp_unavailable_before_turn" || code.startsWith("hermes_run_start_")) {
    return "hermes_run_failed_after_start";
  }
  return code;
}

function isTransientUpstreamFailure(message?: string) {
  return typeof message === "string"
    && /(?:timeout|timed out|temporar|unavailable|overload|rate limit|reset|502|503|504|429)/iu.test(message);
}

function normalizePostStartBridgeEvent(event: HermesBridgeEvent, runStarted: boolean): HermesBridgeEvent {
  if (!runStarted || event.type !== "turn_failed") return event;
  const code = postStartHermesErrorCode(event.code);
  return code === event.code ? event : { ...event, code };
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

async function* eventsWithHeartbeat(
  transport: HermesBridgeTransport & Required<Pick<HermesBridgeTransport, "runEvents">>,
  runId: string,
  signal?: AbortSignal,
  trace?: HermesRunTraceContext,
  heartbeatMs = DEFAULT_HERMES_LONG_RUN_POLICY.observerHeartbeatMs
): AsyncGenerator<HermesBridgeEvent> {
  const heartbeatController = new AbortController();
  const combinedSignal = signal
    ? AbortSignal.any([signal, heartbeatController.signal])
    : heartbeatController.signal;
  const iterator = transport.runEvents(runId, combinedSignal, trace)[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            heartbeatController.abort();
            reject(hermesError("hermes_event_heartbeat_timeout", "Hermes event stream heartbeat timed out; the run remains active."));
        }, heartbeatMs);
      });
      const item = await Promise.race([iterator.next(), heartbeat]);
      if (timer) clearTimeout(timer);
      if (item.done) return;
      yield item.value;
    }
  } finally {
    heartbeatController.abort();
    await iterator.return?.().catch(() => undefined);
  }
}

function supportsRuns(transport: HermesBridgeTransport): transport is HermesBridgeTransport & Required<Pick<
  HermesBridgeTransport,
  "startRun" | "getRun" | "runEvents" | "approveRun" | "stopRun"
>> {
  return typeof transport.startRun === "function"
    && typeof transport.getRun === "function"
    && typeof transport.runEvents === "function"
    && typeof transport.approveRun === "function"
    && typeof transport.stopRun === "function";
}

function requiresConfirmation(contract: CareerToolContract) {
  return contract.confirmationPolicy !== "none";
}

function safeToolResult(result: Awaited<ReturnType<CareerToolGateway["execute"]>>) {
  if (result.ok) {
    return { ok: true, data: result.data, artifacts: result.artifacts, receipt: result.receipt };
  }
  return {
    ok: false,
    ...(result.data === undefined ? {} : { data: result.data }),
    error: result.error
      ? { code: result.error.code, category: result.error.category, message: result.error.message, recoverable: result.error.recoverable, retryHint: result.error.retryHint }
      : { code: "career_tool_failed", message: "工具执行没有完成。", recoverable: false },
    receipt: result.receipt
  };
}

function safeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (["model", "hermesSessionId", "reattachRunId", "requireCareerSessionBinding", "fallbackUsed", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackReasonCode", "runtimeFailureAt", "runtimeRecoveryAttempted", "runtimeRecoveryKind", "transportReattachAttempted", "semanticRetryAttempted", "semanticRetryUserMessage", "attemptNumber", "primaryFailureCode", "workflowId", "workflowStage", "rootGoal", "confirmed", "confirmationCount", "runtimeId", "executionOwner", "nextHermesRunId", "incidentTraceId", "logicalTurnId", "attemptTraceId", "recoveryReason"].includes(key)
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

function allowedCareerToolContracts(gateway: CareerToolGateway, input: AgentRuntimeTurnInput, production = true) {
  if (!production) {
    return projectCareerContractsForHermes(gateway.listContracts());
  }
  const workflowId = typeof input.metadata?.workflowId === "string" ? input.metadata.workflowId : undefined;
  const workflowStage = typeof input.metadata?.workflowStage === "string" ? input.metadata.workflowStage : undefined;
  const composeFacadeFirst = workflowId === "compose_resume" && workflowStage === "select_profile_scope";
  const allowedSourceTools = new Set(
    Array.isArray(input.metadata?.allowedToolNames)
      ? input.metadata.allowedToolNames.filter((name): name is string => typeof name === "string")
      : gateway.listContracts().map((contract) => contract.sourceToolName)
  );
  const workflowFacades = workflowFacadeNames(input);
  const allowedCareerTools = new Set(
    Array.isArray(input.metadata?.allowedCareerToolNames)
      ? input.metadata.allowedCareerToolNames.filter((name): name is string => typeof name === "string")
      : []
  );
  const productionProfile = hermesProductionToolNames();
  const contracts = gateway.listContracts().filter((contract) => composeFacadeFirst
    ? contract.name === "career.workflow.compose_resume"
    : productionProfile.has(contract.name)
      && (
        allowedSourceTools.has(contract.sourceToolName)
        || allowedCareerTools.has(contract.name)
        || workflowFacades.includes(contract.name)
        || isCareerSystemStatusQuestion(input.userMessage) && contract.name.startsWith("career.system.")
        || contract.name.startsWith("career.workflow.")
      )
  );
  return projectCareerContractsForHermes(contracts, productionProfile);
}

function isAllowedCareerTool(input: AgentRuntimeTurnInput, toolName: string, catalog: HermesCareerToolCatalog) {
  if (input.metadata?.hermesProtocol === "legacy") return Boolean(catalog.entryForStableName(toolName));
  const allowed = input.metadata?.allowedCareerToolNames;
  if (Array.isArray(allowed)) return allowed.includes(toolName)
    || workflowFacadeNames(input).includes(toolName)
    || isCareerSystemStatusQuestion(input.userMessage) && toolName.startsWith("career.system.");
  return hermesProductionToolNames().has(toolName) && Boolean(catalog.entryForStableName(toolName));
}

function workflowFacadeNames(input: AgentRuntimeTurnInput) {
  const workflowId = typeof input.metadata?.workflowId === "string" ? input.metadata.workflowId : undefined;
  const stage = typeof input.metadata?.workflowStage === "string" ? input.metadata.workflowStage : undefined;
  if (workflowId === "guided_profile_intake" || workflowId === "profile_intake") {
    return [
      ...(stage === "final_review" || stage === "reconcile_profile" || stage === "resolve_conflicts"
        ? ["career.workflow.profile_intake_finalize"]
        : ["career.workflow.profile_intake_turn"])
    ];
  }
  if (workflowId === "resume_import" || workflowId === "import_resume") return ["career.workflow.resume_import"];
  if (workflowId === "analyze_job_fit") return ["career.workflow.job_fit"];
  if (workflowId === "tailor_existing_resume" || workflowId === "create_tailored_resume") {
    return stage === "analyze_fit"
      ? ["career.workflow.job_fit", "career.workflow.tailor_resume"]
      : ["career.workflow.tailor_resume"];
  }
  if (workflowId === "repair_and_export_resume" || workflowId === "export_resume") return ["career.workflow.resume_export"];
  if (workflowId === "compose_resume" || workflowId === "create_resume_from_profile") {
    return ["career.workflow.compose_resume", "career.workflow.profile_to_resume"];
  }
  return [];
}

async function rereadStaleDependencies(
  gateway: CareerToolGateway,
  input: Record<string, unknown>,
  binding: CareerSessionBinding | undefined,
  requireSessionBinding: boolean,
  signal?: AbortSignal
) {
  const reads: Array<[string, Record<string, unknown>]> = [];
  const profileId = stringValue(input.targetProfileId) ?? stringValue(input.profileId);
  const resumeId = stringValue(input.resumeId);
  const jobId = stringValue(input.jobId);
  if (profileId && hasContract(gateway, "career.profile.get")) reads.push(["career.profile.get", { profileId }]);
  if (resumeId && hasContract(gateway, "career.resume.get")) reads.push(["career.resume.get", { resumeId }]);
  if (jobId && hasContract(gateway, "career.job.get")) reads.push(["career.job.get", { jobId }]);
  const results = await Promise.all(reads.map(([name, value], index) => gateway.execute(name, value, {
    operationId: `mcp-reread-${index}-${Date.now()}`,
    signal,
    careerSessionBinding: binding,
    requireSessionBinding
  })));
  return results.filter((result) => result.ok).length;
}

function shouldRetryRead(contract: CareerToolContract, result: Awaited<ReturnType<CareerToolGateway["execute"]>>) {
  return contract.readWrite === "read"
    && result.error?.recoverable === true
    && result.error.category !== "validation"
    && result.error.category !== "permission";
}

function hasContract(gateway: CareerToolGateway, name: string) {
  return gateway.listContracts().some((contract) => contract.name === name);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "hermes_turn_failed";
}

function hermesError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}
