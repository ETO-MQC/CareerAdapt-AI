import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { CareerAdaptMcpProtocolServer } from "@/agent/mcp/CareerAdaptMcpServer";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";

const AnyInput = z.object({}).passthrough();
const AnyOutput = z.object({}).passthrough();

describe("P4.4c CareerAdapt MCP gateway", () => {
  it("derives MCP discovery from CareerToolGateway contracts", async () => {
    const gateway = createGateway();
    const adapter = new CareerAdaptMcpAdapter(gateway);
    const tools = adapter.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "career.profile.list",
      "career.profile.commit_intake"
    ]));
    expect(tools.find((tool) => tool.name === "career.profile.list")).toMatchObject({
      annotations: { readOnlyHint: true, destructiveHint: false },
      _meta: {
        "careeradapt/namespace": "career.profile",
        "careeradapt/safetyClass": "READ"
      }
    });
    expect(tools.find((tool) => tool.name === "career.profile.commit_intake")).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: false },
      _meta: { "careeradapt/safetyClass": "CONFIRMATION_WRITE" }
    });

    const read = await adapter.callTool("career.profile.list", {}, { operationId: "p44c-read-01" });
    expect(read).toMatchObject({
      structuredContent: { ok: true, data: { profiles: [{ id: "profile-1" }] } },
      _meta: {
        "careeradapt/operationId": "p44c-read-01",
        "careeradapt/safetyClass": "READ"
      }
    });

    const confirmation = await adapter.callTool("career.profile.commit_intake", {}, { operationId: "p44c-write-01" });
    expect(confirmation).toMatchObject({
      isError: true,
      structuredContent: {
        ok: false,
        error: { code: "agent_confirmation_required", category: "permission" },
        receipt: { operationId: "p44c-write-01", status: "confirmation_required" }
      }
    });
  });

  it("handles initialize, discovery, and calls through MCP JSON-RPC", async () => {
    const server = new CareerAdaptMcpProtocolServer(createGateway());
    const initialized = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "test" } }
    });
    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "careeradapt", version: "p4.4c" }
      }
    });

    const listed = await server.handle({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listedTools = (listed?.result?.tools ?? []) as Array<{ name: string }>;
    expect(listedTools.some((tool) => tool.name === "career.profile.list")).toBe(true);

    const called = await server.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "career.profile.list",
        arguments: {},
        _meta: { "careeradapt/operationId": "p44c-jsonrpc-01" }
      }
    });
    expect(called).toMatchObject({
      id: 3,
      result: { structuredContent: { ok: true, receipt: { operationId: "p44c-jsonrpc-01" } } }
    });
  });

  it("translates official Hermes session SSE into the stable runtime stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("event: assistant.delta\ndata: {\"delta\":\"读取完成\"}\n\n"));
        controller.enqueue(encoder.encode("event: assistant.completed\ndata: {\"content\":\"读取完成\"}\n\n"));
        controller.enqueue(encoder.encode("event: run.completed\ndata: {\"completed\":true}\n\n"));
        controller.close();
      }
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" }
    })));
    try {
      const transport = new HttpHermesBridgeTransport("/api/agent/runtime/hermes");
      const events = [];
      for await (const event of transport.turn({
        sessionId: "hermes-session",
        turnId: "p44c-sse-01",
        userMessage: "读取资料",
        pageContext: { query: {} },
        toolContracts: []
      })) events.push(event);
      expect(events).toEqual([
        { type: "text_delta", delta: "读取完成" },
        { type: "turn_completed", message: "读取完成", data: { content: "读取完成" } },
        { type: "turn_completed", data: { completed: true } }
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function createGateway() {
  const registry = new AgentToolRegistry([
    tool("list_profiles", false, async () => ({ profiles: [{ id: "profile-1" }] })),
    tool("commit_profile_intake", true, async () => ({ committed: true }))
  ]);
  return new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
}

function tool(name: string, requiresConfirmation: boolean, execute: () => Promise<unknown>) {
  return {
    name,
    description: `Test ${name}`,
    risk: requiresConfirmation ? "write" as const : "read" as const,
    requiresConfirmation,
    idempotent: true,
    resumable: true,
    category: "test",
    dataScope: "career",
    producesArtifact: false,
    external: false,
    inputSchema: AnyInput,
    outputSchema: AnyOutput,
    execute
  };
}
