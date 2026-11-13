import type { AgentSession } from "@/agent/contracts/agentSession";
import { activeWorkflowInteractionFor } from "./workflowUserInputCheckpoint";
import { activeBranchMessages } from "./activeBranchContext";

export type AgentTurnLifecycle = "IDLE" | "RUNNING" | "WAITING_FOR_USER" | "WAITING_FOR_CONFIRMATION" | "COMPLETED" | "FAILED" | "STOPPED";

export function activeFitNextActionMessage(session: AgentSession) {
  if (session.pendingConfirmation?.status === "pending" || session.taskState?.workflowId !== "analyze_job_fit" || session.taskState.completionStatus !== "completed") return undefined;
  const selected = session.taskState.selectedEntities;
  if (!selected.jobId || !selected.resumeId || !selected.revisionId) return undefined;
  return activeBranchMessages(session).findLast(message => {
    if (message.metadata?.fitNextAction !== true || message.optionSet?.state !== "active" || !message.options?.length) return false;
    const artifactId = message.metadata.fitNextActionArtifactId;
    return session.artifactRefs.some(artifact => artifact.id === artifactId && artifact.kind === "job_fit_overview"
      && artifact.binding?.sessionId === session.id && artifact.binding.branchId === session.activeBranchId
      && artifact.binding.jobId === selected.jobId && artifact.binding.resumeBranchId === selected.resumeId
      && artifact.binding.revisionId === selected.revisionId);
  });
}

/** A projection of existing checkpoint, confirmation, or completed-task options. */
export function derivePendingInteraction(session: AgentSession) {
  const confirmation = session.pendingConfirmation;
  if (confirmation?.status === "pending") return {
    id: confirmation.id, kind: "confirmation" as const, originatingTurnId: confirmation.turnId ?? session.activeTurn?.id
  };
  const checkpoint = activeWorkflowInteractionFor(session.taskState);
  if (checkpoint) return {
    id: checkpoint.interactionId,
    kind: checkpoint.kind === "confirmation" ? "confirmation" as const
      : ["job_choice", "resume_choice", "profile_choice"].includes(checkpoint.kind) ? "entity_selection" as const
        : "clarification" as const,
    originatingTurnId: session.activeTurn?.id,
    options: checkpoint.options
  };
  if (session.taskState?.workflowId === "analyze_job_fit" && session.taskState.completionStatus === "completed") {
    const message = activeFitNextActionMessage(session);
    if (message?.optionSet) return { id: message.optionSet.optionSetId, kind: "next_action" as const,
      originatingTurnId: message.turnId, options: message.options };
  }
  return undefined;
}

/** Read-only projection: Runtime termination never proves business completion. */
export function deriveAgentTurnLifecycle(session: AgentSession): AgentTurnLifecycle {
  const interaction = derivePendingInteraction(session);
  if (interaction?.kind === "confirmation") return "WAITING_FOR_CONFIRMATION";
  if (session.activeTurn?.status === "running") return "RUNNING";
  if (interaction && interaction.kind !== "next_action" && session.taskState?.completionStatus === "waiting_for_user") return "WAITING_FOR_USER";
  if (session.activeTurn?.status === "aborted" || session.taskState?.completionStatus === "cancelled" || session.workflowState?.status === "paused") return "STOPPED";
  if (session.taskState?.completionStatus === "failed" || session.activeTurn?.status === "failed") return "FAILED";
  if (session.taskState?.completionStatus === "completed" || (!session.taskState && session.activeTurn?.status === "completed")) return "COMPLETED";
  return "IDLE";
}
