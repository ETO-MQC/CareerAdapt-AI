import type { AgentTaskState } from "@/agent/contracts/agentSession";
import {
  AgentTaskCompletionGuard,
  type AgentTaskCompletionDecision
} from "./AgentTaskCompletionGuard";

/**
 * Host-facing completion proof for durable Career goals.  Hermes may propose
 * a result in prose, but this guard only accepts the authoritative task
 * projection produced by the Career workflow and its receipts.
 */
export class AgentGoalCompletionGuard {
  private readonly taskGuard = new AgentTaskCompletionGuard();

  evaluate(state: AgentTaskState): AgentTaskCompletionDecision {
    const decision = this.taskGuard.evaluate(state);
    if (!isTransactionalGoal(state)) return decision;
    if (state.completionStatus === "failed" || state.completionStatus === "cancelled") return decision;
    if (decision.reason === "waiting_for_user" || decision.reason === "waiting_for_confirmation") return decision;
    return decision;
  }

  /** Used by terminal narration to prevent a model-only resume claim. */
  requiresAuthoritativeEvidence(state: AgentTaskState) {
    const decision = this.evaluate(state);
    return isTransactionalGoal(state) && !decision.canFinish;
  }
}

function isTransactionalGoal(state: AgentTaskState) {
  return state.workflowId !== "conversation"
    && !["conversation", "career_exploration"].includes(state.rootGoal);
}

