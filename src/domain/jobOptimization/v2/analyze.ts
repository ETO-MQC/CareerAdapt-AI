import { JobRequirementGraphV2Schema, type JobDescription, type JobRequirementGraphV2, type JobRequirementNodeV2 } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

const ANALYZER_VERSION = "jd-analyzer.deterministic-v2.0";
type Section = "responsibility" | "required" | "must_required" | "preferred" | "technology" | "location" | "verification" | "role_profile" | "excluded" | "unknown";

const HEADING_RULES: Array<[RegExp, Section]> = [
  [/^(职位职责|岗位职责|工作职责|主要职责|职责描述|职责内容|工作内容|responsibilities?)\s*[:：]?$/i, "responsibility"],
  [/^(必备条件|硬性条件|must have)\s*[:：]?$/i, "must_required"],
  [/^(任职要求|职位要求|任职资格|基本要求|参与要求|岗位要求|申请要求|候选人要求|requirements?|qualifications?)\s*[:：]?$/i, "required"],
  [/^(加分项|优先条件|优先考虑|preferred|nice to have)\s*[:：]?$/i, "preferred"],
  [/^(技术栈|工具与技术|tech(?:nology)? stack)\s*[:：]?$/i, "technology"],
  [/^(工作地点|办公地点|location)\s*[:：]?$/i, "location"],
  [/^(候选人需提供的验证材料|验证材料)\s*[:：]?$/i, "verification"],
  [/^(我们希望你是这样的人)\s*[:：]?$/i, "role_profile"],
  [/^(公司介绍|关于我们|团队介绍|薪资福利|福利待遇|员工福利|company|about us|benefits?)\s*[:：]?$/i, "excluded"]
];

const METADATA_ONLY = /^(Vibe Coding|关联项目|【?Code】?|General coding|职责内容|岗位要求|优先考虑)$/i;

const EXCLUDED_TEXT = /五险一金|团建|下午茶|带薪年假|公司成立|公司愿景|我们是一家|福利待遇|薪资范围|股票期权/i;
const PREFERRED = /优先|加分|更佳|preferred|nice[ -]?to[ -]?have|a plus/i;
const MUST = /必须|必备|至少|不少于|需具备|要求具备|required|must|minimum/i;
const RESPONSIBILITY = /负责|参与|协助|推动|设计|开发|维护|交付|分析|管理|build|develop|design|maintain|lead|deliver/i;
const SOFT = /沟通|协作|表达|学习能力|责任心|抗压|团队合作|communication|collaboration|stakeholder/i;
const EDUCATION = /学历|本科|硕士|博士|学士|大专|专业背景|degree|bachelor|master|phd/i;
const LANGUAGE = /英语|英文|日语|法语|德语|普通话|粤语|语言能力|CET[- ]?[46]|雅思|托福|english|japanese|mandarin/i;
const YEARS = /(?:至少|不少于|minimum\s*)?(\d+(?:\.\d+)?)\s*(?:年|years?)/i;
const LOCATION = /工作地点|办公地点|驻地|base(?:d)? in|location/i;
const TECH = /\b(?:react|next(?:\.js)?|typescript|javascript|python|java|sql|tableau|power\s*bi|excel|docker|kubernetes|aws|azure|git|node(?:\.js)?)\b/i;

export function analyzeJobDescriptionV2(input: { rawText: string; now?: string }): JobRequirementGraphV2 {
  const rawText = input.rawText;
  const extracted = extractSegments(rawText);
  const nodes: JobRequirementNodeV2[] = [];
  const unclassifiedSourceSpans: JobRequirementGraphV2["unclassifiedSourceSpans"] = [];

  for (const segment of extracted) {
    if (segment.section === "excluded" || EXCLUDED_TEXT.test(segment.text) || METADATA_ONLY.test(segment.text)) continue;
    if (segment.heading) continue;
    const clauses = splitIndependentClauses(segment.text, segment.start);
    for (const clause of clauses) {
      if (clause.text.length < 2) continue;
      const classified = classify(clause.text, segment.section);
      if (!classified) {
        unclassifiedSourceSpans.push({ start: clause.start, end: clause.end, text: rawText.slice(clause.start, clause.end) });
        continue;
      }
      const span = { start: clause.start, end: clause.end, text: rawText.slice(clause.start, clause.end) };
      nodes.push({
        id: `jrv2-${stableHashText(`${normalize(clause.text)}:${classified.kind}`)}`,
        kind: classified.kind,
        statement: clause.text,
        normalizedIntent: normalizeIntent(clause.text),
        priority: classified.priority,
        hardConstraint: classified.hardConstraint,
        competency: classified.competency,
        domain: classified.domain,
        minimumYears: classified.minimumYears,
        seniority: classified.seniority,
        exactKeywords: extractKeywords(clause.text),
        semanticAliases: aliasesFor(clause.text),
        sourceSpan: span,
        sourceSpans: [span],
        confidence: classified.confidence,
        needsConfirmation: classified.needsConfirmation,
        relatedRequirementIds: []
      });
    }
  }

  const merged = mergeDuplicates(nodes);
  linkRelatedNodes(merged);
  return JobRequirementGraphV2Schema.parse({
    schemaVersion: "job-requirement-graph-v2", nodes: merged, unclassifiedSourceSpans,
    analyzedAt: input.now ?? new Date().toISOString(), analyzerVersion: ANALYZER_VERSION
  });
}

export function buildCanonicalJobRequirementGraph(job: JobDescription): JobRequirementGraphV2 {
  if (job.requirementGraph) {
    const nodes = job.requirementGraph.requirements.map((node): JobRequirementNodeV2 => ({
      id: node.id,
      kind: node.kind,
      statement: node.statement,
      normalizedIntent: node.normalizedIntent,
      priority: node.priority,
      hardConstraint: node.hardConstraint,
      exactKeywords: node.exactKeywords,
      semanticAliases: node.semanticAliases,
      sourceSpan: node.sourceSpan,
      sourceSpans: node.sourceSpans,
      confidence: node.confidence,
      needsConfirmation: node.needsConfirmation,
      relatedRequirementIds: []
    }));
    linkRelatedNodes(nodes);
    return JobRequirementGraphV2Schema.parse({ schemaVersion: "job-requirement-graph-v2", nodes, unclassifiedSourceSpans: job.requirementGraph.sourceCoverage.unclassifiedSpans, analyzedAt: new Date().toISOString(), analyzerVersion: `${job.requirementGraph.analyzerVersion}.v2-projection` });
  }
  if (job.requirements.length === 0) return analyzeJobDescriptionV2({ rawText: job.rawText });
  const nodes = job.requirements
    .filter((requirement) => !METADATA_ONLY.test(requirement.description))
    .map((requirement): JobRequirementNodeV2 => ({
      id: requirement.id,
      kind: requirement.category === "responsibility" ? "responsibility"
        : requirement.category === "tool" ? "tool_or_technology"
          : requirement.category === "preferred_skill" || requirement.category === "nice_to_have" ? "preferred"
            : requirement.category === "education" ? "education"
              : requirement.category === "language" ? "language"
                : requirement.category === "experience" ? "experience_depth"
                  : requirement.category === "soft_skill" ? "soft_skill"
                    : requirement.category === "verification_material" ? "risk_or_uncertain"
                      : requirement.hardConstraint ? "hard_constraint" : "core_competency",
      statement: requirement.description,
      normalizedIntent: normalizeIntent(requirement.description),
      priority: requirement.category === "verification_material" ? "uncertain"
        : requirement.priority === "must" || requirement.hardConstraint ? "must"
          : requirement.priority === "high" || requirement.priority === "important" ? "high"
            : requirement.priority === "nice_to_have" || requirement.priority === "low" ? "nice_to_have" : "medium",
      hardConstraint: requirement.category === "verification_material" ? false : requirement.hardConstraint,
      exactKeywords: unique(requirement.keywords.length ? requirement.keywords : extractKeywords(requirement.description)),
      semanticAliases: aliasesFor(requirement.description),
      sourceSpan: requirement.sourceSpan,
      sourceSpans: [requirement.sourceSpan],
      confidence: requirement.confidence,
      needsConfirmation: requirement.category === "verification_material" || requirement.category === "risk_or_uncertain",
      relatedRequirementIds: []
    }));
  linkRelatedNodes(nodes);
  return JobRequirementGraphV2Schema.parse({ schemaVersion: "job-requirement-graph-v2", nodes, unclassifiedSourceSpans: [], analyzedAt: new Date().toISOString(), analyzerVersion: `${ANALYZER_VERSION}.canonical` });
}

function extractSegments(rawText: string) {
  const result: Array<{ text: string; start: number; section: Section; heading: boolean }> = [];
  let section: Section = "unknown";
  const linePattern = /[^\r\n]+/g;
  for (const match of rawText.matchAll(linePattern)) {
    const original = match[0];
    const leading = original.length - original.trimStart().length;
    const text = original.trim().replace(/^\s*(?:[-*•·]|\d+[.)、]|[一二三四五六七八九十]+[、.])\s*/, "").trim();
    const removedPrefix = original.trim().indexOf(text);
    const start = (match.index ?? 0) + leading + Math.max(0, removedPrefix);
    const headingRule = HEADING_RULES.find(([pattern]) => pattern.test(text));
    if (headingRule) {
      section = headingRule[1];
      result.push({ text, start, section, heading: true });
    } else if (text) result.push({ text, start, section, heading: false });
  }
  return result;
}

function splitIndependentClauses(text: string, start: number) {
  const result: Array<{ text: string; start: number; end: number }> = [];
  const boundary = /[。；;!?！？]|(?=\s+(?:并且|以及|同时|and)\s+)/g;
  let cursor = 0;
  for (const match of text.matchAll(boundary)) {
    const end = match.index ?? text.length;
    push(text.slice(cursor, end), cursor);
    cursor = end + match[0].length;
  }
  push(text.slice(cursor), cursor);
  return result;
  function push(value: string, localStart: number) {
    const trimmed = value.trim().replace(/^(?:并且|以及|同时|and)\s*/i, "");
    if (!trimmed) return;
    const offset = value.indexOf(trimmed);
    result.push({ text: trimmed, start: start + localStart + offset, end: start + localStart + offset + trimmed.length });
  }
}

function classify(text: string, section: Section): Omit<JobRequirementNodeV2, "id" | "statement" | "normalizedIntent" | "exactKeywords" | "semanticAliases" | "sourceSpan" | "sourceSpans" | "relatedRequirementIds"> | undefined {
  if (section === "role_profile") return undefined;
  const preferred = section === "preferred" || PREFERRED.test(text);
  const years = YEARS.exec(text);
  const hardConstraint = !preferred && (MUST.test(text) || Boolean(years) || EDUCATION.test(text) || LANGUAGE.test(text) || section === "location" || section === "must_required");
  let kind: JobRequirementNodeV2["kind"];
  if (section === "verification") kind = "risk_or_uncertain";
  else if (preferred) kind = "preferred";
  else if (years) kind = "experience_depth";
  else if (EDUCATION.test(text)) kind = "education";
  else if (LANGUAGE.test(text)) kind = "language";
  else if (LOCATION.test(text) || section === "location") kind = "hard_constraint";
  else if (TECH.test(text) || section === "technology") kind = "tool_or_technology";
  else if (SOFT.test(text)) kind = "soft_skill";
  else if (section === "responsibility" || RESPONSIBILITY.test(text)) kind = "responsibility";
  else if (section === "must_required") kind = "hard_constraint";
  else if (section === "required") kind = "core_competency";
  else if (text.length >= 4) kind = "risk_or_uncertain";
  else return undefined;
  const uncertain = kind === "risk_or_uncertain";
  return {
    kind, priority: uncertain ? "uncertain" : preferred ? "nice_to_have" : hardConstraint ? "must" : section === "responsibility" ? "high" : "medium",
    hardConstraint, minimumYears: years ? Number(years[1]) : undefined,
    competency: kind === "tool_or_technology" || kind === "core_competency" ? extractKeywords(text).slice(0, 3).join(" / ") || undefined : undefined,
    domain: undefined, seniority: /高级|资深|senior/i.test(text) ? "senior" : undefined,
    confidence: uncertain ? 0.45 : section === "unknown" ? 0.68 : 0.86, needsConfirmation: uncertain
  };
}

function mergeDuplicates(nodes: JobRequirementNodeV2[]) {
  const byIntent = new Map<string, JobRequirementNodeV2>();
  for (const node of nodes) {
    const key = `${node.kind}:${node.normalizedIntent}`;
    const existing = byIntent.get(key);
    if (!existing) byIntent.set(key, node);
    else {
      existing.sourceSpans.push(...node.sourceSpans);
      existing.exactKeywords = unique([...existing.exactKeywords, ...node.exactKeywords]);
      existing.semanticAliases = unique([...existing.semanticAliases, ...node.semanticAliases]);
      existing.confidence = Math.max(existing.confidence, node.confidence);
    }
  }
  return [...byIntent.values()];
}

function linkRelatedNodes(nodes: JobRequirementNodeV2[]) {
  for (const node of nodes) {
    const terms = new Set([...node.exactKeywords, ...node.semanticAliases].map(normalize));
    node.relatedRequirementIds = nodes.filter((other) => other.id !== node.id && [...other.exactKeywords, ...other.semanticAliases].some((term) => terms.has(normalize(term)))).map((other) => other.id);
  }
}

function normalizeIntent(text: string) { return normalize(text).replace(/^(负责|参与|协助|要求|必须|熟悉|掌握|具备)/, "").replace(/(优先|者优先)$/, "").trim(); }
function normalize(text: string) { return text.toLowerCase().replace(/[\s,，、:：()（）]/g, ""); }
function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function extractKeywords(text: string) { return unique([...(text.match(/[A-Za-z][A-Za-z0-9+#.]*/g) ?? []), ...(text.match(/[\u4e00-\u9fa5]{2,8}/g) ?? [])]).slice(0, 16); }
function aliasesFor(text: string) {
  const aliases: Record<string, string[]> = { "react": ["reactjs", "next.js", "前端组件"], "typescript": ["ts", "javascript"], "供应链": ["supply chain", "采购", "物流"], "英语": ["english", "cet-4", "cet-6"], "质量评测": ["输出审核", "事实核对", "可信度分析"] };
  return unique(Object.entries(aliases).flatMap(([term, values]) => normalize(text).includes(normalize(term)) ? values : []));
}
