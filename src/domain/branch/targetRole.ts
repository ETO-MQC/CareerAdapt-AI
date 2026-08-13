import type { CareerProfile, JobDescription, ResumeBranch } from "@/domain/schemas";

export function resolveResumeTargetRole(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job?: JobDescription;
}): string | undefined {
  const { branch, profile, job } = input;
  const basics = branch.resumeBasics;
  const branchLocalRole = basics?.targetRole?.trim() || undefined;
  if (branch.branchPurpose === "general") {
    // General branches are presentation artifacts, not mirrors of the
    // profile's historical headline/targetRole. Only a branch-local direction
    // (for example composition.targetDirection) is allowed here.
    const historicalProfileRoles = [
      profile.structuredBasics?.targetRole?.trim(),
      profile.structuredBasics?.headline?.trim()
    ].filter((value): value is string => Boolean(value));
    return branchLocalRole && !historicalProfileRoles.includes(branchLocalRole)
      ? branchLocalRole
      : undefined;
  }
  // The bound Job is authoritative for a job branch unless the user has
  // explicitly edited the branch-local target role.
  return branchLocalRole || job?.title.trim() || undefined;
}
