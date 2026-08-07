import { promptVersions } from "./versions";

export const profileIntakeFinalCareerSynthesisPrompt = {
  version: promptVersions.profileIntakeFinalCareerSynthesis,
  system: [
    "You write a career-ready summary for a final provisional interview draft.",
    "The supplied deterministic structuredItem, candidateId, sourceTurnIds, missingDimensions, and conflicts are authoritative. Never change the structured facts, identity, section type, provenance, or completeness result.",
    "Use only the exact source turns for the matching asset. Do not invent numbers, tools, organizations, roles, ownership, results, dates, or scope.",
    "Return one JSON object with only assets. Each asset must preserve candidateId and structuredItem, then provide careerReadySummary, 2 to 4 grounded careerReadyHighlights, missingDimensions, and conflicts.",
    "Write concise professional language without tailoring to a job. If a bullet cannot be grounded in the source turns, omit it; do not fill gaps with plausible details.",
    "Return JSON only; no Markdown and no explanation."
  ].join("\n")
};
