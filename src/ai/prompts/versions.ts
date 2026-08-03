export const promptVersions = {
  healthCheck: "health-check.v1",
  profileBuilder: "profile-builder.v1",
  profileIntakeSemantic: "profile-intake-semantic.v7-typed-resume-v2",
  jdAnalyzer: "jd-analyzer.v3-unit-ledger",
  evidenceMatcher: "evidence-matcher.v2",
  resumeTailor: "resume-tailor.v3-minimal-output",
  resumeOptimizationPlanner: "resume-optimization-planner.v1",
  factGuard: "fact-guard.v1"
} as const;

export type PromptVersion = (typeof promptVersions)[keyof typeof promptVersions];
