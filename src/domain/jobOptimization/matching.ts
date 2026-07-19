import { nanoid } from "nanoid";
import {
  RequirementBlockMatchSchema,
  RequirementCoverageSummarySchema,
  JobOptimizationSummarySchema,
  type CareerProfile,
  type JobDescription,
  type MatchEvidenceRef,
  type RequirementBlockMatch,
  type RequirementBlockMatchLevel,
  type RequirementCoverageSummary,
  type RequirementMatch,
  type ResumeBranch
} from "@/domain/schemas";
import { branchFactRefKey, resolveBranchFactRefs, toBranchFactRef } from "@/domain/branch/validation";
import { checkRequirementMatchStale, evidenceRefKey, getJobVersion, resolveEffectiveMatch } from "@/domain/match/matcher";
import { stableHashText } from "@/services/security/text";

export function computeRequirementsHash(input: {
  job: JobDescription;
  matches: RequirementMatch[];
}) {
  return stableHashText(JSON.stringify({
    jobId: input.job.id,
    jobVersion: getJobVersion(input.job),
    requirements: input.job.requirements.map((requirement) => ({
      id: requirement.id,
      category: requirement.category,
      priority: requirement.priority,
      hardConstraint: requirement.hardConstraint,
      description: normalizeText(requirement.description),
      sourceText: normalizeText(requirement.sourceSpan.text),
      keywords: [...requirement.keywords].sort()
    })),
    matches: input.matches.map((match) => {
      const effective = resolveEffectiveMatch(match);
      return {
        id: match.id,
        requirementId: match.requirementId,
        candidateSetHash: match.candidateSetHash,
        matcherVersion: match.matcherVersion,
        isStale: match.isStale,
        matchLevel: effective.matchLevel,
        riskLevel: effective.riskLevel,
        risks: [...effective.risks].sort(),
        evidenceRefs: effective.evidenceRefs.map(evidenceRefKey).sort()
      };
    }).sort((a, b) => a.id.localeCompare(b.id))
  }));
}

export function buildRequirementBlockMatches(input: {
  profile: CareerProfile;
  job: JobDescription;
  branch: ResumeBranch;
  matches: RequirementMatch[];
  now?: string;
}): RequirementBlockMatch[] {
  if (!input.branch.currentRevisionId) {
    throw new Error("branch_current_revision_missing");
  }
  const now = input.now ?? new Date().toISOString();
  const requirementsHash = computeRequirementsHash({ job: input.job, matches: input.matches });
  const matchByRequirementId = new Map(input.matches.map((match) => [match.requirementId, match]));
  const blocksByEvidence = buildBlocksByEvidence(input.profile, input.branch);

  return input.job.requirements.flatMap((requirement) => {
    const requirementMatch = matchByRequirementId.get(requirement.id);
    const effective = requirementMatch ? resolveEffectiveMatch(requirementMatch) : undefined;
    const evidenceRefs = effective?.evidenceRefs ?? [];
    const evidenceKeys = new Set(evidenceRefs.map((ref) => branchFactRefKey(toBranchFactRef(ref))));
    const directlyMatchedItems = input.branch.contentItems
      .filter((item) => item.itemType !== "structural")
      .filter((item) => item.factRefs.some((ref) => evidenceKeys.has(branchFactRefKey(ref))));

    // Text similarity is recall-only in V2. A block is not promoted to a match
    // unless its confirmed fact refs intersect the requirement evaluation.
    const targetItems = directlyMatchedItems;
    if (targetItems.length === 0) {
      return [RequirementBlockMatchSchema.parse({
        id: `rbm-${requirement.id}-none-${nanoid(8)}`,
        jobId: input.job.id,
        branchId: input.branch.id,
        branchRevision: input.branch.revision,
        currentRevisionId: input.branch.currentRevisionId,
        requirementsHash,
        requirementId: requirement.id,
        matchLevel: "none",
        evidenceRefs: [],
        evidenceFactIds: [],
        evidenceQuotes: [],
        reason: requirementMatch ? "未找到可定位到当前简历区块的已确认事实证据。" : "当前岗位要求还没有匹配记录。",
        source: "deterministic",
        isStale: requirementMatch ? checkRequirementMatchStale(requirementMatch, {
          profile: input.profile,
          job: input.job,
          matcherVersion: requirementMatch.matcherVersion
        }).isStale : true,
        createdAt: now,
        updatedAt: now
      })];
    }

    return targetItems.map((item) => {
      const itemEvidenceRefs = item.factRefs
        .map((ref) => blocksByEvidence.get(branchFactRefKey(ref)))
        .filter((ref): ref is MatchEvidenceRef => Boolean(ref));
      const matchedEvidenceRefs = evidenceRefs.length > 0
        ? itemEvidenceRefs.filter((ref) => evidenceKeys.has(branchFactRefKey(toBranchFactRef(ref))))
        : itemEvidenceRefs;
      const level = directMatchLevel(effective?.matchLevel, matchedEvidenceRefs.length > 0);
      return RequirementBlockMatchSchema.parse({
        id: `rbm-${requirement.id}-${item.id}-${nanoid(8)}`,
        jobId: input.job.id,
        branchId: input.branch.id,
        branchRevision: input.branch.revision,
        currentRevisionId: input.branch.currentRevisionId,
        requirementsHash,
        requirementId: requirement.id,
        contentItemId: item.id,
        matchLevel: level,
        evidenceRefs: matchedEvidenceRefs,
        evidenceFactIds: matchedEvidenceRefs.map(evidenceFactId),
        evidenceQuotes: matchedEvidenceRefs.map((ref) => ref.factQuote || ref.factText),
        reason: buildMatchReason(level, requirement.description, matchedEvidenceRefs.length, Boolean(effective?.risks.length)),
        source: "deterministic",
        isStale: requirementMatch ? checkRequirementMatchStale(requirementMatch, {
          profile: input.profile,
          job: input.job,
          matcherVersion: requirementMatch.matcherVersion
        }).isStale : true,
        createdAt: now,
        updatedAt: now
      });
    });
  });
}

export function summarizeRequirementCoverage(input: {
  job: JobDescription;
  matches: RequirementBlockMatch[];
}): RequirementCoverageSummary[] {
  return input.job.requirements.map((requirement) => {
    const matches = input.matches.filter((match) => match.requirementId === requirement.id);
    const ranked = [...matches].sort((a, b) => levelRank(b.matchLevel) - levelRank(a.matchLevel));
    const best = ranked[0];
    const matchedContentItemIds = Array.from(new Set(matches.map((match) => match.contentItemId).filter((id): id is string => Boolean(id))));
    const evidenceCount = new Set(matches.flatMap((match) => match.evidenceFactIds)).size;
    const status = best ? coverageStatus(best.matchLevel) : "uncovered";
    return RequirementCoverageSummarySchema.parse({
      requirementId: requirement.id,
      coverageStatus: status,
      bestMatchLevel: best?.matchLevel ?? "none",
      matchedContentItemIds,
      evidenceCount,
      hasFactGap: evidenceCount === 0 || status === "uncovered" || status === "needs_confirmation",
      reasons: ranked.map((match) => match.reason)
    });
  });
}

export function buildJobOptimizationSummary(input: {
  job: JobDescription;
  branch: ResumeBranch;
  matches: RequirementBlockMatch[];
  generatedSuggestions?: number;
  pendingSuggestions?: number;
  acceptedSuggestions?: number;
  rejectedSuggestions?: number;
  staleSuggestions?: number;
  blockedSuggestions?: number;
}) {
  if (!input.branch.currentRevisionId) {
    throw new Error("branch_current_revision_missing");
  }
  const coverage = summarizeRequirementCoverage({ job: input.job, matches: input.matches });
  return JobOptimizationSummarySchema.parse({
    jobId: input.job.id,
    branchId: input.branch.id,
    branchRevision: input.branch.revision,
    currentRevisionId: input.branch.currentRevisionId,
    requirementsHash: input.matches[0]?.requirementsHash ?? stableHashText(input.job.id),
    totalRequirements: input.job.requirements.length,
    strong: coverage.filter((item) => item.bestMatchLevel === "strong").length,
    partial: coverage.filter((item) => item.bestMatchLevel === "partial").length,
    weak: coverage.filter((item) => item.bestMatchLevel === "weak").length,
    none: coverage.filter((item) => item.bestMatchLevel === "none").length,
    needsConfirmation: coverage.filter((item) => item.bestMatchLevel === "needs_confirmation").length,
    generatedSuggestions: input.generatedSuggestions ?? 0,
    pendingSuggestions: input.pendingSuggestions ?? 0,
    acceptedSuggestions: input.acceptedSuggestions ?? 0,
    rejectedSuggestions: input.rejectedSuggestions ?? 0,
    staleSuggestions: input.staleSuggestions ?? 0,
    blockedSuggestions: input.blockedSuggestions ?? 0
  });
}

function buildBlocksByEvidence(profile: CareerProfile, branch: ResumeBranch) {
  const result = new Map<string, MatchEvidenceRef>();
  for (const item of branch.contentItems) {
    for (const ref of resolveBranchFactRefs(profile, item.factRefs)) {
      result.set(branchFactRefKey(toBranchFactRef(ref)), ref);
    }
  }
  return result;
}

function directMatchLevel(
  existingLevel: string | undefined,
  hasEvidence: boolean
): RequirementBlockMatchLevel {
  if (!hasEvidence) {
    return "none";
  }
  if (existingLevel === "strong") {
    return "strong";
  }
  if (existingLevel === "transferable") {
    return "partial";
  }
  if (existingLevel === "weak") {
    return "weak";
  }
  return "partial";
}

function buildMatchReason(level: RequirementBlockMatchLevel, requirementText: string, evidenceCount: number, hasRisk: boolean) {
  const prefix = level === "strong"
    ? "已找到强相关事实证据"
    : level === "partial"
      ? "已找到部分相关事实证据"
      : level === "weak"
        ? "仅找到弱相关事实证据"
        : level === "needs_confirmation"
          ? "文本关键词相近，但缺少可定位事实证据"
          : "未找到证据";
  return `${prefix}；证据 ${evidenceCount} 条；岗位要求：${requirementText.slice(0, 80)}${hasRisk ? "；存在匹配风险。" : "。"}`;
}

function coverageStatus(level: RequirementBlockMatchLevel): RequirementCoverageSummary["coverageStatus"] {
  if (level === "strong") {
    return "covered";
  }
  if (level === "partial") {
    return "partial";
  }
  if (level === "weak") {
    return "weak";
  }
  if (level === "needs_confirmation") {
    return "needs_confirmation";
  }
  return "uncovered";
}

function levelRank(level: RequirementBlockMatchLevel) {
  const rank: Record<RequirementBlockMatchLevel, number> = {
    strong: 4,
    partial: 3,
    weak: 2,
    needs_confirmation: 1,
    none: 0
  };
  return rank[level];
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function evidenceFactId(ref: MatchEvidenceRef) {
  if (ref.type === "experience_fact") {
    return ref.factId;
  }
  if (ref.type === "skill_fact") {
    return ref.factId;
  }
  if (ref.type === "certificate_fact") {
    return ref.factId;
  }
  return ref.linkedFactId;
}
