import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import type { ResumeJsonMapperOutput } from "@/domain/schemas";

const definition = aiTaskRegistry["resume-document-mapper"];
const rawText = JSON.stringify([
  { id: "b1", normalizedText: "GPA：3.95/5.0，排名：1/42" },
  { id: "b2", normalizedText: "未分类来源" }
]);
const input = { rawText, inputHash: "document-mapper-input" };

describe("resume-document-mapper v2 boundary", () => {
  it("includes catalog metadata and requires complete source-block disposition", () => {
    const prompt = JSON.parse(definition.buildUserPrompt(input)) as Record<string, unknown>;
    expect(prompt).toMatchObject({ schemaVersion: "resume-import-v2" });
    expect(prompt.catalogVersion).toBeTypeOf("string");
    expect(prompt.canonicalFields).toEqual(expect.arrayContaining([expect.objectContaining({ id: "education.gpa", valueType: "number" })]));
    expect(() => definition.validateOutput(validOutput(), input)).not.toThrow();

    const dropped = validOutput();
    dropped.unclassifiedBlocks = [];
    expect(() => definition.validateOutput(dropped, input)).toThrow("resume_document_mapper_source_block_dropped");
    expect(definition.systemPrompt).toContain("untrusted DATA");
    expect(definition.systemPrompt).toContain("define structure only, never facts");
  });

  it("rejects a silent one-source-to-many-field decision", () => {
    const output = validOutput();
    output.mappingDecisions = [
      canonicalDecision("education.gpa", "3.95", false),
      canonicalDecision("education.gpaScale", "5.0", false)
    ];
    expect(() => definition.validateOutput(output, input)).toThrow("resume_document_mapper_shared_source_requires_confirmation");
  });

  it("rejects decision quotes that cannot be located in the cited block", () => {
    const output = validOutput();
    output.mappingDecisions = [canonicalDecision("education.gpa", "3.96", true)];
    expect(() => definition.validateOutput(output, input)).toThrow("resume_document_mapper_decision_quote_mismatch");
  });

  it("rejects a current flag when the cited source never says current", () => {
    const output = validOutput();
    const item = output.structuredDraft.sections[0].items[0];
    if (typeof item !== "string") item.current = true;
    expect(() => definition.validateOutput(output, input)).toThrow("resume_json_mapper_invented_current_status");
  });

  it("grounds sensitive placeholders against the redacted authoritative source", () => {
    const sensitiveRawText = JSON.stringify([
      { id: "contact", normalizedText: "电话：13800000000" }
    ]);
    const output: ResumeJsonMapperOutput = {
      structuredDraft: {
        basics: { phone: "[PHONE_1]" },
        sections: []
      },
      mappingDecisions: [{
        kind: "canonical_field",
        targetFieldId: "basics.phone",
        sourceBlockIds: ["contact"],
        sourceQuote: "[PHONE_1]",
        confidence: 0.99,
        needsConfirmation: false,
        mappingReason: "exact redacted source"
      }],
      unclassifiedBlocks: []
    };

    expect(() => definition.validateOutput(output, {
      rawText: sensitiveRawText,
      inputHash: "sensitive-document-mapper-input"
    })).not.toThrow();
  });
});

function validOutput(): ResumeJsonMapperOutput {
  return {
    structuredDraft: {
      basics: {},
      sections: [{
        title: "教育背景",
        sectionType: "experience",
        category: "education",
        included: false,
        items: [{
          text: "GPA：3.95/5.0，排名：1/42",
          included: false,
          mapping: {
            sourcePaths: ["b1"],
            sourceValues: ["GPA：3.95/5.0，排名：1/42"],
            confidenceLevel: "medium",
            confidenceReason: "来源块逐字引用",
            needsConfirmation: true
          }
        }]
      }]
    },
    mappingDecisions: [canonicalDecision("education.gpa", "3.95", true)],
    unclassifiedBlocks: [{ sourcePath: "b2", sourceValue: "未分类来源", reason: "尚未映射" }]
  };
}

function canonicalDecision(targetFieldId: "education.gpa" | "education.gpaScale", sourceQuote: string, needsConfirmation: boolean) {
  return {
    kind: "canonical_field" as const,
    targetFieldId,
    sourceBlockIds: ["b1"],
    sourceQuote,
    confidence: 0.9,
    needsConfirmation,
    mappingReason: "exact source"
  };
}
