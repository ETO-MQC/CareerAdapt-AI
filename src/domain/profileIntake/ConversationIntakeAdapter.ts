import { ImportedResumeDraftSchema, type ImportedResumeDraft } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { ProfileIntakeNormalizer, profileIntakeDisplayLabel } from "./ProfileIntakeNormalizer";
import type { ProfileIntakeInterviewPlan } from "./ProfileIntakeCompleteness";
import type {
  ProfileIntakeSemanticResult,
  VerifiedProfileIntakeCandidate
} from "./ProfileIntakeSemanticService";

export type ConversationIntakeCandidate = {
  id: string;
  sectionType: VerifiedProfileIntakeCandidate["normalization"]["sectionType"];
  kind: "education" | "work" | "internship" | "project" | "award" | "research" | "campus" | "volunteer" | "other";
  label: string;
  sourceQuote: string;
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
      sourceBlockIds: [],
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
    createdAt: input.capturedAt,
    updatedAt: input.capturedAt
  });
  return {
    draft,
    candidates,
    artifact: buildConversationIntakeArtifact(draft, semanticResult.followUpQuestion)
  };
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
    updatedAt: addition.updatedAt
  });
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
