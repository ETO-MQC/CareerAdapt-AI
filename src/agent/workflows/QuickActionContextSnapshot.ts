import { canonicalProfileSectionCounts } from "@/domain/profile/canonicalLibrary";
import { countProfileContent, profileCountSummary } from "@/domain/profile/profileCounts";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { QuickActionContextSnapshotSchema, type QuickActionContextSnapshot } from "@/agent/contracts/quickActionContext";
import { WorkspaceRepository } from "@/services/storage/repositories";

const EMPTY_COUNTS = {
  basics: 0,
  education: 0,
  work: 0,
  internship: 0,
  project: 0,
  research: 0,
  campus: 0,
  volunteer: 0,
  skills: 0,
  certificates: 0,
  awards: 0,
  languages: 0,
  publications: 0,
  patents: 0,
  other: 0
};

/**
 * Fast, typed local preflight for quick actions. This intentionally has no
 * planner/model dependency: the planner may narrate later, but it cannot
 * decide which facts or buttons are available here.
 */
export async function buildQuickActionContextSnapshot(
  repository = new WorkspaceRepository(),
  session?: AgentSession
): Promise<QuickActionContextSnapshot> {
  const [context, persons, profiles, resumes, jobs] = await Promise.all([
    repository.getActiveCareerContext(),
    repository.listCareerPersons(),
    repository.listProfiles(),
    repository.listResumeBranches(),
    repository.listJobDescriptions()
  ]);
  const targetPersonId = session?.personId ?? context?.personId;
  const targetProfileId = session?.activeProfileId ?? context?.profileId;
  const activeProfile = targetProfileId && targetPersonId
    ? profiles.find((profile) => profile.id === targetProfileId && profile.personId === targetPersonId && !profile.archivedAt && !profile.trashedAt)
    : undefined;
  const activePerson = targetPersonId
    ? persons.find((person) => person.id === targetPersonId && !person.trashedAt)
    : undefined;
  const counts = activeProfile ? canonicalProfileSectionCounts(activeProfile) : new Map<string, number>();
  const profileCountsBySection: Record<string, number> = { ...EMPTY_COUNTS };
  counts.forEach((count, section) => {
    profileCountsBySection[section] = count;
  });
  const profileContentCounts = activeProfile ? countProfileContent(activeProfile) : countProfileContentEmpty();
  const activeResumeBranches = resumes.filter((branch) => !branch.lifecycleStatus || branch.lifecycleStatus === "active");
  const samePersonProfileIds = new Set(profiles.filter((profile) => profile.personId === targetPersonId && profile.id !== targetProfileId && !profile.trashedAt).map((profile) => profile.id));
  const toResumeSummary = (branch: typeof resumes[number]) => ({
    id: branch.id,
    profileId: branch.profileId,
    name: branch.name,
    purpose: branch.branchPurpose,
    revision: branch.revision,
    updatedAt: branch.updatedAt
  });
  const activeProfileResumeSummaries = activeProfile
    ? activeResumeBranches.filter((branch) => branch.profileId === activeProfile.id).map(toResumeSummary)
    : [];
  const samePersonOtherVersionResumeSummaries = activeResumeBranches
    .filter((branch) => samePersonProfileIds.has(branch.profileId))
    .map(toResumeSummary);
  const excludedOtherPersonResumeCount = activeResumeBranches.length - activeProfileResumeSummaries.length - samePersonOtherVersionResumeSummaries.length;
  const activeTaskSummary = session
    ? {
        sessionId: session.id,
        title: session.title,
        status: session.pendingConfirmation
          ? "waiting_for_confirmation" as const
          : session.activeTurn?.status === "running"
            ? "running" as const
            : session.taskState?.completionStatus === "waiting_for_user"
              ? "waiting_for_user" as const
              : session.taskState?.completionStatus === "failed"
                ? "failed" as const
                : session.workflowState.status === "paused"
                  ? "paused" as const
                  : session.activeTurn?.status === "completed"
                    ? "completed" as const
                    : "idle" as const,
        pinnedPersonId: session.personId,
        pinnedProfileId: session.activeProfileId
      }
    : undefined;
  return QuickActionContextSnapshotSchema.parse({
    activePerson: activePerson ? {
      id: activePerson.id,
      displayName: activePerson.displayName,
      currentProfileId: activePerson.currentProfileId
    } : undefined,
    activeProfile: activeProfile ? {
      id: activeProfile.id,
      personId: activeProfile.personId,
      displayName: activeProfile.profileVersionLabel?.trim() || activeProfile.name,
      profileVersionNumber: activeProfile.profileVersionNumber ?? context?.profileVersionNumber ?? 1,
      profileVersionLabel: activeProfile.profileVersionLabel,
      profileRevision: activeProfile.version,
      createdAt: activeProfile.createdAt,
      itemCount: profileContentCounts.careerItemCount,
      basicFieldCount: profileContentCounts.basicFieldCount,
      careerItemCount: profileContentCounts.careerItemCount,
      confirmedFactCount: profileContentCounts.confirmedFactCount,
      resumeCount: activeProfileResumeSummaries.length,
      profileCountsBySection
    } : undefined,
    profileVersionNumber: activeProfile?.profileVersionNumber ?? context?.profileVersionNumber,
    profileRevision: activeProfile?.version ?? context?.profileRevision,
    profileCountsBySection,
    profileItemCount: profileContentCounts.careerItemCount,
    basicFieldCount: profileContentCounts.basicFieldCount,
    careerItemCount: profileContentCounts.careerItemCount,
    confirmedFactCount: profileContentCounts.confirmedFactCount,
    resumeCount: activeProfileResumeSummaries.length,
    targetPersonId,
    targetProfileId,
    excludedOtherPersonResumeCount,
    activeProfileResumeSummaries,
    samePersonOtherVersionResumeSummaries,
    // Compatibility field: it contains only the target Person's branches.
    resumeSummaries: [...activeProfileResumeSummaries, ...samePersonOtherVersionResumeSummaries],
    jobSummaries: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      updatedAt: job.updatedAt
    })),
    activeTaskSummary
  });
}

function countProfileContentEmpty() {
  return { basicFieldCount: 0, careerItemCount: 0, confirmedFactCount: 0, resumeCount: 0 };
}

export function quickActionProfileLabel(snapshot: QuickActionContextSnapshot) {
  if (!snapshot.activePerson || !snapshot.activeProfile) return undefined;
  return `${snapshot.activePerson.displayName} · V${snapshot.activeProfile.profileVersionNumber}`;
}

export function quickActionSectionCount(snapshot: QuickActionContextSnapshot, section: string) {
  return snapshot.profileCountsBySection[section] ?? 0;
}

export function quickActionProfileCountSummary(snapshot: QuickActionContextSnapshot) {
  return profileCountSummary(snapshot);
}
