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
import { useRef, useState } from "react";

type Attachment = {
  id: string;
  name: string;
  status: "uploading" | "ready" | "partial" | "failed";
};

export function AgentComposer(props: {
  disabled?: boolean;
  running?: boolean;
  aiStatus?: string;
  onSend(message: string): Promise<void> | void;
  onUpload(file: File): Promise<"ready" | "partial" | void> | "ready" | "partial" | void;
  onStop?(): void;
}) {
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    const id = crypto.randomUUID();
    setAttachments((items) => [...items, { id, name: file.name, status: "uploading" }]);
    try {
      const result = await props.onUpload(file);
      setAttachments((items) => items.map((item) =>
        item.id === id ? { ...item, status: result === "partial" ? "partial" : "ready" } : item
      ));
    } catch {
      setAttachments((items) => items.map((item) =>
        item.id === id ? { ...item, status: "failed" } : item
      ));
    }
  };

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
        const file = event.dataTransfer.files[0];
        if (file) void uploadFile(file);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        const content = message.trim();
        if (!content || props.disabled || props.running) return;
        setMessage("");
        await props.onSend(content);
      }}
    >
      {attachments.length ? (
        <div className="agent-attachment-list" aria-live="polite">
          {attachments.map((attachment) => (
            <span className={`agent-attachment-chip is-${attachment.status}`} key={attachment.id}>
              {attachment.status === "uploading" ? <LoaderCircle aria-hidden="true" className="is-spinning" /> : <FileText aria-hidden="true" />}
              <span title={attachment.name}>{attachment.name}</span>
              <small>{statusLabel(attachment.status)}</small>
              <button
                type="button"
                aria-label={`移除附件 ${attachment.name}`}
                onClick={() => setAttachments((items) => items.filter((item) => item.id !== attachment.id))}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <label className="sr-only" htmlFor="agent-message-input">描述你的求职任务</label>
      <textarea
        id="agent-message-input"
        name="agentMessage"
        rows={1}
        value={message}
        disabled={props.disabled}
        autoComplete="off"
        placeholder="描述你的求职任务，或粘贴一份岗位描述…"
        onChange={(event) => setMessage(event.target.value)}
        onInput={(event) => {
          event.currentTarget.style.height = "auto";
          event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 176)}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      <div className="agent-composer-toolbar">
        <div className="agent-composer-tools">
          <button type="button" aria-label="上传文件" title="上传文件" onClick={() => inputRef.current?.click()}>
            <Plus aria-hidden="true" />
            <span>上传</span>
          </button>
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept=".txt,.json,.pdf,.docx"
            disabled={props.disabled}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" onClick={() => setMessage("请让我选择一份已有简历。")}>
            <FileText aria-hidden="true" /><span>选择简历</span>
          </button>
          <button type="button" onClick={() => setMessage("我想导入一份目标岗位描述：\n")}>
            <BriefcaseBusiness aria-hidden="true" /><span>导入岗位</span>
          </button>
          <button type="button" onClick={() => setMessage("请从个人资料库中选择合适的真实经历。")}>
            <Database aria-hidden="true" /><span>从资料库</span>
          </button>
          <button type="button" onClick={() => setMessage("请列出这项任务可以使用的工具。")}>
            <Wrench aria-hidden="true" /><span>工具</span>
          </button>
        </div>
        <div className="agent-composer-submit">
          <span>{props.aiStatus ?? (props.running ? "AI 正在处理…" : "AI 就绪")}</span>
          {props.running ? (
            <button className="agent-stop-button" type="button" aria-label="停止运行" onClick={props.onStop}>
              <Square aria-hidden="true" />
            </button>
          ) : (
            <button className="agent-send-button" type="submit" disabled={props.disabled || !message.trim()} aria-label="发送消息">
              <Send aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <span className="agent-drop-hint"><Paperclip aria-hidden="true" /> 松开即可添加文件</span>
    </form>
  );
}

function statusLabel(status: Attachment["status"]) {
  if (status === "uploading") return "读取中";
  if (status === "partial") return "待继续";
  if (status === "failed") return "失败";
  return "已接收";
}
