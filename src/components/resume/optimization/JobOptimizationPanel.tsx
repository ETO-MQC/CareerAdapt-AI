"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";
import { invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { mergeAiFactGuardReview, runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createManualJdOutput } from "@/domain/jobAnalysis/manual";
import {
  buildJobOptimizationSummary,
  buildRequirementBlockMatches,
  computeRequirementsHash,
  createBlockSuggestion,
  staleReasonForSuggestion
} from "@/domain/jobOptimization";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import {
  checkRequirementMatchResumeSourceStale,
  checkRequirementMatchStale,
  matchesResumeSource,
  resolveEffectiveMatch
} from "@/domain/match/matcher";
import {
  FactGuardOutputSchema,
  JobAnalysisDraftSchema,
  RawInputDocumentSchema,
  ResumeTailorOutputSchema,
  type AiSuggestion,
  type BranchContentItem,
  type CareerProfile,
  type JobAdaptationDraft,
  type JobDescription,
  type RawInputDocument,
  type RequirementBlockMatch,
  type RequirementMatch,
  type ResumeBlockSuggestionKind,
  type ResumeBranch
} from "@/domain/schemas";
import { hashText, stableHashText } from "@/services/security/text";
import { RevisionConflictError, type WorkspaceRepository } from "@/services/storage/repositories";

type RequirementFilter = "all" | "required" | "preferred" | "covered" | "partial" | "uncovered" | "needs_confirmation";
type OptimizationCategory = "content" | "matching" | "gaps" | "layout";

export function JobOptimizationPanel({
  repository,
  profile,
  jobs,
  branch,
  selectedContentItemId,
  canEdit,
  onJobCreated,
  onBranchReady,
  onApplyStructureSuggestion,
  onMessage
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
}) {
  const [open, setOpen] = useState(true);
  const [localJobs, setLocalJobs] = useState<JobDescription[]>([]);
  const [targetJobId, setTargetJobId] = useState("");
  const [requirementMatches, setRequirementMatches] = useState<RequirementMatch[]>([]);
  const [draft, setDraft] = useState<JobAdaptationDraft | undefined>();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [selectedRequirementId, setSelectedRequirementId] = useState("");
  const [filter, setFilter] = useState<RequirementFilter>("all");
  const [status, setStatus] = useState("尚未生成岗位映射。");
  const [pending, setPending] = useState(false);
  const [jdTitle, setJdTitle] = useState("");
  const [jdCompany, setJdCompany] = useState("");
  const [jdText, setJdText] = useState("");
  const [selectedSuggestionId, setSelectedSuggestionId] = useState("");
  const [acceptedText, setAcceptedText] = useState("");
  const [category, setCategory] = useState<OptimizationCategory>("content");
  const [mediumRiskConfirmed, setMediumRiskConfirmed] = useState(false);

  const allJobs = useMemo(() => {
    const byId = new Map<string, JobDescription>();
    [...jobs, ...localJobs].forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [jobs, localJobs]);
  const selectedTargetJobId = branch?.branchPurpose === "job_specific" ? branch.jobId ?? "" : targetJobId;
  const targetJob = allJobs.find((job) => job.id === selectedTargetJobId);
  const matchingProfile = useMemo(
    () => profile && branch ? profileLimitedToBranch(profile, branch) : profile,
    [profile, branch]
  );
  const activeSuggestion = suggestions.find((suggestion) => suggestion.id === selectedSuggestionId);
  const requirementsHash = targetJob
    ? computeRequirementsHash({ job: targetJob, matches: requirementMatches })
    : "";
  const blockMatches: RequirementBlockMatch[] = matchingProfile && targetJob && branch && branch.currentRevisionId && requirementMatches.length > 0
    ? buildRequirementBlockMatches({ profile: matchingProfile, job: targetJob, branch, matches: requirementMatches })
    : [];
  const coverage = targetJob && branch
    ? targetJob.requirements.map((requirement) => {
      const matches = blockMatches.filter((match) => match.requirementId === requirement.id);
      const best = [...matches].sort((a, b) => matchLevelRank(b.matchLevel) - matchLevelRank(a.matchLevel))[0];
      return {
        requirement,
        matches,
        bestLevel: best?.matchLevel ?? "none",
        contentItemIds: Array.from(new Set(matches.map((match) => match.contentItemId).filter((id): id is string => Boolean(id)))),
        evidenceCount: new Set(matches.flatMap((match) => match.evidenceFactIds)).size,
        factGap: !best || best.matchLevel === "none" || best.matchLevel === "needs_confirmation"
      };
    })
    : [];
  const filteredCoverage = coverage.filter((item) => {
    if (filter === "required") {
      return item.requirement.hardConstraint || item.requirement.priority === "must" || item.requirement.priority === "high";
    }
    if (filter === "preferred") {
      return item.requirement.priority === "nice_to_have" || item.requirement.category === "preferred_skill" || item.requirement.category === "nice_to_have";
    }
    if (filter === "covered") {
      return item.bestLevel === "strong";
    }
    if (filter === "partial") {
      return item.bestLevel === "partial" || item.bestLevel === "weak";
    }
    if (filter === "uncovered") {
      return item.bestLevel === "none";
    }
    if (filter === "needs_confirmation") {
      return item.bestLevel === "needs_confirmation";
    }
    return true;
  });
  const summary = targetJob && branch
    ? buildJobOptimizationSummary({
      job: targetJob,
      branch,
      matches: blockMatches,
      generatedSuggestions: suggestions.length,
      pendingSuggestions: suggestions.filter((suggestion) => suggestion.status === "pending_review" || suggestion.status === "edited_guarded").length,
      acceptedSuggestions: suggestions.filter((suggestion) => suggestion.status === "accepted").length,
      rejectedSuggestions: suggestions.filter((suggestion) => suggestion.status === "rejected").length,
      staleSuggestions: suggestions.filter((suggestion) => suggestion.status === "stale_blocked").length,
      blockedSuggestions: suggestions.filter((suggestion) => suggestion.status === "blocked_high_risk").length
    })
    : undefined;

  useEffect(() => {
    let active = true;
    async function loadBoundOptimizationContext() {
      setRequirementMatches([]);
      setDraft(undefined);
      setSuggestions([]);
      setSelectedSuggestionId("");
      setAcceptedText("");
      setMediumRiskConfirmed(false);
      if (!branch || branch.branchPurpose !== "job_specific" || !branch.jobId || !branch.sourceBranchId || !branch.sourceRevisionId || !matchingProfile) {
        setStatus(branch?.branchPurpose === "general" ? "请先从岗位页生成岗位简历。" : "岗位简历来源引用不完整。");
        return;
      }
      const job = allJobs.find((candidate) => candidate.id === branch.jobId);
      if (!job) {
        setStatus("绑定岗位已失效，不能生成建议。");
        return;
      }
      const stored = await repository.listRequirementMatches(matchingProfile.id, job.id);
      const exactMatches = stored.filter((match) => matchesResumeSource(match, {
        branchId: branch.sourceBranchId!,
        branchRevision: branch.sourceDraftRevision,
        revisionId: branch.sourceRevisionId!
      }));
      if (!active) return;
      setRequirementMatches(exactMatches);
      const latestDraft = await repository.getLatestJobAdaptationDraft(matchingProfile.id, job.id);
      const boundDraft = latestDraft?.branchId === branch.id ? latestDraft : undefined;
      const persisted = boundDraft ? await repository.listAiSuggestions(boundDraft.id) : [];
      if (!active) return;
      setDraft(boundDraft);
      setSuggestions(persisted.filter((suggestion) => suggestion.branchId === branch.id));
      setStatus(exactMatches.length > 0
        ? `已载入 ${exactMatches.length} 条当前来源版本的岗位匹配。`
        : "当前岗位简历没有有效匹配，请返回岗位页重新运行匹配。"
      );
    }
    void loadBoundOptimizationContext();
    return () => { active = false; };
  }, [allJobs, branch, matchingProfile, repository]);

  async function createJobFromJd() {
    if (!jdTitle.trim() || !jdCompany.trim() || !jdText.trim()) {
      setStatus("请先填写岗位名称、公司和岗位描述正文。");
      return;
    }
    setPending(true);
    try {
      const now = new Date().toISOString();
      const inputHash = await hashText(`${jdTitle}\n${jdCompany}\n${jdText}`);
      const rawInput: RawInputDocument = RawInputDocumentSchema.parse({
        id: `raw-${nanoid(10)}`,
        kind: "job_jd",
        rawText: jdText,
        inputHash,
        title: `${jdCompany} / ${jdTitle}`,
        createdAt: now,
        updatedAt: now
      });
      const output = createManualJdOutput(jdText, jdTitle, jdCompany);
      const draft = JobAnalysisDraftSchema.parse({
        id: `job-draft-${nanoid(10)}`,
        rawInputId: rawInput.id,
        revision: 0,
        title: jdTitle,
        company: jdCompany,
        status: "manual_mode",
        promptVersion: promptVersions.jdAnalyzer,
        attemptCount: 0,
        manualRequirements: output.requirements,
        riskNotes: output.riskNotes,
        createdAt: now,
        updatedAt: now
      });
      await repository.saveRawInput(rawInput);
      const savedDraft = await repository.createJobAnalysisDraft(draft);
      const jobDescription = mapJobDraftToJobDescription({ draft: savedDraft, rawInput, now });
      const result = await repository.commitJobDraft({
        draftId: savedDraft.id,
        expectedRevision: savedDraft.revision,
        commitId: `commit-job-${savedDraft.id}`,
        jobDescription
      });
      setLocalJobs((current) => [result.jobDescription, ...current.filter((job) => job.id !== result.jobDescription.id)]);
      onJobCreated(result.jobDescription);
      setTargetJobId(result.jobDescription.id);
      setStatus(`已创建岗位：${result.jobDescription.company} / ${result.jobDescription.title}`);
    } catch {
      setStatus("创建岗位失败，请检查岗位描述正文是否包含可定位要求。");
    } finally {
      setPending(false);
    }
  }

  async function refreshMatches() {
    if (!matchingProfile || !targetJob || !branch || branch.branchPurpose !== "job_specific" || !branch.sourceBranchId || !branch.sourceRevisionId) {
      setStatus("请先从岗位页选择通用简历、完成匹配并生成岗位简历。");
      return [];
    }
    setPending(true);
    try {
      setStatus("准备中…正在读取当前来源版本的岗位匹配。");
      const stored = await repository.listRequirementMatches(matchingProfile.id, targetJob.id);
      const source = {
        branchId: branch.sourceBranchId,
        branchRevision: branch.sourceDraftRevision,
        revisionId: branch.sourceRevisionId
      };
      const usable = stored.filter((match) => matchesResumeSource(match, source));
      const stale = usable.some((match) =>
        checkRequirementMatchStale(match, { profile: matchingProfile, job: targetJob }).isStale
        || checkRequirementMatchResumeSourceStale(match, source).isStale
      );
      if (usable.length === 0 || stale || usable.length < targetJob.requirements.length) {
        setRequirementMatches([]);
        setStatus("建议已过期：当前来源简历、个人资料或岗位已变化。请返回岗位页重新运行匹配。");
        return [];
      }
      setRequirementMatches(usable);
      setStatus(`已刷新 ${usable.length} 条岗位匹配。`);
      return usable;
    } catch {
      setStatus("读取岗位匹配失败；当前简历和已有建议均已保留，可重试。");
      return [];
    } finally {
      setPending(false);
    }
  }

  async function deriveBranch() {
    if (!branch || !targetJob || !branch.currentRevisionId) {
      setStatus("请选择基础简历和目标岗位。");
      return;
    }
    const matches = requirementMatches.length > 0 ? requirementMatches : await refreshMatches();
    if (matches.length === 0) {
      return;
    }
    if (branch.branchPurpose === "job_specific" && branch.jobId === targetJob.id) {
      setStatus("当前已经是该岗位的定制简历。");
      return;
    }
    setPending(true);
    try {
      const result = await repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: branch.id,
        jobId: targetJob.id,
        expectedSourceRevision: branch.revision,
        expectedSourceRevisionId: branch.currentRevisionId,
        operationId: `g5a-derive-${branch.id}-${targetJob.id}-${branch.revision}`,
        name: `${targetJob.company} / ${targetJob.title} 定制简历`
      });
      onBranchReady(result.branch);
      setStatus(result.duplicate ? "已检测到相同岗位简历，已打开既有简历。" : "已创建岗位定制简历，通用简历未被修改。");
    } catch {
      setStatus("创建岗位定制简历失败：请确认当前简历未变化且岗位匹配已生成。");
    } finally {
      setPending(false);
    }
  }

  async function ensureDraft(matches: RequirementMatch[]) {
    if (!matchingProfile || !targetJob || !branch || !branch.currentRevisionId) {
      throw new Error("optimization_context_missing");
    }
    const result = await repository.createJobAdaptationDraft({
      profile: matchingProfile,
      job: targetJob,
      matches,
      operationId: `g5a-draft-${branch.id}-${targetJob.id}-${branch.revision}`,
      branchId: branch.id,
      sourceBranchId: branch.sourceBranchId ?? branch.id,
      sourceRevisionId: branch.currentRevisionId,
      sourceBranchRevision: branch.revision
    });
    const persistedSuggestions = await repository.listAiSuggestions(result.draft.id);
    setDraft(result.draft);
    setSuggestions(persistedSuggestions.filter((suggestion) => suggestion.branchId === branch.id));
    return result.draft;
  }

  async function generateSuggestion(kind: ResumeBlockSuggestionKind = "rewrite") {
    if (!matchingProfile || !targetJob || !branch || branch.branchPurpose !== "job_specific" || !branch.currentRevisionId) {
      setStatus("请先选择岗位并打开岗位定制简历。");
      return;
    }
    const matches = requirementMatches.length > 0 ? requirementMatches : await refreshMatches();
    const requirementId = selectedRequirementId || coverage.find((item) => !item.factGap)?.requirement.id || coverage[0]?.requirement.id;
    const contentItemId = selectedContentItemId
      || coverage.find((item) => item.requirement.id === requirementId)?.contentItemIds[0]
      || blockMatches.find((match) => match.contentItemId)?.contentItemId;
    const contentItem = contentItemId ? branch.contentItems.find((item) => item.id === contentItemId) : undefined;
    const relatedBlockMatches = blockMatches.filter((match) =>
      match.contentItemId === contentItemId
      && (!requirementId || match.requirementId === requirementId)
    );
    if (!contentItem || relatedBlockMatches.length === 0) {
      setStatus("当前要求没有可定位区块，已显示事实缺口，不生成虚假建议。");
      return;
    }
    const evidenceRefs = uniqueEvidenceRefs(relatedBlockMatches.flatMap((match) => match.evidenceRefs));
    if (evidenceRefs.length === 0) {
      setStatus("当前资料未找到可支持该要求的事实证据。");
      return;
    }

    setPending(true);
    try {
      setStatus("生成建议中…");
      const nextDraft = await ensureDraft(matches);
      const tailorMatches = matches
        .filter((match) => relatedBlockMatches.some((blockMatch) => blockMatch.requirementId === match.requirementId))
        .map((match) => {
          const effective = resolveEffectiveMatch(match);
          const requirement = targetJob.requirements.find((item) => item.id === match.requirementId);
          return {
            requirementId: match.requirementId,
            requirementDescription: requirement?.description ?? match.requirementQuote.text,
            matchLevel: effective.matchLevel,
            riskLevel: effective.riskLevel,
            risks: effective.risks,
            evidenceRefs: effective.evidenceRefs,
            explanation: effective.explanation
          };
        });
      const aiResult = await invokeStructuredAi({
        task: "resume-tailor",
        businessInput: {
          draftId: nextDraft.id,
          profileId: matchingProfile.id,
          jobId: targetJob.id,
          profileVersion: matchingProfile.version,
          jobVersion: targetJob.updatedAt,
          matcherVersion: matches[0]?.matcherVersion ?? "evidence-matcher.v1",
          requirementIds: relatedBlockMatches.map((match) => match.requirementId),
          allowedEvidenceRefs: evidenceRefs,
          sectionTexts: [{
            sectionId: contentItem.sourceSectionId ?? contentItem.id,
            sectionType: itemToTailorSectionType(contentItem),
            text: contentItem.text,
            originalText: contentItem.originalText,
            order: contentItem.order
          }],
          matches: tailorMatches
        },
        outputSchema: ResumeTailorOutputSchema
      });
      await repository.saveAiLogs([aiResult.log]);
      if (!aiResult.ok || aiResult.data.suggestions.length === 0) {
        setStatus("生成建议失败；当前简历和已有建议均已保留。请检查 AI 设置后重试。");
        return;
      }

      const aiSuggestion = aiResult.data.suggestions.find((suggestion) => suggestionMatchesKind(suggestion.type, kind))
        ?? aiResult.data.suggestions[0];
      const suggestionEvidence = aiSuggestion.usedEvidenceRefs.length > 0 ? aiSuggestion.usedEvidenceRefs : evidenceRefs;
      const guardResult = await runSuggestionFactGuard(contentItem.text, aiSuggestion.suggestedText, suggestionEvidence);
      const suggestion = createBlockSuggestion({
        draftId: nextDraft.id,
        branch,
        contentItem,
        requirementIds: aiSuggestion.requirementIds,
        requirementsHash,
        kind: aiTypeToKind(aiSuggestion.type),
        suggestedText: aiSuggestion.suggestedText,
        reason: aiSuggestion.reason,
        usedEvidenceRefs: suggestionEvidence,
        guardResult,
        promptVersion: aiResult.promptVersion
      });
      const saved = await repository.saveGeneratedBlockSuggestion({
        profile: matchingProfile,
        job: targetJob,
        draftId: nextDraft.id,
        matches,
        suggestion,
        expectedRevision: nextDraft.revision,
        operationId: `g5a-generate-${branch.id}-${contentItem.id}-${stableHashText(`${kind}-${requirementId}-${suggestions.length}-${nextDraft.revision}`)}`
      });
      setDraft(saved.draft);
      setSuggestions((current) => [saved.suggestion, ...current.filter((item) => item.id !== saved.suggestion.id)]);
      setSelectedSuggestionId(saved.suggestion.id);
      setAcceptedText(saved.suggestion.editedText ?? saved.suggestion.suggestedText);
      setStatus(saved.suggestion.status === "blocked_high_risk" ? "建议已生成，但事实安全检查阻断。" : "段落建议已生成，请审阅后再接受。");
    } catch {
      setStatus("生成建议失败；现有简历未被修改，可重试或查看事实缺口。");
    } finally {
      setPending(false);
    }
  }

  async function runSuggestionFactGuard(
    originalText: string,
    checkedText: string,
    usedEvidenceRefs: AiSuggestion["usedEvidenceRefs"]
  ) {
    setStatus("Fact Guard 检查中…");
    const ruleResult = runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs });
    if (ruleResult.status === "blocked_high_risk") return ruleResult;
    const aiReview = await invokeStructuredAi({
      task: "fact-guard",
      businessInput: {
        originalText,
        checkedText,
        usedEvidenceRefs,
        ruleFindings: ruleResult.ruleFindings
      },
      outputSchema: FactGuardOutputSchema
    });
    await repository.saveAiLogs([aiReview.log]);
    return mergeAiFactGuardReview({
      ruleResult,
      aiReview: aiReview.ok ? aiReview.data : undefined,
      aiFailed: !aiReview.ok
    });
  }

  async function acceptSuggestion() {
    if (!branch || !activeSuggestion?.targetContentItemId || !activeSuggestion.originalTextHash || !requirementsHash) {
      setStatus("没有可接受的建议。");
      return;
    }
    if (activeSuggestion.riskLevel === "high" || activeSuggestion.status === "blocked_high_risk") {
      setStatus("高风险建议已阻止写入。请修改建议或先补充已确认事实。");
      return;
    }
    if (activeSuggestion.riskLevel === "medium" && !mediumRiskConfirmed) {
      setStatus("中风险建议需要你明确确认后才能接受。");
      return;
    }
    setPending(true);
    try {
      let suggestionToApply = activeSuggestion;
      if (acceptedText.trim() !== activeSuggestion.suggestedText.trim()) {
        if (!draft) throw new Error("suggestion_draft_missing");
        const editedGuard = await runSuggestionFactGuard(
          activeSuggestion.originalText,
          acceptedText,
          activeSuggestion.usedEvidenceRefs
        );
        const guarded = await repository.editSuggestionGuarded({
          draftId: draft.id,
          suggestionId: activeSuggestion.id,
          expectedRevision: draft.revision,
          operationId: `p34-edit-guard-${activeSuggestion.id}-${draft.revision}-${stableHashText(acceptedText)}`,
          editedText: acceptedText,
          guardResult: editedGuard
        });
        setDraft(guarded.draft);
        setSuggestions((current) => current.map((item) => item.id === guarded.suggestion.id ? guarded.suggestion : item));
        suggestionToApply = guarded.suggestion;
        if (guarded.suggestion.status !== "edited_guarded") {
          setStatus("编辑后的建议未通过事实安全检查，尚未写入简历。");
          return;
        }
      }
      setStatus("保存中…");
      const result = await repository.applyResumeBlockSuggestion({
        branchId: branch.id,
        suggestionId: suggestionToApply.id,
        contentItemId: suggestionToApply.targetContentItemId!,
        expectedBranchRevision: branch.revision,
        expectedRevisionId: branch.currentRevisionId ?? "",
        expectedOriginalTextHash: suggestionToApply.originalTextHash!,
        requirementsHash,
        operationId: `g5a-accept-${suggestionToApply.id}-${branch.revision}-${stableHashText(acceptedText)}`,
        acceptedText
      });
      onBranchReady(result.branch);
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
      setStatus("建议已通过事实安全检查并写入岗位简历，已保存为新版本。");
    } catch (error) {
      setStatus(error instanceof RevisionConflictError ? "建议已过期：当前正文或版本已变化，请重新生成。" : "接受失败：事实安全检查或建议过期检查未通过。");
    } finally {
      setPending(false);
    }
  }

  async function decideSuggestion(decision: "reject" | "ignore") {
    if (!draft || !activeSuggestion) {
      return;
    }
    setPending(true);
    try {
      const result = decision === "reject"
        ? await repository.rejectSuggestion({
          draftId: draft.id,
          suggestionId: activeSuggestion.id,
          expectedRevision: draft.revision,
          operationId: `g5a-reject-${activeSuggestion.id}-${draft.revision}`
        })
        : await repository.ignoreSuggestion({
          draftId: draft.id,
          suggestionId: activeSuggestion.id,
          expectedRevision: draft.revision,
          operationId: `g5a-ignore-${activeSuggestion.id}-${draft.revision}`
        });
      setDraft(result.draft);
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
      setStatus(decision === "reject" ? "已拒绝建议，正文未修改。" : "已暂时忽略建议，正文未修改。");
    } catch {
      setStatus("建议状态更新失败，请刷新后重试。");
    } finally {
      setPending(false);
    }
  }

  const selectedCoverage = coverage.find((item) => item.requirement.id === selectedRequirementId);
  const selectedContentItem = selectedCoverage?.contentItemIds[0]
    ? branch?.contentItems.find((item) => item.id === selectedCoverage.contentItemIds[0])
    : selectedContentItemId
      ? branch?.contentItems.find((item) => item.id === selectedContentItemId)
      : undefined;
  const staleReason = activeSuggestion && branch && requirementsHash
    ? staleReasonForSuggestion({ suggestion: activeSuggestion, branch, requirementsHash })
    : undefined;

  return (
    <section className="no-print optimization-panel studio-subpanel" data-testid="job-optimization-panel">
      <div className="section-heading">
        <div>
          <h2>针对岗位优化</h2>
          <p role="status" aria-live="polite">{status}</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "收起" : "展开"}
        </button>
      </div>
      {open ? (
        <>
          <div className="optimization-context-bar">
          <div><span>当前岗位</span><strong>{targetJob ? `${targetJob.company} / ${targetJob.title}` : "未绑定"}</strong></div>
          <div><span>当前版本</span><strong>{branch?.currentRevisionId ? `正文版本 ${branch.revision + 1}` : "无正式版本"}</strong></div>
          <button className="secondary-button compact" disabled={pending || !targetJob || branch?.branchPurpose !== "job_specific"} onClick={() => { void refreshMatches(); }}>
            刷新匹配状态
          </button>
        </div>

        {branch?.branchPurpose === "general" ? (
          <div className="warning-box">
            这是一份通用简历。请返回岗位页，明确选择岗位和来源简历、完成匹配后再生成岗位简历。
            <div className="optimization-jd-create">
              <input value={jdTitle} onChange={(event) => setJdTitle(event.target.value)} placeholder="岗位名称…" aria-label="岗位名称" />
              <input value={jdCompany} onChange={(event) => setJdCompany(event.target.value)} placeholder="公司名称…" aria-label="公司名称" />
              <textarea className="textarea small-textarea" value={jdText} onChange={(event) => setJdText(event.target.value)} placeholder="粘贴目标岗位描述…" aria-label="岗位描述" />
              <div className="action-row">
                <button className="secondary-button compact" disabled={pending} onClick={() => { void createJobFromJd(); }}>保存岗位</button>
                <button className="primary-button compact" disabled={pending || !targetJob || !canEdit} onClick={() => { void deriveBranch(); }}>创建岗位简历</button>
              </div>
            </div>
          </div>
        ) : null}

        {summary ? (
          <div className="optimization-summary" data-testid="optimization-summary">
            <span>总要求 {summary.totalRequirements}</span>
            <span>直接匹配 {summary.strong}</span>
            <span>部分匹配 {summary.partial}</span>
            <span>较弱 {summary.weak}</span>
            <span>事实缺口 {summary.none + summary.needsConfirmation}</span>
            <span>待处理建议 {summary.pendingSuggestions}</span>
          </div>
        ) : null}

        <div className="optimization-category-tabs" role="tablist" aria-label="优化建议分类">
          {(["content", "matching", "gaps", "layout"] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={category === value} className={category === value ? "inspector-tab inspector-tab-active" : "inspector-tab"} onClick={() => setCategory(value)}>
              {optimizationCategoryLabel(value, coverage, suggestions)}
            </button>
          ))}
        </div>

        {category === "matching" ? (
          <div className="optimization-column">
            <div className="requirement-filter-row">
              {(["all", "required", "preferred", "covered", "partial", "uncovered", "needs_confirmation"] as const).map((value) => (
                <button key={value} className={`secondary-button compact ${filter === value ? "property-tab-active" : ""}`} onClick={() => setFilter(value)}>{filterLabel(value)}</button>
              ))}
            </div>
            <div className="requirement-list" data-testid="requirement-sidebar">
              {filteredCoverage.map((item) => (
                <button key={item.requirement.id} className={`match-row ${selectedRequirementId === item.requirement.id ? "match-row-active" : ""}`} onClick={() => { setSelectedRequirementId(item.requirement.id); setCategory(item.factGap ? "gaps" : "content"); }}>
                  <strong>{item.requirement.description}</strong>
                  <span>{matchLevelLabel(item.bestLevel)} / 段落 {item.contentItemIds.length} / 证据 {item.evidenceCount}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {category === "gaps" ? (
          <div className="fact-gap-list" data-testid="fact-gap-list">
            {coverage.filter((item) => item.factGap).length > 0 ? coverage.filter((item) => item.factGap).map((item) => (
              <article className="warning-box" key={item.requirement.id}>
                <strong>{item.requirement.description}</strong>
                <p>当前没有可确认的事实证据。请补充具体成果、技能证据、规模、时间范围或责任边界；系统不会自动补写。</p>
              </article>
            )) : <p className="empty-copy">当前岗位要求均已找到可使用证据。</p>}
          </div>
        ) : null}

        {category === "layout" ? (
          <div className="warning-box">
            排版诊断位于上方“质量检查”页签，可检查页数、栏目长度、信息密度、重复表达和模板适配；诊断不会修改事实。
          </div>
        ) : null}

          {category === "content" ? (
          <div className="optimization-content-grid">
            <div className="optimization-column">
              {selectedCoverage?.factGap ? <div className="warning-box" data-testid="fact-gap-card">当前要求没有事实证据，只能进入“事实缺口”，不能生成正文建议。</div> : null}
              <div className="property-summary compact-property-summary">
                <strong>{selectedContentItem ? selectedContentItem.text.slice(0, 72) : "请先在岗位匹配建议中选择有证据的要求"}</strong>
                <span>{selectedCoverage ? `关联 ${selectedCoverage.matches.length} 条映射` : "尚未选择岗位要求"}</span>
              </div>
              <div className="action-row">
                <button className="primary-button compact" disabled={pending || !selectedContentItem || selectedCoverage?.factGap} onClick={() => { void generateSuggestion("rewrite"); }}>生成内容建议</button>
                <button className="secondary-button compact" disabled={pending || !selectedContentItem || selectedCoverage?.factGap} onClick={() => { void generateSuggestion("compress"); }}>压缩表达</button>
                <button className="secondary-button compact" disabled={pending || !selectedContentItem || selectedCoverage?.factGap} onClick={() => { void generateSuggestion("prioritize"); }}>前置重点</button>
              </div>
              {selectedContentItem ? (
                <details className="structure-suggestion-details">
                  <summary>结构与显示建议</summary>
                  <div className="action-row">
                    <button className="secondary-button compact" onClick={() => onApplyStructureSuggestion("reorder", selectedContentItem.id)}>上移当前段落</button>
                    <button className="secondary-button compact" onClick={() => onApplyStructureSuggestion("hide", selectedContentItem.id)}>隐藏当前段落</button>
                    <button className="secondary-button compact" onClick={() => onMessage("结构建议只调整展示配置，不创建正文版本。")}>查看说明</button>
                  </div>
                </details>
              ) : null}
              <div className="suggestion-list">
                {suggestions.length > 0 ? suggestions.map((suggestion) => (
                  <button key={suggestion.id} className={`match-row ${selectedSuggestionId === suggestion.id ? "match-row-active" : ""}`} onClick={() => {
                    setSelectedSuggestionId(suggestion.id);
                    setAcceptedText(suggestion.editedText ?? suggestion.suggestedText);
                    setMediumRiskConfirmed(false);
                  }}>
                    <strong>{suggestionTypeLabel(suggestion.type)} / {suggestionStatusLabel(suggestion.status)}</strong>
                    <span>{riskLabel(suggestion.riskLevel)}风险 · 基于正文版本 {(suggestion.basedOnBranchRevision ?? 0) + 1} · {formatDateTime(suggestion.createdAt)}</span>
                  </button>
                )) : <p className="empty-copy">尚未生成内容建议。</p>}
              </div>
            </div>
            <div className="optimization-column">
              {activeSuggestion ? (
                <article className="suggestion-card" data-testid="block-suggestion-panel">
                  <div className="section-heading compact-heading">
                    <div><h3>{suggestionTypeLabel(activeSuggestion.type)}</h3><p>目标栏目：{activeSuggestion.targetSectionId}</p></div>
                    <span className={`risk-chip risk-chip-${activeSuggestion.riskLevel}`}>{riskLabel(activeSuggestion.riskLevel)}风险</span>
                  </div>
                  {staleReason ? (
                    <div className="warning-box">
                      <strong>建议已过期：{suggestionStaleReasonLabel(staleReason)}</strong>
                      <p>当前简历内容已发生变化，该建议不会覆盖新内容。</p>
                      <div className="action-row">
                        <button className="secondary-button compact" onClick={() => { void generateSuggestion("rewrite"); }}>重新生成</button>
                        <button className="secondary-button compact" onClick={() => { void decideSuggestion("reject"); }}>放弃建议</button>
                      </div>
                    </div>
                  ) : null}
                  <label className="field-label">修改前文本<textarea className="textarea small-textarea" value={activeSuggestion.originalText} readOnly /></label>
                  <label className="field-label">建议文本<textarea className="textarea small-textarea" value={acceptedText} onChange={(event) => { setAcceptedText(event.target.value); setMediumRiskConfirmed(false); }} /></label>
                  <InlineDiff originalText={activeSuggestion.originalText} suggestedText={acceptedText} />
                  <dl className="suggestion-metadata">
                    <div><dt>修改原因</dt><dd><ExpandableText text={activeSuggestion.reason} threshold={150} /></dd></div>
                    <div><dt>岗位要求</dt><dd>{activeSuggestion.requirementIds.map((id) => targetJob?.requirements.find((item) => item.id === id)?.description ?? id).join("；")}</dd></div>
                    <div><dt>事实来源</dt><dd>{(activeSuggestion.evidenceQuotes ?? activeSuggestion.usedEvidenceRefs.map((ref) => ref.factQuote || ref.factText)).join("；") || "无"}</dd></div>
                    <div><dt>事实安全检查</dt><dd>{factGuardStatusLabel(activeSuggestion.guardResult.status)}</dd></div>
                    <div><dt>生成依据</dt><dd>{formatDateTime(activeSuggestion.createdAt)} · 正文版本 {(activeSuggestion.basedOnBranchRevision ?? 0) + 1}</dd></div>
                  </dl>
                  {activeSuggestion.riskLevel === "high" || activeSuggestion.status === "blocked_high_risk" ? (
                    <div className="warning-box"><strong>已阻止接受</strong><p>建议包含未经事实支持的高风险改写。请修改建议或先补充已确认事实。</p></div>
                  ) : activeSuggestion.riskLevel === "medium" ? (
                    <label className="inline-toggle medium-risk-confirmation"><input type="checkbox" checked={mediumRiskConfirmed} onChange={(event) => setMediumRiskConfirmed(event.target.checked)} />我已核对事实来源，并确认接受这条中风险建议</label>
                  ) : null}
                  <div className="action-row">
                    {activeSuggestion.riskLevel !== "high" && activeSuggestion.status !== "blocked_high_risk" ? (
                      <button className="primary-button compact" disabled={pending || Boolean(staleReason) || !["pending_review", "edited_guarded"].includes(activeSuggestion.status) || (activeSuggestion.riskLevel === "medium" && !mediumRiskConfirmed)} onClick={() => { void acceptSuggestion(); }}>
                        {acceptedText.trim() === activeSuggestion.suggestedText.trim() ? "接受" : "编辑后接受"}
                      </button>
                    ) : null}
                    <button className="secondary-button compact" disabled={pending || activeSuggestion.status === "accepted"} onClick={() => { void decideSuggestion("reject"); }}>拒绝</button>
                    <button className="secondary-button compact" disabled={pending || activeSuggestion.status === "accepted"} onClick={() => { void decideSuggestion("ignore"); }}>暂时忽略</button>
                    <button className="secondary-button compact" disabled={pending} onClick={() => { void generateSuggestion("rewrite"); }}>重新生成</button>
                  </div>
                </article>
              ) : <div className="warning-box">选择或生成一条建议后，可核对修改前后文本、岗位要求、事实来源、风险和版本依据。</div>}
            </div>
          </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function InlineDiff({ originalText, suggestedText }: { originalText: string; suggestedText: string }) {
  const originalTokens = tokenize(originalText);
  const suggestedTokens = tokenize(suggestedText);
  return (
    <div className="inline-diff" data-testid="inline-diff">
      <strong>修改对比</strong>
      <div>
        {originalTokens.filter((token) => !suggestedTokens.includes(token)).map((token, index) => (
          <span key={`del-${token}-${index}`} className="diff-token diff-delete">删除 {token}</span>
        ))}
        {suggestedTokens.map((token, index) => (
          <span
            key={`tok-${token}-${index}`}
            className={originalTokens.includes(token) ? "diff-token diff-keep" : "diff-token diff-add"}
          >
            {originalTokens.includes(token) ? token : `新增 ${token}`}
          </span>
        ))}
      </div>
    </div>
  );
}

function tokenize(text: string): string[] {
  return text.match(/[A-Za-z0-9+#.]+|[\u4e00-\u9fa5]{1,2}|[^\s]/g) ?? [];
}

function itemToTailorSectionType(item: BranchContentItem) {
  if (item.itemType === "summary") {
    return "summary" as const;
  }
  if (item.itemType === "skill") {
    return "skills" as const;
  }
  return "experience" as const;
}

function aiTypeToKind(type: AiSuggestion["type"]): ResumeBlockSuggestionKind {
  if (type === "compress" || type === "remove_or_shorten") {
    return "compress";
  }
  if (type === "prioritize") {
    return "prioritize";
  }
  if (type === "remove_irrelevant") {
    return "remove_irrelevant";
  }
  if (type === "reorder") {
    return "reorder";
  }
  if (type === "hide") {
    return "hide";
  }
  if (type === "show") {
    return "show";
  }
  return "rewrite";
}

function suggestionMatchesKind(type: AiSuggestion["type"], kind: ResumeBlockSuggestionKind) {
  return aiTypeToKind(type) === kind;
}

function uniqueEvidenceRefs(refs: AiSuggestion["usedEvidenceRefs"]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function matchLevelRank(level: RequirementBlockMatch["matchLevel"]) {
  return { strong: 4, partial: 3, weak: 2, needs_confirmation: 1, none: 0 }[level];
}

function matchLevelLabel(level: RequirementBlockMatch["matchLevel"]) {
  return {
    strong: "直接匹配",
    partial: "部分匹配",
    weak: "较弱",
    needs_confirmation: "待确认",
    none: "暂无匹配"
  }[level];
}

function riskLabel(risk: string) {
  return {
    low: "低",
    medium: "中",
    high: "高"
  }[risk] ?? risk;
}

function suggestionTypeLabel(type: AiSuggestion["type"]) {
  const labels: Record<string, string> = {
    rewrite: "改写",
    compress: "压缩",
    prioritize: "前置重点",
    remove_irrelevant: "移除无关",
    remove_or_shorten: "删减",
    reorder: "调整顺序",
    hide: "隐藏",
    show: "恢复显示",
    follow_up_question: "需要追问",
    risk_warning: "风险提醒"
  };
  return labels[type] ?? "建议";
}

function suggestionStatusLabel(status: AiSuggestion["status"]) {
  const labels: Record<string, string> = {
    pending: "待审阅",
    accepted: "已接受",
    rejected: "已拒绝",
    ignored: "已忽略",
    blocked_high_risk: "高风险阻断",
    stale_blocked: "已过期",
    edited_guarded: "已编辑并检查",
    edited_pending_guard: "编辑后待检查",
    pending_review: "待复核",
    undone: "已撤回"
  };
  return labels[status] ?? status;
}

function suggestionStaleReasonLabel(reason: string) {
  return {
    original_text_changed: "原文已变化",
    branch_revision_changed: "简历版本已变化",
    requirements_changed: "岗位要求已变化",
    suggestion_stale: "建议已过期"
  }[reason] ?? "相关内容已变化";
}

function filterLabel(filter: RequirementFilter) {
  const labels: Record<RequirementFilter, string> = {
    all: "全部",
    required: "必备",
    preferred: "加分",
    covered: "已覆盖",
    partial: "部分",
    uncovered: "未覆盖",
    needs_confirmation: "待确认"
  };
  return labels[filter];
}

function optimizationCategoryLabel(
  category: OptimizationCategory,
  coverage: Array<{ factGap: boolean }>,
  suggestions: AiSuggestion[]
) {
  const labels: Record<OptimizationCategory, string> = {
    content: `内容优化 ${suggestions.length}`,
    matching: `岗位匹配 ${coverage.length}`,
    gaps: `事实缺口 ${coverage.filter((item) => item.factGap).length}`,
    layout: "排版诊断"
  };
  return labels[category];
}

function factGuardStatusLabel(status: AiSuggestion["guardResult"]["status"]) {
  const labels: Record<AiSuggestion["guardResult"]["status"], string> = {
    pass: "已通过规则与语义检查",
    needs_edit: "需要修改后重新检查",
    blocked_high_risk: "高风险，已阻止",
    ai_failed_rule_kept: "语义检查不可用，已保留规则检查结果"
  };
  return labels[status];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function profileLimitedToBranch(profile: CareerProfile, branch: ResumeBranch): CareerProfile {
  const experienceIds = new Set<string>();
  const skillIds = new Set<string>();
  const certificateIds = new Set<string>();
  for (const item of branch.contentItems) {
    for (const ref of item.factRefs) {
      if (ref.type === "experience_fact") experienceIds.add(ref.experienceId);
      if (ref.type === "skill_fact") skillIds.add(ref.skillId);
      if (ref.type === "certificate_fact") certificateIds.add(ref.certificateId);
    }
  }
  return {
    ...profile,
    experiences: profile.experiences.filter((item) => experienceIds.has(item.id)),
    skills: profile.skills.filter((item) => skillIds.has(item.id)),
    certificates: profile.certificates.filter((item) => certificateIds.has(item.id))
  };
}

function ExpandableText({ text, threshold = 150 }: { text: string; threshold?: number }) {
  const [expanded, setExpanded] = useState(false);
  if (text.length <= threshold) {
    return <p>{text}</p>;
  }
  return (
    <p>
      {expanded ? text : `${text.slice(0, threshold)}…`}
      <button
        type="button"
        className="secondary-button compact"
        style={{ marginLeft: 6, verticalAlign: "middle" }}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? "收起" : "展开全文"}
      </button>
    </p>
  );
}
