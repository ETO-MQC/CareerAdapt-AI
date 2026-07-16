import { isCanonicalFieldId, type CanonicalFieldId, type ResumeFieldValueType, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import {
  ImportedResumeFieldCandidateSchema,
  type ImportedResumeFieldCandidate,
  type NormalizedSourceBlock
} from "@/domain/schemas";
import { alignResumeDateRange } from "./dates";
import { dateFieldSectionType, detectSectionType } from "./sectionHeading";

export type FieldCandidateValidationIssue = {
  candidateId: string;
  code: "unknown_source" | "quote_not_found" | "number_drift" | "value_type_mismatch" | "one_source_many_targets";
  message: string;
};

export type SuppressedCandidate = {
  targetFieldId: string;
  rawValue: string;
  blockId: string;
  reason: "suppressed_inside_email" | "suppressed_inside_url" | "suppressed_date_range" | "invalid_cn_mobile" | "unlabeled_generic_number" | "suppressed_single_char_name";
};

export type CandidateCreationResult =
  | {
      ok: true;
      candidate: ImportedResumeFieldCandidate;
    }
  | {
      ok: false;
      errorCode: "invalid_target_field_id" | "invalid_candidate";
      targetFieldId?: string;
      detector: string;
      sourceBlockIds: string[];
      message: string;
    };

export type ConsumedSourceRange = {
  blockId: string;
  start: number;
  end: number;
  targetFieldId: string;
  candidateId: string;
};

export type ResidualSourceSegment = {
  blockId: string;
  start: number;
  end: number;
  rawText: string;
  normalizedText: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_PATTERN = /(?:https?:\/\/|www\.|github\.com\/|linkedin\.com\/)[^\s，。；;]+/gi;
const GPA_PATTERN = /GPA\s*[:：]?\s*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)/i;
const RANK_PATTERN = /(?:专业)?排名\s*[:：]?\s*(\d+)\s*[/／]\s*(\d+)/i;

const CN_MOBILE_PATTERN = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
const DATE_RANGE_PATTERN = /(?:19|20)\d{2}[\s./\-年]\d{1,2}(?:[\s./\-月]\d{1,2}日?)?(?:\s*[-–—~至到]\s*(?:(?:19|20)\d{2}[\s./\-年]\d{1,2}(?:[\s./\-月]\d{1,2}日?)?|至今|现在|present|current))?/gi;

// Chinese phone with separators: 138-0013-8000, 138 0013 8000, +86 138 0013 8000
const PHONE_SEPARATED_PATTERN = /(?:\+86[\s\-]?)?(1[3-9]\d)[\s\-](\d{4})[\s\-](\d{4})/g;

const SECTION_TYPES_WITH_DATES = new Set<ResumeSectionTypeV2>(["education", "work", "internship", "project", "research", "campus", "volunteer"]);

export function createDeterministicFieldCandidates(blocks: readonly NormalizedSourceBlock[]) {
  const rawCandidates: ImportedResumeFieldCandidate[] = [];
  const suppressed: SuppressedCandidate[] = [];
  const creationResults: CandidateCreationResult[] = [];
  let activeSection: ResumeSectionTypeV2 | undefined;
  for (const block of [...blocks].sort((left, right) => left.order - right.order)) {
    const headingSection = detectSectionType(block.normalizedText);
    if (headingSection) {
      activeSection = headingSection;
      continue;
    }
    const text = block.normalizedText;
    const emailSpans = findPatternSpans(text, EMAIL_PATTERN);
    const urlSpans = findPatternSpans(text, URL_PATTERN);
    const claimedSpans = [...emailSpans, ...urlSpans];

    for (const span of emailSpans) {
      const result = safeCandidate(block, "basics.email", span.match, span.match, 0.99, "邮箱格式可从来源逐字定位");
      if (result.ok) rawCandidates.push(result.candidate);
      else creationResults.push(result);
    }
    for (const span of urlSpans) {
      const result = safeCandidate(block, "basics.otherLinks", [span.match], span.match, 0.96, "链接可从来源逐字定位");
      if (result.ok) rawCandidates.push(result.candidate);
      else creationResults.push(result);
    }

    const phoneMatches = findPhoneMatchesExcluding(text, claimedSpans);
    for (const phoneMatch of phoneMatches) {
      const result = safeCandidate(block, "basics.phone", phoneMatch.value, phoneMatch.value, phoneMatch.confidence, phoneMatch.reason);
      if (result.ok) rawCandidates.push(result.candidate);
      else creationResults.push(result);
    }

    const dateRangeSpans = findPatternSpans(text, DATE_RANGE_PATTERN);
    for (const drSpan of dateRangeSpans) {
      const overlappingPhones = findPatternSpans(text, CN_MOBILE_PATTERN)
        .filter((p) => spansOverlap(p, drSpan));
      for (const op of overlappingPhones) {
        suppressed.push({ targetFieldId: "basics.phone", rawValue: op.match, blockId: block.id, reason: "suppressed_date_range" });
      }
    }

    const gpa = text.match(GPA_PATTERN);
    if (gpa && (activeSection === "education" || /GPA/i.test(text))) {
      const gpaResult = safeCandidate(block, "education.gpa", Number(gpa[1]), gpa[1], 0.99, "GPA 数值来自明确的分数/满分表达");
      const scaleResult = safeCandidate(block, "education.gpaScale", Number(gpa[2]), gpa[2], 0.99, "GPA 满分来自明确的分数/满分表达");
      if (gpaResult.ok) rawCandidates.push(gpaResult.candidate); else creationResults.push(gpaResult);
      if (scaleResult.ok) rawCandidates.push(scaleResult.candidate); else creationResults.push(scaleResult);
    }
    const rank = text.match(RANK_PATTERN);
    if (rank && (activeSection === "education" || /排名/.test(text))) {
      const posResult = safeCandidate(block, "education.rankPosition", Number(rank[1]), rank[1], 0.99, "排名位置来自明确的位置/总人数表达");
      const totalResult = safeCandidate(block, "education.rankTotal", Number(rank[2]), rank[2], 0.99, "排名总人数来自明确的位置/总人数表达");
      if (posResult.ok) rawCandidates.push(posResult.candidate); else creationResults.push(posResult);
      if (totalResult.ok) rawCandidates.push(totalResult.candidate); else creationResults.push(totalResult);
    }

    if (activeSection && SECTION_TYPES_WITH_DATES.has(activeSection)) {
      // Map section types without their own date fields to the appropriate catalog section
      const dateFieldSection = dateFieldSectionType(activeSection) ?? activeSection;
      const range = alignResumeDateRange(block);
      if (range.startDate?.value) {
        const targetId = `${dateFieldSection}.startDate` as CanonicalFieldId;
        const result = safeCandidate(block, targetId, range.startDate.value, range.startDate.sourceQuote, range.startDate.confidence, "日期与当前栏目内同一视觉行对齐", range.startDate);
        if (result.ok) rawCandidates.push(result.candidate); else creationResults.push(result);
      }
      if (range.endDate?.current) {
        const targetId = `${dateFieldSection}.current` as CanonicalFieldId;
        const result = safeCandidate(block, targetId, true, range.endDate.sourceQuote, range.endDate.confidence, "当前状态来自同一视觉行中的至今/Present", range.endDate);
        if (result.ok) rawCandidates.push(result.candidate); else creationResults.push(result);
      } else if (range.endDate?.value) {
        const targetId = `${dateFieldSection}.endDate` as CanonicalFieldId;
        const result = safeCandidate(block, targetId, range.endDate.value, range.endDate.sourceQuote, range.endDate.confidence, "结束日期与当前栏目内同一视觉行对齐", range.endDate);
        if (result.ok) rawCandidates.push(result.candidate); else creationResults.push(result);
      }
    }
  }

  const deduped = requireConfirmationForSharedSources(dedupeCandidates(rawCandidates));

  // Compute consumed ranges and residual segments
  const consumedRanges = computeConsumedRanges(deduped, blocks);
  const residualSegments = computeResidualSegments(consumedRanges, blocks);

  return {
    candidates: deduped,
    creationResults,
    suppressed,
    consumedRanges,
    residualSegments
  };
}

/**
 * Safe candidate factory: wraps schema parse in try/catch.
 * Never lets a single bad candidate crash the entire import.
 */
function safeCandidate(
  block: NormalizedSourceBlock,
  targetFieldId: CanonicalFieldId,
  value: ImportedResumeFieldCandidate["value"],
  sourceQuote: string,
  confidence: number,
  mappingReason: string,
  dateValue?: ImportedResumeFieldCandidate["dateValue"]
): CandidateCreationResult {
  // Pre-validate targetFieldId exists in catalog
  if (!isCanonicalFieldId(targetFieldId)) {
    return {
      ok: false,
      errorCode: "invalid_target_field_id",
      targetFieldId,
      detector: "fieldCandidates.safeCandidate",
      sourceBlockIds: [block.id],
      message: `targetFieldId "${targetFieldId}" does not exist in the canonical field catalog`
    };
  }

  try {
    const candidate = ImportedResumeFieldCandidateSchema.parse({
      id: `field:${targetFieldId}:${block.id}:${sourceQuote}`,
      targetFieldId,
      value,
      sourceBlockIds: [block.id],
      sourceRanges: block.normalizedText.includes(sourceQuote)
        ? [{
            blockId: block.id,
            start: block.normalizedText.indexOf(sourceQuote),
            end: block.normalizedText.indexOf(sourceQuote) + sourceQuote.length
          }]
        : undefined,
      sourceQuote,
      confidence,
      needsConfirmation: confidence < 0.95,
      reviewStatus: confidence >= 0.95 ? "auto_selected" : "needs_review",
      mappingReason,
      dateValue
    });
    return { ok: true, candidate };
  } catch (error) {
    return {
      ok: false,
      errorCode: "invalid_candidate",
      targetFieldId,
      detector: "fieldCandidates.safeCandidate",
      sourceBlockIds: [block.id],
      message: error instanceof Error ? error.message : "Unknown candidate creation error"
    };
  }
}

/**
 * Compute consumed character ranges from confirmed/accepted candidates.
 * Includes high-confidence candidates (>= 0.9) even if needsConfirmation is true,
 * since they are auto-confirmable. Low-confidence tentative candidates are excluded.
 */
export function computeConsumedRanges(
  candidates: ImportedResumeFieldCandidate[],
  blocks: readonly NormalizedSourceBlock[]
): ConsumedSourceRange[] {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const ranges: ConsumedSourceRange[] = [];

  for (const c of candidates) {
    if (c.reviewStatus === "rejected" || c.reviewStatus === "needs_review") continue;
    for (const blockId of c.sourceBlockIds) {
      const block = blockById.get(blockId);
      if (!block) continue;
      const quote = c.sourceQuote;
      const idx = block.normalizedText.indexOf(quote);
      if (idx >= 0) {
        ranges.push({
          blockId,
          start: idx,
          end: idx + quote.length,
          targetFieldId: c.targetFieldId,
          candidateId: c.id
        });
      }
    }
  }

  // Merge overlapping ranges per block
  return mergeOverlappingRanges(ranges);
}

/**
 * Compute residual (unmapped) text segments from blocks after subtracting consumed ranges.
 */
export function computeResidualSegments(
  consumedRanges: ConsumedSourceRange[],
  blocks: readonly NormalizedSourceBlock[]
): ResidualSourceSegment[] {
  const rangesByBlock = new Map<string, ConsumedSourceRange[]>();
  for (const range of consumedRanges) {
    const existing = rangesByBlock.get(range.blockId) ?? [];
    existing.push(range);
    rangesByBlock.set(range.blockId, existing);
  }

  const residuals: ResidualSourceSegment[] = [];
  for (const block of blocks) {
    const blockRanges = (rangesByBlock.get(block.id) ?? []).sort((a, b) => a.start - b.start);
    let cursor = 0;
    for (const range of blockRanges) {
      if (range.start > cursor) {
        const rawText = block.normalizedText.slice(cursor, range.start);
        const normalized = rawText.replace(/\s+/g, " ").trim();
        if (normalized && !isOnlyPunctuationOrSeparators(normalized)) {
          residuals.push({
            blockId: block.id,
            start: cursor,
            end: range.start,
            rawText,
            normalizedText: normalized
          });
        }
      }
      cursor = Math.max(cursor, range.end);
    }
    if (cursor < block.normalizedText.length) {
      const rawText = block.normalizedText.slice(cursor);
      const normalized = rawText.replace(/\s+/g, " ").trim();
      if (normalized && !isOnlyPunctuationOrSeparators(normalized)) {
        residuals.push({
          blockId: block.id,
          start: cursor,
          end: block.normalizedText.length,
          rawText,
          normalizedText: normalized
        });
      }
    }
  }
  return residuals;
}

function isOnlyPunctuationOrSeparators(text: string): boolean {
  return /^[\s\p{P}\p{S}\-–—~·•●▪|/\\,，。；;：:、]+$/u.test(text);
}

function mergeOverlappingRanges(ranges: ConsumedSourceRange[]): ConsumedSourceRange[] {
  const byBlock = new Map<string, ConsumedSourceRange[]>();
  for (const r of ranges) {
    const existing = byBlock.get(r.blockId) ?? [];
    existing.push(r);
    byBlock.set(r.blockId, existing);
  }

  const merged: ConsumedSourceRange[] = [];
  for (const [, blockRanges] of byBlock) {
    const sorted = blockRanges.sort((a, b) => a.start - b.start || b.end - a.end);
    let current = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i];
      if (next.start <= current.end) {
        // Overlap: extend current to cover both
        current = {
          ...current,
          end: Math.max(current.end, next.end),
          candidateId: `${current.candidateId},${next.candidateId}`
        };
      } else {
        merged.push(current);
        current = next;
      }
    }
    merged.push(current);
  }
  return merged;
}

function findPatternSpans(text: string, pattern: RegExp): Array<{ start: number; end: number; match: string }> {
  const spans: Array<{ start: number; end: number; match: string }> = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length, match: m[0] });
  }
  return spans;
}

function spansOverlap(a: { start: number; end: number }, b: { start: number; end: number }) {
  return a.start < b.end && b.start < a.end;
}

function isInsideClaimedSpan(start: number, end: number, claimedSpans: Array<{ start: number; end: number }>) {
  return claimedSpans.some((span) => start >= span.start && end <= span.end);
}

/**
 * Normalize phone candidate: strip spaces, dashes, parentheses, and +86 prefix.
 * Returns the cleaned digit string and whether it's a valid CN mobile.
 */
function normalizePhoneCandidate(raw: string): { digits: string; normalized: string; isMobile: boolean } {
  // Handle +86 prefix
  let cleaned = raw.replace(/^\+86[\s\-]?/, "");
  // Remove spaces, dashes, parentheses
  cleaned = cleaned.replace(/[\s\-()（）]/g, "");
  const digits = cleaned;
  const isMobile = /^1[3-9]\d{9}$/.test(digits);
  return { digits, normalized: digits, isMobile };
}

function findPhoneMatchesExcluding(
  text: string,
  claimedSpans: Array<{ start: number; end: number }>
): Array<{ value: string; confidence: number; reason: string }> {
  const results: Array<{ value: string; confidence: number; reason: string }> = [];
  const dateRangeSpans = findPatternSpans(text, DATE_RANGE_PATTERN);

  // First: try separated phone pattern (138-0013-8000, 138 0013 8000, +86 138 0013 8000)
  const separatedRe = new RegExp(PHONE_SEPARATED_PATTERN.source, "g");
  let m: RegExpExecArray | null;
  while ((m = separatedRe.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (isInsideClaimedSpan(start, end, claimedSpans)) continue;
    if (dateRangeSpans.some((dr) => spansOverlap({ start, end }, dr))) continue;
    const { digits, isMobile } = normalizePhoneCandidate(m[0]);
    if (!isMobile) continue;
    // Exclude if inside email
    const context = text.slice(Math.max(0, start - 5), end + 5);
    if (/@/.test(context)) continue;
    results.push({ value: digits, confidence: 0.97, reason: "电话号码格式可从来源逐字定位" });
  }

  // Second: standard CN mobile pattern (no separators)
  const mobileRe = new RegExp(CN_MOBILE_PATTERN.source, "g");
  while ((m = mobileRe.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (isInsideClaimedSpan(start, end, claimedSpans)) continue;
    if (dateRangeSpans.some((dr) => spansOverlap({ start, end }, dr))) continue;
    // Skip if already captured by separated pattern
    if (results.some((r) => r.value === m![0])) continue;
    results.push({ value: m[0], confidence: 0.97, reason: "电话号码格式可从来源逐字定位" });
  }

  // Third: generic phone patterns (landline, international)
  const genericRe = /(?:\+?\d[\d\s\-]{7,}\d)/g;
  while ((m = genericRe.exec(text)) !== null) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (isInsideClaimedSpan(start, end, claimedSpans)) continue;
    if (dateRangeSpans.some((dr) => spansOverlap({ start, end }, dr))) continue;
    const { digits, isMobile } = normalizePhoneCandidate(m[0]);
    if (isMobile) continue; // Already captured above
    if (digits.length < 11) continue;
    if (/[@.]\s*[a-z]{2,}/i.test(text.slice(Math.max(0, start - 1), end + 10))) continue;
    results.push({ value: m[0].replace(/\s+/g, " ").trim(), confidence: 0.85, reason: "电话号码格式可从来源逐字定位" });
  }

  return results;
}

export function validateFieldCandidates(
  candidates: readonly ImportedResumeFieldCandidate[],
  blocks: readonly NormalizedSourceBlock[]
): FieldCandidateValidationIssue[] {
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const issues: FieldCandidateValidationIssue[] = [];
  const candidatesByBlock = new Map<string, ImportedResumeFieldCandidate[]>();
  for (const candidate of candidates) {
    const field = getResumeFieldDefinition(candidate.targetFieldId as CanonicalFieldId);
    if (!field || !matchesValueType(field.valueType, candidate.value)) {
      issues.push({ candidateId: candidate.id, code: "value_type_mismatch", message: `候选值类型与 ${candidate.targetFieldId} 不一致` });
    }
    for (const sourceBlockId of candidate.sourceBlockIds) {
      const source = byId.get(sourceBlockId);
      if (!source) {
        issues.push({ candidateId: candidate.id, code: "unknown_source", message: `来源块不存在：${sourceBlockId}` });
        continue;
      }
      candidatesByBlock.set(sourceBlockId, [...(candidatesByBlock.get(sourceBlockId) ?? []), candidate]);
      if (!normalize(source.rawText).includes(normalize(candidate.sourceQuote))) {
        issues.push({ candidateId: candidate.id, code: "quote_not_found", message: `来源引文无法在 ${sourceBlockId} 中定位` });
      }
      if (typeof candidate.value === "number" && !sourceContainsNumber(source.rawText, candidate.value)) {
        issues.push({ candidateId: candidate.id, code: "number_drift", message: `数值 ${candidate.value} 未在来源块中逐值出现` });
      }
    }
  }
  for (const [sourceBlockId, shared] of candidatesByBlock) {
    const targets = new Set(shared.map((candidate) => candidate.targetFieldId));
    if (targets.size <= 1) continue;
    for (const candidate of shared.filter((item) =>
      !item.needsConfirmation
      && !item.userConfirmed
      && shared.some((other) => other.id !== item.id && candidateRangesOverlap(item, other, sourceBlockId))
    )) {
      issues.push({ candidateId: candidate.id, code: "one_source_many_targets", message: `来源块 ${sourceBlockId} 映射到多个字段，必须逐项确认` });
    }
  }
  return issues;
}

export function canSilentlyAcceptFieldCandidate(
  candidate: ImportedResumeFieldCandidate,
  candidates: readonly ImportedResumeFieldCandidate[],
  blocks: readonly NormalizedSourceBlock[]
) {
  if (candidate.confidence < 0.95 || candidate.needsConfirmation || candidate.reviewStatus !== "auto_selected") return false;
  return !validateFieldCandidates(candidates, blocks).some((issue) => issue.candidateId === candidate.id);
}

function requireConfirmationForSharedSources(candidates: ImportedResumeFieldCandidate[]) {
  return candidates.map((candidate) => candidates.some((other) =>
    other.id !== candidate.id
    && candidate.sourceBlockIds.some((blockId) =>
      other.sourceBlockIds.includes(blockId)
      && candidateRangesOverlap(candidate, other, blockId)
    )
  )
    ? { ...candidate, needsConfirmation: true, reviewStatus: "needs_review" as const }
    : candidate);
}

function candidateRangesOverlap(
  left: ImportedResumeFieldCandidate,
  right: ImportedResumeFieldCandidate,
  blockId: string
) {
  const leftRanges = left.sourceRanges?.filter((range) => range.blockId === blockId) ?? [];
  const rightRanges = right.sourceRanges?.filter((range) => range.blockId === blockId) ?? [];
  if (!leftRanges.length || !rightRanges.length) return true;
  return leftRanges.some((leftRange) => rightRanges.some((rightRange) =>
    leftRange.start < rightRange.end && rightRange.start < leftRange.end
  ));
}

function dedupeCandidates(candidates: ImportedResumeFieldCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.targetFieldId} ${JSON.stringify(candidate.value)} ${candidate.sourceBlockIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchesValueType(type: ResumeFieldValueType | undefined, value: ImportedResumeFieldCandidate["value"]) {
  if (!type) return false;
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "string_list") return Array.isArray(value) && value.every((item) => typeof item === "string");
  return typeof value === "string";
}

function sourceContainsNumber(source: string, expected: number) {
  const numbers = source.match(/[-+]?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers.some((number) => Object.is(number, expected));
}

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

// Re-export getResumeFieldDefinition for validateFieldCandidates
import { getResumeFieldDefinition } from "@/domain/resumeFields";
