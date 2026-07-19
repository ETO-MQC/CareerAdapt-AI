"use client";

import { nanoid } from "nanoid";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { invokeStageBAi, invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { createManualJdOutput } from "@/domain/jobAnalysis/manual";
import {
  FactGuardOutputSchema,
  ResumeTailorOutputSchema,
  EvidenceMatcherOutputSchema,
  JdAnalyzerOutputSchema,
  MatchEvaluationSchema,
  type AiSuggestion,
  type FactGuardResult,
  type JdAnalyzerOutput,
  type JdAnalyzerRequirement,
  type JobAdaptationDraft,
  type JobAnalysisDraft,
  type JobDescription,
  type JobWorkflowErrorState,
  type CareerProfile,
  type MatchEvaluation,
  type MatchEvidenceRef,
  type RawInputDocument,
  type RequirementMatch,
  type ResumeBranch
} from "@/domain/schemas";
import { collectAllowedEvidenceRefs } from "@/domain/adaptation/draft";
import { mergeAiFactGuardReview, runRuleFactGuard } from "@/domain/adaptation/factGuard";
import {
  checkRequirementMatchStale,
  checkRequirementMatchResumeSourceStale,
  createRuleRequirementMatches,
  evidenceRefKey,
  recallCandidatesForRequirement,
  resolveEffectiveMatch,
  withResolvedEffectiveMatch
} from "@/domain/match/matcher";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { hashText, redactSensitiveTextForModel, stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import {
  classifyJobAiFailure,
  commitParsedJob,
  jobWorkflowErrorState,
  updateRequirementConfirmation,
  validateJobInput
} from "@/services/jobs/jobWorkflow";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { notify } from "@/services/notifications/store";

const repository = new WorkspaceRepository();
const jobArchiveKey = "jobWorkspace:archivedJobIds";

type JobWorkspaceTab = "info" | "requirements" | "resumes" | "applications";
type JobListFilter = "active" | "archived";
type JobResumeActionStatus = "idle" | "matching" | "evaluating" | "preparing" | "saving" | "completed" | "failed";
type JobFailedAction = "start_import" | "analyze" | "commit";
type DerivationPrompt = {
  kind: "same_version" | "source_updated";
  existingBranch: ResumeBranch;
};

export function JobsWorkspace() {
  const router = useRouter();
  const workspace = useWorkspace(repository);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument | undefined>();
  const [draft, setDraft] = useState<JobAnalysisDraft | undefined>();
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [matches, setMatches] = useState<RequirementMatch[]>([]);
  const [selectedMatchId, setSelectedMatchId] = useState<string | undefined>();
  const [manualLevel, setManualLevel] = useState<MatchEvaluation["matchLevel"]>("weak");
  const [manualRisk, setManualRisk] = useState<MatchEvaluation["riskLevel"]>("medium");
  const [manualReason, setManualReason] = useState("");
  const [manualEvidenceKey, setManualEvidenceKey] = useState("");
  const [adaptationDraft, setAdaptationDraft] = useState<JobAdaptationDraft | undefined>();
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [c2Status, setC2Status] = useState<"idle" | "running" | "failed">("idle");
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [jobWorkspaceTab, setJobWorkspaceTab] = useState<JobWorkspaceTab>("resumes");
  const [jobListFilter, setJobListFilter] = useState<JobListFilter>("active");
  const [archivedJobIds, setArchivedJobIds] = useState<string[]>([]);
  const [trashedJobIds, setTrashedJobIds] = useState<string[]>([]);
  const [resumeBranches, setResumeBranches] = useState<ResumeBranch[]>([]);
  const [selectedBaseResumeId, setSelectedBaseResumeId] = useState("");
  const [resumeActionStatus, setResumeActionStatus] = useState<JobResumeActionStatus>("idle");
  const [derivationPrompt, setDerivationPrompt] = useState<DerivationPrompt>();
  const [jobError, setJobError] = useState<JobWorkflowErrorState>();
  const [failedAction, setFailedAction] = useState<JobFailedAction>();

  useEffect(() => {
    let active = true;

    async function loadDraft() {
      const latest = await repository.getLatestJobAnalysisDraft();
      if (!active || !latest) {
        setLoadedDraft(true);
        return;
      }

      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) {
        return;
      }

      setDraft(latest);
      setTitle(latest.title);
      setCompany(latest.company);
      setRawInput(raw);
      setRawText(raw?.rawText ?? "");
      setLoadedDraft(true);
    }

    void loadDraft();

    return () => {
      active = false;
    };
  }, []);

  const redactionPreview = useMemo(() => redactSensitiveTextForModel(rawText), [rawText]);
  const output = draft?.analyzerOutput ?? (draft ? { requirements: draft.manualRequirements, riskNotes: draft.riskNotes } : undefined);
  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = useMemo(() => workspace.status === "ready" ? workspace.jobs : [], [workspace]);
  const activeJobs = jobs.filter((job) => !archivedJobIds.includes(job.id) && !trashedJobIds.includes(job.id));
  const archivedJobs = jobs.filter((job) => archivedJobIds.includes(job.id) && !trashedJobIds.includes(job.id));
  const visibleJobs = jobListFilter === "archived" ? archivedJobs : activeJobs;
  const availableJobs = [...activeJobs, ...archivedJobs];
  const selectedJob = visibleJobs.find((job) => job.id === selectedJobId) ?? visibleJobs[0] ?? availableJobs.find((job) => job.id === selectedJobId) ?? availableJobs[0];
  const baseResumeOptions = resumeBranches.filter(isMatchBaseResume);
  const selectedBaseResume = baseResumeOptions.find((branch) => branch.id === selectedBaseResumeId);
  const matchingProfile = profile && selectedBaseResume ? profileLimitedToResume(profile, selectedBaseResume) : undefined;
  const matchState = getJobResumeMatchState({
    profile: matchingProfile,
    job: selectedJob,
    branch: selectedBaseResume,
    matches
  });

  useEffect(() => {
    let active = true;
    async function loadJobArchive() {
      const [stored, recycleBin] = await Promise.all([repository.getMeta(jobArchiveKey), repository.getRecycleBinState()]);
      if (!active) {
        return;
      }
      setArchivedJobIds(parseArchivedJobIds(stored?.value));
      setTrashedJobIds(recycleBin.jobIds);
    }
    void loadJobArchive();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void repository.listResumeBranches(profile.id).then((items) => {
      if (!active) return;
      setResumeBranches(items);
      setSelectedBaseResumeId((current) => items.some((branch) => branch.id === current && isMatchBaseResume(branch)) ? current : "");
    });
    return () => { active = false; };
  }, [profile]);

  useEffect(() => {
    if (jobs.length === 0 || selectedJobId) return;
    const requestedJobId = new URLSearchParams(window.location.search).get("jobId");
    if (!requestedJobId || !jobs.some((job) => job.id === requestedJobId)) return;
    queueMicrotask(() => {
      setSelectedJobId(requestedJobId);
      setJobWorkspaceTab("resumes");
    });
  }, [jobs, selectedJobId]);

  useEffect(() => {
    let active = true;

    async function loadMatches() {
      if (!profile || !selectedJob || !selectedBaseResumeId) {
        setMatches([]);
        setSelectedMatchId(undefined);
        return;
      }

      const stored = await repository.listRequirementMatches(profile.id, selectedJob.id);
      if (active) {
        const forSelectedResume = latestMatchesForResume(stored, selectedBaseResumeId);
        setMatches(forSelectedResume);
        setSelectedMatchId((current) => forSelectedResume.some((match) => match.id === current) ? current : forSelectedResume[0]?.id);
      }
    }

    void loadMatches();

    return () => {
      active = false;
    };
  }, [profile, selectedBaseResumeId, selectedJob]);

  useEffect(() => {
    let active = true;

    async function loadC2Draft() {
      if (!profile || !selectedJob || !selectedBaseResumeId) {
        setAdaptationDraft(undefined);
        setSuggestions([]);
        return;
      }

      const latestDraft = await repository.getLatestJobAdaptationDraft(profile.id, selectedJob.id);
      const selectedDraft = latestDraft?.sourceBranchId === selectedBaseResumeId ? latestDraft : undefined;
      const latestSuggestions = selectedDraft ? await repository.listAiSuggestions(selectedDraft.id) : [];
      if (active) {
        setAdaptationDraft(selectedDraft);
        setSuggestions(latestSuggestions);
      }
    }

    void loadC2Draft();

    return () => {
      active = false;
    };
  }, [profile, selectedBaseResumeId, selectedJob]);

  const selectedMatch = matches.find((match) => match.id === selectedMatchId) ?? matches[0];
  const selectedRequirement = selectedJob?.requirements.find((requirement) => requirement.id === selectedMatch?.requirementId);
  const manualCandidates = matchingProfile && selectedRequirement ? recallCandidatesForRequirement(matchingProfile, selectedRequirement) : [];

  async function startImport() {
    try {
      const validated = validateJobInput({ title, company, rawText });
      const now = new Date().toISOString();
      const inputHash = await hashText(`${validated.title}\n${validated.company}\n${validated.rawText}`);
      const inputChanged = inputHash !== rawInput?.inputHash;
      const nextRawInput: RawInputDocument = {
        id: rawInput?.id ?? `raw-${nanoid(10)}`,
        kind: "job_jd",
        rawText: validated.rawText,
        inputHash,
        title: `${validated.company} / ${validated.title}`,
        createdAt: rawInput?.createdAt ?? now,
        updatedAt: now
      };

      await repository.saveRawInput(nextRawInput);

      const nextDraft: JobAnalysisDraft = {
        id: draft?.id ?? `job-draft-${nanoid(10)}`,
        rawInputId: nextRawInput.id,
        revision: draft?.revision ?? 0,
        title: validated.title,
        company: validated.company,
        status: "privacy_pending",
        promptVersion: promptVersions.jdAnalyzer,
        attemptCount: inputChanged ? 0 : (draft?.attemptCount ?? 0),
        analyzerOutput: inputChanged ? undefined : draft?.analyzerOutput,
        manualRequirements: inputChanged ? [] : (draft?.manualRequirements ?? []),
        riskNotes: inputChanged ? [] : (draft?.riskNotes ?? []),
        saveError: undefined,
        committedJobId: draft?.committedJobId,
        committedAt: draft?.committedAt,
        createdAt: draft?.createdAt ?? now,
        updatedAt: now
      };

      const saved = draft
        ? await repository.saveJobAnalysisDraftRevision(nextDraft, draft.revision)
        : await repository.createJobAnalysisDraft(nextDraft);

      setTitle(validated.title);
      setCompany(validated.company);
      setRawText(validated.rawText);
      setRawInput(nextRawInput);
      setDraft(saved);
      setJobError(undefined);
      setFailedAction(undefined);
      setMessage("原始 JD 已保存。请确认是否发送脱敏内容给外部模型。");
    } catch (error) {
      setJobError(jobWorkflowErrorState(error, "repository_save_failed"));
      setFailedAction("start_import");
      setMessage(undefined);
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
    }
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) {
      return;
    }

    try {
      setJobError(undefined);
      setMessage("正在解析 JD，服务端会先脱敏并校验模型输出。");
      const analyzingDraft = await saveDraft({ ...draft, title, company, status: "analyzing" });

      const result = await invokeStageBAi({
        task: "jd-analyzer",
        businessInput: {
          title,
          company,
          rawText: rawInput.rawText,
          inputHash: rawInput.inputHash
        },
        outputSchema: JdAnalyzerOutputSchema
      });

      await repository.saveAiLogs([result.log]);

      if (!result.ok) {
        const workflowError = classifyJobAiFailure(result.errorCode);
        const fallbackOutput = createManualJdOutput(rawInput.rawText, title, company);
        const saved = await saveDraft({
          ...analyzingDraft,
          status: "error",
          attemptCount: analyzingDraft.attemptCount + 1,
          manualRequirements: fallbackOutput.requirements,
          riskNotes: fallbackOutput.riskNotes,
          saveError: result.errorCode
        });
        setDraft(saved);
        setJobError(workflowError.state);
        setFailedAction("analyze");
        setMessage(undefined);
        return;
      }

      const saved = await saveDraft({
        ...analyzingDraft,
        status: "ai_validated",
        attemptCount: analyzingDraft.attemptCount + 1,
        promptVersion: result.promptVersion,
        analyzerOutput: result.data,
        riskNotes: result.data.riskNotes,
        saveError: undefined
      });
      setDraft(saved);
      setJobError(undefined);
      setFailedAction(undefined);
      setMessage("JD 解析完成。请核对原文依据并确认要求。");
    } catch (error) {
      setJobError(
        error instanceof TypeError
          ? classifyJobAiFailure("provider_unavailable").state
          : jobWorkflowErrorState(error, "repository_save_failed")
      );
      setFailedAction("analyze");
      setMessage(undefined);
    }
  }

  async function enterManualMode() {
    if (!draft || !rawInput) {
      return;
    }

    const previousDraft = draft;
    const fallbackOutput = createManualJdOutput(rawInput.rawText, title, company);
    const optimisticDraft: JobAnalysisDraft = {
      ...draft,
      status: "manual_mode",
      manualRequirements: draft.manualRequirements.length > 0 ? draft.manualRequirements : fallbackOutput.requirements,
      riskNotes: draft.riskNotes
    };
    setDraft(optimisticDraft);
    setJobError(undefined);
    try {
      const saved = await saveDraft(optimisticDraft);
      setDraft(saved);
      setFailedAction(undefined);
      setMessage("已进入手动分类模式，外部模型不会被调用。");
    } catch (error) {
      setDraft(previousDraft);
      setJobError(jobWorkflowErrorState(error, "repository_save_failed"));
      setFailedAction("analyze");
      setMessage(undefined);
    }
  }

  async function toggleRequirement(requirementId: string, checked: boolean) {
    if (!draft || !output) {
      return;
    }

    const previousDraft = draft;
    const optimisticDraft = updateRequirementConfirmation(draft, requirementId, checked);
    setDraft(optimisticDraft);
    try {
      const saved = await saveDraft(optimisticDraft);
      setDraft(saved);
      setJobError(undefined);
    } catch (error) {
      setDraft(previousDraft);
      setJobError(jobWorkflowErrorState(error, "repository_save_failed"));
      setFailedAction("commit");
      setMessage(undefined);
    }
  }

  async function removeRequirement(requirementId: string) {
    if (!draft || !output) {
      return;
    }

    const confirmed = window.confirm("删除后该要求不会进入正式岗位数据，但原始JD和草稿历史仍会保留。确认删除？");
    if (!confirmed) {
      return;
    }

    const nextOutput: JdAnalyzerOutput = {
      ...output,
      requirements: output.requirements.filter((requirement) => requirement.id !== requirementId)
    };
    const previousDraft = draft;
    const optimisticDraft: JobAnalysisDraft = {
      ...draft,
      status: "editing",
      analyzerOutput: draft.analyzerOutput ? nextOutput : draft.analyzerOutput,
      manualRequirements: draft.analyzerOutput ? draft.manualRequirements : nextOutput.requirements
    };
    setDraft(optimisticDraft);
    try {
      const saved = await saveDraft(optimisticDraft);
      setDraft(saved);
      setJobError(undefined);
    } catch (error) {
      setDraft(previousDraft);
      setJobError(jobWorkflowErrorState(error, "repository_save_failed"));
      setFailedAction("commit");
      setMessage(undefined);
    }
  }

  async function commitJob() {
    if (!draft || !rawInput) {
      return;
    }

    try {
      setSaveStatus("saving");
      const result = await commitParsedJob({ repository, draft, rawInput });
      workspace.upsertJob(result.jobDescription);
      setDraft(undefined);
      setRawInput(undefined);
      setTitle("");
      setCompany("");
      setRawText("");
      setSelectedJobId(result.jobDescription.id);
      setJobListFilter("active");
      setJobWorkspaceTab("requirements");
      setSaveStatus("saved");
      setJobError(undefined);
      setFailedAction(undefined);
      setMessage(undefined);
      notify({ type: "success", title: "岗位已提交", message: `${result.jobDescription.company} / ${result.jobDescription.title} 已写入正式岗位数据。` });
      await workspace.refetch();
    } catch (error) {
      const workflowError = jobWorkflowErrorState(error);
      setSaveStatus(workflowError.code === "revision_conflict" ? "conflict" : "failed");
      setJobError(workflowError);
      setFailedAction("commit");
      setMessage(undefined);
    }
  }

  function retryFailedJobAction() {
    if (failedAction === "start_import") {
      void startImport();
    } else if (failedAction === "analyze") {
      void analyzeWithAi();
    } else if (failedAction === "commit") {
      void commitJob();
    }
  }

  function handleJobTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tab: JobWorkspaceTab) {
    const tabs: JobWorkspaceTab[] = ["info", "requirements", "resumes", "applications"];
    const currentIndex = tabs.indexOf(tab);
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % tabs.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? tabs.length - 1
            : currentIndex;
    if (nextIndex === currentIndex && !["Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    setJobWorkspaceTab(tabs[nextIndex]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[nextIndex]?.focus();
  }

  async function saveDraft(nextDraft: JobAnalysisDraft) {
    setSaveStatus("saving");
    try {
      const saved = await repository.saveJobAnalysisDraftRevision(nextDraft, nextDraft.revision);
      setSaveStatus("saved");
      return saved;
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      throw error;
    }
  }

  async function saveArchivedJobIds(nextIds: string[]) {
    setArchivedJobIds(nextIds);
    await repository.setMeta(jobArchiveKey, nextIds);
  }

  async function archiveSelectedJob() {
    if (!selectedJob) {
      return;
    }
    await saveArchivedJobIds(Array.from(new Set([...archivedJobIds, selectedJob.id])));
    setJobListFilter("active");
    setSelectedJobId(activeJobs.find((job) => job.id !== selectedJob.id)?.id ?? "");
    setMessage("岗位已归档；正式岗位数据保留，可切换到已归档列表恢复。");
  }

  async function restoreSelectedJob() {
    if (!selectedJob) {
      return;
    }
    await saveArchivedJobIds(archivedJobIds.filter((id) => id !== selectedJob.id));
    setJobListFilter("active");
    setSelectedJobId(selectedJob.id);
    setMessage("岗位已恢复到当前列表。");
  }

  async function requestSafeJobDelete() {
    if (!selectedJob) {
      return;
    }
    const confirmed = window.confirm(`将“${selectedJob.company} / ${selectedJob.title}”移入回收站？之后可在统一回收站恢复。`);
    if (!confirmed) return;
    const next = await repository.moveJobToRecycleBin(selectedJob.id);
    await saveArchivedJobIds(archivedJobIds.filter((id) => id !== selectedJob.id));
    setTrashedJobIds(next.jobIds);
    setSelectedJobId(activeJobs.find((job) => job.id !== selectedJob.id)?.id ?? "");
    setMessage("岗位已移入回收站；关联简历、匹配和求职记录未被删除。");
  }

  async function runRuleMatcher() {
    if (!matchingProfile || !selectedJob || !selectedBaseResume) {
      setMessage("请先选择一份可用的通用简历和正式岗位。");
      return;
    }

    setResumeActionStatus("matching");
    setDerivationPrompt(undefined);
    try {
      const nextMatches = createRuleRequirementMatches({ profile: matchingProfile, job: selectedJob }).map((match) => ({
        ...match,
        sourceResumeBranchId: selectedBaseResume.id,
        sourceResumeBranchRevision: selectedBaseResume.revision,
        sourceResumeRevisionId: selectedBaseResume.currentRevisionId ?? undefined
      }));
      const saved = await repository.saveRuleRequirementMatches({
        profile: matchingProfile,
        job: selectedJob,
        matches: nextMatches
      });
      setMatches(saved);
      setSelectedMatchId(saved[0]?.id);
      setResumeActionStatus("completed");
      setMessage(`匹配已完成：只诊断“${selectedBaseResume.name}”当前正式版本中引用的已确认事实。`);
    } catch {
      setResumeActionStatus("failed");
      setMessage("匹配失败：请检查岗位要求、来源简历和个人资料引用后重试。");
    }
  }

  async function runAiEvidenceMatcher() {
    if (!matchingProfile || !selectedJob || matches.length === 0) {
      setMessage("请先运行经历匹配。");
      return;
    }

    setResumeActionStatus("evaluating");
    const nextMatches: RequirementMatch[] = [];

    for (const match of matches) {
      const stale = checkRequirementMatchStale(match, { profile: matchingProfile, job: selectedJob });
      const requirement = selectedJob.requirements.find((item) => item.id === match.requirementId);
      if (stale.isStale || !requirement) {
        nextMatches.push({ ...match, isStale: true });
        continue;
      }

      const candidates = recallCandidatesForRequirement(matchingProfile, requirement);
      const result = await invokeStructuredAi({
        task: "evidence-matcher",
        businessInput: {
          profileId: matchingProfile.id,
          jobId: selectedJob.id,
          profileVersion: matchingProfile.version,
          jobVersion: selectedJob.updatedAt,
          matcherVersion: match.matcherVersion,
          candidateSetHash: match.candidateSetHash,
          requirement: {
            id: requirement.id,
            description: requirement.description,
            sourceQuote: requirement.sourceSpan.text,
            hardConstraint: requirement.hardConstraint,
            keywords: requirement.keywords
          },
          candidates: candidates.map((candidate) => ({
            evidenceRef: candidate.ref,
            searchText: candidate.searchText
          }))
        },
        outputSchema: EvidenceMatcherOutputSchema
      });

      await repository.saveAiLogs([result.log]);

      if (!result.ok) {
        nextMatches.push(match);
        continue;
      }

      const evaluation = result.data.evaluations.find((item) => item.requirementId === requirement.id);
      if (!evaluation) {
        nextMatches.push(match);
        continue;
      }

      const aiEvaluation = MatchEvaluationSchema.parse({
        source: "ai",
        matchLevel: evaluation.matchLevel,
        riskLevel: evaluation.riskLevel,
        risks: evaluation.risks,
        evidenceRefs: evaluation.evidenceRefs,
        explanation: evaluation.explanation,
        evaluatedAt: new Date().toISOString()
      }) as MatchEvaluation & { source: "ai" };

      nextMatches.push(withResolvedEffectiveMatch({
        ...match,
        aiEvaluation,
        updatedAt: new Date().toISOString()
      }));
    }

    try {
      const saved = await repository.saveAiRequirementMatches({
        profile: matchingProfile,
        job: selectedJob,
        matches: nextMatches
      });
      setMatches(saved);
      setResumeActionStatus("completed");
      setMessage("AI证据评估已完成；规则匹配和人工覆盖未被修改。");
    } catch {
      setResumeActionStatus("failed");
      setMessage("AI证据评估失败；规则匹配和已有数据均已保留，可稍后重试。");
    }
  }

  async function prepareJobResumeDerivation() {
    if (!profile || !selectedJob || !selectedBaseResume || !selectedBaseResume.currentRevisionId) {
      setMessage("请选择一份通用简历。");
      return;
    }
    if (!matchState.ready) {
      setMessage(matchState.message);
      return;
    }

    setResumeActionStatus("preparing");
    const existing = await repository.findDerivedJobBranches({
      sourceBranchId: selectedBaseResume.id,
      jobId: selectedJob.id
    });
    const sameVersion = existing.find((branch) => branch.sourceRevisionId === selectedBaseResume.currentRevisionId);
    if (sameVersion) {
      setDerivationPrompt({ kind: "same_version", existingBranch: sameVersion });
      setResumeActionStatus("idle");
      return;
    }
    if (existing[0]) {
      setDerivationPrompt({ kind: "source_updated", existingBranch: existing[0] });
      setResumeActionStatus("idle");
      return;
    }
    await createAndOpenJobResume(false);
  }

  async function createAndOpenJobResume(allowDuplicate: boolean) {
    if (!profile || !selectedJob || !selectedBaseResume?.currentRevisionId) return;
    setResumeActionStatus("saving");
    try {
      const baseName = `${selectedJob.title} - ${selectedJob.company} - ${profile.basics.name}`;
      const result = await repository.deriveJobSpecificBranchFromBranch({
        sourceBranchId: selectedBaseResume.id,
        jobId: selectedJob.id,
        expectedSourceRevision: selectedBaseResume.revision,
        expectedSourceRevisionId: selectedBaseResume.currentRevisionId,
        operationId: `p34-derive-${selectedBaseResume.id}-${selectedJob.id}-${selectedBaseResume.currentRevisionId}-${nanoid(8)}`,
        name: uniqueBranchName(baseName, resumeBranches),
        allowDuplicate
      });
      setResumeActionStatus("completed");
      setDerivationPrompt(undefined);
      router.push(`/resume?branchId=${encodeURIComponent(result.branch.id)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob.id)}`);
    } catch (error) {
      setResumeActionStatus("failed");
      setMessage(error instanceof RevisionConflictError
        ? "通用简历在创建前发生了变化，请重新检查匹配。"
        : "生成岗位简历失败：来源版本或岗位匹配已失效，请重新运行匹配。");
    }
  }

  function openExistingJobResume(branch: ResumeBranch) {
    if (!selectedJob) return;
    setDerivationPrompt(undefined);
    router.push(`/resume?branchId=${encodeURIComponent(branch.id)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob.id)}`);
  }

  async function saveManualOverride(match: RequirementMatch) {
    if (!matchingProfile || !selectedJob) {
      return;
    }

    if (!manualReason.trim()) {
      setMessage("人工覆盖必须填写说明。");
      return;
    }

    const evidenceRefs = manualLevel === "none" ? [] : selectedManualEvidenceRef();
    if (manualLevel !== "none" && evidenceRefs.length === 0) {
      setMessage("人工覆盖为 strong、weak 或 transferable 时必须选择至少一条正式事实。");
      return;
    }

    const nextEvaluation = MatchEvaluationSchema.parse({
      source: "manual",
      matchLevel: manualLevel,
      riskLevel: manualRisk,
      risks: manualRisk === "low" ? [] : ["low_confidence"],
      evidenceRefs,
      explanation: manualReason,
      evaluatedAt: new Date().toISOString()
    }) as MatchEvaluation & { source: "manual" };

    const saved = await repository.saveManualMatchOverride({
      profile: matchingProfile,
      job: selectedJob,
      matchId: match.id,
      operationId: `manual-${stableHashText(JSON.stringify({
        matchId: match.id,
        manualLevel,
        manualRisk,
        manualReason,
        manualEvidenceKey
      }))}`,
      nextEvaluation,
      reason: manualReason
    });

    setMatches((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    setManualReason("");
    setMessage("人工覆盖已保存，并记录修改前后结果。");
  }

  async function createC2Draft() {
    if (!matchingProfile || !selectedJob || !selectedBaseResume || matches.length === 0) {
      setMessage("请先完成经历匹配，再创建简历建议草稿。");
      return undefined;
    }

    try {
      setC2Status("running");
      const operationId = `c2-create-${stableHashText(JSON.stringify({
        profileId: matchingProfile.id,
        jobId: selectedJob.id,
        sourceBranchId: selectedBaseResume.id,
        sourceRevisionId: selectedBaseResume.currentRevisionId ?? undefined,
        matchIds: matches.map((match) => match.id).sort()
      }))}`;
      const result = await repository.createJobAdaptationDraft({
        profile: matchingProfile,
        job: selectedJob,
        matches,
        operationId,
        sourceBranchId: selectedBaseResume.id,
        sourceRevisionId: selectedBaseResume.currentRevisionId ?? undefined,
        sourceBranchRevision: selectedBaseResume.revision
      });
      setAdaptationDraft(result.draft);
      setC2Status("idle");
      setMessage(result.idempotent ? "简历建议草稿已存在，已恢复。" : "简历建议草稿已创建。");
      return result.draft;
    } catch (error) {
      setC2Status("failed");
      setMessage(error instanceof Error && error.message.includes("c2_match_stale")
        ? "存在过期匹配，暂不能生成建议。请重新运行经历匹配。"
        : "创建简历建议草稿失败，请确认匹配结果未过期。");
      return undefined;
    }
  }

  async function generateC2Suggestions() {
    if (!profile || !selectedJob) {
      return;
    }

    const draftForGeneration = adaptationDraft ?? await createC2Draft();
    if (!draftForGeneration) {
      return;
    }

    try {
      setC2Status("running");
      const usableMatches = getC2UsableMatches();
      const tailorInput = buildResumeTailorInput(draftForGeneration, usableMatches);
      const result = await invokeStructuredAi({
        task: "resume-tailor",
        businessInput: tailorInput,
        outputSchema: ResumeTailorOutputSchema
      });
      await repository.saveAiLogs([result.log]);

      if (!result.ok) {
        setC2Status("failed");
        setMessage("resume-tailor 调用失败，已保留现有草稿和建议。");
        return;
      }

      const now = new Date().toISOString();
      const nextSuggestions: AiSuggestion[] = [];
      for (const item of result.data.suggestions) {
        const guardResult = await runFullFactGuard(item.originalText, item.suggestedText, item.usedEvidenceRefs);
        nextSuggestions.push({
          id: `suggestion-${nanoid(10)}`,
          draftId: draftForGeneration.id,
          targetSectionId: item.targetSectionId,
          type: item.type,
          originalText: item.originalText,
          suggestedText: item.suggestedText,
          reason: item.reason,
          requirementIds: item.requirementIds,
          usedEvidenceRefs: item.usedEvidenceRefs,
          guardResult,
          riskLevel: guardResult.riskLevel,
          status: guardResult.status === "blocked_high_risk" ? "blocked_high_risk" : "pending_review",
          promptVersion: result.promptVersion,
          createdAt: now,
          updatedAt: now
        });
      }

      const saved = await repository.saveGeneratedSuggestions({
        profile,
        job: selectedJob,
        draftId: draftForGeneration.id,
        matches: usableMatches,
        suggestions: nextSuggestions,
        expectedRevision: draftForGeneration.revision,
        operationId: `c2-generate-${draftForGeneration.id}-${stableHashText(JSON.stringify(nextSuggestions.map((item) => item.id)))}`
      });
      setAdaptationDraft(saved.draft);
      setSuggestions(saved.suggestions);
      setC2Status("idle");
      setMessage("AI简历建议已生成，并完成事实安全检查。");
    } catch {
      setC2Status("failed");
      setMessage("生成简历建议失败。已有草稿和规则检测结果不会被清空。");
    }
  }

  async function runFullFactGuard(originalText: string, checkedText: string, usedEvidenceRefs: AiSuggestion["usedEvidenceRefs"]): Promise<FactGuardResult> {
    const ruleResult = runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs });
    const aiResult = await invokeStructuredAi({
      task: "fact-guard",
      businessInput: {
        originalText,
        checkedText,
        usedEvidenceRefs,
        ruleFindings: ruleResult.ruleFindings
      },
      outputSchema: FactGuardOutputSchema
    });
    await repository.saveAiLogs([aiResult.log]);
    return mergeAiFactGuardReview({
      ruleResult,
      aiReview: aiResult.ok ? aiResult.data : undefined,
      aiFailed: !aiResult.ok
    });
  }

  async function acceptSuggestion(suggestion: AiSuggestion) {
    if (!profile || !selectedJob || !adaptationDraft) {
      return;
    }

    try {
      const result = await repository.acceptSuggestion({
        profile,
        job: selectedJob,
        matches: getC2UsableMatches(),
        draftId: adaptationDraft.id,
        suggestionId: suggestion.id,
        expectedRevision: adaptationDraft.revision,
        operationId: `c2-accept-${suggestion.id}-${adaptationDraft.revision}`
      });
      setAdaptationDraft(result.draft);
      setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
      setMessage("建议已接受，草稿文本和快照已保存。");
    } catch {
      setMessage("该建议无法接受：可能是高风险、未通过事实安全检查、版本冲突或匹配已过期。");
    }
  }

  async function rejectSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const result = await repository.rejectSuggestion({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-reject-${suggestion.id}-${adaptationDraft.revision}`
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("建议已拒绝，并已记录快照。");
  }

  async function editAndGuardSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const editedText = editedSuggestions[suggestion.id]?.trim();
    if (!editedText) {
      setMessage("请先填写编辑后的文本。");
      return;
    }

    const guardResult = await runFullFactGuard(suggestion.originalText, editedText, suggestion.usedEvidenceRefs);
    const result = await repository.editSuggestionGuarded({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-edit-${suggestion.id}-${stableHashText(editedText)}-${adaptationDraft.revision}`,
      editedText,
      guardResult
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage(guardResult.status === "pass" ? "编辑文本已通过事实安全检查，可单条接受。" : "编辑文本仍存在事实风险，请删除风险内容后重新检测。");
  }

  async function rerunGuardSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const checkedText = suggestion.editedText ?? suggestion.suggestedText;
    const guardResult = await runFullFactGuard(suggestion.originalText, checkedText, suggestion.usedEvidenceRefs);
    const result = await repository.rerunSuggestionGuard({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-rerun-guard-${suggestion.id}-${stableHashText(checkedText)}-${adaptationDraft.revision}`,
      checkedText,
      guardResult
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("事实安全检查已重新检测。");
  }

  async function undoSuggestion(suggestion: AiSuggestion) {
    if (!adaptationDraft) {
      return;
    }

    const result = await repository.undoSuggestion({
      draftId: adaptationDraft.id,
      suggestionId: suggestion.id,
      expectedRevision: adaptationDraft.revision,
      operationId: `c2-undo-${suggestion.id}-${adaptationDraft.revision}`
    });
    setAdaptationDraft(result.draft);
    setSuggestions((current) => current.map((item) => item.id === result.suggestion.id ? result.suggestion : item));
    setMessage("已撤销该建议造成的草稿变更。");
  }

  function getC2UsableMatches() {
    if (!profile || !selectedJob) {
      return [];
    }
    return matches.filter((match) => {
      const stale = checkRequirementMatchStale(match, { profile: matchingProfile ?? profile, job: selectedJob });
      return match.profileId === profile.id && match.jobId === selectedJob.id && !match.isStale && !stale.isStale;
    });
  }

  function buildResumeTailorInput(draftForGeneration: JobAdaptationDraft, usableMatches: RequirementMatch[]) {
    const allowedEvidenceRefs = collectAllowedEvidenceRefs(usableMatches);
    return {
      draftId: draftForGeneration.id,
      profileId: draftForGeneration.profileId,
      jobId: draftForGeneration.jobId,
      profileVersion: draftForGeneration.profileVersion,
      jobVersion: draftForGeneration.jobVersion,
      matcherVersion: draftForGeneration.matcherVersion,
      requirementIds: usableMatches.map((match) => match.requirementId),
      allowedEvidenceRefs,
      sectionTexts: draftForGeneration.sectionTexts.map((section) => ({
        sectionId: section.sectionId,
        sectionType: section.sectionType,
        text: section.text,
        originalText: section.originalText,
        order: section.order
      })),
      matches: usableMatches.map((match) => {
        const effective = resolveEffectiveMatch(match);
        const requirement = selectedJob?.requirements.find((item) => item.id === match.requirementId);
        return {
          requirementId: match.requirementId,
          requirementDescription: requirement?.description ?? match.requirementQuote.text,
          matchLevel: effective.matchLevel,
          riskLevel: effective.riskLevel,
          risks: effective.risks,
          evidenceRefs: effective.evidenceRefs,
          explanation: effective.explanation
        };
      })
    };
  }

  function selectedManualEvidenceRef(): MatchEvidenceRef[] {
    const candidate = manualCandidates.find((item) => evidenceRefKey(item.ref) === manualEvidenceKey);
    return candidate ? [candidate.ref] : [];
  }

  if (workspace.status === "loading" || !loadedDraft) {
    return (
      <main className="page-shell">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (workspace.status === "error") {
    return (
      <main className="page-shell">
        <WorkspaceErrorState message={workspace.error} />
      </main>
    );
  }

  return (
    <main className="page-shell jobs-workspace">
      <section className="page-title">
        <p className="eyebrow">岗位工作区</p>
        <h1>岗位解析与简历建议</h1>
        <p>粘贴岗位描述，提取要求，匹配你的个人资料，并生成可审阅的简历修改建议。</p>
      </section>

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice" role="status" aria-live="polite">{message}</section> : null}
      {jobError ? (
        <section className="warning-box job-workflow-error" role="alert" data-error-code={jobError.code}>
          <div>
            <strong>{jobWorkflowErrorLabel(jobError.code)}</strong>
            <p>{jobError.message}</p>
          </div>
          <div className="action-row">
            {jobError.retryable && failedAction ? (
              <button className="secondary-button compact" type="button" onClick={retryFailedJobAction}>
                重试
              </button>
            ) : null}
            {draft && rawInput ? (
              <button className="secondary-button compact" type="button" onClick={() => { void enterManualMode(); }}>
                手动分类
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="stage-grid">
        <details className="panel job-create-disclosure">
          <summary>新增或更新岗位</summary>
          <div className="job-create-disclosure-body">
          <h2>粘贴岗位描述</h2>
          <div className="form-grid">
            <input data-testid="job-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="岗位名称" />
            <input data-testid="job-company-input" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="公司名称" />
          </div>
          <textarea data-testid="job-raw-textarea" className="textarea" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴岗位 JD 原文…" />
          <div className="action-row">
            <button className="primary-button" data-testid="save-job-raw-input" onClick={startImport}>
              保存原始JD
            </button>
            <span className={`save-status save-status-${saveStatus}`}>保存状态：{saveStatusLabel(saveStatus)}</span>
          </div>
          </div>
        </details>

        {draft?.status === "privacy_pending" ? (
          <article className="panel">
            <h2>2. 外部模型与隐私说明</h2>
            <p>系统会在服务端默认脱敏手机号、邮箱、身份证号和精确地址后再发送给外部模型。</p>
            <p>本次脱敏预览：{redactionPreview.redactions.length === 0 ? "未发现需脱敏内容" : redactionPreview.redactions.map((item) => `${item.type} x${item.count}`).join(" / ")}</p>
            <div className="action-row">
              <button className="primary-button" data-testid="job-analyze-ai" onClick={analyzeWithAi}>
                同意脱敏并解析
              </button>
              <button className="secondary-button" data-testid="job-manual-mode" onClick={enterManualMode}>
                拒绝，手动分类
              </button>
            </div>
          </article>
        ) : null}
      </section>

      {output ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>岗位要求草稿</h2>
              <p>确认后的要求才会进入正式岗位数据。删除前会提示影响。</p>
            </div>
            <button className="primary-button" data-testid="commit-job" onClick={commitJob} disabled={saveStatus === "saving" || draft?.status === "committed"}>
              提交正式岗位
            </button>
          </div>
          <div className="requirement-list">
            {output.requirements.map((requirement) => (
              <RequirementReviewRow key={requirement.id} requirement={requirement} onToggle={toggleRequirement} onRemove={removeRequirement} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="jobs-manager-grid">
        <aside className="panel jobs-list-panel">
          <div className="section-heading compact-heading">
            <div>
              <h2>岗位列表</h2>
              <p>{activeJobs.length} 个当前岗位 / {archivedJobs.length} 个已归档</p>
            </div>
          </div>
          <div className="action-row job-list-filter">
            <button className={jobListFilter === "active" ? "primary-button compact" : "secondary-button compact"} onClick={() => setJobListFilter("active")}>当前</button>
            <button className={jobListFilter === "archived" ? "primary-button compact" : "secondary-button compact"} onClick={() => setJobListFilter("archived")}>已归档</button>
          </div>
          <div className="job-list local-scroll">
            {visibleJobs.length > 0 ? visibleJobs.map((job) => (
              <button
                key={job.id}
                type="button"
                className={selectedJob?.id === job.id ? "match-row match-row-active" : "match-row"}
                onClick={() => {
                  setSelectedJobId(job.id);
                  setSelectedMatchId(undefined);
                  setAdaptationDraft(undefined);
                  setSuggestions([]);
                }}
              >
                <strong>{job.company} / {job.title}</strong>
                <span>{job.requirements.length} 条要求 / {job.source}</span>
              </button>
            )) : <p>当前筛选下没有岗位。</p>}
          </div>
        </aside>

        <section className="panel jobs-tab-panel">
          <div className="inspector-tablist jobs-tablist" role="tablist" aria-label="岗位内容">
            {(["info", "requirements", "resumes", "applications"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={jobWorkspaceTab === tab ? "inspector-tab inspector-tab-active" : "inspector-tab"}
                onClick={() => setJobWorkspaceTab(tab)}
                onKeyDown={(event) => handleJobTabKeyDown(event, tab)}
                role="tab"
                id={`job-tab-${tab}`}
                aria-controls={`job-tabpanel-${tab}`}
                aria-selected={jobWorkspaceTab === tab}
                tabIndex={jobWorkspaceTab === tab ? 0 : -1}
              >
                {jobWorkspaceTabLabel(tab)}
              </button>
            ))}
          </div>
          <div
            className="jobs-tab-content local-scroll"
            role="tabpanel"
            id={`job-tabpanel-${jobWorkspaceTab}`}
            aria-labelledby={`job-tab-${jobWorkspaceTab}`}
            tabIndex={0}
          >
            {!selectedJob ? <p>暂无正式岗位数据。</p> : null}
            {selectedJob && jobWorkspaceTab === "info" ? (
              <div className="job-detail-stack">
                <h3>{selectedJob.company} / {selectedJob.title}</h3>
                <dl className="info-list">
                  <div><dt>地点</dt><dd>{selectedJob.location ?? "未填写"}</dd></div>
                  <div><dt>工作类型</dt><dd>{selectedJob.workType ?? "未填写"}</dd></div>
                  <div><dt>行业</dt><dd>{selectedJob.industry ?? "未填写"}</dd></div>
                  <div><dt>来源</dt><dd>{selectedJob.source}</dd></div>
                </dl>
                <p className="raw-text">{selectedJob.rawText.slice(0, 900)}</p>
              </div>
            ) : null}
            {selectedJob && jobWorkspaceTab === "requirements" ? (
              <div className="requirement-list">
                {selectedJob.requirements.map((requirement) => (
                  <div key={requirement.id}>
                    <span><strong>{requirement.category}</strong> / {requirement.priority}</span>
                    <p>{requirement.description}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {selectedJob && jobWorkspaceTab === "resumes" ? (
              <div className="job-detail-stack">
                <h3>关联简历</h3>
                <p>在此运行经历匹配、生成可审计的简历建议，并在简历工作台中继续编辑。</p>
                <dl className="info-list">
                  <div><dt>匹配结果</dt><dd>{matches.length} 条</dd></div>
                  <div><dt>建议草稿</dt><dd>{adaptationDraft ? "已创建" : "未创建"}</dd></div>
                  <div><dt>AI建议</dt><dd>{suggestions.length} 条</dd></div>
                </dl>
              </div>
            ) : null}
            {selectedJob && jobWorkspaceTab === "applications" ? (
              <div className="job-detail-stack">
                <h3>求职进度</h3>
                <p>求职记录在求职工作台维护；这里保留岗位侧入口和状态摘要，避免把 Application 详情铺到岗位页面。</p>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="panel jobs-detail-panel">
          <div className="section-heading compact-heading">
            <div>
              <h2>岗位详情</h2>
              <p>归档不会删除正式岗位数据。</p>
            </div>
          </div>
          {selectedJob ? (
            <div className="job-detail-stack local-scroll">
              <strong>{selectedJob.company} / {selectedJob.title}</strong>
              <span>{selectedJob.requirements.length} 条要求</span>
              <div className="action-row">
                {archivedJobIds.includes(selectedJob.id) ? (
                  <button className="primary-button compact" onClick={() => { void restoreSelectedJob(); }}>恢复</button>
                ) : (
                  <button className="secondary-button compact" onClick={() => { void archiveSelectedJob(); }}>归档</button>
                )}
                <button className="danger-button compact" onClick={() => { void requestSafeJobDelete(); }}>删除</button>
              </div>
              <div className="profile-source-list">
                <strong>本地说明</strong>
                <p>编辑岗位信息请从上方 JD 草稿重新提交；这能保留来源文本和要求解析链路。</p>
              </div>
            </div>
          ) : <p>请选择一个岗位。</p>}
        </aside>
      </section>

      <section className="panel legacy-job-panel-hidden" aria-hidden="true">
        <h2>当前正式岗位数据</h2>
        {jobs.length > 0 ? (
          <label className="field-label">
            当前岗位
            <select data-testid="current-job-select" value={selectedJob?.id ?? ""} onChange={(event) => {
              setSelectedJobId(event.target.value);
              setSelectedMatchId(undefined);
              setAdaptationDraft(undefined);
              setSuggestions([]);
            }}>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.company} / {job.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="job-list">
          {jobs.length > 0 ? (
            jobs.map((job) => (
              <article key={job.id}>
                <h3>
                  {job.company} / {job.title}
                </h3>
                <p>{job.requirements.length} 条要求，来源：{job.source}</p>
              </article>
            ))
          ) : (
            <p>暂无正式岗位数据。</p>
          )}
        </div>
      </section>

      {profile && selectedJob && jobWorkspaceTab === "resumes" ? (
        <section className="panel job-resume-flow" data-testid="job-resume-flow">
          <ol className="job-resume-steps" aria-label="岗位简历生成流程">
            <li className="is-complete">选择岗位</li>
            <li className={selectedBaseResume ? "is-complete" : "is-current"}>选择通用简历</li>
            <li className={matchState.ready ? "is-complete" : selectedBaseResume ? "is-current" : ""}>检查匹配</li>
            <li className={matchState.ready ? "is-current" : ""}>生成岗位简历</li>
            <li>AI 优化</li>
          </ol>
          <div className="section-heading">
            <div>
              <h2>为当前岗位生成独立简历</h2>
              <p>先明确选择一份通用简历，再检查匹配。生成后会直接进入该岗位简历，不会修改来源简历。</p>
            </div>
          </div>
          <div className="job-match-source">
            <label className="field-label" htmlFor="job-match-base-resume">
              来源通用简历
              <select id="job-match-base-resume" value={selectedBaseResumeId} onChange={(event) => {
                setSelectedBaseResumeId(event.target.value);
                setMatches([]);
                setSelectedMatchId(undefined);
                setAdaptationDraft(undefined);
                setSuggestions([]);
                setResumeActionStatus("idle");
                setDerivationPrompt(undefined);
              }}>
                <option value="">请选择一份简历</option>
                {baseResumeOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <p>{baseResumeOptions.length === 0
              ? "暂无可用通用简历。请先在简历中心创建或恢复一份有正式正文的通用简历。"
              : selectedBaseResume
                ? `已选择“${selectedBaseResume.name}”第 ${selectedBaseResume.revision + 1} 个正式版本。`
                : "请选择一份通用简历。系统不会默认选择第一份。"}</p>
          </div>
          <div className={`job-resume-readiness ${matchState.ready ? "is-ready" : ""}`} role="status" aria-live="polite">
            <strong>{matchState.ready ? "匹配可用于生成" : "下一步"}</strong>
            <span>{matchState.message}</span>
            <small>{jobResumeActionStatusLabel(resumeActionStatus)}</small>
          </div>
          <div className="action-row job-resume-primary-actions">
            <button className={matchState.ready ? "secondary-button" : "primary-button"} data-testid="run-experience-match" onClick={runRuleMatcher} disabled={!selectedBaseResume || resumeActionStatus === "matching"}>
              {resumeActionStatus === "matching" ? "匹配中…" : matches.length > 0 ? "重新运行匹配" : "运行规则匹配"}
            </button>
            <button className="secondary-button" data-testid="run-ai-evidence-explanation" onClick={runAiEvidenceMatcher} disabled={!matchState.hasFreshRuleMatch || resumeActionStatus === "evaluating"}>
              {resumeActionStatus === "evaluating" ? "评估中…" : "运行 AI 证据评估"}
            </button>
            <button className={matchState.ready ? "primary-button" : "secondary-button"} data-testid="generate-job-resume" onClick={() => { void prepareJobResumeDerivation(); }} disabled={!matchState.ready || resumeActionStatus === "preparing" || resumeActionStatus === "saving"}>
              {resumeActionStatus === "preparing" ? "准备中…" : resumeActionStatus === "saving" ? "保存中…" : "生成岗位简历"}
            </button>
          </div>

          {derivationPrompt ? (
            <div className="job-derivation-prompt" role="dialog" aria-modal="false" aria-labelledby="job-derivation-prompt-title">
              <div>
                <h3 id="job-derivation-prompt-title">{derivationPrompt.kind === "same_version"
                  ? "已存在基于当前通用简历版本生成的岗位简历。"
                  : "通用简历在岗位分支创建后发生了变化。"}</h3>
                <p>{derivationPrompt.kind === "same_version"
                  ? "你可以打开已有岗位简历，或明确重新生成一个新分支。"
                  : "不会自动覆盖旧岗位简历。你可以保持当前岗位简历，或基于最新通用简历新建分支。"}</p>
              </div>
              <div className="action-row">
                <button className="primary-button" type="button" onClick={() => openExistingJobResume(derivationPrompt.existingBranch)}>
                  {derivationPrompt.kind === "same_version" ? "打开已有岗位简历" : "保持并打开当前岗位简历"}
                </button>
                <button className="secondary-button" type="button" onClick={() => { void createAndOpenJobResume(true); }}>
                  {derivationPrompt.kind === "same_version" ? "重新生成新分支" : "基于最新版本新建"}
                </button>
                <button className="secondary-button" type="button" onClick={() => setDerivationPrompt(undefined)}>
                  {derivationPrompt.kind === "same_version" ? "取消" : "稍后处理"}
                </button>
              </div>
            </div>
          ) : null}

          {matches.length === 0 ? (
            <p className="empty-copy">尚未生成匹配结果。选择来源简历后运行规则匹配。</p>
          ) : (
            <details className="job-match-details">
              <summary>查看 {matches.length} 条岗位匹配详情</summary>
              <div className="match-layout">
              <div className="match-list">
                {matches.map((match) => {
                  const effective = resolveEffectiveMatch(match);
                  const stale = checkRequirementMatchStale(match, { profile: matchingProfile ?? profile, job: selectedJob });
                  const sourceStale = selectedBaseResume?.currentRevisionId
                    ? checkRequirementMatchResumeSourceStale(match, {
                      branchId: selectedBaseResume.id,
                      branchRevision: selectedBaseResume.revision,
                      revisionId: selectedBaseResume.currentRevisionId
                    })
                    : { isStale: true };
                  return (
                    <button
                      className={`match-row ${match.id === selectedMatch?.id ? "match-row-active" : ""}`}
                      key={match.id}
                      onClick={() => setSelectedMatchId(match.id)}
                    >
                      <strong>{selectedJob.requirements.find((item) => item.id === match.requirementId)?.description}</strong>
                      <span>{matchLevelLabel(effective.matchLevel)} / {riskLabel(effective.riskLevel)} / {sourceLabel(effective.source)}{stale.isStale || sourceStale.isStale ? " / 已过期" : ""}</span>
                    </button>
                  );
                })}
              </div>

              {selectedMatch ? (
                <MatchDetail
                  match={selectedMatch}
                  profile={matchingProfile ?? profile}
                  job={selectedJob}
                  manualLevel={manualLevel}
                  manualRisk={manualRisk}
                  manualReason={manualReason}
                  manualEvidenceKey={manualEvidenceKey}
                  manualCandidates={manualCandidates}
                  onManualLevel={setManualLevel}
                  onManualRisk={setManualRisk}
                  onManualReason={setManualReason}
                  onManualEvidence={setManualEvidenceKey}
                  onSaveManual={() => saveManualOverride(selectedMatch)}
                />
              ) : null}
              </div>
            </details>
          )}
        </section>
      ) : null}

      {profile && selectedJob && jobWorkspaceTab === "resumes" ? (
        <section className="panel legacy-job-panel-hidden" aria-hidden="true">
          <div className="section-heading">
            <div>
              <h2>AI简历建议与事实安全检查</h2>
              <p>只读取未过期的匹配结果；建议会先进入草稿，接受前不会修改个人资料。</p>
            </div>
            <div className="action-row">
              <button className="primary-button" data-testid="create-suggestion-draft" onClick={createC2Draft} disabled={matches.length === 0 || c2Status === "running"}>
                创建建议草稿
              </button>
              <button className="secondary-button" data-testid="generate-ai-suggestions" onClick={generateC2Suggestions} disabled={matches.length === 0 || c2Status === "running"}>
                生成AI建议
              </button>
            </div>
          </div>

          {adaptationDraft ? (
            <div className="c2-layout">
              <article className="draft-preview">
                <h3>建议草稿</h3>
                {adaptationDraft.sectionTexts.map((section) => (
                  <p key={section.sectionId}><strong>{section.sectionType}</strong>：{section.text}</p>
                ))}
              </article>
              <div className="suggestion-list">
                {suggestions.length === 0 ? <p>尚未生成建议。</p> : suggestions.map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    editedText={editedSuggestions[suggestion.id] ?? suggestion.editedText ?? ""}
                    onEditedText={(text) => setEditedSuggestions((current) => ({ ...current, [suggestion.id]: text }))}
                    onAccept={() => acceptSuggestion(suggestion)}
                    onReject={() => rejectSuggestion(suggestion)}
                    onEditGuard={() => editAndGuardSuggestion(suggestion)}
                    onRerunGuard={() => rerunGuardSuggestion(suggestion)}
                    onUndo={() => undoSuggestion(suggestion)}
                  />
                ))}
              </div>
            </div>
          ) : (
            <p>请先创建建议草稿。若任一引用匹配过期，系统会要求重新运行经历匹配。</p>
          )}
        </section>
      ) : null}
    </main>
  );
}

function profileLimitedToResume(profile: CareerProfile, branch: ResumeBranch): CareerProfile {
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

function isMatchBaseResume(branch: ResumeBranch) {
  return branch.branchPurpose === "general"
    && branch.lifecycleStatus === "active"
    && branch.migrationStatus === "verified"
    && Boolean(branch.currentRevisionId)
    && branch.syncStatusCache.status !== "invalid_reference";
}

function latestMatchesForResume(matches: RequirementMatch[], branchId: string) {
  const latestByRequirement = new Map<string, RequirementMatch>();
  for (const match of [...matches]
    .filter((candidate) => candidate.sourceResumeBranchId === branchId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (!latestByRequirement.has(match.requirementId)) latestByRequirement.set(match.requirementId, match);
  }
  return [...latestByRequirement.values()];
}

function getJobResumeMatchState(input: {
  profile?: CareerProfile;
  job?: JobDescription;
  branch?: ResumeBranch;
  matches: RequirementMatch[];
}) {
  if (!input.branch) {
    return { ready: false, hasFreshRuleMatch: false, message: "请选择一份通用简历。" };
  }
  if (!input.profile || !input.job || !input.branch.currentRevisionId) {
    return { ready: false, hasFreshRuleMatch: false, message: "来源简历或岗位引用已失效。" };
  }
  if (input.job.requirements.length === 0) {
    return { ready: false, hasFreshRuleMatch: false, message: "当前岗位没有有效岗位要求，不能生成岗位简历。" };
  }
  if (input.matches.length === 0) {
    return { ready: false, hasFreshRuleMatch: false, message: "尚无匹配结果，请运行规则匹配。" };
  }

  const source = {
    branchId: input.branch.id,
    branchRevision: input.branch.revision,
    revisionId: input.branch.currentRevisionId
  };
  const stale = input.matches.some((match) =>
    checkRequirementMatchStale(match, { profile: input.profile!, job: input.job! }).isStale
    || checkRequirementMatchResumeSourceStale(match, source).isStale
  );
  const requirementIds = new Set(input.matches.map((match) => match.requirementId));
  const complete = input.job.requirements.every((requirement) => requirementIds.has(requirement.id));
  if (stale || !complete) {
    return { ready: false, hasFreshRuleMatch: false, message: "匹配已过期或不完整，请基于当前通用简历版本重新运行规则匹配。" };
  }
  if (collectAllowedEvidenceRefs(input.matches).length === 0) {
    return { ready: false, hasFreshRuleMatch: true, message: "匹配中没有可使用的已确认事实，请先补充或确认个人资料事实。" };
  }
  return {
    ready: true,
    hasFreshRuleMatch: true,
    message: `已核对 ${input.matches.length} 条岗位要求，可生成独立岗位简历。`
  };
}

function jobResumeActionStatusLabel(status: JobResumeActionStatus) {
  const labels: Record<JobResumeActionStatus, string> = {
    idle: "等待下一步",
    matching: "匹配中…",
    evaluating: "AI 证据评估中…",
    preparing: "准备中…",
    saving: "保存中…",
    completed: "已完成",
    failed: "已失败"
  };
  return labels[status];
}

function uniqueBranchName(baseName: string, branches: ResumeBranch[]) {
  const names = new Set(branches.map((branch) => branch.name));
  if (!names.has(baseName)) return baseName;
  const dated = `${baseName} - ${new Date().toISOString().slice(0, 10)}`;
  if (!names.has(dated)) return dated;
  let sequence = 2;
  while (names.has(`${dated} - ${sequence}`)) sequence += 1;
  return `${dated} - ${sequence}`;
}

function SuggestionCard({
  suggestion,
  editedText,
  onEditedText,
  onAccept,
  onReject,
  onEditGuard,
  onRerunGuard,
  onUndo
}: {
  suggestion: AiSuggestion;
  editedText: string;
  onEditedText: (text: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onEditGuard: () => void;
  onRerunGuard: () => void;
  onUndo: () => void;
}) {
  const canAccept = (suggestion.guardResult.status === "pass" || suggestion.guardResult.status === "ai_failed_rule_kept")
    && suggestion.status !== "blocked_high_risk"
    && suggestion.riskLevel !== "high";

  return (
    <article className={`suggestion-card suggestion-card-${suggestion.guardResult.riskLevel}`}>
      <div className="section-heading compact-heading">
        <div>
          <h3>{suggestion.type} / {suggestion.status}</h3>
          <p>风险：{suggestion.guardResult.status} / {suggestion.guardResult.riskLevel}</p>
        </div>
      </div>
      <p><strong>原文：</strong>{suggestion.originalText}</p>
      <p><strong>建议：</strong>{suggestion.suggestedText}</p>
      <p><strong>原因：</strong>{suggestion.reason}</p>
      <p><strong>岗位依据：</strong>{suggestion.requirementIds.join(" / ")}</p>
      <div className="evidence-list">
        {suggestion.usedEvidenceRefs.length > 0 ? suggestion.usedEvidenceRefs.map((ref) => (
          <p key={evidenceRefKey(ref)}><strong>事实依据：</strong>{ref.factText}</p>
        )) : <p>无可引用事实，不能补写新事实。</p>}
      </div>
      {suggestion.guardResult.ruleFindings.length > 0 ? (
        <div className="warning-box">
          {suggestion.guardResult.ruleFindings.map((finding) => (
            <p key={`${finding.type}-${finding.text}`}>{finding.type}：{finding.text} / {finding.message}</p>
          ))}
        </div>
      ) : null}
      <textarea
        className="textarea small-textarea"
        value={editedText}
        onChange={(event) => onEditedText(event.target.value)}
        placeholder="编辑后必须重新检测，不能在建议卡片中直接确认新增事实。"
      />
      <div className="action-row">
        <button className="primary-button" onClick={onAccept} disabled={!canAccept}>接受</button>
        <button className="secondary-button" onClick={onReject}>拒绝</button>
        <button className="secondary-button" onClick={onEditGuard}>编辑后检测</button>
        <button className="secondary-button" onClick={onRerunGuard}>重新检测</button>
        <button className="secondary-button" onClick={onUndo}>撤销</button>
      </div>
    </article>
  );
}

function MatchDetail({
  match,
  profile,
  job,
  manualLevel,
  manualRisk,
  manualReason,
  manualEvidenceKey,
  manualCandidates,
  onManualLevel,
  onManualRisk,
  onManualReason,
  onManualEvidence,
  onSaveManual
}: {
  match: RequirementMatch;
  profile: CareerProfile;
  job: JobDescription;
  manualLevel: MatchEvaluation["matchLevel"];
  manualRisk: MatchEvaluation["riskLevel"];
  manualReason: string;
  manualEvidenceKey: string;
  manualCandidates: ReturnType<typeof recallCandidatesForRequirement>;
  onManualLevel: (level: MatchEvaluation["matchLevel"]) => void;
  onManualRisk: (risk: MatchEvaluation["riskLevel"]) => void;
  onManualReason: (reason: string) => void;
  onManualEvidence: (key: string) => void;
  onSaveManual: () => void;
}) {
  const effective = resolveEffectiveMatch(match);
  const stale = checkRequirementMatchStale(match, { profile, job });
  const requirement = job.requirements.find((item) => item.id === match.requirementId);

  return (
    <article className="match-detail">
      {stale.isStale ? <div className="warning-box">该匹配已过期，需要重新运行经历匹配后才能继续使用。</div> : null}
      <h3>{requirement?.description}</h3>
      <p><strong>岗位原文：</strong>{match.requirementQuote.text}</p>
      <p><strong>有效结果：</strong>{matchLevelLabel(effective.matchLevel)} / {riskLabel(effective.riskLevel)} / 来源：{sourceLabel(effective.source)}</p>
      <p><strong>解释：</strong>{effective.explanation}</p>
      <div className="evidence-list">
        {effective.evidenceRefs.length > 0 ? effective.evidenceRefs.map((ref) => (
          <p key={evidenceRefKey(ref)}><strong>事实依据：</strong>{ref.factText}<br /><small>{ref.factQuote}</small></p>
        )) : <p>当前无证据。</p>}
      </div>
      <div className="manual-override">
        <h4>人工覆盖</h4>
        <div className="form-grid">
          <select value={manualLevel} onChange={(event) => onManualLevel(event.target.value as MatchEvaluation["matchLevel"])}>
            <option value="strong">直接匹配</option>
            <option value="weak">部分匹配</option>
            <option value="transferable">可迁移</option>
            <option value="none">暂无匹配</option>
          </select>
          <select value={manualRisk} onChange={(event) => onManualRisk(event.target.value as MatchEvaluation["riskLevel"])}>
            <option value="low">低风险</option>
            <option value="medium">中风险</option>
            <option value="high">高风险</option>
          </select>
        </div>
        {manualLevel !== "none" ? (
          <select value={manualEvidenceKey} onChange={(event) => onManualEvidence(event.target.value)}>
            <option value="">选择已确认事实</option>
            {manualCandidates.map((candidate) => (
              <option key={evidenceRefKey(candidate.ref)} value={evidenceRefKey(candidate.ref)}>
                {candidate.ref.factText}
              </option>
            ))}
          </select>
        ) : null}
        <textarea className="textarea small-textarea" value={manualReason} onChange={(event) => onManualReason(event.target.value)} placeholder="填写人工覆盖说明..." />
        <button className="secondary-button" onClick={onSaveManual}>保存人工覆盖</button>
      </div>
    </article>
  );
}

function matchLevelLabel(level: MatchEvaluation["matchLevel"]) {
  return {
    strong: "直接匹配",
    weak: "部分匹配",
    transferable: "可迁移",
    none: "暂无匹配"
  }[level];
}

function riskLabel(risk: MatchEvaluation["riskLevel"]) {
  return {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  }[risk];
}

function sourceLabel(source: string) {
  return {
    rule: "规则",
    ai: "AI解释",
    manual: "人工确认",
    fallback: "本地规则"
  }[source] ?? source;
}

function jobWorkspaceTabLabel(tab: JobWorkspaceTab) {
  const labels: Record<JobWorkspaceTab, string> = {
    info: "岗位信息",
    requirements: "岗位要求",
    resumes: "关联简历",
    applications: "求职进度"
  };
  return labels[tab];
}

function parseArchivedJobIds(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function saveStatusLabel(status: "idle" | "saving" | "saved" | "failed" | "conflict") {
  return {
    idle: "等待保存",
    saving: "保存中",
    saved: "已保存",
    failed: "保存失败",
    conflict: "需要刷新后重试"
  }[status];
}

function jobWorkflowErrorLabel(code: JobWorkflowErrorState["code"]) {
  return {
    empty_input: "输入不完整",
    text_too_short: "JD 文本过短",
    schema_validation_failed: "岗位数据校验失败",
    ai_invalid_output: "AI 返回无效",
    repository_save_failed: "岗位保存失败",
    revision_conflict: "岗位草稿已变化",
    unknown_error: "未知错误"
  }[code];
}

function RequirementReviewRow({
  requirement,
  onToggle,
  onRemove
}: {
  requirement: JdAnalyzerRequirement;
  onToggle: (requirementId: string, checked: boolean) => void;
  onRemove: (requirementId: string) => void;
}) {
  return (
    <div className="review-row">
      <input
        type="checkbox"
        aria-label={`确认岗位要求：${requirement.description}`}
        checked={requirement.confirmedByUser}
        disabled={!requirement.sourceSpan}
        onChange={(event) => onToggle(requirement.id, event.target.checked)}
      />
      <span>
        <strong>{requirement.description}</strong>
        <small>
          {requirement.category} / {requirement.priority} / {requirement.confidenceLevel} / 原文：
          {requirement.sourceSpan?.text ?? "未定位，待确认"}
        </small>
      </span>
      <button className="secondary-button compact" onClick={() => onRemove(requirement.id)}>
        删除
      </button>
    </div>
  );
}
