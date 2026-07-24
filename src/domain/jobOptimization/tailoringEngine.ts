import { buildCanonicalJobRequirementGraphV3 } from "./v3";
import type {
  BranchContentItem,
  CareerProfile,
  JobDescription,
  MatchEvidenceRef,
  ResumeBranch,
  ResumeItemV2,
  TailoringIntensity,
  TailoringJobContext,
  TailoringRequirement,
  TailoringSectionPolicy,
  TailoringSuggestion
} from "@/domain/schemas";
import { TailoringSuggestionSchema } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { migrateBranchContentItem } from "@/domain/migrations/resumeV2";
import { ResumeTailorTaskInputV2Schema, type ResumeTailorTaskInputV2 } from "@/domain/schemas";
import { tailoringTargetPriority } from "./confirmation";
import { buildCandidateEvidenceUnits } from "./v2/evidence";
import { resolveBranchFactRefs } from "@/domain/branch/validation";

const GENERIC_REQUIREMENT = "负责AI领域的软件工程化和产品开发";
const sectionOrder: Record<TailoringSectionPolicy, number> = { summary: 0, skills: 1, project: 2, work: 3, internship: 3, ordering: 4 };

export type TailoringDeltaValidation = {
  valid: boolean;
  status: "ready" | "no_change_needed" | "invalid_ai_output";
  reasons: string[];
  metrics: { textChangeRatio: number; keywordGain: number };
  coveredKeywordsBefore: string[];
  coveredKeywordsAfter: string[];
};

export function buildTailoringJobContext(job: JobDescription): TailoringJobContext {
  const graph = buildCanonicalJobRequirementGraphV3(job);
  const requirements = graph.requirements.map((item) => ({
    description: item.statement, category: item.kind, priority: item.priority, keywords: unique([...item.exactKeywords, ...item.details.flatMap((detail) => tokenize(detail.text))])
  }));
  const byCategory = (categories: string[]) => requirements.filter((item) => categories.includes(item.category)).map((item) => item.description);
  const keywords = unique(requirements.flatMap((item) => item.keywords).filter(isUsefulKeyword));
  return {
    title: job.title,
    company: job.company || undefined,
    rawText: job.rawText,
    roleMission: graph.roleProfile.mission ?? byCategory(["responsibility"])[0] ?? requirements[0]?.description,
    responsibilities: byCategory(["responsibility"]),
    mustHave: requirements.filter((item) => item.priority === "must" || item.priority === "high" || ["must_have", "required_skill", "core_skill"].includes(item.category)).map((item) => item.description),
    niceToHave: requirements.filter((item) => item.priority === "nice_to_have" || ["nice_to_have", "preferred_skill"].includes(item.category)).map((item) => item.description),
    verificationMaterials: graph.verificationMaterials.map((item) => item.label),
    hiringSignals: graph.roleProfile.hiringSignals.map((item) => item.statement),
    tools: unique(requirements.filter((item) => ["tool", "required_skill", "core_skill"].includes(item.category)).flatMap((item) => item.keywords)),
    keywords
  };
}

export function routeTailoringRequirements(input: {
  job: JobDescription;
  sectionType: TailoringSectionPolicy;
  renderedText: string;
  itemId?: string;
}): TailoringRequirement[] {
  const graph = buildCanonicalJobRequirementGraphV3(input.job);
  const source = graph.requirements.map((item) => ({
    id: item.id, description: item.statement, priority: item.priority, category: item.kind, keywords: unique([...item.exactKeywords, ...item.details.flatMap((detail) => tokenize(detail.text))])
  }));
  const haystack = normalize(`${input.itemId ?? ""} ${input.renderedText}`);
  return source.map((item) => {
    const keywordHits = unique(item.keywords).filter((keyword) => haystack.includes(normalize(keyword))).length;
    const descriptionHits = tokenize(item.description).filter((token) => token.length > 1 && haystack.includes(token)).length;
    const categoryScore = categoryRelevance(input.sectionType, item.category);
    const priorityScore = item.priority === "must" || item.priority === "high" ? 4 : item.priority === "medium" ? 2 : 0;
    return {
      requirementId: item.id,
      description: item.description,
      priority: item.priority,
      keywords: unique(item.keywords.filter(isUsefulKeyword)),
      // categoryRelevance bottoms out at -3. Offset every score equally so the
      // Zod contract stays non-negative without changing requirement ordering.
      relevanceScore: keywordHits * 12 + descriptionHits * 2 + categoryScore + priorityScore + 3
    };
  }).filter((item) => item.description !== GENERIC_REQUIREMENT || source.length === 1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || a.requirementId.localeCompare(b.requirementId))
    .slice(0, input.sectionType === "summary" ? 4 : 3);
}

// 检测通用前缀（这些前缀不增加价值，只是机械地添加）
const GENERIC_PREFIXES = [
  "围绕任务背景、任务目标、输入与约束",
  "围绕任务背景、任务目标、输入与约束复现问题、定位原因并验证结果",
  "围绕多步骤开发任务、长流程代码修改、真实环境配置与调试",
  "围绕多步骤开发任务、长流程代码修改、真实环境配置与调试复现问题、定位原因并验证结果"
];

function containsGenericPrefix(text: string): boolean {
  const normalized = normalize(text);
  return GENERIC_PREFIXES.some((prefix) => normalized.startsWith(normalize(prefix)));
}

export function validateTailoringDelta(input: {
  before: string | string[];
  after: string | string[] | null | undefined;
  intensity: TailoringIntensity;
  targetKeywords: string[];
  sectionType: TailoringSectionPolicy;
  rationale?: string;
  requirementDescriptions?: string[];
}): TailoringDeltaValidation {
  const before = render(input.before);
  const after = input.after == null ? "" : render(input.after);
  const normalizedBefore = normalizeComparable(before);
  const normalizedAfter = normalizeComparable(after);
  const coveredKeywordsBefore = covered(input.targetKeywords, before);
  const coveredKeywordsAfter = covered(input.targetKeywords, after);
  const keywordGain = Math.max(0, coveredKeywordsAfter.length - coveredKeywordsBefore.length);
  const textChangeRatio = changeRatio(normalizedBefore, normalizedAfter);
  const reasons: string[] = [];
  if (!normalizedAfter) reasons.push("missing_after");
  if (normalizedAfter === normalizedBefore) reasons.push("copied_original");
  if (input.sectionType === "summary" && looksLikeTruncatedSummary(before, after)) reasons.push("truncated_summary");
  if (containsResumeAnalysisBoilerplate(after)) reasons.push("resume_analysis_boilerplate");
  const minimum = adjustedMinimum(input.intensity, input.sectionType, normalizedBefore.length);
  if (textChangeRatio < minimum) reasons.push("insufficient_text_delta");
  if (input.intensity === "conservative" && normalizedBefore.length >= 30 && textChangeRatio > 0.34) reasons.push("conservative_delta_too_large");
  // Legacy suggestions keep textChangeRatio as a diagnostic. Diff V3 validates by operation.
  const usefulTargets = unique(input.targetKeywords.filter(isUsefulKeyword));
  if (input.targetKeywords.length > 0 && usefulTargets.length === 0) reasons.push("generic_target_keywords");

  // 检查是否有重复内容（after 中出现两遍相同的 before 内容）
  if (Array.isArray(input.after) && input.after.length > 1) {
    const afterTexts = input.after.map((item) => normalizeComparable(String(item)));
    const duplicates = afterTexts.filter((text, index) => afterTexts.indexOf(text) !== index);
    if (duplicates.length > 0) reasons.push("duplicate_content_in_after");
  }

  // 检查是否只添加了通用前缀（没有实质性改写）
  if (containsGenericPrefix(after)) {
    // 检查去掉前缀后是否和原文一样
    const afterWithoutPrefix = after.replace(/^围绕[^：：]*[：:]\s*/, "").trim();
    if (normalizeComparable(afterWithoutPrefix) === normalizeComparable(before)) {
      reasons.push("generic_prefix_only");
    }
  }

  // 检查垃圾数据：布尔值、单个工具名、过短文本
  const normalizedAfterTrimmed = normalizedAfter.trim().toLowerCase();
  if (normalizedAfterTrimmed === "true" || normalizedAfterTrimmed === "false") {
    reasons.push("invalid_boolean_output");
  }
  const singleToolNames = ["cursor", "claude code", "codex", "windsurf", "github copilot"];
  if (singleToolNames.includes(normalizedAfterTrimmed)) {
    reasons.push("invalid_single_tool_name");
  }
  if (after.length > 0 && after.length < 10 && !Array.isArray(input.after)) {
    reasons.push("output_too_short");
  }

  if (input.rationale !== undefined) {
    const rationale = normalize(input.rationale);
    // 放宽规则：只要 rationale 长度足够就允许，不要求精确匹配关键词
    const related = [...usefulTargets, ...(input.requirementDescriptions ?? [])].some((value) => tokenize(value).some((token) => token.length > 1 && rationale.includes(token)));
    // 只有当 rationale 太短或太通用时才拒绝
    if (!related && rationale.length < 10) reasons.push("irrelevant_rationale");
    if ((input.requirementDescriptions ?? []).some((description) => normalizeComparable(description) === normalizeComparable(input.rationale!))) reasons.push("rationale_copies_requirement");
    if (normalizeComparable(input.rationale) === normalizeComparable(GENERIC_REQUIREMENT)) reasons.push("generic_rationale");
  }
  return {
    valid: reasons.length === 0,
    status: !normalizedAfter ? "invalid_ai_output" : normalizedAfter === normalizedBefore ? "no_change_needed" : reasons.length ? "invalid_ai_output" : "ready",
    reasons,
    metrics: { textChangeRatio, keywordGain },
    coveredKeywordsBefore,
    coveredKeywordsAfter
  };
}

export function aggregateDelta(suggestions: TailoringSuggestion[]) {
  if (!suggestions.length) return 0;
  return suggestions.reduce((total, suggestion) => total + suggestion.metrics.textChangeRatio, 0) / suggestions.length;
}

export function createDeterministicTailoringSuggestions(input: {
  branch: ResumeBranch;
  job: JobDescription;
  intensity: TailoringIntensity;
  operationId: string;
  resolveEvidenceRefs: (item: BranchContentItem) => MatchEvidenceRef[];
}): TailoringSuggestion[] {
  if (input.intensity !== "conservative") return [];
  const candidates = input.branch.contentItems.filter((item) => item.visible && item.itemType !== "structural")
    .map((item) => targetFor(input.branch, item))
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
    .sort(compareTailoringTargets);
  const suggestions: TailoringSuggestion[] = [];
  for (const target of candidates) {
    const relevant = routeTailoringRequirements({ job: input.job, sectionType: target.sectionType, renderedText: target.renderedText, itemId: target.item.id });
    if (!relevant.length) continue;
    const targetKeywords = unique(relevant.flatMap((item) => item.keywords).filter(isUsefulKeyword)).slice(0, 8);
    const after = mapFieldValue(target.before, alignKeywordVariants);
    const rationale = "仅执行完全等价的术语、标点或格式规范化，不新增能力或职责。";
    const validation = validateTailoringDelta({ before: target.before, after, intensity: input.intensity, targetKeywords, sectionType: target.sectionType, rationale, requirementDescriptions: relevant.map((item) => item.description) });
    if (!validation.valid) continue;
    suggestions.push(TailoringSuggestionSchema.parse({
      id: `tailoring-${stableHashText(`${input.operationId}:${target.item.id}:${target.fieldPath}`)}`,
      intensity: input.intensity,
      operation: "rewrite",
      targetSectionType: target.sectionType,
      targetSectionId: target.sectionType,
      targetItemId: target.item.id,
      targetFieldPath: target.fieldPath,
      before: target.before,
      after,
      changedFields: [target.fieldPath.split(".").at(-1)?.replace(/\[\d+\]$/, "") ?? target.fieldPath],
      requirementIds: relevant.map((item) => item.requirementId),
      targetKeywords,
      coveredKeywordsBefore: validation.coveredKeywordsBefore,
      coveredKeywordsAfter: validation.coveredKeywordsAfter,
      claimSupportLevel: "verified",
      evidenceRefs: input.resolveEvidenceRefs(target.item),
      rationale,
      riskLevel: "low",
      metrics: validation.metrics,
      status: "ready"
    }));
  }
  return suggestions;
}

export function createResumeTailorTaskInputs(input: {
  draftId: string;
  profileId: string;
  branch: ResumeBranch;
  job: JobDescription;
  intensity: TailoringIntensity;
  profile?: CareerProfile;
  resolveEvidenceRefs: (item: BranchContentItem) => MatchEvidenceRef[];
}): ResumeTailorTaskInputV2[] {
  const jobContext = buildTailoringJobContext(input.job);
  return input.branch.contentItems.filter((item) => item.visible && item.itemType !== "structural")
    .map((item) => targetFor(input.branch, item))
    .filter((target): target is NonNullable<typeof target> => Boolean(target))
    .sort(compareTailoringTargets)
    .flatMap((target) => {
      const relevantRequirements = routeTailoringRequirements({ job: input.job, sectionType: target.sectionType, renderedText: target.renderedText, itemId: target.item.id });
      if (!relevantRequirements.length) return [];
      const evidenceBundle = input.profile ? buildTailoringEvidenceBundle({ profile: input.profile, branch: input.branch, target: { itemId: target.item.id }, requirements: relevantRequirements }) : undefined;
      const allowedFacts = evidenceBundle ? [...evidenceBundle.directEvidence, ...evidenceBundle.relatedResumeEvidence, ...evidenceBundle.relatedProfileEvidence].slice(0, 12) : [];
      const allowedEvidenceRefs = allowedFacts.length ? dedupeEvidenceRefs(allowedFacts.flatMap((fact) => fact.evidenceRefs)) : input.resolveEvidenceRefs(target.item);
      const structuredItem = input.branch.structuredContentItems?.find((item) => item.id === target.item.id)?.data ?? migrateBranchContentItem(target.item).data;
      return [ResumeTailorTaskInputV2Schema.parse({
        draftId: input.draftId,
        profileId: input.profileId,
        jobId: input.job.id,
        intensity: input.intensity,
        jobContext,
        target: { sectionType: target.sectionType, sectionId: target.sectionType, itemId: target.item.id, fieldPath: target.fieldPath },
        currentContent: { structuredItem, fieldValue: target.before, renderedText: target.renderedText },
        relevantRequirements,
        allowedEvidenceRefs,
        evidenceBundle,
        allowedFacts: allowedFacts.length ? allowedFacts : unique(allowedEvidenceRefs.map((ref) => ref.factText)).map((value) => ({ value, evidenceRefs: allowedEvidenceRefs.filter((ref) => ref.factText === value) }))
      })];
    })
    .sort(compareTailoringTaskInputs);
}

export function buildTailoringEvidenceBundle(input: {
  profile: CareerProfile;
  branch: ResumeBranch;
  target: { itemId: string };
  requirements: TailoringRequirement[];
}) {
  const units = buildCandidateEvidenceUnits({ profile: input.profile, branch: input.branch });
  const terms = unique(input.requirements.flatMap((requirement) => [...requirement.keywords, ...tokenize(requirement.description)])).filter((term) => term.length > 1);
  const ranked = units.map((unit) => ({ unit, score: terms.reduce((score, term) => score + (normalize(unit.text).includes(normalize(term)) ? 1 : 0), 0) }))
    .filter(({ unit, score }) => unit.supportLevel === "verified" && (score > 0 || unit.itemId === input.target.itemId))
    .sort((a, b) => (b.unit.itemId === input.target.itemId ? 1 : 0) - (a.unit.itemId === input.target.itemId ? 1 : 0) || b.score - a.score)
    .slice(0, 12);
  const toFact = (entry: typeof ranked[number]) => ({ value: entry.unit.text, evidenceRefs: dedupeEvidenceRefs(resolveBranchFactRefs(input.profile, entry.unit.factRefs)) });
  const directEvidence = ranked.filter(({ unit }) => unit.itemId === input.target.itemId).map(toFact);
  const relatedResumeEvidence = ranked.filter(({ unit }) => unit.itemId !== input.target.itemId).map(toFact);
  const usedRefs = new Set([...directEvidence, ...relatedResumeEvidence].flatMap((fact) => fact.evidenceRefs).map((ref) => JSON.stringify(ref)));
  const relatedProfileEvidence = profileEvidenceFacts(input.profile).map((fact) => ({ ...fact, score: terms.reduce((score, term) => score + (normalize(fact.value).includes(normalize(term)) ? 1 : 0), 0) }))
    .filter((fact) => fact.score > 0 && fact.evidenceRefs.some((ref) => !usedRefs.has(JSON.stringify(ref))))
    .sort((a, b) => b.score - a.score).slice(0, Math.max(0, 12 - directEvidence.length - relatedResumeEvidence.length))
    .map(({ value, evidenceRefs }) => ({ value, evidenceRefs }));
  return {
    directEvidence,
    relatedResumeEvidence,
    relatedProfileEvidence,
    confirmableSignals: unique(input.requirements.flatMap((requirement) => requirement.keywords)).filter((keyword) => !ranked.some(({ unit }) => normalize(unit.text).includes(normalize(keyword)))).slice(0, 8)
  };
}

function profileEvidenceFacts(profile: CareerProfile) {
  const confirmed = (fact: CareerProfile["experiences"][number]["facts"][number]) => fact.confirmedByUser && fact.riskLevel !== "high" && fact.provenance.some((item) => item.confirmedByUser);
  return [
    ...profile.experiences.flatMap((experience) => experience.facts.filter(confirmed).map((fact) => ({ value: fact.statement, evidenceRefs: resolveBranchFactRefs(profile, [{ type: "experience_fact" as const, experienceId: experience.id, factId: fact.id }]) }))),
    ...profile.skills.flatMap((skill) => skill.fact && confirmed(skill.fact) ? [{ value: skill.fact.statement, evidenceRefs: resolveBranchFactRefs(profile, [{ type: "skill_fact" as const, skillId: skill.id, factId: skill.fact.id }]) }] : []),
    ...profile.certificates.flatMap((certificate) => certificate.fact && confirmed(certificate.fact) ? [{ value: certificate.fact.statement, evidenceRefs: resolveBranchFactRefs(profile, [{ type: "certificate_fact" as const, certificateId: certificate.id, factId: certificate.fact.id }]) }] : [])
  ];
}

function dedupeEvidenceRefs(refs: MatchEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => { const key = JSON.stringify(ref); if (seen.has(key)) return false; seen.add(key); return true; });
}

function targetFor(branch: ResumeBranch, item: BranchContentItem) {
  const structured = branch.structuredContentItems?.find((candidate) => candidate.id === item.id)?.data as ResumeItemV2 | undefined;
  const rawSection = structured?.sectionType ?? (item.itemType === "summary" ? "summary" : item.itemType === "skill" ? "skills" : item.sourceSectionId);
  const sectionType = (["summary", "skills", "project", "work", "internship"] as const).find((section) => section === rawSection)
    ?? (item.itemType === "experience" ? "project" : undefined);
  if (!sectionType) return undefined;
  if (structured?.sectionType === "summary") return { item, sectionType, before: structured.text, renderedText: item.text, fieldPath: `sections.summary.items.${item.id}.text` };
  if (structured?.sectionType === "skills") return { item, sectionType, before: structured.description || structured.name, renderedText: item.text, fieldPath: `sections.skills.items.${item.id}.description` };
  if (structured && ["project", "work", "internship"].includes(structured.sectionType)) {
    const highlights = "highlights" in structured ? structured.highlights : [];
    if (highlights.length) return { item, sectionType, before: highlights, renderedText: item.text, fieldPath: `sections.${sectionType}.items.${item.id}.highlights` };
    if ("description" in structured && structured.description) return { item, sectionType, before: structured.description, renderedText: item.text, fieldPath: `sections.${sectionType}.items.${item.id}.description` };
    return undefined;
  }
  const field = sectionType === "summary" ? "text" : sectionType === "skills" ? "description" : "highlights";
  return { item, sectionType, before: item.text, renderedText: item.text, fieldPath: `sections.${sectionType}.items.${item.id}.${field}` };
}

function categoryRelevance(section: TailoringSectionPolicy, category: string) {
  const skills = ["required_skill", "preferred_skill", "core_skill", "tool", "language"];
  if (section === "skills") return skills.includes(category) ? 9 : -3;
  if (section === "project") return [...skills, "responsibility"].includes(category) ? 7 : 0;
  if (section === "work" || section === "internship") return ["responsibility", "experience", "soft_skill"].includes(category) ? 8 : 0;
  if (section === "summary") return ["responsibility", "must_have", "required_skill", "core_skill"].includes(category) ? 6 : 1;
  return 0;
}

function adjustedMinimum(intensity: TailoringIntensity, section: TailoringSectionPolicy, length: number) {
  const base = intensity === "conservative" ? 0.05 : intensity === "balanced" ? 0.1 : 0.25;
  if (length < 24) return Math.min(base, intensity === "conservative" ? 0.03 : intensity === "balanced" ? 0.08 : 0.2);
  if (section === "skills" && length < 50) return base * 0.7;
  return base;
}

function changeRatio(before: string, after: string) {
  if (!before && !after) return 0;
  const distance = levenshtein(before, after);
  return Number(Math.min(1, distance / Math.max(before.length, after.length, 1)).toFixed(4));
}

function levenshtein(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

function normalizeComparable(value: string) { return value.replace(/<[^>]+>/g, "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase(); }
function normalize(value: string) { return value.trim().replace(/\s+/g, " ").toLowerCase(); }
function tokenize(value: string) { return unique(normalize(value).split(/[^\p{L}\p{N}+#.]+/u).filter(Boolean)); }
function render(value: string | string[]) { return Array.isArray(value) ? value.join("\n") : value; }
function mapFieldValue(value: string | string[], transform: (item: string) => string) { return Array.isArray(value) ? value.map(transform) : transform(value); }
function alignKeywordVariants(value: string) {
  return value
    .replace(/React\.js|ReactJS/gi, "React")
    .replace(/NextJS/gi, "Next.js")
    .replace(/Type Script/gi, "TypeScript")
    .replace(/ClaudeCode/gi, "Claude Code")
    .replace(/Play Wright/gi, "Playwright");
}
function covered(keywords: string[], text: string) { const normalized = normalize(text); return unique(keywords.filter((keyword) => isUsefulKeyword(keyword) && normalized.includes(normalize(keyword)))); }
function isUsefulKeyword(keyword: string) {
  const normalized = normalize(keyword);
  return normalized.length > 1 && !["ai", "人工智能", "coding", "agent", "vibe"].includes(normalized);
}
function unique<T>(values: T[]) { return Array.from(new Set(values)); }

function compareTailoringTargets(a: NonNullable<ReturnType<typeof targetFor>>, b: NonNullable<ReturnType<typeof targetFor>>) {
  if (a.sectionType === "summary" || b.sectionType === "summary") return sectionOrder[a.sectionType] - sectionOrder[b.sectionType];
  const relevance = tailoringTargetPriority(b.item.id, b.renderedText) - tailoringTargetPriority(a.item.id, a.renderedText);
  return relevance || sectionOrder[a.sectionType] - sectionOrder[b.sectionType] || a.item.order - b.item.order;
}

function compareTailoringTaskInputs(a: ResumeTailorTaskInputV2, b: ResumeTailorTaskInputV2) {
  const experienceSections = new Set(["project", "work", "internship"]);
  if (experienceSections.has(a.target.sectionType) && experienceSections.has(b.target.sectionType)) {
    const score = taskEvidenceScore(b) - taskEvidenceScore(a);
    if (score) return score;
  }
  return sectionOrder[a.target.sectionType] - sectionOrder[b.target.sectionType];
}

function taskEvidenceScore(input: ResumeTailorTaskInputV2) {
  return Math.max(0, ...input.relevantRequirements.map((item) => item.relevanceScore)) + input.allowedEvidenceRefs.length * 10;
}

function looksLikeTruncatedSummary(before: string, after: string) {
  const trimmed = after.trim();
  if (!trimmed || /[…\.。！？!?；;：:]$/.test(trimmed)) return false;
  return before.trim().length >= 40 && trimmed.length < before.trim().length;
}

function containsResumeAnalysisBoilerplate(text: string) {
  return /此经验可迁移到|该能力适用于|该实践积累了|为目标岗位提供方法论基础|此工作流为.+提供/.test(text);
}
