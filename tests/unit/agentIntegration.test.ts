import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentRuntime, type AgentPlanner } from "@/agent/runtime/agentRuntime";
import { AgentEventBus } from "@/agent/runtime/agentEventBus";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentToolRegistry } from "@/agent/tools/registry";
import type { AgentSession } from "@/agent/contracts/agentSession";

describe("agent orchestration integration", () => {
  it("runs planner -> local tool -> confirmation -> apply -> complete", async () => {
    let plannerTurn = 0;
    const planner: AgentPlanner = async () => {
      plannerTurn += 1;
      if (plannerTurn === 1) return {
        type: "tool_call",
        calls: [{ toolName: "analyze", operationId: "analyze-operation-1", input: {} }]
      };
      if (plannerTurn === 2) return {
        type: "request_confirmation",
        message: "Apply the reviewed change?",
        call: { toolName: "apply", operationId: "apply-operation-1", input: {} }
      };
      return { type: "workflow_complete", message: "Completed with a new revision." };
    };
    const apply = vi.fn(async (_: unknown, context: { operationId: string }) => ({ operationId: context.operationId, revisionId: "revision-2" }));
    const registry = new AgentToolRegistry([
      {
        name: "analyze", description: "analyze", risk: "read", requiresConfirmation: false, idempotent: true, resumable: true,
        inputSchema: z.object({}).strict(), outputSchema: z.object({ operationId: z.string(), score: z.number() }),
        execute: async (_, context) => ({ operationId: context.operationId, score: 82 })
      },
      {
        name: "apply", description: "apply", risk: "write", requiresConfirmation: true, idempotent: true, resumable: true,
        inputSchema: z.object({}).strict(), outputSchema: z.object({ operationId: z.string(), revisionId: z.string() }),
        execute: apply
      }
    ]);
    let saved: AgentSession | undefined;
    const runtime = new AgentRuntime(AgentRuntime.create("integration", "analyze"), {
      planner,
      executor: new AgentExecutor(registry),
      persistence: { save: async (session) => (saved = session) },
      eventBus: new AgentEventBus(),
      toolManifest: registry.manifest()
    });
    await runtime.turn("Tailor my resume", { pathname: "/ai-workspace", query: {} });
    expect(saved?.pendingConfirmation?.toolName).toBe("apply");
    await runtime.resolveConfirmation(true, { pathname: "/ai-workspace", query: {} });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().workflowState.status).toBe("completed");
    expect(runtime.getSnapshot().messages.at(-1)?.content).toContain("new revision");
  });
});
