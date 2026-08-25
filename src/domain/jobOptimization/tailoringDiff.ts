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
  type TailoringClarificationQuestion,
  type TailoringUserDeclaration
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
const INTERNAL_FIELD_LABEL = /(?:组织|职位\/角色|项目名称|开始日期|结束日期|进行中|亮点)\s*[:：]/u;
const MALFORMED_CHINESE = /(?:的的|了了|负责负责|并且和|提升并提升)/u;
const GENERIC_PROFICIENCY = /^(?:熟练掌握|熟练运用|熟悉|了解|掌握|具备)\s*[^。；;!?！？]{0,32}(?:能力|经验|技能|知识|相关工作|相关任务)[。；;!?！？]?$/u;
const STRONG_PROFICIENCY = /(?:精通|熟练掌握|熟练运用|独立使用|主导使用)/u;

export function validateEachTailoringDiffLocally(input: {
  branch: ResumeBranch;
  diffs: ResumeTailoringDiff[];
  confirmedRequirementIds?: string[];
  explicitlyAcceptedDiffs?: ResumeTailoringDiff[];
  allowUnconfirmed?: boolean;
  submissionSafe?: boolean;
  forbiddenTerms?: string[];
  confirmedUserDeclarations?: TailoringUserDeclaration[];
  requirementTexts?: string[];
}): TailoringDiffValidationResult {
  const appliedDiffs: ResumeTailoringDiff[] = [];
  const rejectedDiffs: TailoringDiffRejection[] = [];
  const patches: ResumeFieldPatch[] = [];
  const warnings: string[] = [];
  const confirmed = new Set(input.confirmedRequirementIds ?? []);
  const explicitlyAcceptedDiffs = input.explicitlyAcceptedDiffs ?? [];

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
    if (!isAllowedPath(target.sectionType, diff.target.fieldPath, input.submissionSafe ?? false)) {
      rejectedDiffs.push({ diff, reasonCode: diff.target.fieldPath === "name" ? "blocked_identity_path" : "path_not_allowed" });
      continue;
    }
    if (!sameValue(target.current, diff.original)) {
      rejectedDiffs.push({ diff, reasonCode: "original_mismatch" });
      continue;
    }
    const explicitlyAccepted = explicitlyAcceptedDiffs.some((candidate) => sameDiffIdentity(candidate, diff));
    const requirementConfirmed = diff.requirementIds.some((id) => confirmed.has(id));
    const reason = validateOperation(
      diff,
      target.current,
      confirmed,
      input.allowUnconfirmed ?? true,
      explicitlyAccepted,
      input.forbiddenTerms ?? [],
      input.confirmedUserDeclarations ?? [],
      input.requirementTexts ?? []
    );
    if (reason) {
      rejectedDiffs.push({ diff, reasonCode: reason });
      continue;
    }
    const patch = toFieldPatch(diff);
    appliedDiffs.push(diff);
    patches.push(patch);
    if (diff.supportLevel !== "verified" && !explicitlyAccepted && !requirementConfirmed) {
      warnings.push(`${diff.target.itemId}.${diff.target.fieldPath} 需要用户确认后才能写入。`);
    }
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

export function dedupeTailoringDiffs(diffs: ResumeTailoringDiff[]) {
  const appliedDiffs: ResumeTailoringDiff[] = [];
  const rejectedDiffs: TailoringDiffRejection[] = [];
  const seen = new Set<string>();
  for (const diff of diffs) {
    const targetKey = `${diff.target.sectionId}:${diff.target.itemId}:${diff.target.fieldPath}:${diff.operation}`;
    const normalizedValue = normalize(render(diff.value));
    if (seen.has(targetKey)) {
      rejectedDiffs.push({ diff, reasonCode: "cross_diff_duplicate" });
      continue;
    }
    const sameSentence = appliedDiffs.some((candidate) => normalize(render(candidate.value)) === normalizedValue);
    if (sameSentence) {
      rejectedDiffs.push({ diff, reasonCode: "duplicate_sentence" });
      continue;
    }
    const overlaps = appliedDiffs.some((candidate) => {
      const requirementOverlap = candidate.requirementIds.some((id) => diff.requirementIds.includes(id));
      return requirementOverlap && characterOverlap(render(candidate.value), render(diff.value)) >= 0.86;
    });
    if (overlaps) {
      rejectedDiffs.push({ diff, reasonCode: "cross_diff_duplicate" });
      continue;
    }
    seen.add(targetKey);
    appliedDiffs.push(diff);
  }
  return { appliedDiffs, rejectedDiffs, patches: [], warnings: [] };
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

function isAllowedPath(
  sectionType: string,
  fieldPath: ResumeTailoringDiff["target"]["fieldPath"],
  submissionSafe: boolean
) {
  if (fieldPath === "visible" || fieldPath === "order") {
    return !submissionSafe && ["summary", "skills", "project", "work", "internship"].includes(sectionType);
  }
  if (sectionType === "summary") return fieldPath === "text";
  if (sectionType === "skills") return fieldPath === "name" || fieldPath === "description";
  if (["project", "work", "internship"].includes(sectionType)) return fieldPath === "description" || fieldPath === "highlights";
  return false;
}

export function isSubmissionSafeTailoringPath(
  sectionType: string,
  fieldPath: ResumeTailoringDiff["target"]["fieldPath"]
) {
  return isAllowedPath(sectionType, fieldPath, true);
}

function validateOperation(
  diff: ResumeTailoringDiff,
  current: unknown,
  confirmed: Set<string>,
  allowUnconfirmed: boolean,
  explicitlyAccepted: boolean,
  forbiddenTerms: string[],
  confirmedUserDeclarations: TailoringUserDeclaration[],
  requirementTexts: string[]
): TailoringDiffRejectionReason | undefined {
  if (diff.supportLevel !== "verified" && !allowUnconfirmed && !explicitlyAccepted && !diff.requirementIds.some((id) => confirmed.has(id))) return "confirmation_required";
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
    if (diff.supportLevel !== "verified" && !allowUnconfirmed && !explicitlyAccepted && !diff.requirementIds.some((id) => confirmed.has(id))) return "confirmation_required";
    return undefined;
  }
  if (diff.operation !== "replace") return "invalid_value_type";
  if (typeof current !== typeof diff.value || Array.isArray(current) !== Array.isArray(diff.value)) return "invalid_value_type";
  const before = render(current);
  const after = render(diff.value);
  if (!after.trim()) return "empty_value";
  if (normalize(before) === normalize(after)) return "no_op";
  if (INTERNAL_FIELD_LABEL.test(after) && !INTERNAL_FIELD_LABEL.test(before)) return "internal_field_label";
  if (Array.isArray(diff.value) && hasDuplicateSentences(diff.value)) return "duplicate_sentence";
  if (forbiddenTerms.some((term) => termAppearsAsNewText(term, before, after))) return "denied_capability";
  if (hasProficiencyUpgrade(after, confirmedUserDeclarations)) return "proficiency_upgrade";
  if (GENERIC_PROFICIENCY.test(after)) return "generic_proficiency_sentence";
  if (MALFORMED_CHINESE.test(after)) return "malformed_chinese_phrase";
  if (requirementTexts.some((text) => normalize(text) === normalize(after))) return "jd_parroting";
  if (looksLikeKeywordStuffing(after, diff.targetKeywords)) return "keyword_stuffing";
  if (MECHANICAL_PREFIX.test(after)) return "mechanical_prefix";
  if (!Array.isArray(current) && !Array.isArray(diff.value) && before.length >= 24 && after.includes(before) && after.length > before.length * 1.15) return "duplicate_original";
  if (before.length >= 50 && after.length < before.length * 0.45) return "truncated_output";
  if (OWNER_UPGRADE.test(`${before} ${after}`)) return "responsibility_upgrade";
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

function hasDuplicateSentences(values: string[]) {
  const normalized = values.map((value) => normalize(value));
  return new Set(normalized).size !== normalized.length;
}

function termAppearsAsNewText(term: string, before: string, after: string) {
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 1 && !normalize(before).includes(normalizedTerm) && normalize(after).includes(normalizedTerm);
}

function hasProficiencyUpgrade(after: string, declarations: TailoringUserDeclaration[]) {
  if (!STRONG_PROFICIENCY.test(after)) return false;
  return declarations.some((declaration) => declaration.proficiency && ["familiar", "aware", "learning"].includes(declaration.proficiency)
    && normalize(after).includes(normalize(declaration.value)));
}

function looksLikeKeywordStuffing(after: string, targetKeywords: string[]) {
  if (!targetKeywords.length) return false;
  const normalized = normalize(after);
  const hits = targetKeywords.filter((keyword) => normalized.includes(normalize(keyword))).length;
  return hits >= 4 && normalized.length < targetKeywords.reduce((total, keyword) => total + keyword.length, 0) * 1.35;
}

function sameDiffIdentity(left: ResumeTailoringDiff, right: ResumeTailoringDiff) {
  return left.target.sectionId === right.target.sectionId
    && left.target.itemId === right.target.itemId
    && left.target.fieldPath === right.target.fieldPath
    && left.operation === right.operation
    && sameValue(left.original, right.original)
    && sameValue(left.value, right.value);
}

function render(value: unknown) {
  return Array.isArray(value) ? value.join("\n") : String(value ?? "");
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function characterOverlap(left: string, right: string) {
  const toSet = (value: string) => new Set([...normalize(value).replace(/[\s\p{P}\p{S}]/gu, "")]);
  const leftSet = toSet(left);
  const rightSet = toSet(right);
  if (!leftSet.size || !rightSet.size) return 0;
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  return intersection / Math.max(leftSet.size, rightSet.size);
}
