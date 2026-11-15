import { z } from "zod";
import { CareerPreferencePatchSchema, type CareerPreferencePatch } from "@/domain/profile/careerPreferencePatch";
import { sha256Utf8 } from "@/domain/jobAssets/sha256";

/** Model output contains no identity or authority to write. */
export const PreferenceInterpretationSchema = z.object({
  intent: z.enum(["candidate", "ambiguous", "temporary"]),
  patch: CareerPreferencePatchSchema.optional(),
  sourceQuote: z.string().trim().min(1).max(1000)
}).strict();

const PreferenceSourceSchema = z.object({ sourceUserMessageId: z.string().min(1), sourceTurnId: z.string().min(1),
  sourceTextHash: z.string().min(1), sourceQuote: z.string().min(1) }).strict();
export const CareerPreferenceCandidateSchema = PreferenceSourceSchema.extend({
  personId: z.string().min(1), profileId: z.string().min(1), expectedProfileRevision: z.number().int().min(1),
  patch: CareerPreferencePatchSchema, previousSources: z.array(PreferenceSourceSchema).max(10).default([])
}).strict();
export type CareerPreferenceCandidate = z.infer<typeof CareerPreferenceCandidateSchema>;

/** A conservative source boundary; model interpretation alone never authorizes a write. */
export function preparePreferenceCandidate(input: {
  interpretation: unknown;
  sourceText: string;
  sourceUserMessageId: string;
  sourceTurnId: string;
  binding: { personId: string; profileId: string; profileRevision: number };
  editCandidate?: CareerPreferenceCandidate;
}) {
  const interpretation = PreferenceInterpretationSchema.parse(input.interpretation);
  if (!input.sourceText.includes(interpretation.sourceQuote)) throw new Error("preference_source_quote_mismatch");
  if (!input.sourceUserMessageId || !input.sourceTurnId || !input.binding.personId || !input.binding.profileId) {
    throw new Error("preference_source_binding_required");
  }
  if (interpretation.intent === "temporary") return { kind: "none" as const };
  const patch = CareerPreferencePatchSchema.parse(interpretation.patch);
  const values = [patch.additions, patch.removals].flatMap(group => group ? Object.values(group).flatMap(items => items ?? []) : []);
  if (values.some(value => !interpretation.sourceQuote.includes(value))) throw new Error("preference_value_not_grounded");
  const clauses = input.sourceText.split(/[，,。！？；;\n]/u);
  if (values.some(value => clauses.some(clause => clause.includes(value)
    && /今天|本次|这次|临时|这个.{0,12}岗位|该岗位|帮我.{0,4}(?:看看|查找|搜索)|先搜/u.test(clause)
    && !/以后|今后|长期|未来/u.test(clause)))) return { kind: "none" as const };
  const explicitlyFuture = /以后|今后|长期|未来/u.test(input.sourceText);
  if (/今天|本次|这次|临时|这个.{0,12}岗位|该岗位|帮我.{0,4}(?:看看|查找|搜索)|先搜/u.test(input.sourceText) && !explicitlyFuture) return { kind: "none" as const };
  const durable = Boolean(input.editCandidate) || values.every(value => clauses.some(clause => clause.includes(value)
    && /以后|今后|长期|未来|主要|优先|最近.{0,12}(?:考虑|想投|想找)|(?:也|开始|现在).{0,8}(?:考虑|想投|想找)|不考虑/u.test(clause)));
  const previous = input.editCandidate ? CareerPreferenceCandidateSchema.parse(input.editCandidate) : undefined;
  if (previous && (previous.profileId !== input.binding.profileId || previous.personId !== input.binding.personId
    || previous.expectedProfileRevision !== input.binding.profileRevision)) throw new Error("stale_profile_revision");
  const candidate = CareerPreferenceCandidateSchema.parse({
    personId: input.binding.personId, profileId: input.binding.profileId, expectedProfileRevision: input.binding.profileRevision,
    patch: previous ? mergePreferencePatches(previous.patch, patch) : patch, sourceUserMessageId: input.sourceUserMessageId, sourceTurnId: input.sourceTurnId,
    sourceTextHash: sha256Utf8(input.sourceText), sourceQuote: interpretation.sourceQuote,
    previousSources: previous ? [...previous.previousSources, { sourceUserMessageId: previous.sourceUserMessageId,
      sourceTurnId: previous.sourceTurnId, sourceTextHash: previous.sourceTextHash, sourceQuote: previous.sourceQuote }] : []
  });
  return { kind: interpretation.intent === "ambiguous" || !durable ? "clarification" as const : "candidate" as const, candidate };
}

function mergePreferencePatches(previous: CareerPreferencePatch, edit: CareerPreferencePatch): CareerPreferencePatch {
  const result: CareerPreferencePatch = { additions: {}, removals: {} };
  for (const field of ["targetRoles", "targetCities", "industries"] as const) {
    let additions = [...previous.additions?.[field] ?? []];
    let removals = [...previous.removals?.[field] ?? []];
    const key = (value: string) => value.normalize("NFKC").trim().toLowerCase();
    for (const value of edit.additions?.[field] ?? []) {
      removals = removals.filter(item => key(item) !== key(value));
      if (!additions.some(item => key(item) === key(value))) additions.push(value);
    }
    for (const value of edit.removals?.[field] ?? []) {
      additions = additions.filter(item => key(item) !== key(value));
      if (!removals.some(item => key(item) === key(value))) removals.push(value);
    }
    if (additions.length) result.additions![field] = additions;
    if (removals.length) result.removals![field] = removals;
  }
  return CareerPreferencePatchSchema.parse(result);
}
