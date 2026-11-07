import { z } from "zod";
import { FactProposalSchema } from "@/domain/factProposal";
import { MatchEvidenceRefSchema, ResumeBranchSchema, type CareerProfile, type ResumeBranch } from "@/domain/schemas";
import { canonicalJson, preciseSha256 } from "./preciseResumeEdit";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { canonicalTechnicalTerm } from "@/domain/resumeComposition/ResumeSkillTaxonomy";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { resumeFieldById } from "@/domain/resumeFields/fieldCatalog";
import type { CanonicalFieldId } from "@/domain/resumeFields/types";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { stableHashText } from "@/services/security/text";

export const StructuredSelectionSchema = z.object({
  sessionId: z.string().min(1), taskId: z.string().min(1), profileId: z.string().min(1),
  branchId: z.string().min(1), baseRevisionId: z.string().min(1),
  sectionType: z.enum(["project", "work", "internship", "skills"]), itemId: z.string().min(1),
  field: z.enum(["title", "role", "organization", "startDate", "endDate", "name", "highlights"]),
  bulletIndex: z.number().int().min(0).nullable(),
  operation: z.enum(["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"])
}).strict().superRefine((s, ctx) => {
  const valid = s.operation === "confirmed_skill_addition" ? s.sectionType === "skills" && s.field === "name" && s.bulletIndex === null
    : s.sectionType !== "skills" && (s.operation === "fact_correction"
      ? ["role", "organization", "startDate", "endDate", ...(s.sectionType === "project" ? ["title"] : [])].includes(s.field) && s.bulletIndex === null
      : s.field === "highlights" && (s.operation === "bullet_removal" ? s.bulletIndex !== null : s.bulletIndex === null));
  if (!valid) ctx.addIssue({ code: "custom", message: "resume_structured_field_unsupported" });
});
export type StructuredSelection = z.infer<typeof StructuredSelectionSchema>;
export const CorrectionSourceSchema = z.object({
  id: z.string().min(1), sessionId: z.string().min(1), turnId: z.string().min(1), messageId: z.string().min(1),
  content: z.string().min(1).max(200), contentHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(),
  kind: z.literal("user_correction_statement")
}).strict();
export type CorrectionSource = z.infer<typeof CorrectionSourceSchema>;
// A distinct schema; the v1 schema/scope and persisted records retain their original meaning.
export const ResumeFactProposalSchema = z.object({ ...FactProposalSchema.shape,
  schemaVersion: z.literal("fact-proposal-v2"), scope: z.literal("resume_only"),
  proposalType: z.literal("clarification"), source: CorrectionSourceSchema,
  bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
  verification: z.literal("user_declared_not_independently_verified")
}).strict().superRefine((p, ctx) => {
  if (p.relatedRequirementId || new Date(p.expiresAt).getTime() <= new Date(p.createdAt).getTime()
    || !p.candidateAnswer.trim()) ctx.addIssue({ code: "custom", message: "resume_structured_fact_proposal_invalid" });
});
export const StructuredModelOutputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("fact_correction"), proposedValue: z.string().min(1).max(200) }).strict(),
  z.object({ operation: z.literal("confirmed_skill_addition") }).strict(),
  z.object({ operation: z.literal("bullet_removal") }).strict(),
  z.object({ operation: z.literal("bullet_reordering"), permutation: z.array(z.number().int().min(0)) }).strict()
]);
const OperationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fact_correction"), value: z.string().min(1).max(200), correctionKind: z.enum(["date_normalization", "user_declared_correction"]), factProposal: ResumeFactProposalSchema }).strict(),
  z.object({ type: z.literal("confirmed_skill_addition"), sourceSkillId: z.string().min(1), newItemId: z.string().min(1), data: z.unknown() }).strict(),
  z.object({ type: z.literal("bullet_removal"), index: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal("bullet_reordering"), permutation: z.array(z.number().int().min(0)) }).strict()
]);
export const StructuredProposalSchema = z.object({
  schemaVersion: z.literal("precise-edit-v2"), selection: StructuredSelectionSchema,
  turnId: z.string().min(1), profileVersion: z.number().int().min(1), branchPurpose: z.enum(["general", "job_specific"]),
  jobId: z.string().nullable(), baseBranchRevision: z.number().int().min(0), canonicalFieldId: z.string().min(1),
  originalValue: z.union([z.string(), z.array(z.string())]), evidenceRefs: z.array(MatchEvidenceRefSchema),
  claimClassification: z.enum(["user_declared_fact_correction", "confirmed_profile_skill", "structural_only"]),
  operation: OperationSchema, operationId: z.string().min(8).max(160), proposalHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
export type StructuredProposal = z.infer<typeof StructuredProposalSchema>;

export function structuredTarget(branch: ResumeBranch, s: StructuredSelection) {
  if (branch.id !== s.branchId || branch.profileId !== s.profileId) throw new Error("resume_precise_target_mismatch");
  if (!resumeFieldById.has(`${s.sectionType}.${s.field}` as CanonicalFieldId)) throw new Error("resume_structured_field_unsupported");
  if (s.operation === "confirmed_skill_addition") return { value: skillArrayIdentity(branch) };
  const matches = branch.structuredContentItems?.filter(i => i.id === s.itemId && i.data.sectionType === s.sectionType) ?? [];
  if (matches.length !== 1) throw new Error("resume_precise_item_missing");
  const item = matches[0];
  if (item.data.sectionType !== "project" && item.data.sectionType !== "work" && item.data.sectionType !== "internship") throw new Error("resume_structured_field_unsupported");
  const data = item.data;
  const value = s.field === "highlights" ? data.highlights : (data as unknown as Record<string, unknown>)[s.field];
  if (s.field !== "highlights" && (typeof value !== "string" || !value.trim())) throw new Error("resume_precise_field_missing_or_index_invalid");
  if (s.operation === "bullet_removal" && (s.bulletIndex === null || s.bulletIndex >= data.highlights.length)) throw new Error("resume_structured_index_invalid");
  return { item, data, value: value as string | string[] };
}
function skillArrayIdentity(branch: ResumeBranch) {
  return (branch.structuredContentItems ?? []).filter(i => i.data.sectionType === "skills").map(i => canonicalJson(i));
}
export function skillIdentity(name: string) { return (canonicalTechnicalTerm(name) ?? name.trim()).toLocaleLowerCase(); }
export function confirmedSkill(profile: CareerProfile, id: string) {
  const skill = profile.skills.find(s => s.id === id);
  if (!skill?.fact || skill.fact.category !== "skill" || !skill.fact.confirmedByUser || skill.fact.riskLevel === "high") throw new Error("resume_structured_confirmed_skill_required");
  if (skill.fact.maturity === "learning" || skill.fact.maturity === "familiar") throw new Error("resume_structured_skill_maturity_requires_review");
  // Import canonical IDs and legacy Skill IDs can differ; the confirmed fact identity is authoritative.
  const entries = canonicalProfileLibraryItems(profile).filter(i => i.sectionType === "skills" && i.factIds.includes(skill.fact!.id));
  const entry = entries.length === 1 ? entries[0] : undefined;
  if (!entry || entry.data.sectionType !== "skills" || skillIdentity(entry.data.name) !== skillIdentity(skill.name)) throw new Error("resume_structured_skill_source_missing_or_ambiguous");
  return { skill, data: entry.data, evidence: resolveBranchFactRefs(profile, [{ type: "skill_fact", skillId: id, factId: skill.fact.id }]) };
}
export function assertSkillAbsent(branch: ResumeBranch, name: string) {
  if (branch.structuredContentItems?.some(i => i.data.sectionType === "skills" && skillIdentity(i.data.name) === skillIdentity(name))) throw new Error("resume_structured_skill_already_exists");
}

/** Preserve exact year/month/day precision; never fill absent date components. */
export function correctionDate(value: string) {
  const match = value.match(/^(\d{4})(?:(?:[-./]|年)(\d{1,2})(?:(?:[-./]|月)(\d{1,2})日?)?月?)?$/u);
  if (!match) throw new Error("resume_structured_date_invalid");
  const year = Number(match[1]), month = match[2] ? Number(match[2]) : undefined, day = match[3] ? Number(match[3]) : undefined;
  if (year < 1900 || year > 2099 || month !== undefined && (month < 1 || month > 12)
    || day !== undefined && (day < 1 || new Date(Date.UTC(year, month! - 1, day)).getUTCDate() !== day)) throw new Error("resume_structured_date_invalid");
  return { precision: day !== undefined ? 3 : month !== undefined ? 2 : 1,
    normalized: [match[1], ...(month !== undefined ? [String(month).padStart(2, "0")] : []), ...(day !== undefined ? [String(day).padStart(2, "0")] : [])].join("-"),
    min: Date.UTC(year, (month ?? 1) - 1, day ?? 1), max: day !== undefined ? Date.UTC(year, month! - 1, day) : month !== undefined ? Date.UTC(year, month, 0) : Date.UTC(year, 11, 31) };
}
export function assertStructuredGuard(branch: ResumeBranch, p: StructuredProposal) {
  const s = p.selection, op = p.operation;
  if (s.operation !== op.type) throw new Error("resume_structured_operation_mismatch");
  const target = structuredTarget(branch, s);
  if (canonicalJson(target.value) !== canonicalJson(p.originalValue)) throw new Error("resume_precise_original_mismatch");
  if (op.type === "fact_correction") {
    if (p.claimClassification !== "user_declared_fact_correction" || op.factProposal.userConfirmed
      || op.factProposal.candidateAnswer !== op.value || op.factProposal.source.content !== op.value
      || op.factProposal.verification !== "user_declared_not_independently_verified") throw new Error("resume_structured_fact_source_mismatch");
    if (op.value === p.originalValue || op.value !== op.value.trim() || /[\n\r；;%％]|主导|负责|带领|熟练|精通|提升.*\d|\d.*(?:人|万|亿|用户)/u.test(op.value)) throw new Error("resume_structured_fact_value_unsupported");
    const guard = runRuleFactGuard({ originalText: op.factProposal.source.content, checkedText: op.value, usedEvidenceRefs: [] });
    if (guard.status !== "pass") throw new Error("resume_precise_fact_guard_blocked");
    if (s.field === "startDate" || s.field === "endDate") {
      const old = correctionDate(p.originalValue as string), next = correctionDate(op.value);
      if (old.precision !== next.precision) throw new Error("resume_structured_date_precision_changed");
      if (op.correctionKind !== (old.normalized === next.normalized ? "date_normalization" : "user_declared_correction")) throw new Error("resume_structured_classification_invalid");
      const data = target.data!;
      if (s.field === "endDate" && data.current) throw new Error("resume_structured_current_date_conflict");
      const start = s.field === "startDate" ? next : data.startDate ? correctionDate(data.startDate) : undefined;
      const end = s.field === "endDate" ? next : !data.current && data.endDate ? correctionDate(data.endDate) : undefined;
      if (start && end && start.min > end.max) throw new Error("resume_structured_date_range_invalid");
    } else if (op.correctionKind !== "user_declared_correction") throw new Error("resume_structured_classification_invalid");
  } else if (op.type === "bullet_reordering") {
    const values = target.value as string[], order = op.permutation;
    if (p.claimClassification !== "structural_only" || order.length !== values.length || new Set(order).size !== values.length
      || order.some(i => i >= values.length) || order.every((i, index) => i === index)) throw new Error("resume_structured_permutation_invalid");
  } else if (op.type === "bullet_removal") {
    if (p.claimClassification !== "structural_only" || op.index !== s.bulletIndex || op.index >= (target.value as string[]).length) throw new Error("resume_structured_index_invalid");
  } else if (p.claimClassification !== "confirmed_profile_skill") throw new Error("resume_structured_classification_invalid");
}
export function structuredPatchedBranch(branch: ResumeBranch, p: StructuredProposal, confirmedAt?: string) {
  assertStructuredGuard(branch, p);
  const op = p.operation;
  if (op.type === "confirmed_skill_addition") {
    // Data is checked against the authoritative Profile again by the Repository dependency check.
    const data = op.data as ReturnType<typeof confirmedSkill>["data"];
    assertSkillAbsent(branch, data.name);
    const text = projectResumeItemV2(data), factRefs = p.evidenceRefs.map(ref => {
      if (ref.type !== "skill_fact") throw new Error("resume_structured_skill_evidence_invalid");
      return { type: ref.type, skillId: ref.skillId, factId: ref.factId };
    });
    if (branch.contentItems.some(i => i.id === op.newItemId) || branch.structuredContentItems?.some(i => i.id === op.newItemId || i.data.id === data.id)) throw new Error("resume_structured_item_conflict");
    const order = Math.max(-1, ...branch.contentItems.map(i => i.order), ...(branch.structuredContentItems ?? []).map(i => i.order)) + 1;
    const common = { id: op.newItemId, source: "user_manual" as const, order, visible: true, factRefs, guardMode: "rule_verified" as const, guardStatus: "pass" as const, guardFindings: [] };
    return ResumeBranchSchema.parse({ ...branch,
      structuredContentItems: [...branch.structuredContentItems ?? [], { ...common, schemaVersion: "resume-content-item-v2", data, legacyTextProjection: text }],
      contentItems: [...branch.contentItems, { ...common, itemType: "skill", sourceSectionId: "skills", text, originalText: text, requirementIds: [], sourceSuggestionIds: [], guardRiskLevel: "low" }] });
  }
  const { item, data } = structuredTarget(branch, p.selection);
  const nextData = op.type === "fact_correction" ? { ...data!, [p.selection.field]: op.value }
    : { ...data!, highlights: op.type === "bullet_removal" ? data!.highlights.filter((_, i) => i !== op.index) : op.permutation.map(i => data!.highlights[i]) };
  const text = projectResumeItemV2(nextData);
  const confirmation = op.type === "fact_correction" ? { source: "user_manual" as const,
    userConfirmation: { scope: "resume_only" as const, confirmedTextHash: stableHashText(text), confirmedAt: confirmedAt ?? op.factProposal.createdAt } } : {};
  return ResumeBranchSchema.parse({ ...branch,
    structuredContentItems: branch.structuredContentItems!.map(i => i.id === item!.id ? { ...i,
      ...(op.type !== "fact_correction" && i.userConfirmation ? { userConfirmation: { ...i.userConfirmation, confirmedTextHash: stableHashText(text) } } : confirmation),
      data: nextData, legacyTextProjection: text } : i),
    contentItems: branch.contentItems.map(i => i.id === item!.id ? { ...i,
      ...(op.type !== "fact_correction" && i.userConfirmation ? { userConfirmation: { ...i.userConfirmation, confirmedTextHash: stableHashText(text) } } : confirmation), text } : i) });
}
export function assertStructuredDependencies(branch: ResumeBranch, profile: CareerProfile, p: StructuredProposal) {
  if (profile.id !== p.selection.profileId || profile.version !== p.profileVersion) throw new Error("resume_precise_profile_stale");
  if (branch.currentRevisionId !== p.selection.baseRevisionId || branch.revision !== p.baseBranchRevision) throw new Error("resume_precise_revision_stale");
  if (branch.branchPurpose !== p.branchPurpose || (branch.jobId ?? null) !== p.jobId || (p.branchPurpose === "general" ? p.jobId !== null : !p.jobId)) throw new Error("resume_precise_branch_purpose_mismatch");
  if (p.canonicalFieldId !== `${p.selection.sectionType}.${p.selection.field}`) throw new Error("resume_precise_field_mismatch");
  const op = p.operation;
  const refs = op.type === "confirmed_skill_addition" ? confirmedSkill(profile, op.sourceSkillId).evidence
    : resolveBranchFactRefs(profile, structuredTarget(branch, p.selection).item!.factRefs);
  if (canonicalJson(refs) !== canonicalJson(p.evidenceRefs)) throw new Error("resume_precise_evidence_mismatch");
  if (op.type === "confirmed_skill_addition") {
    const source = confirmedSkill(profile, op.sourceSkillId);
    if (op.sourceSkillId !== p.selection.itemId || canonicalJson(source.data) !== canonicalJson(op.data)) throw new Error("resume_structured_skill_source_mismatch");
    assertSkillAbsent(branch, source.data.name);
  }
  assertStructuredGuard(branch, p);
}
export async function createStructuredProposal(input: { branch: ResumeBranch; profile: CareerProfile; selection: StructuredSelection; modelOutput: unknown; turnId: string; operationId: string; source?: CorrectionSource }) {
  const selection = StructuredSelectionSchema.parse(input.selection), output = StructuredModelOutputSchema.parse(input.modelOutput);
  if (selection.operation !== output.operation) throw new Error("resume_structured_operation_mismatch");
  const target = structuredTarget(input.branch, selection);
  let operation: StructuredProposal["operation"];
  if (output.operation === "fact_correction") {
    const source = CorrectionSourceSchema.parse(input.source);
    if (source.sessionId !== selection.sessionId || source.content !== output.proposedValue
      || await preciseSha256(source.content) !== source.contentHash) throw new Error("resume_structured_fact_source_mismatch");
    const bindingHash = await preciseSha256(canonicalJson({ selection, originalValue: target.value, value: output.proposedValue, operationId: input.operationId }));
    const correctionKind = (selection.field === "startDate" || selection.field === "endDate")
      && correctionDate(target.value as string).normalized === correctionDate(output.proposedValue).normalized ? "date_normalization" : "user_declared_correction";
    operation = { type: "fact_correction", value: output.proposedValue, correctionKind, factProposal: ResumeFactProposalSchema.parse({
      id: `fact-${input.operationId}`, schemaVersion: "fact-proposal-v2", scope: "resume_only", proposalType: "clarification",
      question: "仅更正当前简历此字段；用户自述不代表独立核验，也不会同步资料库。", candidateAnswer: output.proposedValue,
      userConfirmed: false, source, bindingHash, verification: "user_declared_not_independently_verified",
      provenance: [{ sourceType: "user_input", sourceId: source.id, sourceText: source.content, confidence: 1, confirmedByUser: false,
        riskLevel: "low", createdAt: source.createdAt, sourceSessionId: source.sessionId, sourceMessageId: source.messageId, sourceTurnId: source.turnId }],
      createdAt: source.createdAt, updatedAt: source.createdAt, expiresAt: new Date(new Date(source.createdAt).getTime() + 30 * 86400000).toISOString() }) };
  } else if (output.operation === "confirmed_skill_addition") {
    const skill = confirmedSkill(input.profile, selection.itemId);
    operation = { type: "confirmed_skill_addition", sourceSkillId: selection.itemId, newItemId: `precise-skill-${crypto.randomUUID()}`, data: skill.data };
  } else operation = output.operation === "bullet_removal" ? { type: "bullet_removal", index: selection.bulletIndex! } : { type: "bullet_reordering", permutation: output.permutation };
  const content = { schemaVersion: "precise-edit-v2" as const, selection, turnId: input.turnId, profileVersion: input.profile.version,
    branchPurpose: input.branch.branchPurpose, jobId: input.branch.jobId ?? null, baseBranchRevision: input.branch.revision,
    canonicalFieldId: `${selection.sectionType}.${selection.field}`, originalValue: target.value,
    evidenceRefs: operation.type === "confirmed_skill_addition" ? confirmedSkill(input.profile, selection.itemId).evidence : resolveBranchFactRefs(input.profile, target.item!.factRefs),
    claimClassification: operation.type === "fact_correction" ? "user_declared_fact_correction" : operation.type === "confirmed_skill_addition" ? "confirmed_profile_skill" : "structural_only",
    operation, operationId: input.operationId };
  const p = StructuredProposalSchema.parse({ ...content, proposalHash: await preciseSha256(canonicalJson(content)) });
  assertStructuredDependencies(input.branch, input.profile, p);
  return p;
}
