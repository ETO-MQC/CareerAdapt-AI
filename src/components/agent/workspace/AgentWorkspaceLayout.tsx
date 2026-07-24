import { History, MoreHorizontal } from "lucide-react";
import { AgentArtifactLauncher } from "@/components/agent/artifacts/AgentArtifactLauncher";

export function AgentWorkspaceLayout({
  children,
  sessionTitle,
  status,
  artifactCount,
  onOpenArtifacts,
  onOpenHistory
}: {
  children: React.ReactNode;
  sessionTitle: string;
  status: string;
  artifactCount: number;
  onOpenArtifacts(): void;
  onOpenHistory(): void;
}) {
  return (
    <main className="agent-workspace">
      <header className="agent-workspace-topbar">
        <strong title={sessionTitle}>{sessionTitle}</strong>
        <div>
          <span className="agent-workflow-status">{status}</span>
          <AgentArtifactLauncher count={artifactCount} onOpen={onOpenArtifacts} />
          <button type="button" aria-label="打开历史记录" title="历史记录" onClick={onOpenHistory}>
            <History aria-hidden="true" />
          </button>
          <button type="button" aria-label="更多任务操作" title="更多操作">
            <MoreHorizontal aria-hidden="true" />
          </button>
        </div>
      </header>
      {children}
    </main>
  );
}
