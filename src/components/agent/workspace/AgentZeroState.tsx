import type { AgentQuickActionId } from "@/agent/contracts/agentQuickAction";
import { AgentQuickStartCards } from "@/components/agent/AgentQuickStartCards";

export function AgentZeroState({
  onSelect
}: {
  onSelect(id: AgentQuickActionId): void;
}) {
  return (
    <section className="agent-zero-state" aria-labelledby="agent-zero-state-title">
      <header>
        <span className="agent-zero-kicker">从真实经历开始</span>
        <h1 id="agent-zero-state-title">今天想从哪一步开始？</h1>
        <p>导入一次经历，生成每个岗位专属的简历与求职方案。</p>
      </header>
      <AgentQuickStartCards onSelect={onSelect} />
    </section>
  );
}
