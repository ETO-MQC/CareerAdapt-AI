import { z } from "zod";

/**
 * User preferences steer wording and emphasis only. They are deliberately separate from
 * profile facts: a preference can never introduce a claim, satisfy a requirement, or reach
 * the personal profile. Keys are closed so an unknown key fails loudly instead of being
 * silently dropped by the writer.
 */
export const ResumeToneStyleSchema = z.enum([
  "concise",
  "professional",
  "technical",
  "business",
  "academic",
  "plain"
]);

export const ResumeFocusAreaSchema = z.enum([
  "project_impact",
  "technical_depth",
  "management",
  "domain_expertise",
  "innovation",
  "collaboration",
  "quantified_results"
]);

export const ResumeCompositionPreferencesSchema = z.object({
  toneStyle: ResumeToneStyleSchema.optional(),
  focusAreas: z.array(ResumeFocusAreaSchema).max(4).optional(),
  audience: z.string().trim().min(1).max(120).optional(),
  avoidJargon: z.boolean().optional()
}).strict();

export const UserPreferencesSchema = ResumeCompositionPreferencesSchema;

export type ResumeCompositionPreferences = z.infer<typeof ResumeCompositionPreferencesSchema>;
export type ResumeToneStyle = z.infer<typeof ResumeToneStyleSchema>;

export const RESUME_TONE_STYLE_LABELS: Readonly<Record<ResumeToneStyle, string>> = {
  concise: "精简，突出结论",
  professional: "正式、专业",
  technical: "技术导向，突出实现细节",
  business: "业务导向，突出价值与结果",
  academic: "学术/研究导向",
  plain: "平实直白"
};

export const RESUME_FOCUS_AREA_LABELS: Readonly<Record<z.infer<typeof ResumeFocusAreaSchema>, string>> = {
  project_impact: "项目影响力",
  technical_depth: "技术深度",
  management: "管理与协作",
  domain_expertise: "领域专业性",
  innovation: "创新",
  collaboration: "跨团队协作",
  quantified_results: "可量化结果"
};

/**
 * Renders preferences as explicit writer instructions. The wording repeats that these are
 * style directives so the writer cannot treat them as facts to assert.
 */
export function renderCompositionPreferenceDirectives(preferences?: ResumeCompositionPreferences): string[] {
  if (!preferences) return [];
  const directives: string[] = [];
  if (preferences.toneStyle) {
    directives.push(`表达风格：${RESUME_TONE_STYLE_LABELS[preferences.toneStyle]}。这是措辞要求，不得据此增加任何经历、能力或成果。`);
  }
  if (preferences.focusAreas?.length) {
    const labels = preferences.focusAreas.map((area) => RESUME_FOCUS_AREA_LABELS[area]);
    directives.push(`重点呈现：${labels.join("、")}。优先选用已有事实中能支撑这些方向的表述，不得新造证据。`);
  }
  if (preferences.audience) {
    directives.push(`目标受众：${preferences.audience}。据此调整术语深度，仍然只能使用已有事实。`);
  }
  if (preferences.avoidJargon) {
    directives.push("减少行业术语与缩写，必要时用完整表述代替。");
  }
  return directives;
}

export function parseUserPreferences(value: unknown): ResumeCompositionPreferences | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = ResumeCompositionPreferencesSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function userPreferenceRejectionReason(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = ResumeCompositionPreferencesSchema.safeParse(value);
  if (parsed.success) return undefined;
  const allowedKeys = Object.keys(ResumeCompositionPreferencesSchema.shape);
  const unknownKeys = value && typeof value === "object"
    ? Object.keys(value as Record<string, unknown>).filter((key) => !allowedKeys.includes(key))
    : [];
  if (unknownKeys.length) return `user_preferences_unknown_key:${unknownKeys.join(",")}`;
  return "user_preferences_invalid";
}
