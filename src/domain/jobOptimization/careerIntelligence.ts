import type { CareerProfile, JobDescription, ResumeBranch } from "@/domain/schemas";
import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { CandidateEvidenceMatrixSchema } from "@/domain/schemas/careerIntelligence";
export type { CandidateEvidenceMatrix } from "@/domain/schemas/careerIntelligence";
import { buildCanonicalJobRequirementGraph } from "./v2/analyze";
import { buildCandidateEvidenceUnits, evaluateRequirementEvidence, recallEvidenceCandidates } from "./v2/evidence";
import { buildJobCoverageReport } from "./v2/coverage";
import { stableHashText } from "@/services/security/text";

export const CAREER_INTELLIGENCE_RULE_VERSION = "career-intelligence-2.1";

/** Derived analysis only. No new fact store, model call, or persistence. */
export function buildCareerIntelligence(input: { profile: CareerProfile; branch: ResumeBranch; job: JobDescription }) {
  const graph = buildCanonicalJobRequirementGraph(input.job);
  const evidenceUnits = buildCandidateEvidenceUnits(input);
  const matrix = evaluateRequirementEvidence({ ...input, graph, evidenceUnits, recalls: recallEvidenceCandidates({ graph, evidenceUnits }) });
  const binding = { profileId: input.profile.id, profileRevision: input.profile.version,
    resumeId: input.branch.id, resumeRevision: input.branch.revision, revisionId: input.branch.currentRevisionId ?? null,
    jobId: input.job.id, jobVersion: input.job.updatedAt,
    graphHash: input.job.requirementGraph?.graphHash ?? stableHashText(JSON.stringify(input.job.requirements)) };
  const candidateEvidenceMatrix = CandidateEvidenceMatrixSchema.parse({
    schemaVersion: "candidate-evidence-matrix-1", ruleVersion: CAREER_INTELLIGENCE_RULE_VERSION,
    analysisId: `analysis-${stableHashText(JSON.stringify([CAREER_INTELLIGENCE_RULE_VERSION, binding, graph.nodes, evidenceUnits]))}`,
    binding,
    rows: graph.nodes.map(requirement => {
      const evaluation = matrix.evaluations.find(row => row.requirementId === requirement.id)!;
      const units = evidenceUnits.filter(unit => evaluation.evidenceUnitIds.includes(unit.id));
      return { requirementId: requirement.id, rawSourceRef: requirement.sourceSpan,
        normalizedRequirement: requirement.normalizedIntent, priority: requirement.priority,
        relationships: (input.job.requirementGraph?.groups ?? []).filter(group => group.requirementIds.includes(requirement.id))
          .map(group => ({ groupId: group.id, relation: group.relation, requirementIds: group.requirementIds })),
        evidenceStatus: evaluation.matchLevel === "direct" ? "direct" : evaluation.matchLevel === "strong_transferable" ? "transferable"
          : evaluation.matchLevel === "partial" ? "partial" : "unknown",
        candidateFactIds: [...new Set(units.flatMap(unit => unit.factRefs.map(ref => ref.type === "evidence_file" ? ref.linkedFactId : ref.factId)))],
        sourceIds: [...new Set(units.flatMap(unit => unit.sourceBlockIds))], evidenceUnitIds: evaluation.evidenceUnitIds,
        confidence: evaluation.confidence,
        unresolvedAmbiguity: [...(requirement.needsConfirmation ? ["requirement_needs_confirmation"] : []),
          ...(!["direct", "strong_transferable"].includes(evaluation.matchLevel) ? evaluation.missingAspects : [])],
        rationale: evaluation.explanation };
    })
  });
  const report = buildJobCoverageReport({ graph, matrix });
  const activeRequirements = new Set([...report.coveredRequirementIds, ...report.partialRequirementIds, ...report.uncoveredRequirementIds, ...report.confirmationRequirementIds]);
  const summarize = (priority: "must" | "preferred") => {
    const rows = candidateEvidenceMatrix.rows.filter(row => activeRequirements.has(row.requirementId) && (priority === "must" ? row.priority === "must" : row.priority === "nice_to_have"));
    return { total: rows.length, direct: rows.filter(row => row.evidenceStatus === "direct").length,
      unknown: rows.filter(row => row.evidenceStatus === "unknown").length };
  };
  return { graph, evidenceUnits, matrix, candidateEvidenceMatrix, report,
    jobFit: { ruleVersion: CAREER_INTELLIGENCE_RULE_VERSION, mustHaveCoverage: summarize("must"), preferredCoverage: summarize("preferred"),
      evidenceStrength: candidateEvidenceMatrix.rows.map(row => ({ requirementId: row.requirementId, status: row.evidenceStatus })),
      materialGaps: input.job.requirementGraph?.verificationMaterials.map(material => ({ id: material.id, label: material.label, status: "unknown" as const })) ?? [],
      unknowns: candidateEvidenceMatrix.rows.filter(row => activeRequirements.has(row.requirementId) && row.evidenceStatus === "unknown").map(row => row.requirementId) } };
}

/** Owned by the caller/session; never Hermes long-term Memory. Copies cannot mutate cached results. */
export class CareerIntelligenceCache {
  private readonly entries = new Map<string, ReturnType<typeof buildCareerIntelligence>>();
  get(input: Parameters<typeof buildCareerIntelligence>[0]) {
    // Revisions are authoritative; fingerprints also protect imported/legacy snapshots with reused revisions.
    const key = stableHashText(JSON.stringify([CAREER_INTELLIGENCE_RULE_VERSION, input.profile, input.branch, input.job]));
    const existing = this.entries.get(key);
    if (existing) return { ...structuredClone(existing), reused: true };
    const result = buildCareerIntelligence(input);
    if (this.entries.size >= 16) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, structuredClone(result));
    return { ...result, reused: false };
  }
}

/** Stable, ephemeral profile projection; never saves a branch or changes Profile. */
export function buildProfileCareerIntelligence(input: { profile: CareerProfile; job: JobDescription }) {
  const profile = input.profile.schemaVersion === "career-profile-v2" ? input.profile : { ...input.profile,
    experiences: input.profile.experiences.map(experience => ({ ...experience, resumeDrafts: [] })) };
  const branch = buildGeneralBranchFromProfile({ profile, operationId: "profile-fit", name: "资料库分析", includeProfileFacts: true, includeProfileBasics: true, now: input.profile.updatedAt }).branch;
  if (input.profile.schemaVersion !== "career-profile-v2") {
    branch.structuredContentItems = branch.structuredContentItems?.map(item => {
      const statements = item.factRefs.flatMap(ref => ref.type === "experience_fact" ? profile.experiences.find(experience => experience.id === ref.experienceId)?.facts.filter(fact => fact.id === ref.factId).map(fact => fact.statement) ?? [] : []);
      return item.data.sectionType === "awards" && statements.length ? { ...item, data: { ...item.data, description: statements.join("\n") }, legacyTextProjection: statements.join("\n") } : item;
    });
    // Keep the ephemeral mirrors synchronized so migration retains the corrected visible text.
    branch.contentItems = branch.contentItems.map(item => {
      const structured = branch.structuredContentItems?.find(candidate => candidate.id === item.id);
      return structured?.data.sectionType === "awards" ? { ...item, text: structured.legacyTextProjection!, originalText: structured.legacyTextProjection! } : item;
    });
  }
  branch.id = `profile-fit-${input.profile.id}`;
  branch.currentRevisionId = `profile-fit-${input.profile.version}`;
  const ids = new Map(branch.structuredContentItems?.map(item => [item.id, `profile-fit-item-${item.data.id}`]) ?? []);
  branch.contentItems = branch.contentItems.map(item => ({ ...item, id: ids.get(item.id) ?? "profile-fit-empty" }));
  branch.structuredContentItems = branch.structuredContentItems?.map(item => ({ ...item, id: ids.get(item.id)! }));
  return { ...buildCareerIntelligence({ ...input, branch }), branch };
}

export type CapabilityGapStatus = "supported" | "partial" | "possible" | "confirmed_absent" | "insufficient";
export function capabilityGapView(analysis: ReturnType<typeof buildCareerIntelligence>, requirementId: string) {
  const evaluation = analysis.matrix.evaluations.find(row => row.requirementId === requirementId);
  const units = analysis.evidenceUnits.filter(unit => evaluation?.evidenceUnitIds.includes(unit.id));
  const hasDemonstratedEvidence = units.some(unit => unit.supportLevel !== "user_declared" && unit.maturity === "demonstrated");
  const declared = !hasDemonstratedEvidence && units.some(unit => unit.supportLevel === "user_declared" || unit.maturity === "confirmed_capability");
  const status: CapabilityGapStatus = evaluation?.matchLevel === "direct" ? "supported" : declared ? "possible"
    : evaluation && ["partial", "strong_transferable"].includes(evaluation.matchLevel) ? "partial" : "insufficient";
  return { status, label: { supported: "有明确证据支持", partial: "有部分证据支持", possible: "可能具备，但缺少证据", confirmed_absent: "已确认暂不具备", insufficient: "信息不足，需要澄清" }[status],
    coveredAspects: evaluation?.coveredAspects ?? [], missingAspects: evaluation?.missingAspects ?? [],
    rationale: evaluation?.explanation ?? "当前材料不足，缺少证据不代表不具备能力。", units };
}
