import { nanoid } from "nanoid";
import type {
  AgentRuntime,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeTurnInput
} from "../agentRuntime";
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
};

/**
 * Server/local Hermes adapter.  It owns protocol translation and tool
 * callbacks, but deliberately contains no WorkspaceRepository or browser
 * persistence access.
 */
export class HermesCareerAgentRuntime implements AgentRuntime {
  readonly id = "hermes" as const;
  private readonly sessions = new Map<string, string>();

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
      runtimeVersion: "hermes-career-bridge-v1",
      ...this.dependencies.capabilities
    };
  }

  health(signal?: AbortSignal) {
    return this.dependencies.transport.health(signal);
  }

  async pause(sessionId: string) {
    await this.dependencies.transport.interrupt({ sessionId, reason: "pause" });
  }

  async interrupt(sessionId: string) {
    await this.dependencies.transport.interrupt({ sessionId, reason: "interrupt" });
  }

  async resume() {
    // Resume is represented by the next runTurn's session resume handshake.
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
    };
    let emitted = false;
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
      const hermesSessionId = await this.openSession(input);
      const stream = this.dependencies.transport.turn({
        sessionId: hermesSessionId,
        turnId,
        userMessage: input.userMessage,
        pageContext: input.pageContext,
        toolContracts: this.dependencies.careerToolGateway.listContracts() as unknown as Array<Record<string, unknown>>,
        careerSessionBinding: binding,
        metadata: {
          ...(safeMetadata(input.metadata) ?? {}),
          requireCareerSessionBinding: requireSessionBinding
        }
      }, input.signal);
      let terminalSeen = false;
      for await (const bridgeEvent of stream) {
        emitted = true;
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
        if (bridgeEvent.type === "tool_call_requested") {
          yield this.event(normalized, "tool_call_requested", {
            toolName: bridgeEvent.toolName,
            operationId: bridgeEvent.operationId,
            data: { toolCallId: bridgeEvent.toolCallId, input: bridgeEvent.input }
          });
          yield* this.executeToolCall(normalized, hermesSessionId, bridgeEvent, counters, binding, requireSessionBinding);
          continue;
        }
        const event = this.mapBridgeEvent(normalized, bridgeEvent, counters, startedAt);
        if (event) yield event;
        if (bridgeEvent.type === "turn_completed" || bridgeEvent.type === "turn_failed") {
          terminalSeen = true;
          if (bridgeEvent.type === "turn_completed") {
            yield this.event(normalized, "turn_completed", {
              data: {
                ...(bridgeEvent.data && typeof bridgeEvent.data === "object" ? bridgeEvent.data as Record<string, unknown> : {}),
                telemetry: this.telemetry(normalized, counters, "completed", startedAt)
              },
              message: bridgeEvent.message
            });
          }
          break;
        }
      }
      if (!terminalSeen) {
        const error = hermesError("hermes_stream_incomplete", "Hermes stream 在完成事件前结束，当前任务没有被重复提交。");
        if (!emitted) throw error;
        yield this.event(normalized, "turn_failed", {
          error: { code: error.code, message: error.message, recoverable: true },
          data: { telemetry: this.telemetry(normalized, counters, "failed", startedAt) }
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
        data: { telemetry: this.telemetry(normalized, counters, "failed", startedAt) }
      });
    }
  }

  private async openSession(input: AgentRuntimeTurnInput) {
    const requested = typeof input.metadata?.hermesSessionId === "string"
      ? input.metadata.hermesSessionId
      : this.sessions.get(input.sessionId);
    if (requested) {
      try {
        const resumed = await this.dependencies.transport.resumeSession({ sessionId: requested }, input.signal);
        this.sessions.set(input.sessionId, resumed.sessionId);
        return resumed.sessionId;
      } catch (error) {
        if (!isSessionMissing(error)) throw error;
      }
    }
    const created = await this.dependencies.transport.createSession({
      sessionId: input.sessionId,
      metadata: {
        ...(safeMetadata(input.metadata) ?? {}),
        ...(input.session ? {
          careerSessionBinding: resolveCareerSessionBinding({
            sessionId: input.sessionId,
            session: input.session,
            pageContext: input.pageContext
          })
        } : {})
      }
    }, input.signal);
    this.sessions.set(input.sessionId, created.sessionId);
    return created.sessionId;
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
        data: { toolCallId: request.toolCallId, contract }
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
    ["model", "hermesSessionId", "fallbackUsed", "preferredRuntime", "confirmed", "confirmationCount", "runtimeId"].includes(key)
    && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  ));
}

function isSessionMissing(error: unknown) {
  return errorCode(error) === "hermes_session_not_found" || errorCode(error) === "session_not_found";
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
