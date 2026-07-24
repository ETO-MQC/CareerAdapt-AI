"use client";

import { Paperclip, Send } from "lucide-react";
import { useState } from "react";

export function AgentComposer(props: {
  disabled?: boolean;
  onSend(message: string): Promise<void> | void;
  onUpload(file: File): Promise<void> | void;
}) {
  const [message, setMessage] = useState("");

  return (
    <form
      className="agent-composer"
      onSubmit={async (event) => {
        event.preventDefault();
        const content = message.trim();
        if (!content || props.disabled) return;
        setMessage("");
        await props.onSend(content);
      }}
    >
      <label className="sr-only" htmlFor="agent-message-input">描述你的求职任务</label>
      <label className="agent-upload-button" aria-label="上传简历或岗位文件" title="上传文件">
        <Paperclip aria-hidden="true" size={18} />
        <input
          type="file"
          accept=".txt,.json,.pdf,.docx"
          disabled={props.disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void props.onUpload(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
      <textarea
        id="agent-message-input"
        name="agentMessage"
        rows={1}
        value={message}
        disabled={props.disabled}
        autoComplete="off"
        placeholder="描述任务，例如：用我的产品经理简历适配这份 JD…"
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button className="agent-send-button" type="submit" disabled={props.disabled || !message.trim()} aria-label="发送消息">
        <Send aria-hidden="true" size={18} />
      </button>
    </form>
  );
}
