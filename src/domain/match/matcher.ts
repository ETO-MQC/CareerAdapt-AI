import { nanoid } from "nanoid";
import {
  MatchEvaluationSchema,
  RequirementMatchSchema,
  type CareerProfile,
  type FactStatement,
  type JobDescription,
  type JobRequirement,
  type ManualMatchOverride,
  type MatchEvaluation,
  type MatchEvidenceRef,
  type MatchLevel,
  type MatchRisk,
  type RequirementMatch
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

export const MATCHER_VERSION = "evidence-matcher.v1";

export type CandidateFact = {
  ref: MatchEvidenceRef;
  searchText: string;
  updatedAt: string;
};

export type MatchContext = {
  profile: CareerProfile;
  job: JobDescription;
  matcherVersion?: string;
};

export type StaleCheck = {
  isStale: boolean;
  currentCandidateSetHash: string;
  currentProfileVersion: number;
  currentJobVersion: string;
  currentMatcherVersion: string;
};

export type ResumeMatchSource = {
  branchId: string;
  branchRevision: number;
  revisionId: string;
};

export function createRuleRequirementMatches(input: MatchContext, now = new Date().toISOString()) {
  const matcherVersion = input.matcherVersion ?? MATCHER_VERSION;

  return input.job.requirements.map((requirement) => {
    const candidates = recallCandidatesForRequirement(input.profile, requirement);
    const candidateSetHash = computeCandidateSetHash({
      profileVersion: input.profile.version,
      jobVersion: getJobVersion(input.job),
      matcherVersion,
      requirement,
      candidates
    });
    const ruleEvaluation = evaluateRuleMatch(requirement, candidates, now);

    const match = RequirementMatchSchema.parse({
      id: `match-${requirement.id}-${nanoid(8)}`,
      profileId: input.profile.id,
      jobId: input.job.id,
      profileVersion: input.profile.version,
      jobVersion: getJobVersion(input.job),
      matcherVersion,
      candidateSetHash,
      isStale: false,
      requirementId: requirement.id,
      requirementQuote: requirement.sourceSpan,
      ruleEvaluation,
      effectiveEvaluation: ruleEvaluation,
      createdAt: now,
      updatedAt: now
    });

    validateRequirementMatchReferences(match, input);
    return match;
  });
}

export function collectConfirmedCandidateFacts(profile: CareerProfile): CandidateFact[] {
  const candidates: CandidateFact[] = [];

  for (const experience of profile.experiences) {
    for (const fact of experience.facts) {
      if (!isConfirmedFact(fact)) {
        continue;
      }

      candidates.push({
        ref: {
          type: "experience_fact",
          experienceId: experience.id,
          factId: fact.id,
          factQuote: primarySourceText(fact),
          factText: fact.statement
        },
        searchText: normalizeSearchText([fact.statement, primarySourceText(fact), experience.organization, experience.role, experience.tags.join(" ")]),
        updatedAt: fact.updatedAt
      });
    }
  }

  for (const skill of profile.skills) {
    if (!skill.fact || !isConfirmedFact(skill.fact)) {
      continue;
    }

    candidates.push({
      ref: {
        type: "skill_fact",
        skillId: skill.id,
        factId: skill.fact.id,
        factQuote: primarySourceText(skill.fact),
        factText: skill.fact.statement
      },
      searchText: normalizeSearchText([skill.name, skill.level ?? "", skill.fact.statement, primarySourceText(skill.fact)]),
      updatedAt: skill.fact.updatedAt
    });
  }

  for (const certificate of profile.certificates) {
    if (!certificate.fact || !isConfirmedFact(certificate.fact)) {
      continue;
    }

    candidates.push({
      ref: {
        type: "certificate_fact",
        certificateId: certificate.id,
        factId: certificate.fact.id,
        factQuote: primarySourceText(certificate.fact),
        factText: certificate.fact.statement
      },
      searchText: normalizeSearchText([certificate.name, certificate.issuer ?? "", certificate.fact.statement, primarySourceText(certificate.fact)]),
      updatedAt: certificate.fact.updatedAt
    });
  }

  return candidates.sort((a, b) => evidenceRefKey(a.ref).localeCompare(evidenceRefKey(b.ref)));
}

export function recallCandidatesForRequirement(profile: CareerProfile, requirement: JobRequirement): CandidateFact[] {
  const allCandidates = collectConfirmedCandidateFacts(profile);
  const requirementText = normalizeSearchText([
    requirement.description,
    requirement.sourceSpan.text,
    requirement.keywords.join(" ")
  ]);
  const keywords = normalizedRequirementKeywords(requirement);

  const recalled = allCandidates
    .map((candidate) => ({
      candidate,
      directHits: keywords.filter((keyword) => keyword.length > 0 && candidate.searchText.includes(keyword)),
      transferable: hasTransferableSignal(requirementText, candidate.searchText)
    }))
    .filter((item) => item.directHits.length > 0 || item.transferable)
    .sort((a, b) => {
      if (b.directHits.length !== a.directHits.length) {
        return b.directHits.length - a.directHits.length;
      }

      if (a.transferable !== b.transferable) {
        return a.transferable ? 1 : -1;
      }

      return evidenceRefKey(a.candidate.ref).localeCompare(evidenceRefKey(b.candidate.ref));
    })
    .slice(0, 5)
    .map((item) => item.candidate);

  return recalled;
}

export function evaluateRuleMatch(requirement: JobRequirement, candidates: CandidateFact[], now = new Date().toISOString()): MatchEvaluation {
  if (candidates.length === 0) {
    return MatchEvaluationSchema.parse({
      source: "rule",
      matchLevel: "none",
      riskLevel: requirement.hardConstraint ? "high" : "medium",
      risks: requirement.hardConstraint ? ["hard_constraint_gap", "source_missing"] : ["source_missing"],
      evidenceRefs: [],
      explanation: buildStructuredExplanation(requirement, [], "none", []),
      evaluatedAt: now
    });
  }

  const keywords = normalizedRequirementKeywords(requirement);
  const best = candidates[0];
  const hitCount = keywords.filter((keyword) => best.searchText.includes(keyword)).length;
  const transferable = hasTransferableSignal(normalizeSearchText([requirement.description, requirement.sourceSpan.text]), best.searchText);
  let matchLevel: MatchLevel = hitCount >= 2 ? "strong" : hitCount === 1 ? "weak" : transferable ? "transferable" : "none";
  const risks: MatchRisk[] = [];

  // 收紧1：「参与/协助/基础/接触/了解」等限定词不得判定strong
  const bestFactText = best.ref.factText;
  if (matchLevel === "strong" && containsQualifierDowngrade(bestFactText)) {
    matchLevel = "weak";
    risks.push("low_confidence");
  }

  // 收紧2：岗位要求独立/主导/负责，但事实只有参与/协助 → 最高weak + medium风险
  if (matchLevel === "strong" && hasIndependenceMismatch(requirement, bestFactText)) {
    matchLevel = "weak";
    if (!risks.includes("low_confidence")) {
      risks.push("low_confidence");
    }
  }

  // 收紧3：团队项目必须检查ownership_risk
  if (containsTeamContext(bestFactText, best.ref)) {
    if (!risks.includes("team_to_individual_risk")) {
      risks.push("team_to_individual_risk");
    }
  }

  if (matchLevel === "transferable") {
    if (!risks.includes("low_confidence")) {
      risks.push("low_confidence");
    }
  }

  if (requirement.hardConstraint && matchLevel !== "strong") {
    risks.push("hard_constraint_gap");
  }

  const riskLevel = risks.includes("hard_constraint_gap") ? "high" : risks.length > 0 ? "medium" : "low";

  return MatchEvaluationSchema.parse({
    source: "rule",
    matchLevel,
    riskLevel,
    risks,
    evidenceRefs: candidates.map((candidate) => candidate.ref),
    explanation: buildStructuredExplanation(requirement, candidates, matchLevel, risks),
    evaluatedAt: now
  });
}

export function computeCandidateSetHash(input: {
  profileVersion: number;
  jobVersion: string;
  matcherVersion: string;
  requirement: JobRequirement;
  candidates: CandidateFact[];
}) {
  const normalized = {
    matcherVersion: input.matcherVersion,
    profileVersion: input.profileVersion,
    jobVersion: input.jobVersion,
    requirement: {
      id: input.requirement.id,
      description: normalizeWhitespace(input.requirement.description),
      sourceText: normalizeWhitespace(input.requirement.sourceSpan.text)
    },
    candidates: input.candidates
      .map((candidate) => ({
        key: evidenceRefKey(candidate.ref),
        factText: normalizeWhitespace(candidate.ref.factText),
        factQuote: normalizeWhitespace(candidate.ref.factQuote),
        updatedAt: candidate.updatedAt
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
  };

  return stableHashText(JSON.stringify(normalized));
}

export function checkRequirementMatchStale(match: RequirementMatch, context: MatchContext): StaleCheck {
  const matcherVersion = context.matcherVersion ?? MATCHER_VERSION;
  const requirement = context.job.requirements.find((item) => item.id === match.requirementId);

  if (!requirement) {
    return {
      isStale: true,
      currentCandidateSetHash: "missing-requirement",
      currentProfileVersion: context.profile.version,
      currentJobVersion: getJobVersion(context.job),
      currentMatcherVersion: matcherVersion
    };
  }

  const currentCandidateSetHash = computeCandidateSetHash({
    profileVersion: context.profile.version,
    jobVersion: getJobVersion(context.job),
    matcherVersion,
    requirement,
    candidates: recallCandidatesForRequirement(context.profile, requirement)
  });

  return {
    isStale:
      match.profileVersion !== context.profile.version ||
      match.jobVersion !== getJobVersion(context.job) ||
      match.matcherVersion !== matcherVersion ||
      match.candidateSetHash !== currentCandidateSetHash,
    currentCandidateSetHash,
    currentProfileVersion: context.profile.version,
    currentJobVersion: getJobVersion(context.job),
    currentMatcherVersion: matcherVersion
  };
}

export function checkRequirementMatchResumeSourceStale(
  match: RequirementMatch,
  source: ResumeMatchSource
) {
  return {
    isStale:
      match.sourceResumeBranchId !== source.branchId
      || match.sourceResumeBranchRevision !== source.branchRevision
      || match.sourceResumeRevisionId !== source.revisionId,
    sourceBranchChanged: match.sourceResumeBranchId !== source.branchId,
    sourceRevisionChanged:
      match.sourceResumeBranchRevision !== source.branchRevision
      || match.sourceResumeRevisionId !== source.revisionId
  };
}

export function matchesResumeSource(match: RequirementMatch, source: ResumeMatchSource) {
  return !checkRequirementMatchResumeSourceStale(match, source).isStale;
}

export function resolveEffectiveMatch(match: RequirementMatch): MatchEvaluation {
  return match.manualOverride?.nextEvaluation ?? match.aiEvaluation ?? match.ruleEvaluation;
}

export function withResolvedEffectiveMatch(match: RequirementMatch): RequirementMatch {
  const effectiveEvaluation = resolveEffectiveMatch(match);
  return RequirementMatchSchema.parse({
    ...match,
    effectiveEvaluation
  });
}

export function validateRequirementMatchReferences(match: RequirementMatch, context: MatchContext) {
  const requirementIds = new Set(context.job.requirements.map((requirement) => requirement.id));
  if (!requirementIds.has(match.requirementId)) {
    throw new MatchValidationError("requirement_not_in_job");
  }

  validateEvaluationReferences(match.ruleEvaluation, context);
  if (match.aiEvaluation) {
    validateEvaluationReferences(match.aiEvaluation, context);
  }
  if (match.manualOverride) {
    validateManualOverride(match.manualOverride, context);
  }

  if (match.effectiveEvaluation) {
    const resolved = resolveEffectiveMatch(match);
    const persisted = JSON.stringify(sortEvaluationForCompare(match.effectiveEvaluation));
    const computed = JSON.stringify(sortEvaluationForCompare(resolved));
    if (persisted !== computed) {
      throw new MatchValidationError("effective_evaluation_inconsistent");
    }
  }
}

export function validateEvaluationReferences(evaluation: MatchEvaluation, context: MatchContext) {
  for (const ref of evaluation.evidenceRefs) {
    validateEvidenceRef(ref, context.profile);
  }
}

export function validateManualOverride(override: ManualMatchOverride, context: MatchContext) {
  validateEvaluationReferences(override.nextEvaluation, context);

  if (override.nextEvaluation.matchLevel === "none") {
    if (!override.reason.trim()) {
      throw new MatchValidationError("manual_none_requires_reason");
    }
    return;
  }

  if (override.nextEvaluation.evidenceRefs.length === 0) {
    throw new MatchValidationError("manual_non_none_requires_evidence");
  }
}

export function validateEvidenceRef(ref: MatchEvidenceRef, profile: CareerProfile) {
  if (ref.type === "experience_fact") {
    const experience = profile.experiences.find((item) => item.id === ref.experienceId);
    const fact = experience?.facts.find((item) => item.id === ref.factId);
    if (!fact || !isConfirmedFact(fact)) {
      throw new MatchValidationError("experience_fact_not_confirmed_or_missing");
    }
    return;
  }

  if (ref.type === "skill_fact") {
    const skill = profile.skills.find((item) => item.id === ref.skillId);
    if (!skill?.fact || skill.fact.id !== ref.factId || !isConfirmedFact(skill.fact)) {
      throw new MatchValidationError("skill_fact_not_confirmed_or_missing");
    }
    return;
  }

  if (ref.type === "certificate_fact") {
    const certificate = profile.certificates.find((item) => item.id === ref.certificateId);
    if (!certificate?.fact || certificate.fact.id !== ref.factId || !isConfirmedFact(certificate.fact)) {
      throw new MatchValidationError("certificate_fact_not_confirmed_or_missing");
    }
    return;
  }

  const evidence = profile.evidences.find((item) => item.id === ref.evidenceId);
  const linkedFact = findConfirmedFact(profile, ref.linkedFactId);
  if (!evidence || !linkedFact) {
    throw new MatchValidationError("evidence_file_or_linked_fact_missing");
  }
}

export function evidenceRefKey(ref: MatchEvidenceRef) {
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

export function getJobVersion(job: JobDescription) {
  return job.updatedAt;
}

export function stripInjectionFromText(text: string): string {
  return stripInjectionPatterns(text);
}

export class MatchValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MatchValidationError";
  }
}

function isConfirmedFact(fact: FactStatement) {
  return fact.confirmedByUser && fact.provenance.some((item) => item.confirmedByUser);
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

function normalizedRequirementKeywords(requirement: JobRequirement) {
  const source = requirement.keywords.length > 0 ? requirement.keywords : [requirement.description, requirement.sourceSpan.text];
  return Array.from(new Set(source.flatMap((item) => splitKeywords(item)).filter((item) => item.length >= 2))).sort();
}

function splitKeywords(text: string) {
  const normalized = normalizeWhitespace(text);
  const alnum = normalized.match(/[A-Za-z0-9+#.]+/g) ?? [];
  const chinese = normalized.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  return [...alnum, ...chinese].map((item) => item.toLowerCase());
}

function hasTransferableSignal(requirementText: string, candidateText: string) {
  const signals = ["沟通", "协作", "执行", "整理", "流程", "记录", "需求", "验收", "分析", "表达"];
  return signals.some((signal) => requirementText.includes(signal) && candidateText.includes(signal));
}

function normalizeSearchText(parts: string[]) {
  return normalizeWhitespace(parts.filter(Boolean).join(" ")).toLowerCase();
}

function normalizeWhitespace(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

const QUALIFIER_WORDS = ["参与", "协助", "基础", "接触", "了解", "帮忙", "配合", "跟随"];

const INJECTION_PATTERNS = [
  /忽略[之所有前]*[所有一切]*指令/g,
  /ignore\s*(all\s+)?(previous\s+)?instructions?/gi,
  /输出\s*总分\s*\d+/g,
  /output\s*(total\s+)?score\s*\d*/gi,
  /system\s*prompt/gi
];

const INDEPENDENCE_WORDS = ["独立", "主导", "负责", "带领", "统筹"];

function containsQualifierDowngrade(factText: string): boolean {
  return QUALIFIER_WORDS.some((word) => factText.includes(word));
}

function hasIndependenceMismatch(requirement: JobRequirement, factText: string): boolean {
  const reqText = normalizeSearchText([requirement.description, requirement.sourceSpan.text]);
  const reqWantsIndependence = INDEPENDENCE_WORDS.some((word) => reqText.includes(word));
  if (!reqWantsIndependence) {
    return false;
  }
  const factHasIndependence = INDEPENDENCE_WORDS.some((word) => factText.includes(word));
  return !factHasIndependence;
}

function containsTeamContext(factText: string, ref: MatchEvidenceRef): boolean {
  const teamWords = ["团队", "项目组", "小组", "课题组"];
  const inFactText = teamWords.some((word) => factText.includes(word));
  if (inFactText) {
    return true;
  }
  if (ref.type === "experience_fact") {
    const orgText = ref.experienceId ?? "";
    return teamWords.some((word) => orgText.includes(word));
  }
  return false;
}

function stripInjectionPatterns(text: string): string {
  let clean = text;
  for (const pattern of INJECTION_PATTERNS) {
    clean = clean.replace(pattern, "");
  }
  return clean.replace(/\s+/g, " ").trim();
}

function buildStructuredExplanation(
  requirement: JobRequirement,
  candidates: CandidateFact[],
  matchLevel: MatchLevel,
  risks: MatchRisk[]
): string {
  if (matchLevel === "none") {
    return "规则层未找到已确认事实证据。";
  }

  const keywords = normalizedRequirementKeywords(requirement);
  const best = candidates[0];
  const matchedKeywords = keywords.filter((keyword) => best.searchText.includes(keyword));
  const missedKeywords = keywords.filter((keyword) => !best.searchText.includes(keyword));

  const supported = matchedKeywords.length > 0
    ? `技能/关键词匹配：${matchedKeywords.join("、")}`
    : "可迁移信号匹配";

  const missing = missedKeywords.length > 0
    ? `未直接匹配：${missedKeywords.join("、")}`
    : "";

  const levelReasons: Record<MatchLevel, string> = {
    strong: "关键词直接命中≥2，证据充分。",
    weak: "关键词部分命中或存在限定词降级，证据不够充分。",
    transferable: "无直接关键词命中，但存在可迁移信号。",
    none: "未找到可引用证据。"
  };

  const parts: string[] = [];
  parts.push(`[支持] ${supported}`);
  if (missing) {
    parts.push(`[缺失] ${missing}`);
  }
  parts.push(`[判定] ${levelReasons[matchLevel]}`);

  if (risks.length > 0) {
    const riskTexts: string[] = [];
    if (risks.includes("team_to_individual_risk")) {
      riskTexts.push("团队成果归属风险：事实中包含团队上下文，不应直接归为个人。");
    }
    if (risks.includes("hard_constraint_gap")) {
      riskTexts.push("硬性条件缺口：硬约束要求未被强匹配满足。");
    }
    if (risks.includes("low_confidence")) {
      riskTexts.push("低置信度：存在限定词或仅为可迁移信号。");
    }
    if (riskTexts.length > 0) {
      parts.push(`[风险] ${riskTexts.join(" ")}`);
    }
  }

  return parts.join(" ");
}

function sortEvaluationForCompare(evaluation: MatchEvaluation) {
  return {
    ...evaluation,
    risks: [...evaluation.risks].sort(),
    evidenceRefs: [...evaluation.evidenceRefs].sort((a, b) => evidenceRefKey(a).localeCompare(evidenceRefKey(b)))
  };
}
