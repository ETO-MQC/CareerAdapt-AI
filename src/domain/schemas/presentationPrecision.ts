import { z } from "zod";

const bounded = (min: number, max: number) => z.number().finite().min(min).max(max).optional();
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/).optional();
/** Optional overrides: absent fields retain the selected template's existing behavior. */
export const PresentationPrecisionSchema = z.object({
  fontSizePx: bounded(9, 24), lineHeight: bounded(1, 2.4), letterSpacingPx: bounded(-0.5, 3), sectionGapPx: bounded(0, 40),
  nameScale: bounded(0.8, 3), sectionScale: bounded(0.7, 2), contactScale: bounded(0.6, 1.5),
  descriptionScale: bounded(0.7, 1.5), entryScale: bounded(0.7, 1.6), targetScale: bounded(0.7, 1.6),
  primaryColor: color, accentColor: color, dividerColor: color, titleFollowColor: z.boolean().optional(),
  titleStyle: z.enum(["plain", "underline", "tint"]).optional(), entryStyle: z.enum(["inline", "stacked"]).optional(),
  linkStyle: z.enum(["plain", "accent", "underline"]).optional(),
  bulletStyle: z.enum(["disc", "circle", "square", "dash", "decimal", "none"]).optional(),
  bulletScale: bounded(0.5, 2), underlineWidth: bounded(0.5, 4), titleBar: z.boolean().optional(),
  neutralDividers: z.boolean().optional(), contactIcons: z.boolean().optional(),
  marginTopMm: bounded(0, 35), marginRightMm: bounded(0, 35), marginBottomMm: bounded(0, 35), marginLeftMm: bounded(0, 35),
  headerLayout: z.enum(["left", "center", "split"]).optional(), verticalAlign: z.enum(["top", "center", "bottom"]).optional(),
  contactOffsetX: bounded(-24, 24), contactOffsetY: bounded(-24, 24), headerHeightPx: bounded(0, 180), headerGapPx: bounded(0, 48)
}).strict();
export type PresentationPrecision = z.infer<typeof PresentationPrecisionSchema>;
