import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { CareerAdaptMcpProtocolServer } from "@/agent/mcp/CareerAdaptMcpServer";
import { HttpHermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import {
  completeCareerAdaptMcpBridgeCall,
  createCareerAdaptMcpBridgeGateway,
  disconnectCareerAdaptMcpBridge,
  pollCareerAdaptMcpBridge,
  registerCareerAdaptMcpBridge,
  setCareerAdaptMcpBridgeBinding
} from "@/server/careerAdaptMcpBridgeRegistry";

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

  it("keeps official API-server MCP calls bound to the active browser turn", async () => {
    const registered = registerCareerAdaptMcpBridge(createGateway().listContracts());
    const binding = {
      personId: "person-1",
      profileId: "profile-1",
      profileVersionNumber: 1,
      profileRevision: 2,
      agentSessionId: "session-1"
    };
    try {
      setCareerAdaptMcpBridgeBinding(registered.bridgeId, registered.token, binding);
      const pending = createCareerAdaptMcpBridgeGateway().execute("career.profile.list", {}, {
        operationId: "p44d-binding-01",
        requireSessionBinding: true
      });
      const [request] = pollCareerAdaptMcpBridge(registered.bridgeId, registered.token);
      expect(request).toMatchObject({
        name: "career.profile.list",
        careerSessionBinding: binding,
        requireSessionBinding: true
      });
      expect(completeCareerAdaptMcpBridgeCall(registered.bridgeId, registered.token, request.id, {
        ok: true,
        data: { profiles: [] },
        artifacts: [],
        receipt: {
          operationId: request.operationId,
          toolName: request.name,
          status: "completed",
          completedAt: new Date().toISOString()
        }
      })).toBe(true);
      await expect(pending).resolves.toMatchObject({ ok: true, data: { profiles: [] } });
    } finally {
      disconnectCareerAdaptMcpBridge(registered.bridgeId, registered.token);
    }
  });

  it("surfaces MCP confirmation-required writes to the active host turn", async () => {
    const gateway = createGateway();
    const client = new CareerAdaptMcpBridgeClient();
    const request = {
      id: "mcp-request-confirmation",
      name: "career.profile.commit_intake",
      input: { profileId: "profile-1", draftId: "draft-1" },
      operationId: "p44c-confirm-01"
    };
    let nextPoll = true;
    let seen: unknown;
    let resolveSeen: (() => void) | undefined;
    const seenPromise = new Promise<void>((resolve) => { resolveSeen = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      if (body?.action === "register") {
        return new Response(JSON.stringify({ ok: true, bridgeId: "bridge-confirm", token: "token-confirm", discoveredToolCount: 2 }), { status: 200 });
      }
      if (body?.action === "result" || body?.action === "heartbeat") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, requests: nextPoll ? [request] : [] }), { status: 200 });
    }));
    try {
      await client.start(gateway, undefined, (confirmation) => {
        seen = confirmation;
        nextPoll = false;
        resolveSeen?.();
      });
      client.setConfirmationContext({
        sessionId: "session-confirm",
        turnId: "turn-confirm",
        assistantMessageId: "assistant-confirm"
      });
      await Promise.race([
        seenPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("confirmation_callback_timeout")), 2_000))
      ]);
      expect(seen).toMatchObject({
        sessionId: "session-confirm",
        turnId: "turn-confirm",
        assistantMessageId: "assistant-confirm",
        toolName: "career.profile.commit_intake",
        operationId: "p44c-confirm-01",
        input: request.input,
        contract: { name: "career.profile.commit_intake", confirmationPolicy: "user_confirmation" }
      });
    } finally {
      await client.stop();
      vi.unstubAllGlobals();
    }
  });

  it("binds Profile Intake evidence to the active CareerAdapt session", async () => {
    let seenInput: unknown;
    let nextPoll = true;
    let resolveSeen: (() => void) | undefined;
    const seenPromise = new Promise<void>((resolve) => { resolveSeen = resolve; });
    const capture = tool("capture_profile_intake", false, async (input) => {
      seenInput = input;
      nextPoll = false;
      resolveSeen?.();
      return { captured: true };
    });
    const gateway = new CareerToolGateway({ registry: new AgentToolRegistry([capture]) });
    const client = new CareerAdaptMcpBridgeClient();
    const binding = {
      personId: "person-1",
      profileId: "profile-1",
      profileVersionNumber: 1,
      profileRevision: 1,
      agentSessionId: "agent-session-1"
    };
    const request = {
      id: "mcp-request-capture",
      name: "career.profile.capture_intake",
      input: { sessionId: "hermes-session-1", targetProfileId: "profile-1" },
      operationId: "p44c-capture-01",
      careerSessionBinding: binding,
      requireSessionBinding: true
    };
    vi.stubGlobal("fetch", vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
      if (body?.action === "register") {
        return new Response(JSON.stringify({ ok: true, bridgeId: "bridge-capture", token: "token-capture", discoveredToolCount: 1 }), { status: 200 });
      }
      if (body?.action === "result" || body?.action === "heartbeat") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (init?.method === "DELETE") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify({ ok: true, requests: nextPoll ? [request] : [] }), { status: 200 });
    }));
    try {
      await client.start(gateway);
      await Promise.race([
        seenPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("capture_callback_timeout")), 2_000))
      ]);
      expect(seenInput).toMatchObject({
        sessionId: "agent-session-1",
        targetProfileId: "profile-1"
      });
    } finally {
      await client.stop();
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

function tool(name: string, requiresConfirmation: boolean, execute: (input?: unknown) => Promise<unknown>) {
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
