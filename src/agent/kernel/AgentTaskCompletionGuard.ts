import type { AgentTaskState } from "@/agent/contracts/agentSession";
import {
  deriveNextLegalStage,
  hasUnresolvedClarifications
} from "@/agent/runtime/TaskContinuationResolver";
import { normalizeTailoringStage, TAILORING_ALLOWED_TOOLS_BY_STAGE } from "@/agent/workflows/tailoringStage";

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
  compose_resume: new Set(["resume_ready", "completed"]),
  import_resume: new Set(["import_complete"]),
  export_resume: new Set(["export_ready"]),
  profile_intake: new Set(["profile_complete", "resume_ready"]),
  analyze_job_fit: new Set(["generate_plan", "quality_result", "completed"]),
  apply_to_job: new Set(["quality_result"]),
  apply_to_external_job: new Set(["quality_result"]),
  generate_job_specific_resume: new Set(["quality_result"]),
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
  "compose_resume",
  "import_resume",
  "ingest_job",
  "export_resume",
  "analyze_resume",
  "analyze_job_fit",
  "apply_to_external_job",
  "generate_job_specific_resume"
]);

export class AgentTaskCompletionGuard {
  evaluate(state: AgentTaskState): AgentTaskCompletionDecision {
    if (state.completionStatus === "waiting_for_confirmation") {
      return state.knownSlots.pendingConfirmation
        ? { canFinish: true, reason: "waiting_for_confirmation" }
        : incomplete(state, requiredNextStage(state));
    }
    if (state.completionStatus === "waiting_for_user") {
      return { canFinish: true, reason: "waiting_for_user" };
    }
    if (isTailoringApplyRecoverableFailure(state)) {
      return incomplete(state, "confirm_apply");
    }
    if (state.completionStatus === "failed" || state.completionStatus === "cancelled") {
      return { canFinish: true, reason: "blocked" };
    }
    if (CONVERSATION_GOALS.has(state.rootGoal)) {
      return { canFinish: true, reason: "goal_completed" };
    }
    const terminal = TERMINAL_STAGES[state.workflowId] ?? TERMINAL_STAGES[state.rootGoal];
    if (!terminal) {
      if (!KNOWN_DOMAIN_GOALS.has(state.rootGoal) && state.workflowId === "agent_quick_action") {
        return { canFinish: true, reason: "no_safe_next_step" };
      }
      return incomplete(state, "clarification_required");
    }
    if (["create_tailored_resume", "apply_to_job", "apply_to_external_job", "generate_job_specific_resume"].includes(state.rootGoal) && !tailoringContractComplete(state)) {
      return incomplete(state, requiredNextStage(state));
    }
    if (isResumeCompositionTask(state) && !resumeCompositionContractComplete(state)) {
      return incomplete(state, requiredNextStage(state));
    }
    if (state.rootGoal === "create_resume_from_profile" && !isResumeCompositionTask(state) && !resumeFromProfileContractComplete(state)) {
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
  if (["create_tailored_resume", "apply_to_job", "apply_to_external_job", "generate_job_specific_resume"].includes(state.rootGoal)) {
    if (!state.selectedEntities.sourceResumeId && !state.selectedEntities.resumeId) return "choose_resume_source";
    if (!state.selectedEntities.jobId && !state.selectedEntities.targetSnapshotId && !state.knownSlots.targetSnapshot) return state.rootGoal === "apply_to_external_job" || state.rootGoal === "generate_job_specific_resume" ? "choose_resume_source" : "choose_job";
    if (!state.knownSlots.fitAnalysis) return "analyze_fit";
    if (!state.knownSlots.tailoringSession) return "generate_plan";
    if (hasUnresolvedClarifications(state)) return "clarify_unsupported_facts";
    if (!state.knownSlots.previewComplete) return "preview_changes";
    if (!state.knownSlots.confirmationAccepted) return "confirm_apply";
    if (!state.selectedEntities.resultResumeRevisionId && !state.selectedEntities.revisionId) return "confirm_apply";
    return normalizeTailoringStage(deriveNextLegalStage(state)) ?? deriveNextLegalStage(state);
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
  if (state.rootGoal === "export_resume") return "export_ready";
  if (isResumeCompositionTask(state)) {
    if (!state.selectedEntities.profileId) return "select_profile_scope";
    if (!state.knownSlots.resumeCompositionCheckpoint && !hasResumeCompositionCompletionResult(state)) return "review_composition";
    if (!hasResumeCompositionCompletionResult(state)) return "confirm_create";
    return "completed";
  }
  if (state.rootGoal === "create_resume_from_profile") {
    if (!state.selectedEntities.profileId) return "select_profile_scope";
    if (!hasValue(state.knownSlots.selectedFactIds)) return "select_facts";
    if (!state.knownSlots.resumeFromProfileResult) return "confirm_create";
    return "completed";
  }
  if (state.rootGoal === "compose_resume") {
    if (!state.selectedEntities.profileId) return "select_profile_scope";
    if (!state.knownSlots.resumeCompositionCheckpoint) return "review_composition";
    if (!state.knownSlots.resumeCompositionResult) return "confirm_create";
    return "completed";
  }
  if (state.rootGoal === "profile_intake" && state.stage === "confirm_commit") return "confirm_commit";
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
  const quality = objectValue(state.knownSlots.qualityResult);
  const receipt = objectValue(quality.receipt ?? state.knownSlots.applyReceipt);
  const acceptedDiffCount = numberValue(quality.acceptedDiffCount ?? state.knownSlots.acceptedDiffCount);
  const acceptedDiffIds = Array.isArray(quality.acceptedDiffIds)
    ? quality.acceptedDiffIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const changedFieldPaths = Array.isArray(quality.changedFieldPaths)
    ? quality.changedFieldPaths.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const beforeHash = stringValue(quality.beforeContentHash);
  const afterHash = stringValue(quality.afterContentHash);
  const resultResumeId = stringValue(state.selectedEntities.resultResumeId ?? quality.resultResumeId ?? quality.branchId);
  const resultRevisionId = stringValue(state.selectedEntities.resultResumeRevisionId ?? quality.resultResumeRevisionId ?? quality.revisionId);
  const readbackVerified = state.completionType !== "transactional"
    || quality.repositoryReadBackVerified === true && quality.resumeListVisibilityVerified === true;
  const targetProvenance = Boolean(
    state.selectedEntities.jobId
    || state.selectedEntities.targetSnapshotId
      && state.selectedEntities.targetSnapshotVersion !== undefined
      && state.selectedEntities.targetSnapshotHash
  );
  return Boolean(
    state.selectedEntities.profileId
    && (state.selectedEntities.sourceResumeId ?? state.selectedEntities.resumeId)
    && targetProvenance
    && state.knownSlots.fitAnalysis
    && state.knownSlots.tailoringSession
    && !hasUnresolvedClarifications(state)
    && state.knownSlots.previewComplete
    && state.knownSlots.confirmationAccepted
    && resultResumeId
    && resultRevisionId
    && acceptedDiffCount !== undefined
    && acceptedDiffCount > 0
    && acceptedDiffIds.length > 0
    && changedFieldPaths.length > 0
    && beforeHash
    && afterHash
    && beforeHash !== afterHash
    && quality.status === "passed"
    && quality.factGuard === "passed"
    && quality.revisionCreated === true
    && readbackVerified
    && receipt.status === "completed"
    && state.stage === "quality_result"
    && state.completionStatus === "completed"
  );
}

function isTailoringApplyRecoverableFailure(state: AgentTaskState) {
  return ["create_tailored_resume", "apply_to_job", "apply_to_external_job", "generate_job_specific_resume"].includes(state.rootGoal)
    && Boolean(state.knownSlots.tailoringApplyFailure)
    && Boolean(state.selectedEntities.jobId || state.selectedEntities.targetSnapshotId || state.knownSlots.targetSnapshot)
    && normalizeTailoringStage(state.stage) === "confirm_apply";
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

function resumeFromProfileContractComplete(state: AgentTaskState) {
  return Boolean(
    state.selectedEntities.profileId
    && Array.isArray(state.knownSlots.selectedFactIds)
    && state.knownSlots.selectedFactIds.length > 0
    && state.selectedEntities.resumeId
    && state.selectedEntities.revisionId
    && state.knownSlots.resumeFromProfileResult
    && state.stage === "completed"
    && state.completionStatus === "completed"
  );
}

function resumeCompositionContractComplete(state: AgentTaskState) {
  return Boolean(
    state.selectedEntities.profileId
    && state.selectedEntities.resumeId
    && state.selectedEntities.revisionId
    && hasResumeCompositionCompletionResult(state)
    && !hasPendingResumeCompositionInformationNeed(state)
    && state.stage === "resume_ready"
    && state.completionStatus === "completed"
  );
}

function hasResumeCompositionCompletionResult(state: AgentTaskState) {
  return Boolean(
    state.knownSlots.resumeCompositionResult
    || state.knownSlots.resumeCompositionMigration === "legacy_build_resume_from_profile"
      && state.knownSlots.resumeCompositionLegacyResult
  );
}

function hasPendingResumeCompositionInformationNeed(state: AgentTaskState) {
  return objectValue(state.knownSlots.resumeCompositionPendingInformationNeed).status === "pending";
}

function isResumeCompositionTask(state: AgentTaskState) {
  return state.workflowId === "compose_resume";
}

function legalToolsFor(stage: string) {
  const tailoringStage = normalizeTailoringStage(stage);
  if (tailoringStage) return [...TAILORING_ALLOWED_TOOLS_BY_STAGE[tailoringStage]];
  const tools: Record<string, string[]> = {
    prepare_import: ["prepare_resume_import"],
    import_review: ["review_resume_import"],
    reconcile_profile: ["reconcile_resume_import"],
    resolve_conflicts: ["resolve_resume_reconciliation"],
    confirm_import: ["commit_resume_import"],
    confirm_commit: ["commit_profile_intake"],
    review_resume_plan: ["create_resume_from_profile"],
    review_composition: ["plan_resume_composition", "review_resume_composition"],
    confirm_create: ["compose_resume"]
  };
  return tools[stage] ?? [];
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
