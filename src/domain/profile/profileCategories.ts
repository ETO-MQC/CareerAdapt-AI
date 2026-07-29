import type { ResumeSectionTypeV2 } from "@/domain/schemas";

export type ProfileUiCategoryId =
  | Exclude<ResumeSectionTypeV2, "awards" | "skills" | "certificates" | "languages">
  | "award"
  | "skill"
  | "certificate"
  | "language";

const canonicalAliases = {
  award: "awards",
  skill: "skills",
  certificate: "certificates",
  language: "languages"
} as const satisfies Record<
  Extract<ProfileUiCategoryId, "award" | "skill" | "certificate" | "language">,
  ResumeSectionTypeV2
>;

const uiAliases = Object.fromEntries(
  Object.entries(canonicalAliases).map(([uiCategory, sectionType]) => [sectionType, uiCategory])
) as Record<(typeof canonicalAliases)[keyof typeof canonicalAliases], keyof typeof canonicalAliases>;

export function canonicalSectionTypeForProfileCategory(
  category: ProfileUiCategoryId
): ResumeSectionTypeV2 {
  return category in canonicalAliases
    ? canonicalAliases[category as keyof typeof canonicalAliases]
    : category as ResumeSectionTypeV2;
}

export function profileCategoryForCanonicalSection(
  sectionType: ResumeSectionTypeV2
): ProfileUiCategoryId {
  return sectionType in uiAliases
    ? uiAliases[sectionType as keyof typeof uiAliases]
    : sectionType as ProfileUiCategoryId;
}
