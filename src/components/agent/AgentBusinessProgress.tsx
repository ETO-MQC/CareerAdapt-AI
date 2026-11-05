import type { BusinessWorkflowProgress } from "@/agent/runtime/businessWorkflowProgress";

export function AgentBusinessProgress({ progress }: { progress?: BusinessWorkflowProgress }) {
  if (!progress || progress.state === "idle") return null;
  return (
    <div role="status" aria-label="业务进度" data-business-state={progress.state}
      className="mb-3 border-l-2 border-slate-300 pl-3 text-sm text-slate-700">
      <p className="font-medium">{progress.label}</p>
      {progress.detail ? <p className="mt-1 text-xs text-slate-500">{progress.detail}</p> : null}
    </div>
  );
}
