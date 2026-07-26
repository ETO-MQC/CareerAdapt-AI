export type SourceRouteSignals = {
  profileEvidenceRichness: number;
  resumeMaturity: number;
  profileJobRelevance: number;
  resumeJobRelevance: number;
  profileProvenanceCoverage: number;
  resumeProvenanceCoverage: number;
  resumeRecency: number;
  profileMissingData: number;
  resumeMissingData: number;
};

export type SourceRouteRecommendation = {
  route: "profile_to_job_resume" | "existing_resume_tailoring";
  profileScore: number;
  resumeScore: number;
  reasons: string[];
};

export function recommendSourceRoute(signals: SourceRouteSignals): SourceRouteRecommendation {
  const profileScore = score(
    signals.profileEvidenceRichness * 0.3
    + signals.profileJobRelevance * 0.3
    + signals.profileProvenanceCoverage * 0.25
    - signals.profileMissingData * 0.15
  );
  const resumeScore = score(
    signals.resumeMaturity * 0.3
    + signals.resumeJobRelevance * 0.3
    + signals.resumeProvenanceCoverage * 0.2
    + signals.resumeRecency * 0.15
    - signals.resumeMissingData * 0.15
  );
  const route = profileScore > resumeScore + 0.03
    ? "profile_to_job_resume"
    : "existing_resume_tailoring";
  const reasons = route === "profile_to_job_resume"
    ? [
        "资料库中可追溯事实更丰富，适合按岗位重新选择内容。",
        "从资料库生成仍会经过 Fact Guard，且不会覆盖通用简历。"
      ]
    : [
        "现有简历成熟度和岗位相关覆盖更高，适合做最小定向调整。",
        "改写会创建独立岗位 Revision，不会覆盖原简历。"
      ];
  return { route, profileScore, resumeScore, reasons };
}

function score(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}
