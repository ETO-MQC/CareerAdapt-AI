"use client";

import Image from "next/image";
import { useRef, useState, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { localResumePhoto } from "@/domain/schemas/resumePhoto";
import { prepareResumePhoto } from "@/services/resumePhoto";

export function ResumePhotoInput({ photo, disabled, onSave, visibilityControl }: {
  photo?: string; disabled: boolean; onSave: (photo: string | undefined) => Promise<void>;
  visibilityControl?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const previewPhoto = localResumePhoto(photo);
  async function save(file?: File) {
    setBusy(true); setError("");
    try { await onSave(file ? await prepareResumePhoto(file) : undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "照片保存失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <div className="resume-photo-input">
    <button type="button" className="resume-photo-upload" disabled={disabled || busy} onClick={() => inputRef.current?.click()} aria-label={photo ? "更换照片" : "添加照片"}>
      {previewPhoto ? <Image unoptimized loading="eager" src={previewPhoto} alt="已保存的简历照片" width={84} height={112} /> : <ImagePlus size={26} aria-hidden="true" />}
      <span>{busy ? "保存中…" : photo ? "更换照片" : "添加照片"}</span>
    </button>
    <input ref={inputRef} id="resume-photo-file" aria-label="上传简历照片" hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy}
      onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void save(file); }} />
    {busy ? <small className="field-help-text" role="status">正在处理并保存照片…</small> : null}
    {photo && !localResumePhoto(photo) ? <p className="field-help-text">旧照片为外部链接，请重新上传本地图片以用于预览和 PDF。</p> : null}
    {photo ? <div className="resume-photo-actions">{visibilityControl}<button className="section-action-button" type="button" aria-label="移除照片" title="移除照片" disabled={disabled || busy} onClick={() => void save()}>移除</button></div> : null}
    {error ? <p role="alert" className="field-error">{error}</p> : null}
  </div>;
}
