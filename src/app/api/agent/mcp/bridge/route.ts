import { NextResponse, type NextRequest } from "next/server";
import type { CareerToolContract, CareerToolResult } from "@/agent/tools/CareerToolGateway";
import {
  completeCareerAdaptMcpBridgeCall,
  disconnectCareerAdaptMcpBridge,
  heartbeatCareerAdaptMcpBridge,
  pollCareerAdaptMcpBridge,
  registerCareerAdaptMcpBridge
} from "@/server/careerAdaptMcpBridgeRegistry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const bridgeId = request.nextUrl.searchParams.get("bridgeId");
  const token = request.nextUrl.searchParams.get("token");
  if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, requests: pollCareerAdaptMcpBridge(bridgeId, token) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return bridgeError(error);
  }
}

export async function POST(request: NextRequest) {
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
      const contracts = Array.isArray(value.contracts)
        ? value.contracts.filter(isCareerToolContract)
        : [];
      return NextResponse.json({ ok: true, ...registerCareerAdaptMcpBridge(contracts) });
    }
    const bridgeId = typeof value.bridgeId === "string" ? value.bridgeId : undefined;
    const token = typeof value.token === "string" ? value.token : undefined;
    if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
    if (action === "heartbeat") {
      return NextResponse.json({ ok: true, status: heartbeatCareerAdaptMcpBridge(bridgeId, token) });
    }
    if (action === "result") {
      const requestId = typeof value.requestId === "string" ? value.requestId : undefined;
      if (!requestId || !isCareerToolResult(value.result)) {
        return NextResponse.json({ ok: false, error: "invalid_result" }, { status: 400 });
      }
      completeCareerAdaptMcpBridgeCall(bridgeId, token, requestId, value.result);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
  } catch (error) {
    return bridgeError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const bridgeId = request.nextUrl.searchParams.get("bridgeId");
  const token = request.nextUrl.searchParams.get("token");
  if (!bridgeId || !token) return NextResponse.json({ ok: false, error: "bridge_credentials_required" }, { status: 400 });
  disconnectCareerAdaptMcpBridge(bridgeId, token);
  return NextResponse.json({ ok: true });
}

function isCareerToolContract(value: unknown): value is CareerToolContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.name === "string"
    && typeof candidate.description === "string"
    && typeof candidate.sourceToolName === "string"
    && typeof candidate.namespace === "string"
    && typeof candidate.inputSchema === "object"
    && typeof candidate.outputSchema === "object"
    && (candidate.readWrite === "read" || candidate.readWrite === "write")
    && typeof candidate.safetyClass === "string"
    && typeof candidate.confirmationPolicy === "string"
    && typeof candidate.idempotencyKeyPolicy === "string"
    && typeof candidate.personProfileBinding === "string"
    && typeof candidate.artifactBehavior === "string"
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
