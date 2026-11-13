import { describe, expect, it } from "vitest";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AgentTaskStateReducer, normalizeAgentTaskState } from "@/agent/runtime/AgentTaskStateReducer";
import { deriveAgentTurnLifecycle } from "@/agent/runtime/agentTurnLifecycle";

describe("H4A lifecycle projection", () => {
  it("prioritizes active work, preserves confirmed waiting after the Run, and does not equate a completed Run with a completed task", () => {
    const session = AgentRuntime.createConversationSession();
    const task = new AgentTaskStateReducer().create(session, undefined, { workflowId: "tailor_existing_resume", step: "clarify_target" });
    session.taskState = normalizeAgentTaskState({ ...task, completionStatus: "waiting_for_user" });
    session.activeTurn = { id: "turn", sessionId: session.id, status: "running", startedAt: session.createdAt };
    expect(deriveAgentTurnLifecycle(session)).toBe("RUNNING");
    session.activeTurn.status = "completed";
    expect(deriveAgentTurnLifecycle(session)).toBe("WAITING_FOR_USER");
    session.taskState = { ...task, completionStatus: "active" };
    expect(deriveAgentTurnLifecycle(session)).toBe("IDLE");
    session.taskState = { ...task, completionStatus: "completed" };
    expect(deriveAgentTurnLifecycle(session)).toBe("COMPLETED");
    session.pendingConfirmation = { id: "confirm", operationId: "operation-1", toolName: "commit_job", title: "确认", description: "保存", destructive: false, status: "pending", requestedAt: session.createdAt };
    expect(deriveAgentTurnLifecycle(session)).toBe("WAITING_FOR_CONFIRMATION");
    session.pendingConfirmation = undefined;
    session.activeTurn.status = "aborted";
    expect(deriveAgentTurnLifecycle(session)).toBe("STOPPED");
  });
});
