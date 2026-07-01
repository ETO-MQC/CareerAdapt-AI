export const promptVersions = {
  healthCheck: "health-check.v1",
  profileBuilder: "profile-builder.v1",
  jdAnalyzer: "jd-analyzer.v1",
  evidenceMatcher: "evidence-matcher.v1",
  resumeTailor: "resume-tailor.v1",
  factGuard: "fact-guard.v1"
} as const;

export type PromptVersion = (typeof promptVersions)[keyof typeof promptVersions];
