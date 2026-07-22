import {
  type ApplicationRecord,
  type BranchContentItem,
  type CareerProfile,
  type ExportRecord,
  type JobDescription,
  type JobRequirement,
  type HiddenSignal,
  type VerificationMaterial,
  type MatchEvidenceRef,
  type RequirementBlockMatch,
  type RequirementMatch,
  type ResumeBranch,
  type ResumeRevision
} from "@/domain/schemas";
import { resolveBranchFactRefs } from "@/domain/branch/validation";
import { buildCanonicalJobRequirementGraphV3, buildRequirementBlockMatches, computeRequirementsHash } from "@/domain/jobOptimization";

export type ApplicationPreparationResumeBlock = {
  id: string;
  itemType: BranchContentItem["itemType"];
  text: string;
  originalText: string;
  evidenceRefs: MatchEvidenceRef[];
};

export type ApplicationPreparationContext = {
  applicationId: string;
  profileId: string;
  jobId: string;
  branchId: string;
  revisionId: string;
  branchRevision: number;
  presentationRevision: number;
  requirementsHash: string;
  exportRecordId?: string;
  hasSuccessfulPdf: boolean;
  candidateName: string;
  jobTitle: string;
  company?: string;
  requirements: JobRequirement[];
  verificationMaterials: VerificationMaterial[];
  hiringSignals: HiddenSignal[];
  resumeBlocks: ApplicationPreparationResumeBlock[];
  evidenceRefs: MatchEvidenceRef[];
  requirementBlockMatches: RequirementBlockMatch[];
  sourceTextBaseline: string;
};

export function buildApplicationPreparationContext(input: {
  application: ApplicationRecord;
  profile: CareerProfile;
  job: JobDescription;
  branch: ResumeBranch;
  selectedRevision: ResumeRevision;
  requirementMatches: RequirementMatch[];
  exportRecord?: ExportRecord;
}): ApplicationPreparationContext {
  const branchFromSelectedRevision = {
    ...input.branch,
    revision: input.application.selectedBranchRevision,
    currentRevisionId: input.selectedRevision.id,
    name: input.selectedRevision.snapshot.name,
    lifecycleStatus: input.selectedRevision.snapshot.lifecycleStatus,
    resumeBasics: input.selectedRevision.snapshot.resumeBasics,
    contentItems: input.selectedRevision.snapshot.contentItems
  };
  const requirementsHash = computeRequirementsHash({
    job: input.job,
    matches: input.requirementMatches
  });
  const requirementBlockMatches = buildRequirementBlockMatches({
    profile: input.profile,
    job: input.job,
    branch: branchFromSelectedRevision,
    matches: input.requirementMatches
  });
  const resumeBlocks = branchFromSelectedRevision.contentItems
    .filter((item) => item.itemType !== "structural")
    .map((item) => ({
      id: item.id,
      itemType: item.itemType,
      text: item.text,
      originalText: item.originalText,
      evidenceRefs: safeResolveEvidenceRefs(input.profile, item.factRefs)
    }));
  const evidenceRefs = uniqueEvidenceRefs(resumeBlocks.flatMap((block) => block.evidenceRefs));
  const graph = buildCanonicalJobRequirementGraphV3(input.job);
  const sourceTextBaseline = [
    input.job.title,
    input.job.company,
    ...resumeBlocks.map((block) => block.text)
  ].filter(Boolean).join("\n");

  return {
    applicationId: input.application.id,
    profileId: input.application.profileId,
    jobId: input.application.jobId,
    branchId: input.application.jobSpecificBranchId,
    revisionId: input.application.selectedRevisionId,
    branchRevision: input.application.selectedBranchRevision,
    presentationRevision: input.application.selectedPresentationRevision,
    requirementsHash,
    exportRecordId: input.application.selectedExportRecordId,
    hasSuccessfulPdf: Boolean(input.exportRecord),
    candidateName: input.profile.basics.name,
    jobTitle: input.job.title,
    company: input.job.company,
    requirements: input.job.requirements,
    verificationMaterials: graph.verificationMaterials,
    hiringSignals: graph.roleProfile.hiringSignals,
    resumeBlocks,
    evidenceRefs,
    requirementBlockMatches,
    sourceTextBaseline
  };
}

function safeResolveEvidenceRefs(profile: CareerProfile, factRefs: BranchContentItem["factRefs"]) {
  try {
    return resolveBranchFactRefs(profile, factRefs);
  } catch {
    return [];
  }
}

function uniqueEvidenceRefs(refs: MatchEvidenceRef[]) {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = JSON.stringify(ref);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
