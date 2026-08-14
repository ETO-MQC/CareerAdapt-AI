import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { HermesCareerAgentRuntime } from "@/agent/runtime/hermes/HermesCareerAgentRuntime";
import type { HermesBridgeTransport } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { NativeCareerAgentRuntime } from "@/agent/runtime/NativeCareerAgentRuntime";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";

const AnyInput = z.object({}).passthrough();
const AnyOutput = z.object({}).passthrough();

describe("P4.4b Hermes runtime bridge", () => {
  it("keeps Hermes as the semantic owner when it is unavailable before the first event", async () => {
    const native = new NativeCareerAgentRuntime({ runTurn: async () => ({ native: true }) });
    const hermes = new HermesCareerAgentRuntime({
      transport: {
        health: async () => ({ available: false, reason: "not configured" }),
        createSession: async () => ({ sessionId: "unused", resumed: false }),
        resumeSession: async () => ({ sessionId: "unused", resumed: true }),
        turn: async function* () { yield { type: "turn_completed", data: { hermes: true } }; },
        toolCallback: async () => undefined,
        interrupt: async () => undefined
      },
      careerToolGateway: gateway()
    });
    const router = new AgentRuntimeRouter({ native, hermes, configuration: { agentRuntime: "hermes" } });
    const events = [];
    for await (const event of router.active().runTurn({ sessionId: "p44b-fallback", userMessage: "继续", pageContext: { query: {} } })) {
      events.push(event);
    }
    expect(events.at(-1)).toMatchObject({
      type: "turn_failed",
      error: { code: "hermes_unavailable_recoverable", recoverable: true },
      data: { telemetry: { fallbackUsed: false, finalRuntime: "hermes" } }
    });
    expect(events.some((event) => event.data && typeof event.data === "object" && "native" in event.data)).toBe(false);
  });

  it("translates tool requests through CareerToolGateway and returns safe callbacks", async () => {
    const callbacks: unknown[] = [];
    const transport: HermesBridgeTransport = {
      health: async () => ({ available: true, runtimeId: "hermes-test", version: "test" }),
      createSession: async () => ({ sessionId: "hermes-session-1", resumed: false }),
      resumeSession: async () => ({ sessionId: "hermes-session-1", resumed: true }),
      turn: async function* () {
        yield { type: "progress", message: "started" };
        yield { type: "tool_call_requested", toolCallId: "call-1", toolName: "career.profile.list", operationId: "p44b-tool-01", input: {} };
        yield { type: "turn_completed", data: { ok: true } };
      },
      toolCallback: async (input) => { callbacks.push(input); },
      interrupt: async () => undefined
    };
    const runtime = new HermesCareerAgentRuntime({ transport, careerToolGateway: gateway() });
    const events = [];
    for await (const event of runtime.runTurn({ sessionId: "p44b-hermes", userMessage: "读取资料", pageContext: { query: {} } })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "progress",
      "tool_call_requested",
      "tool_call_started",
      "tool_call_completed",
      "turn_completed"
    ]);
    expect(callbacks[0]).toMatchObject({ toolName: "career.profile.list", result: { ok: true } });
    expect(events.at(-1)?.data).toMatchObject({ telemetry: { runtimeId: "hermes", toolCalls: 1, toolFailures: 0 } });
  });
});

function gateway() {
  const registry = new AgentToolRegistry([{
    name: "list_profiles",
    description: "List profiles",
    risk: "read",
    requiresConfirmation: false,
    idempotent: true,
    resumable: true,
    category: "profile",
    dataScope: "profile",
    producesArtifact: false,
    external: false,
    inputSchema: AnyInput,
    outputSchema: AnyOutput,
    execute: async () => ({ profiles: [{ id: "profile-1" }] })
  }]);
  return new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });
}
