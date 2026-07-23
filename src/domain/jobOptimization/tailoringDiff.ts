import {
  ResumeFieldPatchSchema,
  ResumeTailoringDiffSchema,
  TailoringGapSchema,
  type JobDescription,
  type MatchEvidenceRef,
  type ResumeBranch,
  type ResumeFieldPatch,
  type ResumeTailoringDiff,
  type TailoringDiffRejectionReason,
  type TailoringGap,
  type TailoringClarificationQuestion
} from "@/domain/schemas";
import { buildCanonicalJobRequirementGraphV3 } from "./v3";
import { extractPhraseAwareKeywords, keywordMatchScore } from "./keywordTaxonomy";

export type TailoringDiffRejection = {
  diff: ResumeTailoringDiff;
  reasonCode: TailoringDiffRejectionReason;
};

export type TailoringDiffValidationResult = {
  appliedDiffs: ResumeTailoringDiff[];
  rejectedDiffs: TailoringDiffRejection[];
  patches: ResumeFieldPatch[];
  warnings: string[];
};

const MECHANICAL_PREFIX = /^(?:围绕|基于).{0,42}(?:复现问题、定位原因并验证结果|：原文|:\s*原文)/;
const OWNER_UPGRADE = /(?:参与|协助|配合|支持).{0,20}(?:主导|独立负责|全面负责)/;
const METRIC = /(?:\d+(?:\.\d+)?%|\d+(?:\.\d+)?x|¥\s*\d+|\$\s*\d+|\d+\s*(?:万|亿|用户|stars?))/gi;

export function validateEachTailoringDiffLocally(input: {
  branch: ResumeBranch;
  diffs: ResumeTailoringDiff[];
  confirmedRequirementIds?: string[];
  allowUnconfirmed?: boolean;
}): TailoringDiffValidationResult {
  const appliedDiffs: ResumeTailoringDiff[] = [];
  const rejectedDiffs: TailoringDiffRejection[] = [];
  const patches: ResumeFieldPatch[] = [];
  const warnings: string[] = [];
  const confirmed = new Set(input.confirmedRequirementIds ?? []);

  for (const rawDiff of input.diffs) {
    const parsed = ResumeTailoringDiffSchema.safeParse(rawDiff);
    if (!parsed.success) {
      rejectedDiffs.push({ diff: rawDiff, reasonCode: "invalid_value_type" });
      continue;
    }
    const diff = parsed.data;
    const target = resolveTarget(input.branch, diff);
    if (!target) {
      rejectedDiffs.push({ diff, reasonCode: "target_not_found" });
      continue;
    }
    if (!isAllowedPath(target.sectionType, diff.target.fieldPath)) {
      rejectedDiffs.push({ diff, reasonCode: diff.target.fieldPath === "name" ? "blocked_identity_path" : "path_not_allowed" });
      continue;
    }
    if (!sameValue(target.current, diff.original)) {
      rejectedDiffs.push({ diff, reasonCode: "original_mismatch" });
      continue;
    }
    const reason = validateOperation(diff, target.current, confirmed, input.allowUnconfirmed ?? true);
    if (reason) {
      rejectedDiffs.push({ diff, reasonCode: reason });
      continue;
    }
    const patch = toFieldPatch(diff);
    appliedDiffs.push(diff);
    patches.push(patch);
    if (diff.supportLevel !== "verified") warnings.push(`${diff.target.itemId}.${diff.target.fieldPath} 需要用户确认后才能写入。`);
  }
  return { appliedDiffs, rejectedDiffs, patches, warnings: [...new Set(warnings)] };
}

export function analyzeKeywordAndCapabilityGaps(input: {
  job: JobDescription;
  branch: ResumeBranch;
  clarificationQuestions?: TailoringClarificationQuestion[];
}): TailoringGap[] {
  const graph = buildCanonicalJobRequirementGraphV3(input.job);
  const items = input.branch.structuredContentItems ?? [];
  const questions = input.clarificationQuestions ?? [];
  const gaps = graph.requirements.map((requirement): TailoringGap => {
    const keywords = extractPhraseAwareKeywords([
      requirement.statement,
      ...requirement.exactKeywords,
      ...requirement.semanticAliases,
      ...requirement.details.map((detail) => detail.text)
    ]);
    const ranked = items.map((item) => {
      const text = item.legacyTextProjection ?? input.branch.contentItems.find((candidate) => candidate.id === item.id)?.text ?? "";
      const score = keywords.reduce((total, entry) => total + keywordMatchScore(entry, text), 0);
      return { item, text, score };
    }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score);
    const evidenceRefs = dedupeEvidenceRefs(ranked.flatMap((entry) => resolveEvidenceRefs(input.branch, entry.item.id)));
    const relatedQuestions = questions.filter((question) => question.requirementIds.includes(requirement.id));
    const exactCovered = keywords.some((entry) => ranked.some((candidate) => candidate.text.toLowerCase().includes(entry.phrase.toLowerCase()) && entry.weight >= 0.75));
    const status: TailoringGap["status"] = exactCovered && evidenceRefs.length ? "covered"
      : ranked.length && evidenceRefs.length ? "rewriteable"
        : relatedQuestions.length ? "confirmable"
          : "uncovered";
    return TailoringGapSchema.parse({
      requirementId: requirement.id,
      status,
      evidenceRefs,
      candidateItemIds: ranked.slice(0, 6).map((entry) => entry.item.id),
      missingKeywords: keywords.filter((entry) => !ranked.some((candidate) => keywordMatchScore(entry, candidate.text) > 0)).map((entry) => entry.phrase),
      clarificationQuestionIds: relatedQuestions.map((question) => question.id)
    });
  });
  for (const material of graph.verificationMaterials) {
    gaps.push(TailoringGapSchema.parse({
      requirementId: material.id,
      status: "material_only",
      evidenceRefs: [],
      candidateItemIds: [],
      missingKeywords: [],
      clarificationQuestionIds: []
    }));
  }
  return gaps;
}

export function markRejectedClarificationGaps(gaps: TailoringGap[], rejectedRequirementIds: string[]) {
  const rejected = new Set(rejectedRequirementIds);
  return gaps.map((gap) => rejected.has(gap.requirementId) ? TailoringGapSchema.parse({ ...gap, status: "not_applicable", clarificationQuestionIds: [] }) : gap);
}

export function diffToFieldPatch(diff: ResumeTailoringDiff) {
  return toFieldPatch(ResumeTailoringDiffSchema.parse(diff));
}

function resolveTarget(branch: ResumeBranch, diff: ResumeTailoringDiff) {
  const item = branch.structuredContentItems?.find((candidate) => candidate.id === diff.target.itemId);
  if (!item || item.data.sectionType !== diff.target.sectionId) return undefined;
  if (diff.target.fieldPath === "visible" || diff.target.fieldPath === "order") {
    return { sectionType: item.data.sectionType, current: item[diff.target.fieldPath] };
  }
  const record = item.data as unknown as Record<string, unknown>;
  const current = record[diff.target.fieldPath] ?? (diff.target.fieldPath === "highlights" ? [] : "");
  return { sectionType: item.data.sectionType, current };
}

function isAllowedPath(sectionType: string, fieldPath: ResumeTailoringDiff["target"]["fieldPath"]) {
  if (fieldPath === "visible" || fieldPath === "order") return ["summary", "skills", "project", "work", "internship"].includes(sectionType);
  if (sectionType === "summary") return fieldPath === "text";
  if (sectionType === "skills") return fieldPath === "name" || fieldPath === "description";
  if (["project", "work", "internship"].includes(sectionType)) return fieldPath === "description" || fieldPath === "highlights";
  return false;
}

function validateOperation(
  diff: ResumeTailoringDiff,
  current: unknown,
  confirmed: Set<string>,
  allowUnconfirmed: boolean
): TailoringDiffRejectionReason | undefined {
  if (diff.supportLevel !== "verified" && !allowUnconfirmed && !diff.requirementIds.some((id) => confirmed.has(id))) return "confirmation_required";
  if (diff.supportLevel === "verified" && !diff.evidenceRefs.length && !["reorder", "hide"].includes(diff.operation)) return "insufficient_evidence";

  if (diff.operation === "hide") {
    return diff.target.fieldPath === "visible" && current === true && diff.value === false ? undefined : "hide_not_allowed";
  }
  if (diff.operation === "reorder") {
    if (!Array.isArray(current) || !Array.isArray(diff.value)) return "invalid_value_type";
    return sameMultiset(current, diff.value) && !sameValue(current, diff.value) ? undefined : sameValue(current, diff.value) ? "no_op" : "reorder_membership_changed";
  }
  if (diff.operation === "append") {
    if (diff.target.fieldPath !== "highlights" && diff.target.sectionId !== "skills") return "append_not_allowed";
    if (typeof diff.value !== "string" || !diff.value.trim()) return "empty_value";
    if (diff.supportLevel !== "verified" && !allowUnconfirmed && !diff.requirementIds.some((id) => confirmed.has(id))) return "confirmation_required";
    return undefined;
  }
  if (diff.operation !== "replace") return "invalid_value_type";
  if (typeof current !== typeof diff.value || Array.isArray(current) !== Array.isArray(diff.value)) return "invalid_value_type";
  const before = render(current);
  const after = render(diff.value);
  if (!after.trim()) return "empty_value";
  if (normalize(before) === normalize(after)) return "no_op";
  if (MECHANICAL_PREFIX.test(after)) return "mechanical_prefix";
  if (before.length >= 24 && after.includes(before) && after.length > before.length * 1.15) return "duplicate_original";
  if (before.length >= 50 && after.length < before.length * 0.45) return "truncated_output";
  if (OWNER_UPGRADE.test(`${before}\n${after}`)) return "responsibility_upgrade";
  const oldMetrics = new Set(before.match(METRIC) ?? []);
  const evidenceText = diff.evidenceRefs.map((ref) => ref.factText).join("\n");
  const invented = (after.match(METRIC) ?? []).filter((metric) => !oldMetrics.has(metric) && !evidenceText.includes(metric));
  if (invented.length) return "invented_metric";
  return undefined;
}

function toFieldPatch(diff: ResumeTailoringDiff): ResumeFieldPatch {
  const after = diff.operation === "append"
    ? Array.isArray(diff.original) ? [...diff.original, diff.value as string]
      : `${String(diff.original).trim()}${String(diff.original).trim() ? "；" : ""}${String(diff.value).trim()}`
    : diff.value;
  return ResumeFieldPatchSchema.parse({
    sectionId: diff.target.sectionId,
    itemId: diff.target.itemId,
    fieldPath: diff.target.fieldPath,
    operation: diff.operation === "append" ? "append" : "replace",
    before: diff.original,
    after
  });
}

function resolveEvidenceRefs(branch: ResumeBranch, itemId: string): MatchEvidenceRef[] {
  const item = branch.contentItems.find((candidate) => candidate.id === itemId);
  if (!item) return [];
  const result: MatchEvidenceRef[] = [];
  for (const ref of item.factRefs) {
    const factText = item.text;
    if (ref.type === "experience_fact") result.push({ ...ref, factQuote: factText, factText });
    if (ref.type === "skill_fact") result.push({ ...ref, factQuote: factText, factText });
    if (ref.type === "certificate_fact") result.push({ ...ref, factQuote: factText, factText });
  }
  return result;
}

function dedupeEvidenceRefs(values: MatchEvidenceRef[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sameMultiset(left: unknown[], right: unknown[]) {
  if (left.length !== right.length) return false;
  const counts = new Map<string, number>();
  for (const item of left) {
    const key = JSON.stringify(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const item of right) {
    const key = JSON.stringify(item);
    const count = counts.get(key) ?? 0;
    if (!count) return false;
    counts.set(key, count - 1);
  }
  return [...counts.values()].every((count) => count === 0);
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function render(value: unknown) {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
