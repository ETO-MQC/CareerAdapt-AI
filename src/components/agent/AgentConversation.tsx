import type { AgentMessage } from "@/agent/contracts/agentSession";
import { RotateCcw, Undo2 } from "lucide-react";

export function AgentConversation({
  messages,
  onUndoLastUser,
  onRegenerate
}: {
  messages: AgentMessage[];
  onUndoLastUser?(): void;
  onRegenerate?(): void;
}) {
  const visibleMessages = messages.filter((message) => message.role !== "system");
  return (
    <section className="agent-conversation" aria-label="AI 对话" aria-live="polite">
      {visibleMessages.map((message) => message.role === "tool" ? (
        <div className="agent-tool-status-row" key={message.id} role="status">
          <span aria-hidden="true" />
          <strong>{toolStatus(message)}</strong>
        </div>
      ) : (
        <article className={`agent-message agent-message-${message.role}`} key={message.id}>
          <span>{message.role === "user" ? "你" : "AI 助手"}</span>
          <p>{message.content}</p>
        </article>
      ))}
      {visibleMessages.length ? (
        <div className="agent-conversation-actions">
          {onUndoLastUser ? (
            <button type="button" onClick={onUndoLastUser}><Undo2 aria-hidden="true" /> 撤回最近输入</button>
          ) : null}
          {onRegenerate ? (
            <button type="button" onClick={onRegenerate}><RotateCcw aria-hidden="true" /> 重新生成</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function toolStatus(message: AgentMessage) {
  const labels: Record<string, string> = {
    parse_resume_file: "已接收文件，正在提取可核对内容",
    parse_job_description: "已生成岗位语义草稿",
    commit_job: "岗位已保存",
    analyze_job_fit: "岗位匹配分析已完成",
    create_tailoring_session: "定制方案已生成",
    apply_tailoring_changes: "新版本已创建",
    export_resume: "PDF 预览已准备"
  };
  return message.toolName ? labels[message.toolName] ?? "工具步骤已完成" : "工具步骤已完成";
}
