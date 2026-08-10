import { nanoid } from "nanoid";
import type {
  AgentRuntime,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeTurnInput
} from "../agentRuntime";
import type { HermesRunHandle } from "../../contracts/agentSession";
import type { CareerToolGateway, CareerToolContract } from "../../tools/CareerToolGateway";
import type { HermesBridgeEvent, HermesBridgeTransport } from "./HermesBridgeTransport";
import { resolveCareerSessionBinding, type CareerSessionBinding } from "../careerSessionBinding";

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

/**
 * Server/local Hermes adapter.  It owns protocol translation and tool
 * callbacks, but deliberately contains no WorkspaceRepository or browser
 * persistence access.
 */
export class HermesCareerAgentRuntime implements AgentRuntime {
  readonly id = "hermes" as const;
  private readonly sessions = new Map<string, string>();
  private readonly activeRuns = new Map<string, HermesRunHandle>();

  constructor(private readonly dependencies: {
    transport: HermesBridgeTransport;
    careerToolGateway: CareerToolGateway;
    capabilities?: Partial<AgentRuntimeCapabilities>;
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

  async recoverBeforeFallback(input: AgentRuntimeTurnInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1_500);
    try {
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
      const health = await this.dependencies.transport.health(signal);
      if (!(health.runtimeHealth?.runtimeAvailable ?? health.available)) {
        throw hermesError("hermes_recovery_unavailable", health.reason ?? "Hermes recovery health check failed.");
      }
      const existingSession = this.sessions.get(input.sessionId);
      if (existingSession && this.dependencies.transport.resumeSession) {
        await this.dependencies.transport.resumeSession({ sessionId: existingSession }, signal);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async pause(sessionId: string) {
    const handle = this.activeRuns.get(sessionId);
    if (handle) await this.dependencies.transport.stopRun?.(handle.runId);
  }

  async interrupt(sessionId: string) {
    const handle = this.activeRuns.get(sessionId);
    if (handle) await this.dependencies.transport.stopRun?.(handle.runId);
  }

  async resume() {
    // Resume is represented by the next runTurn's session resume handshake.
  }

  async approve(sessionId: string, approved: boolean) {
    const handle = this.activeRuns.get(sessionId);
    if (!handle || !this.dependencies.transport.approveRun) {
      throw hermesError("hermes_run_approval_unavailable", "当前没有可确认的 Hermes run。");
    }
    const status = await this.dependencies.transport.approveRun(handle.runId, approved ? "once" : "deny");
    const next = touchRunHandle(handle, normalizeRunStatus(status.status));
    this.activeRuns.set(sessionId, next);
    return next;
  }

  async *runTurn(input: AgentRuntimeTurnInput): AsyncIterable<AgentRuntimeEvent> {
    const turnId = input.turnId ?? `hermes-turn-${nanoid(12)}`;
    const normalized = { ...input, turnId };
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
      if (health.mcpConnected === false) {
        throw hermesError("mcp_unavailable_before_turn", "CareerAdapt MCP is not connected to the active browser workspace.");
      }
      const persisted = input.session?.hermesRun;
      const attachable = persisted
        && persisted.careerAgentSessionId === input.sessionId
        && ["queued", "running", "waiting_for_approval", "stopping"].includes(persisted.status);
      const hermesSessionId = attachable
        ? persisted.hermesSessionId
        : typeof input.metadata?.hermesSessionId === "string"
          ? input.metadata.hermesSessionId
          : this.sessions.get(input.sessionId) ?? `hermes-${input.sessionId}`;
      this.sessions.set(input.sessionId, hermesSessionId);
      const started = attachable
        ? undefined
        : await this.dependencies.transport.startRun({
            sessionId: hermesSessionId,
            turnId,
            userMessage: input.userMessage,
            pageContext: input.pageContext,
            toolContracts: allowedCareerToolContracts(this.dependencies.careerToolGateway, input) as unknown as Array<Record<string, unknown>>,
            careerSessionBinding: binding,
            attachments: input.attachments,
            conversationHistory: conversationHistory(input),
            metadata: {
              ...(safeMetadata(input.metadata) ?? {}),
              requireCareerSessionBinding: requireSessionBinding
            }
          }, input.signal);
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
        data: { runHandle: handle }
      });
      let terminalSeen = false;
      let streamFailed = false;
      for (let reconnectAttempt = 0; reconnectAttempt < 3 && !terminalSeen; reconnectAttempt += 1) {
        try {
        for await (const bridgeEvent of eventsWithHeartbeat(this.dependencies.transport, handle.runId, input.signal)) {
          const heartbeat = bridgeEvent.type === "progress"
            && bridgeEvent.data && typeof bridgeEvent.data === "object" && !Array.isArray(bridgeEvent.data)
            && (bridgeEvent.data as Record<string, unknown>).heartbeat === true;
          if (heartbeat) {
            if (counters.toolStartedAt && Date.now() - counters.toolStartedAt >= 90_000) {
              throw hermesError("hermes_tool_inactivity_timeout", "Hermes tool activity has stalled; the run remains active for recovery.");
            }
            if (Date.now() - counters.lastSubstantiveEventAt >= 120_000) {
              throw hermesError("hermes_model_inactivity_timeout", "Hermes model activity has stalled; the run remains active for recovery.");
            }
          } else {
            counters.lastSubstantiveEventAt = Date.now();
          }
          handle = touchRunHandle(handle, statusForBridgeEvent(bridgeEvent, handle.status));
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
        const event = this.mapBridgeEvent(normalized, bridgeEvent, counters, startedAt);
        if (event) yield { ...event, data: mergeEventData(event.data, { runHandle: handle }) };
        if (bridgeEvent.type === "approval_required") return;
        if (bridgeEvent.type === "turn_completed" || bridgeEvent.type === "turn_failed") {
          terminalSeen = true;
          if (bridgeEvent.type === "turn_completed") {
            yield this.event(normalized, "turn_completed", {
              data: {
                ...(bridgeEvent.data && typeof bridgeEvent.data === "object" ? bridgeEvent.data as Record<string, unknown> : {}),
                runHandle: handle,
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
          yield this.event(normalized, "turn_paused", { message: "页面连接已断开，Hermes 任务仍在运行。", data: { runHandle: handle } });
          return;
        }
        streamFailed = true;
        counters.recoveryCount += 1;
        counters.autonomousRecoveries += 1;
        counters.lastEventType = errorCode(error);
        }
        if (!terminalSeen && reconnectAttempt < 2) {
          const status = await this.dependencies.transport.getRun(handle.runId, input.signal);
          handle = touchRunHandle(handle, normalizeRunStatus(status.status));
          this.activeRuns.set(input.sessionId, handle);
          if (status.status === "completed" || status.status === "failed" || status.status === "cancelled") break;
          yield this.event(normalized, "progress", {
            message: "Hermes 事件连接已恢复，任务没有重复提交。",
            data: { runHandle: handle, recovery: "event_stream_reattach", reconnectAttempt: reconnectAttempt + 1 }
          });
        }
      }
      if (!terminalSeen) {
        for (;;) {
          if (input.signal?.aborted) {
            yield this.event(normalized, "turn_paused", { message: "页面连接已断开，Hermes 任务仍在运行。", data: { runHandle: handle } });
            return;
          }
          if (Date.now() - startedAt >= 15 * 60_000) {
            counters.lastEventType = counters.lastEventType ?? "hermes_overall_budget_checkpoint";
            yield this.event(normalized, "turn_paused", {
              message: "本次前台等待已达到演示预算；Hermes run 未被破坏性停止，可稍后重新连接。",
              data: this.diagnostics(handle, counters, "hermes_overall_budget_checkpoint")
            });
            return;
          }
          const status = await this.dependencies.transport.getRun(handle.runId, input.signal);
          handle = touchRunHandle(handle, normalizeRunStatus(status.status));
          this.activeRuns.set(input.sessionId, handle);
          counters.lastEventType = status.last_event ?? counters.lastEventType;
          if (status.status === "completed") {
            terminalSeen = true;
            yield this.event(normalized, "turn_completed", {
              message: status.output,
              data: { runHandle: handle, recovery: streamFailed ? "status_poll" : undefined, telemetry: this.telemetry(normalized, counters, "completed", startedAt) }
            });
            break;
          }
          if (status.status === "failed" || status.status === "cancelled") {
            terminalSeen = true;
            yield this.event(normalized, "turn_failed", {
              error: { code: status.status === "cancelled" ? "hermes_run_cancelled" : "hermes_run_failed", message: status.error ?? "Hermes run failed.", recoverable: status.status === "cancelled" },
              data: this.diagnostics(handle, counters, status.status === "cancelled" ? "hermes_run_cancelled" : "hermes_run_failed")
            });
            break;
          }
          if (status.status === "waiting_for_approval") {
            yield this.event(normalized, "approval_required", { message: "Hermes 任务正在等待确认。", data: { runHandle: handle } });
            break;
          }
          await delay(1_000, input.signal);
        }
      }
      if (!terminalSeen) {
        const error = hermesError("hermes_stream_incomplete", "Hermes stream 在完成事件前结束，当前任务没有被重复提交。");
        if (!emitted) throw error;
        yield this.event(normalized, "turn_failed", {
          error: { code: error.code, message: error.message, recoverable: true },
          data: this.diagnostics(handle, counters, error.code)
        });
      }
    } catch (error) {
      // Before the first RuntimeEvent, the router may safely fall back to
      // Native. Once a turn has emitted anything, the failure is terminal for
      // this runtime and must not be replayed.
      if (!emitted) throw error;
      yield this.event(normalized, "turn_failed", {
        error: {
          code: errorCode(error),
          message: error instanceof Error ? error.message : "Hermes turn failed.",
          recoverable: isRecoverable(errorCode(error))
        },
        data: { ...this.diagnostics(this.activeRuns.get(input.sessionId), counters, errorCode(error)), telemetry: this.telemetry(normalized, counters, "failed", startedAt) }
      });
    }
  }

  private async *runLegacyAdapterTurn(
    input: AgentRuntimeTurnInput,
    counters: TurnCounters,
    startedAt: number
  ): AsyncGenerator<AgentRuntimeEvent> {
    const binding = resolveCareerSessionBinding({ sessionId: input.sessionId, session: input.session, pageContext: input.pageContext });
    const requireSessionBinding = input.metadata?.requireCareerSessionBinding === true || Boolean(input.session);
    const health = await this.dependencies.transport.health(input.signal);
    if (!(health.runtimeHealth?.runtimeAvailable ?? health.available)) {
      throw hermesError("hermes_unavailable_before_turn", health.reason ?? "Hermes runtime is unavailable.");
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
      toolContracts: allowedCareerToolContracts(this.dependencies.careerToolGateway, input) as unknown as Array<Record<string, unknown>>,
      careerSessionBinding: binding,
      metadata: safeMetadata(input.metadata)
    }, input.signal)) {
      emitted = true;
      if (bridgeEvent.type === "tool_call_requested") {
        yield this.event(input, "tool_call_requested", {
          toolName: bridgeEvent.toolName,
          operationId: bridgeEvent.operationId,
          data: { toolCallId: bridgeEvent.toolCallId, input: bridgeEvent.input }
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

  private diagnostics(handle: HermesRunHandle | undefined, counters: TurnCounters, safeErrorCode: string) {
    return {
      runId: handle?.runId,
      lastEventType: counters.lastEventType,
      lastTool: counters.lastTool,
      lastOperationId: counters.lastOperationId,
      safeErrorCode,
      runHandle: handle
    };
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
    if (!isAllowedCareerTool(input, request.toolName)) {
      const code = "agent_tool_not_allowed";
      counters.toolFailures += 1;
      yield this.event(input, "tool_call_failed", {
        toolName: request.toolName,
        operationId: request.operationId,
        error: { code, message: "当前组合工作流步骤不允许该 Career 工具。", recoverable: true },
        data: { safeErrorCode: code, workflowId: input.metadata?.workflowId, workflowStage: input.metadata?.workflowStage }
      });
      return;
    }
    let contract: CareerToolContract;
    try {
      contract = this.dependencies.careerToolGateway.getContract(request.toolName);
    } catch (error) {
      counters.toolFailures += 1;
      const code = errorCode(error) === "hermes_turn_failed" ? "mcp_tool_not_found" : errorCode(error);
      await this.dependencies.transport.toolCallback({
        sessionId: hermesSessionId,
        turnId: input.turnId ?? "hermes-turn-unknown",
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        operationId: request.operationId,
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
        data: { toolCallId: request.toolCallId, discoveryRefreshRequired: true }
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
        data: { toolCallId: request.toolCallId, input: request.input, contract }
      });
      yield approval;
      await this.dependencies.transport.toolCallback({
        sessionId: hermesSessionId,
        turnId: input.turnId ?? "hermes-turn-unknown",
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        operationId: request.operationId,
        careerSessionBinding: binding,
        result: { ok: false, error: { code: "approval_required", recoverable: false } }
      }, input.signal);
      return;
    }

    yield this.event(input, "tool_call_started", {
      toolName: request.toolName,
      operationId: request.operationId,
      data: { toolCallId: request.toolCallId }
    });
    let result = await this.executeGatewayTool(request.toolName, request.input, {
      operationId: request.operationId,
      signal: input.signal,
      confirmed,
      confirmationCount,
      careerSessionBinding: binding,
      requireSessionBinding
    }, counters);
    if (!result.ok && shouldRetryRead(contract, result)) {
      counters.autonomousRecoveries += 1;
      result = await this.executeGatewayTool(request.toolName, request.input, {
        operationId: request.operationId,
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
      careerSessionBinding: binding,
      result: safeToolResult(result)
    }, input.signal);
    if (result.ok) {
      yield this.event(input, "tool_call_completed", {
        toolName: request.toolName,
        operationId: request.operationId,
        data: { toolCallId: request.toolCallId, artifacts: result.artifacts }
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
      data: { toolCallId: request.toolCallId, safeErrorCode: result.error?.code }
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
        data: { toolCallId: event.toolCallId, ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) }
      });
    }
    if (event.type === "tool_call_completed") return this.event(input, "tool_call_completed", {
      toolName: event.toolName,
      operationId: event.operationId,
      data: { toolCallId: event.toolCallId, ...(event.data && typeof event.data === "object" ? event.data as Record<string, unknown> : {}) }
    });
    if (event.type === "tool_call_failed") {
      counters.toolFailures += 1;
      return this.event(input, "tool_call_failed", {
        toolName: event.toolName,
        operationId: event.operationId,
        error: { code: event.code, message: event.message, recoverable: event.recoverable },
        data: event.data
      });
    }
    if (event.type === "approval_required") return this.event(input, "approval_required", {
      toolName: event.toolName,
      operationId: event.operationId,
      message: event.message,
      data: event.data
    });
    if (event.type === "artifact_updated") {
      counters.artifactUpdates += 1;
      return this.event(input, "artifact_updated", { data: event.data, ...(event.artifactId ? { operationId: event.artifactId } : {}) });
    }
    if (event.type === "turn_failed") return this.event(input, "turn_failed", {
      error: { code: event.code, message: event.message, recoverable: event.recoverable },
      data: { telemetry: this.telemetry(input, counters, "failed", startedAt) }
    });
    return undefined;
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
  signal?: AbortSignal
): AsyncGenerator<HermesBridgeEvent> {
  const heartbeatController = new AbortController();
  const combinedSignal = signal
    ? AbortSignal.any([signal, heartbeatController.signal])
    : heartbeatController.signal;
  const iterator = transport.runEvents(runId, combinedSignal)[Symbol.asyncIterator]();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const heartbeat = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          heartbeatController.abort();
          reject(hermesError("hermes_event_heartbeat_timeout", "Hermes event stream heartbeat timed out; the run remains active."));
        }, 45_000);
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
    error: result.error
      ? { code: result.error.code, category: result.error.category, recoverable: result.error.recoverable, retryHint: result.error.retryHint }
      : { code: "career_tool_failed", recoverable: false },
    receipt: result.receipt
  };
}

function safeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  return Object.fromEntries(Object.entries(metadata).filter(([key, value]) =>
    ["model", "hermesSessionId", "fallbackUsed", "preferredRuntime", "attemptedRuntime", "finalRuntime", "fallbackReasonCode", "runtimeFailureAt", "workflowId", "workflowStage", "rootGoal", "confirmed", "confirmationCount", "runtimeId"].includes(key)
    && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  ));
}

function allowedCareerToolContracts(gateway: CareerToolGateway, input: AgentRuntimeTurnInput) {
  const allowedSourceTools = new Set(
    Array.isArray(input.metadata?.allowedToolNames)
      ? input.metadata.allowedToolNames.filter((name): name is string => typeof name === "string")
      : gateway.listContracts().map((contract) => contract.sourceToolName)
  );
  const workflowId = typeof input.metadata?.workflowId === "string" ? input.metadata.workflowId : undefined;
  const stage = typeof input.metadata?.workflowStage === "string" ? input.metadata.workflowStage : undefined;
  return gateway.listContracts().filter((contract) =>
    allowedSourceTools.has(contract.sourceToolName)
    || contract.name === "career.workflow.compose_resume"
      && workflowId === "compose_resume"
      && ["review_composition", "confirm_create"].includes(stage ?? "")
  );
}

function isAllowedCareerTool(input: AgentRuntimeTurnInput, toolName: string) {
  const allowed = input.metadata?.allowedCareerToolNames;
  if (Array.isArray(allowed)) return allowed.includes(toolName);
  return true;
}

function isRecoverable(code: string) {
  return /temporar|timeout|network|unavailable|provider_http_(408|429|5\d\d)/i.test(code);
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
