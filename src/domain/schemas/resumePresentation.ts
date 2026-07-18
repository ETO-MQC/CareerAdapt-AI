import { z } from "zod";
import { ResumeSectionTypeV2Schema } from "./resumeV2";

export const ResumePresentationCustomRowSchema = z.object({
  label: z.string().min(1).optional(),
  value: z.string().min(1),
  displayMode: z.enum(["inline", "secondary", "bullet"])
}).strict();

export const ResumePresentationItemSchema = z.object({
  id: z.string().min(1),
  sourceItemId: z.string().min(1).optional(),
  fragmentIndex: z.number().int().min(0).optional(),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  primaryTitle: z.string().min(1).optional(),
  secondaryTitle: z.string().min(1).optional(),
  tertiaryTitle: z.string().min(1).optional(),
  dateRange: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  groupLabel: z.string().min(1).optional(),
  inlineMeta: z.array(z.string().min(1)).default([]),
  secondaryMeta: z.array(z.string().min(1)).default([]),
  description: z.string().min(1).optional(),
  highlights: z.array(z.string().min(1)).default([]),
  links: z.array(z.string().url()).default([]),
  customRows: z.array(ResumePresentationCustomRowSchema).default([]),
  warnings: z.array(z.string().min(1)).default([])
}).strict();

export type ResumePresentationCustomRow = z.infer<typeof ResumePresentationCustomRowSchema>;
export type ResumePresentationItem = z.infer<typeof ResumePresentationItemSchema>;
