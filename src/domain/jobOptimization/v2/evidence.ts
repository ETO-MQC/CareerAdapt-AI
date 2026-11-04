import { containsKeywordTerm, classifyKeywordRelation } from "../keywordTaxonomy";
import {
  CandidateEvidenceUnitSchema, RequirementEvidenceEvaluationV2Schema, RequirementEvidenceMatrixV2Schema,
  RequirementEvidenceRecallSchema, type CandidateEvidenceUnit, type CareerProfile, type JobRequirementGraphV2,
  type MatchEvidenceRef, type RequirementEvidenceEvaluationV2, type RequirementEvidenceMatrixV2,
  type RequirementEvidenceRecall, type ResumeBranch, type ResumeItemV2
} from "@/domain/schemas";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";
import { factMaturityOf, strongestFactMaturity } from "@/domain/profile/factMaturity";
import { stableHashText } from "@/services/security/text";

const ALIASES: Record<string, string[]> = {
  react: ["reactjs", "next.js", "nextjs"], typescript: ["ts", "javascript"], javascript: ["js", "typescript"],
  "前端": ["frontend", "react", "web"], "供应链": ["supply chain", "采购", "物流"],
  "质量评测": ["输出审核", "事实核对", "可信度分析", "evaluation"], "英语": ["english", "cet-4", "cet-6"]
};

export function buildCandidateEvidenceUnits(input: { profile: CareerProfile; branch: ResumeBranch }): CandidateEvidenceUnit[] {
  if (input.branch.profileId !== input.profile.id) return [];
  const branch = migrateResumeBranchToV2(input.branch);
  const units: CandidateEvidenceUnit[] = [];
  const factsById = new Map([
    ...input.profile.experiences.flatMap((experience) => experience.facts.map((fact) => [fact.id, fact] as const)),
    ...input.profile.skills.flatMap((skill) => skill.fact ? [[skill.fact.id, skill.fact] as const] : []),
    ...input.profile.certificates.flatMap((certificate) => certificate.fact ? [[certificate.fact.id, certificate.fact] as const] : [])
  ]);
  for (const item of branch.structuredContentItems) {
    const userDeclared = item.factRefs.length === 0 && Boolean(item.userConfirmation);
    if (!item.visible || (!item.factRefs.length && !userDeclared) || item.data.sectionType === "summary") continue;
    if (item.factRefs.length) try { resolveBranchFactRefs(input.profile, item.factRefs); } catch { continue; }
    const data = item.data as ResumeItemV2 & Record<string, unknown>;
    const referencedFacts = item.factRefs
      .map((ref) => ref.type === "evidence_file" ? ref.linkedFactId : ref.factId)
      .map((factId) => factsById.get(factId))
      .filter((fact): fact is NonNullable<typeof fact> => Boolean(fact));
    const maturity = userDeclared
      ? "confirmed_capability" as const
      : referencedFacts.length
        ? strongestFactMaturity(referencedFacts)
        : undefined;
    const common = {
      recallContext: item.factRefs.flatMap(ref => ref.type === "experience_fact" ? input.profile.experiences.find(experience => experience.id === ref.experienceId)?.tags ?? [] : []).join(" "),
      sectionType: data.sectionType, itemId: item.id, factRefs: item.factRefs, sourceBlockIds: item.sourceBlockIds, supportLevel: userDeclared ? "user_declared" as const : "verified" as const,
      ...(maturity ? { maturity } : {}),
      organization: stringValue(data.organization) ?? stringValue(data.school) ?? stringValue(data.institution),
      role: stringValue(data.role) ?? stringValue(data.title),
      dateRange: [stringValue(data.startDate), stringValue(data.endDate)].filter(Boolean).join(" — ") || undefined,
      confirmed: true as const
    };
    const highlights = stringList(data.highlights);
    highlights.forEach((text, index) => units.push(unit({ ...common, sourceType: "experience_highlight", fieldPath: `highlights.${index}`, text })));
    const outcomes = stringList(data.outcomes);
    outcomes.forEach((text, index) => units.push(unit({ ...common, sourceType: "project_outcome", fieldPath: `outcomes.${index}`, text })));
    const description = stringValue(data.description);
    if (description) units.push(unit({ ...common, sourceType: descriptionSource(data.sectionType), fieldPath: "description", text: description }));
    if (data.sectionType === "skills") units.push(unit({ ...common, sourceType: "skill", fieldPath: "name", text: [data.name, data.level, data.description].filter(Boolean).join(" · ") }));
    if (data.sectionType === "certificates") units.push(unit({ ...common, sourceType: "certificate", fieldPath: "name", text: [data.name, data.issuer, data.description].filter(Boolean).join(" · ") }));
    if (data.sectionType === "education") units.push(unit({ ...common, sourceType: "education", fieldPath: "degree", text: [data.school, data.major, data.degree, data.description].filter(Boolean).join(" · ") }));
    if (data.sectionType === "project") stringList(data.tools).forEach((text, index) => units.push(unit({ ...common, sourceType: "skill", fieldPath: `tools.${index}`, text })));
    if (!highlights.length && !outcomes.length && !description && !["skills", "certificates", "education"].includes(data.sectionType) && item.legacyTextProjection) {
      units.push(unit({ ...common, sourceType: "custom_fact", fieldPath: "legacyTextProjection", text: item.legacyTextProjection }));
    }
  }
  return CandidateEvidenceUnitSchema.array().parse(dedupeUnits(units));
}

export function recallEvidenceCandidates(input: { graph: JobRequirementGraphV2; evidenceUnits: CandidateEvidenceUnit[]; limit?: number }): RequirementEvidenceRecall[] {
  const limit = Math.max(1, Math.min(input.limit ?? 6, 12));
  return input.graph.nodes.map((requirement) => {
    const requirementTerms = expandedTerms([requirement.normalizedIntent, ...requirement.exactKeywords, ...requirement.semanticAliases]);
    const candidates = input.evidenceUnits.map((evidence) => {
      const evidenceTerms = tokenize([evidence.normalizedText, evidence.organization, evidence.role, evidence.recallContext].filter(Boolean).join(" "));
      const exact = requirement.exactKeywords.filter((term) => containsTerm(evidence.normalizedText, term));
      const contextHits = requirement.exactKeywords.filter(term => containsTerm(evidence.recallContext ?? "", term));
      const alias = [...requirementTerms].filter((term) => evidenceTerms.has(term) && !requirement.exactKeywords.some((exactTerm) => normalize(exactTerm) === term));
      const lexical = bm25Lite(requirementTerms, evidenceTerms);
      const character = ngramDice(requirement.normalizedIntent, [evidence.normalizedText, evidence.organization, evidence.role, evidence.recallContext].filter(Boolean).join(" "));
      const section = sectionCompatibility(requirement.kind, evidence);
      const factRefBoost = evidence.factRefs.length > 0 ? 0.08 : 0;
      const score = Math.min(1, Math.max(exact.length, contextHits.length) * 0.18 + alias.length * 0.08 + lexical * 0.34 + character * 0.22 + section + factRefBoost);
      const reasons = [contextHits.length ? "经历标签仅用于召回，不证明能力" : "", exact.length ? `精确术语：${exact.join("、")}` : "", alias.length ? `语义别名：${alias.slice(0, 3).join("、")}` : "", section ? "证据类型与要求类别一致" : "", lexical > 0.15 ? "文本主题相关" : "", factRefBoost ? "存在已确认事实引用" : ""].filter(Boolean);
      return { evidenceUnitId: evidence.id, score: Number(score.toFixed(4)), reasons };
    }).filter((candidate) => candidate.score >= 0.12 && candidate.reasons.length > 0)
      .sort((a, b) => b.score - a.score || a.evidenceUnitId.localeCompare(b.evidenceUnitId)).slice(0, limit);
    return RequirementEvidenceRecallSchema.parse({ requirementId: requirement.id, candidates });
  });
}

export function evaluateRequirementEvidence(input: {
  profile: CareerProfile; graph: JobRequirementGraphV2; evidenceUnits: CandidateEvidenceUnit[];
  recalls: RequirementEvidenceRecall[]; aiOutput?: unknown; now?: string;
}): RequirementEvidenceMatrixV2 {
  const allowedByRequirement = new Map(input.recalls.map((recall) => [recall.requirementId, new Set(recall.candidates.map((item) => item.evidenceUnitId))]));
  const unitById = new Map(input.evidenceUnits.map((unit) => [unit.id, unit]));
  let evaluations: RequirementEvidenceEvaluationV2[];
  if (input.aiOutput !== undefined) {
    const parsed = RequirementEvidenceEvaluationV2Schema.array().safeParse(input.aiOutput);
    if (!parsed.success) throw new Error("evidence_matcher_v2_schema_invalid");
    const seen = new Set<string>();
    evaluations = parsed.data.map((evaluation) => {
      if (seen.has(evaluation.requirementId)) throw new Error("evidence_matcher_v2_duplicate_requirement_id");
      seen.add(evaluation.requirementId);
      const requirement = input.graph.nodes.find((node) => node.id === evaluation.requirementId);
      if (!requirement) throw new Error("evidence_matcher_v2_unknown_requirement_id");
      const allowed = allowedByRequirement.get(evaluation.requirementId) ?? new Set();
      if (new Set(evaluation.evidenceUnitIds).size !== evaluation.evidenceUnitIds.length) throw new Error("evidence_matcher_v2_duplicate_evidence_id");
      if (evaluation.evidenceUnitIds.some((id) => !allowed.has(id) || !unitById.has(id))) throw new Error("evidence_matcher_v2_evidence_outside_recall");
      if (evaluation.matchLevel === "direct") {
        const selectedUnits = evaluation.evidenceUnitIds.map((id) => unitById.get(id)!);
        const demonstrated = selectedUnits.filter((unit) => (unit.maturity === "demonstrated" || unit.maturity === undefined) && unit.supportLevel !== "user_declared" && !hasUnverifiedAssertion(unit.text));
        if (!demonstrated.length || requirement.needsConfirmation || /\d+(?:\.\d+)?\s*(?:年|years?)|独立|主导|带领|有效期|有效证书|未过期/iu.test(requirement.statement) || (requirement.kind === "tool_or_technology" && !conditionSupport(requirement, demonstrated, input.profile).satisfied)) {
          throw new Error("evidence_matcher_v2_unsupported_direct_claim");
        }
      }
      return RequirementEvidenceEvaluationV2Schema.parse({ ...evaluation, evidenceRefs: resolveEvaluationRefs(input.profile, evaluation.evidenceUnitIds, unitById) });
    });
    const missing = input.graph.nodes.filter((node) => !seen.has(node.id));
    evaluations.push(...missing.map((node) => noneEvaluation(node.id, "AI 未返回该要求，按未覆盖处理。")));
  } else {
    evaluations = input.graph.nodes.map((requirement) => deterministicEvaluation(requirement, input.recalls.find((item) => item.requirementId === requirement.id), input.profile, unitById));
  }
  return RequirementEvidenceMatrixV2Schema.parse({ schemaVersion: "requirement-evidence-matrix-v2", evaluations, evaluatedAt: input.now ?? new Date().toISOString() });
}

export async function evaluateRequirementEvidenceWithAi(input: {
  profile: CareerProfile; graph: JobRequirementGraphV2; evidenceUnits: CandidateEvidenceUnit[];
  recalls: RequirementEvidenceRecall[]; now?: string;
  rerank: (payload: {
    requirements: JobRequirementGraphV2["nodes"];
    candidates: Array<{ requirementId: string; evidenceUnits: CandidateEvidenceUnit[] }>;
  }) => Promise<unknown>;
}): Promise<{ matrix: RequirementEvidenceMatrixV2; source: "ai" | "deterministic_fallback"; error?: string }> {
  const unitById = new Map(input.evidenceUnits.map((unit) => [unit.id, unit]));
  const payload = {
    requirements: input.graph.nodes,
    candidates: input.recalls.map((recall) => ({
      requirementId: recall.requirementId,
      evidenceUnits: recall.candidates.map((candidate) => unitById.get(candidate.evidenceUnitId)).filter((unit): unit is CandidateEvidenceUnit => Boolean(unit))
    }))
  };
  try {
    const raw = await input.rerank(payload);
    const output = raw && typeof raw === "object" && "evaluations" in raw ? (raw as { evaluations: unknown }).evaluations : raw;
    return { matrix: evaluateRequirementEvidence({ ...input, aiOutput: output }), source: "ai" };
  } catch (error) {
    return {
      matrix: evaluateRequirementEvidence(input), source: "deterministic_fallback",
      error: error instanceof Error ? error.message : "evidence_matcher_v2_failed"
    };
  }
}

function deterministicEvaluation(requirement: JobRequirementGraphV2["nodes"][number], recall: RequirementEvidenceRecall | undefined, profile: CareerProfile, unitById: Map<string, CandidateEvidenceUnit>) {
  const top = recall?.candidates.filter((item) => item.score >= 0.2) ?? [];
  if (!top.length) return noneEvaluation(requirement.id, "当前来源简历中没有召回到可引用的已确认事实。", requirement.statement);
  const units = top.map((item) => unitById.get(item.evidenceUnitId)!).filter(Boolean);
  const hasMaturityGap = units.some((unit) => unit.maturity === "familiar" || unit.maturity === "learning");
  const demonstrated = units.filter(unit => (unit.maturity === "demonstrated" || unit.maturity === undefined) && unit.supportLevel !== "user_declared" && !hasUnverifiedAssertion(unit.text));
  const hasConfirmedCapability = demonstrated.length === 0 && units.some(unit => unit.maturity === "confirmed_capability" || unit.supportLevel === "user_declared");
  const support = conditionSupport(requirement, demonstrated, profile);
  const requiresClarification = requirement.needsConfirmation || /\d+(?:\.\d+)?\s*(?:年|years?)|独立|主导|带领|有效期|有效证书|未过期|valid certification/iu.test(requirement.statement) || units.some(unit => hasUnverifiedAssertion(unit.text));
  const direct = !requiresClarification && support.satisfied && (requirement.keywordLogic !== undefined || top[0].score >= 0.64) && demonstrated.some(unit =>
    ["skill", "certificate", "education", "experience_highlight", "project_outcome"].includes(unit.sourceType) || ngramDice(requirement.normalizedIntent, unit.normalizedText) >= 0.72
  );
  const transferable = !direct && top[0].reasons.some((reason) => reason.startsWith("语义别名")) && top[0].score >= 0.32;
  const level = direct ? "direct" : requiresClarification ? "needs_confirmation" : hasConfirmedCapability ? "partial" : hasMaturityGap ? "needs_confirmation" : transferable ? "strong_transferable" : top[0].score >= 0.3 ? "partial" : "weak";
  return RequirementEvidenceEvaluationV2Schema.parse({
    requirementId: requirement.id, matchLevel: level, evidenceUnitIds: units.map((unit) => unit.id),
    evidenceRefs: resolveEvaluationRefs(profile, units.map((unit) => unit.id), unitById),
    coveredAspects: support.covered,
    missingAspects: level === "direct" ? [] : support.missing.length ? support.missing : [requirement.statement],
    risks: level === "direct" ? [] : hasConfirmedCapability ? ["new_fact_risk"] : hasMaturityGap ? ["skill_level_risk"] : level === "weak" ? ["low_confidence"] : [],
    explanation: level === "direct" ? "已确认事实逐项支持必要条件（任选条件按实际满足项计算）。" : requiresClarification ? "相关证据尚不能验证年限、责任范围、有效期或否定/限定表述，需要澄清；这不代表用户不具备能力。" : hasConfirmedCapability ? "该内容是用户确认的能力或当前简历声明，按部分覆盖计入；它不是带项目来源的已证明经历。" : hasMaturityGap ? "当前只有熟悉、基础接触或学习中的表述，不能作为已完成岗位经历。" : level === "strong_transferable" ? "证据所处场景不同，但任务机制与能力可明确迁移；不等同于已承担完整岗位职责。" : level === "partial" ? "已确认事实只覆盖该要求的一部分。" : "仅存在弱相关证据，不能据此主张满足要求。",
    confidence: Number(top[0].score.toFixed(2))
  });
}

function noneEvaluation(requirementId: string, explanation: string, missing = "该要求尚无事实证据") {
  return RequirementEvidenceEvaluationV2Schema.parse({ requirementId, matchLevel: "none", evidenceUnitIds: [], evidenceRefs: [], coveredAspects: [], missingAspects: [missing], risks: [], explanation, confidence: 1 });
}
function resolveEvaluationRefs(profile: CareerProfile, ids: string[], unitById: Map<string, CandidateEvidenceUnit>): MatchEvidenceRef[] {
  const facts = [...profile.experiences.flatMap(item => item.facts), ...profile.skills.flatMap(item => item.fact ? [item.fact] : []), ...profile.certificates.flatMap(item => item.fact ? [item.fact] : [])];
  const refs = ids.flatMap((id) => resolveBranchFactRefs(profile, unitById.get(id)?.factRefs ?? [])).map(ref => {
    const fact = facts.find(fact => fact.id === (ref.type === "evidence_file" ? ref.linkedFactId : ref.factId));
    return { ...ref, factQuote: fact?.provenance.find(source => source.confirmedByUser)?.sourceText ?? ref.factQuote };
  });
  const seen = new Set<string>(); return refs.filter((ref) => { const key = JSON.stringify(ref); if (seen.has(key)) return false; seen.add(key); return true; });
}
function unit(input: Omit<CandidateEvidenceUnit, "id" | "normalizedText">): CandidateEvidenceUnit { return { ...input, id: `evu-${stableHashText(`${input.itemId}:${input.fieldPath}:${input.text}`)}`, normalizedText: normalize(input.text) }; }
function descriptionSource(section: string): CandidateEvidenceUnit["sourceType"] { return section === "education" ? "education" : section === "project" ? "project_outcome" : section === "custom" || section === "other" ? "custom_fact" : "experience_description"; }
function dedupeUnits(units: CandidateEvidenceUnit[]) { const seen = new Set<string>(); return units.filter((unit) => { const key = `${unit.itemId}:${unit.fieldPath}:${unit.normalizedText}`; if (seen.has(key) || !unit.text.trim()) return false; seen.add(key); return true; }); }
function stringValue(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function stringList(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : []; }
function normalize(text: string) { return text.toLowerCase().replace(/next\s*js/g, "next.js").replace(/react\s*js/g, "react").replace(/[^a-z0-9+#.\u4e00-\u9fa5]+/g, " ").trim(); }
function tokenize(text: string) { return new Set([...(normalize(text).match(/[a-z0-9+#.]+/g) ?? []), ...(normalize(text).match(/[\u4e00-\u9fa5]{2,6}/g) ?? [])]); }
function expandedTerms(values: string[]) { const base = new Set(values.flatMap((value) => [...tokenize(value)])); for (const term of [...base]) for (const [key, aliases] of Object.entries(ALIASES)) if (normalize(key) === term || aliases.some((alias) => normalize(alias) === term)) [key, ...aliases].forEach((alias) => base.add(normalize(alias))); return base; }
function containsTerm(text: string, term: string) { return containsKeywordTerm(text, term); }
function bm25Lite(query: Set<string>, document: Set<string>) { if (!query.size) return 0; let matches = 0; for (const term of query) if (document.has(term)) matches += 1; return matches / Math.sqrt(query.size * Math.max(1, document.size)); }
function ngramDice(left: string, right: string) { const a = grams(normalize(left).replace(/\s/g, "")); const b = grams(normalize(right).replace(/\s/g, "")); if (!a.size || !b.size) return 0; let overlap = 0; for (const gram of a) if (b.has(gram)) overlap += 1; return (2 * overlap) / (a.size + b.size); }
function grams(text: string) { const result = new Set<string>(); const size = /[\u4e00-\u9fa5]/.test(text) ? 2 : 3; for (let i = 0; i <= text.length - size; i += 1) result.add(text.slice(i, i + size)); return result; }
function sectionCompatibility(kind: JobRequirementGraphV2["nodes"][number]["kind"], unit: CandidateEvidenceUnit) { if (kind === "education" && unit.sourceType === "education") return 0.2; if (kind === "language" && unit.sectionType === "languages") return 0.2; if (kind === "tool_or_technology" && unit.sourceType === "skill") return 0.18; if (kind === "experience_depth" && unit.sourceType.startsWith("experience")) return 0.12; if (kind === "responsibility" && ["experience_highlight", "project_outcome"].includes(unit.sourceType)) return 0.1; return 0; }

/** Adjacent skills are recall signals only; direct support requires direct or true synonym evidence. */
function conditionSupport(requirement: JobRequirementGraphV2["nodes"][number], units: CandidateEvidenceUnit[], profile?: CareerProfile) {
  const terms = requirement.keywordLogic?.terms ?? requirement.exactKeywords;
  const facts = profile ? [...profile.experiences.flatMap(item => item.facts), ...profile.skills.flatMap(item => item.fact ? [item.fact] : []), ...profile.certificates.flatMap(item => item.fact ? [item.fact] : [])] : [];
  const covered = terms.filter(term => units.some(unit => ["direct", "synonym"].includes(classifyKeywordRelation(term, unit.text)) && (!profile || unit.factRefs.some(ref => {
    const fact = facts.find(fact => fact.id === (ref.type === "evidence_file" ? ref.linkedFactId : ref.factId));
    return fact && fact.confirmedByUser && factMaturityOf(fact) === "demonstrated" && !hasUnverifiedAssertion(fact.statement)
      && ["direct", "synonym"].includes(classifyKeywordRelation(term, fact.statement));
  }))));
  const satisfied = terms.length > 0 && (requirement.keywordLogic?.relation === "any_of" ? covered.length >= 1 : covered.length === terms.length);
  return { covered, satisfied, missing: satisfied ? [] : terms.filter(term => !covered.includes(term)) };
}
function hasUnverifiedAssertion(text: string) { return /暂未|尚未|从未|未使用|未掌握|未做过|不会|不具备|没有.{0,8}(?:经验|经历)|未独立|正在学习|学习中|not\s+(?:yet|proficient|experienced)|no\s+experience|\bnever\b/iu.test(text); }
