import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CareerAdaptMcpProtocolServer } from "@/agent/mcp/CareerAdaptMcpServer";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import type { HermesBridgeTransport, HermesTurnRequest } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { resolveCareerSessionBinding } from "@/agent/runtime/careerSessionBinding";
import { RuntimeHealthSchema, isRoadshowReady } from "@/agent/runtime/runtimeHealth";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { NativeCareerAgentRuntime } from "@/agent/runtime/NativeCareerAgentRuntime";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { allHermesWorkflowsCovered, evaluateHermesWorkflowCoverage, HERMES_WORKFLOW_MATRIX } from "@/agent/runtime/hermes/hermesWorkflowMatrix";

const AnyInput = z.object({}).passthrough();
const AnyOutput = z.object({}).passthrough();

describe("P4.4d Hermes runtime closure", () => {
  it("uses one readiness contract and never treats an unconfigured provider as roadshow-ready", () => {
    const health = RuntimeHealthSchema.parse({
      runtimeId: "hermes",
      runtimeAvailable: true,
      providerConfigured: true,
      providerReachable: true,
      model: "roadshow-model",
      toolCallingAvailable: true,
      mcpConnected: true,
      mcpToolCount: 42,
      careerSkillsLoaded: true,
      lastCheckedAt: "2026-08-08T10:00:00.000Z"
    });
    expect(isRoadshowReady(health)).toBe(true);
    expect(isRoadshowReady({ ...health, providerReachable: false })).toBe(false);
  });

  it("falls back when a Hermes stream ends before its first event", async () => {
    const native = new NativeCareerAgentRuntime({ runTurn: async () => ({ fallback: true }) });
    const hermes = new HermesCareerAgentRuntime({
      transport: {
        health: async () => ({ available: true }),
        createSession: async () => ({ sessionId: "hermes-empty", resumed: false }),
        resumeSession: async () => ({ sessionId: "hermes-empty", resumed: true }),
        turn: async function* () { /* intentionally empty */ },
        toolCallback: async () => undefined,
        interrupt: async () => undefined
      },
      careerToolGateway: new CareerToolGateway(new AgentToolRegistry([]))
    });
    const router = new AgentRuntimeRouter({ native, hermes, configuration: { agentRuntime: "hermes" } });
    const events = [];
    for await (const event of router.active().runTurn({ sessionId: "p44d-empty", userMessage: "继续", pageContext: { query: {} } })) events.push(event);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { fallback: true, fallbackUsed: true } });
  });

  it("resolves the persisted Agent Session binding and rejects page-context replacement", () => {
    const session = {
      id: "agent-session-p44d",
      personId: "person-1",
      activeProfileId: "profile-1",
      profileVersionNumber: 2,
      profileRevision: 7
    };
    expect(resolveCareerSessionBinding({
      sessionId: session.id,
      session,
      pageContext: {
        agentSessionId: session.id,
        personId: session.personId,
        profileId: session.activeProfileId,
        profileVersionNumber: session.profileVersionNumber,
        profileRevision: session.profileRevision
      }
    })).toEqual({
      agentSessionId: "agent-session-p44d",
      personId: "person-1",
      profileId: "profile-1",
      profileVersionNumber: 2,
      profileRevision: 7
    });
    expect(() => resolveCareerSessionBinding({
      sessionId: session.id,
      session,
      pageContext: { ...session, profileId: "profile-2" }
    })).toThrow(/不能替换/iu);
  });

  it("fails closed for a missing or mismatched Hermes binding before a tool write", async () => {
    let calls = 0;
    const gateway = new CareerToolGateway({
      registry: new AgentToolRegistry([
        tool("commit_profile_intake", true, async () => { calls += 1; return { committed: true }; })
      ])
    });
    const missing = await gateway.execute("career.profile.commit_intake", {}, {
      operationId: "p44d-binding-missing",
      requireSessionBinding: true
    });
    expect(missing).toMatchObject({ ok: false, error: { code: "career_session_binding_required" } });

    const mismatched = await gateway.execute("career.profile.commit_intake", { profileId: "profile-2" }, {
      operationId: "p44d-binding-mismatch",
      requireSessionBinding: true,
      careerSessionBinding: binding()
    });
    expect(mismatched).toMatchObject({ ok: false, error: { code: "career_session_binding_profile_mismatch" } });
    expect(calls).toBe(0);
  });

  it("passes the fixed binding through a Hermes turn and filters list results", async () => {
    const requests: HermesTurnRequest[] = [];
    const callbacks: unknown[] = [];
    const gateway = new CareerToolGateway({
      registry: new AgentToolRegistry([
        tool("list_profiles", false, async () => ({ profiles: [
          { id: "profile-1", personId: "person-1" },
          { id: "profile-2", personId: "person-2" }
        ] }))
      ])
    });
    const transport: HermesBridgeTransport = {
      health: async () => ({ available: true, mcpConnected: true }),
      createSession: async () => ({ sessionId: "hermes-session-p44d", resumed: false }),
      resumeSession: async () => ({ sessionId: "hermes-session-p44d", resumed: true }),
      turn: async function* (request) {
        requests.push(request);
        yield { type: "tool_call_requested", toolCallId: "call-p44d", toolName: "career.profile.list", operationId: "p44d-tool-01", input: {} };
        yield { type: "text_delta", delta: "已读取" };
        yield { type: "turn_completed", data: { structuredOutputValid: true } };
      },
      toolCallback: async (input) => { callbacks.push(input); },
      interrupt: async () => undefined
    };
    const runtime = new HermesCareerAgentRuntime({ transport, careerToolGateway: gateway });
    const events = [];
    for await (const event of runtime.runTurn({
      sessionId: "agent-session-p44d",
      userMessage: "读取资料",
      pageContext: { query: {} },
      session: {
        id: "agent-session-p44d",
        personId: "person-1",
        activeProfileId: "profile-1",
        profileVersionNumber: 2,
        profileRevision: 7
      } as never,
      metadata: { requireCareerSessionBinding: true }
    })) events.push(event);
    expect(requests[0].careerSessionBinding).toEqual(binding());
    expect(callbacks[0]).toMatchObject({ careerSessionBinding: binding(), result: { ok: true, data: { profiles: [{ id: "profile-1", personId: "person-1" }] } } });
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { telemetry: { firstTokenLatencyMs: expect.any(Number), structuredOutputValid: true } } });
  });

  it("keeps the tailoring facade available after the deterministic analyze_fit transition", async () => {
    const requests: HermesTurnRequest[] = [];
    const runtime = new HermesCareerAgentRuntime({
      transport: {
        health: async () => ({ available: true, mcpConnected: true }),
        createSession: async () => ({ sessionId: "hermes-session-card-3", resumed: false }),
        resumeSession: async () => ({ sessionId: "hermes-session-card-3", resumed: true }),
        turn: async function* (request) {
          requests.push(request);
          yield { type: "turn_completed", data: { structuredOutputValid: true } };
        },
        toolCallback: async () => undefined,
        interrupt: async () => undefined
      },
      careerToolGateway: new CareerToolGateway(new AgentToolRegistry([]))
    });

    for await (const _event of runtime.runTurn({
      sessionId: "agent-card-3",
      userMessage: "",
      pageContext: { query: {} },
      metadata: {
        workflowId: "tailor_existing_resume",
        workflowStage: "analyze_fit",
        allowedToolNames: ["analyze_job_fit"],
        allowedCareerToolNames: ["career.job.analyze_fit"]
      }
    })) {
      // The contract assertion below is the purpose of this turn.
    }

    const contractNames = (requests[0].toolContracts ?? []).map((contract) => String(contract.name));
    expect(contractNames).toEqual(expect.arrayContaining([
      "career.workflow.job_fit",
      "career.workflow.tailor_resume"
    ]));
  });

  it("preserves the original tool input across a Hermes approval boundary", async () => {
    const input = {
      targetProfileId: "profile-1",
      expectedProfileVersion: 2,
      selectedFactIds: ["fact-1"],
      name: "Roadshow 通用简历"
    };
    const gateway = new CareerToolGateway({
      registry: new AgentToolRegistry([
        tool("create_resume_from_profile", true, async () => ({ created: true }))
      ])
    });
    const runtime = new HermesCareerAgentRuntime({
      transport: {
        health: async () => ({ available: true, mcpConnected: true }),
        createSession: async () => ({ sessionId: "hermes-approval-p44d", resumed: false }),
        resumeSession: async () => ({ sessionId: "hermes-approval-p44d", resumed: true }),
        turn: async function* () {
          yield { type: "tool_call_requested", toolCallId: "call-approval-p44d", toolName: "career.resume.create_from_profile", operationId: "p44d-approval-input", input };
          yield { type: "turn_completed", data: { structuredOutputValid: true } };
        },
        toolCallback: async () => undefined,
        interrupt: async () => undefined
      },
      careerToolGateway: gateway
    });
    const events = [];
    for await (const event of runtime.runTurn({
      sessionId: "agent-session-p44d",
      userMessage: "创建通用简历",
      pageContext: { query: {} },
      session: {
        id: "agent-session-p44d",
        personId: "person-1",
        activeProfileId: "profile-1",
        profileVersionNumber: 2,
        profileRevision: 7
      } as never,
      metadata: { requireCareerSessionBinding: true }
    })) events.push(event);
    expect(events.find((event) => event.type === "approval_required")).toMatchObject({
      type: "approval_required",
      data: { input }
    });
  });

  it("does not replay an idempotent operation across different session bindings", async () => {
    const registry = new AgentToolRegistry([
      tool("list_profiles", false, async () => ({ profiles: [{ id: "profile-1", personId: "person-1" }] }))
    ]);
    const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
    const first = await gateway.execute("career.profile.list", {}, {
      operationId: "p44d-operation-binding",
      careerSessionBinding: binding()
    });
    const second = await gateway.execute("career.profile.list", {}, {
      operationId: "p44d-operation-binding",
      careerSessionBinding: { ...binding(), personId: "person-2", profileId: "profile-2" }
    });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: "operation_id_binding_conflict" } });
  });

  it("requires a binding on the production MCP route and reports the six workflow contract matrix", async () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([
      tool("list_profiles", false, async () => ({ profiles: [] }))
    ]));
    const server = new CareerAdaptMcpProtocolServer(gateway, { requireSessionBinding: true, version: "p4.4d" });
    const called = await server.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "career.profile.list", arguments: {}, _meta: {} }
    });
    expect(called).toMatchObject({ id: 1, result: { isError: true, structuredContent: { error: { code: "career_session_binding_required" } } } });
    expect(HERMES_WORKFLOW_MATRIX).toHaveLength(6);
    const contracts = HERMES_WORKFLOW_MATRIX.flatMap((workflow) => workflow.requiredTools)
      .map((name) => ({ name })) as never;
    expect(allHermesWorkflowsCovered(contracts)).toBe(true);
    expect(evaluateHermesWorkflowCoverage(contracts).every((workflow) => workflow.covered)).toBe(true);
  });
});

function binding() {
  return {
    agentSessionId: "agent-session-p44d",
    personId: "person-1",
    profileId: "profile-1",
    profileVersionNumber: 2,
    profileRevision: 7
  } as const;
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
