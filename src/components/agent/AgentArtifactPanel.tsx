import type { TailorWorkflowViewState } from "@/agent/workflows/tailorExistingResumeWorkflow";
import { AgentArtifactContent } from "./artifacts/AgentArtifactContent";

export function AgentArtifactPanel({ state }: { state: TailorWorkflowViewState }) {
  return (
    <aside className="agent-artifact-panel" aria-label="任务产物">
      <AgentArtifactContent state={state} />
    </aside>
  );
}
