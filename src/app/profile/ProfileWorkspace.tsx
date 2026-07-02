"use client";

import { nanoid } from "nanoid";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { invokeStageBAi } from "@/ai/client";
import { promptVersions } from "@/ai/prompts/versions";
import { PDF_IMPORT_EXTRACTION_VERSION } from "@/domain/pdfImport/limits";
import { applyPdfSourceMappingToProfileOutput, isPdfEvidenceLocated } from "@/domain/pdfImport/sourceMapping";
import { buildPageTextRecords, combinePdfPageTexts, preparePdfText } from "@/domain/pdfImport/text";
import { validatePdfFileDescriptor, validatePdfHeader } from "@/domain/pdfImport/validation";
import { mapProfileDraftToCareerProfile } from "@/domain/mappers/profileDraftMapper";
import {
  ProfileBuilderOutputSchema,
  type PdfImportErrorCode,
  type PdfImportSession,
  type PdfPageText,
  type ProfileBuilderFact,
  type ProfileBuilderOutput,
  type ProfileImportDraft,
  type RawInputDocument
} from "@/domain/schemas";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";
import { extractTextFromPdfBuffer } from "@/services/pdf/extractText";
import { hashBytes, hashText, redactSensitiveTextForModel } from "@/services/security/text";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { RevisionConflictError, WorkspaceRepository } from "@/services/storage/repositories";

const repository = new WorkspaceRepository();
const pdfInputId = "resume-pdf-upload";

export function ProfileWorkspace() {
  const workspace = useWorkspace(repository);
  const pdfAbortRef = useRef<AbortController | undefined>(undefined);
  const [importMode, setImportMode] = useState<"paste" | "pdf">("paste");
  const [rawText, setRawText] = useState("");
  const [rawInput, setRawInput] = useState<RawInputDocument | undefined>();
  const [draft, setDraft] = useState<ProfileImportDraft | undefined>();
  const [pdfSession, setPdfSession] = useState<PdfImportSession | undefined>();
  const [pdfPages, setPdfPages] = useState<PdfPageText[]>([]);
  const [pdfText, setPdfText] = useState("");
  const [userEditedAiText, setUserEditedAiText] = useState("");
  const [pdfStatus, setPdfStatus] = useState<"idle" | "validating" | "extracting" | "extracted" | "failed" | "cancelled">("idle");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "failed" | "conflict">("idle");
  const [message, setMessage] = useState<string | undefined>();
  const [loadedDraft, setLoadedDraft] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDraft() {
      const latest = await repository.getLatestProfileImportDraft();
      if (!active || !latest) {
        setLoadedDraft(true);
        return;
      }

      const raw = await repository.getRawInput(latest.rawInputId);
      if (!active) {
        return;
      }

      setDraft(latest);
      setRawInput(raw);
      setRawText(raw?.rawText ?? "");
      setUserEditedAiText(raw?.userEditedAiText ?? raw?.rawText ?? "");
      if (raw?.kind === "resume_pdf_text") {
        setImportMode("pdf");
      }
      setLoadedDraft(true);
    }

    void loadDraft();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadPdfSession() {
      const latest = await repository.getLatestPdfImportSession();
      if (!active || !latest) {
        return;
      }

      const pages = await repository.listPdfPageTexts(latest.id);
      if (!active) {
        return;
      }

      setPdfSession(latest);
      setPdfPages(pages);
      const combined = combinePdfPageTexts(pages);
      setPdfText(combined);
      setUserEditedAiText((current) => current || combined);
      if (latest.status === "extracted" || latest.status === "awaiting_privacy_confirmation" || latest.status === "draft_ready") {
        setPdfStatus("extracted");
      } else if (latest.status === "cancelled") {
        setPdfStatus("cancelled");
      } else if (latest.status === "failed") {
        setPdfStatus("failed");
      }
    }

    void loadPdfSession();

    return () => {
      active = false;
      pdfAbortRef.current?.abort();
    };
  }, []);

  const redactionPreview = useMemo(() => redactSensitiveTextForModel(rawText), [rawText]);
  const output = draft?.manualSections ?? draft?.builderOutput;
  const pdfHasPromptInjectionRisk = Boolean(pdfSession?.hasPromptInjectionRisk);

  async function handlePdfFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    setImportMode("pdf");
    setPdfStatus("validating");
    setMessage("正在本地校验 PDF 文件，原始文件不会上传。");

    const descriptorValidation = validatePdfFileDescriptor(file);
    if (!descriptorValidation.ok) {
      setPdfStatus("failed");
      setMessage(descriptorValidation.message);
      return;
    }

    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const headerValidation = validatePdfHeader(bytes);
    if (!headerValidation.ok) {
      setPdfStatus("failed");
      setMessage(headerValidation.message);
      return;
    }

    const now = new Date().toISOString();
    const fileHash = await hashBytes(bytes);
    const duplicate = await repository.findPdfImportByFileHash(fileHash);
    const nextSession: PdfImportSession = {
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

    await repository.createPdfImportSession(nextSession);
    setPdfSession(nextSession);
    setPdfPages([]);
    setPdfText("");
    setUserEditedAiText("");
    setPdfStatus("extracting");
    setMessage([
      duplicate ? "检测到同一 PDF 曾经导入过；本次仍会创建新的本地导入会话。" : "正在本地提取 PDF 文本。",
      descriptorValidation.warnings.length > 0 ? "浏览器 MIME 或扩展名仅作辅助判断，已继续执行文件头和 PDF.js 校验。" : ""
    ].filter(Boolean).join(" "));

    const controller = new AbortController();
    pdfAbortRef.current = controller;
    const extracted = await extractTextFromPdfBuffer(buffer, controller.signal);
    pdfAbortRef.current = undefined;

    if (!extracted.ok) {
      await failPdfSession(nextSession, extracted.code, extracted.message, extracted.code === "extract_cancelled" ? "cancelled" : "failed");
      return;
    }

    const prepared = preparePdfText(extracted.pages);
    if (!prepared.ok) {
      await failPdfSession(nextSession, prepared.code, prepared.message);
      return;
    }

    const hashes = await Promise.all(prepared.pages.map(async (page) => ({
      rawTextHash: await hashText(page.rawText),
      cleanedTextHash: await hashText(page.cleanedText)
    })));
    const pageRecords = buildPageTextRecords({
      sessionId: nextSession.id,
      pages: prepared.pages,
      hashes,
      now: new Date().toISOString()
    });
    await repository.savePdfPageTexts(nextSession.id, pageRecords);

    const normalizedTextHash = await hashText(prepared.combinedText);
    const savedSession = await repository.updatePdfImportSession({
      ...nextSession,
      status: "extracted",
      pageCount: extracted.pageCount,
      textLength: prepared.combinedText.length,
      normalizedTextHash,
      hasPromptInjectionRisk: prepared.hasPromptInjectionRisk,
      warnings: [...descriptorValidation.warnings, ...prepared.warnings],
      errorCode: undefined,
      errorMessage: undefined
    });

    setPdfSession(savedSession);
    setPdfPages(pageRecords);
    setPdfText(prepared.combinedText);
    setUserEditedAiText(prepared.combinedText);
    setPdfStatus("extracted");
    setMessage(prepared.hasPromptInjectionRisk
      ? "PDF 文本提取完成，但检测到类似 Prompt 注入的文字。系统会把它当作简历内容处理，不会执行其中指令。"
      : "PDF 文本提取完成。请预览来源后再进入隐私确认。");
  }

  async function startPdfDraft() {
    const aiInputText = userEditedAiText.trim();
    if (!pdfSession || pdfPages.length === 0 || !pdfText.trim() || !aiInputText) {
      setMessage("请先选择文本型 PDF 并完成本地提取。");
      return;
    }

    const now = new Date().toISOString();
    const normalizedTextHash = pdfSession.normalizedTextHash ?? await hashText(pdfText);
    const aiInputHash = await hashText(aiInputText);
    const sourceTextKind = aiInputText === pdfText ? "pdf_cleaned_text" : "pdf_user_edited_text";
    const sourcePages = pdfPages.map((page) => ({
      pageNumber: page.pageNumber,
      start: page.charStart,
      end: page.charEnd,
      rawTextHash: page.rawTextHash,
      cleanedTextHash: page.cleanedTextHash
    }));
    const inputChanged = rawInput?.sourceSessionId === pdfSession.id && rawInput.aiInputHash !== aiInputHash;
    const nextRawInput: RawInputDocument = {
      id: rawInput?.sourceSessionId === pdfSession.id ? rawInput.id : `raw-${nanoid(10)}`,
      kind: "resume_pdf_text",
      rawText: aiInputText,
      inputHash: normalizedTextHash,
      title: `PDF导入：${pdfSession.fileName}`,
      sourceSessionId: pdfSession.id,
      sourceTextKind,
      normalizedTextHash,
      aiInputHash,
      privacyConfirmedAiInputHash: undefined,
      userEditedAiText: sourceTextKind === "pdf_user_edited_text" ? aiInputText : undefined,
      fileName: pdfSession.fileName,
      fileSize: pdfSession.fileSize,
      mimeType: pdfSession.mimeType,
      pageCount: pdfSession.pageCount,
      sourcePages,
      createdAt: rawInput?.sourceSessionId === pdfSession.id ? rawInput.createdAt : now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);
    const existingDraft = draft?.rawInputId === nextRawInput.id ? draft : undefined;
    const nextDraft: ProfileImportDraft = {
      id: existingDraft?.id ?? `profile-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: existingDraft?.revision ?? 0,
      status: "privacy_pending",
      promptVersion: promptVersions.profileBuilder,
      attemptCount: existingDraft?.attemptCount ?? 0,
      builderOutput: inputChanged ? undefined : existingDraft?.builderOutput,
      manualSections: inputChanged ? undefined : existingDraft?.manualSections,
      pendingFacts: inputChanged ? [] : existingDraft?.pendingFacts ?? [],
      privacyConfirmedAiInputHash: undefined,
      createdAt: existingDraft?.createdAt ?? now,
      updatedAt: now
    };

    const savedDraft = existingDraft
      ? await repository.saveProfileImportDraftRevision(nextDraft, existingDraft.revision)
      : await repository.createProfileImportDraft(nextDraft);
    const savedSession = await repository.updatePdfImportSession({
      ...pdfSession,
      status: "awaiting_privacy_confirmation",
      aiInputHash,
      sourceTextKind,
      rawInputId: nextRawInput.id,
      draftId: savedDraft.id
    });

    setPdfSession(savedSession);
    setRawInput(nextRawInput);
    setRawText(aiInputText);
    setDraft(savedDraft);
    setMessage("PDF 文本已保存为导入草稿。请确认是否发送脱敏内容给外部模型。");
  }

  function handlePdfAiInputChange(value: string) {
    setUserEditedAiText(value);
    if (rawInput?.sourceSessionId === pdfSession?.id && draft && draft.status !== "committed") {
      setDraft({
        ...draft,
        status: "privacy_pending",
        privacyConfirmedAiInputHash: undefined
      });
      setMessage("AI 输入文本已修改，请重新保存草稿并完成隐私确认。");
    }
  }

  async function cancelPdfExtraction() {
    pdfAbortRef.current?.abort();
    setPdfStatus("cancelled");
    if (pdfSession && pdfSession.status === "extracting") {
      const saved = await repository.updatePdfImportSession({
        ...pdfSession,
        status: "cancelled",
        errorCode: "extract_cancelled",
        errorMessage: "用户取消了 PDF 文本提取。"
      });
      setPdfSession(saved);
    }
    setMessage("PDF 文本提取已取消，已保留现有粘贴文本和草稿。");
  }

  async function deleteCurrentPdfSession() {
    if (!pdfSession) {
      return;
    }

    await repository.deletePdfImportSession(pdfSession.id);
    setPdfSession(undefined);
    setPdfPages([]);
    setPdfText("");
    setUserEditedAiText("");
    setPdfStatus("idle");
    setMessage("已删除当前 PDF 导入 session 及其页文本；已存在草稿将保留为手动处理线索。");
  }

  async function startImport() {
    if (!rawText.trim()) {
      setMessage("请先粘贴简历文本。");
      return;
    }

    const now = new Date().toISOString();
    const inputHash = await hashText(rawText);
    const nextRawInput: RawInputDocument = {
      id: rawInput?.kind === "resume_text" ? rawInput.id : `raw-${nanoid(10)}`,
      kind: "resume_text",
      rawText,
      inputHash,
      title: "简历文本导入",
      sourceTextKind: "plain_text",
      aiInputHash: inputHash,
      privacyConfirmedAiInputHash: undefined,
      createdAt: rawInput?.kind === "resume_text" ? rawInput.createdAt : now,
      updatedAt: now
    };

    await repository.saveRawInput(nextRawInput);
    const existingDraft = draft?.rawInputId === nextRawInput.id ? draft : undefined;
    const nextDraft: ProfileImportDraft = {
      id: existingDraft?.id ?? `profile-draft-${nanoid(10)}`,
      rawInputId: nextRawInput.id,
      revision: existingDraft?.revision ?? 0,
      status: "privacy_pending",
      promptVersion: promptVersions.profileBuilder,
      attemptCount: existingDraft?.attemptCount ?? 0,
      builderOutput: existingDraft?.builderOutput,
      manualSections: existingDraft?.manualSections,
      pendingFacts: existingDraft?.pendingFacts ?? [],
      privacyConfirmedAiInputHash: undefined,
      createdAt: existingDraft?.createdAt ?? now,
      updatedAt: now
    };

    const saved = existingDraft
      ? await repository.saveProfileImportDraftRevision(nextDraft, existingDraft.revision)
      : await repository.createProfileImportDraft(nextDraft);

    setRawInput(nextRawInput);
    setDraft(saved);
    setMessage("原始输入已保存。请确认是否发送脱敏内容给外部模型。");
  }

  async function failPdfSession(
    session: PdfImportSession,
    code: PdfImportErrorCode,
    errorMessage: string,
    status: PdfImportSession["status"] = "failed"
  ) {
    const saved = await repository.updatePdfImportSession({
      ...session,
      status,
      errorCode: code,
      errorMessage
    });
    setPdfSession(saved);
    setPdfStatus(status === "cancelled" ? "cancelled" : "failed");
    setMessage(`${errorMessage} 可改用粘贴文本或手动创建。`);
  }

  async function updatePdfSessionStatus(status: PdfImportSession["status"], errorCode?: PdfImportErrorCode, errorMessage?: string) {
    const sourceSessionId = rawInput?.sourceSessionId;
    if (!sourceSessionId) {
      return;
    }

    const session = pdfSession?.id === sourceSessionId ? pdfSession : await repository.getPdfImportSession(sourceSessionId);
    if (!session) {
      return;
    }

    const saved = await repository.updatePdfImportSession({
      ...session,
      status,
      errorCode,
      errorMessage
    });
    setPdfSession(saved);
  }

  function mapAiErrorToPdfError(errorCode: string): PdfImportErrorCode {
    if (errorCode === "validation_failed" || errorCode === "client_schema_validation_failed") {
      return "schema_validation_failed";
    }
    return "ai_failed";
  }

  async function analyzeWithAi() {
    if (!draft || !rawInput) {
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && userEditedAiText.trim() !== rawInput.rawText) {
      setMessage("AI 输入文本已修改，请先使用当前文本重新创建草稿并完成隐私确认。");
      return;
    }

    const aiInputHash = rawInput.aiInputHash ?? await hashText(rawInput.rawText);
    if (rawInput.privacyConfirmedAiInputHash && rawInput.privacyConfirmedAiInputHash !== aiInputHash) {
      const resetDraft = await saveDraft({
        ...draft,
        status: "privacy_pending",
        privacyConfirmedAiInputHash: undefined
      });
      setDraft(resetDraft);
      setMessage("AI 输入已在隐私确认后发生变化，请重新确认后再解析。");
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && pdfPages.length === 0) {
      const pages = rawInput.sourceSessionId ? await repository.listPdfPageTexts(rawInput.sourceSessionId) : [];
      if (pages.length === 0) {
        await updatePdfSessionStatus("failed", "extract_interrupted", "pdf_page_text_missing");
        setMessage("PDF 页文本缺失，不能把来源不可靠的内容写入事实层；请重新导入或改用手动处理。");
        return;
      }
      setPdfPages(pages);
    }

    const confirmedRawInput = await repository.saveRawInput({
      ...rawInput,
      privacyConfirmedAiInputHash: aiInputHash,
      updatedAt: new Date().toISOString()
    });
    setRawInput(confirmedRawInput);

    setMessage("正在解析，服务端会先脱敏并校验模型输出。");
    const analyzingDraft = await saveDraft({
      ...draft,
      status: "analyzing",
      privacyConfirmedAiInputHash: aiInputHash
    });
    await updatePdfSessionStatus("parsing");

    const result = await invokeStageBAi({
      task: "profile-builder",
      businessInput: {
        rawText: confirmedRawInput.rawText,
        inputHash: aiInputHash
      },
      outputSchema: ProfileBuilderOutputSchema
    });

    await repository.saveAiLogs([result.log]);

    if (!result.ok) {
      const failedAttempt = analyzingDraft.attemptCount + 1;
      const manual = failedAttempt >= 2 || result.errorCode !== "validation_failed";
      const fallbackOutput = createManualProfileOutput(rawInput.rawText);
      const saved = await saveDraft({
        ...analyzingDraft,
        status: manual ? "manual_mode" : "error",
        attemptCount: failedAttempt,
        manualSections: manual ? fallbackOutput : analyzingDraft.manualSections,
        saveError: result.errorCode
      });
      setMessage(manual ? "AI 不可用或校验失败，已进入手动分类模式。" : "AI 解析失败，可重试或改用手动分类。");
      setDraft(saved);
      await updatePdfSessionStatus("failed", mapAiErrorToPdfError(result.errorCode), result.errorCode);
      return;
    }

    const mappingPages = confirmedRawInput.kind === "resume_pdf_text"
      ? pdfPages.length > 0
        ? pdfPages
        : await repository.listPdfPageTexts(confirmedRawInput.sourceSessionId ?? "")
      : [];
    const builderOutput = confirmedRawInput.kind === "resume_pdf_text"
      ? applyPdfSourceMappingToProfileOutput(result.data, mappingPages)
      : result.data;

    const saved = await saveDraft({
      ...analyzingDraft,
      status: "ai_validated",
      attemptCount: analyzingDraft.attemptCount + 1,
      promptVersion: result.promptVersion,
      builderOutput,
      pendingFacts: builderOutput.experiences.flatMap((experience) => experience.facts),
      saveError: undefined
    });
    setDraft(saved);
    await updatePdfSessionStatus("draft_ready");
    setMessage("解析完成。请核对原文依据并勾选确认事实。");
  }

  async function enterManualMode() {
    if (!draft || !rawInput) {
      return;
    }

    const saved = await saveDraft({
      ...draft,
      status: "manual_mode",
      manualSections: draft.manualSections ?? draft.builderOutput ?? createManualProfileOutput(rawInput.rawText)
    });
    setDraft(saved);
    setMessage("已进入手动分类模式，外部模型不会被调用。");
  }

  async function toggleFact(factId: string, checked: boolean) {
    if (!draft || !output) {
      return;
    }

    if (rawInput?.kind === "resume_pdf_text" && checked) {
      const fact = output.experiences.flatMap((experience) => experience.facts).find((item) => item.id === factId)
        ?? output.skills.find((item) => item.id === factId)
        ?? output.certificates.find((item) => item.id === factId);
      if (fact && !isPdfEvidenceLocated(fact)) {
        setMessage("该事实在 PDF 页文本中未唯一定位，不能直接确认进入正式事实层。");
        return;
      }
    }

    const nextOutput: ProfileBuilderOutput = {
      ...output,
      experiences: output.experiences.map((experience) => ({
        ...experience,
        facts: experience.facts.map((fact) =>
          fact.id === factId
            ? {
                ...fact,
                confirmedByUser: checked,
                needsConfirmation: !checked
              }
            : fact
        )
      })),
      skills: output.skills.map((skill) =>
        skill.id === factId
          ? {
              ...skill,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : skill
      ),
      certificates: output.certificates.map((certificate) =>
        certificate.id === factId
          ? {
              ...certificate,
              confirmedByUser: checked,
              needsConfirmation: !checked
            }
          : certificate
      )
    };

    const saved = await saveDraft({
      ...draft,
      status: draft.status === "ai_validated" ? "editing" : draft.status,
      builderOutput: draft.builderOutput ? nextOutput : draft.builderOutput,
      manualSections: draft.manualSections ? nextOutput : draft.manualSections
    });
    setDraft(saved);
  }

  async function commitProfile() {
    if (!draft || !rawInput) {
      return;
    }

    if (rawInput.kind === "resume_pdf_text" && workspace.status === "ready" && workspace.profiles.length > 0 && !draft.committedProfileId) {
      setSaveStatus("failed");
      setMessage("当前应用尚未提供多职业母档案选择/合并流程；已有正式 Profile 时，PDF 导入结果已保留为草稿，请手动核对处理。");
      return;
    }

    try {
      setSaveStatus("saving");
      const profile = mapProfileDraftToCareerProfile({ draft, rawInput });
      const result = await repository.commitProfileDraft({
        draftId: draft.id,
        expectedRevision: draft.revision,
        commitId: `commit-profile-${draft.id}`,
        profile
      });
      setDraft({
        ...draft,
        status: "committed",
        revision: draft.revision + (result.idempotent ? 0 : 1),
        committedProfileId: result.profile.id,
        committedAt: new Date().toISOString()
      });
      if (rawInput.sourceSessionId) {
        const session = await repository.getPdfImportSession(rawInput.sourceSessionId);
        if (session) {
          const savedSession = await repository.updatePdfImportSession({
            ...session,
            status: "committed",
            committedProfileId: result.profile.id,
            committedAt: new Date().toISOString()
          });
          setPdfSession(savedSession);
        }
      }
      setSaveStatus("saved");
      setMessage(`已写入正式职业母档案：${result.profile.name}`);
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      setMessage(error instanceof RevisionConflictError ? "提交失败：草稿版本已变化，请刷新后重试。" : "提交失败，请检查已确认事实。低置信度或未定位来源不会进入正式档案。");
    }
  }

  async function saveDraft(nextDraft: ProfileImportDraft) {
    setSaveStatus("saving");
    try {
      const saved = await repository.saveProfileImportDraftRevision(nextDraft, nextDraft.revision);
      setSaveStatus("saved");
      return saved;
    } catch (error) {
      setSaveStatus(error instanceof RevisionConflictError ? "conflict" : "failed");
      throw error;
    }
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

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;

  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Stage E1 / Career Master Profile</p>
        <h1>职业母档案导入</h1>
        <p>粘贴文本或导入文本型 PDF，先生成可校对草稿；用户确认前不会写入正式事实层。</p>
      </section>

      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}
      {message ? <section className="notice">{message}</section> : null}

      <section className="action-row import-tabs">
        <button className={importMode === "paste" ? "primary-button" : "secondary-button"} onClick={() => setImportMode("paste")}>
          粘贴文本
        </button>
        <button className={importMode === "pdf" ? "primary-button" : "secondary-button"} onClick={() => setImportMode("pdf")}>
          导入文本型 PDF
        </button>
      </section>

      <section className="stage-grid">
        {importMode === "paste" ? (
          <article className="panel">
            <h2>1. 粘贴简历文本</h2>
            <textarea
              className="textarea"
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="粘贴简历、经历清单或已有简历文本..."
            />
            <div className="action-row">
              <button className="primary-button" onClick={startImport}>
                保存原文
              </button>
              <span className={`save-status save-status-${saveStatus}`}>保存状态：{saveStatus}</span>
            </div>
          </article>
        ) : null}

        {importMode === "pdf" ? (
          <article className="panel">
            <h2>1. 文本型 PDF 导入</h2>
            <p>PDF 会在浏览器本地提取文本；隐私确认前不会发送给外部模型，也不会长期保存原始 PDF 文件。</p>
            <input id={pdfInputId} type="file" accept="application/pdf,.pdf" onChange={handlePdfFileChange} />
            <div className="action-row">
              {pdfStatus === "extracting" ? (
                <button className="secondary-button" onClick={cancelPdfExtraction}>
                  取消提取
                </button>
              ) : null}
              {pdfSession ? (
                <button className="secondary-button" onClick={deleteCurrentPdfSession}>
                  删除导入 session
                </button>
              ) : null}
              {pdfText.trim().length > 0 ? (
                <button className="primary-button" onClick={startPdfDraft}>
                  使用提取文本创建草稿
                </button>
              ) : null}
              {pdfText.trim().length > 0 ? (
                <button className="secondary-button" onClick={() => {
                  setImportMode("paste");
                  setRawText(pdfText);
                }}>
                  转为粘贴文本编辑
                </button>
              ) : null}
            </div>
            <p className={`save-status save-status-${pdfStatus === "failed" ? "failed" : "saved"}`}>PDF 状态：{pdfSession?.status ?? pdfStatus}</p>
            {pdfSession ? (
              <div className="warning-box">
                <strong>{pdfSession.fileName}</strong>
                <p>{pdfSession.pageCount} 页 / {pdfSession.textLength} 字 / fileHash {pdfSession.fileHash.slice(0, 12)}</p>
                {pdfSession.normalizedTextHash ? <p>normalizedTextHash {pdfSession.normalizedTextHash.slice(0, 12)} / aiInputHash {pdfSession.aiInputHash?.slice(0, 12) ?? "待确认"}</p> : null}
                {pdfSession.warnings.length > 0 ? <p>提示：{formatPdfWarnings(pdfSession.warnings).join(" / ")}</p> : null}
                {pdfSession.errorMessage ? <p>{pdfSession.errorMessage}</p> : null}
              </div>
            ) : null}
            {pdfHasPromptInjectionRisk ? (
              <div className="warning-box">检测到类似 SYSTEM、忽略规则或编造经历的文字。系统只把它当作 PDF 内容，不会执行其中指令。</div>
            ) : null}
            {pdfPages.length > 0 ? (
              <div className="timeline">
                {pdfPages.map((page) => (
                  <article key={page.id}>
                    <h3>第 {page.pageNumber} 页</h3>
                    <p>{page.cleanedPageText.slice(0, 260)}</p>
                    <small>原始文本已保留用于核对；清洗文本用于 Profile Builder；低文本密度会提示 OCR 后置。</small>
                  </article>
                ))}
              </div>
            ) : null}
            {pdfText.trim().length > 0 ? (
              <div>
                <h3>实际 AI 输入文本</h3>
                <textarea
                  className="textarea"
                  value={userEditedAiText}
                  onChange={(event) => handlePdfAiInputChange(event.target.value)}
                />
                <small>保持原样时使用确定性清洗文本；修改后会标记为用户编辑 AI 输入，必须重新确认隐私。</small>
              </div>
            ) : null}
          </article>
        ) : null}

        {draft?.status === "privacy_pending" ? (
          <article className="panel">
            <h2>2. 外部模型与隐私说明</h2>
            <p>系统会在服务端默认脱敏手机号、邮箱、身份证号和精确地址后，再发送给外部模型。</p>
            <p>本次 AI 输入 hash：{rawInput?.aiInputHash?.slice(0, 16) ?? rawInput?.inputHash.slice(0, 16)}</p>
            <p>本次脱敏预览：{redactionPreview.redactions.length === 0 ? "未发现需脱敏内容" : redactionPreview.redactions.map((item) => `${item.type} x${item.count}`).join(" / ")}</p>
            <div className="action-row">
              <button className="primary-button" onClick={analyzeWithAi}>
                同意脱敏并解析
              </button>
              <button className="secondary-button" onClick={enterManualMode}>
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
              <h2>解析草稿与原文依据</h2>
              <p>只勾选你确认属实的事实；未定位原文的低置信度内容不会进入正式母档案。</p>
            </div>
            <button className="primary-button" onClick={commitProfile}>
              提交正式母档案
            </button>
          </div>
          <div className="timeline">
            {output.experiences.map((experience) => (
              <article key={experience.id}>
                <h3>{experience.organization.value} / {experience.role.value}</h3>
                {experience.facts.map((fact) => (
                  <FactReviewRow key={fact.id} fact={fact} requirePdfLocation={rawInput?.kind === "resume_pdf_text"} onToggle={toggleFact} />
                ))}
              </article>
            ))}
          </div>
          {output.unclassifiedBlocks.length > 0 ? (
            <div className="warning-box">
              <strong>未分类内容</strong>
              {output.unclassifiedBlocks.map((block) => (
                <p key={block}>{block}</p>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <h2>当前正式职业母档案</h2>
        {profile ? (
          <div className="timeline">
            <article>
              <h3>{profile.name}</h3>
              <p>{profile.basics.summary}</p>
              <p>{profile.experiences.length} 段经历 / {profile.skills.length} 项技能 / v{profile.version}</p>
            </article>
          </div>
        ) : (
          <p>暂无正式母档案。</p>
        )}
      </section>
    </main>
  );
}

function FactReviewRow({
  fact,
  requirePdfLocation,
  onToggle
}: {
  fact: ProfileBuilderFact;
  requirePdfLocation: boolean;
  onToggle: (factId: string, checked: boolean) => void;
}) {
  const pdfLocatorStatus = fact.sourceLocatorStatus;
  const disabled = requirePdfLocation ? !isPdfEvidenceLocated(fact) : !fact.sourceSpan;
  return (
    <label className="review-row">
      <input
        type="checkbox"
        checked={fact.confirmedByUser}
        disabled={disabled}
        onChange={(event) => onToggle(fact.id, event.target.checked)}
      />
      <span>
        <strong>{fact.statement}</strong>
        <small>
          {fact.confidenceLevel} / {fact.confidenceReason} / 定位：{pdfLocatorStatus ?? (fact.sourceSpan ? "located" : "unlocated")} / 原文：{fact.sourceSpan?.text ?? "未定位，待确认"}
        </small>
      </span>
    </label>
  );
}

function createManualProfileOutput(rawText: string): ProfileBuilderOutput {
  const now = new Date().toISOString();
  const sourceQuote = rawText.split(/\r?\n/).find(Boolean)?.slice(0, 120) || rawText.slice(0, 120);
  const start = rawText.indexOf(sourceQuote);
  const sourceSpan = start >= 0 ? { start, end: start + sourceQuote.length, text: sourceQuote } : undefined;

  return {
    basics: {
      name: {
        value: "待确认用户",
        sourceQuote,
        sourceSpan,
        confidenceLevel: "low",
        confidenceReason: "手动模式默认占位，需要用户确认。",
        needsConfirmation: true
      },
      links: []
    },
    experiences: [
      {
        id: `manual-exp-${nanoid(8)}`,
        type: "other",
        organization: {
          value: "待分类经历",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        role: {
          value: "待确认角色",
          sourceQuote,
          sourceSpan,
          confidenceLevel: "low",
          confidenceReason: "手动模式默认分类。",
          needsConfirmation: true
        },
        facts: [
          {
            id: `manual-fact-${nanoid(8)}`,
            statement: sourceQuote || "待补充事实",
            category: "experience",
            sourceQuote: sourceQuote || rawText,
            sourceSpan,
            confidenceLevel: "low",
            confidenceReason: "用户拒绝外部处理或 AI 不可用，需要手动确认。",
            needsConfirmation: true,
            confirmedByUser: false,
            createdAt: now,
            updatedAt: now
          }
        ],
        tags: [],
        confirmedByUser: false,
        createdAt: now,
        updatedAt: now
      }
    ],
    skills: [],
    certificates: [],
    unclassifiedBlocks: []
  };
}

function formatPdfWarnings(warnings: string[]) {
  return warnings.map((warning) => {
    if (warning.startsWith("complex_layout")) {
      return "版面复杂：疑似双栏，文本顺序可能需要人工核对";
    }
    if (warning.startsWith("low_text_density")) {
      return "文本层过少：疑似扫描件，OCR 已后置";
    }
    if (warning.startsWith("mime_untrusted")) {
      return "MIME 不可信：已通过文件头和 PDF.js 继续校验";
    }
    if (warning.startsWith("extension_not_pdf")) {
      return "扩展名不是 .pdf：已通过文件头和 PDF.js 继续校验";
    }
    if (warning.startsWith("text_item_density")) {
      return "文本对象较多：已按上限保护处理";
    }
    return warning;
  });
}
