import {
  migrateCareerProfileToV2,
  projectResumeItemV2
} from "@/domain/migrations/resumeV2";
import type {
  CareerProfile,
  FactStatement,
  JobDescription,
  MatchEvidenceRef,
  ResumeItemV2
} from "@/domain/schemas";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { dedupeCareerWriting, isFiller, isRawOrNegativeSpeech, semanticComponentCount } from "@/domain/profileIntake/CareerWritingQuality";
import {
  ResumeClaimSchema,
  ResumeCompositionResultSchema,
  ResumeCompositionProposalSchema,
  ResumeReviewResultSchema,
  type ResumeBlueprint,
  type CareerResumeWritingAsset,
  type CareerResumeWritingOutput,
  type ResumeClaim,
  type ResumeCompiledItem,
  type ResumeCompositionMetrics,
  type ResumeCompositionMode,
  type ResumeCompositionResult,
  type ResumeEvidenceGraph
} from "./contracts";
import { buildResumeEvidenceGraph } from "./ResumeEvidenceGraph";
import { planResumeBlueprint } from "./ResumeBlueprint";
import { reviewResumeComposition } from "./ResumeReviewer";
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";
import { normalizeSkillGroups } from "./ResumeSkillTaxonomy";
import { CareerResumeWritingService } from "./CareerResumeWritingService";

export type ResumeWriterInput = {
  profile: CareerProfile;
  graph: ResumeEvidenceGraph;
  blueprint: ResumeBlueprint;
  mode: ResumeCompositionMode;
  job?: JobDescription;
  sourceResumeId?: string;
  writingOutput?: CareerResumeWritingOutput;
  targetDirection?: string;
  targetAudience?: string;
  companyType?: string;
};

export function writeResumeComposition(input: ResumeWriterInput): ResumeCompositionResult {
  const profile = migrateCareerProfileToV2(input.profile);
  const factLookup = collectFacts(profile);
  const claims: ResumeClaim[] = [];
  const items: ResumeCompiledItem[] = [];

  const selectedAssetIds = new Set(input.blueprint.assets.map((asset) => asset.sourceAssetId));
  const selectedEntries = profile.structuredFacts.filter((entry) => selectedAssetIds.has(entry.data.id));
  const selectedFactIds = new Set(selectedEntries.flatMap((entry) => entry.factIds));
  const deterministicOutput = createDeterministicWritingOutput(input);
  const writingOutput = input.writingOutput ?? deterministicOutput;
  const writingAssetById = new Map((writingOutput?.assets ?? []).map((asset) => [asset.sourceAssetId, asset]));

  const summary = writingOutput?.summary?.trim() || input.blueprint.summaryPlan?.trim();
  if (summary) {
    const claim = claimFor({
      id: `claim:summary:${profile.id}`,
      text: summary,
      classification: "DERIVED_PRESENTATION",
      sourceAssetIds: selectedEntries.map((entry) => entry.data.id),
      factIds: [...selectedFactIds],
      graph: input.graph,
      facts: factLookup,
      originalText: selectedEntries.map((entry) => projectResumeItemV2(entry.data)).join("\n"),
      reason: "将多项已确认教育和职业资产压缩为一段展示性摘要。"
    });
    if (claim.classification !== "UNSUPPORTED") {
      claims.push(claim);
      items.push({
        sourceAssetId: `summary:${profile.id}`,
        data: { id: `composition-summary-${profile.id}`, sectionType: "summary", text: summary, customFields: [] },
        claimIds: [claim.id],
        factIds: [...selectedFactIds],
        sourceBlockIds: selectedEntries.flatMap((entry) => entry.sourceBlockIds),
        sourceExcerpt: selectedEntries.map((entry) => entry.sourceExcerpt).filter(Boolean).join("\n") || undefined
      });
    }
  }

  for (const entry of selectedEntries) {
    const asset = input.blueprint.assets.find((candidate) => candidate.sourceAssetId === entry.data.id);
    if (!asset) continue;
    const sourceFacts = entry.factIds.map((id) => factLookup.get(id)).filter((fact): fact is FactStatement => Boolean(fact));
    const writingAsset = writingAssetById.get(entry.data.id);
    const data = compileItem({ entry, asset, writingAsset, sourceFacts, graph: input.graph });
    const bulletClaims = bulletsFor({ entry, data, asset, writingAsset, sourceFacts, graph: input.graph, factLookup });
    claims.push(...bulletClaims);
    const claimIds = bulletClaims.map((claim) => claim.id);
    const filteredData = applyBulletClaims(data, bulletClaims);
    items.push({
      sourceAssetId: entry.data.id,
      data: filteredData,
      claimIds,
      factIds: entry.factIds,
      sourceBlockIds: entry.sourceBlockIds,
      sourceExcerpt: entry.sourceExcerpt
    });
  }

  const derivedSkillItems = derivedSkills(input.graph, factLookup);
  items.push(...derivedSkillItems.items);
  claims.push(...derivedSkillItems.claims);
  const metrics = initialMetrics({ items, claims, input, selectedEntries: selectedEntries.length });
  const proposal = ResumeCompositionProposalSchema.parse({
    mode: input.mode,
    title: input.mode === "job_specific" ? `${input.job?.title ?? "岗位"} · 简历组装预览` : "通用简历组装预览",
    summary: proposalSummary({ profile, selectedEntries, derivedSkillItems, input }),
    selectedAssetTitles: selectedEntries.map((entry) => resolveCareerAssetDisplayIdentity(entry.data).label),
    derivedSkillNames: derivedSkillItems.names,
    bulletCount: metrics.bulletsGenerated,
    informationNeeds: input.blueprint.informationNeeds,
    contactReminder: !hasContactDetails(profile),
    actions: input.blueprint.informationNeeds.length ? ["generate", "supplement", "adjust", "cancel"] : ["generate", "adjust", "cancel"]
  });
  const draft = ResumeCompositionResultSchema.parse({
    schemaVersion: "resume-composition-v1",
    mode: input.mode,
    profileId: profile.id,
    profileRevision: profile.version,
    ...(input.job ? { jobId: input.job.id } : {}),
    ...((input.targetDirection ?? input.blueprint.targetDirection) ? { targetDirection: input.targetDirection ?? input.blueprint.targetDirection } : {}),
    ...((input.targetAudience ?? input.blueprint.targetAudience) ? { targetAudience: input.targetAudience ?? input.blueprint.targetAudience } : {}),
    ...((input.companyType ?? input.blueprint.companyType) ? { companyType: input.companyType ?? input.blueprint.companyType } : {}),
    evidenceGraph: input.graph,
    blueprint: input.blueprint,
    items,
    claims,
    reviewResult: ResumeReviewResultSchema.parse({
      status: "NEEDS_REVIEW",
      findings: [],
      atsCoverage: input.blueprint.keywordCoverage,
      metrics,
      revisedBulletCount: 0
    }),
    proposal,
    metrics,
    keywordCoverage: input.blueprint.keywordCoverage,
    informationNeeds: input.blueprint.informationNeeds,
    skillGroups: writingOutput?.skillGroups ?? Object.entries(normalizeSkillGroups(input.graph.skillMatrix)).map(([category, skills]) => ({ category, skills })),
    ...(input.sourceResumeId ? { sourceResumeId: input.sourceResumeId } : {})
  });
  return reviewResumeComposition(draft, { job: input.job });
}

export function compileResumeComposition(input: {
  profile: CareerProfile;
  mode: ResumeCompositionMode;
  job?: JobDescription;
  sourceResumeId?: string;
  targetDirection?: string;
  targetAudience?: string;
  companyType?: string;
}) {
  const graph = buildResumeEvidenceGraph({ profile: input.profile });
  const blueprint = planResumeBlueprint({ profile: input.profile, graph, mode: input.mode, job: input.job, targetDirection: input.targetDirection, targetAudience: input.targetAudience, companyType: input.companyType });
  return writeResumeComposition({ ...input, graph, blueprint });
}

export async function compileResumeCompositionWithAi(input: {
  profile: CareerProfile;
  mode: ResumeCompositionMode;
  job?: JobDescription;
  sourceResumeId?: string;
  targetDirection?: string;
  targetAudience?: string;
  companyType?: string;
  signal?: AbortSignal;
}, options: {
  graph?: ResumeEvidenceGraph;
  blueprint?: ResumeBlueprint;
  writingService?: CareerResumeWritingService;
} = {}) {
  const graph = options.graph ?? buildResumeEvidenceGraph({ profile: input.profile });
  const blueprint = options.blueprint ?? planResumeBlueprint({ profile: input.profile, graph, mode: input.mode, job: input.job, targetDirection: input.targetDirection, targetAudience: input.targetAudience, companyType: input.companyType });
  const writingOutput = await (options.writingService ?? new CareerResumeWritingService()).write({
    profile: input.profile,
    graph,
    blueprint,
    mode: input.mode,
    job: input.job,
    targetDirection: input.targetDirection,
    targetAudience: input.targetAudience,
    companyType: input.companyType,
    signal: input.signal
  });
  return writeResumeComposition({ ...input, graph, blueprint, writingOutput });
}

/** Deterministic professional fallback used when the writer provider fails or
 * returns no usable asset. It compresses confirmed source fields; it never
 * places the raw blueprint/transcript directly into the resume. */
function createDeterministicWritingOutput(input: ResumeWriterInput): CareerResumeWritingOutput {
  const profile = migrateCareerProfileToV2(input.profile);
  const entriesById = new Map(profile.structuredFacts.map((entry) => [entry.data.id, entry]));
  return {
    assets: input.blueprint.assets.flatMap((asset) => {
      const entry = entriesById.get(asset.sourceAssetId);
      if (!entry) return [];
      const record = entry.data as unknown as Record<string, unknown>;
      const role = [record.role, record.authorRole]
        .map(roleLikeValue)
        .find((value): value is string => Boolean(value));
      return [{
        sourceAssetId: asset.sourceAssetId,
        title: resolveCareerAssetDisplayIdentity(entry.data).label,
        ...(role ? { role } : {}),
        techStack: asset.explicitTools.slice(0, 8),
        highlights: professionalBulletPlan(entry.data, asset).slice(0, 4)
      }];
    }),
    skillGroups: Object.entries(normalizeSkillGroups(input.graph.skillMatrix)).map(([category, skills]) => ({ category, skills }))
  };
}

function roleLikeValue(value: unknown) {
  if (typeof value !== "string") return undefined;
  const role = value.trim();
  if (!role || role.length > 80 || /[\r\n。！？!?；;]/u.test(role)) return undefined;
  if (/(?:sourceExcerpt|description|rawText|full narrative|原文|经历描述|项目描述|岗位描述)/iu.test(role)) return undefined;
  if (/(?:负责|完成了|开发了|实现了|使用了|通过|因为|所以|其中|项目中)/u.test(role) && role.length > 24) return undefined;
  return role;
}

function professionalBulletPlan(item: ResumeItemV2, asset: ResumeBlueprint["assets"][number]) {
  const source = dedupeCareerWriting(asset.bulletPlan)
    .flatMap(splitBullet)
    .filter((value) => !isRawOrNegativeSpeech(value));
  const tools = asset.explicitTools.filter((value) => !/^(?:API|工具|测试|开发)$/iu.test(value)).slice(0, 4);
  return source.map((value) => compressProfessionalBullet(value, tools)).filter(Boolean);
}

function compressProfessionalBullet(value: string, tools: string[]) {
  const cleaned = value
    .replace(/^(?:它既可以|然后可以最后)\s*/u, "")
    .replace(/功能类似\s*DeepTutor\s*但较弱[。；;]?/iu, "")
    .replace(/一个人做/gu, "参与完成")
    .replace(/\s+/gu, " ")
    .trim();
  if (!cleaned || isRawOrNegativeSpeech(cleaned)) return "";
  if (semanticComponentCount(cleaned) >= 2 || !tools.length) return cleaned;
  const sentence = cleaned.replace(/[。；;]+$/u, "");
  return `${sentence}，使用 ${tools.join("、")}。`;
}

function compileItem(input: { entry: NonNullable<ReturnType<typeof migrateCareerProfileToV2>["structuredFacts"]>[number]; asset: ResumeBlueprint["assets"][number]; writingAsset?: CareerResumeWritingAsset; sourceFacts: FactStatement[]; graph: ResumeEvidenceGraph }): ResumeItemV2 {
  const item = input.entry.data;
  if (item.sectionType === "project") {
    return {
      ...item,
      id: item.id,
      tools: unique([...item.tools, ...input.asset.explicitTools, ...(input.writingAsset?.techStack ?? [])]),
      background: undefined,
      description: undefined,
      highlights: [],
      outcomes: []
    };
  }
  if (item.sectionType === "research") {
    return { ...item, highlights: [], description: undefined };
  }
  if (item.sectionType === "education" && item.current) {
    return { ...item, endDate: undefined, expectedEndDate: item.expectedEndDate ?? item.endDate, highlights: [] };
  }
  return item;
}

function bulletsFor(input: {
  entry: NonNullable<ReturnType<typeof migrateCareerProfileToV2>["structuredFacts"]>[number];
  data: ResumeItemV2;
  asset: ResumeBlueprint["assets"][number];
  writingAsset?: CareerResumeWritingAsset;
  sourceFacts: FactStatement[];
  graph: ResumeEvidenceGraph;
  factLookup: Map<string, FactStatement>;
}) {
  const original = [projectResumeItemV2(input.entry.data), ...input.sourceFacts.map((fact) => fact.statement), ...input.sourceFacts.flatMap((fact) => fact.provenance.map((source) => source.sourceText))].join("\n");
  const proposedBullets = input.writingAsset?.highlights.length
    ? input.writingAsset.highlights
    : professionalBulletPlan(input.entry.data, input.asset);
  const rawBullets = dedupeCareerWriting(proposedBullets, original)
    .flatMap(splitBullet)
    .map((bullet) => compressProfessionalBullet(bullet, input.asset.explicitTools))
    .filter((bullet) => !isFiller(bullet) && !isRawOrNegativeSpeech(bullet))
    .filter((bullet) => semanticComponentCount(bullet) >= 2)
    .slice(0, input.data.sectionType === "project" ? 4 : 4);
  return rawBullets.flatMap((bullet, index) => {
    const claim = claimFor({
      id: `claim:${input.entry.data.id}:${index + 1}`,
      text: bullet,
      classification: "DERIVED_PRESENTATION",
      sourceAssetIds: [input.entry.data.id],
      factIds: input.entry.factIds,
      graph: input.graph,
      facts: input.factLookup,
      originalText: original,
      reason: "保留来源事实，只进行简历展示层的压缩与措辞整理。"
    });
    return claim.classification === "UNSUPPORTED" ? [] : [claim];
  });
}

function claimFor(input: {
  id: string;
  text: string;
  classification: "SUPPORTED" | "DERIVED_PRESENTATION";
  sourceAssetIds: string[];
  factIds: string[];
  graph: ResumeEvidenceGraph;
  facts: Map<string, FactStatement>;
  originalText: string;
  reason: string;
}) {
  const sourceFacts = input.factIds.map((id) => input.facts.get(id)).filter((fact): fact is FactStatement => Boolean(fact));
  const evidenceRefs = evidenceRefsForFacts(sourceFacts);
  const guard = runRuleFactGuard({ originalText: input.originalText, checkedText: input.text, usedEvidenceRefs: evidenceRefs });
  const allConfirmed = sourceFacts.length > 0 && sourceFacts.every(isConfirmedFact);
  const classification = !allConfirmed || guard.status === "blocked_high_risk"
    ? "UNSUPPORTED"
    : guard.status === "needs_edit"
      ? "NEEDS_USER_CONFIRMATION"
      : input.classification;
  return ResumeClaimSchema.parse({
    id: input.id,
    text: input.text,
    classification,
    sourceAssetIds: input.sourceAssetIds,
    factIds: input.factIds,
    sourceTurnIds: input.factIds.flatMap((id) => input.facts.get(id)?.provenance.map((source) => source.sourceTurnId).filter((value): value is string => Boolean(value)) ?? []),
    evidenceNodeIds: input.sourceAssetIds.flatMap((assetId) => input.graph.nodes.filter((node) => node.sourceAssetIds.includes(assetId)).map((node) => node.id)),
    reason: classification === "UNSUPPORTED" ? "来源证据不足或规则守卫阻止该表达进入简历。" : input.reason,
    guardStatus: guard.status === "pass" ? "pass" : guard.status === "needs_edit" ? "needs_edit" : guard.status === "blocked_high_risk" ? "blocked" : "not_run"
  });
}

function applyBulletClaims(data: ResumeItemV2, claims: ResumeClaim[]) {
  const bullets = claims.filter((claim) => claim.classification === "SUPPORTED" || claim.classification === "DERIVED_PRESENTATION").map((claim) => claim.text);
  if (data.sectionType === "project") return { ...data, highlights: bullets.slice(0, 4), outcomes: [] };
  if (data.sectionType === "research") return { ...data, highlights: bullets.slice(0, 4) };
  if (["education", "work", "internship", "campus", "volunteer"].includes(data.sectionType)) return { ...data, highlights: bullets.slice(0, 4) } as ResumeItemV2;
  return data;
}

function derivedSkills(graph: ResumeEvidenceGraph, facts: Map<string, FactStatement>) {
  const skillClaims: ResumeClaim[] = [];
  const grouped = new Map<string, { names: string[]; claimIds: string[]; factIds: string[]; sourceAssetIds: string[] }>();
  for (const skill of graph.skillMatrix) {
    const claim = claimFor({
      id: `claim:skill:${skill.name}`,
      text: skill.name,
      classification: "SUPPORTED",
      sourceAssetIds: skill.sourceAssetIds,
      factIds: skill.factIds,
      graph,
      facts,
      originalText: skill.sourceAssetIds
        .flatMap((assetId) => graph.nodes.find((node) => node.id === `asset:${assetId}`)?.sourceExcerpts ?? [])
        .join(" "),
      reason: "从多个已确认职业资产的显式工具、方法或技能字段汇总。"
    });
    skillClaims.push(claim);
    if (claim.classification === "SUPPORTED" || claim.classification === "DERIVED_PRESENTATION") {
      const group = grouped.get(skill.category) ?? { names: [], claimIds: [], factIds: [], sourceAssetIds: [] };
      group.names = unique([...group.names, skill.name]);
      group.claimIds = unique([...group.claimIds, claim.id]);
      group.factIds = unique([...group.factIds, ...skill.factIds]);
      group.sourceAssetIds = unique([...group.sourceAssetIds, ...skill.sourceAssetIds]);
      grouped.set(skill.category, group);
    }
  }
  const items = [...grouped.entries()].map(([category, group]) => ({
    sourceAssetId: `derived-skill-group:${stableToken(category)}`,
    data: {
      id: `composition-skill-group-${stableToken(category)}`,
      sectionType: "skills" as const,
      name: group.names.join(" · "),
      category,
      customFields: []
    },
    claimIds: group.claimIds,
    factIds: group.factIds,
    sourceBlockIds: [],
    sourceExcerpt: group.names.join("、")
  }));
  return { items, claims: skillClaims, names: [...grouped.values()].flatMap((group) => group.names) };
}

function initialMetrics(input: { items: ResumeCompiledItem[]; claims: ResumeClaim[]; input: ResumeWriterInput; selectedEntries: number }): ResumeCompositionMetrics {
  const visibleClaims = input.claims.filter((claim) => claim.classification !== "UNSUPPORTED");
  const bullets = input.items.flatMap((item) => {
    const data = item.data as unknown as Record<string, unknown>;
    return [
      ...(Array.isArray(data.highlights) ? data.highlights : []),
      ...(Array.isArray(data.outcomes) ? data.outcomes : [])
    ].filter((value): value is string => typeof value === "string");
  });
  return {
    sourceAssets: input.input.graph.sourceAssetIds.length,
    selectedAssets: input.selectedEntries,
    derivedSkills: input.input.graph.skillMatrix.length,
    questionsAsked: input.input.blueprint.informationNeeds.length,
    supportedClaims: visibleClaims.filter((claim) => claim.classification === "SUPPORTED").length,
    derivedPresentationClaims: visibleClaims.filter((claim) => claim.classification === "DERIVED_PRESENTATION").length,
    needsConfirmationClaims: input.claims.filter((claim) => claim.classification === "NEEDS_USER_CONFIRMATION").length,
    unsupportedClaims: input.claims.filter((claim) => claim.classification === "UNSUPPORTED").length,
    bulletsGenerated: bullets.length,
    duplicateBullets: 0,
    fillerBullets: 0,
    lowDensityBullets: 0,
    paragraphHeavyItems: input.items.filter((item) => item.data.sectionType === "project" && Boolean((item.data as Extract<ResumeItemV2, { sectionType: "project" }>).description)).length,
    pageOverflow: input.input.blueprint.pageBudget.estimatedPageCount > 1,
    onePageReasonable: input.input.blueprint.pageBudget.estimatedPageCount <= 1.2
  };
}

function collectFacts(profile: ReturnType<typeof migrateCareerProfileToV2>) {
  const facts = new Map<string, FactStatement>();
  for (const experience of profile.experiences) for (const fact of experience.facts) facts.set(fact.id, fact);
  for (const skill of profile.skills) if (skill.fact) facts.set(skill.fact.id, skill.fact);
  for (const certificate of profile.certificates) if (certificate.fact) facts.set(certificate.fact.id, certificate.fact);
  return facts;
}

function proposalSummary(input: {
  profile: ReturnType<typeof migrateCareerProfileToV2>;
  selectedEntries: NonNullable<ReturnType<typeof migrateCareerProfileToV2>["structuredFacts"]>;
  derivedSkillItems: { items: ResumeCompiledItem[]; names: string[] };
  input: ResumeWriterInput;
}) {
  const projectTitles = input.selectedEntries
    .filter((entry) => entry.data.sectionType === "project")
    .map((entry) => resolveCareerAssetDisplayIdentity(entry.data).label)
    .slice(0, 3);
  const skillNames = input.derivedSkillItems.names.slice(0, 4);
  if (projectTitles.length && skillNames.length) return `这份简历会重点呈现 ${projectTitles.join("、")} 等项目实践，并将 ${skillNames.join("、")} 等已确认能力压缩为清晰的技能分组。`;
  if (projectTitles.length) return `这份简历会重点呈现 ${projectTitles.join("、")} 等项目实践，保留教育与研究经历中的可验证要点。`;
  if (skillNames.length) return `这份简历会先突出已确认的教育背景与 ${skillNames.join("、")} 等技能，再补充相关经历。`;
  return input.profile.basics.summary?.trim() || "这份简历会整理已确认的教育与职业经历，保留可追溯的事实边界。";
}

function hasContactDetails(profile: ReturnType<typeof migrateCareerProfileToV2>) {
  const basics = profile.basics as unknown as Record<string, unknown>;
  return [
    basics.email,
    basics.phone,
    basics.location,
    ...(Array.isArray(basics.links) ? basics.links : []),
    ...(Array.isArray(basics.portfolioLinks) ? basics.portfolioLinks : []),
    ...(Array.isArray(basics.otherLinks) ? basics.otherLinks : [])
  ].some((value) => typeof value === "string" && value.trim());
}

function evidenceRefsForFacts(facts: FactStatement[]): MatchEvidenceRef[] {
  return facts.map((fact) => {
    const source = fact.provenance[0];
    if (fact.category === "skill") return { type: "skill_fact", skillId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
    if (fact.category === "certificate" || fact.category === "achievement") return { type: "certificate_fact", certificateId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
    return { type: "experience_fact", experienceId: source.sourceId, factId: fact.id, factQuote: source.sourceQuote ?? source.sourceText, factText: fact.statement };
  });
}

function isConfirmedFact(fact: FactStatement) {
  return fact.confirmedByUser && fact.riskLevel !== "high" && fact.provenance.some((source) => source.confirmedByUser);
}

function splitBullet(value: string) {
  return value.split(/[\n。；;]+/u).map((part) => part.trim()).filter((part) => part.length >= 4).map((part) => part.replace(/^(?:项目成果|项目背景|研究方法|成果|说明)[:：]\s*/u, "").trim()).filter(Boolean).slice(0, 4);
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stableToken(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 48);
}
