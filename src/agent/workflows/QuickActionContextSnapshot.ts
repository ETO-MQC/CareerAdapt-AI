import { canonicalProfileLibraryItems, canonicalProfileSectionCounts } from "@/domain/profile/canonicalLibrary";
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
  const activeProfile = context
    ? profiles.find((profile) => profile.id === context.profileId && profile.personId === context.personId && !profile.archivedAt)
    : undefined;
  const activePerson = context
    ? persons.find((person) => person.id === context.personId)
    : undefined;
  const counts = activeProfile ? canonicalProfileSectionCounts(activeProfile) : new Map<string, number>();
  const profileCountsBySection: Record<string, number> = { ...EMPTY_COUNTS };
  counts.forEach((count, section) => {
    profileCountsBySection[section] = count;
  });
  const profileItemCount = activeProfile ? canonicalProfileLibraryItems(activeProfile).length : 0;
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
      itemCount: profileItemCount,
      profileCountsBySection
    } : undefined,
    profileVersionNumber: activeProfile?.profileVersionNumber ?? context?.profileVersionNumber,
    profileRevision: activeProfile?.version ?? context?.profileRevision,
    profileCountsBySection,
    profileItemCount,
    resumeSummaries: resumes
      .filter((branch) => !branch.lifecycleStatus || branch.lifecycleStatus === "active")
      .map((branch) => ({
        id: branch.id,
        profileId: branch.profileId,
        name: branch.name,
        purpose: branch.branchPurpose,
        revision: branch.revision,
        updatedAt: branch.updatedAt
      })),
    jobSummaries: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      company: job.company,
      updatedAt: job.updatedAt
    })),
    activeTaskSummary
  });
}

export function quickActionProfileLabel(snapshot: QuickActionContextSnapshot) {
  if (!snapshot.activePerson || !snapshot.activeProfile) return undefined;
  return `${snapshot.activePerson.displayName} · V${snapshot.activeProfile.profileVersionNumber}`;
}

export function quickActionSectionCount(snapshot: QuickActionContextSnapshot, section: string) {
  return snapshot.profileCountsBySection[section] ?? 0;
}
