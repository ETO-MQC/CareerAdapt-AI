"use client";

import { useRef, useState } from "react";
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
  const [sessionId] = useState(() => `material-center-${crypto.randomUUID()}`);
  const [importId, setImportId] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachmentId, setAttachmentId] = useState<string>();
  const [manualText, setManualText] = useState("");
  const [sourceFileName, setSourceFileName] = useState("");
  const controller = useRef<AbortController | null>(null);
  const [mode, setMode] = useState<"local" | "ai">(() => readResumeImportSemanticPreference() === "ai" ? "ai" : "local");
  const close = () => { controller.current?.abort(); props.onClose(); };
  return <ImportReviewDialog open={props.open} title="导入资料" description="证书、奖项、成绩单与经历证明，核对后加入个人资料库。" onClose={close}>
    {importId ? <><p>来源：{sourceFileName}</p><ResumeImportWizard repository={repository} profile={props.profile} profiles={props.profiles}
      initialImportId={importId} initialCreateGeneralResume={false} onImported={async () => close()} /></> : <div className="material-intake-entry">
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
          const ref = await agentAttachmentStore.register(file, { agentSessionId: sessionId });
          setAttachmentId(ref.id);
          const prepared = await new MaterialIntakeService(repository).prepare({ attachmentId: ref.id, destination: "profile" }, sessionId, abort.signal);
          if (!abort.signal.aborted) {
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
      {attachmentId && error ? <>
        <label className="field-label">对照原件补充文字<textarea value={manualText} onChange={(event) => setManualText(event.target.value)} /></label>
        <button className="primary-button" type="button" disabled={busy || !manualText.trim()} onClick={async () => {
          setBusy(true); setError("");
          const abort = new AbortController(); controller.current = abort;
          try {
            const prepared = await new MaterialIntakeService(repository).prepare({ attachmentId, manualText, destination: "profile" }, sessionId, abort.signal);
            if (!abort.signal.aborted) setImportId(prepared.importId);
          } catch (failure) {
            if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "转写整理失败。");
          } finally { if (!abort.signal.aborted) setBusy(false); }
        }}>继续核对</button>
      </> : null}
    </div>}
  </ImportReviewDialog>;
}
