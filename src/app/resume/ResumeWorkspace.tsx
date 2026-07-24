"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  FileText,
  Briefcase,
  Compass,
  GraduationCap,
  Rocket,
  School,
  Zap,
  Trophy,
  Scroll,
  Globe,
  Sparkles,
  Plus,
  PanelLeftOpen,
  PanelLeftClose,
  Pencil
} from "lucide-react";
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
  type ResumeRenderSectionType,
  type ResumeRenderModel,
  type ResumeItemV2,
  type ResumeRevision,
  type TemplateId
} from "@/domain/schemas";
import { mapBranchToResumeRenderModel, ResumeRenderMapperError } from "@/domain/resumeRender/mapper";
import { A4ResumePreview } from "@/components/resume/A4ResumePreview";
import { TemplateCenter } from "@/components/resume/TemplateCenter";
import { ResumeDiagnosticsPanel } from "@/components/resume/diagnostics/ResumeDiagnosticsPanel";
import { ResumeImportWizard } from "@/components/resume/import/ResumeImportWizard";
import { JobOptimizationPanel } from "@/components/resume/optimization/JobOptimizationPanel";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import {
  ProductButton,
  ProductTopbar
} from "@/components/ui/product";
import { buildRequirementBlockMatches, computeRequirementsHash } from "@/domain/jobOptimization";
import {
  isResumeDiagnosticSnapshotStale,
  runResumeDiagnostics,
  type ResumeDiagnosticTemplateInfo
} from "@/domain/resumeDiagnostics";
import { mapBranchToResumeDocument, type ResumeDocument, type ResumeDocumentBlock } from "@/domain/resumeDocument/mapper";
import { resumeSectionCatalog, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { useResumePagination } from "@/components/resume/useResumePagination";
import {
  getResumeTemplate,
  assessTemplateCompatibility,
  getTemplateDefaultStyleConfig,
  isResumeTemplateId,
  resumeTemplates,
  type ResumeTemplateStyleConfig
} from "@/components/resume/templates/templateRegistry";
import { printCurrentPage } from "@/services/export/browserPrint";
import { buildResumePdfFileName, PDF_MIME_TYPE } from "@/services/export/filename";
import { isPaginationPlanBlocked, paginateResumeRenderModel, paginationStatusLabel } from "@/services/export/pagination";
import {
  createRenderCoverageReport,
  paginatedCoverage,
  presentationCoverage,
  renderedCoverage,
  renderCoverageHasBlockingFailure,
  sourceVisibleCoverage,
  type RenderCoverageReport
} from "@/services/export/renderCoverage";
import { createResumePdfExportRequest, presentationSnapshotFromConfig } from "@/services/export/snapshot";
import { hashBytes, stableHashText } from "@/services/security/text";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";
import { notify } from "@/services/notifications/store";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { BasicsSectionPage } from "@/components/editor/sections/BasicsSectionPage";
import { SummarySectionPage } from "@/components/editor/sections/SummarySectionPage";
import { ExperienceSectionPage } from "@/components/editor/sections/ExperienceSectionPage";
import { SkillsSectionPage } from "@/components/editor/sections/SkillsSectionPage";
import { CanonicalSectionPage } from "@/components/editor/sections/CanonicalSectionPage";
import { type ResumeStudioSectionKey, type SectionNavContext } from "@/components/editor/sections/types";
import { exportCareerAdaptResumeJsonV2 } from "@/domain/resumeImport/jsonV2Adapter";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { resolveResumeTargetRole } from "@/domain/branch/targetRole";

const repository = new WorkspaceRepository();
const DEFAULT_TEMPLATE_ID: TemplateId = "classic-technical";
const BRANCH_LIST_SENTINEL = "__resume_branch_list__";
const OPTIONAL_STUDIO_SECTIONS: ReadonlyArray<{ key: ResumeStudioSectionKey; label: string }> = [
  { key: "research", label: "科研" }, { key: "campus", label: "校园" }, { key: "volunteer", label: "志愿" },
  { key: "awards", label: "奖项" }, { key: "certificates", label: "证书" }, { key: "languages", label: "语言" },
  { key: "publications", label: "论文" }, { key: "patents", label: "专利" }, { key: "portfolio", label: "作品集" },
  { key: "other", label: "其他" }
];

type WorkbenchState = {
  activeBranchId?: string | null;
  templateId?: TemplateId;
  stylePanelOpen?: boolean;
  studioMode?: StudioMode;
  manualTab?: ManualInspectorTab;
  aiTab?: AiInspectorTab;
  styleTab?: StyleInspectorTab;
  enabledSectionsByBranch?: Record<string, ResumeStudioSectionKey[]>;
  hiddenSectionsByBranch?: Record<string, ResumeStudioSectionKey[]>;
  customSectionsByBranch?: Record<string, CustomStudioSection[]>;
};

type CustomStudioSection = { id: string; title: string; order: number };

type ResumeImportEntryMode = "file" | "json";
type ContentAutoSaveState = "idle" | "dirty" | "saving" | "saved" | "needs_confirmation" | "error";
type ProfileLibraryReference =
  | { type: "experience"; experienceId: string; factId: string }
  | { type: "skill"; skillId: string; factId: string }
  | { type: "certificate"; certificateId: string; factId: string }
  | { type: "canonical"; itemId: string; sectionType: string };
type ProfileLibraryItem = {
  key: string;
  title: string;
  subtitle: string;
  body: string;
  reference: ProfileLibraryReference;
};

type ResumeListFilter = "recent" | "all" | "general" | "job" | "archived" | "trash";
type CanvasZoomMode = "fit-page" | "fit-whole-page" | "custom";
type StudioLayoutState = {
  sectionNavCollapsed: boolean;
  fieldPanelCollapsed: boolean;
  fieldPanelWidth: number;
};

type PresentationHistoryState = {
  undoStack: ResumePresentationConfig[];
  redoStack: ResumePresentationConfig[];
};

type PropertyPanelTab = "document" | "section" | "block";
type StudioMode = "edit" | "ai" | "style";
type ManualInspectorTab = "content" | "typography" | "paragraph" | "layout" | "template" | "page" | "history";
type AiInspectorTab = "suggestions" | "quality";
type StyleInspectorTab = "template" | "colors" | "font" | "page";
type PdfExportState = {
  status: "idle" | "validating" | "generating" | "downloading" | "success" | "failed" | "blocked_overflow";
  exportId?: string;
  filename?: string;
  message?: string;
  errorCode?: string;
  canUseFallback?: boolean;
};

const RESUME_STUDIO_LAYOUT_KEY = "careeradapt.resumeStudioLayout";
const DEFAULT_STUDIO_LAYOUT: StudioLayoutState = {
  sectionNavCollapsed: false,
  fieldPanelCollapsed: false,
  fieldPanelWidth: 420
};
const MIN_FIELD_PANEL_WIDTH = 320;
const MAX_FIELD_PANEL_WIDTH = 560;
const MIN_CANVAS_ZOOM = 0.3;
const MAX_CANVAS_ZOOM = 1.16;
const A4_PAGE_WIDTH_PX = 794;
const A4_PAGE_HEIGHT_PX = 1123;
const CONTENT_AUTO_SAVE_LABELS: Record<ContentAutoSaveState, string> = {
  idle: "自动保存已开启",
  dirty: "等待自动保存",
  saving: "正在保存…",
  saved: "已自动保存",
  needs_confirmation: "需要确认保存范围",
  error: "自动保存失败"
};

export function ResumeWorkspace() {
  const router = useRouter();
  const workspace = useWorkspace(repository);
  const pageRef = useRef<HTMLElement | null>(null);
  const previewStageRef = useRef<HTMLDivElement | null>(null);
  const importDialogRef = useRef<HTMLElement | null>(null);
  const importTriggerRef = useRef<HTMLElement | null>(null);
  const pendingImportedBranchIdRef = useRef<string | undefined>(undefined);
  const profileCreateDialogRef = useRef<HTMLElement | null>(null);
  const branchesRef = useRef<ResumeBranch[]>([]);
  const editTextsRef = useRef<Record<string, string>>({});
  const contentSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveItemRef = useRef<(itemId: string, options?: { origin?: "manual" | "auto" }) => Promise<void>>(async () => undefined);
  const [drafts, setDrafts] = useState<JobAdaptationDraft[]>([]);
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
  const [jobContextSummary, setJobContextSummary] = useState<{ matchUpdatedAt?: string; suggestionCount: number; risk: "low" | "medium" | "high" }>({ suggestionCount: 0, risk: "low" });
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
  const [draftName, setDraftName] = useState("");
  const [editTexts, setEditTexts] = useState<Record<string, string>>({});
  const [contentAutoSaveState, setContentAutoSaveState] = useState<ContentAutoSaveState>("idle");
  const [isStudioEditMode, setIsStudioEditMode] = useState(true);
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
  const [selectedSectionTitleId, setSelectedSectionTitleId] = useState<string | undefined>();
  const [editingSectionTitleId, setEditingSectionTitleId] = useState<string | undefined>();
  const [sectionTitleDraftText, setSectionTitleDraftText] = useState("");
  const [sectionTitleError, setSectionTitleError] = useState<string | undefined>();
  const [sectionTitlePending, setSectionTitlePending] = useState(false);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(true);
  const [isTemplateCenterOpen, setIsTemplateCenterOpen] = useState(false);
  const [isImportPanelOpen, setIsImportPanelOpen] = useState(false);
  const [importEntryMode, setImportEntryMode] = useState<ResumeImportEntryMode>("file");
  const [importCreatesNewProfile, setImportCreatesNewProfile] = useState(false);
  const [isProfileCreateMenuOpen, setIsProfileCreateMenuOpen] = useState(false);
  const [quickProfileName, setQuickProfileName] = useState("");
  const [workbenchStateHydrated, setWorkbenchStateHydrated] = useState(false);
  const [isJobCreatePanelOpen, setIsJobCreatePanelOpen] = useState(false);
  const [isJobCreatePanelDismissed, setIsJobCreatePanelDismissed] = useState(false);
  const [resumeListFilter, setResumeListFilter] = useState<ResumeListFilter>("recent");
  const [renamingBranchId, setRenamingBranchId] = useState<string>();
  const [renameBranchDraft, setRenameBranchDraft] = useState("");
  const [renameBranchError, setRenameBranchError] = useState<string>();
  const [renameBranchPending, setRenameBranchPending] = useState(false);
  const [studioMode, setStudioMode] = useState<StudioMode>("edit");
  const [manualInspectorTab, setManualInspectorTab] = useState<ManualInspectorTab>("content");
  const [aiInspectorTab, setAiInspectorTab] = useState<AiInspectorTab>("suggestions");
  const [aiFloatingOpen, setAiFloatingOpen] = useState(true);
  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [styleInspectorTab, setStyleInspectorTab] = useState<StyleInspectorTab>("template");
  const [activeResumeSection, setActiveResumeSection] = useState<ResumeStudioSectionKey>("basics");
  const [enabledSectionsByBranch, setEnabledSectionsByBranch] = useState<Record<string, ResumeStudioSectionKey[]>>({});
  const [hiddenSectionsByBranch, setHiddenSectionsByBranch] = useState<Record<string, ResumeStudioSectionKey[]>>({});
  const [customSectionsByBranch, setCustomSectionsByBranch] = useState<Record<string, CustomStudioSection[]>>({});
  const [isSectionMenuOpen, setIsSectionMenuOpen] = useState(false);
  const [customSectionTitle, setCustomSectionTitle] = useState("");
  const [customSectionError, setCustomSectionError] = useState<string>();
  const sectionMenuButtonRef = useRef<HTMLButtonElement>(null);
  const sectionMenuRef = useRef<HTMLDivElement>(null);
  const [canvasZoom, setCanvasZoom] = useState(0.8);
  const [canvasZoomMode, setCanvasZoomMode] = useState<CanvasZoomMode>("fit-page");
  const [studioLayout, setStudioLayout] = useState<StudioLayoutState>(() => readInitialStudioLayout());
  const [pendingTemplateApplyId, setPendingTemplateApplyId] = useState<TemplateId | undefined>();
  const [activePropertyTab, setActivePropertyTab] = useState<PropertyPanelTab>("document");
  const [pdfExportState, setPdfExportState] = useState<PdfExportState>({ status: "idle" });
  const [diagnosticSnapshot, setDiagnosticSnapshot] = useState<ResumeDiagnosticSnapshot | undefined>();
  const [diagnosticRequirementsHash, setDiagnosticRequirementsHash] = useState<string | undefined>();
  const [diagnosticRunning, setDiagnosticRunning] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | undefined>();
  const [ignoredDiagnosticIssueKeys, setIgnoredDiagnosticIssueKeys] = useState<string[]>([]);
  const [renderCoverageReport, setRenderCoverageReport] = useState<RenderCoverageReport>();

  const [profileSyncConflicts, setProfileSyncConflicts] = useState<Array<{
    fieldId: string;
    label: string;
    resumeValue: string;
    profileValue: string;
  }>>([]);
  const [profileSyncChoices, setProfileSyncChoices] = useState<Record<string, "resume" | "profile">>({});
  const [profileSyncDialogOpen, setProfileSyncDialogOpen] = useState(false);
  const [profileLibraryOpen, setProfileLibraryOpen] = useState(false);
  const [pendingPermanentDeleteBranch, setPendingPermanentDeleteBranch] = useState<ResumeBranch | undefined>();
  const [permanentDeleteName, setPermanentDeleteName] = useState("");
  const [permanentDeleting, setPermanentDeleting] = useState(false);
  const [pendingResumeOnlyEdit, setPendingResumeOnlyEdit] = useState<{
    itemId: string;
    text: string;
    source: "form" | "preview";
  } | undefined>();

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

  useEffect(() => {
    branchesRef.current = branches;
  }, [branches]);

  useEffect(() => {
    editTextsRef.current = editTexts;
  }, [editTexts]);

  useEffect(() => {
    if (!profileSyncDialogOpen && !pendingResumeOnlyEdit && !profileLibraryOpen && !pendingPermanentDeleteBranch && !isProfileCreateMenuOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isProfileCreateMenuOpen) {
        setIsProfileCreateMenuOpen(false);
        setQuickProfileName("");
      } else if (pendingPermanentDeleteBranch) {
        setPendingPermanentDeleteBranch(undefined);
        setPermanentDeleteName("");
      } else if (profileLibraryOpen) {
        setProfileLibraryOpen(false);
      } else if (pendingResumeOnlyEdit) {
        setPendingResumeOnlyEdit(undefined);
      } else {
        setProfileSyncDialogOpen(false);
        setProfileSyncConflicts([]);
        setProfileSyncChoices({});
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [pendingPermanentDeleteBranch, pendingResumeOnlyEdit, profileLibraryOpen, profileSyncDialogOpen, isProfileCreateMenuOpen]);

  const profile = profileOverride ?? (workspace.status === "ready" ? workspace.profiles[0] : undefined);
  const jobs = useMemo(() => {
    const workspaceJobs = workspace.status === "ready" ? workspace.jobs : [];
    const byId = new Map<string, JobDescription>();
    [...workspaceJobs, ...localJobs].forEach((job) => byId.set(job.id, job));
    return Array.from(byId.values());
  }, [workspace, localJobs]);
  const activeDraftId = selectedDraftId || drafts[0]?.id || "";
  const activeBranchId = selectedBranchId === BRANCH_LIST_SENTINEL ? "" : selectedBranchId;
  const selectedDraft = drafts.find((draft) => draft.id === activeDraftId);
  const selectedBranch = branches.find((branch) => branch.id === activeBranchId);
  const selectedBranchJob = selectedBranch?.jobId ? jobs.find((job) => job.id === selectedBranch.jobId) : undefined;
  const selectedSourceBranch = selectedBranch?.sourceBranchId ? branches.find((branch) => branch.id === selectedBranch.sourceBranchId) : undefined;
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
  const profileLibraryItems = useMemo(
    () => profile ? buildProfileLibraryItems(profile, activeResumeSection) : [],
    [profile, activeResumeSection]
  );
  const selectedStudioBlock = selectedStudioItemId ? resumeDocumentBlocksById.get(selectedStudioItemId) : undefined;
  const selectedStudioSection = useMemo(() => {
    if (!resumeDocument || !selectedStudioBlock) {
      return undefined;
    }
    return resumeDocument.sections.find((section) => section.type === selectedStudioBlock.sectionType);
  }, [resumeDocument, selectedStudioBlock]);

  useEffect(() => {
    let active = true;
    async function loadJobContextSummary() {
      if (!selectedBranch || selectedBranch.branchPurpose !== "job_specific" || !selectedBranchJob || !profile) {
        setJobContextSummary({ suggestionCount: 0, risk: "low" });
        return;
      }
      const matches = await repository.listRequirementMatches(profile.id, selectedBranchJob.id);
      const boundMatches = matches.filter((match) => selectedBranch.requirementMatchIds.includes(match.id));
      const latestDraft = await repository.getLatestJobAdaptationDraft(profile.id, selectedBranchJob.id);
      const suggestions = latestDraft?.branchId === selectedBranch.id ? await repository.listAiSuggestions(latestDraft.id) : [];
      if (!active) return;
      const risk = suggestions.some((suggestion) => suggestion.riskLevel === "high" || suggestion.status === "blocked_high_risk")
        ? "high"
        : suggestions.some((suggestion) => suggestion.riskLevel === "medium") ? "medium" : "low";
      setJobContextSummary({
        matchUpdatedAt: boundMatches.map((match) => match.updatedAt).sort().at(-1),
        suggestionCount: suggestions.filter((suggestion) => suggestion.status === "pending_review" || suggestion.status === "edited_guarded").length,
        risk
      });
    }
    void loadJobContextSummary();
    return () => { active = false; };
  }, [profile, selectedBranch, selectedBranchJob]);
  const resumeSectionNavItems = useMemo(() => buildResumeStudioSections({
    resumeDocument,
    branch: selectedBranch,
    profile,
    enabledSections: selectedBranch ? enabledSectionsByBranch[selectedBranch.id] ?? [] : [],
    hiddenSections: selectedBranch ? hiddenSectionsByBranch[selectedBranch.id] ?? [] : [],
    customSections: selectedBranch ? customSectionsByBranch[selectedBranch.id] ?? [] : []
  }), [resumeDocument, selectedBranch, profile, enabledSectionsByBranch, hiddenSectionsByBranch, customSectionsByBranch]);
  const activeSectionItem = resumeSectionNavItems.find((item) => item.key === activeResumeSection)
    ?? resumeSectionNavItems[0];
  const activeSectionBlocks = useMemo(() => {
    if (!resumeDocument) {
      return [];
    }
    const contentBlocks = resumeDocument.blocks.filter((block) => block.itemType !== "structural" && block.contentVisible);
    if (activeResumeSection === "basics" || activeResumeSection === "add") {
      return [];
    }
    if (activeResumeSection.startsWith("custom:")) {
      return contentBlocks.filter((block) =>
        block.itemType === "custom" && block.sourceSectionId === activeResumeSection
      );
    }
    const canonicalIds = new Set(selectedBranch?.structuredContentItems
      ?.filter((item) => item.data.sectionType === activeResumeSection)
      .map((item) => item.id) ?? []);
    return contentBlocks.filter((block) => canonicalIds.has(block.contentItemId));
  }, [activeResumeSection, resumeDocument, selectedBranch]);
  const activeStructuredItems = useMemo(() => activeResumeSection === "basics" || activeResumeSection === "add" || activeResumeSection.startsWith("custom:")
    ? []
    : (selectedBranch?.structuredContentItems ?? [])
      .filter((item) => item.data.sectionType === activeResumeSection)
      .sort((left, right) => left.order - right.order),
  [activeResumeSection, selectedBranch]);
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
  useEffect(() => {
    if (!renderModel || !pagination.plan) {
      const clearFrame = window.requestAnimationFrame(() => setRenderCoverageReport(undefined));
      return () => window.cancelAnimationFrame(clearFrame);
    }
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const renderedRoot = previewStageRef.current?.querySelector<HTMLElement>(".resume-preview-pages");
        if (!renderedRoot) return;
        const source = selectedBranch && resumeDocument
          ? sourceVisibleCoverage({ branch: selectedBranch, document: resumeDocument, derivedSummary: renderModel.candidate.summary })
          : presentationCoverage(renderModel);
        const pageModels = paginateResumeRenderModel(renderModel, pagination.plan);
        setRenderCoverageReport(createRenderCoverageReport({
          source,
          presentation: presentationCoverage(renderModel),
          paginated: paginatedCoverage(pageModels),
          rendered: renderedCoverage(renderedRoot)
        }));
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pagination.plan, renderModel, resumeDocument, selectedBranch]);
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
  const sortedBranches = useMemo(() => {
    return [...branches].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [branches]);
  const activeBranches = useMemo(() => sortedBranches.filter((branch) => branch.lifecycleStatus === "active"), [sortedBranches]);
  const archivedBranches = useMemo(() => sortedBranches.filter((branch) => branch.lifecycleStatus === "archived"), [sortedBranches]);
  const trashedBranches = useMemo(() => sortedBranches.filter((branch) => branch.lifecycleStatus === "trashed"), [sortedBranches]);
  const visibleBranches = useMemo(() => {
    if (resumeListFilter === "archived") {
      return archivedBranches;
    }
    if (resumeListFilter === "trash") {
      return trashedBranches;
    }
    const unarchived = activeBranches;
    if (resumeListFilter === "general") {
      return unarchived.filter((branch) => branch.branchPurpose === "general");
    }
    if (resumeListFilter === "job") {
      return unarchived.filter((branch) => branch.branchPurpose === "job_specific");
    }
    if (resumeListFilter === "recent") {
      return unarchived.slice(0, 5);
    }
    return unarchived;
  }, [activeBranches, archivedBranches, resumeListFilter, trashedBranches]);
  const resumeListFilters: Array<{ key: ResumeListFilter; label: string; count: number }> = [
    { key: "recent", label: "最近", count: Math.min(activeBranches.length, 5) },
    { key: "all", label: "全部", count: activeBranches.length },
    { key: "general", label: "通用", count: activeBranches.filter((branch) => branch.branchPurpose === "general").length },
    { key: "job", label: "岗位", count: activeBranches.filter((branch) => branch.branchPurpose === "job_specific").length },
    { key: "archived", label: "归档", count: archivedBranches.length },
    { key: "trash", label: "回收站", count: trashedBranches.length }
  ];
  const workbarWarnings = selectedBranch ? [
    selectedBranch.migrationStatus === "legacy_unverified" ? "旧占位简历已只读保留，不参与正式编辑或导出。" : undefined,
    !selectedBranchEditable && selectedBranch.migrationStatus !== "legacy_unverified"
      ? `当前简历不可编辑：${branchNotEditableLabel(branchNotEditableReason(selectedBranch))}。`
      : undefined,
    selectedBranch.syncStatusCache.status !== "in_sync" ? syncStatusMessage(selectedBranch.syncStatusCache.status) : undefined
  ].filter((item): item is string => Boolean(item)) : [];
  const studioLayoutStyle = {
    "--resume-section-nav-width": studioLayout.sectionNavCollapsed ? "44px" : "80px",
    "--resume-field-panel-width": studioLayout.fieldPanelCollapsed ? "20px" : `${studioLayout.fieldPanelWidth}px`
  } as CSSProperties;

  const refreshLists = useCallback(async (profileId: string) => {
    const [nextDrafts, nextBranches] = await Promise.all([
      repository.listJobAdaptationDrafts(profileId),
      repository.listResumeBranches(profileId)
    ]);
    setDrafts(nextDrafts);
    setBranches(nextBranches);
  }, []);

  async function selectResumeProfile(profileId: string) {
    if (profileId === "__new_profile__") {
      setIsProfileCreateMenuOpen(true);
      return;
    }
    const selected = await repository.getProfile(profileId);
    if (!selected) {
      notify({ type: "error", title: "选择失败", message: "所选个人资料已不存在，请返回资料库重新选择。" });
      return;
    }
    await repository.setActiveProfileId(selected.id);
    setProfileOverride(selected);
    setSelectedBranchId(BRANCH_LIST_SENTINEL);
    setSelectedDraftId("");
    setEditTexts({});
    clearStudioEditor();
    await refreshLists(selected.id);
    notify({ type: "success", title: "已切换人物", message: `当前人物已切换为 ${selected.name}。` });
  }

  async function createBlankProfile() {
    const name = quickProfileName.trim();
    if (!name) {
      notify({ type: "warning", title: "请输入名称", message: "请填写新人物名称。" });
      return;
    }
    const now = new Date().toISOString();
    const created: CareerProfile = {
      id: `profile-${crypto.randomUUID()}`,
      name,
      basics: { name, links: [] },
      preference: { targetRoles: [], targetCities: [], industries: [] },
      version: 1,
      experiences: [],
      skills: [],
      certificates: [],
      evidences: [],
      unclassifiedBlocks: [],
      createdAt: now,
      updatedAt: now
    };
    await repository.saveProfile(created);
    await repository.setActiveProfileId(created.id);
    setProfileOverride(created);
    setQuickProfileName("");
    setIsProfileCreateMenuOpen(false);
    setSelectedBranchId(BRANCH_LIST_SENTINEL);
    await refreshLists(created.id);
    notify({ type: "success", title: "人物已创建", message: `已创建空白人物：${created.name}。` });
  }

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
    setSelectedSectionTitleId(undefined);
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText("");
    setSectionTitleError(undefined);
    setSectionTitlePending(false);
    setActivePropertyTab("document");
  }, []);

  function updateCanvasZoom(updater: (current: number) => number) {
    setCanvasZoomMode("custom");
    setCanvasZoom((current) => clampNumber(Number(updater(current).toFixed(2)), MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM));
  }

  const openResumeBranch = useCallback((branchId: string) => {
    setSelectedBranchId(branchId);
  }, []);

  const openImportDialog = useCallback((mode: ResumeImportEntryMode, trigger?: HTMLElement | null, createNewProfile = false) => {
    importTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setImportEntryMode(mode);
    setImportCreatesNewProfile(createNewProfile);
    setIsImportPanelOpen(true);
  }, []);

  const closeImportDialog = useCallback(() => {
    setIsImportPanelOpen(false);
    window.requestAnimationFrame(() => importTriggerRef.current?.focus());
  }, []);

  function handleImportDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeImportDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = importDialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const closeProfileCreateDialog = useCallback(() => {
    setIsProfileCreateMenuOpen(false);
    setQuickProfileName("");
  }, []);

  function handleProfileCreateDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeProfileCreateDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const dialog = profileCreateDialogRef.current;
    if (!dialog) {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  useEffect(() => {
    if (!isImportPanelOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => importDialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [isImportPanelOpen]);

  useEffect(() => {
    if (!isProfileCreateMenuOpen) {
      return;
    }
    const frame = window.requestAnimationFrame(() => profileCreateDialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isProfileCreateMenuOpen]);

  function startFieldPanelResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = studioLayout.fieldPanelWidth;
    const isStyleMode = studioMode === "style";
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = clampNumber(startWidth + (isStyleMode ? -delta : delta), MIN_FIELD_PANEL_WIDTH, MAX_FIELD_PANEL_WIDTH);
      setStudioLayout((current) => ({
        ...current,
        fieldPanelCollapsed: false,
        fieldPanelWidth: nextWidth
      }));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  }

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
      const requestedParams = new URLSearchParams(window.location.search);
      const requestedBranchId = requestedParams.get("branchId");
      const requestedMode = requestedParams.get("mode");
      const pendingImportedBranchId = pendingImportedBranchIdRef.current;
      const branchIdToRestore = pendingImportedBranchId && nextBranches.some((branch) => branch.id === pendingImportedBranchId)
        ? pendingImportedBranchId
        : requestedBranchId && nextBranches.some((branch) => branch.id === requestedBranchId)
        ? requestedBranchId
        : parsed.activeBranchId && nextBranches.some((branch) => branch.id === parsed.activeBranchId)
          ? parsed.activeBranchId
          : BRANCH_LIST_SENTINEL;
      setSelectedBranchId(branchIdToRestore);
      if (branchIdToRestore === pendingImportedBranchId) pendingImportedBranchIdRef.current = undefined;
      if (parsed.templateId) {
        setTemplateId(parsed.templateId);
      }
      if (typeof parsed.stylePanelOpen === "boolean") {
        setIsStylePanelOpen(parsed.stylePanelOpen);
      }
      if (requestedMode === "edit" || requestedMode === "ai" || requestedMode === "style") {
        setStudioMode(requestedMode);
      } else if (parsed.studioMode) {
        setStudioMode(parsed.studioMode);
      }
      if (parsed.manualTab) {
        setManualInspectorTab(parsed.manualTab);
      }
      if (parsed.aiTab) {
        setAiInspectorTab(parsed.aiTab);
      }
      if (parsed.styleTab) {
        setStyleInspectorTab(parsed.styleTab);
      }
      setEnabledSectionsByBranch(parsed.enabledSectionsByBranch ?? {});
      setHiddenSectionsByBranch(parsed.hiddenSectionsByBranch ?? {});
      setCustomSectionsByBranch(parsed.customSectionsByBranch ?? {});
      setWorkbenchStateHydrated(true);
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
      editTextsRef.current = {};
      setContentAutoSaveState("idle");
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
  }, [activeBranchId, clearStudioEditor]);

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
    if (!resumeSectionNavItems.some((item) => item.key === activeResumeSection)) {
      let active = true;
      queueMicrotask(() => {
        if (active) {
          setActiveResumeSection(resumeSectionNavItems[0]?.key ?? "basics");
        }
      });
      return () => {
        active = false;
      };
    }
    return undefined;
  }, [activeResumeSection, resumeSectionNavItems]);

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
    if (!profile || !workbenchStateHydrated) {
      return;
    }
    void repository.setMeta(workbenchStateKey(profile.id), {
      activeBranchId: activeBranchId || null,
      templateId: effectiveTemplateId,
      stylePanelOpen: isStylePanelOpen,
      studioMode,
      manualTab: manualInspectorTab,
      aiTab: aiInspectorTab,
      styleTab: styleInspectorTab
      ,enabledSectionsByBranch
      ,hiddenSectionsByBranch
      ,customSectionsByBranch
    } satisfies WorkbenchState);
  }, [profile, workbenchStateHydrated, activeBranchId, effectiveTemplateId, isStylePanelOpen, studioMode, manualInspectorTab, aiInspectorTab, styleInspectorTab, enabledSectionsByBranch, hiddenSectionsByBranch, customSectionsByBranch]);

  useEffect(() => {
    if (!isSectionMenuOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsSectionMenuOpen(false);
      window.requestAnimationFrame(() => sectionMenuButtonRef.current?.focus());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => sectionMenuRef.current?.querySelector<HTMLElement>("button, input")?.focus());
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSectionMenuOpen]);

  useEffect(() => {
    window.localStorage.setItem(RESUME_STUDIO_LAYOUT_KEY, JSON.stringify(studioLayout));
  }, [studioLayout]);

  useEffect(() => {
    if (canvasZoomMode !== "fit-page" && canvasZoomMode !== "fit-whole-page") {
      return;
    }
    const stage = previewStageRef.current;
    if (!stage) {
      return;
    }
    const updateFitZoom = () => {
      const rect = stage.getBoundingClientRect();
      if (canvasZoomMode === "fit-page") {
        // A4纸左右各留8px
        const availableWidth = rect.width - 16;
        const nextZoom = clampNumber(availableWidth / A4_PAGE_WIDTH_PX, MIN_CANVAS_ZOOM, 1);
        setCanvasZoom(Number(nextZoom.toFixed(2)));
      } else {
        // 整页模式：宽高都适配，保证看到完整一页
        const availableWidth = rect.width - 16;
        const availableHeight = rect.height - 16;
        const nextZoom = clampNumber(
          Math.min(availableWidth / A4_PAGE_WIDTH_PX, availableHeight / A4_PAGE_HEIGHT_PX),
          MIN_CANVAS_ZOOM,
          1
        );
        setCanvasZoom(Number(nextZoom.toFixed(2)));
      }
    };
    updateFitZoom();
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(stage);
    window.addEventListener("resize", updateFitZoom);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateFitZoom);
    };
  }, [canvasZoomMode]);

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
      const block = resumeDocumentBlocksById.get(itemId);
      if (block) {
        setActiveResumeSection(studioSectionForBlock(block));
      }
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
      notify({ type: "info", title: "已定位", message: "已定位到诊断关联区块。" });
      return;
    }
    if (issue.sectionType) {
      setActivePropertyTab("section");
      setActiveResumeSection(issue.sectionType === "experience" ? "work" : issue.sectionType);
      notify({ type: "info", title: "诊断关联", message: `诊断关联栏目：${sectionTypeLabel(issue.sectionType)}。` });
      return;
    }
    if (issue.requirementIds[0]) {
      notify({ type: "info", title: "诊断关联", message: `诊断关联 Requirement：${issue.requirementIds[0]}。请在岗位优化面板中查看对应要求。` });
      return;
    }
    notify({ type: "info", title: "诊断项", message: "该诊断项没有更细粒度定位目标。" });
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
        notify({ type: "warning", title: "提示", message: "请在正文编辑区选择需要修改的区块。" });
      }
      return;
    }
    if (action.kind === "open_job_suggestion") {
      notify({ type: "info", title: "提示", message: "请在“针对岗位优化”面板中查看 Requirement 映射或生成区块建议。" });
      return;
    }
    if (action.kind === "open_fact_gap") {
      notify({ type: "warning", title: "事实缺口", message: "事实缺口需要先补充或确认事实；诊断不会自动写入岗位关键词。" });
      return;
    }
    if (!selectedBranchEditable) {
      notify({ type: "warning", title: "不可编辑", message: "当前简历不可保存展示修复。" });
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
    notify({ type: "info", title: "已忽略", message: "已忽略该诊断项；正文和展示配置均未改变。" });
  }

  const draftOptions = useMemo(() => drafts.map((draft) => {
    const job = jobs.find((item) => item.id === draft.jobId);
    return {
      draft,
      label: `${job?.company ?? "未知公司"} / ${job?.title ?? draft.jobId}`
    };
  }), [drafts, jobs]);
  const showJobCreatePanel = isJobCreatePanelOpen
    || (!isJobCreatePanelDismissed && branches.length === 0 && draftOptions.length > 0);

  async function createBranch() {
    if (!profile || !selectedDraft) {
      notify({ type: "warning", title: "提示", message: "请先选择可用的岗位简历建议草稿。" });
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
      openResumeBranch(result.branch.id);
      setIsJobCreatePanelOpen(false);
      setIsJobCreatePanelDismissed(false);
      notify({ type: "success", title: "创建成功", message: result.idempotent ? "该草稿已经创建过岗位简历，已打开现有简历。" : "岗位简历已创建，并生成首个版本。" });
    } catch (error) {
      notify({ type: "error", title: "创建失败", message: error instanceof RevisionConflictError
        ? "草稿版本已变化，请刷新后重试。"
        : "草稿可能已过期、含高风险内容或引用了失效事实。请返回岗位工作区修复。" });
    }
  }

  async function handleImportedResumeReady(result: { profileId: string; branchId?: string }) {
    pendingImportedBranchIdRef.current = result.branchId;
    const nextProfile = await repository.getProfile(result.profileId);
    if (nextProfile) {
      setProfileOverride(nextProfile);
      await refreshLists(nextProfile.id);
    }
    if (result.branchId) {
      openResumeBranch(result.branchId);
      setStudioMode("edit");
      setActiveResumeSection("basics");
      setIsStudioEditMode(true);
    } else {
      setSelectedBranchId(BRANCH_LIST_SENTINEL);
    }
    setIsImportPanelOpen(false);
    notify({ type: "success", title: "导入完成", message: result.branchId ? "已进入导入生成的通用简历，可继续编辑、换模板、调整分页并下载 PDF。" : "新人物资料已创建，未同时创建通用简历。" });
  }

  async function createGeneralResume(options: { fromProfile: boolean }) {
    if (!profile) {
      notify({ type: "warning", title: "提示", message: "请先在个人资料库填写基本信息，再创建简历。" });
      return;
    }
    const label = options.fromProfile ? "资料库简历" : "空白简历";
    try {
      const result = await repository.createGeneralResumeBranch({
        profileId: profile.id,
        operationId: `v2-g7b5-${options.fromProfile ? "profile" : "blank"}-${crypto.randomUUID()}`,
        name: label,
        includeProfileFacts: options.fromProfile,
        includeProfileBasics: options.fromProfile
      });
      await refreshLists(profile.id);
      openResumeBranch(result.branch.id);
      setStudioMode("edit");
      setActiveResumeSection("basics");
      notify({ type: "success", title: "创建成功", message: options.fromProfile
        ? "已从个人资料库创建独立简历副本；之后资料库变化不会自动覆盖这份简历。"
        : "空白简历已创建。填写并确认的内容才会进入预览和导出。" });
    } catch {
      notify({ type: "error", title: "创建失败", message: "请刷新个人资料库后重试。" });
    }
  }

  async function saveItem(itemId: string, options: { origin?: "manual" | "auto" } = {}) {
    const origin = options.origin ?? "manual";
    const branchId = activeBranchId;
    const queuedText = editTextsRef.current[itemId]?.trim();
    if (!branchId || !queuedText) {
      if (origin === "manual") {
        notify({ type: "warning", title: "不可编辑", message: !branchId
          ? "当前简历不可编辑：旧数据、归档、引用失效或缺少当前版本。"
          : "请先填写要保存的文本。" });
      }
      return;
    }

    setContentAutoSaveState("saving");
    const operation = async () => {
      const text = editTextsRef.current[itemId]?.trim();
      if (!text) {
        return;
      }
      let branch = branchesRef.current.find((item) => item.id === branchId);
      if (!branch || !canEditBranch(branch)) {
        setContentAutoSaveState("error");
        if (origin === "manual") {
          notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑：旧数据、归档、引用失效或缺少当前版本。" });
        }
        return;
      }

      const clearSavedDraft = () => {
        const currentDrafts = editTextsRef.current;
        if (currentDrafts[itemId]?.trim() !== text) {
          setContentAutoSaveState("dirty");
          return;
        }
        const nextDrafts = { ...currentDrafts };
        delete nextDrafts[itemId];
        editTextsRef.current = nextDrafts;
        setEditTexts(nextDrafts);
        setContentAutoSaveState(Object.keys(nextDrafts).length > 0 ? "dirty" : "saved");
      };

      if (branch.contentItems.find((item) => item.id === itemId)?.text.trim() === text) {
        clearSavedDraft();
        return;
      }

      const persist = async (currentBranch: ResumeBranch) => {
        const sourceItem = currentBranch.contentItems.find((item) => item.id === itemId);
        return repository.editResumeBranch({
          branchId: currentBranch.id,
          expectedRevision: currentBranch.revision,
          operationId: `d1-edit-${currentBranch.id}-${currentBranch.revision}-${itemId}-${stableHashText(text)}`,
          confirmAsResumeOnly: sourceItem?.userConfirmation?.scope === "resume_only",
          edits: [{ itemId, text }]
        });
      };

      try {
        let result;
        try {
          result = await persist(branch);
        } catch (error) {
          if (!(error instanceof RevisionConflictError)) {
            throw error;
          }
          const latestBranch = await repository.getResumeBranch(branchId);
          if (!latestBranch || !canEditBranch(latestBranch)) {
            throw error;
          }
          branch = latestBranch;
          replaceBranch(latestBranch, { preserveDrafts: true });
          result = await persist(latestBranch);
        }
        replaceBranch(result.branch, { preserveDrafts: true });
        clearSavedDraft();
        if (origin === "manual") {
          const sourceItem = result.branch.contentItems.find((item) => item.id === itemId);
          notify({ type: "success", title: "已保存", message: sourceItem?.userConfirmation?.scope === "resume_only"
            ? "内容已保存到当前简历；个人资料库未被修改。"
            : "简历内容已保存，事实安全检查已重新计算。" });
        }
      } catch (error) {
        if (error instanceof Error && error.message === "branch_edit_fact_guard_blocked") {
          setContentAutoSaveState("needs_confirmation");
          setPendingResumeOnlyEdit({ itemId, text, source: "form" });
          return;
        }
        setContentAutoSaveState("error");
        notify({ type: "error", title: "保存失败", message: error instanceof RevisionConflictError
          ? "简历版本已变化，请刷新后重试。"
          : "当前简历不可编辑或事实引用已失效。" });
      }
    };

    const queued = contentSaveQueueRef.current.then(operation);
    contentSaveQueueRef.current = queued.catch((error) => {
      console.error("Resume content save queue error:", error);
    });
    await queued;
  }

  async function saveStructuredItem(itemId: string, item: ResumeItemV2, options: { origin?: "manual" | "auto" } = {}) {
    const origin = options.origin ?? "manual";
    const branchId = activeBranchId;
    if (!branchId) {
      if (origin === "manual") notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑。" });
      return;
    }
    const text = projectResumeItemV2(item).trim();
    if (!text) {
      if (origin === "manual") notify({ type: "warning", title: "内容不能为空", message: "请至少填写一个字段。" });
      return;
    }

    setContentAutoSaveState("saving");
    const operation = async () => {
      try {
        const branch = await repository.getResumeBranch(branchId);
        if (!branch || !canEditBranch(branch)) {
          if (origin === "manual") notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑。" });
          setContentAutoSaveState("error");
          return;
        }
        const legacy = branch.contentItems.find((candidate) => candidate.id === itemId);
        if (!legacy) {
          if (origin === "manual") notify({ type: "error", title: "保存失败", message: "找不到对应的简历条目。" });
          setContentAutoSaveState("error");
          return;
        }
        const currentStructured = branch.structuredContentItems?.find((candidate) => candidate.id === itemId);
        if (currentStructured && JSON.stringify(currentStructured.data) === JSON.stringify(item)) {
          setContentAutoSaveState("saved");
          return;
        }

        const persist = (currentBranch: ResumeBranch, sourceItem: ResumeBranch["contentItems"][number]) => repository.editResumeBranch({
          branchId: currentBranch.id,
          expectedRevision: currentBranch.revision,
          operationId: `canonical-edit-${currentBranch.id}-${currentBranch.revision}-${itemId}-${stableHashText(JSON.stringify(item))}`,
          confirmAsResumeOnly: sourceItem.userConfirmation?.scope === "resume_only",
          edits: [{ itemId, text, structuredItem: item }]
        });
        let result;
        try {
          result = await persist(branch, legacy);
        } catch (error) {
          if (!(error instanceof RevisionConflictError)) throw error;
          const latestBranch = await repository.getResumeBranch(branchId);
          const latestLegacy = latestBranch?.contentItems.find((candidate) => candidate.id === itemId);
          if (!latestBranch || !latestLegacy || !canEditBranch(latestBranch)) throw error;
          result = await persist(latestBranch, latestLegacy);
        }
        replaceBranch(result.branch, { preserveDrafts: true });
        setContentAutoSaveState("saved");
        if (origin === "manual") notify({ type: "success", title: "已保存", message: "结构字段和自定义字段已保存到当前简历。" });
      } catch (error) {
        if (error instanceof Error && error.message === "branch_edit_fact_guard_blocked") {
          setContentAutoSaveState("needs_confirmation");
          if (origin === "manual") notify({ type: "warning", title: "需要确认", message: "修改包含新的事实信息，请确认后再保存。" });
          return;
        }
        setContentAutoSaveState("error");
        if (origin === "manual") notify({ type: "error", title: "保存失败", message: error instanceof RevisionConflictError ? "简历版本已变化，请刷新后重试。" : "结构字段未保存，请重试。" });
      }
    };

    const queued = contentSaveQueueRef.current.then(operation);
    contentSaveQueueRef.current = queued.catch((error) => console.error("Resume structured save queue error:", error));
    await queued;
  }

  useEffect(() => {
    saveItemRef.current = saveItem;
  });

  useEffect(() => {
    const dirtyItemIds = Object.keys(editTexts).filter((itemId) => editTexts[itemId]?.trim());
    if (!activeBranchId || !selectedBranchEditable || dirtyItemIds.length === 0) {
      return;
    }
    const stateTimer = window.setTimeout(() => setContentAutoSaveState("dirty"), 0);
    const timer = window.setTimeout(() => {
      dirtyItemIds.forEach((itemId) => {
        void saveItemRef.current(itemId, { origin: "auto" });
      });
    }, 1200);
    return () => {
      window.clearTimeout(stateTimer);
      window.clearTimeout(timer);
    };
  }, [activeBranchId, editTexts, selectedBranchEditable]);

  async function setContentItemVisibility(itemId: string, visible: boolean) {
    if (!selectedBranch || !selectedBranchEditable) {
      notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑：旧数据、归档、引用失效或缺少当前版本。" });
      return;
    }

    try {
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `v2-g7b3-content-visible-${selectedBranch.id}-${selectedBranch.revision}-${itemId}-${visible ? "restore" : "delete"}`,
        edits: [{ itemId, visible }]
      });
      replaceBranch(result.branch);
      setSelectedStudioItemId(visible ? itemId : undefined);
      notify({ type: "success", title: visible ? "已恢复" : "已删除", message: visible ? "内容已恢复到当前简历，并创建新的内容版本。" : "内容已删除，可使用撤销恢复。" });
    } catch {
      notify({ type: "error", title: "操作失败", message: "版本冲突、引用失效或当前简历不可编辑。" });
    }
  }

  async function duplicateContentItem(itemId: string) {
    if (!selectedBranch || !selectedBranchEditable) {
      notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑：旧数据、归档、引用失效或缺少当前版本。" });
      return;
    }

    try {
      const result = await repository.duplicateResumeContentItem({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `v2-g7b3-content-duplicate-${selectedBranch.id}-${selectedBranch.revision}-${itemId}`,
        itemId
      });
      replaceBranch(result.branch);
      setSelectedStudioItemId(result.duplicatedItemId);
      notify({ type: "success", title: "已复制", message: result.idempotent ? "该内容已复制过，未重复创建版本。" : "内容已复制，并创建新的内容版本。" });
    } catch {
      notify({ type: "error", title: "复制失败", message: "版本冲突、引用失效或当前简历不可编辑。" });
    }
  }

  async function renameBranch(branch: ResumeBranch, newName: string) {
    if (!canEditBranch(branch) || renameBranchPending) {
      return;
    }
    const trimmed = newName.trim();
    if (!trimmed) {
      setRenameBranchError("简历名称不能为空");
      return;
    }
    if (trimmed.length > 120) {
      setRenameBranchError("简历名称不能超过 120 个字符");
      return;
    }
    if (trimmed === branch.name) {
      setRenamingBranchId(undefined);
      setRenameBranchError(undefined);
      return;
    }
    setRenameBranchPending(true);
    setRenameBranchError(undefined);
    try {
      const result = await repository.renameResumeBranch({
        branchId: branch.id,
        expectedRevision: branch.revision,
        operationId: `rename-${branch.id}-${branch.revision}-${stableHashText(trimmed)}`,
        name: trimmed
      });
      replaceBranch(result.branch, { select: false });
      setRenamingBranchId(undefined);
      setRenameBranchDraft("");
      notify({ type: "success", title: "已重命名", message: "简历名称已更新。" });
    } catch {
      setRenameBranchError("重命名失败，请刷新后重试");
    } finally {
      setRenameBranchPending(false);
    }
  }

  async function addContentItem(
    section: string,
    draft: string | { text: string; organization?: string; role?: string; location?: string; degree?: string; major?: string; courses?: string[]; startDate?: string; endDate?: string },
    syncToProfile = false
  ) {
    if (!selectedBranch || !selectedBranchEditable) {
      notify({ type: "warning", title: "不可编辑", message: "当前简历不可编辑。" });
      return;
    }
    const itemTypeMap: Record<string, "experience" | "skill" | "certificate" | "summary" | "custom"> = {
      summary: "summary",
      education: "experience",
      work: "experience",
      internship: "experience",
      project: "experience",
      campus: "experience",
      skills: "skill",
      certificates: "certificate",
      awards: "custom",
      languages: "custom",
      custom: "custom"
    };
    const itemType = itemTypeMap[section] ?? "custom";
    const payload = typeof draft === "string" ? { text: draft } : draft;
    if (!payload.text.trim()) {
      notify({ type: "warning", title: "提示", message: "请先填写内容，再保存并确认。" });
      return;
    }
    try {
      const result = await repository.addResumeContentItem({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `add-${section}-${selectedBranch.id}-${selectedBranch.revision}-${stableHashText(payload.text)}`,
        section,
        itemType,
        text: payload.text,
        organization: payload.organization,
        role: payload.role,
        location: payload.location,
        degree: payload.degree,
        major: payload.major,
        courses: payload.courses,
        startDate: payload.startDate,
        endDate: payload.endDate,
        syncToProfile
      });
      if (syncToProfile) {
        const nextProfile = await repository.getProfile(selectedBranch.profileId);
        if (nextProfile) setProfileOverride(nextProfile);
      }
      replaceBranch(result.branch);
      setSelectedBranchId(result.branch.id);
      setSelectedStudioItemId(result.newItemId);
      notify({ type: "success", title: "已添加", message: syncToProfile
        ? "新内容已加入简历，并同步到个人资料库。"
        : "新内容已保存到当前简历。资料库中还没有这条内容，可随时点击“同步到资料库”。" });
    } catch {
      notify({ type: "error", title: "添加失败", message: "当前简历可能不可编辑。" });
    }
  }

  function toggleStudioSection(section: ResumeStudioSectionKey) {
    if (!selectedBranch) return;
    const branchId = selectedBranch.id;
    const enabled = resumeSectionNavItems.some((item) => item.key === section);
    if (enabled) {
      setHiddenSectionsByBranch((current) => ({ ...current, [branchId]: [...new Set([...(current[branchId] ?? []), section])] }));
      setEnabledSectionsByBranch((current) => ({ ...current, [branchId]: (current[branchId] ?? []).filter((key) => key !== section) }));
      const count = resumeSectionNavItems.find((item) => item.key === section)?.count ?? 0;
      notify({ type: "info", title: "栏目已从导航隐藏", message: count > 0 ? `栏目中的 ${count} 条内容仍完整保留，可随时恢复。` : "栏目内容未被删除，可随时恢复。" });
      if (activeResumeSection === section) setActiveResumeSection("basics");
      return;
    }
    setHiddenSectionsByBranch((current) => ({ ...current, [branchId]: (current[branchId] ?? []).filter((key) => key !== section) }));
    setEnabledSectionsByBranch((current) => ({ ...current, [branchId]: [...new Set([...(current[branchId] ?? []), section])] }));
    setActiveResumeSection(section);
  }

  function addCustomStudioSection() {
    if (!selectedBranch) return;
    const title = customSectionTitle.trim();
    if (!title) {
      setCustomSectionError("请输入栏目标题。");
      return;
    }
    const existingTitles = [...resumeSectionNavItems.map((item) => item.label), ...(customSectionsByBranch[selectedBranch.id] ?? []).map((section) => section.title)];
    if (existingTitles.some((existing) => existing.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setCustomSectionError("栏目名称已存在，请换一个名称。");
      return;
    }
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `custom:${id}` as const;
    setCustomSectionsByBranch((current) => {
      const sections = current[selectedBranch.id] ?? [];
      return { ...current, [selectedBranch.id]: [...sections, { id, title, order: sections.length + 1 }] };
    });
    setEnabledSectionsByBranch((current) => ({ ...current, [selectedBranch.id]: [...new Set([...(current[selectedBranch.id] ?? []), key])] }));
    setCustomSectionTitle("");
    setCustomSectionError(undefined);
    setIsSectionMenuOpen(false);
    setActiveResumeSection(key);
    window.requestAnimationFrame(() => sectionMenuButtonRef.current?.focus());
  }

  async function savePendingResumeOnlyEdit(syncAfterSave: boolean) {
    if (!selectedBranch || !pendingResumeOnlyEdit) return;
    const pending = pendingResumeOnlyEdit;
    try {
      const saved = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `resume-only-edit-${selectedBranch.id}-${selectedBranch.revision}-${pending.itemId}-${stableHashText(pending.text)}`,
        confirmAsResumeOnly: true,
        edits: [{ itemId: pending.itemId, text: pending.text }]
      });
      let nextBranch = saved.branch;
      if (syncAfterSave) {
        const synced = await repository.syncResumeContentItemToProfile({
          branchId: saved.branch.id,
          expectedRevision: saved.branch.revision,
          operationId: `sync-resume-item-${saved.branch.id}-${saved.branch.revision}-${pending.itemId}`,
          itemId: pending.itemId
        });
        nextBranch = synced.branch;
        const nextProfile = await repository.getProfile(nextBranch.profileId);
        if (nextProfile) setProfileOverride(nextProfile);
      }
      replaceBranch(nextBranch, { preserveDrafts: true });
      const nextDrafts = { ...editTextsRef.current };
      delete nextDrafts[pending.itemId];
      editTextsRef.current = nextDrafts;
      setEditTexts(nextDrafts);
      setContentAutoSaveState(Object.keys(nextDrafts).length > 0 ? "dirty" : "saved");
      if (pending.source === "preview") cancelStudioEdit();
      setPendingResumeOnlyEdit(undefined);
      notify({ type: "success", title: "已保存", message: syncAfterSave
        ? "修改已保存，并同步到个人资料库。"
        : "修改已仅保存到当前简历；个人资料库未被修改。" });
    } catch (error) {
      notify({ type: "error", title: "保存失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : "当前简历或资料库状态已变化，请重试。" });
    }
  }

  async function syncContentItemToProfile(itemId: string) {
    if (!selectedBranch) return;
    try {
      const result = await repository.syncResumeContentItemToProfile({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `sync-resume-item-${selectedBranch.id}-${selectedBranch.revision}-${itemId}`,
        itemId
      });
      const nextProfile = await repository.getProfile(result.branch.profileId);
      if (nextProfile) setProfileOverride(nextProfile);
      replaceBranch(result.branch);
      notify({ type: "success", title: "已同步", message: "该内容已同步到个人资料库；以后仍可继续独立编辑这份简历。" });
    } catch (error) {
      notify({ type: "error", title: "同步失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : "请检查资料库状态后重试。" });
    }
  }

  async function addProfileLibraryItemToResume(item: ProfileLibraryItem) {
    if (!selectedBranch) return;
    try {
      const result = await repository.addResumeContentItemFromProfileReference({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `use-profile-item-${selectedBranch.id}-${selectedBranch.revision}-${item.key}`,
        section: activeResumeSection,
        reference: item.reference
      });
      replaceBranch(result.branch);
      setSelectedStudioItemId(result.newItemId);
      setProfileLibraryOpen(false);
      notify({ type: "success", title: "已加入", message: "已从个人资料库加入当前简历；重复条目不会再次加入。" });
    } catch (error) {
      notify({ type: "error", title: "加入失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : error instanceof Error && error.message === "profile_item_already_used"
          ? "这条资料已经在当前简历中。"
          : "该资料可能已失效、重复或尚未确认。" });
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
      notify({ type: "warning", title: "不可保存", message: "当前简历不可保存展示配置：旧数据、归档、引用失效或缺少当前版本。" });
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
      notify({ type: "success", title: "已保存", message: result.idempotent ? "该展示操作已保存过，未重复写入。" : input.successMessage });
      return result.config;
    } catch (error) {
      notify({ type: "error", title: "保存失败", message: error instanceof RevisionConflictError
        ? "展示配置保存失败：内容版本或展示版本已变化，请刷新后重试。"
        : "展示配置保存失败：可能隐藏了全部内容、简历不可编辑或配置不合法。" });
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
      notify({ type: "warning", title: "提示", message: "展示配置尚未加载完成，请稍后再切换模板。" });
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
        successMessage: pagePolicy === "prefer_one_page"
          ? "已启用优先压缩到一页；内容仍会完整分页。"
          : "已使用自然分页；内容需要几页就显示几页。"
      });
    });
  }

  async function updatePaginationSettings(
    patch: Partial<ResumePresentationConfig["pagination"]>,
    successMessage: string
  ) {
    if (!selectedBranch || !presentationConfig) {
      return;
    }
    enqueuePresentation(async (current) => {
      const nextPagination = { ...current.pagination, ...patch, maximumPageCount: 4 as const };
      if (stableHashText(JSON.stringify(current.pagination)) === stableHashText(JSON.stringify(nextPagination))) {
        return current;
      }
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: { pagination: nextPagination }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `p38a-pagination-${selectedBranch.id}-${current.presentationRevision}-${stableHashText(JSON.stringify(nextPagination))}`,
        successMessage
      });
    });
  }

  async function optimizeForOnePage() {
    if (!selectedBranch || !presentationConfig) return;
    enqueuePresentation(async (current) => {
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: {
          typography: { ...current.typography, bodyTextScale: "small", lineHeight: "tight" },
          spacing: { pageMargin: "narrow", sectionGap: "tight", itemGap: "tight" },
          theme: { ...current.theme, density: "compact" },
          pagination: { ...current.pagination, preferredPageCount: 1, pagePolicy: "prefer_one_page" }
        }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `p38c-one-page-optimize-${selectedBranch.id}-${current.presentationRevision}`,
        successMessage: "已应用一页优化；内容不会被删除或裁切。"
      });
    });
  }

  async function relaxForTwoPages() {
    if (!selectedBranch || !presentationConfig) return;
    enqueuePresentation(async (current) => {
      const nextConfig = buildNextPresentationConfig({
        current,
        branch: selectedBranch,
        patch: {
          typography: { ...current.typography, bodyTextScale: "normal", lineHeight: "relaxed" },
          spacing: { pageMargin: "normal", sectionGap: "relaxed", itemGap: "relaxed" },
          theme: { ...current.theme, density: "spacious" },
          pagination: { ...current.pagination, preferredPageCount: 2, pagePolicy: "up_to_two_pages" }
        }
      });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `p38c1-two-page-relaxed-${selectedBranch.id}-${current.presentationRevision}`,
        successMessage: "已应用两页舒展；内容将按自然顺序分页。"
      });
    });
  }

  async function updateItemHeaderAlignment(itemHeaderMiddleAlignment: ResumePresentationConfig["itemHeaderMiddleAlignment"]) {
    if (!selectedBranch || !presentationConfig) return;
    enqueuePresentation(async (current) => {
      const nextConfig = buildNextPresentationConfig({ current, branch: selectedBranch, patch: { itemHeaderMiddleAlignment } });
      return await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `p38c-heading-${selectedBranch.id}-${current.presentationRevision}-${itemHeaderMiddleAlignment}`,
        successMessage: "条目头部对齐已保存。"
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
      setPresentationConfig(nextConfig);
      presentationQueueRef.current.latestConfig = nextConfig;
      const saved = await savePresentationConfig({
        nextConfig,
        beforeConfig: current,
        operationId: `v2-g1a-visibility-${selectedBranch.id}-${selectedBranch.revision}-${current.presentationRevision}-${stableHashText(hiddenItemIds.join("|"))}`,
        successMessage: visible ? "内容已恢复显示，未创建内容版本。" : "内容已隐藏，未创建内容版本。"
      });
      if (!saved) {
        setPresentationConfig(current);
        presentationQueueRef.current.latestConfig = current;
      }
      return saved ?? current;
    });
  }

  async function movePresentationItem(itemId: string, direction: "up" | "down") {
    if (!selectedBranch || !presentationConfig || !resumeDocument) {
      return;
    }
    const block = resumeDocumentBlocksById.get(itemId);
    if (!block) {
      notify({ type: "error", title: "排序失败", message: "找不到对应区块。" });
      return;
    }
    const section = resumeDocument.sections.find((candidate) => candidate.type === block.sectionType);
    const sectionBlocks = section?.blocks ?? [];
    const currentIndex = sectionBlocks.findIndex((candidate) => candidate.contentItemId === itemId);
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sectionBlocks.length) {
      notify({ type: "warning", title: "提示", message: "当前区块已经在该栏目边界。" });
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
      notify({ type: "warning", title: "提示", message: "没有可撤销的展示操作。" });
      return;
    }
    const queue = presentationQueueRef.current;
    if (queue.undoStack.length === 0) {
      notify({ type: "warning", title: "提示", message: "没有可撤销的展示操作。" });
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
      notify({ type: "warning", title: "提示", message: "没有可重做的展示操作。" });
      return;
    }
    const queue = presentationQueueRef.current;
    if (queue.redoStack.length === 0) {
      notify({ type: "warning", title: "提示", message: "没有可重做的展示操作。" });
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
      notify({ type: "warning", title: "不可恢复", message: "当前简历不可恢复：旧数据、归档、引用失效或缺少当前版本。" });
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
      notify({ type: "success", title: "已恢复", message: "已恢复旧版本；恢复操作已作为新的版本记录。" });
    } catch {
      notify({ type: "error", title: "恢复失败", message: "版本链缺失、版本冲突或简历不可编辑。" });
    }
  }

  async function undo() {
    if (!selectedBranch || !selectedBranchEditable) {
      notify({ type: "warning", title: "不可撤销", message: "当前简历不可撤销：旧数据、归档、引用失效或缺少当前版本。" });
      return;
    }
    try {
      const result = await repository.undoResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-undo-${selectedBranch.id}-${selectedBranch.revision}`
      });
      replaceBranch(result.branch);
      notify({ type: "success", title: "已撤销", message: "已撤销最近一次简历修改。" });
    } catch {
      notify({ type: "error", title: "撤销失败", message: "没有可撤销版本或当前简历已变化。" });
    }
  }

  function scrollCanvasItemIntoView(itemId: string) {
    window.requestAnimationFrame(() => {
      document
        .querySelector(`.resume-preview-stage [data-source-item-id="${cssEscape(itemId)}"]`)
        ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    });
  }

  function selectStudioItem(itemId: string) {
    if (!isStudioEditMode) {
      return;
    }
    const block = resumeDocumentBlocksById.get(itemId);
    if (block) {
      const targetSection = studioSectionForBlock(block);
      if (targetSection !== activeResumeSection) {
        setActiveResumeSection(targetSection);
      }
    }
    setSelectedStudioItemId(itemId);
    setSelectedProfileFieldId(undefined);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
    setSelectedSectionTitleId(undefined);
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText("");
    setSectionTitleError(undefined);
    setActivePropertyTab("block");
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
    scrollCanvasItemIntoView(itemId);
  }

  function startStudioEdit(itemId: string) {
    const block = resumeDocumentBlocksById.get(itemId);
    if (!block) {
      setStudioError("找不到对应的简历内容区块。");
      return;
    }
    setSelectedStudioItemId(itemId);
    setSelectedProfileFieldId(undefined);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
    setSelectedSectionTitleId(undefined);
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText("");
    setSectionTitleError(undefined);
    if (!block.editable || !selectedBranchEditable) {
      setStudioError(`当前区块不可编辑：${block.notEditableReason ?? "branch_not_editable"}`);
      return;
    }
    setEditingStudioItemId(itemId);
    setStudioDraftText(block.text);
    setStudioError(undefined);
    setPendingStudioOperationId(undefined);
    scrollCanvasItemIntoView(itemId);
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
    setSelectedSectionTitleId(undefined);
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText("");
    setSectionTitleError(undefined);
    setPendingStudioOperationId(undefined);
    setActivePropertyTab("document");
    setActiveResumeSection("basics");
    scrollCanvasItemIntoView(fieldId);
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

  function selectSectionTitle(fieldId: string, currentText: string) {
    const sectionType = sectionTitleFieldType(fieldId);
    if (!isStudioEditMode || !sectionType) {
      return;
    }
    setSelectedSectionTitleId(fieldId);
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText(currentText);
    setSectionTitleError(undefined);
    setSelectedStudioItemId(undefined);
    setEditingStudioItemId(undefined);
    setStudioDraftText("");
    setStudioError(undefined);
    setSelectedProfileFieldId(undefined);
    setEditingProfileFieldId(undefined);
    setProfileFieldDraftText("");
    setProfileFieldError(undefined);
    setPendingStudioOperationId(undefined);
    setActivePropertyTab("section");
    setActiveResumeSection(sectionType === "experience" ? "work" : sectionType);
    scrollCanvasItemIntoView(fieldId);
  }

  function startSectionTitleEdit(fieldId: string, currentText: string) {
    const sectionType = sectionTitleFieldType(fieldId);
    if (!sectionType) {
      setSectionTitleError("当前栏目标题暂不可编辑。");
      return;
    }
    selectSectionTitle(fieldId, currentText);
    setEditingSectionTitleId(fieldId);
  }

  function cancelSectionTitleEdit() {
    setEditingSectionTitleId(undefined);
    setSectionTitleDraftText("");
    setSectionTitleError(undefined);
  }

  async function saveSectionTitleEdit() {
    if (!selectedBranch || !presentationConfig || !editingSectionTitleId) {
      return;
    }
    const sectionType = sectionTitleFieldType(editingSectionTitleId);
    if (!sectionType) {
      setSectionTitleError("当前栏目标题暂不可编辑。");
      return;
    }
    const nextTitle = sectionTitleDraftText.trim();
    if (!nextTitle) {
      setSectionTitleError("栏目标题不能为空。");
      return;
    }
    const currentTitle = renderModel?.sections.find((section) => section.type === sectionType)?.title;
    if (nextTitle === currentTitle) {
      cancelSectionTitleEdit();
      notify({ type: "info", title: "未变化", message: "栏目标题未变化，没有创建新的展示版本。" });
      return;
    }

    setSectionTitlePending(true);
    setSectionTitleError(undefined);
    try {
      await updatePresentationStyle((current) => ({
        sectionStyleOverrides: {
          ...current.sectionStyleOverrides,
          [sectionType]: {
            ...current.sectionStyleOverrides[sectionType],
            titleOverride: nextTitle
          }
        }
      }), "栏目标题已保存；正文事实未改变。");
      setEditingSectionTitleId(undefined);
      setSelectedSectionTitleId(undefined);
      setSectionTitleDraftText("");
    } catch {
      setSectionTitleError("栏目标题保存失败，请稍后重试。");
    } finally {
      setSectionTitlePending(false);
    }
  }

  async function saveProfileFieldEdit() {
    if (!profile || !editingProfileFieldId) {
      return;
    }
    await saveProfileFieldText(editingProfileFieldId, profileFieldDraftText);
  }

  async function saveProfileFieldText(fieldId: string, draftText: string) {
    if (!profile || !selectedBranch || !selectedBranchEditable) {
      return;
    }
    const key = profileFieldKey(fieldId);
    if (!key) {
      setProfileFieldError("当前基本信息字段暂不可编辑。");
      return;
    }
    const text = draftText.trim();
    const currentBasics = selectedBranch.resumeBasics ?? {
      name: profile.basics.name,
      email: profile.basics.email ?? "",
      phone: profile.basics.phone ?? "",
      location: profile.basics.location ?? "",
      summary: profile.basics.summary ?? "",
      links: profile.basics.links
    };
    const currentValue = key === "link"
      ? currentBasics.links[profileLinkIndex(fieldId)] ?? ""
      : currentBasics[key] ?? "";
    if (text === currentValue) {
      setEditingProfileFieldId(undefined);
      setProfileFieldError(undefined);
      return;
    }
    const patch: Partial<NonNullable<ResumeBranch["resumeBasics"]>> = {};
    if (key === "link") {
      const index = profileLinkIndex(fieldId);
      const links = [...currentBasics.links];
      if (text) {
        links[index] = text;
      } else {
        links.splice(index, 1);
      }
      patch.links = links.filter((link) => link.trim().length > 0);
    } else {
      patch[key] = text;
    }
    setProfileFieldPending(true);
    try {
      const result = await repository.editResumeBranchBasics({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `v2-g7b5-basics-${selectedBranch.id}-${selectedBranch.revision}-${fieldId}-${stableHashText(text)}`,
        basics: patch
      });
      const nextProfile = profile ? await repository.getProfile(profile.id) : undefined;
      if (nextProfile) setProfileOverride(nextProfile);
      replaceBranch(result.branch);
      setEditingProfileFieldId(undefined);
      setSelectedProfileFieldId(undefined);
      setProfileFieldDraftText("");
      setProfileFieldError(undefined);
      notify({ type: "success", title: "已保存", message: "这份简历的个人信息已保存；个人资料库未被修改。" });
    } catch {
      setProfileFieldError("保存失败：版本已变化，请刷新后重试。");
    } finally {
      setProfileFieldPending(false);
    }
  }

  async function openProfileSyncDialog() {
    if (!profile || !selectedBranch) return;
    const latestProfile = await repository.getProfile(profile.id);
    if (!latestProfile) return;
    const resumeBasics = selectedBranch.resumeBasics ?? {
      name: profile.basics.name,
      email: profile.basics.email ?? "",
      phone: profile.basics.phone ?? "",
      location: profile.basics.location ?? "",
      summary: profile.basics.summary ?? "",
      links: profile.basics.links
    };
    const conflicts: Array<{ fieldId: string; label: string; resumeValue: string; profileValue: string }> = [];
    const candidates = [
      ["profile:name", "姓名", resumeBasics.name, latestProfile.basics.name],
      ["profile:email", "邮箱", resumeBasics.email, latestProfile.basics.email ?? ""],
      ["profile:phone", "电话", resumeBasics.phone, latestProfile.basics.phone ?? ""],
      ["profile:location", "地址", resumeBasics.location, latestProfile.basics.location ?? ""],
      ["profile:link:0", "个人链接", resumeBasics.links[0] ?? "", latestProfile.basics.links[0] ?? ""]
    ] as const;
    for (const [fieldId, label, resumeValue, profileValue] of candidates) {
      if (resumeValue !== profileValue) conflicts.push({ fieldId, label, resumeValue, profileValue });
    }
    if (conflicts.length === 0) {
      const result = await repository.editResumeBranchBasics({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `v2-g7b5-profile-ack-${selectedBranch.id}-${selectedBranch.revision}-${latestProfile.version}`,
        basics: {},
        acknowledgeProfileVersion: true
      });
      replaceBranch(result.branch);
      notify({ type: "success", title: "已同步", message: "这份简历与个人资料库的基本信息已经一致。" });
      return;
    }
    setProfileSyncConflicts(conflicts);
    setProfileSyncChoices(Object.fromEntries(conflicts.map((item) => [item.fieldId, "resume"])));
    setProfileSyncDialogOpen(true);
  }

  async function applyProfileSyncChoices() {
    if (!selectedBranch) return;
    const basics: Partial<NonNullable<ResumeBranch["resumeBasics"]>> = {};
    const currentLinks = [...(selectedBranch.resumeBasics?.links ?? profile?.basics.links ?? [])];
    for (const conflict of profileSyncConflicts) {
      if (profileSyncChoices[conflict.fieldId] !== "profile") continue;
      const key = profileFieldKey(conflict.fieldId);
      if (!key) continue;
      if (key === "link") currentLinks[profileLinkIndex(conflict.fieldId)] = conflict.profileValue;
      else basics[key] = conflict.profileValue;
    }
    basics.links = currentLinks.filter(Boolean);
    setProfileFieldPending(true);
    try {
      const result = await repository.editResumeBranchBasics({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `v2-g7b5-profile-sync-${selectedBranch.id}-${selectedBranch.revision}-${stableHashText(JSON.stringify(profileSyncChoices))}`,
        basics,
        acknowledgeProfileVersion: true
      });
      replaceBranch(result.branch);
      setProfileSyncDialogOpen(false);
      setProfileSyncConflicts([]);
      setProfileSyncChoices({});
      notify({ type: "success", title: "已同步", message: "已按你的选择处理资料库差异；个人资料库未被修改。" });
    } catch {
      setProfileFieldError("同步失败，请稍后重试。");
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
      notify({ type: "info", title: "未变化", message: "内容未变化，没有创建新的简历版本。" });
      return;
    }

    const operationId = `v2-g0a-edit-${selectedBranch.id}-${selectedBranch.revision}-${block.contentItemId}-${stableHashText(nextText)}`;
    setPendingStudioOperationId(operationId);
    setStudioError(undefined);

    try {
      const sourceItem = selectedBranch.contentItems.find((item) => item.id === block.contentItemId);
      const result = await repository.editResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId,
        confirmAsResumeOnly: sourceItem?.userConfirmation?.scope === "resume_only",
        edits: [{ itemId: block.contentItemId, text: nextText }]
      });
      replaceBranch(result.branch);
      setSelectedBranchId(result.branch.id);
      setEditTexts((prev) => {
        if (!(block.contentItemId in prev)) return prev;
        const next = { ...prev };
        delete next[block.contentItemId];
        return next;
      });
      notify({ type: "success", title: "已保存", message: result.idempotent ? "该编辑已保存过，未重复创建版本。" : "简历内容已保存，并创建新的内容版本。" });
    } catch (error) {
      setPendingStudioOperationId(undefined);
      if (error instanceof Error && error.message === "branch_edit_fact_guard_blocked") {
        setPendingResumeOnlyEdit({ itemId: block.contentItemId, text: nextText, source: "preview" });
        setStudioError(undefined);
        return;
      }
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
    notify({ type: "success", title: "已更新", message: "更新提示已基于当前个人资料、岗位和事实引用重新计算；简历内容未被自动覆盖。" });
  }

  async function openOrCreateApplication() {
    if (!selectedBranch) {
      return;
    }
    if (selectedBranch.branchPurpose !== "job_specific") {
      notify({ type: "warning", title: "提示", message: "通用简历不能直接加入投递工作台；请先在岗位优化面板创建岗位定制简历。" });
      return;
    }
    if (!selectedBranch.currentRevisionId) {
      notify({ type: "warning", title: "提示", message: "当前简历缺少可投递版本，不能加入求职进度。" });
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
      notify({ type: "success", title: "已加入", message: result.duplicate
        ? "该岗位简历已有未归档投递记录，已打开现有记录。"
        : "已加入投递工作台；未自动导出PDF，也未改变投递状态。" });
      router.push(`/applications?applicationId=${encodeURIComponent(result.application.id)}`);
    } catch (error) {
      notify({ type: "error", title: "加入失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : "只有已校验的岗位定制简历可加入投递工作台。" });
    }
  }

  function downloadStructuredJson() {
    if (!renderModel || !profile || !selectedBranch) {
      notify({ type: "warning", title: "提示", message: "当前没有可导出的结构化简历。" });
      return;
    }
    const structuredDraft = exportCareerAdaptResumeJsonV2({ profile, branch: selectedBranch });
    const fileName = `${safeDownloadNamePart(renderModel.candidate.name || selectedBranch.name)}-structured-resume.json`;
    const blob = new Blob([JSON.stringify(structuredDraft, null, 2)], { type: "application/json" });
    triggerBrowserDownload(blob, fileName);
    notify({ type: "success", title: "已下载", message: "结构化 JSON 已下载；可重新导入并进入核对页，不包含内部版本或密钥字段。" });
  }

  async function archiveBranch(branch: ResumeBranch) {
    if (!canManageBranch(branch)) {
      notify({ type: "warning", title: "无法归档", message: "当前简历无法归档：旧数据、已归档或缺少当前版本。" });
      return;
    }
    try {
      const result = await repository.archiveResumeBranch({
        branchId: branch.id,
        expectedRevision: branch.revision,
        operationId: `v2-g7b3-archive-${branch.id}-${branch.revision}`,
        confirmedImpact: true
      });
      replaceBranch(result.branch, { select: false });
      setSelectedBranchId(BRANCH_LIST_SENTINEL);
      if (profile) {
        await refreshLists(profile.id);
      }
      notify({ type: "success", title: "已归档", message: "简历已归档，可通过版本历史保留记录；未删除任何文件或数据表。" });
    } catch (error) {
      notify({ type: "error", title: "归档失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : "当前简历状态不允许归档。" });
    }
  }

  async function restoreArchivedBranch(branch: ResumeBranch) {
    try {
      const result = await repository.restoreArchivedResumeBranch({
        branchId: branch.id,
        expectedRevision: branch.revision,
        operationId: `p33-restore-archived-${branch.id}-${branch.revision}`
      });
      replaceBranch(result.branch, { select: false });
      setResumeListFilter("all");
      notify({ type: "success", title: "已恢复", message: "简历已恢复到当前简历，可继续编辑。" });
    } catch (error) {
      notify({ type: "error", title: "恢复失败", message: error instanceof RevisionConflictError ? "简历版本已变化。" : "当前生命周期状态不允许恢复。" });
    }
  }

  async function moveArchivedBranchToTrash(branch: ResumeBranch) {
    try {
      const result = await repository.moveResumeBranchToTrash({
        branchId: branch.id,
        expectedRevision: branch.revision,
        operationId: `p33-trash-${branch.id}-${branch.revision}`
      });
      replaceBranch(result.branch, { select: false });
      notify({ type: "success", title: "已移入回收站", message: "简历已移入回收站，仍可恢复；尚未永久删除。" });
    } catch (error) {
      notify({ type: "error", title: "操作失败", message: error instanceof RevisionConflictError ? "简历版本已变化。" : "请先将简历归档。" });
    }
  }

  async function restoreBranchFromTrash(branch: ResumeBranch) {
    try {
      const result = await repository.restoreResumeBranchFromTrash({
        branchId: branch.id,
        expectedRevision: branch.revision,
        operationId: `p33-restore-trash-${branch.id}-${branch.revision}`
      });
      replaceBranch(result.branch, { select: false });
      setResumeListFilter("archived");
      notify({ type: "success", title: "已恢复", message: "简历已从回收站恢复到归档。" });
    } catch (error) {
      notify({ type: "error", title: "恢复失败", message: error instanceof RevisionConflictError ? "简历版本已变化。" : "当前简历不在回收站中。" });
    }
  }

  async function confirmPermanentBranchDelete() {
    const branch = pendingPermanentDeleteBranch;
    if (!branch || permanentDeleteName.trim() !== branch.name) return;
    setPermanentDeleting(true);
    try {
      const result = await repository.deleteResumeBranchPermanently({ branchId: branch.id, expectedRevision: branch.revision });
      if (!result.deleted) {
        notify({ type: "warning", title: "无法删除", message: `仍有 ${result.blockers.applications} 条求职记录和 ${result.blockers.derivedBranches} 份岗位简历引用它。` });
        setPendingPermanentDeleteBranch(undefined);
        setPermanentDeleteName("");
        return;
      }
      setBranches((current) => current.filter((item) => item.id !== branch.id));
      if (selectedBranchId === branch.id) setSelectedBranchId(BRANCH_LIST_SENTINEL);
      setPendingPermanentDeleteBranch(undefined);
      setPermanentDeleteName("");
      notify({ type: "success", title: "已永久删除", message: "简历及其版本、操作和导出记录已永久删除。" });
    } catch (error) {
      notify({ type: "error", title: "删除失败", message: error instanceof RevisionConflictError ? "简历版本已变化。" : "简历仍保留在回收站。" });
    } finally {
      setPermanentDeleting(false);
    }
  }

  async function downloadPdf() {
    if (!selectedBranch || !renderModel) {
      notify({ type: "error", title: "无法导出", message: "当前简历无法生成正式预览，不能导出。" });
      setPdfExportState({
        status: "failed",
        message: "当前简历无法生成正式预览。",
        errorCode: "render_model_missing",
        canUseFallback: true
      });
      return;
    }
    if (renderModel.safety.visibleItemCount === 0) {
      notify({ type: "warning", title: "提示", message: "至少确认一项简历内容后才能导出 PDF。" });
      return;
    }
    if (!selectedBranchEditable || !selectedBranch.currentRevisionId) {
      notify({ type: "warning", title: "不可导出", message: "当前简历不可导出：旧数据、归档、引用失效或缺少当前版本。" });
      setPdfExportState({
        status: "failed",
        message: "当前简历不可导出。",
        errorCode: branchNotEditableReason(selectedBranch) ?? "branch_not_exportable"
      });
      return;
    }
    if (!presentationConfig) {
      notify({ type: "warning", title: "提示", message: "展示配置尚未加载完成，请稍后再导出。" });
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
      notify({ type: "warning", title: "提示", message: "分页测量尚未完成，请稍后再导出。" });
      setPdfExportState({
        status: "failed",
        message: "分页测量尚未完成。",
        errorCode: "pagination_measurement_unavailable",
        canUseFallback: true
      });
      return;
    }
    if (!renderCoverageReport || renderCoverageHasBlockingFailure(renderCoverageReport)) {
      notify({ type: "warning", title: "导出已停止", message: "检测到简历栏目或条目在渲染链路中丢失或重复，请等待预览刷新后重试。" });
      setPdfExportState({
        status: "failed",
        message: "渲染覆盖检查未通过，导出未继续。",
        errorCode: "render_coverage_failed",
        canUseFallback: false
      });
      return;
    }
    const startedAt = new Date().toISOString();
    const templateWarnings = assessTemplateCompatibility(renderModel, selectedTemplate);
    if (templateWarnings.length > 0) {
      notify({ type: "warning", title: "模板兼容提示", message: templateWarnings.join("；") });
    }
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
      paginationPlan,
      templateVersion: selectedTemplate.version
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
        notify({ type: "warning", title: "导出已停止", message: "简历版本已更新，已刷新预览，请重新检查后导出。" });
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
          exceededPageLimit: paginationPlan.actualPageCount > paginationPlan.maximumPageCount,
          continuationHeader: "none",
          pageSize: "A4",
          pageDimensions: { widthMm: 210, heightMm: 297 },
          ...(exportDiagnosticSummary ?? {})
        });
        notify({ type: "warning", title: "导出已阻止", message: "当前页数超过所选页面策略。" });
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
      notify({ type: "success", title: "PDF 已下载", message: paginationPlan.status === "near_one_page_limit" || paginationPlan.status === "near_limit"
        ? "当前接近单页上限，建议打开文件复核。"
        : "浏览器不允许确认是否最终保存到磁盘。" });
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
      notify({ type: blockedOverflow ? "warning" : "error", title: blockedOverflow ? "导出已阻止" : "下载失败", message: blockedOverflow
        ? "生成前重新检测到页数超过页面策略，请先删减内容或切换策略。"
        : "正在自动切换到浏览器打印 fallback。" });
      setPdfExportState({
        status: blockedOverflow ? "blocked_overflow" : "failed",
        exportId,
        filename: fileName,
        message: blockedOverflow ? "生成前重新检测到页数超过页面策略。" : "直接下载失败，正在切换到浏览器打印。",
        errorCode,
        canUseFallback: !blockedOverflow
      });
      // Auto fallback to browser print when direct download fails
      if (!blockedOverflow) {
        window.requestAnimationFrame(() => {
          void exportPdf();
        });
      }
    }
  }

  async function exportPdf() {
    if (!selectedBranch || !renderModel) {
      notify({ type: "error", title: "无法导出", message: "当前简历无法生成正式预览，不能导出。" });
      return;
    }
    if (renderModel.safety.visibleItemCount === 0) {
      notify({ type: "warning", title: "提示", message: "至少确认一项简历内容后才能打印或保存 PDF。" });
      return;
    }

    const paginationPlan = pagination.plan;
    if (!paginationPlan || pagination.status === "measuring" || pagination.status === "measurement_failed") {
      notify({ type: "warning", title: "提示", message: "分页测量尚未完成，请稍后再使用打印 fallback。" });
      return;
    }
    if (!renderCoverageReport || renderCoverageHasBlockingFailure(renderCoverageReport)) {
      notify({ type: "warning", title: "导出已停止", message: "检测到简历栏目或条目在渲染链路中丢失或重复，请等待预览刷新后重试。" });
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
        notify({ type: "warning", title: "导出已停止", message: "简历版本已更新，已刷新预览，请重新检查后导出。" });
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
          exceededPageLimit: paginationPlan.actualPageCount > paginationPlan.maximumPageCount,
          continuationHeader: "none",
          pageSize: "A4",
          pageDimensions: { widthMm: 210, heightMm: 297 },
          ...(exportDiagnosticSummary ?? {})
        });
        notify({ type: "warning", title: "导出已阻止", message: "当前页数超过所选页面策略。" });
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
      notify({ type: "success", title: "已打开打印", message: paginationPlan.status === "near_one_page_limit" || paginationPlan.status === "near_limit"
        ? "当前接近单页上限，请在打印预览中再次确认。"
        : "可保存为文本可复制的 PDF。" });
      setPdfExportState({
        status: "success",
        filename: fileName,
        message: "已打开浏览器打印 fallback。"
      });
    } catch (error) {
      notify({ type: "error", title: "导出失败", message: error instanceof RevisionConflictError
        ? "简历版本已变化，请刷新后重试。"
        : "简历可能不可导出、引用失效或导出记录写入失败。" });
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
        exceededPageLimit: input.paginationPlan.actualPageCount > input.paginationPlan.maximumPageCount,
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

  function replaceBranch(branch: ResumeBranch, options: { preserveDrafts?: boolean; select?: boolean } = {}) {
    const nextBranches = branchesRef.current.some((item) => item.id === branch.id)
      ? branchesRef.current.map((item) => item.id === branch.id ? branch : item)
      : [branch, ...branchesRef.current];
    branchesRef.current = nextBranches;
    setBranches(nextBranches);
    if (options.select !== false) setSelectedBranchId(branch.id);
    if (!options.preserveDrafts) {
      editTextsRef.current = {};
      setEditTexts({});
      clearStudioEditor();
      setContentAutoSaveState("idle");
    }
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

  const showManualFormattingPanel = studioMode === "style"
    && isStylePanelOpen
    && (styleInspectorTab === "colors"
      || styleInspectorTab === "font"
      || styleInspectorTab === "page");
  const showDocumentStyleControls = styleInspectorTab === "colors"
    || styleInspectorTab === "font"
    || styleInspectorTab === "page";
  const showSectionStyleControls = false;
  const showBlockStyleControls = false;

  const sectionNavContext: SectionNavContext = {
    activeSection: activeResumeSection,
    onNavigate: (section) => {
      const item = resumeSectionNavItems.find((i) => i.key === section);
      if (item?.firstItemId) {
        selectStudioItem(item.firstItemId);
      } else {
        clearStudioEditor();
      }
      setActiveResumeSection(section);
    },
    canUndo: Boolean(presentationHistory.undoStack.length),
    canRedo: Boolean(presentationHistory.redoStack.length),
    onUndo: undo,
    onRedo: () => { void redoPresentationChange(); }
  };

  return (
    <main className={`page-shell resume-workspace ${selectedBranch ? "resume-workspace-studio" : "resume-workspace-center"}`}>
      {!selectedBranch ? (
        <ProductTopbar
          title="我的简历"
          status={`${activeBranches.length} 份当前简历`}
          actions={(
            <>
              <ProductButton onClick={(event) => openImportDialog("file", event.currentTarget)}>导入</ProductButton>
              <ProductButton variant="primary" disabled={!profile} onClick={() => { void createGeneralResume({ fromProfile: false }); }}>
                <Plus aria-hidden="true" /> 新建简历
              </ProductButton>
            </>
          )}
        />
      ) : null}

      {workspace.status === "empty" && !profile ? <WorkspaceEmptyState /> : null}

      {!selectedBranch ? (
        <>
          {profile && workspace.status === "ready" ? (
            <section className="panel profile-person-toolbar resume-person-toolbar no-print" aria-label="简历使用的人物">
              <div>
                <strong>简历使用的人物</strong>
                <span>创建和管理操作只显示当前人物的简历。</span>
              </div>
              <label className="field-input-group profile-person-selector">
                <span className="field-input-label">选择人物</span>
                <select data-testid="resume-profile-selector" value={profile.id} onChange={(event) => { void selectResumeProfile(event.target.value); }}>
                  {profileOverride && !workspace.profiles.some((item) => item.id === profileOverride.id) ? (
                    <option value={profileOverride.id}>{profileOverride.name}</option>
                  ) : null}
                  {workspace.profiles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  <option value="__new_profile__">＋ 新增人物</option>
                </select>
              </label>
              {isProfileCreateMenuOpen ? (
                <div
                  className="profile-create-popover-backdrop no-print"
                  onMouseDown={(event) => {
                    if (event.target === event.currentTarget) closeProfileCreateDialog();
                  }}
                >
                  <div
                    className="profile-create-popover"
                    role="dialog"
                    aria-label="新增人物"
                    ref={profileCreateDialogRef as React.RefObject<HTMLDivElement>}
                    tabIndex={-1}
                    onKeyDown={handleProfileCreateDialogKeyDown}
                  >
                    <h3 className="profile-create-popover-title">新增人物</h3>
                    <label className="profile-create-popover-field">
                      <span>人物名称</span>
                      <input
                        value={quickProfileName}
                        onChange={(event) => setQuickProfileName(event.target.value)}
                        placeholder="例如：张三、产品经理方向"
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void createBlankProfile();
                          }
                        }}
                      />
                    </label>
                    <div className="profile-create-popover-actions">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => { void createBlankProfile(); }}
                      >
                        创建空白人物
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={(event) => {
                          closeProfileCreateDialog();
                          openImportDialog("file", event.currentTarget, true);
                        }}
                      >
                        从简历导入
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={closeProfileCreateDialog}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          <section className="resume-import-strip no-print" data-testid="resume-import-strip">
            <div className="resume-import-strip-copy">
              <h2>导入已有简历</h2>
              <p>支持文本 PDF、DOCX 和 JSON；解析后先核对。扫描件识别仍为实验功能。</p>
            </div>
            <div className="resume-import-strip-actions">
              <button
                className="primary-button"
                data-testid="resume-entry-import-primary"
                type="button"
                onClick={(event) => openImportDialog("file", event.currentTarget)}
              >
                选择或拖放文件
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={(event) => openImportDialog("json", event.currentTarget)}
              >
                粘贴 JSON
              </button>
            </div>
          </section>

          <section className="resume-entry-grid no-print">
            <article className="panel resume-create-panel">
              <div className="section-heading compact-heading">
                <div>
                  <h2>快速创建</h2>
                  <p>只显示可安全落地的入口，低频配置按需展开。</p>
                </div>
              </div>
              <div className="resume-create-card-grid">
                <button className="resume-create-card" type="button" onClick={(event) => openImportDialog("file", event.currentTarget)}>
                  <strong>导入已有简历</strong>
                  <span>核对来源后创建通用简历</span>
                </button>
                <button
                  className="resume-create-card"
                  type="button"
                  disabled={draftOptions.length === 0}
                  onClick={() => {
                    setIsJobCreatePanelDismissed(false);
                    setIsJobCreatePanelOpen((current) => !current);
                  }}
                >
                  <strong>根据岗位创建</strong>
                  <span>{draftOptions.length > 0 ? `${draftOptions.length} 个可用草稿` : "需要先在岗位工作区生成草稿"}</span>
                </button>
                <button className="resume-create-card" type="button" disabled={!profile} onClick={() => { void createGeneralResume({ fromProfile: true }); }}>
                  <strong>从个人资料库创建</strong>
                  <span>复制已确认信息，之后由你决定是否再次同步</span>
                </button>
                <button className="resume-create-card" type="button" disabled={!profile} onClick={() => { void createGeneralResume({ fromProfile: false }); }}>
                  <strong>从零创建</strong>
                  <span>不带入资料库内容，从空白字段开始</span>
                </button>
              </div>
              {showJobCreatePanel ? (
                <div className="resume-create-inline-panel" data-testid="resume-job-create-panel">
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
                      <div className="action-row">
                        <button className="primary-button compact" data-testid="create-job-resume" onClick={createBranch}>创建岗位简历</button>
                        <button
                          className="secondary-button compact"
                          type="button"
                          onClick={() => {
                            setIsJobCreatePanelOpen(false);
                            setIsJobCreatePanelDismissed(true);
                          }}
                        >
                          收起
                        </button>
                      </div>
                    </>
                  ) : (
                    <p>暂无岗位建议草稿。请先在岗位工作区完成经历匹配和建议生成。</p>
                  )}
                </div>
              ) : null}
            </article>

            <article className="panel resume-library-panel">
              <div className="section-heading compact-heading">
                <div>
                  <h2>简历中心</h2>
                  <p>{activeBranches.length} 份当前简历 / {archivedBranches.length} 份已归档 / {trashedBranches.length} 份在回收站</p>
                </div>
              </div>
              <div className="resume-filter-row" role="tablist" aria-label="简历筛选">
                {resumeListFilters.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    className={resumeListFilter === filter.key ? "secondary-button compact filter-active" : "secondary-button compact"}
                    onClick={() => setResumeListFilter(filter.key)}
                  >
                    {filter.label} {filter.count}
                  </button>
                ))}
              </div>
              {visibleBranches.length > 0 ? (
                <div className="branch-list resume-card-list">
                  {visibleBranches.map((branch) => {
                    const branchEditable = canEditBranch(branch);
                    const branchJob = branch.jobId ? localJobs.find((job) => job.id === branch.jobId) : undefined;
                    const branchTargetRole = profile ? resolveResumeTargetRole({ branch, profile, job: branchJob }) : branch.resumeBasics?.targetRole?.trim();
                    const isRenaming = renamingBranchId === branch.id;
                    return (
                      <article
                        key={branch.id}
                        className={`match-row resume-card ${branch.id === activeBranchId ? "match-row-active" : ""}`}
                      >
                        <div
                          className="resume-card-main"
                          role={isRenaming ? undefined : "button"}
                          tabIndex={!isRenaming && branchEditable ? 0 : undefined}
                          aria-disabled={!isRenaming && !branchEditable ? "true" : undefined}
                          onClick={(event) => {
                            if ((event.target as Element).closest(".resume-card-rename-editor")) return;
                            if (!isRenaming && branchEditable) openResumeBranch(branch.id);
                          }}
                          onKeyDown={(event) => {
                            if ((event.target as Element).closest(".resume-card-rename-editor")) return;
                            if (!isRenaming && branchEditable && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              openResumeBranch(branch.id);
                            }
                          }}
                        >
                          {isRenaming ? (
                            <span className="resume-card-rename-editor" onClick={(event) => event.stopPropagation()}>
                              <input
                                autoFocus
                                aria-label="简历名称"
                                data-testid={`resume-rename-input-${branch.id}`}
                                maxLength={120}
                                value={renameBranchDraft}
                                disabled={renameBranchPending}
                                onChange={(event) => {
                                  setRenameBranchDraft(event.target.value);
                                  setRenameBranchError(undefined);
                                }}
                                onBlur={() => { void renameBranch(branch, renameBranchDraft); }}
                                onKeyDown={(event) => {
                                  event.stopPropagation();
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  } else if (event.key === "Escape") {
                                    event.preventDefault();
                                    setRenamingBranchId(undefined);
                                    setRenameBranchError(undefined);
                                  }
                                }}
                              />
                              {renameBranchError ? <small role="alert">{renameBranchError}</small> : null}
                            </span>
                          ) : (
                            <strong className="resume-card-title">
                              {branch.name}
                              {branchTargetRole ? <span className="resume-card-target-role">（{branchTargetRole}）</span> : null}
                            </strong>
                          )}
                          <span>{branchPurposeLabel(branch.branchPurpose)} / {branchStatusLabel(branch)} / {syncStatusLabel(branch.syncStatusCache.status)}</span>
                          <small>更新于 {formatLocalDateTime(branch.updatedAt)}</small>
                        </div>
                        <div className="resume-card-actions">
                          {branch.lifecycleStatus === "active" ? (
                            <>
                              <button
                                className="secondary-button compact resume-card-rename-button"
                                type="button"
                                aria-label="重命名简历"
                                disabled={!branchEditable || renameBranchPending}
                                onClick={() => {
                                  setRenamingBranchId(branch.id);
                                  setRenameBranchDraft(branch.name);
                                  setRenameBranchError(undefined);
                                }}
                              ><Pencil aria-hidden="true" size={15} /></button>
                              <button className="primary-button compact" type="button" disabled={!branchEditable} onClick={() => openResumeBranch(branch.id)}>打开</button>
                              <button className="secondary-button compact" type="button" disabled={!branchEditable} onClick={() => {
                                openResumeBranch(branch.id);
                                setStudioMode("style");
                                setStyleInspectorTab("page");
                                notify({ type: "info", title: "已打开", message: "可在右上角导出 PDF。" });
                              }}>导出</button>
                              <details className="resume-card-more">
                                <summary className="secondary-button compact">更多</summary>
                                <div className="resume-card-more-popover">
                                  <button type="button" disabled={!branchEditable} onClick={() => {
                                    openResumeBranch(branch.id);
                                    setStudioMode("style");
                                    setStyleInspectorTab("page");
                                  }}>历史与页面</button>
                                  <button type="button" disabled={!canManageBranch(branch)} onClick={() => { void archiveBranch(branch); }}>归档</button>
                                </div>
                              </details>
                            </>
                          ) : branch.lifecycleStatus === "archived" ? (
                            <>
                              <button className="primary-button compact" type="button" onClick={() => { void restoreArchivedBranch(branch); }}>恢复</button>
                              <button className="secondary-button compact" type="button" onClick={() => { void moveArchivedBranchToTrash(branch); }}>移至回收站</button>
                            </>
                          ) : (
                            <>
                              <button className="secondary-button compact" type="button" onClick={() => { void restoreBranchFromTrash(branch); }}>恢复到归档</button>
                              <button className="danger-button compact" type="button" onClick={() => {
                                setPendingPermanentDeleteBranch(branch);
                                setPermanentDeleteName("");
                              }}>永久删除</button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="resume-card-empty">当前筛选下暂无简历。可以先导入已有简历，或在岗位工作区生成岗位建议草稿后创建。</p>
              )}
            </article>
          </section>
        </>
      ) : null}

      {selectedBranch ? (
        <section className="resume-studio-workbar no-print" data-testid="resume-studio-workbar">
          <div className="branch-list resume-compat-branch-list" aria-hidden="true">
            {activeBranches.map((branch) => (
              <button
                key={branch.id}
                className={branch.id === activeBranchId ? "match-row match-row-active" : "match-row"}
                type="button"
                tabIndex={-1}
                onClick={() => openResumeBranch(branch.id)}
              >
                {branch.name}
              </button>
            ))}
          </div>
          {draftOptions.length > 0 ? (
            <article className="panel resume-compat-job-create" aria-hidden="true">
              <select data-testid="job-suggestion-draft-select" value={activeDraftId} onChange={(event) => setSelectedDraftId(event.target.value)}>
                {draftOptions.map((option) => (
                  <option key={option.draft.id} value={option.draft.id}>{option.label}</option>
                ))}
              </select>
              <input data-testid="new-resume-branch-name" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
              <button className="primary-button compact" data-testid="create-job-resume" type="button" onClick={createBranch}>创建岗位简历</button>
            </article>
          ) : null}
          <div className="resume-studio-title-cluster">
            <button className="secondary-button compact" type="button" onClick={() => setSelectedBranchId(BRANCH_LIST_SENTINEL)}>
              返回
            </button>
            <div>
              <span className="resume-workbar-label">{branchPurposeLabel(selectedBranch.branchPurpose)} / {branchStatusLabel(selectedBranch)}</span>
              <h2>{selectedBranch.name}</h2>
              <span
                className={`resume-autosave-status resume-autosave-status-${contentAutoSaveState}`}
                data-testid="resume-autosave-status"
                aria-live="polite"
              >
                {CONTENT_AUTO_SAVE_LABELS[contentAutoSaveState]}
              </span>
            </div>
          </div>

          <nav className="resume-mode-rail no-print" aria-label="编辑模式">
            <button type="button" className={studioMode === "edit" ? "mode-rail-button mode-rail-button-active" : "mode-rail-button"} onClick={() => setStudioMode("edit")} title="编辑">
              <span>编辑</span>
            </button>
            <button type="button" className={studioMode === "ai" ? "mode-rail-button mode-rail-button-active" : "mode-rail-button"} onClick={() => setStudioMode("ai")} title="AI岗位优化">
              <span>AI优化</span>
            </button>
            <button type="button" className={studioMode === "style" ? "mode-rail-button mode-rail-button-active" : "mode-rail-button"} onClick={() => {
              setStudioMode("style");
              setActivePropertyTab("document");
            }} title="样式">
              <span>样式</span>
            </button>
          </nav>

          <div className="resume-studio-toolbar" aria-label="简历工作栏">
            <div className="resume-workbar-actions">
              <button
                type="button"
                className="secondary-button compact"
                data-testid="open-resume-import"
                onClick={(event) => openImportDialog("file", event.currentTarget)}
              >
                导入
              </button>
              <button
                type="button"
                className="secondary-button compact"
                onClick={() => { void openProfileSyncDialog(); }}
                disabled={profileFieldPending}
              >
                {profileFieldPending ? "处理中…" : "从资料库同步"}
              </button>
              {workbarWarnings.length > 0 ? (
                <details className="resume-review-chip">
                  <summary>{workbarWarnings.length} 条需复核</summary>
                  <div className="toolbar-more-popover">
                    {workbarWarnings.map((warning) => <span key={warning}>{warning}</span>)}
                    <button
                      type="button"
                      className="primary-button compact"
                      onClick={() => { void refreshSync(); }}
                    >
                      重新检查
                    </button>
                  </div>
                </details>
              ) : null}
              <button className="secondary-button compact" onClick={undo} disabled={!selectedBranchEditable}>撤销</button>
              <button className="secondary-button compact" disabled={!presentationHistory.redoStack.length || !presentationConfig} onClick={() => { void redoPresentationChange(); }}>重做</button>
              {selectedBranch.branchPurpose === "job_specific" ? (
                <button type="button" className="secondary-button compact" data-testid="open-or-create-application" onClick={openOrCreateApplication} disabled={!selectedBranchEditable}>
                  加入求职进度
                </button>
              ) : null}
              <button
                className="primary-button compact"
                onClick={downloadPdf}
                disabled={!renderModel || renderModel.safety.visibleItemCount === 0 || !presentationConfig || isPdfExportBusy || pagination.blocked || pagination.status === "measuring"}
                title="下载 PDF"
              >
                {isPdfExportBusy ? "生成中" : "导出PDF"}
              </button>
            <details className="toolbar-more">
              <summary className="secondary-button compact">更多</summary>
              <div className="toolbar-more-popover">
                <button type="button" onClick={refreshSync}>重新检查</button>
                <button type="button" onClick={downloadStructuredJson} disabled={!renderModel}>导出 JSON</button>
                <button type="button" onClick={exportPdf} disabled={!renderModel || renderModel.safety.visibleItemCount === 0 || isPdfExportBusy}>打印 / 保存 PDF</button>
                <label className="inline-toggle studio-edit-toggle">
                  <input
                    type="checkbox"
                    data-testid="canvas-edit-toggle"
                    aria-label="画布编辑"
                    checked={isStudioEditMode}
                    disabled={!renderModel || !resumeDocument?.editable}
                    onChange={(event) => setIsStudioEditMode(event.target.checked)}
                  />
                  画布直接编辑
                </label>
                <button type="button" onClick={() => notify({ type: "info", title: "版本记录", message: `当前简历共有 ${revisions.length} 个版本记录。` })}>查看历史</button>
                <button type="button" onClick={() => { void undoPresentationChange(); }} disabled={!presentationHistory.undoStack.length || !presentationConfig}>回退展示</button>
                <button type="button" onClick={() => { void redoPresentationChange(); }} disabled={!presentationHistory.redoStack.length || !presentationConfig}>重做展示</button>
                <button type="button" onClick={() => { void archiveBranch(selectedBranch); }} disabled={!canManageBranch(selectedBranch)}>归档</button>
                {revisions.slice(0, 3).map((revision) => (
                  <button
                    key={revision.id}
                    type="button"
                    disabled={!selectedBranchEditable || revision.id === selectedBranch.currentRevisionId}
                    onClick={() => { void restoreRevision(revision.id); }}
                  >
                    恢复版本 {revision.revisionNumber + 1} · {revisionSourceLabel(revision.source)}
                  </button>
                ))}
              </div>
            </details>
            </div>
          </div>
          {selectedBranch.branchPurpose === "job_specific" ? (
            <div className="resume-job-context-bar" data-testid="resume-job-context">
              <div><span>当前岗位</span><strong>{selectedBranchJob?.title ?? "岗位引用失效"}</strong></div>
              <div><span>公司</span><strong>{selectedBranchJob?.company ?? "—"}</strong></div>
              <div><span>来源通用简历</span><strong>{selectedSourceBranch?.name ?? "来源引用失效"}</strong></div>
              <div><span>匹配更新时间</span><strong>{jobContextSummary.matchUpdatedAt ? formatLocalDateTime(jobContextSummary.matchUpdatedAt) : "未找到有效匹配"}</strong></div>
              <div><span>待处理建议</span><strong>{jobContextSummary.suggestionCount}</strong></div>
              <div><span>当前风险</span><strong>{riskLevelUiLabel(jobContextSummary.risk)}</strong></div>
              <div className="resume-job-context-actions">
                <button className="secondary-button compact" type="button" onClick={() => router.push(`/jobs?jobId=${encodeURIComponent(selectedBranch.jobId ?? "")}`)}>返回岗位</button>
                <button className="primary-button compact" type="button" onClick={() => { setStudioMode("ai"); setAiInspectorTab("suggestions"); }}>AI 优化</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isImportPanelOpen ? (
        <div
          className="resume-import-modal-backdrop no-print"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeImportDialog();
            }
          }}
        >
          <section
            ref={importDialogRef}
            className="resume-import-modal"
            data-testid="resume-import-dock"
            role="dialog"
            aria-modal="true"
            aria-labelledby="resume-import-modal-title"
            tabIndex={-1}
            onKeyDown={handleImportDialogKeyDown}
          >
            <header className="resume-import-modal-header">
              <div>
                <h2 id="resume-import-modal-title">{selectedBranch ? "导入另一份简历" : "导入简历"}</h2>
                <p>PDF、DOCX 或 JSON；解析后先核对，不会覆盖当前简历。</p>
              </div>
              <button className="resume-import-modal-close" type="button" aria-label="关闭导入窗口" onClick={closeImportDialog}>
                ×
              </button>
            </header>
            <div className="resume-import-modal-body">
              <ResumeImportWizard
                key={importEntryMode}
                repository={repository}
                profile={profile}
                profiles={workspace.status === "ready" ? workspace.profiles : profile ? [profile] : []}
                initialTargetMode={importCreatesNewProfile ? "new" : "existing"}
                initialMode={importEntryMode}
                onImported={handleImportedResumeReady}
              />
            </div>
          </section>
        </div>
      ) : null}

      {selectedBranch ? (
        <section
          className={`resume-preview-layout resume-studio-shell resume-studio-shell-${studioMode}`}
          data-testid="resume-studio-shell"
          style={studioLayoutStyle}
        >
          {studioMode === "edit" ? (
            <aside
              className={`panel no-print resume-section-nav-panel ${studioLayout.sectionNavCollapsed ? "resume-section-nav-panel-collapsed" : ""}`}
              data-testid="resume-section-nav"
              aria-label="简历栏目导航"
            >
              <button
                className="section-nav-collapse-toggle"
                type="button"
                aria-label={studioLayout.sectionNavCollapsed ? "展开栏目导航" : "收起栏目导航"}
                onClick={() => setStudioLayout((current) => ({ ...current, sectionNavCollapsed: !current.sectionNavCollapsed }))}
                title={studioLayout.sectionNavCollapsed ? "展开栏目导航" : "收起栏目导航"}
              >
                {studioLayout.sectionNavCollapsed ? (
                  <PanelLeftOpen size={18} strokeWidth={1.5} />
                ) : (
                  <PanelLeftClose size={18} strokeWidth={1.5} />
                )}
              </button>
              <nav className="resume-section-nav">
                {resumeSectionNavItems.map((item) => (
                  <button
                    key={item.key}
                    ref={item.key === "add" ? sectionMenuButtonRef : undefined}
                    type="button"
                    className={activeSectionItem?.key === item.key ? "resume-section-nav-button resume-section-nav-button-active" : "resume-section-nav-button"}
                    onClick={() => {
                      if (item.key === "add") {
                        setIsSectionMenuOpen((current) => !current);
                        return;
                      }
                      if (item.firstItemId) {
                        selectStudioItem(item.firstItemId);
                      } else {
                        clearStudioEditor();
                      }
                      setActiveResumeSection(item.key);
                    }}
                    aria-expanded={item.key === "add" ? isSectionMenuOpen : undefined}
                    aria-controls={item.key === "add" ? "resume-add-section-menu" : undefined}
                    aria-current={activeSectionItem?.key === item.key ? "page" : undefined}
                    aria-label={sectionNavAccessibleLabel(item.key, item.label)}
                    title={studioLayout.sectionNavCollapsed ? item.label : undefined}
                  >
                    {studioLayout.sectionNavCollapsed ? (
                      <span className="section-nav-icon">{sectionNavIcon(item.key)}</span>
                    ) : (
                      <>
                        <span className="section-nav-label">
                          {splitSectionNavLabel(item.label).map((line) => <span key={line}>{line}</span>)}
                        </span>
                        {item.count > 0 ? <strong>{item.count}</strong> : null}
                      </>
                    )}
                  </button>
                ))}
              </nav>
              {isSectionMenuOpen && selectedBranch ? (
                <div
                  id="resume-add-section-menu"
                  ref={sectionMenuRef}
                  className="resume-add-section-menu"
                  role="dialog"
                  aria-label="添加或管理简历栏目"
                >
                  <div className="resume-add-section-menu-heading">
                    <strong>添加栏目</strong>
                    <button type="button" className="secondary-button compact" aria-label="关闭添加栏目" onClick={() => { setIsSectionMenuOpen(false); sectionMenuButtonRef.current?.focus(); }}>×</button>
                  </div>
                  <div className="resume-add-section-options">
                    {OPTIONAL_STUDIO_SECTIONS.map((section) => {
                      const navItem = resumeSectionNavItems.find((item) => item.key === section.key);
                      const enabled = Boolean(navItem);
                      return (
                        <button
                          key={section.key}
                          type="button"
                          className="resume-add-section-option"
                          aria-pressed={enabled}
                          onClick={() => toggleStudioSection(section.key)}
                        >
                          <span>{enabled ? "✓" : "+"} {section.label}</span>
                          <small>{enabled ? `${navItem?.count ?? 0} 条` : "添加"}</small>
                        </button>
                      );
                    })}
                  </div>
                  <label className="field-label" htmlFor="custom-section-title">
                    自定义栏目
                    <input
                      id="custom-section-title"
                      value={customSectionTitle}
                      maxLength={40}
                      aria-invalid={Boolean(customSectionError)}
                      aria-describedby={customSectionError ? "custom-section-error" : undefined}
                      onChange={(event) => { setCustomSectionTitle(event.target.value); setCustomSectionError(undefined); }}
                      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomStudioSection(); } }}
                      placeholder="例如：开源贡献"
                    />
                  </label>
                  {customSectionError ? <p id="custom-section-error" className="field-error" role="alert">{customSectionError}</p> : null}
                  <button type="button" className="primary-button compact" onClick={addCustomStudioSection}>创建自定义栏目</button>
                </div>
              ) : null}
            </aside>
          ) : null}
          <aside className={`panel no-print resume-export-panel resume-inspector ${studioMode === "edit" ? "branch-editor" : ""}`} data-testid="resume-active-section-fields">
            {studioMode !== "edit" ? <div className="property-panel-heading">
              <div>
                {studioMode === "style" ? <h2>样式</h2> : null}
                {studioMode === "style" ? <p>模板、颜色、文字和分页集中调整。</p> : null}
              </div>
              {studioMode === "style" ? (
                <div className="panel-heading-actions">
                  <button
                    className="secondary-button compact"
                    onClick={() => setIsStylePanelOpen((current) => !current)}
                  >
                    {isStylePanelOpen ? "收起" : "展开"}
                  </button>
                </div>
              ) : null}
            </div> : null}
            {studioMode === "ai" ? null : studioMode === "style" ? (
              <div className="inspector-tablist" role="tablist" aria-label="样式工具">
                {(["template", "colors", "font", "page"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={styleInspectorTab === tab}
                    className={styleInspectorTab === tab ? "inspector-tab inspector-tab-active" : "inspector-tab"}
                    onClick={() => setStyleInspectorTab(tab)}
                  >
                    {styleInspectorTabLabel(tab)}
                  </button>
                ))}
              </div>
            ) : null}
            {studioMode === "edit" ? (
              activeResumeSection === "basics" ? (
                <BasicsSectionPage
                  profile={profile}
                  branch={selectedBranch}
                  branchEditable={selectedBranchEditable}
                  profileFieldError={profileFieldError}
                  onSaveProfileField={saveProfileFieldText}
                  onSaveBranchBasicsField={(_field, value) => { void saveProfileFieldText("branch:targetRole", value); }}
                  nav={sectionNavContext}
                />
              ) : activeResumeSection === "summary" ? (
                <SummarySectionPage
                  blocks={activeSectionBlocks}
                  profile={profile}
                  branch={selectedBranch}
                  editTexts={editTexts}
                  onEditTextChange={(itemId, text) => setEditTexts((prev) => ({ ...prev, [itemId]: text }))}
                  onSave={saveItem}
                  onAdd={(text) => void addContentItem(activeResumeSection, text)}
                  onSetPresentationVisibility={(itemId, visible) => { void setPresentationItemVisibility(itemId, visible); }}
                  onDelete={(itemId) => { void setContentItemVisibility(itemId, false); }}
                  onSyncToProfile={(itemId) => { void syncContentItemToProfile(itemId); }}
                  nav={sectionNavContext}
                />
              ) : activeResumeSection === "work"
                || activeResumeSection === "internship"
                || activeResumeSection === "education"
                || activeResumeSection === "project"
                || activeResumeSection === "campus" ? (
                <ExperienceSectionPage
                  sectionLabel={activeSectionItem?.label ?? "经历"}
                  blocks={activeSectionBlocks}
                  branch={selectedBranch}
                  structuredItems={activeStructuredItems}
                  editTexts={editTexts}
                  selectedItemId={selectedStudioItemId}
                  onEditTextChange={(itemId, text) => setEditTexts((prev) => ({ ...prev, [itemId]: text }))}
                  onSave={saveItem}
                  onSaveStructuredItem={saveStructuredItem}
                  onSelectItem={selectStudioItem}
                  onSetPresentationVisibility={(itemId, visible) => { void setPresentationItemVisibility(itemId, visible); }}
                  onDelete={(itemId) => { void setContentItemVisibility(itemId, false); }}
                  onDuplicate={(itemId) => void duplicateContentItem(itemId)}
                  onMoveUp={(itemId) => void movePresentationItem(itemId, "up")}
                  onMoveDown={(itemId) => void movePresentationItem(itemId, "down")}
                  onAdd={(draft, syncToProfile) => void addContentItem(activeResumeSection, draft, syncToProfile)}
                  onSyncToProfile={(itemId) => { void syncContentItemToProfile(itemId); }}
                  onOpenLibrary={() => setProfileLibraryOpen(true)}
                  nav={sectionNavContext}
                />
              ) : activeResumeSection.startsWith("custom:") ? (
                <SkillsSectionPage
                  sectionLabel={activeSectionItem?.label ?? "内容"}
                  blocks={activeSectionBlocks}
                  editTexts={editTexts}
                  selectedItemId={selectedStudioItemId}
                  onEditTextChange={(itemId, text) => setEditTexts((prev) => ({ ...prev, [itemId]: text }))}
                  onSave={saveItem}
                  onSetPresentationVisibility={(itemId, visible) => { void setPresentationItemVisibility(itemId, visible); }}
                  onDelete={(itemId) => { void setContentItemVisibility(itemId, false); }}
                  onDuplicate={(itemId) => void duplicateContentItem(itemId)}
                  onMoveUp={(itemId) => void movePresentationItem(itemId, "up")}
                  onMoveDown={(itemId) => void movePresentationItem(itemId, "down")}
                  onAdd={(text) => void addContentItem(activeResumeSection, text)}
                  onOpenLibrary={() => setProfileLibraryOpen(true)}
                  nav={sectionNavContext}
                />
              ) : (
                <CanonicalSectionPage
                  sectionType={activeResumeSection as Exclude<ResumeSectionTypeV2, "basics">}
                  sectionLabel={activeSectionItem?.label ?? "内容"}
                  items={activeStructuredItems}
                  selectedItemId={selectedStudioItemId}
                  onSave={saveStructuredItem}
                  onSetPresentationVisibility={(itemId, visible) => { void setPresentationItemVisibility(itemId, visible); }}
                  onDelete={(itemId) => { void setContentItemVisibility(itemId, false); }}
                  onDuplicate={(itemId) => void duplicateContentItem(itemId)}
                  onMoveUp={(itemId) => void movePresentationItem(itemId, "up")}
                  onMoveDown={(itemId) => void movePresentationItem(itemId, "down")}
                  onOpenLibrary={() => setProfileLibraryOpen(true)}
                  nav={sectionNavContext}
                />
              )
            ) : null}
            {studioMode === "style" ? (
              <>
                {styleInspectorTab === "template" ? (
                  <>
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
                    onClick={() => {
                      setStyleInspectorTab("template");
                      setIsTemplateCenterOpen((current) => !current);
                    }}
                  >
                    模板中心
                  </button>
                </div>
                  </>
                ) : null}
                <TemplateCenter
                  open={styleInspectorTab === "template" && isTemplateCenterOpen}
                  model={renderModel}
                  presentationConfig={presentationConfig}
                  currentTemplateId={effectiveTemplateId}
                  canApply={selectedBranchEditable && Boolean(presentationConfig) && !pendingTemplateApplyId}
                  pendingTemplateId={pendingTemplateApplyId}
                  onApply={(nextTemplateId) => { void updatePresentationTemplate(nextTemplateId); }}
                  onClose={() => setIsTemplateCenterOpen(false)}
                />
                {showManualFormattingPanel ? (
                  <div className="property-panel-body" data-testid="resume-property-panel">
                {showDocumentStyleControls ? (
                  <div className="property-section" data-testid="document-style-panel">
                    {styleInspectorTab === "colors" ? (
                      <>
                        {([
                          ["主色", "primaryColor"],
                          ["强调色", "accentColor"],
                          ["分隔线颜色", "dividerColor"]
                        ] as const).map(([label, key]) => (
                          <div className="field-label" key={key}>
                            {label}
                            <div className="color-swatch-row">
                              {(["graphite", "emerald", "blue", "rose"] as const).map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  className={`color-swatch ${presentationConfig?.theme[key] === color ? "color-swatch-active" : ""}`}
                                  style={{ backgroundColor: accentSwatchColor(color) }}
                                  aria-label={`${label}：${accentColorLabel(color)}`}
                                  aria-pressed={presentationConfig?.theme[key] === color}
                                  disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsAccentColor}
                                  onClick={() => {
                                    void updatePresentationStyle((current) => ({
                                      theme: { ...current.theme, [key]: color }
                                    }), `${label}已保存。`);
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        ))}
                        <button className="secondary-button compact" disabled={!presentationConfig || !selectedBranchEditable} onClick={() => { void resetTemplateStyle(); }}>
                          恢复默认
                        </button>
                      </>
                    ) : null}

                    {styleInspectorTab === "font" ? (
                      <div className="property-control-grid">
                        <label className="field-label">中文字体
                          <select aria-label="中文字体" value={presentationConfig?.typography.chineseFont ?? "system_sans"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            const chineseFont = event.target.value as ResumePresentationConfig["typography"]["chineseFont"];
                            void updatePresentationStyle((current) => ({ typography: { ...current.typography, chineseFont } }), "中文字体已保存。");
                          }}>
                            <option value="system_sans">系统黑体</option>
                            <option value="source_han_sans">思源黑体</option>
                            <option value="source_han_serif">思源宋体</option>
                          </select>
                        </label>
                        <label className="field-label">英文字体
                          <select aria-label="英文字体" value={presentationConfig?.typography.englishFont ?? "system_sans"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            const englishFont = event.target.value as ResumePresentationConfig["typography"]["englishFont"];
                            void updatePresentationStyle((current) => ({ typography: { ...current.typography, englishFont } }), "英文字体已保存。");
                          }}>
                            <option value="system_sans">System Sans</option>
                            <option value="arial">Arial</option>
                            <option value="georgia">Georgia</option>
                          </select>
                        </label>
                        {([
                          ["正文字号", "bodyTextScale", scaleLabel],
                          ["标题字号", "titleTextScale", scaleLabel],
                          ["行距", "lineHeight", spacingLabel]
                        ] as const).map(([label, key, format]) => (
                          <label className="field-label" key={key}>{label}
                            <select aria-label={label} value={presentationConfig?.typography[key] ?? "normal"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                              const value = event.target.value;
                              void updatePresentationStyle((current) => ({
                                typography: { ...current.typography, [key]: value }
                              }), `${label}已保存。`);
                            }}>
                              {(["small", "normal", "large"] as const)
                                .filter((value) => key !== "lineHeight" || value === "normal")
                                .map((value) => <option key={value} value={value}>{format(value as never)}</option>)}
                              {key === "lineHeight" ? <>
                                <option value="tight">紧凑</option>
                                <option value="relaxed">宽松</option>
                              </> : null}
                            </select>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {styleInspectorTab === "page" ? (
                      <div className="property-control-grid pagination-controls" data-testid="pagination-controls">
                        <div className="preset-buttons-row">
                          <button className="secondary-button compact" type="button" disabled={!presentationConfig || !selectedBranchEditable} onClick={() => { void optimizeForOnePage(); }}>一页优化</button>
                          <button className="secondary-button compact" type="button" disabled={!presentationConfig || !selectedBranchEditable} onClick={() => { void relaxForTwoPages(); }}>两页舒展</button>
                          <button className="secondary-button compact" type="button" disabled={!presentationConfig || !selectedBranchEditable} onClick={() => { void resetTemplateStyle(); }}>恢复默认</button>
                        </div>
                        <label className="field-label">页边距
                          <select aria-label="页边距" value={presentationConfig?.spacing.pageMargin ?? "normal"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            const pageMargin = event.target.value as ResumePresentationConfig["spacing"]["pageMargin"];
                            void updatePresentationStyle((current) => ({ spacing: { ...current.spacing, pageMargin } }), "页边距已保存。");
                          }}>
                            <option value="narrow">窄</option><option value="normal">标准</option><option value="wide">宽</option>
                          </select>
                        </label>
                        <label className="field-label">模块间距
                          <select aria-label="模块间距" value={presentationConfig?.spacing.sectionGap ?? "normal"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            const sectionGap = event.target.value as ResumePresentationConfig["spacing"]["sectionGap"];
                            void updatePresentationStyle((current) => ({ spacing: { ...current.spacing, sectionGap } }), "模块间距已保存。");
                          }}>
                            {(["tight", "normal", "relaxed"] as const).map((value) => <option key={value} value={value}>{spacingLabel(value)}</option>)}
                          </select>
                        </label>
                        <label className="field-label">建议页数
                          <select aria-label="建议页数" value={presentationConfig?.pagination.preferredPageCount ?? 2} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            void updatePaginationSettings({ preferredPageCount: Number(event.target.value) as 1 | 2 }, "建议页数已保存。");
                          }}>
                            <option value={1}>1 页</option><option value={2}>2 页</option>
                          </select>
                        </label>
                        <label className="field-label">最大建议页数
                          <input aria-label="最大建议页数" value="4 页" readOnly />
                        </label>
                        <label className="field-label">页眉页脚
                          <select aria-label="页眉页脚" value={presentationConfig?.pagination.headerFooter ?? "none"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            void updatePaginationSettings({ headerFooter: event.target.value as "none" | "page_number" }, "页眉页脚已保存。");
                          }}>
                            <option value="none">不显示</option><option value="page_number">显示页码</option>
                          </select>
                        </label>
                        <label className="field-label">页面策略
                          <select data-testid="page-policy-selector" aria-label="页面策略" value={presentationConfig?.pagination.pagePolicy ?? "natural"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            void updatePagePolicy(event.target.value as ResumePresentationConfig["pagination"]["pagePolicy"]);
                          }}>
                            <option value="natural">自然分页</option>
                            <option value="prefer_one_page">优先一页</option>
                            <option value="one_page_strict">严格一页</option>
                            <option value="up_to_two_pages">最多两页</option>
                          </select>
                        </label>
                        <label className="field-label">条目头部
                          <select aria-label="条目头部对齐" value={presentationConfig?.itemHeaderMiddleAlignment ?? "balanced"} disabled={!presentationConfig || !selectedBranchEditable} onChange={(event) => {
                            void updateItemHeaderAlignment(event.target.value as ResumePresentationConfig["itemHeaderMiddleAlignment"]);
                          }}>
                            <option value="fixed-column">固定列</option><option value="balanced">均衡</option><option value="flow">紧凑流式</option>
                          </select>
                        </label>
                        <label className="inline-toggle">
                          <input type="checkbox" checked={presentationConfig?.pagination.showPhoto ?? false} disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.capabilities.supportsPhoto} onChange={(event) => {
                            void updatePaginationSettings({ showPhoto: event.target.checked }, "照片显示设置已保存。");
                          }} />
                          显示照片
                        </label>
                        {!selectedTemplate.capabilities.supportsPhoto ? <p className="save-status">当前模板不支持照片。</p> : null}
                        <div className="pagination-summary" data-testid="pagination-summary">
                          <strong>当前：{pagination.plan?.actualPageCount ?? "测量中"} 页</strong>
                          <span>{paginationStatusLabel(pagination.status)}</span>
                          {pagination.plan?.pages.map((page) => <span key={page.pageNumber}>第 {page.pageNumber} 页利用率：{Math.round((page.utilization?.ratio ?? 0) * 100)}%</span>)}
                          {pagination.plan?.issues?.map((issue) => <span className="save-status save-status-failed" key={issue}>{paginationIssueLabel(issue)}</span>)}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {showSectionStyleControls && activePropertyTab === "section" && selectedStudioSection && selectedStudioBlock ? (
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
                    {selectedStudioSection.type === firstVisibleSectionType ? (
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

                {showBlockStyleControls && activePropertyTab === "block" && selectedStudioBlock ? (
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
                      <button className="secondary-button compact" disabled={!selectedBranchEditable || !selectedStudioBlock.contentVisible} onClick={() => { void duplicateContentItem(selectedStudioBlock.contentItemId); }}>
                        复制
                      </button>
                      <button className="danger-button compact" disabled={!selectedBranchEditable || !selectedStudioBlock.contentVisible} onClick={() => { void setContentItemVisibility(selectedStudioBlock.contentItemId, false); }}>
                        删除
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
                {styleInspectorTab === "page" && presentationHiddenBlocks.length > 0 ? (
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
                {styleInspectorTab === "page" ? (
                <div className={`overflow-status overflow-status-${pagination.status}`} data-testid="overflow-status">
                  <strong>{paginationStatusLabel(pagination.status)}</strong>
                  <span>
                    {pagination.plan
                      ? `实际 ${pagination.plan.actualPageCount} 页 / 上限 ${pagination.plan.requestedMaxPages} 页 / 剩余 ${Math.floor(pagination.plan.measurement.remainingPx)}px`
                      : "正在测量分页"}
                  </span>
                </div>
                ) : null}
                {styleInspectorTab === "page" && renderCoverageReport && renderCoverageHasBlockingFailure(renderCoverageReport) ? (
                  <div className="warning-box" data-testid="render-coverage-warning">检测到栏目或条目在展示、分页或模板渲染阶段丢失或重复，已停止正式导出。请等待预览刷新；若提示持续出现，请保留当前版本并报告问题。</div>
                ) : null}
                {styleInspectorTab === "page" && renderModel?.safety.ruleOnlyItemIds.length ? (
                  <div className="warning-box">该简历包含仅由规则检查通过的内容，工作台已显示校验状态；PDF 正文不会加入内部风险标签。</div>
                ) : null}
                {styleInspectorTab === "page" && (pagination.status === "near_one_page_limit" || pagination.status === "near_limit") ? (
                  <div className="warning-box">当前接近单页上限，建议导出前在打印预览中复核。</div>
                ) : null}
                {styleInspectorTab === "page" && pagination.plan && pagination.plan.actualPageCount > 4 ? (
                  <div className="warning-box">
                    <p>当前简历为 {pagination.plan.actualPageCount} 页，超过建议的 4 页；预览与 PDF 仍会保留全部内容。</p>
                    {reductionHints.length > 0 ? (
                      <ul>
                        {reductionHints.map((hint) => <li key={hint}>{hint}</li>)}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
                {styleInspectorTab === "page" ? (
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
                ) : null}
              </>
            ) : null}
            {renderResult.error ? <p className="save-status save-status-failed">{renderResult.error}</p> : null}
          </aside>

          {studioMode === "ai" ? (
            <FloatingWindow
              title="AI 岗位优化"
              isOpen={aiFloatingOpen}
              onClose={() => setAiFloatingOpen(false)}
              defaultX={100}
              defaultY={80}
              defaultWidth={1000}
              defaultHeight={600}
            >
              <div className="ai-sidebar-layout">
                <nav className="ai-nav-rail" role="tablist" aria-label="AI岗位优化工具">
                  <button
                    type="button"
                    className={aiInspectorTab === "suggestions" ? "ai-nav-btn ai-nav-btn-active" : "ai-nav-btn"}
                    onClick={() => setAiInspectorTab("suggestions")}
                    title="岗位优化"
                  >
                    <span className="ai-nav-label">岗位</span>
                    <span className="ai-nav-label">优化</span>
                  </button>
                  <button
                    type="button"
                    className={aiInspectorTab === "quality" ? "ai-nav-btn ai-nav-btn-active" : "ai-nav-btn"}
                    onClick={() => setAiInspectorTab("quality")}
                    title="投递检查"
                  >
                    <span className="ai-nav-label">投递</span>
                    <span className="ai-nav-label">检查</span>
                  </button>
                  <button
                    type="button"
                    className="ai-nav-btn"
                    onClick={() => setShowDebugPanel((prev) => !prev)}
                    title="查看 AI 调试日志"
                  >
                    <span className="ai-nav-label">📋</span>
                    <span className="ai-nav-label">日志</span>
                  </button>
                </nav>
                <div className="ai-content-area studio-sidebar-section">
                  {aiInspectorTab === "quality" ? (
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
                  ) : (
                    <JobOptimizationPanel
                      repository={repository}
                      profile={profile}
                      jobs={jobs}
                      branch={selectedBranch}
                      selectedContentItemId={selectedStudioItemId}
                      canEdit={selectedBranchEditable}
                      showDebugPanel={showDebugPanel}
                      setShowDebugPanel={setShowDebugPanel}
                      onJobCreated={(job) => setLocalJobs((current) => [job, ...current.filter((item) => item.id !== job.id)])}
                      onBranchReady={replaceBranch}
                      onApplyStructureSuggestion={(kind, contentItemId) => {
                        if (kind === "hide") {
                          void setPresentationItemVisibility(contentItemId, false);
                          notify({ type: "info", title: "已隐藏", message: "结构建议已隐藏该段落；未创建正文版本。" });
                          return;
                        }
                        if (kind === "show") {
                          void setPresentationItemVisibility(contentItemId, true);
                          notify({ type: "info", title: "已恢复", message: "结构建议已恢复该段落；未创建正文版本。" });
                          return;
                        }
                        void movePresentationItem(contentItemId, "up");
                        notify({ type: "info", title: "已上移", message: "结构建议已上移该段落；未创建正文版本。" });
                      }}
                      onMessage={(msg) => notify({ type: "info", title: "提示", message: msg })}
                    />
                  )}
                </div>
              </div>
            </FloatingWindow>
          ) : null}

          {studioMode === "ai" && !aiFloatingOpen ? (
            <button
              type="button"
              className="floating-window-minimized"
              onClick={() => setAiFloatingOpen(true)}
            >
              AI 岗位优化
            </button>
          ) : null}

          <button
            className="studio-resize-handle no-print"
            type="button"
            aria-label="拖拽调整字段面板与 A4 预览宽度"
            title="拖拽调整字段面板与 A4 预览宽度"
            onPointerDown={startFieldPanelResize}
            onDoubleClick={() => setStudioLayout((current) => ({ ...current, fieldPanelCollapsed: false, fieldPanelWidth: DEFAULT_STUDIO_LAYOUT.fieldPanelWidth }))}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                setStudioLayout((current) => ({
                  ...current,
                  fieldPanelCollapsed: false,
                  fieldPanelWidth: clampNumber(current.fieldPanelWidth - 24, MIN_FIELD_PANEL_WIDTH, MAX_FIELD_PANEL_WIDTH)
                }));
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                setStudioLayout((current) => ({
                  ...current,
                  fieldPanelCollapsed: false,
                  fieldPanelWidth: clampNumber(current.fieldPanelWidth + 24, MIN_FIELD_PANEL_WIDTH, MAX_FIELD_PANEL_WIDTH)
                }));
              }
            }}
          />

          <div className="resume-preview-stage" ref={previewStageRef}>
            <div className="resume-document-scroller" data-testid="resume-document-scroller">
              {renderModel ? (
                <A4ResumePreview
                model={renderModel}
                template={selectedTemplate}
                pageRef={pageRef}
                paginationPlan={pagination.plan}
                presentationConfig={presentationConfig}
                zoom={canvasZoom}
                editor={resumeDocument ? {
                  enabled: studioMode === "edit" && isStudioEditMode,
                  selectedItemId: selectedStudioItemId,
                  editingItemId: editingStudioItemId,
                  selectedBlock: selectedStudioBlock,
                  selectedProfileFieldId,
                  editingProfileFieldId,
                  selectedProfileFieldLabel: profileFieldLabel(selectedProfileFieldId),
                  selectedSectionTitleId,
                  editingSectionTitleId,
                  selectedSectionTitleLabel: sectionTitleFieldLabel(selectedSectionTitleId),
                  draftText: studioDraftText,
                  profileDraftText: profileFieldDraftText,
                  sectionTitleDraftText,
                  error: studioError,
                  profileError: profileFieldError,
                  sectionTitleError,
                  pending: Boolean(pendingStudioOperationId) || profileFieldPending || sectionTitlePending,
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
                  onSelectSectionTitle: selectSectionTitle,
                  onStartSectionTitleEdit: startSectionTitleEdit,
                  onSectionTitleDraftTextChange: setSectionTitleDraftText,
                  onSaveSectionTitle: saveSectionTitleEdit,
                  onCancelSectionTitle: cancelSectionTitleEdit,
                  onMoveUp: (itemId) => { void movePresentationItem(itemId, "up"); },
                  onMoveDown: (itemId) => { void movePresentationItem(itemId, "down"); },
                  onHide: (itemId) => { void setPresentationItemVisibility(itemId, false); },
                  onDelete: (itemId) => { void setContentItemVisibility(itemId, false); }
                } : undefined}
                />
              ) : (
                <div className="panel no-print">当前简历不能进入正式模板预览。</div>
              )}
            </div>
            <div className="resume-canvas-toolbar no-print" aria-label="A4 预览工具">
              <span className="resume-toolbar-meta">
                {pagination.plan ? `${pagination.plan.actualPageCount} 页` : "测量页数"}
              </span>
              <div className="zoom-control" role="group" aria-label="画布缩放">
                <button className="secondary-button compact" type="button" aria-label="缩小预览" onClick={() => updateCanvasZoom((value) => value - 0.08)}>-</button>
                <span>{Math.round(canvasZoom * 100)}%</span>
                <button className="secondary-button compact" type="button" aria-label="放大预览" onClick={() => updateCanvasZoom((value) => value + 0.08)}>+</button>
                <button className={canvasZoomMode === "fit-page" ? "primary-button compact" : "secondary-button compact"} type="button" onClick={() => setCanvasZoomMode("fit-page")}>
                  适合宽度
                </button>
                <button className={canvasZoomMode === "fit-whole-page" ? "primary-button compact" : "secondary-button compact"} type="button" onClick={() => setCanvasZoomMode("fit-whole-page")}>
                  整页
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Profile sync reconciliation dialog */}
      {profileSyncDialogOpen && profileSyncConflicts.length > 0 ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-label="个人信息复核">
          <div className="sync-dialog">
            <h3 className="sync-dialog-title">选择这份简历使用的信息</h3>
            <p className="sync-dialog-description">
              资料库不会自动覆盖简历。请逐项选择保留简历内容，或使用资料库内容。
            </p>
            <div className="sync-dialog-conflicts">
              {profileSyncConflicts.map((conflict) => (
                <div key={conflict.fieldId} className="sync-conflict-card">
                  <div className="sync-conflict-label">{conflict.label}</div>
                  <div className="sync-conflict-options">
                    <button
                      type="button"
                      className={`sync-conflict-option ${profileSyncChoices[conflict.fieldId] === "resume" ? "sync-conflict-option-selected" : ""}`}
                      onClick={() => setProfileSyncChoices((current) => ({ ...current, [conflict.fieldId]: "resume" }))}
                    >
                      <span className="sync-conflict-option-source">简历版本</span>
                      <span className="sync-conflict-option-value">{conflict.resumeValue || "（空）"}</span>
                    </button>
                    <button
                      type="button"
                      className={`sync-conflict-option ${profileSyncChoices[conflict.fieldId] === "profile" ? "sync-conflict-option-selected" : ""}`}
                      onClick={() => setProfileSyncChoices((current) => ({ ...current, [conflict.fieldId]: "profile" }))}
                    >
                      <span className="sync-conflict-option-source">资料库版本</span>
                      <span className="sync-conflict-option-value">{conflict.profileValue || "（空）"}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="sync-dialog-actions">
              <button
                type="button"
                className="section-action-button"
                onClick={() => {
                  setProfileSyncDialogOpen(false);
                  setProfileSyncConflicts([]);
                  setProfileSyncChoices({});
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="section-action-button section-action-button-primary"
                onClick={() => { void applyProfileSyncChoices(); }}
                disabled={profileFieldPending}
              >
                {profileFieldPending ? "保存中…" : "应用选择"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingResumeOnlyEdit ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-only-edit-title">
          <div className="sync-dialog">
            <h3 className="sync-dialog-title" id="resume-only-edit-title">这次修改与资料库内容不同</h3>
            <p className="sync-dialog-description">
              你可以只更新当前简历，也可以同时更新个人资料库。两种选择都会保留新的简历版本，不会覆盖其他简历正文。
            </p>
            <div className="sync-dialog-notice" role="status">
              仅保存到简历后，这条内容会标记为“未同步”，之后仍可手动同步。
            </div>
            <div className="sync-dialog-actions">
              <button type="button" className="section-action-button" onClick={() => setPendingResumeOnlyEdit(undefined)}>
                取消
              </button>
              <button type="button" className="section-action-button" onClick={() => { void savePendingResumeOnlyEdit(false); }}>
                仅保存到简历
              </button>
              <button type="button" className="section-action-button section-action-button-primary" onClick={() => { void savePendingResumeOnlyEdit(true); }}>
                保存并同步资料库
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileLibraryOpen ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="profile-library-title">
          <div className="sync-dialog profile-library-dialog">
            <div className="profile-library-heading">
              <div>
                <h3 className="sync-dialog-title" id="profile-library-title">从资料库选择{activeSectionItem?.label ?? "经历"}</h3>
                <p className="sync-dialog-description">选择后会复制到当前简历，不会自动改写资料库原内容。</p>
              </div>
              <button type="button" className="section-action-button" onClick={() => setProfileLibraryOpen(false)}>关闭</button>
            </div>
            <div className="profile-library-list">
              {profileLibraryItems.length > 0 ? profileLibraryItems.map((item) => {
                const libraryReference = item.reference;
                const alreadyUsed = libraryReference.type === "canonical"
                  ? selectedBranch?.structuredContentItems?.some((contentItem) => contentItem.data.id === libraryReference.itemId && contentItem.data.sectionType === libraryReference.sectionType)
                  : selectedBranch?.contentItems.some((contentItem) => contentItem.factRefs.some((reference) => profileLibraryReferenceMatches(reference, libraryReference)));
                return (
                  <article className="profile-library-item" key={item.key}>
                    <div className="profile-library-item-copy">
                      <strong>{item.title}</strong>
                      <span>{item.subtitle || "资料库已确认内容"}</span>
                      <p>{item.body}</p>
                    </div>
                    <button
                      type="button"
                      className="section-action-button section-action-button-primary"
                      disabled={alreadyUsed}
                      onClick={() => { void addProfileLibraryItemToResume(item); }}
                    >
                      {alreadyUsed ? "已在简历中" : "使用"}
                    </button>
                  </article>
                );
              }) : (
                <div className="profile-library-empty">资料库中还没有此栏目的已确认内容。你可以先在简历中填写，之后再选择是否同步。</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {pendingPermanentDeleteBranch ? (
        <div className="sync-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="permanent-delete-title">
          <div className="sync-dialog profile-delete-dialog">
            <h3 className="sync-dialog-title" id="permanent-delete-title">永久删除简历？</h3>
            <p className="sync-dialog-description">这会删除简历正文、历史版本、操作记录和导出记录，无法恢复。请输入简历名称“{pendingPermanentDeleteBranch.name}”确认。</p>
            <label className="field-input-group" htmlFor="permanent-delete-name">
              <span className="field-input-label">简历名称</span>
              <input id="permanent-delete-name" className="field-input" value={permanentDeleteName} autoComplete="off" onChange={(event) => setPermanentDeleteName(event.target.value)} />
            </label>
            <div className="sync-dialog-actions">
              <button type="button" className="section-action-button" disabled={permanentDeleting} onClick={() => {
                setPendingPermanentDeleteBranch(undefined);
                setPermanentDeleteName("");
              }}>取消</button>
              <button type="button" className="section-action-button section-action-button-danger" disabled={permanentDeleting || permanentDeleteName.trim() !== pendingPermanentDeleteBranch.name} onClick={() => { void confirmPermanentBranchDelete(); }}>
                {permanentDeleting ? "删除中…" : "永久删除"}
              </button>
            </div>
          </div>
        </div>
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

function buildResumeStudioSections(input: {
  resumeDocument?: ResumeDocument;
  branch?: ResumeBranch;
  profile?: CareerProfile;
  enabledSections: ResumeStudioSectionKey[];
  hiddenSections: ResumeStudioSectionKey[];
  customSections: CustomStudioSection[];
}): Array<{ key: ResumeStudioSectionKey; label: string; count: number; firstItemId?: string }> {
  const blocks = input.resumeDocument?.blocks.filter((block) => block.itemType !== "structural" && block.contentVisible) ?? [];
  const blockById = new Map(blocks.map((block) => [block.contentItemId, block]));
  const canonicalItems = input.branch?.structuredContentItems ?? [];
  const blocksFor = (sectionType: ResumeSectionTypeV2) => canonicalItems
    .filter((item) => item.data.sectionType === sectionType)
    .flatMap((item) => blockById.get(item.id) ? [blockById.get(item.id)!] : []);
  const verifiedContentCount = input.branch?.contentItems.filter((item) => item.visible && item.itemType !== "structural").length ?? 0;
  const customBySource = (sourceSectionId: string) => blocks.filter((block) => block.sourceSectionId === sourceSectionId);
  const profileHasSection = (key: ResumeStudioSectionKey) => {
    if (!input.profile) return false;
    if (key === "awards") return input.profile.experiences.some((experience) => experience.type === "competition");
    if (key === "campus") return input.profile.experiences.some((experience) => experience.type === "campus");
    if (key === "volunteer") return input.profile.experiences.some((experience) => experience.type === "volunteer");
    if (key === "certificates") return input.profile.certificates.length > 0;
    if (key === "other") return input.profile.experiences.some((experience) => experience.type === "other");
    return false;
  };
  const candidates: Array<{ key: ResumeStudioSectionKey; label: string; blocks: ResumeDocumentBlock[]; defaultVisible: boolean; order: number }> = [
    ...resumeSectionCatalog.map((section) => ({
      key: section.id,
      label: section.label,
      blocks: section.id === "basics" ? [] : blocksFor(section.id),
      defaultVisible: section.defaultVisible,
      order: section.displayOrder
    })),
    ...input.customSections.map((section) => ({ key: `custom:${section.id}` as const, label: section.title, blocks: customBySource(`custom:${section.id}`), defaultVisible: false, order: 180 + section.order }))
  ];
  const sections = candidates
    .filter((section) => section.defaultVisible || (!input.hiddenSections.includes(section.key) && (section.blocks.length > 0 || input.enabledSections.includes(section.key) || profileHasSection(section.key))))
    .sort((left, right) => left.order - right.order)
    .map((section) => ({ key: section.key, label: section.label, count: section.key === "basics" ? (verifiedContentCount > 0 ? 1 : 0) : section.blocks.length, firstItemId: section.blocks[0]?.contentItemId }));
  return [...sections, { key: "add", label: "添加栏目", count: 0 }];
}

function studioSectionForBlock(block: ResumeDocumentBlock): ResumeStudioSectionKey {
  if (block.itemType === "custom") {
    if (block.sourceSectionId && isResumeStudioSectionKey(block.sourceSectionId)) {
      return block.sourceSectionId;
    }
    return "custom";
  }
  if (block.sectionType === "experience") {
    const canonical = block.canonicalSectionType;
    if (canonical === "internship" || canonical === "education" || canonical === "project" || canonical === "campus" || canonical === "work") return canonical;
    if (block.sourceSectionId === "projects" || block.sourceSectionId === "project") return "project";
    if (block.sourceSectionId === "education" || block.sourceSectionId === "campus") return block.sourceSectionId;
    if (block.sourceSectionId === "internship") return "internship";
    return "work";
  }
  if (block.sourceSectionId === "language") return "languages";
  return block.sectionType;
}

function buildNextPresentationConfig(input: {
  current: ResumePresentationConfig;
  branch: ResumeBranch;
  patch: Partial<Pick<
    ResumePresentationConfig,
    "templateId" | "itemOrderBySection" | "hiddenItemIds" | "typography" | "spacing" | "theme" | "pagination" | "sectionOrder" | "sectionStyleOverrides" | "itemHeaderMiddleAlignment"
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
  const rawStudioMode = (value as { studioMode?: unknown }).studioMode;
  const rawActiveBranchId = (value as { activeBranchId?: unknown }).activeBranchId;
  return {
    activeBranchId: typeof rawActiveBranchId === "string" || rawActiveBranchId === null ? rawActiveBranchId : undefined,
    templateId: isResumeTemplateId(candidate.templateId) ? candidate.templateId : undefined,
    stylePanelOpen: typeof candidate.stylePanelOpen === "boolean" ? candidate.stylePanelOpen : undefined,
    studioMode: rawStudioMode === "manual" ? "edit" : isStudioMode(rawStudioMode) ? rawStudioMode : undefined,
    manualTab: isManualInspectorTab(candidate.manualTab) ? candidate.manualTab : undefined,
    aiTab: isAiInspectorTab(candidate.aiTab) ? candidate.aiTab : undefined,
    styleTab: isStyleInspectorTab(candidate.styleTab) ? candidate.styleTab : undefined,
    enabledSectionsByBranch: parseSectionStateRecord(candidate.enabledSectionsByBranch),
    hiddenSectionsByBranch: parseSectionStateRecord(candidate.hiddenSectionsByBranch),
    customSectionsByBranch: parseCustomSectionState(candidate.customSectionsByBranch)
  };
}

function parseSectionStateRecord(value: unknown): Record<string, ResumeStudioSectionKey[]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).flatMap(([branchId, sections]) =>
    Array.isArray(sections) ? [[branchId, sections.filter(isResumeStudioSectionKey)]] : []
  ));
}

function parseCustomSectionState(value: unknown): Record<string, CustomStudioSection[]> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).map(([branchId, sections]) => [branchId,
    Array.isArray(sections) ? sections.flatMap((section, index) => {
      if (!section || typeof section !== "object") return [];
      const candidate = section as Partial<CustomStudioSection>;
      return typeof candidate.id === "string" && candidate.id && typeof candidate.title === "string" && candidate.title.trim()
        ? [{ id: candidate.id, title: candidate.title.trim(), order: typeof candidate.order === "number" ? candidate.order : index }]
        : [];
    }) : []
  ]));
}

function isResumeStudioSectionKey(value: unknown): value is ResumeStudioSectionKey {
  return typeof value === "string" && (value.startsWith("custom:") || [...resumeSectionCatalog.map((section) => section.id), "add"].includes(value as ResumeSectionTypeV2 | "add"));
}

function isStudioMode(value: unknown): value is StudioMode {
  return value === "edit" || value === "ai" || value === "style";
}

function isManualInspectorTab(value: unknown): value is ManualInspectorTab {
  return value === "content"
    || value === "typography"
    || value === "paragraph"
    || value === "layout"
    || value === "template"
    || value === "page"
    || value === "history";
}

function isAiInspectorTab(value: unknown): value is AiInspectorTab {
  return value === "suggestions" || value === "quality";
}

function isStyleInspectorTab(value: unknown): value is StyleInspectorTab {
  return value === "template"
    || value === "colors"
    || value === "font"
    || value === "page";
}

function workbenchStateKey(profileId: string) {
  return `resumeWorkbenchState:${profileId}`;
}

function readInitialStudioLayout(): StudioLayoutState {
  if (typeof window === "undefined") {
    return DEFAULT_STUDIO_LAYOUT;
  }
  return parseStudioLayoutState(window.localStorage.getItem(RESUME_STUDIO_LAYOUT_KEY)) ?? DEFAULT_STUDIO_LAYOUT;
}

function parseStudioLayoutState(value: string | null): StudioLayoutState | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Partial<StudioLayoutState>;
    return {
      sectionNavCollapsed: typeof parsed.sectionNavCollapsed === "boolean" ? parsed.sectionNavCollapsed : DEFAULT_STUDIO_LAYOUT.sectionNavCollapsed,
      fieldPanelCollapsed: typeof parsed.fieldPanelCollapsed === "boolean" ? parsed.fieldPanelCollapsed : DEFAULT_STUDIO_LAYOUT.fieldPanelCollapsed,
      fieldPanelWidth: clampNumber(
        typeof parsed.fieldPanelWidth === "number" ? parsed.fieldPanelWidth : DEFAULT_STUDIO_LAYOUT.fieldPanelWidth,
        MIN_FIELD_PANEL_WIDTH,
        MAX_FIELD_PANEL_WIDTH
      )
    };
  } catch {
    return undefined;
  }
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

function safeDownloadNamePart(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60) || "resume";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatLocalDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知时间";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function riskLevelUiLabel(risk: "low" | "medium" | "high") {
  return risk === "high" ? "存在高风险阻止项" : risk === "medium" ? "需要人工确认" : "未发现高风险";
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

function canManageBranch(branch: ResumeBranch) {
  return branch.migrationStatus === "verified" && branch.lifecycleStatus === "active" && Boolean(branch.currentRevisionId);
}

function branchNotEditableReason(branch: ResumeBranch) {
  if (branch.migrationStatus !== "verified") {
    return "legacy_unverified";
  }
  if (branch.lifecycleStatus !== "active") {
    return branch.lifecycleStatus === "trashed" ? "trashed" : "archived";
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
    return branch.lifecycleStatus === "trashed" ? "回收站" : "已归档";
  }
  return "可编辑";
}

function branchNotEditableLabel(reason: ReturnType<typeof branchNotEditableReason>) {
  const labels: Record<string, string> = {
    legacy_unverified: "旧数据只读",
    archived: "已归档",
    trashed: "回收站只读",
    missing_current_revision: "缺少当前版本",
    invalid_reference: "引用的个人资料或岗位已变化"
  };
  return reason ? labels[reason] ?? reason : "未知原因";
}

function syncStatusLabel(value: string) {
  const labels: Record<string, string> = {
    in_sync: "已同步",
    profile_updated: "个人资料有更新",
    job_updated: "岗位有更新",
    profile_and_job_updated: "资料和岗位有更新",
    stale_profile: "个人资料有更新",
    stale_job: "岗位有更新",
    invalid_reference: "引用失效"
  };
  return labels[value] ?? value;
}

function syncStatusMessage(value: string) {
  const labels: Record<string, string> = {
    profile_updated: "个人资料已有更新，请检查是否需要同步到这份简历。",
    job_updated: "关联岗位已有更新，请检查岗位定制内容是否仍然适用。",
    profile_and_job_updated: "个人资料和关联岗位都有更新，请复核后继续。",
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

function sectionTitleFieldType(fieldId: string | undefined): ResumeRenderSectionType | undefined {
  const value = fieldId?.replace(/^section-title:/, "");
  if (value === "summary" || value === "experience" || value === "skills" || value === "certificates") {
    return value;
  }
  return undefined;
}

function sectionTitleFieldLabel(fieldId: string | undefined) {
  const sectionType = sectionTitleFieldType(fieldId);
  return sectionType ? sectionTypeLabel(sectionType) : "栏目标题";
}

type EditableProfileFieldKey = "name" | "targetRole" | "phone" | "email" | "location" | "link";

function profileFieldKey(fieldId: string): EditableProfileFieldKey | undefined {
  if (fieldId === "profile:name") {
    return "name";
  }
  if (fieldId === "branch:targetRole") {
    return "targetRole";
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
  if (fieldId.startsWith("profile:link:") || fieldId.startsWith("profile:email:link:")) {
    return "link";
  }
  return undefined;
}

function profileLinkIndex(fieldId: string) {
  const parts = fieldId.split(":");
  const raw = Number(parts[parts.length - 1] ?? 0);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
}

function profileFieldLabel(fieldId?: string) {
  if (!fieldId) {
    return "";
  }
  const labels: Record<EditableProfileFieldKey, string> = {
    name: "姓名",
    targetRole: "目标职位",
    phone: "电话",
    email: "邮箱",
    location: "所在地",
    link: "链接"
  };
  const key = profileFieldKey(fieldId);
  if (key === "link" && fieldId.startsWith("profile:email:link:")) {
    return "邮箱";
  }
  return key ? labels[key] : "基本信息";
}

function styleInspectorTabLabel(tab: StyleInspectorTab) {
  const labels: Record<StyleInspectorTab, string> = {
    template: "模板",
    colors: "颜色",
    font: "字体",
    page: "页面"
  };
  return labels[tab];
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

function sectionNavIcon(key: string): React.ReactNode {
  const iconSize = 18;
  const iconStrokeWidth = 1.5;
  const icons: Record<string, React.ReactNode> = {
    basics: <User size={iconSize} strokeWidth={iconStrokeWidth} />,
    summary: <FileText size={iconSize} strokeWidth={iconStrokeWidth} />,
    work: <Briefcase size={iconSize} strokeWidth={iconStrokeWidth} />,
    internship: <Compass size={iconSize} strokeWidth={iconStrokeWidth} />,
    education: <GraduationCap size={iconSize} strokeWidth={iconStrokeWidth} />,
    project: <Rocket size={iconSize} strokeWidth={iconStrokeWidth} />,
    campus: <School size={iconSize} strokeWidth={iconStrokeWidth} />,
    skills: <Zap size={iconSize} strokeWidth={iconStrokeWidth} />,
    awards: <Trophy size={iconSize} strokeWidth={iconStrokeWidth} />,
    certificates: <Scroll size={iconSize} strokeWidth={iconStrokeWidth} />,
    languages: <Globe size={iconSize} strokeWidth={iconStrokeWidth} />,
    custom: <Sparkles size={iconSize} strokeWidth={iconStrokeWidth} />,
    add: <Plus size={iconSize} strokeWidth={iconStrokeWidth} />
  };
  return icons[key] ?? <span style={{ fontSize: '18px' }}>•</span>;
}

function sectionNavAccessibleLabel(key: ResumeStudioSectionKey, label: string) {
  return label;
}

function splitSectionNavLabel(label: string) {
  const parts = label.split(/\s*\/\s*/);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) {
      lines.push("/");
    }
    const part = parts[i];
    if (!part) continue;
    const characters = Array.from(part);
    for (let index = 0; index < characters.length; index += 2) {
      lines.push(characters.slice(index, index + 2).join(""));
    }
  }
  return lines;
}

function experienceMatchesResumeSection(
  type: CareerProfile["experiences"][number]["type"],
  section: ResumeStudioSectionKey
) {
  if (section === "education") return type === "education";
  if (section === "project") return type === "project";
  if (section === "campus") return type === "campus";
  if (section === "volunteer") return type === "volunteer";
  if (section === "work") return type === "work" || type === "other";
  if (section === "internship") return type === "internship";
  if (section === "awards") return type === "competition";
  if (section === "other" || section === "custom" || section.startsWith("custom:")) return type === "other";
  return false;
}

function buildProfileLibraryItems(profile: CareerProfile, section: ResumeStudioSectionKey): ProfileLibraryItem[] {
  if (!section.startsWith("custom:")) {
    const canonicalItems = (profile.structuredFacts ?? []).filter((entry) => entry.data.sectionType === section && (entry.factIds.length > 0 || entry.data.sectionType === "summary"));
    if (canonicalItems.length > 0) return canonicalItems.map((entry) => ({
      key: `canonical:${entry.data.sectionType}:${entry.data.id}`,
      title: canonicalProfileItemTitle(entry.data), subtitle: entry.data.sectionType,
      body: projectResumeItemV2(entry.data),
      reference: { type: "canonical" as const, itemId: entry.data.id, sectionType: entry.data.sectionType }
    }));
  }
  if (section === "skills" || section === "languages") {
    return profile.skills.flatMap((skill) => {
      const fact = skill.fact;
      const language = fact?.category === "language" || /语言|英语|日语|韩语|法语|德语|雅思|托福|CET/i.test(skill.name);
      if (!fact || !fact.confirmedByUser || fact.riskLevel === "high" || language !== (section === "languages")) return [];
      return [{
        key: `skill:${skill.id}:${fact.id}`,
        title: skill.name,
        subtitle: skill.level === "proficient" ? "熟练" : skill.level === "basic" ? "了解" : "熟悉",
        body: fact.statement,
        reference: { type: "skill" as const, skillId: skill.id, factId: fact.id }
      }];
    });
  }
  if (section === "certificates") {
    return profile.certificates.flatMap((certificate) => {
      const fact = certificate.fact;
      if (!fact || !fact.confirmedByUser || fact.riskLevel === "high") return [];
      return [{
        key: `certificate:${certificate.id}:${fact.id}`,
        title: certificate.name,
        subtitle: [certificate.issuer, certificate.issuedAt].filter(Boolean).join(" · "),
        body: fact.statement,
        reference: { type: "certificate" as const, certificateId: certificate.id, factId: fact.id }
      }];
    });
  }
  return profile.experiences
    .filter((experience) => experienceMatchesResumeSection(experience.type, section))
    .flatMap((experience) => experience.facts.flatMap((fact) => {
      if (!fact.confirmedByUser || fact.riskLevel === "high") return [];
      return [{
        key: `experience:${experience.id}:${fact.id}`,
        title: `${experience.organization} · ${experience.role}`,
        subtitle: [experience.startDate, experience.endDate].filter(Boolean).join(" — ") || "未填写时间",
        body: fact.statement,
        reference: { type: "experience" as const, experienceId: experience.id, factId: fact.id }
      }];
    }));
}

function canonicalProfileItemTitle(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return [record.title, record.name, record.organization, record.school, record.language, record.text]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined ?? item.sectionType;
}

function profileLibraryReferenceMatches(
  reference: ResumeBranch["contentItems"][number]["factRefs"][number],
  libraryReference: ProfileLibraryReference
) {
  if (reference.type === "experience_fact" && libraryReference.type === "experience") {
    return reference.experienceId === libraryReference.experienceId && reference.factId === libraryReference.factId;
  }
  if (reference.type === "skill_fact" && libraryReference.type === "skill") {
    return reference.skillId === libraryReference.skillId && reference.factId === libraryReference.factId;
  }
  if (reference.type === "certificate_fact" && libraryReference.type === "certificate") {
    return reference.certificateId === libraryReference.certificateId && reference.factId === libraryReference.factId;
  }
  return false;
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
  return value === "natural" || value === "prefer_one_page" || value === "one_page_strict" || value === "up_to_two_pages"
    ? value
    : undefined;
}

function paginationIssueLabel(issue: NonNullable<ResumePaginationPlan["issues"]>[number]) {
  const labels = {
    oversized_content: "某条内容高于单页可用高度，将由浏览器按行自然分页。",
    prefer_one_page_overflow: "当前内容在可读范围内无法压缩为一页，已按自然顺序生成两页。",
    strict_one_page_overflow: "严格一页超出；请减少内容或使用一页优化。",
    exceeds_two_pages: "内容超过两页。",
    horizontal_overflow: "检测到横向溢出。",
    measurement_failed: "分页测量失败，请重试。"
  } satisfies Record<NonNullable<ResumePaginationPlan["issues"]>[number], string>;
  return labels[issue];
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
