import type { CareerSessionBinding } from "./careerSessionBinding";

export type CareerContextBindingState = "unbound" | "partially_bound" | "bound";

export type CareerProfileCandidate = {
  id: string;
  personId?: string;
  profileVersionNumber?: number;
  profileRevision?: number;
  version?: number;
  isCurrent?: boolean;
  archivedAt?: unknown;
  trashedAt?: unknown;
  experienceCount?: number;
  skillCount?: number;
  certificateCount?: number;
  items?: unknown[];
  sectionCounts?: Record<string, unknown>;
  [key: string]: unknown;
};

export type CareerProfileResolution =
  | {
      state: "bound";
      source: "pinned" | "requested" | "active" | "single";
      profile: CareerProfileCandidate;
      binding?: CareerSessionBinding;
    }
  | {
      state: "partially_bound";
      code: "needs_profile_choice";
      candidates: CareerProfileCandidate[];
      userPrompt: string;
    }
  | {
      state: "unbound";
      code: "needs_profile";
      candidates: CareerProfileCandidate[];
      userPrompt: string;
    };

export type CareerResumeCandidate = {
  id: string;
  profileId?: string;
  purpose?: string;
  branchPurpose?: string;
  lifecycleStatus?: string;
  migrationStatus?: string;
  [key: string]: unknown;
};

export type CareerResumeSourceResolution =
  | { kind: "selected"; resume: CareerResumeCandidate; source: "requested" | "single_general" }
  | { kind: "choice"; candidates: CareerResumeCandidate[]; userPrompt: string }
  | { kind: "profile_route"; userPrompt: string }
  | { kind: "needs_profile_facts"; userPrompt: string };

/**
 * Deterministic context policy for Career workflows. It only resolves
 * already-present summaries; it never reads storage, calls an Agent, or
 * mutates the session.
 */
export class CareerContextBindingResolver {
  resolveProfile(input: {
    sessionId?: string;
    pinnedBinding?: CareerSessionBinding;
    requestedProfileId?: string;
    activeProfile?: CareerProfileCandidate;
    profiles: CareerProfileCandidate[];
  }): CareerProfileResolution {
    if (input.pinnedBinding) {
      const profile = input.profiles.find((candidate) => candidate.id === input.pinnedBinding!.profileId)
        ?? profileFromBinding(input.pinnedBinding);
      return { state: "bound", source: "pinned", profile, binding: input.pinnedBinding };
    }

    const profiles = uniqueProfiles([
      ...input.profiles,
      ...(input.activeProfile ? [input.activeProfile] : [])
    ]).filter(isValidProfile);
    const requested = input.requestedProfileId
      ? profiles.find((candidate) => candidate.id === input.requestedProfileId)
      : undefined;
    if (requested) return this.bindProfile(input.sessionId, requested, "requested");

    const activeId = input.activeProfile?.id;
    const active = activeId ? profiles.find((candidate) => candidate.id === activeId) : undefined;
    if (active) return this.bindProfile(input.sessionId, active, "active");

    if (profiles.length === 1) return this.bindProfile(input.sessionId, profiles[0], "single");
    if (profiles.length > 1) {
      return {
        state: "partially_bound",
        code: "needs_profile_choice",
        candidates: profiles.slice(0, 12).map(profileChoiceCandidate),
        userPrompt: "当前有多份可用的个人资料。请选择要用于这次岗位定制的资料。"
      };
    }
    return {
      state: "unbound",
      code: "needs_profile",
      candidates: [],
      userPrompt: "当前还没有可用于定制的个人资料。你可以选择已有资料，或先导入一份简历。"
    };
  }

  resolveResumeSource(input: {
    profileId: string;
    requestedResumeId?: string;
    resumes: CareerResumeCandidate[];
    profileSufficient: boolean;
  }): CareerResumeSourceResolution {
    const general = input.resumes
      .filter((resume) => isHealthyGeneralResume(resume)
        && typeof resume.id === "string"
        && Boolean(resume.id.trim())
        && resume.profileId === input.profileId)
      .slice(0, 12);
    if (input.requestedResumeId) {
      const requested = general.find((resume) => resume.id === input.requestedResumeId);
      if (requested) return { kind: "selected", resume: requested, source: "requested" };
    }
    if (general.length === 1) return { kind: "selected", resume: general[0], source: "single_general" };
    if (general.length > 1) {
      return {
        kind: "choice",
        candidates: general,
        userPrompt: "当前有多份可用的通用简历。请选择要作为这次岗位定制基础的简历。"
      };
    }
    if (input.profileSufficient) {
      return {
        kind: "profile_route",
        userPrompt: "当前还没有通用简历，但你的个人资料已有可用事实。我可以先用资料生成一份通用简历，再继续岗位定制。"
      };
    }
    return {
      kind: "needs_profile_facts",
      userPrompt: "当前资料还不足以生成岗位简历。你可以先导入一份简历，或补充更多个人经历。"
    };
  }

  private bindProfile(
    sessionId: string | undefined,
    profile: CareerProfileCandidate,
    source: "requested" | "active" | "single"
  ): CareerProfileResolution {
    const personId = stringValue(profile.personId);
    const profileRevision = integerValue(profile.profileRevision) ?? integerValue(profile.version);
    const profileVersionNumber = integerValue(profile.profileVersionNumber) ?? integerValue(profile.version);
    if (!personId || profileRevision === undefined || profileVersionNumber === undefined) {
      return {
        state: "unbound",
        code: "needs_profile",
        candidates: [profile],
        userPrompt: "当前个人资料缺少可核验的版本信息。请先重新读取资料，或导入一份新的简历。"
      };
    }
    return {
      state: "bound",
      source,
      profile,
      ...(sessionId ? {
        binding: {
          agentSessionId: sessionId,
          personId,
          profileId: profile.id,
          profileVersionNumber,
          profileRevision
        }
      } : {})
    };
  }
}

export const careerContextBindingResolver = new CareerContextBindingResolver();

export function isCareerDomainPreconditionCode(code?: string) {
  return Boolean(code) && [
    "career_session_binding_required",
    "needs_profile",
    "needs_profile_choice",
    "needs_resume_choice",
    "needs_user_input",
    "workflow_precondition",
    "target_required"
  ].includes(code!);
}

export function isHealthyGeneralResume(resume: CareerResumeCandidate) {
  const purpose = resume.branchPurpose ?? resume.purpose;
  return purpose === "general"
    && (resume.lifecycleStatus === undefined || resume.lifecycleStatus === "active")
    && (resume.migrationStatus === undefined || resume.migrationStatus === "verified");
}

export function profileHasSufficientFacts(profile: CareerProfileCandidate) {
  const explicitCounts = [profile.experienceCount, profile.skillCount, profile.certificateCount]
    .filter((count): count is number => typeof count === "number");
  if (explicitCounts.length > 0) return explicitCounts.some((count) => count > 0);
  if (Array.isArray(profile.items)) return profile.items.length > 0;
  return Object.values(profile.sectionCounts ?? {}).some((count) => typeof count === "number" && count > 0);
}

function isValidProfile(profile: CareerProfileCandidate) {
  return typeof profile.id === "string" && Boolean(profile.id.trim()) && !profile.archivedAt && !profile.trashedAt;
}

function uniqueProfiles(profiles: CareerProfileCandidate[]) {
  const byId = new Map<string, CareerProfileCandidate>();
  for (const profile of profiles) {
    if (typeof profile.id !== "string" || !profile.id.trim()) continue;
    const existing = byId.get(profile.id);
    byId.set(profile.id, existing ? { ...existing, ...profile } : profile);
  }
  return [...byId.values()];
}

function profileFromBinding(binding: CareerSessionBinding): CareerProfileCandidate {
  return {
    id: binding.profileId,
    personId: binding.personId,
    profileVersionNumber: binding.profileVersionNumber,
    profileRevision: binding.profileRevision
  };
}

function profileChoiceCandidate(profile: CareerProfileCandidate): CareerProfileCandidate {
  return {
    id: profile.id,
    ...(profile.personId ? { personId: profile.personId } : {}),
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.profileVersionNumber !== undefined ? { profileVersionNumber: profile.profileVersionNumber } : {}),
    ...(profile.profileRevision !== undefined ? { profileRevision: profile.profileRevision } : {}),
    ...(profile.version !== undefined ? { version: profile.version } : {}),
    ...(profile.isCurrent !== undefined ? { isCurrent: profile.isCurrent } : {}),
    ...(profile.experienceCount !== undefined ? { experienceCount: profile.experienceCount } : {}),
    ...(profile.skillCount !== undefined ? { skillCount: profile.skillCount } : {}),
    ...(profile.certificateCount !== undefined ? { certificateCount: profile.certificateCount } : {})
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function integerValue(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}
