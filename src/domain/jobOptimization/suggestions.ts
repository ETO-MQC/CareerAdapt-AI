import { nanoid } from "nanoid";
import {
  AiSuggestionSchema,
  type AiSuggestion,
  type AiSuggestionType,
  type BranchContentItem,
  type FactGuardResult,
  type JobDescription,
  type MatchEvidenceRef,
  type RequirementBlockMatch,
  type ResumeBlockSuggestionKind,
  type ResumeBranch
} from "@/domain/schemas";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { stableHashText } from "@/services/security/text";

export function mapSuggestionKindToAiType(kind: ResumeBlockSuggestionKind): AiSuggestionType {
  if (kind === "compress") {
    return "compress";
  }
  if (kind === "prioritize") {
    return "prioritize";
  }
  if (kind === "remove_irrelevant") {
    return "remove_irrelevant";
  }
  if (kind === "hide") {
    return "hide";
  }
  if (kind === "show") {
    return "show";
  }
  if (kind === "reorder") {
    return "reorder";
  }
  return "rewrite";
}

export function isTextSuggestionType(type: AiSuggestionType) {
  return type === "rewrite"
    || type === "compress"
    || type === "prioritize"
    || type === "remove_irrelevant"
    || type === "remove_or_shorten";
}

export function createBlockSuggestion(input: {
  draftId: string;
  branch: ResumeBranch;
  contentItem: BranchContentItem;
  requirementIds: string[];
  requirementsHash: string;
  kind: ResumeBlockSuggestionKind;
  suggestedText: string;
  reason: string;
  usedEvidenceRefs: MatchEvidenceRef[];
  guardResult: FactGuardResult;
  promptVersion: string;
  now?: string;
}): AiSuggestion {
  const now = input.now ?? new Date().toISOString();
  const target = resolveCanonicalSuggestionTarget(input.branch, input.contentItem);
  const guardPreview = {
    allowed: input.guardResult.status === "pass" || input.guardResult.status === "ai_failed_rule_kept",
    reasons: input.guardResult.ruleFindings.map((finding) => finding.message)
  };

  return AiSuggestionSchema.parse({
    id: `suggestion-${input.branch.id}-${input.contentItem.id}-${nanoid(8)}`,
    draftId: input.draftId,
    targetSectionId: target.sectionType,
    targetContentItemId: input.contentItem.id,
    targetFieldId: target.fieldId,
    targetFieldPath: target.fieldPath,
    branchId: input.branch.id,
    basedOnBranchRevision: input.branch.revision,
    basedOnRevisionId: input.branch.currentRevisionId,
    originalTextHash: stableHashText(input.contentItem.text),
    requirementsHash: input.requirementsHash,
    evidenceQuotes: input.usedEvidenceRefs.map((ref) => ref.factQuote || ref.factText),
    guardPreview,
    type: mapSuggestionKindToAiType(input.kind),
    originalText: input.contentItem.text,
    suggestedText: input.suggestedText,
    reason: input.reason,
    requirementIds: input.requirementIds,
    usedEvidenceRefs: input.usedEvidenceRefs,
    guardResult: input.guardResult,
    riskLevel: input.guardResult.riskLevel,
    status: guardPreview.allowed
      ? "pending_review"
      : input.guardResult.status === "blocked_high_risk" || input.guardResult.riskLevel === "high"
        ? "blocked_high_risk"
        : "edited_pending_guard",
    promptVersion: input.promptVersion,
    createdAt: now,
    updatedAt: now
  });
}

function resolveCanonicalSuggestionTarget(branch: ResumeBranch, contentItem: BranchContentItem) {
  const data = branch.structuredContentItems?.find((item) => item.id === contentItem.id)?.data;
  const sectionType = data?.sectionType ?? "other";
  const record = (data ?? {}) as Record<string, unknown>;
  const listField = ["highlights", "outcomes"].find((field) => Array.isArray(record[field]) && (record[field] as unknown[]).length > 0);
  const scalarField = ["description", "text", "name", "language", "title", "organization", "school"]
    .find((field) => typeof record[field] === "string" && String(record[field]).trim());
  const field = listField ?? scalarField ?? (sectionType === "summary" ? "text" : "description");
  const listIndex = listField ? "[0]" : "";
  return {
    sectionType,
    fieldId: `${sectionType}.${field}`,
    fieldPath: `sections.${sectionType}.items.${contentItem.id}.${field}${listIndex}`
  };
}

export function createDeterministicBlockSuggestion(input: {
  draftId: string;
  job: JobDescription;
  branch: ResumeBranch;
  contentItem: BranchContentItem;
  matches: RequirementBlockMatch[];
  kind?: ResumeBlockSuggestionKind;
  promptVersion: string;
  now?: string;
}) {
  const kind = input.kind ?? "rewrite";
  const evidenceRefs = uniqueEvidenceRefs(input.matches.flatMap((match) => match.evidenceRefs));
  const requirementIds = Array.from(new Set(input.matches.map((match) => match.requirementId)));
  const suggestedText = deterministicSuggestedText(input.contentItem.text, kind, input.matches);
  const guardResult = runRuleFactGuard({
    originalText: input.contentItem.originalText,
    checkedText: suggestedText,
    usedEvidenceRefs: evidenceRefs,
    now: input.now
  });

  return createBlockSuggestion({
    draftId: input.draftId,
    branch: input.branch,
    contentItem: input.contentItem,
    requirementIds,
    requirementsHash: input.matches[0]?.requirementsHash ?? stableHashText(input.job.id),
    kind,
    suggestedText,
    reason: deterministicReason(kind, input.matches),
    usedEvidenceRefs: evidenceRefs,
    guardResult,
    promptVersion: input.promptVersion,
    now: input.now
  });
}

export function staleReasonForSuggestion(input: {
  suggestion: AiSuggestion;
  branch: ResumeBranch;
  requirementsHash: string;
}) {
  const item = input.suggestion.targetContentItemId
    ? input.branch.contentItems.find((candidate) => candidate.id === input.suggestion.targetContentItemId)
    : undefined;
  if (!item) {
    return "content_item_not_found";
  }
  if (input.suggestion.branchId && input.suggestion.branchId !== input.branch.id) {
    return "branch_mismatch";
  }
  if (input.suggestion.basedOnBranchRevision !== undefined && input.suggestion.basedOnBranchRevision !== input.branch.revision) {
    return "branch_revision_changed";
  }
  if (input.suggestion.basedOnRevisionId && input.suggestion.basedOnRevisionId !== input.branch.currentRevisionId) {
    return "current_revision_changed";
  }
  if (input.suggestion.originalTextHash && input.suggestion.originalTextHash !== stableHashText(item.text)) {
    return "original_text_changed";
  }
  if (input.suggestion.requirementsHash && input.suggestion.requirementsHash !== input.requirementsHash) {
    return "requirements_changed";
  }
  return undefined;
}

function deterministicSuggestedText(
  originalText: string,
  kind: ResumeBlockSuggestionKind,
  matches: RequirementBlockMatch[]
) {
  const text = originalText.trim();
  if (kind === "compress") {
    const firstSentence = text.split(/[。.!?！？]/).find((part) => part.trim().length > 0)?.trim();
    return firstSentence && firstSentence.length < text.length ? firstSentence : text.slice(0, Math.min(text.length, 120));
  }
  if (kind === "remove_irrelevant") {
    return text.split(/[。.!?！？]/).map((part) => part.trim()).filter(Boolean).slice(0, 2).join("；") || text;
  }
  if (kind === "prioritize") {
    const quote = matches.flatMap((match) => match.evidenceQuotes).find(Boolean);
    if (quote && text.includes(quote)) {
      return `${quote}；${text.replace(quote, "").replace(/^；|；$/g, "").trim()}`.replace(/；；+/g, "；");
    }
    return text;
  }
  return `围绕目标岗位突出已有事实：${text}`;
}

function deterministicReason(kind: ResumeBlockSuggestionKind, matches: RequirementBlockMatch[]) {
  const requirementCount = new Set(matches.map((match) => match.requirementId)).size;
  if (kind === "compress") {
    return `压缩当前区块，保留已有事实证据，并关联 ${requirementCount} 条岗位要求。`;
  }
  if (kind === "prioritize") {
    return `前置与岗位要求更相关的已确认事实，未新增未经证实内容。`;
  }
  if (kind === "remove_irrelevant") {
    return `弱化低相关表达，避免自动删除正式事实。`;
  }
  return `基于当前区块原文和已确认事实，调整表达以贴近岗位要求。`;
}

function uniqueEvidenceRefs(refs: MatchEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
