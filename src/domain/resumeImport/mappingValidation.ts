import { getResumeFieldDefinition } from "@/domain/resumeFields";
import type { MappingDecision, NormalizedSourceBlock } from "@/domain/schemas";

export type MappingValidationIssue = { decisionIndex: number; code: "unknown_source" | "quote_not_found" | "field_section_mismatch"; message: string };

export function validateMappingDecisions(decisions: readonly MappingDecision[], sourceBlocks: readonly NormalizedSourceBlock[]): MappingValidationIssue[] {
  const byId = new Map(sourceBlocks.map((block) => [block.id, block]));
  const issues: MappingValidationIssue[] = [];
  decisions.forEach((decision, decisionIndex) => {
    for (const sourceBlockId of decision.sourceBlockIds) {
      const source = byId.get(sourceBlockId);
      if (!source) {
        issues.push({ decisionIndex, code: "unknown_source", message: `source block does not exist: ${sourceBlockId}` });
        continue;
      }
      const haystack = `${source.rawText}\n${source.text}\n${source.normalizedText}`;
      if (!normalize(haystack).includes(normalize(decision.sourceQuote))) {
        issues.push({ decisionIndex, code: "quote_not_found", message: `source quote cannot be located in block: ${sourceBlockId}` });
      }
    }
    if (decision.kind === "canonical_field") {
      const field = getResumeFieldDefinition(decision.targetFieldId);
      if (!field || !decision.targetFieldId.startsWith(`${field.sectionType}.`)) {
        issues.push({ decisionIndex, code: "field_section_mismatch", message: `canonical field is not compatible with its section: ${decision.targetFieldId}` });
      }
    }
  });
  return issues;
}

export function canSilentlyConfirmMapping(decision: MappingDecision) {
  return "confidence" in decision && decision.confidence >= 0.85 && !decision.needsConfirmation;
}

function normalize(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}
