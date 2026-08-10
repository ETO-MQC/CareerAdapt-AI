import type { AiTask } from "@/domain/schemas";
import type { SafeSchemaIssue } from "@/ai/resumeDocumentMapperDiagnostics";

export function buildRetryPrompt({
  task,
  baseUserPrompt,
  failure,
  input,
  issues
}: {
  task: AiTask;
  baseUserPrompt: string;
  failure?: string;
  input?: unknown;
  issues?: SafeSchemaIssue[];
}) {
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
  if (task === "profile-intake-semantic") {
    return [
      baseUserPrompt,
      "",
      `Previous profile-intake-semantic response failed (${failure ?? "schema validation failed"}).`,
      "Never output null. Omit every unsupported or unknown optional candidate field instead.",
      "Return exactly one object with only candidates and optional followUpQuestion.",
      "For each candidate, choose one exact continuous rawNarrative substring that contains only that candidate's experience.",
      "Set candidate.sourceQuote to that substring and set every fieldEvidence.sourceQuote for that candidate to exactly the same substring.",
      "For every populated factual candidate field and every non-empty list, add at least one fieldEvidence item whose field exactly matches that candidate key. titleKind is metadata and uses field=title evidence.",
      "Values for name, organization, institution, role, titleKind=explicit, tools, and methods must appear verbatim in that candidate source substring; never paraphrase or broaden them.",
      "Only return a YYYY-MM date when both its year and month are explicitly present in that candidate source substring.",
      "Set current=true only when the candidate source explicitly says the experience is ongoing; a missing end date is not evidence, so otherwise set current=false.",
      "If a field needs evidence outside that substring, split it into another candidate or omit the unsupported field. Never combine evidence from separate experiences.",
      "Do not normalize punctuation, dates, spacing, or wording in sourceQuote.",
      "Return only the corrected compact JSON object. Do not add a wrapper or explanation."
    ].join("\n");
  }
  if (task === "profile-intake-follow-up-patch") {
    return [
      baseUserPrompt,
      "",
      `Previous profile-intake-follow-up-patch response failed (${failure ?? "schema validation failed"}).`,
      "Return only one object with candidateId, patch, evidenceQuote, answeredDimension, and confidence.",
      "Copy candidateId and answeredDimension exactly from the input.",
      "evidenceQuote must be an exact substring of currentUserAnswer.",
      "patch must contain only grounded changed fields for the named section; omit malformed, unsupported, or uncertain optional fields.",
      "Return a partial patch rather than a complete item or a new candidate."
    ].join("\n");
  }
  if (task === "profile-intake-final-career-synthesis") {
    return [
      baseUserPrompt,
      "",
      `Previous profile-intake-final-career-synthesis response failed (${failure ?? "schema validation failed"}).`,
      "Preserve every supplied candidateId and structuredItem exactly.",
      "Return only {\"assets\":[{\"candidateId\":\"copied\",\"structuredItem\":{},\"careerReadySummary\":\"grounded\",\"careerReadyHighlights\":[],\"missingDimensions\":[],\"conflicts\":[]}]}.",
      "Every highlight must be supported by the matching source turns; omit unsupported claims, filler, summary echoes, and ownership upgrades."
    ].join("\n");
  }
  if (task === "resume-document-mapper") {
    const safeIssues = (issues ?? []).slice(0, 12).map((issue) => {
      const keys = issue.unrecognizedKeys?.length
        ? ` (${issue.unrecognizedKeys.join(", ")})`
        : "";
      return `- ${issue.path || "<root>"}: ${issue.code}${keys}`;
    });
    return [
      baseUserPrompt,
      "",
      "Previous output failed schema validation.",
      ...(safeIssues.length ? ["Issues:", ...safeIssues] : [`Issue code: ${failure ?? "model_schema_invalid"}`]),
      "Return only {\"resume\":{\"schemaVersion\":\"careeradapt-resume-v2\",\"basics\":{},\"sections\":[]},\"sourceRefs\":[]}.",
      "Do not return structuredDraft, mappingDecisions, sourceValues, category, included, parser metadata, or another wrapper.",
      "Use typed CareerAdapt v2 item fields directly: education.school/major/degree; project.title/role/tools; skills.name/category/level/description; awards/certificates/languages use their own fields.",
      "Each basic field needs a field-level sourceRef, and each item needs an item-level sourceRef whose blockIds cover all factual fields.",
      "sourceRefs use path, blockIds, confidenceLevel, confidenceReason, needsConfirmation. confidenceLevel is high, medium, or low; medium/low require needsConfirmation=true.",
      "Return compact JSON only."
    ].join("\n");
  }
  if (!task.startsWith("resume-tailor")) return [baseUserPrompt, "", `Previous ${task} response failed (${failure ?? "schema validation failed"}).`, "Return only compact JSON matching this task's requested schema; do not use another task's example."].join("\n");
  const reason = failure === "resume_tailor_requirement_out_of_scope" || failure === "resume_tailor_requirement_binding_failed" ? "requirementIds did not match the supplied IDs" : failure === "resume_tailor_after_missing" ? "after was missing" : failure === "resume_tailor_no_op" ? "after was identical to before" : failure === "no_change_needed" ? "the response contained no suggestion" : failure ?? "schema validation failed";
  return [baseUserPrompt, "", `Previous response failed because ${reason}.`, "Return only:", '{"suggestions":[{"after":"...","rationale":"...","requirementIds":["an ID copied from relevantRequirements"]}]}'].join("\n");
}
