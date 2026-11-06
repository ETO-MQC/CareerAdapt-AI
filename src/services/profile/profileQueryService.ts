import { z } from "zod";
import { ResumeSectionTypeV2Schema } from "@/domain/schemas/resumeV2";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import type { CareerProfile } from "@/domain/schemas/profile";
import { ProfileReadError, type ProfileReadPort, type ProfileReadScope } from "./profileReadPort";

export const ProfileQueryInputSchema = z.object({
  sectionTypes: z.array(ResumeSectionTypeV2Schema).min(1).max(20).optional(),
  limit: z.number().int().min(1).max(20).default(20),
  cursor: z.string().min(1).max(4096).optional()
}).strict();
export const ProfileSearchQueryInputSchema = ProfileQueryInputSchema.extend({
  query: z.string().trim().min(1).max(240)
});
const CursorSchema = z.object({
  v: z.literal(1), workspaceId: z.string(), personId: z.string(), profileId: z.string(),
  sourceRevision: z.string(), range: z.string(), offset: z.number().int().min(0)
}).strict();
const SourceRefSchema = z.object({
  kind: z.enum(["evidence", "fact_source", "block", "range", "source_turn", "ai_proposal", "user_correction"]),
  id: z.string().max(256), start: z.number().int().optional(), end: z.number().int().optional()
}).strict();
export const ProfileQueryResultSchema = z.object({
  projectionVersion: z.literal("career-profile-read-v1"),
  status: z.enum(["ok", "empty"]), profileId: z.string(), personId: z.string(),
  sourceRevision: z.string(), requestId: z.string(),
  items: z.array(z.object({
    itemId: z.string(), sectionType: ResumeSectionTypeV2Schema,
    text: z.string().max(4000), textTruncated: z.boolean(),
    factIds: z.array(z.string()).max(32), referencesTruncated: z.boolean(),
    confirmationState: z.enum(["confirmed", "unconfirmed", "mixed", "unknown"]),
    sourceRefs: z.array(SourceRefSchema).max(32)
  }).strict()).max(20),
  nextCursor: z.string().nullable(), truncated: z.boolean(),
  searchSemantics: z.literal("keyword_only_no_absence_inference").optional()
}).strict();
export type ProfileQueryResult = z.infer<typeof ProfileQueryResultSchema>;

/** Bounded tool projection only; CareerProfile v2 remains the domain authority. */
export class ProfileQueryService {
  constructor(private readonly repository: ProfileReadPort) {}

  async query(scope: ProfileReadScope, raw: unknown, requestId: string, search = false): Promise<ProfileQueryResult> {
    const parsed = (search ? ProfileSearchQueryInputSchema : ProfileQueryInputSchema).safeParse(raw);
    if (!parsed.success) throw new ProfileReadError("INVALID_REQUEST");
    const input = parsed.data;
    const range = JSON.stringify({ sections: [...new Set(input.sectionTypes ?? [])].sort(),
      query: "query" in input ? input.query : null, limit: input.limit });
    let cursor: z.infer<typeof CursorSchema> | undefined;
    if (input.cursor) {
      try { cursor = CursorSchema.parse(JSON.parse(input.cursor)); }
      catch { throw new ProfileReadError("INVALID_REQUEST"); }
      if (cursor.workspaceId !== scope.workspaceId || cursor.personId !== scope.personId
        || cursor.profileId !== scope.profileId || cursor.range !== range) throw new ProfileReadError("INVALID_REQUEST");
    }
    const profile = await this.repository.readInitializedProfile(scope);
    const sourceRevision = `${profile.version}:${profile.updatedAt}`;
    if (cursor && cursor.sourceRevision !== sourceRevision) throw new ProfileReadError("STALE_CURSOR");
    const items = canonicalProfileLibraryItems(profile).filter(item =>
      (!input.sectionTypes || input.sectionTypes.includes(item.sectionType))
      && (!("query" in input) || `${item.title}\n${item.subtitle}\n${item.body}`.toLocaleLowerCase().includes(String(input.query).toLocaleLowerCase())));
    const offset = cursor?.offset ?? 0;
    if (offset > items.length) throw new ProfileReadError("INVALID_REQUEST");
    const page = items.slice(offset, offset + input.limit).map(item => {
      const entry = profile.structuredFacts!.find(candidate => candidate.data.id === item.id)!;
      const facts = profile.experiences.flatMap(experience => experience.facts)
        .concat(profile.skills.flatMap(skill => skill.fact ? [skill.fact] : []),
          profile.certificates.flatMap(certificate => certificate.fact ? [certificate.fact] : []))
        .filter(fact => item.factIds.includes(fact.id));
      const states = item.factIds.map(id => facts.find(fact => fact.id === id)?.confirmedByUser);
      const confirmationState = !states.length || states.some(state => state === undefined) ? "unknown"
        : states.every(Boolean) ? "confirmed" : states.every(state => !state) ? "unconfirmed" : "mixed";
      const refs: z.infer<typeof SourceRefSchema>[] = [
        ...entry.sourceBlockIds.map(id => ({ kind: "block" as const, id })),
        ...entry.sourceRanges.map(({ blockId, start, end }) => ({ kind: "range" as const, id: blockId, start, end })),
        ...(entry.provenance ?? []).flatMap(p => p.sourceTurnId ? [{ kind: p.kind, id: p.sourceTurnId }] : []),
        ...facts.flatMap(fact => fact.provenance.map(p => ({ kind: "fact_source" as const, id: p.sourceId }))),
        ...evidenceIds(profile, item.factIds).filter(id => profile.evidences.some(e => e.id === id))
          .map(id => ({ kind: "evidence" as const, id }))
      ];
      const safeRefs = refs.filter(ref => ref.id.length <= 256 && !/[\\/]|^[a-z]:/i.test(ref.id));
      const text = [item.title, item.subtitle, item.body].filter(Boolean).join("\n");
      return { itemId: item.id, sectionType: item.sectionType, text: text.slice(0, 4000),
        textTruncated: text.length > 4000, factIds: item.factIds.slice(0, 32),
        confirmationState, sourceRefs: safeRefs.slice(0, 32),
        referencesTruncated: safeRefs.length !== refs.length || refs.length > 32 || item.factIds.length > 32 };
    });
    const hasMore = offset + page.length < items.length;
    const result = ProfileQueryResultSchema.parse({ projectionVersion: "career-profile-read-v1",
      status: items.length ? "ok" : "empty", profileId: profile.id, personId: profile.personId,
      sourceRevision, requestId, items: page,
      nextCursor: hasMore ? JSON.stringify({ v: 1, ...scope, sourceRevision, range, offset: offset + page.length }) : null,
      truncated: hasMore || page.some(item => item.textTruncated || item.referencesTruncated),
      ...(search ? { searchSemantics: "keyword_only_no_absence_inference" } : {}) });
    // Final UTF-8 byte ceiling includes IDs and references, not just body text.
    if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 262_144) {
      throw new ProfileReadError("SERVICE_UNAVAILABLE");
    }
    return result;
  }
}

function evidenceIds(profile: CareerProfile, factIds: string[]) {
  return [...new Set([...profile.experiences.filter(e => e.facts.some(f => factIds.includes(f.id))),
    ...profile.skills.filter(s => s.fact && factIds.includes(s.fact.id)),
    ...profile.certificates.filter(c => c.fact && factIds.includes(c.fact.id))].flatMap(item => item.evidenceIds))];
}
