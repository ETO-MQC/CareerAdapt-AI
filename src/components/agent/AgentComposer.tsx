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
import type { AgentUiAction } from "@/agent/contracts/agentActions";
import type { AgentMessageReference, WorkflowUserInputCheckpoint } from "@/agent/contracts/agentSession";
import { AGENT_RESUME_IMPORT_ACCEPT } from "@/agent/capabilities/AgentProductCapabilityManifest";

export type ComposerAttachmentDraft = {
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
  const canSubmit = Boolean(message.trim() || props.attachments.length);

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
              {attachment.status === "registering" ? <LoaderCircle aria-hidden="true" className="is-spinning" /> : <FileText aria-hidden="true" />}
              <span title={attachment.fileName}>{attachment.fileName}</span>
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
    </form>
  );
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
      return "告诉我哪些修改采用、编辑或忽略…";
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
