import {
  ImportedResumeDraftSchema,
  JobAnalysisDraftSchema,
  JobRequirementGraphV4Schema,
  RawInputDocumentSchema,
  ResumeTailorBatchInputSchema,
  ResumeTailorModelOutputSchema,
  ResumeTailoringDiffSchema,
  type ImportedResumeDraft,
  type ProfileReconciliationPlan,
  TailoringIntensitySchema
} from "@/domain/schemas";
import { projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization/v3/project";
import { createImportedResumeDraftFromText } from "@/domain/resumeImport/parser";
import {
  analyzeJobCommand,
  answerTailoringQuestionCommand,
  applyTailoringSessionCommand,
  createTailoringSessionCommand,
  generateTailoringDiffsCommand,
  previewTailoringChangesCommand,
  reviewTailoringDiffCommand,
  TailoringSessionSchema,
  type TailoringSession
} from "@/services/jobs/tailoringCommands";
import { invokeStructuredAi } from "@/ai/client";
import { ResumeTailoringDiffModelOutputSchema, type ResumeTailoringDiffTaskInput } from "@/domain/schemas";
import { commitParsedJob } from "@/services/jobs/jobWorkflow";
import { analyzeJobFit, tailoringAnswerRevisionHash } from "@/services/jobs/tailoringService";
import { hashText, stableHashText } from "@/services/security/text";
import { WorkspaceRepository } from "@/services/storage/repositories";
import type { AgentToolServices } from "@/agent/tools/registry";
import { getAgentSessionDisplayTitle } from "@/agent/contracts/agentSession";
import { canonicalProfileLibraryItems, canonicalProfileSectionCounts } from "@/domain/profile/canonicalLibrary";
import { agentSkillRegistry } from "@/agent/kernel/AgentSkillRegistry";
import { recommendSourceRoute } from "@/agent/orchestration/sourceRouteRecommendation";
import { analyzeProfileLibrarySource } from "@/services/jobs/jobResumeSourceModes";
import { agentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { ResumeImportOrchestrator } from "@/services/resumeImport/ResumeImportOrchestrator";
import {
  applyResumeImportReviewDecision,
  type ResumeImportReviewDecision
} from "@/domain/resumeImport/reviewDecisions";
import { agentImportProgressBus } from "@/services/agent/AgentImportProgressBus";
import {
  adaptConversationMessageToIntakeDraft,
  buildConversationIntakeReviewProjectionFromDraft,
  buildConversationIntakeArtifact,
  mergeConversationIntakeDraft,
  patchConversationIntakeCandidate
} from "@/domain/profileIntake/ConversationIntakeAdapter";
import { ProfileIntakeSemanticService, type ProfileIntakeSemanticInput } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import {
  applyProfileIntakeStructuredPatch,
  migrateProfileIntakeSection,
  profileIntakeCareerReadyText,
  validateUserCorrectionStructuredPatch,
  validateProfileIntakeStructuredPatch,
  type ProfileIntakeStructuredPatch
} from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { readResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import { adaptResumeJsonToV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { createProfileIntakeInterviewPlan } from "@/domain/profileIntake/ProfileIntakeCompleteness";
import { ProfileIntakeReviewProjectionSchema } from "@/domain/profileIntake/ProfileIntakeReviewProjection";
import { profileIntakeDisplayLabel } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { synthesizeProfileIntakeDraft } from "@/domain/profileIntake/ProfileIntakeFinalSynthesis";
import { ProfileIntakeProvenanceSchema } from "@/domain/profileIntake/ProfileIntakeProvenance";
import {
  applyProfileIntakeFinalCareerSynthesis,
  buildProfileIntakeFinalCareerSynthesisInput,
  ProfileIntakeFinalCareerSynthesisOutputSchema
} from "@/domain/profileIntake/ProfileIntakeFinalCareerSynthesis";
import {
  nextTurnPlanFromSupervisorAction,
  profileIntakeItemLabel,
  resolveProfileIntakeInterviewSupervisor,
  targetQuestion
} from "@/agent/workflows/ProfileIntakeInterviewSupervisor";

export class BrowserAgentToolService implements AgentToolServices {
  constructor(
    private readonly repository = new WorkspaceRepository(),
    private readonly profileIntakeSemantic = new ProfileIntakeSemanticService()
  ) {}

  async prepareResumeImport(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const semanticPreference = readResumeImportSemanticPreference();
    const input = rawInput as { attachmentId: string };
    try {
      const { ref, file } = agentAttachmentStore.resolve(input.attachmentId);
      const canonicalJson = ref.mimeType === "application/json"
        && await isCanonicalCareerAdaptJsonFile(file);
      if (semanticPreference === "unset" && !canonicalJson) {
        throw new Error("resume_import_ai_privacy_consent_required");
      }
      const prepared = await new ResumeImportOrchestrator(this.repository).prepare({
        fileName: ref.fileName,
        mimeType: ref.mimeType,
        size: ref.size,
        file
      }, {
        signal,
        semanticMode: semanticPreference === "ai" && !canonicalJson ? "ai" : "local",
        onProgress: (progress) => agentImportProgressBus.emit(progress)
      });
      return {
        importId: prepared.importId,
        expectedDraftRevision: prepared.draftRevision,
        sourceKind: prepared.sourceKind,
        fileName: prepared.fileName,
        fileHash: prepared.fileHash,
        status: prepared.status,
        quality: prepared.quality,
        reviewSummary: prepared.reviewSummary,
        artifactPayload: prepared.artifactPayload,
        warnings: prepared.warnings
      };
    } finally {
      // The orchestrator has consumed the browser File in every terminal
      // path.  Persisted import drafts retain hashes and extracted evidence,
      // never the File object itself.
      agentAttachmentStore.release(input.attachmentId);
    }
  }

  async reviewResumeImport(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      decision: ResumeImportReviewDecision;
    };
    const draft = await this.repository.getImportedResumeDraft(input.importId);
    if (!draft) throw toolError("resume_import_draft_missing", "导入草稿不存在，请重新选择文件。");
    if (draft.revision !== input.expectedDraftRevision) {
      throw toolError("resume_import_stale_revision", "导入草稿已变化，请刷新核对结果后重试。");
    }
    const saved = await this.repository.saveImportedResumeDraft(
      applyResumeImportReviewDecision(draft, input.decision),
      input.expectedDraftRevision
    );
    return {
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      reviewStatus: "reviewed",
      decision: input.decision
    };
  }

  async reconcileResumeImport(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      profileId: string;
    };
    const plan = await this.repository.reconcileImportedResume(input);
    return reconciliationToolResult(plan);
  }

  async resolveResumeReconciliation(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedPlanRevision: number;
      incomingItemId: string;
      resolution: "keep_existing" | "use_imported" | "keep_both_as_distinct" | "edit_value" | "defer";
      editedValue?: string;
    };
    const plan = await this.repository.resolveProfileReconciliation(input);
    return {
      ...reconciliationToolResult(plan),
      unresolvedCount: plan.summary.requiresReview
    };
  }

  async captureProfileIntake(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      sessionId: string;
      messageId: string;
      turnId: string;
      text: string;
      capturedAt: string;
      targetProfileId: string;
      expectedProfileVersion: number;
      acknowledgedActiveProfileId?: string;
      intakeQuestionId?: string;
      intakeCandidateId?: string;
      intakeDimension?: string;
      importId?: string;
      expectedDraftRevision?: number;
      sourceContentHash?: string;
      retry?: boolean;
    };
    await assertActiveProfileBinding(this.repository, input);
    const profile = await this.repository.getProfile(input.targetProfileId);
    if (!profile) throw toolError("profile_intake_target_missing", "目标资料库不存在，请重新选择。");
    if (profile.version !== input.expectedProfileVersion) {
      throw toolError("profile_intake_stale_profile", "资料库已更新，请先基于最新版本重新对账。");
    }
    const sourceContentHash = input.sourceContentHash ?? stableHashText(input.text.trim());
    const existing = input.importId
      ? await this.repository.getImportedResumeDraft(input.importId)
      : undefined;
    if (input.importId && (!existing || existing.sourceKind !== "conversation")) {
      throw toolError("profile_intake_draft_missing", "访谈草稿不存在，请重新整理刚才的回答。");
    }
    if (existing && existing.revision !== input.expectedDraftRevision) {
      throw toolError("profile_intake_stale_revision", "访谈草稿已更新，请刷新后继续补充。");
    }
    const identityMatch = (draft: ImportedResumeDraft | undefined) => {
      if (!draft || draft.sourceKind !== "conversation") return false;
      if (
        draft.source.sourceSessionId === input.sessionId
        && draft.source.sourceMessageId === input.messageId
        && draft.source.sourceTurnId === input.turnId
        && draft.source.sourceContentHash === sourceContentHash
      ) return true;
      return draft.sections.some((section) => section.items.some((item) =>
        item.conversationEvidence?.some((evidence) =>
          evidence.sessionId === input.sessionId
          && evidence.messageId === input.messageId
          && evidence.turnId === input.turnId
          && evidence.sourceContentHash === sourceContentHash
        )
      ));
    };
    const existingByIdentity = existing
      ? existing
      : await this.repository.findConversationIntakeBySourceIdentity({
          sessionId: input.sessionId,
          messageId: input.messageId,
          turnId: input.turnId,
          sourceContentHash
        });
    if (identityMatch(existingByIdentity) && input.retry !== true) {
      return captureProfileIntakeObservation(existingByIdentity!, profile, true);
    }
    const captureBase = existing && existing.intakeSession?.finalSynthesis
      ? invalidateFinalSynthesis(existing)
      : existing;
    const followUpTarget = input.intakeCandidateId && captureBase
      ? captureBase.sections.flatMap((section) => section.items).find((item) => item.id === input.intakeCandidateId)
      : undefined;
    if (input.intakeCandidateId && !followUpTarget?.structuredItem) {
      throw toolError("profile_intake_follow_up_candidate_missing", "刚才要补充的经历已不存在，请先查看当前草稿后继续。" );
    }
    const semanticResult = await this.profileIntakeSemantic.normalize({
      rawNarrative: input.text,
      existingDraft: input.intakeCandidateId ? undefined : existing,
      ...(followUpTarget?.structuredItem ? {
        followUpContext: {
          candidateId: followUpTarget.id,
          candidateLabel: profileIntakeDisplayLabel(followUpTarget.structuredItem, followUpTarget.itemLabel),
          sectionType: followUpTarget.structuredItem.sectionType as Exclude<NonNullable<ProfileIntakeSemanticInput["followUpContext"]>["sectionType"], "basics" | "summary">,
          currentStructuredItem: followUpTarget.structuredItem,
          expectedAnswerDimension: input.intakeDimension,
          sourceTurns: (followUpTarget.conversationEvidence ?? []).slice(-8).map((evidence) => ({
            turnId: evidence.turnId,
            sourceText: evidence.sourceQuote
          }))
        }
      } : {}),
      signal
    });
    const adapted = adaptConversationMessageToIntakeDraft({
      ...input,
      sourceContentHash,
      importId: captureBase?.importId,
      semanticResult
    });
    const patchBase = input.retry
      ? removeFailedIntakeFallback(captureBase ?? adapted.draft, { ...input, sourceContentHash })
      : captureBase;
    const nextDraft = input.intakeCandidateId && patchBase
      ? patchConversationIntakeCandidate({
          existing: patchBase,
          candidateId: input.intakeCandidateId,
          sessionId: input.sessionId,
          messageId: input.messageId,
          turnId: input.turnId,
          text: input.text,
          capturedAt: input.capturedAt,
          sourceContentHash,
          semanticResult
        })
      : patchBase
        ? mergeConversationIntakeDraft(patchBase, adapted.draft)
        : adapted.draft;
    const previousSession = captureBase?.intakeSession;
    const followUpCounts = { ...(previousSession?.followUpCounts ?? {}) };
    if (input.intakeCandidateId) {
      followUpCounts[input.intakeCandidateId] = (followUpCounts[input.intakeCandidateId] ?? 0) + 1;
    }
    const nextSession = nextDraft.intakeSession
      ? {
          ...nextDraft.intakeSession,
          phase: "clarifying" as const,
          userTurnCount: (previousSession?.userTurnCount ?? 0) + 1,
          perTurnBlockingReviewCount: previousSession?.perTurnBlockingReviewCount ?? 0,
          automaticFollowUpCount: (previousSession?.automaticFollowUpCount ?? 0)
            + Number(Boolean(input.intakeCandidateId)),
          followUpCounts
        }
      : undefined;
    const draftWithPhase = ImportedResumeDraftSchema.parse({
      ...nextDraft,
      ...(nextSession ? { intakeSession: nextSession } : {})
    });
    const saved = await this.repository.saveImportedResumeDraft(
      draftWithPhase,
      existing?.revision ?? 0
    );
    return captureProfileIntakeObservation(saved, profile, false);
  }

  async synthesizeProfileIntake(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { importId: string; expectedDraftRevision: number };
    const draft = await this.repository.getImportedResumeDraft(input.importId);
    if (!draft || draft.sourceKind !== "conversation") {
      throw toolError("profile_intake_draft_missing", "访谈草稿不存在，请重新开始整理。");
    }
    if (draft.revision !== input.expectedDraftRevision) {
      throw toolError("profile_intake_stale_revision", "访谈草稿已更新，请刷新最终整理后重试。");
    }
    const sessionId = draft.intakeSession?.sessionId ?? draft.source.sourceSessionId;
    const sourceTurns = sessionId
      ? await this.repository.listProfileIntakeSourceTurns(sessionId)
      : [];
    const synthesized = synthesizeProfileIntakeDraft({ draft, sourceTurns });
    const careerWritingInput = buildProfileIntakeFinalCareerSynthesisInput({
      draft: synthesized.draft,
      synthesis: synthesized.synthesis,
      sourceTurns
    });
    const careerWriting = await invokeStructuredAi({
      task: "profile-intake-final-career-synthesis",
      businessInput: {
        ...careerWritingInput,
        inputHash: stableHashText(JSON.stringify(careerWritingInput))
      },
      outputSchema: ProfileIntakeFinalCareerSynthesisOutputSchema,
      signal
    });
    const careerReady = careerWriting.ok
      ? applyProfileIntakeFinalCareerSynthesis({
          draft: synthesized.draft,
          synthesis: synthesized.synthesis,
          output: careerWriting.data
        })
      : synthesized;
    const saved = await this.repository.saveImportedResumeDraft(
      ImportedResumeDraftSchema.parse(careerReady.draft),
      input.expectedDraftRevision
    );
    const interviewPlan = createProfileIntakeInterviewPlan([], saved.revision);
    const reviewProjection = ProfileIntakeReviewProjectionSchema.parse({
      ...buildConversationIntakeReviewProjectionFromDraft(saved),
      phase: "ready_for_review",
      finalSynthesis: careerReady.synthesis,
      finalReviewRevision: saved.revision
    });
    const artifactPayload = buildConversationIntakeArtifact(saved, undefined, interviewPlan);
    return {
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      phase: "ready_for_review",
      finalReviewCount: saved.intakeSession?.finalReviewCount ?? 1,
      finalSynthesis: careerReady.synthesis,
      finalCareerWriting: {
        status: careerWriting.ok ? "completed" : "fallback_deterministic",
        provider: careerWriting.ok ? careerWriting.diagnostics?.provider : "deterministic",
        errorCode: careerWriting.ok ? undefined : careerWriting.errorCode
      },
      candidates: reviewProjection.candidates,
      reviewProjection,
      artifactPayload,
      interviewPlan,
      intakeSession: saved.intakeSession,
      persistenceReceipt: saved.intakeSession
        ? { autosavedAt: saved.intakeSession.autosavedAt, resumeToken: saved.intakeSession.resumeToken }
        : undefined
    };
  }

  async reviewProfileIntake(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      candidateId?: string;
      decision: "accept" | "reject" | "reopen" | "accept_all";
      editedLabel?: string;
      sectionType?: import("@/domain/schemas/resumeV2").ResumeSectionTypeV2;
      userCorrection?: boolean;
      structuredPatch?: ProfileIntakeStructuredPatch;
      evidence?: {
        sessionId: string;
        messageId: string;
        turnId: string;
        capturedAt: string;
        sourceQuote: string;
        sourceContentHash?: string;
      };
    };
    const draft = await this.repository.getImportedResumeDraft(input.importId);
    if (!draft || draft.sourceKind !== "conversation") {
      throw toolError("profile_intake_draft_missing", "访谈草稿不存在，请重新整理刚才的回答。");
    }
    if (draft.revision !== input.expectedDraftRevision) {
      throw toolError("profile_intake_stale_revision", "访谈草稿已更新，请刷新后继续核对。");
    }
    const now = new Date().toISOString();
    if (input.decision === "accept_all") {
      const finalIds = new Set(draft.intakeSession?.finalSynthesis?.assets.map((asset) => asset.candidateId) ?? []);
      const candidateIds = finalIds.size
        ? finalIds
        : new Set(draft.sections.flatMap((section) => section.items
          .filter((item) => item.structuredItem && item.userConfirmed !== false)
          .map((item) => item.id)));
      const sections = draft.sections.map((section) => {
        const items = section.items.map((item) => candidateIds.has(item.id)
          ? { ...item, included: true, userConfirmed: true, sourceStatus: "user_confirmed_modified" as const }
          : item);
        return { ...section, included: items.some((item) => item.included), items };
      });
      const nextSession = draft.intakeSession
        ? {
            ...draft.intakeSession,
            phase: "reviewing" as const,
            autosavedAt: now,
            reviewedCandidateIds: [...new Set([...draft.intakeSession.reviewedCandidateIds, ...candidateIds])],
            resumeToken: stableHashText(`${draft.importId}:${draft.revision + 1}:accept-all`)
          }
        : undefined;
      const saved = await this.repository.saveImportedResumeDraft(
        ImportedResumeDraftSchema.parse({ ...draft, sections, ...(nextSession ? { intakeSession: nextSession } : {}) }),
        input.expectedDraftRevision
      );
      const reviewProjection = buildConversationIntakeReviewProjectionFromDraft(saved);
      return {
        importId: saved.importId,
        expectedDraftRevision: saved.revision,
        decision: "accept_all",
        acceptedCount: candidateIds.size,
        unresolvedCount: reviewProjection.reviewProgress.proposed + reviewProjection.reviewProgress.uncertain,
        candidates: reviewProjection.candidates,
        reviewProjection,
        artifactPayload: buildConversationIntakeArtifact(saved),
        intakeSession: saved.intakeSession,
        phase: "reviewing",
        persistenceReceipt: saved.intakeSession
          ? { autosavedAt: saved.intakeSession.autosavedAt, resumeToken: saved.intakeSession.resumeToken }
          : undefined
      };
    }
    if (!input.candidateId) throw toolError("profile_intake_candidate_missing", "待核对经历不存在。");
    const operationId = `profile-intake-edit-${draft.importId}-${draft.revision}-${input.candidateId}`;
    let found = false;
    const sections = draft.sections.map((section) => {
      const items = section.items.map((item) => {
        if (item.id !== input.candidateId) return item;
        found = true;
        const editedLabel = input.editedLabel?.trim();
        const migrated = input.sectionType && item.structuredItem
          ? migrateProfileIntakeSection({ item: item.structuredItem, sectionType: input.sectionType })
          : item.structuredItem;
        const renamed = editedLabel ? renameStructuredItem(migrated, editedLabel) : migrated;
        const correctionValidation = input.userCorrection === true && input.structuredPatch && renamed
          ? validateUserCorrectionStructuredPatch({ item: renamed, rawPatch: input.structuredPatch })
          : undefined;
        const patchValidation = !correctionValidation && input.structuredPatch && renamed
          ? validateProfileIntakeStructuredPatch({
              item: renamed,
              rawPatch: input.structuredPatch,
              evidenceSources: [
                ...(item.careerNormalization?.fieldEvidence.map((entry) => ({ sourceQuote: entry.sourceQuote, supportedFields: [entry.field] })) ?? []),
                ...(input.evidence ? [{ sourceQuote: input.evidence.sourceQuote }] : [])
              ]
            })
          : undefined;
        const structuredItem = correctionValidation?.structuredItem
          ?? (patchValidation && renamed ? applyProfileIntakeStructuredPatch(renamed, patchValidation.patch) : renamed);
        const patchedFields = correctionValidation?.fieldNames ?? (patchValidation ? Object.keys(patchValidation.patch) : []);
        const normalizationResolved = input.userCorrection === true
          || (item.careerNormalization?.needsNormalization === true
            && input.decision === "accept"
            && Boolean(patchValidation && structuredItem && hasCareerReadyPatch(patchValidation.patch)));
        if (input.decision === "accept" && !structuredItem) {
          throw toolError("profile_intake_identity_missing", "这项内容还缺少正式名称，请编辑名称或手动整理后再采用。");
        }
        if (input.decision === "accept" && item.careerNormalization?.needsNormalization === true && !normalizationResolved) {
          throw toolError("profile_intake_normalization_required", "这项原始回答尚未整理完成，请重新解析、编辑后采用或忽略。");
        }
        const followUpEvidence = input.evidence ? { ...input.evidence, supportedFields: patchedFields } : undefined;
        const supersededSourceTurnId = item.conversationEvidence?.at(-1)?.turnId;
        const userCorrectionProvenance = input.userCorrection === true && patchedFields.length
          ? ProfileIntakeProvenanceSchema.parse({
              kind: "user_correction",
              sourceCandidateId: item.id,
              ...(supersededSourceTurnId ? { supersededSourceTurnId } : {}),
              supersededFieldEvidence: (item.careerNormalization?.fieldEvidence ?? [])
                .filter((entry) => patchedFields.includes(entry.field))
                .map((entry) => ({ field: entry.field, sourceTurnId: supersededSourceTurnId ?? item.id, sourceQuote: entry.sourceQuote })),
              fieldNames: patchedFields,
              confirmedAt: now,
              operationId
            })
          : undefined;
        return {
          ...item,
          itemLabel: editedLabel ?? item.itemLabel,
          normalizedText: structuredItem ? profileIntakeCareerReadyText(structuredItem) : item.normalizedText,
          structuredItem,
          included: input.decision === "accept",
          userConfirmed: input.decision === "accept" ? true : input.decision === "reject" ? false : undefined,
          sourceStatus: input.decision === "reject" ? "ambiguous" as const : "user_confirmed_modified" as const,
          userEdited: Boolean(editedLabel || input.structuredPatch),
          ...(userCorrectionProvenance ? { provenance: [...(item.provenance ?? []), userCorrectionProvenance] } : {}),
          pageRefs: followUpEvidence ? [...item.pageRefs, { pageNumber: 1, quote: followUpEvidence.sourceQuote }] : item.pageRefs,
          conversationEvidence: followUpEvidence ? [...(item.conversationEvidence ?? []), followUpEvidence] : item.conversationEvidence,
          careerNormalization: item.careerNormalization
            ? {
                ...item.careerNormalization,
                needsNormalization: normalizationResolved ? false : item.careerNormalization.needsNormalization,
                fieldEvidence: [...item.careerNormalization.fieldEvidence, ...(patchValidation?.fieldEvidence ?? [])]
              }
            : item.careerNormalization
        };
      });
      return { ...section, included: items.some((item) => item.included), items };
    });
    if (!found) throw toolError("profile_intake_candidate_missing", "待核对经历不存在。");
    const nextRevision = input.expectedDraftRevision + 1;
    const structuredItemsBeforeSave = sections.flatMap((section) => section.items.flatMap((item) =>
      item.userConfirmed !== false && item.structuredItem ? [item.structuredItem] : []
    ));
    const nextInterviewPlan = createProfileIntakeInterviewPlan(structuredItemsBeforeSave, nextRevision, {
      followUpCounts: draft.intakeSession?.followUpCounts
    });
    const nextSynthesis = draft.intakeSession?.finalSynthesis && input.candidateId
      ? {
          ...draft.intakeSession.finalSynthesis,
          assets: draft.intakeSession.finalSynthesis.assets.map((asset) => {
              const edited = sections.flatMap((section) => section.items).find((item) => item.id === input.candidateId);
              return asset.candidateId === input.candidateId && edited?.structuredItem
                ? {
                    ...asset,
                    sectionType: edited.structuredItem.sectionType,
                    structuredItem: edited.structuredItem,
                    highlights: finalSynthesisHighlights(edited.structuredItem),
                    provenance: edited.provenance ?? asset.provenance
                  }
                : asset;
          })
        }
      : draft.intakeSession?.finalSynthesis;
    const nextIntakeSession = draft.intakeSession
      ? {
          ...draft.intakeSession,
          ...(nextSynthesis ? { finalSynthesis: nextSynthesis } : {}),
          phase: draft.intakeSession.phase === "ready_for_review" || draft.intakeSession.phase === "reviewing" ? "reviewing" as const : "clarifying" as const,
          autosavedAt: now,
          lastCompletedSection: savedSectionType(sections, input.candidateId) ?? draft.intakeSession.lastCompletedSection,
          reviewedCandidateIds: [...new Set([...draft.intakeSession.reviewedCandidateIds, input.candidateId])],
          activeQuestionId: nextInterviewPlan.activeQuestionId,
          resumeToken: stableHashText(`${draft.importId}:${nextRevision}:${input.candidateId}`)
        }
      : undefined;
    const saved = await this.repository.saveImportedResumeDraft(
      ImportedResumeDraftSchema.parse({ ...draft, sections, ...(nextIntakeSession ? { intakeSession: nextIntakeSession } : {}) }),
      input.expectedDraftRevision
    );
    const unresolved = saved.sections.flatMap((section) => section.items).filter((item) => item.sourceStatus === "ambiguous").length;
    const savedItem = saved.sections.flatMap((section) => section.items).find((item) => item.id === input.candidateId);
    const structuredItems = saved.sections.flatMap((section) => section.items.flatMap((item) =>
      item.userConfirmed !== false && item.structuredItem ? [item.structuredItem] : []
    ));
    const interviewPlan = createProfileIntakeInterviewPlan(structuredItems, saved.revision, { followUpCounts: saved.intakeSession?.followUpCounts });
    const artifact = buildConversationIntakeArtifact(saved, interviewPlan.activeQuestion?.question, interviewPlan);
    const reviewProjection = buildConversationIntakeReviewProjectionFromDraft(saved, interviewPlan.activeQuestion?.question ? [interviewPlan.activeQuestion.question] : []);
    const finalizedProjection = ProfileIntakeReviewProjectionSchema.parse({
      ...reviewProjection,
      ...(reviewProjection.reviewProgress.reviewed === reviewProjection.reviewProgress.total && reviewProjection.reviewProgress.proposed === 0 && reviewProjection.reviewProgress.uncertain === 0 && reviewProjection.extractionStatus !== "failed" ? { finalReviewRevision: saved.revision } : {})
    });
    return {
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      candidateId: input.candidateId,
      decision: input.decision,
      structuredItem: savedItem?.structuredItem,
      fieldEvidence: savedItem?.careerNormalization?.fieldEvidence ?? [],
      candidate: artifact.candidates.find((candidate) => candidate.id === input.candidateId),
      editedLabel: input.editedLabel?.trim(),
      patchedFields: input.structuredPatch ? Object.keys(input.structuredPatch) : [],
      unresolvedCount: unresolved,
      persistenceReceipt: saved.intakeSession ? { autosavedAt: saved.intakeSession.autosavedAt, resumeToken: saved.intakeSession.resumeToken } : undefined,
      intakeSession: saved.intakeSession,
      providerStatus: reviewProjection.providerStatus,
      extractionStatus: captureExtractionStatus(reviewProjection.extractionStatus),
      followUpQuestion: interviewPlan.activeQuestion?.question,
      interviewPlan,
      artifactPayload: artifact,
      reviewProjection: finalizedProjection
    };
  }

  async reconcileProfileIntake(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      targetProfileId: string;
      expectedProfileVersion: number;
      acknowledgedActiveProfileId?: string;
    };
    await assertActiveProfileBinding(this.repository, input);
    const profile = await this.repository.getProfile(input.targetProfileId);
    if (!profile || profile.version !== input.expectedProfileVersion) {
      throw toolError("profile_intake_stale_profile", "资料库已变化，请基于最新版本重新对账。");
    }
    const plan = await this.repository.reconcileImportedResume({
      importId: input.importId,
      expectedDraftRevision: input.expectedDraftRevision,
      profileId: input.targetProfileId
    });
    return reconciliationToolResult(plan);
  }

  async resolveProfileIntakeConflict(rawInput: unknown, signal?: AbortSignal) {
    return this.resolveResumeReconciliation(rawInput, signal);
  }

  async commitProfileIntake(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      expectedReconciliationRevision: number;
      targetProfileId: string;
      expectedProfileVersion: number;
      acknowledgedActiveProfileId?: string;
    };
    await assertActiveProfileBinding(this.repository, input);
    const draft = await this.repository.getImportedResumeDraft(input.importId);
    assertConversationIntakeCommitEligible(draft);
    return this.repository.confirmProfileIntake({
      ...input,
      operationId
    });
  }

  async ensureGeneralResumeFromProfile(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      targetProfileId: string;
      expectedProfileVersion: number;
      acknowledgedActiveProfileId?: string;
      name?: string;
    };
    await assertActiveProfileBinding(this.repository, input);
    const profile = await this.repository.getProfile(input.targetProfileId);
    if (!profile || profile.version !== input.expectedProfileVersion) {
      throw toolError("profile_intake_stale_profile", "资料库已变化，请先读取最新版本后再生成通用简历。");
    }
    const result = await this.repository.ensureGeneralResumeFromProfile({
      profileId: input.targetProfileId,
      operationId,
      name: input.name
    });
    return {
      profileId: input.targetProfileId,
      profileVersion: profile.version,
      resumeId: result.branch.id,
      revisionId: result.revision?.id,
      revision: result.branch.revision,
      mode: result.mode,
      idempotent: result.idempotent
    };
  }

  async createResumeFromProfile(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      targetProfileId: string;
      expectedProfileVersion: number;
      selectedFactIds: string[];
      acknowledgedActiveProfileId?: string;
      name?: string;
    };
    await assertActiveProfileBinding(this.repository, input);
    const profile = await this.repository.getProfile(input.targetProfileId);
    if (!profile || profile.version !== input.expectedProfileVersion) {
      throw toolError("profile_from_profile_stale", "资料库已变化，请先读取最新版本后再创建简历。");
    }
    const selectedFactIds = [...new Set(input.selectedFactIds.map((id) => id.trim()).filter(Boolean))];
    if (!selectedFactIds.length) {
      throw toolError("profile_library_selection_empty", "请至少选择一项已确认经历后再创建简历。");
    }
    const created = await this.repository.createGeneralResumeBranch({
      profileId: input.targetProfileId,
      operationId,
      name: input.name?.trim() || `${profile.name} · 通用简历`,
      includeProfileFacts: true,
      includeProfileBasics: true,
      selectedCanonicalItemIds: selectedFactIds
    });
    return {
      profileId: input.targetProfileId,
      profileVersion: profile.version,
      resumeId: created.branch.id,
      revisionId: created.revision?.id ?? created.branch.currentRevisionId,
      revision: created.branch.revision,
      selectedFactIds,
      idempotent: created.idempotent
    };
  }

  async listResumes(signal?: AbortSignal) {
    assertNotAborted(signal);
    const branches = await this.repository.listResumeBranches();
    return {
      resumes: branches
        .filter((branch) => branch.lifecycleStatus === "active" && branch.migrationStatus === "verified")
        .map((branch, index) => ({
          order: index + 1,
          id: branch.id,
          profileId: branch.profileId,
          jobId: branch.jobId,
          name: branch.name,
          purpose: branch.branchPurpose,
          revision: branch.revision,
          currentRevisionId: branch.currentRevisionId,
          updatedAt: branch.updatedAt
        }))
    };
  }

  async listProfiles(signal?: AbortSignal) {
    assertNotAborted(signal);
    const profiles = await this.repository.listProfiles();
    return {
      profiles: profiles.map((profile) => ({
        ...profileSummaryCounts(profile),
        id: profile.id,
        personId: profile.personId,
        profileVersionNumber: profile.profileVersionNumber,
        isCurrent: profile.isCurrent,
        name: profile.name,
        version: profile.version,
        sectionCounts: Object.fromEntries(canonicalProfileSectionCounts(profile)),
        items: canonicalProfileLibraryItems(profile).slice(0, 24).map((item) => ({
          id: item.id,
          sectionType: item.sectionType,
          title: item.title,
          subtitle: item.subtitle,
          body: item.body.slice(0, 360),
          factCount: item.factIds.length
        })),
        updatedAt: profile.updatedAt
      }))
    };
  }

  async listJobs(signal?: AbortSignal) {
    assertNotAborted(signal);
    const jobs = await this.repository.listJobDescriptions();
    return {
      jobs: jobs.map((job, index) => ({
        order: index + 1,
        id: job.id,
        title: job.title,
        company: job.company,
        requirementCount: job.requirements.length,
        analysisStatus: job.analysisStatus,
        updatedAt: job.updatedAt
      }))
    };
  }

  async getActiveProfile(signal?: AbortSignal) {
    assertNotAborted(signal);
    const contextReader = this.repository.getActiveCareerContext;
    if (typeof contextReader !== "function") {
      const profileId = await this.repository.getActiveProfileId();
      const profile = profileId ? await this.repository.getProfile(profileId) : undefined;
      return profile
        ? {
            selected: true,
            profileId: profile.id,
            name: profile.name,
            version: profile.version,
            profileVersionNumber: profile.profileVersionNumber,
            profileVersionLabel: profile.profileVersionLabel,
            isCurrent: profile.isCurrent
          }
        : { selected: false, profileId: null, availableProfiles: [] };
    }
    const context = await contextReader.call(this.repository);
    if (!context) {
      const [profiles, persons] = await Promise.all([this.repository.listProfiles(), this.repository.listCareerPersons()]);
      return {
      selected: false,
      profileId: null,
      availableProfiles: profiles.map((profile) => ({ id: profile.id, personId: profile.personId, name: profile.name, version: profile.version, profileVersionNumber: profile.profileVersionNumber, isCurrent: profile.isCurrent })),
      availablePersons: persons.map((person) => ({ id: person.id, displayName: person.displayName }))
      };
    }
    const profile = await this.repository.getProfile(context.profileId);
    if (!profile) throw toolError("active_profile_not_found", "The selected profile no longer exists.");
    const person = await this.repository.getCareerPerson(context.personId);
    return {
      selected: true,
      personId: context.personId,
      personName: person?.displayName,
      profileId: profile.id,
      name: profile.name,
      version: profile.version,
      profileVersionNumber: profile.profileVersionNumber,
      profileVersionLabel: profile.profileVersionLabel,
      isCurrent: profile.isCurrent
    };
  }

  async getProfile(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { profileId: string };
    const profile = await this.repository.getProfile(input.profileId);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    const items = canonicalProfileLibraryItems(profile);
    return {
      profile: {
        ...profileSummaryCounts(profile),
        id: profile.id,
        personId: profile.personId,
        profileVersionNumber: profile.profileVersionNumber,
        profileVersionLabel: profile.profileVersionLabel,
        isCurrent: profile.isCurrent,
        name: profile.name,
        version: profile.version,
        basics: profile.basics,
        preference: profile.preference,
        sectionCounts: Object.fromEntries(canonicalProfileSectionCounts(profile)),
        items: items.slice(0, 60).map((item) => ({
          id: item.id,
          sectionType: item.sectionType,
          title: item.title,
          subtitle: item.subtitle,
          body: item.body.slice(0, 800),
          factIds: item.factIds
        })),
        unclassifiedBlockCount: profile.unclassifiedBlocks.length,
        updatedAt: profile.updatedAt
      }
    };
  }

  async searchProfileFacts(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { profileId: string; query: string; sectionTypes?: string[]; limit?: number };
    const profile = await this.repository.getProfile(input.profileId);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    const terms = input.query.toLowerCase().split(/[\s,，。；;、/]+/).filter(Boolean);
    const sections = new Set(input.sectionTypes ?? []);
    const results = canonicalProfileLibraryItems(profile)
      .filter((item) => !sections.size || sections.has(item.sectionType))
      .map((item) => {
        const haystack = `${item.title}\n${item.subtitle ?? ""}\n${item.body}`.toLowerCase();
        const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
        return { item, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit ?? 12)
      .map(({ item, score }) => ({
        id: item.id,
        sectionType: item.sectionType,
        title: item.title,
        subtitle: item.subtitle,
        body: item.body.slice(0, 800),
        factIds: item.factIds,
        score
      }));
    return { profileId: profile.id, query: input.query, results };
  }

  async getResume(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    return {
      resume: {
        id: branch.id,
        profileId: branch.profileId,
        jobId: branch.jobId,
        name: branch.name,
        purpose: branch.branchPurpose,
        revision: branch.revision,
        currentRevisionId: branch.currentRevisionId,
        resumeHash: stableHashText(JSON.stringify({
          currentRevisionId: branch.currentRevisionId,
          contentItems: branch.contentItems,
          structuredContentItems: branch.structuredContentItems
        })),
        contentItems: branch.contentItems,
        structuredContentItems: branch.structuredContentItems,
        updatedAt: branch.updatedAt
      }
    };
  }

  async getResumeRevision(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string; revisionId?: string };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    const revisionId = input.revisionId ?? branch.currentRevisionId;
    if (!revisionId) throw toolError("resume_revision_not_found", "Resume does not have a revision.");
    const revisions = await this.repository.listResumeRevisions(branch.id);
    const revision = revisions.find((candidate) => candidate.id === revisionId);
    if (!revision) throw toolError("resume_revision_not_found", "Resume revision no longer exists.");
    return { resumeId: branch.id, revision };
  }

  async getJob(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { jobId: string };
    const job = await this.repository.getJobDescription(input.jobId);
    if (!job) throw toolError("job_not_found", "Job no longer exists.");
    return {
      job: {
        ...job,
        jobRevision: job.updatedAt,
        jobGraphHash: stableHashText(JSON.stringify(job.requirementGraph ?? job.requirements))
      }
    };
  }

  async recommendResumeSource(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { profileId: string; jobId: string };
    const [profile, job, branches] = await Promise.all([
      this.repository.getProfile(input.profileId),
      this.repository.getJobDescription(input.jobId),
      this.repository.listResumeBranches()
    ]);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    if (!job) throw toolError("job_not_found", "Job no longer exists.");
    const candidates = branches.filter((branch) =>
      branch.profileId === profile.id
      && branch.lifecycleStatus === "active"
      && branch.migrationStatus === "verified"
    );
    const keywords = [...new Set(job.requirements.flatMap((requirement) => requirement.keywords).filter((keyword) => keyword.length > 1))];
    const profileItems = canonicalProfileLibraryItems(profile);
    const profileText = profileItems.map((item) => `${item.title} ${item.subtitle ?? ""} ${item.body}`).join("\n").toLowerCase();
    const rankedResumes = candidates.map((branch) => {
      const text = branch.contentItems.filter((item) => item.visible).map((item) => item.text).join("\n").toLowerCase();
      return {
        id: branch.id,
        name: branch.name,
        maturity: Math.min(1, branch.contentItems.filter((item) => item.visible).length / 12),
        relevance: keywordCoverage(text, keywords),
        provenance: branch.contentItems.length
          ? branch.contentItems.filter((item) => item.factRefs.length > 0 || item.guardStatus === "pass").length / branch.contentItems.length
          : 0,
        recency: recencyScore(branch.updatedAt),
        missingData: branch.contentItems.length ? 0 : 1
      };
    }).sort((left, right) => (right.maturity + right.relevance) - (left.maturity + left.relevance));
    const best = rankedResumes[0];
    const recommendation = recommendSourceRoute({
      profileEvidenceRichness: Math.min(1, profileItems.length / 16),
      resumeMaturity: best?.maturity ?? 0,
      profileJobRelevance: keywordCoverage(profileText, keywords),
      resumeJobRelevance: best?.relevance ?? 0,
      profileProvenanceCoverage: profileItems.length
        ? profileItems.filter((item) => item.factIds.length > 0).length / profileItems.length
        : 0,
      resumeProvenanceCoverage: best?.provenance ?? 0,
      resumeRecency: best?.recency ?? 0,
      profileMissingData: profileItems.length ? 0 : 1,
      resumeMissingData: best?.missingData ?? 1
    });
    return { recommendation, recommendedResumeId: best?.id, resumeCandidates: rankedResumes };
  }

  async createJobResumeFromProfile(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { profileId: string; jobId: string; name?: string };
    const [profile, job] = await Promise.all([
      this.repository.getProfile(input.profileId),
      this.repository.getJobDescription(input.jobId)
    ]);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    if (!job) throw toolError("job_not_found", "Job no longer exists.");
    const analysis = analyzeProfileLibrarySource({ profile, job });
    const selectedCanonicalItemIds = analysis.recommendations
      .filter((item) => item.disposition !== "hide")
      .map((item) => item.id);
    if (!selectedCanonicalItemIds.length) {
      throw toolError("profile_library_selection_empty", "No confirmed profile content can support this job yet.");
    }
    const created = await this.repository.createJobSpecificBranchFromProfile({
      profileId: profile.id,
      jobId: job.id,
      operationId,
      name: input.name?.trim() || `${profile.name} · ${job.title}`,
      selectedCanonicalItemIds,
      requirementMatchIds: []
    });
    return {
      resumeId: created.branch.id,
      revisionId: created.revision?.id ?? created.branch.currentRevisionId,
      selectedCanonicalItemIds,
      analysisHash: analysis.analysisHash,
      factGaps: analysis.factGaps,
      idempotent: created.idempotent
    };
  }

  async getAgentTaskContext(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { sessionId: string };
    const session = await this.repository.getAgentSession(input.sessionId);
    if (!session) throw toolError("agent_session_not_found", "Agent session no longer exists.");
    return {
      sessionId: session.id,
      title: getAgentSessionDisplayTitle(session),
      workflowState: session.workflowState,
      activeProfileId: session.activeProfileId,
      activeResumeId: session.activeResumeId,
      activeJobId: session.activeJobId,
      artifactRefs: session.artifactRefs,
      conversationSummary: session.conversationSummary,
      updatedAt: session.updatedAt
    };
  }

  async searchAgentSessions(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { query: string; limit?: number };
    const query = input.query.trim().toLowerCase();
    const sessions = await this.repository.listAgentSessions(100);
    return {
      query: input.query,
      sessions: sessions
        .filter((session) => `${session.title}\n${session.conversationSummary}\n${session.messages.map((message) => message.content).join("\n")}`.toLowerCase().includes(query))
        .slice(0, input.limit ?? 8)
        .map((session) => ({
          id: session.id,
          title: getAgentSessionDisplayTitle(session),
          workflowId: session.workflowState.workflowId,
          step: session.workflowState.step,
          status: session.workflowState.status,
          summary: session.conversationSummary.slice(-1200),
          updatedAt: session.updatedAt
        }))
    };
  }

  async skillsList(signal?: AbortSignal) {
    assertNotAborted(signal);
    return { skills: agentSkillRegistry.list() };
  }

  async skillView(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { skillId: string; referencePath?: string };
    return input.referencePath
      ? agentSkillRegistry.view(input.skillId, input.referencePath)
      : agentSkillRegistry.view(input.skillId);
  }

  async parseResumeFile(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { fileName: string; mimeType: string; text: string };
    if (input.mimeType === "application/pdf") {
      throw toolError("pdf_text_required", "PDF must first be converted to page text by the existing PDF import flow.");
    }
    const now = new Date().toISOString();
    const text = input.text.replace(/\r\n/g, "\n").trim();
    const draft = createImportedResumeDraftFromText({
      source: {
        fileName: input.fileName,
        mimeType: input.mimeType as "text/plain",
        fileHash: stableHashText(input.text),
        normalizedTextHash: stableHashText(text),
        pageCount: 1,
        extractedAt: now
      },
      pages: [{
        pageNumber: 1,
        extractedPageText: input.text,
        cleanedPageText: text,
        charStart: 0,
        charEnd: text.length
      }],
      sourceKind: input.mimeType === "application/json" ? "standard_json" : "docx",
      now
    });
    return { parsedResume: draft };
  }

  async createResumeImportDraft(rawInput: unknown, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { parsedResume: unknown };
    const draft = ImportedResumeDraftSchema.parse(input.parsedResume);
    const saved = await this.repository.saveImportedResumeDraft(draft, 0);
    return {
      importId: saved.importId,
      revision: saved.revision,
      status: saved.status,
      sectionCount: saved.sections.length,
      warningCount: saved.warnings.length
    };
  }

  async commitResumeImport(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as {
      importId: string;
      expectedDraftRevision: number;
      expectedReconciliationRevision?: number;
      target: { mode: "existing"; profileId: string } | { mode: "new"; profileName: string; createGeneralResume: true };
    };
    return this.repository.confirmImportedResume({ ...input, operationId });
  }

  async parseJobDescription(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { rawText: string; title?: string; company?: string };
    const analyzed = analyzeJobCommand({ operationId, rawText: input.rawText }, signal);
    const candidateTitle = input.title?.trim() || inferJobTitle(input.rawText);
    const candidateCompany = input.company?.trim() || inferJobCompany(input.rawText);
    return {
      ...analyzed,
      candidateTitle,
      candidateCompany,
      missingIdentityFields: [
        ...(candidateTitle ? [] : ["title"]),
        ...(candidateCompany ? [] : ["company"])
      ],
      reviewStatus: analyzed.needsReview ? "needs_review" : "ready_for_identity_review"
    };
  }

  async commitJob(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { title: string; company: string; rawText: string; graph: unknown };
    const graph = JobRequirementGraphV4Schema.parse(input.graph);
    const now = new Date().toISOString();
    const rawInputId = `raw-agent-job-${stableHashText(operationId).slice(0, 20)}`;
    const draftId = `job-draft-agent-${stableHashText(operationId).slice(0, 20)}`;
    const rawDocument = RawInputDocumentSchema.parse({
      id: rawInputId,
      kind: "job_jd",
      rawText: input.rawText,
      inputHash: await hashText(input.rawText),
      title: `${input.company} ${input.title}`,
      createdAt: now,
      updatedAt: now
    });
    const analyzerOutput = projectJobGraphV4ToAnalyzerOutput({
      graph,
      title: input.title,
      company: input.company,
      now
    });
    const draft = JobAnalysisDraftSchema.parse({
      id: draftId,
      rawInputId,
      revision: 0,
      title: input.title,
      company: input.company,
      status: graph.needsReview ? "needs_review" : "ai_validated",
      promptVersion: "agent-command.v1",
      attemptCount: 1,
      analyzerOutput,
      requirementGraph: graph,
      analysisIssues: graph.sourceCoverage.unclassifiedSpans.map((span) => span.text),
      manualRequirements: [],
      riskNotes: analyzerOutput.riskNotes,
      createdAt: now,
      updatedAt: now
    });
    await this.repository.saveRawInput(rawDocument);
    await this.repository.createJobAnalysisDraft(draft);
    const committed = await commitParsedJob({ repository: this.repository, draft, rawInput: rawDocument });
    return {
      jobId: committed.jobDescription.id,
      jobRevision: committed.jobDescription.updatedAt,
      jobGraphHash: stableHashText(JSON.stringify(
        committed.jobDescription.requirementGraph ?? committed.jobDescription.requirements
      )),
      ...committed
    };
  }

  async analyzeJobFit(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const { profile, branch, job } = await this.loadSelection(rawInput);
    return {
      operationId,
      analysis: analyzeJobFit({ profile, branch, job }),
      dependencies: selectionDependencies(profile, branch, job)
    };
  }

  async createTailoringSession(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { intensity?: unknown };
    const { profile, branch, job } = await this.loadSelection(rawInput);
    const created = createTailoringSessionCommand({
      operationId,
      profile,
      branch,
      job,
      intensity: input.intensity ? TailoringIntensitySchema.parse(input.intensity) : undefined
    }, signal);
    return {
      ...created,
      appliedDiffs: [],
      candidateQuestionCount: created.session.plan.clarificationQuestions?.length ?? 0,
      selectedQuestionCount: created.session.plan.questionPlan?.questionIds.length ?? 0,
      dependencies: {
        ...selectionDependencies(profile, branch, job),
        tailoringSessionId: created.session.id
      }
    };
  }

  async answerTailoringQuestion(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { session: unknown; questionId: string; answer: string | string[] | boolean; proficiency?: "proficient" | "familiar" | "aware" | "learning" };
    const answered = answerTailoringQuestionCommand({
      operationId,
      session: TailoringSessionSchema.parse(input.session),
      questionId: input.questionId,
      answer: input.answer,
      proficiency: input.proficiency
    }, signal);
    return answered;
  }

  async generateTailoringChanges(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as { session: unknown };
    const session = TailoringSessionSchema.parse(input.session);
    const answerRevisionHash = tailoringAnswerRevisionHash(session.plan);
    const generationIsCurrent = session.plan.generationStatus === "completed"
      && session.plan.generatedDiffsBasedOnQuestionPlanRevision === session.plan.questionPlan?.revision
      && session.plan.generatedDiffsBasedOnAnswerRevisionHash === answerRevisionHash;
    if (generationIsCurrent) {
      return {
        operationId,
        session,
        appliedDiffs: session.plan.diffs ?? [],
        rejectedDiffs: [],
        warnings: [],
        idempotent: true
      };
    }
    return this.generateDiffs(operationId, session, signal);
  }

  async reviewTailoringDiff(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = rawInput as {
      session: unknown;
      diffId: string;
      decision: "accept" | "edit" | "reject";
      editedValue?: string | string[];
    };
    return reviewTailoringDiffCommand({
      operationId,
      session: TailoringSessionSchema.parse(input.session),
      diffId: input.diffId,
      decision: input.decision,
      editedValue: input.editedValue
    }, signal);
  }

  async previewTailoringChanges(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = parseTailoringChanges(rawInput);
    return previewTailoringChangesCommand({ operationId, ...input }, signal);
  }

  async applyTailoringChanges(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    const input = parseTailoringChanges(rawInput);
    let session = input.session;

    if (session.branch.branchPurpose === "general") {
      if (!session.branch.currentRevisionId) {
        throw toolError("source_revision_missing", "The selected resume does not have a source revision.");
      }
      const derived = await this.repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: session.branch.id,
        jobId: session.job.id,
        expectedSourceRevision: session.branch.revision,
        expectedSourceRevisionId: session.branch.currentRevisionId,
        operationId: childOperationId(operationId, "derive"),
        name: `${session.branch.name} · ${session.job.title}`.slice(0, 120)
      });
      session = TailoringSessionSchema.parse({
        ...session,
        branch: derived.branch
      });
    }

    const result = await applyTailoringSessionCommand({
      repository: this.repository,
      operationId: childOperationId(operationId, "apply"),
      session,
      selectedDiffs: input.selectedDiffs,
      confirmedRequirementIds: input.confirmedRequirementIds,
      signal
    });
    return {
      branchId: result.branch.id,
      branchRevision: result.branch.revision,
      revisionId: result.revision?.id,
      resumeHash: stableHashText(JSON.stringify({
        currentRevisionId: result.branch.currentRevisionId,
        contentItems: result.branch.contentItems,
        structuredContentItems: result.branch.structuredContentItems
      })),
      ...result
    };
  }

  async archiveResume(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string; expectedRevision: number };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    if (branch.lifecycleStatus !== "active") {
      throw toolError("resume_not_active", "Only an active resume can be archived.");
    }
    const result = await this.repository.archiveResumeBranch({
      branchId: branch.id,
      expectedRevision: input.expectedRevision,
      operationId,
      confirmedImpact: true
    });
    return {
      resumeId: result.branch.id,
      lifecycleStatus: result.branch.lifecycleStatus,
      revision: result.branch.revision,
      idempotent: result.idempotent
    };
  }

  async restoreResume(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string; expectedRevision: number };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    if (branch.lifecycleStatus !== "archived") {
      throw toolError("resume_not_archived", "Only an archived resume can be restored.");
    }
    const result = await this.repository.restoreArchivedResumeBranch({
      branchId: branch.id,
      expectedRevision: input.expectedRevision,
      operationId
    });
    return {
      resumeId: result.branch.id,
      lifecycleStatus: result.branch.lifecycleStatus,
      revision: result.branch.revision,
      idempotent: result.idempotent
    };
  }

  async exportResume(rawInput: unknown, operationId: string, signal?: AbortSignal) {
    assertNotAborted(signal);
    const input = rawInput as { resumeId: string; templateId?: string };
    const branch = await this.repository.getResumeBranch(input.resumeId);
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    await this.repository.getResumePresentationConfig(branch.id);
    return {
      exportId: `agent-export-${stableHashText(operationId).slice(0, 20)}`,
      branchId: branch.id,
      route: `/resume?branchId=${encodeURIComponent(branch.id)}&export=pdf`,
      status: "ready_for_preview"
    };
  }

  private async loadSelection(rawInput: unknown) {
    const input = rawInput as { profileId: string; resumeId: string; jobId: string };
    const [profile, branch, job] = await Promise.all([
      this.repository.getProfile(input.profileId),
      this.repository.getResumeBranch(input.resumeId),
      this.repository.getJobDescription(input.jobId)
    ]);
    if (!profile) throw toolError("profile_not_found", "Profile no longer exists.");
    if (!branch) throw toolError("resume_not_found", "Resume no longer exists.");
    if (!job) throw toolError("job_not_found", "Job no longer exists.");
    if (branch.profileId !== profile.id) throw toolError("resume_profile_mismatch", "Resume does not belong to the selected profile.");
    return { profile, branch, job };
  }

  private generateDiffs(operationId: string, session: TailoringSession, signal?: AbortSignal) {
    return generateTailoringDiffsCommand({
      operationId,
      session,
      signal,
      generate: async (request: ResumeTailoringDiffTaskInput, requestSignal?: AbortSignal) => {
        const result = await invokeStructuredAi({
          task: "resume-tailor-diff",
          businessInput: request,
          outputSchema: ResumeTailoringDiffModelOutputSchema,
          signal: requestSignal
        });
        if (!result.ok) throw toolError(result.errorCode, "AI could not generate a validated tailoring diff.");
        return result.data;
      },
      generateConsolidated: async (requests: ResumeTailoringDiffTaskInput[], requestSignal?: AbortSignal) => {
        const first = requests[0];
        const batchInput = ResumeTailorBatchInputSchema.parse({
          draftId: first.draftId,
          profileId: first.profileId,
          jobId: first.jobId,
          intensity: first.intensity,
          compactJobContext: {
            title: first.jobContext.title,
            roleMission: first.jobContext.roleMission,
            topResponsibilities: first.jobContext.responsibilities.slice(0, 4),
            targetKeywords: first.jobContext.keywords.slice(0, 16)
          },
          targets: requests.map((request) => ({
            itemId: request.target.itemId,
            sectionType: request.target.sectionType,
            sectionId: request.target.sectionId,
            fieldPath: request.target.fieldPath,
            structuredItem: request.currentContent.structuredItem,
            before: request.currentContent.fieldValue,
            renderedText: request.currentContent.renderedText,
            relevantRequirements: request.relevantRequirements,
            evidenceBundle: request.evidenceBundle,
            allowedEvidenceRefs: request.allowedEvidenceRefs,
            allowedFacts: request.allowedFacts
          }))
        });
        const result = await invokeStructuredAi({
          task: "resume-tailor-batch",
          businessInput: batchInput,
          outputSchema: ResumeTailorModelOutputSchema,
          signal: requestSignal
        });
        if (!result.ok) throw toolError(result.errorCode, "AI could not generate a consolidated tailoring plan.");
        const targetByItemId = new Map(requests.map((request) => [request.target.itemId, request]));
        const suggestions = result.data.suggestions as Array<Record<string, unknown>>;
        const diffs = suggestions.flatMap((suggestion) => {
          const request = targetByItemId.get(String(suggestion.targetItemId ?? suggestion.itemId ?? ""));
          if (!request) return [];
          return [ResumeTailoringDiffSchema.parse({
            target: {
              sectionId: request.target.sectionId,
              itemId: request.target.itemId,
              fieldPath: request.target.fieldPath
            },
            operation: "replace",
            original: request.currentContent.fieldValue,
            value: suggestion.after,
            reason: suggestion.rationale,
            requirementIds: suggestion.requirementIds ?? [],
            targetKeywords: suggestion.targetKeywords ?? [],
            evidenceRefs: suggestion.evidenceRefs ?? request.allowedEvidenceRefs,
            supportLevel: suggestion.claimSupportLevel ?? "verified"
          })];
        });
        return { diffs };
      }
    });
  }
}

function hasCareerReadyPatch(patch: ProfileIntakeStructuredPatch) {
  return Boolean(
    patch.title
    || patch.name
    || patch.organization
    || patch.institution
    || patch.role
    || patch.description
    || patch.highlights?.length
    || patch.tools?.length
    || patch.methods?.length
    || patch.outcomes?.length
  );
}

function assertConversationIntakeCommitEligible(draft: ImportedResumeDraft | undefined) {
  if (!draft || draft.sourceKind !== "conversation") {
    throw toolError("profile_intake_draft_missing", "访谈草稿不存在，请重新整理刚才的回答。");
  }
  const blocked = draft.sections.flatMap((section) => section.items)
    .some((item) =>
      item.included
      && (item.careerNormalization?.needsNormalization === true || !item.structuredItem)
    );
  if (blocked) {
    throw toolError(
      "profile_intake_normalization_required",
      "仍有内容尚未形成可写入资料库的正式事实，请先重新解析、编辑或手动整理。"
    );
  }
}

function inferJobTitle(rawText: string) {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const labeled = lines.find((line) => /^(岗位|职位|job\s*title)\s*[:：]/i.test(line));
  if (labeled) return labeled.replace(/^[^:：]+[:：]\s*/, "").slice(0, 160) || undefined;
  const first = lines[0];
  return first && first.length <= 80 && !/职责|要求|招聘|responsibilit|requirement/i.test(first)
    ? first.slice(0, 160)
    : undefined;
}

function inferJobCompany(rawText: string) {
  const line = rawText.split(/\r?\n/).map((value) => value.trim()).find((value) =>
    /^(公司|企业|company)\s*[:：]/i.test(value)
  );
  return line?.replace(/^[^:：]+[:：]\s*/, "").slice(0, 160) || undefined;
}

function parseTailoringChanges(rawInput: unknown) {
  const input = rawInput as { session: unknown; selectedDiffs: unknown[]; confirmedRequirementIds?: string[] };
  return {
    session: TailoringSessionSchema.parse(input.session),
    selectedDiffs: input.selectedDiffs.map((diff) => ResumeTailoringDiffSchema.parse(diff)),
    confirmedRequirementIds: input.confirmedRequirementIds ?? []
  };
}

function selectionDependencies(
  profile: { id: string; version: number },
  branch: {
    id: string;
    currentRevisionId?: string | null;
    contentItems: unknown;
    structuredContentItems?: unknown;
  },
  job: {
    id: string;
    updatedAt: string;
    requirementGraph?: unknown;
    requirements: unknown;
  }
) {
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    resumeId: branch.id,
    resumeRevisionId: branch.currentRevisionId,
    resumeHash: stableHashText(JSON.stringify({
      currentRevisionId: branch.currentRevisionId,
      contentItems: branch.contentItems,
      structuredContentItems: branch.structuredContentItems
    })),
    jobId: job.id,
    jobRevision: job.updatedAt,
    jobGraphHash: stableHashText(JSON.stringify(job.requirementGraph ?? job.requirements))
  };
}

function childOperationId(operationId: string, suffix: string) {
  return `${operationId.slice(0, 150 - suffix.length)}-${suffix}`;
}

function profileSummaryCounts(profile: Parameters<typeof canonicalProfileLibraryItems>[0]) {
  const items = canonicalProfileLibraryItems(profile);
  const experienceSections = new Set(["education", "work", "internship", "project", "research", "campus", "volunteer"]);
  return {
    experienceCount: items.filter((item) => experienceSections.has(item.sectionType)).length,
    skillCount: items.filter((item) => item.sectionType === "skills" || item.sectionType === "languages").length,
    certificateCount: items.filter((item) => item.sectionType === "certificates").length
  };
}

function captureProfileIntakeObservation(
  draft: ImportedResumeDraft,
  profile: { id: string; version: number },
  idempotent: boolean
) {
  const provisionalStructuredItems = draft.sections.flatMap((section) => section.items.flatMap((item) =>
    item.userConfirmed !== false && item.structuredItem ? [item.structuredItem] : []
  ));
  const interviewPlan = createProfileIntakeInterviewPlan(provisionalStructuredItems, draft.revision, {
    followUpCounts: draft.intakeSession?.followUpCounts
  });
  const followUpQuestion = interviewPlan.activeQuestion?.question;
  const artifactPayload = buildConversationIntakeArtifact(draft, followUpQuestion, interviewPlan);
  const reviewProjection = buildConversationIntakeReviewProjectionFromDraft(
    draft,
    // The persisted plan is the single selector authority; never reintroduce a
    // provider question after the per-asset cap is exhausted.
    followUpQuestion ? [followUpQuestion] : []
  );
  const extractionStatus = captureExtractionStatus(reviewProjection.extractionStatus);
  const usableCandidateCount = reviewProjection.candidates.filter((candidate) =>
    candidate.status !== "failed" && Boolean(candidate.structuredItem)
  ).length;
  const quarantinedCandidateCount = draft.intakeSession?.quarantinedCandidateCount ?? 0;
  const provisionalItems = draft.sections.flatMap((section) => section.items.flatMap((item) =>
    item.userConfirmed !== false && item.structuredItem ? [item.structuredItem] : []
  ));
  const activeQuestion = interviewPlan.activeQuestion;
  const activeCandidate = activeQuestion
    ? provisionalItems.find((item) => item.id === activeQuestion.candidateId)
    : undefined;
  const supervisorAction = resolveProfileIntakeInterviewSupervisor({
    provisionalItems,
    activeQuestion: activeQuestion && activeCandidate ? {
      candidateId: activeQuestion.candidateId,
      candidateLabel: activeQuestion.candidateLabel ?? profileIntakeItemLabel(activeCandidate),
      ...(activeQuestion.sectionType !== "basics"
        ? { sectionType: activeQuestion.sectionType ?? activeCandidate.sectionType }
        : { sectionType: activeCandidate.sectionType }),
      dimension: activeQuestion.dimension,
      question: targetQuestion(activeQuestion.question, activeQuestion.candidateLabel ?? profileIntakeItemLabel(activeCandidate))
    } : undefined,
    suggestedNextSections: interviewPlan.suggestedNextSections,
    followUpCounts: draft.intakeSession?.followUpCounts,
    capturedAssetLabels: provisionalItems.map(profileIntakeItemLabel)
  });
  const nextTurnPlan = nextTurnPlanFromSupervisorAction({
    ...supervisorAction,
    ...(supervisorAction.type === "ask_follow_up" ? {
      acknowledgement: activeCandidate
        ? `已补充“${profileIntakeItemLabel(activeCandidate)}”的这条信息。`
        : undefined,
      capturedAssetLabels: provisionalItems.map(profileIntakeItemLabel)
    } : {})
  });
  return {
    importId: draft.importId,
    expectedDraftRevision: draft.revision,
    targetProfileId: profile.id,
    expectedProfileVersion: profile.version,
    persistenceStatus: idempotent ? "already_saved" as const : "saved" as const,
    providerStatus: reviewProjection.providerStatus,
    extractionStatus,
    candidateCount: reviewProjection.reviewProgress.total,
    usableCandidateCount,
    quarantinedCandidateCount,
    needsConfirmationCount: artifactPayload.needsConfirmation.length,
    candidates: reviewProjection.candidates,
    followUpQuestion,
    nextTurnPlan,
    interviewPlan,
    artifactPayload,
    reviewProjection,
    persistenceReceipt: draft.intakeSession
      ? {
          autosavedAt: draft.intakeSession.autosavedAt,
          resumeToken: draft.intakeSession.resumeToken
        }
      : undefined,
    intakeSession: draft.intakeSession,
    safeDiagnostics: {
      ...(reviewProjection.safeDiagnostics ?? {}),
      provider: reviewProjection.safeDiagnostics?.provider ?? reviewProjection.providerStatus,
      extractionStatus,
      candidateCount: reviewProjection.reviewProgress.total,
      quarantinedCount: reviewProjection.safeDiagnostics?.quarantinedCount ?? quarantinedCandidateCount,
      quarantinedCandidateCount,
      ...(quarantinedCandidateCount > 0
        ? { code: "candidate_quarantined", safeErrorCode: reviewProjection.safeDiagnostics?.safeErrorCode ?? "candidate_quarantined" }
        : reviewProjection.safeDiagnostics?.safeErrorCode
          ? { code: reviewProjection.safeDiagnostics.safeErrorCode }
          : {})
    },
    idempotent
  };
}

function captureExtractionStatus(value: string) {
  if (value === "structured_local") return "structured_local" as const;
  if (value === "structured_ai" || value === "structured") return "structured_ai" as const;
  if (value === "partial") return "partial" as const;
  return "failed" as const;
}

function finalSynthesisHighlights(item: import("@/domain/schemas").ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return [
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : []),
    ...(typeof record.description === "string" ? record.description.split(/[\n。；;]+/u) : [])
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 4);
}

function savedSectionType(
  sections: Array<{
    sectionType: ImportedResumeDraft["sections"][number]["sectionType"];
    items: Array<{ id: string }>;
  }>,
  candidateId: string
) {
  return sections.find((section) => section.items.some((item) => item.id === candidateId))?.sectionType;
}

function removeFailedIntakeFallback(
  draft: ImportedResumeDraft,
  input: { sessionId: string; messageId: string; turnId: string; sourceContentHash: string }
): ImportedResumeDraft {
  const sections = draft.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.conversationEvidence?.some((evidence) =>
        evidence.sessionId === input.sessionId
        && evidence.messageId === input.messageId
        && evidence.turnId === input.turnId
        && evidence.sourceContentHash === input.sourceContentHash
      ))
    }))
    .filter((section) => section.items.length);
  return ImportedResumeDraftSchema.parse({
    ...draft,
    sections,
    warnings: draft.warnings.filter((warning) => warning.code !== "provider_unavailable")
  });
}

function invalidateFinalSynthesis(draft: ImportedResumeDraft): ImportedResumeDraft {
  const sections = draft.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !item.id.startsWith("synth-"))
    }))
    .filter((section) => section.items.length);
  const session = draft.intakeSession;
  return ImportedResumeDraftSchema.parse({
    ...draft,
    sections,
    intakeSession: session
      ? {
          ...session,
          phase: "clarifying",
          finalSynthesis: undefined,
          finalSynthesisRevision: undefined,
          finalReviewCount: session.finalReviewCount
        }
      : undefined
  });
}

async function assertActiveProfileBinding(
  repository: WorkspaceRepository,
  input: { targetProfileId: string; acknowledgedActiveProfileId?: string }
) {
  const context = await repository.getActiveCareerContext();
  const activeProfileId = context?.profileId;
  if (
    activeProfileId
    && activeProfileId !== input.targetProfileId
    && input.acknowledgedActiveProfileId !== activeProfileId
  ) {
    throw toolError(
      "profile_intake_active_profile_changed",
      "当前活动资料库已变化，请确认这批经历要写入哪个资料库。"
    );
  }
}

function reconciliationToolResult(plan: ProfileReconciliationPlan) {
  return {
    importId: plan.importId,
    expectedDraftRevision: plan.draftRevision,
    expectedPlanRevision: plan.revision,
    profileId: plan.profileId,
    status: plan.status,
    summary: plan.summary,
    unresolved: plan.decisions
      .filter((decision) =>
        decision.requiresUserConfirmation
        && !plan.reviewUnits.find((unit) => unit.incomingItemId === decision.incomingItemId)?.resolved
      )
      .map((decision) => {
        const candidate = plan.candidates.find((item) => item.incomingItemId === decision.incomingItemId);
        return {
          incomingItemId: decision.incomingItemId,
          entityType: candidate?.entityType,
          label: candidate?.displayLabel,
          state: decision.state,
          fieldComparisons: decision.fieldComparisons,
          supportedResolutions: decision.state === "conflict"
            ? ["keep_existing", "use_imported", "keep_both_as_distinct", "edit_value", "defer"]
            : ["keep_existing", "use_imported", "keep_both_as_distinct", "defer"]
        };
      })
  };
}

function renameStructuredItem<T extends { sectionType: string } | undefined>(
  item: T,
  label: string
): T {
  if (!item) return item;
  if (item.sectionType === "education") {
    return { ...item, school: label } as T;
  }
  if (["project", "research", "publications", "patents", "portfolio", "other", "custom"].includes(item.sectionType)) {
    return { ...item, title: label } as T;
  }
  if (["awards", "certificates", "skills"].includes(item.sectionType)) {
    return { ...item, name: label } as T;
  }
  if (item.sectionType === "languages") return { ...item, language: label } as T;
  if (["work", "internship", "campus", "volunteer"].includes(item.sectionType)) {
    return { ...item, organization: label } as T;
  }
  if (item.sectionType === "summary") return { ...item, text: label } as T;
  return item;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw toolError("operation_cancelled", "Operation was cancelled.");
}

async function isCanonicalCareerAdaptJsonFile(file: File) {
  try {
    const adapted = adaptResumeJsonToV2(JSON.parse(await file.text()));
    return adapted.ok && adapted.sourceKind === "v2";
  } catch {
    return false;
  }
}

function toolError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function keywordCoverage(text: string, keywords: string[]) {
  if (!keywords.length) return 0;
  const matches = keywords.filter((keyword) => text.includes(keyword.toLowerCase())).length;
  return Math.round((matches / keywords.length) * 1000) / 1000;
}

function recencyScore(updatedAt: string) {
  const ageDays = Math.max(0, (Date.now() - new Date(updatedAt).getTime()) / 86_400_000);
  return Math.round(Math.max(0, 1 - ageDays / 730) * 1000) / 1000;
}
