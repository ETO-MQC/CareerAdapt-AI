import {
  JobRequirementGraphV3Schema,
  type JdAnalyzerOutput,
  type JdSourceUnit,
  type JobDescription,
  type JobRequirementGraphV3,
  type RequirementNodeV3,
  type SourceSpan
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { adaptJobRequirementGraphV4ToV3 } from "../v4/analyze";

export const JOB_REQUIREMENT_ANALYZER_V3 = "jd-analyzer.unit-ledger-v3.1";

type Section = RequirementNodeV3["section"] | "excluded";
type Relation = JobRequirementGraphV3["groups"][number]["relation"];
type UnitContext = { unit: JdSourceUnit; section: Section; relation?: Relation; minimumSatisfied?: number };

const HEADING_RULES: Array<[RegExp, Section]> = [
  [/^(职责内容|岗位职责|职位职责|工作职责|主要职责|职责描述|工作内容|responsibilities?)\s*[:：]?$/i, "responsibility"],
  [/^(参与要求|岗位要求|必备条件|硬性条件|任职要求|职位要求|任职资格|基本要求|申请要求|候选人要求|requirements?|qualifications?)\s*[:：]?$/i, "required"],
  [/^(优先考虑|加分项|优先条件|preferred|nice to have)\s*[:：]?$/i, "preferred"],
  [/^(候选人需提供的验证材料|验证材料|申请材料)\s*[:：]?$/i, "verification"],
  [/^(我们希望你是这样的人|候选人画像|人物画像)\s*[:：]?$/i, "role_profile"],
  [/^(公司介绍|关于我们|团队介绍|薪资福利|福利待遇|员工福利|company|about us|benefits?)\s*[:：]?$/i, "excluded"]
];
const METADATA = /^(关联项目|岗位标签|职位类别|Vibe Coding|【[^】]+】(?:\s*[\w -]+)?)\s*[:：]?$/i;
const WRAPPERS: Array<[RegExp, Relation, number?]> = [
  [/^(满足以下任一条件即可|满足任一条件即可|以下任一条件)\s*[:：]?$/i, "any_of", 1],
  [/^具备以下任一条件者优先\s*[:：]?$/i, "preferred_any_of"],
  [/^根据自身情况提供以下材料\s*[:：]?$/i, "evidence_bundle"]
];
const DETAIL_LEADS: Array<[RegExp, RequirementNodeV3["details"][number]["type"]]> = [
  [/(?:包括但不限于)[:：]\s*$/, "scenario"],
  [/(?:明确写出)[:：]\s*$/, "required_field"],
  [/(?:例如)[:：]\s*$/, "failure_pattern"]
];
const BADCASE_LEAD = /至少\s*1\s*个真实\s*coding agent badcase.*需包括[:：]\s*$/i;
const TECH_TERMS = ["Cursor Pro", "Claude Code", "Coding Agent", "Vibe Coding", "Playwright", "Vitest", "Python", "FastAPI", "RAG", "GitHub", "training data", "reward hacking", "long context", "multi-file", "Cursor", "Codex", "Windsurf", "verifier", "benchmark", "badcase", "RL"];
const MUST = /必须|必备|至少|不少于|需具备|required|must|minimum/i;
const SOFT = /沟通|协作|表达|学习能力|责任心|抗压|团队合作|好奇心|自驱|communication|collaboration/i;
const YEARS = /(?:至少|不少于|minimum\s*)?(\d+(?:\.\d+)?)\s*(?:年|years?)/i;

export type JobGraphValidation = {
  valid: boolean;
  status: "validated" | "needs_review";
  issues: string[];
  metrics: {
    sourceCoverage: number; allSourceUnitsAssigned: boolean; metadataInRequirements: number;
    headingInRequirements: number; wrapperInRequirements: number; orphanDetails: number;
    inventedReferences: number; duplicateTopLevelIntent: number; verificationInRequirements: number;
    hiringSignalHardConstraint: number; emptyGroups: number; sourceSpanRoundTripFailure: number;
    hardWrapperNodes: number; danglingGroupChildren: number; duplicateNormalizedIntent: number;
    sourceQuoteNotFound: number; silentLoss: number;
  };
};
export type ReconciledJobGraph = JobGraphValidation & { graph: JobRequirementGraphV3 };

export function analyzeJobDescriptionV3(input: { rawText: string }): JobRequirementGraphV3 {
  const contexts = segmentSourceUnits(input.rawText);
  const sourceUnits = contexts.map((item) => item.unit);
  const requirements: RequirementNodeV3[] = [];
  const groups: JobRequirementGraphV3["groups"] = [];
  const verificationMaterials: JobRequirementGraphV3["verificationMaterials"] = [];
  const hiringSignals: JobRequirementGraphV3["roleProfile"]["hiringSignals"] = [];
  let activeGroup: JobRequirementGraphV3["groups"][number] | undefined;
  let detailParent: RequirementNodeV3 | undefined;
  let detailType: RequirementNodeV3["details"][number]["type"] | undefined;
  let badcaseMaterial: JobRequirementGraphV3["verificationMaterials"][number] | undefined;

  for (const context of contexts) {
    const unit = context.unit;
    if (["heading", "metadata", "excluded"].includes(unit.disposition)) { activeGroup = undefined; detailParent = undefined; detailType = undefined; badcaseMaterial = undefined; if (unit.disposition === "heading" && context.section === "verification") { activeGroup = makeGroup(unit, "evidence_bundle"); groups.push(activeGroup); } continue; }
    if (unit.disposition === "wrapper") {
      if (!activeGroup || activeGroup.relation !== context.relation) { activeGroup = makeGroup(unit, context.relation!, context.minimumSatisfied); groups.push(activeGroup); }
      detailParent = undefined; detailType = undefined; continue;
    }
    if (unit.disposition === "requirement_detail" && detailParent && detailType) {
      unit.parentUnitId = detailParent.sourceUnitId;
      detailParent.details.push({ id: `detail-${stableHashText(unit.id)}`, type: detailType, text: unit.text.replace(/[；。]$/, ""), sourceSpan: unit.sourceSpan, sourceUnitId: unit.id });
      continue;
    }
    if (unit.disposition === "requirement_detail" && badcaseMaterial) {
      unit.parentUnitId = badcaseMaterial.sourceUnitId;
      continue;
    }
    if (unit.disposition === "verification_material") {
      const material = toVerificationMaterial(unit);
      verificationMaterials.push(material);
      if (activeGroup?.relation === "evidence_bundle") activeGroup.requirementIds.push(material.id);
      if (BADCASE_LEAD.test(unit.text)) badcaseMaterial = material;
      continue;
    }
    if (unit.disposition === "hiring_signal") {
      hiringSignals.push({ id: `signal-${stableHashText(unit.id)}`, statement: unit.text, normalizedIntent: normalizeIntent(unit.text), sourceSpan: unit.sourceSpan, confidence: 0.9 });
      continue;
    }
    if (unit.disposition !== "requirement") continue;
    const node = toRequirement(unit, context.section, activeGroup);
    requirements.push(node);
    if (activeGroup && activeGroup.relation !== "evidence_bundle") activeGroup.requirementIds.push(node.id);
    const lead = DETAIL_LEADS.find(([pattern]) => pattern.test(unit.text));
    detailParent = lead ? node : undefined;
    detailType = lead?.[1];
  }

  const mergedRequirements = mergeRequirements(requirements);
  const replacementIds = new Map(requirements.map((item) => [item.id, mergedRequirements.find((merged) => merged.normalizedIntent === item.normalizedIntent)?.id ?? item.id]));
  for (const group of groups) group.requirementIds = unique(group.requirementIds.map((id) => replacementIds.get(id) ?? id));
  const meaningful = sourceUnits.filter((u) => u.disposition !== "excluded");
  const unassigned = meaningful.filter((u) => u.disposition === "unclassified");
  const coveredSpans = sourceUnits.map((u) => u.sourceSpan);
  const graphBase = {
    schemaVersion: "job-requirement-graph-v3" as const,
    roleProfile: { mission: requirements.find((r) => r.section === "responsibility")?.statement, hiringSignals },
    groups: groups.filter((g) => g.requirementIds.length), requirements: mergedRequirements, verificationMaterials, sourceUnits,
    sourceCoverage: {
      coveredSpans, unclassifiedSpans: unassigned.map((u) => u.sourceSpan), totalMeaningfulUnits: meaningful.length,
      assignedUnits: meaningful.length - unassigned.length, unassignedUnitIds: unassigned.map((u) => u.id),
      metadataUnitIds: sourceUnits.filter((u) => u.disposition === "metadata").map((u) => u.id),
      excludedUnitIds: sourceUnits.filter((u) => u.disposition === "excluded").map((u) => u.id),
      requirementUnitIds: sourceUnits.filter((u) => u.disposition === "requirement").map((u) => u.id),
      detailUnitIds: sourceUnits.filter((u) => u.disposition === "requirement_detail").map((u) => u.id),
      inventedReferenceCount: 0,
      coverageRatio: meaningful.length ? (meaningful.length - unassigned.length) / meaningful.length : 1
    }, analyzerVersion: JOB_REQUIREMENT_ANALYZER_V3
  };
  return withHashes(graphBase);
}

export function reconcileJobRequirementGraphV3(input: { rawText: string; aiOutput?: JdAnalyzerOutput }): ReconciledJobGraph {
  const deterministic = analyzeJobDescriptionV3({ rawText: input.rawText });
  const assignments = input.aiOutput?.unitAssignments ?? [];
  const sourceIds = new Set(deterministic.sourceUnits?.map((u) => u.id));
  const invented = assignments.filter((a) => !sourceIds.has(a.sourceUnitId)).length;
  const duplicate = assignments.length - new Set(assignments.map((a) => a.sourceUnitId)).size;
  const validAssignments = assignments.filter((a) => sourceIds.has(a.sourceUnitId));
  const requirements = deterministic.requirements.map((node) => {
    const assignment = validAssignments.find((a) => a.sourceUnitId === node.sourceUnitId);
    const legacy = input.aiOutput?.requirements.find((candidate) => candidate.id === node.id || candidate.sourceSpan?.start === node.sourceSpan.start);
    if (!assignment && !legacy) return node;
    if (assignment?.disposition && ["metadata", "heading", "wrapper", "requirement_detail", "verification_material"].includes(assignment.disposition)) return node;
    const legacyKind = legacy ? categoryToKind(legacy.category) : node.kind;
    return { ...node, normalizedIntent: assignment?.normalizedIntent || node.normalizedIntent, exactKeywords: unique([...node.exactKeywords, ...(assignment?.exactKeywords ?? []), ...(legacy?.keywords ?? [])]), semanticAliases: unique([...node.semanticAliases, ...(assignment?.semanticAliases ?? [])]), confidence: Math.max(node.confidence, legacy ? confidenceNumber(legacy.confidenceLevel) : 0), needsConfirmation: node.needsConfirmation || Boolean(assignment && assignment.disposition !== "requirement") || legacyKind !== node.kind };
  });
  const enrichment = { assignments: validAssignments.map((a) => ({ id: a.sourceUnitId, keywords: [...(a.exactKeywords ?? [])].sort(), aliases: [...(a.semanticAliases ?? [])].sort(), confidence: a.confidence })), legacy: (input.aiOutput?.requirements ?? []).map((item) => ({ id: item.id, keywords: [...item.keywords].sort(), confidenceLevel: item.confidenceLevel })).sort((a, b) => a.id.localeCompare(b.id)) };
  const graph = withHashes({ ...deterministic, requirements, sourceCoverage: { ...deterministic.sourceCoverage, inventedReferenceCount: invented + Math.max(0, duplicate) }, analyzerVersion: input.aiOutput ? `${JOB_REQUIREMENT_ANALYZER_V3}+ai-reconcile` : JOB_REQUIREMENT_ANALYZER_V3 }, enrichment);
  const validation = validateJobRequirementGraphV3(graph, deterministic.requirements.length);
  if (assignments.length) {
    const missing = (deterministic.sourceUnits ?? []).filter((unit) => !validAssignments.some((assignment) => assignment.sourceUnitId === unit.id)).map((unit) => unit.id);
    if (missing.length) validation.issues.push(`AI 遗漏 ${missing.length} 个 Source Unit`);
    if (duplicate) validation.issues.push(`AI 重复返回 ${duplicate} 个 Source Unit`);
    if (invented) validation.issues.push(`AI 返回 ${invented} 个不存在的 Source Unit`);
    validation.valid = validation.issues.length === 0; validation.status = validation.valid ? "validated" : "needs_review";
  }
  return { graph, ...validation };
}

export function validateJobRequirementGraphV3(graph: JobRequirementGraphV3, deterministicCount = graph.requirements.length): JobGraphValidation {
  const units = graph.sourceUnits ?? [];
  const dispositions = new Map(units.map((u) => [u.id, u.disposition]));
  const nodeIds = new Set(graph.requirements.map((r) => r.id));
  const materialIds = new Set(graph.verificationMaterials.map((m) => m.id));
  const referencedUnits = [...graph.requirements.map((r) => r.sourceUnitId), ...graph.requirements.flatMap((r) => r.details.map((d) => d.sourceUnitId)), ...graph.verificationMaterials.map((m) => m.sourceUnitId)].filter(Boolean) as string[];
  const metrics = {
    sourceCoverage: graph.sourceCoverage.coverageRatio,
    allSourceUnitsAssigned: graph.sourceCoverage.unassignedUnitIds.length === 0,
    metadataInRequirements: graph.requirements.filter((r) => dispositions.get(r.sourceUnitId ?? "") === "metadata").length,
    headingInRequirements: graph.requirements.filter((r) => dispositions.get(r.sourceUnitId ?? "") === "heading").length,
    wrapperInRequirements: graph.requirements.filter((r) => dispositions.get(r.sourceUnitId ?? "") === "wrapper").length,
    orphanDetails: graph.requirements.reduce((count, requirement) => count + requirement.details.filter((d) => !units.some((u) => u.id === d.sourceUnitId && u.parentUnitId === requirement.sourceUnitId)).length, 0),
    inventedReferences: graph.sourceCoverage.inventedReferenceCount + referencedUnits.filter((id) => !dispositions.has(id)).length,
    duplicateTopLevelIntent: graph.requirements.length - new Set(graph.requirements.map((r) => r.normalizedIntent)).size,
    verificationInRequirements: graph.requirements.filter((r) => dispositions.get(r.sourceUnitId ?? "") === "verification_material").length,
    hiringSignalHardConstraint: 0,
    emptyGroups: graph.groups.filter((g) => ["any_of", "preferred_any_of"].includes(g.relation) && g.requirementIds.length === 0).length,
    sourceSpanRoundTripFailure: [...units.map((u) => u.sourceSpan), ...graph.requirements.map((r) => r.sourceSpan)].filter((s) => s.text.length !== s.end - s.start).length,
    hardWrapperNodes: graph.requirements.filter((r) => dispositions.get(r.sourceUnitId ?? "") === "wrapper").length,
    danglingGroupChildren: graph.groups.flatMap((g) => g.requirementIds).filter((id) => !nodeIds.has(id) && !materialIds.has(id)).length,
    duplicateNormalizedIntent: graph.requirements.length - new Set(graph.requirements.map((r) => r.normalizedIntent)).size,
    sourceQuoteNotFound: referencedUnits.filter((id) => !dispositions.has(id)).length,
    silentLoss: Math.max(0, deterministicCount - graph.requirements.length)
  };
  const issues: string[] = [];
  for (const [key, value] of Object.entries(metrics)) if (key !== "sourceCoverage" && key !== "allSourceUnitsAssigned" && typeof value === "number" && value > 0) issues.push(`${key}: ${value}`);
  if (!metrics.allSourceUnitsAssigned) issues.push(`未分类 Source Unit：${graph.sourceCoverage.unassignedUnitIds.join("、")}`);
  if (metrics.sourceCoverage < 1) issues.push(`语义来源覆盖率仅 ${(metrics.sourceCoverage * 100).toFixed(1)}%`);
  return { valid: issues.length === 0, status: issues.length ? "needs_review" : "validated", issues, metrics };
}

export function buildCanonicalJobRequirementGraphV3(job: JobDescription) {
  if (job.requirementGraph) return job.requirementGraph.schemaVersion === "job-requirement-graph-v4"
    ? adaptJobRequirementGraphV4ToV3(job.requirementGraph)
    : job.requirementGraph;
  const graph = analyzeJobDescriptionV3({ rawText: job.rawText });
  if (!job.requirements.length) return graph;
  const byId = new Map(graph.requirements.map((r) => [r.id, r]));
  const projected = job.requirements.map((item) => byId.get(item.id) ?? ({
    id: item.id, section: item.category === "responsibility" ? "responsibility" : ["preferred_skill", "nice_to_have"].includes(item.category) ? "preferred" : "required",
    kind: categoryToKind(item.category), statement: item.description, normalizedIntent: normalizeIntent(item.description),
    priority: item.priority === "must" || item.hardConstraint ? "must" : item.priority === "high" || item.priority === "important" ? "high" : item.priority === "nice_to_have" || item.priority === "low" ? "nice_to_have" : item.priority === "uncertain" ? "uncertain" : "medium",
    hardConstraint: item.hardConstraint, exactKeywords: item.keywords, semanticAliases: [], details: [], sourceSpan: item.sourceSpan,
    sourceSpans: [item.sourceSpan], confidence: item.confidence, needsConfirmation: item.category === "risk_or_uncertain"
  } satisfies RequirementNodeV3));
  return withHashes({ ...graph, groups: [], requirements: projected, analyzerVersion: `${JOB_REQUIREMENT_ANALYZER_V3}.flat-projection` });
}

export function segmentJdSourceUnits(rawText: string) { return segmentSourceUnits(rawText).map((c) => c.unit); }

function segmentSourceUnits(rawText: string): UnitContext[] {
  const result: UnitContext[] = []; let section: Section = "responsibility"; let activeRelation: Relation | undefined; let detailType: RequirementNodeV3["details"][number]["type"] | undefined; let detailParentId: string | undefined; let detailRemaining = 0; let badcaseParentId: string | undefined; let badcaseRemaining = 0;
  const lines = rawText.split(/\r?\n/); let offset = 0;
  lines.forEach((raw, index) => {
    const trimmed = raw.trim(); const start = offset + raw.indexOf(trimmed); offset += raw.length + (rawText.slice(offset + raw.length, offset + raw.length + 2) === "\r\n" ? 2 : 1); if (!trimmed) return;
    const text = trimmed.replace(/^(?:[-*•·]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim(); const textStart = start + trimmed.indexOf(text);
    const span = { start: textStart, end: textStart + text.length, text }; const id = `unit-${stableHashText(`${textStart}:${text}`)}`;
    const heading = HEADING_RULES.find(([p]) => p.test(text)); const wrapper = WRAPPERS.find(([p]) => p.test(text));
    let disposition: JdSourceUnit["disposition"] = "requirement"; let relation: Relation | undefined; let minimumSatisfied: number | undefined;
    if (METADATA.test(text)) disposition = "metadata";
    else if (heading) { disposition = /^(职责内容|参与要求)$/.test(text) ? "metadata" : "heading"; section = heading[1]; activeRelation = undefined; }
    else if (wrapper) { disposition = "wrapper"; relation = wrapper[1]; minimumSatisfied = wrapper[2]; activeRelation = relation; if (relation === "preferred_any_of") section = "preferred"; if (relation === "evidence_bundle") section = "verification"; }
    else if (section === "excluded") disposition = "excluded";
    else if (section === "role_profile") disposition = "hiring_signal";
    else if (section === "verification") disposition = badcaseParentId && badcaseRemaining > 0 ? "requirement_detail" : "verification_material";
    else if (detailType && detailParentId && detailRemaining > 0) disposition = "requirement_detail";
    const punctuation: JdSourceUnit["punctuation"] = heading ? "heading" : /[:：]$/.test(text) ? "colon_lead" : /；$/.test(text) ? "semicolon_item" : /[。！？]$/.test(text) ? "sentence" : "plain";
    const unit: JdSourceUnit = { id, text, sourceSpan: span, lineNumber: index + 1, indentation: raw.length - raw.trimStart().length, punctuation, disposition, ...(disposition === "requirement_detail" && (detailParentId || badcaseParentId) ? { parentUnitId: detailParentId || badcaseParentId } : {}) };
    result.push({ unit, section, relation, minimumSatisfied });
    const lead = DETAIL_LEADS.find(([p]) => p.test(text)); if (lead && disposition === "requirement") { detailType = lead[1]; detailParentId = id; detailRemaining = 6; }
    else if (BADCASE_LEAD.test(text) && disposition === "verification_material") { badcaseParentId = id; badcaseRemaining = 5; }
    else if (disposition === "requirement_detail" && detailRemaining > 0) { detailRemaining -= 1; if (!detailRemaining) { detailType = undefined; detailParentId = undefined; } }
    else if (disposition === "requirement_detail" && badcaseRemaining > 0) { badcaseRemaining -= 1; if (!badcaseRemaining) badcaseParentId = undefined; }
    else if (disposition !== "requirement_detail") { detailType = undefined; detailParentId = undefined; if (disposition !== "verification_material") badcaseParentId = undefined; }
    if (activeRelation && !relation) result[result.length - 1].relation = activeRelation;
  });
  return result;
}

function makeGroup(unit: JdSourceUnit, relation: Relation, minimumSatisfied?: number) { return { id: `group-${stableHashText(`${relation}:${unit.id}`)}`, label: unit.text, relation, minimumSatisfied, requirementIds: [], sourceSpan: unit.sourceSpan }; }
function toRequirement(unit: JdSourceUnit, section: Section, group?: JobRequirementGraphV3["groups"][number]): RequirementNodeV3 {
  const preferred = section === "preferred" || group?.relation === "preferred_any_of"; const keywords = extractKeywords(unit.text); const technical = keywords.some((term) => TECH_TERMS.some((known) => normalize(known) === normalize(term))); const hard = !preferred && (MUST.test(unit.text) || Boolean(YEARS.exec(unit.text)) || group?.relation === "any_of");
  const kind: RequirementNodeV3["kind"] = preferred ? "preferred" : technical ? "tool_or_technology" : SOFT.test(unit.text) ? "soft_skill" : section === "responsibility" ? "responsibility" : section === "required" ? "core_competency" : "risk_or_uncertain";
  return { id: `jrv3-${stableHashText(unit.id)}`, section: section === "excluded" ? "unknown" : section, kind, statement: unit.text, normalizedIntent: normalizeIntent(unit.text), priority: preferred ? "nice_to_have" : hard ? "must" : section === "responsibility" ? "high" : "medium", hardConstraint: hard, exactKeywords: keywords, semanticAliases: aliasesFor(unit.text), parentGroupId: group && group.relation !== "evidence_bundle" ? group.id : undefined, sourceUnitId: unit.id, details: [], sourceSpan: unit.sourceSpan, sourceSpans: [unit.sourceSpan], confidence: 0.9, needsConfirmation: false };
}
function toVerificationMaterial(unit: JdSourceUnit): JobRequirementGraphV3["verificationMaterials"][number] { const n = normalize(unit.text); const kind = n.includes("dashboard") ? "usage_dashboard" : n.includes("billing") ? "billing_history" : n.includes("github") ? "github" : n.includes("badcase") ? "badcase" : "other"; return { id: `material-${stableHashText(unit.id)}`, label: unit.text, kind, requiredComponents: kind === "badcase" ? ["agent", "goal", "failure", "reproduction", "cause"] : [], sourceUnitId: unit.id, sourceSpan: unit.sourceSpan, confidence: 0.9, needsConfirmation: false }; }
function mergeRequirements(items: RequirementNodeV3[]) { const result: RequirementNodeV3[] = []; for (const item of items) { const existing = result.find((candidate) => candidate.normalizedIntent === item.normalizedIntent); if (!existing) { result.push(item); continue; } existing.sourceSpans = uniqueSpans([...existing.sourceSpans, ...item.sourceSpans]); existing.exactKeywords = unique([...existing.exactKeywords, ...item.exactKeywords]); existing.details = [...existing.details, ...item.details]; } return result; }
function uniqueSpans(items: SourceSpan[]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.start}:${item.end}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function withHashes(base: Omit<JobRequirementGraphV3, "graphHash" | "semanticEnrichmentHash"> & Partial<Pick<JobRequirementGraphV3, "graphHash" | "semanticEnrichmentHash">>, enrichment?: unknown) { const canonical = { sourceUnits: base.sourceUnits?.map((u) => ({ id: u.id, disposition: u.disposition, parentUnitId: u.parentUnitId, sourceSpan: u.sourceSpan })), requirements: base.requirements.map((r) => ({ id: r.id, sourceUnitId: r.sourceUnitId, section: r.section, kind: r.kind, priority: r.priority, normalizedIntent: r.normalizedIntent, parentGroupId: r.parentGroupId, sourceSpan: r.sourceSpan, details: r.details.map((d) => ({ id: d.id, type: d.type, sourceUnitId: d.sourceUnitId, sourceSpan: d.sourceSpan })) })), groups: base.groups.map((g) => ({ id: g.id, relation: g.relation, minimumSatisfied: g.minimumSatisfied, requirementIds: [...g.requirementIds].sort(), sourceSpan: g.sourceSpan })), materials: base.verificationMaterials.map((m) => ({ id: m.id, sourceUnitId: m.sourceUnitId, sourceSpan: m.sourceSpan })) }; return JobRequirementGraphV3Schema.parse({ ...base, graphHash: stableHashText(stableJson(canonical)), semanticEnrichmentHash: stableHashText(stableJson(enrichment ?? {})) }); }
function extractKeywords(text: string) { return unique(TECH_TERMS.filter((term) => normalize(text).includes(normalize(term))).sort((a, b) => a.localeCompare(b))); }
function aliasesFor(text: string) { const pairs: Array<[RegExp, string[]]> = [[/reward hacking/i, ["投机行为", "评测规避"]], [/badcase/i, ["失败案例", "反例"]], [/vibe coding/i, ["AI 辅助开发"]]]; return unique(pairs.filter(([p]) => p.test(text)).flatMap(([, a]) => a)); }
function categoryToKind(category: string): RequirementNodeV3["kind"] { if (category === "responsibility") return "responsibility"; if (["preferred_skill", "nice_to_have"].includes(category)) return "preferred"; if (category === "tool") return "tool_or_technology"; if (category === "soft_skill") return "soft_skill"; if (category === "education") return "education"; if (category === "language") return "language"; if (category === "experience") return "experience_depth"; return "core_competency"; }
function confidenceNumber(level: "high" | "medium" | "low") { return level === "high" ? 0.9 : level === "medium" ? 0.7 : 0.45; }
function normalize(value: string) { return value.toLowerCase().replace(/\s+/g, " ").trim(); }
function normalizeIntent(value: string) { return normalize(value).replace(/[，。；、:：,.!?！？（）()]/g, " ").replace(/\s+/g, " ").trim(); }
function unique<T>(items: T[]) { return [...new Set(items)]; }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`; return JSON.stringify(value); }
