import {
  ImportedResumeDraftSchema,
  ResumeItemV2Schema,
  type ImportedResumeDraft,
  type ImportedResumeDraftV2,
  type ImportedResumeField,
  type ImportedResumeFieldCandidate
} from "@/domain/schemas";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { containsUnresolvedSensitivePlaceholder } from "@/services/security/text";

export type ResumeImportReviewDecision = "accept_all" | "ignore_uncertain";
const BASIC_CANDIDATE_KEYS = ["name", "email", "phone", "location", "targetRole", "summary"] as const;
type BasicCandidateKey = typeof BASIC_CANDIDATE_KEYS[number];

export type FieldCandidateApplyAction =
  | "accept"
  | "reject"
  | { type: "edit"; value: ImportedResumeFieldCandidate["value"] };

export type FieldCandidateApplyErrorCode =
  | "placeholder_unresolved"
  | "candidate_target_unresolved"
  | "candidate_duplicate_target";

export class FieldCandidateApplyError extends Error {
  constructor(
    readonly code: FieldCandidateApplyErrorCode,
    readonly candidateId: string,
    readonly targetFieldId: string
  ) {
    super(code);
    this.name = "FieldCandidateApplyError";
  }
}

/**
 * The single mutation path for a review candidate. It updates both the
 * candidate decision and the canonical field/item it points at.
 */
export function applyFieldCandidateToDraft(
  draft: ImportedResumeDraft,
  candidate: ImportedResumeFieldCandidate,
  action: FieldCandidateApplyAction
): ImportedResumeDraft {
  if (draft.schemaVersion !== "resume-import-v2") {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }
  assertSafeCandidate(candidate);

  if (action !== "reject") {
    const sibling = draft.fieldCandidates.find((item) =>
      item.id !== candidate.id
      && item.targetFieldId === candidate.targetFieldId
      && item.sectionId === candidate.sectionId
      && item.itemId === candidate.itemId
      && (item.reviewStatus === "accepted" || item.reviewStatus === "edited")
    );
    if (sibling && JSON.stringify(sibling.value) !== JSON.stringify(candidate.value)) {
      throw new FieldCandidateApplyError("candidate_duplicate_target", candidate.id, candidate.targetFieldId);
    }
  }

  const isEdit = typeof action === "object";
  const value = isEdit ? action.value : candidate.value;
  assertSafeCandidateValue(candidate, value);
  const nextCandidate = {
    ...candidate,
    value,
    needsConfirmation: false,
    userConfirmed: action !== "reject",
    reviewStatus: action === "reject" ? "rejected" as const : isEdit ? "edited" as const : "accepted" as const,
    dateValue: candidate.dateValue && typeof value === "string"
      ? { ...candidate.dateValue, value, current: false }
      : candidate.dateValue
  };

  // Rejecting a candidate is intentionally metadata-only. An authoritative
  // target must not be cleared merely because one alternative was rejected.
  if (action === "reject") {
    return ImportedResumeDraftSchema.parse({
      ...draft,
      fieldCandidates: draft.fieldCandidates.map((item) => item.id === candidate.id ? nextCandidate : item)
    });
  }

  const nextDraft = candidate.targetFieldId.startsWith("basics.")
    ? applyBasicCandidate(draft, candidate, value, isEdit)
    : applyStructuredCandidate(draft, candidate, value, isEdit);

  return ImportedResumeDraftSchema.parse({
    ...nextDraft,
    fieldCandidates: nextDraft.fieldCandidates.map((item) => item.id === candidate.id ? nextCandidate : item)
  });
}

export function assertNoPlaceholderFieldCandidates(draft: ImportedResumeDraft) {
  if (draft.schemaVersion !== "resume-import-v2") return;
  const invalid = draft.fieldCandidates.find((candidate) =>
    containsUnresolvedSensitivePlaceholder(candidate.value)
    || containsUnresolvedSensitivePlaceholder(candidate.sourceQuote)
  );
  if (invalid) {
    throw new Error("resume_import_placeholder_candidate");
  }
}

export function applyResumeImportReviewDecision(
  draft: ImportedResumeDraft,
  decision: ResumeImportReviewDecision
): ImportedResumeDraft {
  const accept = decision === "accept_all";
  if (accept && draft.schemaVersion === "resume-import-v2") {
    const reviewedDraft = draft.fieldCandidates
      .filter((candidate) => candidate.reviewStatus === "needs_review")
      .reduce<ImportedResumeDraftV2>(
        (current, candidate) => applyFieldCandidateToDraft(current, candidate, "accept") as ImportedResumeDraftV2,
        draft
      );
    draft = reviewedDraft;
  }
  const confirmField = <T extends ImportedResumeDraft["basics"]["name"]>(field: T): T => {
    if (!field?.mapping?.needsConfirmation) return field;
    if (!accept) return undefined as T;
    return {
      ...field,
      sourceStatus: "user_confirmed_modified",
      userConfirmed: true,
      mapping: { ...field.mapping, needsConfirmation: false }
    } as T;
  };
  const reviewedSections = draft.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => item.mapping?.needsConfirmation || item.sourceStatus === "ambiguous"
      ? {
          ...item,
          included: accept,
          sourceStatus: "user_confirmed_modified" as const,
          userConfirmed: accept,
          mapping: item.mapping ? { ...item.mapping, needsConfirmation: false } : undefined
        }
      : item)
  }));
  const sections = !accept && draft.schemaVersion === "resume-import-v2"
    ? draft.fieldCandidates
        .filter((candidate) => candidate.reviewStatus === "needs_review")
        .reduce(removeCandidateValue, reviewedSections)
    : reviewedSections;
  return ImportedResumeDraftSchema.parse({
    ...draft,
    basics: {
      ...draft.basics,
      name: confirmField(draft.basics.name),
      email: confirmField(draft.basics.email),
      phone: confirmField(draft.basics.phone),
      location: confirmField(draft.basics.location),
      summary: confirmField(draft.basics.summary),
      links: draft.basics.links.flatMap((field) => {
        const reviewed = confirmField(field);
        return reviewed ? [reviewed] : [];
      })
    },
    sections,
    ...(draft.schemaVersion === "resume-import-v2"
      ? {
          fieldCandidates: draft.fieldCandidates.map((candidate) =>
            candidate.reviewStatus === "needs_review"
              ? {
                  ...candidate,
                  needsConfirmation: false,
                  userConfirmed: accept,
                  reviewStatus: accept ? "accepted" as const : "rejected" as const
                }
              : candidate
          )
        }
      : {})
  });
}

function applyBasicCandidate(
  draft: ImportedResumeDraftV2,
  candidate: ImportedResumeFieldCandidate,
  value: ImportedResumeFieldCandidate["value"],
  isEdit: boolean
): ImportedResumeDraftV2 {
  const key = (candidate.targetFieldId === "basics.headline" || candidate.targetFieldId === "basics.targetRole"
    ? "targetRole"
    : candidate.targetFieldId.replace(/^basics\./u, "")) as BasicCandidateKey;
  if (!BASIC_CANDIDATE_KEYS.includes(key)) {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }

  const current = draft.basics[key];
  const nextValue = value.trim();
  const changed = current?.value !== nextValue;
  const nextField = fieldWithCandidateProvenance(current, candidate, nextValue, isEdit, changed);
  return {
    ...draft,
    basics: { ...draft.basics, [key]: nextField }
  } as ImportedResumeDraftV2;
}

function applyStructuredCandidate(
  draft: ImportedResumeDraftV2,
  candidate: ImportedResumeFieldCandidate,
  value: ImportedResumeFieldCandidate["value"],
  isEdit: boolean
): ImportedResumeDraftV2 {
  if (!candidate.itemId || candidate.itemId === "basics") {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }
  const key = candidate.targetFieldId.split(".").at(-1);
  if (!key) {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }
  let found = false;
  const sections = draft.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.id !== candidate.itemId || (candidate.sectionId && candidate.sectionId !== section.id)) return item;
      found = true;
      if (!item.structuredItem) {
        throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
      }
      const currentRecord = item.structuredItem as unknown as Record<string, unknown>;
      const structuredItem = ResumeItemV2Schema.parse({ ...currentRecord, [key]: value });
      return {
        ...item,
        structuredItem,
        normalizedText: projectResumeItemV2(structuredItem),
        sourceStatus: isEdit || item.userEdited ? "user_confirmed_modified" as const : "located" as const,
        userEdited: isEdit ? true : item.userEdited,
        userConfirmed: true,
        sourceBlockIds: uniqueStrings([...item.sourceBlockIds, ...candidate.sourceBlockIds]),
        sourceRanges: mergeSourceRanges(item.sourceRanges, candidate.sourceRanges),
        sourceQuote: item.sourceQuote ?? candidate.sourceQuote,
        mapping: mappingWithCandidateProvenance(item.mapping, candidate, value)
      };
    })
  }));
  if (!found) {
    throw new FieldCandidateApplyError("candidate_target_unresolved", candidate.id, candidate.targetFieldId);
  }
  return { ...draft, sections };
}

function fieldWithCandidateProvenance(
  current: ImportedResumeField | undefined,
  candidate: ImportedResumeFieldCandidate,
  value: string,
  isEdit: boolean,
  changed: boolean
): ImportedResumeField {
  return {
    value,
    pageRefs: current?.pageRefs ?? [],
    confidence: current?.confidence ?? confidenceLabel(candidate.confidence),
    sourceStatus: isEdit || current?.userEdited
      ? "user_confirmed_modified"
      : current?.sourceStatus === "located" && !changed ? current.sourceStatus : "located",
    userEdited: isEdit ? true : current?.userEdited ?? false,
    userConfirmed: true,
    sourceBlockIds: uniqueStrings([...(current?.sourceBlockIds ?? []), ...candidate.sourceBlockIds]),
    sourceRanges: mergeSourceRanges(current?.sourceRanges, candidate.sourceRanges),
    sourceQuote: current?.sourceQuote ?? candidate.sourceQuote,
    mapping: mappingWithCandidateProvenance(current?.mapping, candidate, value)
  };
}

function mappingWithCandidateProvenance(
  current: ImportedResumeField["mapping"] | undefined,
  candidate: ImportedResumeFieldCandidate,
  value: ImportedResumeFieldCandidate["value"]
) {
  return {
    ...(current ?? {}),
    sourcePaths: uniqueStrings([...(current?.sourcePaths ?? []), ...candidate.sourceBlockIds]),
    sourceValues: uniqueUnknownValues([...(current?.sourceValues ?? []), value]),
    confidenceLevel: current?.confidenceLevel ?? confidenceLabel(candidate.confidence),
    confidenceReason: candidate.mappingReason,
    needsConfirmation: false
  };
}

function mergeSourceRanges(
  current: ImportedResumeField["sourceRanges"] | undefined,
  candidate: ImportedResumeFieldCandidate["sourceRanges"] | undefined
) {
  const ranges = [...(current ?? []), ...(candidate ?? [])];
  const keys = new Set<string>();
  return ranges.filter((range) => {
    const key = `${range.blockId}:${range.start}:${range.end}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function confidenceLabel(value: number): "high" | "medium" | "low" {
  return value >= 0.9 ? "high" : value >= 0.7 ? "medium" : "low";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function uniqueUnknownValues(values: unknown[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertSafeCandidate(candidate: ImportedResumeFieldCandidate) {
  if (containsUnresolvedSensitivePlaceholder(candidate.value) || containsUnresolvedSensitivePlaceholder(candidate.sourceQuote)) {
    throw new FieldCandidateApplyError("placeholder_unresolved", candidate.id, candidate.targetFieldId);
  }
}

function assertSafeCandidateValue(candidate: ImportedResumeFieldCandidate, value: ImportedResumeFieldCandidate["value"]) {
  if (containsUnresolvedSensitivePlaceholder(value)) {
    throw new FieldCandidateApplyError("placeholder_unresolved", candidate.id, candidate.targetFieldId);
  }
}

function removeCandidateValue(
  sections: ImportedResumeDraft["sections"],
  candidate: Extract<ImportedResumeDraft, { schemaVersion: "resume-import-v2" }>["fieldCandidates"][number]
) {
  if (!candidate.itemId || candidate.itemId === "basics") return sections;
  const key = candidate.targetFieldId.split(".").at(-1);
  if (!key) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.id !== candidate.itemId || !item.structuredItem) return item;
      const record = { ...item.structuredItem } as unknown as Record<string, unknown>;
      if (key === "current") record.current = false;
      else delete record[key];
      return { ...item, structuredItem: ResumeItemV2Schema.parse(record) };
    })
  }));
}
