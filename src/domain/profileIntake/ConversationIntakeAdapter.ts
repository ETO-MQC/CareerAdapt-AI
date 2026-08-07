import { ImportedResumeDraftSchema, type ImportedResumeDraft } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import {
  applyProfileIntakeStructuredPatch,
  ProfileIntakeNormalizer,
  profileIntakeCareerReadyText,
  profileIntakeDisplayLabel,
  validateProfileIntakeStructuredPatch,
  type ProfileIntakeStructuredPatch
} from "./ProfileIntakeNormalizer";
import type { ProfileIntakeInterviewPlan } from "./ProfileIntakeCompleteness";
import type {
  ProfileIntakeSemanticResult,
  VerifiedProfileIntakeCandidate
} from "./ProfileIntakeSemanticService";
import {
  ProfileIntakeReviewProjectionSchema,
  profileIntakeReviewProgress,
  type ProfileIntakeReviewProjection
} from "./ProfileIntakeReviewProjection";

export type ConversationIntakeCandidate = {
  id: string;
  sectionType: VerifiedProfileIntakeCandidate["normalization"]["sectionType"];
  kind: "education" | "work" | "internship" | "project" | "award" | "research" | "campus" | "volunteer" | "other";
  label: string;
  sourceQuote: string;
  sourceBlockIds?: string[];
  needsConfirmation: boolean;
  reason?: string;
  status: "confirmed" | "ai_review" | "insufficient";
  decision?: "accept" | "reject";
  professionalDescription: string;
};

export type ConversationIntakeArtifact = {
  title: "经历核对";
  followUpQuestion?: string;
  interviewPlan?: ProfileIntakeInterviewPlan;
  candidates: Array<{
    id: string;
    sectionType: ConversationIntakeCandidate["sectionType"];
    label: string;
    sourceQuote: string;
    time?: string;
    organization?: string;
    role?: string;
    professionalDescription: string;
    highlights: string[];
    toolsOrMethods: string[];
    outcomes: string[];
    sources: string[];
    status: "confirmed" | "ai_review" | "insufficient" | "duplicate" | "conflict";
    confidence: number;
    reason?: string;
    needsNormalization: boolean;
    canAccept: boolean;
    structuredItem?: unknown;
    decision?: "accept" | "reject";
    fieldEvidence?: Array<{ field: string; sourceQuote: string; support: string; confidence: number; needsConfirmation: boolean }>;
  }>;
  recognized: Array<{ id: string; label: string }>;
  needsConfirmation: Array<{ id: string; label: string; reason: string }>;
  duplicates: Array<{ id: string; label: string }>;
  additions: Array<{ id: string; label: string }>;
  sources: Array<{
    sessionId: string;
    messageId: string;
    turnId: string;
    sourceContentHash: string;
    capturedAt: string;
  }>;
};

export function adaptConversationMessageToIntakeDraft(input: {
  sessionId: string;
  messageId: string;
  turnId: string;
  text: string;
  capturedAt: string;
  sourceContentHash?: string;
  importId?: string;
  semanticResult?: ProfileIntakeSemanticResult;
}): {
  draft: ImportedResumeDraft;
  candidates: ConversationIntakeCandidate[];
  artifact: ConversationIntakeArtifact;
  reviewProjection: ProfileIntakeReviewProjection;
} {
  const text = input.text.trim();
  if (!text) throw new Error("profile_intake_source_empty");
  const sourceContentHash = input.sourceContentHash ?? stableHashText(text);
  const shortHash = stableHashText(`${input.sessionId}:${input.messageId}:${text}`);
  const hash = `${shortHash}${stableHashText(`${text}:${input.turnId}`)}`;
  const importId = input.importId ?? `conversation-intake-${hash.slice(0, 20)}`;
  const normalizer = new ProfileIntakeNormalizer();
  const semanticResult = input.semanticResult ?? {
    mode: "deterministic" as const,
    providerStatus: "failed" as const,
    extractionStatus: "failed" as const,
    quarantinedCandidateCount: 0,
    warning: "AI 语义整理尚未执行；已保留原始回答。",
    candidates: [{
      id: `intake-${hash.slice(0, 16)}-fallback`,
      label: "待整理经历",
      sourceQuote: text,
      normalization: normalizer.fallback(text)
    }]
  };
  const candidates: ConversationIntakeCandidate[] = semanticResult.candidates.map((candidate) => {
    const label = candidate.normalization.needsNormalization
      ? candidate.label
      : candidate.normalization.structuredItem
        ? profileIntakeDisplayLabel(candidate.normalization.structuredItem, candidate.label)
      : candidate.label;
    return {
      id: candidate.id,
      sectionType: candidate.normalization.sectionType,
      kind: candidateKind(candidate.normalization.sectionType),
      label,
      sourceQuote: candidate.sourceQuote,
      ...(candidate.sourceBlockIds ? { sourceBlockIds: candidate.sourceBlockIds } : {}),
      needsConfirmation: candidate.normalization.needsConfirmation,
      reason: candidate.normalization.needsNormalization
        ? "AI 语义整理暂不可用，原始回答已保留，请重试或手动核对"
        : candidate.normalization.needsConfirmation
          ? "AI 已整理，但有信息需要确认"
          : undefined,
      status: candidate.normalization.needsNormalization
        ? "insufficient"
        : candidate.normalization.needsConfirmation ? "ai_review" : "confirmed",
      decision: undefined,
      professionalDescription: candidate.normalization.normalizedText
    };
  });
  const sections = candidates.map((candidate, order) => {
    const normalized = semanticResult.candidates[order].normalization;
    return {
    id: `section-${candidate.id}`,
    sectionType: candidate.sectionType,
    category: candidateCategory(candidate.sectionType),
    detectedTitle: candidate.label,
    // Candidate review is deliberately separate from Profile persistence.
    included: false,
    order,
    confidence: candidate.needsConfirmation ? "low" as const : "high" as const,
    items: [{
      id: candidate.id,
      rawText: candidate.sourceQuote,
      normalizedText: normalized.normalizedText,
      included: false,
      order: 0,
      pageRefs: [{ pageNumber: 1, quote: candidate.sourceQuote }],
      confidence: candidate.needsConfirmation ? "low" as const : "high" as const,
      sourceStatus: candidate.needsConfirmation ? "ambiguous" as const : "user_confirmed_modified" as const,
      userEdited: false,
      sourceBlockIds: candidate.sourceBlockIds ?? [],
      itemLabel: candidate.label,
      structuredItem: normalized.structuredItem,
      structuredMappingTrace: [],
      sourceQuote: candidate.sourceQuote,
      conversationEvidence: [{
        sessionId: input.sessionId,
        messageId: input.messageId,
        turnId: input.turnId,
        sourceContentHash,
        capturedAt: input.capturedAt,
        sourceQuote: candidate.sourceQuote,
        supportedFields: normalized.fieldEvidence.map((item) => item.field)
      }],
      careerNormalization: {
        version: "profile-intake-normalization-v1" as const,
        mode: semanticResult.mode,
        needsNormalization: normalized.needsNormalization,
        deterministicDatePatch: normalized.deterministicDatePatch,
        fieldEvidence: normalized.fieldEvidence
      }
    }]
  };
  });
  const draft = ImportedResumeDraftSchema.parse({
    id: importId,
    schemaVersion: "resume-import-v1",
    importId,
    revision: 0,
    status: "reviewing",
    source: {
      sourceSessionId: input.sessionId,
      sourceMessageId: input.messageId,
      sourceTurnId: input.turnId,
      capturedAt: input.capturedAt,
      fileName: `conversation-${input.messageId}.txt`,
      mimeType: "application/x-careeradapt-conversation",
      fileHash: hash,
      sourceContentHash,
      normalizedTextHash: stableHashText(text),
      pageCount: 1,
      extractedAt: input.capturedAt
    },
    sourceKind: "conversation",
    sourceBlocks: [],
    basics: { links: [] },
    sections,
    pages: [{
      pageNumber: 1,
      rawText: text,
      normalizedText: text,
      charStart: 0,
      charEnd: text.length
    }],
    unclassifiedBlocks: [],
    warnings: [
      ...(semanticResult.warning ? [{
        code: "provider_unavailable" as const,
        message: semanticResult.warning,
        pageNumber: 1
      }] : []),
      ...candidates.filter((candidate) => candidate.needsConfirmation).map((candidate) => ({
      code: "ambiguous_field",
      message: candidate.reason ?? `${candidate.label} 需要确认`,
      pageNumber: 1,
      itemId: candidate.id,
      sectionId: `section-${candidate.id}`
      }))
    ],
    parserVersion: "conversation-intake.v1",
    intakeSession: {
      sessionId: input.sessionId,
      autosavedAt: input.capturedAt,
      reviewedCandidateIds: [],
      resumeToken: stableHashText(`${importId}:${input.messageId}:${sourceContentHash}`),
      lastSourceMessageId: input.messageId,
      lastSourceTurnId: input.turnId,
      providerStatus: semanticResult.providerStatus,
      extractionStatus: extractionStatusForSemanticResult(semanticResult, candidates),
      quarantinedCandidateCount: semanticResult.quarantinedCandidateCount ?? 0,
      latestSourceTurnDiagnostics: toProjectionDiagnostics(
        semanticResult.safeDiagnostics,
        extractionStatusForSemanticResult(semanticResult, candidates),
        candidates.length,
        semanticResult.quarantinedCandidateCount ?? 0
      )
    },
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt
  });
  const reviewProjection = buildConversationIntakeReviewProjection({
    importId,
    draftRevision: 0,
    sourceMessageId: input.messageId,
    sourceTurnId: input.turnId,
    sourceContentHash,
    text,
    semanticResult
  });
  return {
    draft,
    candidates,
    artifact: buildConversationIntakeArtifact(draft, semanticResult.followUpQuestion),
    reviewProjection
  };
}

export function buildConversationIntakeReviewProjection(input: {
  importId: string;
  draftRevision: number;
  sourceMessageId: string;
  sourceTurnId: string;
  sourceContentHash: string;
  text: string;
  semanticResult: ProfileIntakeSemanticResult;
}): ProfileIntakeReviewProjection {
  const candidates = input.semanticResult.candidates.flatMap((candidate) => {
        if (!candidate.normalization.structuredItem || candidate.normalization.needsNormalization) return [];
        const sourceStart = candidate.sourceSpan?.start ?? Math.max(0, input.text.indexOf(candidate.sourceQuote));
        const sourceSpan = candidate.sourceSpan ?? { start: sourceStart, end: sourceStart + candidate.sourceQuote.length };
        const status = candidate.normalization.needsConfirmation ? "uncertain" as const : "proposed" as const;
        return [{
          id: candidate.id,
          ...(candidate.candidateKey ? { candidateKey: candidate.candidateKey } : {}),
          sectionType: candidate.normalization.sectionType,
          sourceSpan,
          sourceQuote: candidate.sourceQuote,
          structuredItem: candidate.normalization.structuredItem,
          professionalText: candidate.professionalText ?? candidate.normalization.normalizedText,
          uncertainFields: candidate.uncertainFields ?? [],
          confidence: candidate.normalization.confidence,
          needsConfirmation: candidate.normalization.needsConfirmation,
          status,
          sourceBadge: candidate.normalization.needsConfirmation
            ? "needs_confirmation" as const
            : input.semanticResult.mode === "ai" ? "ai" as const : "local" as const,
          canAccept: true,
          ...(candidate.normalization.needsConfirmation ? { reason: "有字段需要你确认" } : {}),
          fieldEvidence: candidate.normalization.fieldEvidence
        }];
      });
  const isFailed = candidates.length === 0;
  const projectionCandidates = isFailed
    ? [{
        id: input.semanticResult.candidates[0]?.id ?? `intake-failed-${stableHashText(input.text).slice(0, 16)}`,
        candidateKey: "failed-extraction",
        sectionType: "other" as const,
        sourceSpan: { start: 0, end: input.text.length },
        sourceQuote: input.text,
        professionalText: "原始回答已保留，等待重新整理。",
        uncertainFields: ["structuredItem"],
        confidence: 0,
        needsConfirmation: true,
        status: "failed" as const,
        sourceBadge: input.semanticResult.mode === "ai" ? "needs_confirmation" as const : "local" as const,
        canAccept: false,
        reason: "这段内容没有完成结构化，但原文已经保留。",
        fieldEvidence: []
      }]
    : candidates;
  const followUpQuestions = (input.semanticResult.followUpQuestions?.length
    ? input.semanticResult.followUpQuestions
    : input.semanticResult.followUpQuestion
      ? [input.semanticResult.followUpQuestion]
      : []).slice(0, 3);
  const reviewProgress = profileIntakeReviewProgress(projectionCandidates);
  const extractionStatus = isFailed
    ? "failed"
    : input.semanticResult.providerStatus === "available"
      ? input.semanticResult.extractionStatus === "partial" || reviewProgress.uncertain > 0
        ? "partial"
        : "structured_ai"
      : "structured_local";
  return ProfileIntakeReviewProjectionSchema.parse({
    importId: input.importId,
    draftRevision: input.draftRevision,
    sourceMessageId: input.sourceMessageId,
    sourceTurnId: input.sourceTurnId,
    sourceContentHash: input.sourceContentHash,
    providerStatus: input.semanticResult.providerStatus,
    extractionStatus,
    candidates: projectionCandidates,
    reviewProgress,
    safeDiagnostics: toProjectionDiagnostics(
      input.semanticResult.safeDiagnostics,
      extractionStatus,
      projectionCandidates.length,
      input.semanticResult.quarantinedCandidateCount ?? 0
    ),
    followUpQuestions,
    ...(followUpQuestions[0] ? { followUpQuestion: followUpQuestions[0] } : {}),
    ...(isFailed ? {
      failedExtraction: {
        code: input.semanticResult.warning?.match(/（([^）]+)）/u)?.[1] ?? "profile_intake_extraction_failed",
        message: "这段内容没有完成结构化，但原文已经保留。",
        actions: ["retry", "manual", "preserve"] as const
      }
    } : {})
  });
}

export function buildConversationIntakeReviewProjectionFromDraft(
  draft: ImportedResumeDraft,
  followUpQuestions: string[] = []
): ProfileIntakeReviewProjection {
  const rawText = draft.pages[0]?.rawText ?? "";
  const sourceMessageId = draft.intakeSession?.lastSourceMessageId
    ?? draft.source.sourceMessageId
    ?? `draft-${draft.importId}`;
  const sourceTurnId = draft.intakeSession?.lastSourceTurnId
    ?? draft.source.sourceTurnId
    ?? `draft-${draft.importId}`;
  const sourceContentHash = draft.source.sourceContentHash ?? stableHashText(rawText);
  const finalAssets = draft.intakeSession?.finalSynthesis?.assets ?? [];
  const finalItemIds = new Set(finalAssets.map((asset) => asset.candidateId));
  const items = finalAssets.length
    ? draft.sections.flatMap((section) => section.items.filter((item) => finalItemIds.has(item.id)))
    : draft.sections.flatMap((section) => section.items);
  const candidatesFromItems = items.flatMap((item) => {
        if (!item.structuredItem || item.careerNormalization?.needsNormalization) return [];
        const sourceQuote = item.sourceQuote ?? item.rawText;
        const start = Math.max(0, rawText.indexOf(sourceQuote));
        const normalization = item.careerNormalization;
        const status = item.userConfirmed === true
          ? "accepted" as const
          : item.userConfirmed === false
            ? "ignored" as const
            : normalization?.fieldEvidence.some((entry) => entry.needsConfirmation) || item.sourceStatus === "ambiguous"
              ? "uncertain" as const
              : "proposed" as const;
        return [{
          id: item.id,
          sectionType: item.structuredItem.sectionType,
          sourceSpan: { start, end: start + sourceQuote.length },
          sourceQuote,
          structuredItem: item.structuredItem,
          professionalText: item.normalizedText,
          uncertainFields: normalization?.fieldEvidence.filter((entry) => entry.needsConfirmation).map((entry) => entry.field) ?? [],
          confidence: item.confidence === "high" ? 0.9 : item.confidence === "medium" ? 0.75 : 0.58,
          needsConfirmation: status === "uncertain" || status === "proposed",
          status,
          sourceBadge: status === "uncertain"
            ? "needs_confirmation" as const
            : item.careerNormalization?.mode === "ai" ? "ai" as const : "local" as const,
          ...(item.userConfirmed === true ? { decision: "accept" as const } : item.userConfirmed === false ? { decision: "reject" as const } : {}),
          canAccept: true,
          ...(status === "uncertain" ? { reason: "有字段需要你确认" } : {}),
           fieldEvidence: normalization?.fieldEvidence ?? []
         }];
       });
  const failedItems = items.filter((item) =>
    item.careerNormalization?.needsNormalization
    && item.conversationEvidence?.some((evidence) => evidence.turnId === sourceTurnId)
  );
  const failedCandidates = failedItems.map((item) => {
    const sourceQuote = item.sourceQuote ?? item.rawText;
    const start = Math.max(0, rawText.indexOf(sourceQuote));
    return {
      id: item.id,
      candidateKey: "failed-extraction",
      sectionType: "other" as const,
      sourceSpan: { start, end: start + sourceQuote.length },
      sourceQuote,
      professionalText: "原始回答已保留，等待重新整理。",
      uncertainFields: ["structuredItem"],
      confidence: 0,
      needsConfirmation: true,
      status: "failed" as const,
      sourceBadge: "local" as const,
      canAccept: false,
      reason: "这段内容没有完成安全归属，但原文已经保留。",
      fieldEvidence: []
    };
  });
  const failed = candidatesFromItems.length === 0 || failedCandidates.length > 0;
  const candidates = failed
    ? [
        ...candidatesFromItems,
        ...(failedCandidates.length ? failedCandidates : [{
          id: `intake-failed-${stableHashText(rawText).slice(0, 16)}`,
          candidateKey: "failed-extraction",
          sectionType: "other" as const,
          sourceSpan: { start: 0, end: rawText.length },
          sourceQuote: rawText,
          professionalText: "原始回答已保留，等待重新整理。",
          uncertainFields: ["structuredItem"],
          confidence: 0,
          needsConfirmation: true,
          status: "failed" as const,
          sourceBadge: "local" as const,
          canAccept: false,
          reason: "这段内容没有完成结构化，但原文已经保留。",
          fieldEvidence: []
        }])
      ]
    : candidatesFromItems;
  const questions = followUpQuestions.slice(0, 3);
  const reviewProgress = profileIntakeReviewProgress(candidates);
  return ProfileIntakeReviewProjectionSchema.parse({
    importId: draft.importId,
    draftRevision: draft.revision,
    phase: draft.intakeSession?.phase ?? "collecting",
    ...(draft.intakeSession?.finalSynthesis ? { finalSynthesis: draft.intakeSession.finalSynthesis } : {}),
    sourceMessageId,
    sourceTurnId,
    sourceContentHash,
    providerStatus: draft.intakeSession?.providerStatus ?? "available",
    extractionStatus: finalAssets.length > 0 ? "structured_local" : failed
      ? "failed"
      : draft.intakeSession?.latestSourceTurnDiagnostics?.extractionStatus === "structured_local"
        ? "structured_local"
        : draft.intakeSession?.latestSourceTurnDiagnostics?.extractionStatus === "failed"
          ? "failed"
          : reviewProgress.uncertain > 0
            || draft.intakeSession?.latestSourceTurnDiagnostics?.extractionStatus === "partial"
            || draft.intakeSession?.extractionStatus === "partial"
          ? "partial"
          : "structured_ai",
    candidates,
    reviewProgress,
    ...(draft.intakeSession?.finalSynthesisRevision !== undefined && finalAssets.length > 0
      ? { finalReviewRevision: draft.intakeSession.finalSynthesisRevision }
      : {}),
    safeDiagnostics: draft.intakeSession?.latestSourceTurnDiagnostics,
    followUpQuestions: questions,
    ...(questions[0] ? { followUpQuestion: questions[0] } : {}),
    ...(failed ? {
      failedExtraction: {
        code: "profile_intake_extraction_failed",
        message: "这段内容没有完成结构化，但原文已经保留。",
        actions: ["retry", "manual", "preserve"] as const
      }
    } : {})
  });
}

export function buildConversationIntakeArtifact(
  draft: ImportedResumeDraft,
  followUpQuestion?: string,
  interviewPlan?: ProfileIntakeInterviewPlan
): ConversationIntakeArtifact {
  const entries = draft.sections.flatMap((section) => section.items.map((item) => {
    const structuredItem = item.structuredItem;
    const needsNormalization = item.careerNormalization?.needsNormalization === true;
    const status = needsNormalization
      ? "insufficient" as const
      : item.sourceStatus === "ambiguous"
        ? "ai_review" as const
        : item.included ? "confirmed" as const : "ai_review" as const;
    const label = item.careerNormalization?.needsNormalization
      ? item.itemLabel ?? section.detectedTitle
      : structuredItem
        ? profileIntakeDisplayLabel(structuredItem, item.itemLabel ?? section.detectedTitle)
      : item.itemLabel ?? section.detectedTitle;
    const candidate: ConversationIntakeArtifact["candidates"][number] = structuredItem
      ? artifactCandidate({
          id: item.id,
          sectionType: structuredItem.sectionType,
          kind: candidateKind(structuredItem.sectionType),
          label,
          sourceQuote: item.sourceQuote ?? item.rawText,
          needsConfirmation: status !== "confirmed",
          reason: needsNormalization
            ? "AI 语义整理暂不可用，原始回答已保留，请重试或手动核对"
            : status === "ai_review" ? "AI 已整理，但有信息需要确认" : undefined,
          status,
          decision: item.userConfirmed === true ? "accept" : item.userConfirmed === false ? "reject" : undefined,
          professionalDescription: item.normalizedText
        }, {
          sectionType: structuredItem.sectionType,
          normalizedText: item.normalizedText,
          structuredItem,
          confidence: section.confidence === "high" ? 0.9 : 0.68,
          needsConfirmation: status !== "confirmed",
          needsNormalization,
          deterministicDatePatch: item.careerNormalization?.deterministicDatePatch,
          fieldEvidence: item.careerNormalization?.fieldEvidence ?? []
        })
      : {
          id: item.id,
          sectionType: conversationSectionType(section.sectionType),
          label,
          sourceQuote: item.sourceQuote ?? item.rawText,
          professionalDescription: item.normalizedText,
          highlights: [],
          toolsOrMethods: [],
          outcomes: [],
          sources: [item.sourceQuote ?? item.rawText],
          status,
          confidence: 0.5,
          needsNormalization,
          decision: item.userConfirmed === true ? "accept" : item.userConfirmed === false ? "reject" : undefined,
          canAccept: false
        };
    const fallbackDates = item.careerNormalization?.deterministicDatePatch;
    if (!candidate.time && fallbackDates) {
      candidate.time = fallbackDates.awardedAt ?? (
        [fallbackDates.startDate, fallbackDates.current ? "至今" : fallbackDates.endDate]
          .filter(Boolean)
          .join(" — ") || undefined
      );
    }
    return { item, candidate };
  }));
  const candidates = entries.map((entry) => entry.candidate);
  const recognized = candidates
    .filter((candidate) => candidate.status === "confirmed")
    .map(({ id, label }) => ({ id, label }));
  const needsConfirmation = candidates
    .filter((candidate) => candidate.status === "ai_review" || candidate.status === "insufficient")
    .map(({ id, label, reason }) => ({
      id,
      label,
      reason: reason ?? "名称或表述需要确认"
    }));
  const sources = entries.flatMap(({ item }) => item.conversationEvidence ?? [])
    .map(({ sessionId, messageId, turnId, sourceContentHash, capturedAt }) => ({
      sessionId,
      messageId,
      turnId,
      sourceContentHash: sourceContentHash ?? stableHashText(`${sessionId}:${messageId}:${turnId}`),
      capturedAt
    }))
    .filter((source, index, all) =>
      all.findIndex((candidate) =>
        candidate.sessionId === source.sessionId
        && candidate.messageId === source.messageId
        && candidate.turnId === source.turnId
      ) === index
    );
  return {
    title: "经历核对",
    followUpQuestion,
    interviewPlan,
    candidates,
    recognized,
    needsConfirmation,
    duplicates: [],
    additions: candidates.map(({ id, label }) => ({ id, label })),
    sources
  };
}

export function mergeConversationIntakeDraft(
  existing: ImportedResumeDraft,
  addition: ImportedResumeDraft
): ImportedResumeDraft {
  if (existing.sourceKind !== "conversation" || addition.sourceKind !== "conversation") {
    throw new Error("profile_intake_merge_requires_conversation_drafts");
  }
  const existingIds = new Set(existing.sections.flatMap((section) => section.items.map((item) => item.id)));
  const additions = addition.sections
    .map((section) => ({
      ...section,
      order: existing.sections.length + section.order,
      items: section.items.filter((item) => !existingIds.has(item.id))
    }))
    .filter((section) => section.items.length);
  const rawText = [existing.pages[0]?.rawText, addition.pages[0]?.rawText].filter(Boolean).join("\n");
  const intakeSession = existing.intakeSession || addition.intakeSession
    ? {
        ...(existing.intakeSession ?? addition.intakeSession),
        ...(addition.intakeSession ?? {}),
        reviewedCandidateIds: [...new Set([
          ...(existing.intakeSession?.reviewedCandidateIds ?? []),
          ...(addition.intakeSession?.reviewedCandidateIds ?? [])
        ])]
      }
    : undefined;
  return ImportedResumeDraftSchema.parse({
    ...existing,
    sections: [...existing.sections, ...additions],
    pages: [{
      pageNumber: 1,
      rawText,
      normalizedText: rawText,
      charStart: 0,
      charEnd: rawText.length
    }],
    warnings: [...existing.warnings, ...addition.warnings],
    ...(intakeSession ? { intakeSession } : {}),
    updatedAt: addition.updatedAt
  });
}

/**
 * Follow-up answers are scoped to one already-proposed item.  The semantic
 * pass may return a complete canonical item for convenience, but only changed
 * fields with evidence in the current answer are allowed to cross this
 * boundary.  No new section or candidate is created here.
 */
export function patchConversationIntakeCandidate(input: {
  existing: ImportedResumeDraft;
  candidateId: string;
  sessionId: string;
  messageId: string;
  turnId: string;
  text: string;
  capturedAt: string;
  sourceContentHash?: string;
  semanticResult: ProfileIntakeSemanticResult;
}): ImportedResumeDraft {
  if (input.existing.sourceKind !== "conversation") {
    throw new Error("profile_intake_patch_requires_conversation_draft");
  }
  const semanticCandidate = input.semanticResult.candidates.find((candidate) => candidate.normalization.structuredItem);
  if (!semanticCandidate?.normalization.structuredItem) {
    throw new Error("profile_intake_follow_up_patch_unstructured");
  }
  let found = false;
  const sourceContentHash = input.sourceContentHash ?? stableHashText(input.text.trim());
  const sections = input.existing.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.id !== input.candidateId) return item;
      found = true;
      if (!item.structuredItem) throw new Error("profile_intake_follow_up_target_unstructured");
      if (item.structuredItem.sectionType !== semanticCandidate.normalization.structuredItem!.sectionType) {
        throw new Error("profile_intake_follow_up_section_mismatch");
      }
      const patch = diffStructuredItems(item.structuredItem, semanticCandidate.normalization.structuredItem!);
      const supportedFields = semanticCandidate.normalization.fieldEvidence.map((entry) => entry.field);
      const patchResult = Object.keys(patch).length
        ? validateProfileIntakeStructuredPatch({
            item: item.structuredItem,
            rawPatch: patch,
            evidenceSources: [{ sourceQuote: input.text, supportedFields }]
          })
        : undefined;
      const structuredItem = patchResult
        ? applyProfileIntakeStructuredPatch(item.structuredItem, patchResult.patch)
        : item.structuredItem;
      const evidence = {
        sessionId: input.sessionId,
        messageId: input.messageId,
        turnId: input.turnId,
        sourceContentHash,
        capturedAt: input.capturedAt,
        sourceQuote: input.text,
        supportedFields: patchResult?.fieldEvidence.map((entry) => entry.field) ?? supportedFields
      };
      const priorNormalization = item.careerNormalization;
      const nextFieldEvidence = [
        ...(priorNormalization?.fieldEvidence ?? []),
        ...(patchResult?.fieldEvidence ?? semanticCandidate.normalization.fieldEvidence)
      ].filter((entry, index, all) => all.findIndex((candidate) =>
        candidate.field === entry.field
        && candidate.sourceQuote === entry.sourceQuote
      ) === index);
      return {
        ...item,
        rawText: [item.rawText, input.text].filter(Boolean).join("\n"),
        normalizedText: profileIntakeCareerReadyText(structuredItem),
        sourceQuote: item.sourceQuote ?? item.rawText,
        conversationEvidence: [...(item.conversationEvidence ?? []), evidence],
        careerNormalization: {
          version: "profile-intake-normalization-v1" as const,
          mode: semanticCandidate.normalization.fieldEvidence.length ? "ai" as const : priorNormalization?.mode ?? "deterministic" as const,
          needsNormalization: priorNormalization?.needsNormalization ?? semanticCandidate.normalization.needsNormalization,
          deterministicDatePatch: semanticCandidate.normalization.deterministicDatePatch,
          fieldEvidence: nextFieldEvidence
        },
        structuredItem
      };
    })
  }));
  if (!found) throw new Error("profile_intake_follow_up_candidate_missing");
  const rawText = [input.existing.pages[0]?.rawText, input.text].filter(Boolean).join("\n");
  const priorSession = input.existing.intakeSession;
  return ImportedResumeDraftSchema.parse({
    ...input.existing,
    sections,
    pages: [{
      pageNumber: 1,
      rawText,
      normalizedText: rawText,
      charStart: 0,
      charEnd: rawText.length
    }],
    source: {
      ...input.existing.source,
      sourceMessageId: input.messageId,
      sourceTurnId: input.turnId,
      capturedAt: input.capturedAt,
      sourceContentHash,
      normalizedTextHash: stableHashText(rawText)
    },
    intakeSession: priorSession ? {
      ...priorSession,
      lastSourceMessageId: input.messageId,
      lastSourceTurnId: input.turnId,
      autosavedAt: input.capturedAt
    } : undefined,
    updatedAt: input.capturedAt
  });
}

function diffStructuredItems(current: ImportedResumeDraft["sections"][number]["items"][number]["structuredItem"], proposed: NonNullable<typeof current>) {
  if (!current) return {} as ProfileIntakeStructuredPatch;
  const patch: Record<string, unknown> = {};
  const currentRecord = current as unknown as Record<string, unknown>;
  const proposedRecord = proposed as unknown as Record<string, unknown>;
  for (const [field, value] of Object.entries(proposedRecord)) {
    if (["id", "sectionType", "customFields"].includes(field) || value === undefined) continue;
    if (JSON.stringify(currentRecord[field]) !== JSON.stringify(value)) patch[field] = value;
  }
  return patch as ProfileIntakeStructuredPatch;
}

function extractionStatusForSemanticResult(
  semanticResult: ProfileIntakeSemanticResult,
  candidates: ConversationIntakeCandidate[]
) {
  if (!candidates.length || candidates.every((candidate) => candidate.status === "insufficient")) return "failed" as const;
  if (semanticResult.providerStatus !== "available") return "structured_local" as const;
  if (semanticResult.extractionStatus === "partial" || candidates.some((candidate) => candidate.needsConfirmation)) {
    return "partial" as const;
  }
  return "structured_ai" as const;
}

function toProjectionDiagnostics(
  diagnostics: ProfileIntakeSemanticResult["safeDiagnostics"],
  extractionStatus: ProfileIntakeReviewProjection["extractionStatus"],
  candidateCount: number,
  quarantinedCount: number
) {
  return {
    ...(diagnostics?.provider ? { provider: diagnostics.provider } : {}),
    ...(diagnostics?.model ? { model: diagnostics.model } : {}),
    ...(diagnostics?.attempt !== undefined ? { attempt: diagnostics.attempt } : {}),
    ...(diagnostics?.latencyMs !== undefined ? { latencyMs: diagnostics.latencyMs } : {}),
    processingStatus: extractionStatus === "failed" ? "failed" as const : extractionStatus === "partial" ? "partial" as const : "structured" as const,
    extractionStatus: extractionStatus === "structured" ? "structured_ai" as const : extractionStatus,
    ...(diagnostics?.safeErrorCode || diagnostics?.code
      ? { safeErrorCode: diagnostics.safeErrorCode ?? diagnostics.code }
      : {}),
    candidateCount: diagnostics?.candidateCount ?? candidateCount,
    quarantinedCount: diagnostics?.quarantinedCount ?? quarantinedCount,
    quarantinedErrorCodes: diagnostics?.quarantinedErrorCodes ?? [],
    ...(diagnostics?.operationId ? { operationId: diagnostics.operationId } : {})
  };
}

function candidateCategory(sectionType: ConversationIntakeCandidate["sectionType"]) {
  const category = {
    summary: "summary",
    education: "education",
    work: "work",
    internship: "work",
    project: "project",
    research: "custom",
    campus: "campus",
    volunteer: "custom",
    awards: "award",
    skills: "skill",
    certificates: "certificate",
    languages: "language",
    publications: "custom",
    patents: "custom",
    portfolio: "custom",
    other: "custom",
    custom: "custom"
  } as const;
  return category[sectionType];
}

function candidateKind(sectionType: ConversationIntakeCandidate["sectionType"]): ConversationIntakeCandidate["kind"] {
  if (sectionType === "awards") return "award";
  if (["education", "work", "internship", "project", "research", "campus", "volunteer"].includes(sectionType)) {
    return sectionType as ConversationIntakeCandidate["kind"];
  }
  return "other";
}

function artifactCandidate(
  candidate: ConversationIntakeCandidate,
  normalized: VerifiedProfileIntakeCandidate["normalization"]
): ConversationIntakeArtifact["candidates"][number] {
  const item = normalized.structuredItem;
  if (!item) throw new Error("profile_intake_artifact_item_missing");
  const date = item.sectionType === "awards"
    ? item.awardedAt
    : "startDate" in item
      ? [item.startDate, item.current ? "至今" : item.endDate].filter(Boolean).join(" — ")
      : undefined;
  const organization = "organization" in item ? item.organization
    : "institution" in item ? item.institution
      : item.sectionType === "education" ? item.school
        : "issuer" in item ? item.issuer : undefined;
  const role = "role" in item ? item.role
    : "authorRole" in item ? item.authorRole
      : item.sectionType === "education" ? item.major : undefined;
  return {
    id: candidate.id,
    sectionType: candidate.sectionType,
    label: normalized.needsNormalization ? candidate.label : profileIntakeDisplayLabel(item, candidate.label),
    sourceQuote: candidate.sourceQuote,
    time: date,
    organization,
    role,
    professionalDescription: normalized.normalizedText,
    highlights: "highlights" in item ? item.highlights : [],
    toolsOrMethods: "tools" in item ? item.tools : "methods" in item ? item.methods : [],
    outcomes: "outcomes" in item ? item.outcomes : [],
    sources: [...new Set(normalized.fieldEvidence.map((entry) => entry.sourceQuote))],
    status: candidate.status,
    confidence: normalized.confidence,
    reason: candidate.reason,
    needsNormalization: normalized.needsNormalization,
    canAccept: Boolean(normalized.structuredItem) && !normalized.needsNormalization,
    structuredItem: item,
    decision: candidate.decision,
    fieldEvidence: normalized.fieldEvidence
  };
}

function conversationSectionType(
  value: ImportedResumeDraft["sections"][number]["sectionType"]
): ConversationIntakeCandidate["sectionType"] {
  return value === "basics" || value === "experience" || value === "unknown"
    ? "other"
    : value;
}
