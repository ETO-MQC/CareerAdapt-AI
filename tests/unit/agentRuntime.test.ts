import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentRuntime, type AgentPlanner } from "@/agent/runtime/agentRuntime";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentToolRegistry } from "@/agent/tools/registry";
import type { AgentSession } from "@/agent/contracts/agentSession";

function harness(planner: AgentPlanner, maxToolCalls = 12) {
  const registry = new AgentToolRegistry([{
    name: "read",
    description: "read",
    risk: "read" as const,
    requiresConfirmation: false,
    idempotent: true,
    resumable: true,
    inputSchema: z.object({}).strict(),
    outputSchema: z.object({ operationId: z.string(), value: z.string() }),
    execute: async (_, context) => ({ operationId: context.operationId, value: "done" })
  }]);
  let saved: AgentSession | undefined;
  const runtime = new AgentRuntime(AgentRuntime.create("test", "start"), {
    planner,
    executor: new AgentExecutor(registry),
    eventBus: new AgentEventBus(),
    persistence: { save: vi.fn(async (session) => (saved = session)) },
    toolManifest: registry.manifest(),
    maxToolCalls
  });
  return { runtime, saved: () => saved };
}

describe("agent runtime", () => {
  it("pauses and resumes a session", async () => {
    const { runtime } = harness(async () => ({ type: "assistant_message", message: "resumed" }));
    await runtime.pause();
    expect(runtime.getSnapshot().workflowState.status).toBe("paused");
    await runtime.resume({ pathname: "/ai-workspace", query: {} });
    expect(runtime.getSnapshot().messages.at(-1)?.content).toBe("resumed");
  });

  it("stops after the configured maximum number of tool calls", async () => {
    let count = 0;
    const planner: AgentPlanner = async () => ({
      type: "tool_call",
      calls: [{ toolName: "read", operationId: `read-operation-${count++}`, input: {} }]
    });
    const { runtime } = harness(planner, 2);
    await expect(runtime.turn("start", { pathname: "/ai-workspace", query: {} })).rejects.toMatchObject({
      code: "maximum_tool_steps_exceeded"
    });
    expect(runtime.getSnapshot().workflowState.toolCallCount).toBe(2);
    expect(runtime.getSnapshot().workflowState.status).toBe("failed");
  });
});
