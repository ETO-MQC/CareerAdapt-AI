export const promptVersions = {
  healthCheck: "health-check.v1",
  profileBuilder: "profile-builder.v1",
  profileIntakeSemantic: "profile-intake-semantic.v10-p43j-semantic-v3",
  profileIntakeFollowUpPatch: "profile-intake-follow-up-patch.v1-p44b",
  profileIntakeFinalCareerSynthesis: "profile-intake-final-career-synthesis.v1",
  resumeCareerWriter: "resume-career-writer.v3-context-execution",
  jdAnalyzer: "jd-analyzer.v3-unit-ledger",
  evidenceMatcher: "evidence-matcher.v2",
  resumeTailor: "resume-tailor.v3-minimal-output",
  resumeOptimizationPlanner: "resume-optimization-planner.v1",
  factGuard: "fact-guard.v1"
} as const;

export type PromptVersion = (typeof promptVersions)[keyof typeof promptVersions];
