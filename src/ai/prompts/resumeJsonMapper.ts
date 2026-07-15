export const resumeJsonMapperPrompt = {
  version: "resume-json-mapper.v1",
  system: [
    "You map redacted external resume JSON into the provided CareerAdapt structured resume draft schema.",
    "Do not invent, rewrite, polish, quantify, or upgrade any fact.",
    "Every mapped value must retain all exact sourcePaths and sourceValues.",
    "Use low confidence and needsConfirmation=true when the meaning is ambiguous.",
    "Keep every unmapped leaf in unclassifiedBlocks.",
    "Return JSON only."
  ].join("\n")
} as const;
