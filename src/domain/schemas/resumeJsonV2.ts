import { z } from "zod";
import { isCanonicalFieldId } from "@/domain/resumeFields";
import { ResumeBasicsV2Schema, ResumeItemV2Schema, ResumeSectionTypeV2Schema } from "./resumeV2";

export const ResumeJsonV2MappingTraceSchema = z.object({
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  sourceQuote: z.string().min(1),
  targetFieldId: z.string().refine(isCanonicalFieldId, "targetFieldId must exist in the canonical field catalog"),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean(),
  mappingReason: z.string().min(1)
}).strict();

export const ResumeJsonV2SectionSchema = z.object({
  id: z.string().min(1),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  title: z.string().min(1),
  order: z.number().int().min(0),
  visible: z.boolean().default(true),
  items: z.array(ResumeItemV2Schema).default([]),
  mappingTrace: z.array(ResumeJsonV2MappingTraceSchema).optional()
}).strict().superRefine((section, context) => {
  for (const [index, item] of section.items.entries()) {
    if (item.sectionType !== section.sectionType) {
      context.addIssue({ code: "custom", path: ["items", index, "sectionType"], message: "item sectionType must match its section" });
    }
  }
});

export const ResumeJsonV2UnclassifiedBlockSchema = z.object({
  id: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceValue: z.unknown(),
  reason: z.string().min(1)
}).strict();

export const CareerAdaptResumeJsonV2Schema = z.object({
  schemaVersion: z.literal("careeradapt-resume-v2"),
  locale: z.string().min(2).default("zh-CN"),
  basics: ResumeBasicsV2Schema.default({ portfolioLinks: [], otherLinks: [], customFields: [] }),
  sections: z.array(ResumeJsonV2SectionSchema).default([]),
  unclassifiedBlocks: z.array(ResumeJsonV2UnclassifiedBlockSchema).default([])
}).strict().superRefine((resume, context) => {
  const ids = new Set<string>();
  for (const [sectionIndex, section] of resume.sections.entries()) {
    if (ids.has(section.id)) context.addIssue({ code: "custom", path: ["sections", sectionIndex, "id"], message: "section ids must be unique" });
    ids.add(section.id);
    for (const [itemIndex, item] of section.items.entries()) {
      if (ids.has(item.id)) context.addIssue({ code: "custom", path: ["sections", sectionIndex, "items", itemIndex, "id"], message: "item ids must be unique" });
      ids.add(item.id);
    }
  }
});

export type ResumeJsonV2MappingTrace = z.infer<typeof ResumeJsonV2MappingTraceSchema>;
export type ResumeJsonV2Section = z.infer<typeof ResumeJsonV2SectionSchema>;
export type ResumeJsonV2UnclassifiedBlock = z.infer<typeof ResumeJsonV2UnclassifiedBlockSchema>;
export type CareerAdaptResumeJsonV2 = z.infer<typeof CareerAdaptResumeJsonV2Schema>;
