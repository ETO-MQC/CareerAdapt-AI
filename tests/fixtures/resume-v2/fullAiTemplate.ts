import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";

/**
 * Desensitized, placeholder-free fixture derived from the user-supplied full AI template.
 * It is parsed by the production Zod schema at construction time.
 */
export const fullAiTemplateFixture = createResumeJsonV2Example();

// Exercise the optional percentage field added in catalog v2.2.0.
for (const section of fullAiTemplateFixture.sections) {
  for (const item of section.items) {
    if (item.sectionType === "education") item.rankPercent = 10;
  }
}
