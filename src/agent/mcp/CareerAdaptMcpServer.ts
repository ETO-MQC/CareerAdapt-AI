import { CareerAdaptMcpAdapter, type CareerAdaptMcpCallMeta, type CareerAdaptMcpGateway } from "./CareerAdaptMcpAdapter";
import type { CareerSessionBinding } from "../runtime/careerSessionBinding";

export const CAREERADAPT_MCP_PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOL_VERSIONS = new Set([
  CAREERADAPT_MCP_PROTOCOL_VERSION,
  "2025-03-26",
  "2024-11-05"
]);

export type McpJsonRpcId = string | number | null;

export type McpJsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

export type McpJsonRpcResponse = {
  jsonrpc: "2.0";
  id: McpJsonRpcId;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: Record<string, unknown>;
  };
};

export class CareerAdaptMcpUnavailableError extends Error {
  readonly code = "mcp_gateway_unavailable";

  constructor(message = "CareerAdapt 工作区尚未连接。") {
    super(message);
  }
}

/**
 * Small protocol-only MCP server.  It can be mounted on Next's Streamable
 * HTTP route or used by a stdio wrapper.  It has no repository dependency and
 * receives all domain behavior through the existing gateway interface.
 */
export class CareerAdaptMcpProtocolServer {
  private readonly adapter: CareerAdaptMcpAdapter;

  constructor(
    gateway: CareerAdaptMcpGateway,
    private readonly metadata: {
      name?: string;
      version?: string;
      requireSessionBinding?: boolean;
    } = {}
  ) {
    this.adapter = new CareerAdaptMcpAdapter(gateway);
  }

  async handle(request: McpJsonRpcRequest): Promise<McpJsonRpcResponse | undefined> {
    const id = normalizeId(request.id);
    const method = typeof request.method === "string" ? request.method : undefined;
    if (!method) return errorResponse(id, -32600, "Invalid Request");
    if (request.id === undefined) {
      // Notifications do not receive a JSON-RPC response.  The server still
      // accepts the lifecycle notification so native MCP clients can finish
      // their initialize handshake normally.
      if (method === "notifications/initialized" || method === "notifications/cancelled") return undefined;
      if (method === "notifications/tools/list_changed") return undefined;
    }

    try {
      switch (method) {
        case "initialize":
          return successResponse(id, initializeResult(request.params, this.metadata));
        case "ping":
          return successResponse(id, {});
        case "tools/list":
          return successResponse(id, { tools: this.adapter.listTools() as unknown as Record<string, unknown>[] });
        case "tools/call":
          return successResponse(id, await this.callTool(request.params));
        case "resources/list":
          return successResponse(id, { resources: [] });
        case "prompts/list":
          return successResponse(id, { prompts: [] });
        default:
          return errorResponse(id, -32601, `Method not found: ${method}`);
      }
    } catch (error) {
      if (error instanceof CareerAdaptMcpUnavailableError) {
        return errorResponse(id, -32002, error.message, { code: error.code });
      }
      return errorResponse(id, -32603, "CareerAdapt MCP request failed.", {
        code: safeErrorCode(error)
      });
    }
  }

  getDiscoveredToolCount() {
    return this.adapter.listTools().length;
  }

  private async callTool(params: unknown) {
    const value = asRecord(params);
    const name = typeof value.name === "string" ? value.name : undefined;
    if (!name) throw Object.assign(new Error("tools/call requires a tool name."), { code: "mcp_invalid_tool_name" });
    const input = value.arguments && typeof value.arguments === "object" && !Array.isArray(value.arguments)
      ? value.arguments
      : {};
    const meta = readCallMeta(value._meta, this.metadata.requireSessionBinding === true);
    return this.adapter.callTool(name, input, meta);
  }
}

function initializeResult(
  params: unknown,
  metadata: { name?: string; version?: string }
) {
  const value = asRecord(params);
  const requested = typeof value.protocolVersion === "string" ? value.protocolVersion : undefined;
  return {
    protocolVersion: requested && SUPPORTED_PROTOCOL_VERSIONS.has(requested)
      ? requested
      : CAREERADAPT_MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false
      }
    },
    serverInfo: {
      name: metadata.name ?? "careeradapt",
      version: metadata.version ?? "p4.4c",
      ...(typeof value.clientInfo === "object" && value.clientInfo !== null ? { client: "mcp" } : {})
    },
    instructions: "CareerAdapt tools are evidence-bound. Reads may be retried; confirmation and destructive writes remain host-authorized."
  };
}

function readCallMeta(value: unknown, requireSessionBinding: boolean): CareerAdaptMcpCallMeta {
  const meta = asRecord(value);
  const operationId = typeof meta["careeradapt/operationId"] === "string"
    ? meta["careeradapt/operationId"]
    : typeof meta.operationId === "string"
      ? meta.operationId
      : undefined;
  const logicalToolOperationId = typeof meta["careeradapt/logicalToolOperationId"] === "string"
    ? meta["careeradapt/logicalToolOperationId"]
    : typeof meta.logicalToolOperationId === "string"
      ? meta.logicalToolOperationId
      : undefined;
  const careerSessionBinding = readCareerSessionBinding(meta.careerSessionBinding ?? meta["careeradapt/sessionBinding"]);
  return {
    ...(operationId ? { operationId } : {}),
    ...(logicalToolOperationId ? { logicalToolOperationId } : {}),
    ...(careerSessionBinding ? { careerSessionBinding } : {}),
    requireSessionBinding,
    confirmationRequested: meta["careeradapt/confirmationRequested"] === true
      || meta.confirmationRequested === true
  };
}

function readCareerSessionBinding(value: unknown): CareerSessionBinding | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.personId !== "string"
    || typeof candidate.profileId !== "string"
    || typeof candidate.profileVersionNumber !== "number"
    || typeof candidate.profileRevision !== "number"
    || typeof candidate.agentSessionId !== "string"
  ) return undefined;
  return {
    personId: candidate.personId,
    profileId: candidate.profileId,
    profileVersionNumber: candidate.profileVersionNumber,
    profileRevision: candidate.profileRevision,
    agentSessionId: candidate.agentSessionId
  };
}

function successResponse(id: McpJsonRpcId, result: Record<string, unknown>): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(
  id: McpJsonRpcId,
  code: number,
  message: string,
  data?: Record<string, unknown>
): McpJsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } };
}

function normalizeId(value: unknown): McpJsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "mcp_internal_error";
}
