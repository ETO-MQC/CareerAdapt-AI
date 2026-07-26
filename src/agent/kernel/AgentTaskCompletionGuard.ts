import type { AgentTaskState } from "@/agent/contracts/agentSession";

export type AgentTaskCompletionDecision =
  | { canFinish: true; reason: "goal_completed" | "waiting_for_user" | "waiting_for_confirmation" | "blocked" | "analysis_complete" | "no_safe_next_step" }
  | { canFinish: false; reason: "task_incomplete"; requiredNextStage: string };

const TERMINAL_STAGES: Record<string, Set<string>> = {
  create_tailored_resume: new Set(["quality_result"]),
  create_resume_from_profile: new Set(["quality_result", "completed"]),
  import_resume: new Set(["import_complete"]),
  export_resume: new Set(["export_complete"]),
  analyze_job_fit: new Set(["generate_plan", "quality_result", "completed"]),
  analyze_resume: new Set(["completed"])
};

export class AgentTaskCompletionGuard {
  evaluate(state: AgentTaskState): AgentTaskCompletionDecision {
    if (state.completionStatus === "waiting_for_confirmation") {
      return { canFinish: true, reason: "waiting_for_confirmation" };
    }
    if (state.completionStatus === "waiting_for_user") {
      return { canFinish: true, reason: "waiting_for_user" };
    }
    if (state.completionStatus === "failed" || state.completionStatus === "cancelled") {
      return { canFinish: true, reason: "blocked" };
    }
    const terminal = TERMINAL_STAGES[state.goal];
    if (!terminal) return { canFinish: true, reason: "no_safe_next_step" };
    if (terminal.has(state.stage) || state.completionStatus === "completed") {
      return {
        canFinish: true,
        reason: state.goal.startsWith("analyze_") ? "analysis_complete" : "goal_completed"
      };
    }
    return {
      canFinish: false,
      reason: "task_incomplete",
      requiredNextStage: requiredNextStage(state)
    };
  }
}

function requiredNextStage(state: AgentTaskState) {
  if (state.goal === "create_tailored_resume") {
    const order = [
      "choose_resume_source",
      "analyze_fit",
      "generate_plan",
      "clarify_unsupported_facts",
      "preview_changes",
      "confirm_apply",
      "quality_result"
    ];
    const index = order.indexOf(state.stage);
    return index >= 0 ? order[Math.min(index + 1, order.length - 1)] : "choose_resume_source";
  }
  if (state.goal === "import_resume") return "import_review";
  if (state.goal === "export_resume") return "export_complete";
  return state.stage;
}
