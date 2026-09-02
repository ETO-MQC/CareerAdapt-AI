import { nanoid } from "nanoid";
import type { AgentRuntimeEvent, AgentRuntimeTurnInput } from "../agentRuntime";
import type { CareerSessionBinding } from "../careerSessionBinding";
import { resolveCareerSessionBinding } from "../careerSessionBinding";
import type { CareerToolGateway, CareerToolContract } from "../../tools/CareerToolGateway";
import { safeCareerToolArgumentShape } from "../../tools/careerToolDiagnostics";
import {
  logicalToolOperationId,
  type HermesBridgeEvent,
  type HermesBridgeTransport
} from "./HermesBridgeTransport";
import { HermesCareerToolCatalog, HERMES_REQUIRED_CAREER_FACADES, hermesProductionToolNames, projectCareerContractsForHermes } from "./HermesCareerToolCatalog";
import { isRoadshowReady } from "../runtimeHealth";
import { isCareerSystemStatusQuestion } from "../../kernel/AgentToolResolver";
import { getUserMessageForTurn } from "../currentTurnUserMessage";

type LegacyTurnCounters = {
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
 * Compatibility-only adapter for pre-P4.6f Hermes transports. The production
 * runtime never constructs this adapter; its session/callback loop remains
 * available only for non-production protocol fixtures and dev adapters.
 */
export class HermesLegacyCompatibilityAdapter {
  constructor(private readonly dependencies: {
    transport: HermesBridgeTransport;
    careerToolGateway: CareerToolGateway;
    sessions: Map<string, string>;
  }) {}

  async *runTurn(
    input: AgentRuntimeTurnInput,
    counters: LegacyTurnCounters,
    startedAt: number
  ): AsyncGenerator<AgentRuntimeEvent> {
    input = { ...input, metadata: { ...(input.metadata ?? {}), hermesProtocol: "legacy" } };
    const binding = resolveCareerSessionBinding({ sessionId: input.sessionId, session: input.session, pageContext: input.pageContext });
    const requireSessionBinding = Boolean(binding);
    const health = await this.dependencies.transport.health(input.signal);
    if (!(health.runtimeHealth?.runtimeAvailable ?? health.available)) {
      throw legacyError("hermes_unavailable_recoverable", health.reason ?? "Hermes runtime is unavailable.", true);
    }
    if (health.runtimeHealth && !isRoadshowReady(health.runtimeHealth)) {
      throw legacyError("hermes_career_registry_not_ready", "CareerAdapt MCP 尚未完成 Hermes 注册。");
    }
    const existing = this.dependencies.sessions.get(input.sessionId);
    const opened = existing
      ? await this.dependencies.transport.resumeSession({ sessionId: existing }, input.signal)
      : await this.dependencies.transport.createSession({ sessionId: input.sessionId }, input.signal);
    this.dependencies.sessions.set(input.sessionId, opened.sessionId);
    let emitted = false;
    for await (const bridgeEvent of this.dependencies.transport.turn({
      sessionId: opened.sessionId,
      turnId: input.turnId ?? `hermes-turn-${nanoid(12)}`,
      userMessage: input.userMessage,
      pageContext: input.pageContext,
      toolContracts: allowedCareerToolContracts(this.dependencies.careerToolGateway),
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
          data: {
            toolCallId: bridgeEvent.toolCallId,
            logicalToolOperationId: this.bridgeLogicalOperationId(input, bridgeEvent),
            hermesToolCallArgumentShape: safeCareerToolArgumentShape(bridgeEvent.input),
            sourceUserMessageId: sourceUserMessageIdForTurn(input.session, input.turnId)
          }
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
    if (!emitted) throw legacyError("hermes_stream_incomplete", "Hermes adapter stream ended before the first event.");
  }

  private async *executeToolCall(
    input: AgentRuntimeTurnInput,
    hermesSessionId: string,
    request: Extract<HermesBridgeEvent, { type: "tool_call_requested" }>,
    counters: LegacyTurnCounters,
    binding: CareerSessionBinding | undefined,
    requireSessionBinding: boolean
  ): AsyncGenerator<AgentRuntimeEvent> {
    counters.toolCalls += 1;
    const catalog = new HermesCareerToolCatalog(this.dependencies.careerToolGateway.listContracts());
    const requestedHermesToolName = request.toolName;
    const stableToolName = catalog.stableNameForRequestedName(requestedHermesToolName) ?? requestedHermesToolName;
    const sourceUserMessageId = sourceUserMessageIdForTurn(input.session, input.turnId);
    const logicalOperationId = request.logicalToolOperationId ?? logicalToolOperationId({
      ...request,
      turnId: input.turnId,
      stableToolName,
      preferStableToolName: true
    });
    if (!isAllowedCareerTool(input, stableToolName, catalog)) {
      const code = "agent_tool_not_allowed";
      counters.toolFailures += 1;
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
        eventId: request.eventId,
        toolName: request.toolName,
        operationId: request.operationId,
        error: { code, message: "当前组合工作流步骤不允许该 Career 工具。", recoverable: true },
        data: { safeErrorCode: code, logicalToolOperationId: logicalOperationId, workflowId: input.metadata?.workflowId, workflowStage: input.metadata?.workflowStage, requestedHermesToolName, stableCareerToolName: stableToolName, sourceUserMessageId }
      });
      return;
    }
    let contract: CareerToolContract;
    try {
      contract = this.dependencies.careerToolGateway.getContract(stableToolName);
    } catch (error) {
      counters.toolFailures += 1;
      const code = legacyErrorCode(error) === "hermes_turn_failed" ? "mcp_tool_not_found" : legacyErrorCode(error);
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
        eventId: request.eventId,
        toolName: request.toolName,
        operationId: request.operationId,
        error: { code, message: "CareerAdapt MCP 工具未找到，正在刷新工具发现。", recoverable: true },
        data: { toolCallId: request.toolCallId, logicalToolOperationId: logicalOperationId, discoveryRefreshRequired: true, requestedHermesToolName, stableCareerToolName: stableToolName, sourceUserMessageId }
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
        data: {
          toolCallId: request.toolCallId,
          logicalToolOperationId: logicalOperationId,
          hermesToolCallArgumentShape: safeCareerToolArgumentShape(request.input),
          sourceUserMessageId,
          contract
        }
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
      eventId: request.eventId,
      toolName: request.toolName,
      operationId: request.operationId,
      data: {
        toolCallId: request.toolCallId,
        logicalToolOperationId: logicalOperationId,
        hermesToolCallArgumentShape: safeCareerToolArgumentShape(request.input),
        requestedHermesToolName,
        stableCareerToolName: stableToolName,
        sourceUserMessageId
      }
    });
    let result = await this.executeGatewayTool(stableToolName, request.input, {
      operationId: request.operationId,
      logicalToolOperationId: logicalOperationId,
      logicalTurnId: input.turnId,
      taskId: typeof input.metadata?.taskId === "string" ? input.metadata.taskId : undefined,
      incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
      agentSessionId: input.sessionId,
      signal: input.signal,
      confirmed,
      confirmationCount,
      careerSessionBinding: binding,
      requireSessionBinding,
      sourceUserMessageId
    }, counters);
    if (!result.ok && shouldRetryRead(contract, result)) {
      counters.autonomousRecoveries += 1;
      result = await this.executeGatewayTool(stableToolName, request.input, {
        operationId: request.operationId,
        logicalToolOperationId: logicalOperationId,
        logicalTurnId: input.turnId,
        taskId: typeof input.metadata?.taskId === "string" ? input.metadata.taskId : undefined,
        incidentTraceId: typeof input.metadata?.incidentTraceId === "string" ? input.metadata.incidentTraceId : undefined,
        agentSessionId: input.sessionId,
        signal: input.signal,
        confirmed,
        confirmationCount,
        careerSessionBinding: binding,
        requireSessionBinding,
        sourceUserMessageId
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
        eventId: request.eventId,
        toolName: request.toolName,
        operationId: request.operationId,
        data: {
          toolCallId: request.toolCallId,
          logicalToolOperationId,
          result: safeToolResult(result),
          artifacts: result.artifacts,
          requestedHermesToolName,
          stableCareerToolName: stableToolName,
          sourceUserMessageId
        }
      });
      return;
    }
    counters.toolFailures += 1;
    yield this.event(input, "tool_call_failed", {
      eventId: request.eventId,
      toolName: request.toolName,
      operationId: request.operationId,
      error: {
        code: result.error?.code ?? "career_tool_failed",
        message: result.error?.message ?? "Career tool failed.",
        recoverable: result.error?.recoverable ?? false
      },
      data: { toolCallId: request.toolCallId, logicalToolOperationId, result: safeToolResult(result), safeErrorCode: result.error?.code, requestedHermesToolName, stableCareerToolName: stableToolName, sourceUserMessageId }
    });
  }

  private mapBridgeEvent(input: AgentRuntimeTurnInput, event: HermesBridgeEvent, counters: LegacyTurnCounters, startedAt: number) {
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

  private telemetry(input: AgentRuntimeTurnInput, counters: LegacyTurnCounters, completionStatus: "completed" | "failed", startedAt: number) {
    return {
      runtimeId: "hermes",
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
    counters: LegacyTurnCounters
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

function sourceUserMessageIdForTurn(session: AgentRuntimeTurnInput["session"], turnId?: string) {
  return turnId ? getUserMessageForTurn(session, turnId)?.id : undefined;
}

function allowedCareerToolContracts(gateway: CareerToolGateway) {
  return projectCareerContractsForHermes(gateway.listContracts());
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
  if (workflowId === "tailor_existing_resume" || workflowId === "tailor_resume" || workflowId === "create_tailored_resume") {
    return stage === "analyze_fit"
      ? ["career.workflow.job_fit", "career.workflow.tailor_resume"]
      : ["career.workflow.tailor_resume"];
  }
  if (workflowId === "repair_and_export_resume" || workflowId === "export_resume") return ["career.workflow.resume_export"];
  if (workflowId === "compose_resume" || workflowId === "create_resume_from_profile") {
    return ["career.workflow.compose_resume", "career.workflow.profile_to_resume"];
  }
  if (!workflowId || workflowId === "agent_quick_action") return [...HERMES_REQUIRED_CAREER_FACADES];
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

function safeToolResult(result: Awaited<ReturnType<CareerToolGateway["execute"]>>) {
  if (result.ok) {
    return { ok: true, data: result.data, artifacts: result.artifacts, receipt: result.receipt, diagnostics: result.diagnostics };
  }
  return {
    ok: false,
    ...(result.data === undefined ? {} : { data: result.data }),
    error: result.error
      ? {
          code: result.error.code,
          category: result.error.category,
          message: result.error.message,
          recoverable: result.error.recoverable,
          retryHint: result.error.retryHint,
          ...(result.error.scope ? { scope: result.error.scope } : {}),
          ...(result.error.invalidFields ? { invalidFields: result.error.invalidFields } : {}),
          ...(result.error.acceptedShapeHint ? { acceptedShapeHint: result.error.acceptedShapeHint } : {}),
          diagnostics: result.error.diagnostics
        }
      : { code: "career_tool_failed", message: "工具执行没有完成。", recoverable: false },
    receipt: result.receipt,
    diagnostics: result.diagnostics ?? result.error?.diagnostics
  };
}

function requiresConfirmation(contract: CareerToolContract) {
  return contract.confirmationPolicy !== "none";
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

function legacyErrorCode(error: unknown) {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "hermes_turn_failed";
}

function legacyError(code: string, message: string, retryable?: boolean) {
  return Object.assign(new Error(message), { code, ...(retryable === undefined ? {} : { retryable }) });
}
