import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import { ResumeRenderSectionTypeSchema, TemplateIdSchema } from "./resumeRender";

export const PresentationTypographyScaleSchema = z.enum(["compact", "normal", "comfortable"]);
export const PresentationLineHeightSchema = z.enum(["compact", "normal", "relaxed"]);
export const PresentationSpacingScaleSchema = z.enum(["compact", "normal", "spacious"]);
export const PresentationAccentColorSchema = z.enum(["graphite", "emerald", "blue", "rose"]);
export const PresentationDensitySchema = z.enum(["compact", "balanced", "spacious"]);

const ItemOrderBySectionSchema = z.object({
  summary: z.array(z.string().min(1)).optional(),
  experience: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  certificates: z.array(z.string().min(1)).optional()
}).default({});

export const ResumePresentationConfigSchema = z.object({
  schemaVersion: z.literal("resume-presentation-v1"),
  branchId: z.string().min(1),
  templateId: TemplateIdSchema,
  contentRevision: z.object({
    branchRevision: z.number().int().min(0),
    currentRevisionId: z.string().min(1)
  }),
  sectionOrder: z.array(ResumeRenderSectionTypeSchema).default(["summary", "skills", "experience", "certificates"]),
  itemOrderBySection: ItemOrderBySectionSchema,
  hiddenItemIds: z.array(z.string().min(1)).default([]),
  typography: z.object({
    scale: PresentationTypographyScaleSchema,
    lineHeight: PresentationLineHeightSchema
  }).default({
    scale: "normal",
    lineHeight: "normal"
  }),
  spacing: z.object({
    sectionGap: PresentationSpacingScaleSchema,
    itemGap: PresentationSpacingScaleSchema,
    paragraphGap: PresentationSpacingScaleSchema
  }).default({
    sectionGap: "normal",
    itemGap: "normal",
    paragraphGap: "normal"
  }),
  theme: z.object({
    accentColor: PresentationAccentColorSchema,
    density: PresentationDensitySchema
  }).default({
    accentColor: "emerald",
    density: "balanced"
  }),
  presentationRevision: z.number().int().min(0),
  updatedAt: IsoDateStringSchema
}).superRefine((config, ctx) => {
  for (const [section, itemIds] of Object.entries(config.itemOrderBySection)) {
    if (!itemIds) {
      continue;
    }
    const seen = new Set<string>();
    for (const itemId of itemIds) {
      if (seen.has(itemId)) {
        ctx.addIssue({
          code: "custom",
          path: ["itemOrderBySection", section],
          message: "item order must not contain duplicate item ids"
        });
      }
      seen.add(itemId);
    }
  }

  const hiddenSeen = new Set<string>();
  for (const itemId of config.hiddenItemIds) {
    if (hiddenSeen.has(itemId)) {
      ctx.addIssue({
        code: "custom",
        path: ["hiddenItemIds"],
        message: "hidden item ids must be unique"
      });
    }
    hiddenSeen.add(itemId);
  }
});

export type ResumePresentationConfig = z.infer<typeof ResumePresentationConfigSchema>;
export type PresentationTypographyScale = z.infer<typeof PresentationTypographyScaleSchema>;
export type PresentationLineHeight = z.infer<typeof PresentationLineHeightSchema>;
export type PresentationSpacingScale = z.infer<typeof PresentationSpacingScaleSchema>;
export type PresentationAccentColor = z.infer<typeof PresentationAccentColorSchema>;
export type PresentationDensity = z.infer<typeof PresentationDensitySchema>;
