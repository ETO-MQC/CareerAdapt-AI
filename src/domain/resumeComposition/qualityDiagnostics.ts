import { z } from "zod";
import type { ResumeCompositionResult } from "./contracts";

const ObservationSchema = z.object({ status: z.enum(["pass", "needs_review", "unknown"]), reason: z.string() }).strict();
export const ResumeQualityDiagnosticsSchema = z.object({
  ruleVersion: z.literal("resume-diagnostics-1"),
  hardGate: z.object({ status: z.enum(["pass", "blocked", "unknown"]), violations: z.array(z.string()) }).strict(),
  recruiterScan: z.object({ positioning: ObservationSchema, scanClarity: ObservationSchema, strongestExperience: ObservationSchema }).strict().optional(),
  claimRisk: z.object({ level: z.enum(["low", "needs_confirmation", "high_risk"]), claimIds: z.array(z.string()) }).strict().optional(),
  contentQuality: z.object({ factualFidelity: ObservationSchema, specificity: ObservationSchema, relevance: ObservationSchema,
    clarity: ObservationSchema, evidenceDensity: ObservationSchema, redundancy: ObservationSchema, ownershipAccuracy: ObservationSchema }).strict(),
  atsStructure: z.object({ textExtractability: ObservationSchema, sectionStructure: ObservationSchema, fieldCompleteness: ObservationSchema,
    readingOrder: ObservationSchema, supportedKeywordCoverage: ObservationSchema, unsupportedKeywordInjection: ObservationSchema }).strict()
}).strict();

/** Observable rule findings, never a calibrated hiring or ATS probability. */
export function diagnoseResumeQuality(result: ResumeCompositionResult) {
  const emittedIds = new Set(result.items.flatMap(item => item.claimIds));
  const claims = result.claims.filter(claim => emittedIds.has(claim.id));
  const violations = claims.filter(claim => claim.classification === "UNSUPPORTED" || claim.classification === "NEEDS_USER_CONFIRMATION"
    || claim.guardStatus !== "pass").map(claim => `unverified_claim:${claim.id}`);
  const observation = (bad: boolean, reason: string) => ({ status: bad ? "needs_review" as const : "pass" as const, reason });
  const unknown = (reason: string) => ({ status: "unknown" as const, reason });
  const metrics = result.metrics;
  return ResumeQualityDiagnosticsSchema.parse({
    ruleVersion: "resume-diagnostics-1",
    hardGate: { status: violations.length ? "blocked" : claims.length ? "pass" : "unknown", violations },
    recruiterScan: {
      positioning: result.candidateEvidenceMatrix
        ? observation(!result.candidateEvidenceMatrix.rows.some(row => row.evidenceStatus === "direct" || row.evidenceStatus === "transferable"), "Selected Job evidence coverage; not a calibrated recruiter judgment.")
        : unknown("No target Job; assess general positioning with the user."),
      scanClarity: observation(metrics.fillerBullets > 0 || metrics.paragraphHeavyItems > 0, "Text-only filler and paragraph observations; first-screen layout requires rendered inspection."),
      strongestExperience: unknown("Requires semantic comparison of experience and actual first-screen order.")
    },
    claimRisk: {
      level: claims.some(claim => claim.classification === "UNSUPPORTED" || claim.guardStatus === "blocked")
        ? "high_risk" : violations.length || !claims.length ? "needs_confirmation" : "low",
      claimIds: claims.filter(claim => violations.includes(`unverified_claim:${claim.id}`)).map(claim => claim.id)
    },
    contentQuality: {
      factualFidelity: claims.length ? observation(violations.length > 0, "Only emitted, source-bound claims with a passed Fact Guard count.") : unknown("No emitted claims to audit."),
      specificity: observation(metrics.lowDensityBullets > 0, `${metrics.lowDensityBullets} low-density bullets.`),
      relevance: result.candidateEvidenceMatrix ? observation(result.candidateEvidenceMatrix.rows.some(row => row.evidenceStatus === "unknown"), "Requirement evidence coverage; missing evidence remains unknown.") : unknown("No selected Job analysis."),
      clarity: observation(metrics.fillerBullets > 0 || metrics.paragraphHeavyItems > 0, "Filler and paragraph-density rule observations."),
      evidenceDensity: claims.length ? observation(claims.some(claim => !claim.factIds.length && !claim.sourceTurnIds.length), "Claim-to-fact or confirmed source-turn references, without treating keyword presence as evidence.") : unknown("No claims."),
      redundancy: observation(metrics.duplicateBullets > 0, `${metrics.duplicateBullets} duplicate bullets.`),
      ownershipAccuracy: unknown("Ownership is checked against source wording by Writer/Reviewer; this diagnostic has no independent semantic calibration.")
    },
    atsStructure: {
      textExtractability: unknown("Requires the actual exported PDF text extraction result."),
      sectionStructure: observation(result.items.length === 0, "Canonical Schema v2 section items."),
      fieldCompleteness: observation(result.informationNeeds.length > 0, `${result.informationNeeds.length} unresolved information needs.`),
      readingOrder: unknown("Requires rendered Preview/PDF validation."),
      supportedKeywordCoverage: observation(result.reviewResult.atsCoverage.some(row => row.finalStatus === "MISSING_BUT_SUPPORTED"), "Supported keywords only; not an ATS pass rate."),
      unsupportedKeywordInjection: observation(result.reviewResult.atsCoverage.some(row => row.status === "UNSUPPORTED" && row.finalStatus === "PRESENT"), "Unsupported target terms must stay absent.")
    }
  });
}
