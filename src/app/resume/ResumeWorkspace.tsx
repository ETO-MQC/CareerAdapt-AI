"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type JobAdaptationDraft,
  type CareerProfile,
  type JobDescription,
  type OverflowStatus,
  type RequirementMatch,
  type ResumeDiagnosticAction,
  type ResumeDiagnosticIssue,
  type ResumeDiagnosticSnapshot,
  type ResumePaginationPlan,
  type ResumeBranch,
  type ResumePresentationConfig,
  type ResumeRenderModel,
  type ResumeRevision,
  type TemplateId
} from "@/domain/schemas";
import { mapBranchToResumeRenderModel, ResumeRenderMapperError } from "@/domain/resumeRender/mapper";
import { A4ResumePreview } from "@/components/resume/A4ResumePreview";
import { TemplateCenter } from "@/components/resume/TemplateCenter";
import { ResumeDiagnosticsPanel } from "@/components/resume/diagnostics/ResumeDiagnosticsPanel";
import { ResumeImportWizard } from "@/components/resume/import/ResumeImportWizard";
import { JobOptimizationPanel } from "@/components/resume/optimization/JobOptimizationPanel";
import { buildRequirementBlockMatches, computeRequirementsHash } from "@/domain/jobOptimization";
import {
  isResumeDiagnosticSnapshotStale,
  runResumeDiagnostics,
  type ResumeDiagnosticTemplateInfo
} from "@/domain/resumeDiagnostics";
import { mapBranchToResumeDocument } from "@/domain/resumeDocument/mapper";
import { useResumePagination } from "@/components/resume/useResumePagination";
import {
  getResumeTemplate,
  getTemplateDefaultStyleConfig,
  isResumeTemplateId,
  resumeTemplates,
  type ResumeTemplateStyleConfig
} from "@/components/resume/templates/templateRegistry";
import { printCurrentPage } from "@/services/export/browserPrint";
import { buildResumePdfFileName, PDF_MIME_TYPE } from "@/services/export/filename";
import { isPaginationPlanBlocked, paginationStatusLabel } from "@/services/export/pagination";
import { createResumePdfExportRequest, presentationSnapshotFromConfig } from "@/services/export/snapshot";
import { hashBytes, stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

const repository = new WorkspaceRepository();
const DEFAULT_TEMPLATE_ID: TemplateId = "classic-technical";

type WorkbenchState = {
  branchId?: string;
  templateId?: TemplateId;
  stylePanelOpen?: boolean;
};

type PresentationHistoryState = {
  undoStack: ResumePresentationConfig[];
  redoStack: ResumePresentationConfig[];
};

type PropertyPanelTab = "document" | "section" | "block";
type StudioMode = "manual" | "ai";

type PdfExportState = {
  status: "idle" | "validating" | "generating" | "downloading" | "success" | "failed" | "blocked_overflow";
  exportId?: string;
  filename?: string;
  message?: string;
  errorCode?: string;
  canUseFallback?: boolean;
};

export function ResumeWorkspace() {
  const router = useRouter();
  const workspace = useWorkspace(repository);
  const pageRef = useRef<HTMLElement | null>(null);
  const [drafts, setDrafts] = useState<JobAdaptationDraft[]>([]);
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [localJobs, setLocalJobs] = useState<JobDescription[]>([]);
  const [profileOverride, setProfileOverride] = useState<CareerProfile | undefined>();
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [templateId, setTemplateId] = useState<TemplateId>(DEFAULT_TEMPLATE_ID);
  const [presentationConfig, setPresentationConfig] = useState<ResumePresentationConfig | undefined>();
  const [presentationHistory, setPresentationHistory] = useState<PresentationHistoryState>({
    undoStack: [],
    redoStack: []
  });
  const [revisions, setRevisions] = useState<ResumeRevision[]>([]);
  const [message, setMessage] = useState<string | undefined>();
  const [draftName, setDraftName] = useState("");
  const [editTexts, setEditTexts] = useState<Record<string, string>>({});
  const [isStudioEditMode, setIsStudioEditMode] = useState(false);
  const [selectedStudioItemId, setSelectedStudioItemId] = useState<string | undefined>();
  const [editingStudioItemId, setEditingStudioItemId] = useState<string | undefined>();
  const [studioDraftText, setStudioDraftText] = useState("");
  const [studioError, setStudioError] = useState<string | undefined>();
  const [pendingStudioOperationId, setPendingStudioOperationId] = useState<string | undefined>();
  const [selectedProfileFieldId, setSelectedProfileFieldId] = useState<string | undefined>();
  const [editingProfileFieldId, setEditingProfileFieldId] = useState<string | undefined>();
  const [profileFieldDraftText, setProfileFieldDraftText] = useState("");
  const [profileFieldError, setProfileFieldError] = useState<string | undefined>();
  const [profileFieldPending, setProfileFieldPending] = useState(false);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(true);
  const [isTemplateCenterOpen, setIsTemplateCenterOpen] = useState(false);
  const [studioMode, setStudioMode] = useState<StudioMode>("manual");
  const [pendingTemplateApplyId, setPendingTemplateApplyId] = useState<TemplateId | undefined>();
  const [activePropertyTab, setActivePropertyTab] = useState<PropertyPanelTab>("document");
  const [pdfExportState, setPdfExportState] = useState<PdfExportState>({ status: "idle" });
  const [diagnosticSnapshot, setDiagnosticSnapshot] = useState<ResumeDiagnosticSnapshot | undefined>();
  const [diagnosticRequirementsHash, setDiagnosticRequirementsHash] = useState<string | undefined>();
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | undefined>();
  const [ignoredDiagnosticIssueKeys, setIgnoredDiagnosticIssueKeys] = useState<string[]>([]);

  const presentationQueueRef = useRef<{
    promise: Promise<void>;
    latestConfig: ResumePresentationConfig | undefined;
    undoStack: ResumePresentationConfig[];
    redoStack: ResumePresentationConfig[];
  }>({
    promise: Promise.resolve(),
    latestConfig: undefined,
    undoStack: [],
    redoStack: []
  });
  const diagnosticRunSeqRef = useRef(0);

  function enqueuePresentation(operation: (config: ResumePresentationConfig) => Promise<ResumePresentationConfig | undefined>) {
    const queue = presentationQueueRef.current;
    queue.promise = queue.promise.then(async () => {
      const config = queue.latestConfig ?? presentationConfig;
      if (!config) {
        return;
      }
      queue.latestConfig = config;
      const result = await operation(config);
      if (result) {
        queue.latestConfig = result;
      }
    }).catch((error) => {
      console.error("Presentation queue error:", error);
    });
    return queue.promise;
  }

  useEffect(() => {
    presentationQueueRef.current.latestConfig = presentationConfig;
  }, [presentationConfig]);

  const profile = profileOverride ?? (workspace.status === "ready" ? workspace.profiles[0] : undefined);
  const jobs = useMemo(() => {
    const workspaceJobs = workspace.status === "ready" ? workspace.jobs : [];
    const byId = new Map<string, JobDescription>();
    [...workspaceJobs, ...localJobs].forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values());
  }, [workspace, localJobs]);
  const activeDraftId = selectedDraftId || drafts[0]?.id || "";
  const activeBranchId = selectedBranchId || branches[0]?.id || "";
  const selectedDraft = drafts.find((draft) => draft.id === activeDraftId);
  const selectedBranch = branches.find((branch) => branch.id === activeBranchId);
  const selectedBranchJob = selectedBranch?.jobId ? jobs.find((job) => job.id === selectedBranch.jobId) : undefined;
  const effectiveTemplateId = presentationConfig?.templateId ?? templateId;
  const selectedTemplate = getResumeTemplate(effectiveTemplateId);
  const renderResult = useMemo(() => buildRenderModel({
    branch: selectedBranch,
    profile,
    job: selectedBranchJob,
    presentationConfig
  }), [selectedBranch, profile, selectedBranchJob, presentationConfig]);
  const renderModel = renderResult.model;
  const resumeDocument = useMemo(() => {
    if (!selectedBranch || !profile || (selectedBranch.branchPurpose !== "general" && !selectedBranchJob)) {
      return undefined;
    }
    return mapBranchToResumeDocument({
      branch: selectedBranch,
      profile,
      job: selectedBranchJob,
      templateId: effectiveTemplateId,
      presentationConfig
    });
  }, [selectedBranch, profile, selectedBranchJob, effectiveTemplateId, presentationConfig]);
  const resumeDocumentBlocksById = useMemo(() => {
    return new Map(resumeDocument?.blocks.map((block) => [block.contentItemId, block]) ?? []);
  }, [resumeDocument]);
  const selectedStudioBlock = selectedStudioItemId ? resumeDocumentBlocksById.get(selectedStudioItemId) : undefined;
  const selectedStudioSection = useMemo(() => {
    if (!resumeDocument || !selectedStudioBlock) {
      return undefined;
    }
    return resumeDocument.sections.find((section) => section.type === selectedStudioBlock.sectionType);
  }, [resumeDocument, selectedStudioBlock]);
  const visibleSectionTypes = useMemo(() => {
    return resumeDocument?.sections
      .filter((section) => section.blocks.some((block) => block.visible && block.renderable))
      .map((section) => section.type) ?? [];
  }, [resumeDocument]);
  const firstVisibleSectionType = visibleSectionTypes[0];
  const selectedSectionPageBreakEnabled = selectedStudioSection
    ? Boolean(presentationConfig?.pagination.pageBreakBeforeSections.includes(selectedStudioSection.type))
    : false;
  const selectedSectionCanPageBreak = Boolean(
    selectedStudioSection
    && presentationConfig?.pagination.pagePolicy === "up_to_two_pages"
    && selectedTemplate.capabilities.supportsSectionPageBreaks
    && selectedStudioSection.type !== firstVisibleSectionType
  );
  const selectedBranchEditable = selectedBranch ? canEditBranch(selectedBranch) : false;
  const pagination = useResumePagination(pageRef, presentationConfig?.pagination, [
    renderModel?.branchId,
    renderModel?.branchRevision,
    effectiveTemplateId,
    presentationConfig?.presentationRevision,
    presentationConfig?.pagination.pagePolicy,
    presentationConfig?.pagination.pageBreakBeforeSections.join("|")
  ]);
  const reductionHints = useMemo(() => renderModel ? buildReductionHints(renderModel) : [], [renderModel]);
  const presentationHiddenBlocks = useMemo(() => {
    return resumeDocument?.blocks.filter((block) => block.presentationHidden && block.contentVisible) ?? [];
  }, [resumeDocument]);
  const isPdfExportBusy = pdfExportState.status === "validating"
    || pdfExportState.status === "generating"
    || pdfExportState.status === "downloading";
  const diagnosticsStale = isResumeDiagnosticSnapshotStale({
    snapshot: diagnosticSnapshot,
    branchRevision: selectedBranch?.revision,
    currentRevisionId: selectedBranch?.currentRevisionId ?? undefined,
    presentationRevision: presentationConfig?.presentationRevision,
    templateId: presentationConfig?.templateId ?? effectiveTemplateId,
    pagePolicy: presentationConfig?.pagination.pagePolicy,
    paginationHash: pagination.plan?.paginationHash,
    requirementsHash: diagnosticRequirementsHash
  });
  const exportDiagnosticSummary = diagnosticSnapshot && !diagnosticsStale ? {
    diagnosticsEngineVersion: diagnosticSnapshot.diagnosticsEngineVersion,
    diagnosticsSnapshotHash: diagnosticSnapshot.diagnosticHash,
    criticalIssueCount: diagnosticSnapshot.summary.critical,
    warningIssueCount: diagnosticSnapshot.summary.warning,
    requirementCoverageSummary: diagnosticSnapshot.summary.requirementCoverage
  } : undefined;

  const refreshLists = useCallback(async (profileId: string) => {
    const [nextDrafts, nextBranches] = await Promise.all([
      repository.listJobAdaptationDrafts(profileId),
      repository.listResumeBranches(profileId)
    ]);
    setDrafts(nextDrafts);
    setBranches(nextBranches);
  }, []);

  const clearStudioEditor = useCallback(() => {
    setSelectedStudioItemId(undefined);
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
    setSelectedProfileFieldId(undefined);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
    setProfileFieldPending(false);
    setActivePropertyTab("document");
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const requestedBranchId = new URLSearchParams(window.location.search).get("branchId");
      if (requestedBranchId && branches.some((branch) => branch.id === requestedBranchId)) {
        setSelectedBranchId(requestedBranchId);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [branches]);

  useEffect(() => {
    if (workspace.status !== "ready" || !profile) {
      return;
    }
    let active = true;
    async function loadLists() {
      const [nextDrafts, nextBranches, savedState] = await Promise.all([
        repository.listJobAdaptationDrafts(profile!.id),
        repository.listResumeBranches(profile!.id),
        repository.getMeta(workbenchStateKey(profile!.id))
      ]);
      if (!active) {
        return;
      }
      setDrafts(nextDrafts);
      setBranches(nextBranches);
      const parsed = parseWorkbenchState(savedState?.value);
      if (parsed.templateId) {
        setTemplateId(parsed.templateId);
      }
      if (typeof parsed.stylePanelOpen === "boolean") {
        setIsStylePanelOpen(parsed.stylePanelOpen);
      }
      if (parsed.branchId && nextBranches.some((branch) => branch.id === parsed.branchId)) {
        setSelectedBranchId(parsed.branchId);
      }
    }
    void loadLists();
    return () => {
      active = false;
    };
  }, [workspace.status, profile]);

  useEffect(() => {
    if (!activeBranchId) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setPresentationConfig(undefined);
        }
      });
      return () => {
        active = false;
      };
    }
    let active = true;
    async function loadBranchState() {
      const [nextRevisions, nextPresentationConfig] = await Promise.all([
        repository.listResumeRevisions(activeBranchId),
        repository.getResumePresentationConfig(activeBranchId)
      ]);
      if (active) {
        setRevisions(nextRevisions);
        setPresentationConfig(nextPresentationConfig);
        setTemplateId(nextPresentationConfig.templateId);
        const queue = presentationQueueRef.current;
        queue.undoStack = [];
        queue.redoStack = [];
        setPresentationHistory({ undoStack: [], redoStack: [] });
      }
    }
    void loadBranchState();
    return () => {
      active = false;
    };
  }, [activeBranchId]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      setEditTexts({});
      clearStudioEditor();
      setPdfExportState({ status: "idle" });
      const queue = presentationQueueRef.current;
      queue.undoStack = [];
      queue.redoStack = [];
      setPresentationHistory({ undoStack: [], redoStack: [] });
    });
    return () => {
      active = false;
    };
  }, [activeBranchId, selectedBranch?.revision, selectedBranch?.currentRevisionId, clearStudioEditor]);

  useEffect(() => {
    if (!isStudioEditMode) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          clearStudioEditor();
        }
      });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [isStudioEditMode, clearStudioEditor]);

  useEffect(() => {
    if (!activeBranchId) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setIgnoredDiagnosticIssueKeys([]);
          setDiagnosticSnapshot(undefined);
          setDiagnosticRequirementsHash(undefined);
        }
      });
      return () => {
        active = false;
      };
    }
    let active = true;
    async function loadIgnoredDiagnostics() {
      const stored = await repository.getMeta(resumeDiagnosticsIgnoredKey(activeBranchId));
      if (!active) {
        return;
      }
      setIgnoredDiagnosticIssueKeys(parseIgnoredDiagnosticKeys(stored?.value));
    }
    void loadIgnoredDiagnostics();
    return () => {
      active = false;
    };
  }, [activeBranchId]);

  useEffect(() => {
    if (!profile || !activeBranchId) {
      return;
    }
    void repository.setMeta(workbenchStateKey(profile.id), {
      branchId: activeBranchId,
      templateId: effectiveTemplateId,
      stylePanelOpen: isStylePanelOpen
    } satisfies WorkbenchState);
  }, [profile, activeBranchId, effectiveTemplateId, isStylePanelOpen]);

  const runDiagnostics = useCallback(async () => {
    if (!selectedBranch || !renderModel || !presentationConfig) {
      setDiagnosticError("no_branch_or_render_model");
      return;
    }
    if (!selectedBranch.currentRevisionId) {
      setDiagnosticError("no_current_revision");
      return;
    }
    if (!pagination.plan || pagination.status === "measuring") {
      setDiagnosticError("measuring");
      return;
    }

    const runId = diagnosticRunSeqRef.current + 1;
    diagnosticRunSeqRef.current = runId;
    setDiagnosticRunning(true);
    setDiagnosticError(undefined);
    try {
      let requirementMatches: RequirementMatch[] = [];
      if (profile && selectedBranchJob) {
        requirementMatches = await repository.listRequirementMatches(profile.id, selectedBranchJob.id);
      }
      if (diagnosticRunSeqRef.current !== runId) {
        return;
      }
      const requirementsHash = selectedBranchJob
        ? computeRequirementsHash({ job: selectedBranchJob, matches: requirementMatches })
        : undefined;
      const requirementBlockMatches = profile && selectedBranchJob && selectedBranch.currentRevisionId && requirementMatches.length > 0
        ? buildRequirementBlockMatches({
          profile,
          job: selectedBranchJob,
          branch: selectedBranch,
          matches: requirementMatches
        })
        : [];
      const snapshot = runResumeDiagnostics({
        branchId: selectedBranch.id,
        branchRevision: selectedBranch.revision,
        currentRevisionId: selectedBranch.currentRevisionId,
        branchContentItems: selectedBranch.contentItems,
        renderModel,
        presentationConfig,
        template: diagnosticTemplateInfo(selectedTemplate),
        job: selectedBranchJob,
        requirementMatches,
        requirementBlockMatches,
        requirementsHash,
        paginationPlan: pagination.plan,
        paginationMeasurement: pagination.measurement,
        ignoredIssueKeys: ignoredDiagnosticIssueKeys
      });
      if (diagnosticRunSeqRef.current !== runId) {
        return;
      }
      setDiagnosticRequirementsHash(requirementsHash);
      setDiagnosticSnapshot(snapshot);
      setDiagnosticError(undefined);
    } catch {
      if (diagnosticRunSeqRef.current === runId) {
        setDiagnosticError("diagnostic_failed");
      }
    } finally {
      if (diagnosticRunSeqRef.current === runId) {
        setDiagnosticRunning(false);
      }
    }
  }, [
    ignoredDiagnosticIssueKeys,
    pagination.measurement,
    pagination.plan,
    pagination.status,
    presentationConfig,
    profile,
    renderModel,
    selectedBranch,
    selectedBranchJob,
    selectedTemplate
  ]);

  useEffect(() => {
    if (!selectedBranch || !renderModel || !presentationConfig || !pagination.plan || pagination.status === "measuring") {
      return;
    }
    const timer = window.setTimeout(() => {
      void runDiagnostics();
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    ignoredDiagnosticIssueKeys,
    pagination.plan,
    pagination.status,
    presentationConfig,
    renderModel,
    runDiagnostics,
    selectedBranch
  ]);

  function locateDiagnosticIssue(issue: ResumeDiagnosticIssue) {
    const itemId = issue.contentItemIds[0];
    if (itemId) {
      setIsStudioEditMode(true);
      setSelectedStudioItemId(itemId);
      setEditingStudioItemId(undefined);
      setStudioDraftText("");
      setActivePropertyTab("block");
      window.requestAnimationFrame(() => {
        document.querySelector(`[data-source-item-id="${cssEscape(itemId)}"]`)?.scrollIntoView({
          block: "center",
          behavior: "smooth"
        });
      });
      setMessage("已定位到诊断关联区块。");
      return;
    }
    if (issue.sectionType) {
      setActivePropertyTab("section");
      setMessage(`诊断关联栏目：${sectionTypeLabel(issue.sectionType)}。`);
      return;
    }
    if (issue.requirementIds[0]) {
      setMessage(`诊断关联 Requirement：${issue.requirementIds[0]}。请在岗位优化面板中查看对应要求。`);
      return;
    }
    setMessage("该诊断项没有更细粒度定位目标。");
  }

  async function applyDiagnosticAction(issue: ResumeDiagnosticIssue, action: ResumeDiagnosticAction) {
    const payload = actionPayload(action);
    if (action.kind === "ignore_issue") {
      await ignoreDiagnosticIssue(issue);
      return;
    }
    if (action.kind === "open_content_editor") {
      const contentItemId = stringPayload(payload, "contentItemId") ?? issue.contentItemIds[0];
      if (contentItemId) {
        setIsStudioEditMode(true);
        setActivePropertyTab("block");
        startStudioEdit(contentItemId);
      } else {
        setMessage("请在正文编辑区选择需要修改的区块。");
      }
      return;
    }
    if (action.kind === "open_job_suggestion") {
      setMessage("请在“针对岗位优化”面板中查看 Requirement 映射或生成区块建议。");
      return;
    }
    if (action.kind === "open_fact_gap") {
      setMessage("事实缺口需要先补充或确认事实；诊断不会自动写入岗位关键词。");
      return;
    }
    if (!selectedBranchEditable) {
      setMessage("当前简历不可保存展示修复。");
      return;
    }
    if (action.kind === "set_density") {
      const density = presentationDensityPayload(payload) ?? "compact";
      await updatePresentationStyle((current) => ({
        theme: { ...current.theme, density }
      }), "诊断修复已调整页面密度。");
      return;
    }
    if (action.kind === "set_body_scale") {
      const bodyTextScale = presentationBodyScalePayload(payload);
      const titleTextScale = presentationTitleScalePayload(payload);
      await updatePresentationStyle((current) => ({
        typography: {
          ...current.typography,
          bodyTextScale: bodyTextScale ?? current.typography.bodyTextScale,
          titleTextScale: titleTextScale ?? current.typography.titleTextScale
        }
      }), "诊断修复已调整字号。");
      return;
    }
    if (action.kind === "set_line_height") {
      const lineHeight = presentationLineHeightPayload(payload) ?? "normal";
      await updatePresentationStyle((current) => ({
        typography: { ...current.typography, lineHeight }
      }), "诊断修复已调整行距。");
      return;
    }
    if (action.kind === "set_section_gap") {
      const sectionGap = presentationSpacingPayload(payload, "sectionGap") ?? "tight";
      await updatePresentationStyle((current) => ({
        spacing: { ...current.spacing, sectionGap }
      }), "诊断修复已调整栏目间距。");
      return;
    }
    if (action.kind === "set_item_gap") {
      const itemGap = presentationSpacingPayload(payload, "itemGap") ?? "normal";
      await updatePresentationStyle((current) => ({
        spacing: { ...current.spacing, itemGap }
      }), "诊断修复已调整条目间距。");
      return;
    }
    if (action.kind === "change_page_policy") {
      const pagePolicy = pagePolicyPayload(payload);
      if (pagePolicy) {
        await updatePagePolicy(pagePolicy);
      }
      return;
    }
    if (action.kind === "switch_template") {
      const templateId = templateIdPayload(payload);
      if (templateId) {
        await updatePresentationTemplate(templateId);
      }
      return;
    }
    if (action.kind === "cancel_section_break") {
      const sectionType = sectionTypePayload(payload);
      if (sectionType) {
        await setSectionPageBreak(sectionType, false);
      }
      return;
    }
    if (action.kind === "hide_block" || action.kind === "show_block") {
      const contentItemId = stringPayload(payload, "contentItemId") ?? issue.contentItemIds[0];
      if (contentItemId) {
        await setPresentationItemVisibility(contentItemId, action.kind === "show_block");
      }
      return;
    }
    if (action.kind === "move_block_up" || action.kind === "move_block_down") {
      const contentItemId = stringPayload(payload, "contentItemId") ?? issue.contentItemIds[0];
      if (contentItemId) {
        await movePresentationItem(contentItemId, action.kind === "move_block_up" ? "up" : "down");
      }
    }
  }

  async function ignoreDiagnosticIssue(issue: ResumeDiagnosticIssue) {
    if (!selectedBranch) {
      return;
    }
    const next = Array.from(new Set([...ignoredDiagnosticIssueKeys, issue.issueKey]));
    setIgnoredDiagnosticIssueKeys(next);
    await repository.setMeta(resumeDiagnosticsIgnoredKey(selectedBranch.id), next);
    setMessage("已忽略该诊断项；正文和展示配置均未改变。");
  }

  const draftOptions = useMemo(() => drafts.map((draft) => {
    const job = jobs.find((item) => item.id === draft.jobId);
    return {
      draft,
      label: `${job?.company ?? "未知公司"} / ${job?.title ?? draft.jobId}`
    };
  }), [drafts, jobs]);

  async function createBranch() {
    if (!profile || !selectedDraft) {
      setMessage("请先选择可用的岗位简历建议草稿。");
      return;
    }

    const job = jobs.find((item) => item.id === selectedDraft.jobId);
    const name = draftName.trim() || `${job?.company ?? "岗位"} / ${job?.title ?? "定制简历"}`;
    try {
      const result = await repository.createResumeBranchFromDraft({
        draftId: selectedDraft.id,
        expectedDraftRevision: selectedDraft.revision,
        operationId: `d1-create-${selectedDraft.id}-${selectedDraft.revision}`,
        name
      });
      await refreshLists(profile.id);
      setSelectedBranchId(result.branch.id);
      setMessage(result.idempotent ? "该草稿已经创建过岗位简历，已打开现有简历。" : "岗位简历已创建，并生成首个版本。");
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "创建失败：草稿版本已变化，请刷新后重试。"
        : "创建失败：草稿可能已过期、含高风险内容或引用了失效事实。请返回岗位工作区修复。");
    }
  }

  async function handleImportedResumeReady(result: { profileId: string; branchId: string }) {
    const nextProfile = await repository.getProfile(result.profileId);
    if (nextProfile) {
      setProfileOverride(nextProfile);
      await refreshLists(nextProfile.id);
    }
    setSelectedBranchId(result.branchId);
    setIsStudioEditMode(true);
    setMessage("已进入导入生成的通用简历，可继续编辑、换模板、调整分页并下载 PDF。");
  }

  async function saveItem(itemId: string) {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前简历不可编辑：旧数据、归档、引用失效或缺少当前版本。");
      return;
    }

    const text = editTexts[itemId]?.trim();
    if (!text) {
      setMessage("请先填写要保存的文本。");
      return;
    }

    try {
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-edit-${selectedBranch.id}-${selectedBranch.revision}-${itemId}-${stableHashText(text)}`,
        edits: [{ itemId, text }]
      });
      replaceBranch(result.branch);
      setSelectedBranchId(result.branch.id);
      setMessage("简历内容已保存，事实安全检查已重新计算。");
    } catch {
      setMessage("保存失败：可能存在高风险事实变更、版本冲突或旧简历只读。");
    }
  }

  async function savePresentationConfig(input: {
    nextConfig: ResumePresentationConfig;
    beforeConfig: ResumePresentationConfig;
    operationId: string;
    successMessage: string;
    recordHistory?: boolean;
  }) {
    if (!selectedBranch || !selectedBranchEditable || !selectedBranch.currentRevisionId) {
      setMessage("当前简历不可保存展示配置：旧数据、归档、引用失效或缺少当前版本。");
      return undefined;
    }

    try {
      const result = await repository.saveResumePresentationConfig({
        branchId: selectedBranch.id,
        expectedBranchRevision: selectedBranch.revision,
        expectedRevisionId: selectedBranch.currentRevisionId,
        expectedPresentationRevision: input.beforeConfig.presentationRevision,
        operationId: input.operationId,
        nextConfig: input.nextConfig
      });
      setPresentationConfig(result.config);
      setTemplateId(result.config.templateId);
      presentationQueueRef.current.latestConfig = result.config;
      if (input.recordHistory !== false && !result.idempotent) {
        const queue = presentationQueueRef.current;
        queue.undoStack = [...queue.undoStack.slice(-49), input.beforeConfig];
        queue.redoStack = [];
        setPresentationHistory({
          undoStack: queue.undoStack,
          redoStack: queue.redoStack
        });
      }
      setMessage(result.idempotent ? "该展示操作已保存过，未重复写入。" : input.successMessage);
      return result.config;
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "展示配置保存失败：内容版本或展示版本已变化，请刷新后重试。"
        : "展示配置保存失败：可能隐藏了全部内容、简历不可编辑或配置不合法。");
      return undefined;
    }
  }

  async function updatePresentationTemplate(nextTemplateId: TemplateId) {
    if (pendingTemplateApplyId) {
      return;
    }
    if (!selectedBranch) {
      setTemplateId(nextTemplateId);
      return;
    }
    if (!presentationConfig) {
      setMessage("展示配置尚未加载完成，请稍后再切换模板。");
      return;
    }
    if (nextTemplateId === presentationConfig.templateId) {
      return;
    }
    setPendingTemplateApplyId(nextTemplateId);
    await enqueuePresentation(async (current) => {
      if (nextTemplateId === current.templateId) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: { templateId: nextTemplateId }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-template-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${nextTemplateId}`,
        successMessage: "模板偏好已保存到当前简历展示配置。"
      });
    }).finally(() => {
      setPendingTemplateApplyId(undefined);
    });
  }

  async function updatePresentationStyle(
    patch: Partial<ResumeTemplateStyleConfig> | ((current: ResumePresentationConfig) => Partial<ResumeTemplateStyleConfig>),
    successMessage = "样式已保存到当前简历展示配置。"
  ) {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      const resolvedPatch = typeof patch === "function" ? patch(current) : patch;
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: resolvedPatch
      });
      if (stableHashText(JSON.stringify(presentationStylePatch(current))) === stableHashText(JSON.stringify(presentationStylePatch(nextConfig)))) {
        return current;
      }
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1b-style-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${stableHashText(JSON.stringify(presentationStylePatch(nextConfig)))}`,
        successMessage
      });
    });
  }

  async function resetTemplateStyle() {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      const defaults = getTemplateDefaultStyleConfig(current.templateId);
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: defaults
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1b-style-reset-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${current.templateId}`,
        successMessage: "已恢复当前模板默认样式。"
      });
    });
  }

  async function updatePagePolicy(pagePolicy: ResumePresentationConfig["pagination"]["pagePolicy"]) {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      if (current.pagination.pagePolicy === pagePolicy) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: {
          pagination: {
            ...current.pagination,
            pagePolicy
          }
        }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g3b-page-policy-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${pagePolicy}`,
        successMessage: pagePolicy === "up_to_two_pages"
          ? "页面策略已切换为最多两页，未创建内容版本。"
          : "页面策略已切换为严格一页，未创建内容版本。"
      });
    });
  }

  async function setSectionPageBreak(sectionType: NonNullable<typeof selectedStudioBlock>["sectionType"], enabled: boolean) {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      const pageBreakBeforeSections = enabled
        ? Array.from(new Set([...current.pagination.pageBreakBeforeSections, sectionType]))
        : current.pagination.pageBreakBeforeSections.filter((value) => value !== sectionType);
      if (
        pageBreakBeforeSections.length === current.pagination.pageBreakBeforeSections.length
        && pageBreakBeforeSections.every((value, index) => value === current.pagination.pageBreakBeforeSections[index])
      ) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: {
          pagination: {
            ...current.pagination,
            pageBreakBeforeSections
          }
        }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g3b-section-break-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${sectionType}-${enabled}`,
        successMessage: enabled ? "当前栏目已设置为从下一页开始。" : "当前栏目分页提示已取消。"
      });
    });
  }

  async function setSectionTitleVisibility(
    sectionType: NonNullable<typeof selectedStudioBlock>["sectionType"],
    showTitle: boolean
  ) {
    await updatePresentationStyle((current) => ({
      sectionStyleOverrides: {
        ...current.sectionStyleOverrides,
        [sectionType]: {
          ...current.sectionStyleOverrides[sectionType],
          showTitle
        }
      }
    }), showTitle ? "栏目标题已恢复显示。" : "栏目标题已隐藏。");
  }

  async function resetSectionStyle(sectionType: NonNullable<typeof selectedStudioBlock>["sectionType"]) {
    await updatePresentationStyle((current) => {
      const nextOverrides = { ...current.sectionStyleOverrides };
      delete nextOverrides[sectionType];
      return {
        sectionStyleOverrides: nextOverrides
      };
    }, "当前栏目样式已恢复默认。");
  }

  async function setPresentationItemVisibility(itemId: string, visible: boolean) {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      const hiddenItemIds = visible
        ? current.hiddenItemIds.filter((id) => id !== itemId)
        : Array.from(new Set([...current.hiddenItemIds, itemId]));
      if (hiddenItemIds.length === current.hiddenItemIds.length && hiddenItemIds.every((id, index) => id === current.hiddenItemIds[index])) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: { hiddenItemIds }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-visibility-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${stableHashText(hiddenItemIds.join("|"))}`,
        successMessage: visible ? "内容已恢复显示，未创建内容版本。" : "内容已隐藏，未创建内容版本。"
      });
    });
  }

  async function movePresentationItem(itemId: string, direction: "up" | "down") {
    if (!selectedBranch || !presentationConfig || !resumeDocument) {
      return;
    }
    const block = resumeDocumentBlocksById.get(itemId);
    if (!block) {
      setMessage("排序失败：找不到对应区块。");
      return;
    }
    const section = resumeDocument.sections.find((candidate) => candidate.type === block.sectionType);
    const sectionBlocks = section?.blocks ?? [];
    const currentIndex = sectionBlocks.findIndex((candidate) => candidate.contentItemId === itemId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sectionBlocks.length) {
      setMessage("当前区块已经在该栏目边界。");
      return;
    }

    enqueuePresentation(async (current) => {
      const currentSectionOrder = current.itemOrderBySection[block.sectionType] ?? [];
      const sectionItemIds = new Set(sectionBlocks.map((candidate) => candidate.contentItemId));
      const orderedIds = currentSectionOrder.filter((id) => sectionItemIds.has(id));
      const fallbackIds = sectionBlocks.map((candidate) => candidate.contentItemId);
      const effectiveOrder = orderedIds.length === fallbackIds.length ? orderedIds : fallbackIds;
      const idx = effectiveOrder.indexOf(itemId);
      if (idx < 0) {
        return current;
      }
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= effectiveOrder.length) {
        return current;
      }
      const nextOrder = [...effectiveOrder];
      const [moved] = nextOrder.splice(idx, 1);
      nextOrder.splice(swapIdx, 0, moved);
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: {
          itemOrderBySection: {
            ...current.itemOrderBySection,
            [block.sectionType]: nextOrder
          }
        }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-reorder-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${block.sectionType}-${stableHashText(nextOrder.join("|"))}`,
        successMessage: "排序已保存到当前简历展示配置，未创建内容版本。"
      });
    });
  }

  async function undoPresentationChange() {
    if (!selectedBranch || !presentationConfig) {
      setMessage("没有可撤销的展示操作。");
      return;
    }
    const queue = presentationQueueRef.current;
    if (queue.undoStack.length === 0) {
      setMessage("没有可撤销的展示操作。");
      return;
    }
    enqueuePresentation(async (current) => {
      const undoTarget = presentationQueueRef.current.undoStack.at(-1);
      if (!undoTarget) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: presentationSnapshotPatch(undoTarget)
      });
      const saved = await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-presentation-undo-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${stableHashText(JSON.stringify(presentationSnapshotPatch(undoTarget)))}`,
        successMessage: "已撤销最近一次展示操作。",
        recordHistory: false
      });
      if (saved) {
        const q = presentationQueueRef.current;
        q.undoStack = q.undoStack.slice(0, -1);
        q.redoStack = [...q.redoStack.slice(-49), current];
        setPresentationHistory({
          undoStack: q.undoStack,
          redoStack: q.redoStack
        });
      }
      return saved ?? current;
    });
  }

  async function redoPresentationChange() {
    if (!selectedBranch || !presentationConfig) {
      setMessage("没有可重做的展示操作。");
      return;
    }
    const queue = presentationQueueRef.current;
    if (queue.redoStack.length === 0) {
      setMessage("没有可重做的展示操作。");
      return;
    }
    enqueuePresentation(async (current) => {
      const redoTarget = presentationQueueRef.current.redoStack.at(-1);
      if (!redoTarget) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: presentationSnapshotPatch(redoTarget)
      });
      const saved = await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-presentation-redo-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${stableHashText(JSON.stringify(presentationSnapshotPatch(redoTarget)))}`,
        successMessage: "已重做最近一次展示操作。",
        recordHistory: false
      });
      if (saved) {
        const q = presentationQueueRef.current;
        q.undoStack = [...q.undoStack.slice(-49), current];
        q.redoStack = q.redoStack.slice(0, -1);
        setPresentationHistory({
          undoStack: q.undoStack,
          redoStack: q.redoStack
        });
      }
      return saved ?? current;
    });
  }

  async function restoreRevision(revisionId: string) {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前简历不可恢复：旧数据、归档、引用失效或缺少当前版本。");
      return;
    }
    try {
      const result = await repository.restoreResumeRevision({
        branchId: selectedBranch.id,
        revisionId,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-restore-${selectedBranch.id}-${selectedBranch.revision}-${revisionId}`
      });
      replaceBranch(result.branch);
      setMessage("已恢复旧版本；恢复操作已作为新的版本记录。");
    } catch {
      setMessage("恢复失败：版本链缺失、版本冲突或简历不可编辑。");
    }
  }

  async function undo() {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前简历不可撤销：旧数据、归档、引用失效或缺少当前版本。");
      return;
    }
    try {
      const result = await repository.undoResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-undo-${selectedBranch.id}-${selectedBranch.revision}`
      });
      replaceBranch(result.branch);
      setMessage("已撤销最近一次简历修改。");
    } catch {
      setMessage("撤销失败：没有可撤销版本或当前简历已变化。");
    }
  }

  function selectStudioItem(itemId: string) {
    if (!isStudioEditMode) {
      return;
    }
    setSelectedStudioItemId(itemId);
    setSelectedProfileFieldId(undefined);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
    setActivePropertyTab("block");
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
  }

  function startStudioEdit(itemId: string) {
    const block = resumeDocumentBlocksById.get(itemId);
    if (!block) {
      setStudioError("找不到对应的简历内容区块。");
      return;
    }
    setSelectedStudioItemId(itemId);
    if (!block.editable || !selectedBranchEditable) {
      setStudioError(`当前区块不可编辑：${block.notEditableReason ?? "branch_not_editable"}`);
      return;
    }
    setEditingStudioItemId(itemId);
    setStudioDraftText(block.text);
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
  }

  function cancelStudioEdit() {
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
  }

  function selectProfileField(fieldId: string, currentText: string) {
    if (!isStudioEditMode) {
      return;
    }
    setSelectedProfileFieldId(fieldId);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText(currentText);
    setProfileFieldError(undefined);
    setSelectedStudioItemId(undefined);
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
    setActivePropertyTab("document");
  }

  function startProfileFieldEdit(fieldId: string, currentText: string) {
    if (!profileFieldKey(fieldId)) {
      setProfileFieldError("当前基本信息字段暂不可编辑。");
      return;
    }
    selectProfileField(fieldId, currentText);
    setEditingProfileFieldId(fieldId);
  }

  function cancelProfileFieldEdit() {
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
  }

  async function saveProfileFieldEdit() {
    if (!profile || !editingProfileFieldId) {
      return;
    }
    const key = profileFieldKey(editingProfileFieldId);
    if (!key) {
      setProfileFieldError("当前基本信息字段暂不可编辑。");
      return;
    }
    const text = profileFieldDraftText.trim();
    if (key === "name" && !text) {
      setProfileFieldError("姓名不能为空。");
      return;
    }
    const now = new Date().toISOString();
    const nextBasics = { ...profile.basics };
    if (key === "name") {
      nextBasics.name = text;
    } else if (key === "link") {
      const index = profileLinkIndex(editingProfileFieldId);
      const links = [...nextBasics.links];
      if (text) {
        links[index] = text;
      } else {
        links.splice(index, 1);
      }
      nextBasics.links = links.filter((link) => link.trim().length > 0);
    } else {
      nextBasics[key] = text || undefined;
    }

    setProfileFieldPending(true);
    setProfileFieldError(undefined);
    try {
      const saved = await repository.saveProfile({
        ...profile,
        name: key === "name" ? text : profile.name,
        basics: nextBasics,
        version: profile.version + 1,
        updatedAt: now
      });
      setProfileOverride(saved);
      setEditingProfileFieldId(undefined);
      setSelectedProfileFieldId(undefined);
      setProfileFieldDraftText("");
      setMessage("基本信息已保存到个人资料；如需同步到岗位简历，请复核更新提示。");
    } catch {
      setProfileFieldError("基本信息保存失败，请检查内容后重试。");
    } finally {
      setProfileFieldPending(false);
    }
  }

  async function saveStudioEdit() {
    if (!selectedBranch || !resumeDocument || !editingStudioItemId) {
      return;
    }
    const block = resumeDocumentBlocksById.get(editingStudioItemId);
    if (!block) {
      setStudioError("找不到对应的简历内容区块。");
      return;
    }
    if (!selectedBranchEditable || !block.editable) {
      setStudioError(`当前区块不可编辑：${block.notEditableReason ?? "branch_not_editable"}`);
      return;
    }
    if (
      selectedBranch.revision !== resumeDocument.branchRevision ||
      selectedBranch.currentRevisionId !== resumeDocument.branchCurrentRevisionId
    ) {
      setStudioError("当前预览不是最新版本，请刷新后再编辑。");
      return;
    }

    const nextText = studioDraftText.trim();
    if (!nextText) {
      setStudioError("保存失败：文本不能为空。");
      return;
    }
    if (nextText === block.text.trim()) {
      cancelStudioEdit();
      setMessage("内容未变化，没有创建新的简历版本。");
      return;
    }

    const operationId = `v2-g0a-edit-${selectedBranch.id}-${selectedBranch.revision}-${block.contentItemId}-${stableHashText(nextText)}`;
    setPendingStudioOperationId(operationId);
    setStudioError(undefined);

    try {
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId,
        edits: [{ itemId: block.contentItemId, text: nextText }]
      });
      replaceBranch(result.branch);
      setSelectedBranchId(result.branch.id);
      setMessage(result.idempotent ? "该编辑已保存过，未重复创建版本。" : "简历内容已保存，并创建新的内容版本。");
    } catch (error) {
      setPendingStudioOperationId(undefined);
      setStudioError(error instanceof RevisionConflictError
        ? "保存失败：简历版本已变化，未覆盖最新内容。"
        : "保存失败：事实安全检查阻止了高风险修改，或当前简历不可编辑。");
    }
  }

  async function refreshSync() {
    if (!selectedBranch) {
      return;
    }
    const result = await repository.refreshResumeBranchSyncStatus({
      branchId: selectedBranch.id,
      operationId: `d1-refresh-sync-${selectedBranch.id}-${stableHashText(selectedBranch.syncStatusCache.checkedAt)}`
    });
    replaceBranch(result.branch);
    setMessage("更新提示已基于当前个人资料、岗位和事实引用重新计算；简历内容未被自动覆盖。");
  }

  async function openOrCreateApplication() {
    if (!selectedBranch) {
      return;
    }
    if (selectedBranch.branchPurpose !== "job_specific") {
      setMessage("通用简历不能直接加入投递工作台；请先在岗位优化面板创建岗位定制简历。");
      return;
    }
    if (!selectedBranch.currentRevisionId) {
      setMessage("当前简历缺少可投递版本，不能加入求职进度。");
      return;
    }

    try {
      const result = await repository.createApplicationFromBranch({
        branchId: selectedBranch.id,
        expectedBranchRevision: selectedBranch.revision,
        expectedRevisionId: selectedBranch.currentRevisionId,
        operationId: `v2-g6a-create-application-${selectedBranch.id}-${selectedBranch.revision}-${selectedBranch.currentRevisionId}`,
        initialStatus: "preparing"
      });
      setMessage(result.duplicate
        ? "该岗位简历已有未归档投递记录，已打开现有记录。"
        : "已加入投递工作台；未自动导出PDF，也未改变投递状态。");
      router.push(`/applications?applicationId=${encodeURIComponent(result.application.id)}`);
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "加入求职进度失败：简历版本已变化，请刷新后重试。"
        : "加入求职进度失败：只有已校验的岗位定制简历可加入投递工作台。");
    }
  }

  async function downloadPdf() {
    if (!selectedBranch || !renderModel) {
      setMessage("当前简历无法生成正式预览，不能导出。");
      setPdfExportState({
        status: "failed",
        message: "当前简历无法生成正式预览。",
        errorCode: "render_model_missing",
        canUseFallback: true
      });
      return;
    }
    if (!selectedBranchEditable || !selectedBranch.currentRevisionId) {
      setMessage("当前简历不可导出：旧数据、归档、引用失效或缺少当前版本。");
      setPdfExportState({
        status: "failed",
        message: "当前简历不可导出。",
        errorCode: branchNotEditableReason(selectedBranch) ?? "branch_not_exportable"
      });
      return;
    }
    if (!presentationConfig) {
      setMessage("展示配置尚未加载完成，请稍后再导出。");
      setPdfExportState({
        status: "failed",
        message: "展示配置尚未加载完成。",
        errorCode: "presentation_config_loading",
        canUseFallback: true
      });
      return;
    }

    const paginationPlan = pagination.plan;
    if (!paginationPlan || pagination.status === "measuring" || pagination.status === "measurement_failed") {
      setMessage("分页测量尚未完成，请稍后再导出。");
      setPdfExportState({
        status: "failed",
        message: "分页测量尚未完成。",
        errorCode: "pagination_measurement_unavailable",
        canUseFallback: true
      });
      return;
    }
    const startedAt = new Date().toISOString();
    const exportId = createExportId("v2-g3a-direct");
    const fileName = buildResumePdfFileName({
      candidateName: renderModel.candidate.name,
      jobTitle: renderModel.jobTitle,
      templateName: selectedTemplate.shortName,
      date: startedAt
    });
    const exportRequest = createResumePdfExportRequest({
      exportId,
      renderModel,
      presentationConfig,
      generatedAt: startedAt,
      filename: fileName,
      overflowStatus: paginationPlan.status,
      paginationPlan
    });

    setPdfExportState({
      status: "validating",
      exportId,
      filename: fileName,
        message: "正在校验当前版本和分页状态。"
    });

    try {
      const [latestBranch, latestProfile, latestJob] = await Promise.all([
        repository.getResumeBranch(selectedBranch.id),
        repository.getProfile(selectedBranch.profileId),
        selectedBranch.jobId ? repository.getJobDescription(selectedBranch.jobId) : Promise.resolve(undefined)
      ]);

      if (!latestBranch || !latestProfile || (selectedBranch.branchPurpose !== "general" && !latestJob)) {
        throw new Error("export_source_missing");
      }
      if (latestBranch.revision !== renderModel.branchRevision || latestBranch.currentRevisionId !== renderModel.branchCurrentRevisionId) {
        replaceBranch(latestBranch);
        setMessage("导出已停止：简历版本已更新，已刷新预览，请重新检查后导出。");
        setPdfExportState({
          status: "failed",
          exportId,
          filename: fileName,
          message: "分支版本已变化，请重新检查后导出。",
          errorCode: "stale_branch",
          canUseFallback: true
        });
        return;
      }

      mapBranchToResumeRenderModel({
        branch: latestBranch,
        profile: latestProfile,
        job: latestJob,
        presentationConfig
      });

      if (isPaginationPlanBlocked(paginationPlan)) {
        await repository.createResumeExportRecord({
          operationId: exportId,
          branchId: latestBranch.id,
          expectedBranchRevision: latestBranch.revision,
          expectedRevisionId: latestBranch.currentRevisionId!,
          templateId: effectiveTemplateId,
          overflowStatus: paginationPlan.status,
          exportStatus: "blocked_overflow",
          fileName,
          errorCode: "page_limit_exceeded",
          failureCode: "page_limit_exceeded",
          exportMethod: "direct_pdf",
          startedAt,
          completedAt: new Date().toISOString(),
          presentationRevision: presentationConfig.presentationRevision,
          presentationSnapshot: presentationSnapshotFromConfig(presentationConfig),
          snapshotHash: exportRequest.snapshot.snapshotHash,
          pagePolicy: paginationPlan.pagePolicy,
          requestedMaxPages: paginationPlan.requestedMaxPages,
          actualPageCount: paginationPlan.actualPageCount,
          paginationHash: paginationPlan.paginationHash,
          paginationSnapshot: paginationPlan,
          exceededPageLimit: true,
          continuationHeader: "none",
          pageSize: "A4",
          pageDimensions: { widthMm: 210, heightMm: 297 },
          ...(exportDiagnosticSummary ?? {})
        });
        setMessage("导出已阻止：当前页数超过所选页面策略。");
        setPdfExportState({
          status: "blocked_overflow",
          exportId,
          filename: fileName,
          message: "当前页数超过所选页面策略，已阻止下载。",
          errorCode: "page_limit_exceeded"
        });
        return;
      }

      setPdfExportState({
        status: "generating",
        exportId,
        filename: fileName,
        message: "正在生成 A4 PDF。"
      });
      const response = await fetch("/api/resume-export/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(exportRequest)
      });
      const responseType = response.headers.get("content-type") ?? "";
      if (!response.ok) {
        throw new Error(await readExportErrorCode(response));
      }
      if (!responseType.includes(PDF_MIME_TYPE)) {
        throw new Error("invalid_pdf_mime");
      }
      setPdfExportState({
        status: "downloading",
        exportId,
        filename: fileName,
        message: "PDF 已生成，正在触发浏览器下载。"
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isPdfBytes(bytes)) {
        throw new Error("invalid_pdf_response");
      }
      const pdfHash = await hashBytes(bytes);
      const completedAt = new Date().toISOString();
      await repository.createResumeExportRecord({
        operationId: exportId,
        branchId: latestBranch.id,
        expectedBranchRevision: latestBranch.revision,
        expectedRevisionId: latestBranch.currentRevisionId!,
        templateId: effectiveTemplateId,
        overflowStatus: paginationPlan.status,
        exportStatus: "direct_pdf_success",
        fileName,
        exportMethod: "direct_pdf",
        mimeType: PDF_MIME_TYPE,
        fileSize: bytes.byteLength,
        startedAt,
        completedAt,
        presentationRevision: presentationConfig.presentationRevision,
        presentationSnapshot: presentationSnapshotFromConfig(presentationConfig),
        snapshotHash: exportRequest.snapshot.snapshotHash,
        pdfContentHash: pdfHash,
        pagePolicy: paginationPlan.pagePolicy,
        requestedMaxPages: paginationPlan.requestedMaxPages,
        actualPageCount: paginationPlan.actualPageCount,
        paginationHash: paginationPlan.paginationHash,
        paginationSnapshot: paginationPlan,
        exceededPageLimit: false,
        continuationHeader: "none",
        pageSize: "A4",
        pageDimensions: { widthMm: 210, heightMm: 297 },
        ...(exportDiagnosticSummary ?? {}),
        allowHistoricalRevision: true
      });
      triggerBrowserDownload(new Blob([bytes], { type: PDF_MIME_TYPE }), fileName);
      setMessage(paginationPlan.status === "near_one_page_limit" || paginationPlan.status === "near_limit"
        ? "PDF 已生成并触发下载。当前接近单页上限，建议打开文件复核。"
        : "PDF 已生成并触发下载；浏览器不允许确认是否最终保存到磁盘。");
      setPdfExportState({
        status: "success",
        exportId,
        filename: fileName,
        message: "PDF 已生成并触发下载。"
      });
    } catch (error) {
      const errorCode = error instanceof RevisionConflictError ? "revision_conflict" : exportErrorCode(error);
      const blockedOverflow = errorCode === "snapshot_overflow" || errorCode === "export_snapshot_overflow";
      if (selectedBranch.currentRevisionId) {
        await recordDirectPdfFailure({
          exportId,
          branch: selectedBranch,
          presentationConfig,
          fileName,
          startedAt,
          overflowStatus: blockedOverflow ? "exceeds_two_pages" : paginationPlan.status,
          errorCode,
          snapshotHash: exportRequest.snapshot.snapshotHash,
          paginationPlan
        });
      }
      setMessage(blockedOverflow
        ? "导出已阻止：生成前重新检测到页数超过页面策略，请先删减内容或切换策略。"
        : "直接下载失败：可以重试，或使用浏览器打印 fallback。");
      setPdfExportState({
        status: blockedOverflow ? "blocked_overflow" : "failed",
        exportId,
        filename: fileName,
        message: blockedOverflow ? "生成前重新检测到页数超过页面策略。" : "直接下载失败，可以重试或使用浏览器打印。",
        errorCode,
        canUseFallback: !blockedOverflow
      });
    }
  }

  async function exportPdf() {
    if (!selectedBranch || !renderModel) {
      setMessage("当前简历无法生成正式预览，不能导出。");
      return;
    }

    const paginationPlan = pagination.plan;
    if (!paginationPlan || pagination.status === "measuring" || pagination.status === "measurement_failed") {
      setMessage("分页测量尚未完成，请稍后再使用打印 fallback。");
      return;
    }
    const startedAt = new Date().toISOString();
    const operationId = `d2-export-${selectedBranch.id}-${selectedBranch.revision}-${selectedBranch.currentRevisionId}-${effectiveTemplateId}-${paginationPlan.status}-${presentationConfig?.presentationRevision ?? 0}-${paginationPlan.paginationHash}`;
    const fileName = buildResumePdfFileName({
      candidateName: renderModel.candidate.name,
      jobTitle: renderModel.jobTitle,
      templateName: selectedTemplate.shortName,
      date: startedAt
    });
    const presentationSnapshot = presentationConfig ? presentationSnapshotFromConfig(presentationConfig) : undefined;

    try {
      const [latestBranch, latestProfile, latestJob] = await Promise.all([
        repository.getResumeBranch(selectedBranch.id),
        repository.getProfile(selectedBranch.profileId),
        selectedBranch.jobId ? repository.getJobDescription(selectedBranch.jobId) : Promise.resolve(undefined)
      ]);

      if (!latestBranch || !latestProfile || (selectedBranch.branchPurpose !== "general" && !latestJob)) {
        throw new Error("export_source_missing");
      }
      if (latestBranch.revision !== renderModel.branchRevision || latestBranch.currentRevisionId !== renderModel.branchCurrentRevisionId) {
        replaceBranch(latestBranch);
        setMessage("导出已停止：简历版本已更新，已刷新预览，请重新检查后导出。");
        return;
      }

      mapBranchToResumeRenderModel({
        branch: latestBranch,
        profile: latestProfile,
        job: latestJob,
        presentationConfig
      });

      if (isPaginationPlanBlocked(paginationPlan)) {
        await repository.createResumeExportRecord({
          operationId,
          branchId: latestBranch.id,
          expectedBranchRevision: latestBranch.revision,
          expectedRevisionId: latestBranch.currentRevisionId!,
          templateId: effectiveTemplateId,
          overflowStatus: paginationPlan.status,
          exportStatus: "blocked_overflow",
          fileName,
          errorCode: "page_limit_exceeded",
          failureCode: "page_limit_exceeded",
          exportMethod: "browser_print",
          startedAt,
          completedAt: new Date().toISOString(),
          presentationRevision: presentationConfig?.presentationRevision,
          presentationSnapshot,
          pagePolicy: paginationPlan.pagePolicy,
          requestedMaxPages: paginationPlan.requestedMaxPages,
          actualPageCount: paginationPlan.actualPageCount,
          paginationHash: paginationPlan.paginationHash,
          paginationSnapshot: paginationPlan,
          exceededPageLimit: true,
          continuationHeader: "none",
          pageSize: "A4",
          pageDimensions: { widthMm: 210, heightMm: 297 },
          ...(exportDiagnosticSummary ?? {})
        });
        setMessage("导出已阻止：当前页数超过所选页面策略。");
        setPdfExportState({
          status: "blocked_overflow",
          message: "当前页数超过所选页面策略，已阻止打印 fallback。",
          filename: fileName,
          errorCode: "page_limit_exceeded"
        });
        return;
      }

      await repository.createResumeExportRecord({
        operationId,
        branchId: latestBranch.id,
        expectedBranchRevision: latestBranch.revision,
        expectedRevisionId: latestBranch.currentRevisionId!,
        templateId: effectiveTemplateId,
        overflowStatus: paginationPlan.status,
        exportStatus: "print_invoked",
        fileName,
        exportMethod: "browser_print",
        mimeType: PDF_MIME_TYPE,
        startedAt,
        completedAt: new Date().toISOString(),
        presentationRevision: presentationConfig?.presentationRevision,
        presentationSnapshot,
        pagePolicy: paginationPlan.pagePolicy,
        requestedMaxPages: paginationPlan.requestedMaxPages,
        actualPageCount: paginationPlan.actualPageCount,
        paginationHash: paginationPlan.paginationHash,
        paginationSnapshot: paginationPlan,
        exceededPageLimit: false,
        continuationHeader: "none",
        pageSize: "A4",
        pageDimensions: { widthMm: 210, heightMm: 297 },
        ...(exportDiagnosticSummary ?? {})
      });
      printCurrentPage();
      setMessage(paginationPlan.status === "near_one_page_limit" || paginationPlan.status === "near_limit"
        ? "已打开浏览器打印 fallback。当前接近单页上限，请在打印预览中再次确认。"
        : "已打开浏览器打印 fallback，可保存为文本可复制的 PDF。");
      setPdfExportState({
        status: "success",
        filename: fileName,
        message: "已打开浏览器打印 fallback。"
      });
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "导出失败：简历版本已变化，请刷新后重试。"
        : "导出失败：简历可能不可导出、引用失效或导出记录写入失败。");
      setPdfExportState({
        status: "failed",
        filename: fileName,
        message: "浏览器打印 fallback 启动失败。",
        errorCode: exportErrorCode(error)
      });
    }
  }

  async function recordDirectPdfFailure(input: {
    exportId: string;
    branch: ResumeBranch;
    presentationConfig: ResumePresentationConfig;
    fileName: string;
    startedAt: string;
    overflowStatus: OverflowStatus;
    errorCode: string;
    snapshotHash: string;
    paginationPlan: ResumePaginationPlan;
  }) {
    try {
      await repository.createResumeExportRecord({
        operationId: input.exportId,
        branchId: input.branch.id,
        expectedBranchRevision: input.branch.revision,
        expectedRevisionId: input.branch.currentRevisionId!,
        templateId: input.presentationConfig.templateId,
        overflowStatus: input.overflowStatus,
        exportStatus: isPaginationPlanBlocked(input.paginationPlan) ? "blocked_overflow" : "failed",
        fileName: input.fileName,
        errorCode: input.errorCode,
        failureCode: input.errorCode,
        exportMethod: "direct_pdf",
        mimeType: PDF_MIME_TYPE,
        fileSize: 0,
        startedAt: input.startedAt,
        completedAt: new Date().toISOString(),
        presentationRevision: input.presentationConfig.presentationRevision,
        presentationSnapshot: presentationSnapshotFromConfig(input.presentationConfig),
        snapshotHash: input.snapshotHash,
        pagePolicy: input.paginationPlan.pagePolicy,
        requestedMaxPages: input.paginationPlan.requestedMaxPages,
        actualPageCount: input.paginationPlan.actualPageCount,
        paginationHash: input.paginationPlan.paginationHash,
        paginationSnapshot: input.paginationPlan,
        exceededPageLimit: isPaginationPlanBlocked(input.paginationPlan),
        continuationHeader: "none",
        pageSize: "A4",
        pageDimensions: { widthMm: 210, heightMm: 297 },
        ...(exportDiagnosticSummary ?? {})
      });
    } catch {
      // A failed export must never be promoted to success; failure-record writes
      // are best-effort because the branch may have moved while the PDF task ran.
    }
  }

  function replaceBranch(branch: ResumeBranch) {
    setBranches((current) => current.some((item) => item.id === branch.id)
      ? current.map((item) => item.id === branch.id ? branch : item)
      : [branch, ...current]);
    setSelectedBranchId(branch.id);
    setEditTexts({});
    clearStudioEditor();
    const queue = presentationQueueRef.current;
    queue.undoStack = [];
    queue.redoStack = [];
    setPresentationHistory({ undoStack: [], redoStack: [] });
    void repository.listResumeRevisions(branch.id).then(setRevisions);
  }

  if (workspace.status === "loading") {
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
    <main className="page-shell resume-workspace">
      <section className="page-title no-print">
        <p className="eyebrow">我的简历</p>
        <h1>简历工作台</h1>
        <p>在同一张 A4 画布上编辑内容、切换模板、检查页数，并导出 PDF。</p>
      </section>

      {workspace.status === "empty" && !profile ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice no-print">{message}</section> : null}

      <ResumeImportWizard
        repository={repository}
        profile={profile}
        onImported={handleImportedResumeReady}
      />

      <section className="stage-grid no-print">
        <article className="panel">
          <h2>1. 从岗位建议创建简历</h2>
          {draftOptions.length > 0 ? (
            <>
              <label className="field-label">
                岗位建议草稿
                <select data-testid="job-suggestion-draft-select" value={activeDraftId} onChange={(event) => setSelectedDraftId(event.target.value)}>
                  {draftOptions.map((option) => (
                    <option key={option.draft.id} value={option.draft.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <input data-testid="new-resume-branch-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="简历名称" />
              <button className="primary-button" data-testid="create-job-resume" onClick={createBranch}>创建岗位简历</button>
            </>
          ) : (
            <p>暂无岗位建议草稿。请先在岗位工作区完成经历匹配和建议生成。</p>
          )}
        </article>

        <article className="panel">
          <h2>2. 选择简历</h2>
          {branches.length > 0 ? (
            <div className="branch-list">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  className={`match-row ${branch.id === activeBranchId ? "match-row-active" : ""}`}
                  onClick={() => setSelectedBranchId(branch.id)}
                >
                  <strong>{branch.name}</strong>
                  <span>{branchPurposeLabel(branch.branchPurpose)} / {branchStatusLabel(branch)} / {syncStatusLabel(branch.syncStatusCache.status)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无可编辑简历。</p>
          )}
        </article>
      </section>

      {selectedBranch ? (
        <section className="panel no-print">
          <div className="section-heading">
            <div>
              <h2>{selectedBranch.name}</h2>
              <p>
                {selectedBranchJob ? `${selectedBranchJob.company} / ${selectedBranchJob.title}` : "通用简历 / 无目标岗位"}
                {" "} / {branchPurposeLabel(selectedBranch.branchPurpose)} / {branchStatusLabel(selectedBranch)}
              </p>
            </div>
            <div className="action-row">
              <div className="studio-mode-switch" role="tablist" aria-label="编辑模式">
                <button
                  type="button"
                  className={studioMode === "manual" ? "mode-tab mode-tab-active" : "mode-tab"}
                  onClick={() => setStudioMode("manual")}
                >
                  手动编辑
                </button>
                <button
                  type="button"
                  className={studioMode === "ai" ? "mode-tab mode-tab-active" : "mode-tab"}
                  onClick={() => setStudioMode("ai")}
                >
                  AI岗位优化
                </button>
              </div>
              <button
                className="primary-button"
                data-testid="open-or-create-application"
                onClick={openOrCreateApplication}
                disabled={!selectedBranchEditable || selectedBranch.branchPurpose !== "job_specific"}
              >
                {selectedBranch.branchPurpose === "job_specific" ? "加入求职进度" : "先创建岗位定制简历"}
              </button>
              <button className="secondary-button" onClick={refreshSync}>刷新更新提示</button>
              <button className="secondary-button" onClick={undo} disabled={!selectedBranchEditable}>撤销</button>
            </div>
          </div>

          {selectedBranch.migrationStatus === "legacy_unverified" ? (
            <div className="warning-box">这是旧占位简历，已只读保留，不参与正式编辑、版本恢复、预览或后续导出。</div>
          ) : null}

          {!selectedBranchEditable && selectedBranch.migrationStatus !== "legacy_unverified" ? (
            <div className="warning-box">当前简历不可编辑：{branchNotEditableLabel(branchNotEditableReason(selectedBranch))}。</div>
          ) : null}

          {selectedBranch.syncStatusCache.status !== "in_sync" ? (
            <div className="warning-box">{syncStatusMessage(selectedBranch.syncStatusCache.status)}</div>
          ) : null}

        </section>
      ) : null}

      {selectedBranch ? (
        <section className="resume-preview-layout">
          <aside className="panel no-print resume-export-panel">
            <div className="property-panel-heading">
              <h2>编辑与导出</h2>
              <button
                className="secondary-button compact"
                onClick={() => setIsStylePanelOpen((current) => !current)}
              >
                {isStylePanelOpen ? "收起面板" : "展开面板"}
              </button>
            </div>
            <div className="property-summary">
              <strong>{selectedStudioBlock ? selectedStudioBlock.text.slice(0, 28) : selectedBranch.name}</strong>
              <span>
                {selectedStudioBlock ? "已选段落" : "整份简历"} / {selectedTemplate.name} / {selectedTemplate.layout === "two-column" ? "双栏" : "单栏"}
              </span>
            </div>
            <label className="inline-toggle studio-edit-toggle">
              <input
                type="checkbox"
                data-testid="canvas-edit-toggle"
                checked={isStudioEditMode}
                disabled={!renderModel || !resumeDocument?.editable}
                onChange={(event) => setIsStudioEditMode(event.target.checked)}
              />
              画布编辑
            </label>
            {isStudioEditMode && resumeDocument ? (
              <div className="save-status">单击区块选中，双击或 Enter/F2 编辑，Escape 取消，Ctrl/Cmd+Enter 保存。</div>
            ) : null}
            {studioMode === "manual" ? (
              <div className="studio-sidebar-section">
                <div className="section-heading compact-heading">
                  <div>
                    <h3>内容</h3>
                    <p>选择段落后可在左侧或 A4 画布上编辑，同一套保存链路会生成新版本。</p>
                  </div>
                </div>
                <div className="branch-editor">
                  {selectedBranch.contentItems.map((item) => {
                    const presentationBlock = resumeDocumentBlocksById.get(item.id);
                    const presentationVisible = presentationBlock?.visible ?? item.visible;
                    return (
                      <article key={item.id} className="suggestion-card">
                        <div className="section-heading compact-heading">
                          <div>
                            <h3>{contentItemTypeLabel(item.itemType)}</h3>
                            <p>{guardStatusLabel(item.guardStatus)} / {riskLevelLabel(item.guardRiskLevel)}</p>
                          </div>
                          <label className="inline-toggle">
                            <input
                              type="checkbox"
                              checked={presentationVisible}
                              disabled={!selectedBranchEditable || !presentationConfig || !item.visible}
                              onChange={(event) => setPresentationItemVisibility(item.id, event.target.checked)}
                            />
                            显示
                          </label>
                        </div>
                        {!item.visible ? (
                          <div className="warning-box">该内容已在正文版本中隐藏，展示设置不会静默改写旧内容。</div>
                        ) : null}
                        {item.guardMode === "rule_only_verified" ? (
                          <div className="warning-box">规则事实检查已通过，AI 复核尚未完成。</div>
                        ) : null}
                        <textarea
                          className="textarea small-textarea"
                          value={editTexts[item.id] ?? item.text}
                          disabled={!selectedBranchEditable}
                          onFocus={() => selectStudioItem(item.id)}
                          onChange={(event) => setEditTexts((current) => ({ ...current, [item.id]: event.target.value }))}
                        />
                        <div className="action-row">
                          <button className="primary-button" disabled={!selectedBranchEditable} onClick={() => saveItem(item.id)}>
                            保存
                          </button>
                          <button className="secondary-button compact" disabled={!selectedBranchEditable} onClick={() => startStudioEdit(item.id)}>
                            在画布上编辑
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="studio-sidebar-section">
              <JobOptimizationPanel
                repository={repository}
                profile={profile}
                jobs={jobs}
                branch={selectedBranch}
                selectedContentItemId={selectedStudioItemId}
                canEdit={selectedBranchEditable}
                onJobCreated={(job) => setLocalJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])}
                onBranchReady={replaceBranch}
                onApplyStructureSuggestion={(kind, contentItemId) => {
                  if (kind === "hide") {
                    void setPresentationItemVisibility(contentItemId, false);
                    setMessage("结构建议已隐藏该段落；未创建正文版本。");
                    return;
                  }
                  if (kind === "show") {
                    void setPresentationItemVisibility(contentItemId, true);
                    setMessage("结构建议已恢复该段落；未创建正文版本。");
                    return;
                  }
                  void movePresentationItem(contentItemId, "up");
                  setMessage("结构建议已上移该段落；未创建正文版本。");
                }}
                onMessage={setMessage}
              />
              <ResumeDiagnosticsPanel
                snapshot={diagnosticSnapshot}
                stale={diagnosticsStale}
                running={diagnosticRunning}
                error={diagnosticError}
                canEdit={selectedBranchEditable}
                onRun={() => { void runDiagnostics(); }}
                onLocateIssue={locateDiagnosticIssue}
                onApplyAction={(issue, action) => { void applyDiagnosticAction(issue, action); }}
                onIgnoreIssue={(issue) => { void ignoreDiagnosticIssue(issue); }}
              />
            </div>
            <label className="field-label">
              模板
              <select
                value={effectiveTemplateId}
                disabled={!presentationConfig || Boolean(pendingTemplateApplyId)}
                onChange={(event) => { void updatePresentationTemplate(event.target.value as TemplateId); }}
              >
                {resumeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} / {template.shortName}</option>
                ))}
              </select>
            </label>
            <div className="action-row template-center-entry">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsTemplateCenterOpen((current) => !current)}
              >
                模板中心
              </button>
            </div>
            <div className="action-row presentation-history-actions">
              <button
                className="secondary-button compact"
                disabled={!presentationHistory.undoStack.length || !presentationConfig}
                onClick={() => { void undoPresentationChange(); }}
              >
                回退展示
              </button>
              <button
                className="secondary-button compact"
                disabled={!presentationHistory.redoStack.length || !presentationConfig}
                onClick={() => { void redoPresentationChange(); }}
              >
                重做展示
              </button>
            </div>
            <TemplateCenter
              open={isTemplateCenterOpen}
              model={renderModel}
              presentationConfig={presentationConfig}
              currentTemplateId={effectiveTemplateId}
              canApply={selectedBranchEditable && Boolean(presentationConfig) && !pendingTemplateApplyId}
              pendingTemplateId={pendingTemplateApplyId}
              onApply={(nextTemplateId) => { void updatePresentationTemplate(nextTemplateId); }}
              onClose={() => setIsTemplateCenterOpen(false)}
            />
            {isStylePanelOpen ? (
              <div className="property-panel-body" data-testid="resume-property-panel">
                <div className="property-tabs" role="tablist" aria-label="属性面板上下文">
                  {(["document", "section", "block"] as const).map((tab) => {
                    const disabled = tab === "section"
                      ? !selectedStudioSection
                      : tab === "block"
                        ? !selectedStudioBlock
                        : false;
                    const active = activePropertyTab === tab || (disabled && tab === "document");
                    return (
                      <button
                        key={tab}
                        className={`secondary-button compact ${active ? "property-tab-active" : ""}`}
                        disabled={disabled}
                        onClick={() => setActivePropertyTab(tab)}
                        type="button"
                      >
                        {propertyTabLabel(tab)}
                      </button>
                    );
                  })}
                </div>

                {activePropertyTab === "document" || !selectedStudioBlock ? (
                  <div className="property-section" data-testid="document-style-panel">
                    <div className="property-control-grid">
                      <label className="field-label">
                        页面密度
                        <select
                          aria-label="页面密度"
                          value={presentationConfig?.theme.density ?? "balanced"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsDensity}
                          onChange={(event) => {
                            const density = event.target.value as ResumePresentationConfig["theme"]["density"];
                            void updatePresentationStyle((current) => ({
                              theme: { ...current.theme, density }
                            }), "页面密度已保存。");
                          }}
                        >
                          {(["compact", "balanced", "spacious"] as const).map((value) => (
                            <option key={value} value={value}>{densityLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        正文字号
                        <select
                          aria-label="正文字号"
                          value={presentationConfig?.typography.bodyTextScale ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsBodyScale}
                          onChange={(event) => {
                            const bodyTextScale = event.target.value as ResumePresentationConfig["typography"]["bodyTextScale"];
                            void updatePresentationStyle((current) => ({
                              typography: { ...current.typography, bodyTextScale }
                            }), "正文字号已保存。");
                          }}
                        >
                          {(["small", "normal", "large"] as const).map((value) => (
                            <option key={value} value={value}>{scaleLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        标题字号
                        <select
                          aria-label="标题字号"
                          value={presentationConfig?.typography.titleTextScale ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsHeadingScale}
                          onChange={(event) => {
                            const titleTextScale = event.target.value as ResumePresentationConfig["typography"]["titleTextScale"];
                            void updatePresentationStyle((current) => ({
                              typography: { ...current.typography, titleTextScale }
                            }), "标题字号已保存。");
                          }}
                        >
                          {(["small", "normal", "large"] as const).map((value) => (
                            <option key={value} value={value}>{scaleLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        行距
                        <select
                          aria-label="行距"
                          value={presentationConfig?.typography.lineHeight ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsLineHeight}
                          onChange={(event) => {
                            const lineHeight = event.target.value as ResumePresentationConfig["typography"]["lineHeight"];
                            void updatePresentationStyle((current) => ({
                              typography: { ...current.typography, lineHeight }
                            }), "行距已保存。");
                          }}
                        >
                          {(["tight", "normal", "relaxed"] as const).map((value) => (
                            <option key={value} value={value}>{spacingLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        条目间距
                        <select
                          aria-label="条目间距"
                          value={presentationConfig?.spacing.itemGap ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsItemGap}
                          onChange={(event) => {
                            const itemGap = event.target.value as ResumePresentationConfig["spacing"]["itemGap"];
                            void updatePresentationStyle((current) => ({
                              spacing: { ...current.spacing, itemGap }
                            }), "条目间距已保存。");
                          }}
                        >
                          {(["tight", "normal", "relaxed"] as const).map((value) => (
                            <option key={value} value={value}>{spacingLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        栏目间距
                        <select
                          aria-label="栏目间距"
                          value={presentationConfig?.spacing.sectionGap ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsSectionGap}
                          onChange={(event) => {
                            const sectionGap = event.target.value as ResumePresentationConfig["spacing"]["sectionGap"];
                            void updatePresentationStyle((current) => ({
                              spacing: { ...current.spacing, sectionGap }
                            }), "栏目间距已保存。");
                          }}
                        >
                          {(["tight", "normal", "relaxed"] as const).map((value) => (
                            <option key={value} value={value}>{spacingLabel(value)}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-label">
                      主题强调色
                      <div className="color-swatch-row">
                        {(["graphite", "emerald", "blue", "rose"] as const).map((color) => (
                          <button
                            key={color}
                            type="button"
                            className={`color-swatch ${presentationConfig?.theme.accentColor === color ? "color-swatch-active" : ""}`}
                            style={{ backgroundColor: accentSwatchColor(color) }}
                            aria-label={`主题强调色：${accentColorLabel(color)}`}
                            disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsAccentColor}
                            onClick={() => {
                              void updatePresentationStyle((current) => ({
                                theme: { ...current.theme, accentColor: color }
                              }), "主题强调色已保存。");
                            }}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="action-row">
                      <button
                        className="secondary-button compact"
                        disabled={!presentationConfig || !selectedBranchEditable}
                        onClick={() => { void resetTemplateStyle(); }}
                      >
                        恢复模板默认样式
                      </button>
                    </div>
                    <div className="property-section pagination-controls" data-testid="pagination-controls">
                      <label className="field-label">
                        页面策略
                        <select
                          aria-label="页面策略"
                          data-testid="page-policy-selector"
                          value={presentationConfig?.pagination.pagePolicy ?? "one_page_strict"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsTwoPages}
                          onChange={(event) => {
                            void updatePagePolicy(event.target.value as ResumePresentationConfig["pagination"]["pagePolicy"]);
                          }}
                        >
                          <option value="one_page_strict">严格一页</option>
                          <option value="up_to_two_pages">最多两页</option>
                        </select>
                      </label>
                      <div className="pagination-summary" data-testid="pagination-summary">
                        <strong>实际页数：{pagination.plan?.actualPageCount ?? "测量中"}</strong>
                        <span>{paginationStatusLabel(pagination.status)}</span>
                        {pagination.plan ? <span>策略上限：{pagination.plan.requestedMaxPages} 页</span> : null}
                      </div>
                    </div>
                    {!selectedTemplate.capabilities.supportsTwoPages ? (
                      <p className="save-status">当前模板不支持两页策略。</p>
                    ) : null}
                  </div>
                ) : null}

                {activePropertyTab === "section" && selectedStudioSection && selectedStudioBlock ? (
                  <div className="property-section" data-testid="section-style-panel">
                    <div className="property-summary compact-property-summary">
                      <strong>{selectedStudioSection.title}</strong>
                      <span>栏目 / {sectionTypeLabel(selectedStudioSection.type)}</span>
                    </div>
                    <label className="inline-toggle">
                      <input
                        type="checkbox"
                        checked={presentationConfig?.sectionStyleOverrides[selectedStudioSection.type]?.showTitle !== false}
                        disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsSectionTitleVisibility}
                        onChange={(event) => { void setSectionTitleVisibility(selectedStudioSection.type, event.target.checked); }}
                      />
                      显示栏目标题
                    </label>
                    <label className="inline-toggle">
                      <input
                        type="checkbox"
                        checked={selectedSectionPageBreakEnabled}
                        disabled={!presentationConfig || !selectedBranchEditable || !selectedSectionCanPageBreak}
                        onChange={(event) => { void setSectionPageBreak(selectedStudioSection.type, event.target.checked); }}
                      />
                      从下一页开始
                    </label>
                    {presentationConfig?.pagination.pagePolicy !== "up_to_two_pages" ? (
                      <p className="save-status">仅“最多两页”策略下可设置栏目分页提示。</p>
                    ) : selectedStudioSection.type === firstVisibleSectionType ? (
                      <p className="save-status">第一个可见栏目不能从下一页开始。</p>
                    ) : null}
                    <button
                      className="secondary-button compact"
                      disabled={!presentationConfig || !selectedBranchEditable}
                      onClick={() => { void resetSectionStyle(selectedStudioSection.type); }}
                    >
                      恢复当前栏目默认值
                    </button>
                  </div>
                ) : null}

                {activePropertyTab === "block" && selectedStudioBlock ? (
                  <div className="property-section" data-testid="block-style-panel">
                    <div className="property-summary compact-property-summary">
                      <strong>{selectedStudioBlock.text.slice(0, 36)}</strong>
                      <span>段落 / {contentItemTypeLabel(selectedStudioBlock.itemType)} / {guardStatusLabel(selectedStudioBlock.guardStatus)}</span>
                    </div>
                    <label className="inline-toggle">
                      <input
                        type="checkbox"
                        checked={selectedStudioBlock.visible}
                        disabled={!selectedBranchEditable || !presentationConfig || !selectedStudioBlock.contentVisible}
                        onChange={(event) => { void setPresentationItemVisibility(selectedStudioBlock.contentItemId, event.target.checked); }}
                      />
                      显示
                    </label>
                    <div className="action-row resume-structure-actions">
                      <button className="secondary-button compact" disabled={!selectedBranchEditable || !presentationConfig} onClick={() => { void movePresentationItem(selectedStudioBlock.contentItemId, "up"); }}>
                        上移
                      </button>
                      <button className="secondary-button compact" disabled={!selectedBranchEditable || !presentationConfig} onClick={() => { void movePresentationItem(selectedStudioBlock.contentItemId, "down"); }}>
                        下移
                      </button>
                      <button className="secondary-button compact" disabled={!selectedBranchEditable || !presentationConfig} onClick={() => { void setPresentationItemVisibility(selectedStudioBlock.contentItemId, false); }}>
                        隐藏
                      </button>
                    </div>
                    <button
                      className="primary-button compact"
                      disabled={!selectedStudioBlock.editable || !selectedBranchEditable}
                      onClick={() => startStudioEdit(selectedStudioBlock.contentItemId)}
                    >
                      编辑
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {presentationHiddenBlocks.length > 0 ? (
              <div className="hidden-block-list">
                <strong>已隐藏内容</strong>
                {presentationHiddenBlocks.map((block) => (
                  <button
                    key={block.contentItemId}
                    className="secondary-button compact hidden-block-button"
                    disabled={!selectedBranchEditable || !presentationConfig}
                    onClick={() => { void setPresentationItemVisibility(block.contentItemId, true); }}
                  >
                    显示：{block.text.slice(0, 18)}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={`overflow-status overflow-status-${pagination.status}`} data-testid="overflow-status">
              <strong>{paginationStatusLabel(pagination.status)}</strong>
              <span>
                {pagination.plan
                  ? `实际 ${pagination.plan.actualPageCount} 页 / 上限 ${pagination.plan.requestedMaxPages} 页 / 剩余 ${Math.floor(pagination.plan.measurement.remainingPx)}px`
                  : "正在测量分页"}
              </span>
            </div>
            {renderModel?.safety.ruleOnlyItemIds.length ? (
              <div className="warning-box">该简历包含仅由规则检查通过的内容，工作台已显示校验状态；PDF 正文不会加入内部风险标签。</div>
            ) : null}
            {pagination.status === "near_one_page_limit" || pagination.status === "near_limit" ? (
              <div className="warning-box">当前接近单页上限，建议导出前在打印预览中复核。</div>
            ) : null}
            {pagination.plan && isPaginationPlanBlocked(pagination.plan) ? (
              <div className="warning-box">
                <p>当前页数超过所选页面策略，正式导出会被阻止。</p>
                {reductionHints.length > 0 ? (
                  <ul>
                    {reductionHints.map((hint) => <li key={hint}>{hint}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="export-control-stack" data-testid="pdf-export-controls">
              <button
                className="primary-button"
                onClick={downloadPdf}
                disabled={!renderModel || !presentationConfig || isPdfExportBusy || pagination.blocked || pagination.status === "measuring"}
              >
                {isPdfExportBusy ? "生成 PDF 中" : "下载 PDF"}
              </button>
              <button
                className="secondary-button"
                onClick={exportPdf}
                disabled={!renderModel || isPdfExportBusy}
              >
                打印 / 保存 PDF
              </button>
              <p
                className={`save-status export-status-text ${pdfExportState.status === "failed" || pdfExportState.status === "blocked_overflow" ? "save-status-failed" : ""}`}
                aria-live="polite"
                data-testid="pdf-export-status"
              >
                {exportStatusLabel(pdfExportState)}
              </p>
              {pdfExportState.status === "failed" && pdfExportState.canUseFallback ? (
                <p className="save-status">可重试下载，或使用浏览器打印 fallback。</p>
              ) : null}
            </div>
            <div className="studio-sidebar-section">
              <h3>版本历史</h3>
              {revisions.length > 0 ? (
                <div className="revision-list compact-revision-list">
                  {revisions.map((revision) => (
                    <article key={revision.id} className="review-row">
                      <span>
                        <strong>版本 {revision.revisionNumber + 1}</strong>
                        <small>{revisionSourceLabel(revision.source)}</small>
                      </span>
                      <button
                        className="secondary-button compact"
                        disabled={!selectedBranchEditable || revision.id === selectedBranch.currentRevisionId}
                        onClick={() => restoreRevision(revision.id)}
                      >
                        恢复
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p>暂无版本历史。</p>
              )}
            </div>
            {renderResult.error ? <p className="save-status save-status-failed">{renderResult.error}</p> : null}
          </aside>

          <div className="resume-preview-stage">
            {renderModel ? (
              <A4ResumePreview
                model={renderModel}
                template={selectedTemplate}
                pageRef={pageRef}
                paginationPlan={pagination.plan}
                presentationConfig={presentationConfig}
                editor={resumeDocument ? {
                  enabled: isStudioEditMode,
                  selectedItemId: selectedStudioItemId,
                  editingItemId: editingStudioItemId,
                  selectedBlock: selectedStudioBlock,
                  selectedProfileFieldId,
                  editingProfileFieldId,
                  selectedProfileFieldLabel: profileFieldLabel(selectedProfileFieldId),
                  draftText: studioDraftText,
                  profileDraftText: profileFieldDraftText,
                  error: studioError,
                  profileError: profileFieldError,
                  pending: Boolean(pendingStudioOperationId) || profileFieldPending,
                  onSelect: selectStudioItem,
                  onStartEdit: startStudioEdit,
                  onDraftTextChange: setStudioDraftText,
                  onSave: saveStudioEdit,
                  onCancel: cancelStudioEdit,
                  onSelectProfileField: selectProfileField,
                  onStartProfileFieldEdit: startProfileFieldEdit,
                  onProfileDraftTextChange: setProfileFieldDraftText,
                  onSaveProfileField: saveProfileFieldEdit,
                  onCancelProfileField: cancelProfileFieldEdit,
                  onMoveUp: (itemId) => { void movePresentationItem(itemId, "up"); },
                  onMoveDown: (itemId) => { void movePresentationItem(itemId, "down"); },
                  onHide: (itemId) => { void setPresentationItemVisibility(itemId, false); }
                } : undefined}
              />
            ) : (
              <div className="panel no-print">当前简历不能进入正式模板预览。</div>
            )}
          </div>
        </section>
      ) : null}

    </main>
  );
}

function buildRenderModel(input: {
  branch?: ResumeBranch;
  profile?: Parameters<typeof mapBranchToResumeRenderModel>[0]["profile"];
  job?: Parameters<typeof mapBranchToResumeRenderModel>[0]["job"];
  presentationConfig?: ResumePresentationConfig;
}): { model?: ResumeRenderModel; error?: string } {
  if (!input.branch || !input.profile || (input.branch.branchPurpose !== "general" && !input.job)) {
    return {};
  }

  try {
    return {
      model: mapBranchToResumeRenderModel({
        branch: input.branch,
        profile: input.profile,
        job: input.job,
        presentationConfig: input.presentationConfig
      })
    };
  } catch (error) {
    return {
      error: error instanceof ResumeRenderMapperError
        ? `预览阻止：${error.code}`
        : "预览阻止：简历内容无法通过正式渲染校验。"
    };
  }
}

function buildNextPresentationConfig(input: {
  current: ResumePresentationConfig;
  branch: ResumeBranch;
  patch: Partial<Pick<
    ResumePresentationConfig,
    "templateId" | "itemOrderBySection" | "hiddenItemIds" | "typography" | "spacing" | "theme" | "pagination" | "sectionOrder" | "sectionStyleOverrides"
  >>;
}): ResumePresentationConfig {
  if (!input.branch.currentRevisionId) {
    throw new Error("branch_current_revision_missing");
  }
  return {
    ...input.current,
    ...input.patch,
    contentRevision: {
      branchRevision: input.branch.revision,
      currentRevisionId: input.branch.currentRevisionId
    },
    presentationRevision: input.current.presentationRevision + 1,
    updatedAt: new Date().toISOString()
  };
}

function presentationSnapshotPatch(config: ResumePresentationConfig) {
  return {
    templateId: config.templateId,
    sectionOrder: config.sectionOrder,
    itemOrderBySection: config.itemOrderBySection,
    hiddenItemIds: config.hiddenItemIds,
    typography: config.typography,
    spacing: config.spacing,
    theme: config.theme,
    pagination: config.pagination,
    sectionStyleOverrides: config.sectionStyleOverrides
  };
}

function presentationStylePatch(config: ResumePresentationConfig): ResumeTemplateStyleConfig {
  return {
    typography: config.typography,
    spacing: config.spacing,
    theme: config.theme,
    sectionStyleOverrides: config.sectionStyleOverrides
  };
}

function parseWorkbenchState(value: unknown): WorkbenchState {
  if (!value || typeof value !== "object") {
    return {};
  }
  const candidate = value as WorkbenchState;
  return {
    branchId: typeof candidate.branchId === "string" ? candidate.branchId : undefined,
    templateId: isResumeTemplateId(candidate.templateId) ? candidate.templateId : undefined,
    stylePanelOpen: typeof candidate.stylePanelOpen === "boolean" ? candidate.stylePanelOpen : undefined
  };
}

function workbenchStateKey(profileId: string) {
  return `resumeWorkbenchState:${profileId}`;
}

function buildReductionHints(model: ResumeRenderModel) {
  return model.sections
    .flatMap((section) => section.blocks.map((block) => ({ section: section.title, block })))
    .sort((a, b) => b.block.text.length - a.block.text.length)
    .slice(0, 3)
    .map((item, index) => `${index + 1}. ${item.section}：优先压缩「${item.block.text.slice(0, 28)}...」`);
}

function createExportId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

async function readExportErrorCode(response: Response) {
  try {
    const body = await response.json() as { code?: unknown };
    return typeof body.code === "string" ? body.code : `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

function isPdfBytes(bytes: Uint8Array) {
  return bytes.length > 4
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46;
}

function triggerBrowserDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportErrorCode(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "export_failed";
}

function exportStatusLabel(state: PdfExportState) {
  if (state.message) {
    return state.message;
  }
  if (state.status === "validating") {
    return "正在校验导出快照。";
  }
  if (state.status === "generating") {
    return "正在生成 PDF。";
  }
  if (state.status === "downloading") {
    return "正在触发浏览器下载。";
  }
  if (state.status === "success") {
    return "PDF 已生成并触发下载。";
  }
  if (state.status === "failed") {
    return "直接下载失败。";
  }
  if (state.status === "blocked_overflow") {
    return "当前页数超过页面策略，已阻止导出。";
  }
  return "准备下载 PDF。";
}

function canEditBranch(branch: ResumeBranch) {
  return branchNotEditableReason(branch) === undefined;
}

function branchNotEditableReason(branch: ResumeBranch) {
  if (branch.migrationStatus !== "verified") {
    return "legacy_unverified";
  }
  if (branch.lifecycleStatus !== "active") {
    return "archived";
  }
  if (!branch.currentRevisionId) {
    return "missing_current_revision";
  }
  if (branch.syncStatusCache.status === "invalid_reference") {
    return "invalid_reference";
  }
  return undefined;
}

function branchPurposeLabel(value: ResumeBranch["branchPurpose"]) {
  return value === "job_specific" ? "岗位简历" : "通用简历";
}

function branchStatusLabel(branch: ResumeBranch) {
  if (branch.migrationStatus !== "verified") {
    return "旧数据只读";
  }
  if (branch.lifecycleStatus !== "active") {
    return "已归档";
  }
  return "可编辑";
}

function branchNotEditableLabel(reason: ReturnType<typeof branchNotEditableReason>) {
  const labels: Record<string, string> = {
    legacy_unverified: "旧数据只读",
    archived: "已归档",
    missing_current_revision: "缺少当前版本",
    invalid_reference: "引用的个人资料或岗位已变化"
  };
  return reason ? labels[reason] ?? reason : "未知原因";
}

function syncStatusLabel(value: string) {
  const labels: Record<string, string> = {
    in_sync: "已同步",
    stale_profile: "个人资料有更新",
    stale_job: "岗位有更新",
    invalid_reference: "引用失效"
  };
  return labels[value] ?? value;
}

function syncStatusMessage(value: string) {
  const labels: Record<string, string> = {
    stale_profile: "个人资料已有更新，请检查是否需要同步到这份简历。",
    stale_job: "关联岗位已有更新，请检查岗位定制内容是否仍然适用。",
    invalid_reference: "这份简历引用的个人资料或岗位已失效，当前只能保守处理。"
  };
  return labels[value] ?? "这份简历有更新提示，请复核后继续。";
}

function revisionSourceLabel(value: string) {
  const labels: Record<string, string> = {
    initial: "初始版本",
    edit: "手动编辑",
    suggestion_accept: "接受建议",
    restore: "恢复旧版本",
    undo: "撤销操作",
    import: "导入创建"
  };
  return labels[value] ?? "内容修改";
}

type EditableProfileFieldKey = "name" | "phone" | "email" | "location" | "link";

function profileFieldKey(fieldId: string): EditableProfileFieldKey | undefined {
  if (fieldId === "profile:name") {
    return "name";
  }
  if (fieldId === "profile:phone") {
    return "phone";
  }
  if (fieldId === "profile:email") {
    return "email";
  }
  if (fieldId === "profile:location") {
    return "location";
  }
  if (fieldId.startsWith("profile:link:")) {
    return "link";
  }
  return undefined;
}

function profileLinkIndex(fieldId: string) {
  const raw = Number(fieldId.split(":")[2] ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function profileFieldLabel(fieldId?: string) {
  if (!fieldId) {
    return "";
  }
  const labels: Record<EditableProfileFieldKey, string> = {
    name: "姓名",
    phone: "电话",
    email: "邮箱",
    location: "所在地",
    link: "链接"
  };
  const key = profileFieldKey(fieldId);
  return key ? labels[key] : "基本信息";
}

function propertyTabLabel(tab: PropertyPanelTab) {
  if (tab === "section") {
    return "栏目";
  }
  if (tab === "block") {
    return "段落";
  }
  return "整页";
}

function contentItemTypeLabel(value: string) {
  const labels: Record<string, string> = {
    summary: "个人简介",
    experience: "经历",
    project: "项目",
    education: "教育",
    skill: "技能",
    certificate: "证书",
    award: "奖项",
    language: "语言",
    custom: "自定义"
  };
  return labels[value] ?? "段落";
}

function guardStatusLabel(value: string) {
  const labels: Record<string, string> = {
    passed: "事实检查通过",
    failed: "事实检查失败",
    blocked: "已阻断",
    pending: "待检查",
    rule_only_verified: "规则检查通过"
  };
  return labels[value] ?? value;
}

function riskLevelLabel(value: string) {
  const labels: Record<string, string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  };
  return labels[value] ?? value;
}

function scaleLabel(value: "small" | "normal" | "large") {
  if (value === "small") {
    return "小";
  }
  if (value === "large") {
    return "大";
  }
  return "标准";
}

function spacingLabel(value: "tight" | "normal" | "relaxed") {
  if (value === "tight") {
    return "紧凑";
  }
  if (value === "relaxed") {
    return "舒展";
  }
  return "标准";
}

function densityLabel(value: "compact" | "balanced" | "spacious") {
  if (value === "compact") {
    return "紧凑";
  }
  if (value === "spacious") {
    return "宽松";
  }
  return "均衡";
}

function accentColorLabel(value: "graphite" | "emerald" | "blue" | "rose") {
  if (value === "graphite") {
    return "石墨";
  }
  if (value === "blue") {
    return "蓝色";
  }
  if (value === "rose") {
    return "玫瑰";
  }
  return "翠绿";
}

function accentSwatchColor(value: "graphite" | "emerald" | "blue" | "rose") {
  if (value === "graphite") {
    return "#202522";
  }
  if (value === "blue") {
    return "#1d4f91";
  }
  if (value === "rose") {
    return "#9d3151";
  }
  return "#176b5b";
}

function sectionTypeLabel(value: string) {
  if (value === "summary") {
    return "岗位概览";
  }
  if (value === "skills") {
    return "技能";
  }
  if (value === "certificates") {
    return "证书";
  }
  return "项目与经历";
}

function diagnosticTemplateInfo(template: ReturnType<typeof getResumeTemplate>): ResumeDiagnosticTemplateInfo {
  return {
    id: template.id,
    version: template.version,
    category: template.category,
    layout: template.layout,
    atsLevel: template.atsLevel,
    suitableRoles: template.suitableRoles,
    tags: template.tags,
    capabilities: template.capabilities
  };
}

function parseIgnoredDiagnosticKeys(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function resumeDiagnosticsIgnoredKey(branchId: string) {
  return `resumeDiagnosticsIgnored:${branchId}`;
}

function actionPayload(action: ResumeDiagnosticAction): Record<string, unknown> {
  return action.payload && typeof action.payload === "object" && !Array.isArray(action.payload)
    ? action.payload as Record<string, unknown>
    : {};
}

function stringPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function presentationDensityPayload(payload: Record<string, unknown>): ResumePresentationConfig["theme"]["density"] | undefined {
  const value = payload.density;
  return value === "compact" || value === "balanced" || value === "spacious" ? value : undefined;
}

function presentationBodyScalePayload(payload: Record<string, unknown>): ResumePresentationConfig["typography"]["bodyTextScale"] | undefined {
  const value = payload.bodyTextScale;
  return value === "small" || value === "normal" || value === "large" ? value : undefined;
}

function presentationTitleScalePayload(payload: Record<string, unknown>): ResumePresentationConfig["typography"]["titleTextScale"] | undefined {
  const value = payload.titleTextScale;
  return value === "small" || value === "normal" || value === "large" ? value : undefined;
}

function presentationLineHeightPayload(payload: Record<string, unknown>): ResumePresentationConfig["typography"]["lineHeight"] | undefined {
  const value = payload.lineHeight;
  return value === "tight" || value === "normal" || value === "relaxed" ? value : undefined;
}

function presentationSpacingPayload(
  payload: Record<string, unknown>,
  key: "sectionGap" | "itemGap"
): ResumePresentationConfig["spacing"]["sectionGap"] | undefined {
  const value = payload[key];
  return value === "tight" || value === "normal" || value === "relaxed" ? value : undefined;
}

function pagePolicyPayload(payload: Record<string, unknown>): ResumePresentationConfig["pagination"]["pagePolicy"] | undefined {
  const value = payload.pagePolicy;
  return value === "one_page_strict" || value === "up_to_two_pages" ? value : undefined;
}

function templateIdPayload(payload: Record<string, unknown>): TemplateId | undefined {
  const value = payload.templateId;
  return isResumeTemplateId(value) ? value : undefined;
}

function sectionTypePayload(payload: Record<string, unknown>): "summary" | "experience" | "skills" | "certificates" | undefined {
  const value = payload.sectionType;
  return value === "summary" || value === "experience" || value === "skills" || value === "certificates" ? value : undefined;
}

function cssEscape(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}
