import type { AgentTaskState } from "@/agent/contracts/agentSession";
import {
  deriveNextLegalStage,
  hasUnresolvedClarifications
} from "@/agent/runtime/TaskContinuationResolver";

export type AgentTaskCompletionDecision =
  | { canFinish: true; reason: "goal_completed" | "waiting_for_user" | "waiting_for_confirmation" | "blocked" | "analysis_complete" | "no_safe_next_step" }
  | {
      canFinish: false;
      reason: "task_incomplete";
      requiredNextStage: string;
      nextAction: AgentNextActionHint;
    };

export type AgentNextActionHint = {
  goal: string;
  stage: string;
  missingSlots: string[];
  requiredNextStage: string;
  legalNextTools: string[];
  selected: AgentTaskState["selectedEntities"];
};

const TERMINAL_STAGES: Record<string, Set<string>> = {
  create_tailored_resume: new Set(["quality_result"]),
  create_resume_from_profile: new Set(["quality_result", "completed"]),
  import_resume: new Set(["import_complete"]),
  export_resume: new Set(["export_complete"]),
  analyze_job_fit: new Set(["generate_plan", "quality_result", "completed"]),
  apply_to_job: new Set(["quality_result"]),
  analyze_resume: new Set(["completed"]),
  ingest_job: new Set(["completed"]),
  archive_resume: new Set(["lifecycle_result"]),
  restore_resume: new Set(["lifecycle_result"])
};

const CONVERSATION_GOALS = new Set(["conversation", "career_exploration"]);
const KNOWN_DOMAIN_GOALS = new Set([
  ...Object.keys(TERMINAL_STAGES),
  "create_tailored_resume",
  "create_resume_from_profile",
  "import_resume",
  "ingest_job",
  "export_resume",
  "analyze_resume",
  "analyze_job_fit"
]);

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
    if (CONVERSATION_GOALS.has(state.rootGoal)) {
      return { canFinish: true, reason: "goal_completed" };
    }
    const terminal = TERMINAL_STAGES[state.rootGoal];
    if (!terminal) {
      if (!KNOWN_DOMAIN_GOALS.has(state.rootGoal) && state.workflowId === "agent_quick_action") {
        return { canFinish: true, reason: "no_safe_next_step" };
      }
      return incomplete(state, "clarification_required");
    }
    if (["create_tailored_resume", "apply_to_job"].includes(state.rootGoal) && !tailoringContractComplete(state)) {
      return incomplete(state, requiredNextStage(state));
    }
    if (state.rootGoal === "import_resume" && !importContractComplete(state)) {
      return incomplete(state, requiredNextStage(state));
    }
    if (terminal.has(state.stage) || state.completionStatus === "completed") {
      return {
        canFinish: true,
        reason: state.rootGoal.startsWith("analyze_") ? "analysis_complete" : "goal_completed"
      };
    }
    return incomplete(state, requiredNextStage(state));
  }
}

function requiredNextStage(state: AgentTaskState) {
  if (["create_tailored_resume", "apply_to_job"].includes(state.rootGoal)) {
    if (!state.selectedEntities.resumeId) return "choose_resume_source";
    if (!state.selectedEntities.jobId) return "choose_job";
    if (!state.knownSlots.fitAnalysis) return "analyze_fit";
    if (!state.knownSlots.tailoringSession) return "generate_plan";
    if (hasUnresolvedClarifications(state)) return "clarify_unsupported_facts";
    if (!state.knownSlots.previewComplete) return "preview_changes";
    if (!state.knownSlots.confirmationAccepted) return "confirm_apply";
    if (!state.selectedEntities.revisionId) return "apply";
    return deriveNextLegalStage(state);
  }
  if (state.rootGoal === "import_resume") {
    if (!state.attachment && !state.knownSlots.importId) return "select_source";
    if (!state.knownSlots.importId) return "prepare_import";
    if (state.knownSlots.reviewStatus !== "reviewed") return "import_review";
    if (!state.knownSlots.importTarget) return "resolve_target";
    const target = objectValue(state.knownSlots.importTarget);
    if (target.mode === "existing" && !state.knownSlots.importReconciliation) return "reconcile_profile";
    if (objectValue(objectValue(state.knownSlots.importReconciliation).summary).requiresReview) return "resolve_conflicts";
    return "confirm_import";
  }
  if (state.rootGoal === "export_resume") return "export_complete";
  return state.stage;
}

function incomplete(
  state: AgentTaskState,
  requiredNextStage: string
): AgentTaskCompletionDecision {
  return {
    canFinish: false,
    reason: "task_incomplete",
    requiredNextStage,
    nextAction: {
      goal: state.rootGoal,
      stage: state.stage,
      missingSlots: state.missingSlots,
      requiredNextStage,
      legalNextTools: legalToolsFor(requiredNextStage),
      selected: state.selectedEntities
    }
  };
}

function tailoringContractComplete(state: AgentTaskState) {
  return Boolean(
    state.selectedEntities.resumeId
    && state.selectedEntities.jobId
    && state.knownSlots.fitAnalysis
    && state.knownSlots.tailoringSession
    && !hasUnresolvedClarifications(state)
    && state.knownSlots.previewComplete
    && state.knownSlots.confirmationAccepted
    && state.selectedEntities.revisionId
    && state.knownSlots.qualityResult
    && state.stage === "quality_result"
    && state.completionStatus === "completed"
  );
}

function importContractComplete(state: AgentTaskState) {
  return Boolean(
    state.stage === "import_complete"
    && state.completionStatus === "completed"
    && state.knownSlots.importId
    && state.knownSlots.expectedDraftRevision !== undefined
    && state.knownSlots.reviewStatus === "reviewed"
    && state.knownSlots.importTarget
    && state.selectedEntities.profileId
    && state.knownSlots.importResult
  );
}

function legalToolsFor(stage: string) {
  const tools: Record<string, string[]> = {
    prepare_import: ["prepare_resume_import"],
    import_review: ["review_resume_import"],
    reconcile_profile: ["reconcile_resume_import"],
    resolve_conflicts: ["resolve_resume_reconciliation"],
    confirm_import: ["commit_resume_import"],
    choose_resume_source: ["list_resumes"],
    choose_job: ["list_jobs"],
    analyze_fit: ["analyze_job_fit"],
    generate_plan: ["create_tailoring_session"],
    clarify_unsupported_facts: ["answer_tailoring_question"],
    preview_changes: ["preview_tailoring_changes"],
    confirm_apply: ["apply_tailoring_changes"],
    apply: ["apply_tailoring_changes"]
  };
  return tools[stage] ?? [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
