import type { AgentMessage } from "@/agent/contracts/agentSession";

export function AgentConversation({ messages }: { messages: AgentMessage[] }) {
  return (
    <section className="agent-conversation" aria-label="AI 对话" aria-live="polite">
      {messages.length === 0 ? (
        <div className="agent-conversation-empty">
          <strong>从一个真实任务开始</strong>
          <p>选择快捷入口，或直接描述你希望完成的求职任务。</p>
        </div>
      ) : (
        messages.filter((message) => message.role !== "system").map((message) => (
          <article className={`agent-message agent-message-${message.role}`} key={message.id}>
            <span>{message.role === "user" ? "你" : message.role === "assistant" ? "AI 助手" : "工具"}</span>
            <p>{message.content}</p>
          </article>
        ))
      )}
    </section>
  );
}
