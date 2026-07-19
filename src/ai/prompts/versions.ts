export const promptVersions = {
  healthCheck: "health-check.v1",
  profileBuilder: "profile-builder.v1",
  jdAnalyzer: "jd-analyzer.v2",
  evidenceMatcher: "evidence-matcher.v2",
  resumeTailor: "resume-tailor.v1",
  resumeOptimizationPlanner: "resume-optimization-planner.v1",
  factGuard: "fact-guard.v1"
} as const;

export type PromptVersion = (typeof promptVersions)[keyof typeof promptVersions];
