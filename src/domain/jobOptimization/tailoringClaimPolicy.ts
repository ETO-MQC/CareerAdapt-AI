import type {
  ClaimDecision,
  FactGuardFinding,
  FactGuardResult,
  RiskLevel,
  TailoringClaimClass,
  TailoringIntensity,
  TailoringSectionPolicy
} from "@/domain/schemas";

const CONFIRMABLE = new Set<FactGuardFinding["type"]>(["new_tool", "new_skill", "know_to_proficient"]);
const HARD_FACT = new Set<FactGuardFinding["type"]>([
  "new_number", "new_company", "new_school", "new_role", "new_org", "new_award", "new_outcome",
  "participation_to_owner", "assist_to_independent", "team_to_individual"
]);

export type TailoringClaimPolicyResult = {
  claimClass: TailoringClaimClass;
  decision: ClaimDecision;
  riskLevel: RiskLevel;
  confirmationKind: "none" | "capability" | "reframe";
  blockingFindings: FactGuardFinding[];
  confirmableFindings: FactGuardFinding[];
};

export function resolveTailoringClaimPolicy(input: {
  suggestion: { claimSupportLevel: "verified" | "reasonable_inference" | "user_declared" | "unsupported_hard_fact"; targetKeywords?: string[] };
  guardResult: FactGuardResult;
  sectionType: TailoringSectionPolicy;
  intensity: TailoringIntensity;
}): TailoringClaimPolicyResult {
  const findings = input.guardResult.ruleFindings.filter((finding) => !finding.allowed);
  const blockingFindings = findings.filter((finding) => HARD_FACT.has(finding.type));
  const confirmableFindings = findings.filter((finding) => CONFIRMABLE.has(finding.type));
  if (input.suggestion.claimSupportLevel === "unsupported_hard_fact" || blockingFindings.length) {
    return { claimClass: "unsupported_hard_fact", decision: "blocked", riskLevel: "high", confirmationKind: "none", blockingFindings, confirmableFindings };
  }
  if (confirmableFindings.length || input.suggestion.claimSupportLevel === "user_declared") {
    return { claimClass: "user_confirmable_capability", decision: "requires_confirmation", riskLevel: "medium", confirmationKind: "capability", blockingFindings: [], confirmableFindings };
  }
  if (input.suggestion.claimSupportLevel === "reasonable_inference" || findings.length) {
    return { claimClass: "reasonable_reframe", decision: "requires_confirmation", riskLevel: "medium", confirmationKind: "reframe", blockingFindings: [], confirmableFindings: findings };
  }
  return { claimClass: "verified_rewrite", decision: "auto_applicable", riskLevel: "low", confirmationKind: "none", blockingFindings: [], confirmableFindings: [] };
}
