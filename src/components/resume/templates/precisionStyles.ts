import type { CSSProperties } from "react";
import type { ResumePresentationConfig } from "@/domain/schemas";
import type { PresentationPrecision } from "@/domain/schemas/presentationPrecision";

export function resolvedPrecision(config: ResumePresentationConfig) {
  const body = ({ small: 8.8, normal: 9.3, large: 9.9 }[config.typography.bodyTextScale]) * 4 / 3 * (config.templateId === "campus-reference" ? 1.1 : 1);
  const colors = { graphite: "#202522", emerald: "#0f5145", blue: "#1d4f91", rose: "#9d3151" };
  const margin = { narrow: [10, 12], normal: [12, 14], wide: [16, 18] }[config.spacing.pageMargin];
  return {
    fontSizePx: Number(body.toFixed(2)), lineHeight: { tight: 1.34, normal: 1.48, relaxed: 1.62 }[config.typography.lineHeight],
    letterSpacingPx: 0, sectionGapPx: { tight: 14.36, normal: 18.9, relaxed: 22.68 }[config.spacing.sectionGap],
    nameScale: 2.26, sectionScale: 1.2, contactScale: 0.95, descriptionScale: 1, entryScale: 1, targetScale: 1.07,
    primaryColor: colors[config.theme.primaryColor], accentColor: colors[config.theme.accentColor], dividerColor: "#c9cec8",
    titleFollowColor: true, titleStyle: "plain" as const, entryStyle: "inline" as const, linkStyle: "underline" as const,
    bulletStyle: config.highlightListStyle === "numbered" ? "decimal" as const : config.highlightListStyle === "none" ? "none" as const : "disc" as const,
    bulletScale: 1, underlineWidth: 1, titleBar: false, neutralDividers: false, contactIcons: false,
    marginTopMm: margin[0], marginRightMm: margin[1], marginBottomMm: margin[0], marginLeftMm: margin[1],
    headerLayout: "split" as const, verticalAlign: "top" as const, contactOffsetX: 0, contactOffsetY: 0, headerHeightPx: 0, headerGapPx: 0,
    ...config.precision
  };
}

export function precisionAttrs(config?: ResumePresentationConfig) {
  const p = config?.precision;
  return {
    "data-precision-title": p?.titleStyle, "data-precision-entry": p?.entryStyle,
    "data-precision-link": p?.linkStyle, "data-precision-bullet": p?.bulletStyle,
    "data-precision-header": p?.headerLayout, "data-precision-align": p?.verticalAlign,
    "data-precision-bar": p?.titleBar === undefined ? undefined : p.titleBar ? "on" : "off"
  };
}

export function precisionStyleVars(config?: ResumePresentationConfig): CSSProperties {
  if (!config?.precision) return {};
  const p = config.precision;
  const effective = resolvedPrecision(config);
  const vars: Record<string, string | number> = {};
  const pxFields: Array<[keyof PresentationPrecision, string]> = [
    ["fontSizePx", "--resume-body-font-size"], ["letterSpacingPx", "--resume-letter-spacing"],
    ["sectionGapPx", "--resume-section-padding-top"], ["underlineWidth", "--resume-underline-width"],
    ["contactOffsetX", "--resume-contact-x"], ["contactOffsetY", "--resume-contact-y"],
    ["headerHeightPx", "--resume-header-height"], ["headerGapPx", "--resume-header-gap"]
  ];
  for (const [key, css] of pxFields) if (p[key] !== undefined) vars[css] = `${p[key]}px`;
  if (p.sectionGapPx !== undefined) { vars["--resume-section-padding-bottom"] = "0px"; vars["--resume-precision-section-gap"] = `${p.sectionGapPx}px`; }
  if (p.lineHeight !== undefined) vars["--resume-line-height"] = p.lineHeight;
  if (p.bulletScale !== undefined) vars["--resume-bullet-scale"] = p.bulletScale;
  for (const [key, css] of [["nameScale", "name"], ["sectionScale", "section"], ["contactScale", "contact"], ["descriptionScale", "description"], ["entryScale", "entry"], ["targetScale", "target"]] as const) {
    if (p[key] !== undefined || p.fontSizePx !== undefined) vars[`--resume-${css}-size`] = `${effective.fontSizePx * effective[key]}px`;
  }
  for (const side of ["Top", "Right", "Bottom", "Left"] as const) {
    const value = p[`margin${side}Mm`];
    if (value !== undefined) vars[`--resume-margin-${side.toLowerCase()}`] = `${value}mm`;
  }
  if (p.primaryColor) { vars["--resume-primary-color"] = p.primaryColor; vars["--resume-primary-strong"] = p.primaryColor; }
  if (p.accentColor) { vars["--resume-accent-color"] = p.accentColor; vars["--resume-accent-strong"] = p.accentColor; vars["--resume-bullet-color"] = p.accentColor; }
  if (p.dividerColor) vars["--resume-divider-color"] = p.dividerColor;
  if (p.neutralDividers) vars["--resume-divider-color"] = "#c9c8c3";
  if (p.titleFollowColor !== undefined || p.primaryColor !== undefined) vars["--resume-heading-color"] = effective.titleFollowColor ? effective.primaryColor : "#202522";
  return vars as CSSProperties;
}
