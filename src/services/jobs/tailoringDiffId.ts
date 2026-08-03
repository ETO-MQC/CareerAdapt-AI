import type { ResumeTailoringDiff } from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";

/** Stable identity shared by the Tailoring service, runtime migration, and UI. */
export function tailoringDiffId(diff: ResumeTailoringDiff) {
  return `tailoring-diff-${stableHashText(JSON.stringify({
    target: diff.target,
    operation: diff.operation,
    original: diff.original,
    value: diff.value
  }))}`;
}
