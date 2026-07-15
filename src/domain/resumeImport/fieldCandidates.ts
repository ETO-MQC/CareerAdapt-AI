import { getResumeFieldDefinition, type CanonicalFieldId, type ResumeFieldValueType, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import {
  ImportedResumeFieldCandidateSchema,
  type ImportedResumeFieldCandidate,
  type NormalizedSourceBlock
} from "@/domain/schemas";
import { alignResumeDateRange } from "./dates";

export type FieldCandidateValidationIssue = {
  candidateId: string;
  code: "unknown_source" | "quote_not_found" | "number_drift" | "value_type_mismatch" | "one_source_many_targets";
  message: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{7,}\d|1[3-9]\d{9})/g;
const URL_PATTERN = /(?:https?:\/\/|www\.|github\.com\/|linkedin\.com\/)[^\s，。；;]+/gi;
const GPA_PATTERN = /GPA\s*[:：]?\s*(\d+(?:\.\d+)?)\s*[/／]\s*(\d+(?:\.\d+)?)/i;
const RANK_PATTERN = /(?:专业)?排名\s*[:：]?\s*(\d+)\s*[/／]\s*(\d+)/i;

const SECTION_PATTERNS: Array<[RegExp, ResumeSectionTypeV2]> = [
  [/^(?:教育背景|教育经历|education)\s*[:：]?$/i, "education"],
  [/^(?:工作经历|工作经验|work experience|employment)\s*[:：]?$/i, "work"],
  [/^(?:实习经历|internships?)\s*[:：]?$/i, "internship"],
  [/^(?:项目经历|projects?)\s*[:：]?$/i, "project"],
  [/^(?:科研经历|research)\s*[:：]?$/i, "research"],
  [/^(?:校园经历|campus experience|leadership)\s*[:：]?$/i, "campus"],
  [/^(?:志愿经历|volunteer)\s*[:：]?$/i, "volunteer"],
  [/^(?:技能|专业技能|skills?)\s*[:：]?$/i, "skills"],
  [/^(?:证书|certificates?)\s*[:：]?$/i, "certificates"],
  [/^(?:语言|languages?)\s*[:：]?$/i, "languages"]
];

const DATE_SECTIONS = new Set<ResumeSectionTypeV2>(["education", "work", "internship", "project", "research", "campus", "volunteer"]);

export function createDeterministicFieldCandidates(blocks: readonly NormalizedSourceBlock[]) {
  const rawCandidates: ImportedResumeFieldCandidate[] = [];
  let activeSection: ResumeSectionTypeV2 | undefined;
  for (const block of [...blocks].sort((left, right) => left.order - right.order)) {
    const headingSection = detectSection(block.normalizedText);
    if (headingSection) {
      activeSection = headingSection;
      continue;
    }
    for (const match of block.normalizedText.match(EMAIL_PATTERN) ?? []) {
      rawCandidates.push(candidate(block, "basics.email", match, match, 0.99, "邮箱格式可从来源逐字定位"));
    }
    for (const match of block.normalizedText.match(PHONE_PATTERN) ?? []) {
      rawCandidates.push(candidate(block, "basics.phone", match, match, 0.97, "电话号码格式可从来源逐字定位"));
    }
    for (const match of block.normalizedText.match(URL_PATTERN) ?? []) {
      rawCandidates.push(candidate(block, "basics.otherLinks", [match], match, 0.96, "链接可从来源逐字定位"));
    }

    const gpa = block.normalizedText.match(GPA_PATTERN);
    if (gpa && (activeSection === "education" || /GPA/i.test(block.normalizedText))) {
      rawCandidates.push(candidate(block, "education.gpa", Number(gpa[1]), gpa[1], 0.99, "GPA 数值来自明确的分数/满分表达"));
      rawCandidates.push(candidate(block, "education.gpaScale", Number(gpa[2]), gpa[2], 0.99, "GPA 满分来自明确的分数/满分表达"));
    }
    const rank = block.normalizedText.match(RANK_PATTERN);
    if (rank && (activeSection === "education" || /排名/.test(block.normalizedText))) {
      rawCandidates.push(candidate(block, "education.rankPosition", Number(rank[1]), rank[1], 0.99, "排名位置来自明确的位置/总人数表达"));
      rawCandidates.push(candidate(block, "education.rankTotal", Number(rank[2]), rank[2], 0.99, "排名总人数来自明确的位置/总人数表达"));
    }

    if (activeSection && DATE_SECTIONS.has(activeSection)) {
      const range = alignResumeDateRange(block);
      if (range.startDate?.value) {
        rawCandidates.push(candidate(block, `${activeSection}.startDate` as CanonicalFieldId, range.startDate.value, range.startDate.sourceQuote, range.startDate.confidence, "日期与当前栏目内同一视觉行对齐", range.startDate));
      }
      if (range.endDate?.current) {
        rawCandidates.push(candidate(block, `${activeSection}.current` as CanonicalFieldId, true, range.endDate.sourceQuote, range.endDate.confidence, "当前状态来自同一视觉行中的“至今/Present”", range.endDate));
      } else if (range.endDate?.value) {
        rawCandidates.push(candidate(block, `${activeSection}.endDate` as CanonicalFieldId, range.endDate.value, range.endDate.sourceQuote, range.endDate.confidence, "结束日期与当前栏目内同一视觉行对齐", range.endDate));
      }
    }
  }
  return requireConfirmationForSharedSources(dedupeCandidates(rawCandidates));
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
    for (const candidate of shared.filter((item) => !item.needsConfirmation && !item.userConfirmed)) {
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
  if (candidate.confidence < 0.9 || candidate.needsConfirmation) return false;
  return !validateFieldCandidates(candidates, blocks).some((issue) => issue.candidateId === candidate.id);
}

function candidate(
  block: NormalizedSourceBlock,
  targetFieldId: CanonicalFieldId,
  value: ImportedResumeFieldCandidate["value"],
  sourceQuote: string,
  confidence: number,
  mappingReason: string,
  dateValue?: ImportedResumeFieldCandidate["dateValue"]
) {
  return ImportedResumeFieldCandidateSchema.parse({
    id: `field:${targetFieldId}:${block.id}:${sourceQuote}`,
    targetFieldId,
    value,
    sourceBlockIds: [block.id],
    sourceQuote,
    confidence,
    needsConfirmation: confidence < 0.9,
    mappingReason,
    dateValue
  });
}

function requireConfirmationForSharedSources(candidates: ImportedResumeFieldCandidate[]) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const blockId of candidate.sourceBlockIds) counts.set(blockId, (counts.get(blockId) ?? 0) + 1);
  }
  return candidates.map((candidate) => candidate.sourceBlockIds.some((blockId) => (counts.get(blockId) ?? 0) > 1)
    ? { ...candidate, needsConfirmation: true }
    : candidate);
}

function dedupeCandidates(candidates: ImportedResumeFieldCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.targetFieldId}\u0000${JSON.stringify(candidate.value)}\u0000${candidate.sourceBlockIds.join(",")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectSection(text: string) {
  return SECTION_PATTERNS.find(([pattern]) => pattern.test(text.trim()))?.[1];
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
