import {
  type BranchFactRef,
  type BranchSyncStatus,
  type CareerProfile,
  type FactGuardFinding,
  type FactStatement,
  type JobDescription,
  type MatchEvidenceRef,
  type ResumeBranch
} from "@/domain/schemas";
import { getJobVersion } from "@/domain/match/matcher";

export class BranchValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BranchValidationError";
  }
}

export function branchFactRefKey(ref: BranchFactRef) {
  if (ref.type === "experience_fact") {
    return `${ref.type}:${ref.experienceId}:${ref.factId}`;
  }
  if (ref.type === "skill_fact") {
    return `${ref.type}:${ref.skillId}:${ref.factId}`;
  }
  if (ref.type === "certificate_fact") {
    return `${ref.type}:${ref.certificateId}:${ref.factId}`;
  }
  return `${ref.type}:${ref.evidenceId}:${ref.linkedFactId}`;
}

export function toBranchFactRef(ref: MatchEvidenceRef): BranchFactRef {
  if (ref.type === "experience_fact") {
    return {
      type: "experience_fact",
      experienceId: ref.experienceId,
      factId: ref.factId
    };
  }
  if (ref.type === "skill_fact") {
    return {
      type: "skill_fact",
      skillId: ref.skillId,
      factId: ref.factId
    };
  }
  if (ref.type === "certificate_fact") {
    return {
      type: "certificate_fact",
      certificateId: ref.certificateId,
      factId: ref.factId
    };
  }
  return {
    type: "evidence_file",
    evidenceId: ref.evidenceId,
    linkedFactId: ref.linkedFactId
  };
}

export function resolveBranchFactRefs(profile: CareerProfile, factRefs: BranchFactRef[]): MatchEvidenceRef[] {
  return factRefs.map((ref) => resolveBranchFactRef(profile, ref));
}

export function resolveBranchFactRef(profile: CareerProfile, ref: BranchFactRef): MatchEvidenceRef {
  if (ref.type === "experience_fact") {
    const experience = profile.experiences.find((item) => item.id === ref.experienceId);
    const fact = experience?.facts.find((item) => item.id === ref.factId);
    if (!fact || !isConfirmedFact(fact)) {
      throw new BranchValidationError("branch_experience_fact_missing_or_unconfirmed");
    }
    return {
      type: "experience_fact",
      experienceId: ref.experienceId,
      factId: ref.factId,
      factQuote: primarySourceText(fact),
      factText: fact.statement
    };
  }

  if (ref.type === "skill_fact") {
    const skill = profile.skills.find((item) => item.id === ref.skillId);
    const fact = skill?.fact;
    if (!fact || fact.id !== ref.factId || !isConfirmedFact(fact)) {
      throw new BranchValidationError("branch_skill_fact_missing_or_unconfirmed");
    }
    return {
      type: "skill_fact",
      skillId: ref.skillId,
      factId: ref.factId,
      factQuote: primarySourceText(fact),
      factText: fact.statement
    };
  }

  if (ref.type === "certificate_fact") {
    const certificate = profile.certificates.find((item) => item.id === ref.certificateId);
    const fact = certificate?.fact;
    if (!fact || fact.id !== ref.factId || !isConfirmedFact(fact)) {
      throw new BranchValidationError("branch_certificate_fact_missing_or_unconfirmed");
    }
    return {
      type: "certificate_fact",
      certificateId: ref.certificateId,
      factId: ref.factId,
      factQuote: primarySourceText(fact),
      factText: fact.statement
    };
  }

  const evidence = profile.evidences.find((item) => item.id === ref.evidenceId);
  const linkedFact = findConfirmedFact(profile, ref.linkedFactId);
  if (!evidence || !linkedFact) {
    throw new BranchValidationError("branch_evidence_file_or_linked_fact_missing");
  }
  return {
    type: "evidence_file",
    evidenceId: ref.evidenceId,
    linkedFactId: ref.linkedFactId,
    factQuote: primarySourceText(linkedFact),
    factText: linkedFact.statement
  };
}

export function collectInvalidFactRefKeys(profile: CareerProfile, factRefs: BranchFactRef[]) {
  const invalid: string[] = [];
  for (const ref of factRefs) {
    try {
      resolveBranchFactRef(profile, ref);
    } catch {
      invalid.push(branchFactRefKey(ref));
    }
  }
  return invalid;
}

export function computeBranchSyncStatus(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job: JobDescription;
  now?: string;
}): BranchSyncStatus {
  const now = input.now ?? new Date().toISOString();
  const allFactRefs = input.branch.contentItems.flatMap((item) => item.factRefs);
  const invalidFactRefs = collectInvalidFactRefKeys(input.profile, allFactRefs);
  const profileChanged = input.branch.sourceProfileVersion !== input.profile.version;
  const jobVersion = getJobVersion(input.job);
  const jobChanged = input.branch.sourceJobVersion !== jobVersion;

  let status: BranchSyncStatus["status"] = "in_sync";
  if (invalidFactRefs.length > 0) {
    status = "invalid_reference";
  } else if (profileChanged && jobChanged) {
    status = "profile_and_job_updated";
  } else if (profileChanged) {
    status = "profile_updated";
  } else if (jobChanged) {
    status = "job_updated";
  }

  return {
    status,
    sourceProfileVersion: input.branch.sourceProfileVersion,
    currentProfileVersion: input.profile.version,
    sourceJobVersion: input.branch.sourceJobVersion,
    currentJobVersion: jobVersion,
    invalidFactRefs,
    checkedAt: now,
    message: syncStatusMessage(status, invalidFactRefs.length)
  };
}

export function computeGeneralBranchSyncStatus(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  now?: string;
}): BranchSyncStatus {
  const now = input.now ?? new Date().toISOString();
  const allFactRefs = input.branch.contentItems.flatMap((item) => item.factRefs);
  const invalidFactRefs = collectInvalidFactRefKeys(input.profile, allFactRefs);
  const profileChanged = input.branch.sourceProfileVersion !== input.profile.version;
  const status: BranchSyncStatus["status"] = invalidFactRefs.length > 0
    ? "invalid_reference"
    : profileChanged
      ? "profile_updated"
      : "in_sync";

  return {
    status,
    sourceProfileVersion: input.branch.sourceProfileVersion,
    currentProfileVersion: input.profile.version,
    invalidFactRefs,
    checkedAt: now,
    message: syncStatusMessage(status, invalidFactRefs.length)
  };
}

export function assertNoHighGuardFindings(findings: Array<Pick<FactGuardFinding, "severity" | "allowed">>) {
  if (findings.some((finding) => finding.severity === "high" && !finding.allowed)) {
    throw new BranchValidationError("branch_high_guard_finding_blocked");
  }
}

function syncStatusMessage(status: BranchSyncStatus["status"], invalidCount: number) {
  if (status === "invalid_reference") {
    return `Branch has ${invalidCount} invalid fact reference(s).`;
  }
  if (status === "profile_and_job_updated") {
    return "Career profile and job have updates. Branch content was not automatically changed.";
  }
  if (status === "profile_updated") {
    return "Career profile has updates. Branch content was not automatically changed.";
  }
  if (status === "job_updated") {
    return "Job description has updates. Branch content was not automatically changed.";
  }
  return "Branch is in sync with its source profile and job versions.";
}

function isConfirmedFact(fact: FactStatement) {
  return fact.confirmedByUser && fact.riskLevel !== "high" && fact.provenance.some((item) => item.confirmedByUser);
}

function primarySourceText(fact: FactStatement) {
  return fact.provenance[0]?.sourceText || fact.statement;
}

function findConfirmedFact(profile: CareerProfile, factId: string) {
  for (const experience of profile.experiences) {
    const fact = experience.facts.find((item) => item.id === factId);
    if (fact && isConfirmedFact(fact)) {
      return fact;
    }
  }

  const skillFact = profile.skills.find((item) => item.fact?.id === factId)?.fact;
  if (skillFact && isConfirmedFact(skillFact)) {
    return skillFact;
  }

  const certificateFact = profile.certificates.find((item) => item.fact?.id === factId)?.fact;
  if (certificateFact && isConfirmedFact(certificateFact)) {
    return certificateFact;
  }

  return undefined;
}
