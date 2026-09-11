import type { CSSProperties } from "react";
import type { ResumePresentationConfig } from "@/domain/schemas";
import type { ResumeTemplateDefinition, ResumeTemplateStyleConfig } from "./types";

export const DEFAULT_TEMPLATE_STYLE_CONFIG: ResumeTemplateStyleConfig = {
  typography: {
    chineseFont: "system_sans",
    englishFont: "system_sans",
    bodyTextScale: "normal",
    titleTextScale: "normal",
    lineHeight: "normal"
  },
  spacing: {
    pageMargin: "normal",
    sectionGap: "normal",
    itemGap: "normal"
  },
  theme: {
    primaryColor: "emerald",
    accentColor: "emerald",
    dividerColor: "graphite",
    density: "balanced"
  },
  sectionStyleOverrides: {}
};

export function getTemplateDefaultStyleConfig(template: ResumeTemplateDefinition): ResumeTemplateStyleConfig {
  return cloneTemplateStyleConfig(template.defaultPresentationStyle);
}

export function cloneTemplateStyleConfig(style: ResumeTemplateStyleConfig): ResumeTemplateStyleConfig {
  return {
    typography: { ...style.typography },
    spacing: { ...style.spacing },
    theme: { ...style.theme },
    sectionStyleOverrides: { ...style.sectionStyleOverrides }
  };
}

export function resolveTemplateStyleConfig(
  template: ResumeTemplateDefinition,
  presentationConfig?: ResumePresentationConfig
): ResumeTemplateStyleConfig {
  if (!presentationConfig) {
    return cloneTemplateStyleConfig(template.defaultPresentationStyle);
  }
  return {
    typography: { ...presentationConfig.typography },
    spacing: { ...presentationConfig.spacing },
    theme: { ...presentationConfig.theme },
    sectionStyleOverrides: { ...presentationConfig.sectionStyleOverrides }
  };
}

/**
 * Converts the existing full-token config into the target template's resolved
 * style. Values equal to the source defaults are defaults, while explicit
 * user values remain overrides. This keeps the persisted schema compatible
 * without adding a second override store.
 */
export function resolveTemplateSwitchStyle(
  sourceTemplate: ResumeTemplateDefinition,
  targetTemplate: ResumeTemplateDefinition,
  currentStyle: ResumeTemplateStyleConfig
): ResumeTemplateStyleConfig {
  const source = sourceTemplate.defaultPresentationStyle;
  const target = targetTemplate.defaultPresentationStyle;
  const adoptDefault = <T>(value: T, sourceDefault: T, targetDefault: T) => value === sourceDefault ? targetDefault : value;

  return {
    typography: {
      chineseFont: adoptDefault(currentStyle.typography.chineseFont, source.typography.chineseFont, target.typography.chineseFont),
      englishFont: adoptDefault(currentStyle.typography.englishFont, source.typography.englishFont, target.typography.englishFont),
      bodyTextScale: adoptDefault(currentStyle.typography.bodyTextScale, source.typography.bodyTextScale, target.typography.bodyTextScale),
      titleTextScale: adoptDefault(currentStyle.typography.titleTextScale, source.typography.titleTextScale, target.typography.titleTextScale),
      lineHeight: adoptDefault(currentStyle.typography.lineHeight, source.typography.lineHeight, target.typography.lineHeight)
    },
    spacing: {
      pageMargin: adoptDefault(currentStyle.spacing.pageMargin, source.spacing.pageMargin, target.spacing.pageMargin),
      sectionGap: adoptDefault(currentStyle.spacing.sectionGap, source.spacing.sectionGap, target.spacing.sectionGap),
      itemGap: adoptDefault(currentStyle.spacing.itemGap, source.spacing.itemGap, target.spacing.itemGap)
    },
    theme: {
      primaryColor: adoptDefault(currentStyle.theme.primaryColor, source.theme.primaryColor, target.theme.primaryColor),
      accentColor: adoptDefault(currentStyle.theme.accentColor, source.theme.accentColor, target.theme.accentColor),
      dividerColor: adoptDefault(currentStyle.theme.dividerColor, source.theme.dividerColor, target.theme.dividerColor),
      density: adoptDefault(currentStyle.theme.density, source.theme.density, target.theme.density)
    },
    sectionStyleOverrides: { ...currentStyle.sectionStyleOverrides }
  };
}

export function resumeTemplateStyleVars(
  template: ResumeTemplateDefinition,
  presentationConfig?: ResumePresentationConfig
): CSSProperties {
  const style = resolveTemplateStyleConfig(template, presentationConfig);
  const accent = accentColorTokens(style.theme.accentColor);
  const primary = accentColorTokens(style.theme.primaryColor);
  const divider = accentColorTokens(style.theme.dividerColor);
  const density = densityTokens(style.theme.density);
  const pageMargin = pageMarginTokens(style.spacing.pageMargin);
  const bodyTextScale = bodyTextScaleTokens(style.typography.bodyTextScale);
  const titleTextScale = titleTextScaleTokens(style.typography.titleTextScale);
  const spacing = spacingTokens(style.spacing);

  return {
    "--resume-font-family": fontFamilyToken(style.typography.chineseFont, style.typography.englishFont),
    "--resume-body-font-size": bodyTextScale.fontSize,
    "--resume-line-height": lineHeightToken(style.typography.lineHeight),
    "--resume-section-title-size": titleTextScale.sectionTitleSize,
    "--resume-header-title-size": titleTextScale.headerTitleSize,
    "--resume-section-padding-top": spacing.sectionPaddingTop,
    "--resume-section-padding-bottom": spacing.sectionPaddingBottom,
    "--resume-item-gap": spacing.itemGap,
    "--resume-inline-gap-row": spacing.inlineGapRow,
    "--resume-inline-gap-column": spacing.inlineGapColumn,
    "--resume-page-padding-block": pageMargin.pagePaddingBlock,
    "--resume-page-padding-inline": pageMargin.pagePaddingInline,
    "--resume-modern-grid-gap": density.modernGridGap,
    "--resume-accent-color": accent.accent,
    "--resume-accent-strong": accent.strong,
    "--resume-accent-soft": accent.soft,
    "--resume-accent-border": accent.border,
    "--resume-bullet-color": accent.bullet,
    "--resume-primary-color": primary.accent,
    "--resume-primary-strong": primary.strong,
    "--resume-divider-color": divider.border
  } as CSSProperties;
}

function accentColorTokens(color: ResumePresentationConfig["theme"]["accentColor"]) {
  if (color === "graphite") {
    return { accent: "#202522", strong: "#111", soft: "#f0f2f0", border: "#c9cec8", bullet: "#202522" };
  }
  if (color === "blue") {
    return { accent: "#1d4f91", strong: "#143866", soft: "#edf4ff", border: "#bfd2ef", bullet: "#1d4f91" };
  }
  if (color === "rose") {
    return { accent: "#9d3151", strong: "#74213a", soft: "#fff0f4", border: "#efc1ce", bullet: "#9d3151" };
  }
  return { accent: "#0f5145", strong: "#176b5b", soft: "#eef6f3", border: "#c7ddd5", bullet: "#176b5b" };
}

function densityTokens(density: ResumePresentationConfig["theme"]["density"]) {
  if (density === "compact") return { pagePaddingBlock: "10mm", pagePaddingInline: "12mm", modernGridGap: "6mm" };
  if (density === "spacious") return { pagePaddingBlock: "14mm", pagePaddingInline: "16mm", modernGridGap: "10mm" };
  return { pagePaddingBlock: "12mm", pagePaddingInline: "14mm", modernGridGap: "8mm" };
}

function pageMarginTokens(pageMargin: ResumePresentationConfig["spacing"]["pageMargin"]) {
  if (pageMargin === "narrow") return { pagePaddingBlock: "10mm", pagePaddingInline: "12mm" };
  if (pageMargin === "wide") return { pagePaddingBlock: "16mm", pagePaddingInline: "18mm" };
  return { pagePaddingBlock: "12mm", pagePaddingInline: "14mm" };
}

function fontFamilyToken(
  chineseFont: ResumePresentationConfig["typography"]["chineseFont"],
  englishFont: ResumePresentationConfig["typography"]["englishFont"]
) {
  const chinese = chineseFont === "source_han_serif"
    ? '"Source Han Serif SC", "Noto Serif CJK SC", SimSun'
    : chineseFont === "source_han_sans"
      ? '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei"'
      : '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC"';
  const english = englishFont === "georgia" ? "Georgia" : englishFont === "arial" ? "Arial" : '"Segoe UI", Arial';
  return `${chinese}, ${english}, sans-serif`;
}

function bodyTextScaleTokens(scale: ResumePresentationConfig["typography"]["bodyTextScale"]) {
  if (scale === "small") return { fontSize: "8.8pt" };
  if (scale === "large") return { fontSize: "9.9pt" };
  return { fontSize: "9.3pt" };
}

function titleTextScaleTokens(scale: ResumePresentationConfig["typography"]["titleTextScale"]) {
  if (scale === "small") return { sectionTitleSize: "10.4pt", headerTitleSize: "20pt" };
  if (scale === "large") return { sectionTitleSize: "12pt", headerTitleSize: "22pt" };
  return { sectionTitleSize: "11.2pt", headerTitleSize: "21pt" };
}

function lineHeightToken(lineHeight: ResumePresentationConfig["typography"]["lineHeight"]) {
  if (lineHeight === "tight") return 1.34;
  if (lineHeight === "relaxed") return 1.62;
  return 1.48;
}

function spacingTokens(spacing: ResumePresentationConfig["spacing"]) {
  const section = spacing.sectionGap === "tight"
    ? { top: "3.8mm", bottom: "2.8mm" }
    : spacing.sectionGap === "relaxed"
      ? { top: "6mm", bottom: "4.8mm" }
      : { top: "5mm", bottom: "3.8mm" };
  const item = spacing.itemGap === "tight"
    ? { gap: "2mm", row: "1.5mm", column: "3mm" }
    : spacing.itemGap === "relaxed"
      ? { gap: "4mm", row: "2.8mm", column: "5mm" }
      : { gap: "3mm", row: "2mm", column: "4mm" };

  return {
    sectionPaddingTop: section.top,
    sectionPaddingBottom: section.bottom,
    itemGap: item.gap,
    inlineGapRow: item.row,
    inlineGapColumn: item.column
  };
}
