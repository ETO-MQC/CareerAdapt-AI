import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentToolDefinition } from "@/agent/contracts/agentTool";

export type AgentToolEligibilityInput = {
  tools: AgentToolDefinition[];
  workflowToolNames: string[];
  capabilityToolNames: string[];
  taskState: AgentTaskState;
};

export class AgentToolEligibility {
  eligible(input: AgentToolEligibilityInput) {
    const workflow = new Set(input.workflowToolNames);
    const capabilities = new Set(input.capabilityToolNames);
    return input.tools.filter((tool) => {
      if (!capabilities.has(tool.name)) return false;
      if (!workflow.has(tool.name) && !safeAutonomousJump(tool.name, input.taskState)) return false;
      return preconditions(tool.name, input.taskState);
    });
  }
}

function safeAutonomousJump(toolName: string, state: AgentTaskState) {
  if (state.workflowId === "tailor_existing_resume" || state.workflowId === "analyze_job_fit") {
    return false;
  }
  if (toolName === "parse_job_description") return has(state, "rawText");
  if (toolName === "prepare_resume_import") {
    return state.rootGoal === "import_resume" && Boolean(state.attachment?.id);
  }
  if (toolName === "review_resume_import") {
    return state.rootGoal === "import_resume"
      && state.stage === "import_review"
      && has(state, "reviewDecision");
  }
  if (toolName === "commit_resume_import") {
    return state.rootGoal === "import_resume"
      && state.stage === "confirm_import"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && has(state, "importTarget");
  }
  if (toolName === "commit_job") {
    return state.rootGoal === "apply_to_job"
      && ["title", "company", "rawText", "graph"].every((slot) => has(state, slot));
  }
  if (["list_profiles", "list_resumes", "list_jobs", "get_active_profile"].includes(toolName)) return true;
  if (["get_profile", "search_profile_facts", "get_resume", "get_resume_revision", "get_job"].includes(toolName)) return true;
  if (["archive_resume", "restore_resume"].includes(toolName)) {
    return Boolean(state.selectedEntities.resumeId);
  }
  if (toolName === "analyze_job_fit" || toolName === "create_tailoring_session") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.resumeId && state.selectedEntities.jobId);
  }
  if (toolName === "recommend_resume_source") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId) && state.stage === "choose_resume_source";
  }
  if (toolName === "create_job_resume_from_profile") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId)
      && state.stage === "create_profile_resume";
  }
  if (toolName === "answer_tailoring_question") {
    return state.stage === "clarify_unsupported_facts" && Boolean(state.knownSlots.tailoringSession);
  }
  if (toolName === "preview_tailoring_changes") return state.stage === "preview_changes";
  if (toolName === "apply_tailoring_changes") return state.stage === "confirm_apply";
  return false;
}

function preconditions(toolName: string, state: AgentTaskState) {
  if (toolName === "prepare_resume_import") {
    return state.stage === "prepare_import" && Boolean(state.attachment?.id);
  }
  if (toolName === "review_resume_import") {
    return state.stage === "import_review"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && has(state, "reviewDecision");
  }
  if (toolName === "commit_resume_import") {
    return state.stage === "confirm_import"
      && state.completionStatus === "waiting_for_confirmation"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && has(state, "importTarget");
  }
  if (toolName === "parse_job_description") return has(state, "rawText");
  if (toolName === "commit_job") {
    return ["title", "company", "rawText", "graph"].every((slot) => has(state, slot))
      && state.completionStatus === "waiting_for_confirmation";
  }
  if (toolName === "analyze_job_fit" || toolName === "create_tailoring_session") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.resumeId && state.selectedEntities.jobId);
  }
  if (toolName === "create_job_resume_from_profile") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId)
      && state.knownSlots.sourceRoute === "profile_to_job_resume";
  }
  if (toolName === "apply_tailoring_changes") {
    return state.stage === "confirm_apply"
      && state.completionStatus === "waiting_for_confirmation"
      && Boolean(state.knownSlots.tailoringSession)
      && Array.isArray(state.knownSlots.selectedDiffs);
  }
  if (toolName === "preview_tailoring_changes") {
    return state.stage === "preview_changes"
      && Boolean(state.knownSlots.tailoringSession)
      && Array.isArray(state.knownSlots.selectedDiffs);
  }
  if (["archive_resume", "restore_resume"].includes(toolName)) {
    return Boolean(state.selectedEntities.resumeId);
  }
  return true;
}

function has(state: AgentTaskState, slot: string) {
  const value = state.knownSlots[slot];
  return value !== undefined && value !== null && value !== "";
}
