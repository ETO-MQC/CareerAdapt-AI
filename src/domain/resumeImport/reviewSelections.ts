import type { CareerProfile, ImportedResumeDraft, ImportedResumeField, ImportedResumeItem } from "@/domain/schemas";

export type ImportBulkSelectionMode = "use_imported" | "keep_existing" | "safe_only" | "reset";

export function applyImportBulkSelection(input: {
  draft: ImportedResumeDraft;
  baseline?: ImportedResumeDraft;
  mode: ImportBulkSelectionMode;
  sectionId?: string;
  profile?: CareerProfile;
}) {
  const sourcePathCounts = mappingSourcePathCounts(input.draft);
  return {
    ...input.draft,
    sections: input.draft.sections.map((section) => {
      if (input.sectionId && section.id !== input.sectionId) return section;
      const baselineSection = input.baseline?.sections.find((candidate) => candidate.id === section.id);
      return {
        ...section,
        items: section.items.map((item) => {
          if (input.mode === "reset") {
            const original = baselineSection?.items.find((candidate) => candidate.id === item.id);
            return original ? { ...item, included: original.included, sourceStatus: original.sourceStatus, mapping: original.mapping } : item;
          }
          if (input.mode === "keep_existing") return { ...item, included: false };
          const safe = isSafeBulkMapping(item, sourcePathCounts)
            && (input.mode !== "safe_only" || !itemConflictsWithProfile(item, input.profile));
          if (!safe) return { ...item, included: false };
          return input.mode === "use_imported"
            ? { ...item, included: true, sourceStatus: "user_confirmed_modified" as const }
            : { ...item, included: true };
        })
      };
    })
  };
}

export function mappingSourcePathCounts(draft: ImportedResumeDraft) {
  const counts = new Map<string, number>();
  const mappings = [
    draft.basics.name?.mapping,
    draft.basics.email?.mapping,
    draft.basics.phone?.mapping,
    draft.basics.location?.mapping,
    draft.basics.summary?.mapping,
    ...draft.basics.links.map((field) => field.mapping),
    ...draft.sections.flatMap((section) => section.items.map((item) => item.mapping))
  ].filter(Boolean);
  for (const mapping of mappings) {
    for (const path of mapping!.sourcePaths) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

export function isSafeBulkMapping(
  item: Pick<ImportedResumeItem, "confidence" | "mapping"> | Pick<ImportedResumeField, "confidence" | "mapping">,
  counts: Map<string, number>
) {
  if (!item.mapping) return true;
  return item.mapping.confidenceLevel !== "low"
    && !item.mapping.needsConfirmation
    && item.mapping.sourcePaths.every((path) => counts.get(path) === 1);
}

function itemConflictsWithProfile(item: ImportedResumeItem, profile: CareerProfile | undefined) {
  if (!profile) return false;
  const normalized = item.normalizedText.trim().toLocaleLowerCase();
  const existing = [
    ...profile.experiences.flatMap((experience) => experience.facts.map((fact) => fact.statement)),
    ...profile.skills.map((skill) => skill.name),
    ...profile.certificates.map((certificate) => certificate.name)
  ];
  return existing.some((value) => value.trim().toLocaleLowerCase() === normalized);
}
