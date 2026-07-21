import { JobCoverageReportV2Schema, type JobCoverageReportV2, type JobRequirementGraphV2, type RequirementEvidenceMatrixV2 } from "@/domain/schemas";

export const JOB_COVERAGE_SCORE_VERSION = "job-evidence-coverage.v2.0";
const LEVEL_VALUE = { direct: 1, strong_transferable: 0.72, partial: 0.5, weak: 0.18, none: 0, needs_confirmation: 0.12 } as const;
const PRIORITY_WEIGHT = { must: 5, high: 3.5, medium: 2, nice_to_have: 1, uncertain: 0.75 } as const;

export function buildJobCoverageReport(input: { graph: JobRequirementGraphV2; matrix: RequirementEvidenceMatrixV2 }): JobCoverageReportV2 {
  const evaluationById = new Map(input.matrix.evaluations.map((item) => [item.requirementId, item]));
  const usedEvidence = new Map<string, number>();
  const contributions = input.graph.nodes.map((requirement) => {
    const evaluation = evaluationById.get(requirement.id);
    const base = evaluation ? LEVEL_VALUE[evaluation.matchLevel] : 0;
    const duplicateUse = Math.max(0, ...(evaluation?.evidenceUnitIds.map((id) => usedEvidence.get(id) ?? 0) ?? [0]));
    evaluation?.evidenceUnitIds.forEach((id) => usedEvidence.set(id, (usedEvidence.get(id) ?? 0) + 1));
    const dedupeFactor = duplicateUse > 0 && requirement.relatedRequirementIds.length > 0 ? Math.max(0.65, 1 - duplicateUse * 0.15) : 1;
    const weight = PRIORITY_WEIGHT[requirement.priority] * (requirement.hardConstraint ? 1.35 : 1);
    return { requirement, evaluation, value: base * dedupeFactor, weight };
  });
  const weighted = weightedScore(contributions);
  const hardGaps = contributions.filter((item) => item.requirement.hardConstraint && (!item.evaluation || ["none", "weak", "partial", "needs_confirmation"].includes(item.evaluation.matchLevel)));
  const hardPenalty = Math.min(38, hardGaps.reduce((total, item) => total + (item.requirement.priority === "must" ? 14 : 9), 0));
  const overallCoverage = clamp(Math.round(weighted - hardPenalty));
  const subScores = {
    hardConstraints: scoreFor(contributions.filter((item) => item.requirement.hardConstraint)),
    coreCompetencies: scoreFor(contributions.filter((item) => ["core_competency", "tool_or_technology", "domain_knowledge", "soft_skill"].includes(item.requirement.kind))),
    responsibilities: scoreFor(contributions.filter((item) => item.requirement.kind === "responsibility")),
    preferredQualifications: scoreFor(contributions.filter((item) => item.requirement.priority === "nice_to_have" || item.requirement.kind === "preferred")),
    terminologyCoverage: terminologyScore(input.graph, input.matrix)
  };
  const coveredRequirementIds = contributions.filter((item) => item.evaluation && ["direct", "strong_transferable"].includes(item.evaluation.matchLevel)).map((item) => item.requirement.id);
  const partialRequirementIds = contributions.filter((item) => item.evaluation && ["partial", "weak"].includes(item.evaluation.matchLevel)).map((item) => item.requirement.id);
  const uncoveredRequirementIds = contributions.filter((item) => !item.evaluation || item.evaluation.matchLevel === "none").map((item) => item.requirement.id);
  const uncoveredRequirementDescriptions = contributions.filter((item) => !item.evaluation || item.evaluation.matchLevel === "none").map((item) => item.requirement.sourceSpan?.text || item.requirement.statement);
  const confirmationRequirementIds = contributions.filter((item) => item.evaluation?.matchLevel === "needs_confirmation" || item.requirement.needsConfirmation).map((item) => item.requirement.id);
  const coveredRequirementDescriptions = contributions.filter((item) => item.evaluation && ["direct", "strong_transferable"].includes(item.evaluation.matchLevel)).map((item) => item.requirement.statement);
  const partialRequirementDescriptions = contributions.filter((item) => item.evaluation && ["partial", "weak"].includes(item.evaluation.matchLevel)).map((item) => item.requirement.statement);
  return JobCoverageReportV2Schema.parse({
    overallCoverage, subScores, coveredRequirementIds, partialRequirementIds, uncoveredRequirementIds, confirmationRequirementIds, coveredRequirementDescriptions, partialRequirementDescriptions, uncoveredRequirementDescriptions,
    blockingGaps: hardGaps.map((item) => item.requirement.statement),
    improvementOpportunities: contributions.filter((item) => !item.requirement.hardConstraint && item.value < 0.72).map((item) => item.requirement.statement),
    scoreVersion: JOB_COVERAGE_SCORE_VERSION,
    scoreExplanation: `岗位证据覆盖度由已确认事实与 ${input.graph.nodes.length} 条岗位要求的逐项证据等级确定；必备缺口扣减 ${hardPenalty} 分。它不是 ATS 通过率、录取概率或招聘成功率。`
  });
}

function weightedScore(items: Array<{ value: number; weight: number }>) { const total = items.reduce((sum, item) => sum + item.weight, 0); return total ? items.reduce((sum, item) => sum + item.value * item.weight, 0) / total * 100 : 0; }
function scoreFor(items: Array<{ value: number; weight: number }>) { return clamp(Math.round(weightedScore(items))); }
function terminologyScore(graph: JobRequirementGraphV2, matrix: RequirementEvidenceMatrixV2) {
  const evaluations = new Map(matrix.evaluations.map((item) => [item.requirementId, item])); let total = 0; let covered = 0;
  for (const node of graph.nodes) { total += node.exactKeywords.length; const evaluation = evaluations.get(node.id); if (evaluation && evaluation.matchLevel !== "none") covered += evaluation.coveredAspects.length; }
  return total ? clamp(Math.round(covered / total * 100)) : 0;
}
function clamp(value: number) { return Math.max(0, Math.min(100, value)); }
