import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import { ResumeRenderSectionTypeSchema, TemplateIdSchema } from "./resumeRender";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";

export const PresentationBodyTextScaleSchema = z.enum(["small", "normal", "large"]);
export const PresentationTitleTextScaleSchema = z.enum(["small", "normal", "large"]);
export const PresentationLineHeightSchema = z.enum(["tight", "normal", "relaxed"]);
export const PresentationSpacingScaleSchema = z.enum(["tight", "normal", "relaxed"]);
export const PresentationAccentColorSchema = z.enum(["graphite", "emerald", "blue", "rose"]);
export const PresentationDensitySchema = z.enum(["compact", "balanced", "spacious"]);
export const PresentationFontFamilySchema = z.enum(["system_sans", "source_han_sans", "source_han_serif"]);
export const PresentationEnglishFontFamilySchema = z.enum(["system_sans", "arial", "georgia"]);
export const PresentationPageMarginSchema = z.enum(["narrow", "normal", "wide"]);
export const PresentationHeaderFooterSchema = z.enum(["none", "page_number"]);
export const ResumePagePolicySchema = z.enum(["natural", "prefer_one_page", "one_page_strict", "up_to_two_pages"]);
export const ResumePreferredPageCountSchema = z.union([z.literal(1), z.literal(2)]);
export const ResumeMaximumPageCountSchema = z.literal(4);
export const ResumeOverflowBehaviorSchema = z.enum(["warn", "allow"]);
export const PresentationHighlightListStyleSchema = z.enum(["bullet", "numbered", "none"]);
export const PresentationItemHeaderMiddleAlignmentSchema = z.enum(["fixed-column", "balanced", "flow"]);

const LEGACY_TYPOGRAPHY_SCALE = ["compact", "normal", "comfortable"] as const;
const LEGACY_SPACING_SCALE = ["compact", "normal", "spacious"] as const;

const DEFAULT_TYPOGRAPHY = {
  chineseFont: "system_sans",
  englishFont: "system_sans",
  bodyTextScale: "normal",
  titleTextScale: "normal",
  lineHeight: "normal"
} as const;

const DEFAULT_SPACING = {
  pageMargin: "normal",
  sectionGap: "normal",
  itemGap: "normal"
} as const;

const DEFAULT_THEME = {
  primaryColor: "emerald",
  accentColor: "emerald",
  dividerColor: "graphite",
  density: "balanced"
} as const;

const DEFAULT_PAGINATION: {
  pagePolicy: "natural";
  preferredPageCount: 1 | 2;
  maximumPageCount: 4;
  overflowBehavior: "warn" | "allow";
  headerFooter: "none" | "page_number";
  showPhoto: boolean;
  pageBreakBeforeSections: Array<z.infer<typeof ResumeRenderSectionTypeSchema>>;
} = {
  pagePolicy: "natural",
  preferredPageCount: 2,
  maximumPageCount: 4,
  overflowBehavior: "warn",
  headerFooter: "none",
  showPhoto: false,
  pageBreakBeforeSections: []
};

const ItemOrderBySectionSchema = z.object({
  summary: z.array(z.string().min(1)).optional(),
  experience: z.array(z.string().min(1)).optional(),
  skills: z.array(z.string().min(1)).optional(),
  certificates: z.array(z.string().min(1)).optional()
}).default({});

const SectionStyleOverrideSchema = z.object({
  showTitle: z.boolean().optional(),
  titleOverride: z.string().trim().min(1).max(80).optional()
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
    chineseFont?: unknown;
    englishFont?: unknown;
    bodyTextScale?: unknown;
    titleTextScale?: unknown;
    scale?: unknown;
    lineHeight?: unknown;
  };
  return {
    chineseFont: normalizeChineseFont(candidate.chineseFont),
    englishFont: normalizeEnglishFont(candidate.englishFont),
    bodyTextScale: normalizeBodyTextScale(candidate.bodyTextScale ?? candidate.scale),
    titleTextScale: normalizeTitleTextScale(candidate.titleTextScale),
    lineHeight: normalizeLineHeight(candidate.lineHeight)
  };
}, z.object({
  chineseFont: PresentationFontFamilySchema,
  englishFont: PresentationEnglishFontFamilySchema,
  bodyTextScale: PresentationBodyTextScaleSchema,
  titleTextScale: PresentationTitleTextScaleSchema,
  lineHeight: PresentationLineHeightSchema
}));

const PresentationSpacingSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_SPACING;
  }
  const candidate = value as {
    pageMargin?: unknown;
    sectionGap?: unknown;
    itemGap?: unknown;
  };
  return {
    pageMargin: normalizePageMargin(candidate.pageMargin),
    sectionGap: normalizeSpacingScale(candidate.sectionGap),
    itemGap: normalizeSpacingScale(candidate.itemGap)
  };
}, z.object({
  pageMargin: PresentationPageMarginSchema,
  sectionGap: PresentationSpacingScaleSchema,
  itemGap: PresentationSpacingScaleSchema
}));

const PresentationThemeSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_THEME;
  }
  const candidate = value as {
    primaryColor?: unknown;
    accentColor?: unknown;
    dividerColor?: unknown;
    density?: unknown;
  };
  return {
    primaryColor: normalizeAccentColor(candidate.primaryColor ?? candidate.accentColor),
    accentColor: normalizeAccentColor(candidate.accentColor),
    dividerColor: normalizeAccentColor(candidate.dividerColor ?? "graphite"),
    density: normalizeDensity(candidate.density)
  };
}, z.object({
  primaryColor: PresentationAccentColorSchema,
  accentColor: PresentationAccentColorSchema,
  dividerColor: PresentationAccentColorSchema,
  density: PresentationDensitySchema
}));

const PresentationPaginationSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object") {
    return DEFAULT_PAGINATION;
  }
  const candidate = value as {
    pagePolicy?: unknown;
    preferredPageCount?: unknown;
    maximumPageCount?: unknown;
    overflowBehavior?: unknown;
    headerFooter?: unknown;
    showPhoto?: unknown;
    pageBreakBeforeSections?: unknown;
  };
  const pagePolicy = normalizePagePolicy(candidate.pagePolicy);
  const pageBreakBeforeSections = Array.isArray(candidate.pageBreakBeforeSections)
    ? uniqueSectionTypes(candidate.pageBreakBeforeSections)
    : [];
  return {
    pagePolicy,
    preferredPageCount: candidate.preferredPageCount === 1 || candidate.preferredPageCount === 2
      ? candidate.preferredPageCount
      : pagePolicy === "prefer_one_page" ? 1 : DEFAULT_PAGINATION.preferredPageCount,
    maximumPageCount: 4,
    overflowBehavior: candidate.overflowBehavior === "allow" ? "allow" : "warn",
    headerFooter: candidate.headerFooter === "page_number" ? "page_number" : "none",
    showPhoto: candidate.showPhoto === true,
    pageBreakBeforeSections
  };
}, z.object({
  pagePolicy: ResumePagePolicySchema,
  preferredPageCount: ResumePreferredPageCountSchema,
  maximumPageCount: ResumeMaximumPageCountSchema,
  overflowBehavior: ResumeOverflowBehaviorSchema,
  headerFooter: PresentationHeaderFooterSchema,
  showPhoto: z.boolean(),
  pageBreakBeforeSections: z.array(ResumeRenderSectionTypeSchema).default([])
}));

export const ResumePresentationConfigSchema = z.object({
  schemaVersion: z.literal("resume-presentation-v1"),
  branchId: z.string().min(1),
  templateId: TemplateIdSchema,
  contentRevision: z.object({
    branchRevision: z.number().int().min(0),
    currentRevisionId: z.string().min(1)
  }),
  sectionOrder: z.array(ResumeRenderSectionTypeSchema).default([...defaultResumeRenderSectionOrder]),
  itemOrderBySection: ItemOrderBySectionSchema,
  hiddenItemIds: z.array(z.string().min(1)).default([]),
  typography: PresentationTypographySchema.default(DEFAULT_TYPOGRAPHY),
  spacing: PresentationSpacingSchema.default(DEFAULT_SPACING),
  theme: PresentationThemeSchema.default(DEFAULT_THEME),
  pagination: PresentationPaginationSchema.default(DEFAULT_PAGINATION),
  sectionStyleOverrides: SectionStyleOverridesSchema,
  highlightListStyle: PresentationHighlightListStyleSchema.default("bullet"),
  itemHeaderMiddleAlignment: PresentationItemHeaderMiddleAlignmentSchema.default("balanced"),
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

function normalizeChineseFont(value: unknown) {
  if (value === "system_sans" || value === "source_han_sans" || value === "source_han_serif") {
    return value;
  }
  return DEFAULT_TYPOGRAPHY.chineseFont;
}

function normalizeEnglishFont(value: unknown) {
  if (value === "system_sans" || value === "arial" || value === "georgia") {
    return value;
  }
  return DEFAULT_TYPOGRAPHY.englishFont;
}

function normalizePageMargin(value: unknown) {
  if (value === "narrow" || value === "normal" || value === "wide") {
    return value;
  }
  return DEFAULT_SPACING.pageMargin;
}

function normalizePagePolicy(value: unknown): z.infer<typeof ResumePagePolicySchema> {
  if (value === "natural" || value === "prefer_one_page" || value === "one_page_strict" || value === "up_to_two_pages") {
    return value;
  }
  return DEFAULT_PAGINATION.pagePolicy;
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

function uniqueSectionTypes(values: unknown[]) {
  const seen = new Set<string>();
  const result: Array<z.infer<typeof ResumeRenderSectionTypeSchema>> = [];
  for (const value of values) {
    const parsed = ResumeRenderSectionTypeSchema.safeParse(value);
    if (!parsed.success || seen.has(parsed.data)) {
      continue;
    }
    seen.add(parsed.data);
    result.push(parsed.data);
  }
  return result;
}

export type ResumePresentationConfig = z.infer<typeof ResumePresentationConfigSchema>;
export type PresentationBodyTextScale = z.infer<typeof PresentationBodyTextScaleSchema>;
export type PresentationTitleTextScale = z.infer<typeof PresentationTitleTextScaleSchema>;
export type PresentationLineHeight = z.infer<typeof PresentationLineHeightSchema>;
export type PresentationSpacingScale = z.infer<typeof PresentationSpacingScaleSchema>;
export type PresentationAccentColor = z.infer<typeof PresentationAccentColorSchema>;
export type PresentationDensity = z.infer<typeof PresentationDensitySchema>;
export type PresentationFontFamily = z.infer<typeof PresentationFontFamilySchema>;
export type PresentationEnglishFontFamily = z.infer<typeof PresentationEnglishFontFamilySchema>;
export type PresentationPageMargin = z.infer<typeof PresentationPageMarginSchema>;
export type PresentationHeaderFooter = z.infer<typeof PresentationHeaderFooterSchema>;
export type ResumePagePolicy = z.infer<typeof ResumePagePolicySchema>;
export type PresentationHighlightListStyle = z.infer<typeof PresentationHighlightListStyleSchema>;
export type PresentationItemHeaderMiddleAlignment = z.infer<typeof PresentationItemHeaderMiddleAlignmentSchema>;
