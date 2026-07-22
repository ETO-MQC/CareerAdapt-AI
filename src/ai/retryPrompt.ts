import type { AiTask } from "@/domain/schemas";

export function buildRetryPrompt({ task, baseUserPrompt, failure, input }: { task: AiTask; baseUserPrompt: string; failure?: string; input?: unknown }) {
  if (task === "jd-analyzer") {
    const sourceUnitIds = typeof input === "object" && input && "sourceUnits" in input && Array.isArray(input.sourceUnits)
      ? input.sourceUnits.flatMap((unit) => typeof unit === "object" && unit && "id" in unit && typeof unit.id === "string" ? [unit.id] : []) : [];
    const detail = failure?.includes("too_large") || failure?.includes("output_limit")
      ? "The output was too long. Use accept items with only sourceUnitId and verdict; omit all redundant fields."
      : failure?.includes("duplicate") ? "A sourceUnitId was duplicated. Return each supplied ID exactly once."
        : failure?.includes("invented") ? "An unknown sourceUnitId was returned. Copy IDs only from the supplied sourceUnits."
          : failure?.includes("missing") ? "Some sourceUnitIds were missing. Cover every supplied ID exactly once."
            : `The previous output failed validation (${failure ?? "schema field error"}). Normalize disposition/priority values and use numeric confidence from 0 to 1.`;
    return [baseUserPrompt, "", detail, `Expected sourceUnitIds: ${JSON.stringify(sourceUnitIds)}`, "Return only compact JD Analyzer V3 JSON:", '{"unitAssignments":[{"sourceUnitId":"copy exactly from input","verdict":"accept"}],"groupAdjustments":[],"riskNotes":[]}'].join("\n");
  }
  if (!task.startsWith("resume-tailor")) return [baseUserPrompt, "", `Previous ${task} response failed (${failure ?? "schema validation failed"}).`, "Return only compact JSON matching this task's requested schema; do not use another task's example."].join("\n");
  const reason = failure === "resume_tailor_requirement_out_of_scope" || failure === "resume_tailor_requirement_binding_failed" ? "requirementIds did not match the supplied IDs" : failure === "resume_tailor_after_missing" ? "after was missing" : failure === "resume_tailor_no_op" ? "after was identical to before" : failure === "no_change_needed" ? "the response contained no suggestion" : failure ?? "schema validation failed";
  return [baseUserPrompt, "", `Previous response failed because ${reason}.`, "Return only:", '{"suggestions":[{"after":"...","rationale":"...","requirementIds":["an ID copied from relevantRequirements"]}]}'].join("\n");
}
