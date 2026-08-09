import { nanoid } from "nanoid";
import { NextResponse, type NextRequest } from "next/server";
import { CareerAdaptMcpProtocolServer, type McpJsonRpcRequest } from "@/agent/mcp/CareerAdaptMcpServer";
import type { CareerToolContract, CareerToolResult } from "@/agent/tools/CareerToolGateway";
import {
  completeCareerAdaptMcpBridgeCall,
  disconnectCareerAdaptMcpBridge,
  heartbeatCareerAdaptMcpBridge,
  pollCareerAdaptMcpBridge,
  createCareerAdaptMcpBridgeGateway,
  registerCareerAdaptMcpBridge,
  setCareerAdaptMcpBridgeBinding,
  statusCareerAdaptMcpBridge
} from "@/server/careerAdaptMcpBridgeRegistry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("bridge") === "1") return bridgeGet(request);
  return NextResponse.json({
    server: "careeradapt",
    protocol: "MCP Streamable HTTP",
    status: statusCareerAdaptMcpBridge()
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}

export async function POST(request: NextRequest) {
  if (request.nextUrl.searchParams.get("bridge") === "1") return bridgePost(request);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (!isJsonRpcRequest(body)) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } }, { status: 400 });
  }

  const protocol = new CareerAdaptMcpProtocolServer(createCareerAdaptMcpBridgeGateway(), {
    name: "careeradapt",
    version: "p4.4d",
    requireSessionBinding: true
  });
  const response = await protocol.handle(body);
  if (!response) return new Response(null, { status: 202 });
  const headers = new Headers({
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "MCP-Protocol-Version": typeof body.params === "object" && body.params && "protocolVersion" in body.params
      ? String((body.params as Record<string, unknown>).protocolVersion)
      : "2025-06-18"
  });
  if (body.method === "initialize") headers.set("Mcp-Session-Id", `careeradapt-mcp-${nanoid(12)}`);
  return new Response(JSON.stringify(response), { status: 200, headers });
}

export async function DELETE(request: NextRequest) {
  if (request.nextUrl.searchParams.get("bridge") !== "1") {
    return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
  }
  const bridgeId = request.nextUrl.searchParams.get("bridgeId");
  const token = request.nextUrl.searchParams.get("token");
  if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
  disconnectCareerAdaptMcpBridge(bridgeId, token);
  return NextResponse.json({ ok: true });
}

async function bridgeGet(request: NextRequest) {
  const bridgeId = request.nextUrl.searchParams.get("bridgeId");
  const token = request.nextUrl.searchParams.get("token");
  if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, requests: pollCareerAdaptMcpBridge(bridgeId, token) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return bridgeError(error);
  }
}

async function bridgePost(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }
  const value = body as Record<string, unknown>;
  const action = typeof value.action === "string" ? value.action : undefined;
  try {
    if (action === "register") {
      const contracts = Array.isArray(value.contracts) ? value.contracts.filter(isCareerToolContract) : [];
      return NextResponse.json({ ok: true, ...registerCareerAdaptMcpBridge(contracts) });
    }
    const bridgeId = typeof value.bridgeId === "string" ? value.bridgeId : undefined;
    const token = typeof value.token === "string" ? value.token : undefined;
    if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
    if (action === "heartbeat") {
      return NextResponse.json({ ok: true, status: heartbeatCareerAdaptMcpBridge(bridgeId, token) });
    }
    if (action === "binding") {
      return NextResponse.json({ ok: true, status: setCareerAdaptMcpBridgeBinding(bridgeId, token, value.binding) });
    }
    if (action === "result") {
      const requestId = typeof value.requestId === "string" ? value.requestId : undefined;
      if (!requestId || !isCareerToolResult(value.result)) return NextResponse.json({ ok: false, error: "invalid_result" }, { status: 400 });
      completeCareerAdaptMcpBridgeCall(bridgeId, token, requestId, value.result);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return bridgeError(error);
  }
}

function isJsonRpcRequest(value: unknown): value is McpJsonRpcRequest {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isCareerToolContract(value: unknown): value is CareerToolContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string"
    && typeof candidate.description === "string"
    && typeof candidate.sourceToolName === "string"
    && typeof candidate.namespace === "string"
    && candidate.inputSchema !== null && typeof candidate.inputSchema === "object"
    && candidate.outputSchema !== null && typeof candidate.outputSchema === "object"
    && (candidate.readWrite === "read" || candidate.readWrite === "write")
    && ["READ", "SAFE_WRITE", "CONFIRMATION_WRITE", "DESTRUCTIVE"].includes(String(candidate.safetyClass))
    && ["none", "user_confirmation", "destructive_confirmation"].includes(String(candidate.confirmationPolicy))
    && ["none", "operation_id"].includes(String(candidate.idempotencyKeyPolicy))
    && ["none", "optional", "required"].includes(String(candidate.personProfileBinding))
    && ["none", "produces_artifact"].includes(String(candidate.artifactBehavior))
    && Array.isArray(candidate.errorTaxonomy);
}

function isCareerToolResult(value: unknown): value is CareerToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const receipt = candidate.receipt;
  return typeof candidate.ok === "boolean"
    && Array.isArray(candidate.artifacts)
    && Boolean(receipt && typeof receipt === "object");
}

function bridgeError(error: unknown) {
  const message = error instanceof Error ? error.message : "CareerAdapt MCP bridge request failed.";
  const status = error && typeof error === "object" && "code" in error && error.code === "mcp_gateway_unavailable" ? 503 : 400;
  return NextResponse.json({ ok: false, error: message }, { status });
}
