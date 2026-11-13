import { z } from "zod";
import * as v1 from "./preciseResumeEdit";
import * as v2 from "./structuredResumeOperation";
import type { AgentSession } from "@/agent/contracts/agentSession";
import type { CareerProfile, ResumeBranch } from "@/domain/schemas";
export { canonicalJson, preciseSha256 } from "./preciseResumeEdit";
export const PreciseSelectionSchema = z.union([v1.PreciseSelectionSchema, v2.StructuredSelectionSchema]);
export const PreciseProposalSchema = z.union([v1.PreciseProposalSchema, v2.StructuredProposalSchema]);
export const PreciseModelOutputSchema = z.union([v1.PreciseModelOutputSchema, v2.StructuredModelOutputSchema]);
export type PreciseSelection = z.infer<typeof PreciseSelectionSchema>;
export type PreciseProposal = z.infer<typeof PreciseProposalSchema>;
export type PreciseTargetInput = Omit<v1.PreciseSelection, "sessionId" | "taskId" | "profileId"> | Omit<v2.StructuredSelection, "sessionId" | "taskId" | "profileId">;
export const preciseReference = (p: Pick<PreciseProposal, "operationId" | "proposalHash">) => ({ operationId: p.operationId, proposalHash: p.proposalHash });
export async function verifyPreciseProposal(raw: unknown) {
  const p = PreciseProposalSchema.parse(raw);
  if (p.schemaVersion === "precise-edit-v1") return v1.verifyPreciseProposal(p);
  const { proposalHash, ...content } = p;
  if (await v1.preciseSha256(v1.canonicalJson(content)) !== proposalHash) throw new Error("resume_precise_hash_mismatch");
  if (p.operation.type === "fact_correction") {
    const fact = p.operation.factProposal, source = fact.source;
    if (await v1.preciseSha256(source.content) !== source.contentHash || source.sessionId !== p.selection.sessionId
      || fact.bindingHash !== await v1.preciseSha256(v1.canonicalJson({ selection: p.selection, originalValue: p.originalValue, value: p.operation.value, operationId: p.operationId }))) throw new Error("resume_structured_fact_source_mismatch");
  }
  return p;
}
export async function preciseOperationKey(p: Pick<PreciseProposal, "operationId" | "proposalHash">) {
  const prefix = `precise:${await v1.preciseSha256(p.operationId)}:`;
  return { prefix, key: `${prefix}${p.proposalHash}` };
}
export function preciseTarget(branch: ResumeBranch, selection: PreciseSelection) {
  return "operation" in selection ? v2.structuredTarget(branch, selection) : v1.preciseTarget(branch, selection);
}
export function assertPreciseDependencies(branch: ResumeBranch, profile: CareerProfile, p: PreciseProposal) {
  return p.schemaVersion === "precise-edit-v1" ? v1.assertPreciseDependencies(branch, profile, p) : v2.assertStructuredDependencies(branch, profile, p);
}
export function assertPreciseGuard(branch: ResumeBranch, p: PreciseProposal) {
  return p.schemaVersion === "precise-edit-v1" ? v1.assertPreciseGuard(branch, p) : v2.assertStructuredGuard(branch, p);
}
export function precisePatchedBranch(branch: ResumeBranch, p: PreciseProposal, confirmedAt?: string) {
  return p.schemaVersion === "precise-edit-v1" ? v1.precisePatchedBranch(branch, p) : v2.structuredPatchedBranch(branch, p, confirmedAt);
}
export function assertPreciseOwnership(session: AgentSession, p: PreciseProposal, confirmed = false) {
  if (p.schemaVersion === "precise-edit-v1") return v1.assertPreciseOwnership(session, p, confirmed);
  const slot = session.taskState?.knownSlots.preciseResumeEdit as { selection?: unknown; proposal?: unknown } | undefined;
  if (session.id !== p.selection.sessionId || session.taskState?.selectedEntities.profileId !== p.selection.profileId
    || session.taskState.selectedEntities.resumeId !== p.selection.branchId
    || session.taskState.selectedEntities.revisionId !== p.selection.baseRevisionId
    || session.taskState?.workflowId !== "precise_resume_edit" || v1.canonicalJson(slot?.selection) !== v1.canonicalJson(p.selection)
    || v1.canonicalJson(slot?.proposal) !== v1.canonicalJson(p)) throw new Error("resume_precise_owner_mismatch");
  const ref = v1.canonicalJson(preciseReference(p));
  if (session.activeTurn?.id !== p.turnId || v1.canonicalJson(session.activeTurn.workflowCheckpoint?.preciseEditRef) !== ref
    || v1.canonicalJson(session.pendingConfirmation?.validatedInput) !== ref || v1.canonicalJson(session.pendingToolCall?.input) !== ref
    || session.pendingConfirmation?.operationId !== p.operationId || session.pendingToolCall?.operationId !== p.operationId
    || session.pendingConfirmation?.turnId !== p.turnId || session.pendingToolCall?.turnId !== p.turnId
    || session.pendingConfirmation?.toolName !== "career.workflow.precise_edit" || session.pendingToolCall?.toolName !== "career.workflow.precise_edit"
    || session.pendingConfirmation.status !== (confirmed ? "confirmed" : "pending")) throw new Error("resume_precise_reference_mismatch");
}
