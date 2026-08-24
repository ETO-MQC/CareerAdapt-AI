import type { ResumeBranch, ResumeItemV2, ResumeTailoringDiff } from "@/domain/schemas";

/**
 * Tailoring is a field-patch operation. Identity fields are deliberately not
 * in the patch allow-list, so any change to them is a transaction failure.
 * The diff list is accepted here to keep the assertion at the same boundary
 * as the applied patch ledger and to make future allow-list changes explicit.
 */
export function assertTailoringStructuralPreservation(
  source: ResumeBranch,
  result: ResumeBranch,
  appliedDiffs: ResumeTailoringDiff[]
) {
  const appliedTargets = new Set(appliedDiffs.map((diff) => diff.target.itemId));
  const sourceItems = source.structuredContentItems ?? [];
  const resultById = new Map((result.structuredContentItems ?? []).map((item) => [item.id, item]));

  for (const sourceItem of sourceItems) {
    const resultItem = resultById.get(sourceItem.id);
    if (!resultItem) throw new Error(`tailoring_structural_item_removed:${sourceItem.id}`);
    if (sourceItem.data.sectionType !== resultItem.data.sectionType) {
      throw new Error(`tailoring_structural_section_changed:${sourceItem.id}`);
    }
    for (const field of structuralFields(sourceItem.data)) {
      const before = structuralValue(sourceItem.data, field);
      const after = structuralValue(resultItem.data, field);
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const targetState = appliedTargets.has(sourceItem.id) ? "targeted" : "untargeted";
      throw new Error(`tailoring_structural_identity_changed:${sourceItem.id}:${field}:${targetState}`);
    }
  }
}

function structuralFields(item: ResumeItemV2): string[] {
  if (item.sectionType === "education") return ["school", "degree", "major", "department", "location", "startDate", "endDate", "expectedEndDate", "current"];
  if (["work", "internship", "campus", "volunteer"].includes(item.sectionType)) return ["organization", "role", "department", "location", "startDate", "endDate", "current"];
  if (item.sectionType === "project") return ["title", "role", "organization", "location", "startDate", "endDate", "current", "url", "tools", "background"];
  if (["research", "portfolio", "publications", "patents"].includes(item.sectionType)) return ["title", "role", "authorRole", "institution", "startDate", "endDate", "current", "url"];
  if (item.sectionType === "skills") return ["name", "category", "level"];
  if (["certificates", "awards", "languages"].includes(item.sectionType)) return ["name", "issuer", "language", "level", "issuedAt", "awardedAt"];
  return ["title"];
}

function structuralValue(item: ResumeItemV2, field: string) {
  return (item as unknown as Record<string, unknown>)[field];
}
