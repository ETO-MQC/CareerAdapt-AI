import { z } from "zod";
import { MatchEvidenceRefSchema, ResumeBranchSchema, type ResumeBranch, type CareerProfile } from "@/domain/schemas";
import { resumeFieldById } from "@/domain/resumeFields/fieldCatalog";
import type { CanonicalFieldId } from "@/domain/resumeFields/types";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { validateEachTailoringDiffLocally } from "@/domain/jobOptimization/tailoringDiff";

export const PreciseModelOutputSchema = z.object({ proposedValue: z.string().refine(s => !!s.trim(), "resume_precise_empty_value") }).strict();
export const PreciseSelectionSchema = z.object({
  sessionId: z.string().min(1), taskId: z.string().min(1),
  profileId: z.string().min(1), branchId: z.string().min(1), baseRevisionId: z.string().min(1),
  sectionType: z.enum(["project", "work", "internship"]), itemId: z.string().min(1),
  field: z.enum(["description", "highlights"]), bulletIndex: z.number().int().min(0).nullable()
}).strict().refine(s => s.field === "highlights" ? s.bulletIndex !== null : s.bulletIndex === null, "resume_precise_index_invalid");
export const PreciseProposalSchema = z.object({
  schemaVersion: z.literal("precise-edit-v1"), selection: PreciseSelectionSchema,
  turnId: z.string().min(1), profileVersion: z.number().int().min(1),
  branchPurpose: z.enum(["general", "job_specific"]), jobId: z.string().min(1).nullable(),
  baseBranchRevision: z.number().int().min(0), canonicalFieldId: z.string().min(1),
  originalValue: z.string(), proposedValue: z.string().refine(s => !!s.trim()),
  evidenceRefs: z.array(MatchEvidenceRefSchema).min(1), claimClassification: z.literal("presentation_only"),
  operationId: z.string().min(8).max(160), proposalHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type PreciseSelection = z.infer<typeof PreciseSelectionSchema>;
export type PreciseProposal = z.infer<typeof PreciseProposalSchema>;
export type PreciseReference = Pick<PreciseProposal, "operationId" | "proposalHash">;
export function preciseReference(p: PreciseProposal): PreciseReference { return { operationId: p.operationId, proposalHash: p.proposalHash }; }
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object" || !value) throw new Error("resume_precise_invalid_json");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export async function preciseSha256(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function verifyPreciseProposal(raw: unknown) {
  const p = PreciseProposalSchema.parse(raw);
  const { proposalHash, ...content } = p;
  if (await preciseSha256(canonicalJson(content)) !== proposalHash) throw new Error("resume_precise_hash_mismatch");
  return p;
}
export async function preciseOperationKey(p: PreciseProposal) {
  const prefix = `precise:${await preciseSha256(p.operationId)}:`;
  return { prefix, key: `${prefix}${p.proposalHash}` };
}
export function preciseTarget(branch: ResumeBranch, selection: PreciseSelection) {
  if (branch.id !== selection.branchId || branch.profileId !== selection.profileId) throw new Error("resume_precise_target_mismatch");
  if (!resumeFieldById.has(`${selection.sectionType}.${selection.field}` as CanonicalFieldId)) throw new Error("resume_precise_field_unsupported");
  const item = branch.structuredContentItems?.find(i => i.id === selection.itemId);
  if (!item || item.data.sectionType !== selection.sectionType) throw new Error("resume_precise_item_missing");
  if (!["project", "work", "internship"].includes(item.data.sectionType)) throw new Error("resume_precise_field_unsupported");
  const data = item.data as Extract<typeof item.data, { sectionType: "project" | "work" | "internship" }>;
  const value = selection.field === "description" ? data.description : data.highlights[selection.bulletIndex!];
  if (typeof value !== "string" || !value.trim()) throw new Error("resume_precise_field_missing_or_index_invalid");
  return { item, value, data };
}
export function preciseEvidence(branch: ResumeBranch, profile: CareerProfile, s: PreciseSelection) {
  const { item } = preciseTarget(branch, s);
  const refs = resolveBranchFactRefs(profile, item.factRefs);
  if (!refs.length) throw new Error("resume_precise_confirmed_evidence_required");
  return refs;
}
export function assertPreciseDependencies(branch: ResumeBranch, profile: CareerProfile, p: PreciseProposal) {
  if (profile.id !== p.selection.profileId || profile.version !== p.profileVersion) throw new Error("resume_precise_profile_stale");
  if (branch.currentRevisionId !== p.selection.baseRevisionId || branch.revision !== p.baseBranchRevision) throw new Error("resume_precise_revision_stale");
  if (branch.branchPurpose !== p.branchPurpose || (branch.jobId ?? null) !== p.jobId
    || (p.branchPurpose === "general" ? p.jobId !== null : !p.jobId)) throw new Error("resume_precise_branch_purpose_mismatch");
  if (preciseTarget(branch, p.selection).value !== p.originalValue) throw new Error("resume_precise_original_mismatch");
  if (p.canonicalFieldId !== `${p.selection.sectionType}.${p.selection.field}`) throw new Error("resume_precise_field_mismatch");
  if (canonicalJson(preciseEvidence(branch, profile, p.selection)) !== canonicalJson(p.evidenceRefs)) throw new Error("resume_precise_evidence_mismatch");
}
export function precisePatchedBranch(branch: ResumeBranch, p: PreciseProposal) {
  const { item, data, value } = preciseTarget(branch, p.selection);
  if (value !== p.originalValue) throw new Error("resume_precise_original_mismatch");
  const highlights = [...data.highlights];
  if (p.selection.field === "highlights") highlights[p.selection.bulletIndex!] = p.proposedValue;
  const nextData = { ...data, ...(p.selection.field === "description" ? { description: p.proposedValue } : { highlights }) };
  const text = [nextData.description, ...nextData.highlights].filter(v => !!v?.trim()).join("\n");
  return ResumeBranchSchema.parse({ ...branch,
    structuredContentItems: branch.structuredContentItems!.map(i => i.id === item.id ? { ...i, data: nextData, legacyTextProjection: text } : i),
    contentItems: branch.contentItems.map(i => i.id === item.id ? { ...i, text } : i)
  });
}
export function assertPreciseGuard(branch: ResumeBranch, p: PreciseProposal) {
  const guard = runRuleFactGuard({ originalText: p.originalValue, checkedText: p.proposedValue, usedEvidenceRefs: p.evidenceRefs });
  // A1 cannot add even an evidence-backed factual assertion to this field.
  // The existing Guard is also run against the selected original alone to classify wording-only changes.
  const wordingOnly = runRuleFactGuard({ originalText: p.originalValue, checkedText: p.proposedValue, usedEvidenceRefs: [] });
  if (guard.status !== "pass" || wordingOnly.status !== "pass") throw new Error("resume_precise_fact_guard_blocked");
  const { data } = preciseTarget(branch, p.selection);
  const next = precisePatchedBranch(branch, p);
  const nextData = preciseTarget(next, p.selection).data;
  const validation = validateEachTailoringDiffLocally({ branch, diffs: [{
    target: { sectionId: p.selection.sectionType, itemId: p.selection.itemId, fieldPath: p.selection.field },
    operation: "replace", original: p.selection.field === "description" ? data.description! : data.highlights,
    value: p.selection.field === "description" ? nextData.description! : nextData.highlights,
    reason: "Explicit single-field edit", requirementIds: [], targetKeywords: [], supportLevel: "verified", evidenceRefs: p.evidenceRefs
  }], submissionSafe: true, allowUnconfirmed: false });
  if (validation.rejectedDiffs.length || validation.patches.length !== 1) throw new Error(`resume_precise_claim_safety_blocked:${validation.rejectedDiffs[0]?.reasonCode}`);
}
export async function createPreciseProposal(input: { branch: ResumeBranch; profile: CareerProfile; selection: PreciseSelection; modelOutput: unknown; turnId: string; operationId: string }) {
  const selection = PreciseSelectionSchema.parse(input.selection);
  const proposedValue = PreciseModelOutputSchema.parse(input.modelOutput).proposedValue;
  const content = { schemaVersion: "precise-edit-v1" as const, selection, turnId: input.turnId,
    profileVersion: input.profile.version, branchPurpose: input.branch.branchPurpose, jobId: input.branch.jobId ?? null,
    baseBranchRevision: input.branch.revision, canonicalFieldId: `${selection.sectionType}.${selection.field}`,
    originalValue: preciseTarget(input.branch, selection).value, proposedValue,
    evidenceRefs: preciseEvidence(input.branch, input.profile, selection), claimClassification: "presentation_only" as const,
    operationId: input.operationId };
  const p = PreciseProposalSchema.parse({ ...content, proposalHash: await preciseSha256(canonicalJson(content)) });
  assertPreciseDependencies(input.branch, input.profile, p);
  assertPreciseGuard(input.branch, p);
  return p;
}

/** One complete proposal in TaskState; every other durable location is a reference. */
export function assertPreciseOwnership(session: import("@/agent/contracts/agentSession").AgentSession, p: PreciseProposal, confirmed = false) {
  const slot = session.taskState?.knownSlots.preciseResumeEdit as { selection?: unknown; proposal?: unknown } | undefined;
  if (session.id !== p.selection.sessionId || session.activeProfileId !== p.selection.profileId
    || session.taskState?.workflowId !== "precise_resume_edit" || canonicalJson(slot?.selection) !== canonicalJson(p.selection)
    || canonicalJson(slot?.proposal) !== canonicalJson(p)) throw new Error("resume_precise_owner_mismatch");
  const ref = canonicalJson(preciseReference(p));
  if (session.activeTurn?.id !== p.turnId
    || canonicalJson(session.activeTurn?.workflowCheckpoint?.preciseEditRef) !== ref
    || canonicalJson(session.pendingConfirmation?.validatedInput) !== ref
    || canonicalJson(session.pendingToolCall?.input) !== ref
    || session.pendingConfirmation?.operationId !== p.operationId
    || session.pendingConfirmation?.turnId !== p.turnId
    || session.pendingToolCall?.operationId !== p.operationId
    || session.pendingToolCall?.turnId !== p.turnId
    || session.pendingConfirmation?.toolName !== "career.workflow.precise_edit"
    || session.pendingToolCall?.toolName !== "career.workflow.precise_edit"
    || session.pendingConfirmation?.status !== (confirmed ? "confirmed" : "pending")) throw new Error("resume_precise_reference_mismatch");
}
