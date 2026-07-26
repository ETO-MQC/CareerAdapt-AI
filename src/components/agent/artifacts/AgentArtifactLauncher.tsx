import { PanelRightOpen } from "lucide-react";

export function AgentArtifactLauncher({
  count,
  onOpen
}: {
  count: number;
  onOpen(): void;
}) {
  if (count === 0) return null;
  return (
    <button className="agent-artifact-launcher" type="button" onClick={onOpen}>
      <PanelRightOpen aria-hidden="true" />
      产物 {count}
    </button>
  );
}
