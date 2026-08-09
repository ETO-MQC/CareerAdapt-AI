import type {
  CareerToolContract,
  CareerToolExecutionContext
} from "@/agent/tools/CareerToolGateway";
import type { CareerAdaptMcpGateway } from "./CareerAdaptMcpAdapter";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";

type BridgeRequest = {
  id: string;
  name: string;
  input: unknown;
  operationId: string;
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
  private confirmationContext?: CareerAdaptMcpConfirmationContext;

  async start(
    gateway: CareerAdaptMcpGateway,
    onStatus?: (status: CareerAdaptMcpBridgeClientStatus) => void,
    onConfirmation?: (confirmation: CareerAdaptMcpExternalConfirmation) => Promise<void> | void
  ) {
    if (!this.stopped) return;
    this.gateway = gateway;
    this.onStatus = onStatus;
    this.onConfirmation = onConfirmation;
    this.stopped = false;
    await this.register();
    this.schedulePoll(0);
  }

  setConfirmationContext(context?: CareerAdaptMcpConfirmationContext) {
    this.confirmationContext = context;
  }

  async stop() {
    this.stopped = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.pollTimer = undefined;
    this.heartbeatTimer = undefined;
    if (this.bridgeId && this.token) {
      await fetch(bridgeUrl(this.bridgeId, this.token), {
        method: "DELETE",
        cache: "no-store"
      }).catch(() => undefined);
    }
    this.bridgeId = undefined;
    this.token = undefined;
    this.confirmationContext = undefined;
    this.onConfirmation = undefined;
    this.publish({ connected: false, discoveredToolCount: 0, reason: "stopped" });
  }

  async setSessionBinding(binding?: CareerSessionBinding) {
    if (this.stopped || !this.bridgeId || !this.token) {
      throw Object.assign(new Error("mcp_bridge_binding_unavailable"), { code: "mcp_bridge_binding_unavailable" });
    }
    const response = await fetch(bridgeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "binding",
        bridgeId: this.bridgeId,
        token: this.token,
        ...(binding ? { binding } : {})
      }),
      cache: "no-store"
    });
    if (!response.ok) {
      throw Object.assign(new Error("mcp_bridge_binding_unavailable"), { code: "mcp_bridge_binding_unavailable" });
    }
  }

  private async register() {
    const gateway = this.gateway;
    if (!gateway) return;
    try {
      const response = await fetch(bridgeUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register", contracts: gateway.listContracts() }),
        cache: "no-store"
      });
      const payload = await response.json() as { ok?: boolean; bridgeId?: string; token?: string; discoveredToolCount?: number };
      if (!response.ok || !payload.ok || !payload.bridgeId || !payload.token) {
        throw new Error("mcp_bridge_register_failed");
      }
      this.bridgeId = payload.bridgeId;
      this.token = payload.token;
      this.publish({ connected: true, discoveredToolCount: payload.discoveredToolCount ?? gateway.listContracts().length });
      this.heartbeatTimer = setInterval(() => { void this.heartbeat(); }, 5_000);
    } catch (error) {
      this.publish({ connected: false, discoveredToolCount: 0, reason: safeError(error) });
      if (!this.stopped) this.schedulePoll(1_000);
    }
  }

  private async poll() {
    if (this.stopped || !this.gateway) return;
    if (!this.bridgeId || !this.token) {
      await this.register();
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
        await this.register();
        this.schedulePoll(1_000);
      }
    }
  }

  private async execute(request: BridgeRequest) {
    if (!this.gateway || !this.bridgeId || !this.token) return;
    let result;
    const toolInput = normalizeHermesScopedInput(request.name, request.input, request.careerSessionBinding);
    try {
      const context: CareerToolExecutionContext = {
        operationId: request.operationId,
        careerSessionBinding: request.careerSessionBinding,
        requireSessionBinding: request.requireSessionBinding === true
      };
      result = await this.gateway.execute(request.name, toolInput, context);
      if (isConfirmationRequired(result) && this.confirmationContext && this.onConfirmation) {
        const contract = this.gateway.listContracts().find((candidate) => candidate.name === request.name);
        const input = asRecord(toolInput);
        if (contract) {
          await Promise.resolve(this.onConfirmation({
            ...this.confirmationContext,
            toolName: request.name,
            operationId: request.operationId,
            input,
            contract
          })).catch(() => undefined);
        }
      }
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
    const response = await fetch(bridgeUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "heartbeat", bridgeId: this.bridgeId, token: this.token }),
      cache: "no-store"
    }).catch(() => undefined);
    if (!response?.ok) this.publish({ connected: false, discoveredToolCount: 0, reason: "mcp_bridge_heartbeat_failed" });
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

function safeError(error: unknown) {
  return error instanceof Error ? error.message : "mcp_bridge_unavailable";
}

function isConfirmationRequired(result: { ok: boolean; error?: { code?: string } }) {
  return result.ok === false
    && (result.error?.code === "agent_confirmation_required" || result.error?.code === "confirmation_required");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeHermesScopedInput(
  name: string,
  value: unknown,
  binding?: CareerSessionBinding
) {
  if (!binding) return value;
  const input = asRecord(value);
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
