import { describe, expect, it } from "vitest";
import { AgentMessageSchema } from "@/agent/contracts/agentSession";

describe("agent option actions", () => {
  it("stores structured actions instead of plain message values", () => {
    const message = AgentMessageSchema.parse({
      id: "m1",
      role: "assistant",
      content: "是否取消？",
      options: [{
        id: "cancel-job",
        label: "确认取消",
        action: { type: "cancel_workflow", workflowId: "job_ingestion" }
      }],
      createdAt: new Date().toISOString()
    });
    expect(message.options?.[0].action).toEqual({ type: "cancel_workflow", workflowId: "job_ingestion" });
  });
});

