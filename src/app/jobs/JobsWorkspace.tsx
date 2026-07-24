"use client";

import { nanoid } from "nanoid";
import { Archive, BriefcaseBusiness, Database, FileText, KanbanSquare, ListChecks, LoaderCircle, MoreHorizontal, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { invokeStageBAi, invokeStructuredAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { analyzeJobDescriptionV4, projectJobGraphV4ToAnalyzerOutput } from "@/domain/jobOptimization";
import {
  EvidenceMatcherOutputSchema,
  JdAnalyzerModelOutputSchema,
  MatchEvaluationSchema,
  type CareerProfile,
  type JdAnalyzerOutput,
  type JdAnalyzerRequirement,
  type JobAnalysisDraft,
  type JobDescription,
  type JobWorkflowErrorState,
  type MatchEvaluation,
  type RawInputDocument,
  type RequirementMatch,
  type ResumeBranch
} from "@/domain/schemas";
import {
  createRuleRequirementMatches,
  recallCandidatesForRequirement,
  withResolvedEffectiveMatch
} from "@/domain/match/matcher";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { ProductTopbar } from "@/components/ui/product";
import { hashText, redactSensitiveTextForModel, stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import {
  commitParsedJob,
  jobResumeGenerationFeedback,
  jobWorkflowErrorState,
  appendJobAnalysisRun,
  recoverInterruptedJobAnalysis,
  mapJobResumeGenerationError,
  updateRequirementConfirmation,
  validateJobInput,
  type JobResumeGenerationErrorCode
} from "@/services/jobs/jobWorkflow";
import {
  analyzeProfileLibrarySource,
  recommendJobResumeSource,
  type ProfileLibrarySourceAnalysis
} from "@/services/jobs/jobResumeSourceModes";
import { hasCustomAiSettings } from "@/services/storage/aiSettings";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { notify } from "@/services/notifications/store";
import { createJobResume } from "@/services/jobs/tailoringService";

const repository = new WorkspaceRepository();
const jobArchiveKey = "jobWorkspace:archivedJobIds";

type JobWorkspaceTab = "resumes" | "info" | "requirements" | "applications";
type JobListFilter = "active" | "archived";
type SourceMode = "profile" | "resume";
type JobResumeActionStatus = "idle" | "matching" | "analyzing" | "saving" | "completed" | "failed";
type JobFailedAction = "start_import" | "analyze" | "commit";

export function JobsWorkspace() {
  const router = useRouter();
  const workspace = useWorkspace(repository);
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument>();
  const [draft, setDraft] = useState<JobAnalysisDraft>();
  const [isJobAnalysisDialogOpen, setJobAnalysisDialogOpen] = useState(false);
  const [loadedDraft, setLoadedDraft] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [jobError, setJobError] = useState<JobWorkflowErrorState>();
  const [failedAction, setFailedAction] = useState<JobFailedAction>();
  const [selectedJobId, setSelectedJobId] = useState(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("jobId") ?? "");
  const [jobListFilter, setJobListFilter] = useState<JobListFilter>("active");
  const [archivedJobIds, setArchivedJobIds] = useState<string[]>([]);
  const [trashedJobIds, setTrashedJobIds] = useState<string[]>([]);
  const [tab, setTab] = useState<JobWorkspaceTab>("resumes");
  const [showJobMenu, setShowJobMenu] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("profile");
  const [resumeBranches, setResumeBranches] = useState<ResumeBranch[]>([]);
  const [selectedBaseResumeId, setSelectedBaseResumeId] = useState("");
  const [matches, setMatches] = useState<RequirementMatch[]>([]);
  const [showMatchDetails, setShowMatchDetails] = useState(false);
  const [resumeActionStatus, setResumeActionStatus] = useState<JobResumeActionStatus>("idle");
  const [generationErrorCode, setGenerationErrorCode] = useState<JobResumeGenerationErrorCode>();
  const [profileAnalysis, setProfileAnalysis] = useState<ProfileLibrarySourceAnalysis>();
  const [selectedProfileItemIds, setSelectedProfileItemIds] = useState<string[]>([]);
  const [existingJobBranch, setExistingJobBranch] = useState<ResumeBranch | null>(null);

  useEffect(() => {
    let active = true;
    void repository.getLatestActiveJobAnalysisDraft().then(async (latest) => {
      if (!active || !latest) { setLoadedDraft(true); return; }
      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) return;
      const recovered = recoverInterruptedJobAnalysis(latest);
      const persisted = recovered === latest ? latest : await repository.saveJobAnalysisDraftRevision(recovered, latest.revision);
      if (!active) return;
      setDraft(persisted); setTitle(persisted.title); setCompany(persisted.company); setRawInput(raw); setRawText(raw?.rawText ?? ""); setLoadedDraft(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getMeta(jobArchiveKey), repository.getRecycleBinState()]).then(([stored, recycleBin]) => {
      if (!active) return;
      setArchivedJobIds(parseArchivedJobIds(stored?.value)); setTrashedJobIds(recycleBin.jobIds);
    });
    return () => { active = false; };
  }, []);

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = useMemo(() => workspace.status === "ready" ? workspace.jobs : [], [workspace]);
  const activeJobs = jobs.filter((job) => !archivedJobIds.includes(job.id) && !trashedJobIds.includes(job.id));
  const archivedJobs = jobs.filter((job) => archivedJobIds.includes(job.id) && !trashedJobIds.includes(job.id));
  const visibleJobs = jobListFilter === "active" ? activeJobs : archivedJobs;
  const selectedJob = jobs.find((job) => job.id === selectedJobId && !trashedJobIds.includes(job.id)) ?? visibleJobs[0] ?? activeJobs[0] ?? archivedJobs[0];
  const baseResumeOptions = resumeBranches.filter(isMatchBaseResume);
  const selectedBaseResume = baseResumeOptions.find((branch) => branch.id === selectedBaseResumeId);
  const matchingProfile = profile && selectedBaseResume ? profileLimitedToResume(profile, selectedBaseResume) : undefined;
  const output = draft?.analyzerOutput ?? (draft ? { requirements: draft.manualRequirements, riskNotes: draft.riskNotes } : undefined);
  const redactionPreview = useMemo(() => redactSensitiveTextForModel(rawText), [rawText]);
  const availableProfileItems = profile ? canonicalProfileLibraryItems(profile).length : 0;
  const recommendation = recommendJobResumeSource({
    profileItemCount: profileAnalysis?.availableItemCount ?? availableProfileItems,
    profileEvidenceCount: profileAnalysis?.availableEvidenceCount ?? profile?.structuredFacts?.flatMap((item) => item.factIds).length ?? 0,
    generalResumeCount: baseResumeOptions.length
  });

  useEffect(() => {
    if (!profile) return;
    let active = true;
    void repository.listResumeBranches(profile.id).then((branches) => {
      if (!active) return;
      setResumeBranches(branches);
      setSelectedBaseResumeId((current) => branches.some((branch) => branch.id === current && isMatchBaseResume(branch)) ? current : "");
    });
    return () => { active = false; };
  }, [profile]);

  useEffect(() => {
    if (!profile || !selectedJob || !selectedBaseResumeId) return;
    let active = true;
    void repository.listRequirementMatches(profile.id, selectedJob.id).then((stored) => {
      if (active) setMatches(latestMatchesForResume(stored, selectedBaseResumeId));
    });
    return () => { active = false; };
  }, [profile, selectedBaseResumeId, selectedJob]);

  async function startImport() {
    try {
      const validated = validateJobInput({ title, company, rawText });
      const now = new Date().toISOString();
      const inputHash = await hashText(`${validated.title}\n${validated.company}\n${validated.rawText}`);
      const inputChanged = inputHash !== rawInput?.inputHash;
      const nextRawInput: RawInputDocument = { id: rawInput?.id ?? `raw-${nanoid(10)}`, kind: "job_jd", rawText: validated.rawText, inputHash, title: `${validated.company} / ${validated.title}`, createdAt: rawInput?.createdAt ?? now, updatedAt: now };
      await repository.saveRawInput(nextRawInput);
      const nextDraft: JobAnalysisDraft = {
        id: draft?.id ?? `job-draft-${nanoid(10)}`, rawInputId: nextRawInput.id, revision: draft?.revision ?? 0,
        title: validated.title, company: validated.company, status: "privacy_pending", promptVersion: promptVersions.jdAnalyzer,
        attemptCount: inputChanged ? 0 : draft?.attemptCount ?? 0,
        analyzerOutput: inputChanged ? undefined : draft?.analyzerOutput,
        requirementGraph: inputChanged ? undefined : draft?.requirementGraph,
        analysisIssues: inputChanged ? [] : draft?.analysisIssues ?? [],
        manualRequirements: inputChanged ? [] : draft?.manualRequirements ?? [], riskNotes: inputChanged ? [] : draft?.riskNotes ?? [],
        committedJobId: draft?.committedJobId, committedAt: draft?.committedAt,
        analysisRunStatus: "saved",
        analysisRuns: inputChanged ? [{ id: `job-run-${nanoid(8)}`, startedAt: now, status: "saved", analyzerVersion: "jd-analyzer.semantic-ledger-v4.0" }] : draft?.analysisRuns ?? [],
        createdAt: draft?.createdAt ?? now, updatedAt: now
      };
      const saved = draft ? await repository.saveJobAnalysisDraftRevision(nextDraft, draft.revision) : await repository.createJobAnalysisDraft(nextDraft);
      setRawInput(nextRawInput); setDraft(saved); setJobAnalysisDialogOpen(true); setSaveStatus("saved"); setJobError(undefined); setFailedAction(undefined);
      notify({ type: "success", title: "岗位已保存", message: "原始 JD 已安全保留。确认隐私说明后即可开始解析。" });
    } catch (error) {
      const state = jobWorkflowErrorState(error, "repository_save_failed");
      setJobError(state); setFailedAction("start_import"); setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      notify({ type: "error", title: jobWorkflowErrorLabel(state.code), message: state.message });
    }
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) return;
    try {
      notify({ type: "info", title: "正在解析岗位", message: "系统会先脱敏，再校验 AI 返回的岗位要求。" });
      const currentRun = draft.analysisRuns?.at(-1) ?? { id: `job-run-${nanoid(8)}`, startedAt: new Date().toISOString(), status: "saved" as const, analyzerVersion: "jd-analyzer.semantic-ledger-v4.0" };
      const localAnalyzing = await saveDraft(appendJobAnalysisRun({ ...draft, title, company, status: "analyzing" }, { ...currentRun, status: "local_analyzing" }));
      const deterministic = analyzeJobDescriptionV4({ rawText: rawInput.rawText });
      const deterministicGraph = deterministic.graph;
      const analyzing = await saveDraft(appendJobAnalysisRun({ ...localAnalyzing, requirementGraph: deterministicGraph }, { ...currentRun, status: "ai_analyzing", sourceUnitCount: deterministic.provisionalUnits.length, graphHash: deterministicGraph.graphHash }));
      const result = await invokeStageBAi({ task: "jd-analyzer", businessInput: {
        title, company, rawText: rawInput.rawText, inputHash: rawInput.inputHash,
        sourceUnits: deterministic.provisionalUnits,
        deterministicGroups: deterministicGraph.groups,
        deterministicHierarchy: deterministic.provisionalUnits.map((unit) => ({ sourceUnitId: unit.id, detailUnitIds: deterministic.provisionalUnits.filter((candidate) => candidate.provisional.parentUnitId === unit.id).map((candidate) => candidate.id) }))
      }, outputSchema: JdAnalyzerModelOutputSchema });
      await repository.saveAiLogs([result.log]);
      if (!result.ok) {
        const fallback = projectJobGraphV4ToAnalyzerOutput({ graph: deterministicGraph, title, company });
        const analysisIssues = deterministic.validation.issues.map((item) => item.message);
        const saved = await saveDraft(appendJobAnalysisRun({ ...analyzing, status: deterministic.validation.status === "validated" ? "manual_mode" : "needs_review", attemptCount: analyzing.attemptCount + 1, manualRequirements: fallback.requirements, requirementGraph: deterministicGraph, analysisIssues, riskNotes: fallback.riskNotes, saveError: result.errorCode }, { ...currentRun, status: "local_ready_ai_failed", finishedAt: new Date().toISOString(), sourceUnitCount: deterministic.provisionalUnits.length, assignmentCount: 0, graphHash: deterministicGraph.graphHash, errorCode: result.errorCode }));
        setDraft(saved); setJobError(undefined); setFailedAction("analyze");
        notify({ type: "warning", title: "本地解析已完成，AI 增强未完成", message: "岗位职责、条件和申请材料已经整理完成。你可以直接核对并提交，或重试 AI 增强。" });
        return;
      }
      const modelOutput = { ...result.data, requirements: [] };
      const reconciled = analyzeJobDescriptionV4({ rawText: rawInput.rawText, aiAssignments: result.data.unitAssignments });
      const projection = projectJobGraphV4ToAnalyzerOutput({ graph: reconciled.graph, title, company });
      const analyzerOutput = { ...modelOutput, requirements: projection.requirements, riskNotes: [...result.data.riskNotes, ...projection.riskNotes] };
      const analysisIssues = reconciled.validation.issues.map((item) => item.message);
      const saved = await saveDraft(appendJobAnalysisRun({ ...analyzing, status: reconciled.validation.status === "validated" ? "ai_validated" : "needs_review", attemptCount: analyzing.attemptCount + 1, promptVersion: result.promptVersion, analyzerOutput, requirementGraph: reconciled.graph, analysisIssues, riskNotes: analyzerOutput.riskNotes, saveError: undefined }, { ...currentRun, status: "review_ready", finishedAt: new Date().toISOString(), sourceUnitCount: deterministic.provisionalUnits.length, assignmentCount: result.data.unitAssignments.length, graphHash: reconciled.graph.graphHash, semanticEnrichmentHash: reconciled.graph.semanticEnrichmentHash }));
      setDraft(saved); setJobError(undefined); setFailedAction(undefined);
      notify(reconciled.validation.status === "validated"
        ? { type: "success", title: "岗位解析完成", message: "请核对要求与原文依据，再提交正式岗位。" }
        : { type: "warning", title: "岗位解析需要核对", message: analysisIssues.join("；") || "部分来源尚未完整覆盖，请核对缺失区域。" });
    } catch {
      const validation = analyzeJobDescriptionV4({ rawText: rawInput.rawText });
      const fallback = projectJobGraphV4ToAnalyzerOutput({ graph: validation.graph, title, company });
      try {
        const currentRun = draft.analysisRuns?.at(-1) ?? { id: `job-run-${nanoid(8)}`, startedAt: new Date().toISOString(), status: "saved" as const, analyzerVersion: "jd-analyzer.semantic-ledger-v4.0" };
        const saved = await saveDraft(appendJobAnalysisRun({ ...draft, status: validation.validation.status === "validated" ? "manual_mode" : "needs_review", attemptCount: draft.attemptCount + 1, manualRequirements: fallback.requirements, requirementGraph: validation.graph, analysisIssues: validation.validation.issues.map((item) => item.message), riskNotes: fallback.riskNotes, saveError: "provider_unavailable" }, { ...currentRun, status: "local_ready_ai_failed", finishedAt: new Date().toISOString(), graphHash: validation.graph.graphHash, errorCode: "provider_unavailable" }));
        setDraft(saved);
      } catch { /* The persistent error card retains the original input. */ }
      setJobError(undefined); setFailedAction("analyze");
      notify({ type: "warning", title: "本地解析已完成，AI 增强未完成", message: "岗位职责、条件和申请材料已经整理完成。你可以直接核对并提交，或重试 AI 增强。" });
    }
  }

  async function enterManualMode() {
    if (!draft || !rawInput) return;
    try {
      const validation = analyzeJobDescriptionV4({ rawText: rawInput.rawText });
      const fallback = projectJobGraphV4ToAnalyzerOutput({ graph: validation.graph, title, company });
      const currentRun = draft.analysisRuns?.at(-1) ?? { id: `job-run-${nanoid(8)}`, startedAt: new Date().toISOString(), status: "saved" as const, analyzerVersion: "jd-analyzer.semantic-ledger-v4.0" };
      const saved = await saveDraft(appendJobAnalysisRun({ ...draft, status: validation.validation.status === "validated" ? "manual_mode" : "needs_review", manualRequirements: draft.manualRequirements.length ? draft.manualRequirements : fallback.requirements, requirementGraph: validation.graph, analysisIssues: validation.validation.issues.map((item) => item.message), riskNotes: fallback.riskNotes }, { ...currentRun, status: "review_ready", finishedAt: new Date().toISOString(), graphHash: validation.graph.graphHash }));
      setDraft(saved); setJobError(undefined); setFailedAction(undefined);
      notify({ type: "warning", title: "已使用本地解析", message: "外部模型不会被调用，请核对本地岗位要求草稿。" });
    } catch (error) { setJobError(jobWorkflowErrorState(error, "repository_save_failed")); }
  }

  async function toggleRequirement(requirementId: string, checked: boolean) {
    if (!draft) return;
    const previous = draft;
    const optimistic = updateRequirementConfirmation(draft, requirementId, checked);
    setDraft(optimistic);
    try { setDraft(await saveDraft(optimistic)); setJobError(undefined); }
    catch (error) { setDraft(previous); setJobError(jobWorkflowErrorState(error, "repository_save_failed")); setFailedAction("commit"); }
  }

  async function toggleAllRequirements(checked: boolean) {
    if (!draft) return;
    const previous = draft;
    let optimistic = draft;
    for (const req of output?.requirements ?? []) {
      optimistic = updateRequirementConfirmation(optimistic, req.id, checked);
    }
    setDraft(optimistic);
    try { setDraft(await saveDraft(optimistic)); setJobError(undefined); }
    catch (error) { setDraft(previous); setJobError(jobWorkflowErrorState(error, "repository_save_failed")); setFailedAction("commit"); }
  }

  async function removeRequirement(requirementId: string) {
    if (!draft || !output || !window.confirm("删除后该要求不会进入正式岗位数据，但原始 JD 和草稿历史仍会保留。确认删除？")) return;
    const nextOutput: JdAnalyzerOutput = { ...output, requirements: output.requirements.filter((item) => item.id !== requirementId) };
    const next = { ...draft, status: "editing" as const, analyzerOutput: draft.analyzerOutput ? nextOutput : undefined, manualRequirements: draft.analyzerOutput ? draft.manualRequirements : nextOutput.requirements };
    try { setDraft(await saveDraft(next)); } catch (error) { setJobError(jobWorkflowErrorState(error, "repository_save_failed")); }
  }

  async function commitJob() {
    if (!draft || !rawInput) return;
    try {
      setSaveStatus("saving");
      const result = await commitParsedJob({ repository, draft, rawInput });
      workspace.upsertJob(result.jobDescription);
      setDraft(undefined); setRawInput(undefined); setTitle(""); setCompany(""); setRawText(""); setSelectedJobId(result.jobDescription.id); setJobListFilter("active"); setTab("resumes"); setSaveStatus("saved"); setJobError(undefined); setFailedAction(undefined);
      notify({ type: "success", title: "岗位已提交", message: `${result.jobDescription.company} / ${result.jobDescription.title} 已保存。` });
      await workspace.refetch();
    } catch (error) {
      const state = jobWorkflowErrorState(error); setJobError(state); setFailedAction("commit"); setSaveStatus(state.code === "revision_conflict" ? "conflict" : "failed");
      notify({ type: "error", title: jobWorkflowErrorLabel(state.code), message: state.message });
    }
  }

  async function saveDraft(next: JobAnalysisDraft) {
    setSaveStatus("saving");
    try { const saved = await repository.saveJobAnalysisDraftRevision(next, next.revision); setSaveStatus("saved"); return saved; }
    catch (error) { setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed"); throw error; }
  }

  async function discardDraft() {
    if (!draft || !window.confirm("弃用后，岗位解析任务入口会移除。原始 JD 不会进入正式岗位。确认弃用？")) return;
    const currentRun = draft.analysisRuns?.at(-1) ?? { id: `job-run-${nanoid(8)}`, startedAt: new Date().toISOString(), status: "saved" as const, analyzerVersion: "job-requirement-analyzer-v3" };
    await saveDraft(appendJobAnalysisRun({ ...draft, status: "discarded" }, { ...currentRun, status: "discarded", finishedAt: new Date().toISOString() }));
    setDraft(undefined); setRawInput(undefined); setTitle(""); setCompany(""); setRawText(""); setJobAnalysisDialogOpen(false);
  }

  async function analyzeProfileLibrary() {
    if (!profile || !selectedJob) { showGenerationError(!selectedJob ? "no_job_selected" : "source_reference_invalid"); return; }
    setResumeActionStatus("analyzing"); setGenerationErrorCode(undefined);
    try {
      const analysis = analyzeProfileLibrarySource({ profile, job: selectedJob });
      setProfileAnalysis(analysis);
      setSelectedProfileItemIds(analysis.recommendations.filter((item) => item.disposition !== "hide").map((item) => item.id));
      setResumeActionStatus("idle");
      notify({ type: "success", title: "匹配完成", message: `已从资料库整理 ${analysis.recommendations.length} 项内容，请确认选择。` });
    } catch (error) {
      setResumeActionStatus("failed"); showGenerationError(mapJobResumeGenerationError(error));
    }
  }

  async function createFromProfileLibrary() {
    if (!profile || !selectedJob || !profileAnalysis) { showGenerationError("matches_missing"); return; }
    if (!selectedProfileItemIds.length) { showGenerationError("matches_have_no_evidence"); return; }
    setResumeActionStatus("saving");
    try {
      const nextMatches = createRuleRequirementMatches({ profile, job: selectedJob });
      const savedMatches = await repository.saveRuleRequirementMatches({ profile, job: selectedJob, matches: nextMatches });
      const operationId = `profile-job-${profile.id}-${profile.version}-${selectedJob.id}-${profileAnalysis.analysisHash}-${stableHashText(selectedProfileItemIds.slice().sort().join(":"))}`;
      const result = await createJobResume({ repository, job: selectedJob, operationId,
        name: uniqueBranchName(`${selectedJob.title} - ${selectedJob.company} - ${profile.basics.name}`, resumeBranches),
        source: { type: "profile", profileId: profile.id, selectedCanonicalItemIds: selectedProfileItemIds, requirementMatchIds: savedMatches.map((match) => match.id) }
      });
      setResumeActionStatus("completed"); setGenerationErrorCode(undefined);
      notify({ type: "success", title: "岗位简历已创建", message: "个人资料库没有被修改，正在打开 Resume Studio。" });
      router.push(`/resume?branchId=${encodeURIComponent(result.resultRefs!.branchId!)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob.id)}`);
    } catch (error) { setResumeActionStatus("failed"); showGenerationError(mapJobResumeGenerationError(error)); }
  }

  async function analyzeAndGenerateFromResume() {
    if (!profile || !selectedJob || !selectedBaseResume?.currentRevisionId || !matchingProfile) { showGenerationError(!selectedJob ? "no_job_selected" : "no_source_selected"); return; }
    setResumeActionStatus("matching"); setGenerationErrorCode(undefined);
    try {
      const deterministic = createRuleRequirementMatches({ profile: matchingProfile, job: selectedJob }).map((match) => ({ ...match, sourceResumeBranchId: selectedBaseResume.id, sourceResumeBranchRevision: selectedBaseResume.revision, sourceResumeRevisionId: selectedBaseResume.currentRevisionId ?? undefined }));
      let savedMatches = await repository.saveRuleRequirementMatches({ profile: matchingProfile, job: selectedJob, matches: deterministic });
      setMatches(savedMatches);
      if (hasCustomAiSettings()) savedMatches = await runOptionalSemanticEvaluation({ profile: matchingProfile, job: selectedJob, branch: selectedBaseResume, matches: savedMatches });
      const existing = (await repository.findDerivedJobBranches({ sourceBranchId: selectedBaseResume.id, jobId: selectedJob.id, sourceRevisionId: selectedBaseResume.currentRevisionId }))[0];
      if (existing) {
        setResumeActionStatus("completed");
        setExistingJobBranch(existing);
        return;
      }
      setResumeActionStatus("saving");
      const result = await createJobResume({ repository, job: selectedJob,
        operationId: `job-resume-${selectedBaseResume.id}-${selectedJob.id}-${selectedBaseResume.currentRevisionId}-${nanoid(8)}`,
        name: uniqueBranchName(`${selectedJob.title} - ${selectedJob.company} - ${profile.basics.name}`, resumeBranches),
        source: { type: "resume", branch: selectedBaseResume }
      });
      setResumeActionStatus("completed"); notify({ type: "success", title: "岗位简历已创建", message: "原通用简历没有被修改，正在打开 Resume Studio。" });
      router.push(`/resume?branchId=${encodeURIComponent(result.resultRefs!.branchId!)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob.id)}`);
    } catch (error) { setResumeActionStatus("failed"); showGenerationError(mapJobResumeGenerationError(error)); }
  }

  async function createNewJobBranchFromBase() {
    if (!profile || !selectedJob || !selectedBaseResume?.currentRevisionId) return;
    setExistingJobBranch(null);
    setResumeActionStatus("saving");
    try {
      const result = await createJobResume({ repository, job: selectedJob,
        operationId: `job-resume-${selectedBaseResume.id}-${selectedJob.id}-${selectedBaseResume.currentRevisionId}-${nanoid(8)}`,
        name: uniqueBranchName(`${selectedJob.title} - ${selectedJob.company} - ${profile.basics.name} - 新优化`, resumeBranches),
        source: { type: "resume", branch: selectedBaseResume }
      });
      setResumeActionStatus("completed"); notify({ type: "success", title: "新岗位简历已创建", message: "基于原始通用简历创建了新的岗位优化版本，正在打开 Resume Studio。" });
      router.push(`/resume?branchId=${encodeURIComponent(result.resultRefs!.branchId!)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob.id)}`);
    } catch (error) { setResumeActionStatus("failed"); showGenerationError(mapJobResumeGenerationError(error)); }
  }

  async function runOptionalSemanticEvaluation(input: { profile: CareerProfile; job: JobDescription; branch: ResumeBranch; matches: RequirementMatch[] }) {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const results = await Promise.all(input.matches.map(async (match, index) => {
      if (index > 0) await sleep(500);
      const requirement = input.job.requirements.find((item) => item.id === match.requirementId);
      const candidates = requirement ? recallCandidatesForRequirement(input.profile, requirement) : [];
      if (!requirement) return match;
      const result = await invokeStructuredAi({
        task: "evidence-matcher",
        businessInput: { profileId: input.profile.id, jobId: input.job.id, profileVersion: input.profile.version, jobVersion: input.job.updatedAt, matcherVersion: match.matcherVersion, candidateSetHash: match.candidateSetHash, requirement: { id: requirement.id, description: requirement.description, sourceQuote: requirement.sourceSpan.text, hardConstraint: requirement.hardConstraint, keywords: requirement.keywords }, candidates: candidates.map((candidate) => ({ evidenceRef: candidate.ref, searchText: candidate.searchText })) },
        outputSchema: EvidenceMatcherOutputSchema
      });
      await repository.saveAiLogs([result.log]);
      const item = result.ok ? result.data.evaluations.find((candidate) => candidate.requirementId === requirement.id) : undefined;
      if (!item) return match;
      const aiEvaluation = MatchEvaluationSchema.parse({ source: "ai", matchLevel: item.matchLevel, riskLevel: item.riskLevel, risks: item.risks, evidenceRefs: item.evidenceRefs, explanation: item.explanation, evaluatedAt: new Date().toISOString() }) as MatchEvaluation & { source: "ai" };
      return withResolvedEffectiveMatch({ ...match, aiEvaluation, updatedAt: new Date().toISOString() });
    }));
    const saved = await repository.saveAiRequirementMatches({ profile: input.profile, job: input.job, matches: results });
    setMatches(saved); return saved;
  }

  function showGenerationError(code: JobResumeGenerationErrorCode) {
    const feedback = jobResumeGenerationFeedback(code); setGenerationErrorCode(code);
    notify({ type: code === "matches_have_no_evidence" ? "warning" : "error", title: feedback.title, message: `${feedback.message}${feedback.nextStep}` });
  }

  async function saveArchivedJobIds(next: string[]) { setArchivedJobIds(next); await repository.setMeta(jobArchiveKey, next); }
  async function archiveSelectedJob() { if (!selectedJob) return; await saveArchivedJobIds([...new Set([...archivedJobIds, selectedJob.id])]); setJobListFilter("active"); setSelectedJobId(activeJobs.find((job) => job.id !== selectedJob.id)?.id ?? ""); notify({ type: "success", title: "岗位已归档", message: "正式岗位数据仍保留，可在已归档列表恢复。" }); }
  async function restoreSelectedJob() { if (!selectedJob) return; await saveArchivedJobIds(archivedJobIds.filter((id) => id !== selectedJob.id)); setJobListFilter("active"); setSelectedJobId(selectedJob.id); notify({ type: "success", title: "岗位已恢复", message: "岗位已回到当前列表。" }); }
  async function requestSafeJobDelete() { if (!selectedJob || !window.confirm(`将“${selectedJob.company} / ${selectedJob.title}”移入回收站？之后可在统一回收站恢复。`)) return; const next = await repository.moveJobToRecycleBin(selectedJob.id); await saveArchivedJobIds(archivedJobIds.filter((id) => id !== selectedJob.id)); setTrashedJobIds(next.jobIds); setSelectedJobId(activeJobs.find((job) => job.id !== selectedJob.id)?.id ?? ""); notify({ type: "success", title: "岗位已移入回收站", message: "关联简历、匹配和求职记录未被删除。" }); }

  function editSelectedJob() { if (!selectedJob) return; setTitle(selectedJob.title); setCompany(selectedJob.company); setRawText(selectedJob.rawText); setRawInput(undefined); setDraft(undefined); setShowJobMenu(false); window.scrollTo({ top: 0, behavior: "smooth" }); }
  function editJobFromCard(job: JobDescription) { setSelectedJobId(job.id); setTitle(job.title); setCompany(job.company); setRawText(job.rawText); setRawInput(undefined); setDraft(undefined); setShowJobMenu(false); setTab("resumes"); setSourceMode("profile"); setSelectedBaseResumeId(""); setMatches([]); setProfileAnalysis(undefined); setSelectedProfileItemIds([]); setGenerationErrorCode(undefined); setShowMatchDetails(false); setResumeActionStatus("idle"); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function deleteJobFromCard(job: JobDescription) { if (!window.confirm(`将"${job.company} / ${job.title}"移入回收站？之后可在统一回收站恢复。`)) return; const next = await repository.moveJobToRecycleBin(job.id); await saveArchivedJobIds(archivedJobIds.filter((id) => id !== job.id)); setTrashedJobIds(next.jobIds); setSelectedJobId(activeJobs.find((j) => j.id !== job.id)?.id ?? ""); notify({ type: "success", title: "岗位已移入回收站", message: "关联简历、匹配和求职记录未被删除。" }); }
  function retryFailedJobAction() { if (failedAction === "start_import") void startImport(); else if (failedAction === "analyze") void analyzeWithAi(); else if (failedAction === "commit") void commitJob(); }
  function selectJob(id: string) { setSelectedJobId(id); setTab("resumes"); setSourceMode("profile"); setSelectedBaseResumeId(""); setMatches([]); setProfileAnalysis(undefined); setSelectedProfileItemIds([]); setGenerationErrorCode(undefined); setShowMatchDetails(false); setResumeActionStatus("idle"); setShowJobMenu(false); }
  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: JobWorkspaceTab) { const tabs: JobWorkspaceTab[] = ["resumes", "info", "requirements", "applications"]; const index = tabs.indexOf(current); const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : index; if (next === index && !["Home", "End"].includes(event.key)) return; event.preventDefault(); setTab(tabs[next]); event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }

  if (workspace.status === "loading" || !loadedDraft) return <main className="page-shell"><WorkspaceLoadingState /></main>;
  if (workspace.status === "error") return <main className="page-shell"><WorkspaceErrorState message={workspace.error} /></main>;

  return (
    <main className="page-shell jobs-workspace jobs-workspace-v2">
      <ProductTopbar title="岗位" status={`${activeJobs.length} 个当前岗位 · ${archivedJobs.length} 个已归档`} />
      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {jobError ? <PersistentJobError error={jobError} canUseFallback={Boolean(draft && rawInput)} onRetry={retryFailedJobAction} onFallback={() => void enterManualMode()} /> : null}

      <section className="jobs-overview-grid">
        <article className="panel job-entry-panel">
          <header><div><h2>新增 / 更新岗位</h2><p>粘贴完整 JD，系统会保留原文和来源。</p></div><span className={`save-status save-status-${saveStatus}`}>{saveStatusLabel(saveStatus)}</span></header>
          <div className="job-entry-fields">
            <label htmlFor="job-title-input">岗位名称<input id="job-title-input" name="job-title" autoComplete="off" data-testid="job-title-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：数据产品经理…" /></label>
            <label htmlFor="job-company-input">公司名称<input id="job-company-input" name="job-company" autoComplete="organization" data-testid="job-company-input" value={company} onChange={(event) => setCompany(event.target.value)} placeholder="例如：某科技公司…" /></label>
            <label className="job-jd-field" htmlFor="job-raw-textarea">岗位描述<textarea id="job-raw-textarea" name="job-description" data-testid="job-raw-textarea" value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="粘贴岗位职责、任职要求和加分项…" /></label>
          </div>
          <footer className="job-entry-actions">
            {draft?.status === "privacy_pending" ? <div className="privacy-inline"><span>{redactionPreview.redactions.length ? `已识别 ${redactionPreview.redactions.length} 类隐私信息，将先脱敏。` : "未发现需脱敏的联系信息。"}</span><button className="secondary-button" type="button" data-testid="job-manual-mode" onClick={() => void enterManualMode()}>使用本地解析</button><button className="primary-button" type="button" data-testid="job-analyze-ai" onClick={() => void analyzeWithAi()}>同意脱敏并解析</button></div> : <button className="primary-button" type="button" data-testid="save-job-raw-input" onClick={() => void startImport()} disabled={saveStatus === "saving"}>{saveStatus === "saving" ? "保存中…" : "保存并分析岗位"}</button>}
          </footer>
        </article>

        <aside className="panel jobs-list-panel">
          <header><div><h2>岗位列表</h2><p>{activeJobs.length} 个当前岗位 · {archivedJobs.length} 个已归档</p></div></header>
          <div className="job-list-filter" role="group" aria-label="岗位状态"><button className={jobListFilter === "active" ? "is-active" : ""} type="button" onClick={() => setJobListFilter("active")}>当前</button><button className={jobListFilter === "archived" ? "is-active" : ""} type="button" onClick={() => setJobListFilter("archived")}>已归档</button></div>
          <div className="job-card-list local-scroll">{visibleJobs.length ? visibleJobs.map((job) => <div key={job.id} className={selectedJob?.id === job.id ? "job-card is-selected" : "job-card"}><div className="job-card-body" role="button" tabIndex={0} onClick={() => selectJob(job.id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectJob(job.id); } }}><strong>{job.title}</strong><span className="job-card-company">{job.company}</span><small>{job.requirements.length} 条要求 · {formatJobDate(job.updatedAt)} · {jobSourceLabel(job.source)}</small></div><div className="job-card-actions"><button type="button" className="icon-button" aria-label={`编辑 ${job.title}`} onClick={(e) => { e.stopPropagation(); editJobFromCard(job); }}><Pencil size={14} aria-hidden="true" /></button><button type="button" className="icon-button danger" aria-label={`删除 ${job.title}`} onClick={(e) => { e.stopPropagation(); void deleteJobFromCard(job); }}><Trash2 size={14} aria-hidden="true" /></button></div></div>) : <p className="empty-copy">当前筛选下没有岗位。</p>}</div>
        </aside>
      </section>

      {draft && !["committed", "discarded"].includes(draft.status) ? <section className="panel job-analysis-task" aria-live="polite"><div><span>{jobAnalysisTaskLabel(draft.analysisRunStatus)}</span><strong>{draft.title}</strong><p>{jobAnalysisTaskDescription(draft)}</p></div><div className="action-row"><button className="secondary-button compact" type="button" data-testid="open-job-analysis" onClick={() => setJobAnalysisDialogOpen(true)}>{draft.analysisRunStatus === "ai_analyzing" ? "查看进度" : "继续核对"}</button>{draft.analysisRunStatus === "local_ready_ai_failed" ? <button className="secondary-button compact" type="button" onClick={() => { setJobAnalysisDialogOpen(true); void analyzeWithAi(); }}>重试 AI</button> : null}</div></section> : null}

      {draft && output ? <JobAnalysisDialog open={isJobAnalysisDialogOpen} draft={draft} output={output} saveStatus={saveStatus} onClose={() => setJobAnalysisDialogOpen(false)} onRetry={() => void analyzeWithAi()} onManual={() => void enterManualMode()} onToggle={toggleRequirement} onToggleAll={toggleAllRequirements} onRemove={removeRequirement} onDiscard={() => void discardDraft()} onCommit={() => void commitJob()} /> : null}

      {selectedJob ? <section className="panel selected-job-workspace">
        <header className="selected-job-context">
          <div className="selected-job-title"><span>{selectedJob.company}</span><h2>{selectedJob.title}</h2><p>{selectedJob.requirements.length} 条已确认要求 · {archivedJobIds.includes(selectedJob.id) ? "已归档" : "当前岗位"} · 当前来源：{sourceMode === "profile" ? "个人资料库" : selectedBaseResume?.name ?? "尚未选择简历"}</p></div>
          <div className="job-context-actions"><button className="secondary-button compact" type="button" onClick={editSelectedJob}><Pencil size={15} aria-hidden="true" />重新编辑 JD</button><button className="icon-button" type="button" aria-label="更多岗位操作" aria-expanded={showJobMenu} onClick={() => setShowJobMenu((current) => !current)}><MoreHorizontal size={18} aria-hidden="true" /></button>{showJobMenu ? <div className="job-more-menu">{archivedJobIds.includes(selectedJob.id) ? <button type="button" onClick={() => void restoreSelectedJob()}><BriefcaseBusiness size={15} aria-hidden="true" />恢复到当前</button> : <button type="button" onClick={() => void archiveSelectedJob()}><Archive size={15} aria-hidden="true" />归档岗位</button>}<button className="danger-text" type="button" onClick={() => void requestSafeJobDelete()}><Trash2 size={15} aria-hidden="true" />移入回收站</button></div> : null}</div>
        </header>
        <div className="job-primary-tabs" role="tablist" aria-label="岗位工作内容">{(["resumes", "info", "requirements", "applications"] as const).map((item) => { const Icon = tabIcon(item); return <button key={item} type="button" role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1} className={tab === item ? "is-active" : ""} onClick={() => setTab(item)} onKeyDown={(event) => handleTabKeyDown(event, item)}><Icon size={20} aria-hidden="true" /><span>{tabLabel(item)}</span></button>; })}</div>
        <div className="selected-job-content local-scroll" role="tabpanel" tabIndex={0}>
          {tab === "resumes" ? <ResumeSourcePanel mode={sourceMode} onMode={setSourceMode} recommendation={recommendation} profile={profile} profileAnalysis={profileAnalysis} selectedProfileItemIds={selectedProfileItemIds} onSelectedProfileItemIds={setSelectedProfileItemIds} onAnalyzeProfile={() => void analyzeProfileLibrary()} onCreateProfile={() => void createFromProfileLibrary()} baseResumeOptions={baseResumeOptions} selectedBaseResumeId={selectedBaseResumeId} onBaseResume={(id) => { setSelectedBaseResumeId(id); setMatches([]); setGenerationErrorCode(undefined); }} onAnalyzeResume={() => void analyzeAndGenerateFromResume()} matches={matches} showMatchDetails={showMatchDetails} onShowMatchDetails={() => setShowMatchDetails((current) => !current)} status={resumeActionStatus} generationErrorCode={generationErrorCode} onRetryMatch={() => sourceMode === "profile" ? void analyzeProfileLibrary() : void analyzeAndGenerateFromResume()} /> : null}
          {tab === "info" ? <JobInfo job={selectedJob} /> : null}
          {tab === "requirements" ? <JobRequirements job={selectedJob} /> : null}
          {tab === "applications" ? <ApplicationEmpty jobId={selectedJob.id} /> : null}
        </div>
        {existingJobBranch ? <div className="sync-dialog-overlay" onClick={() => setExistingJobBranch(null)}>
          <div className="sync-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="已存在优化简历">
            <h3>已存在优化过的岗位简历</h3>
            <p>当前来源简历针对「{selectedJob?.title}」已有优化版本（{existingJobBranch.tailoringAppliedCount ? `已优化 ${existingJobBranch.tailoringAppliedCount} 次` : "已创建"}）。你可以前往已有版本继续调整，或基于原始通用简历创建一份新的优化版本。</p>
            <div className="sync-dialog-actions">
              <button className="secondary-button" type="button" onClick={() => { router.push(`/resume?branchId=${encodeURIComponent(existingJobBranch.id)}&mode=ai&fromJobId=${encodeURIComponent(selectedJob?.id ?? "")}`); setExistingJobBranch(null); }}>前往已有简历</button>
              <button className="primary-button" type="button" onClick={() => void createNewJobBranchFromBase()}>创建新的优化</button>
            </div>
          </div>
        </div> : null}
      </section> : <section className="panel jobs-empty-selection"><BriefcaseBusiness size={22} aria-hidden="true" /><h2>先添加或选择一个岗位</h2><p>正式岗位提交后，这里会提供两种岗位简历生成方式。</p></section>}
    </main>
  );
}

function JobAnalysisDialog(props: { open: boolean; draft: JobAnalysisDraft; output: JdAnalyzerOutput; saveStatus: string; onClose: () => void; onRetry: () => void; onManual: () => void; onToggle: (id: string, checked: boolean) => void; onToggleAll: (checked: boolean) => void; onRemove: (id: string) => void; onDiscard: () => void; onCommit: () => void }) {
  const { open, onClose } = props;
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    dialog?.focus();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocusRef.current?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const statuses = ["原始 JD 已保存", "本地结构化", "AI 语义增强", "来源与 Schema 校验", "等待核对"];
  const activeIndex = props.draft.analysisRunStatus === "saved" ? 0 : props.draft.analysisRunStatus === "local_analyzing" ? 1 : props.draft.analysisRunStatus === "ai_analyzing" ? 2 : props.draft.analysisRunStatus === "validating" ? 3 : 4;
  const busy = ["local_analyzing", "ai_analyzing", "validating"].includes(props.draft.analysisRunStatus ?? "");
  return <div className="job-analysis-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div ref={dialogRef} className="job-analysis-dialog" role="dialog" aria-modal="true" aria-labelledby="job-analysis-dialog-title" tabIndex={-1}>
      <header className="job-analysis-dialog-header"><div><span>岗位解析任务</span><h2 id="job-analysis-dialog-title">{props.draft.title}</h2><p>{props.draft.company}</p></div><button className="icon-button" type="button" aria-label="关闭岗位解析窗口" onClick={props.onClose}><X size={18} aria-hidden="true" /></button></header>
      <ol className="job-analysis-stages">{statuses.map((label, index) => <li key={label} className={index < activeIndex ? "is-complete" : index === activeIndex ? "is-active" : ""}><span>{busy && index === activeIndex ? <LoaderCircle size={14} aria-hidden="true" /> : index + 1}</span>{label}</li>)}</ol>
      <div className="job-analysis-dialog-body local-scroll">
        {props.draft.analysisRunStatus === "local_ready_ai_failed" ? <section className="job-analysis-warning" role="status"><strong>本地解析已完成，AI 增强未完成</strong><p>岗位职责、条件和申请材料已经整理完成。你可以直接核对并提交，或重试 AI 增强。</p><button className="secondary-button compact" type="button" onClick={props.onRetry}>重试 AI</button></section> : null}
        {props.draft.status === "privacy_pending" ? <section className="job-analysis-privacy"><h3>开始语义增强前确认</h3><p>系统会先脱敏联系信息。原始 JD 已保存，关闭窗口不会删除任务。</p><div className="action-row"><button className="secondary-button" type="button" data-testid="job-manual-mode-dialog" onClick={props.onManual}>使用本地解析</button><button className="primary-button" type="button" onClick={props.onRetry}>同意脱敏并解析</button></div></section> : <DraftReview draft={props.draft} output={props.output} saveStatus={props.saveStatus} onToggle={props.onToggle} onToggleAll={props.onToggleAll} onRemove={props.onRemove} onCommit={props.onCommit} />}
        <details className="job-analysis-history"><summary>解析历史</summary><ul>{[...(props.draft.analysisRuns ?? [])].reverse().map((run, index) => <li key={run.id}><strong>{index === 0 ? "本次" : "上一次"}</strong><span>{jobAnalysisRunLabel(run.status)}</span><small>{new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(run.startedAt))}</small></li>)}</ul></details>
      </div>
      <footer className="job-analysis-dialog-footer"><button className="danger-text" type="button" onClick={props.onDiscard}>弃用草稿</button><button className="secondary-button" type="button" onClick={props.onClose}>稍后处理</button><button className="primary-button" type="button" data-testid="commit-job" disabled={props.saveStatus === "saving" || props.draft.status === "privacy_pending"} onClick={props.onCommit}>提交正式岗位</button></footer>
    </div>
  </div>;
}

function PersistentJobError({ error, canUseFallback, onRetry, onFallback }: { error: JobWorkflowErrorState; canUseFallback: boolean; onRetry: () => void; onFallback: () => void }) {
  return <section className="warning-box job-workflow-error" role="alert"><div><strong>{jobWorkflowErrorLabel(error.code)}</strong><p>{error.message}</p></div><div className="action-row">{error.retryable ? <button className="secondary-button compact" type="button" onClick={onRetry}>重试</button> : null}{canUseFallback ? <button className="secondary-button compact" type="button" onClick={onFallback}>使用本地解析</button> : null}</div></section>;
}

function DraftReview({ draft, output, onToggle, onToggleAll, onRemove }: { draft: JobAnalysisDraft; output: JdAnalyzerOutput; saveStatus: string; onToggle: (id: string, checked: boolean) => void; onToggleAll: (checked: boolean) => void; onRemove: (id: string) => void; onCommit: () => void }) {
  const allChecked = output.requirements.every((r) => r.confirmedByUser);
  const graph = draft.requirementGraph;
  const section = (title: string, nodes: NonNullable<typeof graph>["requirements"], description?: string) => nodes.length ? <section className="job-draft-section"><header><div><h3>{title}</h3>{description ? <p>{description}</p> : null}</div><span>{nodes.length} 条</span></header><div className="requirement-review-list">{nodes.map((node) => { const requirement = output.requirements.find((item) => item.id === node.id); return requirement ? <RequirementReviewRow key={node.id} requirement={requirement} details={node.details} onToggle={onToggle} onRemove={onRemove} /> : null; })}</div></section> : null;
  return <section className="job-draft-review"><header><div><h2>{draft.analyzerOutput ? "岗位语义核对" : "本地岗位语义核对"}</h2><p>按职责、条件与申请材料核对；子详情不会作为独立要求计分。</p></div><button className="secondary-button compact" type="button" onClick={() => onToggleAll(!allChecked)}>{allChecked ? "取消全选" : "全选"}</button></header>{graph ? <div className="job-draft-sections">
    {graph.roleProfile.mission ? <section className="job-draft-section"><header><h3>岗位核心使命</h3></header><p className="job-mission-copy">{graph.roleProfile.mission}</p></section> : null}
    {section("工作职责", graph.requirements.filter((node) => node.section === "responsibility" && node.statement !== graph.roleProfile.mission))}
    {graph.schemaVersion === "job-requirement-graph-v4" && graph.contextGroups.length ? <section className="job-draft-section context-groups"><header><div><h3>岗位上下文</h3><p>用于理解岗位方向，不计入匹配分母。</p></div><span>{graph.contextGroups.length} 组</span></header>{graph.contextGroups.map((group) => <article key={group.id}><strong>{group.label}</strong><ul>{group.details.map((detail) => <li key={detail.id}>{detail.text}</li>)}</ul></article>)}</section> : null}
    {section("必备条件", graph.requirements.filter((node) => node.section === "required"), graph.groups.find((group) => group.relation === "any_of") ? `以下 ${graph.groups.find((group) => group.relation === "any_of")!.requirementIds.length} 条满足任意 1 条即可` : undefined)}
    {section("加分条件", graph.requirements.filter((node) => node.section === "preferred"), graph.groups.find((group) => group.relation === "preferred_any_of") ? `以下 ${graph.groups.find((group) => group.relation === "preferred_any_of")!.requirementIds.length} 条具备任意一条均为加分` : undefined)}
    {graph.verificationMaterials.length ? <section className="job-draft-section verification-materials"><header><div><h3>验证材料</h3><p>用于申请材料清单，不计入技能或硬性条件。</p></div><span>{graph.verificationMaterials.length} 条</span></header>{graph.verificationMaterials.map((item) => <article key={item.id}><strong>{item.label}</strong>{item.requiredComponents.length ? <small>{item.requiredComponents.join(" · ")}</small> : null}</article>)}</section> : null}
    {graph.roleProfile.hiringSignals.length ? <section className="job-draft-section hiring-signals"><header><div><h3>招聘画像</h3><p>招聘方关注特征，用于自我评价与项目叙事。</p></div><span>{graph.roleProfile.hiringSignals.length} 条</span></header>{graph.roleProfile.hiringSignals.map((item) => <article key={item.id}>{item.statement}</article>)}</section> : null}
    {graph.sourceCoverage.unassignedUnitIds.length ? <section className="job-draft-section"><header><h3>未分类内容</h3></header>{(graph.schemaVersion === "job-requirement-graph-v4" ? graph.semanticUnits : graph.sourceUnits)?.filter((unit) => graph.sourceCoverage.unassignedUnitIds.includes(unit.id)).map((unit) => <p key={unit.id}>{unit.text}</p>)}</section> : null}
    {draft.analysisIssues?.length ? <section className="job-analysis-warning" role="status"><strong>需要核对的来源问题</strong><ul>{draft.analysisIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></section> : null}
  </div> : <div className="requirement-review-list">{output.requirements.map((requirement) => <RequirementReviewRow key={requirement.id} requirement={requirement} details={[]} onToggle={onToggle} onRemove={onRemove} />)}</div>}</section>;
}

function RequirementReviewRow({ requirement, details, onToggle, onRemove }: { requirement: JdAnalyzerRequirement; details: Array<{ id: string; type: string; text: string }>; onToggle: (id: string, checked: boolean) => void; onRemove: (id: string) => void }) {
  return <article className="review-row"><label><input type="checkbox" checked={requirement.confirmedByUser} disabled={!requirement.sourceSpan} onChange={(event) => onToggle(requirement.id, event.target.checked)} /><span><strong>{requirement.description}</strong><small>{categoryLabel(requirement.category)} · {priorityLabel(requirement.priority)}</small></span></label>{details.length ? <details><summary>{details.length} 条子详情</summary><ul>{details.map((detail) => <li key={detail.id}>{detail.text}</li>)}</ul></details> : null}<details><summary>查看来源</summary><p>{requirement.sourceSpan?.text ?? "原文位置待确认"}</p></details><button className="secondary-button compact" type="button" onClick={() => onRemove(requirement.id)}>排除</button></article>;
}

function ResumeSourcePanel(props: {
  mode: SourceMode; onMode: (mode: SourceMode) => void; recommendation: ReturnType<typeof recommendJobResumeSource>;
  profile?: CareerProfile; profileAnalysis?: ProfileLibrarySourceAnalysis; selectedProfileItemIds: string[]; onSelectedProfileItemIds: (ids: string[]) => void;
  onAnalyzeProfile: () => void; onCreateProfile: () => void; baseResumeOptions: ResumeBranch[]; selectedBaseResumeId: string; onBaseResume: (id: string) => void;
  onAnalyzeResume: () => void; matches: RequirementMatch[]; showMatchDetails: boolean; onShowMatchDetails: () => void; status: JobResumeActionStatus;
  generationErrorCode?: JobResumeGenerationErrorCode; onRetryMatch: () => void;
}) {
  const selected = new Set(props.selectedProfileItemIds);
  return <div className="job-source-panel">
    <header className="source-panel-heading"><div><h3>选择生成方式</h3><p>两种方式都会创建独立岗位简历，不修改个人资料或原简历。</p></div><span className={`source-recommendation is-${props.recommendation.mode}`}>{props.recommendation.label}</span></header>
    <div className="source-mode-cards" role="radiogroup" aria-label="岗位简历来源">
      <button type="button" role="radio" aria-checked={props.mode === "profile"} className={props.mode === "profile" ? "source-mode-card is-active" : "source-mode-card"} onClick={() => props.onMode("profile")}><Database size={22} aria-hidden="true" /><span><strong>从资料库生成</strong><small>从完整个人资料中筛选最相关的经历、项目和技能，重新组合岗位简历。</small></span></button>
      <button type="button" role="radio" aria-checked={props.mode === "resume"} className={props.mode === "resume" ? "source-mode-card is-active" : "source-mode-card"} onClick={() => props.onMode("resume")}><Sparkles size={22} aria-hidden="true" /><span><strong>优化已有简历</strong><small>以一份现有简历为基础，调整重点、顺序和表达；原简历不会被修改。</small></span></button>
    </div>
    <p className="recommendation-reason">{props.recommendation.reason}</p>
    {props.mode === "profile" ? <div className="source-mode-body" data-testid="profile-source-mode">
      <div className="source-summary"><div><strong>{props.profileAnalysis?.availableItemCount ?? canonicalProfileLibraryItems(props.profile ?? emptyProfile).length}</strong><span>项可用内容</span></div><div><strong>{props.profileAnalysis?.availableEvidenceCount ?? canonicalProfileLibraryItems(props.profile ?? emptyProfile).flatMap((item) => item.factIds).length}</strong><span>条已确认事实</span></div><div><strong>{props.profileAnalysis?.coverage.overallCoverage ?? "—"}</strong><span>岗位证据覆盖度</span></div></div>
      {!props.profileAnalysis ? <div className="source-intro"><p>{canonicalProfileLibraryItems(props.profile ?? emptyProfile).length < 6 ? "资料库内容较少，使用已有简历可能更快。系统不会自动替你切换。" : "系统将运行确定性召回与 V2 岗位匹配，再由你确认最终内容。"}</p><button className="primary-button" type="button" data-testid="analyze-profile-source" disabled={!props.profile || props.status === "analyzing"} onClick={props.onAnalyzeProfile}>{props.status === "analyzing" ? "分析中…" : "检查资料库并匹配"}</button></div> : <>
        <div className="profile-recommendation-list">{props.profileAnalysis.recommendations.map((item) => <label key={item.id} className={`profile-recommendation-item is-${item.disposition}`}><input type="checkbox" checked={selected.has(item.id)} onChange={(event) => props.onSelectedProfileItemIds(event.target.checked ? [...selected, item.id] : [...selected].filter((id) => id !== item.id))} /><span><strong>{item.title}</strong><small>{item.subtitle || sectionLabel(item.sectionType)} · {dispositionLabel(item.disposition)}</small><p>{item.reason}</p></span></label>)}</div>
        {props.profileAnalysis.factGaps.length ? <details className="fact-gap-list"><summary>查看 {props.profileAnalysis.factGaps.length} 个可补充项</summary>{props.profileAnalysis.factGaps.map((gap) => <p key={gap}>这项岗位要求暂未在简历中体现：{gap}</p>)}</details> : null}
        <div className="source-confirm-actions"><span>已选择 {props.selectedProfileItemIds.length} 项内容</span><button className="primary-button" type="button" data-testid="create-from-profile-source" disabled={!props.selectedProfileItemIds.length || props.status === "saving"} onClick={props.onCreateProfile}>{props.status === "saving" ? "创建中…" : "确认并创建岗位简历"}</button></div>
      </>}
    </div> : <div className="source-mode-body" data-testid="resume-source-mode">
      <label className="field-label" htmlFor="job-match-base-resume">来源通用简历<select id="job-match-base-resume" value={props.selectedBaseResumeId} onChange={(event) => props.onBaseResume(event.target.value)}><option value="">请选择一份通用简历</option>{props.baseResumeOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <div className="source-confirm-actions"><span>{props.selectedBaseResumeId ? "将分析当前正式版本并生成岗位简历；如已存在优化版本，可选择前往或新建。" : "请选择来源简历。系统不会默认替你选择。"}</span><button className="primary-button" type="button" data-testid="analyze-and-generate-job-resume" disabled={!props.selectedBaseResumeId || ["matching", "saving"].includes(props.status)} onClick={props.onAnalyzeResume}>{props.status === "matching" ? "分析中…" : props.status === "saving" ? "创建中…" : "分析并生成岗位简历"}</button></div>
      <button className="text-button" type="button" onClick={props.onShowMatchDetails}>查看匹配详情</button>
      {props.showMatchDetails ? <div className="match-detail-summary">{props.matches.length ? props.matches.map((match) => <div key={match.id}><strong>{match.requirementQuote.text}</strong><span>{match.isStale ? "匹配已过期" : match.effectiveEvaluation?.evidenceRefs.length ? "已有事实支持" : "暂无事实支持"}</span></div>) : <p>尚未运行岗位匹配。</p>}</div> : null}
    </div>}
    {props.generationErrorCode ? <div className="warning-box job-resume-recovery" role="alert"><div><strong>{jobResumeGenerationFeedback(props.generationErrorCode).title}</strong><p>{jobResumeGenerationFeedback(props.generationErrorCode).message}</p><p>{jobResumeGenerationFeedback(props.generationErrorCode).nextStep}</p></div>{["matches_missing", "matches_incomplete", "matches_stale", "source_revision_changed"].includes(props.generationErrorCode) ? <button className="secondary-button compact" type="button" onClick={props.onRetryMatch}>重新运行匹配</button> : null}</div> : null}
  </div>;
}

function JobInfo({ job }: { job: JobDescription }) { return <div className="job-info-panel"><header><h3>岗位信息</h3><span>更新于 {formatJobDate(job.updatedAt)}</span></header><dl className="info-list"><div><dt>公司</dt><dd>{job.company}</dd></div><div><dt>岗位名称</dt><dd>{job.title}</dd></div><div><dt>地点</dt><dd>{job.location ?? "未填写"}</dd></div><div><dt>工作方式</dt><dd>{job.workType ?? "未填写"}</dd></div><div><dt>行业</dt><dd>{job.industry ?? "未填写"}</dd></div><div><dt>JD 来源</dt><dd>{jobSourceLabel(job.source)}</dd></div></dl><section className="raw-jd-section"><h4>原始 JD</h4><p>{job.rawText}</p></section></div>; }
function JobRequirements({ job }: { job: JobDescription }) {
  const graph = job.requirementGraph;
  return <div className="job-requirement-cards">
    <header><h3>岗位要求</h3><span>{job.requirements.length} 条已确认要求{graph ? ` · 来源覆盖 ${Math.round(graph.sourceCoverage.coverageRatio * 100)}%` : ""}</span></header>
    {graph?.groups.filter((group) => group.relation !== "evidence_bundle").map((group) => <section key={group.id} className="job-requirement-group"><h4>{groupLabel(group.relation)}{group.minimumSatisfied ? `（至少满足 ${group.minimumSatisfied} 项）` : ""}</h4>{group.requirementIds.map((id) => {
      const requirement = job.requirements.find((item) => item.id === id);
      return requirement ? <RequirementArticle key={id} requirement={requirement} /> : null;
    })}</section>)}
    {graph ? job.requirements.filter((requirement) => !graph.groups.some((group) => group.requirementIds.includes(requirement.id))).map((requirement) => <RequirementArticle key={requirement.id} requirement={requirement} />) : job.requirements.map((requirement) => <RequirementArticle key={requirement.id} requirement={requirement} />)}
    {graph?.verificationMaterials.length ? <section className="job-requirement-group"><h4>申请材料清单</h4>{graph.verificationMaterials.map((item) => <article key={item.id}><strong>{item.label}</strong><span>验证材料，不计入技能匹配</span>{item.requiredComponents.length ? <small>{item.requiredComponents.join(" · ")}</small> : null}</article>)}</section> : null}
    {graph?.roleProfile.hiringSignals.length ? <section className="job-requirement-group"><h4>招聘方关注特征</h4>{graph.roleProfile.hiringSignals.map((item) => <article key={item.id}><strong>{item.statement}</strong><span>用于自我评价、项目叙事与面试准备，不作为硬条件</span></article>)}</section> : null}
  </div>;
}
function RequirementArticle({ requirement }: { requirement: JobDescription["requirements"][number] }) { return <article><strong>{requirement.description}</strong><span>{categoryLabel(requirement.category)} · {priorityLabel(requirement.priority)}</span><details><summary>查看依据</summary><p>{requirement.sourceSpan.text}</p><small>置信度 {confidenceLabel(requirement.confidence)}</small></details></article>; }
function groupLabel(relation: "all_of" | "any_of" | "preferred_any_of" | "evidence_bundle") { return { all_of: "全部要求", any_of: "满足任一即可", preferred_any_of: "加分项（满足任一）", evidence_bundle: "申请材料清单" }[relation]; }
function ApplicationEmpty({ jobId }: { jobId: string }) { return <div className="application-empty"><KanbanSquare size={28} aria-hidden="true" /><h3>该岗位暂未创建求职记录</h3><p>求职记录将在求职进度工作台中维护，岗位页只保留入口。</p><Link className="primary-button" href={`/applications?jobId=${encodeURIComponent(jobId)}`}>创建求职记录</Link></div>; }

const emptyProfile = { id: "empty", name: "空资料", basics: { name: "空资料", links: [] }, preference: { targetRoles: [], targetCities: [], industries: [] }, version: 1, experiences: [], skills: [], certificates: [], evidences: [], unclassifiedBlocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" } satisfies CareerProfile;

function profileLimitedToResume(profile: CareerProfile, branch: ResumeBranch): CareerProfile { const experienceIds = new Set<string>(); const skillIds = new Set<string>(); const certificateIds = new Set<string>(); for (const item of branch.contentItems) for (const ref of item.factRefs) { if (ref.type === "experience_fact") experienceIds.add(ref.experienceId); if (ref.type === "skill_fact") skillIds.add(ref.skillId); if (ref.type === "certificate_fact") certificateIds.add(ref.certificateId); } return { ...profile, experiences: profile.experiences.filter((item) => experienceIds.has(item.id)), skills: profile.skills.filter((item) => skillIds.has(item.id)), certificates: profile.certificates.filter((item) => certificateIds.has(item.id)) }; }
function isMatchBaseResume(branch: ResumeBranch) { return branch.branchPurpose === "general" && branch.lifecycleStatus === "active" && branch.migrationStatus === "verified" && Boolean(branch.currentRevisionId) && branch.syncStatusCache.status !== "invalid_reference"; }
function latestMatchesForResume(matches: RequirementMatch[], branchId: string) { const latest = new Map<string, RequirementMatch>(); for (const match of [...matches].filter((item) => item.sourceResumeBranchId === branchId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) if (!latest.has(match.requirementId)) latest.set(match.requirementId, match); return [...latest.values()]; }
function uniqueBranchName(base: string, branches: ResumeBranch[]) { const names = new Set(branches.map((branch) => branch.name)); if (!names.has(base)) return base; const dated = `${base} - ${new Date().toISOString().slice(0, 10)}`; if (!names.has(dated)) return dated; let index = 2; while (names.has(`${dated} - ${index}`)) index += 1; return `${dated} - ${index}`; }
function parseArchivedJobIds(value: unknown) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function formatJobDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(value)); }
function tabLabel(tab: JobWorkspaceTab) { return { resumes: "生成岗位简历", info: "岗位信息", requirements: "岗位要求", applications: "求职进度" }[tab]; }
function tabIcon(tab: JobWorkspaceTab) { return { resumes: Sparkles, info: FileText, requirements: ListChecks, applications: KanbanSquare }[tab]; }
function saveStatusLabel(status: "idle" | "saving" | "saved" | "failed" | "conflict") { return { idle: "等待保存", saving: "保存中…", saved: "已保存", failed: "保存失败", conflict: "内容已变化" }[status]; }
function jobWorkflowErrorLabel(code: JobWorkflowErrorState["code"]) { return { empty_input: "输入不完整", text_too_short: "JD 文本过短", schema_validation_failed: "岗位数据校验失败", ai_invalid_output: "岗位解析格式不完整", repository_save_failed: "岗位保存失败", revision_conflict: "岗位草稿已变化", unknown_error: "操作未完成" }[code]; }
function jobSourceLabel(source: JobDescription["source"]) { return { manual: "手动录入", imported_text: "文本导入", url: "链接导入", demo: "示例岗位" }[source]; }
function categoryLabel(value: string) { return ({ responsibility: "工作职责", must_have: "必备条件", required_skill: "必备技能", core_skill: "核心能力", preferred_skill: "加分技能", nice_to_have: "加分项", experience: "工作经验", education: "学历要求", certificate: "证书要求", language: "语言要求", tool: "工具与技术", soft_skill: "通用能力", risk_or_uncertain: "待确认", other: "其他要求" } as Record<string, string>)[value] ?? "其他要求"; }
function jobAnalysisRunLabel(value: string) { return ({ saved: "原始 JD 已保存", local_analyzing: "正在本地结构化", ai_analyzing: "正在进行 AI 语义增强", validating: "正在校验来源与 Schema", review_ready: "已完成，等待核对", local_ready_ai_failed: "本地完成，AI 增强失败", interrupted: "已中断，可继续解析", committed: "已提交", discarded: "已弃用" } as Record<string, string>)[value] ?? "等待处理"; }
function jobAnalysisTaskLabel(value?: string) { return value === "ai_analyzing" || value === "local_analyzing" || value === "validating" ? "分析中" : value === "interrupted" ? "已中断" : "待核对"; }
function jobAnalysisTaskDescription(draft: JobAnalysisDraft) { if (draft.analysisRunStatus === "local_ready_ai_failed") return "本地结果可用 · AI 增强未完成"; if (draft.analysisRunStatus === "interrupted") return "上次解析被中断，原始 JD 和本地解析结果仍已保存"; if (["ai_analyzing", "local_analyzing", "validating"].includes(draft.analysisRunStatus ?? "")) return jobAnalysisRunLabel(draft.analysisRunStatus ?? ""); return `本地解析完成 · ${draft.requirementGraph?.requirements.length ?? draft.manualRequirements.length} 条语义节点待核对`; }
function priorityLabel(value: string) { return ({ must: "必须满足", high: "高优先", important: "高优先", medium: "一般要求", low: "低优先", nice_to_have: "加分项", uncertain: "待确认" } as Record<string, string>)[value] ?? "待确认"; }
function confidenceLabel(value: number) { return value >= 0.8 ? "高" : value >= 0.6 ? "中" : "低"; }
function sectionLabel(value: string) { return ({ summary: "个人总结", education: "教育经历", work: "工作经历", internship: "实习经历", project: "项目经历", research: "研究经历", campus: "校园经历", volunteer: "志愿经历", awards: "荣誉奖项", skills: "技能", certificates: "证书", languages: "语言", publications: "出版物", patents: "专利", portfolio: "作品集", other: "其他", custom: "自定义内容" } as Record<string, string>)[value] ?? "其他内容"; }
function dispositionLabel(value: "prioritize" | "keep" | "hide") { return { prioritize: "推荐前置", keep: "推荐保留", hide: "可隐藏" }[value]; }
