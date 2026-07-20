import {
  analyzeJobDescriptionV2,
  buildCandidateEvidenceUnits,
  buildJobCoverageReport,
  classifyTailoringClaim,
  evaluateRequirementEvidence,
  recallEvidenceCandidates,
  recommendedTailoringIntensity,
  sectionTailoringPolicy
} from "@/domain/jobOptimization";
import type {
  CareerProfile,
  ClaimConfirmation,
  JobCoverageReportV2,
  JobDescription,
  ResumeBranch,
  ResumeTailoringPlan,
  TailoringClaim,
  TailoringIntensity
} from "@/domain/schemas";
import { ResumeTailoringPlanSchema } from "@/domain/schemas";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { stableHashText } from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";

export type ClaimConfirmationGroup = {
  id: string;
  title: string;
  claims: TailoringClaim[];
  options: readonly string[];
  defaultSyncScope: "resume_only";
};

export type TailoringServiceResult = {
  status: "ready" | "needs_confirmation" | "completed" | "blocked";
  summary: string;
  report?: JobCoverageReportV2;
  plan?: ResumeTailoringPlan;
  confirmationGroups?: ClaimConfirmationGroup[];
  resultRefs?: { branchId?: string; revisionId?: string; planId?: string };
};

export function analyzeJobFit(input: { profile: CareerProfile; branch: ResumeBranch; job: JobDescription }): TailoringServiceResult {
  const graph = analyzeJobDescriptionV2({ rawText: input.job.rawText });
  const evidenceUnits = buildCandidateEvidenceUnits({ profile: input.profile, branch: input.branch });
  const recalls = recallEvidenceCandidates({ graph, evidenceUnits });
  const matrix = evaluateRequirementEvidence({ profile: input.profile, graph, evidenceUnits, recalls });
  const report = buildJobCoverageReport({ graph, matrix });
  return {
    status: "ready",
    summary: `当前岗位适配度 ${report.overallCoverage} 分；未覆盖项会作为可补充项，不阻止创建岗位简历。`,
    report
  };
}

export function createTailoringPlan(input: {
  profile: CareerProfile;
  branch: ResumeBranch;
  job: JobDescription;
  intensity?: TailoringIntensity;
  operationId: string;
  now?: string;
}): TailoringServiceResult {
  const analyzed = analyzeJobFit(input);
  const report = analyzed.report!;
  const intensity = input.intensity ?? recommendedTailoringIntensity(report.overallCoverage);
  const requirements = analyzeJobDescriptionV2({ rawText: input.job.rawText }).nodes;
  const claims: TailoringClaim[] = [];
  for (const item of input.branch.contentItems.filter((candidate) => candidate.itemType !== "structural" && candidate.visible).slice(0, 12)) {
    const section = item.itemType === "skill" ? "skills" : item.itemType === "summary" ? "summary" : "project";
    const policy = sectionTailoringPolicy(section, intensity);
    if (!policy.allowedActions.includes("rewrite") && !policy.allowedActions.includes("keyword_align")) continue;
    const requirement = requirements.find((node) => node.exactKeywords.some((keyword) => item.text.toLowerCase().includes(keyword.toLowerCase()))) ?? requirements[0];
    if (!requirement) continue;
    const proposedText = item.text;
    claims.push(classifyTailoringClaim({
      id: `claim-${stableHashText(`${input.operationId}:${item.id}:${requirement.id}`)}`,
      section,
      targetContentItemId: item.id,
      currentText: item.text,
      proposedText,
      reason: `让已有内容更贴近“${requirement.statement}”，不新增未经确认的事实。`,
      keywords: requirement.exactKeywords.slice(0, 4),
      evidenceRefs: resolveBranchFactRefs(input.profile, item.factRefs),
      inferred: intensity !== "conservative" && section === "project"
    }));
  }
  const plan = ResumeTailoringPlanSchema.parse({
    id: `tailoring-plan-${stableHashText(input.operationId)}`,
    branchId: input.branch.id,
    jobId: input.job.id,
    intensity,
    basedOnBranchRevision: input.branch.revision,
    claims,
    estimatedFitScore: Math.min(100, report.overallCoverage + claims.length * 2),
    createdAt: input.now ?? new Date().toISOString()
  });
  const confirmationGroups = buildConfirmationGroups(plan.claims);
  return {
    status: confirmationGroups.length ? "needs_confirmation" : "ready",
    summary: `已生成 ${claims.length} 条${intensityLabel(intensity)}建议。`,
    report,
    plan,
    confirmationGroups,
    resultRefs: { branchId: input.branch.id, planId: plan.id }
  };
}

export function confirmTailoringClaims(input: { plan: ResumeTailoringPlan; confirmations: ClaimConfirmation[] }): TailoringServiceResult {
  const decisions = new Map(input.confirmations.map((item) => [item.claimId, item]));
  const claims = input.plan.claims.map((claim) => {
    if (claim.decision === "blocked") return { ...claim, confirmed: false, syncScope: "rejected" as const };
    const confirmation = decisions.get(claim.id);
    if (!confirmation) return claim;
    return {
      ...claim,
      proposedText: confirmation.editedText ?? claim.proposedText,
      confirmed: confirmation.accepted,
      syncScope: confirmation.accepted ? confirmation.syncScope : "rejected" as const,
      proficiency: confirmation.proficiency
    };
  });
  const plan = ResumeTailoringPlanSchema.parse({ ...input.plan, claims });
  const pending = claims.filter((claim) => claim.decision === "requires_confirmation" && !claim.confirmed && claim.syncScope !== "rejected");
  return {
    status: pending.length ? "needs_confirmation" : "ready",
    summary: pending.length ? `还有 ${pending.length} 项需要确认。` : "确认已完成，可以应用并保存新版本。",
    plan,
    confirmationGroups: buildConfirmationGroups(pending),
    resultRefs: { branchId: plan.branchId, planId: plan.id }
  };
}

export async function applyTailoringPlan(input: {
  plan: ResumeTailoringPlan;
  operationId: string;
  apply: (payload: { plan: ResumeTailoringPlan; operationId: string }) => Promise<{ branchId: string; revisionId: string }>;
}): Promise<TailoringServiceResult> {
  if (input.plan.claims.some((claim) => claim.decision === "blocked" && claim.syncScope !== "rejected")) {
    return { status: "blocked", summary: "存在不能自动添加的硬事实，请先改成真实表述。", plan: input.plan };
  }
  if (input.plan.claims.some((claim) => claim.decision === "requires_confirmation" && !claim.confirmed && claim.syncScope !== "rejected")) {
    return { status: "needs_confirmation", summary: "请先统一确认推导项和新增技能。", plan: input.plan, confirmationGroups: buildConfirmationGroups(input.plan.claims) };
  }
  const refs = await input.apply({ plan: input.plan, operationId: input.operationId });
  return { status: "completed", summary: "岗位简历已更新并保存为新版本，可以撤销。", plan: input.plan, resultRefs: { ...refs, planId: input.plan.id } };
}

export async function createJobResume(input: {
  repository: WorkspaceRepository;
  source: { type: "profile"; profileId: string; selectedCanonicalItemIds: string[]; requirementMatchIds?: string[] } |
    { type: "resume"; branch: ResumeBranch };
  job: JobDescription;
  operationId: string;
  name: string;
}): Promise<TailoringServiceResult> {
  const result = input.source.type === "profile"
    ? await input.repository.createJobSpecificBranchFromProfile({
        profileId: input.source.profileId, jobId: input.job.id, operationId: input.operationId, name: input.name,
        selectedCanonicalItemIds: input.source.selectedCanonicalItemIds, requirementMatchIds: input.source.requirementMatchIds ?? []
      })
    : await input.repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: input.source.branch.id, jobId: input.job.id, expectedSourceRevision: input.source.branch.revision,
        expectedSourceRevisionId: input.source.branch.currentRevisionId ?? "", operationId: input.operationId, name: input.name
      });
  return {
    status: "completed",
    summary: "岗位简历已从真实来源创建；未覆盖要求已保留为可补充项。",
    resultRefs: { branchId: result.branch.id, revisionId: result.revision?.id }
  };
}

function buildConfirmationGroups(claims: TailoringClaim[]): ClaimConfirmationGroup[] {
  const pending = claims.filter((claim) => claim.decision === "requires_confirmation" && !claim.confirmed && claim.syncScope !== "rejected");
  if (!pending.length) return [];
  return [{
    id: "claim-confirmation",
    title: "待确认能力与表达",
    claims: pending,
    options: ["熟练使用", "熟悉基础", "了解", "正在学习", "不添加"],
    defaultSyncScope: "resume_only"
  }];
}

function intensityLabel(intensity: TailoringIntensity) {
  return ({ conservative: "保守对齐", balanced: "平衡强化", proactive: "主动定向" } as const)[intensity];
}
