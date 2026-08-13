import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import type { CareerProfile, JobDescription, ResumeItemV2 } from "@/domain/schemas";
import {
  ResumeBlueprintSchema,
  type ResumeBlueprint,
  type ResumeEvidenceGraph,
  type ResumeKeywordCoverage
} from "./contracts";
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";
import { findTechnicalTerms, normalizeSkillGroups } from "./ResumeSkillTaxonomy";

export type ResumeBlueprintInput = {
  profile: CareerProfile;
  graph: ResumeEvidenceGraph;
  mode: "general" | "job_specific";
  job?: JobDescription;
  targetDirection?: string;
  targetAudience?: string;
  companyType?: string;
};

export const DEFAULT_RESUME_TARGET_DIRECTION = "互联网技术 / AI 应用";

export function planResumeBlueprint(input: ResumeBlueprintInput): ResumeBlueprint {
  const effectiveInput: ResumeBlueprintInput = {
    ...input,
    ...(input.mode === "general" && !input.targetDirection?.trim()
      ? { targetDirection: DEFAULT_RESUME_TARGET_DIRECTION }
      : {})
  };
  const profile = migrateCareerProfileToV2(effectiveInput.profile);
  const canonicalById = new Map(profile.structuredFacts.map((entry) => [entry.data.id, entry.data]));
  const keywordCoverage = effectiveInput.mode === "job_specific" && effectiveInput.job
    ? classifyJobKeywords(effectiveInput.job, effectiveInput.graph, canonicalById)
    : [];
  const assetCandidates: Array<{ data: ResumeItemV2; relevance: number; node?: ResumeEvidenceGraph["nodes"][number]; score: ResumeBlueprint["assets"][number]["score"] }> = effectiveInput.graph.sourceAssetIds
    .flatMap((id) => {
      const data = canonicalById.get(id);
      if (!data) return [];
      const node = effectiveInput.graph.nodes.find((candidate) => candidate.id === `asset:${id}`);
      const score = careerAssetResumeScore({ data, node, graph: effectiveInput.graph, mode: effectiveInput.mode, job: effectiveInput.job, keywordCoverage, input: effectiveInput });
      return [{ data, relevance: score.total, node, score }];
    })
    .sort((left, right) => right.relevance - left.relevance || assetTitle(left.data).localeCompare(assetTitle(right.data)));

  const selected = selectAssets(assetCandidates, effectiveInput.mode, effectiveInput);
  const assets = selected.map(({ data, relevance, node, score }) => ({
    sourceAssetId: data.id,
    sectionType: data.sectionType,
    title: assetTitle(data),
    sourceFactIds: node?.factIds ?? [],
    evidenceNodeIds: node ? [node.id] : [],
    relevance,
    inclusionReason: inclusionReason(data, effectiveInput.mode, relevance, effectiveInput, score),
    bulletPlan: bulletPlan(data),
    explicitTools: explicitTools(data, effectiveInput.graph),
    score
  }));
  const selectedIds = new Set(selected.map(({ data }) => data.id));
  const excludedAssets = assetCandidates
    .filter(({ data }) => !selectedIds.has(data.id))
    .map(({ data, relevance, score }) => ({
      sourceAssetId: data.id,
      title: assetTitle(data),
      relevance,
      reason: exclusionReason(data, relevance, effectiveInput.mode, selected, score),
      score
    }));

  const skillGroups = normalizeSkillGroups(input.graph.skillMatrix);
  const projectCount = selected.filter(({ data }) => data.sectionType === "project").length;
  const estimatedPageCount = estimatePages({
    selectedCount: selected.length,
    projectCount,
    bulletCount: selected.reduce((sum, item) => sum + Math.max(1, bulletPlan(item.data).length), 0),
    skillCount: effectiveInput.graph.skillMatrix.length,
    hasSummary: Boolean(profile.basics.summary || selected.length)
  });

  const informationNeeds = buildInformationNeeds(effectiveInput, keywordCoverage);
  const sections = buildSections(selected, effectiveInput.graph.skillMatrix.length, effectiveInput.mode);
  return ResumeBlueprintSchema.parse({
    schemaVersion: "resume-blueprint-v1",
    mode: effectiveInput.mode,
    profileId: profile.id,
    profileRevision: profile.version,
    ...(effectiveInput.job ? { jobId: effectiveInput.job.id, targetRole: effectiveInput.job.title } : {}),
    ...(effectiveInput.targetDirection ? { targetDirection: effectiveInput.targetDirection } : {}),
    ...(effectiveInput.targetAudience ? { targetAudience: effectiveInput.targetAudience } : {}),
    ...(effectiveInput.companyType ? { companyType: effectiveInput.companyType } : {}),
    summaryPlan: summaryPlan(profile, selected, effectiveInput),
    skillGroups,
    sections,
    assets,
    excludedAssets,
    informationNeeds,
    keywordCoverage,
    pageBudget: {
      targetPages: 1,
      maxProjects: 4,
      maxBulletsPerProject: 4,
      estimatedPageCount
    }
  });
}

export function classifyJobKeywords(job: JobDescription, graph: ResumeEvidenceGraph, canonicalById = new Map<string, ResumeItemV2>()): ResumeKeywordCoverage[] {
  const keywords = unique([
    ...job.requirements.flatMap((requirement) => requirement.keywords),
    ...job.requirements.flatMap((requirement) => findTechnicalTerms(requirement.description)),
    ...findTechnicalTerms(job.rawText)
  ]).slice(0, 48);
  const searchableByAsset = new Map<string, string>();
  for (const id of graph.sourceAssetIds) {
    const item = canonicalById.get(id);
    const evidence = graph.nodes
      .filter((node) => node.sourceAssetIds.includes(id))
      .flatMap((node) => node.sourceExcerpts)
      .join(" ");
    if (item) searchableByAsset.set(id, `${projectResumeItemV2(item)} ${itemText(item)} ${evidence}`.toLocaleLowerCase());
  }
  return keywords.map((keyword) => {
    const normalized = keyword.toLocaleLowerCase();
    const exact = [...searchableByAsset.entries()].filter(([, text]) => text.includes(normalized) && !isNegatedKeyword(text, normalized));
    if (exact.length) return {
      keyword,
      status: "SUPPORTED" as const,
      sourceAssetIds: exact.map(([id]) => id),
      factIds: exact.flatMap(([id]) => graph.nodes.find((node) => node.id === `asset:${id}`)?.factIds ?? []),
      reason: "在已确认职业资产的明确字段或来源证据中出现。"
    };
    const related = relatedEvidence(keyword, graph, searchableByAsset);
    if (related.length) return {
      keyword,
      status: "POTENTIALLY_SUPPORTED" as const,
      sourceAssetIds: related,
      factIds: related.flatMap((id) => graph.nodes.find((node) => node.id === `asset:${id}`)?.factIds ?? []),
      reason: "存在相邻工具或方法，但不能把相邻能力写成该关键词的直接经验。",
      question: `你是否有明确的「${keyword}」使用经历？没有也可以直接生成，并保留为岗位缺口。`
    };
    return {
      keyword,
      status: "UNSUPPORTED" as const,
      sourceAssetIds: [],
      factIds: [],
      reason: "当前已确认资料库没有足够证据支持该关键词。",
      question: `你是否有「${keyword}」的已确认经历？没有也可以直接生成。`
    };
  });
}

function selectAssets(candidates: Array<{ data: ResumeItemV2; relevance: number; node?: ResumeEvidenceGraph["nodes"][number]; score: ResumeBlueprint["assets"][number]["score"] }>, mode: "general" | "job_specific", input: ResumeBlueprintInput) {
  const selected: typeof candidates = [];
  const education = candidates.find((candidate) => candidate.data.sectionType === "education");
  if (education) selected.push(education);
  const limit = mode === "general" ? 8 : 7;
  const add = (candidate: (typeof candidates)[number]) => {
    if (selected.some((item) => item.data.id === candidate.data.id) || selected.length >= limit) return;
    if (candidate.relevance < 0.2 && mode === "job_specific") return;
    if (candidate.data.sectionType === "project" && selected.filter((item) => item.data.sectionType === "project").length >= 4) return;
    selected.push(candidate);
  };
  if (mode === "general") {
    for (const candidate of candidates.filter((item) => item.data.sectionType === "project")) add(candidate);
    for (const candidate of candidates.filter((item) => item.data.sectionType === "research")) add(candidate);
    for (const candidate of candidates.filter((item) => ["awards", "certificates"].includes(item.data.sectionType))) add(candidate);
    for (const candidate of candidates.filter((item) => ["work", "internship", "portfolio", "publications", "patents"].includes(item.data.sectionType))) add(candidate);
    if (input.targetAudience?.includes("校招") || input.targetDirection?.includes("秋招")) {
      for (const candidate of candidates.filter((item) => ["campus", "volunteer"].includes(item.data.sectionType))) add(candidate);
    }
  } else {
    for (const candidate of candidates) add(candidate);
  }
  return selected;
}

function buildSections(selected: Array<{ data: ResumeItemV2; relevance: number }>, skillCount: number, mode: "general" | "job_specific") {
  const sections = new Map<string, string[]>();
  for (const item of selected) {
    const current = sections.get(item.data.sectionType) ?? [];
    current.push(item.data.id);
    sections.set(item.data.sectionType, current);
  }
  if (skillCount) sections.set("skills", ["derived-skills"]);
  return [...sections.entries()].map(([sectionType, assetIds]) => ({
    sectionType,
    assetIds,
    maxItems: sectionType === "project" ? Math.min(4, assetIds.length) : assetIds.length,
    priority: mode === "job_specific" && sectionType === "project" ? 0.95 : sectionType === "education" ? 0.9 : 0.7
  }));
}

function buildInformationNeeds(input: ResumeBlueprintInput, coverage: ResumeKeywordCoverage[]) {
  const needs: Array<{ id: string; question: string; reason: string; optional: true }> = [];
  const recovery = input.graph.recoveryCandidates.find((candidate) => candidate.status === "needs_confirmation");
  if (recovery) needs.push({
    id: recovery.id,
    question: `是否将「${recovery.proposedValue}」作为该研究经历的作者角色？不确认也可以继续生成。`,
    reason: recovery.reason,
    optional: true
  });
  const potential = coverage.find((item) => item.status === "POTENTIALLY_SUPPORTED");
  if (potential && needs.length < 2) needs.push({
    id: `keyword:${potential.keyword}`,
    question: potential.question ?? `是否有「${potential.keyword}」的直接使用经历？不确认也可以继续生成。`,
    reason: potential.reason,
    optional: true
  });
  return needs;
}

function summaryPlan(
  profile: ReturnType<typeof migrateCareerProfileToV2>,
  selected: Array<{ data: ResumeItemV2 }>,
  input: ResumeBlueprintInput
) {
  const education = selected.find(({ data }) => data.sectionType === "education")?.data;
  const school = education && education.sectionType === "education" ? education.school : undefined;
  const visibleSkills = selected
    .flatMap(({ data }) => {
      const record = data as unknown as Record<string, unknown>;
      return [...(Array.isArray(record.tools) ? record.tools : []), ...(Array.isArray(record.methods) ? record.methods : [])];
    })
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .slice(0, 4);
  const direction = input.targetDirection ?? input.job?.title ?? profile.structuredBasics?.targetRole ?? profile.structuredBasics?.headline;
  const audience = input.targetAudience ?? (direction?.includes("秋招") ? "互联网秋招" : undefined);
  const skillText = unique(visibleSkills).join("、");
  const educationLabel = education && education.sectionType === "education"
    ? `${education.major ? `${education.major}` : ""}本科生`
    : "本科生";
  const lead = school ? `${school}${educationLabel}` : educationLabel;
  const focus = skillText
    ? `聚焦 ${skillText} 的项目实践`
    : selected.some(({ data }) => data.sectionType === "project") ? "具备多项项目实践" : "具备学习与实践经历";
  const audienceText = audience ? `，面向${audience}` : "";
  const directionText = direction && !direction.includes("秋招") ? `，目标${direction}` : "";
  return `${lead}${audienceText}${directionText}，${focus}。`;
}

function inclusionReason(item: ResumeItemV2, mode: "general" | "job_specific", relevance: number, input: ResumeBlueprintInput, score?: ResumeBlueprint["assets"][number]["score"]) {
  if (item.sectionType === "education") return "教育背景是通用简历的基础事实。";
  const signals = score ? `证据强度${formatScore(score.evidenceStrength)}、技术深度${formatScore(score.technicalDepth)}、独特性${formatScore(score.uniqueness)}` : "已有证据";
  if (mode === "job_specific") return relevance >= 0.7 ? `与岗位要求有直接证据连接（${signals}）。` : `保留相邻经历，供人工判断（${signals}）。`;
  if (input.targetDirection && (item.sectionType === "project" || item.sectionType === "research")) return `与${input.targetDirection}方向相关，并具备可核验行动证据（${signals}）。`;
  return item.sectionType === "project" || item.sectionType === "research" ? `项目或研究经历能承载可核验的行动与技术证据（${signals}）。` : `属于已确认的职业资产，作为通用简历补充（${signals}）。`;
}

function exclusionReason(item: ResumeItemV2, relevance: number, mode: "general" | "job_specific", selected: Array<{ data: ResumeItemV2 }>, score?: ResumeBlueprint["assets"][number]["score"]) {
  if (score?.weakEvidencePenalty && score.weakEvidencePenalty >= 0.45) return "来源事实或确认强度不足，未进入展示层。";
  if (mode === "job_specific" && score && (score.requirementCoverage ?? 0) === 0 && relevance < 0.45) return "与当前岗位要求的直接证据连接不足，保留在资料库而不写入岗位简历。";
  if (item.sectionType === "project" && selected.some(({ data }) => data.sectionType === "project")) return "页面预算优先保留更高综合分的项目，避免项目堆叠和重复技术栈。";
  if (selected.length >= (mode === "general" ? 8 : 7)) return "达到当前简历的一页内容预算，未因篇幅继续堆叠低分资产。";
  return "综合相关性、证据强度和页面预算后暂不选入，可在调整内容时重新评估。";
}

function careerAssetResumeScore(input: {
  data: ResumeItemV2;
  node?: ResumeEvidenceGraph["nodes"][number];
  graph: ResumeEvidenceGraph;
  mode: "general" | "job_specific";
  job?: JobDescription;
  keywordCoverage: ResumeKeywordCoverage[];
  input: ResumeBlueprintInput;
}): NonNullable<ResumeBlueprint["assets"][number]["score"]> {
  const text = `${itemText(input.data)} ${input.node?.sourceExcerpts.join(" ") ?? ""}`.toLocaleLowerCase();
  const tools = explicitTools(input.data, input.graph);
  const bullets = bulletPlan(input.data);
  const targetTerms = unique([input.input.targetDirection, input.input.targetAudience, input.input.companyType, input.job?.title].filter((value): value is string => Boolean(value)).flatMap((value) => value.toLocaleLowerCase().split(/[\s/|·、，,]+/u)));
  const targetRelevance = targetTerms.length ? clamp(targetTerms.filter((term) => term.length > 1 && text.includes(term)).length / Math.min(4, targetTerms.length)) : sectionWeight(input.data.sectionType);
  const evidenceStrength = clamp(((input.node?.confirmationStatus === "confirmed" ? 0.55 : 0.2) + Math.min(0.3, (input.node?.factIds.length ?? 0) * 0.08) + Math.min(0.15, (input.node?.sourceExcerpts.length ?? 0) * 0.03)));
  const demonstratedComplexity = clamp((semanticParts(bullets.join(" ")) + Math.min(3, tools.length)) / 10);
  const outcomeStrength = clamp((countOutcomeTerms(text) + (input.data.sectionType === "project" && bullets.some((bullet) => /完成|实现|构建|分析|优化|交付|支持/iu.test(bullet)) ? 1 : 0)) / 4);
  const specificity = clamp((tools.length + (/[0-9一二三四五六七八九十%]+/u.test(text) ? 1 : 0) + (input.data.sectionType !== "custom" ? 1 : 0)) / 5);
  const uniqueness = clamp(1 - maxOverlap(input.data, input.graph, input.node?.sourceAssetIds[0]));
  const technicalDepth = clamp((tools.length + findTechnicalTerms(text).length) / 8);
  const recency = recencyScore(input.data);
  const ownershipStrength = clamp((input.node?.ownershipStrength ?? 0) / 6);
  const redundancy = clamp(maxOverlap(input.data, input.graph, input.node?.sourceAssetIds[0]));
  const weakEvidencePenalty = input.node?.confirmationStatus === "confirmed" ? 0 : input.node?.confirmationStatus === "needs_confirmation" ? 0.25 : 0.6;
  const supported = input.keywordCoverage.filter((keyword) => keyword.status === "SUPPORTED" && keyword.sourceAssetIds.includes(input.data.id));
  const requirementCoverage = input.mode === "job_specific" ? clamp(supported.length / Math.max(1, input.keywordCoverage.filter((keyword) => keyword.status === "SUPPORTED").length)) : undefined;
  const mustHaveCoverage = input.mode === "job_specific" ? clamp(supported.length / Math.max(1, input.job?.requirements.filter((requirement) => requirement.priority === "high" || requirement.hardConstraint).length ?? 1)) : undefined;
  const jdSemanticRelevance = input.mode === "job_specific" ? clamp((supported.length * 0.3) + (input.data.sectionType === "project" || input.data.sectionType === "research" ? 0.25 : 0)) : undefined;
  const total = clamp(
    targetRelevance * 0.28
    + evidenceStrength * 0.16
    + demonstratedComplexity * 0.1
    + outcomeStrength * 0.1
    + specificity * 0.08
    + uniqueness * 0.08
    + technicalDepth * 0.08
    + recency * 0.05
    + ownershipStrength * 0.06
    + (requirementCoverage ?? 0.5) * (input.mode === "job_specific" ? 0.1 : 0.04)
    + (mustHaveCoverage ?? 0.5) * (input.mode === "job_specific" ? 0.08 : 0)
    + (jdSemanticRelevance ?? 0.5) * (input.mode === "job_specific" ? 0.07 : 0)
    - redundancy * 0.1
    - weakEvidencePenalty * 0.18
  );
  return {
    targetRelevance,
    evidenceStrength,
    demonstratedComplexity,
    outcomeStrength,
    specificity,
    uniqueness,
    technicalDepth,
    recency,
    ownershipStrength,
    redundancy,
    weakEvidencePenalty,
    ...(requirementCoverage !== undefined ? { requirementCoverage } : {}),
    ...(mustHaveCoverage !== undefined ? { mustHaveCoverage } : {}),
    ...(jdSemanticRelevance !== undefined ? { jdSemanticRelevance } : {}),
    total
  };
}

function bulletPlan(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return unique([
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : []),
    ...(Array.isArray(record.methods) ? record.methods : []),
    typeof record.description === "string" ? record.description : "",
    typeof record.background === "string" ? record.background : ""
  ].filter((value): value is string => typeof value === "string"));
}

function explicitTools(item: ResumeItemV2, graph: ResumeEvidenceGraph) {
  const record = item as unknown as Record<string, unknown>;
  const recovered = graph.nodes
    .filter((node) => node.sourceAssetIds.includes(item.id) && ["tool", "method", "skill"].includes(node.type))
    .map((node) => node.value);
  return unique([...(Array.isArray(record.tools) ? record.tools : []), ...(Array.isArray(record.methods) ? record.methods : []), ...recovered].filter((value): value is string => typeof value === "string"));
}

function itemText(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return Object.values(record).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string").join(" ");
}

function assetTitle(item: ResumeItemV2) {
  return resolveCareerAssetDisplayIdentity(item).label;
}

function relatedEvidence(keyword: string, graph: ResumeEvidenceGraph, searchableByAsset: Map<string, string>) {
  const normalized = keyword.toLocaleLowerCase();
  const relations: Record<string, string[]> = {
    postgresql: ["sqlite", "sqlx", "sql"],
    "rest api": ["fastapi", "api"],
    fastapi: ["api", "python"],
    backend: ["fastapi", "node.js", "rust", "api"],
    frontend: ["react", "next.js", "typescript"]
  };
  const aliases = relations[normalized] ?? [];
  return [...searchableByAsset.entries()]
    .filter(([, text]) => aliases.some((alias) => text.includes(alias)))
    .map(([id]) => id)
    .filter((id) => graph.sourceAssetIds.includes(id));
}

function isNegatedKeyword(text: string, keyword: string) {
  const escaped = escapeRegExp(keyword);
  return new RegExp(`(?:未涉及|未使用|没有|不会|不使用|不支持|不含)\\s*(?:[A-Za-z0-9+#.-]+\\s*){0,2}${escaped}`, "iu").test(text);
}

function estimatePages(input: { selectedCount: number; projectCount: number; bulletCount: number; skillCount: number; hasSummary: boolean }) {
  const weightedLines = input.selectedCount * 2.2 + input.bulletCount * 1.15 + input.skillCount * 0.28 + (input.hasSummary ? 2.2 : 0);
  return Math.max(0.6, Math.round((weightedLines / 24) * 10) / 10);
}

function sectionWeight(sectionType: string) {
  return ({ education: 0.95, project: 0.9, research: 0.88, work: 0.86, internship: 0.82, campus: 0.7, awards: 0.65, certificates: 0.58 } as Record<string, number>)[sectionType] ?? 0.45;
}

function semanticParts(value: string) {
  return [
    /(?:完成|实现|构建|开发|分析|设计|参与|协助|负责|优化|搭建|维护|清洗|组织)/iu.test(value),
    /(?:系统|平台|页面|流程|数据|接口|模型|设备|功能|样本|活动|项目)/iu.test(value),
    /(?:使用|结合|基于|通过|采用|调用|部署|验证|测试|联调)/iu.test(value),
    /(?:结果|成果|支持|提升|降低|交付|上线|覆盖|准确|效率)/iu.test(value)
  ].filter(Boolean).length;
}

function countOutcomeTerms(value: string) {
  return (value.match(/(?:完成|实现|交付|支持|提升|降低|减少|覆盖|上线|验证|优化|成果)/giu) ?? []).length;
}

function maxOverlap(item: ResumeItemV2, graph: ResumeEvidenceGraph, currentId?: string) {
  const currentTokens = tokenSet(itemText(item));
  return Math.max(0, ...graph.sourceAssetIds.filter((id) => id !== currentId).map((id) => {
    const node = graph.nodes.find((candidate) => candidate.id === `asset:${id}`);
    return overlap(currentTokens, tokenSet(node?.sourceExcerpts.join(" ") ?? node?.value ?? ""));
  }));
}

function tokenSet(value: string) {
  return new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}+#.-]+/u).filter((token) => token.length > 1));
}

function overlap(left: Set<string>, right: Set<string>) {
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(1, Math.min(left.size, right.size));
}

function recencyScore(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  const value = [record.endDate, record.expectedEndDate, record.startDate, record.awardedAt]
    .find((candidate): candidate is string => typeof candidate === "string" && /^20\d{2}/u.test(candidate));
  if (!value) return 0.5;
  const year = Number(value.slice(0, 4));
  return clamp((year - 2020) / 10);
}

function formatScore(value: number) {
  return `${Math.round(value * 100)}%`;
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
