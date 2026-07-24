import type { AgentWorkflowState } from "../contracts/agentSession";
import type { AgentEvent } from "../contracts/agentEvent";

export function workflowReducer(state: AgentWorkflowState, event: AgentEvent): AgentWorkflowState {
  switch (event.type) {
    case "planning_started":
    case "workflow_resumed":
      return { ...state, status: "running", error: undefined };
    case "tool_started":
      return {
        ...state,
        status: "running",
        pendingOperationId: event.operationId,
        pendingToolName: event.toolName,
        toolCallCount: state.toolCallCount + 1
      };
    case "tool_succeeded":
      return { ...state, status: "running", pendingOperationId: undefined, pendingToolName: undefined };
    case "confirmation_requested":
      return {
        ...state,
        status: "waiting_for_confirmation",
        pendingOperationId: event.operationId,
        pendingToolName: event.toolName
      };
    case "workflow_paused":
      return { ...state, status: "paused" };
    case "workflow_completed":
      return { ...state, status: "completed", pendingOperationId: undefined, pendingToolName: undefined };
    case "tool_failed":
    case "workflow_failed":
      return {
        ...state,
        status: "failed",
        pendingOperationId: undefined,
        pendingToolName: undefined,
        error: {
          code: String(event.payload?.code ?? "workflow_failed"),
          message: event.message ?? "Workflow failed.",
          retryable: Boolean(event.payload?.retryable)
        }
      };
    default:
      return state;
  }
}
