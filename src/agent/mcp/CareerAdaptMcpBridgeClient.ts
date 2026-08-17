import type {
  CareerToolContract,
  CareerToolExecutionContext,
  CareerToolResult
} from "@/agent/tools/CareerToolGateway";
import type { CareerAdaptMcpGateway } from "./CareerAdaptMcpAdapter";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";

type BridgeRequest = {
  id: string;
  name: string;
  input: unknown;
  operationId: string;
  logicalToolOperationId?: string;
  incidentTraceId?: string;
  careerSessionBinding?: CareerSessionBinding;
  requireSessionBinding?: boolean;
};

export type CareerAdaptMcpBridgeClientStatus = {
  connected: boolean;
  discoveredToolCount: number;
  reason?: string;
};

export type CareerAdaptMcpConfirmationContext = {
  sessionId: string;
  turnId: string;
  assistantMessageId: string;
  userMessageId?: string;
  incidentTraceId?: string;
};

export type CareerAdaptMcpExternalConfirmation = CareerAdaptMcpConfirmationContext & {
  toolName: string;
  operationId: string;
  input: Record<string, unknown>;
  contract: CareerToolContract;
};

/**
 * Keeps the browser-owned CareerToolGateway behind the local MCP HTTP
 * boundary. The Node/Next MCP endpoint never receives a Repository object or
 * a browser database handle; it only queues protocol calls here.
 */
export class CareerAdaptMcpBridgeClient {
  private bridgeId?: string;
  private token?: string;
  private stopped = true;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private gateway?: CareerAdaptMcpGateway;
  private onStatus?: (status: CareerAdaptMcpBridgeClientStatus) => void;
  private onConfirmation?: (confirmation: CareerAdaptMcpExternalConfirmation) => Promise<void> | void;
  private onResult?: (input: {
    request: BridgeRequest;
    result: CareerToolResult;
    confirmationContext?: CareerAdaptMcpConfirmationContext;
  }) => Promise<void> | void;
  private confirmationContext?: CareerAdaptMcpConfirmationContext;
  private detachedConfirmationContext?: CareerAdaptMcpConfirmationContext;
  private confirmationPendingTurnId?: string;
  private noProgress?: { turnId: string; callKey: string; count: number };
  private lifecycleGeneration = 0;
  private registrationChain: Promise<void> = Promise.resolve();
  private currentBinding?: CareerSessionBinding;

  async start(
    gateway: CareerAdaptMcpGateway,
    onStatus?: (status: CareerAdaptMcpBridgeClientStatus) => void,
    onConfirmation?: (confirmation: CareerAdaptMcpExternalConfirmation) => Promise<void> | void,
    onResult?: (input: {
      request: BridgeRequest;
      result: CareerToolResult;
      confirmationContext?: CareerAdaptMcpConfirmationContext;
    }) => Promise<void> | void
  ) {
    if (!this.stopped) return;
    const generation = ++this.lifecycleGeneration;
    this.gateway = gateway;
    this.onStatus = onStatus;
    this.onConfirmation = onConfirmation;
    this.onResult = onResult;
    this.stopped = false;
    await this.queueRegister(generation);
    if (this.stopped || generation !== this.lifecycleGeneration) return;
    this.schedulePoll(0);
  }

  setConfirmationContext(context?: CareerAdaptMcpConfirmationContext) {
    if (context?.turnId !== this.confirmationContext?.turnId) {
      this.noProgress = undefined;
      this.confirmationPendingTurnId = undefined;
    }
    if (context) {
      // A new runtime turn owns all subsequent bridge calls. Do not let a
      // delayed result from the previous turn attach to this one.
      this.detachedConfirmationContext = undefined;
    } else if (this.confirmationContext) {
      // Hermes can close its lifecycle stream before the browser receives a
      // queued MCP request. Keep this one context until the next turn or
      // bridge stop so the result can still be projected to its assistant.
      this.detachedConfirmationContext = this.confirmationContext;
    }
    this.confirmationContext = context;
  }

  async stop() {
    ++this.lifecycleGeneration;
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = undefined;
    this.heartbeatTimer = undefined;
    const bridgeId = this.bridgeId;
    const token = this.token;
    this.bridgeId = undefined;
    this.token = undefined;
    if (bridgeId && token) {
      await fetch(bridgeUrl(bridgeId, token), {
        method: "DELETE",
        cache: "no-store"
      }).catch(() => undefined);
    }
    this.confirmationContext = undefined;
    this.detachedConfirmationContext = undefined;
    this.confirmationPendingTurnId = undefined;
    this.currentBinding = undefined;
    this.onConfirmation = undefined;
    this.onResult = undefined;
    this.publish({ connected: false, discoveredToolCount: 0, reason: "stopped" });
  }

  async setSessionBinding(binding?: CareerSessionBinding) {
    this.currentBinding = binding;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (this.stopped) break;
      if (!this.bridgeId || !this.token) await this.queueRegister().catch(() => undefined);
      const bridgeId = this.bridgeId;
      const token = this.token;
      if (!bridgeId || !token) continue;
      const response = await fetch(bridgeUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "binding",
          bridgeId,
          token,
          ...(binding ? { binding } : {})
        }),
        cache: "no-store"
      }).catch(() => undefined);
      if (response?.ok) return;
      if (this.bridgeId === bridgeId) {
        this.bridgeId = undefined;
        this.token = undefined;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
      }
      await this.queueRegister().catch(() => undefined);
    }
    throw Object.assign(new Error("mcp_bridge_binding_unavailable"), { code: "mcp_bridge_binding_unavailable" });
  }

  private queueRegister(generation = this.lifecycleGeneration) {
    const queued = this.registrationChain.then(() => this.register(generation));
    this.registrationChain = queued.catch(() => undefined);
    return queued;
  }

  private async register(generation: number) {
    if (this.stopped || generation !== this.lifecycleGeneration) return;
    const gateway = this.gateway;
    if (!gateway) return;
    try {
      const response = await fetch(bridgeUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          contracts: gateway.listContracts(),
          ...(this.currentBinding ? { binding: this.currentBinding } : {})
        }),
        cache: "no-store"
      });
      const payload = await response.json() as { ok?: boolean; bridgeId?: string; token?: string; discoveredToolCount?: number };
      if (!response.ok || !payload.ok || !payload.bridgeId || !payload.token) {
        throw new Error("mcp_bridge_register_failed");
      }
      if (this.stopped || generation !== this.lifecycleGeneration) {
        await fetch(bridgeUrl(payload.bridgeId, payload.token), { method: "DELETE", cache: "no-store" }).catch(() => undefined);
        return;
      }
      this.bridgeId = payload.bridgeId;
      this.token = payload.token;
      if (this.currentBinding) {
        const bindingResponse = await fetch(bridgeUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "binding",
            bridgeId: this.bridgeId,
            token: this.token,
            binding: this.currentBinding
          }),
          cache: "no-store"
        }).catch(() => undefined);
        if (!bindingResponse?.ok) throw new Error("mcp_bridge_binding_restore_failed");
      }
      this.publish({ connected: true, discoveredToolCount: payload.discoveredToolCount ?? gateway.listContracts().length });
      if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, 5_000);
    } catch (error) {
      this.publish({ connected: false, discoveredToolCount: 0, reason: safeError(error) });
      if (!this.stopped && generation === this.lifecycleGeneration) this.schedulePoll(1_000);
    }
  }

  private async poll() {
    if (this.stopped || !this.gateway) return;
    if (!this.bridgeId || !this.token) {
      await this.queueRegister();
      if (!this.bridgeId || !this.token) return;
    }
    try {
      const response = await fetch(bridgeUrl(this.bridgeId, this.token), {
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`mcp_bridge_poll_${response.status}`);
      const payload = await response.json() as { ok?: boolean; requests?: BridgeRequest[] };
      if (!payload.ok) throw new Error("mcp_bridge_poll_failed");
      this.publish({ connected: true, discoveredToolCount: this.gateway.listContracts().length });
      for (const request of payload.requests ?? []) await this.execute(request);
      this.schedulePoll(150);
    } catch (error) {
      this.publish({ connected: false, discoveredToolCount: 0, reason: safeError(error) });
      if (!this.stopped) {
        this.bridgeId = undefined;
        this.token = undefined;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        await this.queueRegister();
        this.schedulePoll(1_000);
      }
    }
  }

  private async execute(request: BridgeRequest) {
    if (!this.gateway || !this.bridgeId || !this.token) return;
    // The official Hermes run can emit its terminal lifecycle event before
    // the browser bridge finishes the MCP request. Capture the turn context
    // at request start so a later cleanup cannot make a valid result look
    // unrelated to the assistant message that initiated it.
    const confirmationContext = this.confirmationContext ?? this.detachedConfirmationContext;
    let result;
    const toolInput = normalizeHermesScopedInput(request.name, request.input, request.careerSessionBinding, confirmationContext);
    try {
      const context: CareerToolExecutionContext = {
        operationId: request.operationId,
        logicalToolOperationId: request.logicalToolOperationId,
        incidentTraceId: request.incidentTraceId,
        careerSessionBinding: request.careerSessionBinding,
        requireSessionBinding: request.requireSessionBinding === true
      };
      const callKey = `${request.name}:${stableJson(toolInput)}`;
      const turnId = confirmationContext?.turnId ?? "unbound-turn";
      if (this.confirmationPendingTurnId === turnId) {
        result = confirmationBoundaryResult(request);
      } else if (this.noProgress?.turnId === turnId && this.noProgress.callKey === callKey && this.noProgress.count >= 2) {
        result = noProgressResult(request);
      } else {
        result = await this.gateway.execute(request.name, toolInput, context);
        this.noProgress = this.noProgress?.turnId === turnId && this.noProgress.callKey === callKey
          ? { ...this.noProgress, count: this.noProgress.count + 1 }
          : { turnId, callKey, count: 1 };
      }
      if (isConfirmationRequired(result) && confirmationContext) {
        this.confirmationPendingTurnId = turnId;
      }
      if (isConfirmationRequired(result) && confirmationContext && this.onConfirmation) {
        const contract = this.gateway.listContracts().find((candidate) => candidate.name === request.name);
        const input = asRecord(toolInput);
        if (contract) {
          await Promise.resolve(this.onConfirmation({
            ...confirmationContext,
            toolName: request.name,
            operationId: request.operationId,
            input,
            contract
          })).catch(() => undefined);
        }
      }
      await Promise.resolve(this.onResult?.({ request, result, confirmationContext })).catch(() => undefined);
    } catch (error) {
      result = failedResult(request, safeError(error));
    }
    await fetch(bridgeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "result", bridgeId: this.bridgeId, token: this.token, requestId: request.id, result }),
      cache: "no-store"
    }).catch(() => undefined);
  }

  private async heartbeat() {
    if (this.stopped || !this.bridgeId || !this.token) return;
    const bridgeId = this.bridgeId;
    const token = this.token;
    const response = await fetch(bridgeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "heartbeat", bridgeId: this.bridgeId, token: this.token }),
      cache: "no-store"
    }).catch(() => undefined);
    if (!response?.ok) {
      this.publish({ connected: false, discoveredToolCount: 0, reason: "mcp_bridge_heartbeat_failed" });
      if (this.bridgeId === bridgeId && this.token === token) {
        this.bridgeId = undefined;
        this.token = undefined;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        await this.queueRegister().catch(() => undefined);
        this.schedulePoll(0);
      }
    }
  }

  private schedulePoll(delay: number) {
    if (this.stopped) return;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(() => { void this.poll(); }, delay);
  }

  private publish(status: CareerAdaptMcpBridgeClientStatus) {
    this.onStatus?.(status);
  }
}

function bridgeUrl(bridgeId?: string, token?: string) {
  const params = new URLSearchParams({ bridge: "1" });
  if (bridgeId) params.set("bridgeId", bridgeId);
  if (token) params.set("token", token);
  return `/api/agent/mcp?${params.toString()}`;
}

function failedResult(request: BridgeRequest, reason: string) {
  return {
    ok: false,
    error: {
      code: "mcp_bridge_tool_failed",
      category: "recoverable",
      message: `CareerAdapt MCP 工具未完成：${reason}`,
      recoverable: true
    },
    artifacts: [],
    receipt: {
      operationId: request.operationId,
      toolName: request.name,
      status: "failed",
      completedAt: new Date().toISOString()
    }
  };
}

function noProgressResult(request: BridgeRequest): CareerToolResult {
  return {
    ok: false,
    error: {
      code: "career_agent_no_progress",
      category: "conflict",
      message: "同一轮已连续执行两次完全相同的工具输入；为避免空转，工作流已停止。",
      recoverable: false,
      retryHint: "向用户报告当前 checkpoint，等待新输入后再继续。"
    },
    artifacts: [],
    receipt: {
      operationId: request.operationId,
      toolName: request.name,
      status: "failed",
      completedAt: new Date().toISOString()
    }
  };
}

function confirmationBoundaryResult(request: BridgeRequest): CareerToolResult {
  return {
    ok: false,
    error: {
      code: "career_agent_waiting_for_confirmation",
      category: "conflict",
      message: "当前 Career 工作流已到达确认边界；请等待用户确认后再继续调用工具。",
      recoverable: true,
      retryHint: "停止当前工具循环，向用户展示确认边界。"
    },
    artifacts: [],
    receipt: {
      operationId: request.operationId,
      toolName: request.name,
      status: "failed",
      completedAt: new Date().toISOString()
    }
  };
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "mcp_bridge_unavailable";
}

function isConfirmationRequired(result: { ok: boolean; data?: unknown; error?: { code?: string } }) {
  if (result.ok === false) {
    return result.error?.code === "agent_confirmation_required" || result.error?.code === "confirmation_required";
  }
  const data = asRecord(result.data);
  return data.status === "waiting_for_confirmation";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeHermesScopedInput(
  name: string,
  value: unknown,
  binding?: CareerSessionBinding,
  turn?: CareerAdaptMcpConfirmationContext
) {
  if (!binding) return value;
  const input = asRecord(value);
  if (name === "career.workflow.profile_intake_turn") {
    return {
      ...input,
      agentSessionId: binding.agentSessionId,
      profileId: binding.profileId,
      expectedProfileRevision: binding.profileRevision,
      ...(turn ? {
        ...(turn.userMessageId ? { messageId: turn.userMessageId } : {}),
        turnId: turn.turnId,
        capturedAt: new Date().toISOString()
      } : {})
    };
  }
  if (name === "career.profile.capture_intake" && typeof input.sessionId === "string" && input.sessionId !== binding.agentSessionId) {
    return { ...input, sessionId: binding.agentSessionId };
  }
  if (name === "career.profile.review_intake" && input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence)) {
    const evidence = input.evidence as Record<string, unknown>;
    if (typeof evidence.sessionId === "string" && evidence.sessionId !== binding.agentSessionId) {
      return { ...input, evidence: { ...evidence, sessionId: binding.agentSessionId } };
    }
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
