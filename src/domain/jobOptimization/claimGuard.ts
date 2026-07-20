import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import type { ClaimDecision, ClaimSupportLevel, MatchEvidenceRef, TailoringClaim } from "@/domain/schemas";

export function claimDecisionFor(level: ClaimSupportLevel): ClaimDecision {
  if (level === "verified") return "auto_applicable";
  if (level === "unsupported_hard_fact") return "blocked";
  return "requires_confirmation";
}

export function classifyTailoringClaim(input: {
  id: string;
  section: TailoringClaim["section"];
  targetContentItemId?: string;
  currentText?: string;
  proposedText: string;
  reason: string;
  keywords?: string[];
  evidenceRefs?: MatchEvidenceRef[];
  declaredByUser?: boolean;
  inferred?: boolean;
}): TailoringClaim {
  const evidenceRefs = input.evidenceRefs ?? [];
  const guard = runRuleFactGuard({
    originalText: input.currentText ?? "",
    checkedText: input.proposedText,
    usedEvidenceRefs: evidenceRefs
  });
  const supportLevel: ClaimSupportLevel = guard.status === "blocked_high_risk"
    ? "unsupported_hard_fact"
    : input.declaredByUser
      ? "user_declared"
      : input.inferred
        ? "reasonable_inference"
      : evidenceRefs.length > 0 && guard.status === "pass"
        ? "verified"
        : "reasonable_inference";
  return {
    id: input.id,
    section: input.section,
    targetContentItemId: input.targetContentItemId,
    currentText: input.currentText ?? "",
    proposedText: input.proposedText,
    reason: input.reason,
    keywords: input.keywords ?? [],
    supportLevel,
    decision: claimDecisionFor(supportLevel),
    evidenceRefs,
    syncScope: supportLevel === "unsupported_hard_fact" ? "rejected" : "resume_only",
    confirmed: supportLevel === "verified"
  };
}

export function canApplyClaim(claim: TailoringClaim) {
  return claim.decision === "auto_applicable" || (claim.decision === "requires_confirmation" && claim.confirmed);
}
