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
import { resolveCareerAssetDisplayIdentity } from "./CareerAssetDisplayIdentity";
import {
  canonicalTechnicalTerm,
  extractTechnicalTerms,
  technicalTermCategory
} from "./ResumeSkillTaxonomy";

type FactLookup = Map<string, FactStatement>;

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
          category: technicalTermCategory(term) ?? "其他",
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
    const category = technicalTermCategory(term) ?? "其他";
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
  return resolveCareerAssetDisplayIdentity(item).label;
}

function nodeTypeFor(item: ResumeItemV2): ResumeEvidenceNode["type"] {
  if (item.sectionType === "education") return "education";
  if (item.sectionType === "awards" || item.sectionType === "certificates") return "award";
  return "career_asset";
}

function termNodeType(term: string): ResumeEvidenceNode["type"] {
  const category = technicalTermCategory(term);
  return category === "工程与测试" || category === "嵌入式 / IoT" ? "tool" : category === "数据与 AI" ? "method" : "skill";
}

function explicitTechnicalTerms(item: ResumeItemV2, text: string) {
  return extractTechnicalTerms(item, text);
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
  const groundedRole = experience ? roleLikeValue(experience.role) : undefined;
  if (!experience || !groundedRole || !linked.length) return;
  const status = /课题组|实验室|研究/u.test(linked.map((fact) => fact.statement).join(" ")) ? "needs_confirmation" : "safe_recovery";
  recoveryCandidates.push({
    id: `recovery:${entry.data.id}:authorRole`,
    sourceAssetId: entry.data.id,
    field: "authorRole",
    proposedValue: groundedRole,
    status,
    factIds: entry.factIds,
    reason: status === "safe_recovery" ? "同一已确认经历中存在明确角色，可作为建议恢复。" : "来源提到实验室或课题组，但作者角色需要用户确认。"
  });
}

/** A recovery candidate may only carry a compact role label. Never promote a
 * source excerpt, description, or full narrative into authorRole. */
function roleLikeValue(value: unknown) {
  if (typeof value !== "string") return undefined;
  const role = value.trim();
  if (!role || role.length > 80 || /[\r\n。！？!?；;]/u.test(role)) return undefined;
  if (/(?:sourceExcerpt|description|rawText|full narrative|原文|经历描述|项目描述|岗位描述)/iu.test(role)) return undefined;
  if (/(?:负责|完成了|开发了|实现了|使用了|通过|因为|所以|其中|项目中)/u.test(role) && role.length > 24) return undefined;
  return role;
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
