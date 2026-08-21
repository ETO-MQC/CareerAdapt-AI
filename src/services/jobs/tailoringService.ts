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
  CapabilityEntity,
  ClaimConfirmation,
  CanonicalResumeTailoringPlan,
  JobCoverageReportV2,
  JobDescription,
  ResumeBranch,
  ResumeTailoringPlan,
  ResumeTailorTaskInputV2,
  TailoringClaim,
  TailoringAction,
  TailoringClarificationQuestion,
  TailoringQuestionAnswerReceipt,
  TailoringQuestionPlan,
  TailoringIntensity,
  TailoringSuggestion
} from "@/domain/schemas";
import {
  ClarificationAnswerRecordSchema,
  ResumeTailoringPlanSchema,
  TailoringQuestionAnswerReceiptSchema,
  TailoringQuestionPlanSchema,
  TailoringSuggestionSchema
} from "@/domain/schemas";
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
      const inferredAnswerType = clarificationAnswerTypeFromAssessment(questionText, capability);
      return {
        id: `planner-clarification-${assessment.itemId}-${index}`,
        question: questionText,
        requirementText: questionText,
        requirementCategory: capability?.type ?? "planner_clarification",
        requirementPriority: assessment.relatedRequirementIds.length ? "high" : "medium",
        evidenceNeed: "请提供真实经历、使用场景和结果证据",
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
  const allQuestions = input.plan.questionPlan?.frozenAt
    ? questions
    : selectHighValueClarificationQuestions(
        dedupeClarificationQuestions([...questions, ...plannerQuestions], input.plan.jobId),
        3
      );

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

export function clarificationAnswerTypeFromAssessment(questionText: string, capability?: CapabilityEntity): ReturnType<typeof clarificationAnswerType> {
  const normalized = questionText.trim();
  if (isEvidenceFirstQuestion(normalized)) return "text";
  if (/链接|网址|仓库|作品集|github|url/i.test(normalized)) return "url";
  if (/哪些|哪项|哪个|哪一|任意|之一|可选|多选|列表/i.test(normalized)) return "multi_select";
  if (/描述|举例|案例|复现|原因|过程|如何|材料|证据|成果|项目中|负责过|解决过|产出过|失败|限制/i.test(normalized)) return "text";
  if (capabilityAllowsProficiency(capability) && /程度|熟练|熟悉|了解|水平|使用过|实际使用|掌握|经验/i.test(normalized)) return "proficiency";
  if (/是否|有没有|有无|用过|具备|曾经|能否|是否有/i.test(normalized)) return "boolean";
  return capabilityAllowsProficiency(capability) ? "proficiency" : "boolean";
}

export type TailoringQuestionAnswerDisposition = "answered" | "none" | "uncertain" | "skipped";

export function classifyTailoringQuestionAnswer(answer: string | string[] | boolean): TailoringQuestionAnswerDisposition {
  const normalizedAnswer = typeof answer === "string" ? answer.trim() : answer;
  if (typeof normalizedAnswer === "string" && normalizedAnswer === "跳过") return "skipped";
  if (typeof normalizedAnswer === "string" && normalizedAnswer === "不确定") return "uncertain";
  if (normalizedAnswer === false
    || (typeof normalizedAnswer === "string" && /^(?:没有|没有使用|不具备|不添加|否|无)$/.test(normalizedAnswer))
    || (Array.isArray(normalizedAnswer) && normalizedAnswer.length === 0)) return "none";
  return "answered";
}

export function answerTailoringClarification(input: {
  plan: ResumeTailoringPlan;
  question: TailoringClarificationQuestion;
  answer: string | string[] | boolean;
  proficiency?: ClaimConfirmation["proficiency"];
  branch?: ResumeBranch;
  operationId?: string;
  answerMessageId?: string;
  now?: string;
}): CanonicalResumeTailoringPlan {
  const normalizedAnswer = typeof input.answer === "string" ? input.answer.trim() : input.answer;
  const disposition = classifyTailoringQuestionAnswer(input.answer);
  const skipped = disposition === "skipped";
  const uncertain = disposition === "uncertain";
  const rejected = disposition === "none";
  const previous = input.plan.clarificationAnswers?.find((record) => record.questionId === input.question.id);
  if (previous?.operationId && input.operationId && previous.operationId === input.operationId) {
    return ResumeTailoringPlanSchema.parse(input.plan);
  }
  const resolvedAt = input.now ?? new Date().toISOString();
  const answerRecord = ClarificationAnswerRecordSchema.parse({
    questionId: input.question.id,
    status: skipped ? "skipped" : uncertain ? "uncertain" : rejected ? "rejected" : "accepted",
    answer: skipped ? undefined : input.answer,
    proficiency: input.proficiency,
    evidenceQuote: typeof normalizedAnswer === "string" ? normalizedAnswer : undefined,
    answerRevision: (previous?.answerRevision ?? 0) + 1,
    operationId: input.operationId,
    resolvedAt
  });
  const withAnswerRecord = (plan: ResumeTailoringPlan) => {
    const questionPlan = advanceTailoringQuestionPlan(plan.questionPlan, input.question.id, disposition, resolvedAt);
    const clarificationAnswers = [
      ...(plan.clarificationAnswers ?? []).filter((record) => record.questionId !== input.question.id),
      answerRecord
    ];
    const receipt: TailoringQuestionAnswerReceipt = TailoringQuestionAnswerReceiptSchema.parse({
      questionPlanId: plan.questionPlan?.id ?? "tailoring-question-plan-legacy",
      questionPlanRevision: plan.questionPlan?.revision ?? 1,
      questionId: input.question.id,
      answerMessageId: input.answerMessageId ?? `tailoring-answer-${input.operationId ?? input.question.id}`,
      disposition,
      answerText: answerTextForReceipt(input.answer),
      consumedAt: resolvedAt
    });
    const answerReceipts = [
      ...(plan.answerReceipts ?? []).filter((item) => item.questionId !== input.question.id),
      receipt
    ];
    const answerRevisionHash = tailoringAnswerRevisionHash({ clarificationAnswers });
    return ResumeTailoringPlanSchema.parse({
      ...plan,
      diffs: previous ? [] : plan.diffs,
      clarificationAnswers,
      answerReceipts,
      generationStatus: previous ? "ready_for_regeneration" : plan.generationStatus,
      answerRevisionHash,
      ...(previous ? {
        generatedDiffsBasedOnQuestionPlanRevision: undefined,
        generatedDiffsBasedOnAnswerRevisionHash: undefined
      } : {}),
      clarificationQuestions: (plan.clarificationQuestions ?? []).map((question) => question.id === input.question.id
        ? {
            ...question,
            status: skipped ? "skipped" : "answered",
            answer: skipped ? undefined : input.answer,
            proficiency: input.proficiency,
            evidenceQuote: typeof normalizedAnswer === "string" ? normalizedAnswer : undefined,
            answeredAt: resolvedAt,
            updatedAt: resolvedAt
          }
        : question.id === questionPlan?.activeQuestionId
          ? { ...question, status: "active", updatedAt: resolvedAt }
          : question),
      questionPlan
    });
  };
  if (rejected || skipped || uncertain) return withAnswerRecord(input.plan);
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
    resolved = `结合 ${tools} 等相关工具或方法完成岗位相关任务，具备真实使用经验。`;
    finalTextByProficiency = {
      proficient: `熟练运用 ${tools} 完成相关任务、问题定位与结果交付。`,
      familiar: `熟悉 ${tools} 在相关任务中的使用、修改与问题定位流程。`,
      aware: `了解 ${tools} 等相关工具或方法的基本工作方式。`,
      learning: `正在学习 ${tools} 等相关工具或方法在真实任务中的应用。`
    };
  } else if (input.question.answerType === "proficiency" && input.proficiency) {
    const tool = capability!.label;
    finalTextByProficiency = {
      proficient: `熟练运用 ${tool} 完成相关任务、问题定位与结果交付。`,
      familiar: `熟悉 ${tool} 在相关任务中的使用、修改与问题定位流程。`,
      aware: `了解 ${tool} 等相关工具或方法的基本工作方式。`,
      learning: `正在学习 ${tool} 等相关工具或方法在真实任务中的应用。`
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

/**
 * Consume a presented question at the workflow boundary. The normal path
 * uses the typed tailoring plan; the small projection fallback keeps older
 * persisted host snapshots readable until their next canonical tool result.
 */
export function consumeTailoringQuestionAnswer(input: {
  session: Record<string, unknown>;
  questionId: string;
  answer: string | string[] | boolean;
  answerMessageId: string;
  proficiency?: ClaimConfirmation["proficiency"];
  branch?: ResumeBranch;
  operationId?: string;
  now?: string;
}): { session: Record<string, unknown>; receipt: TailoringQuestionAnswerReceipt; changed: boolean } {
  const tailoringPlan = rawRecord(input.session.plan);
  const questionPlan = rawRecord(tailoringPlan.questionPlan);
  const questions = rawRecords(tailoringPlan.clarificationQuestions);
  const question = questions.find((item) => item.id === input.questionId);
  if (!question) throw new Error("tailoring_question_not_found");
  const previousAnswer = rawRecords(tailoringPlan.clarificationAnswers).find((item) => item.questionId === input.questionId);
  const previousReceipt = rawRecords(tailoringPlan.answerReceipts).find((item) => item.questionId === input.questionId);
  if (previousReceipt?.answerMessageId === input.answerMessageId) {
    return {
      session: input.session,
      receipt: TailoringQuestionAnswerReceiptSchema.parse(previousReceipt),
      changed: false
    };
  }
  const activeQuestionId = typeof questionPlan.activeQuestionId === "string" ? questionPlan.activeQuestionId : undefined;
  if (activeQuestionId !== input.questionId && !previousAnswer && !previousReceipt) {
    throw new Error("tailoring_question_not_active");
  }

  const parsedPlan = ResumeTailoringPlanSchema.safeParse(tailoringPlan);
  if (parsedPlan.success) {
    const typedQuestion = parsedPlan.data.clarificationQuestions?.find((item) => item.id === input.questionId);
    if (!typedQuestion) throw new Error("tailoring_question_not_found");
    const plan = answerTailoringClarification({
      plan: parsedPlan.data,
      question: typedQuestion,
      answer: input.answer,
      proficiency: input.proficiency,
      branch: input.branch,
      operationId: input.operationId,
      answerMessageId: input.answerMessageId,
      now: input.now
    });
    const receipt = plan.answerReceipts.find((item) => item.questionId === input.questionId);
    if (!receipt) throw new Error("tailoring_question_receipt_missing");
    return {
      session: { ...input.session, plan, revision: (numberValue(input.session.revision) ?? 1) + (plan === parsedPlan.data ? 0 : 1) },
      receipt,
      changed: plan !== parsedPlan.data
    };
  }

  const now = input.now ?? new Date().toISOString();
  const disposition = classifyTailoringQuestionAnswer(input.answer);
  const questionIds = rawStringArray(questionPlan.questionIds);
  const currentAnswered = rawStringArray(questionPlan.answeredQuestionIds).filter((id) => id !== input.questionId);
  const currentSkipped = rawStringArray(questionPlan.skippedQuestionIds).filter((id) => id !== input.questionId);
  const currentUncertain = rawStringArray(questionPlan.uncertainQuestionIds).filter((id) => id !== input.questionId);
  const answeredQuestionIds = disposition === "answered" || disposition === "none"
    ? [...new Set([...currentAnswered, input.questionId])]
    : currentAnswered;
  const skippedQuestionIds = disposition === "skipped"
    ? [...new Set([...currentSkipped, input.questionId])]
    : currentSkipped;
  const uncertainQuestionIds = disposition === "uncertain"
    ? [...new Set([...currentUncertain, input.questionId])]
    : currentUncertain;
  const resolvedIds = new Set([...answeredQuestionIds, ...skippedQuestionIds, ...uncertainQuestionIds]);
  const editingResolved = Boolean(previousAnswer || previousReceipt);
  const nextQuestionId = editingResolved
    ? activeQuestionId
    : questionIds.find((id) => !resolvedIds.has(id));
  const questionPlanRevision = numberValue(questionPlan.revision) ?? 1;
  const receipt = TailoringQuestionAnswerReceiptSchema.parse({
    questionPlanId: typeof questionPlan.id === "string" ? questionPlan.id : "tailoring-question-plan-legacy",
    questionPlanRevision,
    questionId: input.questionId,
    answerMessageId: input.answerMessageId,
    disposition,
    answerText: answerTextForReceipt(input.answer),
    consumedAt: now
  });
  const priorAnswerRevision = numberValue(previousAnswer?.answerRevision) ?? 0;
  const answerRecord = {
    questionId: input.questionId,
    status: disposition === "skipped" ? "skipped" : disposition === "uncertain" ? "uncertain" : disposition === "none" ? "rejected" : "accepted",
    ...(disposition === "skipped" ? {} : { answer: input.answer }),
    ...(typeof input.answer === "string" ? { evidenceQuote: input.answer.trim() || undefined } : {}),
    answerRevision: priorAnswerRevision + 1,
    ...(input.operationId && input.operationId.length >= 8 ? { operationId: input.operationId } : {}),
    resolvedAt: now
  };
  const nextPlan = {
    ...tailoringPlan,
    clarificationAnswers: [
      ...rawRecords(tailoringPlan.clarificationAnswers).filter((item) => item.questionId !== input.questionId),
      answerRecord
    ],
    answerReceipts: [
      ...rawRecords(tailoringPlan.answerReceipts).filter((item) => item.questionId !== input.questionId),
      receipt
    ],
    clarificationQuestions: questions.map((item) => item.id === input.questionId
      ? {
          ...item,
          status: disposition === "skipped" ? "skipped" : "answered",
          ...(disposition === "skipped" ? { answer: undefined } : { answer: input.answer }),
          ...(typeof input.answer === "string" ? { evidenceQuote: input.answer.trim() || undefined } : {}),
          answeredAt: now,
          updatedAt: now
        }
      : item.id === nextQuestionId ? { ...item, status: "active", updatedAt: now } : item),
    questionPlan: {
      ...questionPlan,
      revision: questionPlanRevision + 1,
      status: nextQuestionId ? "asking" : "ready_for_generation",
      activeQuestionId: nextQuestionId,
      answeredQuestionIds,
      skippedQuestionIds,
      uncertainQuestionIds,
      completedAt: nextQuestionId ? undefined : now
    }
  };
  return {
    session: {
      ...input.session,
      plan: nextPlan,
      revision: (numberValue(input.session.revision) ?? 1) + 1
    },
    receipt,
    changed: true
  };
}

/** Stable input marker for generated diffs. It includes answer revisions so an edit
 * cannot accidentally reuse a preview generated from an earlier answer. */
export function tailoringAnswerRevisionHash(plan: Pick<ResumeTailoringPlan, "clarificationAnswers">) {
  const answers = [...(plan.clarificationAnswers ?? [])]
    .sort((left, right) => left.questionId.localeCompare(right.questionId))
    .map((answer) => ({
      questionId: answer.questionId,
      status: answer.status,
      answer: answer.answer,
      proficiency: answer.proficiency,
      answerRevision: answer.answerRevision
    }));
  return stableHashText(JSON.stringify(answers));
}

function answerTextForReceipt(answer: string | string[] | boolean) {
  if (typeof answer === "string") return answer.trim() || undefined;
  if (Array.isArray(answer)) return answer.join("、").trim() || undefined;
  return answer ? "有" : "没有";
}

function rawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rawRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(rawRecord).filter((item) => Object.keys(item).length > 0) : [];
}

function rawStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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
  const candidates = graph.requirements
    .filter((node) => node.priority === "must" || node.priority === "high")
    .filter((node) => isMaterialTailoringRequirement(node.statement));
  const emittedAnyOfGroups = new Set<string>();
  const fallbackTargets = input.taskInputs.filter((item) => ["summary", "skills", "project", "work", "internship"].includes(item.target.sectionType)).slice(0, 4);
  const questions = candidates.flatMap((requirement, index) => {
    const requirementText = requirement.statement.trim();
    const group = requirement.parentGroupId ? graph.groups.find((item) => item.id === requirement.parentGroupId) : undefined;
    if (group?.relation === "any_of") {
      if (emittedAnyOfGroups.has(group.id)) return [];
      emittedAnyOfGroups.add(group.id);
    }
    const directlyRelated = input.taskInputs.filter((item) => item.relevantRequirements.some((related) => related.requirementId === requirement.id));
    const normalizedKeywords = requirement.exactKeywords
      .map((keyword) => keyword.toLocaleLowerCase().replace(/\s+/g, ""))
      .filter((keyword) => keyword.length >= 2);
    const hasEvidence = normalizedKeywords.length > 0 && directlyRelated.some((item) => {
      const evidenceText = item.allowedFacts
        .map((fact) => fact.value)
        .join(" ")
        .toLocaleLowerCase()
        .replace(/\s+/g, "");
      return normalizedKeywords.some((keyword) => evidenceText.includes(keyword));
    });
    if (hasEvidence) return [];
    const related = (directlyRelated.length ? directlyRelated : fallbackTargets).slice(0, 4);
    const sourceItemIds = [...new Set(related.map((item) => item.target.itemId ?? item.target.sectionId))];
    const targetFieldPaths = [...new Set(related.map((item) => item.target.fieldPath))];
    if (!sourceItemIds.length || !targetFieldPaths.length) return [];
    const entities = resolveCapabilityEntities({
      job: input.job,
      requirements: [requirementText],
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
    const inferredAnswerType = clarificationAnswerType(requirementText, capability);
    const expectedImpact = related.some((item) => item.target.sectionType === "summary")
      ? "summary" as const
      : related.some((item) => item.target.sectionType === "skills")
        ? "skills" as const
        : related.some((item) => item.target.sectionType === "project")
          ? "project" as const
          : "multiple" as const;
    const capabilityCluster = inferCapabilityCluster(requirementText, capability?.normalizedLabel);
    return [{
      id: `clarification-${requirement.id}-${index + 1}`,
      question: group?.relation === "any_of" ? `以下 ${group.requirementIds.length} 项满足任一项即可；你具备其中哪一项真实经历或可核验材料？` : `你是否具备"${requirementText}"相关的真实经历或可核验材料？`,
      requirementText,
      requirementCategory: requirement.kind,
      requirementPriority: requirement.priority,
      evidenceNeed: evidenceNeedForRequirement(requirement.kind, requirementText),
      shortLabel: shortQuestionLabel(requirementText),
      requirementIds: group?.relation === "any_of" ? group.requirementIds : [requirement.id],
      groupId: requirement.parentGroupId,
      sourceItemIds,
      relatedItemIds: sourceItemIds,
      candidateClaim: requirementText,
      targetFieldPaths,
      capability,
      capabilityCluster,
      targetPolicy,
      answerType: inferredAnswerType === "proficiency" && !capabilityAllowsProficiency(capability) ? "text" as const : inferredAnswerType,
      options: defaultQuestionOptions(inferredAnswerType, isEvidenceFirstQuestion(requirementText)),
      expectedImpact,
      priorityScore: (requirement.priority === "must" ? 50 : 35) + requirement.exactKeywords.length + (expectedImpact === "summary" ? 20 : expectedImpact === "skills" ? 16 : 8),
      status: "pending" as const,
      updatedAt: new Date().toISOString()
    }];
  });
  return selectHighValueClarificationQuestions(dedupeClarificationQuestions(questions, input.job.id), 3);
}

function isMaterialTailoringRequirement(statement: string) {
  const normalized = statement.trim();
  if (normalized.length < 8) return false;
  return !/^(?:我想|我要|希望|请帮我)?\s*(?:应聘|申请|投递)\s*(?:这个|该|目标)?\s*(?:岗位|职位)\s*(?:[:：].*)?$/u.test(normalized);
}

function evidenceNeedForRequirement(category: string, statement: string) {
  if (category === "tool_or_technology") return "请提供实际使用场景、项目范围和可核验结果";
  if (category === "verification" || /作品集|仓库|链接|材料|证据|可核验/u.test(statement)) return "请提供可核验材料、来源或链接";
  if (category === "responsibility") return "请提供你实际负责的任务、方法和结果";
  if (category === "experience_depth") return "请提供对应项目或工作经历、时间和交付结果";
  return "请提供真实经历、使用场景和结果证据";
}

export function clarificationAnswerType(statement: string, capability?: CapabilityEntity): "boolean" | "proficiency" | "text" | "url" | "multi_select" {
  const normalized = statement.trim();
  if (isEvidenceFirstQuestion(normalized)) return "text";
  if (/链接|网址|仓库|作品集|github|url/i.test(normalized)) return "url";
  if (/哪些|哪项|哪个|哪一|任意|之一|可选|多选|列表/i.test(normalized)) return "multi_select";
  if (/描述|举例|案例|复现|原因|过程|如何|材料|证据|成果|项目中|负责过|解决过|产出过|失败|限制/i.test(normalized)) return "text";
  if (capabilityAllowsProficiency(capability) && /程度|熟练|熟悉|了解|水平|使用过|实际使用|掌握|经验/i.test(normalized)) return "proficiency";
  if (/是否|有没有|有无|用过|具备|曾经|能否|是否有/i.test(normalized)) return "boolean";
  return capabilityAllowsProficiency(capability) ? "proficiency" : "boolean";
}

export function dedupeClarificationQuestions(questions: TailoringClarificationQuestion[], jobId: string) {
  const merged = new Map<string, TailoringClarificationQuestion>();
  for (const question of questions) {
    const cluster = question.capabilityCluster ?? inferCapabilityCluster(
      `${question.question} ${question.candidateClaim}`,
      question.capability?.normalizedLabel
    );
    const key = [jobId, cluster].join("|");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, question);
      continue;
    }
    merged.set(key, {
      ...existing,
      capabilityCluster: cluster,
      requirementIds: [...new Set([...existing.requirementIds, ...question.requirementIds])],
      sourceItemIds: [...new Set([...existing.sourceItemIds, ...question.sourceItemIds])],
      relatedItemIds: [...new Set([...existing.relatedItemIds, ...question.relatedItemIds])],
      targetFieldPaths: [...new Set([...existing.targetFieldPaths, ...question.targetFieldPaths])]
    });
  }
  return [...merged.values()];
}

export function selectHighValueClarificationQuestions(
  questions: TailoringClarificationQuestion[],
  budget = 3
) {
  const maximum = Math.max(0, Math.min(5, budget));
  const byCluster = new Map<string, TailoringClarificationQuestion>();
  for (const question of questions) {
    const cluster = question.capabilityCluster ?? inferCapabilityCluster(
      `${question.question} ${question.candidateClaim}`,
      question.capability?.normalizedLabel
    );
    const candidate = { ...question, capabilityCluster: cluster };
    const existing = byCluster.get(cluster);
    if (!existing || (candidate.priorityScore ?? 0) > (existing.priorityScore ?? 0)) byCluster.set(cluster, candidate);
  }
  return [...byCluster.values()]
    .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0) || left.id.localeCompare(right.id))
    .slice(0, maximum);
}

export function createTailoringQuestionPlan(input: {
  sessionId: string;
  questions: TailoringClarificationQuestion[];
  now?: string;
  defaultBudget?: number;
  maximumBudget?: number;
}): TailoringQuestionPlan {
  const now = input.now ?? new Date().toISOString();
  const maximumBudget = Math.max(0, Math.min(5, input.maximumBudget ?? 5));
  const defaultBudget = Math.max(0, Math.min(maximumBudget, input.defaultBudget ?? 3));
  const selected = selectHighValueClarificationQuestions(input.questions, defaultBudget);
  const questionIds = selected.map((question) => question.id);
  return TailoringQuestionPlanSchema.parse({
    id: `tailoring-question-plan-${stableHashText(input.sessionId)}`,
    sessionId: input.sessionId,
    revision: 1,
    status: questionIds.length ? "asking" : "ready_for_generation",
    defaultBudget,
    maximumBudget,
    questionIds,
    activeQuestionId: questionIds[0],
    answeredQuestionIds: [],
    skippedQuestionIds: [],
    uncertainQuestionIds: [],
    createdAt: now,
    frozenAt: now,
    completedAt: questionIds.length ? undefined : now
  });
}

export function getActiveTailoringQuestion(plan: Pick<ResumeTailoringPlan, "questionPlan" | "clarificationQuestions">) {
  const activeId = plan.questionPlan?.activeQuestionId;
  return activeId ? plan.clarificationQuestions?.find((question) => question.id === activeId) : undefined;
}

function advanceTailoringQuestionPlan(
  questionPlan: TailoringQuestionPlan | undefined,
  questionId: string,
  disposition: TailoringQuestionAnswerDisposition,
  now: string
) {
  if (!questionPlan) return undefined;
  const editingResolved = questionPlan.answeredQuestionIds.includes(questionId)
    || questionPlan.skippedQuestionIds.includes(questionId)
    || questionPlan.uncertainQuestionIds.includes(questionId);
  if (questionPlan.activeQuestionId !== questionId && !editingResolved) throw new Error("tailoring_question_not_active");
  const answeredQuestionIds = disposition === "answered" || disposition === "none"
    ? [...new Set([...questionPlan.answeredQuestionIds.filter((id) => id !== questionId), questionId])]
    : questionPlan.answeredQuestionIds.filter((id) => id !== questionId);
  const skippedQuestionIds = disposition === "skipped"
    ? [...new Set([...questionPlan.skippedQuestionIds.filter((id) => id !== questionId), questionId])]
    : questionPlan.skippedQuestionIds.filter((id) => id !== questionId);
  const uncertainQuestionIds = disposition === "uncertain"
    ? [...new Set([...questionPlan.uncertainQuestionIds.filter((id) => id !== questionId), questionId])]
    : questionPlan.uncertainQuestionIds.filter((id) => id !== questionId);
  const resolved = new Set([...answeredQuestionIds, ...skippedQuestionIds, ...uncertainQuestionIds]);
  const activeQuestionId = editingResolved
    ? questionPlan.activeQuestionId
    : questionPlan.questionIds.find((id) => !resolved.has(id));
  return TailoringQuestionPlanSchema.parse({
    ...questionPlan,
    revision: questionPlan.revision + 1,
    status: activeQuestionId ? "asking" : "ready_for_generation",
    activeQuestionId,
    answeredQuestionIds,
    skippedQuestionIds,
    uncertainQuestionIds,
    completedAt: activeQuestionId ? undefined : now
  });
}

function inferCapabilityCluster(text: string, capability?: string) {
  const normalized = `${text} ${capability ?? ""}`.toLocaleLowerCase().replace(/\s+/g, "");
  if (/(ai|llm|大模型).*(回答|输出|回复).*(评估|质量|纠错)|((评估|检查|纠错).*(ai|llm|大模型).*(回答|输出|回复))/.test(normalized)) return "ai_answer_evaluation";
  if (/(复杂|多约束|高难度).*(任务|指令|题目)|(任务|指令).*(设计|拆解)/.test(normalized)) return "complex_task_design";
  if (/rag|检索增强|grounding|知识库/.test(normalized)) return "rag_grounding";
  if (/反馈|修正|失败案例|错误案例|纠错|复盘/.test(normalized)) return "feedback_and_correction";
  if (/量化|百分比|提升|结果|成效/.test(normalized)) return "measurable_result";
  if (/ai编程|智能编程|codingagent|开发助手|代码助手|大模型工具/.test(normalized)) return "llm_tool_usage";
  return capability ? `capability:${capability}` : `requirement:${stableHashText(normalized).slice(0, 12)}`;
}

function shortQuestionLabel(statement: string) {
  return statement.replace(/[。；;，,].*$/u, "").trim().slice(0, 28) || "岗位相关经验";
}

function defaultQuestionOptions(answerType: ReturnType<typeof clarificationAnswerType>, evidenceFirst = false) {
  if (evidenceFirst) return [
    { id: "evidence", label: "有相关经历", value: "有相关经历" },
    { id: "partial", label: "接触过但不完整", value: "接触过但不完整" },
    { id: "none", label: "没有", value: "没有" },
    { id: "uncertain", label: "不确定", value: "不确定" },
    { id: "skip", label: "跳过", value: "跳过" }
  ];
  if (answerType === "boolean") return [
    { id: "yes", label: "有", value: "有" },
    { id: "no", label: "没有", value: "没有" },
    { id: "uncertain", label: "不确定", value: "不确定" },
    { id: "skip", label: "跳过", value: "跳过" }
  ];
  if (answerType === "proficiency") return [
    { id: "proficient", label: "熟练", value: "熟练" },
    { id: "familiar", label: "熟悉", value: "熟悉" },
    { id: "aware", label: "了解", value: "了解" },
    { id: "learning", label: "正在学习", value: "正在学习" },
    { id: "none", label: "没有", value: "没有" },
    { id: "uncertain", label: "不确定", value: "不确定" },
    { id: "skip", label: "跳过", value: "跳过" }
  ];
  return [
    { id: "none", label: "没有", value: "没有" },
    { id: "uncertain", label: "不确定", value: "不确定" },
    { id: "skip", label: "跳过", value: "跳过" }
  ];
}

function isEvidenceFirstQuestion(value: string) {
  return /(?:评估|评价|检查|纠错|复盘|失败|限制|验证|规划|拆解|复杂任务|多约束|帮助模型|提升回答|改进输出|检索方向|工作流|排查原因)/iu.test(value);
}

function resolveConfirmedClaimText(claim: TailoringClaim, confirmation: ClaimConfirmation) {
  if (confirmation.editedText) return confirmation.editedText;
  if (claim.finalTextByProficiency && confirmation.proficiency) return claim.finalTextByProficiency[confirmation.proficiency];
  if (!confirmation.proficiency) return claim.proposedText;
  const capability = claim.capability ?? pickProficiencyCapability(resolveCapabilityEntities({ keywords: claim.keywords }));
  if (!capabilityAllowsProficiency(capability)) return claim.proposedText;
  const tool = capability!.label;
  const textByLevel = {
    proficient: `熟练运用 ${tool} 完成相关任务、问题定位与结果交付。`,
    familiar: `熟悉 ${tool} 在相关任务中的使用、修改与问题定位流程。`,
    aware: `了解 ${tool} 等相关工具或方法的基本工作方式。`,
    learning: `正在学习 ${tool} 等相关工具或方法在真实任务中的应用。`
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
  allowDuplicate?: boolean;
}): Promise<TailoringServiceResult> {
  const result = input.source.type === "profile"
    ? await input.repository.createJobSpecificBranchFromProfile({
        profileId: input.source.profileId, jobId: input.job.id, operationId: input.operationId, name: input.name,
        selectedCanonicalItemIds: input.source.selectedCanonicalItemIds, requirementMatchIds: input.source.requirementMatchIds ?? []
      })
    : await input.repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: input.source.branch.id, jobId: input.job.id, expectedSourceRevision: input.source.branch.revision,
        expectedSourceRevisionId: input.source.branch.currentRevisionId ?? "", operationId: input.operationId, name: input.name,
        allowDuplicate: input.allowDuplicate
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
