import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import { ResumeRenderSectionTypeSchema, TemplateIdSchema } from "./resumeRender";

export const PresentationBodyTextScaleSchema = z.enum(["small", "normal", "large"]);
export const PresentationTitleTextScaleSchema = z.enum(["small", "normal", "large"]);
export const PresentationLineHeightSchema = z.enum(["tight", "normal", "relaxed"]);
export const PresentationSpacingScaleSchema = z.enum(["tight", "normal", "relaxed"]);
export const PresentationAccentColorSchema = z.enum(["graphite", "emerald", "blue", "rose"]);
export const PresentationDensitySchema = z.enum(["compact", "balanced", "spacious"]);

const LEGACY_TYPOGRAPHY_SCALE = ["compact", "normal", "comfortable"] as const;
const LEGACY_SPACING_SCALE = ["compact", "normal", "spacious"] as const;

const DEFAULT_TYPOGRAPHY = {
  bodyTextScale: "normal",
  titleTextScale: "normal",
  lineHeight: "normal"
} as const;

const DEFAULT_SPACING = {
  sectionGap: "normal",
  itemGap: "normal"
} as const;

const DEFAULT_THEME = {
  accentColor: "emerald",
  density: "balanced"
} as const;

const ItemOrderBySectionSchema = z.object({
  summary: z.array(z.string().min(1)).optional(),
  experience: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  certificates: z.array(z.string().min(1)).optional()
}).default({});

const SectionStyleOverrideSchema = z.object({
  showTitle: z.boolean().optional()
});

const SectionStyleOverridesSchema = z.object({
  summary: SectionStyleOverrideSchema.optional(),
  experience: SectionStyleOverrideSchema.optional(),
  skills: SectionStyleOverrideSchema.optional(),
  certificates: SectionStyleOverrideSchema.optional()
}).default({});

const PresentationTypographySchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_TYPOGRAPHY;
  }
  const candidate = value as {
    bodyTextScale?: unknown;
    titleTextScale?: unknown;
    scale?: unknown;
    lineHeight?: unknown;
  };
  return {
    bodyTextScale: normalizeBodyTextScale(candidate.bodyTextScale ?? candidate.scale),
    titleTextScale: normalizeTitleTextScale(candidate.titleTextScale),
    lineHeight: normalizeLineHeight(candidate.lineHeight)
  };
}, z.object({
  bodyTextScale: PresentationBodyTextScaleSchema,
  titleTextScale: PresentationTitleTextScaleSchema,
  lineHeight: PresentationLineHeightSchema
}));

const PresentationSpacingSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_SPACING;
  }
  const candidate = value as {
    sectionGap?: unknown;
    itemGap?: unknown;
  };
  return {
    sectionGap: normalizeSpacingScale(candidate.sectionGap),
    itemGap: normalizeSpacingScale(candidate.itemGap)
  };
}, z.object({
  sectionGap: PresentationSpacingScaleSchema,
  itemGap: PresentationSpacingScaleSchema
}));

const PresentationThemeSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_THEME;
  }
  const candidate = value as {
    accentColor?: unknown;
    density?: unknown;
  };
  return {
    accentColor: normalizeAccentColor(candidate.accentColor),
    density: normalizeDensity(candidate.density)
  };
}, z.object({
  accentColor: PresentationAccentColorSchema,
  density: PresentationDensitySchema
}));

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
  typography: PresentationTypographySchema.default(DEFAULT_TYPOGRAPHY),
  spacing: PresentationSpacingSchema.default(DEFAULT_SPACING),
  theme: PresentationThemeSchema.default(DEFAULT_THEME),
  sectionStyleOverrides: SectionStyleOverridesSchema,
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

function normalizeBodyTextScale(value: unknown) {
  if (value === "small" || value === "normal" || value === "large") {
    return value;
  }
  if (value === "compact") {
    return "small";
  }
  if (value === "comfortable") {
    return "large";
  }
  if (LEGACY_TYPOGRAPHY_SCALE.includes(value as never)) {
    return "normal";
  }
  return DEFAULT_TYPOGRAPHY.bodyTextScale;
}

function normalizeTitleTextScale(value: unknown) {
  if (value === "small" || value === "normal" || value === "large") {
    return value;
  }
  return DEFAULT_TYPOGRAPHY.titleTextScale;
}

function normalizeLineHeight(value: unknown) {
  if (value === "tight" || value === "normal" || value === "relaxed") {
    return value;
  }
  if (value === "compact") {
    return "tight";
  }
  return DEFAULT_TYPOGRAPHY.lineHeight;
}

function normalizeSpacingScale(value: unknown) {
  if (value === "tight" || value === "normal" || value === "relaxed") {
    return value;
  }
  if (value === "compact") {
    return "tight";
  }
  if (value === "spacious") {
    return "relaxed";
  }
  if (LEGACY_SPACING_SCALE.includes(value as never)) {
    return "normal";
  }
  return "normal";
}

function normalizeAccentColor(value: unknown) {
  if (value === "graphite" || value === "emerald" || value === "blue" || value === "rose") {
    return value;
  }
  return DEFAULT_THEME.accentColor;
}

function normalizeDensity(value: unknown) {
  if (value === "compact" || value === "balanced" || value === "spacious") {
    return value;
  }
  return DEFAULT_THEME.density;
}

export type ResumePresentationConfig = z.infer<typeof ResumePresentationConfigSchema>;
export type PresentationBodyTextScale = z.infer<typeof PresentationBodyTextScaleSchema>;
export type PresentationTitleTextScale = z.infer<typeof PresentationTitleTextScaleSchema>;
export type PresentationLineHeight = z.infer<typeof PresentationLineHeightSchema>;
export type PresentationSpacingScale = z.infer<typeof PresentationSpacingScaleSchema>;
export type PresentationAccentColor = z.infer<typeof PresentationAccentColorSchema>;
export type PresentationDensity = z.infer<typeof PresentationDensitySchema>;
