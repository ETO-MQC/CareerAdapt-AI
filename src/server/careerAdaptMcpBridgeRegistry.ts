import { nanoid } from "nanoid";
import type {
  CareerToolContract,
  CareerToolExecutionContext,
  CareerToolResult
} from "@/agent/tools/CareerToolGateway";
import { CareerAdaptMcpUnavailableError } from "@/agent/mcp/CareerAdaptMcpServer";
import { CareerSessionBindingSchema, type CareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { hermesProductionToolNames } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import {
  type CareerToolFailureDiagnostics,
  safeCareerToolArgumentShape
} from "@/agent/tools/careerToolDiagnostics";
import { stableCareerLogicalToolOperationId } from "@/agent/tools/careerToolContract";

export type CareerAdaptMcpSurface = "internal" | "hermes-production";

type BridgeRequest = {
  id: string;
  name: string;
  input: unknown;
  operationId: string;
  logicalToolOperationId?: string;
  logicalTurnId?: string;
  taskId?: string;
  incidentTraceId?: string;
  agentSessionId?: string;
  careerSessionBinding?: CareerSessionBinding;
  requireSessionBinding?: boolean;
  createdAt: number;
};

type BridgeRecord = {
  id: string;
  token: string;
  contracts: CareerToolContract[];
  careerSessionBinding?: CareerSessionBinding;
  queue: BridgeRequest[];
  inflight: Map<string, BridgeRequest>;
  lastHeartbeatAt: number;
};

type PendingCall = {
  bridgeId: string;
  request: BridgeRequest;
  timer?: ReturnType<typeof setTimeout>;
  resolve: (result: CareerToolResult) => void;
};

// A long Career tool can legitimately occupy the browser adapter while the
// page is rendering its progress shell. Heartbeats are still sent every 5s,
// but a short scheduling hiccup must not invalidate an otherwise recoverable
// bridge and turn the Hermes Run into a chain of synthetic tool failures.
const BRIDGE_TTL_MS = 60_000;
const CALL_TIMEOUT_MS = 120_000;
const registryGlobal = globalThis as typeof globalThis & {
  __careerAdaptMcpBridgeRegistry?: {
    bridges: Map<string, BridgeRecord>;
    pendingCalls: Map<string, PendingCall>;
    orphanedPendingCalls: PendingCall[];
  };
};
const sharedRegistry = registryGlobal.__careerAdaptMcpBridgeRegistry ??= {
  bridges: new Map<string, BridgeRecord>(),
  pendingCalls: new Map<string, PendingCall>(),
  orphanedPendingCalls: []
};
sharedRegistry.orphanedPendingCalls ??= [];
const bridges = sharedRegistry.bridges;
const pendingCalls = sharedRegistry.pendingCalls;
const orphanedPendingCalls = sharedRegistry.orphanedPendingCalls;

export type CareerAdaptMcpBridgeStatus = {
  connected: boolean;
  server: "careeradapt";
  discoveredToolCount: number;
  bindingPresent: boolean;
  lastHeartbeatAt?: string;
  bridgeId?: string;
};

export function registerCareerAdaptMcpBridge(
  contracts: CareerToolContract[],
  initialBinding?: unknown
) {
  // A page navigation can briefly leave the previous browser adapter alive
  // while the replacement registers. Do not invalidate that adapter here:
  // its next poll would see a synthetic 404 and immediately register again,
  // causing the old and new pages to replace one another indefinitely. The
  // newest bridge becomes active; the previous bridge is kept until its
  // owner explicitly stops or its heartbeat expires.
  const current = activeBridge();
  if (current) orphanPendingCalls(current.id);
  const bridge: BridgeRecord = {
    id: `careeradapt-bridge-${nanoid(12)}`,
    token: `careeradapt-token-${nanoid(24)}`,
    contracts: contracts.map(sanitizeContract),
    careerSessionBinding: initialBinding === undefined || initialBinding === null
      ? undefined
      : CareerSessionBindingSchema.parse(initialBinding),
    queue: [],
    inflight: new Map(),
    lastHeartbeatAt: Date.now()
  };
  bridges.set(bridge.id, bridge);
  requeueOrphanedCalls(bridge);
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
  orphanPendingCalls(bridgeId);
  return true;
}

export function heartbeatCareerAdaptMcpBridge(bridgeId: string, token: string) {
  const bridge = requireBridge(bridgeId, token);
  bridge.lastHeartbeatAt = Date.now();
  return statusCareerAdaptMcpBridge();
}

/**
 * Official Hermes MCP clients do not forward a custom `_meta` object from the
 * API-server turn body into `tools/call`. Keep the selected binding on the
 * existing browser bridge for the lifetime of the active turn instead of
 * relaxing the domain gateway's fail-closed binding requirement.
 */
export function setCareerAdaptMcpBridgeBinding(bridgeId: string, token: string, value: unknown) {
  const bridge = requireBridge(bridgeId, token);
  bridge.careerSessionBinding = value === undefined || value === null
    ? undefined
    : CareerSessionBindingSchema.parse(value);
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
    operationId: request.operationId,
    logicalToolOperationId: request.logicalToolOperationId,
    logicalTurnId: request.logicalTurnId,
    taskId: request.taskId,
    incidentTraceId: request.incidentTraceId,
    agentSessionId: request.agentSessionId,
    careerSessionBinding: request.careerSessionBinding,
    requireSessionBinding: request.requireSessionBinding
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
  if (pending.timer) clearTimeout(pending.timer);
  pendingCalls.delete(requestId);
  pending.resolve(result);
  return true;
}

export function careerAdaptMcpBridgeContracts(surface: CareerAdaptMcpSurface = "internal") {
  const bridge = activeBridge();
  return bridge ? contractsForSurface(bridge.contracts, surface) : [];
}

export function statusCareerAdaptMcpBridge(): CareerAdaptMcpBridgeStatus {
  const bridge = activeBridge();
  return {
    connected: Boolean(bridge),
    server: "careeradapt",
    discoveredToolCount: bridge?.contracts.length ?? 0,
    bindingPresent: Boolean(bridge?.careerSessionBinding),
    ...(bridge ? {
      lastHeartbeatAt: new Date(bridge.lastHeartbeatAt).toISOString(),
      bridgeId: bridge.id
    } : {})
  };
}

export function createCareerAdaptMcpBridgeGateway(surface: CareerAdaptMcpSurface = "internal") {
  return {
    listContracts: () => {
      const bridge = activeBridge();
      if (!bridge) throw new CareerAdaptMcpUnavailableError();
      return contractsForSurface(bridge.contracts, surface);
    },
    execute: (_name: string, _input: unknown, context: CareerToolExecutionContext = {}) => {
      const bridge = activeBridge();
      if (!bridge) throw new CareerAdaptMcpUnavailableError();
      if (!contractsForSurface(bridge.contracts, surface).some((contract) => contract.name === _name)) {
        return Promise.resolve(failedResult({
          id: `mcp-request-${nanoid(16)}`,
          name: _name,
          input: _input,
          operationId: context.operationId ?? `mcp-bridge-${nanoid(16)}`,
          logicalTurnId: context.logicalTurnId,
          taskId: context.taskId,
          incidentTraceId: context.incidentTraceId,
          createdAt: Date.now()
        }, "career_tool_not_exposed", "当前 Hermes 生产工具面不暴露该 Career 原子工具。"));
      }
      return enqueueCall(_name, _input, context);
    }
  };
}

function contractsForSurface(contracts: CareerToolContract[], surface: CareerAdaptMcpSurface) {
  if (surface === "internal") return contracts;
  const allowed = hermesProductionToolNames();
  return contracts.filter((contract) => allowed.has(contract.name));
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
    logicalToolOperationId: context.logicalToolOperationId
      ?? stableCareerLogicalToolOperationId(context.logicalTurnId, name),
    logicalTurnId: context.logicalTurnId,
    taskId: context.taskId,
    incidentTraceId: context.incidentTraceId,
    agentSessionId: context.agentSessionId,
    careerSessionBinding: context.careerSessionBinding ?? bridge.careerSessionBinding,
    requireSessionBinding: context.requireSessionBinding,
    createdAt: Date.now()
  };
  bridge.queue.push(request);
  return new Promise((resolve) => {
    const pending: PendingCall = {
      bridgeId: bridge.id,
      request,
      resolve
    };
    pending.timer = setTimeout(() => {
      pendingCalls.delete(request.id);
      bridges.get(pending.bridgeId)?.inflight.delete(request.id);
      const orphanedIndex = orphanedPendingCalls.indexOf(pending);
      if (orphanedIndex >= 0) orphanedPendingCalls.splice(orphanedIndex, 1);
      resolve(failedResult(request, "mcp_bridge_timeout", "等待本地 CareerAdapt 工作区响应超时。", "timeout"));
    }, CALL_TIMEOUT_MS);
    pendingCalls.set(request.id, pending);
  });
}

function requeueOrphanedCalls(bridge: BridgeRecord) {
  for (const pending of orphanedPendingCalls.splice(0)) {
    if (pendingCalls.get(pending.request.id) !== pending) continue;
    pending.bridgeId = bridge.id;
    pending.request.createdAt = Date.now();
    bridge.queue.push(pending.request);
  }
}

function activeBridge() {
  pruneExpiredBridges();
  const bridge = [...bridges.values()].at(-1);
  if (!bridge) return undefined;
  return bridge;
}

function orphanPendingCalls(bridgeId: string) {
  for (const [requestId, pending] of pendingCalls) {
    if (pending.bridgeId !== bridgeId) continue;
    pending.bridgeId = "orphaned";
    pending.request.createdAt = Date.now();
    bridges.get(bridgeId)?.inflight.delete(requestId);
    if (!orphanedPendingCalls.includes(pending)) orphanedPendingCalls.push(pending);
    pendingCalls.set(requestId, pending);
  }
}

function pruneExpiredBridges() {
  const now = Date.now();
  for (const bridge of [...bridges.values()]) {
    if (now - bridge.lastHeartbeatAt > BRIDGE_TTL_MS) disconnectCareerAdaptMcpBridge(bridge.id);
  }
}

function requireBridge(bridgeId: string, token: string) {
  const bridge = bridges.get(bridgeId);
  if (!bridge || bridge.token !== token || Date.now() - bridge.lastHeartbeatAt > BRIDGE_TTL_MS) {
    if (bridge && Date.now() - bridge.lastHeartbeatAt > BRIDGE_TTL_MS) bridges.delete(bridgeId);
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
    errorTaxonomy: contract.errorTaxonomy,
    ...(contract.contractVersion ? { contractVersion: contract.contractVersion } : {}),
    ...(contract.contractSchemaHash ? { contractSchemaHash: contract.contractSchemaHash } : {})
  };
}

function failedResult(
  request: BridgeRequest,
  code: string,
  message: string,
  layer: CareerToolFailureDiagnostics["toolFailureLayer"] = "mcp_transport"
): CareerToolResult {
  const diagnostics: CareerToolFailureDiagnostics = {
    toolFailureLayer: layer,
    failureKind: layer === "mcp_jsonrpc"
      ? "mcp_jsonrpc_failed"
      : layer === "mcp_handler"
        ? "mcp_handler_not_reached"
        : layer === "gateway_validation"
          ? "gateway_validation_failed"
          : "workflow_failed",
    failureScope: "mcp_transport",
    safeDomainErrorCode: code,
    toolResultIsError: true,
    failedStage: layer,
    durationMs: Math.max(0, Date.now() - request.createdAt),
    retryable: layer === "timeout",
    operationId: request.operationId,
    logicalToolOperationId: request.logicalToolOperationId
      ?? stableCareerLogicalToolOperationId(request.logicalTurnId, request.name),
    argumentShape: safeCareerToolArgumentShape(request.input),
    mcpCallTrace: {
      toolName: request.name,
      logicalToolOperationId: request.logicalToolOperationId
        ?? stableCareerLogicalToolOperationId(request.logicalTurnId, request.name),
      requestStartedAt: new Date(request.createdAt).toISOString(),
      jsonRpcStatus: "error",
      safeMcpErrorCode: code,
      browserMcpHandlerReached: false,
      gatewayReached: layer === "gateway_validation",
      completedAt: new Date().toISOString()
    },
    ...(request.logicalTurnId ? { logicalTurnId: request.logicalTurnId } : {}),
    ...(request.taskId ? { taskId: request.taskId } : {}),
    completedAt: new Date().toISOString()
  };
  return {
    ok: false,
    error: {
      code,
      category: "recoverable",
      message,
      recoverable: diagnostics.retryable,
      diagnostics,
      retryHint: "请确认 CareerAdapt 工作区仍在运行后重试。"
    },
    diagnostics,
    artifacts: [],
    receipt: {
      operationId: request.operationId,
      toolName: request.name,
      status: "failed",
      completedAt: new Date().toISOString()
    }
  };
}
