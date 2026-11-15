import { z } from "zod";

const values = z.array(z.string().trim().min(1).max(120)).max(50).optional();
const changes = z.object({ targetRoles: values, targetCities: values, industries: values }).strict();

export const CareerPreferencePatchSchema = z.object({
  additions: changes.optional(),
  removals: changes.optional()
}).strict().refine(patch => [patch.additions, patch.removals].some(group =>
  group && Object.values(group).some(items => items && items.length > 0)), "preference_patch_empty");

export type CareerPreferencePatch = z.infer<typeof CareerPreferencePatchSchema>;

export function applyCareerPreferencePatch(
  current: { targetRoles: string[]; targetCities: string[]; industries: string[] },
  patch: CareerPreferencePatch
) {
  const canonical = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  const result = { ...current };
  for (const field of ["targetRoles", "targetCities", "industries"] as const) {
    const removed = new Set((patch.removals?.[field] ?? []).map(canonical));
    const additions = patch.additions?.[field] ?? [];
    if (additions.some(value => removed.has(canonical(value)))) throw new Error("preference_patch_conflict");
    const seen = new Set<string>();
    result[field] = [...current[field], ...additions].filter(value => {
      const key = canonical(value);
      if (removed.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return result;
}
