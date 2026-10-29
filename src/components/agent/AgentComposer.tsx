"use client";

import {
  BriefcaseBusiness,
  Database,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Send,
  Square,
  Wrench,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ImportReviewDialog } from "@/components/resume/import/ImportReviewDialog";
import type { AgentUiAction } from "@/agent/contracts/agentActions";
import type { AgentMessageReference, WorkflowUserInputCheckpoint } from "@/agent/contracts/agentSession";
import { AGENT_RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";

export type ComposerAttachmentDraft = {
  attachmentId?: string;
  clientId: string;
  file: File;
  fileName: string;
  mimeType: string;
  size: number;
  status: "staged" | "registering" | "queued" | "failed";
  errorCode?: string;
};

export type ComposerSubmit = {
  text: string;
  attachments: ComposerAttachmentDraft[];
};

export function AgentComposer(props: {
  disabled?: boolean;
  running?: boolean;
  queuedCount?: number;
  aiStatus?: string;
  checkpoint?: WorkflowUserInputCheckpoint;
  draft?: string;
  reference?: AgentMessageReference;
  onRemoveReference?(): void;
  onDraftChange?(value: string): void;
  attachments: ComposerAttachmentDraft[];
  onFilesSelected(files: File[]): void;
  onRemoveAttachment(clientId: string): void;
  onSubmit(input: ComposerSubmit): Promise<void> | void;
  onSubmissionError?(error: unknown): void;
  canFinish?: boolean;
  onFinish?(): Promise<void> | void;
  onUiAction?(action: AgentUiAction): void;
  uploadFocusSignal?: number;
  onStop?(): void;
}) {
  const [localMessage, setLocalMessage] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploadHighlighted, setUploadHighlighted] = useState(false);
  const [preview, setPreview] = useState<ComposerAttachmentDraft>();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const message = props.draft ?? localMessage;
  const interactionPlaceholder = props.checkpoint
    ? workflowInteractionPlaceholder(props.checkpoint)
    : "描述你的求职任务，或粘贴一份岗位描述...";
  const setMessage = (value: string) => {
    props.onDraftChange?.(value);
    if (props.draft === undefined) setLocalMessage(value);
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
  }, [message]);

  useEffect(() => {
    if (!props.uploadFocusSignal) return;
    inputRef.current?.focus();
    inputRef.current?.click();
    const highlightTimer = window.setTimeout(() => setUploadHighlighted(true), 0);
    const clearTimer = window.setTimeout(() => setUploadHighlighted(false), 1800);
    return () => {
      window.clearTimeout(highlightTimer);
      window.clearTimeout(clearTimer);
    };
  }, [props.uploadFocusSignal]);

  const stageFiles = (files: FileList | File[]) => {
    const selected = Array.from(files).filter((file) => file.size >= 0);
    if (selected.length) props.onFilesSelected(selected);
  };
  const canSubmit = Boolean(message.trim() || props.attachments.length) && !props.attachments.some((attachment) => attachment.status === "registering");

  return (
    <form
      className={dragActive ? "agent-composer is-dragging" : "agent-composer"}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragActive(false);
        stageFiles(event.dataTransfer.files);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!canSubmit || props.disabled) return;
        try {
          await props.onSubmit({ text: message.trim(), attachments: props.attachments });
        } catch (error) {
          props.onSubmissionError?.(error);
        }
      }}
    >
      {props.reference ? (
        <div className="agent-reference-chip" aria-label="引用的 AI 回复">
          <div><strong>回复 AI</strong><span>“{props.reference.excerpt ?? "已引用一条回复"}”</span></div>
          <button type="button" aria-label="移除引用" onClick={props.onRemoveReference}><X aria-hidden="true" /></button>
        </div>
      ) : null}
      {props.attachments.length ? (
        <div className="agent-attachment-list" aria-live="polite">
          {props.attachments.map((attachment) => (
            <span className={`agent-attachment-chip is-${attachment.status}`} key={attachment.clientId}>
              {attachment.status === "registering" ? <LoaderCircle aria-hidden="true" className="is-spinning" /> : attachment.file.type.startsWith("image/") ? <AttachmentImage file={attachment.file} thumbnail /> : <FileText aria-hidden="true" />}
              <button className="agent-attachment-preview-button" type="button" title={attachment.fileName} aria-label={`预览附件 ${attachment.fileName}`} onClick={() => setPreview(attachment)}>{attachment.fileName}</button>
              <small>{statusLabel(attachment.status, attachment.errorCode)}</small>
              <button type="button" aria-label={`移除附件 ${attachment.fileName}`} onClick={() => props.onRemoveAttachment(attachment.clientId)}><X aria-hidden="true" /></button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="agent-composer-input-row">
        <label className="sr-only" htmlFor="agent-message-input">描述你的求职任务</label>
        <textarea
          ref={textareaRef}
          id="agent-message-input"
          name="agentMessage"
          rows={1}
          value={message}
          disabled={props.disabled}
          data-agent-checkpoint-kind={props.checkpoint?.kind}
          data-agent-checkpoint-id={props.checkpoint?.checkpointId}
          data-agent-interaction-id={props.checkpoint?.interactionId}
          data-agent-interaction-revision={props.checkpoint?.revision}
          autoComplete="off"
          placeholder={interactionPlaceholder}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
      </div>

      <div className="agent-composer-toolbar">
        <button className={uploadHighlighted ? "agent-composer-icon-button is-highlighted" : "agent-composer-icon-button"} type="button" aria-label="上传文件" title="上传文件" disabled={props.disabled} onClick={() => inputRef.current?.click()}><Plus aria-hidden="true" /></button>
        <input ref={inputRef} className="sr-only" type="file" multiple accept={AGENT_RESUME_IMPORT_ACCEPT} disabled={props.disabled} onChange={(event) => { stageFiles(event.target.files ?? []); event.currentTarget.value = ""; }} />
        <div className="agent-composer-tools">
          <button type="button" onClick={() => props.onUiAction?.({ type: "open_resume_picker" })}><FileText aria-hidden="true" /><span>选择简历</span></button>
          <button type="button" onClick={() => props.onUiAction?.({ type: "open_job_import_dialog" })}><BriefcaseBusiness aria-hidden="true" /><span>导入岗位</span></button>
          <button type="button" onClick={() => props.onUiAction?.({ type: "open_profile_browser" })}><Database aria-hidden="true" /><span>从资料库</span></button>
          <button type="button" onClick={() => props.onUiAction?.({ type: "open_tool_palette" })}><Wrench aria-hidden="true" /><span>工具</span></button>
          {props.canFinish ? <button type="button" disabled={props.disabled} onClick={() => void props.onFinish?.()}><span>完成整理</span></button> : null}
        </div>
        <div className="agent-composer-submit">
          <span>{props.aiStatus ?? (props.checkpoint ? "等待回答" : props.queuedCount ? `已排队 ${props.queuedCount} 条` : props.running ? "AI 正在处理，可继续发送排队" : "AI 就绪")}</span>
          {props.running ? <><button className="agent-send-button" type="submit" disabled={props.disabled || !canSubmit} aria-label="排队发送消息"><Send aria-hidden="true" /></button><button className="agent-stop-button" type="button" aria-label="停止运行" onClick={props.onStop}><Square aria-hidden="true" /></button></> : <button className="agent-send-button" type="submit" disabled={props.disabled || !canSubmit} aria-label="发送消息"><Send aria-hidden="true" /></button>}
        </div>
      </div>
      <span className="agent-drop-hint"><Paperclip aria-hidden="true" /> 松开即可添加文件</span>
      <ImportReviewDialog open={Boolean(preview)} title={preview?.fileName ?? "附件预览"} onClose={() => setPreview(undefined)}>
        {preview ? <AttachmentPreview key={preview.clientId} attachment={preview} /> : null}
      </ImportReviewDialog>
    </form>
  );
}

function AttachmentImage({ file, thumbnail = false }: { file: File; thumbnail?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  // Local blob previews have no remote image optimizer and must recreate URLs on effect replay.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} alt={thumbnail ? "" : file.name} width={thumbnail ? 28 : 1200} height={thumbnail ? 28 : 900} className={thumbnail ? "agent-attachment-thumbnail" : "agent-attachment-image"} />;
}

function AttachmentPreview({ attachment }: { attachment: ComposerAttachmentDraft }) {
  const [text, setText] = useState("");
  useEffect(() => {
    let active = true;
    if (/\.(txt|md|markdown|json)$/iu.test(attachment.fileName)) {
      void attachment.file.text().then((value) => { if (active) setText(value); });
    }
    return () => { active = false; };
  }, [attachment]);
  if (attachment.file.type.startsWith("image/")) return <AttachmentImage file={attachment.file} />;
  if (attachment.mimeType === "application/pdf" || /\.pdf$/iu.test(attachment.fileName)) return <AttachmentPdf file={attachment.file} />;
  return <div><p>{attachment.fileName} · {Math.ceil(attachment.size / 1024)} KB</p>{text ? <pre className="agent-attachment-text-preview">{text}</pre> : <p>发送后可在来源核对中查看文档解析内容。</p>}</div>;
}

function AttachmentPdf({ file }: { file: File }) {
  const ref = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (ref.current) ref.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <iframe ref={ref} className="agent-attachment-pdf" title={file.name} sandbox="allow-same-origin" />;
}

function statusLabel(status: ComposerAttachmentDraft["status"], errorCode?: string) {
  if (status === "staged") return "待发送";
  if (status === "registering") return "登记中";
  if (status === "queued") return "已排队";
  return errorCode ? `失败 · ${errorCode}` : "失败，可重试";
}

function workflowInteractionPlaceholder(checkpoint: WorkflowUserInputCheckpoint) {
  switch (checkpoint.kind) {
    case "clarification":
      return "补充你的实际经历，或回复“跳过”…";
    case "review_decision":
      return "补充经历，或告诉我还需要调整什么…";
    case "confirmation":
      return "输入“确认”或“取消”…";
    case "resume_choice":
      return "输入简历名称，或选择一个选项…";
    case "job_choice":
      return "输入岗位名称，或选择一个选项…";
    case "target_persistence_choice":
      return "输入“保存”或“仅本次”…";
    default:
      return "补充当前步骤需要的信息…";
  }
}
