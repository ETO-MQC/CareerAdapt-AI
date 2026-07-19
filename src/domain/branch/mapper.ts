import { nanoid } from "nanoid";
import {
  ResumeBranchSchema,
  ResumeRevisionSchema,
  type AiSuggestion,
  type BranchContentItem,
  type BranchGuardMode,
  type CareerProfile,
  type JobAdaptationDraft,
  type JobAdaptationSectionText,
  type JobDescription,
  type RequirementMatch,
  type ResumeBranch,
  type ResumeRevision
} from "@/domain/schemas";
import { assertC2MatchesUsable } from "@/domain/adaptation/draft";
import { evidenceRefKey, getJobVersion, resolveEffectiveMatch } from "@/domain/match/matcher";
import {
  assertNoHighGuardFindings,
  branchFactRefKey,
  computeBranchSyncStatus,
  resolveBranchFactRefs,
  toBranchFactRef
} from "./validation";
import { resumeBasicsFromProfile } from "./profileBranch";

export class BranchMapperError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BranchMapperError";
  }
}

export function mapAdaptationDraftToResumeBranch(input: {
  draft: JobAdaptationDraft;
  suggestions: AiSuggestion[];
  profile: CareerProfile;
  job: JobDescription;
  matches: RequirementMatch[];
  operationId: string;
  name: string;
  now?: string;
}): { branch: ResumeBranch; firstRevision: ResumeRevision; warnings: string[] } {
  const now = input.now ?? new Date().toISOString();
  assertDraftUsable(input.draft);

  if (input.draft.profileId !== input.profile.id || input.draft.jobId !== input.job.id) {
    throw new BranchMapperError("draft_profile_job_mismatch");
  }
  if (input.draft.profileVersion !== input.profile.version) {
    throw new BranchMapperError("draft_profile_version_stale");
  }
  if (input.draft.jobVersion !== getJobVersion(input.job)) {
    throw new BranchMapperError("draft_job_version_stale");
  }

  const usableMatches = assertC2MatchesUsable({
    profile: input.profile,
    job: input.job,
    matches: input.matches
  });
  const allowedRefs = new Map(
    usableMatches.flatMap((match) => resolveEffectiveMatch(match).evidenceRefs).map((ref) => [evidenceRefKey(ref), ref])
  );
  const suggestionsBySection = new Map<string, AiSuggestion[]>();
  for (const suggestion of input.suggestions) {
    if (suggestion.draftId !== input.draft.id) {
      continue;
    }
    const current = suggestionsBySection.get(suggestion.targetSectionId) ?? [];
    current.push(suggestion);
    suggestionsBySection.set(suggestion.targetSectionId, current);
  }

  const warnings: string[] = [];
  const contentItems = input.draft.sectionTexts
    .filter((section) => section.sectionType !== "risk_note" && section.sectionType !== "ordering_note")
    .map((section) => buildContentItem({
      section,
      suggestions: suggestionsBySection.get(section.sectionId) ?? [],
      allowedRefs,
      now
    }));

  if (contentItems.length === 0) {
    throw new BranchMapperError("branch_requires_factual_content");
  }

  for (const item of contentItems) {
    resolveBranchFactRefs(input.profile, item.factRefs);
    if (item.guardMode === "rule_only_verified") {
      warnings.push(`Item ${item.id} has rule-only verification because AI Fact Guard was unavailable.`);
    }
  }

  const branchId = `branch-${input.draft.profileId}-${input.draft.jobId}-${nanoid(8)}`;
  const branchWithoutSync = {
    id: branchId,
    profileId: input.profile.id,
    jobId: input.job.id,
    name: input.name.trim(),
    sourceProfileVersion: input.draft.profileVersion,
    sourceJobVersion: input.draft.jobVersion,
    sourceAdaptationDraftId: input.draft.id,
    sourceDraftRevision: input.draft.revision,
    matcherVersion: input.draft.matcherVersion,
    sourceMatchSetHash: input.draft.sourceMatchSetHash,
    requirementMatchIds: input.draft.requirementMatchIds,
    revision: 0,
    lifecycleStatus: "active" as const,
    migrationStatus: "verified" as const,
    resumeBasics: { ...resumeBasicsFromProfile(input.profile), targetRole: input.job.title },
    contentItems,
    createdAt: now,
    updatedAt: now
  };

  const branch = ResumeBranchSchema.parse({
    ...branchWithoutSync,
    syncStatusCache: computeBranchSyncStatus({
      branch: ResumeBranchSchema.parse({
        ...branchWithoutSync,
        syncStatusCache: {
          status: "in_sync",
          sourceProfileVersion: input.draft.profileVersion,
          currentProfileVersion: input.profile.version,
          sourceJobVersion: input.draft.jobVersion,
          currentJobVersion: getJobVersion(input.job),
          invalidFactRefs: [],
          checkedAt: now,
          message: "Branch is in sync with its source profile and job versions."
        }
      }),
      profile: input.profile,
      job: input.job,
      now
    })
  });

  const firstRevision = ResumeRevisionSchema.parse({
    id: `resume-revision-${nanoid(10)}`,
    branchId: branch.id,
    revisionNumber: 0,
    source: "created",
    operationId: input.operationId,
    snapshot: {
      name: branch.name,
      lifecycleStatus: branch.lifecycleStatus,
      resumeBasics: branch.resumeBasics,
      contentItems: branch.contentItems
    },
    createdAt: now,
    updatedAt: now
  });

  return {
    branch: ResumeBranchSchema.parse({
      ...branch,
      currentRevisionId: firstRevision.id
    }),
    firstRevision,
    warnings
  };
}

function assertDraftUsable(draft: JobAdaptationDraft) {
  if (draft.status === "stale_blocked" || draft.status === "error") {
    throw new BranchMapperError("draft_status_not_usable");
  }
  if (draft.sectionTexts.length === 0) {
    throw new BranchMapperError("draft_has_no_sections");
  }
}

function buildContentItem(input: {
  section: JobAdaptationSectionText;
  suggestions: AiSuggestion[];
  allowedRefs: Map<string, ReturnType<typeof resolveEffectiveMatch>["evidenceRefs"][number]>;
  now: string;
}): BranchContentItem {
  const accepted = input.suggestions.find((suggestion) => suggestion.status === "accepted");
  const text = accepted?.editedText ?? accepted?.suggestedText ?? input.section.text;
  const originalText = input.section.originalText;
  const guardResult = accepted?.guardResult;
  const sourceRefs = accepted?.usedEvidenceRefs
    ?? (input.section.sourceRef ? [input.allowedRefs.get(input.section.sourceRef)].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref)) : []);

  if (sourceRefs.length === 0) {
    throw new BranchMapperError("branch_section_missing_fact_ref");
  }

  const factRefs = sourceRefs.map(toBranchFactRef);
  const uniqueFactRefs = Array.from(new Map(factRefs.map((ref) => [branchFactRefKey(ref), ref])).values());

  if (guardResult) {
    if (guardResult.status === "blocked_high_risk" || guardResult.status === "needs_edit" || guardResult.riskLevel === "high") {
      throw new BranchMapperError("branch_guard_result_not_accepted");
    }
    if (guardResult.status === "ai_failed_rule_kept") {
      assertNoHighGuardFindings(guardResult.ruleFindings);
    }
  }

  const guardMode = guardResult ? guardModeFromGuardResult(guardResult.status, Boolean(guardResult.aiReview)) : "rule_verified";

  return {
    id: `branch-item-${input.section.sectionId}`,
    itemType: sectionTypeToItemType(input.section.sectionType),
    source: accepted ? "adaptation_draft" : "adaptation_draft",
    sourceSectionId: input.section.sectionId,
    text,
    originalText,
    order: input.section.order,
    visible: true,
    requirementIds: accepted?.requirementIds ?? [],
    sourceSuggestionIds: accepted ? [accepted.id] : [],
    factRefs: uniqueFactRefs,
    guardMode,
    guardStatus: guardResult?.status === "ai_failed_rule_kept" ? "ai_failed_rule_kept" : "pass",
    guardRiskLevel: guardResult?.riskLevel ?? "low",
    guardFindings: (guardResult?.ruleFindings ?? []).map((finding) => ({
      type: finding.type,
      text: finding.text,
      severity: finding.severity,
      allowed: finding.allowed,
      message: finding.message
    })),
    guardedAt: guardResult?.checkedAt ?? input.section.updatedAt ?? input.now,
    guardVersion: guardResult?.guardVersion
  };
}

function guardModeFromGuardResult(status: string, hasAiReview: boolean): BranchGuardMode {
  if (status === "ai_failed_rule_kept") {
    return "rule_only_verified";
  }
  return hasAiReview ? "ai_verified" : "rule_verified";
}

function sectionTypeToItemType(sectionType: JobAdaptationSectionText["sectionType"]): BranchContentItem["itemType"] {
  if (sectionType === "skills") {
    return "skill";
  }
  if (sectionType === "summary") {
    return "summary";
  }
  return "experience";
}
