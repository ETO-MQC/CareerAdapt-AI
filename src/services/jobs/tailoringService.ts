import {
  buildCanonicalJobRequirementGraph,
  buildCanonicalJobRequirementGraphV3,
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
import { buildConfirmableClaim, resolveConfirmableClaim } from "@/domain/jobOptimization/confirmation";
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
import { resolveTailoringClaimPolicy } from "@/domain/jobOptimization/tailoringClaimPolicy";

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
  const graph = buildCanonicalJobRequirementGraph(input.job);
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
  const clarificationQuestions = buildClarificationQuestions({ job: input.job, taskInputs });
  const plan = ResumeTailoringPlanSchema.parse({
    id: `tailoring-plan-${stableHashText(input.operationId)}`,
    branchId: input.branch.id,
    jobId: input.job.id,
    intensity,
    promptVersion: "resume-tailor.v2",
    jobContext,
    basedOnBranchRevision: input.branch.revision,
    claims,
    clarificationQuestions,
    materialSuggestions: jobContext.verificationMaterials ?? [],
    suggestions,
    estimatedFitScore: report.overallCoverage,
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
      const policy = resolveTailoringClaimPolicy({ suggestion, guardResult: guard, sectionType: suggestion.targetSectionType, intensity: suggestion.intensity });
      const blocked = policy.decision === "blocked";
      const requiresConfirmation = policy.decision === "requires_confirmation";
      valid.push(TailoringSuggestionSchema.parse({
        ...suggestion,
        claimSupportLevel: blocked ? "unsupported_hard_fact" : policy.claimClass === "user_confirmable_capability" ? "user_declared" : policy.claimClass === "reasonable_reframe" ? "reasonable_inference" : "verified",
        status: blocked ? "blocked" : requiresConfirmation ? "requires_confirmation" : "ready",
        riskLevel: policy.riskLevel,
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
    const resolvedClaim = claim.targetPatches && claim.label && claim.claimText && claim.sourceItemIds && claim.requirementIds && claim.claimType
      ? resolveConfirmableClaim({
          id: claim.id,
          label: claim.label,
          claimText: claim.claimText,
          finalTextByProficiency: claim.finalTextByProficiency,
          sourceItemIds: claim.sourceItemIds,
          requirementIds: claim.requirementIds,
          targetPatches: claim.targetPatches,
          claimType: claim.claimType
        }, confirmation)
      : undefined;
    return {
      ...claim,
      proposedText: confirmation.editedText ?? claim.proposedText,
      resolvedText: confirmation.accepted ? resolvedClaim?.resolvedText ?? resolveConfirmedClaimText(claim, confirmation) : undefined,
      targetPatches: resolvedClaim?.targetPatches ?? claim.targetPatches,
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

export function buildClarificationQuestions(input: { job: JobDescription; taskInputs: ResumeTailorTaskInputV2[] }) {
  const graph = buildCanonicalJobRequirementGraphV3(input.job);
  const candidates = graph.requirements.filter((node) => node.priority === "must" || node.priority === "high");
  const emittedAnyOfGroups = new Set<string>();
  const fallbackTargets = input.taskInputs.filter((item) => ["summary", "skills", "project", "work", "internship"].includes(item.target.sectionType)).slice(0, 4);
  return candidates.flatMap((requirement, index) => {
    const group = requirement.parentGroupId ? graph.groups.find((item) => item.id === requirement.parentGroupId) : undefined;
    if (group?.relation === "any_of") {
      if (emittedAnyOfGroups.has(group.id)) return [];
      emittedAnyOfGroups.add(group.id);
    }
    const directlyRelated = input.taskInputs.filter((item) => item.relevantRequirements.some((related) => related.requirementId === requirement.id));
    const hasEvidence = directlyRelated.some((item) => item.allowedEvidenceRefs.length > 0);
    if (hasEvidence) return [];
    const related = (directlyRelated.length ? directlyRelated : fallbackTargets).slice(0, 4);
    const sourceItemIds = [...new Set(related.map((item) => item.target.itemId ?? item.target.sectionId))];
    const targetFieldPaths = [...new Set(related.map((item) => item.target.fieldPath))];
    if (!sourceItemIds.length || !targetFieldPaths.length) return [];
    return [{
      id: `clarification-${requirement.id}-${index + 1}`,
      question: group?.relation === "any_of" ? `以下 ${group.requirementIds.length} 项满足任一项即可；你具备其中哪一项真实经历或可核验材料？` : `你是否具备“${requirement.statement}”相关的真实经历或可核验材料？`,
      requirementIds: group?.relation === "any_of" ? group.requirementIds : [requirement.id],
      groupId: requirement.parentGroupId,
      sourceItemIds,
      relatedItemIds: sourceItemIds,
      candidateClaim: requirement.statement,
      targetFieldPaths,
      answerType: clarificationAnswerType(requirement.statement)
    }];
  });
}

function clarificationAnswerType(statement: string): "boolean" | "proficiency" | "text" | "url" | "multi_select" {
  if (/cursor|claude code|codex|windsurf/i.test(statement)) return "proficiency";
  if (/badcase|复现|原因|failure/i.test(statement)) return "text";
  if (/playwright|vitest|verifier|benchmark/i.test(statement)) return "multi_select";
  return "boolean";
}

function resolveConfirmedClaimText(claim: TailoringClaim, confirmation: ClaimConfirmation) {
  if (confirmation.editedText) return confirmation.editedText;
  if (claim.finalTextByProficiency && confirmation.proficiency) return claim.finalTextByProficiency[confirmation.proficiency];
  if (!confirmation.proficiency) return claim.proposedText;
  const tool = claim.keywords.find((keyword) => /cursor|claude code|codex|windsurf/i.test(keyword)) ?? "AI Coding 工具";
  const textByLevel = {
    proficient: `熟练使用 ${tool} 完成多文件开发、代码修改与问题定位。`,
    familiar: `熟悉 ${tool} 的项目开发、代码修改与调试流程。`,
    aware: `了解 ${tool} 等 AI Coding 工具的基本工作方式。`,
    learning: `正在学习 ${tool} 等 AI Coding 工具在真实开发任务中的应用。`
  } as const;
  return textByLevel[confirmation.proficiency];
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
  return suggestions.map((suggestion) => {
    const confirmable = buildConfirmableClaim(suggestion);
    return ({
    ...confirmable,
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
  });
  });
}
