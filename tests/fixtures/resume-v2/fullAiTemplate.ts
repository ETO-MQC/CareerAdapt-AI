import { createResumeJsonV2Example } from "@/domain/resumeImport/jsonV2Adapter";

/**
 * Desensitized, placeholder-free fixture derived from the user-supplied full AI template.
 * It is parsed by the production Zod schema at construction time.
 */
export const fullAiTemplateFixture = createResumeJsonV2Example();
