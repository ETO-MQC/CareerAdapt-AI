import { describe, expect, it } from "vitest";
import { aiTaskRegistry } from "@/ai/tasks/registry";
import type { ResumeJsonMapperOutput } from "@/domain/schemas";

describe("resume-json-mapper task boundary", () => {
  const definition = aiTaskRegistry["resume-json-mapper"];
  const rawText = JSON.stringify({ profile: { name: "林同学" } });
  const input = { rawText, inputHash: "mapper-input-hash" };

  it("accepts traceable source-exact mapped facts", () => {
    expect(() => definition.validateOutput(output("林同学"), input)).not.toThrow();
  });

  it("rejects source path mismatches and invented facts", () => {
    const wrongPath = output("林同学");
    wrongPath.structuredDraft.basics.name = {
      value: "林同学",
      mapping: trace("profile.missing", "林同学")
    };
    expect(() => definition.validateOutput(wrongPath, input)).toThrow("resume_json_mapper_source_mismatch");
    expect(() => definition.validateOutput(output("虚构姓名"), input)).toThrow("resume_json_mapper_invented_content");
  });
});

function output(value: string): ResumeJsonMapperOutput {
  return {
    structuredDraft: {
      basics: { name: { value, mapping: trace("profile.name", "林同学") } },
      sections: []
    },
    unclassifiedBlocks: []
  };
}

function trace(sourcePath: string, sourceValue: string) {
  return {
    sourcePaths: [sourcePath],
    sourceValues: [sourceValue],
    confidenceLevel: "high" as const,
    confidenceReason: "exact source field",
    needsConfirmation: true
  };
}
