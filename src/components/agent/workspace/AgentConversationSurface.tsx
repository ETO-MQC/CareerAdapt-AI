import { AgentConversation } from "@/components/agent/AgentConversation";
import type { AgentMessage } from "@/agent/contracts/agentSession";

export function AgentConversationSurface({
  messages,
  children
}: {
  messages: AgentMessage[];
  children?: React.ReactNode;
}) {
  return (
    <section className="agent-conversation-surface">
      <AgentConversation messages={messages} />
      {children}
    </section>
  );
}
