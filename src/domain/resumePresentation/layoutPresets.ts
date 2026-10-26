import { z } from "zod";
import { ResumePresentationConfigSchema, type ResumePresentationConfig } from "@/domain/schemas/presentation";

export const ResumeLayoutStyleSchema = z.object({
  typography: ResumePresentationConfigSchema.shape.typography,
  spacing: ResumePresentationConfigSchema.shape.spacing,
  theme: ResumePresentationConfigSchema.shape.theme,
  precision: ResumePresentationConfigSchema.shape.precision
}).strict();
export const ResumeLayoutPresetSchema = z.object({
  id: z.string().min(1), name: z.string().trim().min(1).max(60),
  createdAt: z.string().datetime(), style: ResumeLayoutStyleSchema
}).strict();
export const ResumeLayoutPresetsSchema = z.array(ResumeLayoutPresetSchema).max(100);
export type ResumeLayoutStyle = z.infer<typeof ResumeLayoutStyleSchema>;
export type ResumeLayoutPreset = z.infer<typeof ResumeLayoutPresetSchema>;
export function layoutStyleFrom(config: ResumePresentationConfig): ResumeLayoutStyle {
  return ResumeLayoutStyleSchema.parse({ typography: config.typography, spacing: config.spacing, theme: config.theme, precision: config.precision });
}
export function referenceLayoutStyle(config: ResumePresentationConfig): ResumeLayoutStyle {
  return { ...layoutStyleFrom(config), precision: { ...config.precision, fontSizePx: 15, lineHeight: 1.56, letterSpacingPx: 0, sectionGapPx: 10, nameScale: 1.55, sectionScale: 1.08, contactScale: 0.94, descriptionScale: 1, entryScale: 1, targetScale: 1 } };
}
