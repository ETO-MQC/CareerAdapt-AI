"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { MaterialSourceReview } from "./MaterialSourceReview";
import type { MaterialIntakeArtifact } from "@/domain/materialIntake/materialIntake";
import { ImportReviewDialog } from "./ImportReviewDialog";
import { ResumeImportWizard } from "./ResumeImportWizard";
import { RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";
import { agentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { MaterialIntakeService } from "@/services/materialIntake/MaterialIntakeService";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { readResumeImportSemanticPreference, writeResumeImportSemanticPreference } from "@/services/preferences/resumeImportAi";
import type { CareerProfile } from "@/domain/schemas";

const repository = new WorkspaceRepository();

export function MaterialIntakeDialog(props: { open: boolean; onClose(): void; profile?: CareerProfile; profiles: CareerProfile[] }) {
  const [sessionId, setSessionId] = useState(() => `material-center-${crypto.randomUUID()}`);
  const [importId, setImportId] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachmentId, setAttachmentId] = useState<string>();
  const [manualText, setManualText] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const [artifact, setArtifact] = useState<MaterialIntakeArtifact>();
  const [history, setHistory] = useState<Array<{ importId: string; fileName: string; status: string }>>([]);
  const pointerKey = `material-center:${props.profile?.id ?? "new"}`;
  useEffect(() => {
    if (!props.open) return;
    let active = true;
    void (async () => {
      const row = await repository.getMeta(pointerKey);
      const imports = await repository.listMaterialImports(props.profile?.id);
      if (!active) return;
      setHistory(imports.map((draft) => ({ importId: draft.importId, fileName: draft.source.fileName, status: draft.status })));
      if (!row) { setImportId(undefined); setAttachmentId(undefined); setArtifact(undefined); setNotice(""); setError(""); return; }
      const saved = z.object({ sessionId: z.string(), attachmentId: z.string(), fileName: z.string(), importId: z.string().optional() }).parse(row.value);
      setSessionId(saved.sessionId); setAttachmentId(saved.attachmentId); setSourceFileName(saved.fileName);
      const source = await repository.getMaterialIntake(saved.attachmentId, saved.sessionId);
      if (!active) return;
      setArtifact(source);
      const id = source?.importId ?? saved.importId;
      const draft = id ? await repository.getImportedResumeDraft(id) : undefined;
      if (!active) return;
      if (draft?.status === "confirmed") { setImportId(undefined); setNotice("该材料已保存，可回读历史来源。"); }
      else if (draft) setImportId(draft.importId);
      else setError("原附件已恢复，可重试识别或对照原件补充文字。");
    })().catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : "恢复材料失败。"); });
    return () => { active = false; };
  }, [props.open, pointerKey, props.profile?.id]);
  const controller = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"local" | "ai">(() => readResumeImportSemanticPreference() === "ai" ? "ai" : "local");
  const close = () => { controller.current?.abort(); setBusy(false); props.onClose(); };
  return <ImportReviewDialog open={props.open} title="导入资料" description="证书、奖项、成绩单与经历证明，核对后加入个人资料库。" onClose={close}>
    {importId ? <div style={{ display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><p style={{ margin: 0 }}>来源：{sourceFileName}</p><button className="secondary-button compact" type="button" onClick={() => { setImportId(undefined); setArtifact(undefined); setAttachmentId(undefined); setError(""); setNotice("原审核任务已保留，可从材料任务与历史来源重新打开。"); }}>选择另一份材料</button></div><ResumeImportWizard repository={repository} profile={props.profile} profiles={props.profiles}
      initialImportId={importId} initialCreateGeneralResume={false} onImported={async () => close()} /></div> : <div className="material-intake-entry">
      <p>使用与 AI 工作台相同的来源解析与核对流程。</p>
      <label className="field-label">识别方式<select value={mode} disabled={busy} onChange={(event) => setMode(event.target.value as "local" | "ai")}>
        <option value="local">仅本地解析 / OCR</option><option value="ai">允许 AI 识别并整理字段</option>
      </select></label>
      {mode === "ai" ? <p>图片和来源文字会发送给已配置的 AI 服务，请确认材料可用于识别。</p> : null}
      <label className="field-label">选择职业材料<input type="file" accept={RESUME_IMPORT_ACCEPT} disabled={busy} onChange={async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setSourceFileName(file.name);
        setError(""); setNotice(""); setBusy(true);
        const abort = new AbortController(); controller.current = abort;
        try {
          writeResumeImportSemanticPreference(mode);
          const uploadSessionId = `material-center-${crypto.randomUUID()}`;
          setSessionId(uploadSessionId);
          const ref = await agentAttachmentStore.register(file, { agentSessionId: uploadSessionId });
          setAttachmentId(ref.id);
          await repository.setMeta(pointerKey, { sessionId: uploadSessionId, attachmentId: ref.id, fileName: file.name });
          const prepared = await new MaterialIntakeService(repository).prepare({ attachmentId: ref.id, targetProfileId: props.profile?.id, newProfileIntentId: uploadSessionId, destination: "profile" }, uploadSessionId, abort.signal);
          if (!abort.signal.aborted) {
            setArtifact(prepared.artifact);
            setImportId(prepared.importId);
            if (prepared.status === "already_saved") setNotice(prepared.userPrompt ?? "这份材料已经确认保存。");
            if (prepared.nextAction === "manual_review") setError(prepared.userPrompt ?? "请对照原件补充可辨认文字。");
          }
        } catch (failure) {
          if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "材料读取失败，请重试。");
        } finally { if (!abort.signal.aborted) setBusy(false); }
      }} /></label>
      {busy ? <p role="status">正在读取来源并生成核对草稿…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice} <a href="/profile">查看个人资料库</a></p> : null}
      {artifact ? <MaterialSourceReview artifact={artifact} repository={repository} /> : null}
      {history.length ? <details><summary>材料任务与历史来源</summary>{history.map((entry) => <button className="secondary-button" key={entry.importId} type="button" onClick={async () => {
        const sources = await repository.getMaterialSources(entry.importId);
        setArtifact(sources[0]);
        if (entry.status !== "confirmed") setImportId(entry.importId);
        else setNotice("已正式保存；以下为原始来源，继续使用新材料需要独立核对。");
      }}>{entry.fileName} · {entry.status}</button>)}</details> : null}
      {attachmentId && error ? <>
        <button className="secondary-button" type="button" disabled={busy} onClick={async () => {
          setBusy(true); setError("");
          const abort = new AbortController(); controller.current = abort;
          try {
            const prepared = await new MaterialIntakeService(repository).prepare({ attachmentId, retryOcr: true, targetProfileId: props.profile?.id, newProfileIntentId: sessionId, destination: "profile" }, sessionId, abort.signal);
            if (!abort.signal.aborted) { setArtifact(prepared.artifact); setImportId(prepared.importId); if (prepared.nextAction === "manual_review") setError(prepared.userPrompt ?? "识别仍不可用，请人工转写。"); }
          } catch (failure) { if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "识别失败。"); }
          finally { if (!abort.signal.aborted) setBusy(false); }
        }}>重试原附件 OCR</button>
        <label className="field-label">对照原件补充文字<textarea value={manualText} onChange={(event) => setManualText(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy || !manualText.trim()} onClick={async () => {
          setBusy(true); setError("");
          const abort = new AbortController(); controller.current = abort;
          try {
            const prepared = await new MaterialIntakeService(repository).prepare({ attachmentId, manualText, targetProfileId: props.profile?.id, newProfileIntentId: sessionId, destination: "profile" }, sessionId, abort.signal);
            if (!abort.signal.aborted) { setArtifact(prepared.artifact); setImportId(prepared.importId); }
          } catch (failure) {
            if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "转写整理失败。");
          } finally { if (!abort.signal.aborted) setBusy(false); }
        }}>继续核对</button>
      </> : null}
    </div>}
  </ImportReviewDialog>;
}
