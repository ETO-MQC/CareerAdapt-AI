"use client";

import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";
import { runResumeOcrAdapter } from "@/domain/resumeImport/ocrAdapter";
import {
  selectDocumentImportRoute,
  type DocumentImportRoutingDecision
} from "@/domain/resumeImport/routing";
import { createImportedResumeDraftFromText } from "@/domain/resumeImport/parser";
import { RESUME_JSON_MAX_CHARS } from "@/domain/resumeImport/jsonMapper";
import {
  adaptResumeJsonToV2,
  createResumeJsonV2Example
} from "@/domain/resumeImport/jsonV2Adapter";
import { auditResumeImportInvariants, resumeImportInvariantIssueCount } from "@/domain/resumeImport/invariants";
import { analyzeImportQuality, normalizeExtractedSourceBlocks, normalizedBlocksToText, RESUME_IMPORT_CLEANER_VERSION } from "@/domain/resumeImport/normalizer";
import { applyImportBulkSelection, type ImportBulkSelectionMode } from "@/domain/resumeImport/reviewSelections";
import {
  applyFieldCandidateToDraft,
  applyResumeImportReviewDecision,
  assertNoPlaceholderFieldCandidates,
  FieldCandidateApplyError
} from "@/domain/resumeImport/reviewDecisions";
import {
  ImportedResumeDraftSchema,
  ResumeItemV2Schema,
  type CareerProfile,
  type ExtractedSourceBlock,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeFieldCandidate,
  type ImportedResumeItem,
  type ResumeItemV2,
  type ImportedResumeSource,
  type ImportedResumeSectionType,
  type ImportMergeDecision,
  type ProfileReconciliationPlan,
  type ProfileReconciliationResolution,
  type PdfPageText
} from "@/domain/schemas";
import { containsUnresolvedSensitivePlaceholder, hashBytes, hashText } from "@/services/security/text";
import { RevisionConflictError, type WorkspaceRepository } from "@/services/storage/repositories";
import { notificationStore, notify } from "@/services/notifications/store";
import { getResumeFieldDefinition, type CanonicalFieldId } from "@/domain/resumeFields";
import {
  readDocumentRecognitionPreferences
} from "@/services/preferences/documentRecognition";
import {
  readResumeImportSemanticPreference,
  writeResumeImportSemanticPreference,
  type ResumeImportSemanticPreference
} from "@/services/preferences/resumeImportAi";
import {
  ResumeImportOrchestrator,
  ResumeImportOrchestratorError,
  type ResumeImportProgressStage
} from "@/services/resumeImport/ResumeImportOrchestrator";
import {
  ResumeDocumentSemanticMapper,
  ResumeDocumentSemanticMapperError,
  type ResumeMapperSafeDiagnostics
} from "@/services/resumeImport/ResumeDocumentSemanticMapper";

type ImportStatus =
  | "idle"
  | "validating_file"
  | "extracting_pdf"
  | "extracting_docx"
  | "extracting_text"
  | "extracting_ocr"
  | "importing_json"
  | "classifying_sections"
  | "reviewing"
  | "confirming"
  | "completed"
  | "failed"
  | "cancelled";

type BasicFieldKey = "name" | "email" | "phone" | "location" | "targetRole" | "summary";
const REVIEW_BASIC_FIELD_KEYS: BasicFieldKey[] = ["name", "email", "phone", "location", "targetRole", "summary"];
const MERGE_BASIC_FIELD_KEYS: Exclude<BasicFieldKey, "targetRole">[] = ["name", "email", "phone", "location", "summary"];

const SECTION_OPTIONS: Array<{ value: ImportedResumeSectionType; label: string }> = [
  { value: "summary", label: "个人概述" },
  { value: "education", label: "教育经历" },
  { value: "work", label: "工作经历" },
  { value: "internship", label: "实习经历" },
  { value: "project", label: "项目成果" },
  { value: "awards", label: "奖项" },
  { value: "skills", label: "技能" },
  { value: "certificates", label: "证书" },
  { value: "languages", label: "语言" },
  { value: "experience", label: "旧版经历（需拆分）" },
  { value: "unknown", label: "其他/待确认" }
];

export function ResumeImportWizard(props: {
  repository: WorkspaceRepository;
  profile?: CareerProfile;
  profiles?: CareerProfile[];
  initialImportId?: string;
  initialMode?: "file" | "json";
  initialTargetMode?: "existing" | "new";
  variant?: "resume" | "agent";
  onImported: (result: { profileId: string; branchId?: string }) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSelectedFileRef = useRef<File | undefined>(undefined);
  const fileIntentRef = useRef<"auto" | "pdf" | "docx" | "json" | "ocr">("auto");
  const abortRef = useRef<AbortController | undefined>(undefined);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState("文件仅在本地解析，写入前可核对。");
  const [draft, setDraft] = useState<ImportedResumeDraft | undefined>();
  const [pages, setPages] = useState<PdfPageText[]>([]);
  const [selectedPageNumber, setSelectedPageNumber] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [selectedBasicFieldKey, setSelectedBasicFieldKey] = useState<BasicFieldKey | undefined>();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | undefined>();
  const [editingCandidateId, setEditingCandidateId] = useState<string | undefined>();
  const [basicMergeActions, setBasicMergeActions] = useState<Record<string, ImportMergeDecision["action"]>>({});
  const [jsonText, setJsonText] = useState("");
  const [sourceMode, setSourceMode] = useState<"file" | "json">(props.initialMode ?? "file");
  const [semanticPreference, setSemanticPreference] = useState<ResumeImportSemanticPreference>(
    () => readResumeImportSemanticPreference()
  );
  const semanticModeRef = useRef<"ai" | "local">(
    readResumeImportSemanticPreference() === "ai" ? "ai" : "local"
  );
  const [pendingConsentImport, setPendingConsentImport] = useState<{
    file: File;
    intent: "auto" | "pdf" | "docx" | "json" | "ocr";
  }>();
  const [aiFailureRecovery, setAiFailureRecovery] = useState<{
    draft: ImportedResumeDraft;
    pages: PdfPageText[];
    routingDecision: DocumentImportRoutingDecision;
    errorCode?: string;
    diagnostics?: ResumeMapperSafeDiagnostics;
  }>();
  const [targetMode, setTargetMode] = useState<"existing" | "new">(props.initialTargetMode ?? (props.profile ? "existing" : "new"));
  const [targetProfileId, setTargetProfileId] = useState(props.profile?.id ?? "");
  const [newProfileName, setNewProfileName] = useState("");
  const [createGeneralResume, setCreateGeneralResume] = useState(true);
  const [reviewedUnclassifiedKeys, setReviewedUnclassifiedKeys] = useState<string[]>([]);
  const [reconciliationPlan, setReconciliationPlan] = useState<ProfileReconciliationPlan>();
  const [reconciliationStatus, setReconciliationStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [reconciliationEdits, setReconciliationEdits] = useState<Record<string, string>>({});
  const [reconciliationAttempt, setReconciliationAttempt] = useState(0);
  const [documentPreferences] = useState(() => readDocumentRecognitionPreferences());
  const [routeOverride, setRouteOverride] = useState<"text_layer" | "local_ocr" | "manual_review" | undefined>();
  const [routingDecision, setRoutingDecision] = useState<DocumentImportRoutingDecision>(() =>
    selectDocumentImportRoute({
      sourceKind: "pdf",
      preferences: readDocumentRecognitionPreferences()
    })
  );
  const selectionBaselineRef = useRef<ImportedResumeDraft | undefined>(undefined);
  const jsonErrorNotificationIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    async function restoreDraft() {
      const latest = props.initialImportId
        ? await props.repository.getImportedResumeDraft(props.initialImportId)
        : await props.repository.getLatestImportedResumeDraft();
      if (!active || !latest || (latest.status !== "reviewing" && latest.status !== "failed")) {
        return;
      }
      const restoredRouting = selectDocumentImportRoute({
        sourceKind: latest.sourceKind,
        preferences: documentPreferences,
        qualityReport: latest.qualityReport
      });
      const restoredPages = latest.source.sourceSessionId
        ? await props.repository.listPdfPageTexts(latest.source.sourceSessionId)
        : [];
      if (latest.status === "failed") {
        setDraft(undefined);
        setAiFailureRecovery({
          draft: latest,
          pages: restoredPages,
          routingDecision: restoredRouting,
          errorCode: "resume_import_previous_ai_failure"
        });
        setStatus("failed");
        setMessage("已恢复上次失败的来源文档，可重试 AI 或使用仅本地解析结果。");
        return;
      }
      if (containsUnresolvedSensitivePlaceholder(latest)) {
        // A malformed or legacy local record must never enter the Review
        // projection. Keep the value out of React state and require a safe
        // re-import instead.
        setDraft(undefined);
        setStatus("failed");
        setMessage("导入草稿中的敏感信息尚未恢复，已阻止进入核对页面，请重新导入。");
        return;
      }
      setDraft(latest);
      selectionBaselineRef.current = latest;
      setStatus("reviewing");
      setSelectedPageNumber(latest.pages[0]?.pageNumber ?? 1);
      if (latest.source.sourceSessionId) {
        setPages(restoredPages);
      }
      setMessage("已恢复未确认的简历导入草稿。");
      setRoutingDecision(restoredRouting);
    }
    void restoreDraft();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [documentPreferences, props.initialImportId, props.repository]);

  const selectedPage = useMemo(() => {
    return draft?.pages.find((page) => page.pageNumber === selectedPageNumber);
  }, [draft, selectedPageNumber]);
  const selectedItem = useMemo(() => {
    return draft?.sections.flatMap((section) => section.items).find((item) => item.id === selectedItemId);
  }, [draft, selectedItemId]);
  const selectedBasicMapping = selectedBasicFieldKey ? draft?.basics[selectedBasicFieldKey]?.mapping : undefined;
  const fieldCandidates = draft?.schemaVersion === "resume-import-v2"
    ? draft.fieldCandidates.filter((candidate) =>
        !containsUnresolvedSensitivePlaceholder(candidate.value)
        && !containsUnresolvedSensitivePlaceholder(candidate.sourceQuote)
      )
    : [];
  const selectedCandidate = fieldCandidates.find((candidate) => candidate.id === selectedCandidateId);
  const importableItemCount = useMemo(() => {
    return draft?.sections.flatMap((section) => section.items).filter((item) =>
      item.included && (item.sourceStatus === "located" || item.sourceStatus === "user_confirmed_modified")
    ).length ?? 0;
  }, [draft]);
  const fieldCandidateReviewCount = useMemo(() => {
    if (!draft) return 0;
    const fields = [draft.basics.name, draft.basics.email, draft.basics.phone, draft.basics.location, draft.basics.targetRole, draft.basics.summary, ...draft.basics.links];
    return fields.filter((field) => field?.mapping?.needsConfirmation).length
      + draft.sections.flatMap((section) => section.items).filter((item) => !item.structuredItem && item.mapping?.needsConfirmation).length
      + (draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates.filter((candidate) => candidate.reviewStatus === "needs_review").length : 0);
  }, [draft]);
  const invariantReport = useMemo(() => draft ? auditResumeImportInvariants(draft) : undefined, [draft]);
  const structureReviewCount = invariantReport?.semanticStructureReviewCount ?? 0;
  const structureConflictCount = invariantReport
    ? resumeImportInvariantIssueCount(invariantReport) - structureReviewCount
    : 0;
  const unreviewedUnclassifiedCount = draft?.unclassifiedBlocks.filter((block) =>
    !reviewedUnclassifiedKeys.includes(unclassifiedBlockKey(block))
  ).length ?? 0;
  const pendingReviewCount = fieldCandidateReviewCount + structureReviewCount + unreviewedUnclassifiedCount + structureConflictCount;
  const unsafeTextLayerBlocked = draft?.qualityReport?.recommendedRoute === "ocr_ai"
    && routingDecision.route !== "manual_review";
  const targetProfile = (props.profiles ?? []).find((item) => item.id === targetProfileId) ?? props.profile;
  const activeReconciliationPlan = reconciliationPlan
    && draft
    && reconciliationPlan.importId === draft.importId
    && reconciliationPlan.draftRevision === draft.revision
    && reconciliationPlan.profileId === targetProfileId
    ? reconciliationPlan
    : undefined;
  useEffect(() => {
    if (!draft || targetMode !== "existing" || !targetProfileId || pendingReviewCount > 0) {
      return;
    }
    if (
      reconciliationPlan?.importId === draft.importId
      && reconciliationPlan.draftRevision === draft.revision
      && reconciliationPlan.profileId === targetProfileId
    ) {
      return;
    }
    const sourceDraft = draft;
    const profileId = targetProfileId;
    let active = true;
    async function reconcile() {
      setReconciliationStatus("loading");
      try {
        const plan = await props.repository.reconcileImportedResume({
          importId: sourceDraft.importId,
          expectedDraftRevision: sourceDraft.revision,
          profileId
        });
        if (!active) return;
        setReconciliationPlan(plan);
        setReconciliationStatus("ready");
      } catch {
        if (!active) return;
        setReconciliationStatus("failed");
      }
    }
    void reconcile();
    return () => {
      active = false;
    };
  }, [
    draft,
    pendingReviewCount,
    props.repository,
    reconciliationAttempt,
    reconciliationPlan,
    targetMode,
    targetProfileId
  ]);
  const nameMismatch = targetMode === "existing" && Boolean(
    draft?.basics.name?.value
    && targetProfile?.basics.name
    && normalizeName(draft.basics.name.value) !== normalizeName(targetProfile.basics.name)
  );

  function prefillImportedProfileName(nextDraft: ImportedResumeDraft) {
    if (targetMode === "new" && !newProfileName.trim() && nextDraft.basics.name?.value) {
      setNewProfileName(nextDraft.basics.name.value);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (file) {
      lastSelectedFileRef.current = file;
      const intent = fileIntentRef.current;
      fileIntentRef.current = "auto";
      await beginSelectedImport(file, intent);
    }
    input.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      lastSelectedFileRef.current = file;
      await beginSelectedImport(file, "auto");
    }
  }

  async function beginSelectedImport(
    file: File,
    intent: "auto" | "pdf" | "docx" | "json" | "ocr"
  ) {
    const canonicalJson = isJsonFile(file)
      ? isCanonicalCareerAdaptJson(await file.text())
      : false;
    if (!canonicalJson && semanticPreference === "unset") {
      setPendingConsentImport({ file, intent });
      setMessage("请选择 AI 智能识别或仅本地解析后继续。");
      return;
    }
    await executeSelectedImport(file, intent, canonicalJson ? "local" : semanticModeRef.current);
  }

  async function executeSelectedImport(
    file: File,
    intent: "auto" | "pdf" | "docx" | "json" | "ocr",
    semanticMode: "ai" | "local"
  ) {
    semanticModeRef.current = semanticMode;
    setPendingConsentImport(undefined);
    setAiFailureRecovery(undefined);
    if (intent === "docx" || (intent === "auto" && isDocxFile(file))) {
      await startDocxImport(file);
    } else if (intent === "json" || (intent === "auto" && isJsonFile(file))) {
      await startJsonImport(await file.text(), file.name);
    } else if (intent === "ocr") {
      setRouteOverride("local_ocr");
      await startOcrImport(file, { fallbackToText: true });
    } else if (routeOverride === "local_ocr") {
      await startOcrImport(file, { fallbackToText: true });
    } else {
      await startFileImport(file, { modeOverride: routeOverride });
    }
  }

  async function confirmSemanticPreference(mode: "ai" | "local") {
    writeResumeImportSemanticPreference(mode);
    setSemanticPreference(mode);
    semanticModeRef.current = mode;
    const pending = pendingConsentImport;
    if (pending) {
      await executeSelectedImport(pending.file, pending.intent, mode);
    }
  }

  async function startFileImport(file: File, options: {
    modeOverride?: "text_layer" | "manual_review";
    skipExperimental?: boolean;
    routeReasonPrefix?: string;
  } = {}) {
    const effectivePreferences = options.modeOverride
      ? { ...documentPreferences, parsingMode: options.modeOverride }
      : documentPreferences;
    if (!options.modeOverride && documentPreferences.parsingMode === "local_ocr" && documentPreferences.localOcrEnabled) {
      await startOcrImport(file, { fallbackToText: true });
      return;
    }
    try {
      await prepareWithOrchestrator(file, effectivePreferences);
      if (options.routeReasonPrefix) {
        setRoutingDecision((current) => ({
          ...current,
          reason: `${options.routeReasonPrefix} ${current.reason}`
        }));
      }
    } catch (error) {
      if (
        error instanceof ResumeImportOrchestratorError
        && error.code === "resume_import_ocr_required"
        && effectivePreferences.localOcrEnabled
        && effectivePreferences.parsingMode === "auto"
      ) {
        await startOcrImport(file);
        return;
      }
      handleImportFailure(error, "PDF 导入失败。");
    }
  }

  async function startDocxImport(file: File) {
    try {
      await prepareWithOrchestrator(file, documentPreferences);
    } catch (error) {
      handleImportFailure(error, "DOCX 导入失败。");
    }
  }

  async function startOcrImport(file: File, options: {
    fallbackDraft?: ImportedResumeDraft;
    fallbackPages?: PdfPageText[];
    fallbackToText?: boolean;
  } = {}) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("extracting_ocr");
    setMessage("正在检查本机 PaddleOCR-VL；识别结果仍需逐项核对。");
    setRoutingDecision({
      route: "local_ocr",
      reason: "当前选择本地 PaddleOCR-VL；识别通常比文本解析更慢。",
      fallbackRoute: options.fallbackDraft || options.fallbackToText ? "pdfjs" : "manual_review",
      canUseOcr: true,
      ocrExpectedSlow: true,
      experimental: false
    });
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
    const result = await runResumeOcrAdapter(file, {
      signal: controller.signal,
      onProgress: (progress) => setMessage(progress.message)
    });
    if (!result.ok) {
      if (options.fallbackDraft) {
        setDraft(options.fallbackDraft);
        selectionBaselineRef.current = options.fallbackDraft;
        setPages(options.fallbackPages ?? []);
        setSelectedPageNumber(options.fallbackPages?.[0]?.pageNumber ?? 1);
        setStatus("reviewing");
        setRoutingDecision({
          route: "pdfjs",
          reason: `${result.message} 已自动回退到已有文本层；请重点人工核对。`,
          fallbackRoute: "manual_review",
          canUseOcr: false,
          ocrExpectedSlow: false,
          experimental: false
        });
        setMessage(`${result.message} 已保留 PDF.js 文本结果，未保存 OCR 输出。`);
        return;
      }
      if (options.fallbackToText) {
        setRouteOverride("text_layer");
        await startFileImport(file, {
          modeOverride: "text_layer",
          skipExperimental: true,
          routeReasonPrefix: `${result.message} 已自动回退到文本解析。`
        });
        return;
      }
      setRoutingDecision({
        route: "manual_review",
        reason: `${result.message} 已降级为人工核对；未保存 OCR 输出。`,
        canUseOcr: false,
        ocrExpectedSlow: false,
        experimental: false
      });
      fail(`${result.message}${result.warnings.length ? ` ${result.warnings.join("；")}` : ""} 可改用人工核对。`);
      return;
    }
    const fileHash = await hashBytes(new Uint8Array(await file.arrayBuffer()));
    await createDraftFromPlainText({
      fileName: file.name,
      mimeType: file.type === "image/png" ? "image/png" : file.type === "image/jpeg" ? "image/jpeg" : "application/pdf",
      fileHash,
      text: result.text,
      sourceKind: file.type === "application/pdf" ? "scanned_pdf" : "image",
      pageCount: result.pageCount,
      sourceBlocks: result.blocks.map((block): ExtractedSourceBlock => ({
        id: block.id,
        page: block.page,
        text: block.text,
        rawText: block.rawText,
        blockType: block.blockType,
        position: block.position,
        order: block.order,
        sourceEngine: "paddleocr_vl",
        sourceEngineVersion: result.engineVersion,
        extractionConfidence: block.confidence,
        sourceKind: file.type === "application/pdf" ? "scanned_pdf" : "image"
      })),
      successMessage: `本地 OCR 已完成（${result.pageCount} 页，${Math.round(result.elapsedMs / 100) / 10} 秒）；请逐项确认来源后再导入。`
    });
  }

  async function startJsonImport(rawText: string, fileName = "structured-resume.json") {
    try {
      const file = new File([rawText], fileName, { type: "application/json" });
      await prepareWithOrchestrator(file, documentPreferences);
      if (jsonErrorNotificationIdRef.current) notificationStore.dismiss(jsonErrorNotificationIdRef.current);
      jsonErrorNotificationIdRef.current = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入过程中发生未知错误";
      handleImportFailure(error, message);
      jsonErrorNotificationIdRef.current = notify({ type: "error", title: "导入失败", message });
    }
  }

  function handleImportFailure(error: unknown, fallbackMessage: string) {
    if (error instanceof ResumeImportOrchestratorError && error.fallbackResult) {
      setAiFailureRecovery({
        draft: error.fallbackResult.draft,
        pages: error.fallbackResult.pages,
          routingDecision: error.fallbackResult.routingDecision,
          errorCode: error.code,
          diagnostics: error.diagnostics
      });
    }
    fail(error instanceof Error ? error.message : fallbackMessage);
  }

  async function prepareWithOrchestrator(
    file: File,
    preferences: typeof documentPreferences
  ) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
      const prepared = await new ResumeImportOrchestrator(props.repository).prepare({
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      file
    }, {
      signal: controller.signal,
      preferences,
      semanticMode: semanticModeRef.current,
      onProgress: (progress) => {
        setStatus(importStatusFromProgress(progress.stage, file));
        setMessage(progress.message);
      }
    });
    selectionBaselineRef.current = prepared.draft;
    setDraft(prepared.draft);
    prefillImportedProfileName(prepared.draft);
    setPages(prepared.pages);
    setSelectedPageNumber(prepared.pages[0]?.pageNumber ?? 1);
    setRoutingDecision(prepared.routingDecision);
    setStatus("reviewing");
    setMessage(`已进入核对：识别 ${prepared.reviewSummary.itemCount} 项信息，其中 ${prepared.reviewSummary.needsReviewCount} 项需要核对。`);
  }

  async function createDraftFromPlainText(input: {
    fileName: string;
    mimeType: ImportedResumeSource["mimeType"];
    fileHash: string;
    text: string;
    sourceKind: "docx" | "text_pdf" | "scanned_pdf" | "image";
    pageCount?: number;
    sourceBlocks?: ExtractedSourceBlock[];
    successMessage: string;
  }) {
    setStatus("classifying_sections");
    const now = new Date().toISOString();
    const sourceBlocks = normalizeExtractedSourceBlocks(input.sourceBlocks ?? [{ id: `text-block-${nanoid(8)}`, text: input.text, rawText: input.text, blockType: "text_block", order: 0 }]);
    const normalizedText = normalizedBlocksToText(sourceBlocks);
    if (!normalizedText) {
      fail("未读取到可导入文本。");
      return;
    }
    const normalizedTextHash = await hashText(normalizedText);
    const pageRecords = await buildSyntheticPageTexts({
      fileName: input.fileName,
      pageTexts: input.sourceBlocks?.length
        ? Array.from({ length: input.pageCount ?? 1 }, (_, index) => normalizedBlocksToText(sourceBlocks.filter((block) => (block.page ?? 1) === index + 1)))
        : [normalizedText],
      now
    });
    const importedDraft = createImportedResumeDraftFromText({
      source: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileHash: input.fileHash,
        normalizedTextHash,
        pageCount: pageRecords.length,
        extractedAt: now
      },
      pages: pageRecords,
      sourceKind: input.sourceKind,
      sourceBlocks,
      qualityReport: analyzeImportQuality({ sourceType: input.sourceKind, blocks: sourceBlocks }),
      now
    });
    let finalDraft: ImportedResumeDraft = {
      ...importedDraft,
      parserVersion: `${importedDraft.parserVersion}+${RESUME_IMPORT_CLEANER_VERSION}`
    };
    if (semanticModeRef.current === "ai" && finalDraft.schemaVersion === "resume-import-v2") {
      try {
        finalDraft = await new ResumeDocumentSemanticMapper(props.repository).map(
          finalDraft,
          { signal: abortRef.current?.signal, onProgress: setMessage }
        );
      } catch (error) {
        if (!(error instanceof ResumeDocumentSemanticMapperError)) throw error;
        const failed = await props.repository.saveImportedResumeDraft(
          { ...finalDraft, status: "failed" },
          0
        );
        setAiFailureRecovery({
          draft: failed,
          pages: pageRecords,
          routingDecision,
          errorCode: error.code,
          diagnostics: error.diagnostics
        });
        fail(`${error.message} OCR 来源文档和本地解析结果已保留，可重试 AI 或改用仅本地解析。`);
        return;
      }
    }
    const saved = await props.repository.saveImportedResumeDraft(finalDraft, 0);
    setDraft(saved);
    prefillImportedProfileName(saved);
    setPages(pageRecords);
    setSelectedPageNumber(pageRecords[0]?.pageNumber ?? 1);
    setStatus("reviewing");
    setMessage(semanticModeRef.current === "ai"
      ? "AI 识别与字段来源校验已完成，现进入核对。"
      : input.successMessage);
  }

  async function retryAiMapping() {
    const recovery = aiFailureRecovery;
    if (!recovery || recovery.draft.schemaVersion !== "resume-import-v2") return;
    setStatus("classifying_sections");
    setMessage("AI 正在识别简历内容…");
    try {
      const mapped = await new ResumeDocumentSemanticMapper(props.repository).map(
        recovery.draft,
        { signal: abortRef.current?.signal, onProgress: setMessage }
      );
      const saved = await props.repository.saveImportedResumeDraft(
        { ...mapped, status: "reviewing" },
        recovery.draft.revision
      );
      showRecoveredDraft(saved, recovery.pages, recovery.routingDecision);
      setMessage("AI 识别与字段来源校验已完成，现进入核对。");
    } catch (error) {
      if (error instanceof ResumeDocumentSemanticMapperError) {
        setAiFailureRecovery((current) => current ? {
          ...current,
          errorCode: error.code,
          diagnostics: error.diagnostics
        } : current);
      }
      fail(error instanceof Error ? error.message : "AI 简历语义识别暂时不可用。");
    }
  }

  async function acceptLocalFallback() {
    const recovery = aiFailureRecovery;
    if (!recovery) return;
    const saved = await props.repository.saveImportedResumeDraft(
      { ...recovery.draft, status: "reviewing" },
      recovery.draft.revision
    );
    showRecoveredDraft(saved, recovery.pages, recovery.routingDecision);
    setMessage("已切换为仅本地解析结果，请逐项人工核对。");
  }

  function showRecoveredDraft(
    saved: ImportedResumeDraft,
    recoveredPages: PdfPageText[],
    recoveredRouting: DocumentImportRoutingDecision
  ) {
    selectionBaselineRef.current = saved;
    setDraft(saved);
    prefillImportedProfileName(saved);
    setPages(recoveredPages);
    setSelectedPageNumber(recoveredPages[0]?.pageNumber ?? 1);
    setRoutingDecision(recoveredRouting);
    setAiFailureRecovery(undefined);
    setStatus("reviewing");
  }

  async function patchDraft(updater: (current: ImportedResumeDraft) => ImportedResumeDraft) {
    if (!draft) {
      return;
    }
    const previous = draft;
    const next = ImportedResumeDraftSchema.parse(updater(draft));
    if (containsUnresolvedSensitivePlaceholder(next)) {
      setMessage("敏感信息恢复未完成，已阻止保存该核对状态。");
      throw new Error("resume_import_unresolved_sensitive_placeholder");
    }
    assertNoPlaceholderFieldCandidates(next);
    setDraft(next);
    try {
      const saved = await props.repository.saveImportedResumeDraft(next, previous.revision);
      setDraft(saved);
    } catch (error) {
      setDraft(previous);
      setMessage(error instanceof RevisionConflictError ? "保存失败：导入草稿已变化，请刷新后重试。" : "保存失败：请检查本地数据状态后重试。");
      throw error;
    }
  }

  async function updateBasicField(key: BasicFieldKey, value: string) {
    if (!draft) {
      return;
    }
    const current = draft.basics[key];
    const nextField: ImportedResumeField | undefined = value.trim()
      ? {
          value: value.trim(),
          pageRefs: current?.pageRefs ?? [],
          confidence: current?.confidence ?? "medium",
          sourceStatus: current?.value === value.trim() ? current.sourceStatus : "user_confirmed_modified",
          userEdited: current?.value !== value.trim(),
          userConfirmed: current?.value === value.trim() ? current?.userConfirmed : false,
          sourceBlockIds: current?.sourceBlockIds ?? [],
          sourceRanges: current?.sourceRanges,
          sourceQuote: current?.sourceQuote ?? current?.value,
          mapping: current?.mapping ? { ...current.mapping, needsConfirmation: false } : undefined
        }
      : undefined;
    await patchDraft((currentDraft) => ({
      ...currentDraft,
      basics: {
        ...currentDraft.basics,
        [key]: nextField
      }
    }));
  }

  async function confirmBasicMapping(key: BasicFieldKey) {
    await patchDraft((current) => {
      const field = current.basics[key];
      if (!field?.mapping) return current;
      return { ...current, basics: { ...current.basics, [key]: { ...field, sourceStatus: "user_confirmed_modified", userConfirmed: true, mapping: { ...field.mapping, needsConfirmation: false } } } };
    });
  }

  async function confirmFieldCandidate(candidateId: string) {
    await patchDraft((current) => {
      if (current.schemaVersion !== "resume-import-v2") return current;
      const candidate = current.fieldCandidates.find((item) => item.id === candidateId);
      return candidate ? applyFieldCandidateToDraft(current, candidate, "accept") : current;
    });
  }

  async function rejectFieldCandidate(candidateId: string) {
    await patchDraft((current) => {
      if (current.schemaVersion !== "resume-import-v2") return current;
      const candidate = current.fieldCandidates.find((item) => item.id === candidateId);
      if (!candidate) return current;
      return applyFieldCandidateToDraft(current, candidate, "reject");
    });
    setEditingCandidateId(undefined);
  }

  async function editFieldCandidate(candidateId: string, rawValue: string) {
    await patchDraft((current) => {
      if (current.schemaVersion !== "resume-import-v2") return current;
      const candidate = current.fieldCandidates.find((item) => item.id === candidateId);
      if (!candidate) return current;
      const value = parseEditedCandidateValue(candidate.value, rawValue);
      return applyFieldCandidateToDraft(current, candidate, { type: "edit", value });
    });
    setEditingCandidateId(undefined);
  }

  async function confirmItemMapping(sectionId: string, itemId: string) {
    await updateItem(sectionId, itemId, {
      included: true,
      sourceStatus: "user_confirmed_modified",
      userEdited: false,
      userConfirmed: true,
      mapping: draft?.sections.flatMap((section) => section.items).find((item) => item.id === itemId)?.mapping
        ? { ...draft.sections.flatMap((section) => section.items).find((item) => item.id === itemId)!.mapping!, needsConfirmation: false }
        : undefined
    });
  }

  async function discardStructuredItem(sectionId: string, itemId: string) {
    await updateItem(sectionId, itemId, {
      included: false,
      sourceStatus: "user_confirmed_modified",
      userEdited: false,
      userConfirmed: false
    });
  }

  async function confirmCurrentSemanticStructure() {
    if (!draft) return;
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => item.structuredItem
          && item.sourceStatus === "ambiguous"
          && hasCompleteItemSource(item)
          && !hasItemSourceConflict(current, item)
          ? {
              ...item,
              included: true,
              sourceStatus: "user_confirmed_modified" as const,
              userEdited: false,
              userConfirmed: true,
              mapping: item.mapping ? { ...item.mapping, needsConfirmation: false } : undefined
            }
          : item)
      }))
    }));
  }

  async function confirmAllMappings() {
    if (!draft) return;
    await patchDraft((current) => applyResumeImportReviewDecision(current, "accept_all"));
  }

  async function applyBulkSelection(mode: ImportBulkSelectionMode, sectionId?: string) {
    if (!draft) return;
    await patchDraft((current) => applyImportBulkSelection({
      draft: current,
      baseline: selectionBaselineRef.current,
      mode,
      sectionId,
      profile: props.profile
    }));
    if (!sectionId) {
      if (mode === "keep_existing" || mode === "reset") setBasicMergeActions({});
    }
  }

  async function updateSectionType(sectionId: string, sectionType: ImportedResumeSectionType) {
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              sectionType,
              included: sectionType !== "unknown" || section.included,
              confidence: sectionType === "unknown" ? "low" : "medium"
            }
          : section
      )
    }));
  }

  async function updateSectionIncluded(sectionId: string, included: boolean) {
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => section.id === sectionId ? { ...section, included } : section)
    }));
  }

  async function updateItem(sectionId: string, itemId: string, patch: Partial<ImportedResumeItem>) {
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => item.id === itemId ? { ...item, ...patch } : item)
            }
          : section
      )
    }));
  }

  async function editItemText(sectionId: string, item: ImportedResumeItem, value: string) {
    const text = value.trim();
    if (!text) {
      return;
    }
    await updateItem(sectionId, item.id, {
      normalizedText: item.structuredItem ? item.normalizedText : text,
      structuredItem: item.structuredItem ? updateStructuredItemBody(item.structuredItem, text) : undefined,
      sourceStatus: text === item.rawText.trim() ? item.sourceStatus : "user_confirmed_modified",
      userEdited: text !== item.rawText.trim(),
      userConfirmed: text === item.rawText.trim() ? item.userConfirmed : false,
      confidence: text === item.rawText.trim() ? item.confidence : "medium"
    });
  }

  async function moveItem(sectionId: string, itemId: string, direction: "up" | "down") {
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) {
          return section;
        }
        const index = section.items.findIndex((item) => item.id === itemId);
        const target = direction === "up" ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= section.items.length) {
          return section;
        }
        const items = [...section.items];
        [items[index], items[target]] = [items[target], items[index]];
        return {
          ...section,
          items: items.map((item, order) => ({ ...item, order }))
        };
      })
    }));
  }

  async function mergeWithNext(sectionId: string, itemId: string) {
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) {
          return section;
        }
        const index = section.items.findIndex((item) => item.id === itemId);
        const next = section.items[index + 1];
        if (index < 0 || !next) {
          return section;
        }
        const currentItem = section.items[index];
        const merged: ImportedResumeItem = {
          ...currentItem,
          rawText: `${currentItem.rawText}\n${next.rawText}`,
          normalizedText: `${currentItem.normalizedText}\n${next.normalizedText}`,
          pageRefs: [...currentItem.pageRefs, ...next.pageRefs],
          sourceStatus: currentItem.sourceStatus === "located" && next.sourceStatus === "located" ? "located" : "user_confirmed_modified",
          userEdited: true,
          userConfirmed: false,
          confidence: "medium"
        };
        return {
          ...section,
          items: [
            ...section.items.slice(0, index),
            merged,
            ...section.items.slice(index + 2)
          ].map((item, order) => ({ ...item, order }))
        };
      })
    }));
  }

  async function splitItem(sectionId: string, item: ImportedResumeItem) {
    const parts = item.normalizedText.split(/\n|[；;]/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) {
      setMessage("当前条目没有可安全拆分的换行或分号。");
      return;
    }
    await patchDraft((current) => ({
      ...current,
      sections: current.sections.map((section) => {
        if (section.id !== sectionId) {
          return section;
        }
        const index = section.items.findIndex((candidate) => candidate.id === item.id);
        if (index < 0) {
          return section;
        }
        const splitItems = parts.map((part) => ({
          ...item,
          id: `import-item-${nanoid(10)}`,
          rawText: part,
          normalizedText: part,
          sourceStatus: "user_confirmed_modified" as const,
          userEdited: true,
          userConfirmed: false,
          confidence: "medium" as const
        }));
        return {
          ...section,
          items: [
            ...section.items.slice(0, index),
            ...splitItems,
            ...section.items.slice(index + 1)
          ].map((nextItem, order) => ({ ...nextItem, order }))
        };
      })
    }));
  }

  async function confirmImport() {
    if (!draft || (importableItemCount === 0 && (targetMode !== "new" || createGeneralResume))) {
      setMessage("没有可导入的已定位或用户确认条目。");
      return;
    }
    if (unsafeTextLayerBlocked) {
      setMessage("文本层可信度过低，已阻止直接提交。请改用本地 OCR 或仅人工核对。");
      return;
    }
    if (targetMode === "existing" && !targetProfileId) {
      setMessage("请选择要导入到的已有人物。");
      return;
    }
    if (targetMode === "new" && !newProfileName.trim()) {
      setMessage("请填写新人物名称。");
      return;
    }
    if (nameMismatch && basicMergeActions.name !== "keep_existing") {
      setMessage("导入姓名与当前人物不一致，请改为新人物或明确继续导入当前人物。");
      return;
    }
    if (pendingReviewCount > 0) {
      setMessage(`仍有 ${pendingReviewCount} 项来源、映射或结构问题需要处理。`);
      notify({ type: "warning", title: "仍需核对", message: `请先处理 ${pendingReviewCount} 项来源、映射或结构问题。` });
      return;
    }
    if (targetMode === "existing" && (
      reconciliationStatus !== "ready"
      || !activeReconciliationPlan
      || activeReconciliationPlan.summary.requiresReview > 0
    )) {
      setMessage(reconciliationStatus === "loading"
        ? "正在比对资料库，请稍候。"
        : `仍有 ${activeReconciliationPlan?.summary.requiresReview ?? 0} 项资料库冲突或近似重复需要确认。`);
      return;
    }
    setStatus("confirming");
    try {
      const result = await props.repository.confirmImportedResume({
        importId: draft.importId,
        expectedDraftRevision: draft.revision,
        operationId: `resume-import-confirm-${draft.importId}`,
        mergeDecisions: buildMergeDecisions(),
        expectedReconciliationRevision: targetMode === "existing" ? activeReconciliationPlan?.revision : undefined,
        target: targetMode === "existing"
          ? { mode: "existing", profileId: targetProfileId }
          : { mode: "new", profileName: newProfileName.trim(), createGeneralResume }
      });
      setStatus("completed");
      setMessage(result.branchId ? (result.idempotent ? "该导入已确认过，已打开现有通用简历。" : "已确认导入，并创建通用简历分支。") : "已确认导入并创建人物资料。");
      notify({ type: "success", title: "导入成功", message: result.branchId ? (result.idempotent ? "已打开现有通用简历。" : "已创建通用简历和首个版本。") : "已创建人物资料，未创建简历。" });
      await props.onImported({ profileId: result.profileId, branchId: result.branchId });
    } catch (error) {
      setStatus("reviewing");
      const diagnostic = classifyImportConfirmError(error);
      if (process.env.NODE_ENV === "development") {
        console.error("[resume-import-confirm]", {
          code: diagnostic.code,
          importId: draft.importId,
          revision: draft.revision,
          candidateId: error instanceof FieldCandidateApplyError ? error.candidateId : undefined,
          targetFieldId: error instanceof FieldCandidateApplyError ? error.targetFieldId : undefined,
          invariant: diagnostic.invariant
        });
      }
      setMessage(diagnostic.message);
    }
  }

  async function resolveReconciliation(
    incomingItemId: string,
    resolution: ProfileReconciliationResolution
  ) {
    if (!draft || !activeReconciliationPlan) return;
    const editedValue = resolution === "edit_value"
      ? reconciliationEdits[incomingItemId]?.trim()
      : undefined;
    if (resolution === "edit_value" && !editedValue) {
      setMessage("请先填写编辑后的值。");
      return;
    }
    try {
      const next = await props.repository.resolveProfileReconciliation({
        importId: draft.importId,
        expectedPlanRevision: activeReconciliationPlan.revision,
        incomingItemId,
        resolution,
        editedValue
      });
      setReconciliationPlan(next);
      setReconciliationStatus("ready");
      const candidate = next.candidates.find((item) => item.incomingItemId === incomingItemId);
      const field = candidate?.entityType === "basic" ? candidate.normalizedFields.field : undefined;
      if (field && ["name", "email", "phone", "location", "summary"].includes(field)) {
        setBasicMergeActions((current) => ({
          ...current,
          [field]: resolution === "use_imported" || resolution === "edit_value"
            ? "use_imported"
            : "keep_existing"
        }));
      }
    } catch (error) {
      setMessage(error instanceof RevisionConflictError
        ? "资料库已变化，正在重新生成核对计划。"
        : "无法保存当前核对决定，请重试。");
      setReconciliationPlan(undefined);
      setReconciliationStatus("idle");
    }
  }

  async function cancelImport() {
    abortRef.current?.abort();
    if (draft) {
      await props.repository.cancelImportedResumeDraft(draft.importId, draft.revision);
    }
    setStatus("cancelled");
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
    setMessage("已取消当前导入。");
  }

  function buildMergeDecisions(): ImportMergeDecision[] {
    if (!draft || targetMode !== "existing" || !targetProfile) {
      return [];
    }
    return MERGE_BASIC_FIELD_KEYS
      .flatMap((key) => {
        const imported = draft.basics[key]?.value;
        const existing = targetProfile.basics[key];
        if (!imported || !existing || imported === existing) {
          return [];
        }
        return [{
          target: key,
          importedValue: imported,
          action: basicMergeActions[key] ?? "keep_existing"
        }];
      });
  }

  function fail(text: string) {
    setStatus("failed");
    setMessage(text);
  }

  function downloadSampleJson() {
    const blob = new Blob([JSON.stringify(sampleResumeJsonV2(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "careeradapt-structured-resume-sample.json";
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function chooseImportRoute(mode: "text_layer" | "local_ocr" | "manual_review") {
    setRouteOverride(mode);
    const file = lastSelectedFileRef.current;
    const preferences = { ...documentPreferences, parsingMode: mode };
    setRoutingDecision(selectDocumentImportRoute({
      sourceKind: file && isDocxFile(file) ? "docx" : "pdf",
      preferences
    }));
    if (!file) {
      setMessage("路线已选择；请选择文件继续。");
      return;
    }
    if (mode === "local_ocr") {
      await startOcrImport(file, { fallbackToText: true });
      return;
    }
    await startFileImport(file, { modeOverride: mode });
  }

  return (
    <section
      className={`resume-import-wizard no-print ${draft ? "resume-import-wizard-review" : ""} ${props.variant === "agent" ? "resume-import-wizard-agent" : ""}`}
      aria-busy={["validating_file", "extracting_pdf", "extracting_docx", "extracting_text", "extracting_ocr", "importing_json", "classifying_sections", "confirming"].includes(status)}
    >
      <p className="visually-hidden" role="status" aria-live="polite">{importStatusLabel(status)}。{message}</p>
      <input ref={fileInputRef} className="visually-hidden" type="file" name="resume-file" aria-label="选择要导入的简历文件" accept={RESUME_IMPORT_ACCEPT} onChange={handleFileChange} />
      <fieldset className="import-target-picker">
        <legend>导入目标</legend>
        <div className="import-target-options">
          <label className={targetMode === "existing" ? "import-target-option active" : "import-target-option"}>
            <input type="radio" name="import-target" checked={targetMode === "existing"} disabled={(props.profiles ?? []).length === 0 && !props.profile} onChange={() => { setTargetMode("existing"); setBasicMergeActions((current) => ({ ...current, name: "keep_existing" })); }} />
            导入到已有资料
          </label>
          <label className={targetMode === "new" ? "import-target-option active" : "import-target-option"}>
            <input type="radio" name="import-target" checked={targetMode === "new"} onChange={() => { setTargetMode("new"); if (!newProfileName.trim() && draft?.basics.name?.value) setNewProfileName(draft.basics.name.value); }} />
            创建新人物
          </label>
        </div>
        {targetMode === "existing" ? (
          <label className="import-target-field">目标人物
            <select name="import-target-profile" value={targetProfileId} onChange={(event) => setTargetProfileId(event.target.value)}>
              {(props.profiles?.length ? props.profiles : props.profile ? [props.profile] : []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
          </label>
        ) : (
          <div className="import-new-profile-fields">
            <label className="import-target-field">人物名称<input name="new-profile-name" autoComplete="off" value={newProfileName} onChange={(event) => setNewProfileName(event.target.value)} placeholder="将从导入姓名预填" /></label>
            <label className="inline-toggle"><input name="import-create-general-resume" type="checkbox" checked={createGeneralResume} onChange={(event) => setCreateGeneralResume(event.target.checked)} />同时创建通用简历</label>
          </div>
        )}
        {nameMismatch ? <p className="import-target-warning" role="alert">导入姓名与当前人物不一致，请重新选择“导入到已有资料”以保留当前姓名，或选择“创建新人物”。</p> : null}
      </fieldset>
      <section
        className={`import-routing-panel import-recognition-panel ai-mapping-consent ${draft ? "import-routing-panel-compact" : ""}`}
        aria-labelledby="resume-recognition-title"
      >
        {draft ? (
          <>
            <strong id="resume-recognition-title">识别方式</strong>
            <div className="import-recognition-status" aria-label="已使用的识别方式">
              <span>{documentImportRouteLabel(routingDecision.route)}</span>
              <span>{semanticModeRef.current === "ai" ? "AI 智能识别" : "仅本地"}</span>
            </div>
            {documentPreferences.allowManualRouteSelection ? (
              <details className="import-route-actions">
                <summary className="secondary-button compact">路线详情</summary>
                <div>
                  <p>{routingDecision.reason}</p>
                  <button type="button" onClick={() => { void chooseImportRoute("text_layer"); }}>PDF.js 文本层</button>
                  <button type="button" disabled={!documentPreferences.localOcrEnabled} onClick={() => { void chooseImportRoute("local_ocr"); }}>本地 OCR</button>
                  <button type="button" onClick={() => { void chooseImportRoute("manual_review"); }}>人工核对</button>
                </div>
              </details>
            ) : null}
          </>
        ) : (
          <>
            <div className="import-recognition-main">
              <strong id="resume-recognition-title">识别方式</strong>
              <div className="import-recognition-modes" role="group" aria-label="简历识别方式">
                <button
                  className={semanticPreference === "ai" ? "active" : ""}
                  type="button"
                  aria-label="使用 AI 智能识别"
                  aria-pressed={semanticPreference === "ai"}
                  onClick={() => { void confirmSemanticPreference("ai"); }}
                >
                  <span aria-hidden="true">✦</span> AI 智能识别 · 推荐
                </button>
                <button
                  className={semanticPreference === "local" ? "active" : ""}
                  type="button"
                  aria-pressed={semanticPreference === "local"}
                  onClick={() => { void confirmSemanticPreference("local"); }}
                >
                  仅本地
                </button>
              </div>
              <div className="import-recognition-privacy">
                <span>本地提取并脱敏后由 AI 整理结构 · 原始文件不发送</span>
                <details>
                  <summary>隐私说明</summary>
                  <p>仅发送脱敏后的文本与必要布局信息；电话、邮箱、身份证号、详细地址及高置信姓名优先在本地替换。</p>
                </details>
              </div>
            </div>
            <details className="import-recognition-advanced">
              <summary>高级设置</summary>
              <div>
                <span className={!routeOverride ? "active" : ""}>自动提取</span>
                <button type="button" onClick={() => { void chooseImportRoute("text_layer"); }}>PDF.js 文本层</button>
                <button type="button" disabled={!documentPreferences.localOcrEnabled} onClick={() => { void chooseImportRoute("local_ocr"); }}>本地 OCR</button>
                <button type="button" onClick={() => { void chooseImportRoute("manual_review"); }}>人工核对</button>
              </div>
            </details>
            {pendingConsentImport ? <p className="import-recognition-note" role="status">已读取文件，请选择识别方式继续。</p> : null}
            {aiFailureRecovery ? (
              <div className="import-recognition-recovery" role="alert">
                <span>
                  <strong>{aiFailureRecovery.diagnostics?.safeErrorCode === "model_schema_invalid" ? "● 结构校验未通过" : "● AI 识别未完成"}</strong>
                  {aiFailureRecovery.diagnostics?.safeErrorCode === "model_schema_invalid" ? "模型输出格式需要修正" : message}
                </span>
                <div>
                  <button className="primary-button compact" type="button" onClick={() => { void retryAiMapping(); }}>重试</button>
                  <button className="secondary-button compact" type="button" onClick={() => { void acceptLocalFallback(); }}>使用本地结果</button>
                </div>
                {aiFailureRecovery.errorCode ? (
                  <details>
                    <summary>查看技术详情</summary>
                    <dl className="import-recognition-diagnostics" translate="no">
                      <div><dt>safeErrorCode</dt><dd>{aiFailureRecovery.diagnostics?.safeErrorCode ?? aiFailureRecovery.errorCode}</dd></div>
                      {aiFailureRecovery.diagnostics?.provider ? <div><dt>provider/model</dt><dd>{aiFailureRecovery.diagnostics.provider} / {aiFailureRecovery.diagnostics.model ?? "unknown"}</dd></div> : null}
                      {aiFailureRecovery.diagnostics?.attempt ? <div><dt>attempt</dt><dd>{aiFailureRecovery.diagnostics.attempt}</dd></div> : null}
                      {aiFailureRecovery.diagnostics?.latencyMs !== undefined ? <div><dt>latency</dt><dd>{aiFailureRecovery.diagnostics.latencyMs}ms</dd></div> : null}
                      {aiFailureRecovery.diagnostics?.failedIssues.map((issue, index) => (
                        <div key={`${issue.path}-${issue.code}-${index}`}>
                          <dt>{issue.path || "&lt;root&gt;"}</dt>
                          <dd>{issue.code}{issue.unrecognizedKeys?.length ? ` (${issue.unrecognizedKeys.join(", ")})` : ""}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
      {!draft && sourceMode === "file" ? (
        <div
          className="import-dropzone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          role="button"
          tabIndex={0}
          onClick={() => {
            fileIntentRef.current = "auto";
            fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              fileIntentRef.current = "auto";
              fileInputRef.current?.click();
            }
          }}
        >
          <span className="import-dropzone-icon" aria-hidden="true">↑</span>
          <strong>拖放简历到这里</strong>
          <span>PDF · DOCX · MD · TXT · JSON</span>
          {!aiFailureRecovery && status !== "idle" ? <small>{importStatusLabel(status)} · {message}</small> : null}
        </div>
      ) : null}

      {!draft ? <div className="import-entry-secondary-actions" aria-label="辅助导入工具">
        <details
          className="import-json-details"
          open={sourceMode === "json"}
          onToggle={(event) => setSourceMode(event.currentTarget.open ? "json" : "file")}
        >
          <summary>粘贴 JSON</summary>
          <textarea
            className="textarea compact-textarea"
            aria-label="JSON 内容"
            name="resume-json"
            autoComplete="off"
            spellCheck={false}
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            placeholder={JSON.stringify(sampleResumeJsonV2(), null, 2)}
          />
          <p className={status === "failed" ? "import-json-feedback import-json-feedback-error" : "import-json-feedback"} role={status === "failed" ? "alert" : "status"}>
            {!jsonText.trim() ? "请先粘贴 JSON 内容。" : jsonText.length > RESUME_JSON_MAX_CHARS ? `JSON 内容超过 ${RESUME_JSON_MAX_CHARS.toLocaleString("zh-CN")} 个字符，请拆分后重试。` : message} 当前 {jsonText.length.toLocaleString("zh-CN")} / {RESUME_JSON_MAX_CHARS.toLocaleString("zh-CN")} 字符。
          </p>
          <div className="action-row">
            <button type="button" className="primary-button compact" disabled={!jsonText.trim() || jsonText.length > RESUME_JSON_MAX_CHARS || status === "importing_json"} onClick={() => {
              void beginSelectedImport(
                new File([jsonText], "pasted-structured-resume.json", { type: "application/json" }),
                "json"
              );
            }}>导入 JSON</button>
            <button type="button" className="secondary-button compact" onClick={() => setJsonText(JSON.stringify(sampleResumeJsonV2(), null, 2))}>填入示例</button>
            <button className="secondary-button compact" type="button" onClick={downloadSampleJson}>下载示例</button>
          </div>
        </details>
        {sourceMode !== "json" ? (
          <button className="secondary-button compact" type="button" onClick={() => {
            fileIntentRef.current = "ocr";
            fileInputRef.current?.click();
          }} disabled={!documentPreferences.localOcrEnabled || status === "extracting_ocr" || status === "confirming"}>
            扫描件导入
          </button>
        ) : null}
        <a className="secondary-button compact" href="/settings">导入设置</a>
        {draft || ["extracting_pdf", "extracting_docx", "extracting_text", "extracting_ocr", "importing_json"].includes(status) ? (
          <button className="secondary-button compact" type="button" onClick={cancelImport} disabled={status === "confirming"}>
            取消当前导入
          </button>
        ) : null}
      </div> : null}

      {draft ? (
        <>
        <div className="import-review-toolbar">
          <div>
            <h3>核对结构</h3>
            <span>{pendingReviewCount} 项待处理</span>
            <span>字段候选 {fieldCandidateReviewCount} 项待确认 · 结构条目 {structureReviewCount} 项待确认 · 未识别来源 {unreviewedUnclassifiedCount} 项 · 结构冲突 {structureConflictCount} 项</span>
          </div>
          {structureReviewCount > 0 ? <button className="secondary-button compact" type="button" onClick={() => { void confirmCurrentSemanticStructure(); }}>确认全部当前结构</button> : null}
          <details className="import-bulk-menu"><summary className="secondary-button compact">批量操作</summary><div>
            <button type="button" onClick={() => { void applyBulkSelection("use_imported"); }}>全部使用安全导入项</button>
            {targetMode === "existing" ? <button type="button" onClick={() => { void applyBulkSelection("keep_existing"); }}>全部保留现有</button> : null}
            <button type="button" onClick={() => { void applyBulkSelection("safe_only"); }}>仅使用无冲突项</button>
            <button type="button" onClick={() => { void applyBulkSelection("reset"); }}>重置选择</button>
          </div></details>
        </div>
        {targetMode === "existing" && pendingReviewCount === 0 ? (
          <section className="profile-reconciliation-review" aria-label="资料库导入核对">
            <div className="profile-reconciliation-heading">
              <div>
                <h3>导入概览</h3>
                <p>{reconciliationStatus === "loading"
                  ? "正在与现有资料库进行确定性比对…"
                  : reconciliationStatus === "failed"
                    ? "比对计划加载失败，请重试后再确认导入。"
                    : "只需处理近似重复或真实字段冲突。"}</p>
              </div>
              {reconciliationStatus === "failed" ? <button className="secondary-button compact" type="button" onClick={() => setReconciliationAttempt((value) => value + 1)}>重新比对</button> : null}
            </div>
            {activeReconciliationPlan ? (
              <>
                <dl className="profile-reconciliation-summary">
                  <div><dt>新增</dt><dd>{activeReconciliationPlan.summary.newFacts}</dd></div>
                  <div><dt>已存在</dt><dd>{activeReconciliationPlan.summary.existing}</dd></div>
                  <div><dt>融合来源</dt><dd>{activeReconciliationPlan.summary.mergedEvidence}</dd></div>
                  <div><dt>需确认</dt><dd>{activeReconciliationPlan.summary.requiresReview}</dd></div>
                </dl>
                {activeReconciliationPlan.decisions.filter((decision) =>
                  decision.requiresUserConfirmation
                  && !activeReconciliationPlan.reviewUnits.find((unit) => unit.incomingItemId === decision.incomingItemId)?.resolved
                ).map((decision) => {
                  const candidate = activeReconciliationPlan.candidates.find((item) => item.incomingItemId === decision.incomingItemId);
                  const conflictFields = decision.fieldComparisons.filter((comparison) =>
                    comparison.relation === "conflicting" || comparison.relation === "different"
                  );
                  return (
                    <article className="profile-reconciliation-item" key={decision.incomingItemId}>
                      <header>
                        <div><strong>{candidate?.displayLabel ?? "待核对内容"}</strong><span>{decision.state === "conflict" ? "字段冲突" : "可能重复"}</span></div>
                        <small>{Math.round(decision.confidence * 100)}% 匹配</small>
                      </header>
                      {conflictFields.length ? <dl className="profile-reconciliation-comparison">
                        {conflictFields.map((comparison) => <div key={comparison.field}>
                          <dt>{comparison.field}</dt>
                          <dd><span>资料库</span>{comparison.existingValue ?? "—"}</dd>
                          <dd><span>本次导入</span>{comparison.incomingValue ?? "—"}</dd>
                        </div>)}
                      </dl> : null}
                      <div className="profile-reconciliation-actions">
                        <button type="button" onClick={() => { void resolveReconciliation(decision.incomingItemId, "keep_existing"); }}>保留原数据</button>
                        <button type="button" onClick={() => { void resolveReconciliation(decision.incomingItemId, "use_imported"); }}>采用本次</button>
                        <button type="button" onClick={() => { void resolveReconciliation(decision.incomingItemId, "keep_both_as_distinct"); }}>视为不同经历</button>
                        <label><span className="visually-hidden">编辑后的值</span><input type="text" value={reconciliationEdits[decision.incomingItemId] ?? ""} placeholder="编辑值" onChange={(event) => setReconciliationEdits((current) => ({ ...current, [decision.incomingItemId]: event.target.value }))} /></label>
                        <button type="button" onClick={() => { void resolveReconciliation(decision.incomingItemId, "edit_value"); }}>保存编辑</button>
                      </div>
                    </article>
                  );
                })}
              </>
            ) : null}
          </section>
        ) : null}
        <div className="import-review-grid">
          <aside className="import-source-panel">
            <div className="section-heading compact-heading">
              <h3>字段来源</h3>
              <div className="action-row">
                {draft.pages.map((page) => (
                  <button
                    type="button"
                    key={page.pageNumber}
                    className={page.pageNumber === selectedPageNumber ? "primary-button compact" : "secondary-button compact"}
                    aria-label={`查看第 ${page.pageNumber} 页来源`}
                    aria-current={page.pageNumber === selectedPageNumber ? "page" : undefined}
                    onClick={() => setSelectedPageNumber(page.pageNumber)}
                  >
                    {page.pageNumber}
                  </button>
                ))}
              </div>
            </div>
            <div className="import-trace-summary" role="status">
              <span><strong>{sourceKindLabel(draft.sourceKind)}</strong>{draft.sourceBlocks.length} 个来源块</span>
              <span><strong>{pipelineRouteLabel(draft)}</strong>{fieldCandidates.length} 个字段候选</span>
              <span><strong>{draft.unclassifiedBlocks.length ? "有保留项" : "无遗漏项"}</strong>{draft.unclassifiedBlocks.length} 个未识别来源</span>
            </div>
            <pre className="import-source-text" tabIndex={0} aria-label={`第 ${selectedPageNumber} 页来源文本`}>
              {selectedBasicMapping
                ? formatMappingSource(selectedBasicMapping)
                : selectedItem?.mapping
                ? formatMappingSource(selectedItem.mapping)
                : highlightSourceText(selectedPage?.normalizedText ?? "", selectedCandidate?.sourceQuote ?? selectedItem?.pageRefs[0]?.quote)}
            </pre>
            <div className="import-source-footer">
              <p>{draft.source.mimeType === "application/json" ? "原始 JSON 保留在当前导入窗口，正式提交前不会写入简历。" : `${pages.length} 页来源文本已保存；原始文件未长期保存。`}</p>
              {draft.source.mimeType === "application/json" && jsonText ? <details><summary>查看原始 JSON</summary><pre>{jsonText}</pre></details> : null}
            </div>
          </aside>

          <div className="import-structure-panel">
            <div className="section-heading compact-heading">
              <div><h3>结构内容</h3>{fieldCandidateReviewCount > 0 ? <p>一源多字段需逐项确认</p> : null}</div>
              {fieldCandidateReviewCount > fieldCandidates.filter((candidate) => candidate.reviewStatus === "needs_review").length ? <button className="primary-button compact" type="button" onClick={() => { void confirmAllMappings(); }}>确认可批量项</button> : null}
            </div>

            {fieldCandidates.length > 0 ? <details className="import-field-candidates" open={fieldCandidates.some((candidate) => candidate.reviewStatus === "needs_review")}>
              <summary>字段候选 <span>{fieldCandidates.filter((candidate) => candidate.reviewStatus === "needs_review").length} 项待确认</span></summary>
              <div className="import-field-candidate-list">
                {fieldCandidates.map((candidate) => (
                  <div key={candidate.id} className={selectedCandidateId === candidate.id ? "import-field-candidate active" : "import-field-candidate"}>
                    <button type="button" className="import-field-candidate-source" aria-pressed={selectedCandidateId === candidate.id} onClick={() => {
                      setSelectedCandidateId(candidate.id);
                      setSelectedBasicFieldKey(undefined);
                      setSelectedItemId(candidate.itemId && candidate.itemId !== "basics" ? candidate.itemId : undefined);
                      const block = draft.sourceBlocks.find((source) => candidate.sourceBlockIds.includes(source.id));
                      if (block?.page) setSelectedPageNumber(block.page);
                    }}>
                      <small>{candidateContextLabel(candidate, draft)}</small>
                      <span>{canonicalFieldLabel(candidate.targetFieldId)}</span>
                      <strong>{formatCandidateValue(candidate.value)}</strong>
                      <small>{candidate.dateValue ? `${datePrecisionLabel(candidate.dateValue.sourcePrecision ?? candidate.dateValue.precision, candidate.dateValue.current)} · 来源 ${candidate.dateValue.rawText}` : "逐字来源"} · {Math.round(candidate.confidence * 100)}%</small>
                    </button>
                    {editingCandidateId === candidate.id ? (
                      <label className="import-field-candidate-edit">
                        <span>编辑值</span>
                        <input
                          name={`import-candidate-${candidate.id}`}
                          autoComplete="off"
                          autoFocus
                          defaultValue={formatCandidateValue(candidate.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") setEditingCandidateId(undefined);
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.currentTarget.blur();
                            }
                          }}
                          onBlur={(event) => { void editFieldCandidate(candidate.id, event.currentTarget.value); }}
                        />
                      </label>
                    ) : candidate.reviewStatus === "needs_review" ? (
                      <div className="action-row import-field-candidate-actions">
                        <button className="secondary-button compact" type="button" onClick={() => { void confirmFieldCandidate(candidate.id); }}>采用</button>
                        <button className="secondary-button compact" type="button" onClick={() => { void rejectFieldCandidate(candidate.id); }}>舍弃</button>
                        <button className="secondary-button compact" type="button" onClick={() => setEditingCandidateId(candidate.id)}>编辑</button>
                      </div>
                    ) : <span className="import-field-candidate-confirmed">{fieldCandidateStatusLabel(candidate.reviewStatus)}</span>}
                  </div>
                ))}
              </div>
            </details> : null}

            <div className="review-row">
              <strong>基本信息</strong>
              <div className="form-grid compact-form-grid">
                {REVIEW_BASIC_FIELD_KEYS.map((key) => (
                  <div className="import-basic-field" key={key}>
                    <label>{basicLabel(key)}<input
                      name={`import-basic-${key}`}
                      type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
                      autoComplete={key === "email" ? "email" : key === "phone" ? "tel" : key === "name" ? "name" : "off"}
                      spellCheck={key !== "email" && key !== "phone"}
                      defaultValue={draft.basics[key]?.value ?? ""}
                      onBlur={(event) => { void updateBasicField(key, event.target.value); }}
                    /></label>
                    {draft.basics[key]?.mapping ? <button
                      type="button"
                      className={`mapping-trace ${draft.basics[key]?.mapping?.confidenceLevel === "low" ? "mapping-trace-low" : ""}`}
                      aria-pressed={selectedBasicFieldKey === key}
                      onClick={() => {
                        setSelectedBasicFieldKey(key);
                        setSelectedCandidateId(undefined);
                        setSelectedItemId(undefined);
                      }}
                    >
                      <span>来源：{draft.basics[key]?.mapping?.sourcePaths.join("、")}</span>
                      <strong>{draft.basics[key]?.mapping?.needsConfirmation ? "需要确认" : "来源已核对"}</strong>
                    </button> : null}
                    {draft.basics[key]?.mapping?.needsConfirmation ? <button className="secondary-button compact" type="button" onClick={() => { void confirmBasicMapping(key); }}>确认字段映射</button> : null}
                    {key !== "targetRole" && targetMode === "existing" && targetProfile?.basics[key] && draft.basics[key]?.value && targetProfile.basics[key] !== draft.basics[key]?.value ? (
                      <select
                        name={`import-basic-${key}-merge`}
                        aria-label={`${basicLabel(key)}合并方式`}
                        value={basicMergeActions[key] ?? "keep_existing"}
                        onChange={(event) => setBasicMergeActions((current) => ({ ...current, [key]: event.target.value as ImportMergeDecision["action"] }))}
                      >
                        <option value="keep_existing">保留现有</option>
                        <option value="use_imported">使用导入</option>
                      </select>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {draft.sections.map((section) => (
              <article key={section.id} className="review-row">
                <div className="section-heading compact-heading">
                  <label className="inline-toggle">
                    <input name={`import-section-${section.id}-included`} type="checkbox" checked={section.included} onChange={(event) => { void updateSectionIncluded(section.id, event.target.checked); }} />
                    {section.detectedTitle}
                  </label>
                  <select name={`import-section-${section.id}-type`} aria-label={`${section.detectedTitle}栏目类型`} value={section.sectionType} onChange={(event) => { void updateSectionType(section.id, event.target.value as ImportedResumeSectionType); }}>
                    {SECTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <div className="action-row import-section-bulk-actions">
                    <button className="secondary-button compact" type="button" onClick={() => { void applyBulkSelection("use_imported", section.id); }}>本栏目使用导入</button>
                    <button className="secondary-button compact" type="button" onClick={() => { void applyBulkSelection("keep_existing", section.id); }}>本栏目保留现有</button>
                  </div>
                </div>

                {section.items.map((item) => (
                  <div key={item.id} className={`import-item-row ${selectedItemId === item.id ? "import-item-row-active" : ""}`}>
                    <label className="inline-toggle">
                      <input name={`import-item-${item.id}-included`} type="checkbox" checked={item.included} onChange={(event) => { void updateItem(section.id, item.id, { included: event.target.checked }); }} />
                      {sourceStatusLabel(item.sourceStatus, item.userEdited, item.userConfirmed, item.mapping?.needsConfirmation, item.confidence)} / 第 {item.pageRefs.map((ref) => ref.pageNumber).join(",") || "?"} 页
                    </label>
                    {item.structuredItem && item.sourceStatus === "ambiguous" ? <div className="action-row">
                      <button className="secondary-button compact" type="button" onClick={() => { void confirmItemMapping(section.id, item.id); }}>采用此条</button>
                      <button className="secondary-button compact" type="button" onClick={() => { void discardStructuredItem(section.id, item.id); }}>舍弃</button>
                    </div> : item.mapping?.needsConfirmation ? <button className="secondary-button compact" type="button" onClick={() => { void confirmItemMapping(section.id, item.id); }}>确认此映射</button> : null}
                    {item.mapping ? <button
                      type="button"
                      className={`mapping-trace ${item.mapping.confidenceLevel === "low" ? "mapping-trace-low" : ""}`}
                      aria-pressed={selectedItemId === item.id}
                      onClick={() => {
                        setSelectedItemId(item.id);
                        setSelectedBasicFieldKey(undefined);
                        setSelectedCandidateId(undefined);
                        setSelectedPageNumber(item.pageRefs[0]?.pageNumber ?? selectedPageNumber);
                      }}
                    >
                      <span>来源：{item.mapping.sourcePaths.join("、")}</span>
                      <strong>{item.mapping.needsConfirmation ? "需要确认" : "来源已核对"}</strong>
                    </button> : null}
                    {item.structuredItem ? <dl className="import-item-structured-fields">
                      {structuredItemFields(item.structuredItem).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                    </dl> : <>
                      <strong className="import-item-body-label">{structuredItemBodyLabel(section.sectionType)}</strong>
                      <textarea
                        id={`import-item-editor-${item.id}`}
                        className="textarea compact-textarea"
                        name={`import-item-${item.id}`}
                        aria-label={`${section.detectedTitle}${structuredItemBodyLabel(section.sectionType)}`}
                        defaultValue={item.normalizedText}
                        onFocus={() => {
                          setSelectedItemId(item.id);
                          setSelectedBasicFieldKey(undefined);
                          setSelectedCandidateId(undefined);
                          setSelectedPageNumber(item.pageRefs[0]?.pageNumber ?? selectedPageNumber);
                        }}
                        onBlur={(event) => { void editItemText(section.id, item, event.target.value); }}
                      />
                    </>}
                    <details className="import-item-source-excerpt">
                      <summary>查看来源原文</summary>
                      <pre>{item.rawText}</pre>
                    </details>
                    <div className="action-row">
                      <button type="button" className="secondary-button compact" onClick={() => { void moveItem(section.id, item.id, "up"); }}>上移</button>
                      <button type="button" className="secondary-button compact" onClick={() => { void moveItem(section.id, item.id, "down"); }}>下移</button>
                      <button type="button" className="secondary-button compact" onClick={() => { void mergeWithNext(section.id, item.id); }}>合并</button>
                      <button type="button" className="secondary-button compact" onClick={() => { void splitItem(section.id, item); }}>拆分</button>
                    </div>
                  </div>
                ))}
              </article>
            ))}
            {draft.unclassifiedBlocks.length > 0 ? <section className="review-row import-unclassified-blocks"><strong>未识别内容（{draft.unclassifiedBlocks.length}）</strong><p>这些字段没有被丢弃，也不会自动写入正式简历。请确认保留为来源记录。</p>{draft.unclassifiedBlocks.map((block) => {
              const key = unclassifiedBlockKey(block);
              const value = "sourceValue" in block ? block.sourceValue : block.text;
              const reviewed = reviewedUnclassifiedKeys.includes(key);
              return <div className="import-unclassified-item" key={key}><details><summary>{key}</summary><pre>{stringifyUnknown(value)}</pre></details><button className="secondary-button compact" type="button" disabled={reviewed} onClick={() => setReviewedUnclassifiedKeys((current) => [...new Set([...current, key])])}>{reviewed ? "已核对保留" : "核对并保留来源"}</button></div>;
            })}</section> : null}
          </div>
        </div>
        <footer className="import-review-footer">
          <div><strong>{unsafeTextLayerBlocked ? "当前文本层不可安全提交" : `${importableItemCount} 条已选内容`}</strong><span>{pendingReviewCount > 0 ? `确认导入暂不可用：${importBlockReason({ fieldCandidateReviewCount, structureReviewCount, unreviewedUnclassifiedCount, structureConflictCount })} · ` : ""}{targetMode === "new" ? `创建新人物：${newProfileName || "待填写"}` : `导入到：${targetProfile?.name ?? "待选择"}`} · {message}</span></div>
          <div className="action-row"><button className="secondary-button" type="button" onClick={cancelImport} disabled={status === "confirming"}>取消</button><button type="button" className="primary-button" disabled={status === "confirming" || unsafeTextLayerBlocked || (createGeneralResume && importableItemCount === 0) || pendingReviewCount > 0 || (targetMode === "existing" && (reconciliationStatus !== "ready" || !activeReconciliationPlan || activeReconciliationPlan.summary.requiresReview > 0)) || (targetMode === "new" && !newProfileName.trim()) || (nameMismatch && basicMergeActions.name !== "keep_existing")} onClick={confirmImport}>确认导入</button></div>
        </footer>
        </>
      ) : null}
    </section>
  );
}

async function buildSyntheticPageTexts(input: {
  fileName: string;
  pageTexts: string[];
  now: string;
}): Promise<PdfPageText[]> {
  const sessionId = `synthetic-${nanoid(10)}`;
  const pages: PdfPageText[] = [];
  let charStart = 0;
  for (let index = 0; index < input.pageTexts.length; index += 1) {
    const text = input.pageTexts[index] ?? "";
    const cleaned = text.trim();
    pages.push({
      id: `import-text-page-${nanoid(10)}`,
      sessionId,
      pageNumber: index + 1,
      extractedPageText: text,
      cleanedPageText: cleaned,
      charStart,
      charEnd: charStart + cleaned.length,
      textItemCount: text.split(/\s+/).filter(Boolean).length,
      warnings: [`${input.fileName} 已转换为第 ${index + 1} 页来源文本。`],
      rawTextHash: await hashText(text),
      cleanedTextHash: await hashText(cleaned),
      createdAt: input.now,
      updatedAt: input.now
    });
    charStart += cleaned.length + 2;
  }
  return pages;
}

function isDocxFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx")
    || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isJsonFile(file: File) {
  return file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
}

function isCanonicalCareerAdaptJson(rawText: string) {
  try {
    const adapted = adaptResumeJsonToV2(JSON.parse(rawText));
    return adapted.ok && adapted.sourceKind === "v2";
  } catch {
    return false;
  }
}

function isTextResumeFile(file: File) {
  const name = file.name.toLowerCase();
  return name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".txt")
    || file.type === "text/markdown" || file.type === "text/plain";
}

export function sampleStructuredResumeJson() {
  return {
    schemaVersion: "structured-resume-draft-v1",
    basics: {
      name: "陈同学",
      email: "demo.student@example.com",
      phone: "13800000000",
      location: "上海市浦东新区",
      summary: "数据分析方向应届毕业生，熟悉 Excel、Stata、SQL 和 Python，具备业务分析与数据可视化能力，注重数据质量与跨部门沟通。",
      links: [
        "https://www.linkedin.com/in/example",
        "https://github.com/example"
      ]
    },
    sections: [
      {
        title: "自我评价",
        category: "summary",
        sectionType: "summary",
        items: [
          "具备扎实的统计学基础和数据处理能力，熟练使用 Excel、Stata、SQL 进行数据清洗与分析。善于从数据中提炼业务洞察，注重逻辑严谨与结果可验证性。实习期间独立完成多项经营指标分析报告，获得团队认可。"
        ]
      },
      {
        title: "教育经历",
        category: "education",
        sectionType: "experience",
        items: [
          {
            organization: "职适大学",
            role: "本科 · 信息管理与信息系统",
            location: "上海",
            startDate: "2021-09",
            endDate: "2025-06",
            current: false,
            highlights: [
              "GPA 3.6 / 4.0，专业排名前 15%",
              "主修课程：统计学、数据库系统、数据挖掘、机器学习导论、微观经济学",
              "获校级一等奖学金（2023、2024 年度）"
            ],
            included: true
          }
        ]
      },
      {
        title: "工作 / 实习经历",
        category: "work",
        sectionType: "experience",
        items: [
          {
            organization: "示例科技有限公司",
            role: "数据运营实习生",
            location: "上海",
            startDate: "2024-03",
            endDate: "2024-08",
            current: false,
            highlights: [
              "整理周度经营指标并完成异常复核，输出 12 份分析报告",
              "使用 SQL 提取用户行为数据，协助完成转化漏斗分析",
              "搭建 Excel 自动化报表模板，将周报制作时间从 4 小时缩短至 1 小时",
              "参与季度复盘会议，提出 3 条数据驱动的运营优化建议并被采纳"
            ],
            included: true
          },
          {
            organization: "某咨询公司",
            role: "研究助理（兼职）",
            location: "上海",
            startDate: "2023-07",
            endDate: "2023-09",
            current: false,
            highlights: [
              "协助完成 2 个行业研究项目的数据收集与整理",
              "使用 Stata 对 5000+ 条样本数据进行回归分析"
            ],
            included: true
          }
        ]
      },
      {
        title: "项目经历",
        category: "project",
        sectionType: "experience",
        items: [
          {
            organization: "区域经济数据分析项目",
            role: "核心分析成员",
            location: "上海",
            startDate: "2023-09",
            endDate: "2023-12",
            current: false,
            highlights: [
              "使用 Stata 清洗 31 个省级行政区 5 年面板数据，完成描述统计与相关性分析",
              "撰写 8000 字分析报告，提出 3 条区域发展差异的政策建议",
              "项目获课程优秀成果奖"
            ],
            included: true
          },
          {
            organization: "个人数据分析博客",
            role: "独立运营者",
            startDate: "2022-06",
            endDate: "2024-06",
            current: false,
            highlights: [
              "发布 30+ 篇数据分析教程，累计阅读量 5 万+",
              "内容涵盖 Python 数据清洗、SQL 查询优化、可视化实战"
            ],
            included: true
          }
        ]
      },
      {
        title: "校园经历",
        category: "campus",
        sectionType: "experience",
        items: [
          {
            organization: "学生会宣传部",
            role: "副部长",
            location: "上海",
            startDate: "2022-09",
            endDate: "2023-06",
            current: false,
            highlights: [
              "统筹 5 场校园活动的宣传策划，覆盖 3000+ 学生",
              "管理 3 人小组，负责公众号内容排版与数据复盘",
              "活动期间公众号粉丝增长 20%"
            ],
            included: true
          }
        ]
      },
      {
        title: "奖项",
        category: "award",
        sectionType: "certificates",
        items: [
          { text: "校级一等奖学金 · 2023 年度", included: true },
          { text: "校级一等奖学金 · 2024 年度", included: true },
          { text: "全国大学生数学建模竞赛省级二等奖 · 2023", included: true }
        ]
      },
      {
        title: "技能",
        category: "skill",
        sectionType: "skills",
        items: [
          "Excel（数据透视表、VBA）",
          "SQL（复杂查询、窗口函数）",
          "Python（Pandas、Matplotlib）",
          "Stata（面板数据、回归分析）",
          "数据清洗与可视化",
          "业务分析与报告撰写"
        ]
      },
      {
        title: "证书",
        category: "certificate",
        sectionType: "certificates",
        items: [
          { text: "大学英语六级（CET-6）· 560 分", included: true },
          { text: "全国计算机等级考试二级（Python）", included: true }
        ]
      },
      {
        title: "语言",
        category: "language",
        sectionType: "certificates",
        items: [
          { text: "英语 · 熟练（六级 560，可阅读英文文献）", included: true },
          { text: "普通话 · 一级乙等", included: true }
        ]
      },
      {
        title: "其他内容",
        category: "custom",
        sectionType: "unknown",
        included: false,
        items: [
          { text: "可到岗时间：2025 年 7 月", included: false },
          { text: "期望城市：上海、杭州", included: false }
        ]
      }
    ]
  };
}

export function sampleResumeJsonV2() {
  return createResumeJsonV2Example();
}

function basicLabel(key: BasicFieldKey) {
  return {
    name: "姓名",
    email: "邮箱",
    phone: "电话",
    location: "地点",
    targetRole: "求职意向",
    summary: "概述"
  }[key];
}

function formatMappingSource(trace: NonNullable<ImportedResumeItem["mapping"]>) {
  return trace.sourcePaths.map((path, index) => `${path}\n${stringifyUnknown(trace.sourceValues[index])}`).join("\n\n");
}

function stringifyUnknown(value: unknown) {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function unclassifiedBlockKey(block: ImportedResumeDraft["unclassifiedBlocks"][number]) {
  return "sourcePath" in block ? block.sourcePath : `${block.sourceBlockId}:${block.sourceRange.start}-${block.sourceRange.end}`;
}

function normalizeName(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase();
}

function importStatusLabel(status: ImportStatus) {
  return {
    idle: "等待上传",
    validating_file: "校验文件",
    extracting_pdf: "提取文本",
    extracting_docx: "读取DOCX",
    extracting_text: "读取文本",
    extracting_ocr: "OCR识别",
    importing_json: "校验JSON",
    classifying_sections: "识别栏目",
    reviewing: "等待核对",
    confirming: "正在导入",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  }[status];
}

function confidenceLabel(confidence: ImportedResumeItem["confidence"]) {
  return {
    high: "高置信",
    medium: "中置信",
    low: "低置信"
  }[confidence];
}

function sourceStatusLabel(
  status: ImportedResumeItem["sourceStatus"],
  userEdited = false,
  userConfirmed = false,
  needsConfirmation = false,
  confidence: ImportedResumeItem["confidence"] = "medium"
) {
  if (userEdited) return "用户已编辑";
  if (userConfirmed) return "用户已确认";
  if (needsConfirmation || status === "ambiguous" || status === "unlocated") {
    return `AI 已识别 / ${confidenceLabel(confidence)} / 需要核对`;
  }
  return "AI 已识别";
}

function hasCompleteItemSource(item: ImportedResumeItem) {
  return item.sourceBlockIds.length > 0
    && item.pageRefs.length > 0
    && item.pageRefs.every((ref) => ref.quote.trim().length > 0);
}

function hasItemSourceConflict(draft: ImportedResumeDraft, item: ImportedResumeItem) {
  if (draft.schemaVersion !== "resume-import-v2") return false;
  const targetsByRange = new Map<string, Set<string>>();
  for (const candidate of draft.fieldCandidates.filter((entry) => entry.itemId === item.id)) {
    for (const range of candidate.sourceRanges ?? []) {
      const key = `${range.blockId}:${range.start}:${range.end}`;
      const targets = targetsByRange.get(key) ?? new Set<string>();
      targets.add(candidate.targetFieldId);
      targetsByRange.set(key, targets);
    }
  }
  return [...targetsByRange.values()].some((targets) => targets.size > 1);
}

function importBlockReason(counts: {
  fieldCandidateReviewCount: number;
  structureReviewCount: number;
  unreviewedUnclassifiedCount: number;
  structureConflictCount: number;
}) {
  return [
    counts.fieldCandidateReviewCount ? `${counts.fieldCandidateReviewCount} 项字段候选待确认` : "",
    counts.structureReviewCount ? `${counts.structureReviewCount} 项结构条目待确认` : "",
    counts.unreviewedUnclassifiedCount ? `${counts.unreviewedUnclassifiedCount} 项未识别来源待核对` : "",
    counts.structureConflictCount ? `${counts.structureConflictCount} 项结构冲突需处理` : ""
  ].filter(Boolean).join("、");
}

function highlightSourceText(text: string, quote: string | undefined) {
  if (!quote) {
    return text;
  }
  const index = text.indexOf(quote);
  if (index < 0) {
    return text;
  }
  return `${text.slice(0, index)}\n>>> ${quote} <<<\n${text.slice(index + quote.length)}`;
}

function canonicalFieldLabel(fieldId: string) {
  return getResumeFieldDefinition(fieldId as CanonicalFieldId)?.label ?? fieldId;
}

function candidateContextLabel(candidate: ImportedResumeFieldCandidate, draft: ImportedResumeDraft) {
  if (candidate.itemId === "basics") return "基本信息";
  const section = draft.sections.find((item) => item.id === candidate.sectionId);
  return [section?.detectedTitle, candidate.itemLabel].filter(Boolean).join(" · ") || "待确认条目";
}

function structuredItemFields(item: ResumeItemV2): Array<[string, string]> {
  const record = item as unknown as Record<string, unknown>;
  const labelsByType: Record<string, Array<[string, string]>> = {
    summary: [["text", "内容"]],
    education: [["school", "学校"], ["degree", "学历"], ["major", "专业"], ["department", "院系"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "在读状态"], ["gpa", "GPA"], ["gpaScale", "GPA 满分"], ["rankPosition", "排名"], ["rankTotal", "总人数"], ["courses", "课程"], ["honors", "荣誉"], ["description", "说明"], ["highlights", "亮点"]],
    work: [["organization", "组织"], ["role", "职位"], ["department", "部门"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["description", "说明"], ["highlights", "职责与成果"]],
    internship: [["organization", "组织"], ["role", "职位"], ["department", "部门"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["description", "说明"], ["highlights", "职责与成果"]],
    campus: [["organization", "组织"], ["role", "角色"], ["department", "部门"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["description", "说明"], ["highlights", "职责与成果"]],
    volunteer: [["organization", "组织"], ["role", "角色"], ["department", "部门"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["description", "说明"], ["highlights", "职责与成果"]],
    project: [["title", "项目名称"], ["role", "角色"], ["organization", "组织"], ["location", "地点"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["url", "链接"], ["tools", "工具"], ["background", "背景"], ["description", "说明"], ["highlights", "亮点"], ["outcomes", "成果"]],
    research: [["title", "研究题目"], ["authorRole", "作者身份"], ["institution", "机构"], ["startDate", "开始日期"], ["endDate", "结束日期"], ["current", "当前状态"], ["methods", "方法"], ["samples", "样本"], ["publication", "关联论文"], ["publicationStatus", "发表状态"], ["url", "链接"], ["description", "说明"], ["highlights", "亮点"]],
    skills: [["category", "类别"], ["name", "技能"], ["level", "熟练度"], ["description", "说明"]],
    awards: [["name", "奖项"], ["issuer", "颁发方"], ["level", "级别"], ["awardedAt", "获奖时间"], ["rank", "名次"], ["description", "说明"]],
    certificates: [["name", "证书"], ["issuer", "颁发方"], ["issuedAt", "颁发日期"], ["expiresAt", "到期日期"], ["credentialId", "证书编号"], ["status", "状态"], ["description", "说明"]],
    languages: [["language", "语言"], ["level", "水平"], ["testName", "考试"], ["score", "成绩"], ["description", "说明"]],
    publications: [["title", "标题"], ["authors", "作者"], ["authorRole", "作者身份"], ["publisher", "出版方"], ["publishedAt", "发表日期"], ["status", "状态"], ["doi", "DOI"], ["url", "链接"], ["description", "说明"]],
    patents: [["title", "专利"], ["inventors", "发明人"], ["patentNumber", "专利号"], ["office", "受理机构"], ["filedAt", "申请日期"], ["grantedAt", "授权日期"], ["status", "状态"], ["url", "链接"], ["description", "说明"]],
    portfolio: [["title", "作品"], ["type", "类型"], ["role", "角色"], ["url", "链接"], ["createdAt", "创作日期"], ["tools", "工具"], ["description", "说明"], ["highlights", "亮点"]],
    other: [["title", "标题"], ["description", "内容"], ["highlights", "要点"]],
    custom: [["title", "标题"], ["description", "内容"], ["highlights", "要点"]]
  };
  return (labelsByType[item.sectionType] ?? []).flatMap(([key, label]) => {
    const value = record[key];
    if (key === "current") return value === true ? [[label, "至今"]] : [];
    if (Array.isArray(value) && value.length > 0) return [[label, value.join("、")]];
    if (typeof value === "number" && Number.isFinite(value)) return [[label, String(value)]];
    return typeof value === "string" && value.trim() ? [[label, value]] : [];
  });
}

function structuredItemBodyLabel(item: ResumeItemV2 | ImportedResumeSectionType) {
  const sectionType = typeof item === "string" ? item : item.sectionType;
  if (sectionType === "summary") return "内容";
  if (sectionType === "education") return "说明与亮点";
  if (sectionType === "project") return "项目说明与成果";
  if (sectionType === "skills") return "技能说明";
  if (sectionType === "awards" || sectionType === "certificates" || sectionType === "languages") return "说明";
  return "职责与成果";
}

function formatCandidateValue(value: string | number | boolean | string[]) {
  if (Array.isArray(value)) return value.join("、");
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function fieldCandidateStatusLabel(status: ImportedResumeFieldCandidate["reviewStatus"]) {
  return {
    auto_selected: "已预选",
    needs_review: "待核对",
    accepted: "已采用",
    rejected: "已舍弃",
    edited: "已编辑"
  }[status];
}

function parseEditedCandidateValue(
  current: ImportedResumeFieldCandidate["value"],
  rawValue: string
): ImportedResumeFieldCandidate["value"] {
  const value = rawValue.trim();
  if (typeof current === "boolean") return /^(true|1|是|至今)$/i.test(value);
  if (typeof current === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : current;
  }
  if (Array.isArray(current)) return value.split(/[，,]/).map((item) => item.trim()).filter(Boolean);
  return value || current;
}

function updateStructuredItemBody(item: ResumeItemV2, text: string): ResumeItemV2 {
  if (item.sectionType === "summary") return ResumeItemV2Schema.parse({ ...item, text });
  const highlights = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if ("highlights" in item) {
    return ResumeItemV2Schema.parse({ ...item, highlights, description: undefined });
  }
  if ("description" in item) return ResumeItemV2Schema.parse({ ...item, description: text });
  return item;
}

function datePrecisionLabel(precision: "year" | "month" | "day" | undefined, current: boolean) {
  if (current) return "当前状态";
  return precision === "day" ? "精确到日" : precision === "month" ? "精确到月" : "精确到年";
}

function sourceKindLabel(sourceKind: ImportedResumeDraft["sourceKind"]) {
  return {
    conversation: "对话访谈",
    standard_json: "标准 JSON",
    external_json: "外部 JSON",
    docx: "DOCX 结构",
    markdown: "Markdown 文本",
    text: "纯文本",
    digital_pdf: "数字 PDF",
    complex_digital_pdf: "复杂 PDF",
    text_pdf: "PDF 文本",
    scanned_pdf: "扫描 PDF",
    image: "简历图片"
  }[sourceKind];
}

function pipelineRouteLabel(draft: ImportedResumeDraft) {
  if (draft.schemaVersion !== "resume-import-v2") {
    return draft.qualityReport?.recommendedRoute === "ocr_ai" ? "需要本地识别" : "确定性提取";
  }
  return {
    standard_json: "标准结构校验",
    deterministic_json: "确定性字段映射",
    docx_structure: "文档结构提取",
    text_structure: "文本结构提取",
    digital_pdf_layout: "坐标阅读顺序",
    ocr_local: "需要本地识别",
    manual_review: "本地识别后核对"
  }[draft.qualityReport.recommendedPipeline];
}

function documentImportRouteLabel(route: DocumentImportRoutingDecision["route"]) {
  return {
    pdfjs: "PDF.js 文本层",
    docx: "DOCX 结构解析",
    text: "文本结构解析",
    local_ocr: "本地 OCR",
    manual_review: "仅人工核对",
    opendataloader: "OpenDataLoader（实验）"
  }[route];
}

function importStatusFromProgress(stage: ResumeImportProgressStage, file: File): ImportStatus {
  if (stage === "validating") return "validating_file";
  if (stage === "extracting") {
    return isDocxFile(file) ? "extracting_docx" : isJsonFile(file) ? "importing_json" : isTextResumeFile(file) ? "extracting_text" : "extracting_pdf";
  }
  if (stage === "normalizing" || stage === "mapping" || stage === "building_draft") {
    return "classifying_sections";
  }
  if (stage === "ready_for_review") return "reviewing";
  if (stage === "failed") return "failed";
  return isJsonFile(file) ? "importing_json" : isTextResumeFile(file) ? "extracting_text" : "extracting_pdf";
}

type ImportConfirmDiagnosticCode =
  | "revision_conflict"
  | "pending_review"
  | "placeholder_unresolved"
  | "candidate_target_unresolved"
  | "candidate_duplicate_target"
  | "source_not_located"
  | "reconciliation_not_ready"
  | "repository_invariant_failed";

function classifyImportConfirmError(error: unknown): {
  code: ImportConfirmDiagnosticCode;
  message: string;
  invariant?: string;
} {
  const raw = error instanceof Error ? error.message : "";
  const normalized = raw.toLocaleLowerCase();
  const invariant = raw.match(/(?:resume_import|profile_reconciliation)_[a-z0-9_]+/i)?.[0];
  if (error instanceof RevisionConflictError || /revision_conflict|revision mismatch|revision/i.test(normalized)) {
    return { code: "revision_conflict", message: "确认失败：草稿或资料库已变化，请刷新后重试。", invariant };
  }
  if (/placeholder|sensitive/i.test(normalized)) {
    return { code: "placeholder_unresolved", message: "确认失败：敏感信息恢复未完成，已阻止提交，请重新导入。", invariant };
  }
  if (/candidate_duplicate_target|duplicate_target/i.test(normalized)) {
    return { code: "candidate_duplicate_target", message: "确认失败：同一字段存在重复候选，请刷新后重新核对。", invariant };
  }
  if (/candidate_target_unresolved|target_invalid|field_candidate_invalid/i.test(normalized)) {
    return { code: "candidate_target_unresolved", message: "确认失败：字段候选未能定位到目标，请刷新或重新导入。", invariant };
  }
  if (/source_missing|source_not|not_located|unlocated/i.test(normalized)) {
    return { code: "source_not_located", message: "确认失败：部分内容的原文来源已失效，请重新导入。", invariant };
  }
  if (/reconciliation|profile_reconciliation/i.test(normalized)) {
    return { code: "reconciliation_not_ready", message: "确认失败：资料库冲突尚未完成确认，请先处理核对项。", invariant };
  }
  if (/pending|unconfirmed|not_reviewing|needs_review/i.test(normalized)) {
    return { code: "pending_review", message: "确认失败：仍有待核对条目，请完成核对后再试。", invariant };
  }
  return { code: "repository_invariant_failed", message: "确认失败：本地数据状态异常，请重试。", invariant };
}
