"use client";

import { useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Sparkles, Square } from "lucide-react";
import { analyzeJobFit, answerTailoringClarification, applyTailoringPlan, confirmTailoringClaims, createTailoringPlan, validateTailoringSuggestions, withPlannerActions, withTailoringSuggestions } from "@/services/jobs/tailoringService";
import { invokeStructuredAi } from "@/ai/client";
import type {
  CareerProfile,
  ClaimConfirmation,
  JobDescription,
  ResumeBranch,
  ResumeTailoringPlan,
  TailoringClaim,
  TailoringIntensity,
  TailoringSuggestion
} from "@/domain/schemas";
import { ResumeTailorOutputSchema, ResumeTailorPlannerOutputSchema } from "@/domain/schemas";
import type { WorkspaceRepository } from "@/services/storage/repositories";
import { nanoid } from "nanoid";
import { capabilityAllowsProficiency, groupTailoringKeywords } from "@/domain/jobOptimization";

type TailoringView = "overview" | "clarification" | "suggestions" | "apply";

export function JobOptimizationPanel({
  repository,
  profile,
  jobs,
  branch,
  canEdit,
  onBranchReady,
  onMessage,
  showDebugPanel,
  setShowDebugPanel
}: {
  repository: WorkspaceRepository;
  profile?: CareerProfile;
  jobs: JobDescription[];
  branch?: ResumeBranch;
  selectedContentItemId?: string;
  canEdit: boolean;
  onJobCreated: (job: JobDescription) => void;
  onBranchReady: (branch: ResumeBranch) => void;
  onApplyStructureSuggestion: (kind: "reorder" | "hide" | "show", contentItemId: string) => void;
  onMessage: (message: string) => void;
  showDebugPanel: boolean;
  setShowDebugPanel: (value: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const [view, setView] = useState<TailoringView>("overview");
  const [intensity, setIntensity] = useState<TailoringIntensity>("balanced");
  const [plan, setPlan] = useState<ResumeTailoringPlan>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmations, setConfirmations] = useState<Record<string, ClaimConfirmation>>({});
  const [confirmationEdits, setConfirmationEdits] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState({ step: 0, completed: 0, skipped: 0, failed: 0 });
  const generationController = useRef<AbortController | undefined>(undefined);
  const [plannerAssessment, setPlannerAssessment] = useState<{ globalNotes?: string; direct: number; confirmable: number; clarification: number; materials: number; keep: number }>();
  const [activeQuestionId, setActiveQuestionId] = useState<string>();
  const [clarificationAnswer, setClarificationAnswer] = useState<string | string[] | boolean>("");
  const [answeredQuestionIds, setAnsweredQuestionIds] = useState<Set<string>>(new Set());
  const [fitDelta, setFitDelta] = useState<{ beforeScore: number; afterScore: number; newlyCovered: string[]; newKeywords: string[]; userDeclared: string[]; remaining: string[] }>();
  const [pendingTaskInputs, setPendingTaskInputs] = useState<unknown[]>([]);
  const [pendingBasePlan, setPendingBasePlan] = useState<ResumeTailoringPlan | undefined>();
  const [debugLogs, setDebugLogs] = useState<Array<{ timestamp: number; type: string; phase: string; data: unknown }>>([]);
  const [debugPanelPos, setDebugPanelPos] = useState({ x: window.innerWidth - 540, y: window.innerHeight - 500 });
  const [debugPanelSize, setDebugPanelSize] = useState({ width: 500, height: 400 });
  const debugPanelDragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const debugPanelResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const targetJob = useMemo(() => jobs.find((job) => job.id === branch?.jobId), [branch?.jobId, jobs]);

  function addDebugLog(type: string, phase: string, data: unknown) {
    setDebugLogs((prev) => [...prev, { timestamp: Date.now(), type, phase, data }]);
  }

  // 调试面板拖动处理
  function handleDebugPanelDragStart(e: React.MouseEvent) {
    e.preventDefault();
    debugPanelDragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: debugPanelPos.x, startPosY: debugPanelPos.y };
    const handleMouseMove = (moveE: MouseEvent) => {
      if (!debugPanelDragRef.current) return;
      const dx = moveE.clientX - debugPanelDragRef.current.startX;
      const dy = moveE.clientY - debugPanelDragRef.current.startY;
      setDebugPanelPos({ x: debugPanelDragRef.current.startPosX + dx, y: debugPanelDragRef.current.startPosY + dy });
    };
    const handleMouseUp = () => {
      debugPanelDragRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }

  // 调试面板缩放处理
  function handleDebugPanelResizeStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    debugPanelResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: debugPanelSize.width, startH: debugPanelSize.height };
    const handleMouseMove = (moveE: MouseEvent) => {
      if (!debugPanelResizeRef.current) return;
      const dx = moveE.clientX - debugPanelResizeRef.current.startX;
      const dy = moveE.clientY - debugPanelResizeRef.current.startY;
      setDebugPanelSize({ width: Math.max(300, debugPanelResizeRef.current.startW + dx), height: Math.max(200, debugPanelResizeRef.current.startH + dy) });
    };
    const handleMouseUp = () => {
      debugPanelResizeRef.current = null;
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }
  const analysis = useMemo(() => profile && branch && targetJob ? analyzeJobFit({ profile, branch, job: targetJob }) : undefined, [profile, branch, targetJob]);

  if (!profile || !branch || !targetJob) {
    return <section className="optimization-panel studio-subpanel" data-testid="job-optimization-panel"><div className="warning-box">请先从岗位页创建并打开一份岗位简历。</div></section>;
  }
  const activeProfile = profile;
  const activeBranch = branch;
  const activeJob = targetJob;

  const report = analysis?.report;
  const claims = (plan?.claims ?? []).filter((claim) => normalizeDiffText(claim.currentText) !== normalizeDiffText(claim.proposedText));
  const suggestionsById = new Map((plan?.suggestions ?? []).map((suggestion) => [suggestion.id, suggestion]));
  const selectedClaims = claims.filter((claim) => selected.has(claim.id));
  const completedQuestionIds = new Set([
    ...answeredQuestionIds,
    ...(plan?.clarificationAnswers ?? []).map((record) => record.questionId)
  ]);
  const allQuestions = plan?.clarificationQuestions ?? [];
  const unansweredQuestions = allQuestions.filter((question) => !completedQuestionIds.has(question.id));
  const activeQuestion = unansweredQuestions.find((question) => question.id === activeQuestionId) ?? unansweredQuestions[0];
  const activeQuestionPosition = activeQuestion ? allQuestions.findIndex((question) => question.id === activeQuestion.id) + 1 : 0;
  const confirmationCount = selectedClaims.filter((claim) => claim.decision === "requires_confirmation").length;
  const keywordGroups = groupTailoringKeywords(selectedClaims.flatMap((claim) => claim.keywords));
  const keywordCount = keywordGroups.core.length + keywordGroups.confirmableTools.length;
  const hiddenCount = selectedClaims.filter((claim) => claim.section === "ordering" && /隐藏/.test(claim.reason)).length;
  const conflictingClaimIds = duplicateFinalTextClaimIds(selectedClaims, confirmations);

  async function generatePlan() {
    if (activeBranch.tailoringAppliedCount) {
      const proceed = window.confirm(`此简历已优化过 ${activeBranch.tailoringAppliedCount} 次，是否继续重新优化？`);
      if (!proceed) return;
    }
    generationController.current?.abort();
    const controller = new AbortController();
    generationController.current = controller;
    setPending(true);
    setProgress({ step: 1, completed: 0, skipped: 0, failed: 0 });
    setPlannerAssessment(undefined);
    setAnsweredQuestionIds(new Set());
    setClarificationAnswer("");
    setActiveQuestionId(undefined);
    setView("suggestions");
    try {
      const result = createTailoringPlan({ profile: activeProfile, branch: activeBranch, job: activeJob, intensity, operationId: `plan-${activeBranch.id}-${activeBranch.revision}-${activeJob.id}` });
      const taskInputs = result.taskInputs ?? [];
      if (!taskInputs.length) {
        onMessage("简历内容较少，无需改写。");
        setPlan(result.plan);
        return;
      }

      // --- Phase 1: 全局评估 ---
      const plannerInput = {
        jobContext: result.plan?.jobContext ?? { title: activeJob.title, rawText: activeJob.rawText },
        requirements: activeJob.requirements.map((r) => ({ id: r.id, description: r.description, priority: r.priority, category: r.category, keywords: r.keywords })),
        sections: taskInputs.map((t) => ({ sectionType: t.target.sectionType, itemId: t.target.itemId ?? "", currentText: typeof t.currentContent.fieldValue === "string" ? t.currentContent.fieldValue : t.currentContent.fieldValue.join("；"), relevantRequirementIds: t.relevantRequirements.map((r) => r.requirementId) }))
      };
      addDebugLog("request", "planner", { input: plannerInput });
      const plannerResponse = await invokeStructuredAi({ task: "resume-optimization-planner", businessInput: plannerInput, outputSchema: ResumeTailorPlannerOutputSchema, signal: controller.signal });
      addDebugLog("response", "planner", { ok: plannerResponse.ok, data: plannerResponse.ok ? plannerResponse.data : plannerResponse.errorCode, log: plannerResponse.log });
      await repository.saveAiLogs([plannerResponse.log]);

      const rewriteIds = new Set<string>();
      let basePlan = result.plan;
      if (plannerResponse.ok) {
        basePlan = result.plan ? withPlannerActions({ plan: result.plan, assessments: plannerResponse.data.assessments }) : undefined;
        const actions = basePlan?.plannerActions ?? [];
        actions.filter((item) => item.action === "verified_rewrite").forEach((item) => rewriteIds.add(item.itemId));
        setPlannerAssessment({
          globalNotes: plannerResponse.data.globalNotes,
          direct: actions.filter((item) => item.action === "verified_rewrite").length,
          confirmable: actions.filter((item) => item.action === "confirmable_rewrite").length,
          clarification: actions.filter((item) => item.action === "clarification_required").length,
          materials: (basePlan?.materialTasks?.length ?? 0) + actions.filter((item) => item.action === "material_task").length,
          keep: actions.filter((item) => item.action === "keep" || item.action === "deprioritize").length
        });
      } else {
        taskInputs.forEach((item) => rewriteIds.add(item.target.itemId ?? item.target.sectionId));
        const failure = plannerFailureMessage(plannerResponse.errorCode);
        setPlannerAssessment({ globalNotes: `${failure} 已切换为基于已确认事实的安全改写。`, direct: taskInputs.length, confirmable: 0, clarification: 0, materials: result.plan?.materialTasks?.length ?? 0, keep: 0 });
        onMessage(failure);
      }
      setPlan(basePlan);
      setProgress((current) => ({ ...current, step: 2, skipped: taskInputs.length - rewriteIds.size }));

      // --- 检查是否需要先问问题 ---
      const hasClarificationQuestions = (basePlan?.clarificationQuestions?.length ?? 0) > 0;
      if (hasClarificationQuestions) {
        // 存储状态，等用户回答完再继续
        setPendingTaskInputs(taskInputs);
        setPendingBasePlan(basePlan);
        setView("clarification");
        setPending(false);
        onMessage("AI 发现一些不确定的地方，需要你先回答几个问题。");
        return;
      }

      // --- Phase 2: 仅对可改写片段发送改写请求 ---
      const generated: TailoringSuggestion[] = [];
      const allRejectedReasons: string[] = [];
      const rewriteInputs = taskInputs.filter((t) => rewriteIds.has(t.target.itemId ?? t.target.sectionId));
      addDebugLog("info", "phase2", { rewriteIdsCount: rewriteIds.size, rewriteInputsCount: rewriteInputs.length, taskInputsCount: taskInputs.length });
      setProgress((current) => ({ ...current, step: 3 }));
      const batchSize = Math.ceil(rewriteInputs.length / Math.min(2, rewriteInputs.length || 1));
      const batches = Array.from({ length: Math.ceil(rewriteInputs.length / batchSize) }, (_, index) => rewriteInputs.slice(index * batchSize, (index + 1) * batchSize));
      for (const batch of batches) {
        if (controller.signal.aborted) break;
        const first = batch[0];
        const batchInput = {
          draftId: first.draftId, profileId: first.profileId, jobId: first.jobId, intensity: first.intensity,
          compactJobContext: {
            title: first.jobContext.title, roleMission: first.jobContext.roleMission,
            topResponsibilities: first.jobContext.responsibilities.slice(0, 4), targetKeywords: first.jobContext.keywords.slice(0, 16)
          },
          targets: batch.map((request) => ({
            itemId: request.target.itemId ?? request.target.sectionId, sectionType: request.target.sectionType, sectionId: request.target.sectionId, fieldPath: request.target.fieldPath,
            structuredItem: request.currentContent.structuredItem, before: request.currentContent.fieldValue, renderedText: request.currentContent.renderedText,
            relevantRequirements: request.relevantRequirements.slice(0, 4), allowedEvidenceRefs: request.allowedEvidenceRefs, allowedFacts: request.allowedFacts,
            currentSectionContext: taskInputs.filter((item) => item.target.sectionType === request.target.sectionType).map((item) => item.currentContent.renderedText).slice(0, 6),
            evidenceBundle: request.evidenceBundle
          }))
        };
        addDebugLog("request", "tailor-batch", { batchIndex: batches.indexOf(batch), targetsCount: batchInput.targets.length, targets: batchInput.targets.map(t => ({ itemId: t.itemId, sectionType: t.sectionType, beforePreview: String(t.before).slice(0, 100) })) });
        const response = await invokeStructuredAi({
          task: "resume-tailor-batch",
          businessInput: batchInput,
          outputSchema: ResumeTailorOutputSchema,
          signal: controller.signal
        });
        addDebugLog("response", "tailor-batch", { batchIndex: batches.indexOf(batch), ok: response.ok, data: response.ok ? { suggestionsCount: response.data.suggestions.length, suggestions: response.data.suggestions.map(s => ({ id: s.id, afterPreview: String(s.after).slice(0, 150) })) } : (response as { errorCode?: string }).errorCode, rawLog: response.log });
        await repository.saveAiLogs([response.log]);
        const validated = response.ok ? validateTailoringSuggestions({ suggestions: response.data.suggestions }) : undefined;
        if (validated?.suggestions.length) generated.push(...validated.suggestions);
        else if (validated?.rejected.length) allRejectedReasons.push(...validated.rejected.flatMap((r) => r.reasons));
        else allRejectedReasons.push(response.ok ? "empty_suggestions" : (response as { errorCode?: string }).errorCode ?? "provider_error");
        if (validated?.rejected.length) addDebugLog("rejected", "validation", { rejected: validated.rejected.map(r => ({ reasons: r.reasons, afterPreview: String(r.suggestion.after).slice(0, 100) })) });
        setProgress((current) => ({ ...current, completed: current.completed + (validated?.suggestions.length ?? 0), failed: current.failed + Math.max(0, batch.length - (validated?.suggestions.length ?? 0)) }));
        const partialPlan = basePlan ? withTailoringSuggestions({ plan: basePlan, suggestions: generated, invalidOutputCodes: [] }) : undefined;
        setPlan(partialPlan);
        setSelected(new Set(partialPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      }

      const nextPlan = basePlan ? withTailoringSuggestions({ plan: basePlan, suggestions: generated, invalidOutputCodes: allRejectedReasons.includes("no_change_needed") ? ["no_change_needed"] : ["invalid_ai_output"] }) : undefined;
      addDebugLog("summary", "complete", { generatedCount: generated.length, rejectedReasons: allRejectedReasons, finalClaimsCount: nextPlan?.claims.length ?? 0, finalSuggestionsCount: nextPlan?.suggestions?.length ?? 0 });
      setPlan(nextPlan);
      setSelected(new Set(nextPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      if (!generated.length && rewriteInputs.length === 0 && (nextPlan?.clarificationQuestions?.length ?? 0) > 0) onMessage("需要补充信息后才能生成部分建议。");
      else if (!generated.length && allRejectedReasons.length) onMessage(summarizeRejectionReasons(allRejectedReasons));
      else if (!generated.length) onMessage("AI 未能生成有效改写内容。");
    } catch (error) {
      if (controller.signal.aborted) {
        onMessage("已停止生成，已完成的建议会保留。");
        return;
      }
      onMessage(error instanceof Error ? `生成失败：${error.message}` : "AI 生成改写时出现异常，请稍后重试。");
    } finally { setPending(false); generationController.current = undefined; }
  }

  function updateConfirmation(claim: TailoringClaim, proficiency: ClaimConfirmation["proficiency"] | undefined, accepted = true, editedText?: string) {
    setConfirmations((current) => ({ ...current, [claim.id]: { claimId: claim.id, accepted, proficiency, editedText: accepted ? editedText : undefined, syncScope: accepted ? "resume_only" : "rejected" } }));
  }

  function submitClarificationAnswer() {
    const question = activeQuestion;
    if (!plan || !question || clarificationAnswer === "" || (Array.isArray(clarificationAnswer) && !clarificationAnswer.length)) return;
    const proficiency = question.answerType === "proficiency" ? ({ "熟练使用": "proficient", "熟悉基础": "familiar", "了解": "aware", "正在学习": "learning" } as const)[String(clarificationAnswer) as "熟练使用" | "熟悉基础" | "了解" | "正在学习"] : undefined;
    const next = answerTailoringClarification({ plan, question, answer: clarificationAnswer, proficiency, branch: activeBranch });
    const newIds = next.claims.filter((claim) => !plan.claims.some((existing) => existing.id === claim.id)).map((claim) => claim.id);
    if (!newIds.length && clarificationAnswer !== false && clarificationAnswer !== "没有使用") {
      onMessage("未能为这个回答找到安全的写入字段，请返回简历补充对应条目后重试。");
      return;
    }
    setPlan(next);
    setSelected((current) => new Set([...current, ...newIds]));
    setAnsweredQuestionIds((current) => new Set([...current, question.id]));
    setClarificationAnswer("");
    const nextQuestion = (next.clarificationQuestions ?? []).find((item) => item.id !== question.id && !completedQuestionIds.has(item.id));
    setActiveQuestionId(nextQuestion?.id);
    onMessage(newIds.length ? '已根据回答生成候选句，请在"确认后可加入"中核对。' : "已记录为不添加该能力。");

    // 检查是否还有更多问题，如果没有则自动继续生成建议
    const remainingQuestions = (next.clarificationQuestions ?? []).filter((q) => !answeredQuestionIds.has(q.id) && q.id !== question.id);
    if (remainingQuestions.length === 0 && pendingBasePlan && pendingTaskInputs.length) {
      // 所有问题已回答，自动继续生成建议
      setTimeout(() => { void continueToSuggestions(); }, 500);
    }
  }

  async function continueToSuggestions() {
    if (!pendingTaskInputs.length) return;
    const controller = new AbortController();
    generationController.current = controller;
    setPending(true);
    setProgress({ step: 2, completed: 0, skipped: 0, failed: 0 });
    setView("suggestions");
    try {
      // 使用更新后的 plan（包含用户回答），而不是原始的 pendingBasePlan
      const basePlan = plan ?? pendingBasePlan;
      const taskInputs = pendingTaskInputs as Array<{ target: { sectionType: string; sectionId: string; itemId?: string; fieldPath: string }; currentContent: { fieldValue: string | string[]; renderedText: string; structuredItem: unknown }; relevantRequirements: Array<{ requirementId: string }>; allowedEvidenceRefs: unknown[]; allowedFacts: unknown[]; evidenceBundle: unknown; draftId: string; profileId: string; jobId: string; intensity: TailoringIntensity; jobContext: { title: string; roleMission?: string; responsibilities: string[]; keywords: string[] } }>;
      const rewriteIds = new Set<string>();
      (basePlan?.plannerActions ?? []).filter((item) => item.action === "verified_rewrite").forEach((item) => rewriteIds.add(item.itemId));
      addDebugLog("info", "continue", { hasUpdatedPlan: !!plan, rewriteIdsCount: rewriteIds.size, clarifiedQuestionsCount: answeredQuestionIds.size });

      // --- Phase 2: 仅对可改写片段发送改写请求 ---
      const generated: TailoringSuggestion[] = [];
      const allRejectedReasons: string[] = [];
      const rewriteInputs = taskInputs.filter((t) => rewriteIds.has(t.target.itemId ?? t.target.sectionId));
      addDebugLog("info", "phase2-continue", { rewriteInputsCount: rewriteInputs.length });
      setProgress((current) => ({ ...current, step: 3 }));
      const batchSize = Math.ceil(rewriteInputs.length / Math.min(2, rewriteInputs.length || 1));
      const batches = Array.from({ length: Math.ceil(rewriteInputs.length / batchSize) }, (_, index) => rewriteInputs.slice(index * batchSize, (index + 1) * batchSize));
      for (const batch of batches) {
        if (controller.signal.aborted) break;
        const first = batch[0];
        const batchInput = {
          draftId: first.draftId, profileId: first.profileId, jobId: first.jobId, intensity: first.intensity,
          compactJobContext: {
            title: first.jobContext.title, roleMission: first.jobContext.roleMission,
            topResponsibilities: first.jobContext.responsibilities.slice(0, 4), targetKeywords: first.jobContext.keywords.slice(0, 16)
          },
          targets: batch.map((request) => ({
            itemId: request.target.itemId ?? request.target.sectionId, sectionType: request.target.sectionType, sectionId: request.target.sectionId, fieldPath: request.target.fieldPath,
            structuredItem: request.currentContent.structuredItem, before: request.currentContent.fieldValue, renderedText: request.currentContent.renderedText,
            relevantRequirements: request.relevantRequirements.slice(0, 4), allowedEvidenceRefs: request.allowedEvidenceRefs, allowedFacts: request.allowedFacts,
            currentSectionContext: taskInputs.filter((item) => item.target.sectionType === request.target.sectionType).map((item) => item.currentContent.renderedText).slice(0, 6),
            evidenceBundle: request.evidenceBundle
          }))
        };
        addDebugLog("request", "tailor-batch-continue", { batchIndex: batches.indexOf(batch), targetsCount: batchInput.targets.length });
        const response = await invokeStructuredAi({
          task: "resume-tailor-batch",
          businessInput: batchInput,
          outputSchema: ResumeTailorOutputSchema,
          signal: controller.signal
        });
        addDebugLog("response", "tailor-batch-continue", { batchIndex: batches.indexOf(batch), ok: response.ok, data: response.ok ? { suggestionsCount: response.data.suggestions.length } : (response as { errorCode?: string }).errorCode });
        await repository.saveAiLogs([response.log]);
        const validated = response.ok ? validateTailoringSuggestions({ suggestions: response.data.suggestions }) : undefined;
        if (validated?.suggestions.length) generated.push(...validated.suggestions);
        else if (validated?.rejected.length) allRejectedReasons.push(...validated.rejected.flatMap((r) => r.reasons));
        else allRejectedReasons.push(response.ok ? "empty_suggestions" : (response as { errorCode?: string }).errorCode ?? "provider_error");
        if (validated?.rejected.length) addDebugLog("rejected", "validation-continue", { rejected: validated.rejected.map(r => ({ reasons: r.reasons })) });
        setProgress((current) => ({ ...current, completed: current.completed + (validated?.suggestions.length ?? 0), failed: current.failed + Math.max(0, batch.length - (validated?.suggestions.length ?? 0)) }));
        const partialPlan = basePlan ? withTailoringSuggestions({ plan: basePlan, suggestions: generated, invalidOutputCodes: [] }) : undefined;
        setPlan(partialPlan);
        setSelected(new Set(partialPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      }

      const nextPlan = basePlan ? withTailoringSuggestions({ plan: basePlan, suggestions: generated, invalidOutputCodes: allRejectedReasons.includes("no_change_needed") ? ["no_change_needed"] : ["invalid_ai_output"] }) : undefined;
      addDebugLog("summary", "complete-continue", { generatedCount: generated.length, rejectedReasons: allRejectedReasons, finalClaimsCount: nextPlan?.claims.length ?? 0 });
      setPlan(nextPlan);
      setSelected(new Set(nextPlan?.claims.filter((claim) => claim.decision !== "blocked").map((claim) => claim.id)));
      if (!generated.length && allRejectedReasons.length) onMessage(summarizeRejectionReasons(allRejectedReasons));
      else if (!generated.length) onMessage("AI 未能生成有效改写内容。");
    } catch (error) {
      if (controller.signal.aborted) {
        onMessage("已停止生成，已完成的建议会保留。");
        return;
      }
      onMessage(error instanceof Error ? `生成失败：${error.message}` : "AI 生成改写时出现异常，请稍后重试。");
    } finally {
      setPending(false);
      generationController.current = undefined;
      setPendingTaskInputs([]);
      setPendingBasePlan(undefined);
    }
  }

  async function applySelected() {
    if (!plan || !activeBranch.currentRevisionId) return;
    if (conflictingClaimIds.size) {
      onMessage("存在相同最终句写入多个位置的冲突，请调整或取消重复项后再应用。");
      return;
    }
    setPending(true);
    try {
      const deselected: ClaimConfirmation[] = claims.filter((claim) => !selected.has(claim.id)).map((claim) => ({ claimId: claim.id, accepted: false, syncScope: "rejected" }));
      const confirmed = confirmTailoringClaims({ plan, confirmations: [...Object.values(confirmations), ...deselected] });
      if (confirmed.status === "needs_confirmation") {
        setPlan(confirmed.plan);
        onMessage("请先确认所有推导项和新增能力，或选择暂不添加。");
        return;
      }
      const result = await applyTailoringPlan({
        plan: confirmed.plan!,
        operationId: `apply-tailoring-${confirmed.plan!.id}-${nanoid(8)}`,
        apply: async ({ plan: confirmedPlan, operationId }) => {
          const saved = await repository.applyTailoringPlan({ plan: confirmedPlan, operationId, expectedBranchRevision: activeBranch.revision, expectedRevisionId: activeBranch.currentRevisionId! });
          const afterReport = analyzeJobFit({ profile: activeProfile, branch: saved.branch, job: activeJob }).report!;
          const beforeCovered = new Set(report?.coveredRequirementIds ?? []);
          setFitDelta({
            beforeScore: report?.overallCoverage ?? 0,
            afterScore: afterReport.overallCoverage,
            newlyCovered: afterReport.coveredRequirementIds.filter((id) => !beforeCovered.has(id)).map((id) => requirementText(activeJob, id)),
            newKeywords: newlyAppliedKeywords(confirmedPlan.claims, activeBranch, saved.branch),
            userDeclared: confirmedPlan.claims.filter((claim) => claim.supportLevel === "user_declared" && claim.syncScope !== "rejected").map((claim) => claim.label ?? claim.claimText ?? claim.proposedText),
            remaining: afterReport.uncoveredRequirementDescriptions
          });
          onBranchReady(saved.branch);
          return { branchId: saved.branch.id, revisionId: saved.revision?.id ?? saved.branch.currentRevisionId! };
        }
      });
      onMessage(result.summary);
    } catch (error) {
      const message = error instanceof Error ? error.message : "应用岗位定制失败，请重试。";
      onMessage(message);
    } finally { setPending(false); }
  }

  return (
    <>
    <section className="optimization-panel tailoring-panel studio-subpanel" data-testid="job-optimization-panel" aria-label="AI 岗位优化">
      <nav className="tailoring-view-tabs" aria-label="岗位定制步骤">
        {(["overview", "clarification", "suggestions", "apply"] as const).map((item, index) => <button key={item} type="button" className={view === item ? "inspector-tab inspector-tab-active" : "inspector-tab"} onClick={() => setView(item)} disabled={item !== "overview" && !plan}>{index + 1} {viewLabel(item)}</button>)}
      </nav>

      {view === "overview" ? <div className="tailoring-page" data-testid="tailoring-overview">
        <header className="tailoring-hero">
          <div><span>{activeJob.company}</span><h2>{activeJob.title}</h2><p>岗位适配度，不代表 ATS 通过率或录取概率</p></div>
          <strong aria-label="岗位适配度">{report?.overallCoverage ?? 0}</strong>
        </header>
        {activeBranch.tailoringAppliedCount ? <div className="info-box" style={{ marginBottom: "0.5rem" }}><span>✅ 此简历已优化 {activeBranch.tailoringAppliedCount} 次，再次优化将基于当前内容重新生成建议。</span></div> : null}
        <label className="field-label">推荐改写力度
          <select value={intensity} onChange={(event) => setIntensity(event.target.value as TailoringIntensity)}>
            <option value="conservative">保守对齐</option><option value="balanced">平衡强化</option><option value="proactive">主动定向</option>
          </select>
        </label>
        <div className="tailoring-score-grid">
          {report ? Object.entries(report.subScores).map(([key, score]) => <div key={key}><span>{scoreLabel(key)}</span><strong>{score}</strong></div>) : null}
        </div>
        <ResultList title="你的优势" items={(report?.coveredRequirementDescriptions ?? []).slice(0, 4).map((description) => `匹配能力：${description}`)} empty="暂未识别到可直接证明的岗位优势" />
        <ResultList title="主要缺口" items={(report?.uncoveredRequirementDescriptions ?? []).slice(0, 4).map((description) => `尚无直接证据：${description}`)} empty="暂未发现明显缺口" />
        <div className="info-box"><strong>推荐策略</strong><p>{strategyCopy(intensity)}</p></div>
        <button className="primary-button" type="button" disabled={pending || !canEdit} onClick={() => { void generatePlan(); }}><Sparkles size={16} />生成改写建议</button>
      </div> : null}

      {view === "clarification" ? <div className="tailoring-page" data-testid="tailoring-clarification">
        <div className="section-heading compact-heading"><div><h2>补充信息</h2><p>AI 发现一些不确定的地方，需要你先回答几个问题，这样改写建议会更准确。</p></div></div>
        {plannerAssessment ? <div className="info-box" style={{ marginBottom: "0.75rem" }}>
          <strong>AI 评估结果</strong>
          <p>{plannerAssessment.globalNotes ?? "已完成匹配分析。"}</p>
          <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-secondary, #666)" }}>
            可直接改写 {plannerAssessment.direct} 项 · 确认后可加入 {plannerAssessment.confirmable} 项 · 需要回答 {plannerAssessment.clarification} 项 · 建议准备材料 {plannerAssessment.materials} 项 · 保持不变 {plannerAssessment.keep} 项
          </p>
        </div> : null}
        {activeQuestion ? <section className="tailoring-suggestion-group"><h3>需要你回答</h3><p>一次只展开一个问题；否定回答会被记录，且不会重复询问。</p><article key={activeQuestion.id} className="tailoring-suggestion-card"><div className="tailoring-question-progress"><strong>问题 {activeQuestionPosition} / {allQuestions.length}</strong><span>已完成 {completedQuestionIds.size}</span><span>剩余 {unansweredQuestions.length}</span></div><strong>{activeQuestion.question}</strong>{activeQuestion.answerType === "proficiency" ? <div className="chip-row" aria-label="选择真实熟练度">{["熟练使用", "熟悉基础", "了解", "正在学习", "没有使用"].map((option) => <button type="button" key={option} className={clarificationAnswer === option ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => setClarificationAnswer(option)}>{option}</button>)}</div> : activeQuestion.answerType === "boolean" ? <div className="chip-row">{["有", "没有"].map((option) => <button type="button" key={option} className={clarificationAnswer === (option === "有") ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => setClarificationAnswer(option === "有")}>{option}</button>)}</div> : activeQuestion.answerType === "multi_select" ? <div className="chip-row" aria-label="选择适用项">{["Cursor", "Claude Code", "Codex", "Windsurf", "其他"].map((option) => <button type="button" key={option} className={Array.isArray(clarificationAnswer) && clarificationAnswer.includes(option) ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => setClarificationAnswer((current) => { const values = Array.isArray(current) ? current : []; return values.includes(option) ? values.filter((value) => value !== option) : [...values, option]; })}>{option}</button>)}</div> : <label className="field-label" htmlFor={`clarification-${activeQuestion.id}`}>{activeQuestion.answerType === "url" ? "链接" : "你的回答"}<input id={`clarification-${activeQuestion.id}`} name={`clarification-${activeQuestion.id}`} type={activeQuestion.answerType === "url" ? "url" : "text"} autoComplete="off" value={typeof clarificationAnswer === "string" ? clarificationAnswer : ""} onChange={(event) => setClarificationAnswer(event.target.value)} /></label>}<button type="button" className="primary-button" onClick={submitClarificationAnswer}>提交回答</button></article></section> : <div className="info-box" aria-live="polite"><strong>所有问题已回答完毕</strong><p>现在可以继续生成改写建议了。</p></div>}
        <div className="action-row">
          <button className="secondary-button" onClick={() => { setPlan(undefined); setPlannerAssessment(undefined); setSelected(new Set()); setPendingTaskInputs([]); setPendingBasePlan(undefined); setView("overview"); }}>弃用建议</button>
          <button className="secondary-button" onClick={() => setView("overview")}><ChevronLeft size={16} />返回概览</button>
          <button className="primary-button" disabled={unansweredQuestions.length > 0} onClick={() => { void continueToSuggestions(); }}>继续生成改写建议</button>
        </div>
      </div> : null}

      {view === "suggestions" ? <div className="tailoring-page" data-testid="tailoring-suggestions">
        <div className="section-heading compact-heading"><div><h2>改写建议</h2><p>可直接采用的建议已选中，需要确认的内容集中在下一步处理。</p></div><button className="secondary-button compact" onClick={() => setSelected(new Set(claims.filter((claim) => claim.decision === "auto_applicable").map((claim) => claim.id)))}>采用全部可直接应用建议</button></div>
        {plannerAssessment ? <div className="info-box" style={{ marginBottom: "0.75rem" }}>
          <strong>AI 评估结果</strong>
          <p>{plannerAssessment.globalNotes ?? "已完成匹配分析。"}</p>
          <p style={{ marginTop: "0.25rem", fontSize: "0.85rem", color: "var(--color-text-secondary, #666)" }}>
            可直接改写 {plannerAssessment.direct} 项 · 确认后可加入 {plannerAssessment.confirmable} 项 · 需要回答 {plannerAssessment.clarification} 项 · 建议准备材料 {plannerAssessment.materials} 项 · 保持不变 {plannerAssessment.keep} 项
          </p>
        </div> : null}
        {suggestionStatusGroups(claims.slice(0, 5)).map(([group, items]) => <section key={group} className="tailoring-suggestion-group"><h3>{group}</h3>{items.map((claim) => { const suggestion = suggestionsById.get(claim.id); const groupedKeywords = groupTailoringKeywords(claim.keywords); return <article key={claim.id} className="tailoring-suggestion-card">
          <div className="tailoring-suggestion-status"><span>{decisionLabel(claim)}</span><input type="checkbox" aria-label="采用建议" checked={selected.has(claim.id)} disabled={claim.decision === "blocked"} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(claim.id); else next.delete(claim.id); return next; })} /></div>
          <header className="tailoring-suggestion-title"><strong>{claim.label ?? sectionLabel(claim.section)}</strong><span>{fieldLocationLabel(claim)}</span></header>
          <div className="tailoring-suggestion-comparison"><p><strong>完整原文：</strong>{renderFieldValue(claim.originalValue ?? claim.currentText)}</p><p><strong>完整改写后：</strong>{renderFieldValue(claim.suggestedValue ?? claim.claimText ?? claim.proposedText)}</p></div>
          <p className="tailoring-suggestion-reason"><strong>修改原因：</strong>{claim.reason}</p>
          <details className="tailoring-suggestion-details"><summary>查看详细差异与依据</summary><div className="inline-diff"><FieldDiff before={claim.originalValue ?? claim.currentText} after={claim.suggestedValue ?? claim.claimText ?? claim.proposedText} /></div><div className="tailoring-suggestion-meta"><p><strong>完整当前条目：</strong>{currentItemText(activeBranch, claim)}</p><p><strong>岗位要求：</strong>{(claim.requirementIds ?? []).map((id) => requirementText(activeJob, id)).join("、") || "对应岗位要求"}</p><p><strong>EvidenceRefs：</strong>{claim.evidenceRefs.length ? `${claim.evidenceRefs.length} 条已确认事实证据` : "当前岗位简历中的用户确认内容"}</p><p><strong>Requirement IDs：</strong>{(claim.requirementIds ?? []).join("、") || "无"}</p><p><strong>风险：</strong>{suggestion?.riskLevel === "low" ? "低" : suggestion?.riskLevel === "high" ? "高" : "中，需确认"}</p>{groupedKeywords.core.length ? <div className="keyword-phrase"><strong>核心岗位词：</strong>{groupedKeywords.core.join("、")}</div> : null}{groupedKeywords.confirmableTools.length ? <div className="keyword-phrase"><strong>需确认工具：</strong>{groupedKeywords.confirmableTools.join("、")}</div> : null}{groupedKeywords.materials.length ? <div className="keyword-phrase"><strong>材料要求：</strong>{groupedKeywords.materials.join("、")}</div> : null}</div></details>
        </article>; })}</section>)}
        {claims.length > 5 ? <details className="tailoring-suggestion-details"><summary>更多建议（{claims.length - 5}）</summary><div className="tailoring-suggestion-meta">{claims.slice(5).map((claim) => <p key={claim.id}><strong>{fieldLocationLabel(claim)}：</strong>{claim.reason}</p>)}</div></details> : null}
        {plan?.materialTasks?.length ? <ResultList title={`申请前建议准备 ${plan.materialTasks.length} 项材料`} items={plan.materialTasks.map((item) => item.label)} empty="暂无" /> : null}
        {pending ? <div className="info-box" aria-live="polite"><strong>{progress.step}/3 {progress.step === 1 ? "正在分析岗位要求" : progress.step === 2 ? "正在筛选需要改写的内容" : "正在生成并验证建议"}</strong><p>已完成 {progress.completed} 项　跳过 {progress.skipped} 项　失败 {progress.failed} 项</p><button className="secondary-button compact" type="button" onClick={() => generationController.current?.abort()}><Square size={14} aria-hidden="true" />停止生成</button></div> : null}
        {!claims.length && !pending ? <div className="info-box">{plan?.clarificationQuestions?.length ? "需要补充信息后才能生成部分建议。" : "没有生成可安全应用的具体文本；请检查岗位要求和已确认事实。"}</div> : null}
        <div className="action-row"><button className="secondary-button" onClick={() => { setPlan(undefined); setPlannerAssessment(undefined); setSelected(new Set()); setView("overview"); }}>弃用建议</button><button className="secondary-button" onClick={() => setView("overview")}><ChevronLeft size={16} />返回概览</button><button className="primary-button" onClick={() => setView("apply")}>确认并应用</button></div>
      </div> : null}

      {view === "apply" ? <div className="tailoring-page" data-testid="tailoring-apply">
        <h2>确认并应用</h2>
        <div className="tailoring-apply-summary"><span>将修改 <strong>{selectedClaims.length}</strong> 处</span><span>新增关键词 <strong>{keywordCount}</strong> 个</span><span>隐藏 <strong>{hiddenCount}</strong> 项</span><span>需确认 <strong>{confirmationCount}</strong> 项</span><span>当前岗位适配度 <strong>{report?.overallCoverage ?? 0}</strong></span></div>
        {selectedClaims.length ? <section className="tailoring-suggestion-group"><h3>本次真正写入的数据</h3>{selectedClaims.map((claim) => { const patch = claim.targetPatches?.at(-1); const finalText = finalTextForClaim(claim, confirmations[claim.id]); return <article key={claim.id} className="tailoring-suggestion-card"><header className="tailoring-suggestion-title"><strong>{fieldLocationLabel(claim)}</strong><span>{patch?.fieldPath ?? claim.targetFieldPath ?? "text"} · {patch?.operation ?? "replace"}</span></header><div className="tailoring-confirmation-context"><p><span>原简历内容</span><strong>{renderFieldValue(claim.originalValue ?? patch?.before ?? claim.currentText)}</strong></p><p><span>AI 建议内容</span><strong>{renderFieldValue(claim.suggestedValue ?? patch?.after ?? claim.proposedText)}</strong></p><p><span>用户确认后的最终内容</span><strong>{finalText}</strong></p><p><span>修改位置</span>{fieldLocationLabel(claim)}</p><p><span>修改原因</span>{claim.reason}</p><p><span>覆盖要求</span>{(claim.requirementIds ?? []).map((id) => requirementText(activeJob, id)).join("、") || "无"}</p><p><span>依据</span>{claim.evidenceRefs.length ? `${claim.evidenceRefs.length} 条已确认事实证据` : "用户本轮确认"}</p><p><span>保存范围</span>仅用于当前岗位简历</p></div>{conflictingClaimIds.has(claim.id) ? <div className="warning-box" role="alert">相同最终句还指向其他位置，必须先解决冲突。</div> : null}</article>; })}</section> : null}
        {fitDelta ? <div className="info-box tailoring-fit-delta" aria-live="polite"><strong>岗位适配度：{fitDelta.beforeScore} → {fitDelta.afterScore}</strong><p>新覆盖要求：{fitDelta.newlyCovered.join("、") || "无新增"}</p><p>新关键词：{fitDelta.newKeywords.join("、") || "无新增"}</p><p>用户声明能力：{fitDelta.userDeclared.join("、") || "无"}</p><p>仍缺失要求：{fitDelta.remaining.join("、") || "无"}</p></div> : null}
        {selectedClaims.filter((claim) => claim.decision === "requires_confirmation").length ? <section className="tailoring-confirmations"><h3>待确认能力与表达</h3>{selectedClaims.filter((claim) => claim.decision === "requires_confirmation").map((claim) => { const confirmation = confirmations[claim.id]; const finalText = finalTextForClaim(claim, confirmation); const isProficiencyClaim = capabilityAllowsProficiency(claim.capability) && Boolean(claim.finalTextByProficiency); const editText = confirmationEdits[claim.id] ?? claim.claimText ?? claim.proposedText; return <article key={claim.id} className="tailoring-confirmation-card">
          <strong>{claim.label ?? "确认岗位相关表达"}</strong>
          <div className="tailoring-confirmation-context"><p><span>原简历内容</span><strong>{renderFieldValue(claim.originalValue ?? claim.currentText)}</strong></p><p><span>AI 建议内容</span><strong>{renderFieldValue(claim.suggestedValue ?? claim.proposedText)}</strong></p><p><span>用户确认后的最终内容</span><strong aria-live="polite">{finalText}</strong></p><p><span>修改位置</span>{fieldLocationLabel(claim)}</p><p><span>修改原因</span>{claim.reason}</p><p><span>覆盖要求</span>{(claim.requirementIds ?? []).map((id) => requirementText(activeJob, id)).join("、") || "对应岗位要求"}</p><p><span>依据</span>{claim.evidenceRefs.length ? `${claim.evidenceRefs.length} 条已确认事实证据` : `用户确认 · 来源：${sourceItemsLabel(activeBranch, claim)}`}</p><p><span>保存范围</span>仅用于当前岗位简历</p></div>
          {isProficiencyClaim ? <div className="chip-row" aria-label="选择真实熟练度">{([['proficient','熟练使用'],['familiar','熟悉基础'],['aware','了解'],['learning','正在学习']] as const).map(([value, label]) => <button type="button" key={value} className={confirmation?.proficiency === value && confirmation.accepted ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, value)}>{label}</button>)}<button type="button" className={!confirmation?.accepted && confirmation?.syncScope === "rejected" ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, undefined, false)}>不添加</button></div> : <><label className="field-label" htmlFor={`claim-edit-${claim.id}`}>编辑最终句<textarea id={`claim-edit-${claim.id}`} value={editText} onChange={(event) => setConfirmationEdits((current) => ({ ...current, [claim.id]: event.target.value }))} /></label><div className="chip-row"><button type="button" className={confirmation?.accepted && !confirmation.editedText ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, undefined, true)}>确认采用</button><button type="button" className={confirmation?.editedText ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, undefined, true, editText)}>编辑后采用</button><button type="button" className={!confirmation?.accepted && confirmation?.syncScope === "rejected" ? "secondary-button compact property-tab-active" : "secondary-button compact"} onClick={() => updateConfirmation(claim, undefined, false)}>不采用</button></div></>}
          <small>保存范围：仅用于当前岗位简历</small>
        </article>; })}</section> : null}
        <div className="info-box"><strong>导出前检查</strong><p><Check size={14} /> 通过 / 有建议 / 需要处理将在保存后显示；它不会改变事实。</p></div>
        {!selectedClaims.length ? <div className="info-box"><strong>尚未选中任何修改</strong><p>请选择具体改写，或返回回答问题后生成确认项。</p><button type="button" className="secondary-button compact" onClick={() => setView("suggestions")}>返回回答问题</button></div> : null}
        <button className="primary-button" type="button" disabled={pending || !canEdit || selectedClaims.length === 0 || conflictingClaimIds.size > 0} onClick={() => { void applySelected(); }}>应用选择并保存新版本</button>
        <p className="muted-copy">来源通用简历和个人资料库默认不变。保存后会创建新版本，可以撤销。</p>
      </div> : null}

    </section>

    {/* 调试日志面板 - 可拖动、可缩放 */}
    {showDebugPanel ? <div data-testid="debug-panel" style={{
      position: "fixed",
      left: debugPanelPos.x,
      top: debugPanelPos.y,
      width: debugPanelSize.width,
      height: debugPanelSize.height,
      backgroundColor: "var(--color-background, #fff)",
      border: "1px solid var(--color-border, #e0e0e0)",
      borderRadius: "8px",
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      zIndex: 1000,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }}>
      <div
        style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border, #e0e0e0)", display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "move", userSelect: "none" }}
        onMouseDown={handleDebugPanelDragStart}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "16px" }}>AI 调试日志</h3>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--color-text-secondary, #666)" }}>拖动标题栏移动，拖动右下角缩放</p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button className="secondary-button compact" onClick={(e) => { e.stopPropagation(); setDebugLogs([]); }}>清空</button>
          <button className="secondary-button compact" onClick={(e) => { e.stopPropagation(); setShowDebugPanel(false); }}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
        {debugLogs.length === 0 ? <div className="info-box">暂无日志。点击“生成改写建议”后，AI 的请求和响应会显示在这里。</div> : null}
        {debugLogs.map((log, index) => <details key={index} open={index === debugLogs.length - 1} className="tailoring-suggestion-card" style={{ marginBottom: "8px" }}>
          <summary style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px" }}>
            <span>
              <span style={{ color: log.type === "request" ? "#2563eb" : log.type === "response" ? "#16a34a" : log.type === "rejected" ? "#d97706" : "#6b7280" }}>
                {log.type === "request" ? "📤" : log.type === "response" ? "📥" : log.type === "rejected" ? "⚠️" : "ℹ️"}
              </span>
              <span style={{ marginLeft: "6px", fontWeight: 600 }}>{log.phase}</span>
            </span>
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
          </summary>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: "11px", padding: "8px", margin: "0 8px 8px", background: "#f3f4f6", borderRadius: "4px", maxHeight: "300px", overflow: "auto" }}>
            {JSON.stringify(log.data, null, 2)}
          </pre>
        </details>)}
      </div>
      {/* 缩放手柄 */}
      <div
        style={{ position: "absolute", right: 0, bottom: 0, width: "16px", height: "16px", cursor: "nwse-resize", background: "linear-gradient(135deg, transparent 50%, var(--color-border, #ccc) 50%)" }}
        onMouseDown={handleDebugPanelResizeStart}
      />
    </div> : null}
    </>
  );
}

function ResultList({ title, items, empty }: { title: string; items: string[]; empty: string }) { return <section className="tailoring-result-list"><h3>{title}</h3><ul>{items.length ? items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>) : <li>{empty}</li>}</ul></section>; }
function viewLabel(view: TailoringView) { return ({ overview: "匹配概览", clarification: "补充信息", suggestions: "改写建议", apply: "确认并应用" } as const)[view]; }
function scoreLabel(key: string) { return ({ hardConstraints: "硬性条件", coreCompetencies: "核心能力", responsibilities: "职责匹配", preferredQualifications: "加分项", terminologyCoverage: "关键词覆盖" } as Record<string, string>)[key] ?? key; }
function sectionLabel(section: TailoringClaim["section"]) { return ({ summary: "自我评价", skills: "技能", project: "项目经历", work: "工作 / 实习经历", internship: "工作 / 实习经历", ordering: "排序与隐藏" } as Partial<Record<TailoringClaim["section"], string>>)[section] ?? "其他"; }
function strategyCopy(intensity: TailoringIntensity) { return intensity === "conservative" ? "对齐关键词、压缩句子并调整顺序，不产生新能力陈述。" : intensity === "balanced" ? "用岗位语言重组真实经历；合理推导项集中确认后再应用。" : "更主动地重构相关内容并建议能力项；所有非直接依据内容都需确认。"; }
function decisionLabel(claim: TailoringClaim) { return claim.decision === "auto_applicable" ? "可直接采用" : claim.decision === "blocked" ? "不能添加硬事实" : claim.supportLevel === "reasonable_inference" ? "不建议但可确认" : "需要确认"; }
function requirementText(job: JobDescription, id: string) { return job.requirements.find((item) => item.id === id)?.description ?? "这项岗位要求暂未在简历中体现"; }
function suggestionStatusGroups(claims: TailoringClaim[]) {
  const groups = [
    ["可直接应用", (claim: TailoringClaim) => claim.decision === "auto_applicable" && claim.section !== "ordering"],
    ["确认后可加入", (claim: TailoringClaim) => claim.decision === "requires_confirmation" && claim.section !== "ordering"],
    ["保持不变 / 降低优先级", (claim: TailoringClaim) => claim.section === "ordering" || claim.decision === "blocked"]
  ] as const;
  return groups.map(([label, predicate]) => [label, claims.filter(predicate)] as const).filter(([, items]) => items.length);
}
function fieldLocationLabel(claim: TailoringClaim) {
  const field = claim.targetPatches?.at(-1)?.fieldPath ?? claim.targetFieldPath?.split(".").at(-1);
  return `${sectionLabel(claim.section)} · ${({ text: "正文", name: "技能名称", description: "描述", highlights: "亮点", visible: "显示状态", order: "排序" } as Record<string, string>)[field ?? ""] ?? "正文"}`;
}
function finalTextForClaim(claim: TailoringClaim, confirmation?: ClaimConfirmation) {
  if (!confirmation?.accepted) return claim.claimText ?? claim.proposedText;
  if (confirmation.editedText) return confirmation.editedText;
  if (confirmation.proficiency && claim.finalTextByProficiency) return claim.finalTextByProficiency[confirmation.proficiency];
  return claim.claimText ?? claim.proposedText;
}
function renderFieldValue(value: string | string[] | boolean | number) {
  return Array.isArray(value) ? value.join("\n") : String(value);
}
function duplicateFinalTextClaimIds(claims: TailoringClaim[], confirmations: Record<string, ClaimConfirmation>) {
  const firstByText = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const claim of claims) {
    const normalized = normalizeDiffText(finalTextForClaim(claim, confirmations[claim.id]));
    if (!normalized) continue;
    const first = firstByText.get(normalized);
    if (first) {
      conflicts.add(first);
      conflicts.add(claim.id);
    } else firstByText.set(normalized, claim.id);
  }
  return conflicts;
}
function sourceItemsLabel(branch: ResumeBranch, claim: TailoringClaim) {
  const ids = claim.sourceItemIds ?? (claim.targetContentItemId ? [claim.targetContentItemId] : []);
  const labels = ids.map((id) => {
    const structured = branch.structuredContentItems?.find((item) => item.id === id)?.data;
    if (structured?.sectionType === "project") return structured.title ?? id;
    if (structured && ["work", "internship"].includes(structured.sectionType)) return "organization" in structured ? structured.organization ?? structured.role ?? id : id;
    if (structured?.sectionType === "skills") return structured.name;
    return branch.contentItems.find((item) => item.id === id)?.text.split(/[；;。\n]/)[0] ?? id;
  });
  return labels.join("、") || "当前岗位简历";
}
function currentItemText(branch: ResumeBranch, claim: TailoringClaim) {
  const id = claim.targetContentItemId ?? claim.sourceItemIds?.[0];
  return branch.contentItems.find((item) => item.id === id)?.text ?? claim.currentText ?? "暂无";
}
function normalizeDiffText(value: string) { return value.replace(/<[^>]+>/g, "").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase(); }
function newlyAppliedKeywords(claims: TailoringClaim[], before: ResumeBranch, after: ResumeBranch) {
  const beforeText = JSON.stringify(before.structuredContentItems ?? before.contentItems).toLowerCase();
  const afterText = JSON.stringify(after.structuredContentItems ?? after.contentItems).toLowerCase();
  return [...new Set(claims
    .filter((claim) => claim.syncScope !== "rejected")
    .flatMap((claim) => claim.keywords)
    .filter((keyword) => {
      const normalized = keyword.trim().toLowerCase();
      return normalized && !beforeText.includes(normalized) && afterText.includes(normalized);
    }))];
}
function summarizeRejectionReasons(reasons: string[]): string {
  const unique = [...new Set(reasons)];
  if (!unique.length) return "AI 未能生成有效改写内容。建议检查岗位描述是否包含具体技能或职责描述。";
  const httpErrors = unique.filter((r) => r.startsWith("provider_http_"));
  if (httpErrors.length) {
    const codes = httpErrors.map((r) => r.replace("provider_http_", ""));
    const descriptions: Record<string, string> = {
      "401": "API Key 无效或已过期，请在设置中检查 AI API Key。",
      "403": "API Key 无权限访问该模型，请检查模型名称和 API Key 是否匹配。",
      "429": "AI 服务请求过于频繁，请稍后再试。",
      "500": "AI 服务端内部错误，请稍后再试。",
      "502": "AI 服务网关错误，请检查 AI 服务地址配置是否正确。",
      "503": "AI 服务暂时不可用，请稍后再试。"
    };
    const msg = codes.map((c) => descriptions[c] ?? `AI 服务返回 HTTP ${c} 错误。`).join(" ");
    return msg;
  }
  const aiErrors: string[] = [];
  if (unique.includes("missing_ai_config")) aiErrors.push("AI 服务未配置（缺少 API Key 或模型名称），请在设置中完成 AI 配置。");
  if (unique.includes("provider_failed") || unique.includes("empty_model_output")) aiErrors.push("AI 服务调用失败或返回空内容，请检查网络连接和 AI 配置后重试。");
  if (unique.some((r) => r.includes("invalid_json")) || unique.includes("client_schema_validation_failed")) aiErrors.push("AI 返回了无法解析的内容，请重试；若反复出现请检查 AI 模型设置。");
  if (unique.includes("empty_suggestions")) aiErrors.push("AI 未返回任何改写建议，请重试。");
  const semanticFails = unique.filter((r) => r.startsWith("semantic_validation_failed:"));
  if (semanticFails.length) {
    const semanticReasons: Record<string, string> = {
      "resume_tailor_no_op": "AI 改写结果与原文相同，未产生有效变化。",
      "resume_tailor_section_out_of_scope": "AI 返回了不属于当前简历片段的改写内容。",
      "resume_tailor_requirement_out_of_scope": "AI 引用了不属于当前任务的岗位要求。",
      "resume_tailor_evidence_ref_out_of_scope": "AI 引用了不在允许范围内的证据来源。",
      "invalid_ai_output": "AI 返回了空的改写建议。"
    };
    for (const fail of semanticFails) {
      const reason = fail.split(":")[1] ?? "";
      aiErrors.push(semanticReasons[reason] ?? `AI 改写未通过业务校验（${reason}）。`);
    }
  }
  if (aiErrors.length) return aiErrors.join(" ");
  const messages: string[] = [];
  if (unique.includes("copied_original") || unique.includes("insufficient_text_delta")) messages.push("改写内容与原文差异过小");
  if (unique.includes("no_keyword_or_structure_gain")) messages.push("未覆盖新的岗位关键词");
  if (unique.includes("generic_target_keywords")) messages.push("岗位描述中的关键词过于泛化（如仅包含「AI」等通用词），建议补充具体技术栈或职责描述");
  if (unique.includes("missing_after")) messages.push("AI 返回了空内容");
  if (unique.includes("irrelevant_rationale") || unique.includes("generic_rationale") || unique.includes("rationale_copies_requirement")) messages.push("AI 生成的修改理由不充分");
  if (unique.includes("conservative_delta_too_large")) messages.push("保守模式下改写幅度过大");
  if (!messages.length) messages.push("AI 改写未通过校验");
  return `改写建议未通过校验：${messages.join("；")}（${unique.join(", ")}）。请调整岗位描述后重试。`;
}
function plannerFailureMessage(code: string): string {
  const messages: Record<string, string> = {
    missing_ai_config: "岗位评估失败：AI 配置不完整，请在设置中检查 API Key 和模型名称。",
    provider_protocol_mismatch: "岗位评估失败：当前地址不是 OpenAI 兼容的 chat/completions 接口。",
    provider_http_401: "岗位评估失败：API Key 无效或已过期。",
    provider_http_403: "岗位评估失败：当前 API Key 无权访问所选模型。",
    provider_http_429: "岗位评估失败：AI 服务请求过于频繁，请稍后重试。",
    provider_http_502: "岗位评估失败：AI 服务网关异常，请检查服务地址。",
    provider_http_503: "岗位评估失败：AI 服务暂时不可用，请稍后重试。",
    invalid_json: "岗位评估失败：模型未返回有效 JSON，请重试或更换支持结构化输出的模型。",
    model_output_too_large: "岗位评估失败：模型输出超过长度限制，请重试。",
    planner_no_assessments: "岗位评估失败：模型没有返回任何条目判断，请重试。",
    validation_failed: "岗位评估失败：模型返回的数据不符合动作合同，请重试。",
    client_schema_validation_failed: "岗位评估失败：返回结果未通过客户端校验，请重试。"
  };
  return messages[code] ?? `岗位评估失败（${code}），请检查 AI 服务日志后重试。`;
}
function FieldDiff({ before, after }: { before: string | string[] | boolean | number; after: string | string[] | boolean | number }) {
  if (Array.isArray(before) || Array.isArray(after)) {
    const left = (Array.isArray(before) ? before : [before]).map(String);
    const right = (Array.isArray(after) ? after : [after]).map(String);
    const count = Math.max(left.length, right.length);
    return <div className="array-field-diff">{Array.from({ length: count }, (_, index) => <div className="array-field-diff-row" key={index}><strong>Bullet {index + 1}</strong><span className="array-field-diff-label">原文</span><StringFieldDiff before={left[index] ?? ""} after="" /><span className="array-field-diff-label">新文</span><StringFieldDiff before="" after={right[index] ?? ""} /></div>)}</div>;
  }
  return <StringFieldDiff before={String(before)} after={String(after)} />;
}

function StringFieldDiff({ before, after }: { before: string; after: string }) {
  const tokens = wordLevelDiff(before, after);
  return <div aria-label={`原文：${before}；新文：${after}`}>{tokens.map((token, index) => <span key={`${token.type}-${index}`} className={`diff-token diff-${token.type}`}>{token.text}</span>)}</div>;
}

function wordLevelDiff(before: string, after: string) {
  const left = tokenizeDiffText(before);
  const right = tokenizeDiffText(after);
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const raw: Array<{ type: "keep" | "delete" | "add"; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      raw.push({ type: "keep", text: left[i] }); i += 1; j += 1;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      raw.push({ type: "add", text: right[j] }); j += 1;
    } else {
      raw.push({ type: "delete", text: left[i] }); i += 1;
    }
  }
  return raw.reduce<typeof raw>((result, token) => {
    const previous = result.at(-1);
    if (previous?.type === token.type) previous.text += token.text;
    else result.push({ ...token });
    return result;
  }, []);
}

function tokenizeDiffText(value: string) {
  return value.match(/[\p{Script=Han}]|[A-Za-z0-9.+#-]+|\s+|[^\s]/gu) ?? [];
}
