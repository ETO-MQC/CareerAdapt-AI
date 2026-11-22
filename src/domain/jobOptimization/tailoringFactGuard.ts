import type { CareerProfile, ResumeTailoringDiff } from "@/domain/schemas";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";
import { resolveBranchFactRefs, toBranchFactRef } from "@/domain/branch/validation";
import { tailoringDiffId } from "@/services/jobs/tailoringDiffId";
import type { TailoringTaskEvidence } from "./tailoringTaskEvidence";

/** Recheck the reviewed text against the actual confirmed profile facts. */
export function assertTailoringDiffFacts(profile: CareerProfile, diffs: ResumeTailoringDiff[], taskEvidence: TailoringTaskEvidence[] = []) {
  for (const diff of diffs) {
    if (diff.operation === "hide" || diff.operation === "reorder") continue;
    const evidence = resolveBranchFactRefs(profile, diff.evidenceRefs.map(toBranchFactRef));
    const originalText = Array.isArray(diff.original) ? diff.original.join("\n") : String(diff.original);
    const checkedText = Array.isArray(diff.value) ? diff.value.join("\n") : String(diff.value);
    const verifiedTaskFacts = taskEvidence.filter((item) => item.diffId === tailoringDiffId(diff)).map((item) => item.factText);
    if (runRuleFactGuard({ originalText, checkedText, usedEvidenceRefs: evidence, verifiedTaskFacts }).status !== "pass") {
      throw new Error("tailoring_fact_guard_rejected");
    }
  }
}
