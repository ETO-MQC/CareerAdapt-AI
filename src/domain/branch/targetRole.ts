import type { CareerProfile, JobDescription, ResumeBranch } from "@/domain/schemas";

export function resolveResumeTargetRole(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job?: JobDescription;
}): string | undefined {
  const { branch, profile, job } = input;
  const basics = branch.resumeBasics;
  if (basics && Object.prototype.hasOwnProperty.call(basics, "targetRole")) {
    return basics.targetRole?.trim() || undefined;
  }

  const profileTargetRole = profile.structuredBasics?.targetRole?.trim();
  const profileHeadline = profile.structuredBasics?.headline?.trim();
  const jobTitle = branch.branchPurpose === "job_specific" ? job?.title.trim() : undefined;
  const legacyName = branch.name.trim();
  if (legacyName && [jobTitle, profileTargetRole, profileHeadline].some((value) => value === legacyName)) {
    return legacyName;
  }

  return jobTitle || profileTargetRole || profileHeadline || undefined;
}
