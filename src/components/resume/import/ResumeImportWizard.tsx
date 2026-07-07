"use client";

import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { PDF_IMPORT_EXTRACTION_VERSION } from "@/domain/pdfImport/limits";
import { buildPageTextRecords, preparePdfText } from "@/domain/pdfImport/text";
import { validatePdfFileDescriptor, validatePdfHeader } from "@/domain/pdfImport/validation";
import { extractTextFromDocxBuffer } from "@/domain/resumeImport/docx";
import { benchmarkResumeOcrAdapter, runResumeOcrAdapter, type ResumeOcrBenchmarkResult } from "@/domain/resumeImport/ocrAdapter";
import {
  createImportedResumeDraftFromPdf,
  createImportedResumeDraftFromStructuredJson,
  createImportedResumeDraftFromText
} from "@/domain/resumeImport/parser";
import {
  ImportedResumeDraftSchema,
  StructuredResumeDraftSchema,
  type CareerProfile,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeItem,
  type ImportedResumeSource,
  type ImportedResumeSectionType,
  type ImportMergeDecision,
  type PdfImportSession,
  type PdfPageText
} from "@/domain/schemas";
import { extractTextFromPdfBuffer } from "@/services/pdf/extractText";
import { hashBytes, hashText } from "@/services/security/text";
import { RevisionConflictError, type WorkspaceRepository } from "@/services/storage/repositories";

type ImportStatus =
  | "idle"
  | "validating_file"
  | "extracting_pdf"
  | "extracting_docx"
  | "extracting_ocr"
  | "importing_json"
  | "benchmarking_ocr"
  | "classifying_sections"
  | "reviewing"
  | "confirming"
  | "completed"
  | "failed"
  | "cancelled";

type BasicFieldKey = "name" | "email" | "phone" | "location" | "summary";

const SECTION_OPTIONS: Array<{ value: ImportedResumeSectionType; label: string }> = [
  { value: "summary", label: "个人概述" },
  { value: "experience", label: "经历/教育/项目" },
  { value: "skills", label: "技能" },
  { value: "certificates", label: "证书/奖项/语言" },
  { value: "unknown", label: "其他/待确认" }
];

export function ResumeImportWizard(props: {
  repository: WorkspaceRepository;
  profile?: CareerProfile;
  onImported: (result: { profileId: string; branchId: string }) => Promise<void>;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileIntentRef = useRef<"auto" | "pdf" | "docx" | "json" | "ocr">("auto");
  const abortRef = useRef<AbortController | undefined>(undefined);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState("导入 PDF、DOCX、OCR 或结构化 JSON 后，系统会先生成可核对草稿。");
  const [draft, setDraft] = useState<ImportedResumeDraft | undefined>();
  const [pages, setPages] = useState<PdfPageText[]>([]);
  const [selectedPageNumber, setSelectedPageNumber] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [basicMergeActions, setBasicMergeActions] = useState<Record<string, ImportMergeDecision["action"]>>({});
  const [jsonText, setJsonText] = useState("");
  const [ocrBenchmark, setOcrBenchmark] = useState<ResumeOcrBenchmarkResult | undefined>();

  useEffect(() => {
    let active = true;
    async function restoreDraft() {
      const latest = await props.repository.getLatestImportedResumeDraft();
      if (!active || !latest || (latest.status !== "reviewing" && latest.status !== "failed")) {
        return;
      }
      setDraft(latest);
      setStatus(latest.status === "reviewing" ? "reviewing" : "failed");
      setSelectedPageNumber(latest.pages[0]?.pageNumber ?? 1);
      if (latest.source.sourceSessionId) {
        setPages(await props.repository.listPdfPageTexts(latest.source.sourceSessionId));
      }
      setMessage("已恢复上次未确认的 PDF 简历导入草稿。");
    }
    void restoreDraft();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
  }, [props.repository]);

  const selectedPage = useMemo(() => {
    return draft?.pages.find((page) => page.pageNumber === selectedPageNumber);
  }, [draft, selectedPageNumber]);
  const selectedItem = useMemo(() => {
    return draft?.sections.flatMap((section) => section.items).find((item) => item.id === selectedItemId);
  }, [draft, selectedItemId]);
  const importableItemCount = useMemo(() => {
    return draft?.sections.flatMap((section) => section.items).filter((item) =>
      item.included && (item.sourceStatus === "located" || item.sourceStatus === "user_confirmed_modified")
    ).length ?? 0;
  }, [draft]);
  const qualityReport = useMemo(() => draft ? buildImportQualityReport(draft) : undefined, [draft]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) {
      const intent = fileIntentRef.current;
      fileIntentRef.current = "auto";
      if (intent === "docx" || (intent === "auto" && isDocxFile(file))) {
        await startDocxImport(file);
      } else if (intent === "json" || (intent === "auto" && isJsonFile(file))) {
        await startJsonImport(await file.text(), file.name);
      } else if (intent === "ocr") {
        await startOcrImport(file);
      } else {
        await startFileImport(file);
      }
    }
    event.currentTarget.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      if (isDocxFile(file)) {
        await startDocxImport(file);
        return;
      }
      if (isJsonFile(file)) {
        await startJsonImport(await file.text(), file.name);
        return;
      }
      await startFileImport(file);
    }
  }

  async function startFileImport(file: File) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("validating_file");
    setMessage("正在本地校验 PDF 文件。原始文件不会上传，也不会长期保存。");
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);

    const descriptorValidation = validatePdfFileDescriptor(file);
    if (!descriptorValidation.ok) {
      fail(descriptorValidation.message);
      return;
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const headerValidation = validatePdfHeader(bytes);
    if (!headerValidation.ok) {
      fail(headerValidation.message);
      return;
    }

    const now = new Date().toISOString();
    const fileHash = await hashBytes(bytes);
    const duplicate = await props.repository.findPdfImportByFileHash(fileHash);
    const session: PdfImportSession = {
      id: `pdf-session-${nanoid(10)}`,
      status: "extracting",
      fileName: file.name,
      fileSize: file.size,
      mimeType: descriptorValidation.mimeType,
      extension: descriptorValidation.extension,
      fileHash,
      pageCount: 0,
      textLength: 0,
      extractionVersion: PDF_IMPORT_EXTRACTION_VERSION,
      hasPromptInjectionRisk: false,
      warnings: descriptorValidation.warnings,
      createdAt: now,
      updatedAt: now
    };
    await props.repository.createPdfImportSession(session);

    setStatus("extracting_pdf");
    setMessage(duplicate ? "检测到同一 PDF 曾经导入过；本次会创建新的核对草稿。" : "正在本地提取 PDF 文本。");
    const extracted = await extractTextFromPdfBuffer(buffer, controller.signal);
    if (!extracted.ok) {
      await props.repository.updatePdfImportSession({
        ...session,
        status: extracted.code === "extract_cancelled" ? "cancelled" : "failed",
        errorCode: extracted.code,
        errorMessage: extracted.message
      });
      fail(extracted.code === "no_text_layer" ? "当前文件可能是扫描版PDF，G4a暂不支持OCR。" : extracted.message);
      return;
    }

    const prepared = preparePdfText(extracted.pages);
    if (!prepared.ok) {
      await props.repository.updatePdfImportSession({
        ...session,
        status: "failed",
        errorCode: prepared.code,
        errorMessage: prepared.message
      });
      fail(prepared.code === "no_text_layer" || prepared.code === "empty_extracted_text"
        ? "当前文件可能是扫描版PDF，G4a暂不支持OCR。"
        : prepared.message);
      return;
    }

    setStatus("classifying_sections");
    const hashes = await Promise.all(prepared.pages.map(async (page) => ({
      rawTextHash: await hashText(page.rawText),
      cleanedTextHash: await hashText(page.cleanedText)
    })));
    const pageRecords = buildPageTextRecords({
      sessionId: session.id,
      pages: prepared.pages,
      hashes,
      now: new Date().toISOString()
    });
    await props.repository.savePdfPageTexts(session.id, pageRecords);
    const normalizedTextHash = await hashText(prepared.combinedText);
    await props.repository.updatePdfImportSession({
      ...session,
      status: "extracted",
      pageCount: extracted.pageCount,
      textLength: prepared.combinedText.length,
      normalizedTextHash,
      hasPromptInjectionRisk: prepared.hasPromptInjectionRisk,
      warnings: [...descriptorValidation.warnings, ...prepared.warnings]
    });
    const importedDraft = createImportedResumeDraftFromPdf({
      source: {
        sourceSessionId: session.id,
        fileName: file.name,
        fileHash,
        normalizedTextHash,
        pageCount: extracted.pageCount,
        extractedAt: now
      },
      pages: pageRecords,
      now
    });
    const saved = await props.repository.saveImportedResumeDraft(importedDraft, 0);
    setDraft(saved);
    setPages(pageRecords);
    setSelectedPageNumber(pageRecords[0]?.pageNumber ?? 1);
    setStatus("reviewing");
    setMessage(prepared.hasPromptInjectionRisk
      ? "提取完成，检测到类似 Prompt 注入文字。系统会按纯文本处理，不执行其中指令。"
      : "提取和结构识别完成。请核对栏目、来源和包含状态后确认导入。");
  }

  async function startDocxImport(file: File) {
    setStatus("extracting_docx");
    setMessage("正在读取 DOCX 正文。原文件不会长期保存。");
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
    if (!isDocxFile(file)) {
      fail("请选择 .docx 文件。");
      return;
    }
    const buffer = await file.arrayBuffer();
    const fileHash = await hashBytes(new Uint8Array(buffer));
    const extracted = await extractTextFromDocxBuffer(buffer);
    if (!extracted.ok) {
      fail(extracted.message);
      return;
    }
    await createDraftFromPlainText({
      fileName: file.name,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileHash,
      text: extracted.text,
      successMessage: extracted.warnings.length
        ? `DOCX 正文已提取：${extracted.warnings.join("；")} 请继续核对。`
        : "DOCX 正文已提取并进入核对页。"
    });
  }

  async function startOcrImport(file: File) {
    setStatus("extracting_ocr");
    setMessage("正在调用 OCR Adapter。OCR 结果仍需逐项核对。");
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
    const result = await runResumeOcrAdapter(file);
    if (!result.ok) {
      fail(`${result.message}${result.warnings.length ? ` ${result.warnings.join("；")}` : ""}`);
      return;
    }
    const fileHash = await hashBytes(new Uint8Array(await file.arrayBuffer()));
    await createDraftFromPlainText({
      fileName: file.name,
      mimeType: file.type === "image/png" ? "image/png" : file.type === "image/jpeg" ? "image/jpeg" : "application/pdf",
      fileHash,
      text: result.text,
      successMessage: `OCR 文本已由 ${result.engine} 生成；请在核对页确认后再导入。`
    });
  }

  async function runOcrBenchmark() {
    setStatus("benchmarking_ocr");
    setMessage("正在运行本地 OCR Adapter Benchmark。");
    const result = await benchmarkResumeOcrAdapter();
    setOcrBenchmark(result);
    setStatus(draft ? "reviewing" : "idle");
    setMessage(result.supported
      ? "OCR Adapter Benchmark 已通过，仍需用户核对识别结果。"
      : "OCR Adapter Benchmark 完成：当前推荐使用 JSON 兜底或 DOCX/PDF 文本导入。");
  }

  async function startJsonImport(rawText: string, fileName = "structured-resume.json") {
    setStatus("importing_json");
    setMessage("正在校验结构化 JSON。JSON 不会绕过核对页。");
    setDraft(undefined);
    setPages([]);
    setSelectedItemId(undefined);
    const risk = validateStructuredJsonText(rawText);
    if (risk) {
      fail(risk);
      return;
    }
    try {
      const parsed = StructuredResumeDraftSchema.parse(JSON.parse(rawText));
      const now = new Date().toISOString();
      const normalizedTextHash = await hashText(rawText);
      const importedDraft = createImportedResumeDraftFromStructuredJson({
        source: {
          fileName,
          mimeType: "application/json",
          fileHash: normalizedTextHash,
          normalizedTextHash,
          pageCount: 1,
          extractedAt: now
        },
        structuredDraft: parsed,
        now
      });
      const saved = await props.repository.saveImportedResumeDraft(importedDraft, 0);
      setDraft(saved);
      setPages([]);
      setSelectedPageNumber(1);
      setStatus("reviewing");
      setMessage("结构化 JSON 已进入核对页；确认前不会写入正式数据。");
    } catch {
      fail("JSON 结构不符合示例格式，请修正后重试。");
    }
  }

  async function createDraftFromPlainText(input: {
    fileName: string;
    mimeType: ImportedResumeSource["mimeType"];
    fileHash: string;
    text: string;
    successMessage: string;
  }) {
    setStatus("classifying_sections");
    const now = new Date().toISOString();
    const normalizedText = normalizeImportedPlainText(input.text);
    if (!normalizedText) {
      fail("未读取到可导入文本。");
      return;
    }
    const normalizedTextHash = await hashText(normalizedText);
    const pageRecord = await buildSyntheticPageText({
      fileName: input.fileName,
      text: normalizedText,
      now
    });
    const importedDraft = createImportedResumeDraftFromText({
      source: {
        fileName: input.fileName,
        mimeType: input.mimeType,
        fileHash: input.fileHash,
        normalizedTextHash,
        pageCount: 1,
        extractedAt: now
      },
      pages: [pageRecord],
      now
    });
    const saved = await props.repository.saveImportedResumeDraft(importedDraft, 0);
    setDraft(saved);
    setPages([pageRecord]);
    setSelectedPageNumber(1);
    setStatus("reviewing");
    setMessage(input.successMessage);
  }

  async function patchDraft(updater: (current: ImportedResumeDraft) => ImportedResumeDraft) {
    if (!draft) {
      return;
    }
    const previous = draft;
    const next = ImportedResumeDraftSchema.parse(updater(draft));
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
          userEdited: current?.value !== value.trim()
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
      normalizedText: text,
      sourceStatus: text === item.rawText.trim() ? item.sourceStatus : "user_confirmed_modified",
      userEdited: text !== item.rawText.trim(),
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
    if (!draft || importableItemCount === 0) {
      setMessage("没有可导入的已定位或用户确认条目。");
      return;
    }
    setStatus("confirming");
    try {
      const result = await props.repository.confirmImportedResume({
        importId: draft.importId,
        expectedDraftRevision: draft.revision,
        operationId: `resume-import-confirm-${draft.importId}`,
        mergeDecisions: buildMergeDecisions()
      });
      setStatus("completed");
      setMessage(result.idempotent ? "该导入已确认过，已打开现有通用简历。" : "已确认导入，并创建通用简历分支。");
      await props.onImported({ profileId: result.profileId, branchId: result.branchId });
    } catch (error) {
      setStatus("reviewing");
      setMessage(error instanceof RevisionConflictError ? "确认失败：草稿已变化，请刷新后重试。" : "确认失败：请检查未定位条目、重复确认或本地数据状态。");
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
    if (!draft || !props.profile) {
      return [];
    }
    return (["name", "email", "phone", "location", "summary"] as BasicFieldKey[])
      .flatMap((key) => {
        const imported = draft.basics[key]?.value;
        const existing = props.profile?.basics[key];
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
    const blob = new Blob([JSON.stringify(sampleStructuredResumeJson(), null, 2)], { type: "application/json" });
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

  return (
    <section className="panel no-print" aria-live="polite">
      <div className="section-heading">
        <div>
          <h2>导入已有 PDF 简历</h2>
          <p>支持文本 PDF、DOCX、OCR Adapter 和结构化 JSON；确认前不会写入个人资料或创建正式简历。</p>
        </div>
        <div className="action-row import-source-actions">
          <button className="secondary-button" onClick={() => {
            fileIntentRef.current = "pdf";
            fileInputRef.current?.click();
          }} disabled={status === "extracting_pdf" || status === "confirming"}>
            PDF
          </button>
          <button className="secondary-button" onClick={() => {
            fileIntentRef.current = "docx";
            fileInputRef.current?.click();
          }} disabled={status === "extracting_docx" || status === "confirming"}>
            DOCX
          </button>
          <button className="secondary-button" onClick={() => {
            fileIntentRef.current = "ocr";
            fileInputRef.current?.click();
          }} disabled={status === "extracting_ocr" || status === "confirming"}>
            OCR
          </button>
          <button className="secondary-button" onClick={() => {
            fileIntentRef.current = "json";
            fileInputRef.current?.click();
          }} disabled={status === "importing_json" || status === "confirming"}>
            JSON
          </button>
          <button className="secondary-button" onClick={downloadSampleJson}>
            示例JSON
          </button>
          <button className="secondary-button" onClick={() => { void runOcrBenchmark(); }} disabled={status === "benchmarking_ocr" || status === "confirming"}>
            OCR Benchmark
          </button>
          <button className="secondary-button" onClick={cancelImport} disabled={status === "confirming" || (!draft && !["extracting_pdf", "extracting_docx", "extracting_ocr", "importing_json"].includes(status))}>
            取消
          </button>
        </div>
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/json,.json,image/png,image/jpeg,.png,.jpg,.jpeg" onChange={handleFileChange} />
      <div
        className="import-dropzone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            fileInputRef.current?.click();
          }
        }}
      >
        <strong>{draft?.source.fileName ?? "拖放或选择 PDF / DOCX / JSON 文件"}</strong>
        <span>{importStatusLabel(status)} / {message}</span>
      </div>

      <details className="import-json-details">
        <summary>粘贴结构化 JSON</summary>
        <textarea
          className="textarea compact-textarea"
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          placeholder={JSON.stringify(sampleStructuredResumeJson(), null, 2)}
        />
        <div className="action-row">
          <button className="primary-button compact" onClick={() => { void startJsonImport(jsonText || JSON.stringify(sampleStructuredResumeJson()), "pasted-structured-resume.json"); }}>
            导入JSON
          </button>
          <button className="secondary-button compact" onClick={() => setJsonText(JSON.stringify(sampleStructuredResumeJson(), null, 2))}>
            填入示例
          </button>
        </div>
      </details>

      {ocrBenchmark ? (
        <section className="import-quality-report" data-testid="ocr-benchmark-report">
          <div>
            <strong>OCR Benchmark</strong>
            <span>{ocrBenchmark.engine}</span>
          </div>
          <div>
            <span>{ocrBenchmark.supported ? "Adapter可用" : "Adapter未就绪"}</span>
            <span>{ocrBenchmark.elapsedMs}ms</span>
            <span>{ocrBenchmark.recommendation === "adapter_ready" ? "可接入OCR核对" : "建议JSON兜底"}</span>
          </div>
          <div>
            {ocrBenchmark.notes.map((note) => <span key={note}>{note}</span>)}
          </div>
        </section>
      ) : null}

      {draft ? (
        <>
        {qualityReport ? <ImportQualityReport report={qualityReport} /> : null}
        <div className="import-review-grid">
          <aside className="import-source-panel">
            <div className="section-heading compact-heading">
              <h3>来源页</h3>
              <div className="action-row">
                {draft.pages.map((page) => (
                  <button
                    key={page.pageNumber}
                    className={page.pageNumber === selectedPageNumber ? "primary-button compact" : "secondary-button compact"}
                    onClick={() => setSelectedPageNumber(page.pageNumber)}
                  >
                    {page.pageNumber}
                  </button>
                ))}
              </div>
            </div>
            <pre className="import-source-text">
              {highlightSourceText(selectedPage?.normalizedText ?? "", selectedItem)}
            </pre>
            <p>{pages.length} 页来源文本已保存；原始 PDF 文件未长期保存。</p>
          </aside>

          <div className="import-structure-panel">
            <div className="section-heading compact-heading">
              <h3>核对结构</h3>
              <button className="primary-button compact" disabled={status === "confirming" || importableItemCount === 0} onClick={confirmImport}>
                确认导入
              </button>
            </div>

            <div className="review-row">
              <strong>基本信息</strong>
              <div className="form-grid compact-form-grid">
                {(["name", "email", "phone", "location", "summary"] as BasicFieldKey[]).map((key) => (
                  <label key={key}>
                    {basicLabel(key)}
                    <input
                      defaultValue={draft.basics[key]?.value ?? ""}
                      onBlur={(event) => { void updateBasicField(key, event.target.value); }}
                    />
                    {props.profile?.basics[key] && draft.basics[key]?.value && props.profile.basics[key] !== draft.basics[key]?.value ? (
                      <select
                        value={basicMergeActions[key] ?? "keep_existing"}
                        onChange={(event) => setBasicMergeActions((current) => ({ ...current, [key]: event.target.value as ImportMergeDecision["action"] }))}
                      >
                        <option value="keep_existing">保留现有</option>
                        <option value="use_imported">使用导入</option>
                      </select>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            {draft.sections.map((section) => (
              <article key={section.id} className="review-row">
                <div className="section-heading compact-heading">
                  <label className="inline-toggle">
                    <input type="checkbox" checked={section.included} onChange={(event) => { void updateSectionIncluded(section.id, event.target.checked); }} />
                    {section.detectedTitle}
                  </label>
                  <select value={section.sectionType} onChange={(event) => { void updateSectionType(section.id, event.target.value as ImportedResumeSectionType); }}>
                    {SECTION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>

                {section.items.map((item) => (
                  <div key={item.id} className={`import-item-row ${selectedItemId === item.id ? "import-item-row-active" : ""}`}>
                    <label className="inline-toggle">
                      <input type="checkbox" checked={item.included} onChange={(event) => { void updateItem(section.id, item.id, { included: event.target.checked }); }} />
                      {sourceStatusLabel(item.sourceStatus)} / {confidenceLabel(item.confidence)} / 第 {item.pageRefs.map((ref) => ref.pageNumber).join(",") || "?"} 页
                    </label>
                    <textarea
                      className="textarea compact-textarea"
                      defaultValue={item.normalizedText}
                      onFocus={() => {
                        setSelectedItemId(item.id);
                        setSelectedPageNumber(item.pageRefs[0]?.pageNumber ?? selectedPageNumber);
                      }}
                      onBlur={(event) => { void editItemText(section.id, item, event.target.value); }}
                    />
                    <div className="action-row">
                      <button className="secondary-button compact" onClick={() => { void moveItem(section.id, item.id, "up"); }}>上移</button>
                      <button className="secondary-button compact" onClick={() => { void moveItem(section.id, item.id, "down"); }}>下移</button>
                      <button className="secondary-button compact" onClick={() => { void mergeWithNext(section.id, item.id); }}>合并</button>
                      <button className="secondary-button compact" onClick={() => { void splitItem(section.id, item); }}>拆分</button>
                    </div>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </div>
        </>
      ) : null}
    </section>
  );
}

async function buildSyntheticPageText(input: {
  fileName: string;
  text: string;
  now: string;
}): Promise<PdfPageText> {
  const rawTextHash = await hashText(input.text);
  const cleanedTextHash = await hashText(input.text.trim());
  return {
    id: `import-text-page-${nanoid(10)}`,
    sessionId: `synthetic-${nanoid(10)}`,
    pageNumber: 1,
    extractedPageText: input.text,
    cleanedPageText: input.text.trim(),
    charStart: 0,
    charEnd: input.text.trim().length,
    textItemCount: input.text.split(/\s+/).filter(Boolean).length,
    warnings: [`${input.fileName} 已转换为单页来源文本。`],
    rawTextHash,
    cleanedTextHash,
    createdAt: input.now,
    updatedAt: input.now
  };
}

function normalizeImportedPlainText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isDocxFile(file: File) {
  return file.name.toLowerCase().endsWith(".docx")
    || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isJsonFile(file: File) {
  return file.name.toLowerCase().endsWith(".json") || file.type === "application/json";
}

function validateStructuredJsonText(text: string) {
  if (!text.trim()) {
    return "请先粘贴或选择结构化 JSON。";
  }
  if (/<\/?(script|style|iframe|object|embed)\b/i.test(text)) {
    return "JSON 中包含脚本或样式片段，已阻止导入。";
  }
  if (/(api[_-]?key|secret[_-]?key|OPENAI_API_KEY|AI_API_KEY|-----BEGIN\s+(?:RSA|PRIVATE))/i.test(text)) {
    return "JSON 中疑似包含密钥或私密凭据，已阻止导入。";
  }
  return undefined;
}

function sampleStructuredResumeJson() {
  return {
    schemaVersion: "structured-resume-draft-v1",
    basics: {
      name: "陈同学",
      email: "demo.student@example.com",
      phone: "13800000000",
      location: "上海",
      summary: "数据分析方向学生，熟悉 Excel、Stata 和业务分析。"
    },
    sections: [
      {
        title: "项目与经历",
        sectionType: "experience",
        items: [
          "使用 Stata 清洗 31 个省级样本，并完成描述统计、相关分析与区域差异分析。",
          "使用 Excel 整理表格数据和基础分析结果。"
        ]
      },
      {
        title: "技能",
        sectionType: "skills",
        items: ["Excel", "Stata", "数据清洗", "描述统计"]
      }
    ]
  };
}

function basicLabel(key: BasicFieldKey) {
  return {
    name: "姓名",
    email: "邮箱",
    phone: "电话",
    location: "地点",
    summary: "概述"
  }[key];
}

type ImportQualityReport = {
  totalItems: number;
  importableItems: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  locatedItems: number;
  ambiguousItems: number;
  unlocatedItems: number;
  unknownSections: number;
  warningCount: number;
};

function buildImportQualityReport(draft: ImportedResumeDraft): ImportQualityReport {
  const items = draft.sections.flatMap((section) => section.items);
  return {
    totalItems: items.length,
    importableItems: items.filter((item) => item.included && (item.sourceStatus === "located" || item.sourceStatus === "user_confirmed_modified")).length,
    highConfidence: items.filter((item) => item.confidence === "high").length,
    mediumConfidence: items.filter((item) => item.confidence === "medium").length,
    lowConfidence: items.filter((item) => item.confidence === "low").length,
    locatedItems: items.filter((item) => item.sourceStatus === "located").length,
    ambiguousItems: items.filter((item) => item.sourceStatus === "ambiguous").length,
    unlocatedItems: items.filter((item) => item.sourceStatus === "unlocated").length,
    unknownSections: draft.sections.filter((section) => section.sectionType === "unknown").length,
    warningCount: draft.warnings.length
  };
}

function ImportQualityReport({ report }: { report: ImportQualityReport }) {
  return (
    <section className="import-quality-report" data-testid="import-quality-report">
      <div>
        <strong>识别质量</strong>
        <span>{report.importableItems}/{report.totalItems} 条可导入</span>
      </div>
      <div>
        <span>高置信 {report.highConfidence}</span>
        <span>中置信 {report.mediumConfidence}</span>
        <span>低置信 {report.lowConfidence}</span>
      </div>
      <div>
        <span>已定位 {report.locatedItems}</span>
        <span>需核对 {report.ambiguousItems}</span>
        <span>未定位 {report.unlocatedItems}</span>
      </div>
      <div>
        <span>待分类栏目 {report.unknownSections}</span>
        <span>提示 {report.warningCount}</span>
      </div>
    </section>
  );
}

function importStatusLabel(status: ImportStatus) {
  return {
    idle: "等待上传",
    validating_file: "校验文件",
    extracting_pdf: "提取文本",
    extracting_docx: "读取DOCX",
    extracting_ocr: "OCR识别",
    importing_json: "校验JSON",
    benchmarking_ocr: "OCR测试",
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

function sourceStatusLabel(status: ImportedResumeItem["sourceStatus"]) {
  return {
    located: "已定位",
    ambiguous: "需核对",
    unlocated: "未定位",
    user_confirmed_modified: "用户已修正"
  }[status];
}

function highlightSourceText(text: string, item: ImportedResumeItem | undefined) {
  if (!item?.pageRefs[0]?.quote) {
    return text;
  }
  const quote = item.pageRefs[0].quote;
  const index = text.indexOf(quote);
  if (index < 0) {
    return text;
  }
  return `${text.slice(0, index)}\n>>> ${quote} <<<\n${text.slice(index + quote.length)}`;
}
