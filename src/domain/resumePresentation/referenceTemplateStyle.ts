/** Defaults for new resumes; saved presentation choices remain authoritative. */
export const REFERENCE_TEMPLATE_STYLE = {
  typography: { chineseFont: "source_han_serif", englishFont: "times_new_roman", bodyTextScale: "normal", titleTextScale: "normal", lineHeight: "tight" },
  spacing: { pageMargin: "narrow", sectionGap: "tight", itemGap: "tight" },
  theme: { primaryColor: "blue", accentColor: "blue", dividerColor: "blue", density: "compact" }
} as const;
