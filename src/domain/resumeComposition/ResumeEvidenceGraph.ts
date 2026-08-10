import {
  migrateCareerProfileToV2,
  projectResumeItemV2
} from "@/domain/migrations/resumeV2";
import type {
  CareerProfile,
  FactStatement,
  ProfileStructuredFact,
  ResumeItemV2
} from "@/domain/schemas";
import {
  ResumeEvidenceGraphSchema,
  type ResumeEvidenceGraph,
  type ResumeEvidenceNode,
  type ResumeEvidenceEdge,
  type ResumeSkillEvidence,
  type ResumeEvidenceRecoveryCandidate
} from "./contracts";

type FactLookup = Map<string, FactStatement>;

const TECHNICAL_TERMS = [
  "TypeScript", "JavaScript", "Python", "Java", "C++", "Rust", "Go", "RPA", "FastAPI", "React", "Next.js",
  "Vue", "Node.js", "SQL", "SQLx", "SQLite", "MySQL", "PostgreSQL", "MongoDB", "Redis", "ESP32", "Arduino",
  "PlatformIO", "TensorFlow", "PyTorch", "机器学习", "深度学习", "数据处理", "数据分析", "数据可视化", "API",
  "REST API", "Git", "Docker", "Linux", "Figma", "测试", "爬虫", "自动化"
];

const TERM_CATEGORY: Record<string, string> = {
  TypeScript: "编程语言", JavaScript: "编程语言", Python: "编程语言", Java: "编程语言", "C++": "编程语言", Rust: "编程语言", Go: "编程语言",
  React: "前端", "Next.js": "前端", Vue: "前端", "Node.js": "后端", FastAPI: "后端", API: "后端", "REST API": "后端",
  SQL: "数据与 AI", "SQLx": "后端", SQLite: "数据库", MySQL: "数据库", PostgreSQL: "数据库", MongoDB: "数据库", Redis: "数据库",
  RPA: "数据与 AI", "机器学习": "数据与 AI", "深度学习": "数据与 AI", "数据处理": "数据与 AI", "数据分析": "数据与 AI", "数据可视化": "数据与 AI",
  ESP32: "工具与测试", Arduino: "工具与测试", PlatformIO: "工具与测试", TensorFlow: "数据与 AI", PyTorch: "数据与 AI", Git: "工具与测试", Docker: "工具与测试", Linux: "工具与测试", Figma: "工具与测试", 测试: "工具与测试", 爬虫: "数据与 AI", 自动化: "工具与测试"
};

export type ResumeEvidenceGraphInput = {
  profile: CareerProfile;
};

export function buildResumeEvidenceGraph(input: ResumeEvidenceGraphInput): ResumeEvidenceGraph {
  const profile = migrateCareerProfileToV2(input.profile);
  const facts = factLookup(profile);
  const nodes: ResumeEvidenceNode[] = [];
  const edges: ResumeEvidenceEdge[] = [];
  const skillEvidence = new Map<string, ResumeSkillEvidence>();
  const recoveryCandidates: ResumeEvidenceRecoveryCandidate[] = [];
  const sourceAssetIds: string[] = [];
  const excludedAssetIds: string[] = [];

  for (const entry of profile.structuredFacts) {
    const assetId = entry.data.id;
    const sourceFactIds = unique(entry.factIds);
    const sourceFacts = sourceFactIds.map((id) => facts.get(id)).filter((fact): fact is FactStatement => Boolean(fact));
    const text = assetText(entry, sourceFacts);
    const confirmationStatus = confirmationFor(sourceFacts, sourceFactIds.length > 0);
    if (isExcludedAsset(entry.data, text, confirmationStatus)) {
      excludedAssetIds.push(assetId);
      continue;
    }
    sourceAssetIds.push(assetId);
    const assetNodeId = `asset:${assetId}`;
    const assetNode: ResumeEvidenceNode = {
      id: assetNodeId,
      type: nodeTypeFor(entry.data),
      value: assetTitle(entry.data),
      sourceAssetIds: [assetId],
      factIds: sourceFactIds,
      sourceTurnIds: sourceTurnIds(entry, sourceFacts),
      confirmationStatus,
      ownershipStrength: Math.max(0, ...sourceFacts.map((fact) => ownershipStrength(`${fact.statement} ${fact.provenance.map((item) => item.sourceText).join(" ")}`))),
      sourceExcerpts: unique([entry.sourceExcerpt ?? "", ...sourceFacts.flatMap((fact) => fact.provenance.map((item) => item.sourceQuote ?? item.sourceText))])
    };
    nodes.push(assetNode);

    const explicitTerms = explicitTechnicalTerms(entry.data, text);
    for (const term of explicitTerms) {
      const existing = skillEvidence.get(term);
      const nodeId = `term:${term.toLocaleLowerCase()}`;
      if (!nodes.some((node) => node.id === nodeId)) {
        nodes.push({
          id: nodeId,
          type: termNodeType(term),
          value: term,
          sourceAssetIds: [assetId],
          factIds: sourceFactIds,
          sourceTurnIds: sourceTurnIds(entry, sourceFacts),
          confirmationStatus,
          ownershipStrength: assetNode.ownershipStrength,
          sourceExcerpts: assetNode.sourceExcerpts
        });
      } else {
        const node = nodes.find((candidate) => candidate.id === nodeId)!;
        node.sourceAssetIds = unique([...node.sourceAssetIds, assetId]);
        node.factIds = unique([...node.factIds, ...sourceFactIds]);
        node.sourceTurnIds = unique([...node.sourceTurnIds, ...sourceTurnIds(entry, sourceFacts)]);
        node.sourceExcerpts = unique([...node.sourceExcerpts, ...assetNode.sourceExcerpts]);
      }
      edges.push({ id: `edge:${nodeId}:${assetNodeId}`, from: nodeId, to: assetNodeId, relation: "supports" });
      if (!existing) {
        skillEvidence.set(term, {
          name: term,
          category: TERM_CATEGORY[term] ?? "其他",
          sourceAssetIds: [assetId],
          factIds: sourceFactIds,
          evidenceNodeIds: [nodeId],
          evidenceCount: 1
        });
      } else {
        existing.sourceAssetIds = unique([...existing.sourceAssetIds, assetId]);
        existing.factIds = unique([...existing.factIds, ...sourceFactIds]);
        existing.evidenceNodeIds = unique([...existing.evidenceNodeIds, nodeId]);
        existing.evidenceCount = existing.sourceAssetIds.length;
      }
    }

    for (const kind of ["outcome", "leadership", "evidence"] as const) {
      const values = nodeValuesFor(kind, entry.data, text);
      for (const value of values) {
        const id = `${kind}:${assetId}:${stableToken(value)}`;
        nodes.push({
          id,
          type: kind,
          value,
          sourceAssetIds: [assetId],
          factIds: sourceFactIds,
          sourceTurnIds: sourceTurnIds(entry, sourceFacts),
          confirmationStatus,
          ownershipStrength: assetNode.ownershipStrength,
          sourceExcerpts: assetNode.sourceExcerpts
        });
        edges.push({ id: `edge:${id}:${assetNodeId}`, from: id, to: assetNodeId, relation: "supports" });
      }
    }

    addRecoveryCandidates({ entry, profile, facts, recoveryCandidates });
  }

  for (const skill of profile.skills) {
    const sourceFactIds = skill.fact ? [skill.fact.id] : [];
    const term = canonicalTechnicalTerm(skill.name);
    if (!term || !isConfirmedFact(skill.fact)) continue;
    const existing = skillEvidence.get(term);
    const category = TERM_CATEGORY[term] ?? "其他";
    if (existing) {
      existing.sourceAssetIds = unique([...existing.sourceAssetIds, skill.id]);
      existing.factIds = unique([...existing.factIds, ...sourceFactIds]);
      existing.evidenceCount = existing.sourceAssetIds.length;
      continue;
    }
    const nodeId = `term:${term.toLocaleLowerCase()}`;
    nodes.push({
      id: nodeId,
      type: "skill",
      value: term,
      sourceAssetIds: [skill.id],
      factIds: sourceFactIds,
      sourceTurnIds: sourceTurnIdsFromFacts([skill.fact!]),
      confirmationStatus: "confirmed",
      ownershipStrength: 0,
      sourceExcerpts: [skill.fact!.statement, ...skill.fact!.provenance.map((item) => item.sourceQuote ?? item.sourceText)]
    });
    skillEvidence.set(term, { name: term, category, sourceAssetIds: [skill.id], factIds: sourceFactIds, evidenceNodeIds: [nodeId], evidenceCount: 1 });
  }

  return ResumeEvidenceGraphSchema.parse({
    schemaVersion: "resume-evidence-graph-v1",
    profileId: profile.id,
    profileRevision: profile.version,
    nodes: dedupeNodes(nodes),
    edges: dedupeEdges(edges),
    skillMatrix: [...skillEvidence.values()].sort((left, right) => left.name.localeCompare(right.name)),
    recoveryCandidates,
    sourceAssetIds: unique(sourceAssetIds),
    excludedAssetIds: unique(excludedAssetIds)
  });
}

function factLookup(profile: ReturnType<typeof migrateCareerProfileToV2>): FactLookup {
  const lookup: FactLookup = new Map();
  for (const experience of profile.experiences) for (const fact of experience.facts) lookup.set(fact.id, fact);
  for (const skill of profile.skills) if (skill.fact) lookup.set(skill.fact.id, skill.fact);
  for (const certificate of profile.certificates) if (certificate.fact) lookup.set(certificate.fact.id, certificate.fact);
  return lookup;
}

function assetText(entry: ProfileStructuredFact, facts: FactStatement[]) {
  return [projectResumeItemV2(entry.data), entry.sourceExcerpt ?? "", ...facts.map((fact) => fact.statement), ...facts.flatMap((fact) => fact.provenance.map((item) => item.sourceText))].filter(Boolean).join("\n");
}

function assetTitle(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  for (const key of ["title", "name", "school", "organization", "institution", "language", "text"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return item.id;
}

function nodeTypeFor(item: ResumeItemV2): ResumeEvidenceNode["type"] {
  if (item.sectionType === "education") return "education";
  if (item.sectionType === "awards" || item.sectionType === "certificates") return "award";
  return "career_asset";
}

function termNodeType(term: string): ResumeEvidenceNode["type"] {
  return TERM_CATEGORY[term] === "工具与测试" ? "tool" : TERM_CATEGORY[term] === "数据与 AI" ? "method" : "skill";
}

function explicitTechnicalTerms(item: ResumeItemV2, text: string) {
  const record = item as unknown as Record<string, unknown>;
  const explicit = [
    ...(Array.isArray(record.tools) ? record.tools : []),
    ...(Array.isArray(record.methods) ? record.methods : []),
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : []),
    ...(Array.isArray(record.courses) ? record.courses : []),
    text
  ].filter((value): value is string => typeof value === "string").join(" ");
  return TECHNICAL_TERMS.filter((term) => new RegExp(`(?:^|[^A-Za-z0-9+#.-])${escapeRegExp(term)}(?:$|[^A-Za-z0-9+#.-])`, "iu").test(explicit)
    && !new RegExp(`(?:未涉及|未使用|没有|不会|不使用|不支持|不含|无)\\s*(?:[A-Za-z0-9+#.-]+\\s*){0,2}${escapeRegExp(term)}`, "iu").test(explicit));
}

function canonicalTechnicalTerm(value: string) {
  return TECHNICAL_TERMS.find((term) => term.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
}

function nodeValuesFor(kind: "outcome" | "leadership" | "evidence", item: ResumeItemV2, text: string) {
  const record = item as unknown as Record<string, unknown>;
  if (kind === "outcome") return [...(Array.isArray(record.outcomes) ? record.outcomes : []), ...(Array.isArray(record.highlights) ? record.highlights : [])].filter((value): value is string => typeof value === "string" && /结果|完成|交付|提升|实现|获奖|排名|落地|处理|搭建|开发|设计|分析|协助|参与/u.test(value));
  if (kind === "leadership") return [item.sectionType === "campus" ? text : ""].filter((value): value is string => Boolean(value) && /部长|秘书|负责人|主导|负责|带领|协助|参与/u.test(value));
  return item.sectionType === "research" || item.sectionType === "project" ? [text.slice(0, 180)] : [];
}

function addRecoveryCandidates(input: { entry: ProfileStructuredFact; profile: ReturnType<typeof migrateCareerProfileToV2>; facts: FactLookup; recoveryCandidates: ResumeEvidenceRecoveryCandidate[] }) {
  const { entry, profile, facts, recoveryCandidates } = input;
  if (entry.data.sectionType !== "research") return;
  const research = entry.data;
  if (research.authorRole) return;
  const linked = entry.factIds.map((id) => facts.get(id)).filter((fact): fact is FactStatement => Boolean(fact));
  const experience = profile.experiences.find((candidate) => candidate.facts.some((fact) => entry.factIds.includes(fact.id)));
  if (!experience || !linked.length) return;
  const status = /课题组|实验室|研究/u.test(linked.map((fact) => fact.statement).join(" ")) ? "needs_confirmation" : "safe_recovery";
  recoveryCandidates.push({
    id: `recovery:${entry.data.id}:authorRole`,
    sourceAssetId: entry.data.id,
    field: "authorRole",
    proposedValue: experience.role,
    status,
    factIds: entry.factIds,
    reason: status === "safe_recovery" ? "同一已确认经历中存在明确角色，可作为建议恢复。" : "来源提到实验室或课题组，但作者角色需要用户确认。"
  });
}

function isExcludedAsset(item: ResumeItemV2, text: string, status: ResumeEvidenceNode["confirmationStatus"]) {
  const normalized = `${assetTitle(item)} ${text}`.trim();
  return !normalized || status !== "confirmed" || /empty-resume-placeholder|待整理|暂无可靠内容|fallback|diagnostic|placeholder|negative|失败原因|不采用|Other\b/iu.test(normalized);
}

function confirmationFor(facts: FactStatement[], hasFactIds: boolean): ResumeEvidenceNode["confirmationStatus"] {
  if (!hasFactIds || !facts.length) return "unconfirmed";
  if (facts.every(isConfirmedFact)) return "confirmed";
  if (facts.some((fact) => fact.confirmedByUser)) return "needs_confirmation";
  return "unconfirmed";
}

function isConfirmedFact(fact?: FactStatement) {
  return Boolean(fact && fact.confirmedByUser && fact.riskLevel !== "high" && fact.provenance.some((source) => source.confirmedByUser));
}

function sourceTurnIds(entry: ProfileStructuredFact, facts: FactStatement[]) {
  return unique([
    ...facts.flatMap((fact) => sourceTurnIdsFromFacts([fact])),
    ...(entry.provenance ?? []).flatMap((source) => source.sourceTurnId ? [source.sourceTurnId] : [])
  ]);
}

function sourceTurnIdsFromFacts(facts: FactStatement[]) {
  return unique(facts.flatMap((fact) => fact.provenance.map((source) => source.sourceTurnId).filter((value): value is string => Boolean(value))));
}

function ownershipStrength(text: string) {
  if (/主导|带领/u.test(text)) return 6;
  if (/独立完成|独立负责/u.test(text)) return 5;
  if (/负责/u.test(text)) return 4;
  if (/主要负责/u.test(text)) return 3;
  if (/共同完成|共同负责/u.test(text)) return 2;
  if (/协助|参与|配合|支持/u.test(text)) return 1;
  return 0;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stableToken(value: string) {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 48);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupeNodes(nodes: ResumeEvidenceNode[]) {
  const byId = new Map<string, ResumeEvidenceNode>();
  for (const node of nodes) {
    const existing = byId.get(node.id);
    if (!existing) byId.set(node.id, node);
    else {
      existing.sourceAssetIds = unique([...existing.sourceAssetIds, ...node.sourceAssetIds]);
      existing.factIds = unique([...existing.factIds, ...node.factIds]);
      existing.sourceTurnIds = unique([...existing.sourceTurnIds, ...node.sourceTurnIds]);
      existing.sourceExcerpts = unique([...existing.sourceExcerpts, ...node.sourceExcerpts]);
      existing.ownershipStrength = Math.max(existing.ownershipStrength, node.ownershipStrength);
    }
  }
  return [...byId.values()];
}

function dedupeEdges(edges: ResumeEvidenceEdge[]) {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}:${edge.to}:${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
