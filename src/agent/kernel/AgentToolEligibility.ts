import type { AgentTaskState } from "@/agent/contracts/agentSession";
import type { AgentToolDefinition } from "@/agent/contracts/agentTool";
import {
  isTailoringQuestionPaused,
  normalizeTailoringStage
} from "@/agent/workflows/tailoringStage";

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
  if (["get_agent_task_context", "search_agent_sessions"].includes(toolName)) {
    return state.workflowId === "agent_quick_action" && state.rootGoal === "conversation";
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
  if (toolName === "reconcile_resume_import") {
    return state.rootGoal === "import_resume"
      && state.stage === "reconcile_profile"
      && has(state, "importTarget");
  }
  if (toolName === "resolve_resume_reconciliation") {
    return state.rootGoal === "import_resume"
      && state.stage === "resolve_conflicts"
      && has(state, "importReconciliation")
      && has(state, "reconciliationDecision");
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
  if (toolName === "analyze_job_fit") {
    return Boolean(state.selectedEntities.profileId && (state.selectedEntities.sourceResumeId ?? state.selectedEntities.resumeId) && state.selectedEntities.jobId)
      && (!state.workflowId.startsWith("tailor") || tailoringStage(state) === "analyze_fit")
      && !has(state, "fitAnalysis");
  }
  if (toolName === "create_tailoring_session") {
    return Boolean(state.selectedEntities.profileId && (state.selectedEntities.sourceResumeId ?? state.selectedEntities.resumeId) && state.selectedEntities.jobId)
      && state.workflowId === "tailor_existing_resume"
      && tailoringStage(state) === "generate_plan";
  }
  if (toolName === "recommend_resume_source") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId) && state.stage === "choose_resume_source";
  }
  if (toolName === "create_job_resume_from_profile") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId)
      && state.stage === "create_profile_resume";
  }
  if (toolName === "create_resume_from_profile") {
    return state.rootGoal === "create_resume_from_profile"
      && Boolean(state.selectedEntities.profileId)
      && ["review_resume_plan", "confirm_create"].includes(state.stage);
  }
  if (toolName === "answer_tailoring_question") {
    return tailoringStage(state) === "clarify_unsupported_facts"
      && Boolean(state.knownSlots.tailoringSession)
      && tailoringQuestionActive(state);
  }
  if (toolName === "generate_tailoring_changes") {
    return tailoringStage(state) === "generate_changes"
      && !isTailoringQuestionPaused(state.knownSlots.tailoringSession)
      && Boolean(state.knownSlots.tailoringSession);
  }
  if (toolName === "preview_tailoring_changes") return tailoringStage(state) === "preview_changes";
  if (toolName === "review_tailoring_diff") return tailoringStage(state) === "preview_changes";
  if (toolName === "apply_tailoring_changes") return tailoringStage(state) === "confirm_apply";
  return false;
}

function preconditions(toolName: string, state: AgentTaskState) {
  if (toolName === "capture_profile_intake") {
    const source = objectValue(state.knownSlots.latestIntakeSource);
    return state.workflowId === "guided_profile_intake"
      && state.stage === "structure_facts"
      && (source.sourceKind === "career_narrative" || source.sourceKind === "follow_up_answer")
      && source.classifiedAsEvidence === true
      && source.retracted !== true
      && typeof source.sessionId === "string"
      && typeof source.messageId === "string"
      && typeof source.turnId === "string"
      && typeof source.exactSourceQuote === "string"
      && typeof source.capturedAt === "string"
      && source.targetProfileId === state.knownSlots.targetProfileId
      && source.expectedProfileVersion === state.knownSlots.expectedProfileVersion;
  }
  if (["build_resume_evidence_graph", "plan_resume_composition", "review_resume_composition"].includes(toolName)) {
    return state.workflowId === "compose_resume" && Boolean(state.selectedEntities.profileId || state.knownSlots.targetProfileId);
  }
  if (toolName === "compose_resume") {
    return state.workflowId === "compose_resume"
      && Boolean(state.selectedEntities.profileId || state.knownSlots.targetProfileId)
      && ["review_composition", "confirm_create"].includes(state.stage);
  }
  if (toolName === "commit_profile_intake") {
    return state.workflowId === "guided_profile_intake"
      && state.stage === "confirm_commit"
      && state.completionStatus === "active"
      && state.knownSlots.profileIntakeExplicitCommit === true
      && has(state, "intakeImportId")
      && has(state, "expectedIntakeDraftRevision")
      && has(state, "expectedIntakeReconciliationRevision");
  }
  if (toolName === "prepare_resume_import") {
    return state.stage === "prepare_import" && Boolean(state.attachment?.id);
  }
  if (toolName === "review_resume_import") {
    return state.stage === "import_review"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && has(state, "reviewDecision");
  }
  if (toolName === "reconcile_resume_import") {
    return state.stage === "reconcile_profile"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && objectValue(state.knownSlots.importTarget).mode === "existing";
  }
  if (toolName === "resolve_resume_reconciliation") {
    return state.stage === "resolve_conflicts"
      && has(state, "importId")
      && has(state, "expectedReconciliationRevision")
      && has(state, "reconciliationDecision");
  }
  if (toolName === "commit_resume_import") {
    return state.stage === "confirm_import"
      && state.completionStatus === "active"
      && has(state, "importId")
      && has(state, "expectedDraftRevision")
      && has(state, "importTarget");
  }
  if (toolName === "parse_job_description") return has(state, "rawText");
  if (toolName === "commit_job") {
    return ["title", "company", "rawText", "graph"].every((slot) => has(state, slot))
      && state.completionStatus === "active";
  }
  if (toolName === "analyze_job_fit") {
    return Boolean(state.selectedEntities.profileId && (state.selectedEntities.sourceResumeId ?? state.selectedEntities.resumeId) && state.selectedEntities.jobId)
      && (!state.workflowId.startsWith("tailor") || tailoringStage(state) === "analyze_fit")
      && !has(state, "fitAnalysis");
  }
  if (toolName === "create_tailoring_session") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.resumeId && state.selectedEntities.jobId)
      && state.workflowId === "tailor_existing_resume"
      && tailoringStage(state) === "generate_plan";
  }
  if (toolName === "create_job_resume_from_profile") {
    return Boolean(state.selectedEntities.profileId && state.selectedEntities.jobId)
      && state.knownSlots.sourceRoute === "profile_to_job_resume";
  }
  if (toolName === "create_resume_from_profile") {
    return state.rootGoal === "create_resume_from_profile"
      && Boolean(state.selectedEntities.profileId)
      && ["review_resume_plan", "confirm_create"].includes(state.stage);
  }
  if (["build_resume_evidence_graph", "plan_resume_composition", "review_resume_composition"].includes(toolName)) {
    return state.workflowId === "compose_resume" && Boolean(state.selectedEntities.profileId || state.knownSlots.targetProfileId);
  }
  if (toolName === "compose_resume") {
    return state.workflowId === "compose_resume"
      && state.completionStatus === "active"
      && Boolean(state.selectedEntities.profileId || state.knownSlots.targetProfileId)
      && ["review_composition", "confirm_create"].includes(state.stage);
  }
  if (toolName === "apply_tailoring_changes") {
    return tailoringStage(state) === "confirm_apply"
      && state.completionStatus === "active"
      && Boolean(state.knownSlots.tailoringSession)
      && Array.isArray(state.knownSlots.selectedDiffs);
  }
  if (toolName === "preview_tailoring_changes") {
    return tailoringStage(state) === "preview_changes"
      && Boolean(state.knownSlots.tailoringSession)
      && Array.isArray(state.knownSlots.selectedDiffs)
      && state.knownSlots.remainingDiffCount === 0;
  }
  if (toolName === "review_tailoring_diff") {
    return tailoringStage(state) === "preview_changes" && Boolean(state.knownSlots.tailoringSession);
  }
  if (toolName === "generate_tailoring_changes") {
    return tailoringStage(state) === "generate_changes"
      && !isTailoringQuestionPaused(state.knownSlots.tailoringSession)
      && Boolean(state.knownSlots.tailoringSession);
  }
  if (toolName === "answer_tailoring_question") {
    return tailoringStage(state) === "clarify_unsupported_facts"
      && Boolean(state.knownSlots.tailoringSession)
      && tailoringQuestionActive(state);
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

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function tailoringStage(state: AgentTaskState) {
  return normalizeTailoringStage(state.stage) ?? state.stage;
}

function tailoringQuestionActive(state: AgentTaskState) {
  const session = state.knownSlots.tailoringSession;
  const plan = objectValue(objectValue(session).plan);
  const questionPlan = objectValue(plan.questionPlan);
  return Boolean(state.knownSlots.activeQuestionId)
    && isTailoringQuestionPaused(session)
    && (questionPlan.status === "asking" || typeof questionPlan.activeQuestionId === "string");
}
