import { buildCareerIntelligence, buildProfileCareerIntelligence, capabilityGapView } from "@/domain/jobOptimization/careerIntelligence";
import { recallEvidenceCandidates } from "@/domain/jobOptimization/v2/evidence";
import { evaluateRuleMatch, recallCandidatesForRequirement, createRuleRequirementMatches } from "@/domain/match/matcher";
import { factMaturityOf } from "@/domain/profile/factMaturity";
import { createBranchSnapshot } from "@/domain/branch/revision";
import type { CareerProfile, ResumeBranch, JobDescription } from "@/domain/schemas";
export function traceSqlAcceptance(input: { profile: CareerProfile; branch: ResumeBranch; job: JobDescription }) {
  const requirement = input.job.requirements.find(row => row.id === "req-sql-reporting")!;
  const legacyCandidates = recallCandidatesForRequirement(input.profile, requirement);
  const profileAnalysis = buildProfileCareerIntelligence(input);
  const resumeAnalysis = buildCareerIntelligence(input);
  const extract = (analysis: ReturnType<typeof buildCareerIntelligence>) => ({ binding: analysis.candidateEvidenceMatrix.binding,
    graph: analysis.graph, evidenceUnits: analysis.evidenceUnits, recalls: recallEvidenceCandidates(analysis),
    evaluations: analysis.matrix, candidateEvidenceMatrix: analysis.candidateEvidenceMatrix, jobFit: analysis.jobFit,
    gapView: capabilityGapView(analysis, requirement.id) });
  return { profileSnapshot: input.profile, branchSnapshot: input.branch, rawJob: input.job, profileId: input.profile.id, profileVersion: input.profile.version,
    facts: [...input.profile.experiences.flatMap(row => row.facts), ...input.profile.skills.flatMap(row => row.fact ? [row.fact] : []), ...input.profile.certificates.flatMap(row => row.fact ? [row.fact] : [])].map(fact => ({ ...fact, resolvedMaturity: factMaturityOf(fact) })),
    branch: { id: input.branch.id, revision: input.branch.revision, currentRevisionId: input.branch.currentRevisionId, snapshot: createBranchSnapshot(input.branch) },
    legacy: { candidates: legacyCandidates, evaluation: evaluateRuleMatch(requirement, legacyCandidates) },
    profileAnalysis: extract(profileAnalysis), resumeAnalysis: extract(resumeAnalysis),
    formalProfileMatches: createRuleRequirementMatches({ profile: input.profile, job: input.job }),
    formalResumeMatches: createRuleRequirementMatches(input) };
}
