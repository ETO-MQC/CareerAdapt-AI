"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type JobAdaptationDraft,
  type ResumeBranch,
  type ResumePresentationConfig,
  type ResumeRenderModel,
  type ResumeRevision,
  type TemplateId
} from "@/domain/schemas";
import { mapBranchToResumeRenderModel, ResumeRenderMapperError } from "@/domain/resumeRender/mapper";
import { A4ResumePreview } from "@/components/resume/A4ResumePreview";
import { mapBranchToResumeDocument } from "@/domain/resumeDocument/mapper";
import { classifyOverflow, useA4Overflow } from "@/components/resume/useA4Overflow";
import {
  getResumeTemplate,
  getTemplateDefaultStyleConfig,
  resumeTemplates,
  type ResumeTemplateStyleConfig
} from "@/components/resume/templates/templateRegistry";
import { printCurrentPage } from "@/services/export/browserPrint";
import { stableHashText } from "@/services/security/text";
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

export function ResumeWorkspace() {
  const workspace = useWorkspace(repository);
  const pageRef = useRef<HTMLElement | null>(null);
  const [drafts, setDrafts] = useState<JobAdaptationDraft[]>([]);
  const [branches, setBranches] = useState<ResumeBranch[]>([]);
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
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(true);
  const [activePropertyTab, setActivePropertyTab] = useState<PropertyPanelTab>("document");

  const presentationQueueRef = useRef<{ promise: Promise<void>; latestConfig: ResumePresentationConfig | undefined }>({
    promise: Promise.resolve(),
    latestConfig: undefined
  });

  function enqueuePresentation(operation: (config: ResumePresentationConfig) => Promise<ResumePresentationConfig | undefined>) {
    const queue = presentationQueueRef.current;
    queue.promise = queue.promise.then(async () => {
      const config = queue.latestConfig;
      if (!config) {
        return;
      }
      const result = await operation(config);
      if (result) {
        queue.latestConfig = result;
      }
    }).catch((error) => {
      console.error("Presentation queue error:", error);
    });
  }

  useEffect(() => {
    presentationQueueRef.current.latestConfig = presentationConfig;
  }, [presentationConfig]);

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = useMemo(() => workspace.status === "ready" ? workspace.jobs : [], [workspace]);
  const activeDraftId = selectedDraftId || drafts[0]?.id || "";
  const activeBranchId = selectedBranchId || branches[0]?.id || "";
  const selectedDraft = drafts.find((draft) => draft.id === activeDraftId);
  const selectedBranch = branches.find((branch) => branch.id === activeBranchId);
  const selectedBranchJob = selectedBranch ? jobs.find((job) => job.id === selectedBranch.jobId) : undefined;
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
    if (!selectedBranch || !profile || !selectedBranchJob) {
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
  const selectedBranchEditable = selectedBranch ? canEditBranch(selectedBranch) : false;
  const overflow = useA4Overflow(pageRef, [
    renderModel?.branchId,
    renderModel?.branchRevision,
    effectiveTemplateId,
    presentationConfig?.presentationRevision
  ]);
  const reductionHints = useMemo(() => renderModel ? buildReductionHints(renderModel) : [], [renderModel]);
  const presentationHiddenBlocks = useMemo(() => {
    return resumeDocument?.blocks.filter((block) => block.presentationHidden && block.contentVisible) ?? [];
  }, [resumeDocument]);

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
    setActivePropertyTab("document");
  }, []);

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
    if (!profile || !activeBranchId) {
      return;
    }
    void repository.setMeta(workbenchStateKey(profile.id), {
      branchId: activeBranchId,
      templateId: effectiveTemplateId,
      stylePanelOpen: isStylePanelOpen
    } satisfies WorkbenchState);
  }, [profile, activeBranchId, effectiveTemplateId, isStylePanelOpen]);

  const draftOptions = useMemo(() => drafts.map((draft) => {
    const job = jobs.find((item) => item.id === draft.jobId);
    return {
      draft,
      label: `${job?.company ?? "Unknown"} / ${job?.title ?? draft.jobId} / revision ${draft.revision}`
    };
  }), [drafts, jobs]);

  async function createBranch() {
    if (!profile || !selectedDraft) {
      setMessage("请先选择可用的 C2 适配草稿。");
      return;
    }

    const job = jobs.find((item) => item.id === selectedDraft.jobId);
    const name = draftName.trim() || `${job?.company ?? "岗位"} / ${job?.title ?? "分支"}`;
    try {
      const result = await repository.createResumeBranchFromDraft({
        draftId: selectedDraft.id,
        expectedDraftRevision: selectedDraft.revision,
        operationId: `d1-create-${selectedDraft.id}-${selectedDraft.revision}`,
        name
      });
      await refreshLists(profile.id);
      setSelectedBranchId(result.branch.id);
      setMessage(result.idempotent ? "该草稿已经创建过正式分支，已恢复现有分支。" : "正式岗位分支已创建，并生成首个版本。");
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "创建失败：C2 草稿 revision 已变化，请刷新后重试。"
        : "创建失败：草稿可能已 stale、含高风险内容或引用了失效事实。请返回 C1/C2 修复。");
    }
  }

  async function saveItem(itemId: string) {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前分支不可编辑：legacy、归档、引用失效或缺少 currentRevision。");
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
      setMessage("分支内容已保存，规则 Fact Guard 已由 Repository 重新计算。");
    } catch {
      setMessage("保存失败：可能存在高风险事实变更、revision 冲突或 legacy 分支只读。");
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
      setMessage("当前分支不可保存展示配置：legacy、归档、引用失效或缺少 currentRevision。");
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
      if (input.recordHistory !== false && !result.idempotent) {
        setPresentationHistory((current) => ({
          undoStack: [...current.undoStack.slice(-49), input.beforeConfig],
          redoStack: []
        }));
      }
      setMessage(result.idempotent ? "该展示操作已保存过，未重复写入。" : input.successMessage);
      return result.config;
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "展示配置保存失败：内容版本或展示版本已变化，请刷新后重试。"
        : "展示配置保存失败：可能隐藏了全部内容、分支不可编辑或配置不合法。");
      return undefined;
    }
  }

  async function updatePresentationTemplate(nextTemplateId: TemplateId) {
    if (!selectedBranch || !presentationConfig) {
      setTemplateId(nextTemplateId);
      return;
    }
    if (nextTemplateId === presentationConfig.templateId) {
      return;
    }
    enqueuePresentation(async (current) => {
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
        successMessage: "模板偏好已保存到当前分支展示配置。"
      });
    });
  }

  async function updatePresentationStyle(
    patch: Partial<ResumeTemplateStyleConfig> | ((current: ResumePresentationConfig) => Partial<ResumeTemplateStyleConfig>),
    successMessage = "样式已保存到当前分支展示配置。"
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
    }), showTitle ? "Section 标题已恢复显示。" : "Section 标题已隐藏。");
  }

  async function resetSectionStyle(sectionType: NonNullable<typeof selectedStudioBlock>["sectionType"]) {
    await updatePresentationStyle((current) => {
      const nextOverrides = { ...current.sectionStyleOverrides };
      delete nextOverrides[sectionType];
      return {
        sectionStyleOverrides: nextOverrides
      };
    }, "当前 Section 样式已恢复默认。");
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
        successMessage: "排序已保存到当前分支展示配置，未创建内容版本。"
      });
    });
  }

  async function undoPresentationChange() {
    if (!selectedBranch || !presentationConfig) {
      setMessage("没有可撤销的展示操作。");
      return;
    }
    const target = presentationHistory.undoStack.at(-1);
    if (!target) {
      setMessage("没有可撤销的展示操作。");
      return;
    }
    enqueuePresentation(async (current) => {
      const undoTarget = presentationHistory.undoStack.at(-1);
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
        setPresentationHistory((prev) => ({
          undoStack: prev.undoStack.slice(0, -1),
          redoStack: [...prev.redoStack.slice(-49), current]
        }));
      }
      return saved ?? current;
    });
  }

  async function redoPresentationChange() {
    if (!selectedBranch || !presentationConfig) {
      setMessage("没有可重做的展示操作。");
      return;
    }
    const target = presentationHistory.redoStack.at(-1);
    if (!target) {
      setMessage("没有可重做的展示操作。");
      return;
    }
    enqueuePresentation(async (current) => {
      const redoTarget = presentationHistory.redoStack.at(-1);
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
        setPresentationHistory((prev) => ({
          undoStack: [...prev.undoStack.slice(-49), current],
          redoStack: prev.redoStack.slice(0, -1)
        }));
      }
      return saved ?? current;
    });
  }

  async function restoreRevision(revisionId: string) {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前分支不可恢复：legacy、归档、引用失效或缺少 currentRevision。");
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
      setMessage("已恢复旧版本；恢复操作本身已作为新的 restore revision 追加。");
    } catch {
      setMessage("恢复失败：版本链缺失、revision 冲突或分支不可编辑。");
    }
  }

  async function undo() {
    if (!selectedBranch || !selectedBranchEditable) {
      setMessage("当前分支不可撤销：legacy、归档、引用失效或缺少 currentRevision。");
      return;
    }
    try {
      const result = await repository.undoResumeBranch({
        branchId: selectedBranch.id,
        expectedRevision: selectedBranch.revision,
        operationId: `d1-undo-${selectedBranch.id}-${selectedBranch.revision}`
      });
      replaceBranch(result.branch);
      setMessage("已按 previousRevisionId 链撤销最近一次分支修改。");
    } catch {
      setMessage("撤销失败：没有可撤销版本或当前分支已变化。");
    }
  }

  function selectStudioItem(itemId: string) {
    if (!isStudioEditMode) {
      return;
    }
    setSelectedStudioItemId(itemId);
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
      setStudioError("当前预览不是最新 currentRevision，请刷新后再编辑。");
      return;
    }

    const nextText = studioDraftText.trim();
    if (!nextText) {
      setStudioError("保存失败：文本不能为空。");
      return;
    }
    if (nextText === block.text.trim()) {
      cancelStudioEdit();
      setMessage("内容未变化，没有创建新的分支版本。");
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
      setMessage(result.idempotent ? "该编辑已保存过，未重复创建版本。" : "预览区编辑已保存，并创建新的内容版本。");
    } catch (error) {
      setPendingStudioOperationId(undefined);
      setStudioError(error instanceof RevisionConflictError
        ? "保存失败：分支 revision 已变化，未覆盖最新内容。"
        : "保存失败：Fact Guard 阻止了高风险事实修改，或当前分支不可编辑。");
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
    setMessage("syncStatus 已基于当前母档案、岗位和事实引用重新计算；分支内容未被自动覆盖。");
  }

  async function exportPdf() {
    if (!selectedBranch || !renderModel) {
      setMessage("当前分支无法生成正式预览，不能导出。");
      return;
    }

    const page = pageRef.current;
    const measured = page
      ? classifyOverflow({ scrollHeight: page.scrollHeight, clientHeight: page.clientHeight })
      : overflow;
    const fileName = buildExportFileName(renderModel, effectiveTemplateId);
    const presentationSnapshot = presentationConfig ? {
      templateId: presentationConfig.templateId,
      itemOrderBySection: presentationConfig.itemOrderBySection,
      hiddenItemIds: presentationConfig.hiddenItemIds,
      typography: presentationConfig.typography,
      spacing: presentationConfig.spacing,
      theme: presentationConfig.theme,
      sectionStyleOverrides: presentationConfig.sectionStyleOverrides
    } : undefined;
    const operationId = `d2-export-${selectedBranch.id}-${selectedBranch.revision}-${selectedBranch.currentRevisionId}-${effectiveTemplateId}-${measured.status}-${presentationConfig?.presentationRevision ?? 0}`;

    try {
      const [latestBranch, latestProfile, latestJob] = await Promise.all([
        repository.getResumeBranch(selectedBranch.id),
        repository.getProfile(selectedBranch.profileId),
        repository.getJobDescription(selectedBranch.jobId)
      ]);

      if (!latestBranch || !latestProfile || !latestJob) {
        throw new Error("export_source_missing");
      }
      if (latestBranch.revision !== renderModel.branchRevision || latestBranch.currentRevisionId !== renderModel.branchCurrentRevisionId) {
        replaceBranch(latestBranch);
        setMessage("导出已停止：分支 revision 已更新，已刷新预览，请重新检查后导出。");
        return;
      }

      mapBranchToResumeRenderModel({
        branch: latestBranch,
        profile: latestProfile,
        job: latestJob,
        presentationConfig
      });

      if (measured.status === "overflow") {
        await repository.createResumeExportRecord({
          operationId,
          branchId: latestBranch.id,
          expectedBranchRevision: latestBranch.revision,
          expectedRevisionId: latestBranch.currentRevisionId!,
          templateId: effectiveTemplateId,
          overflowStatus: "overflow",
          exportStatus: "blocked_overflow",
          fileName,
          errorCode: "overflow",
          presentationRevision: presentationConfig?.presentationRevision,
          presentationSnapshot
        });
        setMessage("导出已阻止：当前 A4 预览为 overflow，请先删减内容。");
        return;
      }

      await repository.createResumeExportRecord({
        operationId,
        branchId: latestBranch.id,
        expectedBranchRevision: latestBranch.revision,
        expectedRevisionId: latestBranch.currentRevisionId!,
        templateId: effectiveTemplateId,
        overflowStatus: measured.status,
        exportStatus: "print_invoked",
        fileName,
        presentationRevision: presentationConfig?.presentationRevision,
        presentationSnapshot
      });
      printCurrentPage();
      setMessage(measured.status === "near_limit"
        ? "已打开浏览器打印。当前接近单页上限，请在打印预览中再次确认。"
        : "已打开浏览器打印，可保存为文本可复制的 PDF。");
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "导出失败：分支 revision 已变化，请刷新后重试。"
        : "导出失败：分支可能不可导出、引用失效或导出记录写入失败。");
    }
  }

  function replaceBranch(branch: ResumeBranch) {
    setBranches((current) => current.map((item) => item.id === branch.id ? branch : item));
    setEditTexts({});
    clearStudioEditor();
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

  if (workspace.status === "empty" || !profile) {
    return (
      <main className="page-shell">
        <WorkspaceEmptyState />
      </main>
    );
  }

  return (
    <main className="page-shell resume-workspace">
      <section className="page-title no-print">
        <p className="eyebrow">Stage D2 / Templates & PDF</p>
        <h1>简历工作台</h1>
        <p>正式分支进入统一 RenderModel 后，可切换双模板、检查 A4 单页状态，并通过浏览器打印导出 PDF。</p>
      </section>

      {message ? <section className="notice no-print">{message}</section> : null}

      <section className="stage-grid no-print">
        <article className="panel">
          <h2>1. 从 C2 草稿创建分支</h2>
          {draftOptions.length > 0 ? (
            <>
              <label className="field-label">
                C2 适配草稿
                <select value={activeDraftId} onChange={(event) => setSelectedDraftId(event.target.value)}>
                  {draftOptions.map((option) => (
                    <option key={option.draft.id} value={option.draft.id}>{option.label}</option>
                  ))}
                </select>
              </label>
              <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="分支名称" />
              <button className="primary-button" onClick={createBranch}>创建正式分支</button>
            </>
          ) : (
            <p>暂无 C2 适配草稿。请先在岗位工作区完成 C1/C2。</p>
          )}
        </article>

        <article className="panel">
          <h2>2. 选择分支</h2>
          {branches.length > 0 ? (
            <div className="branch-list">
              {branches.map((branch) => (
                <button
                  key={branch.id}
                  className={`match-row ${branch.id === activeBranchId ? "match-row-active" : ""}`}
                  onClick={() => setSelectedBranchId(branch.id)}
                >
                  <strong>{branch.name}</strong>
                  <span>{branch.migrationStatus} / revision {branch.revision} / {branch.syncStatusCache.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <p>暂无正式岗位分支。</p>
          )}
        </article>
      </section>

      {selectedBranch ? (
        <section className="panel no-print">
          <div className="section-heading">
            <div>
              <h2>{selectedBranch.name}</h2>
              <p>
                {selectedBranchJob ? `${selectedBranchJob.company} / ${selectedBranchJob.title}` : selectedBranch.jobId}
                {" "} / {selectedBranch.migrationStatus} / revision {selectedBranch.revision}
              </p>
            </div>
            <div className="action-row">
              <button className="secondary-button" onClick={refreshSync}>刷新更新提示</button>
              <button className="secondary-button" onClick={undo} disabled={!selectedBranchEditable}>撤销</button>
            </div>
          </div>

          {selectedBranch.migrationStatus === "legacy_unverified" ? (
            <div className="warning-box">这是旧占位分支，已按 legacy_unverified 只读保留，不参与正式编辑、版本恢复、预览或后续导出。</div>
          ) : null}

          {!selectedBranchEditable && selectedBranch.migrationStatus !== "legacy_unverified" ? (
            <div className="warning-box">当前分支不可编辑：{branchNotEditableReason(selectedBranch)}。</div>
          ) : null}

          {selectedBranch.syncStatusCache.status !== "in_sync" ? (
            <div className="warning-box">{selectedBranch.syncStatusCache.message}</div>
          ) : null}

          <div className="branch-editor">
            {selectedBranch.contentItems.map((item) => {
              const presentationBlock = resumeDocumentBlocksById.get(item.id);
              const presentationVisible = presentationBlock?.visible ?? item.visible;
              return (
                <article key={item.id} className="suggestion-card">
                  <div className="section-heading compact-heading">
                    <div>
                      <h3>{item.itemType} / {item.guardMode}</h3>
                      <p>{item.guardStatus} / {item.guardRiskLevel}</p>
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
                    <div className="warning-box">该内容在历史内容版本中已隐藏，G1a 展示配置不会静默改写旧内容快照。</div>
                  ) : null}
                  {item.guardMode === "rule_only_verified" ? (
                    <div className="warning-box">规则 Fact Guard 已通过，但 AI 复核未完成。</div>
                  ) : null}
                  <textarea
                    className="textarea small-textarea"
                    value={editTexts[item.id] ?? item.text}
                    disabled={!selectedBranchEditable}
                    onChange={(event) => setEditTexts((current) => ({ ...current, [item.id]: event.target.value }))}
                  />
                  <div className="action-row">
                    <button className="primary-button" disabled={!selectedBranchEditable} onClick={() => saveItem(item.id)}>
                      保存
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedBranch ? (
        <section className="resume-preview-layout">
          <aside className="panel no-print resume-export-panel">
            <div className="property-panel-heading">
              <h2>3. 属性与导出</h2>
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
                {selectedStudioBlock ? "Block" : "Document"} / {selectedTemplate.name} / presentation {presentationConfig?.presentationRevision ?? 0}
              </span>
            </div>
            <label className="inline-toggle studio-edit-toggle">
              <input
                type="checkbox"
                checked={isStudioEditMode}
                disabled={!renderModel || !resumeDocument?.editable}
                onChange={(event) => setIsStudioEditMode(event.target.checked)}
              />
              预览区编辑
            </label>
            {isStudioEditMode && resumeDocument ? (
              <div className="save-status">单击区块选中，双击或 Enter/F2 编辑，Escape 取消，Ctrl/Cmd+Enter 保存。</div>
            ) : null}
            <label className="field-label">
              模板
              <select value={effectiveTemplateId} onChange={(event) => { void updatePresentationTemplate(event.target.value as TemplateId); }}>
                {resumeTemplates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name} / {template.audience}</option>
                ))}
              </select>
            </label>
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
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.density}
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
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.bodyTextScale}
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
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.titleTextScale}
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
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.lineHeight}
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
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.itemGap}
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
                        Section 间距
                        <select
                          aria-label="Section 间距"
                          value={presentationConfig?.spacing.sectionGap ?? "normal"}
                          disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.sectionGap}
                          onChange={(event) => {
                            const sectionGap = event.target.value as ResumePresentationConfig["spacing"]["sectionGap"];
                            void updatePresentationStyle((current) => ({
                              spacing: { ...current.spacing, sectionGap }
                            }), "Section 间距已保存。");
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
                            disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.accentColor}
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
                  </div>
                ) : null}

                {activePropertyTab === "section" && selectedStudioSection && selectedStudioBlock ? (
                  <div className="property-section" data-testid="section-style-panel">
                    <div className="property-summary compact-property-summary">
                      <strong>{selectedStudioSection.title}</strong>
                      <span>Section / {sectionTypeLabel(selectedStudioSection.type)}</span>
                    </div>
                    <label className="inline-toggle">
                      <input
                        type="checkbox"
                        checked={presentationConfig?.sectionStyleOverrides[selectedStudioSection.type]?.showTitle !== false}
                        disabled={!presentationConfig || !selectedBranchEditable || !selectedTemplate.styleCapabilities.sectionTitleVisibility}
                        onChange={(event) => { void setSectionTitleVisibility(selectedStudioSection.type, event.target.checked); }}
                      />
                      显示 Section 标题
                    </label>
                    <button
                      className="secondary-button compact"
                      disabled={!presentationConfig || !selectedBranchEditable}
                      onClick={() => { void resetSectionStyle(selectedStudioSection.type); }}
                    >
                      恢复当前 Section 默认值
                    </button>
                  </div>
                ) : null}

                {activePropertyTab === "block" && selectedStudioBlock ? (
                  <div className="property-section" data-testid="block-style-panel">
                    <div className="property-summary compact-property-summary">
                      <strong>{selectedStudioBlock.text.slice(0, 36)}</strong>
                      <span>Block / {selectedStudioBlock.itemType} / {selectedStudioBlock.guardStatus}</span>
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
            <div className={`overflow-status overflow-status-${overflow.status}`} data-testid="overflow-status">
              <strong>{overflow.status}</strong>
              <span>剩余 {Math.floor(overflow.remainingPx)}px</span>
            </div>
            {renderModel?.safety.ruleOnlyItemIds.length ? (
              <div className="warning-box">该分支包含 rule_only_verified 内容，工作台已显示校验状态；PDF 正文不会加入内部风险标签。</div>
            ) : null}
            {overflow.status === "near_limit" ? (
              <div className="warning-box">当前接近单页上限，建议导出前在打印预览中复核。</div>
            ) : null}
            {overflow.status === "overflow" ? (
              <div className="warning-box">
                <p>当前内容已超出 A4 单页，正式导出会被阻止。</p>
                {reductionHints.length > 0 ? (
                  <ul>
                    {reductionHints.map((hint) => <li key={hint}>{hint}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <button
              className="primary-button"
              onClick={exportPdf}
              disabled={!renderModel}
            >
              打印 / 保存 PDF
            </button>
            {renderResult.error ? <p className="save-status save-status-failed">{renderResult.error}</p> : null}
          </aside>

          <div className="resume-preview-stage">
            {renderModel ? (
              <A4ResumePreview
                model={renderModel}
                template={selectedTemplate}
                pageRef={pageRef}
                presentationConfig={presentationConfig}
                editor={resumeDocument ? {
                  enabled: isStudioEditMode,
                  selectedItemId: selectedStudioItemId,
                  editingItemId: editingStudioItemId,
                  selectedBlock: selectedStudioBlock,
                  draftText: studioDraftText,
                  error: studioError,
                  pending: Boolean(pendingStudioOperationId),
                  onSelect: selectStudioItem,
                  onStartEdit: startStudioEdit,
                  onDraftTextChange: setStudioDraftText,
                  onSave: saveStudioEdit,
                  onCancel: cancelStudioEdit,
                  onMoveUp: (itemId) => { void movePresentationItem(itemId, "up"); },
                  onMoveDown: (itemId) => { void movePresentationItem(itemId, "down"); },
                  onHide: (itemId) => { void setPresentationItemVisibility(itemId, false); }
                } : undefined}
              />
            ) : (
              <div className="panel no-print">当前分支不能进入正式模板预览。</div>
            )}
          </div>
        </section>
      ) : null}

      {selectedBranch ? (
        <section className="panel no-print">
          <h2>版本历史</h2>
          {revisions.length > 0 ? (
            <div className="revision-list">
              {revisions.map((revision) => (
                <article key={revision.id} className="review-row">
                  <span>
                    <strong>revision {revision.revisionNumber}</strong>
                    <small>{revision.source} / previous: {revision.previousRevisionId ?? "initial"}</small>
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
  if (!input.branch || !input.profile || !input.job) {
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
        : "预览阻止：分支内容无法通过正式渲染校验。"
    };
  }
}

function buildNextPresentationConfig(input: {
  current: ResumePresentationConfig;
  branch: ResumeBranch;
  patch: Partial<Pick<
    ResumePresentationConfig,
    "templateId" | "itemOrderBySection" | "hiddenItemIds" | "typography" | "spacing" | "theme" | "sectionOrder" | "sectionStyleOverrides"
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
    templateId: candidate.templateId === "classic-technical" || candidate.templateId === "modern-operations"
      ? candidate.templateId
      : undefined,
    stylePanelOpen: typeof candidate.stylePanelOpen === "boolean" ? candidate.stylePanelOpen : undefined
  };
}

function workbenchStateKey(profileId: string) {
  return `resumeWorkbenchState:${profileId}`;
}

function buildExportFileName(model: ResumeRenderModel, templateId: TemplateId) {
  const base = `${model.candidate.name}-${model.company}-${model.jobTitle}-${templateId}`;
  return `${base.replace(/[\\/:*?"<>|]/g, "-")}.pdf`;
}

function buildReductionHints(model: ResumeRenderModel) {
  return model.sections
    .flatMap((section) => section.blocks.map((block) => ({ section: section.title, block })))
    .sort((a, b) => b.block.text.length - a.block.text.length)
    .slice(0, 3)
    .map((item) => `${item.section}：优先压缩「${item.block.text.slice(0, 28)}...」`);
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

function propertyTabLabel(tab: PropertyPanelTab) {
  if (tab === "section") {
    return "Section";
  }
  if (tab === "block") {
    return "Block";
  }
  return "Document";
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
