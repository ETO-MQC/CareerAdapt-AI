import {
  analyzeJobDescriptionV2,
  buildCandidateEvidenceUnits,
  buildJobCoverageReport,
  buildTailoringJobContext,
  createDeterministicTailoringSuggestions,
  createResumeTailorTaskInputs,
  evaluateRequirementEvidence,
  recallEvidenceCandidates,
  recommendedTailoringIntensity,
  validateTailoringDelta
} from "@/domain/jobOptimization";
import type {
  CareerProfile,
  ClaimConfirmation,
  JobCoverageReportV2,
  JobDescription,
  ResumeBranch,
  ResumeTailoringPlan,
  ResumeTailorTaskInputV2,
  TailoringClaim,
  TailoringIntensity,
  TailoringSuggestion
} from "@/domain/schemas";
import { ResumeTailoringPlanSchema, TailoringSuggestionSchema } from "@/domain/schemas";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { stableHashText } from "@/services/security/text";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";

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
  taskInputs?: ResumeTailorTaskInputV2[];
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
  const jobContext = buildTailoringJobContext(input.job);
  const taskInputs = createResumeTailorTaskInputs({
    draftId: `tailoring-draft-${input.branch.id}`,
    profileId: input.profile.id,
    branch: input.branch,
    job: input.job,
    intensity,
    resolveEvidenceRefs: (item) => resolveBranchFactRefs(input.profile, item.factRefs)
  });
  const suggestions = createDeterministicTailoringSuggestions({
    branch: input.branch,
    job: input.job,
    intensity,
    operationId: input.operationId,
    resolveEvidenceRefs: (item) => resolveBranchFactRefs(input.profile, item.factRefs)
  });
  const claims = claimsFromSuggestions(suggestions);
  const plan = ResumeTailoringPlanSchema.parse({
    id: `tailoring-plan-${stableHashText(input.operationId)}`,
    branchId: input.branch.id,
    jobId: input.job.id,
    intensity,
    promptVersion: "resume-tailor.v2",
    jobContext,
    basedOnBranchRevision: input.branch.revision,
    claims,
    suggestions,
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
    taskInputs,
    resultRefs: { branchId: input.branch.id, planId: plan.id }
  };
}

export function validateTailoringSuggestions(input: { suggestions: TailoringSuggestion[] }) {
  const valid: TailoringSuggestion[] = [];
  const rejected: Array<{ suggestion: TailoringSuggestion; code: "invalid_ai_output" | "no_change_needed"; reasons: string[] }> = [];
  for (const candidate of input.suggestions) {
    const suggestion = TailoringSuggestionSchema.parse(candidate);
    const validation = validateTailoringDelta({
      before: suggestion.before,
      after: suggestion.after,
      intensity: suggestion.intensity,
      targetKeywords: suggestion.targetKeywords,
      sectionType: suggestion.targetSectionType,
      rationale: suggestion.rationale
    });
    if (validation.valid) {
      const guard = runRuleFactGuard({ originalText: renderSuggestionValue(suggestion.before), checkedText: renderSuggestionValue(suggestion.after), usedEvidenceRefs: suggestion.evidenceRefs });
      const blocked = guard.status === "blocked_high_risk";
      const requiresConfirmation = !blocked && (suggestion.claimSupportLevel === "reasonable_inference" || suggestion.claimSupportLevel === "user_declared");
      valid.push(TailoringSuggestionSchema.parse({
        ...suggestion,
        claimSupportLevel: blocked ? "unsupported_hard_fact" : suggestion.claimSupportLevel,
        status: blocked ? "blocked" : requiresConfirmation ? "requires_confirmation" : "ready",
        riskLevel: blocked ? "high" : requiresConfirmation ? "medium" : suggestion.riskLevel,
        metrics: validation.metrics,
        coveredKeywordsBefore: validation.coveredKeywordsBefore,
        coveredKeywordsAfter: validation.coveredKeywordsAfter
      }));
    }
    else rejected.push({ suggestion, code: validation.status === "no_change_needed" ? "no_change_needed" : "invalid_ai_output", reasons: validation.reasons });
  }
  return { status: rejected.length ? (valid.length ? "ready" : "blocked") : "ready", suggestions: valid, rejected } as const;
}

export function withTailoringSuggestions(input: {
  plan: ResumeTailoringPlan;
  suggestions: TailoringSuggestion[];
  invalidOutputCodes?: Array<"invalid_ai_output" | "no_change_needed">;
}) {
  return ResumeTailoringPlanSchema.parse({
    ...input.plan,
    claims: claimsFromSuggestions(input.suggestions),
    suggestions: input.suggestions,
    invalidOutputCodes: input.invalidOutputCodes ?? []
  });
}

export async function generateTailoringSuggestions(input: {
  requests: Array<{ intensity: TailoringIntensity; targetSectionType: TailoringSuggestion["targetSectionType"]; before: string | string[]; targetKeywords: string[]; requirementDescriptions: string[] }>;
  generate: (request: typeof input.requests[number] & { retryContext?: { previousWasNoOp: true } }) => Promise<TailoringSuggestion | null | undefined>;
}) {
  const suggestions: TailoringSuggestion[] = [];
  const invalidOutputCodes: Array<"invalid_ai_output" | "no_change_needed"> = [];
  for (const request of input.requests) {
    let candidate = await input.generate(request);
    let validation = candidate ? validateTailoringDelta({ before: request.before, after: candidate.after, intensity: request.intensity, targetKeywords: request.targetKeywords, sectionType: request.targetSectionType, rationale: candidate.rationale, requirementDescriptions: request.requirementDescriptions }) : undefined;
    if (!candidate || !validation?.valid) {
      candidate = await input.generate({ ...request, retryContext: { previousWasNoOp: true } });
      validation = candidate ? validateTailoringDelta({ before: request.before, after: candidate.after, intensity: request.intensity, targetKeywords: request.targetKeywords, sectionType: request.targetSectionType, rationale: candidate.rationale, requirementDescriptions: request.requirementDescriptions }) : undefined;
    }
    if (!candidate || !validation?.valid) {
      invalidOutputCodes.push(validation?.status === "no_change_needed" ? "no_change_needed" : "invalid_ai_output");
      continue;
    }
    suggestions.push(TailoringSuggestionSchema.parse({ ...candidate, metrics: validation.metrics, coveredKeywordsBefore: validation.coveredKeywordsBefore, coveredKeywordsAfter: validation.coveredKeywordsAfter }));
  }
  return { status: suggestions.length ? "ready" as const : "blocked" as const, suggestions, invalidOutputCodes };
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

function renderSuggestionValue(value: string | string[]) {
  return Array.isArray(value) ? value.join("\n") : value;
}

function claimsFromSuggestions(suggestions: TailoringSuggestion[]): TailoringClaim[] {
  return suggestions.map((suggestion) => ({
    id: suggestion.id,
    section: suggestion.targetSectionType,
    targetContentItemId: suggestion.targetItemId,
    targetFieldPath: suggestion.targetFieldPath,
    currentText: renderSuggestionValue(suggestion.before),
    proposedText: renderSuggestionValue(suggestion.after),
    reason: suggestion.rationale,
    keywords: suggestion.targetKeywords,
    requirementIds: suggestion.requirementIds,
    supportLevel: suggestion.claimSupportLevel,
    decision: suggestion.status === "ready" ? "auto_applicable" : suggestion.status === "requires_confirmation" ? "requires_confirmation" : "blocked",
    evidenceRefs: suggestion.evidenceRefs,
    syncScope: suggestion.status === "blocked" ? "rejected" : "resume_only",
    confirmed: suggestion.status === "ready"
  }));
}
