/**
 * V4-P1 阶段 3：overall fit / hard gate / coverage 派生。
 *
 * Adapted from MyCareer (https://github.com/low-hands/MyCareer),
 * MIT License, Copyright (c) 2026 Rui Guo —
 * agent/capabilities/resume_job_fit.py (derive_overall_fit, 096 anchors)、
 * agent/contracts/job_analysis.py (explicit_hard_gate_language /
 * is_confirmed_hard_gate 双语硬门槛词表)、
 * services/job_comparison.py (_requirement_coverage: matched + 0.5 × partial)。
 *
 * 迁移约束（v4-plan.md §7.2–7.4）：
 * - 派生摘要，不新增第二个匹配主模型；现有 strong/partial/weak/none/
 *   needs_confirmation 仍是正式匹配结论，本模块只读它们；
 * - 双语硬门槛词表只用于提高现有 requirementGraph 的分类质量，映射到现有
 *   hardConstraint 与 requirement ID，不建独立 hard gate 表，也不以正则
 *   单独判定"不可投"；
 * - 所有派生输出带算法版本（algorithmId/algorithmVersion/generatedAt/
 *   inputJobVersion/inputResumeRevision）。
 */

export const OVERALL_FIT_ALGORITHM = "careeradapt-overall-fit-v1";
export const COVERAGE_ALGORITHM = "careeradapt-coverage-v1";
export const HARD_GATE_ALGORITHM = "careeradapt-hard-gate-v1";
export const MATCH_DERIVATION_ALGORITHM = "careeradapt-match-derivation-v1";

/** MyCareer 096 锚定的层级语义：tier 是 S/A/B/C，kind 区分事实与推断。 */
export type RequirementTier = "S" | "A" | "B" | "C";
export type RequirementFactKind = "fact" | "inference";
export type AssessmentStatus = "matched" | "partial" | "missing" | "unclear";
export type OverallFit = "strong" | "moderate" | "weak" | "insufficient_evidence";

export type DerivableRequirement = {
  requirementId: string;
  tier: RequirementTier;
  kind: RequirementFactKind;
};

export type DerivableAssessment = {
  requirementId: string;
  status: AssessmentStatus;
};

export function deriveOverallFit(
  requirements: readonly DerivableRequirement[],
  assessments: readonly DerivableAssessment[]
): OverallFit {
  const byId = new Map(requirements.map((item) => [item.requirementId, item]));
  const material: Array<[DerivableRequirement, DerivableAssessment]> = [];
  for (const assessment of assessments) {
    const requirement = byId.get(assessment.requirementId);
    if (requirement && (requirement.tier === "S" || requirement.tier === "A")) {
      material.push([requirement, assessment]);
    }
  }
  if (material.length === 0) return "insufficient_evidence";

  if (material.some(([requirement, assessment]) =>
    requirement.tier === "S" && requirement.kind === "fact" && assessment.status === "missing")) {
    return "weak";
  }

  const statusCounts = new Map<AssessmentStatus, number>();
  for (const [, assessment] of material) {
    statusCounts.set(assessment.status, (statusCounts.get(assessment.status) ?? 0) + 1);
  }
  // Python Counter 语义：缺键计 0，保证后续比较与算术不出现 undefined。
  const statusCount = (status: AssessmentStatus) => statusCounts.get(status) ?? 0;
  if (statusCount("unclear") === material.length || statusCount("unclear") * 2 > material.length) {
    return "insufficient_evidence";
  }
  if (material.every(([requirement]) => requirement.kind === "inference")
    && !material.some(([, assessment]) => assessment.status === "matched" || assessment.status === "partial")) {
    return "insufficient_evidence";
  }

  const factualA = material
    .filter(([requirement]) => requirement.tier === "A" && requirement.kind === "fact")
    .map(([, assessment]) => assessment);
  const aCount = (status: AssessmentStatus) => factualA.filter((assessment) => assessment.status === status).length;
  if (aCount("missing") > aCount("matched") + aCount("partial")) return "weak";

  const factualMaterial = material
    .filter(([requirement]) => requirement.kind === "fact")
    .map(([, assessment]) => assessment);
  if (factualMaterial.length > 0
    && !factualMaterial.some((assessment) => assessment.status === "matched" || assessment.status === "partial")
    && factualMaterial.some((assessment) => assessment.status === "missing")) {
    return "weak";
  }

  const factualS = material
    .filter(([requirement]) => requirement.tier === "S" && requirement.kind === "fact")
    .map(([, assessment]) => assessment);
  const hasFactualMaterial = factualMaterial.length > 0;
  const noFactualGap = factualMaterial.every((assessment) =>
    assessment.status !== "missing" && assessment.status !== "unclear");
  const allSMatched = factualS.every((assessment) => assessment.status === "matched");
  const aHasMatch = factualA.length === 0 || aCount("matched") > 0;
  const aMatchDominatesPartial = aCount("matched") >= aCount("partial");
  if (hasFactualMaterial && noFactualGap && allSMatched && aHasMatch && aMatchDominatesPartial) {
    return "strong";
  }
  return "moderate";
}

/**
 * 双语硬门槛词表（英文 + 中文）。只回答"这段 JD 原文是否显式写了硬门槛"，
 * 不回答"这个人能不能投"。
 */
const EXPLICIT_HARD_GATE_PATTERN = new RegExp(
  "(?:required|must have|must|minimum|at least|mandatory|hard requirement|"
  + "\\b\\d+\\s*\\+?\\s*years?\\b|\\b\\d+\\s*years?\\s+(?:of\\s+)?experience\\b|"
  + "bachelor(?:'s|s)?(?:\\s+degree)?|master(?:'s|s)?(?:\\s+degree)?|"
  + "ph\\.?d\\.?|degree required|certification required|license required|"
  + "\\d+\\s*年以上|\\d+\\s*年经验|本科及以上|硕士及以上|博士及以上|学历要求|"
  + "资格证书|认证要求|持证|硬性要求|必须|至少|硬门槛|必备)",
  "iu"
);

export function explicitHardGateLanguage(jdQuote: string): boolean {
  return EXPLICIT_HARD_GATE_PATTERN.test(jdQuote);
}

export type HardGateCandidate = {
  tier: RequirementTier;
  kind: RequirementFactKind;
  /** 评估结论；缺省时不参与 missing 判定 */
  status?: AssessmentStatus;
  tierConfidence?: "high" | "medium" | "low";
  tierRationale?: string;
  /** 门槛语言证据：优先 tier 依据原文，回退到 JD 原句 */
  tierEvidence?: string;
  jdQuote?: string;
};

/**
 * 参考实现的 canonical hard-gate 规则：S 级事实类要求、缺失状态、高置信、
 * 有依据原文，且原文含显式硬门槛语言。输出是"硬门槛候选"，供现有
 * requirementGraph 的 hardConstraint 分类参考，不单独构成否决。
 */
export function isConfirmedHardGate(candidate: HardGateCandidate): boolean {
  return candidate.tier === "S"
    && candidate.kind === "fact"
    && (candidate.status === undefined || candidate.status === "missing")
    && candidate.tierConfidence === "high"
    && Boolean(candidate.tierRationale?.trim())
    && explicitHardGateLanguage(candidate.tierEvidence || candidate.jdQuote || "");
}

export type CoverageValue = "full" | "most" | "partial" | "little" | "unknown";

export type CoverageDerivation = {
  value: CoverageValue;
  ratio: number | undefined;
  counts: { total: number; matched: number; partial: number; missing: number; unclear: number };
  algorithm: typeof COVERAGE_ALGORITHM;
};

/**
 * matched + 0.5 × partial 公式。无法判断（unclear）的要求留在明细里、
 * 但不进分母——"JD 本身说不清"不能算成一个分数。
 */
export function deriveCoverage(assessments: readonly DerivableAssessment[]): CoverageDerivation {
  const counts = {
    total: assessments.length,
    matched: assessments.filter((item) => item.status === "matched").length,
    partial: assessments.filter((item) => item.status === "partial").length,
    missing: assessments.filter((item) => item.status === "missing").length,
    unclear: assessments.filter((item) => item.status === "unclear").length
  };
  const assessable = counts.matched + counts.partial + counts.missing;
  if (assessable === 0) {
    return { value: "unknown", ratio: undefined, counts, algorithm: COVERAGE_ALGORITHM };
  }
  const ratio = (counts.matched + 0.5 * counts.partial) / assessable;
  const value: CoverageValue = ratio >= 0.9
    ? "full"
    : ratio >= 0.7
      ? "most"
      : ratio >= 0.4
        ? "partial"
        : "little";
  return { value, ratio, counts, algorithm: COVERAGE_ALGORITHM };
}

// --- CareerAdapt 现有模型到派生输入的映射（v1 政策，全部显式可测） ---

/** v4-plan §7.2：现有匹配等级保留为正式结论；这里只映射为派生评估状态。 */
export type ExistingMatchLevel = "strong" | "partial" | "weak" | "none" | "needs_confirmation";

export function assessmentStatusFromMatchLevel(level: ExistingMatchLevel): AssessmentStatus {
  switch (level) {
    case "strong": return "matched";
    case "partial": return "partial";
    case "weak":
    case "needs_confirmation": return "unclear";
    case "none": return "missing";
  }
}

export type ExistingRequirementPriority = "must" | "high" | "medium" | "nice_to_have" | "uncertain";

export function tierFromPriority(priority: ExistingRequirementPriority): RequirementTier {
  switch (priority) {
    case "must": return "S";
    case "high": return "A";
    case "medium": return "B";
    case "nice_to_have":
    case "uncertain": return "C";
  }
}

/** 事实类 kind 的判定：硬约束或客观资格类（学历/语言/工具技术/经验深度）。 */
const FACT_KIND_CATEGORIES: readonly string[] = ["education", "language", "tool_or_technology", "experience_depth"];

export function requirementFactKind(input: { hardConstraint: boolean; kind: string }): RequirementFactKind {
  return input.hardConstraint || FACT_KIND_CATEGORIES.includes(input.kind) ? "fact" : "inference";
}

/** 派生摘要的算法元数据（v4-plan §7.4 要求的全部字段）。 */
export type MatchDerivationMetadata = {
  algorithmId: typeof MATCH_DERIVATION_ALGORITHM;
  algorithmVersion: 1;
  generatedAt: string;
  inputJobVersion: string;
  inputResumeRevision: string;
};

export type MatchDerivationSummary = {
  overallFit: OverallFit;
  coverage: CoverageDerivation;
  hardGateCandidates: Array<{ requirementId: string } & HardGateCandidate>;
  algorithm: MatchDerivationMetadata;
};

/**
 * 组合派生：overall fit + coverage + 硬门槛候选。requirements/assessments
 * 由调用方从现有 RequirementNode + 匹配等级映射而来（见 *_from* 助手）；
 * generatedAt 由调用方注入，本模块不读时钟。
 */
export function deriveMatchSummary(
  requirements: readonly DerivableRequirement[],
  assessments: readonly DerivableAssessment[],
  hardGateInputs: readonly (HardGateCandidate & { requirementId: string })[],
  metadata: { generatedAt: string; inputJobVersion: string; inputResumeRevision: string }
): MatchDerivationSummary {
  return {
    overallFit: deriveOverallFit(requirements, assessments),
    coverage: deriveCoverage(assessments),
    hardGateCandidates: hardGateInputs.filter((input) => isConfirmedHardGate(input)),
    algorithm: {
      algorithmId: MATCH_DERIVATION_ALGORITHM,
      algorithmVersion: 1,
      generatedAt: metadata.generatedAt,
      inputJobVersion: metadata.inputJobVersion,
      inputResumeRevision: metadata.inputResumeRevision
    }
  };
}
