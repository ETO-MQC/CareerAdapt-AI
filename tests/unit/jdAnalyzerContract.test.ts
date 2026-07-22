import { describe, expect, it } from "vitest";
import { normalizeJdConfidence, normalizeJdUnitAssignment, stageBTaskRegistry } from "@/ai/tasks/registry";
import { JdAnalyzerModelOutputSchema } from "@/domain/schemas";

describe("JD analyzer model contract", () => {
  it.each([["high", 0.9], ["medium", 0.7], ["low", 0.45]] as const)("normalizes confidence %s", (value, expected) => {
    expect(normalizeJdConfidence(value)).toBe(expected);
  });

  it("strips extra fields and permits accept without reason", () => {
    expect(normalizeJdUnitAssignment({ sourceUnitId: " unit-1 ", verdict: "ACCEPT", confidence: "high", sourceText: "private" })).toEqual({
      sourceUnitId: "unit-1", verdict: "accept", confidence: 0.9
    });
  });

  it("drops one invalid assignment without losing valid assignments", () => {
    const definition = stageBTaskRegistry["jd-analyzer"];
    const coerced = definition.coerceRawOutput({ unitAssignments: [{ sourceUnitId: "unit-1", verdict: "accept" }, { reason: "missing id" }] });
    const parsed = JdAnalyzerModelOutputSchema.parse(coerced);
    expect(parsed.unitAssignments).toEqual([{ sourceUnitId: "unit-1", verdict: "accept" }]);
    expect(parsed.riskNotes).toContain("assignment_schema_partial:1");
  });
});
