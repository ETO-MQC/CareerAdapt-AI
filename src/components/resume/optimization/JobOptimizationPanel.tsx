"use client";

import { nanoid } from "nanoid";
import { useState } from "react";
import { invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { createManualJdOutput } from "@/domain/jobAnalysis/manual";
import {
  buildJobOptimizationSummary,
  buildRequirementBlockMatches,
  computeRequirementsHash,
  createBlockSuggestion,
  createDeterministicBlockSuggestion,
  staleReasonForSuggestion
} from "@/domain/jobOptimization";
import { mapJobDraftToJobDescription } from "@/domain/mappers/jobDraftMapper";
import { createRuleRequirementMatches, resolveEffectiveMatch } from "@/domain/match/matcher";
import {
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
  const [open, setOpen] = useState(false);
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

  const allJobs = (() => {
    const byId = new Map<string, JobDescription>();
    [...jobs, ...localJobs].forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  })();
  const selectedTargetJobId = targetJobId || branch?.jobId || allJobs[0]?.id || "";
  const targetJob = allJobs.find((job) => job.id === selectedTargetJobId);
  const activeSuggestion = suggestions.find((suggestion) => suggestion.id === selectedSuggestionId);
  const requirementsHash = targetJob
    ? computeRequirementsHash({ job: targetJob, matches: requirementMatches })
    : "";
  const blockMatches: RequirementBlockMatch[] = profile && targetJob && branch && branch.currentRevisionId && requirementMatches.length > 0
    ? buildRequirementBlockMatches({ profile, job: targetJob, branch, matches: requirementMatches })
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
    if (!profile || !targetJob) {
      setStatus("请先选择岗位和基础简历。");
      return [];
    }
    setPending(true);
    try {
      const stored = await repository.listRequirementMatches(profile.id, targetJob.id);
      const usable = stored.length > 0
        ? stored
        : createRuleRequirementMatches({ profile, job: targetJob });
      if (stored.length === 0) {
        await repository.saveRuleRequirementMatches({ profile, job: targetJob, matches: usable });
      }
      setRequirementMatches(usable);
      setStatus(`岗位要求映射已生成：${usable.length} 条。`);
      return usable;
    } catch {
      setStatus("生成岗位要求映射失败，请确认岗位要求和个人资料都已就绪。");
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
    if (!profile || !targetJob || !branch || !branch.currentRevisionId) {
      throw new Error("optimization_context_missing");
    }
    const result = await repository.createJobAdaptationDraft({
      profile,
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
    if (!profile || !targetJob || !branch || !branch.currentRevisionId) {
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
          profileId: profile.id,
          jobId: targetJob.id,
          profileVersion: profile.version,
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

      const aiSuggestion = aiResult.ok ? aiResult.data.suggestions[0] : undefined;
      const guardResult = aiSuggestion
        ? runRuleFactGuard({
          originalText: contentItem.originalText,
          checkedText: aiSuggestion.suggestedText,
          usedEvidenceRefs: aiSuggestion.usedEvidenceRefs.length > 0 ? aiSuggestion.usedEvidenceRefs : evidenceRefs
        })
        : undefined;
      const suggestion = aiSuggestion && guardResult
        ? createBlockSuggestion({
          draftId: nextDraft.id,
          branch,
          contentItem,
          requirementIds: aiSuggestion.requirementIds,
          requirementsHash,
          kind: aiTypeToKind(aiSuggestion.type),
          suggestedText: aiSuggestion.suggestedText,
          reason: aiSuggestion.reason,
          usedEvidenceRefs: aiSuggestion.usedEvidenceRefs.length > 0 ? aiSuggestion.usedEvidenceRefs : evidenceRefs,
          guardResult,
          promptVersion: aiResult.ok ? aiResult.promptVersion : promptVersions.resumeTailor
        })
        : createDeterministicBlockSuggestion({
          draftId: nextDraft.id,
          job: targetJob,
          branch,
          contentItem,
          matches: relatedBlockMatches,
          kind,
          promptVersion: "resume-tailor.fallback.v1"
        });
      const saved = await repository.saveGeneratedBlockSuggestion({
        profile,
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

  async function acceptSuggestion() {
    if (!branch || !activeSuggestion?.targetContentItemId || !activeSuggestion.originalTextHash || !requirementsHash) {
      setStatus("没有可接受的建议。");
      return;
    }
    setPending(true);
    try {
      const result = await repository.applyResumeBlockSuggestion({
        branchId: branch.id,
        suggestionId: activeSuggestion.id,
        contentItemId: activeSuggestion.targetContentItemId,
        expectedBranchRevision: branch.revision,
        expectedRevisionId: branch.currentRevisionId ?? "",
        expectedOriginalTextHash: activeSuggestion.originalTextHash,
        requirementsHash,
        operationId: `g5a-accept-${activeSuggestion.id}-${branch.revision}-${stableHashText(acceptedText)}`,
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
          <p>{status}</p>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setOpen((current) => !current)}>
          {open ? "收起" : "展开"}
        </button>
      </div>
      {open ? (
        <div className="optimization-grid">
          <div className="optimization-column">
            <label className="field-label">
              已有岗位
              <select value={selectedTargetJobId} onChange={(event) => setTargetJobId(event.target.value)}>
                {allJobs.map((job) => (
                  <option key={job.id} value={job.id}>{job.company} / {job.title}</option>
                ))}
              </select>
            </label>
            <div className="action-row">
              <button className="secondary-button compact" disabled={pending || !targetJob} onClick={() => { void refreshMatches(); }}>
                刷新匹配
              </button>
              <button className="primary-button compact" disabled={pending || !canEdit || !targetJob || !branch} onClick={() => { void deriveBranch(); }}>
                创建岗位简历
              </button>
            </div>
            <div className="optimization-jd-create">
              <input value={jdTitle} onChange={(event) => setJdTitle(event.target.value)} placeholder="岗位名称" />
              <input value={jdCompany} onChange={(event) => setJdCompany(event.target.value)} placeholder="公司名称" />
              <textarea className="textarea small-textarea" value={jdText} onChange={(event) => setJdText(event.target.value)} placeholder="粘贴目标岗位描述" />
              <button className="secondary-button compact" disabled={pending} onClick={() => { void createJobFromJd(); }}>
                从岗位描述创建
              </button>
            </div>
            {summary ? (
              <div className="optimization-summary" data-testid="optimization-summary">
                <span>总要求 {summary.totalRequirements}</span>
                <span>直接匹配 {summary.strong}</span>
                <span>部分匹配 {summary.partial}</span>
                <span>较弱 {summary.weak}</span>
                <span>暂无匹配 {summary.none}</span>
                <span>待处理建议 {summary.pendingSuggestions}</span>
              </div>
            ) : null}
            <div className="requirement-filter-row">
              {(["all", "required", "preferred", "covered", "partial", "uncovered", "needs_confirmation"] as const).map((value) => (
                <button key={value} className={`secondary-button compact ${filter === value ? "property-tab-active" : ""}`} onClick={() => setFilter(value)}>
                  {filterLabel(value)}
                </button>
              ))}
            </div>
            <div className="requirement-list" data-testid="requirement-sidebar">
              {filteredCoverage.map((item) => (
                <button
                  key={item.requirement.id}
                  className={`match-row ${selectedRequirementId === item.requirement.id ? "match-row-active" : ""}`}
                  onClick={() => setSelectedRequirementId(item.requirement.id)}
                >
                  <strong>{item.requirement.description}</strong>
                  <span>{item.requirement.category} / {item.requirement.priority} / {matchLevelLabel(item.bestLevel)} / 段落 {item.contentItemIds.length} / 证据 {item.evidenceCount}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="optimization-column">
            {selectedCoverage?.factGap ? (
              <div className="warning-box" data-testid="fact-gap-card">
                当前资料未找到可支持该岗位要求的事实证据。请先在个人资料库补充并确认事实，或忽略此要求。
              </div>
            ) : null}
            <div className="property-summary compact-property-summary">
              <strong>{selectedContentItem ? selectedContentItem.text.slice(0, 48) : "请选择要求或区块"}</strong>
              <span>{selectedCoverage ? `关联 ${selectedCoverage.matches.length} 条映射` : "无映射"}</span>
            </div>
            <div className="action-row">
              <button className="primary-button compact" disabled={pending || !selectedContentItem} onClick={() => { void generateSuggestion("rewrite"); }}>
                生成改写建议
              </button>
              <button className="secondary-button compact" disabled={pending || !selectedContentItem} onClick={() => { void generateSuggestion("compress"); }}>
                生成压缩建议
              </button>
              <button className="secondary-button compact" disabled={pending || !selectedContentItem} onClick={() => { void generateSuggestion("prioritize"); }}>
                生成前置建议
              </button>
            </div>
            {selectedContentItem ? (
              <div className="action-row">
                <button className="secondary-button compact" onClick={() => onApplyStructureSuggestion("reorder", selectedContentItem.id)}>结构建议：上移</button>
                <button className="secondary-button compact" onClick={() => onApplyStructureSuggestion("hide", selectedContentItem.id)}>结构建议：隐藏</button>
                <button className="secondary-button compact" onClick={() => onMessage("结构建议只调整展示配置，不创建正文版本。")}>说明</button>
              </div>
            ) : null}
            <div className="suggestion-list">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  className={`match-row ${selectedSuggestionId === suggestion.id ? "match-row-active" : ""}`}
                  onClick={() => {
                    setSelectedSuggestionId(suggestion.id);
                    setAcceptedText(suggestion.editedText ?? suggestion.suggestedText);
                  }}
                >
                  <strong>{suggestionTypeLabel(suggestion.type)} / {suggestionStatusLabel(suggestion.status)}</strong>
                  <span>{suggestion.reason}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="optimization-column">
            {activeSuggestion ? (
              <article className="suggestion-card" data-testid="block-suggestion-panel">
                <h3>建议详情</h3>
                {staleReason ? <div className="warning-box">建议已过期：{suggestionStaleReasonLabel(staleReason)}。请重新生成后再接受。</div> : null}
                <label className="field-label">
                  原文
                  <textarea className="textarea small-textarea" value={activeSuggestion.originalText} readOnly />
                </label>
                <label className="field-label">
                  建议文本
                  <textarea className="textarea small-textarea" value={acceptedText} onChange={(event) => setAcceptedText(event.target.value)} />
                </label>
                <InlineDiff originalText={activeSuggestion.originalText} suggestedText={acceptedText} />
                <div className="warning-box">
                  <strong>理由</strong>
                  <p>{activeSuggestion.reason}</p>
                  <p>风险：{riskLabel(activeSuggestion.riskLevel)} / 安全检查：{activeSuggestion.guardPreview?.allowed ? "预检通过" : "预检阻断"}</p>
                  <p>证据：{(activeSuggestion.evidenceQuotes ?? activeSuggestion.usedEvidenceRefs.map((ref) => ref.factQuote || ref.factText)).join(" / ") || "无"}</p>
                </div>
                <div className="action-row">
                  <button className="primary-button compact" disabled={pending || Boolean(staleReason) || activeSuggestion.status === "accepted"} onClick={() => { void acceptSuggestion(); }}>
                    接受
                  </button>
                  <button className="secondary-button compact" disabled={pending || Boolean(staleReason) || activeSuggestion.status === "accepted"} onClick={() => { void acceptSuggestion(); }}>
                    编辑后接受
                  </button>
                  <button className="secondary-button compact" disabled={pending} onClick={() => { void decideSuggestion("reject"); }}>
                    拒绝
                  </button>
                  <button className="secondary-button compact" disabled={pending} onClick={() => { void decideSuggestion("ignore"); }}>
                    忽略
                  </button>
                  <button className="secondary-button compact" disabled={pending} onClick={() => { void generateSuggestion("rewrite"); }}>
                    重新生成
                  </button>
                </div>
              </article>
            ) : (
              <div className="warning-box">选择或生成一个建议后，可查看原文、建议、修改对比、理由、证据和事实安全检查。</div>
            )}
          </div>
        </div>
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
