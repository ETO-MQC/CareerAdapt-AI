import { resumeFieldCatalog } from "./fieldCatalog";
import { resumeSectionCatalog } from "./sectionCatalog";
import type { CanonicalFieldId, ResumeSectionTypeV2 } from "./types";

export type ResumeSectionCapability = {
  sectionType: ResumeSectionTypeV2;
  supportedFields: CanonicalFieldId[];
  optimizableFields: CanonicalFieldId[];
  readOnlyFields: CanonicalFieldId[];
  rendererSupport: true;
  templateSupport: "native" | "fallback";
  preservesCustomFields: true;
};

export const resumeSectionCapabilityMatrix: readonly ResumeSectionCapability[] = resumeSectionCatalog.map((section) => {
  const fields = resumeFieldCatalog.filter((field) => field.sectionType === section.id);
  return {
    sectionType: section.id,
    supportedFields: fields.map((field) => field.id),
    optimizableFields: fields.filter((field) => field.aiMappable && !field.sensitive).map((field) => field.id),
    readOnlyFields: fields.filter((field) => !field.aiMappable || field.sensitive).map((field) => field.id),
    rendererSupport: true,
    templateSupport: "native",
    preservesCustomFields: true
  };
});

export function getResumeSectionCapability(sectionType: ResumeSectionTypeV2) {
  return resumeSectionCapabilityMatrix.find((capability) => capability.sectionType === sectionType);
}
