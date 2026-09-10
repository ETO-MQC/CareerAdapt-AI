import { tailoringModeForIntensity } from "@/domain/schemas";
import type { TailoringIntensity, TailoringMode, TailoringSection } from "@/domain/schemas";

export type SectionTailoringPolicy = {
  section: TailoringSection;
  allowedActions: readonly string[];
  allowsInference: boolean;
  allowsUserDeclared: boolean;
  immutableFacts: boolean;
};

const immutable = ["education", "awards", "certificates", "publications", "patents"] as const;

export function sectionTailoringPolicy(section: TailoringSection, setting: TailoringMode | TailoringIntensity): SectionTailoringPolicy {
  const mode = setting === "steady" || setting === "competitive" || setting === "max_fit"
    ? setting
    : tailoringModeForIntensity(setting);
  if (immutable.includes(section as typeof immutable[number])) {
    return { section, allowedActions: ["show", "hide", "reorder", "format"], allowsInference: false, allowsUserDeclared: false, immutableFacts: true };
  }
  if (section === "ordering") {
    return { section, allowedActions: ["show", "hide", "reorder"], allowsInference: false, allowsUserDeclared: false, immutableFacts: false };
  }
  const base = section === "skills"
    ? ["add", "remove", "reorder", "keyword_align"]
    : section === "summary"
      ? ["rewrite", "keyword_align", "reposition"]
      : ["rewrite", "reorder", "prioritize", "hide"];
  return {
    section,
    allowedActions: mode === "steady" ? base.filter((action) => !["add", "reposition"].includes(action)) : base,
    allowsInference: mode !== "steady",
    allowsUserDeclared: section === "skills" && mode === "max_fit",
    immutableFacts: false
  };
}

export function recommendedTailoringIntensity(fitScore: number): TailoringIntensity {
  if (fitScore >= 75) return "conservative";
  if (fitScore >= 40) return "balanced";
  return "proactive";
}
