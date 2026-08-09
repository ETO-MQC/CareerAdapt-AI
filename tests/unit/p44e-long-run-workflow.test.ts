import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import type { AgentRuntimeTurnInput } from "@/agent/runtime/agentRuntime";
import { HttpHermesBridgeTransport, type HermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";

const Any = z.object({}).passthrough();

describe("P4.4e Hermes long-run closure", () => {
  it("starts one official run and exposes a persistable handle through terminal completion", async () => {
    let starts = 0;
    let legacyTurns = 0;
    const transport = runsTransport({
      startRun: async () => { starts += 1; return { runId: "run-p44e-1", status: "started" }; },
      runEvents: async function* () {
        yield { type: "text_delta", delta: "已整理" } as const;
        yield { type: "turn_completed", message: "完成", data: { output: "完成" } } as const;
      },
      turn: async function* () { legacyTurns += 1; }
    });
    const events = [];
    for await (const event of runtime(transport).runTurn(turnInput())) events.push(event);

    expect(starts).toBe(1);
    expect(legacyTurns).toBe(0);
    expect(events[0]).toMatchObject({ type: "progress", data: { runHandle: { runId: "run-p44e-1", status: "running" } } });
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", data: { runHandle: { runId: "run-p44e-1", status: "completed" } } });
  });

  it("reattaches a persisted running handle without creating a duplicate run", async () => {
    let starts = 0;
    const transport = runsTransport({
      startRun: async () => { starts += 1; return { runId: "duplicate", status: "started" }; },
      runEvents: async function* () { yield { type: "turn_completed", message: "恢复完成" } as const; }
    });
    const input = turnInput();
    input.session = {
      id: input.sessionId,
      personId: "person-1",
      activeProfileId: "profile-1",
      profileVersionNumber: 1,
      profileRevision: 1,
      hermesRun: {
        runId: "run-existing",
        hermesSessionId: "hermes-existing",
        careerAgentSessionId: input.sessionId,
        turnId: "turn-existing",
        status: "running",
        startedAt: "2026-08-09T01:00:00.000Z",
        lastEventAt: "2026-08-09T01:00:01.000Z"
      }
    } as never;
    const events = [];
    for await (const event of runtime(transport).runTurn(input)) events.push(event);

    expect(starts).toBe(0);
    expect(events[0]).toMatchObject({ type: "turn_resumed", data: { runHandle: { runId: "run-existing" } } });
  });

  it("sends attachment metadata through the runtime bridge without file contents", async () => {
    let body: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, data: { runId: "run-attachment", status: "started" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }));
    try {
      await new HttpHermesBridgeTransport("/hermes").startRun!({
        sessionId: "hermes-attachment",
        turnId: "turn-attachment",
        userMessage: "导入这份简历",
        pageContext: { query: {} },
        toolContracts: [],
        attachments: [{ id: "attachment-local-1", fileName: "resume.docx", mimeType: "application/docx", size: 128, purpose: "resume_import" }]
      });
      expect(body).toMatchObject({
        action: "run_start",
        attachments: [{ id: "attachment-local-1", fileName: "resume.docx", size: 128, purpose: "resume_import" }]
      });
      expect(JSON.stringify(body)).not.toContain("base64");
      expect(JSON.stringify(body)).not.toContain("fileBytes");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps Hermes data-only SSE lifecycle events using the payload event name", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response([
      'data: {"event":"message.delta","delta":"处理中"}',
      "",
      'data: {"event":"run.completed","output":"完成"}',
      ""
    ].join("\n"), { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    try {
      const events = [];
      for await (const event of new HttpHermesBridgeTransport("/hermes").runEvents!("run-sse")) events.push(event);
      expect(events).toEqual([
        { type: "text_delta", delta: "处理中" },
        { type: "turn_completed", data: { event: "run.completed", output: "完成" }, message: "完成" }
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("publishes and executes the profile intake facade through existing atomic tools", async () => {
    const registry = new AgentToolRegistry([{
      name: "capture_profile_intake",
      description: "capture",
      risk: "write",
      requiresConfirmation: false,
      idempotent: true,
      resumable: true,
      category: "profile",
      dataScope: "profile",
      producesArtifact: true,
      external: false,
      inputSchema: Any,
      outputSchema: Any,
      execute: async (input) => ({ understood: input, changedAssets: ["项目 A"] })
    }]);
    const gateway = new CareerToolGateway(registry);
    expect(gateway.listContracts().some((contract) => contract.name === "career.workflow.profile_intake_turn")).toBe(true);
    const result = await gateway.execute("career.workflow.profile_intake_turn", {
      userTurn: "我在项目 A 负责数据处理。",
      agentSessionId: "agent-p44e",
      profileId: "profile-1",
      expectedProfileRevision: 1,
      messageId: "message-p44e",
      turnId: "turn-p44e",
      capturedAt: "2026-08-09T01:00:00.000Z"
    }, {
      operationId: "operation-p44e-facade",
      requireSessionBinding: true,
      careerSessionBinding: binding()
    });
    expect(result).toMatchObject({
      ok: true,
      data: { status: "waiting_for_user", nextAction: "ask_high_value_gap" },
      receipt: { toolName: "career.workflow.profile_intake_turn" }
    });
  });

  it("keeps the authoritative tailoring session in the facade checkpoint", async () => {
    const registry = new AgentToolRegistry([{
      name: "create_tailoring_session",
      description: "create tailoring session",
      risk: "write",
      requiresConfirmation: false,
      idempotent: true,
      resumable: true,
      category: "tailoring",
      dataScope: "career_assets",
      producesArtifact: true,
      external: false,
      inputSchema: Any,
      outputSchema: Any,
      execute: async () => ({
        session: {
          id: "tailoring-session-p44e",
          plan: { questionPlan: { questionIds: ["intensity"] } },
          branch: { id: "branch-p44e" },
          job: { id: "job-p44e" }
        },
        candidateQuestionCount: 1
      })
    }]);
    const result = await new CareerToolGateway(registry).execute("career.workflow.tailor_resume", {
      profileId: "profile-1",
      resumeId: "resume-1",
      jobId: "job-1"
    }, {
      operationId: "operation-p44e-tailoring",
      requireSessionBinding: true,
      careerSessionBinding: binding()
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        status: "waiting_for_user",
        workflowCheckpoint: {
          kind: "tailoring_session",
          session: { id: "tailoring-session-p44e", plan: { questionPlan: { questionIds: ["intensity"] } } }
        }
      }
    });
  });

  it("stops a third identical MCP call in one turn before another domain execution", async () => {
    const client = new CareerAdaptMcpBridgeClient();
    let executions = 0;
    let poll = 0;
    const seen: Array<{ ok: boolean; error?: { code?: string } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      if (method === "POST" && body.action === "register") {
        return Response.json({ ok: true, bridgeId: "bridge-p44e", token: "token-p44e", discoveredToolCount: 1 });
      }
      if (method === "GET") {
        poll += 1;
        return Response.json({ ok: true, requests: poll <= 3 ? [{
          id: `request-${poll}`,
          name: "career.test.read",
          input: { same: true },
          operationId: `operation-loop-${poll}`
        }] : [] });
      }
      return Response.json({ ok: true });
    }));
    try {
      await client.start({
        listContracts: () => [{ name: "career.test.read" }] as never,
        execute: async (_name, _input, context) => {
          executions += 1;
          return {
            ok: true,
            data: { unchanged: true },
            artifacts: [],
            receipt: { operationId: context?.operationId ?? "operation", toolName: "career.test.read", status: "completed", completedAt: new Date().toISOString() }
          };
        }
      }, undefined, undefined, ({ result }) => { seen.push(result); });
      client.setConfirmationContext({ sessionId: "session-loop", turnId: "turn-loop", assistantMessageId: "assistant-loop" });
      await expect.poll(() => seen.length, { timeout: 2_000 }).toBe(3);
      expect(executions).toBe(2);
      expect(seen[2]).toMatchObject({ ok: false, error: { code: "career_agent_no_progress" } });
    } finally {
      await client.stop();
      vi.unstubAllGlobals();
    }
  });
});

function runtime(transport: HermesBridgeTransport) {
  return new HermesCareerAgentRuntime({ transport, careerToolGateway: new CareerToolGateway(new AgentToolRegistry([])) });
}

function turnInput(): AgentRuntimeTurnInput {
  return {
    sessionId: "agent-p44e",
    turnId: "turn-p44e",
    userMessage: "继续",
    pageContext: { query: {} }
  };
}

function binding() {
  return { agentSessionId: "agent-p44e", personId: "person-1", profileId: "profile-1", profileVersionNumber: 1, profileRevision: 1 };
}

function runsTransport(overrides: Partial<HermesBridgeTransport> = {}): HermesBridgeTransport {
  return {
    health: async () => ({ available: true, mcpConnected: true }),
    createSession: async ({ sessionId }) => ({ sessionId, resumed: false }),
    resumeSession: async ({ sessionId }) => ({ sessionId, resumed: true }),
    turn: async function* () {},
    toolCallback: async () => undefined,
    interrupt: async () => undefined,
    startRun: async () => ({ runId: "run-p44e", status: "started" }),
    getRun: async () => ({ run_id: "run-p44e", status: "completed", output: "完成" }),
    runEvents: async function* () { yield { type: "turn_completed", message: "完成" }; },
    approveRun: async (runId) => ({ run_id: runId, status: "running" }),
    stopRun: async (runId) => ({ run_id: runId, status: "stopping" }),
    ...overrides
  };
}
