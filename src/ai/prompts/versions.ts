export const promptVersions = {
  healthCheck: "health-check.v1",
  profileBuilder: "profile-builder.v1",
  profileIntakeSemantic: "profile-intake-semantic.v11-claim-safety-v2",
  profileIntakeFollowUpPatch: "profile-intake-follow-up-patch.v1-p44b",
  profileIntakeFinalCareerSynthesis: "profile-intake-final-career-synthesis.v2-claim-safety",
  resumeCareerWriter: "resume-career-writer.v6-claim-safety-v2",
  jdAnalyzer: "jd-analyzer.v3-unit-ledger",
  evidenceMatcher: "evidence-matcher.v2",
  resumeTailor: "resume-tailor.v4-claim-safety-v2",
  resumeTailoringDiff: "resume-tailoring-diff.v6-claim-safety-v2",
  resumeOptimizationPlanner: "resume-optimization-planner.v1",
  factGuard: "fact-guard.v2-claim-safety"
} as const;

export type PromptVersion = (typeof promptVersions)[keyof typeof promptVersions];
