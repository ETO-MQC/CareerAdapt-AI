"use client";

import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { PDF_IMPORT_EXTRACTION_VERSION } from "@/domain/pdfImport/limits";
import { buildPageTextRecords, preparePdfText } from "@/domain/pdfImport/text";
import { validatePdfFileDescriptor, validatePdfHeader } from "@/domain/pdfImport/validation";
import { createImportedResumeDraftFromPdf } from "@/domain/resumeImport/parser";
import {
  ImportedResumeDraftSchema,
  type CareerProfile,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeItem,
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
  const abortRef = useRef<AbortController | undefined>(undefined);
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [message, setMessage] = useState("上传文本型 PDF 后，系统会本地提取文本并生成可核对草稿。");
  const [draft, setDraft] = useState<ImportedResumeDraft | undefined>();
  const [pages, setPages] = useState<PdfPageText[]>([]);
  const [selectedPageNumber, setSelectedPageNumber] = useState(1);
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>();
  const [basicMergeActions, setBasicMergeActions] = useState<Record<string, ImportMergeDecision["action"]>>({});

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

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (file) {
      await startFileImport(file);
    }
    event.currentTarget.value = "";
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
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

  async function patchDraft(updater: (current: ImportedResumeDraft) => ImportedResumeDraft) {
    if (!draft) {
      return;
    }
    const next = ImportedResumeDraftSchema.parse(updater(draft));
    const saved = await props.repository.saveImportedResumeDraft(next, draft.revision);
    setDraft(saved);
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

  return (
    <section className="panel no-print" aria-live="polite">
      <div className="section-heading">
        <div>
          <h2>导入已有 PDF 简历</h2>
          <p>仅支持文本型 PDF；确认前不会写入 CareerProfile 或创建正式分支。</p>
        </div>
        <div className="action-row">
          <button className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={status === "extracting_pdf" || status === "confirming"}>
            上传PDF简历
          </button>
          <button className="secondary-button" onClick={cancelImport} disabled={status === "confirming" || (!draft && status !== "extracting_pdf")}>
            取消
          </button>
        </div>
      </div>

      <input ref={fileInputRef} className="visually-hidden" type="file" accept="application/pdf,.pdf" onChange={handleFileChange} />
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
        <strong>{draft?.source.fileName ?? "拖放或选择一份 PDF 简历"}</strong>
        <span>{status} / {message}</span>
      </div>

      {draft ? (
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
            <p>{pages.length} 页来源文本已保存；原始 PDF Blob 未持久化。</p>
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
                      {item.sourceStatus} / {item.confidence} / p{item.pageRefs.map((ref) => ref.pageNumber).join(",") || "?"}
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
      ) : null}
    </section>
  );
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
