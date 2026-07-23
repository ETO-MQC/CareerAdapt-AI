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
import {
  capabilityAllowsProficiency,
  capabilityIsMaterialOnly,
  captureAndDedupeTailoringClaims,
  dedupeTailoringClaims,
  pickProficiencyCapability,
  resolveCapabilityEntities,
  tailoringValueHash,
  validateTailoringClaimClosure
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
  TailoringAction,
  TailoringClarificationQuestion,
  TailoringIntensity,
  TailoringSuggestion
} from "@/domain/schemas";
import { ClarificationAnswerRecordSchema, ResumeTailoringPlanSchema, TailoringSuggestionSchema } from "@/domain/schemas";
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
    profile: input.profile,
    resolveEvidenceRefs: (item) => resolveBranchFactRefs(input.profile, item.factRefs)
  });
  const suggestions = createDeterministicTailoringSuggestions({
    branch: input.branch,
    job: input.job,
    intensity,
    operationId: input.operationId,
    resolveEvidenceRefs: (item) => resolveBranchFactRefs(input.profile, item.factRefs)
  });
  const claims = captureAndDedupeTailoringClaims({
    claims: claimsFromSuggestions(suggestions, input.branch.currentRevisionId ?? undefined),
    branch: input.branch,
    jobId: input.job.id
  });
  const clarificationQuestions = buildClarificationQuestions({ job: input.job, taskInputs });
  const plan = ResumeTailoringPlanSchema.parse({
    id: `tailoring-plan-${stableHashText(input.operationId)}`,
    branchId: input.branch.id,
    jobId: input.job.id,
    intensity,
    promptVersion: "resume-tailor.v2",
    jobContext,
    basedOnBranchRevision: input.branch.revision,
    basedOnRevisionId: input.branch.currentRevisionId,
    claims,
    plannerActions: [],
    clarificationQuestions,
    materialSuggestions: jobContext.verificationMaterials ?? [],
    materialTasks: (jobContext.verificationMaterials ?? []).map((label, index) => ({ id: `material-${stableHashText(`${input.job.id}:${index}:${label}`)}`, label, requirementIds: [] })),
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
  const mergedSuggestions = mergeById(input.plan.suggestions ?? [], input.suggestions);
  const mergedClaims = dedupeTailoringClaims({
    claims: mergeById(input.plan.claims, claimsFromSuggestions(input.suggestions, input.plan.basedOnRevisionId)),
    jobId: input.plan.jobId
  });
  return ResumeTailoringPlanSchema.parse({
    ...input.plan,
    claims: mergedClaims,
    suggestions: mergedSuggestions,
    invalidOutputCodes: input.invalidOutputCodes ?? []
  });
}

export function normalizeTailoringAction(action: string): TailoringAction {
  return ({ rewrite_from_evidence: "verified_rewrite", propose_confirmable_claim: "confirmable_rewrite", ask_user: "clarification_required", hide_or_deprioritize: "deprioritize" } as Record<string, TailoringAction>)[action] ?? action as TailoringAction;
}

export function withPlannerActions(input: { plan: ResumeTailoringPlan; assessments: Array<{ itemId: string; action: string; reason: string; suggestedKeywords: string[]; relatedRequirementIds: string[]; clarificationQuestions: string[] }> }) {
  const questions = input.plan.clarificationQuestions ?? [];
  const actionByItem = new Map(input.assessments.map((assessment) => [assessment.itemId, normalizeTailoringAction(assessment.action)]));
  const claims = input.plan.claims.flatMap((claim) => {
    const action = actionByItem.get(claim.targetContentItemId ?? "");
    if (action === "keep" || action === "deprioritize" || action === "clarification_required" || action === "material_task") return [];
    if (action === "confirmable_rewrite") return [{ ...claim, supportLevel: "reasonable_inference" as const, decision: "requires_confirmation" as const, confirmed: false }];
    return [claim];
  });

  // 从 planner 的 clarification_required 评估中创建澄清问题
  const plannerQuestions = input.assessments
    .filter((assessment) => normalizeTailoringAction(assessment.action) === "clarification_required" && assessment.clarificationQuestions.length > 0)
    .flatMap((assessment) => assessment.clarificationQuestions.map((questionText, index) => {
      const targetClaim = input.plan.claims.find((claim) => claim.targetContentItemId === assessment.itemId);
      const capability = pickProficiencyCapability(resolveCapabilityEntities({
        job: input.plan.jobContext,
        requirements: [questionText],
        keywords: assessment.suggestedKeywords
      })) ?? resolveCapabilityEntities({ requirements: [questionText], keywords: assessment.suggestedKeywords })[0];
      const targetPolicy = capabilityIsMaterialOnly(capability)
        ? "material_only" as const
        : targetClaim?.section === "summary"
          ? "summary_once" as const
          : targetClaim?.section === "skills"
            ? "skill_once" as const
            : "specific_item" as const;
      const inferredAnswerType = clarificationAnswerTypeFromAssessment(questionText);
      return {
        id: `planner-clarification-${assessment.itemId}-${index}`,
        question: questionText,
        requirementIds: assessment.relatedRequirementIds,
        sourceItemIds: [assessment.itemId],
        relatedItemIds: [assessment.itemId],
        candidateClaim: assessment.reason,
        targetFieldPaths: [targetClaim?.targetFieldPath ?? `sections.${assessment.itemId}`],
        capability,
        targetPolicy,
        answerType: inferredAnswerType === "proficiency" && !capabilityAllowsProficiency(capability)
          ? "text" as const
          : inferredAnswerType as TailoringClarificationQuestion["answerType"]
      };
    }));

  // 合并现有的澄清问题和 planner 创建的澄清问题
  const allQuestions = dedupeClarificationQuestions([...questions, ...plannerQuestions], input.plan.jobId);

  return ResumeTailoringPlanSchema.parse({
    ...input.plan,
    claims,
    clarificationQuestions: allQuestions,
    plannerActions: input.assessments.map((assessment) => ({
      itemId: assessment.itemId,
      action: normalizeTailoringAction(assessment.action),
      reason: assessment.reason,
      suggestedKeywords: assessment.suggestedKeywords,
      requirementIds: assessment.relatedRequirementIds,
      clarificationQuestionIds: allQuestions.filter((question) => question.relatedItemIds.includes(assessment.itemId)).map((question) => question.id)
    }))
  });
}

function clarificationAnswerTypeFromAssessment(questionText: string): string {
  if (/cursor|claude code|codex|windsurf/i.test(questionText) && /哪些|什么|哪个/i.test(questionText)) return "multi_select";
  if (/cursor|claude code|codex|windsurf/i.test(questionText)) return "proficiency";
  if (/badcase|复现|原因|failure/i.test(questionText)) return "text";
  if (/playwright|vitest|verifier|benchmark/i.test(questionText)) return "multi_select";
  if (/哪些|什么|哪个/i.test(questionText)) return "multi_select";
  if (/使用|用过|具备/i.test(questionText)) return "boolean";
  return "boolean";
}

export function answerTailoringClarification(input: { plan: ResumeTailoringPlan; question: TailoringClarificationQuestion; answer: string | string[] | boolean; proficiency?: ClaimConfirmation["proficiency"]; branch?: ResumeBranch }) {
  const normalizedAnswer = typeof input.answer === "string" ? input.answer.trim() : input.answer;
  const rejected = normalizedAnswer === false
    || (typeof normalizedAnswer === "string" && /^(?:没有|没有使用|不具备|不添加|否|无)$/.test(normalizedAnswer))
    || (Array.isArray(normalizedAnswer) && normalizedAnswer.length === 0);
  const answerRecord = ClarificationAnswerRecordSchema.parse({
    questionId: input.question.id,
    status: rejected ? "rejected" : "accepted",
    answer: input.answer,
    proficiency: input.proficiency,
    resolvedAt: new Date().toISOString()
  });
  const withAnswerRecord = (plan: ResumeTailoringPlan) => ResumeTailoringPlanSchema.parse({
    ...plan,
    clarificationAnswers: [
      ...(plan.clarificationAnswers ?? []).filter((record) => record.questionId !== input.question.id),
      answerRecord
    ]
  });
  if (rejected) return withAnswerRecord(input.plan);
  if (input.question.targetPolicy === "material_only") return withAnswerRecord(input.plan);
  const answerText = Array.isArray(input.answer) ? input.answer.join("、") : String(input.answer);
  const answerCapabilities = resolveCapabilityEntities({ userAnswers: Array.isArray(input.answer) ? input.answer : [answerText] });
  const capability = input.question.capability ?? pickProficiencyCapability(answerCapabilities);
  if (input.question.answerType === "proficiency" && !capabilityAllowsProficiency(capability)) {
    return withAnswerRecord(input.plan);
  }
  const sourceItemId = targetItemForQuestion(input.plan, input.question);
  const existing = input.plan.claims.find((claim) => claim.targetContentItemId === sourceItemId)
    ?? claimsFromSuggestions(
      (input.plan.suggestions ?? []).filter((suggestion) => suggestion.targetItemId === sourceItemId).slice(0, 1),
      input.plan.basedOnRevisionId
    )[0];
  const fallback = !existing && input.branch
    ? clarificationFallbackClaim(input.branch, { ...input.question, sourceItemIds: [sourceItemId] })
    : undefined;
  const skillProposal = !existing && !fallback && input.question.targetPolicy === "skill_once" && capabilityAllowsProficiency(capability) && input.branch
    ? newCapabilitySkillClaim(input.branch, input.question, capability!)
    : undefined;
  const claimSource = existing ?? fallback ?? skillProposal;
  if (!claimSource?.targetPatches?.[0]) return withAnswerRecord(input.plan);
  const label = input.question.candidateClaim;

  let resolved: string;
  let finalTextByProficiency: { proficient: string; familiar: string; aware: string; learning: string } | undefined;

  if (input.question.answerType === "multi_select" && Array.isArray(input.answer)) {
    const tools = answerCapabilities.filter(capabilityAllowsProficiency).map((item) => item.label).join("、");
    if (!tools) return withAnswerRecord(input.plan);
    resolved = `在 ${tools} 等 AI Coding 工具辅助下完成开发任务，具备真实使用经验。`;
    finalTextByProficiency = {
      proficient: `熟练使用 ${tools} 完成多文件开发、代码修改与问题定位。`,
      familiar: `熟悉 ${tools} 的项目开发、代码修改与调试流程。`,
      aware: `了解 ${tools} 等 AI Coding 工具的基本工作方式。`,
      learning: `正在学习 ${tools} 等 AI Coding 工具在真实开发任务中的应用。`
    };
  } else if (input.question.answerType === "proficiency" && input.proficiency) {
    const tool = capability!.label;
    finalTextByProficiency = {
      proficient: `熟练使用 ${tool} 完成多文件开发、代码修改与问题定位。`,
      familiar: `熟悉 ${tool} 的项目开发、代码修改与调试流程。`,
      aware: `了解 ${tool} 等 AI Coding 工具的基本工作方式。`,
      learning: `正在学习 ${tool} 等 AI Coding 工具在真实开发任务中的应用。`
    };
    resolved = finalTextByProficiency[input.proficiency];
  } else {
    resolved = answerText;
  }

  const patches = resolveClarificationPatches(claimSource.targetPatches, resolved, input.question.targetPolicy);
  const patch = patches.at(-1)!;
  const claim = captureClarificationClaimSnapshot({
    ...claimSource, id: `clarification-claim-${stableHashText(`${input.question.id}:${answerText}`)}`, label, claimText: resolved,
    finalTextByProficiency, proposedText: renderPatchValue(patch.after), targetPatches: patches,
    keywords: Array.isArray(input.answer)
      ? answerCapabilities.filter(capabilityAllowsProficiency).map((item) => item.label)
      : capability ? [capability.label] : [answerText],
    requirementIds: input.question.requirementIds, supportLevel: "user_declared", decision: "requires_confirmation", confirmed: false, syncScope: "resume_only",
    capability, targetPolicy: input.question.targetPolicy,
    reason: `根据你对"${input.question.question}"的回答生成，应用前仍需确认最终文本。`
  }, input.plan.basedOnRevisionId);
  const claims = dedupeTailoringClaims({ claims: [...input.plan.claims, claim], jobId: input.plan.jobId });
  return withAnswerRecord(ResumeTailoringPlanSchema.parse({ ...input.plan, claims }));
}

function clarificationFallbackClaim(branch: ResumeBranch, question: TailoringClarificationQuestion): TailoringClaim | undefined {
  const itemId = question.sourceItemIds[0];
  const structured = branch.structuredContentItems?.find((item) => item.id === itemId)?.data;
  const content = branch.contentItems.find((item) => item.id === itemId);
  if (!structured || !content) return undefined;
  const requestedField = question.targetFieldPaths[0]?.split(".").at(-1)?.replace(/\[\d+\]$/, "");
  const fieldPath = requestedField === "text" || requestedField === "description" || requestedField === "highlights" || requestedField === "name" ? requestedField : structured.sectionType === "summary" ? "text" : structured.sectionType === "skills" ? "description" : "highlights";
  if (!(["summary", "skills", "project", "work", "internship"] as string[]).includes(structured.sectionType)) return undefined;
  const record = structured as unknown as Record<string, unknown>;
  const before = fieldPath === "highlights" ? (Array.isArray(record.highlights) ? record.highlights.filter((value): value is string => typeof value === "string") : []) : typeof record[fieldPath] === "string" ? record[fieldPath] as string : "";
  return {
    id: `clarification-base-${question.id}`, section: structured.sectionType as TailoringClaim["section"], targetContentItemId: itemId,
    targetFieldPath: `sections.${structured.sectionType}.items.${itemId}.${fieldPath}`, currentText: Array.isArray(before) ? before.join("\n") : before,
    proposedText: Array.isArray(before) ? before.join("\n") : before, reason: question.question, keywords: [], supportLevel: "user_declared",
    decision: "requires_confirmation", evidenceRefs: [], syncScope: "resume_only", confirmed: false, sourceItemIds: [itemId],
    requirementIds: question.requirementIds, claimType: structured.sectionType === "skills" ? "skill" : "experience_reframe",
    capability: question.capability, targetPolicy: question.targetPolicy, baseRevisionId: branch.currentRevisionId ?? undefined,
    originalValue: before, originalValueHash: tailoringValueHash(before), suggestedValue: before,
    targetPatches: [{ sectionId: structured.sectionType, itemId, fieldPath, operation: "replace", before, after: before }]
  };
}

function targetItemForQuestion(plan: ResumeTailoringPlan, question: TailoringClarificationQuestion) {
  if (question.targetPolicy === "summary_once") {
    return plan.claims.find((claim) => claim.section === "summary")?.targetContentItemId ?? question.sourceItemIds[0];
  }
  if (question.targetPolicy === "skill_once") {
    const capability = question.capability?.normalizedLabel;
    return plan.claims.find((claim) =>
      claim.section === "skills"
      && (!capability || claim.capability?.normalizedLabel === capability || claim.keywords.some((value) => value.toLowerCase() === question.capability?.label.toLowerCase()))
    )?.targetContentItemId ?? question.sourceItemIds[0];
  }
  return question.sourceItemIds[0];
}

function newCapabilitySkillClaim(
  branch: ResumeBranch,
  question: TailoringClarificationQuestion,
  capability: NonNullable<TailoringClarificationQuestion["capability"]>
): TailoringClaim {
  const itemId = `tailoring-skill-${stableHashText(`${branch.id}:${capability.normalizedLabel}`)}`;
  const empty = "";
  return {
    id: `clarification-base-${question.id}`,
    section: "skills",
    targetContentItemId: itemId,
    targetFieldPath: `sections.skills.items.${itemId}.description`,
    currentText: empty,
    proposedText: empty,
    reason: question.question,
    keywords: [capability.label],
    supportLevel: "user_declared",
    decision: "requires_confirmation",
    evidenceRefs: [],
    syncScope: "resume_only",
    confirmed: false,
    sourceItemIds: [itemId],
    requirementIds: question.requirementIds,
    claimType: capability.type === "workflow" ? "workflow" : capability.type === "skill" ? "skill" : "tool",
    capability,
    targetPolicy: "skill_once",
    baseRevisionId: branch.currentRevisionId ?? undefined,
    originalValue: empty,
    originalValueHash: tailoringValueHash(empty),
    suggestedValue: empty,
    targetPatches: [
      { sectionId: "skills", itemId, fieldPath: "name", operation: "append", before: empty, after: capability.label },
      { sectionId: "skills", itemId, fieldPath: "description", operation: "replace", before: empty, after: empty }
    ]
  };
}

function resolveClarificationPatches(
  patches: NonNullable<TailoringClaim["targetPatches"]>,
  resolved: string,
  targetPolicy: TailoringClarificationQuestion["targetPolicy"]
) {
  return patches.map((patch, index) => {
    if (patches.length > 1 && index === 0 && patch.fieldPath === "name") return patch;
    if (!Array.isArray(patch.before)) return {
      ...patch,
      after: targetPolicy === "summary_once" && String(patch.before).trim()
        ? appendUniqueSentence(String(patch.before), resolved)
        : resolved
    };
    if (patch.targetIndex !== undefined && patch.targetIndex < patch.before.length) {
      return { ...patch, operation: "replace" as const, after: patch.before.map((value, itemIndex) => itemIndex === patch.targetIndex ? resolved : value) };
    }
    return patch.before.some((value) => normalizeSentence(value) === normalizeSentence(resolved))
      ? { ...patch, after: patch.before }
      : { ...patch, operation: "append" as const, after: [...patch.before, resolved] };
  });
}

function captureClarificationClaimSnapshot(claim: TailoringClaim, baseRevisionId?: string): TailoringClaim {
  const valuePatch = claim.targetPatches?.at(-1);
  const originalValue = valuePatch?.before ?? claim.originalValue ?? claim.currentText;
  const suggestedValue = valuePatch?.after ?? claim.suggestedValue ?? claim.proposedText;
  return {
    ...claim,
    baseRevisionId,
    originalValue,
    originalValueHash: tailoringValueHash(originalValue),
    suggestedValue,
    resolvedValue: undefined,
    currentText: renderSuggestionValue(originalValue as string | string[]),
    proposedText: renderSuggestionValue(suggestedValue as string | string[])
  };
}

function appendUniqueSentence(original: string, addition: string) {
  return normalizeSentence(original).includes(normalizeSentence(addition))
    ? original
    : `${original.trim()}${/[。！？!?]$/.test(original.trim()) ? "" : "。"}${addition}`;
}

function normalizeSentence(value: string) {
  return value.replace(/\s+/g, "").replace(/[。；;，,！!？?]+$/g, "").toLowerCase();
}

function mergeById<T extends { id: string }>(base: T[], additions: T[]) {
  const merged = new Map(base.map((item) => [item.id, item]));
  additions.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
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
      proposedText: claim.proposedText,
      resolvedText: confirmation.accepted ? resolvedClaim?.resolvedText ?? resolveConfirmedClaimText(claim, confirmation) : undefined,
      targetPatches: resolvedClaim?.targetPatches ?? claim.targetPatches,
      resolvedValue: confirmation.accepted
        ? resolvedClaim?.targetPatches.at(-1)?.after ?? resolveConfirmedClaimText(claim, confirmation)
        : undefined,
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
  const questions = candidates.flatMap((requirement, index) => {
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
    const entities = resolveCapabilityEntities({
      job: input.job,
      requirements: [requirement.statement],
      keywords: requirement.exactKeywords
    });
    const capability = pickProficiencyCapability(entities) ?? entities.find((item) => item.source === "requirement");
    const materialOnly = capabilityIsMaterialOnly(capability);
    const singleTarget = related.length === 1 ? related[0] : undefined;
    const targetPolicy = materialOnly
      ? "material_only" as const
      : singleTarget?.target.sectionType === "summary"
        ? "summary_once" as const
        : singleTarget?.target.sectionType === "skills"
          ? "skill_once" as const
          : singleTarget
            ? "specific_item" as const
            : capabilityAllowsProficiency(capability) ? "skill_once" as const : "summary_once" as const;
    const inferredAnswerType = clarificationAnswerType(requirement.statement);
    return [{
      id: `clarification-${requirement.id}-${index + 1}`,
      question: group?.relation === "any_of" ? `以下 ${group.requirementIds.length} 项满足任一项即可；你具备其中哪一项真实经历或可核验材料？` : `你是否具备"${requirement.statement}"相关的真实经历或可核验材料？`,
      requirementIds: group?.relation === "any_of" ? group.requirementIds : [requirement.id],
      groupId: requirement.parentGroupId,
      sourceItemIds,
      relatedItemIds: sourceItemIds,
      candidateClaim: requirement.statement,
      targetFieldPaths,
      capability,
      targetPolicy,
      answerType: inferredAnswerType === "proficiency" && !capabilityAllowsProficiency(capability) ? "text" as const : inferredAnswerType
    }];
  });
  return dedupeClarificationQuestions(questions, input.job.id);
}

function clarificationAnswerType(statement: string): "boolean" | "proficiency" | "text" | "url" | "multi_select" {
  if (/cursor|claude code|codex|windsurf/i.test(statement)) return "proficiency";
  if (/badcase|复现|原因|failure/i.test(statement)) return "text";
  if (/playwright|vitest|verifier|benchmark/i.test(statement)) return "multi_select";
  return "boolean";
}

export function dedupeClarificationQuestions(questions: TailoringClarificationQuestion[], jobId: string) {
  const merged = new Map<string, TailoringClarificationQuestion>();
  for (const question of questions) {
    const capability = question.capability?.normalizedLabel ?? "none";
    const targetItemId = question.targetPolicy === "specific_item" ? question.sourceItemIds[0] : question.targetPolicy;
    const targetFieldPath = question.targetPolicy === "specific_item" ? question.targetFieldPaths[0] : question.targetPolicy;
    const key = [jobId, capability, question.targetPolicy, targetItemId, targetFieldPath].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, question);
      continue;
    }
    merged.set(key, {
      ...existing,
      requirementIds: [...new Set([...existing.requirementIds, ...question.requirementIds])],
      sourceItemIds: [...new Set([...existing.sourceItemIds, ...question.sourceItemIds])],
      relatedItemIds: [...new Set([...existing.relatedItemIds, ...question.relatedItemIds])],
      targetFieldPaths: [...new Set([...existing.targetFieldPaths, ...question.targetFieldPaths])]
    });
  }
  return [...merged.values()];
}

function resolveConfirmedClaimText(claim: TailoringClaim, confirmation: ClaimConfirmation) {
  if (confirmation.editedText) return confirmation.editedText;
  if (claim.finalTextByProficiency && confirmation.proficiency) return claim.finalTextByProficiency[confirmation.proficiency];
  if (!confirmation.proficiency) return claim.proposedText;
  const capability = claim.capability ?? pickProficiencyCapability(resolveCapabilityEntities({ keywords: claim.keywords }));
  if (!capabilityAllowsProficiency(capability)) return claim.proposedText;
  const tool = capability!.label;
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
  const closureIssues = validateTailoringClaimClosure({ claims: input.plan.claims.filter((claim) => claim.syncScope !== "rejected") });
  if (closureIssues.length) {
    return { status: "blocked", summary: `存在不能应用的岗位定制冲突：${closureIssues.map((item) => item.code).join("、")}`, plan: input.plan };
  }
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

function renderPatchValue(value: string | string[] | number | boolean) {
  return Array.isArray(value) ? value.join("\n") : String(value);
}

function claimsFromSuggestions(suggestions: TailoringSuggestion[], baseRevisionId?: string): TailoringClaim[] {
  return suggestions.flatMap((suggestion): TailoringClaim[] => {
    const capability = pickProficiencyCapability(resolveCapabilityEntities({ keywords: suggestion.targetKeywords }))
      ?? resolveCapabilityEntities({ keywords: suggestion.targetKeywords }).find((item) => capabilityIsMaterialOnly(item));
    if (suggestion.targetSectionType === "skills" && capabilityIsMaterialOnly(capability)) return [];
    const confirmable = buildConfirmableClaim(suggestion);
    const originalValue = confirmable.targetPatches[0].before;
    const suggestedValue = confirmable.targetPatches[0].after;
    return [{
    ...confirmable,
    id: suggestion.id,
    section: suggestion.targetSectionType,
    targetContentItemId: suggestion.targetItemId,
    targetFieldPath: suggestion.targetFieldPath,
    targetPolicy: capabilityIsMaterialOnly(capability) ? "material_only"
      : suggestion.targetSectionType === "summary" ? "summary_once"
        : suggestion.targetSectionType === "skills" ? "skill_once" : "specific_item",
    capability,
    baseRevisionId,
    originalValue,
    originalValueHash: tailoringValueHash(originalValue),
    suggestedValue,
    resolvedValue: suggestion.status === "ready" ? suggestedValue : undefined,
    currentText: renderSuggestionValue(originalValue as string | string[]),
    proposedText: renderSuggestionValue(suggestedValue as string | string[]),
    reason: suggestion.rationale,
    keywords: suggestion.targetKeywords,
    requirementIds: suggestion.requirementIds,
    supportLevel: suggestion.claimSupportLevel,
    decision: suggestion.status === "ready" ? "auto_applicable" : suggestion.status === "requires_confirmation" ? "requires_confirmation" : "blocked",
    evidenceRefs: suggestion.evidenceRefs,
    syncScope: suggestion.status === "blocked" ? "rejected" : "resume_only",
    confirmed: suggestion.status === "ready"
    }];
  });
}
