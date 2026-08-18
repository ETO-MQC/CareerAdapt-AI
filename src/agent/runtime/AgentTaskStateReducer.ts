import type { AgentSession, AgentTaskState } from "@/agent/contracts/agentSession";
import { canonicalWorkflowId, getWorkflowDefinition, isTailoringWorkflowId } from "@/agent/workflows/workflowRegistry";
import {
  classifyProfileIntakeTurn,
  hasExplicitCorrectionReplacement,
  isProfileIntakeDraftRequest,
  isProfileIntakeReferenceQuestion,
  type ProfileIntakeTurnKind,
  type TurnIntent
} from "./AgentTurnIntent";
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
import { ProfileIntakeReviewProjectionSchema, type ProfileIntakeReviewProjection } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { ResumeCompositionInformationNeedSchema } from "@/domain/resumeComposition/contracts";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import { normalizeTailoringStage } from "@/agent/workflows/tailoringStage";
import { createTurnScopedTargetContext } from "./turnScopedTargetContext";

export type AgentTaskEvent =
  | {
      type: "user_message";
      message: string;
      sessionId?: string;
      messageId?: string;
      turnId?: string;
      capturedAt?: string;
      turnIntent?: TurnIntent;
      profileIntakeTurnKind?: ProfileIntakeTurnKind;
    }
  | { type: "new_root_task"; goal: string; workflowId: string; stage: string }
  | { type: "new_active_task"; goal: string; workflowId: string; stage: string }
  | {
      type: "authoritative_workflow_selected";
      rootGoal: "generate_job_specific_resume";
      workflowId: "tailor_resume";
      stage: string;
      completionType: "transactional";
    }
  | { type: "restart_profile_intake" }
  | { type: "attachment_selected"; attachment: AgentAttachmentRef }
  | { type: "slot_answer"; slot: string; value: unknown }
  | {
      type: "decision_selected";
      decisionType: "resume_source_route" | "job_target_persistence" | "profile_intake_target" | "profile_intake_resume" | "profile_intake_post_save";
      option: "profile" | "existing_resume" | "session_only" | "save_job" | "switch_to_active" | "keep_original" | "save_profile_only" | "generate_general_resume" | "finish";
    }
  | { type: "tool_observation"; toolName: string; observation: unknown; artifactIds?: string[] }
  | { type: "tool_failure"; toolName: string; operationId?: string; errorCode: string; message?: string; recoverable?: boolean }
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
    const tailoringWorkflow = isTailoringWorkflowId(session.workflowState.workflowId);
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
        ...(tailoringWorkflow && session.activeResumeId ? { sourceResumeId: session.activeResumeId } : {}),
        jobId: session.activeJobId,
        revisionId: stringValue(knownSlots.revisionId)
      },
      dependencySnapshots: {},
      artifacts: session.artifactRefs.map((artifact) => artifact.id),
      completionStatus: workflowStatus(session.workflowState.status),
      completionType: session.workflowState.workflowId === "tailor_resume" ? "transactional" : "conversational",
      computeTier: computeTier(goal),
      updatedAt: now
    };
    return normalize(state);
  }

  reduce(previous: AgentTaskState, event: AgentTaskEvent): AgentTaskState {
    const state = structuredClone(previous);
    state.updatedAt = new Date().toISOString();
    if (event.type === "authoritative_workflow_selected") {
      state.goal = event.rootGoal;
      state.rootGoal = event.rootGoal;
      state.activeGoal = event.rootGoal;
      state.workflowId = event.workflowId;
      state.stage = event.stage;
      state.completionType = event.completionType;
      state.completionStatus = "active";
      state.pendingDecision = undefined;
      return normalize(state);
    }
    if (event.type === "new_root_task") {
      const workflowId = canonicalWorkflowId(event.workflowId);
      return normalize({
        ...state,
        goal: event.goal,
        rootGoal: event.goal,
        activeGoal: event.goal,
        workflowId,
        stage: event.stage,
        requiredSlots: [],
        knownSlots: workflowId === "compose_resume"
          ? {
              resumeCompositionPendingInformationNeed: defaultResumeCompositionInformationNeed(),
              resumeCompositionBranchMode: "create_new"
            }
          : {},
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
        completionType: workflowId === "tailor_resume"
          ? "transactional"
          : "conversational",
        computeTier: computeTier(event.goal),
        updatedAt: new Date().toISOString()
      });
    }
    if (event.type === "new_active_task") {
      state.activeGoal = event.goal;
      state.workflowId = canonicalWorkflowId(event.workflowId);
      state.stage = event.stage;
      state.requiredSlots = [];
      state.missingSlots = [];
      state.pendingDecision = undefined;
      state.completionStatus = "active";
      state.completionType = state.workflowId === "tailor_resume"
        ? "transactional"
        : state.completionType;
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
      if (looksLikeJd(event.message)) {
        const targetText = event.message.trim();
        if (event.turnId) {
          state.knownSlots.turnScopedTargetContext = createTurnScopedTargetContext({
            logicalTurnId: event.turnId,
            targetText,
            createdAt: event.capturedAt ?? state.updatedAt
          });
        }
        if (
          state.rootGoal === "apply_to_external_job"
          || state.rootGoal === "generate_job_specific_resume"
          || state.rootGoal === "clarify_external_target"
        ) {
          state.knownSlots.rawText = targetText;
          state.knownSlots.targetSourceType = "pasted_jd";
          state.knownSlots.jobPersistenceDecision = "ask";
        }
      }
      if (state.workflowId === "guided_profile_intake") {
        const profileIntakeTurnKind = event.profileIntakeTurnKind ?? classifyProfileIntakeTurn({
          text: event.message,
          stage: state.stage,
          activeQuestionId: stringValue(state.knownSlots.activeQuestionId),
          activeQuestionLabel: stringValue(objectValue(state.knownSlots.intakeActiveQuestion).candidateLabel),
          expectedAnswerDimension: expectedProfileIntakeAnswerDimension(state)
        });
        const acceptedEvidenceKind = profileIntakeTurnKind === "correction"
          && hasExplicitCorrectionReplacement(event.message)
          ? "follow_up_answer" as const
          : profileIntakeTurnKind;
        const hasIntakeEvidence = isProfileIntakeEvidence(event.message, {
          stage: state.stage,
          activeQuestionId: stringValue(state.knownSlots.activeQuestionId),
          expectedAnswerDimension: expectedProfileIntakeAnswerDimension(state),
          turnKind: acceptedEvidenceKind
        });
        if (
          isSubstantiveProfileIntakeNarrative(event.message)
          && (state.stage === "profile_complete" || state.stage === "resume_ready")
        ) {
          resetProfileIntakeDraft(state);
          state.stage = "collect_experience";
        }
        const isIntakeAnswer = (
          (state.stage === "collect_experience" || state.stage === "review_facts")
          && event.message.trim()
          && isProfileIntakeAnswerTurn(acceptedEvidenceKind)
          && hasIntakeEvidence
        );
        const targetScopedAnswer = acceptedEvidenceKind === "follow_up_answer";
        const command = event.message.trim().replace(/[。！!？?\s]+$/g, "");
        const acceptedCandidateCount = acceptedIntakeCandidateCount(state);
        const hasIntakeCandidates = intakeCandidateCount(state) > 0;
        if ((acceptedCandidateCount > 0 || hasIntakeCandidates) && isProfileIntakeFinishCommand(command)) {
          state.pendingDecision = undefined;
          delete state.knownSlots.intakeFollowUpQuestion;
          if (isExplicitProfileIntakeSaveIntent(command)) {
            state.knownSlots.profileIntakeExplicitCommit = true;
            state.knownSlots.profileIntakeFinishRequested = true;
            state.stage = "final_review";
            state.knownSlots.profileIntakePhase = "ready_for_review";
            state.completionStatus = "active";
          } else {
            state.knownSlots.profileIntakeExplicitCommit = false;
            state.knownSlots.profileIntakeFinishRequested = false;
            state.stage = "final_review";
            state.knownSlots.profileIntakePhase = "ready_for_review";
            state.completionStatus = "waiting_for_user";
          }
        }
        if (isIntakeAnswer) {
          delete state.knownSlots.intakeRequestedSection;
          state.knownSlots.latestIntakeSource = {
            sourceKind: acceptedEvidenceKind,
            sessionId: event.sessionId,
            messageId: event.messageId,
            turnId: event.turnId,
            sourceContentHash: stableHashText(event.message.trim()),
            exactSourceQuote: event.message,
            capturedAt: event.capturedAt ?? state.updatedAt,
            classifiedAsEvidence: true,
            retracted: false,
            targetProfileId: state.knownSlots.targetProfileId,
            expectedProfileVersion: state.knownSlots.expectedProfileVersion,
            ...(targetScopedAnswer ? { intakeQuestionId: stringValue(state.knownSlots.activeQuestionId) } : {}),
            ...(targetScopedAnswer ? { intakeCandidateId: stringValue(objectValue(state.knownSlots.intakeActiveQuestion).candidateId) } : {}),
            ...(targetScopedAnswer ? { intakeDimension: stringValue(objectValue(state.knownSlots.intakeActiveQuestion).dimension) } : {})
          };
          state.stage = "structure_facts";
          state.pendingDecision = undefined;
          delete state.knownSlots.profileIntakeFinishDecision;
        }
        if (
          state.stage === "review_facts"
          && event.message.trim()
          && (acceptedEvidenceKind === "follow_up_answer" || acceptedEvidenceKind === "career_narrative")
          && hasIntakeEvidence
        ) {
          state.knownSlots.latestIntakeSource = {
            sourceKind: acceptedEvidenceKind,
            sessionId: event.sessionId,
            messageId: event.messageId,
            turnId: event.turnId,
            sourceContentHash: stableHashText(event.message.trim()),
            exactSourceQuote: event.message,
            capturedAt: event.capturedAt ?? state.updatedAt,
            classifiedAsEvidence: true,
            retracted: false,
            targetProfileId: state.knownSlots.targetProfileId,
            expectedProfileVersion: state.knownSlots.expectedProfileVersion,
            ...(acceptedEvidenceKind === "follow_up_answer" ? { intakeQuestionId: stringValue(state.knownSlots.activeQuestionId) } : {}),
            ...(acceptedEvidenceKind === "follow_up_answer" ? { intakeCandidateId: stringValue(objectValue(state.knownSlots.intakeActiveQuestion).candidateId) } : {}),
            ...(acceptedEvidenceKind === "follow_up_answer" ? { intakeDimension: stringValue(objectValue(state.knownSlots.intakeActiveQuestion).dimension) } : {})
          };
          state.stage = "structure_facts";
          state.pendingDecision = undefined;
          delete state.knownSlots.profileIntakeFinishDecision;
        }
        if (state.stage === "profile_complete" && state.pendingDecision?.type === "profile_intake_post_save") {
          if (/生成(?:一份)?(?:通用)?简历|创建(?:一份)?(?:通用)?简历/.test(event.message)) {
            state.pendingDecision = undefined;
            state.stage = "optional_resume_decision";
            state.completionStatus = "active";
          } else if (/暂时完成|先到这里|完成/.test(event.message)) {
            state.pendingDecision = undefined;
            state.completionStatus = "completed";
          }
        }
      }
      // Import review replies commonly combine the review decision and target
      // selection in one sentence. Capture both before the continuation
      // resolver can consume the reply and return early.
      if (state.rootGoal === "import_resume") {
        captureImportTargetIntent(state, event.message);
      }
      // The quick-card instruction establishes a new root task. It is not an
      // answer to the composition workflow's first information need; only a
      // later user turn may consume that pending question.
      const continuation = event.turnIntent === "new_domain_task"
        ? { consumed: false as const }
        : new TaskContinuationResolver().resolve(state, event.message);
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
      const sourceSelectionAllowed = ["apply_to_job", "create_tailored_resume", "generate_job_specific_resume"].includes(state.rootGoal);
      if (sourceSelectionAllowed && /从资料库|资料库生成|路线\s*A/i.test(event.message)) {
        selectResumeSourceRoute(state, "profile");
      } else if (sourceSelectionAllowed && /已有简历|现有简历|通用简历|路线\s*B/i.test(event.message)) {
        selectResumeSourceRoute(state, "existing_resume");
      }
      state.computeTier = computeTier(state.rootGoal, event.message);
      if (state.rootGoal === "import_resume") {
        captureImportTargetIntent(state, event.message);
      }
      if (state.rootGoal === "clarify_external_target" && isExternalTargetAction(event.message)) {
        state.rootGoal = "apply_to_external_job";
        state.activeGoal = "apply_to_external_job";
        state.goal = state.rootGoal;
        state.workflowId = "tailor_existing_resume";
        state.stage = "choose_resume_source";
        state.completionStatus = "active";
      }
      if (state.rootGoal === "clarify_external_target" && state.stage === "clarify_target") {
        state.completionStatus = "waiting_for_user";
      }
      if (
        state.workflowId === "guided_profile_intake"
        && state.stage === "collect_experience"
        && (
          !isProfileIntakeAnswerTurn(effectiveProfileIntakeEvidenceKind(
            event.profileIntakeTurnKind ?? classifyProfileIntakeTurn({ text: event.message, stage: state.stage }),
            event.message
          ))
          || !isProfileIntakeEvidence(event.message, {
            stage: state.stage,
            turnKind: effectiveProfileIntakeEvidenceKind(
              event.profileIntakeTurnKind ?? classifyProfileIntakeTurn({ text: event.message, stage: state.stage }),
              event.message
            )
          })
        )
      ) {
        // Commands such as "继续添加经历" ask the interview to continue; they
        // are neither source evidence nor a reason to leave the user-input boundary.
        state.completionStatus = "waiting_for_user";
      }
      if (state.workflowId === "guided_profile_intake" && state.stage === "collect_experience") {
        const requestedSection = intakeSectionFromCommand(event.message.trim().replace(/[。！!？?\s]+$/g, ""));
        if (requestedSection) state.knownSlots.intakeRequestedSection = requestedSection;
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
        } else if (event.decisionType === "job_target_persistence") {
          state.pendingDecision = undefined;
          state.knownSlots.jobPersistenceDecision = event.option === "save_job" ? "save" : "session_only";
          state.stage = "confirm_apply";
          state.completionStatus = "active";
        } else if (event.decisionType === "profile_intake_target") {
          resolveProfileIntakeTargetDecision(state, event.option);
        } else if (event.decisionType === "profile_intake_resume") {
          state.pendingDecision = undefined;
          state.knownSlots.profileIntakeFinishDecision = event.option;
          if (state.knownSlots.profileCommitResult) {
            if (event.option === "save_profile_only") {
              state.stage = "profile_complete";
              state.completionStatus = "completed";
            } else {
              state.stage = "optional_resume_decision";
              state.completionStatus = "active";
            }
          } else {
            state.stage = "reconcile_profile";
            state.completionStatus = "active";
          }
        } else if (event.decisionType === "profile_intake_post_save") {
          state.pendingDecision = undefined;
          if (event.option === "save_profile_only") {
            resetProfileIntakeDraft(state);
            state.stage = "collect_experience";
            state.completionStatus = "waiting_for_user";
          } else if (event.option === "generate_general_resume") {
            state.stage = "optional_resume_decision";
            state.completionStatus = "active";
          } else if (event.option === "finish") {
            state.stage = "profile_complete";
            state.completionStatus = "completed";
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
        } else if (state.rootGoal === "apply_to_external_job" || state.rootGoal === "generate_job_specific_resume") {
          state.knownSlots.jobPersistenceDecision = "save";
          const value = objectValue(event.observation);
          const committedJob = objectValue(value.jobDescription ?? value.job);
          const committedJobId = stringValue(value.jobId ?? committedJob.id);
          const committedRevision = scalarValue(value.jobRevision ?? committedJob.updatedAt);
          if (committedJobId) {
            state.selectedEntities.jobId = committedJobId;
            state.selectedEntities.jobRevision = committedRevision;
            state.selectedEntities.savedJobId = committedJobId;
            state.knownSlots.savedJobId = committedJobId;
            state.knownSlots.jobId = committedJobId;
          }
          if (committedRevision !== undefined) state.knownSlots.jobRevision = committedRevision;
          state.activeGoal = "create_tailored_resume";
          state.workflowId = "tailor_existing_resume";
          state.stage = "confirm_apply";
          state.completionStatus = "active";
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
      } else if (event.toolName === "compose_resume") {
        const value = objectValue(event.observation);
        const resumeId = stringValue(value.resumeId);
        const revisionId = stringValue(value.revisionId);
        if (resumeId) state.selectedEntities.resumeId = resumeId;
        if (revisionId) {
          state.selectedEntities.revisionId = revisionId;
          state.selectedEntities.resumeRevisionId = revisionId;
        }
        state.knownSlots.resumeCompositionResult = event.observation;
        if (resumeId) delete state.knownSlots.resumeCompositionPendingInformationNeed;
        state.activeGoal = "compose_resume";
        state.stage = resumeId ? "resume_ready" : "review_composition";
        state.completionStatus = resumeId ? "completed" : "waiting_for_user";
      } else if (event.toolName === "build_resume_evidence_graph") {
        state.knownSlots.resumeCompositionEvidenceGraph = event.observation;
        state.activeGoal = "compose_resume";
        if (state.workflowId === "compose_resume" && state.stage === "select_profile_scope") {
          state.completionStatus = "active";
        }
      } else if (event.toolName === "plan_resume_composition") {
        const value = objectValue(event.observation);
        state.knownSlots.resumeCompositionEvidenceGraph = value.evidenceGraph ?? state.knownSlots.resumeCompositionEvidenceGraph;
        state.knownSlots.resumeCompositionBlueprint = value.blueprint;
        state.knownSlots.resumeCompositionProposal = value.compositionProposal;
        state.knownSlots.resumeCompositionReviewResult = value.reviewResult;
        state.knownSlots.resumeCompositionInformationNeeds = value.informationNeeds;
        state.knownSlots.resumeCompositionCheckpoint = value.checkpoint ?? {
          kind: "resume_composition",
          profileId: value.profileId ?? state.selectedEntities.profileId,
          expectedProfileRevision: value.profileRevision ?? state.selectedEntities.profileVersion,
          mode: value.mode ?? state.knownSlots.resumeCompositionMode ?? "general",
          jobId: value.jobId ?? state.selectedEntities.jobId,
          evidenceGraph: value.evidenceGraph,
          blueprint: value.blueprint,
          proposal: value.compositionProposal,
          reviewResult: value.reviewResult,
          metrics: value.metrics,
          keywordCoverage: value.keywordCoverage,
          informationNeeds: value.informationNeeds
        };
        state.knownSlots.resumeCompositionBranchMode = state.knownSlots.resumeCompositionBranchMode ?? "create_new";
        state.activeGoal = "compose_resume";
        state.stage = "review_composition";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "review_resume_composition") {
        const value = objectValue(event.observation);
        state.knownSlots.resumeCompositionReviewResult = value.reviewResult;
        const checkpoint = objectValue(state.knownSlots.resumeCompositionCheckpoint);
        state.knownSlots.resumeCompositionProposal = checkpoint.proposal ?? state.knownSlots.resumeCompositionProposal;
        state.stage = "review_composition";
        state.completionStatus = "waiting_for_user";
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
        state.knownSlots.acceptedDiffIds = [];
        state.knownSlots.editedDiffIds = [];
        state.knownSlots.rejectedDiffIds = [];
        state.knownSlots.acceptedDiffCount = 0;
        state.knownSlots.remainingDiffCount = diffReviews.length;
        state.stage = "preview_changes";
        state.activeGoal = "review_tailoring_changes";
        state.completionStatus = diffReviews.length ? "waiting_for_user" : "active";
      } else if (event.toolName === "review_tailoring_diff") {
        captureTailoringTruth(state, event.observation);
        const reviewed = objectValue(event.observation);
        state.knownSlots.selectedDiffs = Array.isArray(reviewed.selectedDiffs) ? reviewed.selectedDiffs : [];
        state.knownSlots.selectedDiffIds = Array.isArray(reviewed.selectedDiffIds) ? reviewed.selectedDiffIds : [];
        const selectedDiffIds = Array.isArray(state.knownSlots.selectedDiffIds)
          ? state.knownSlots.selectedDiffIds
          : [];
        state.knownSlots.acceptedDiffCount = typeof reviewed.acceptedDiffCount === "number"
          ? reviewed.acceptedDiffCount
          : selectedDiffIds.length;
        state.knownSlots.editedDiffIds = Array.isArray(reviewed.editedDiffIds) ? reviewed.editedDiffIds : state.knownSlots.editedDiffIds;
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
        const quality = objectValue(value.qualityResult);
        const receipt = objectValue(quality.receipt ?? value.receipt);
        const artifactReceipt = objectValue(quality.artifactReceipt ?? value.artifactReceipt);
        const resultResumeId = stringValue(value.resultResumeId ?? value.branchId ?? objectValue(value.branch).id);
        const resultRevisionId = stringValue(value.resultResumeRevisionId ?? value.revisionId ?? objectValue(value.revision).id);
        const acceptedDiffCount = numberValue(quality.acceptedDiffCount ?? value.acceptedDiffCount);
        const acceptedDiffIds = Array.isArray(quality.acceptedDiffIds ?? value.acceptedDiffIds)
          ? (quality.acceptedDiffIds ?? value.acceptedDiffIds) as unknown[]
          : [];
        const changedFieldPathsValue = quality.changedFieldPaths ?? value.changedFieldPaths;
        const changedFieldPaths = Array.isArray(changedFieldPathsValue) ? changedFieldPathsValue : [];
        const beforeHash = stringValue(quality.beforeContentHash ?? value.beforeContentHash);
        const afterHash = stringValue(quality.afterContentHash ?? value.afterContentHash);
        const hasDurableArtifactProof = quality.repositoryReadBackVerified === true
          && quality.resumeListVisibilityVerified === true
          && artifactReceipt.status === "completed";
        const authoritative = Boolean(
          resultResumeId
          && resultRevisionId
          && acceptedDiffCount !== undefined
          && acceptedDiffCount > 0
          && acceptedDiffIds.some((item) => typeof item === "string" && item.length > 0)
          && changedFieldPaths.length > 0
          && beforeHash
          && afterHash
          && beforeHash !== afterHash
          && receipt.status === "completed"
          && quality.status === "passed"
          && quality.factGuard === "passed"
          && quality.revisionCreated === true
          && hasDurableArtifactProof
        );
        if (authoritative) {
          state.knownSlots.qualityResult = value.qualityResult ?? value;
          state.knownSlots.applyReceipt = value.receipt ?? quality.receipt;
          state.knownSlots.artifactReceipt = value.artifactReceipt ?? quality.artifactReceipt;
          delete state.knownSlots.tailoringApplyFailure;
          state.selectedEntities.resultResumeId = resultResumeId;
          state.selectedEntities.resultResumeRevisionId = resultRevisionId;
          state.selectedEntities.revisionId = resultRevisionId;
          state.dependencySnapshots.qualityResult = dependencySnapshot(state, event.observation);
          state.activeGoal = "quality_result";
          state.stage = "quality_result";
          state.completionStatus = "completed";
        } else {
          state.knownSlots.tailoringApplyFailure = {
            code: hasDurableArtifactProof
              ? "tailoring_apply_verification_failed"
              : "artifact_commit_visibility_verification_failed",
            message: "已采用的修改仍保留，但岗位简历写入没有完成。可以从当前步骤重试。",
            recoverable: true,
            operationId: stringValue(value.operationId)
          };
          state.activeGoal = "confirm_apply";
          state.stage = "confirm_apply";
          state.completionStatus = "waiting_for_user";
        }
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
        const projection = ProfileIntakeReviewProjectionSchema.safeParse(value.reviewProjection).success
          ? value.reviewProjection as ProfileIntakeReviewProjection
          : undefined;
        state.knownSlots.intakeImportId = value.importId;
        state.knownSlots.expectedIntakeDraftRevision = value.expectedDraftRevision;
        state.knownSlots.profileIntakeCaptureResult = value;
        state.knownSlots.profileIntakeProviderStatus = value.providerStatus;
        state.knownSlots.profileIntakeExtractionStatus = value.extractionStatus;
        state.knownSlots.profileIntakePersistenceStatus = value.persistenceStatus;
        state.knownSlots.profileIntakePersistenceReceipt = value.persistenceReceipt;
        state.knownSlots.intakeSession = value.intakeSession;
        state.knownSlots.profileIntakeNextTurnPlan = value.nextTurnPlan;
        state.knownSlots.profileInteractionPlan = value.interactionPlan;
        state.knownSlots.profileIntakePhase = objectValue(value.intakeSession).phase ?? "clarifying";
        if (projection) {
          state.knownSlots.profileIntakeReviewProjection = projection;
          if (projection.finalReviewRevision !== undefined) {
            state.knownSlots.finalReviewRevision = projection.finalReviewRevision;
          }
          // Compatibility aliases are derived from the projection and are not
          // used as an independent source of truth by the new UI.
          state.knownSlots.intakeCandidates = projection.candidates;
          state.knownSlots.intakeArtifact = nextArtifact;
        } else {
          state.knownSlots.intakeCandidates = value.candidates;
          state.knownSlots.intakeArtifact = nextArtifact;
        }
        state.knownSlots.intakeInterviewPlan = value.interviewPlan;
        state.knownSlots.intakeFollowUpQuestion = value.followUpQuestion;
        state.knownSlots.intakeActiveQuestion = objectValue(value.interviewPlan).activeQuestion;
        const activeQuestionId = objectValue(value.interviewPlan).activeQuestionId;
        if (typeof activeQuestionId === "string") state.knownSlots.activeQuestionId = activeQuestionId;
        else delete state.knownSlots.activeQuestionId;
        state.pendingDecision = undefined;
        // Keep the legacy stage alias for persisted sessions, but the phase is
        // the authoritative UI contract: provisional candidates never open a
        // blocking review card after each turn.
        state.knownSlots.profileIntakePhase = "clarifying";
        state.stage = (projection?.candidates.some((candidate) => candidate.status === "failed") ?? false)
          ? "review_facts"
          : "collect_experience";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "synthesize_profile_intake") {
        const value = objectValue(event.observation);
        state.knownSlots.intakeImportId = value.importId;
        state.knownSlots.expectedIntakeDraftRevision = value.expectedDraftRevision;
        state.knownSlots.intakeSession = value.intakeSession;
        if (value.nextTurnPlan) state.knownSlots.profileIntakeNextTurnPlan = value.nextTurnPlan;
        state.knownSlots.profileIntakePhase = "ready_for_review";
        state.knownSlots.profileIntakeFinalSynthesis = value.finalSynthesis;
        state.knownSlots.profileInteractionPlan = value.interactionPlan;
        state.knownSlots.finalReviewRevision = value.expectedDraftRevision;
        const projection = ProfileIntakeReviewProjectionSchema.safeParse(value.reviewProjection);
        if (projection.success) {
          state.knownSlots.profileIntakeReviewProjection = projection.data;
          state.knownSlots.intakeCandidates = projection.data.candidates;
          state.knownSlots.intakeArtifact = value.artifactPayload;
        }
        state.stage = "final_review";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "review_profile_intake") {
        const value = objectValue(event.observation);
        state.knownSlots.expectedIntakeDraftRevision = value.expectedDraftRevision;
        state.knownSlots.profileIntakePersistenceReceipt = value.persistenceReceipt;
        state.knownSlots.intakeSession = value.intakeSession;
        state.knownSlots.profileIntakePhase = objectValue(value.intakeSession).phase
          ?? (value.decision === "accept_all" ? "reviewing" : state.knownSlots.profileIntakePhase ?? "clarifying");
        if (value.interviewPlan) state.knownSlots.intakeInterviewPlan = value.interviewPlan;
        if (value.interactionPlan) state.knownSlots.profileInteractionPlan = value.interactionPlan;
        if (value.followUpQuestion) state.knownSlots.intakeFollowUpQuestion = value.followUpQuestion;
        state.knownSlots.intakeActiveQuestion = objectValue(value.interviewPlan).activeQuestion;
        const activeQuestionId = objectValue(value.interviewPlan).activeQuestionId;
        if (typeof activeQuestionId === "string") state.knownSlots.activeQuestionId = activeQuestionId;
        else delete state.knownSlots.activeQuestionId;
        const authoritativeProjection = ProfileIntakeReviewProjectionSchema.safeParse(value.reviewProjection).success
          ? value.reviewProjection as ProfileIntakeReviewProjection
          : undefined;
        if (authoritativeProjection) {
          state.knownSlots.profileIntakeReviewProjection = authoritativeProjection;
          if (authoritativeProjection.finalReviewRevision !== undefined) {
            state.knownSlots.finalReviewRevision = authoritativeProjection.finalReviewRevision;
          }
          state.knownSlots.intakeCandidates = authoritativeProjection.candidates;
          state.knownSlots.intakeArtifact = objectValue(value.artifactPayload);
          state.pendingDecision = undefined;
          state.stage = authoritativeProjection.finalSynthesis || state.knownSlots.profileIntakePhase === "reviewing"
            ? "final_review"
            : authoritativeProjection.reviewProgress.proposed > 0 || authoritativeProjection.reviewProgress.uncertain > 0 || authoritativeProjection.extractionStatus === "failed"
              ? "review_facts"
              : "collect_experience";
          state.completionStatus = "waiting_for_user";
          return normalize(state);
        }
        const candidateId = stringValue(value.candidateId);
        const decision = value.decision === "accept" || value.decision === "reject" || value.decision === "reopen"
          ? value.decision
          : undefined;
        if (candidateId && decision) {
          const candidates = Array.isArray(state.knownSlots.intakeCandidates)
            ? state.knownSlots.intakeCandidates.map(objectValue)
            : [];
          const reviewed = candidates.find((candidate) => candidate.id === candidateId);
          const authoritative = objectValue(value.candidate);
          const structuredItem = value.structuredItem ?? authoritative.structuredItem ?? reviewed?.structuredItem;
          const fieldEvidence = Array.isArray(value.fieldEvidence)
            ? value.fieldEvidence
            : authoritative.fieldEvidence ?? reviewed?.fieldEvidence;
          const projected = {
            ...reviewed,
            ...authoritative,
            ...(structuredItem !== undefined ? { structuredItem } : {}),
            ...(fieldEvidence !== undefined ? { fieldEvidence } : {}),
            ...(value.editedLabel ? { label: value.editedLabel } : {}),
            needsConfirmation: decision !== "accept",
            canAccept: decision !== "accept",
            decision,
            included: decision === "accept",
            status: decision === "accept" ? "confirmed" : "ai_review"
          };
          state.knownSlots.intakeCandidates = candidates.map((candidate) =>
            candidate.id === candidateId ? projected : candidate
          );
          const artifact = objectValue(state.knownSlots.intakeArtifact);
          const recognized = Array.isArray(artifact.recognized)
            ? artifact.recognized.map(objectValue)
            : [];
          const artifactCandidates = Array.isArray(artifact.candidates)
            ? artifact.candidates.map(objectValue)
            : [];
          state.knownSlots.intakeArtifact = {
            ...artifact,
            candidates: artifactCandidates.map((item) => item.id === candidateId ? {
              ...item,
              ...projected,
              structuredItem,
              fieldEvidence,
              status: decision === "accept" ? "confirmed" : "ai_review"
            } : item),
            recognized: decision === "accept" && projected
              ? [...recognized.filter((item) => item.id !== candidateId), { id: candidateId, label: projected.label }]
              : recognized.filter((item) => item.id !== candidateId),
            needsConfirmation: Array.isArray(artifact.needsConfirmation)
              ? artifact.needsConfirmation
                  .map(objectValue)
                  .filter((item) => item.id !== candidateId)
                  .concat(decision === "accept" ? [] : [{
                    id: candidateId,
                    label: String(projected.label ?? "待核对经历"),
                    reason: decision === "reopen" ? "已撤销采用，请重新核对" : "已忽略这项候选"
                  }])
              : []
          };
        }
        state.pendingDecision = undefined;
          state.stage = state.knownSlots.profileIntakePhase === "reviewing" ? "final_review" : "collect_experience";
        state.completionStatus = "waiting_for_user";
      } else if (event.toolName === "reconcile_profile_intake") {
        const value = objectValue(event.observation);
        const summary = objectValue(value.summary);
        const unresolved = typeof summary.requiresReview === "number" ? summary.requiresReview : 0;
        state.knownSlots.intakeReconciliation = event.observation;
        const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
        if (projection.success && projection.data.finalReviewRevision !== undefined) {
          state.knownSlots.finalReviewRevision = projection.data.finalReviewRevision;
        }
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
        state.knownSlots.profileIntakePhase = "completed";
        delete state.knownSlots.profileCommitVerification;
        delete state.knownSlots.profileIntakeExplicitCommit;
        delete state.knownSlots.profileIntakeFinishRequested;
        state.pendingDecision = {
          type: "profile_intake_post_save",
          options: ["save_profile_only", "generate_general_resume", "finish"]
        };
        state.stage = "profile_complete";
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
    if (event.type === "tool_failure") {
      state.lastObservation = {
        toolName: event.toolName,
        errorCode: event.errorCode,
        message: event.message,
        recoverable: event.recoverable
      };
      state.knownSlots.lastFailedTool = event.toolName;
      state.knownSlots.lastFailedOperationId = event.operationId;
      state.knownSlots.lastSafeErrorCode = event.errorCode;
      state.knownSlots.toolFailure = state.lastObservation;
      if (event.toolName === "apply_tailoring_changes") {
        state.knownSlots.tailoringApplyFailure = {
          code: event.errorCode,
          message: "已采用的修改仍保留，但岗位简历写入没有完成。可以从当前步骤重试。",
          recoverable: event.recoverable !== false,
          operationId: event.operationId
        };
        state.activeGoal = "confirm_apply";
        state.stage = "confirm_apply";
        state.completionStatus = "waiting_for_user";
      } else if (event.errorCode === "tailoring_questions_incomplete") {
        state.activeGoal = "clarify_tailoring";
        state.stage = "clarify_unsupported_facts";
        state.completionStatus = "waiting_for_user";
      } else if (event.recoverable !== false) {
        state.completionStatus = "waiting_for_user";
      } else {
        state.completionStatus = "failed";
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
      if (event.toolName === "compose_resume") {
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
          "profileIntakeReviewProjection",
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

function isProfileIntakeAnswerTurn(kind: ProfileIntakeTurnKind) {
  return kind === "career_narrative" || kind === "follow_up_answer";
}

function isProfileIntakeFinishCommand(command: string) {
  return [
    "完成整理",
    "完成整理并保存",
    "先到这里",
    "没有其他经历了",
    "结束访谈",
    "完成整理并保存到资料库",
    "确认",
    "导入资料库",
    "保存为经历档案",
    "写入资料库",
    "完成整理并保存资料库",
    "完成整理并保存到个人资料库",
    "确认导入资料库",
    "确认保存到资料库"
  ].includes(command)
    || /^(?:确认|完成整理)(?:并)?(?:保存|导入|写入)(?:到)?(?:个人)?资料库$/u.test(command);
}

function isExplicitProfileIntakeSaveIntent(command: string) {
  return [
    "完成整理并保存",
    "完成整理并保存到资料库",
    "确认",
    "导入资料库",
    "保存为经历档案",
    "写入资料库",
    "完成整理并保存资料库",
    "完成整理并保存到个人资料库",
    "确认导入资料库",
    "确认保存到资料库"
  ].includes(command)
    || /^(?:确认|完成整理)(?:并)?(?:保存|导入|写入)(?:到)?(?:个人)?资料库$/u.test(command);
}

function intakeSectionFromCommand(command: string) {
  if (/实习经历/u.test(command)) return "internship";
  if (/项目经历/u.test(command)) return "project";
  if (/校园经历/u.test(command)) return "campus";
  if (/技能(?:或证书)?|证书/u.test(command)) return "skills";
  if (/奖项经历/u.test(command)) return "awards";
  if (/证书经历/u.test(command)) return "certificates";
  return undefined;
}

function acceptedIntakeCandidateCount(state: AgentTaskState) {
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
  const candidates = projection.success
    ? projection.data.candidates.map(objectValue)
    : Array.isArray(state.knownSlots.intakeCandidates)
      ? state.knownSlots.intakeCandidates.map(objectValue)
    : [];
  return candidates.filter((candidate) => candidate.status === "accepted" || candidate.decision === "accept" || candidate.included === true).length;
}

function intakeCandidateCount(state: AgentTaskState) {
  const projection = ProfileIntakeReviewProjectionSchema.safeParse(state.knownSlots.profileIntakeReviewProjection);
  if (projection.success) return projection.data.candidates.length;
  return Array.isArray(state.knownSlots.intakeCandidates) ? state.knownSlots.intakeCandidates.length : 0;
}

function effectiveProfileIntakeEvidenceKind(kind: ProfileIntakeTurnKind, message: string): ProfileIntakeTurnKind {
  return kind === "correction" && hasExplicitCorrectionReplacement(message) ? "follow_up_answer" : kind;
}

export function isProfileIntakeEvidence(message: string, context: {
  stage?: string;
  activeQuestionId?: string;
  expectedAnswerDimension?: string;
  turnKind?: ProfileIntakeTurnKind;
} = {}) {
  const text = message.trim();
  if (!text) return false;
  if (context.turnKind && !isProfileIntakeAnswerTurn(context.turnKind)) return false;
  if (isProfileIntakeDraftRequest(text) || isProfileIntakeReferenceQuestion(text, Boolean(context.activeQuestionId))) return false;
  if (/^(?:是|是的|对|对的|好的?|嗯|确认|没问题|没有问题|全部确认|都正确|导入|写入|保存|开始导入|确认导入)[。！!]?$/u.test(text)) return false;
  if (/为什么|为何|怎么还|不是已经|回收站|删除|归档|你从哪里知道|当前资料库|这条对吗|这条不是/i.test(text)) return false;
  const grounded = [
    /大学|学院|学校|本科|硕士|博士|专业|学位|入学|毕业|就读|教育/i,
    /公司|企业|组织|单位|雇主|实习|任职|担任|负责|岗位|职位|工作|入职|离职/i,
    /项目|课题|比赛|竞赛|活动|研究|开发|设计|搭建|实现|上线|产出|结果|成果/i,
    /技能|证书|认证|语言|奖项|获奖|掌握|熟悉|会用|精通/i,
    /(?:19|20)\d{2}\s*[年/-]|\d{4}\s*年|\d{1,2}\s*月/i
  ].some((pattern) => pattern.test(text));
  return grounded || Boolean(
    context.stage === "collect_experience"
    && context.activeQuestionId
    && context.expectedAnswerDimension
    && text.length >= 2
    && !/^(?:工作|项目|经历|岗位|职位|学校|教育|研究|活动|技能|证书|奖项|成果|结果)$/u.test(text.replace(/[\s。！!？?，,、]+/gu, ""))
  );
}

function expectedProfileIntakeAnswerDimension(state: AgentTaskState) {
  const plan = objectValue(state.knownSlots.intakeInterviewPlan);
  const questions = Array.isArray(plan.questions) ? plan.questions : [];
  const activeQuestionId = stringValue(state.knownSlots.activeQuestionId);
  const question = questions.map(objectValue).find((item) => item.id === activeQuestionId);
  return stringValue(
    question?.expectedAnswerDimension
    ?? question?.answerType
    ?? question?.dimension
    ?? objectValue(state.knownSlots.intakeActiveQuestion).dimension
  );
}

function isSubstantiveProfileIntakeNarrative(message: string) {
  return isProfileIntakeEvidence(message, { stage: "collect_experience" });
}

function resetProfileIntakeDraft(state: AgentTaskState) {
  for (const key of [
    "latestIntakeSource",
    "intakeImportId",
    "expectedIntakeDraftRevision",
    "profileIntakeReviewProjection",
    "intakeCandidates",
    "intakeArtifact",
    "intakeInterviewPlan",
    "intakeActiveQuestion",
    "profileIntakeNextTurnPlan",
    "intakeFollowUpQuestion",
    "profileIntakeCaptureResult",
    "profileIntakeProviderStatus",
    "profileIntakeExtractionStatus",
    "profileIntakePersistenceStatus",
    "profileIntakePersistenceReceipt",
    "finalReviewRevision",
    "intakeSession",
    "profileIntakePhase",
    "profileIntakeFinalSynthesis",
    "activeQuestionId",
    "profileIntakeExplicitCommit",
    "profileIntakeFinishRequested",
    "profileIntakeFinishDecision",
    "intakeReconciliation",
    "expectedIntakeReconciliationRevision",
    "profileCommitResult",
    "profileCommitVerification",
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
  state.workflowId = canonicalWorkflowId(state.workflowId);
  if (state.workflowId === "tailor_resume") {
    state.completionType = "transactional";
  }
  if (state.workflowId === "compose_resume") {
    // `create_resume_from_profile` remains a compatible root-goal label for
    // persisted sessions, but its executable workflow is now composition.
    const hasCompositionResult = Boolean(state.knownSlots.resumeCompositionResult);
    const compositionIsTerminal = hasCompositionResult
      || state.stage === "resume_ready"
      || state.completionStatus === "completed";
    state.activeGoal = hasCompositionResult ? "compose_resume" : state.activeGoal === "create_resume_from_profile" ? "compose_resume" : state.activeGoal;
    if (compositionIsTerminal) {
      delete state.knownSlots.resumeCompositionPendingInformationNeed;
    } else if (!state.knownSlots.resumeCompositionPendingInformationNeed && !state.knownSlots.resumeCompositionTargetDirection) {
      state.knownSlots.resumeCompositionPendingInformationNeed = defaultResumeCompositionInformationNeed();
    }
    if (state.stage === "select_facts" || state.stage === "review_resume_plan") state.stage = "review_composition";
    if (state.stage === "completed" && state.knownSlots.resumeCompositionResult) state.stage = "resume_ready";
    if (state.knownSlots.resumeCompositionResult) state.completionStatus = "completed";
  }
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
  if (isTailoringWorkflowId(state.workflowId)) {
    const canonicalStage = normalizeTailoringStage(state.stage);
    if (canonicalStage) state.stage = canonicalStage;
    if (state.selectedEntities.resumeId && !state.selectedEntities.sourceResumeId && !state.selectedEntities.resultResumeId) {
      state.selectedEntities.sourceResumeId = state.selectedEntities.resumeId;
      state.selectedEntities.sourceResumeRevisionId = state.selectedEntities.resumeRevisionId;
    }
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
    if (
      (state.rootGoal === "apply_to_external_job" || state.rootGoal === "generate_job_specific_resume" || state.rootGoal === "clarify_external_target")
      && (hasValue(state.knownSlots.rawText) || hasValue(state.knownSlots.targetSnapshot) || hasValue(state.knownSlots.targetSnapshotId))
    ) {
      state.requiredSlots = state.requiredSlots.filter((slot) => slot !== "jobId");
    }
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
      : state.knownSlots.targetProfileId
        ? profiles.find((profile) => profile.id === state.knownSlots.targetProfileId)
        : undefined;
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
        if (
          state.stage === "profile_complete"
          && state.knownSlots.profileCommitResult
          && id === state.knownSlots.targetProfileId
          && profile.version === objectValue(state.knownSlots.profileCommitResult).profileVersion
        ) {
          state.knownSlots.profileCommitVerification = {
            profileId: id,
            profileVersion: scalarValue(profile.version ?? value.profileVersion),
            verifiedItemCount: Array.isArray(profile.items) ? profile.items.length : undefined,
            verifiedAt: new Date().toISOString()
          };
        }
      } else {
        updateAuthoritativeEntity(state, {
          type: "entity_revision",
          entityType: "profile",
          entityId: id,
          version: scalarValue(profile.version ?? value.profileVersion)
        });
      }
      if (state.workflowId === "compose_resume") {
        const items = Array.isArray(profile.items) ? profile.items.map(objectValue) : [];
        state.knownSlots.profileItemCandidates = items;
        if (!state.knownSlots.resumeCompositionResult
          && state.stage !== "resume_ready"
          && state.completionStatus !== "completed"
          && !state.knownSlots.resumeCompositionPendingInformationNeed) {
          state.knownSlots.resumeCompositionPendingInformationNeed = defaultResumeCompositionInformationNeed();
        }
      } else if (state.rootGoal === "create_resume_from_profile") {
        const items = Array.isArray(profile.items) ? profile.items.map(objectValue) : [];
        state.knownSlots.profileItemCandidates = items;
        if (state.stage === "select_profile_scope") state.stage = "select_facts";
      }
    }
  }
  if (toolName === "search_profile_facts" && state.workflowId === "compose_resume") {
    const results = Array.isArray(value.results) ? value.results.map(objectValue) : [];
    state.knownSlots.profileItemCandidates = results;
  } else if (toolName === "search_profile_facts" && state.rootGoal === "create_resume_from_profile") {
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
    if (branchId) {
      state.selectedEntities.resultResumeId = branchId;
      state.knownSlots.resultResumeId = branchId;
    }
    if (id) {
      state.selectedEntities.revisionId = id;
      state.selectedEntities.resultResumeRevisionId = id;
      state.knownSlots.resultResumeRevisionId = id;
    }
    const hash = stringValue(value.resumeHash);
    if (hash) state.knownSlots.resultResumeHash = hash;
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
  option: "profile" | "existing_resume" | "session_only" | "save_job" | "switch_to_active" | "keep_original" | "save_profile_only" | "generate_general_resume" | "finish"
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
  state.selectedEntities.sourceResumeId = undefined;
  state.selectedEntities.sourceResumeRevisionId = undefined;
  state.selectedEntities.resultResumeId = undefined;
  state.selectedEntities.resultResumeRevisionId = undefined;
  state.selectedEntities.revisionId = undefined;
  for (const key of ["resumeId", "resumeRevisionId", "resumeHash", "sourceResumeId", "sourceResumeRevisionId", "resultResumeId", "resultResumeRevisionId", "recommendedResumeId", "selectedResumeName", "resumeCandidates", "resumeSelectionRequired"]) {
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
  const targetSnapshot = objectValue(session.targetSnapshot);
  const targetSnapshotId = stringValue(targetSnapshot.id);
  const targetSnapshotVersion = numberValue(targetSnapshot.version);
  if (targetSnapshotId) {
    state.selectedEntities.targetSnapshotId = targetSnapshotId;
    state.knownSlots.targetSnapshotId = targetSnapshotId;
    state.knownSlots.targetSourceType = stringValue(targetSnapshot.sourceType) ?? "pasted_jd";
  }
  if (targetSnapshotVersion !== undefined) {
    state.selectedEntities.targetSnapshotVersion = targetSnapshotVersion;
    state.knownSlots.targetSnapshotVersion = targetSnapshotVersion;
  }
  const targetSnapshotHash = stringValue(value.targetSnapshotHash) ?? stringValue(targetSnapshot.rawTextHash);
  if (targetSnapshotHash) {
    state.selectedEntities.targetSnapshotHash = targetSnapshotHash;
    state.knownSlots.targetSnapshotHash = targetSnapshotHash;
  }
  const savedJobId = stringValue(value.savedJobId) ?? stringValue(targetSnapshot.sourceJobId);
  if (savedJobId) {
    state.selectedEntities.savedJobId = savedJobId;
    state.knownSlots.savedJobId = savedJobId;
  }
  if (targetSnapshotId && state.knownSlots.jobPersistenceDecision === undefined) {
    state.knownSlots.jobPersistenceDecision = "ask";
  }
  const sessionBranch = objectValue(session.branch);
  const sourceResumeId = stringValue(sessionBranch.id);
  const sourceResumeRevisionId = stringValue(sessionBranch.currentRevisionId);
  if (sourceResumeId && !state.selectedEntities.resultResumeId) {
    state.selectedEntities.sourceResumeId = sourceResumeId;
    state.selectedEntities.sourceResumeRevisionId = sourceResumeRevisionId;
    state.knownSlots.sourceResumeId = sourceResumeId;
    state.knownSlots.sourceResumeRevisionId = sourceResumeRevisionId;
  }
  state.knownSlots.tailoringSession = value.session;
  state.knownSlots.questionPlan = plan.questionPlan;
  state.knownSlots.activeQuestionId = questionPlan.activeQuestionId;
  state.knownSlots.selectedQuestionId = state.knownSlots.selectedQuestionId ?? questionPlan.activeQuestionId;
  state.knownSlots.answeredQuestionIds = Array.isArray(questionPlan.answeredQuestionIds) ? questionPlan.answeredQuestionIds : [];
  state.knownSlots.skippedQuestionIds = Array.isArray(questionPlan.skippedQuestionIds) ? questionPlan.skippedQuestionIds : [];
  const diffs = Array.isArray(plan.diffs) ? plan.diffs.map(objectValue) : [];
  const reviews = Array.isArray(plan.diffReviews) ? plan.diffReviews.map(objectValue) : [];
  const reviewById = new Map(reviews.flatMap((review) =>
    typeof review.diffId === "string" ? [[review.diffId, review] as const] : []
  ));
  const selectedDiffs = diffs.flatMap((diff) => {
    const review = reviewById.get(tailoringDiffId(diff as never));
    if (review?.status !== "accepted" && review?.status !== "edited") return [];
    return [{ ...diff, value: review.status === "edited" ? review.editedValue : diff.value }];
  });
  const acceptedDiffIds = diffs.flatMap((diff) => {
    const review = reviewById.get(tailoringDiffId(diff as never));
    return review?.status === "accepted" ? [tailoringDiffId(diff as never)] : [];
  });
  const editedDiffIds = diffs.flatMap((diff) => {
    const review = reviewById.get(tailoringDiffId(diff as never));
    return review?.status === "edited" ? [tailoringDiffId(diff as never)] : [];
  });
  const rejectedDiffIds = diffs.flatMap((diff) => {
    const review = reviewById.get(tailoringDiffId(diff as never));
    return review?.status === "rejected" ? [tailoringDiffId(diff as never)] : [];
  });
  state.knownSlots.selectedDiffs = selectedDiffs;
  state.knownSlots.selectedDiffIds = [...acceptedDiffIds, ...editedDiffIds];
  state.knownSlots.acceptedDiffIds = acceptedDiffIds;
  state.knownSlots.editedDiffIds = editedDiffIds;
  state.knownSlots.rejectedDiffIds = rejectedDiffIds;
  state.knownSlots.acceptedDiffCount = acceptedDiffIds.length + editedDiffIds.length;
  state.knownSlots.remainingDiffCount = diffs.filter((diff) =>
    reviewById.get(tailoringDiffId(diff as never))?.status === "suggested"
  ).length;
  state.knownSlots.confirmedRequirementIds = answers.flatMap((answer) => {
    const ids = objectValue(answer).requirementIds;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  });
  const activeQuestionId = stringValue(questionPlan.activeQuestionId);
  state.knownSlots.currentClarification = activeQuestionId
    ? questions.find((question) => stringValue(objectValue(question).id) === activeQuestionId)
    : undefined;
  const generationStatus = stringValue(plan.generationStatus);
  state.knownSlots.tailoringGenerationStatus = generationStatus ?? "not_started";
  state.knownSlots.generatedDiffsBasedOnQuestionPlanRevision = plan.generatedDiffsBasedOnQuestionPlanRevision;
  state.knownSlots.generatedDiffsBasedOnAnswerRevisionHash = plan.generatedDiffsBasedOnAnswerRevisionHash;
  state.knownSlots.answerRevisionHash = plan.answerRevisionHash;
  const generationReady = generationStatus === "completed"
    && plan.generatedDiffsBasedOnQuestionPlanRevision === questionPlan.revision
    && plan.generatedDiffsBasedOnAnswerRevisionHash === plan.answerRevisionHash;
  state.stage = activeQuestionId ? "clarify_unsupported_facts" : generationReady ? "preview_changes" : "generate_changes";
  state.activeGoal = activeQuestionId ? "clarify_tailoring" : generationReady ? "review_tailoring_changes" : "generate_tailoring_changes";
  state.completionStatus = activeQuestionId || generationReady ? "waiting_for_user" : "active";
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
  if (
    event.entityType === "resume"
    && isTailoringGoal(state.rootGoal)
    && state.selectedEntities.resultResumeId
    && !["choose_resume_source", "choose_job"].includes(normalizeTailoringStage(state.stage) ?? state.stage)
  ) {
    // A post-apply read may legitimately inspect the generated branch. It is
    // evidence about the result, never a new source selection.
    if (event.entityId === state.selectedEntities.resultResumeId) {
      if (event.revisionId) {
        state.selectedEntities.resultResumeRevisionId = event.revisionId;
        state.knownSlots.resultResumeRevisionId = event.revisionId;
      }
      if (event.hash) state.knownSlots.resultResumeHash = event.hash;
    }
    return;
  }
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
    if (isTailoringGoal(state.rootGoal) && !state.selectedEntities.resultResumeId) {
      state.selectedEntities.sourceResumeId = event.entityId;
      state.knownSlots.sourceResumeId = event.entityId;
    }
    if (event.revisionId) {
      state.selectedEntities.resumeRevisionId = event.revisionId;
      state.knownSlots.resumeRevisionId = event.revisionId;
      if (isTailoringGoal(state.rootGoal) && !state.selectedEntities.resultResumeId) {
        state.selectedEntities.sourceResumeRevisionId = event.revisionId;
        state.knownSlots.sourceResumeRevisionId = event.revisionId;
      }
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
    "tailoringApplyFailure",
    "applyReceipt",
    "pendingConfirmation"
  ]) {
    delete state.knownSlots[key];
  }
  state.pendingDecision = undefined;
  state.dependencySnapshots = {};
  state.selectedEntities.tailoringSessionId = undefined;
  state.selectedEntities.resultResumeId = undefined;
  state.selectedEntities.resultResumeRevisionId = undefined;
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

function defaultResumeCompositionInformationNeed() {
  return ResumeCompositionInformationNeedSchema.parse({
    informationNeedId: "target_direction",
    question: "这份通用简历主要准备投什么方向？如果暂时没有明确方向，我先按互联网技术 / AI 应用通用版整理。",
    status: "pending"
  });
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function hasValue(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function isTailoringGoal(goal: string) {
  return ["create_tailored_resume", "apply_to_job", "apply_to_external_job", "generate_job_specific_resume", "analyze_job_fit"].includes(goal);
}

function isExternalTargetAction(text: string) {
  return /应聘|申请|投递|生成(?:对应(?:的)?(?:岗位)?|岗位|定制)?简历|定制(?:简历|一版)|改(?:写|一下)?简历|优化简历|为(?:这个|该)?岗位/u.test(text);
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
