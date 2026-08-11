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
};

export function planResumeBlueprint(input: ResumeBlueprintInput): ResumeBlueprint {
  const profile = migrateCareerProfileToV2(input.profile);
  const canonicalById = new Map(profile.structuredFacts.map((entry) => [entry.data.id, entry.data]));
  const keywordCoverage = input.mode === "job_specific" && input.job
    ? classifyJobKeywords(input.job, input.graph, canonicalById)
    : [];
  const assetCandidates: Array<{ data: ResumeItemV2; relevance: number; node?: ResumeEvidenceGraph["nodes"][number] }> = input.graph.sourceAssetIds
    .flatMap((id) => {
      const data = canonicalById.get(id);
      if (!data) return [];
      const node = input.graph.nodes.find((candidate) => candidate.id === `asset:${id}`);
      const relevance = input.mode === "job_specific"
        ? jobRelevance(data, keywordCoverage)
        : generalRelevance(data, node?.factIds.length ?? 0);
      return [{ data, relevance, node }];
    })
    .sort((left, right) => right.relevance - left.relevance || assetTitle(left.data).localeCompare(assetTitle(right.data)));

  const selected = selectAssets(assetCandidates, input.mode);
  const assets = selected.map(({ data, relevance, node }) => ({
    sourceAssetId: data.id,
    sectionType: data.sectionType,
    title: assetTitle(data),
    sourceFactIds: node?.factIds ?? [],
    evidenceNodeIds: node ? [node.id] : [],
    relevance,
    inclusionReason: inclusionReason(data, input.mode, relevance),
    bulletPlan: bulletPlan(data),
    explicitTools: explicitTools(data, input.graph)
  }));

  const skillGroups = normalizeSkillGroups(input.graph.skillMatrix);
  const projectCount = selected.filter(({ data }) => data.sectionType === "project").length;
  const estimatedPageCount = estimatePages({
    selectedCount: selected.length,
    projectCount,
    bulletCount: selected.reduce((sum, item) => sum + Math.max(1, bulletPlan(item.data).length), 0),
    skillCount: input.graph.skillMatrix.length,
    hasSummary: Boolean(profile.basics.summary || selected.length)
  });

  const informationNeeds = buildInformationNeeds(input, keywordCoverage);
  const sections = buildSections(selected, input.graph.skillMatrix.length, input.mode);
  return ResumeBlueprintSchema.parse({
    schemaVersion: "resume-blueprint-v1",
    mode: input.mode,
    profileId: profile.id,
    profileRevision: profile.version,
    ...(input.job ? { jobId: input.job.id, targetRole: input.job.title } : {}),
    summaryPlan: summaryPlan(profile, selected, input.mode, input.job),
    skillGroups,
    sections,
    assets,
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

function selectAssets(candidates: Array<{ data: ResumeItemV2; relevance: number; node?: ResumeEvidenceGraph["nodes"][number] }>, mode: "general" | "job_specific") {
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
    for (const candidate of candidates.filter((item) => ["campus", "volunteer", "other", "custom"].includes(item.data.sectionType))) add(candidate);
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

function summaryPlan(profile: ReturnType<typeof migrateCareerProfileToV2>, selected: Array<{ data: ResumeItemV2 }>, mode: "general" | "job_specific", job?: JobDescription) {
  const education = selected.find(({ data }) => data.sectionType === "education")?.data;
  const school = education && education.sectionType === "education" ? education.school : undefined;
  const visibleSkills = selected
    .flatMap(({ data }) => {
      const record = data as unknown as Record<string, unknown>;
      return [...(Array.isArray(record.tools) ? record.tools : []), ...(Array.isArray(record.methods) ? record.methods : [])];
    })
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .slice(0, 4);
  const direction = job?.title ?? profile.structuredBasics?.targetRole ?? profile.structuredBasics?.headline;
  const sourceDirection = Boolean(direction && selected.some(({ data }) => itemText(data).toLocaleLowerCase().includes(direction.toLocaleLowerCase())));
  void mode;
  return [
    sourceDirection ? `${direction}方向` : "",
    school ? `${school}相关学习背景` : "",
    visibleSkills.length ? `具备 ${unique(visibleSkills).join("、")} 项目实践` : selected.some(({ data }) => data.sectionType === "project") ? "具备项目实践" : ""
  ].filter(Boolean).join("，") + "。";
}

function generalRelevance(item: ResumeItemV2, factCount: number) {
  const sectionWeight: Record<string, number> = { education: 0.95, project: 0.9, research: 0.88, work: 0.86, internship: 0.82, campus: 0.7, awards: 0.65, certificates: 0.58 };
  return Math.min(1, (sectionWeight[item.sectionType] ?? 0.45) + Math.min(0.12, factCount * 0.03));
}

function jobRelevance(item: ResumeItemV2, coverage: ResumeKeywordCoverage[]) {
  const text = itemText(item).toLocaleLowerCase();
  const hits = coverage.filter((keyword) => keyword.status === "SUPPORTED" && text.includes(keyword.keyword.toLocaleLowerCase())).length;
  return Math.min(1, 0.35 + hits * 0.14 + (item.sectionType === "project" || item.sectionType === "research" ? 0.18 : 0));
}

function inclusionReason(item: ResumeItemV2, mode: "general" | "job_specific", relevance: number) {
  if (item.sectionType === "education") return "教育背景是通用简历的基础事实。";
  if (mode === "job_specific") return relevance >= 0.7 ? "与岗位关键词或相关职责有直接证据连接。" : "保留一项相邻经历，便于人工判断是否继续使用。";
  return item.sectionType === "project" || item.sectionType === "research" ? "项目或研究经历能承载可核验的行动与技术证据。" : "属于已确认的职业资产，作为通用简历补充。";
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

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
