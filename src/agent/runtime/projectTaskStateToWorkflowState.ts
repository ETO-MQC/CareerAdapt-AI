import type {
  AgentSession,
  AgentTaskState,
  AgentWorkflowState
} from "@/agent/contracts/agentSession";

/**
 * Legacy workflowState is a persistence/UI projection only. Runtime decisions
 * must always read AgentTaskState and then call this helper after transitions.
 */
export function projectTaskStateToWorkflowState(
  taskState: AgentTaskState,
  previous?: AgentWorkflowState
): AgentWorkflowState {
  return {
    workflowId: taskState.workflowId,
    step: taskState.stage,
    status: projectCompletionStatus(taskState.completionStatus),
    toolCallCount: previous?.toolCallCount ?? 0,
    pendingOperationId: previous?.pendingOperationId,
    pendingToolName: previous?.pendingToolName,
    data: projectCompatibleSlots(taskState.knownSlots),
    error: previous?.error
  };
}

export function projectTaskStateIntoSession(
  session: AgentSession,
  taskState: AgentTaskState
): AgentSession {
  return {
    ...session,
    taskState,
    workflowState: projectTaskStateToWorkflowState(taskState, session.workflowState)
  };
}

function projectCompletionStatus(
  status: AgentTaskState["completionStatus"]
): AgentWorkflowState["status"] {
  if (status === "waiting_for_confirmation") return "waiting_for_confirmation";
  if (status === "waiting_for_user") return "waiting_for_user";
  if (status === "completed" || status === "cancelled") return "completed";
  if (status === "failed") return "failed";
  return "running";
}

function projectCompatibleSlots(slots: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(slots).flatMap(([key, value]) => {
      if (
        value === null
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
        || (Array.isArray(value) && value.every((item) => typeof item === "string"))
      ) {
        return [[key, value]];
      }
      return [];
    })
  );
}
