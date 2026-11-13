import { AgentTaskStateSchema, type AgentSession } from "@/agent/contracts/agentSession";
import { canonicalJson, PreciseProposalSchema, preciseReference, type PreciseProposal } from "@/domain/resumeEditing/preciseResumeContract";

export function projectPreciseProposal(session: AgentSession, raw: unknown): AgentSession {
  const p = PreciseProposalSchema.parse(raw);
  const slot = session.taskState?.knownSlots.preciseResumeEdit as { selection?: unknown; proposal?: unknown } | undefined;
  if (session.id !== p.selection.sessionId || session.taskState?.selectedEntities.profileId !== p.selection.profileId
    || session.taskState.selectedEntities.resumeId !== p.selection.branchId
    || session.activeTurn?.id !== p.turnId || session.taskState?.workflowId !== "precise_resume_edit"
    || canonicalJson(slot?.selection) !== canonicalJson(p.selection)) throw new Error("resume_precise_owner_mismatch");
  if (slot?.proposal) {
    if (canonicalJson(slot.proposal) !== canonicalJson(p)) throw new Error("resume_precise_proposal_already_reviewed");
    return session; // Duplicate tool delivery cannot resurrect or reset a reviewed decision.
  }
  if (session.taskState.selectedEntities.revisionId !== p.selection.baseRevisionId) throw new Error("resume_precise_owner_mismatch");
  const ref = preciseReference(p);
  return { ...session,
    taskState: AgentTaskStateSchema.parse({ ...session.taskState, stage: "review_precise_edit", completionType: "transactional",
      completionStatus: "waiting_for_confirmation", knownSlots: { ...session.taskState.knownSlots,
        preciseResumeEdit: { selection: p.selection, proposal: p } } }),
    activeTurn: { ...session.activeTurn!, status: "waiting_for_confirmation", workflowCheckpoint: {
      ...session.activeTurn!.workflowCheckpoint, preciseEditRef: ref } },
    pendingConfirmation: { id: `confirmation-${p.operationId}`, turnId: p.turnId, operationId: p.operationId,
      toolName: "career.workflow.precise_edit", title: "确认精确修改",
      description: "仅修改已选择的字段；请先核对原文、新文与来源。", destructive: false,
      validatedInput: ref, status: "pending", requestedAt: new Date().toISOString() },
    pendingToolCall: { turnId: p.turnId, operationId: p.operationId, toolName: "career.workflow.precise_edit", input: ref }
  };
}
export function projectPreciseReceipt(session: AgentSession, p: PreciseProposal, receipt: { operationId: string; proposalHash: string; branchId: string; revisionId: string }): AgentSession {
  if (receipt.operationId !== p.operationId || receipt.proposalHash !== p.proposalHash || receipt.branchId !== p.selection.branchId
    || !receipt.revisionId) throw new Error("resume_precise_receipt_mismatch");
  const knownSlots = { ...session.taskState!.knownSlots };
  delete knownSlots.preciseResumeEditFailure;
  return { ...session, pendingConfirmation: undefined, pendingToolCall: undefined,
    taskState: { ...session.taskState!, stage: "resume_ready", completionStatus: "completed",
      selectedEntities: { ...session.taskState!.selectedEntities, resumeId: receipt.branchId, resumeRevisionId: receipt.revisionId, revisionId: receipt.revisionId },
      knownSlots: { ...knownSlots, preciseResumeEdit: { selection: p.selection, proposal: p, outcome: receipt } } },
    activeTurn: session.activeTurn ? { ...session.activeTurn, status: "completed" } : undefined,
    updatedAt: new Date().toISOString() };
}
