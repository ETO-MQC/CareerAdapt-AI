import { buildGeneralBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonicalProfileLibraryItems, type CanonicalProfileLibraryItem } from "@/domain/profile/canonicalLibrary";
import {
  buildCanonicalJobRequirementGraph,
  buildCandidateEvidenceUnits,
  buildJobCoverageReport,
  createResumeOptimizationPlan,
  evaluateRequirementEvidence,
  recallEvidenceCandidates
} from "@/domain/jobOptimization/v2";
import type { CareerProfile, JobDescription, JobCoverageReportV2, RequirementEvidenceMatrixV2, ResumeOptimizationPlanV2 } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

export type ProfileLibraryRecommendation = CanonicalProfileLibraryItem & {
  disposition: "prioritize" | "keep" | "hide";
  reason: string;
};

export type ProfileLibrarySourceAnalysis = {
  availableItemCount: number;
  availableEvidenceCount: number;
  recommendations: ProfileLibraryRecommendation[];
  factGaps: string[];
  coverage: JobCoverageReportV2;
  matrix: RequirementEvidenceMatrixV2;
  plan: ResumeOptimizationPlanV2;
  analysisHash: string;
};

export function analyzeProfileLibrarySource(input: { profile: CareerProfile; job: JobDescription; now?: string }): ProfileLibrarySourceAnalysis {
  const now = input.now ?? new Date().toISOString();
  const ephemeral = buildGeneralBranchFromProfile({
    profile: input.profile,
    operationId: `profile-library-analysis-${input.profile.id}-${input.profile.version}-${input.job.id}`,
    name: "资料库分析",
    includeProfileFacts: true,
    includeProfileBasics: true,
    now
  }).branch;
  const graph = buildCanonicalJobRequirementGraph(input.job);
  const evidenceUnits = buildCandidateEvidenceUnits({ profile: input.profile, branch: ephemeral });
  const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
  const matrix = evaluateRequirementEvidence({ profile: input.profile, graph, evidenceUnits, recalls, now });
  const coverage = buildJobCoverageReport({ graph, matrix });
  const plan = createResumeOptimizationPlan({ profile: input.profile, branch: ephemeral, jobId: input.job.id, graph, evidenceUnits, matrix, coverage, now });
  const structuredByBranchItem = new Map((ephemeral.structuredContentItems ?? []).map((item) => [item.id, item.data.id]));
  const libraryById = new Map(canonicalProfileLibraryItems(input.profile).map((item) => [item.id, item]));
  const directIds = new Set<string>();
  const supportedIds = new Set<string>();
  for (const evaluation of matrix.evaluations) {
    for (const unitId of evaluation.evidenceUnitIds) {
      const unit = evidenceUnits.find((candidate) => candidate.id === unitId);
      const canonicalId = unit ? structuredByBranchItem.get(unit.itemId) : undefined;
      if (!canonicalId) continue;
      supportedIds.add(canonicalId);
      if (evaluation.matchLevel === "direct" || evaluation.matchLevel === "strong_transferable") directIds.add(canonicalId);
    }
  }
  const availableIds = new Set((ephemeral.structuredContentItems ?? []).map((item) => item.data.id));
  const recommendations: ProfileLibraryRecommendation[] = [];
  for (const id of availableIds) {
    const item = libraryById.get(id);
    if (!item) continue;
    if (directIds.has(id)) recommendations.push({ ...item, disposition: "prioritize", reason: "可直接或明确迁移地支持岗位核心要求。" });
    else if (supportedIds.has(id)) recommendations.push({ ...item, disposition: "keep", reason: "可支持部分岗位要求，建议保留。" });
    else recommendations.push({ ...item, disposition: "hide", reason: "与当前岗位要求关联较弱，可暂不放入岗位简历。" });
  }
  recommendations.sort((left, right) => dispositionRank(left.disposition) - dispositionRank(right.disposition) || left.title.localeCompare(right.title, "zh-CN"));
  return {
    availableItemCount: recommendations.length,
    availableEvidenceCount: evidenceUnits.length,
    recommendations,
    factGaps: plan.factGaps.map((gap) => gap.question),
    coverage,
    matrix,
    plan,
    analysisHash: stableHashText(JSON.stringify({ profileVersion: input.profile.version, jobVersion: input.job.updatedAt, recommendations: recommendations.map((item) => [item.id, item.disposition]) }))
  };
}

export function recommendJobResumeSource(input: { profileItemCount: number; profileEvidenceCount: number; generalResumeCount: number }) {
  if (input.profileItemCount >= 8 && input.profileEvidenceCount >= 12) {
    return { mode: "profile" as const, label: "推荐：从资料库生成", reason: `资料库中有 ${input.profileItemCount} 项内容、${input.profileEvidenceCount} 条可用事实可供筛选。` };
  }
  if (input.generalResumeCount > 0) {
    return { mode: "resume" as const, label: "推荐：优化已有简历", reason: "已有通用简历可作为成熟基础，针对岗位调整重点会更快。" };
  }
  return { mode: "profile" as const, label: "推荐：从资料库生成", reason: "当前没有可用通用简历，可先从资料库中的已确认内容开始。" };
}

function dispositionRank(value: ProfileLibraryRecommendation["disposition"]) {
  return value === "prioritize" ? 0 : value === "keep" ? 1 : 2;
}
