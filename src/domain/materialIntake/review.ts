import { ImportedResumeDraftSchema, ResumeItemV2Schema, type ImportedResumeDraft, type ImportedResumeSectionType } from "@/domain/schemas";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";

/** Material candidates are provisional; a rejected sole value is never a fact. */
export function omitRejectedMaterialValues(draft: ImportedResumeDraft): ImportedResumeDraft {
  if (draft.schemaVersion !== "resume-import-v2") return draft;
  let result: ImportedResumeDraft = draft;
  for (const candidate of draft.fieldCandidates.filter((field) => field.reviewStatus === "rejected")) {
    if (candidate.mappingReason === "user_reclassified_section") continue;
    const alternative = draft.fieldCandidates.some((field) => field.id !== candidate.id && field.targetFieldId === candidate.targetFieldId
      && field.itemId === candidate.itemId && field.sectionId === candidate.sectionId && ["accepted", "edited"].includes(field.reviewStatus));
    if (alternative) continue;
    const key = candidate.targetFieldId.split(".").at(-1)!;
    if (candidate.targetFieldId.startsWith("basics.")) {
      result = { ...result, basics: { ...result.basics, [key]: undefined } };
      continue;
    }
    result = { ...result, sections: result.sections.map((section) => ({ ...section, items: section.items.map((item) => {
      if (item.id !== candidate.itemId || !item.structuredItem) return item;
      const value: Record<string, unknown> = { ...item.structuredItem };
      delete value[key];
      const parsed = ResumeItemV2Schema.safeParse(value);
      return parsed.success ? { ...item, structuredItem: parsed.data, normalizedText: projectResumeItemV2(parsed.data) }
        : { ...item, included: false };
    }) })) };
  }
  return ImportedResumeDraftSchema.parse(result);
}

/** Changing a category changes its canonical data as well as the label. No expertise or responsibility is inferred. */
export function reclassifyMaterialSection(draft: ImportedResumeDraft, sectionId: string, type: ImportedResumeSectionType): ImportedResumeDraft {
  return ImportedResumeDraftSchema.parse({ ...draft,
    ...(draft.schemaVersion === "resume-import-v2" ? { fieldCandidates: draft.fieldCandidates.map((field) => field.sectionId === sectionId
      ? { ...field, reviewStatus: "rejected", userConfirmed: false, needsConfirmation: false, mappingReason: "user_reclassified_section" } : field) } : {}),
    sections: draft.sections.map((section) => section.id !== sectionId ? section : { ...section, sectionType: type, category: undefined,
      included: type !== "unknown", confidence: "low", items: section.items.map((item) => {
        const old = item.structuredItem;
        const name = old && "name" in old ? old.name : old && "title" in old ? old.title : item.rawText.split("\n")[0];
        const base = { id: old?.id ?? item.id, sectionType: type, description: item.rawText, customFields: old?.customFields ?? [] };
        const value = ["awards", "certificates", "skills"].includes(type) ? { ...base, name,
          ...((type === "awards" || type === "certificates") && old && "issuer" in old ? { issuer: old.issuer } : {}) }
          : type === "languages" ? { ...base, language: name }
          : type === "project" ? { ...base, title: name }
          : type === "summary" ? { id: base.id, sectionType: type, text: item.rawText }
          : base;
        const parsed = ResumeItemV2Schema.safeParse(value);
        return { ...item, structuredItem: parsed.success ? parsed.data : undefined, included: parsed.success,
          normalizedText: parsed.success ? projectResumeItemV2(parsed.data) : item.normalizedText,
          userEdited: true, userConfirmed: false, sourceStatus: "ambiguous", mapping: undefined };
      }) }) });
}
