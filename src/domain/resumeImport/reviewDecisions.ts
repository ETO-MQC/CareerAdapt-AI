import {
  ImportedResumeDraftSchema,
  ResumeItemV2Schema,
  type ImportedResumeDraft
} from "@/domain/schemas";

export type ResumeImportReviewDecision = "accept_all" | "ignore_uncertain";

export function applyResumeImportReviewDecision(
  draft: ImportedResumeDraft,
  decision: ResumeImportReviewDecision
): ImportedResumeDraft {
  const accept = decision === "accept_all";
  const confirmField = <T extends ImportedResumeDraft["basics"]["name"]>(field: T): T => {
    if (!field?.mapping?.needsConfirmation) return field;
    if (!accept) return undefined as T;
    return {
      ...field,
      sourceStatus: "user_confirmed_modified",
      userConfirmed: true,
      mapping: { ...field.mapping, needsConfirmation: false }
    } as T;
  };
  const reviewedSections = draft.sections.map((section) => ({
    ...section,
    items: section.items.map((item) => item.mapping?.needsConfirmation || item.sourceStatus === "ambiguous"
      ? {
          ...item,
          included: accept,
          sourceStatus: "user_confirmed_modified" as const,
          userConfirmed: accept,
          mapping: item.mapping ? { ...item.mapping, needsConfirmation: false } : undefined
        }
      : item)
  }));
  const sections = !accept && draft.schemaVersion === "resume-import-v2"
    ? draft.fieldCandidates
        .filter((candidate) => candidate.reviewStatus === "needs_review")
        .reduce(removeCandidateValue, reviewedSections)
    : reviewedSections;
  return ImportedResumeDraftSchema.parse({
    ...draft,
    basics: {
      ...draft.basics,
      name: confirmField(draft.basics.name),
      email: confirmField(draft.basics.email),
      phone: confirmField(draft.basics.phone),
      location: confirmField(draft.basics.location),
      summary: confirmField(draft.basics.summary),
      links: draft.basics.links.flatMap((field) => {
        const reviewed = confirmField(field);
        return reviewed ? [reviewed] : [];
      })
    },
    sections,
    ...(draft.schemaVersion === "resume-import-v2"
      ? {
          fieldCandidates: draft.fieldCandidates.map((candidate) =>
            candidate.reviewStatus === "needs_review"
              ? {
                  ...candidate,
                  needsConfirmation: false,
                  userConfirmed: accept,
                  reviewStatus: accept ? "accepted" as const : "rejected" as const
                }
              : candidate
          )
        }
      : {})
  });
}

function removeCandidateValue(
  sections: ImportedResumeDraft["sections"],
  candidate: Extract<ImportedResumeDraft, { schemaVersion: "resume-import-v2" }>["fieldCandidates"][number]
) {
  if (!candidate.itemId || candidate.itemId === "basics") return sections;
  const key = candidate.targetFieldId.split(".").at(-1);
  if (!key) return sections;
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.id !== candidate.itemId || !item.structuredItem) return item;
      const record = { ...item.structuredItem } as unknown as Record<string, unknown>;
      if (key === "current") record.current = false;
      else delete record[key];
      return { ...item, structuredItem: ResumeItemV2Schema.parse(record) };
    })
  }));
}
