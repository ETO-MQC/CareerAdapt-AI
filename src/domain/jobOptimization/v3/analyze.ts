import {
  JobRequirementGraphV3Schema,
  type JdAnalyzerOutput,
  type JobDescription,
  type JobRequirementGraphV3,
  type RequirementNodeV3,
  type SourceSpan
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

export const JOB_REQUIREMENT_ANALYZER_V3 = "jd-analyzer.reconciled-v3.0";

type Section = RequirementNodeV3["section"] | "excluded";
type Line = { text: string; contentSpan: SourceSpan; lineSpan: SourceSpan; section: Section; heading: boolean; wrapper?: GroupIntent };
type GroupIntent = { relation: "any_of" | "preferred_any_of" | "evidence_bundle"; minimumSatisfied?: number };

const HEADINGS: Array<[RegExp, Section]> = [
  [/^(岗位职责|职位职责|工作职责|主要职责|职责描述|工作内容|responsibilities?)\s*[:：]?$/i, "responsibility"],
  [/^(必备条件|硬性条件|任职要求|职位要求|任职资格|基本要求|参与要求|岗位要求|申请要求|候选人要求|requirements?|qualifications?)\s*[:：]?$/i, "required"],
  [/^(加分项|优先条件|优先考虑|preferred|nice to have)\s*[:：]?$/i, "preferred"],
  [/^(候选人需提供的验证材料|验证材料|申请材料)\s*[:：]?$/i, "verification"],
  [/^(我们希望你是这样的人|候选人画像|人物画像)\s*[:：]?$/i, "role_profile"],
  [/^(公司介绍|关于我们|团队介绍|薪资福利|福利待遇|员工福利|company|about us|benefits?)\s*[:：]?$/i, "excluded"]
];

const WRAPPERS: Array<[RegExp, GroupIntent]> = [
  [/^(满足以下任一条件即可|满足任一条件即可|以下任一条件)\s*[:：]?$/i, { relation: "any_of", minimumSatisfied: 1 }],
  [/^具备以下任一条件者优先\s*[:：]?$/i, { relation: "preferred_any_of" }],
  [/^(根据自身情况提供以下材料|包括但不限于)\s*[:：]?$/i, { relation: "evidence_bundle" }]
];

const TECH_TERMS = [
  "Cursor Pro", "Claude Code", "Coding Agent", "Vibe Coding", "Playwright", "Vitest", "training data",
  "reward hacking", "long context", "multi-file", "Cursor", "Codex", "Windsurf", "verifier", "benchmark", "badcase", "RL"
];
const WRAPPER_TEXT = /^(岗位要求|优先考虑|满足以下任一条件即可|满足任一条件即可|以下任一条件|具备以下任一条件者优先|根据自身情况提供以下材料|包括但不限于|我们希望你是这样的人)$/i;
const MUST = /必须|必备|至少|不少于|需具备|required|must|minimum/i;
const RESPONSIBILITY = /负责|参与|推动|设计|开发|维护|交付|分析|管理|build|develop|design|maintain|lead|deliver/i;
const SOFT = /沟通|协作|表达|学习能力|责任心|抗压|团队合作|好奇心|自驱|communication|collaboration/i;
const YEARS = /(?:至少|不少于|minimum\s*)?(\d+(?:\.\d+)?)\s*(?:年|years?)/i;

export type JobGraphValidation = {
  valid: boolean;
  status: "validated" | "needs_review";
  issues: string[];
  metrics: {
    sourceCoverage: number;
    hardWrapperNodes: number;
    danglingGroupChildren: number;
    duplicateNormalizedIntent: number;
    sourceQuoteNotFound: number;
    silentLoss: number;
  };
};

export type ReconciledJobGraph = JobGraphValidation & { graph: JobRequirementGraphV3 };

export function analyzeJobDescriptionV3(input: { rawText: string }): JobRequirementGraphV3 {
  const lines = extractLines(input.rawText);
  const groups: JobRequirementGraphV3["groups"] = [];
  const requirements: RequirementNodeV3[] = [];
  const verificationMaterials: JobRequirementGraphV3["verificationMaterials"] = [];
  const hiringSignals: JobRequirementGraphV3["roleProfile"]["hiringSignals"] = [];
  const coveredSpans: SourceSpan[] = [];
  const unclassifiedSpans: SourceSpan[] = [];
  let activeGroup: JobRequirementGraphV3["groups"][number] | undefined;

  for (const line of lines) {
    if (line.heading || line.wrapper) coveredSpans.push(line.lineSpan);
    if (line.heading) {
      activeGroup = undefined;
      if (line.section === "verification") {
        activeGroup = makeGroup(line, "evidence_bundle");
        groups.push(activeGroup);
      }
      continue;
    }
    if (line.wrapper) {
      const relation = line.wrapper.relation;
      const groupSection = relation === "preferred_any_of" ? "preferred" : relation === "evidence_bundle" ? "verification" : "required";
      line.section = groupSection;
      if (!activeGroup || activeGroup.relation !== relation) {
        activeGroup = makeGroup(line, relation, line.wrapper.minimumSatisfied);
        groups.push(activeGroup);
      }
      continue;
    }
    if (line.section === "excluded") {
      coveredSpans.push(line.lineSpan);
      continue;
    }
    if (line.section === "role_profile") {
      hiringSignals.push({
        id: `signal-${stableHashText(normalize(line.text))}`,
        statement: line.text,
        normalizedIntent: normalizeIntent(line.text),
        sourceSpan: line.contentSpan,
        confidence: 0.9
      });
      coveredSpans.push(line.lineSpan);
      continue;
    }
    if (line.section === "verification") {
      const material = toVerificationMaterial(line);
      verificationMaterials.push(material);
      coveredSpans.push(line.lineSpan);
      if (!activeGroup || activeGroup.relation !== "evidence_bundle") {
        activeGroup = makeGroup(line, "evidence_bundle");
        groups.push(activeGroup);
      }
      activeGroup.requirementIds.push(material.id);
      continue;
    }
    if (!line.text) continue;
    const node = toRequirement(line, activeGroup);
    requirements.push(node);
    coveredSpans.push(line.lineSpan);
    if (activeGroup && activeGroup.relation !== "evidence_bundle") activeGroup.requirementIds.push(node.id);
  }

  const merged = mergeRequirements(requirements);
  for (const group of groups) group.requirementIds = unique(group.requirementIds.filter((id) => merged.some((node) => node.id === id) || verificationMaterials.some((item) => item.id === id)));
  const coverageRatio = calculateCoverage(input.rawText, coveredSpans);
  const graphBase = {
    schemaVersion: "job-requirement-graph-v3" as const,
    roleProfile: { hiringSignals },
    groups: groups.filter((group) => group.requirementIds.length > 0),
    requirements: merged,
    verificationMaterials,
    sourceCoverage: { coveredSpans: mergeSpans(coveredSpans), unclassifiedSpans, coverageRatio },
    analyzerVersion: JOB_REQUIREMENT_ANALYZER_V3
  };
  return JobRequirementGraphV3Schema.parse({ ...graphBase, graphHash: stableHashText(stableGraphJson(graphBase)) });
}

export function reconcileJobRequirementGraphV3(input: { rawText: string; aiOutput?: JdAnalyzerOutput }): ReconciledJobGraph {
  const deterministic = analyzeJobDescriptionV3({ rawText: input.rawText });
  if (!input.aiOutput) {
    const validation = validateJobRequirementGraphV3(deterministic);
    return { graph: deterministic, ...validation };
  }
  const requirements = deterministic.requirements.map((node) => {
    const ai = input.aiOutput!.requirements.find((candidate) => sameSource(candidate.sourceSpan, node.sourceSpan) || normalizeIntent(candidate.description) === node.normalizedIntent);
    if (!ai) return node;
    const aiKind = categoryToKind(ai.category);
    const classificationConflict = aiKind !== node.kind && !(aiKind === "core_competency" && node.kind === "tool_or_technology");
    return {
      ...node,
      exactKeywords: unique([...node.exactKeywords, ...ai.keywords]),
      sourceSpans: uniqueSpans([...node.sourceSpans, ...(ai.sourceSpan ? [ai.sourceSpan] : [])]),
      confidence: Math.max(node.confidence, confidenceNumber(ai.confidenceLevel)),
      needsConfirmation: node.needsConfirmation || ai.needsConfirmation || classificationConflict
    };
  });
  const graphBase = { ...deterministic, requirements, analyzerVersion: `${JOB_REQUIREMENT_ANALYZER_V3}+ai-reconcile` };
  const graph = JobRequirementGraphV3Schema.parse({ ...graphBase, graphHash: stableHashText(stableGraphJson({ ...graphBase, graphHash: undefined })) });
  const validation = validateJobRequirementGraphV3(graph, deterministic.requirements.length);
  return { graph, ...validation };
}

export function validateJobRequirementGraphV3(graph: JobRequirementGraphV3, deterministicCount = graph.requirements.length): JobGraphValidation {
  const nodeIds = new Set(graph.requirements.map((node) => node.id));
  const materialIds = new Set(graph.verificationMaterials.map((item) => item.id));
  const allChildIds = new Set([...nodeIds, ...materialIds]);
  const groupIds = new Set(graph.groups.map((group) => group.id));
  const metrics = {
    sourceCoverage: graph.sourceCoverage.coverageRatio,
    hardWrapperNodes: graph.requirements.filter((node) => WRAPPER_TEXT.test(node.statement)).length,
    danglingGroupChildren: graph.groups.flatMap((group) => group.requirementIds).filter((id) => !allChildIds.has(id)).length
      + graph.requirements.filter((node) => node.parentGroupId && !groupIds.has(node.parentGroupId)).length,
    duplicateNormalizedIntent: graph.requirements.length - new Set(graph.requirements.map((node) => node.normalizedIntent)).size,
    sourceQuoteNotFound: [...graph.requirements.map((node) => node.sourceSpan), ...graph.verificationMaterials.map((item) => item.sourceSpan), ...graph.roleProfile.hiringSignals.map((item) => item.sourceSpan)]
      .filter((span) => graph.sourceCoverage.coveredSpans.every((covered) => covered.start > span.start || covered.end < span.end)).length,
    silentLoss: Math.max(0, deterministicCount - graph.requirements.length)
  };
  const issues: string[] = [];
  if (metrics.sourceCoverage < 0.95) issues.push(`来源覆盖率仅 ${(metrics.sourceCoverage * 100).toFixed(1)}%`);
  if (graph.sourceCoverage.unclassifiedSpans.length) issues.push(`未分类区域：${graph.sourceCoverage.unclassifiedSpans.map((span) => span.text).join("｜")}`);
  if (metrics.hardWrapperNodes) issues.push(`仍有 ${metrics.hardWrapperNodes} 条包装句被误判为要求`);
  if (metrics.danglingGroupChildren) issues.push(`有 ${metrics.danglingGroupChildren} 个分组子项无法定位`);
  if (metrics.duplicateNormalizedIntent) issues.push(`有 ${metrics.duplicateNormalizedIntent} 条重复要求`);
  if (metrics.sourceQuoteNotFound) issues.push(`有 ${metrics.sourceQuoteNotFound} 条来源无法回跳`);
  if (metrics.silentLoss) issues.push(`对账后仍丢失 ${metrics.silentLoss} 条确定性要求`);
  return { valid: issues.length === 0, status: issues.length ? "needs_review" : "validated", issues, metrics };
}

export function buildCanonicalJobRequirementGraphV3(job: JobDescription) {
  if (job.requirementGraph) return job.requirementGraph;
  const deterministic = analyzeJobDescriptionV3({ rawText: job.rawText });
  if (!job.requirements.length) return deterministic;
  const requirements = job.requirements.map((item): RequirementNodeV3 => ({
    id: item.id,
    section: item.category === "responsibility" ? "responsibility" : ["preferred_skill", "nice_to_have"].includes(item.category) ? "preferred" : "required",
    kind: categoryToKind(item.category),
    statement: item.description,
    normalizedIntent: normalizeIntent(item.description),
    priority: item.priority === "must" || item.hardConstraint ? "must" : item.priority === "high" || item.priority === "important" ? "high" : item.priority === "nice_to_have" || item.priority === "low" ? "nice_to_have" : item.priority === "uncertain" ? "uncertain" : "medium",
    hardConstraint: item.hardConstraint,
    exactKeywords: item.keywords.length ? item.keywords : extractKeywords(item.description),
    semanticAliases: aliasesFor(item.description),
    sourceSpan: item.sourceSpan,
    sourceSpans: [item.sourceSpan],
    confidence: item.confidence,
    needsConfirmation: item.category === "risk_or_uncertain"
  }));
  const graphBase = { ...deterministic, groups: [], requirements, analyzerVersion: `${JOB_REQUIREMENT_ANALYZER_V3}.flat-projection` };
  return JobRequirementGraphV3Schema.parse({ ...graphBase, graphHash: stableHashText(stableGraphJson({ ...graphBase, graphHash: undefined })) });
}

function extractLines(rawText: string): Line[] {
  const result: Line[] = [];
  let section: Section = "unknown";
  for (const match of rawText.matchAll(/[^\r\n]+/g)) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lineStart = (match.index ?? 0) + raw.indexOf(trimmed);
    const lineSpan = { start: lineStart, end: lineStart + trimmed.length, text: trimmed };
    const content = trimmed.replace(/^(?:[-*•·]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim();
    const contentStart = lineStart + trimmed.indexOf(content);
    const heading = HEADINGS.find(([pattern]) => pattern.test(content));
    if (heading) section = heading[1];
    const wrapper = WRAPPERS.find(([pattern]) => pattern.test(content))?.[1];
    if (wrapper?.relation === "preferred_any_of") section = "preferred";
    if (wrapper?.relation === "evidence_bundle") section = "verification";
    result.push({
      text: content,
      contentSpan: { start: contentStart, end: contentStart + content.length, text: content },
      lineSpan,
      section,
      heading: Boolean(heading),
      wrapper
    });
  }
  return result;
}

function makeGroup(line: Line, relation: JobRequirementGraphV3["groups"][number]["relation"], minimumSatisfied?: number) {
  return {
    id: `group-${stableHashText(`${relation}:${line.contentSpan.start}:${normalize(line.text)}`)}`,
    label: line.text,
    relation,
    minimumSatisfied,
    requirementIds: [],
    sourceSpan: line.contentSpan
  };
}

function toRequirement(line: Line, activeGroup?: JobRequirementGraphV3["groups"][number]): RequirementNodeV3 {
  const preferred = line.section === "preferred" || activeGroup?.relation === "preferred_any_of";
  const years = YEARS.exec(line.text);
  const exactKeywords = extractKeywords(line.text);
  const technical = exactKeywords.some((term) => TECH_TERMS.some((known) => normalize(known) === normalize(term)));
  const hardConstraint = !preferred && (MUST.test(line.text) || Boolean(years) || activeGroup?.relation === "any_of");
  const kind: RequirementNodeV3["kind"] = preferred ? "preferred"
    : years ? "experience_depth"
      : technical ? "tool_or_technology"
        : SOFT.test(line.text) ? "soft_skill"
          : line.section === "responsibility" || RESPONSIBILITY.test(line.text) ? "responsibility"
            : line.section === "required" ? "core_competency" : "risk_or_uncertain";
  const normalizedIntent = normalizeIntent(line.text);
  return {
    id: `jrv3-${stableHashText(`${normalizedIntent}:${line.contentSpan.start}`)}`,
    section: line.section === "excluded" ? "unknown" : line.section,
    kind,
    statement: line.text,
    normalizedIntent,
    priority: preferred ? "nice_to_have" : hardConstraint ? "must" : line.section === "responsibility" ? "high" : kind === "risk_or_uncertain" ? "uncertain" : "medium",
    hardConstraint,
    exactKeywords,
    semanticAliases: aliasesFor(line.text),
    parentGroupId: activeGroup && activeGroup.relation !== "evidence_bundle" ? activeGroup.id : undefined,
    sourceSpan: line.contentSpan,
    sourceSpans: [line.contentSpan],
    confidence: kind === "risk_or_uncertain" ? 0.55 : 0.9,
    needsConfirmation: kind === "risk_or_uncertain"
  };
}

function toVerificationMaterial(line: Line): JobRequirementGraphV3["verificationMaterials"][number] {
  const normalized = normalize(line.text);
  const kind = normalized.includes("dashboard") ? "usage_dashboard"
    : normalized.includes("billing") ? "billing_history"
      : normalized.includes("github") ? "github"
        : normalized.includes("badcase") ? "badcase" : "other";
  return {
    id: `material-${stableHashText(`${normalized}:${line.contentSpan.start}`)}`,
    label: line.text,
    kind,
    requiredComponents: kind === "badcase" ? ["agent", "goal", "failure", "reproduction", "cause"] : [],
    sourceSpan: line.contentSpan,
    confidence: 0.92,
    needsConfirmation: false
  };
}

function mergeRequirements(nodes: RequirementNodeV3[]) {
  const result = new Map<string, RequirementNodeV3>();
  for (const node of nodes) {
    const existing = result.get(node.normalizedIntent);
    if (!existing) result.set(node.normalizedIntent, node);
    else {
      existing.sourceSpans = uniqueSpans([...existing.sourceSpans, ...node.sourceSpans]);
      existing.exactKeywords = unique([...existing.exactKeywords, ...node.exactKeywords]);
      existing.semanticAliases = unique([...existing.semanticAliases, ...node.semanticAliases]);
      existing.needsConfirmation ||= existing.kind !== node.kind || existing.parentGroupId !== node.parentGroupId;
    }
  }
  return [...result.values()];
}

function calculateCoverage(rawText: string, spans: SourceSpan[]) {
  const meaningful = [...rawText].map((char, index) => ({ char, index })).filter(({ char }) => !/\s/.test(char));
  if (!meaningful.length) return 1;
  const covered = meaningful.filter(({ index }) => spans.some((span) => index >= span.start && index < span.end)).length;
  return Number((covered / meaningful.length).toFixed(4));
}

function mergeSpans(spans: SourceSpan[]) {
  return [...spans].sort((a, b) => a.start - b.start).filter((span, index, values) => index === 0 || span.start !== values[index - 1].start || span.end !== values[index - 1].end);
}

function sameSource(left: SourceSpan | undefined, right: SourceSpan) { return Boolean(left && left.start === right.start && left.end === right.end); }
function normalize(value: string) { return value.toLowerCase().replace(/[\s,，。；;：:、()（）/]/g, ""); }
function normalizeIntent(value: string) { return normalize(value).replace(/^(负责|参与|协助|要求|必须|熟悉|掌握|具备)/, "").replace(/(者优先|优先)$/, ""); }
function unique<T>(values: T[]) { return [...new Set(values.filter(Boolean))]; }
function uniqueSpans(values: SourceSpan[]) { return values.filter((span, index) => values.findIndex((candidate) => candidate.start === span.start && candidate.end === span.end) === index); }
function extractKeywords(text: string) {
  const exact = TECH_TERMS.filter((term) => normalize(text).includes(normalize(term)));
  const tokens = text.match(/[A-Za-z][A-Za-z0-9+#.-]*/g) ?? [];
  return unique([...exact, ...tokens]).slice(0, 20);
}
function aliasesFor(text: string) {
  const aliases: Array<[RegExp, string[]]> = [
    [/Claude Code/i, ["Claude", "AI coding assistant"]],
    [/Coding Agent/i, ["code agent", "agentic coding"]],
    [/Vibe Coding/i, ["AI-assisted development"]],
    [/badcase/i, ["failure case", "reproduction case"]],
    [/long context/i, ["long-context"]]
  ];
  return unique(aliases.flatMap(([pattern, values]) => pattern.test(text) ? values : []));
}
function categoryToKind(category: JdAnalyzerOutput["requirements"][number]["category"]): RequirementNodeV3["kind"] {
  if (category === "responsibility") return "responsibility";
  if (["tool", "required_skill"].includes(category)) return "tool_or_technology";
  if (["preferred_skill", "nice_to_have"].includes(category)) return "preferred";
  if (category === "experience") return "experience_depth";
  if (category === "education") return "education";
  if (category === "language") return "language";
  if (category === "soft_skill") return "soft_skill";
  if (["must_have"].includes(category)) return "hard_constraint";
  if (["verification_material", "risk_or_uncertain"].includes(category)) return "risk_or_uncertain";
  return "core_competency";
}
function confidenceNumber(level: "high" | "medium" | "low") { return level === "high" ? 0.9 : level === "medium" ? 0.7 : 0.45; }
function stableGraphJson(value: unknown) { return JSON.stringify(value, (_key, item) => item === undefined ? undefined : item); }
