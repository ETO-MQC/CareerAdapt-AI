import { nanoid } from "nanoid";
import type {
  CareerToolContract,
  CareerToolExecutionContext,
  CareerToolResult
} from "@/agent/tools/CareerToolGateway";
import { CareerAdaptMcpUnavailableError } from "@/agent/mcp/CareerAdaptMcpServer";

type BridgeRequest = {
  id: string;
  name: string;
  input: unknown;
  operationId: string;
  createdAt: number;
};

type BridgeRecord = {
  id: string;
  token: string;
  contracts: CareerToolContract[];
  queue: BridgeRequest[];
  inflight: Map<string, BridgeRequest>;
  lastHeartbeatAt: number;
};

type PendingCall = {
  bridgeId: string;
  request: BridgeRequest;
  timer: ReturnType<typeof setTimeout>;
  resolve: (result: CareerToolResult) => void;
};

const BRIDGE_TTL_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;
const bridges = new Map<string, BridgeRecord>();
const pendingCalls = new Map<string, PendingCall>();

export type CareerAdaptMcpBridgeStatus = {
  connected: boolean;
  server: "careeradapt";
  discoveredToolCount: number;
  lastHeartbeatAt?: string;
  bridgeId?: string;
};

export function registerCareerAdaptMcpBridge(contracts: CareerToolContract[]) {
  const current = [...bridges.values()][0];
  if (current) disconnectCareerAdaptMcpBridge(current.id);
  const bridge: BridgeRecord = {
    id: `careeradapt-bridge-${nanoid(12)}`,
    token: `careeradapt-token-${nanoid(24)}`,
    contracts: contracts.map(sanitizeContract),
    queue: [],
    inflight: new Map(),
    lastHeartbeatAt: Date.now()
  };
  bridges.set(bridge.id, bridge);
  return {
    bridgeId: bridge.id,
    token: bridge.token,
    discoveredToolCount: bridge.contracts.length
  };
}

export function disconnectCareerAdaptMcpBridge(bridgeId: string, token?: string) {
  const bridge = bridges.get(bridgeId);
  if (!bridge || (token && bridge.token !== token)) return false;
  bridges.delete(bridgeId);
  for (const [requestId, pending] of pendingCalls) {
    if (pending.bridgeId !== bridgeId) continue;
    clearTimeout(pending.timer);
    pending.resolve(failedResult(pending.request, "mcp_bridge_disconnected", "CareerAdapt MCP 桥接已断开。"));
    pendingCalls.delete(requestId);
  }
  return true;
}

export function heartbeatCareerAdaptMcpBridge(bridgeId: string, token: string) {
  const bridge = requireBridge(bridgeId, token);
  bridge.lastHeartbeatAt = Date.now();
  return statusCareerAdaptMcpBridge();
}

export function pollCareerAdaptMcpBridge(bridgeId: string, token: string, limit = 4) {
  const bridge = requireBridge(bridgeId, token);
  bridge.lastHeartbeatAt = Date.now();
  requeueExpired(bridge);
  const requests = bridge.queue.splice(0, Math.max(1, Math.min(8, Math.trunc(limit))));
  for (const request of requests) bridge.inflight.set(request.id, request);
  return requests.map((request) => ({
    id: request.id,
    name: request.name,
    input: request.input,
    operationId: request.operationId
  }));
}

export function completeCareerAdaptMcpBridgeCall(
  bridgeId: string,
  token: string,
  requestId: string,
  result: CareerToolResult
) {
  const bridge = requireBridge(bridgeId, token);
  bridge.lastHeartbeatAt = Date.now();
  bridge.inflight.delete(requestId);
  const pending = pendingCalls.get(requestId);
  if (!pending || pending.bridgeId !== bridgeId) return false;
  clearTimeout(pending.timer);
  pendingCalls.delete(requestId);
  pending.resolve(result);
  return true;
}

export function careerAdaptMcpBridgeContracts() {
  const bridge = activeBridge();
  return bridge?.contracts ?? [];
}

export function statusCareerAdaptMcpBridge(): CareerAdaptMcpBridgeStatus {
  const bridge = activeBridge();
  return {
    connected: Boolean(bridge),
    server: "careeradapt",
    discoveredToolCount: bridge?.contracts.length ?? 0,
    ...(bridge ? {
      lastHeartbeatAt: new Date(bridge.lastHeartbeatAt).toISOString(),
      bridgeId: bridge.id
    } : {})
  };
}

export function createCareerAdaptMcpBridgeGateway() {
  return {
    listContracts: () => {
      const bridge = activeBridge();
      if (!bridge) throw new CareerAdaptMcpUnavailableError();
      return bridge.contracts;
    },
    execute: (_name: string, _input: unknown, context: CareerToolExecutionContext = {}) => enqueueCall(_name, _input, context)
  };
}

function enqueueCall(name: string, input: unknown, context: CareerToolExecutionContext): Promise<CareerToolResult> {
  const bridge = activeBridge();
  if (!bridge) throw new CareerAdaptMcpUnavailableError();
  const operationId = context.operationId ?? `mcp-bridge-${nanoid(16)}`;
  const request: BridgeRequest = {
    id: `mcp-request-${nanoid(16)}`,
    name,
    input,
    operationId,
    createdAt: Date.now()
  };
  bridge.queue.push(request);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(request.id);
      bridge.inflight.delete(request.id);
      resolve(failedResult(request, "mcp_bridge_timeout", "等待本地 CareerAdapt 工作区响应超时。"));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(request.id, { bridgeId: bridge.id, request, timer, resolve });
  });
}

function activeBridge() {
  const bridge = [...bridges.values()][0];
  if (!bridge) return undefined;
  if (Date.now() - bridge.lastHeartbeatAt > BRIDGE_TTL_MS) {
    disconnectCareerAdaptMcpBridge(bridge.id);
    return undefined;
  }
  return bridge;
}

function requireBridge(bridgeId: string, token: string) {
  const bridge = bridges.get(bridgeId);
  if (!bridge || bridge.token !== token || activeBridge()?.id !== bridgeId) {
    throw new CareerAdaptMcpUnavailableError("CareerAdapt MCP 桥接会话已失效。");
  }
  return bridge;
}

function requeueExpired(bridge: BridgeRecord) {
  for (const [requestId, request] of bridge.inflight) {
    if (Date.now() - request.createdAt < 30_000) continue;
    bridge.inflight.delete(requestId);
    if (pendingCalls.has(requestId)) bridge.queue.unshift(request);
  }
}

function sanitizeContract(contract: CareerToolContract): CareerToolContract {
  return {
    name: contract.name,
    description: contract.description,
    sourceToolName: contract.sourceToolName,
    namespace: contract.namespace,
    inputSchema: contract.inputSchema,
    outputSchema: contract.outputSchema,
    readWrite: contract.readWrite,
    safetyClass: contract.safetyClass,
    confirmationPolicy: contract.confirmationPolicy,
    idempotencyKeyPolicy: contract.idempotencyKeyPolicy,
    personProfileBinding: contract.personProfileBinding,
    artifactBehavior: contract.artifactBehavior,
    errorTaxonomy: contract.errorTaxonomy
  };
}

function failedResult(request: BridgeRequest, code: string, message: string): CareerToolResult {
  return {
    ok: false,
    error: {
      code,
      category: "recoverable",
      message,
      recoverable: true,
      retryHint: "请确认 CareerAdapt 工作区仍在运行后重试。"
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
