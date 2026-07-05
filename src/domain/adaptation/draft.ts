import { nanoid } from "nanoid";
import {
  JobAdaptationDraftSchema,
  JobAdaptationSnapshotSchema,
  type CareerProfile,
  type JobAdaptationDraft,
  type JobAdaptationSectionText,
  type JobDescription,
  type MatchEvidenceRef,
  type RequirementMatch
} from "@/domain/schemas";
import { checkRequirementMatchStale, evidenceRefKey, resolveEffectiveMatch } from "@/domain/match/matcher";
import { stableHashText } from "@/services/security/text";

export class AdaptationDraftError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AdaptationDraftError";
  }
}

export function createJobAdaptationDraft(input: {
  profile: CareerProfile;
  job: JobDescription;
  matches: RequirementMatch[];
  operationId: string;
  branchId?: string;
  sourceBranchId?: string;
  sourceRevisionId?: string;
  sourceBranchRevision?: number;
  now?: string;
}): JobAdaptationDraft {
  const now = input.now ?? new Date().toISOString();
  const validMatches = assertC2MatchesUsable(input);
  const sectionTexts = buildInitialSectionTexts(validMatches, now);
  const draftId = `adapt-${input.profile.id}-${input.job.id}-${nanoid(8)}`;
  const sourceMatchSetHash = computeSourceMatchSetHash(validMatches);
  const snapshot = JobAdaptationSnapshotSchema.parse({
    id: `adapt-snapshot-${nanoid(10)}`,
    draftId,
    revision: 0,
    source: "created",
    operationId: input.operationId,
    sectionTexts,
    appliedSuggestionIds: [],
    createdAt: now,
    updatedAt: now
  });

  return JobAdaptationDraftSchema.parse({
    id: draftId,
    profileId: input.profile.id,
    jobId: input.job.id,
    branchId: input.branchId,
    sourceBranchId: input.sourceBranchId,
    sourceRevisionId: input.sourceRevisionId,
    sourceBranchRevision: input.sourceBranchRevision,
    profileVersion: input.profile.version,
    jobVersion: input.job.updatedAt,
    matcherVersion: validMatches[0].matcherVersion,
    requirementMatchIds: validMatches.map((match) => match.id),
    sourceMatchSetHash,
    revision: 0,
    status: "draft",
    appliedSuggestionIds: [],
    sectionTexts,
    snapshots: [snapshot],
    createdAt: now,
    updatedAt: now
  });
}

export function assertC2MatchesUsable(input: {
  profile: CareerProfile;
  job: JobDescription;
  matches: RequirementMatch[];
}) {
  if (input.matches.length === 0) {
    throw new AdaptationDraftError("c2_requires_requirement_matches");
  }

  const jobRequirementIds = new Set(input.job.requirements.map((requirement) => requirement.id));
  const validMatches = input.matches.filter((match) => match.profileId === input.profile.id && match.jobId === input.job.id);

  if (validMatches.length === 0) {
    throw new AdaptationDraftError("c2_no_matches_for_profile_job");
  }

  for (const match of validMatches) {
    if (!jobRequirementIds.has(match.requirementId)) {
      throw new AdaptationDraftError("c2_match_requirement_missing");
    }
    const stale = checkRequirementMatchStale(match, { profile: input.profile, job: input.job, matcherVersion: match.matcherVersion });
    if (match.isStale || stale.isStale) {
      throw new AdaptationDraftError("c2_match_stale_return_to_c1");
    }
  }

  return validMatches;
}

export function collectAllowedEvidenceRefs(matches: RequirementMatch[]) {
  const refs = new Map<string, MatchEvidenceRef>();
  for (const match of matches) {
    for (const ref of resolveEffectiveMatch(match).evidenceRefs) {
      refs.set(evidenceRefKey(ref), ref);
    }
  }
  return Array.from(refs.values()).sort((a, b) => evidenceRefKey(a).localeCompare(evidenceRefKey(b)));
}

export function computeSourceMatchSetHash(matches: RequirementMatch[]) {
  return stableHashText(JSON.stringify(matches.map((match) => {
    const effective = resolveEffectiveMatch(match);
    return {
      id: match.id,
      requirementId: match.requirementId,
      candidateSetHash: match.candidateSetHash,
      matcherVersion: match.matcherVersion,
      matchLevel: effective.matchLevel,
      riskLevel: effective.riskLevel,
      risks: [...effective.risks].sort(),
      evidenceRefs: effective.evidenceRefs.map(evidenceRefKey).sort()
    };
  }).sort((a, b) => a.id.localeCompare(b.id))));
}

function buildInitialSectionTexts(matches: RequirementMatch[], now: string): JobAdaptationSectionText[] {
  const refs = collectAllowedEvidenceRefs(matches);
  const sections: JobAdaptationSectionText[] = refs.map((ref, index) => ({
    sectionId: `section-${evidenceRefKey(ref).replace(/[^a-zA-Z0-9-]/g, "-")}`,
    sectionType: "experience" as const,
    sourceRef: evidenceRefKey(ref),
    originalText: ref.factText,
    text: ref.factText,
    order: index,
    updatedAt: now
  }));

  const noneMatches = matches.filter((match) => resolveEffectiveMatch(match).matchLevel === "none");
  for (const match of noneMatches) {
    const order = sections.length;
    sections.push({
      sectionId: `section-gap-${match.requirementId}`,
      sectionType: "risk_note",
      sourceRef: match.requirementId,
      originalText: "当前无证据支持该岗位要求。",
      text: "当前无证据支持该岗位要求。",
      order,
      updatedAt: now
    });
  }

  if (sections.length === 0) {
    throw new AdaptationDraftError("c2_requires_confirmed_evidence_or_gap");
  }

  return sections;
}
