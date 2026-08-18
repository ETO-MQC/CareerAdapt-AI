import type { ProfileStructuredFact } from "@/domain/schemas/profile";
import type { ResumeItemV2 } from "@/domain/schemas/resumeV2";

/**
 * Neutral editor projection for canonical Profile evidence. The projection is
 * intentionally broader than the old work/project form so a UI round trip
 * cannot erase project outcomes, tools, or provenance.
 */
export type CanonicalExperienceEditorDocument = {
  description: string;
  highlights: string[];
  outcomes: string[];
  tools: string[];
  background: string;
  provenance?: ProfileStructuredFact["provenance"];
};

export function canonicalExperienceToEditorDocument(
  source: ResumeItemV2 | ProfileStructuredFact
): CanonicalExperienceEditorDocument {
  const item = "data" in source ? source.data : source;
  const record = item as unknown as Record<string, unknown>;
  return {
    description: typeof record.description === "string" ? record.description : "",
    highlights: Array.isArray(record.highlights) ? record.highlights.filter((value): value is string => typeof value === "string") : [],
    outcomes: item.sectionType === "project" ? [...item.outcomes] : [],
    tools: item.sectionType === "project" ? [...item.tools] : [],
    background: item.sectionType === "project" ? item.background ?? "" : "",
    ...(
      "data" in source && source.provenance
        ? { provenance: source.provenance }
        : {}
    )
  };
}

export function editorDocumentToCanonicalExperience(
  source: ResumeItemV2,
  document: CanonicalExperienceEditorDocument
): ResumeItemV2;
export function editorDocumentToCanonicalExperience(
  source: ProfileStructuredFact,
  document: CanonicalExperienceEditorDocument
): ProfileStructuredFact;
export function editorDocumentToCanonicalExperience(
  source: ResumeItemV2 | ProfileStructuredFact,
  document: CanonicalExperienceEditorDocument
): ResumeItemV2 | ProfileStructuredFact {
  if ("data" in source) {
    return {
      ...source,
      data: editorDocumentToCanonicalExperience(source.data, document),
      ...(document.provenance ? { provenance: document.provenance } : {})
    };
  }
  const description = optionalText(document.description);
  const highlights = cleanList(document.highlights);
  if (source.sectionType === "project") {
    return {
      ...source,
      description,
      highlights,
      outcomes: cleanList(document.outcomes),
      tools: cleanList(document.tools),
      background: optionalText(document.background)
    };
  }
  if (source.sectionType === "summary") return source;
  if ("highlights" in source) return { ...source, description, highlights } as ResumeItemV2;
  if ("description" in source) return { ...source, description } as ResumeItemV2;
  return source;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function cleanList(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}
