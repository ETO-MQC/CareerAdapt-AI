export type ResumeSemanticAnchors = {
  identityFields: number;
  education: number;
  work: number;
  project: number;
  skills: number;
  bullets: number;
  unclassified: number;
};

export type ResumeSemanticEvaluation = {
  criticalIdentityRecall: number;
  experienceProjectEntityRecall: number;
  bulletRecall: number;
  unsupportedInsertions: number;
  unclassifiedCount: number;
  silentSourceBlockLoss: number;
  pass: boolean;
};

export function evaluateResumeSemanticRecall(input: {
  expected: ResumeSemanticAnchors;
  detected: ResumeSemanticAnchors;
  unsupportedInsertions: number;
  silentSourceBlockLoss: number;
}): ResumeSemanticEvaluation {
  const criticalIdentityRecall = ratio(input.detected.identityFields, input.expected.identityFields);
  const expectedEntities = input.expected.education + input.expected.work + input.expected.project;
  const detectedEntities = Math.min(input.detected.education, input.expected.education)
    + Math.min(input.detected.work, input.expected.work)
    + Math.min(input.detected.project, input.expected.project);
  const experienceProjectEntityRecall = ratio(detectedEntities, expectedEntities);
  const bulletRecall = ratio(input.detected.bullets, input.expected.bullets);
  return {
    criticalIdentityRecall,
    experienceProjectEntityRecall,
    bulletRecall,
    unsupportedInsertions: input.unsupportedInsertions,
    unclassifiedCount: input.detected.unclassified,
    silentSourceBlockLoss: input.silentSourceBlockLoss,
    pass: criticalIdentityRecall === 1
      && experienceProjectEntityRecall >= 0.95
      && bulletRecall >= 0.95
      && input.unsupportedInsertions === 0
      && input.silentSourceBlockLoss === 0
  };
}

function ratio(detected: number, expected: number) {
  if (expected <= 0) return 1;
  return Math.min(1, detected / expected);
}
