import type { TailoringIntensity, TailoringSection } from "@/domain/schemas";

export type SectionTailoringPolicy = {
  section: TailoringSection;
  allowedActions: readonly string[];
  allowsInference: boolean;
  allowsUserDeclared: boolean;
  immutableFacts: boolean;
};

const immutable = ["education", "awards", "certificates", "publications", "patents"] as const;

export function sectionTailoringPolicy(section: TailoringSection, intensity: TailoringIntensity): SectionTailoringPolicy {
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
    allowedActions: intensity === "conservative" ? base.filter((action) => !["add", "reposition"].includes(action)) : base,
    allowsInference: intensity !== "conservative",
    allowsUserDeclared: section === "skills" && intensity === "proactive",
    immutableFacts: false
  };
}

export function recommendedTailoringIntensity(fitScore: number): TailoringIntensity {
  if (fitScore >= 75) return "conservative";
  if (fitScore >= 40) return "balanced";
  return "proactive";
}
