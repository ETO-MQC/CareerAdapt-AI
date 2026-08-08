import type { CareerToolExecutionContext } from "@/agent/tools/CareerToolGateway";
import type { CareerAdaptMcpGateway } from "./CareerAdaptMcpAdapter";

type BridgeRequest = {
  id: string;
  name: string;
  input: unknown;
  operationId: string;
};

export type CareerAdaptMcpBridgeClientStatus = {
  connected: boolean;
  discoveredToolCount: number;
  reason?: string;
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

  async start(
    gateway: CareerAdaptMcpGateway,
    onStatus?: (status: CareerAdaptMcpBridgeClientStatus) => void
  ) {
    if (!this.stopped) return;
    this.gateway = gateway;
    this.onStatus = onStatus;
    this.stopped = false;
    await this.register();
    this.schedulePoll(0);
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
    this.publish({ connected: false, discoveredToolCount: 0, reason: "stopped" });
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
    try {
      const context: CareerToolExecutionContext = { operationId: request.operationId };
      result = await this.gateway.execute(request.name, request.input, context);
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
