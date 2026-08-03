import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import { getWorkflowDefinition } from "@/agent/workflows/workflowRegistry";
import type { TurnIntent } from "./AgentTurnIntent";
import {
  deriveNextLegalStage,
  TaskContinuationResolver
} from "./TaskContinuationResolver";
import type { AgentAttachmentRef } from "@/services/agent/AgentAttachmentStore";
import { stableHashText } from "@/services/security/text";
import {
  resolveTailoringEntityReference,
  type TailoringContextCandidate
} from "./tailoringContextResolver";

export type AgentTaskEvent =
  | {
      type: "user_message";
      message: string;
      sessionId?: string;
      messageId?: string;
      turnId?: string;
      capturedAt?: string;
      turnIntent?: TurnIntent;
    }
  | { type: "new_root_task"; goal: string; workflowId: string; stage: string }
  | { type: "new_active_task"; goal: string; workflowId: string; stage: string }
  | { type: "restart_profile_intake" }
  | { type: "attachment_selected"; attachment: AgentAttachmentRef }
  | { type: "slot_answer"; slot: string; value: unknown }
  | {
      type: "decision_selected";
      decisionType: "resume_source_route" | "profile_intake_target" | "profile_intake_resume";
      option: "profile" | "existing_resume" | "switch_to_active" | "keep_original" | "save_profile_only" | "generate_general_resume";
    }
  | { type: "tool_observation"; toolName: string; observation: unknown; artifactIds?: string[] }
  | { type: "confirmation_requested"; toolName: string; operationId: string }
  | { type: "confirmation_accepted"; toolName: string }
  | { type: "confirmation_rejected"; toolName: string }
  | { type: "confirmation_superseded"; toolName: string }
  | {
      type: "entity_revision";
      entityType: "profile" | "resume" | "job";
      entityId: string;
      revisionId?: string;
      version?: string | number;
      hash?: string;
    }
  | { type: "dependencies_invalidated" }
  | { type: "failed"; errorCode: string };

export class AgentTaskStateReducer {
  create(
    session: AgentSession,
    goal = session.taskState?.rootGoal ?? session.memory?.currentGoal ?? "conversation"
  ): AgentTaskState {
    const now = new Date().toISOString();
    const knownSlots: AgentTaskState["knownSlots"] = { ...session.workflowState.data };
    if (session.pendingConfirmation && session.pendingToolCall) {
      knownSlots.pendingConfirmation = {
        toolName: session.pendingToolCall.toolName,
        operationId: session.pendingConfirmation.operationId
      };
    }
    const state: AgentTaskState = {
      goal,
      rootGoal: goal,
      activeGoal: goal,
      workflowId: session.workflowState.workflowId,
      stage: session.workflowState.step,
      requiredSlots: [],
      knownSlots,
      missingSlots: [],
      selectedEntities: {
        profileId: session.activeProfileId,
        resumeId: session.activeResumeId,
        jobId: session.activeJobId,
        revisionId: stringValue(knownSlots.revisionId)
      },
      dependencySnapshots: {},
      artifacts: session.artifactRefs.map((artifact) => artifact.id),
      completionStatus: workflowStatus(session.workflowState.status),
      computeTier: computeTier(goal),
      updatedAt: now
    };
    return normalize(state);
  }

  reduce(previous: AgentTaskState, event: AgentTaskEvent): AgentTaskState {
    const state = structuredClone(previous);
    state.updatedAt = new Date().toISOString();
    if (event.type === "new_root_task") {
      return normalize({
        ...state,
        goal: event.goal,
        rootGoal: event.goal,
        activeGoal: event.goal,
        workflowId: event.workflowId,
        stage: event.stage,
        requiredSlots: [],
        knownSlots: {},
        missingSlots: [],
        selectedEntities: {
          profileId: state.selectedEntities.profileId,
          profileVersion: state.selectedEntities.profileVersion
        },
        pendingDecision: undefined,
        dependencySnapshots: {},
        artifacts: [],
        lastObservation: undefined,
        completionStatus: "active",
        computeTier: computeTier(event.goal),
        updatedAt: new Date().toISOString()
      });
    }
    if (event.type === "new_active_task") {
      state.activeGoal = event.goal;
      state.workflowId = event.workflowId;
      state.stage = event.stage;
      state.requiredSlots = [];
      state.missingSlots = [];
      state.pendingDecision = undefined;
      state.completionStatus = "active";
      return normalize(state);
    }
    if (event.type === "restart_profile_intake") {
      resetProfileIntakeDraft(state);
      state.stage = "collect_experience";
      state.completionStatus = "active";
      return normalize(state);
    }
    if (event.type === "user_message") {
      delete state.knownSlots.compoundAnswerResolution;
      if (state.workflowId === "guided_profile_intake") {
        const hasIntakeEvidence = isProfileIntakeEvidence(event.message);
        if (
          isSubstantiveProfileIntakeNarrative(event.message)
          && (state.stage === "profile_complete" || state.stage === "resume_ready")
        ) {
          resetProfileIntakeDraft(state);
          state.stage = "collect_experience";
        }
        const isIntakeAnswer = (
          state.stage === "collect_experience"
          && event.message.trim()
          && isProfileIntakeAnswerTurn(event.turnIntent)
          && hasIntakeEvidence
        );
        if (isIntakeAnswer) {
          state.knownSlots.latestIntakeSource = {
            sessionId: event.sessionId,
            messageId: event.messageId,
            turnId: event.turnId,
            exactSourceQuote: event.message,
            capturedAt: event.capturedAt ?? state.updatedAt
          };
          state.stage = "structure_facts";
        }
        if (
          state.stage === "review_facts"
          && event.message.trim()
          && isProfileIntakeAnswerTurn(event.turnIntent)
          && hasIntakeEvidence
        ) {
          state.knownSlots.latestIntakeClarification = {
            sessionId: event.sessionId,
            messageId: event.messageId,
            turnId: event.turnId,
            exactSourceQuote: event.message,
            capturedAt: event.capturedAt ?? state.updatedAt
          };
        }
        if (state.stage === "profile_complete") {
          if (/仅保存(?:资料库)?|不(?:需要|用)生成(?:通用)?简历/.test(event.message)) {
            state.pendingDecision = undefined;
            state.completionStatus = "completed";
          } else if (/生成(?:一份)?(?:通用)?简历|创建(?:一份)?(?:通用)?简历/.test(event.message)) {
            state.pendingDecision = undefined;
            state.stage = "optional_resume_decision";
            state.completionStatus = "active";
          }
        }
      }
      // Import review replies commonly combine the review decision and target
      // selection in one sentence. Capture both before the continuation
      // resolver can consume the reply and return early.
      if (state.rootGoal === "import_resume") {
        captureImportTargetIntent(state, event.message);
      }
      const continuation = new TaskContinuationResolver().resolve(state, event.message);
      if (continuation.consumed) {
        Object.assign(state.knownSlots, continuation.slotUpdates);
        if (continuation.intent === "continue") {
          state.stage = deriveNextLegalStage(state);
        }
        state.completionStatus = "active";
        state.computeTier = computeTier(state.rootGoal, event.message);
        return normalize(state);
      }
      if (state.completionStatus !== "waiting_for_confirmation") state.completionStatus = "active";
      captureEntityReferences(state, event.message);
      if (isTailoringGoal(state.rootGoal)) {
        resolvePendingTailoringSelection(state, event.message);
      }
      if (state.workflowId === "job_ingestion" && looksLikeJd(event.message)) {
        state.stage = "parse_job";
        state.knownSlots.rawText = event.message.trim();
      }
      const sourceSelectionAllowed = ["apply_to_job", "create_tailored_resume"].includes(state.rootGoal);
      if (sourceSelectionAllowed && /从资料库|资料库生成|路线\s*A/i.test(event.message)) {
        selectResumeSourceRoute(state, "profile");
      } else if (sourceSelectionAllowed && /已有简历|现有简历|通用简历|路线\s*B/i.test(event.message)) {
        selectResumeSourceRoute(state, "existing_resume");
      }
      state.computeTier = computeTier(state.rootGoal, event.message);
      if (state.rootGoal === "import_resume") {
        captureImportTargetIntent(state, event.message);
      }
      if (
        state.workflowId === "guided_profile_intake"
        && state.stage === "collect_experience"
        && (
          !isProfileIntakeAnswerTurn(event.turnIntent)
          || !isProfileIntakeEvidence(event.message)
        )
      ) {
        // Commands such as "继续添加经历" ask the interview to continue; they
        // are neither source evidence nor a reason to leave the user-input boundary.
        state.completionStatus = "waiting_for_user";
      }
    }
    if (event.type === "attachment_selected") {
      setUserRootGoal(state, "import_resume");
      state.workflowId = "resume_import";
      state.stage = "prepare_import";
      state.attachment = event.attachment;
      for (const key of [
        "importId",
        "expectedDraftRevision",
        "importReviewSummary",
        "importArtifact",
        "reviewStatus",
        "reviewDecision",
        "importTarget",
        "importTargetIntent",
        "importTargetProfileName",
        "importResult",
        "importCommitError",
        "pendingConfirmation"
      ]) {
        delete state.knownSlots[key];
      }
      state.knownSlots.attachmentId = event.attachment.id;
      state.knownSlots.attachmentFileName = event.attachment.fileName;
      state.knownSlots.attachmentMimeType = event.attachment.mimeType;
      state.selectedEntities.profileId = undefined;
      state.selectedEntities.profileVersion = undefined;
      state.selectedEntities.resumeId = undefined;
      state.selectedEntities.resumeRevisionId = undefined;
      state.selectedEntities.revisionId = undefined;
      state.completionStatus = "active";
    }
    if (event.type === "slot_answer") {
      state.knownSlots[event.slot] = event.value;
      state.completionStatus = "active";
    }
    if (event.type === "decision_selected") {
      if (
        state.pendingDecision?.type === event.decisionType
        && state.pendingDecision.options.includes(event.option)
      ) {
        if (event.decisionType === "resume_source_route" && (event.option === "profile" || event.option === "existing_resume")) {
          selectResumeSourceRoute(state, event.option);
        } else if (event.decisionType === "profile_intake_target") {
          resolveProfileIntakeTargetDecision(state, event.option);
        } else if (event.decisionType === "profile_intake_resume") {
          state.pendingDecision = undefined;
          if (event.option === "save_profile_only") {
            state.stage = "profile_complete";
            state.completionStatus = "completed";
          } else if (event.option === "generate_general_resume") {
            state.stage = "optional_resume_decision";
            state.completionStatus = "active";
          }
        }
      }
    }
    if (event.type === "tool_observation") {
      state.lastObservation = { toolName: event.toolName, value: event.observation };
      state.artifacts = unique([...state.artifacts, ...(event.artifactIds ?? [])]);
      mergeObservationSlots(state, event.toolName, event.observation);
      if (event.toolName === "commit_job") {
        if (state.rootGoal === "ingest_job") {
          state.activeGoal = "ingest_job";
          state.stage = "completed";
          state.completionStatus = "completed";
        } else {
          state.activeGoal = "resolve_resume_source";
          state.workflowId = "tailor_existing_resume";
          state.stage = "choose_resume_source";
          state.completionStatus = "active";
        }
      } else if (event.toolName === "recommend_resume_source") {
        state.activeGoal = "resolve_resume_source";
        const value = objectValue(event.observation);
        state.knownSlots.sourceRecommendation = value.recommendation;
        state.knownSlots.recommendedResumeId = value.recommendedResumeId;
        state.pendingDecision = {
          type: "resume_source_route",
          options: ["profile", "existing_resume"]
        };
        state.stage = "choose_resume_source";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "create_job_resume_from_profile") {
        const value = objectValue(event.observation);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) state.selectedEntities.revisionId = revisionId;
        state.activeGoal = "analyze_job_fit";
        state.stage = "analyze_fit";
        state.completionStatus = "active";
      } else if (event.toolName === "create_resume_from_profile") {
        const value = objectValue(event.observation);
        const profileId = stringValue(value.profileId);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (profileId) state.selectedEntities.profileId = profileId;
        if (typeof value.profileVersion === "number") state.selectedEntities.profileVersion = value.profileVersion;
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) {
          state.selectedEntities.revisionId = revisionId;
          state.selectedEntities.resumeRevisionId = revisionId;
        }
        state.knownSlots.selectedFactIds = Array.isArray(value.selectedFactIds) ? value.selectedFactIds : state.knownSlots.selectedFactIds;
        state.knownSlots.resumeFromProfileResult = event.observation;
        state.activeGoal = "create_resume_from_profile";
        state.stage = "completed";
        state.completionStatus = "completed";
      } else if (event.toolName === "analyze_job_fit") {
        state.knownSlots.fitAnalysis = objectValue(event.observation).analysis ?? event.observation;
        state.dependencySnapshots.fitResult = dependencySnapshot(state, event.observation);
        if (state.rootGoal === "analyze_job_fit") {
          state.activeGoal = "analyze_job_fit";
          state.stage = "completed";
          state.completionStatus = "completed";
        } else {
          state.activeGoal = "create_tailored_resume";
          state.stage = "generate_plan";
          state.completionStatus = "active";
        }
      } else if (event.toolName === "create_tailoring_session") {
        state.activeGoal = "create_tailored_resume";
        captureTailoringTruth(state, event.observation);
        state.dependencySnapshots.tailoringSession = dependencySnapshot(state, event.observation);
      } else if (event.toolName === "answer_tailoring_question") {
        captureTailoringTruth(state, event.observation);
        state.dependencySnapshots.clarificationAnswers = dependencySnapshot(state, event.observation);
      } else if (event.toolName === "generate_tailoring_changes") {
        captureTailoringTruth(state, event.observation);
        const generated = objectValue(event.observation);
        const generatedSession = objectValue(generated.session);
        const generatedPlan = objectValue(generatedSession.plan);
        const diffReviews = Array.isArray(generatedPlan.diffReviews) ? generatedPlan.diffReviews : [];
        state.knownSlots.selectedDiffs = [];
        state.knownSlots.selectedDiffIds = [];
        state.knownSlots.rejectedDiffIds = [];
        state.knownSlots.remainingDiffCount = diffReviews.length;
        state.stage = "preview_changes";
        state.activeGoal = "review_tailoring_changes";
        state.completionStatus = diffReviews.length ? "waiting_for_user" : "active";
      } else if (event.toolName === "review_tailoring_diff") {
        captureTailoringTruth(state, event.observation);
        const reviewed = objectValue(event.observation);
        state.knownSlots.selectedDiffs = Array.isArray(reviewed.selectedDiffs) ? reviewed.selectedDiffs : [];
        state.knownSlots.selectedDiffIds = Array.isArray(reviewed.selectedDiffIds) ? reviewed.selectedDiffIds : [];
        state.knownSlots.rejectedDiffIds = Array.isArray(reviewed.rejectedDiffIds) ? reviewed.rejectedDiffIds : [];
        state.knownSlots.remainingDiffCount = typeof reviewed.remainingDiffCount === "number" ? reviewed.remainingDiffCount : 0;
        state.stage = "preview_changes";
        state.activeGoal = "review_tailoring_changes";
        state.completionStatus = state.knownSlots.remainingDiffCount === 0 ? "active" : "waiting_for_user";
      } else if (event.toolName === "preview_tailoring_changes") {
        state.knownSlots.previewComplete = true;
        state.dependencySnapshots.preview = dependencySnapshot(state, event.observation);
        state.stage = "confirm_apply";
        state.completionStatus = "active";
      } else if (event.toolName === "apply_tailoring_changes") {
        const value = objectValue(event.observation);
        state.knownSlots.qualityResult = value.qualityResult ?? {
          status: "passed",
          factGuard: "passed",
          revisionCreated: Boolean(value.revision ?? value.revisionId)
        };
        state.dependencySnapshots.qualityResult = dependencySnapshot(state, event.observation);
        state.activeGoal = "quality_result";
        state.stage = "quality_result";
        state.completionStatus = "completed";
      } else if (event.toolName === "archive_resume" || event.toolName === "restore_resume") {
        state.stage = "lifecycle_result";
        state.knownSlots.lifecycleResult = event.observation;
        state.completionStatus = "completed";
      } else if (event.toolName === "export_resume") {
        state.knownSlots.exportResult = event.observation;
        state.activeGoal = "export_resume";
        state.stage = "export_ready";
        state.completionStatus = "completed";
      } else if (event.toolName === "capture_profile_intake") {
        const value = objectValue(event.observation);
        const nextArtifact = objectValue(value.artifactPayload);
        state.knownSlots.intakeImportId = value.importId;
        state.knownSlots.expectedIntakeDraftRevision = value.expectedDraftRevision;
        state.knownSlots.intakeCandidates = value.candidates;
        state.knownSlots.intakeArtifact = nextArtifact;
        const needsConfirmation = typeof value.needsConfirmationCount === "number"
          ? value.needsConfirmationCount
          : 0;
        state.stage = needsConfirmation > 0 ? "review_facts" : "reconcile_profile";
        state.completionStatus = needsConfirmation > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "review_profile_intake") {
        const value = objectValue(event.observation);
        state.knownSlots.expectedIntakeDraftRevision = value.expectedDraftRevision;
        const candidateId = stringValue(value.candidateId);
        const decision = value.decision === "accept" || value.decision === "reject"
          ? value.decision
          : undefined;
        if (candidateId && decision) {
          const editedLabel = stringValue(value.editedLabel);
          const candidates = Array.isArray(state.knownSlots.intakeCandidates)
            ? state.knownSlots.intakeCandidates.map(objectValue)
            : [];
          const reviewed = candidates.find((candidate) => candidate.id === candidateId);
          state.knownSlots.intakeCandidates = candidates.map((candidate) =>
            candidate.id === candidateId
              ? {
                  ...candidate,
                  label: editedLabel ?? candidate.label,
                  needsConfirmation: false,
                  decision
                }
              : candidate
          );
          const artifact = objectValue(state.knownSlots.intakeArtifact);
          const recognized = Array.isArray(artifact.recognized)
            ? artifact.recognized.map(objectValue)
            : [];
          state.knownSlots.intakeArtifact = {
            ...artifact,
            candidates: Array.isArray(artifact.candidates)
              ? artifact.candidates.map(objectValue)
                  .filter((item) => decision !== "reject" || item.id !== candidateId)
                  .map((item) => item.id === candidateId
                    ? { ...item, label: editedLabel ?? item.label, status: "confirmed" }
                    : item)
              : [],
            recognized: decision === "accept" && reviewed
              ? [...recognized.filter((item) => item.id !== candidateId), {
                  id: candidateId,
                  label: editedLabel ?? reviewed.label
                }]
              : recognized.filter((item) => item.id !== candidateId),
            needsConfirmation: Array.isArray(artifact.needsConfirmation)
              ? artifact.needsConfirmation
                  .map(objectValue)
                  .filter((item) => item.id !== candidateId)
              : []
          };
        }
        const unresolved = typeof value.unresolvedCount === "number" ? value.unresolvedCount : 0;
        state.stage = unresolved > 0 ? "review_facts" : "reconcile_profile";
        state.completionStatus = unresolved > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "reconcile_profile_intake") {
        const value = objectValue(event.observation);
        const summary = objectValue(value.summary);
        const unresolved = typeof summary.requiresReview === "number" ? summary.requiresReview : 0;
        state.knownSlots.intakeReconciliation = event.observation;
        state.knownSlots.expectedIntakeReconciliationRevision = value.expectedPlanRevision;
        const currentArtifact = objectValue(state.knownSlots.intakeArtifact);
        const unresolvedItems = Array.isArray(value.unresolved) ? value.unresolved.map(objectValue) : [];
        state.knownSlots.intakeArtifact = {
          ...currentArtifact,
          candidates: Array.isArray(currentArtifact.candidates)
            ? currentArtifact.candidates.map(objectValue).map((candidate) => {
                const match = unresolvedItems.find((item) => item.incomingItemId === candidate.id);
                return match
                  ? { ...candidate, status: match.state === "conflict" ? "conflict" : "duplicate" }
                  : candidate;
              })
            : [],
          duplicates: Array.isArray(value.existing) ? value.existing : [],
          additions: Array.isArray(value.additions) ? value.additions : [],
          reconciliationSummary: summary
        };
        state.stage = unresolved > 0 ? "resolve_conflicts" : "confirm_commit";
        state.completionStatus = unresolved > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "resolve_profile_intake_conflict") {
        const value = objectValue(event.observation);
        const unresolved = typeof value.unresolvedCount === "number" ? value.unresolvedCount : 0;
        state.knownSlots.expectedIntakeReconciliationRevision = value.expectedPlanRevision;
        state.knownSlots.intakeReconciliation = {
          ...objectValue(state.knownSlots.intakeReconciliation),
          ...value
        };
        state.stage = unresolved > 0 ? "resolve_conflicts" : "confirm_commit";
        state.completionStatus = unresolved > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "commit_profile_intake") {
        const value = objectValue(event.observation);
        const profileId = stringValue(value.profileId);
        const profileVersion = scalarValue(value.profileVersion);
        if (!profileId || typeof profileVersion !== "number") {
          state.stage = "confirm_commit";
          state.completionStatus = "failed";
          return normalize(state);
        }
        state.selectedEntities.profileId = profileId;
        state.selectedEntities.profileVersion = profileVersion;
        state.knownSlots.targetProfileId = profileId;
        state.knownSlots.expectedProfileVersion = profileVersion;
        state.knownSlots.profileCommitResult = event.observation;
        state.pendingDecision = {
          type: "profile_intake_resume",
          options: ["save_profile_only", "generate_general_resume"]
        };
        state.stage = "profile_complete";
        state.completionStatus = "waiting_for_user";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "ensure_general_resume_from_profile") {
        const value = objectValue(event.observation);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) {
          state.selectedEntities.resumeRevisionId = revisionId;
          state.selectedEntities.revisionId = revisionId;
        }
        state.knownSlots.generalResumeResult = event.observation;
        state.stage = "resume_ready";
        state.completionStatus = "completed";
      } else if (event.toolName === "prepare_resume_import") {
        const value = objectValue(event.observation);
        state.knownSlots.importId = value.importId;
        state.knownSlots.expectedDraftRevision = value.expectedDraftRevision;
        state.knownSlots.importReviewSummary = value.reviewSummary;
        state.knownSlots.importArtifact = value.artifactPayload;
        const review = objectValue(value.reviewSummary);
        const needsReview = typeof review.needsReviewCount === "number"
          ? review.needsReviewCount
          : 0;
        state.knownSlots.reviewStatus = needsReview > 0 ? "needs_review" : "reviewed";
        state.activeGoal = needsReview > 0 ? "review_import" : "resolve_import_target";
        state.stage = needsReview > 0 ? "import_review" : "resolve_target";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "review_resume_import") {
        const value = objectValue(event.observation);
        state.knownSlots.expectedDraftRevision = value.expectedDraftRevision;
        state.knownSlots.reviewStatus = "reviewed";
        delete state.knownSlots.reviewDecision;
        delete state.knownSlots.importReconciliation;
        delete state.knownSlots.expectedReconciliationRevision;
        state.activeGoal = "resolve_import_target";
        state.stage = hasValue(state.knownSlots.importTarget) ? "reconcile_profile" : "resolve_target";
        state.completionStatus = hasValue(state.knownSlots.importTarget)
          ? "active"
          : "waiting_for_user";
      } else if (event.toolName === "reconcile_resume_import") {
        const value = objectValue(event.observation);
        state.knownSlots.importReconciliation = event.observation;
        state.knownSlots.expectedReconciliationRevision = value.expectedPlanRevision;
        const summary = objectValue(value.summary);
        const requiresReview = typeof summary.requiresReview === "number" ? summary.requiresReview : 0;
        state.activeGoal = requiresReview > 0 ? "resolve_import_conflicts" : "confirm_import";
        state.stage = requiresReview > 0 ? "resolve_conflicts" : "confirm_import";
        state.completionStatus = requiresReview > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "resolve_resume_reconciliation") {
        const value = objectValue(event.observation);
        state.knownSlots.expectedReconciliationRevision = value.expectedPlanRevision;
        const current = objectValue(state.knownSlots.importReconciliation);
        state.knownSlots.importReconciliation = {
          ...current,
          ...value
        };
        delete state.knownSlots.reconciliationDecision;
        const unresolvedCount = typeof value.unresolvedCount === "number" ? value.unresolvedCount : 0;
        state.stage = unresolvedCount > 0 ? "resolve_conflicts" : "confirm_import";
        state.activeGoal = unresolvedCount > 0 ? "resolve_import_conflicts" : "confirm_import";
        state.completionStatus = unresolvedCount > 0 ? "waiting_for_user" : "active";
      } else if (event.toolName === "commit_resume_import") {
        const value = objectValue(event.observation);
        const profileId = stringValue(value.profileId);
        const resumeId = stringValue(value.branchId ?? value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (!profileId) {
          state.knownSlots.importCommitError = value.error ?? event.observation;
          state.stage = "confirm_import";
          state.completionStatus = "failed";
          return normalize(state);
        }
        if (profileId) state.selectedEntities.profileId = profileId;
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) {
          state.selectedEntities.resumeRevisionId = revisionId;
          state.selectedEntities.revisionId = revisionId;
        }
        state.knownSlots.importResult = event.observation;
        state.activeGoal = "import_resume";
        state.stage = "import_complete";
        state.completionStatus = "completed";
      }
    }
    if (event.type === "confirmation_requested") {
      state.completionStatus = "waiting_for_confirmation";
      state.knownSlots.pendingConfirmation = {
        toolName: event.toolName,
        operationId: event.operationId
      };
      if (event.toolName === "apply_tailoring_changes") {
        state.dependencySnapshots.pendingApplyConfirmation = dependencySnapshot(state);
      }
      if (event.toolName === "commit_resume_import") {
        state.stage = "confirm_import";
      }
      if (event.toolName === "commit_profile_intake") {
        state.stage = "confirm_commit";
      }
      if (event.toolName === "create_resume_from_profile") {
        state.stage = "confirm_create";
      }
    }
    if (event.type === "confirmation_accepted") {
      state.completionStatus = "active";
      if (event.toolName === "apply_tailoring_changes") {
        state.knownSlots.confirmationAccepted = true;
      }
      delete state.knownSlots.pendingConfirmation;
    }
    if (event.type === "confirmation_rejected") {
      state.completionStatus = "waiting_for_user";
      delete state.knownSlots.pendingConfirmation;
      delete state.dependencySnapshots.pendingApplyConfirmation;
      if (event.toolName === "commit_profile_intake") {
        for (const slot of [
          "intakeImportId",
          "expectedIntakeDraftRevision",
          "intakeCandidates",
          "intakeArtifact",
          "intakeReconciliation",
          "expectedIntakeReconciliationRevision"
        ]) {
          delete state.knownSlots[slot];
        }
        state.stage = "collect_experience";
      }
      if (event.toolName === "create_resume_from_profile") {
        state.stage = "confirm_create";
      }
    }
    if (event.type === "confirmation_superseded") {
      supersedeConfirmation(state, event.toolName);
    }
    if (event.type === "entity_revision") {
      updateAuthoritativeEntity(state, event);
    }
    if (event.type === "dependencies_invalidated") {
      invalidateDerivedState(state);
    }
    if (event.type === "failed") {
      const committedProfileIntake = (
        state.workflowId === "guided_profile_intake"
        && Boolean(state.knownSlots.profileCommitResult)
        && (state.stage === "profile_complete" || state.stage === "resume_ready")
      );
      if (!committedProfileIntake) state.completionStatus = "failed";
      state.lastObservation = { errorCode: event.errorCode };
    }
    return normalize(state);
  }
}

function isProfileIntakeAnswerTurn(intent?: TurnIntent) {
  // Direct reducer callers predate explicit turn intent. Runtime turns always
  // provide it, so only actual interview answers or fresh domain narratives
  // advance into fact capture; side questions and task controls never do.
  return intent === undefined
    || intent === "clarification_answer"
    || intent === "new_domain_task";
}

function isProfileIntakeEvidence(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (/^(?:是|是的|对|对的|好的?|嗯|确认|没问题|没有问题|全部确认|都正确|导入|写入|保存|开始导入|确认导入)[。！!]?$/u.test(text)) {
    return false;
  }
  return true;
}

function isSubstantiveProfileIntakeNarrative(message: string) {
  const text = message.trim();
  return text.length >= 12
    && /项目|实习|比赛|竞赛|经历|负责|开发|组织|课题|工作|活动|获奖|学校|专业|教育/u.test(text);
}

function resetProfileIntakeDraft(state: AgentTaskState) {
  for (const key of [
    "latestIntakeSource",
    "intakeImportId",
    "expectedIntakeDraftRevision",
    "intakeCandidates",
    "intakeArtifact",
    "intakeReconciliation",
    "expectedIntakeReconciliationRevision",
    "profileCommitResult",
    "pendingConfirmation"
  ]) {
    delete state.knownSlots[key];
  }
  state.pendingDecision = undefined;
  state.lastObservation = undefined;
  state.completionStatus = "active";
}

function normalize(state: AgentTaskState): AgentTaskState {
  state.goal = state.rootGoal;
  if (state.rootGoal === "create_resume_from_profile" && state.workflowId === "build_resume_from_profile") {
    if (state.stage !== "completed" && state.stage !== "confirm_create") {
      if (!state.selectedEntities.profileId) {
        state.stage = "select_profile_scope";
      } else if (!hasValue(state.knownSlots.selectedFactIds)) {
        state.stage = state.stage === "select_profile_scope" ? "select_facts" : state.stage;
      } else {
        state.stage = "review_resume_plan";
      }
    }
    if (state.stage === "completed") state.completionStatus = "completed";
  }
  if (state.workflowId === "tailor_existing_resume") {
    if (state.stage === "select_resume") state.stage = "choose_resume_source";
    if (state.stage === "answer_questions") state.stage = "clarify_unsupported_facts";
    if (state.stage === "completed") state.stage = "quality_result";
    if (
      ["choose_resume_source", "choose_job"].includes(state.stage)
      && state.selectedEntities.profileId
      && state.selectedEntities.resumeId
      && state.selectedEntities.jobId
    ) {
      state.activeGoal = "analyze_job_fit";
      state.stage = "analyze_fit";
      state.completionStatus = "active";
    } else if (
      ["choose_resume_source", "choose_job"].includes(state.stage)
      && state.selectedEntities.profileId
      && state.selectedEntities.resumeId
      && !state.selectedEntities.jobId
      && Array.isArray(state.knownSlots.jobCandidates)
      && state.knownSlots.jobCandidates.length > 0
    ) {
      state.activeGoal = "resolve_resume_source";
      state.stage = "choose_job";
      state.completionStatus = "waiting_for_user";
    }
  }
  if (state.workflowId === "resume_import") {
    if (!state.attachment && !hasValue(state.knownSlots.importId)) {
      state.stage = "select_source";
    } else if (!hasValue(state.knownSlots.importId)) {
      state.stage = "prepare_import";
    } else if (state.stage !== "import_complete") {
      const reviewed = state.knownSlots.reviewStatus === "reviewed";
      const targetSelected = hasValue(state.knownSlots.importTarget);
      const target = objectValue(state.knownSlots.importTarget);
      const reconciliation = objectValue(state.knownSlots.importReconciliation);
      const reconciliationSummary = objectValue(reconciliation.summary);
      const targetNeedsReconciliation = target.mode === "existing";
      const reconciliationMatchesTarget = reconciliation.profileId === target.profileId;
      const unresolved = typeof reconciliationSummary.requiresReview === "number"
        ? reconciliationSummary.requiresReview
        : 0;
      state.stage = !reviewed
        ? "import_review"
        : !targetSelected
          ? "resolve_target"
          : targetNeedsReconciliation && !reconciliationMatchesTarget
            ? "reconcile_profile"
            : unresolved > 0
              ? "resolve_conflicts"
              : "confirm_import";
      if (
        reviewed
        && targetSelected
        && state.stage === "confirm_import"
        && !["completed", "failed", "cancelled"].includes(state.completionStatus)
      ) {
        state.completionStatus = hasValue(state.knownSlots.pendingConfirmation)
          ? "waiting_for_confirmation"
          : "active";
      } else if (state.stage === "reconcile_profile") {
        state.completionStatus = "active";
      } else if (state.stage === "resolve_conflicts") {
        state.completionStatus = "waiting_for_user";
      }
    }
  }
  if (
    state.workflowId === "job_ingestion"
    && (
      !["collect_job_identity", "collect_job_description", "parse_job", "confirm_commit", "completed"].includes(state.stage)
      || (state.stage === "parse_job" && hasValue(state.knownSlots.graph))
    )
  ) {
    const hasRawText = hasValue(state.knownSlots.rawText);
    const hasGraph = hasValue(state.knownSlots.graph);
    const identity = ["title", "company"];
    if (!hasRawText) {
      state.stage = "collect_job_description";
      state.requiredSlots = ["rawText"];
    } else if (!hasGraph) {
      state.stage = "parse_job";
      state.requiredSlots = ["rawText"];
    } else {
      const missingIdentity = identity.filter((slot) => !hasValue(state.knownSlots[slot]));
      state.stage = missingIdentity.length ? "complete_job_identity" : "review_job";
      state.requiredSlots = identity;
      if (!missingIdentity.length && state.completionStatus === "active") state.stage = "confirm_commit";
    }
  } else if (state.workflowId !== "job_ingestion") {
    const workflow = getWorkflowDefinition(state.workflowId);
    state.requiredSlots = workflow?.requiredSlots[state.stage] ?? state.requiredSlots;
  }
  state.missingSlots = state.requiredSlots.filter((slot) => !hasValue(state.knownSlots[slot]));
  if (
    state.completionStatus === "waiting_for_confirmation"
    && !hasValue(state.knownSlots.pendingConfirmation)
  ) {
    state.completionStatus = "active";
  }
  return state;
}

function supersedeConfirmation(state: AgentTaskState, toolName: string) {
  delete state.knownSlots.pendingConfirmation;
  delete state.knownSlots.confirmationAccepted;
  delete state.dependencySnapshots.pendingApplyConfirmation;
  state.completionStatus = "active";

  if (toolName === "commit_profile_intake") {
    // The reviewed intake draft is authoritative upstream data. A correction
    // supersedes only the commit/reconciliation derived from it; the next
    // capture can merge the user's correction into the same draft revision.
    for (const slot of [
      "intakeReconciliation",
      "expectedIntakeReconciliationRevision"
    ]) {
      delete state.knownSlots[slot];
    }
    state.stage = "collect_experience";
    return;
  }
  if (toolName === "commit_resume_import") {
    delete state.knownSlots.importReconciliation;
    delete state.knownSlots.expectedReconciliationRevision;
    delete state.knownSlots.reconciliationDecision;
    state.stage = hasValue(state.knownSlots.importTarget) ? "reconcile_profile" : "resolve_target";
    return;
  }
  if (toolName === "apply_tailoring_changes") {
    invalidateDerivedState(state);
    return;
  }
  if (toolName === "commit_job") {
    state.stage = hasValue(state.knownSlots.graph) ? "confirm_commit" : "parse_job";
  }
}

function setUserRootGoal(state: AgentTaskState, goal: string) {
  state.rootGoal = goal;
  state.activeGoal = goal;
  state.goal = state.rootGoal;
}

function mergeObservationSlots(state: AgentTaskState, toolName: string, observation: unknown) {
  const value = objectValue(observation);
  if (toolName === "list_resumes") {
    const resumes = Array.isArray(value.resumes) ? value.resumes.map(objectValue) : [];
    const targetProfileId = state.selectedEntities.profileId ?? stringValue(state.knownSlots.targetProfileId);
    const ownedResumes = targetProfileId
      ? resumes.filter((resume) => resume.profileId === targetProfileId)
      : resumes;
    const resumeCandidates: Record<string, unknown>[] = ownedResumes.map((resume, index) => ({
      ...resume,
      order: typeof resume.order === "number" ? resume.order : index + 1
    }));
    state.knownSlots.resumeCandidates = resumeCandidates.map(compactEntityCandidate);
    state.knownSlots.resumeCandidateSetRevision = stableHashText(JSON.stringify(state.knownSlots.resumeCandidates));
    const reference = state.knownSlots.resumeReference ?? state.knownSlots.resumeSelectionPreference;
    const selected: Record<string, unknown> | undefined = reference
      ? selectResumeReference(resumeCandidates, reference)
      : isTailoringGoal(state.rootGoal) && !targetProfileId
        ? undefined
        : resumeCandidates.length === 1 ? resumeCandidates[0] : undefined;
    const id = stringValue(selected?.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "resume",
        entityId: id,
        revisionId: stringValue(selected?.currentRevisionId),
        version: scalarValue(selected?.revision)
      });
      state.knownSlots.selectedResumeName = stringValue(selected?.name);
      delete state.knownSlots.resumeSelectionRequired;
    } else if (isTailoringGoal(state.rootGoal) && resumeCandidates.length > 1) {
      state.knownSlots.resumeSelectionRequired = true;
      state.stage = "choose_resume_source";
      state.completionStatus = "waiting_for_user";
    }
  }
  if (toolName === "list_jobs") {
    const jobs = Array.isArray(value.jobs) ? value.jobs.map(objectValue) : [];
    const jobCandidates: Record<string, unknown>[] = [...new Map(jobs.map((job, index) => [String(job.id), {
      ...job,
      order: typeof job.order === "number" ? job.order : index + 1
    }])).values()];
    state.knownSlots.jobCandidates = jobCandidates.map(compactJobCandidate);
    state.knownSlots.jobCandidateSetRevision = stableHashText(JSON.stringify(state.knownSlots.jobCandidates));
    const jobReference = stringValue(state.knownSlots.jobReference);
    const resolution = jobReference
      ? resolveTailoringEntityReference(jobReference, jobCandidates as TailoringContextCandidate[])
      : undefined;
    const selected: Record<string, unknown> | undefined = resolution?.status === "resolved"
      ? resolution.candidate
      : !jobReference && jobCandidates.length === 1 ? jobCandidates[0] : undefined;
    const id = stringValue(selected?.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(selected?.revision ?? selected?.updatedAt)
      });
      state.knownSlots.selectedJobTitle = stringValue(selected?.title);
      state.knownSlots.selectedJobCompany = stringValue(selected?.company);
      delete state.knownSlots.jobSelectionError;
    } else if (isTailoringGoal(state.rootGoal) && (jobCandidates.length > 1 || Boolean(jobReference))) {
      if (state.selectedEntities.profileId && state.selectedEntities.resumeId) {
        state.stage = "choose_job";
        state.completionStatus = "waiting_for_user";
      }
      if (resolution?.status === "ambiguous") {
        state.knownSlots.jobSelectionError = "ambiguous";
        state.knownSlots.jobSelectionAmbiguity = resolution.candidates.map(compactJobCandidate);
      } else if (jobReference) {
        state.knownSlots.jobSelectionError = "not_found";
        delete state.knownSlots.jobSelectionAmbiguity;
      }
    }
  }
  if (toolName === "get_active_profile") {
    const id = stringValue(value.profileId);
    if (id) {
      if (state.workflowId === "guided_profile_intake") {
        observeProfileIntakeTarget(state, {
          profileId: id,
          profileName: stringValue(value.name),
          profileVersion: scalarValue(value.version)
        });
      } else {
        updateAuthoritativeEntity(state, {
          type: "entity_revision",
          entityType: "profile",
          entityId: id,
          version: scalarValue(value.version)
        });
        bindAutoSelectedResumeFromCandidates(state);
      }
    }
  }
  if (toolName === "list_profiles" && state.rootGoal === "import_resume") {
    const profiles = Array.isArray(value.profiles) ? value.profiles.map(objectValue) : [];
    const requestedName = stringValue(state.knownSlots.importTargetProfileName);
    const selected = requestedName
      ? profiles.find((profile) => profile.name === requestedName || String(profile.name ?? "").includes(requestedName))
      : profiles.length === 1 ? profiles[0] : undefined;
    const id = stringValue(selected?.id);
    if (id && state.knownSlots.importTargetIntent === "existing") {
      state.knownSlots.importTarget = { mode: "existing", profileId: id };
    }
  }
  if (toolName === "get_profile") {
    const profile = objectValue(value.profile);
    const id = stringValue(profile.id ?? value.profileId);
    if (id) {
      if (state.workflowId === "guided_profile_intake") {
        observeProfileIntakeTarget(state, {
          profileId: id,
          profileName: stringValue(profile.name ?? value.name),
          profileVersion: scalarValue(profile.version ?? value.profileVersion)
        });
      } else {
        updateAuthoritativeEntity(state, {
          type: "entity_revision",
          entityType: "profile",
          entityId: id,
          version: scalarValue(profile.version ?? value.profileVersion)
        });
      }
      if (state.rootGoal === "create_resume_from_profile") {
        const items = Array.isArray(profile.items) ? profile.items.map(objectValue) : [];
        state.knownSlots.profileItemCandidates = items;
        if (state.stage === "select_profile_scope") state.stage = "select_facts";
      }
    }
  }
  if (toolName === "search_profile_facts" && state.rootGoal === "create_resume_from_profile") {
    const results = Array.isArray(value.results) ? value.results.map(objectValue) : [];
    state.knownSlots.profileItemCandidates = results;
    if (results.length && state.stage === "select_facts") state.stage = "review_resume_plan";
  }
  if (toolName === "get_resume") {
    const resume = objectValue(value.resume);
    const id = stringValue(resume.id ?? value.resumeId);
    if (id) {
      const resumeProfileId = stringValue(resume.profileId ?? value.profileId);
      const targetProfileId = stringValue(state.knownSlots.targetProfileId);
      if (targetProfileId && resumeProfileId && resumeProfileId !== targetProfileId) {
        clearResumeSelection(state);
        state.knownSlots.resumeOwnershipMismatch = {
          resumeId: id,
          resumeProfileId,
          targetProfileId
        };
        return;
      }
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "resume",
        entityId: id,
        revisionId: stringValue(resume.currentRevisionId ?? value.resumeRevisionId),
        version: scalarValue(resume.revision),
        hash: stringValue(resume.resumeHash ?? value.resumeHash)
      });
      if (state.rootGoal === "export_resume" && state.workflowId === "repair_and_export_resume") {
        state.stage = "export";
        state.completionStatus = "active";
      }
    }
  }
  if (toolName === "get_job") {
    const job = objectValue(value.job);
    const id = stringValue(job.id ?? value.jobId);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(job.revision ?? job.updatedAt ?? value.jobRevision),
        hash: stringValue(job.jobGraphHash ?? value.jobGraphHash)
      });
    }
  }
  if (toolName === "parse_job_description") {
    state.knownSlots.graph = value.graph ?? value.requirementGraph ?? state.knownSlots.graph;
    state.knownSlots.title = value.candidateTitle ?? value.title ?? state.knownSlots.title;
    state.knownSlots.company = value.candidateCompany ?? value.company ?? state.knownSlots.company;
  }
  if (toolName === "commit_job") {
    const id = stringValue(value.jobId ?? value.id);
    if (id) {
      updateAuthoritativeEntity(state, {
        type: "entity_revision",
        entityType: "job",
        entityId: id,
        version: scalarValue(value.jobRevision ?? value.updatedAt),
        hash: stringValue(value.jobGraphHash)
      });
    }
  }
  if (toolName === "apply_tailoring_changes") {
    const revision = objectValue(value.revision);
    const branch = objectValue(value.branch);
    const id = stringValue(value.revisionId ?? revision.id);
    const branchId = stringValue(value.branchId ?? branch.id);
    if (branchId) state.selectedEntities.resumeId = branchId;
    if (id) {
      state.selectedEntities.revisionId = id;
      state.selectedEntities.resumeRevisionId = id;
    }
    const hash = stringValue(value.resumeHash);
    if (hash) state.selectedEntities.resumeHash = hash;
  }
  if (
    state.knownSlots.sourceRoute === "existing_resume_to_job_revision"
    && state.stage === "choose_resume_source"
    && state.selectedEntities.profileId
    && state.selectedEntities.resumeId
    && state.selectedEntities.jobId
  ) {
    state.activeGoal = "analyze_job_fit";
    state.stage = "analyze_fit";
    state.completionStatus = "active";
  }
}

function observeProfileIntakeTarget(state: AgentTaskState, authority: {
  profileId: string;
  profileName?: string;
  profileVersion?: string | number;
}) {
  const targetProfileId = stringValue(state.knownSlots.targetProfileId);
  const expectedVersion = scalarValue(state.knownSlots.expectedProfileVersion);
  if (!targetProfileId) {
    state.knownSlots.targetProfileId = authority.profileId;
    state.knownSlots.targetProfileName = authority.profileName;
    state.knownSlots.expectedProfileVersion = authority.profileVersion;
    state.knownSlots.acknowledgedActiveProfileId = authority.profileId;
    state.selectedEntities.profileId = authority.profileId;
    state.selectedEntities.profileVersion = authority.profileVersion;
    if (state.stage === "resolve_profile_target") {
      state.stage = "collect_experience";
      state.completionStatus = "waiting_for_user";
    }
    return;
  }
  if (targetProfileId === authority.profileId) {
    const versionChanged = expectedVersion !== undefined
      && authority.profileVersion !== undefined
      && expectedVersion !== authority.profileVersion;
    state.knownSlots.targetProfileName = authority.profileName ?? state.knownSlots.targetProfileName;
    state.knownSlots.expectedProfileVersion = authority.profileVersion ?? expectedVersion;
    state.selectedEntities.profileId = authority.profileId;
    state.selectedEntities.profileVersion = authority.profileVersion ?? expectedVersion;
    if (versionChanged && hasValue(state.knownSlots.intakeImportId)) {
      delete state.knownSlots.intakeReconciliation;
      delete state.knownSlots.expectedIntakeReconciliationRevision;
      state.stage = "reconcile_profile";
      state.completionStatus = "active";
    } else if (state.stage === "resolve_profile_target") {
      state.stage = "collect_experience";
      state.completionStatus = "waiting_for_user";
    }
    return;
  }
  state.knownSlots.pendingProfileTarget = {
    original: {
      profileId: targetProfileId,
      profileName: state.knownSlots.targetProfileName,
      profileVersion: expectedVersion
    },
    active: {
      profileId: authority.profileId,
      profileName: authority.profileName,
      profileVersion: authority.profileVersion
    }
  };
  state.pendingDecision = {
    type: "profile_intake_target",
    options: ["switch_to_active", "keep_original"]
  };
  state.stage = "resolve_profile_target";
  state.completionStatus = "waiting_for_user";
}

function resolveProfileIntakeTargetDecision(
  state: AgentTaskState,
  option: "profile" | "existing_resume" | "switch_to_active" | "keep_original" | "save_profile_only" | "generate_general_resume"
) {
  const pending = objectValue(state.knownSlots.pendingProfileTarget);
  const target = option === "switch_to_active"
    ? objectValue(pending.active)
    : option === "keep_original"
      ? objectValue(pending.original)
      : undefined;
  const profileId = stringValue(target?.profileId);
  if (!profileId) return;
  const changed = profileId !== state.knownSlots.targetProfileId;
  state.knownSlots.targetProfileId = profileId;
  state.knownSlots.targetProfileName = target?.profileName;
  state.knownSlots.expectedProfileVersion = scalarValue(target?.profileVersion);
  state.knownSlots.acknowledgedActiveProfileId = stringValue(objectValue(pending.active).profileId);
  state.selectedEntities.profileId = profileId;
  state.selectedEntities.profileVersion = scalarValue(target?.profileVersion);
  if (changed) {
    clearResumeSelection(state);
    delete state.knownSlots.intakeReconciliation;
    delete state.knownSlots.expectedIntakeReconciliationRevision;
  }
  delete state.knownSlots.pendingProfileTarget;
  state.pendingDecision = undefined;
  state.stage = hasValue(state.knownSlots.intakeImportId) ? "reconcile_profile" : "collect_experience";
  state.completionStatus = state.stage === "collect_experience" ? "waiting_for_user" : "active";
}

function clearResumeSelection(state: AgentTaskState) {
  state.selectedEntities.resumeId = undefined;
  state.selectedEntities.resumeRevisionId = undefined;
  state.selectedEntities.resumeHash = undefined;
  state.selectedEntities.revisionId = undefined;
  for (const key of ["resumeId", "resumeRevisionId", "resumeHash", "recommendedResumeId", "selectedResumeName", "resumeCandidates", "resumeSelectionRequired"]) {
    delete state.knownSlots[key];
  }
  state.dependencySnapshots = {};
}

function captureTailoringTruth(state: AgentTaskState, observation: unknown) {
  const value = objectValue(observation);
  const session = objectValue(value.session);
  const plan = objectValue(session.plan);
  const questions = Array.isArray(plan.clarificationQuestions) ? plan.clarificationQuestions : [];
  const answers = Array.isArray(plan.clarificationAnswers) ? plan.clarificationAnswers : [];
  const questionPlan = objectValue(plan.questionPlan);
  const tailoringSessionId = stringValue(session.id);
  if (tailoringSessionId) state.selectedEntities.tailoringSessionId = tailoringSessionId;
  state.knownSlots.tailoringSession = value.session;
  state.knownSlots.questionPlan = plan.questionPlan;
  state.knownSlots.activeQuestionId = questionPlan.activeQuestionId;
  state.knownSlots.answeredQuestionIds = Array.isArray(questionPlan.answeredQuestionIds) ? questionPlan.answeredQuestionIds : [];
  state.knownSlots.skippedQuestionIds = Array.isArray(questionPlan.skippedQuestionIds) ? questionPlan.skippedQuestionIds : [];
  state.knownSlots.selectedDiffs = Array.isArray(value.appliedDiffs)
    ? value.appliedDiffs
    : Array.isArray(plan.diffs)
      ? plan.diffs
      : [];
  state.knownSlots.confirmedRequirementIds = answers.flatMap((answer) => {
    const ids = objectValue(answer).requirementIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
  const activeQuestionId = stringValue(questionPlan.activeQuestionId);
  state.knownSlots.currentClarification = activeQuestionId
    ? questions.find((question) => stringValue(objectValue(question).id) === activeQuestionId)
    : undefined;
  state.stage = activeQuestionId ? "clarify_unsupported_facts" : "generate_changes";
  state.activeGoal = activeQuestionId ? "clarify_tailoring" : "generate_tailoring_changes";
  state.completionStatus = activeQuestionId ? "waiting_for_user" : "active";
}

function selectResumeSourceRoute(
  state: AgentTaskState,
  option: "profile" | "existing_resume"
) {
  state.pendingDecision = undefined;
  state.completionStatus = "active";
  if (option === "profile") {
    state.knownSlots.sourceRoute = "profile_to_job_resume";
    state.stage = "create_profile_resume";
    return;
  }
  state.knownSlots.sourceRoute = "existing_resume_to_job_revision";
  const recommendedResumeId = stringValue(state.knownSlots.recommendedResumeId);
  if (recommendedResumeId) {
    updateAuthoritativeEntity(state, {
      type: "entity_revision",
      entityType: "resume",
      entityId: recommendedResumeId
    });
  }
  state.activeGoal = "analyze_job_fit";
  state.stage = recommendedResumeId ? "analyze_fit" : "choose_resume_source";
}

function updateAuthoritativeEntity(
  state: AgentTaskState,
  event: Extract<AgentTaskEvent, { type: "entity_revision" }>
) {
  const idKey = `${event.entityType}Id` as "profileId" | "resumeId" | "jobId";
  const previousId = state.selectedEntities[idKey];
  const versionKey = event.entityType === "profile"
    ? "profileVersion"
    : event.entityType === "job"
      ? "jobRevision"
      : undefined;
  const previousVersion = versionKey ? state.selectedEntities[versionKey] : undefined;
  const previousRevisionId = event.entityType === "resume"
    ? state.selectedEntities.resumeRevisionId
    : undefined;
  const previousHash = event.entityType === "resume"
    ? state.selectedEntities.resumeHash
    : event.entityType === "job"
      ? state.selectedEntities.jobGraphHash
      : undefined;
  const changed = Boolean(
    previousId && previousId !== event.entityId
    || previousId === event.entityId && event.version !== undefined && previousVersion !== undefined && event.version !== previousVersion
    || previousId === event.entityId && event.revisionId && previousRevisionId && event.revisionId !== previousRevisionId
    || previousId === event.entityId && event.hash && previousHash && event.hash !== previousHash
  );
  if (changed) invalidateDerivedState(state);
  state.selectedEntities[idKey] = event.entityId;
  state.knownSlots[idKey] = event.entityId;
  if (event.entityType === "profile" && event.version !== undefined) {
    state.selectedEntities.profileVersion = event.version;
    state.knownSlots.profileVersion = event.version;
  }
  if (event.entityType === "resume") {
    if (event.revisionId) {
      state.selectedEntities.resumeRevisionId = event.revisionId;
      state.knownSlots.resumeRevisionId = event.revisionId;
    }
    if (event.hash) state.selectedEntities.resumeHash = event.hash;
    if (event.hash) state.knownSlots.resumeHash = event.hash;
  }
  if (event.entityType === "job") {
    if (event.version !== undefined) {
      state.selectedEntities.jobRevision = event.version;
      state.knownSlots.jobRevision = event.version;
    }
    if (event.hash) state.selectedEntities.jobGraphHash = event.hash;
    if (event.hash) state.knownSlots.jobGraphHash = event.hash;
  }
}

function invalidateDerivedState(state: AgentTaskState) {
  for (const key of [
    "fitAnalysis",
    "tailoringSession",
    "selectedDiffs",
    "confirmedRequirementIds",
    "currentClarification",
    "previewComplete",
    "confirmationAccepted",
    "qualityResult",
    "pendingConfirmation"
  ]) {
    delete state.knownSlots[key];
  }
  state.pendingDecision = undefined;
  state.dependencySnapshots = {};
  state.selectedEntities.tailoringSessionId = undefined;
  state.selectedEntities.revisionId = undefined;
  if (["apply_to_job", "create_tailored_resume"].includes(state.rootGoal)) {
    state.activeGoal = state.selectedEntities.resumeId ? "analyze_job_fit" : "resolve_resume_source";
    state.workflowId = "tailor_existing_resume";
    state.stage = state.selectedEntities.resumeId ? "analyze_fit" : "choose_resume_source";
    state.completionStatus = "active";
  }
}

export function dependencySnapshot(
  state: AgentTaskState,
  observation?: unknown
): AgentTaskState["dependencySnapshots"]["fitResult"] {
  const value = objectValue(observation);
  const dependencies = objectValue(value.dependencies);
  return {
    profileId: stringValue(dependencies.profileId) ?? state.selectedEntities.profileId,
    profileVersion: scalarValue(dependencies.profileVersion) ?? state.selectedEntities.profileVersion,
    resumeId: stringValue(dependencies.resumeId) ?? state.selectedEntities.resumeId,
    resumeRevisionId: stringValue(dependencies.resumeRevisionId) ?? state.selectedEntities.resumeRevisionId,
    resumeHash: stringValue(dependencies.resumeHash) ?? state.selectedEntities.resumeHash,
    jobId: stringValue(dependencies.jobId) ?? state.selectedEntities.jobId,
    jobRevision: scalarValue(dependencies.jobRevision) ?? state.selectedEntities.jobRevision,
    jobGraphHash: stringValue(dependencies.jobGraphHash) ?? state.selectedEntities.jobGraphHash,
    tailoringSessionId: stringValue(dependencies.tailoringSessionId)
      ?? state.selectedEntities.tailoringSessionId
  };
}

function computeTier(goal: string, message = ""): AgentTaskState["computeTier"] {
  const text = `${goal} ${message}`;
  if (/导出|生成|定制|改写|tailor|apply_to_job/i.test(text)) return "T3";
  if (/分析|匹配|评估|岗位|JD/i.test(text)) return "T2";
  if (/查看|查找|搜索|资料|简历/i.test(text)) return "T1";
  return "T0";
}

function workflowStatus(status: AgentSession["workflowState"]["status"]): AgentTaskState["completionStatus"] {
  if (status === "waiting_for_confirmation") return "waiting_for_confirmation";
  if (status === "waiting_for_user" || status === "paused") return "waiting_for_user";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  return "active";
}

function looksLikeJd(value: string) {
  return value.trim().length >= 240 && /职责|工作内容|responsibilit/i.test(value) && /要求|任职资格|qualification|requirement/i.test(value);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function scalarValue(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : undefined;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isTailoringGoal(goal: string) {
  return ["create_tailored_resume", "apply_to_job", "analyze_job_fit"].includes(goal);
}

function captureEntityReferences(state: AgentTaskState, message: string) {
  if (/通用简历/.test(message)) {
    state.knownSlots.resumeReference = "latest_general";
  } else if (/第二(?:份|个)(?:简历)?/.test(message)) {
    state.knownSlots.resumeReference = "second";
  }
  const jobMatch = message.match(/(?:针对|优化|适配)\s*(?:岗位)?\s*([^，。！？!]+?)(?:\s*(?:做|创建|生成|定制)(?:岗位简历|版本|简历)?)?$/u);
  const jobReference = jobMatch?.[1]?.trim();
  if (jobReference && !/^(?:简历|版本|岗位定制版本)$/u.test(jobReference)) {
    state.knownSlots.jobReference = jobReference;
  }
  if (/刚才那个岗位|还是上一份/.test(message)) {
    state.knownSlots.reuseSelectedJob = true;
  }
}

function resolvePendingTailoringSelection(state: AgentTaskState, message: string) {
  if (state.stage === "choose_resume_source" && state.knownSlots.resumeSelectionRequired) {
    const resumeCandidates = Array.isArray(state.knownSlots.resumeCandidates)
      ? state.knownSlots.resumeCandidates.map(objectValue) as TailoringContextCandidate[]
      : [];
    const reference = message.trim() || stringValue(state.knownSlots.resumeReference);
    if (resumeCandidates.length > 0 && reference) {
      const resolution = resolveTailoringEntityReference(reference, resumeCandidates);
      if (resolution.status === "resolved") {
        const candidate = resolution.candidate;
        updateAuthoritativeEntity(state, {
          type: "entity_revision",
          entityType: "resume",
          entityId: candidate.id,
          revisionId: stringValue(candidate.currentRevisionId),
          version: scalarValue(candidate.revision)
        });
        state.knownSlots.selectedResumeName = stringValue(candidate.name);
        delete state.knownSlots.resumeSelectionRequired;
        state.completionStatus = "active";
      } else {
        state.knownSlots.resumeSelectionError = resolution.status === "ambiguous" ? "ambiguous" : "not_found";
        state.completionStatus = "waiting_for_user";
      }
    }
    return;
  }
  const candidates = Array.isArray(state.knownSlots.jobCandidates)
    ? state.knownSlots.jobCandidates.map(objectValue) as TailoringContextCandidate[]
    : [];
  const explicitReference = stringValue(state.knownSlots.jobReference);
  const waitingForJob = state.stage === "choose_job" || candidates.length > 0 && !state.selectedEntities.jobId;
  if (!waitingForJob || candidates.length === 0) return;

  const reference = message.trim() || explicitReference;
  if (!reference || /^(?:我想|我要|请|帮我|用现有简历|用通用简历)/u.test(reference)) return;
  const resolution = resolveTailoringEntityReference(reference, candidates);
  if (resolution.status === "resolved") {
    const candidate = resolution.candidate;
    updateAuthoritativeEntity(state, {
      type: "entity_revision",
      entityType: "job",
      entityId: candidate.id,
      version: scalarValue(candidate.revision ?? candidate.updatedAt)
    });
    state.knownSlots.selectedJobTitle = stringValue(candidate.title);
    state.knownSlots.selectedJobCompany = stringValue(candidate.company);
    state.knownSlots.jobReference = reference;
    delete state.knownSlots.jobSelectionError;
    delete state.knownSlots.jobSelectionAmbiguity;
    state.stage = state.selectedEntities.profileId && state.selectedEntities.resumeId ? "analyze_fit" : "choose_resume_source";
    state.activeGoal = state.stage === "analyze_fit" ? "analyze_job_fit" : "resolve_resume_source";
    state.completionStatus = "active";
    return;
  }
  state.stage = "choose_job";
  state.completionStatus = "waiting_for_user";
  state.knownSlots.jobSelectionError = resolution.status === "ambiguous" ? "ambiguous" : "not_found";
  state.knownSlots.jobSelectionAmbiguity = resolution.status === "ambiguous"
    ? resolution.candidates.map(compactJobCandidate)
    : undefined;
}

function captureImportTargetIntent(state: AgentTaskState, message: string) {
  if (/保留(资料库)?原数据/.test(message)) {
    state.knownSlots.reconciliationDecision = "keep_existing";
  } else if (/采用本次(导入)?/.test(message)) {
    state.knownSlots.reconciliationDecision = "use_imported";
  } else if (/视为不同(经历|项目|内容)/.test(message)) {
    state.knownSlots.reconciliationDecision = "keep_both_as_distinct";
  }
  if (
    /新建|新资料库|新人物|(?:创建|建立)(?:一个|新的?)?(?:职业)?(?:档案|资料库)/.test(message)
  ) {
    const name = extractNewImportProfileName(message);
    state.knownSlots.importTargetIntent = "new";
    state.knownSlots.importTarget = name
      ? { mode: "new", profileName: name, createGeneralResume: true }
      : undefined;
    if (name) state.knownSlots.importTargetProfileName = name;
    return;
  }
  if (/现有|已有|资料库|保存到/.test(message)) {
    const candidateName = message.match(/保存到\s*([^，。,]{1,40}?)(?:的)?资料库/)?.[1]?.trim();
    const name = candidateName && !/^(现有|已有|当前|我的)$/.test(candidateName)
      ? candidateName
      : undefined;
    state.knownSlots.importTargetIntent = "existing";
    if (name) state.knownSlots.importTargetProfileName = name;
  }
  if (/忽略.*(不确定|未分类|待确认)|舍弃.*(不确定|未分类|待确认)/.test(message)) {
    state.knownSlots.reviewDecision = "ignore_uncertain";
  } else if (/确认无误|核对完成|全部采用|确认这些信息|采用.*来源明确/.test(message)) {
    state.knownSlots.reviewDecision = "accept_all";
  }
}

function extractNewImportProfileName(message: string) {
  return (
    message.match(/(?:叫|名称为|名为)\s*([^，。,]{1,40})/)?.[1]
    ?? message.match(/(?:这个|该)\s*([^，。,\s]{1,20}?)(?:的)?资料库/)?.[1]
  )?.trim();
}

function selectResumeReference(
  resumes: Record<string, unknown>[],
  reference: unknown
) {
  if (reference === "second") return resumes[1];
  if (reference === "latest_general") {
    return resumes
      .filter((resume) => resume.purpose === "general")
      .sort(byLatest)[0];
  }
  if (typeof reference === "string") {
    const resolution = resolveTailoringEntityReference(reference, resumes as TailoringContextCandidate[]);
    return resolution.status === "resolved" ? resolution.candidate : undefined;
  }
  return undefined;
}

function compactEntityCandidate(value: Record<string, unknown>) {
  return {
    id: stringValue(value.id),
    title: stringValue(value.title),
    company: stringValue(value.company),
    name: stringValue(value.name),
    purpose: stringValue(value.purpose),
    profileId: stringValue(value.profileId),
    revision: scalarValue(value.revision),
    currentRevisionId: stringValue(value.currentRevisionId),
    updatedAt: stringValue(value.updatedAt),
    order: typeof value.order === "number" ? value.order : undefined
  };
}

function compactJobCandidate(value: Record<string, unknown>) {
  return {
    id: stringValue(value.id),
    title: stringValue(value.title),
    company: stringValue(value.company),
    revision: scalarValue(value.revision),
    updatedAt: stringValue(value.updatedAt),
    source: stringValue(value.source ?? value.sourceType),
    graphHash: stringValue(value.graphHash ?? value.jobGraphHash ?? value.sourceHash),
    order: typeof value.order === "number" ? value.order : undefined
  };
}

function bindAutoSelectedResumeFromCandidates(state: AgentTaskState) {
  if (!isTailoringGoal(state.rootGoal) || state.selectedEntities.resumeId) return;
  const profileId = state.selectedEntities.profileId;
  const candidates = Array.isArray(state.knownSlots.resumeCandidates)
    ? state.knownSlots.resumeCandidates.map(objectValue).filter((candidate) => !profileId || candidate.profileId === profileId)
    : [];
  if (candidates.length !== 1) return;
  const selected = candidates[0];
  const id = stringValue(selected.id);
  if (!id) return;
  updateAuthoritativeEntity(state, {
    type: "entity_revision",
    entityType: "resume",
    entityId: id,
    revisionId: stringValue(selected.currentRevisionId),
    version: scalarValue(selected.revision)
  });
  state.knownSlots.selectedResumeName = stringValue(selected.name);
  delete state.knownSlots.resumeSelectionRequired;
}

function byLatest(left: Record<string, unknown>, right: Record<string, unknown>) {
  return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
}
