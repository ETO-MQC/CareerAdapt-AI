import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HERMES_PRODUCTION_TOOL_PROFILE } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import {
  CAREER_AGENT_EVAL_CATEGORIES,
  CareerAgentEvalCaseSchema,
  careerAgentEvalCases,
  hermesCareerAgentEvalCases,
  mappedCareerAgentEvalCases
} from "../agent-eval/cases";

describe("P4.7b Career Agent evaluation fixtures", () => {
  it("contains the representative ten-category baseline without duplicate ids", () => {
    expect(careerAgentEvalCases).toHaveLength(39);
    expect(new Set(careerAgentEvalCases.map((caseDef) => caseDef.id)).size).toBe(careerAgentEvalCases.length);
    for (const category of CAREER_AGENT_EVAL_CATEGORIES) {
      expect(careerAgentEvalCases.filter((caseDef) => caseDef.category === category).length).toBeGreaterThan(0);
    }
    expect(hermesCareerAgentEvalCases).toHaveLength(27);
    expect(mappedCareerAgentEvalCases).toHaveLength(12);
  });

  it("validates every case's required, allowed, forbidden, and budget contract", () => {
    for (const caseDef of careerAgentEvalCases) {
      expect(() => CareerAgentEvalCaseSchema.parse(caseDef)).not.toThrow();
      expect(caseDef.requiredTools.every((tool) => caseDef.expectedTools.includes(tool))).toBe(true);
      expect(caseDef.expectedTools.every((tool) => caseDef.allowedTools.includes(tool))).toBe(true);
      expect(caseDef.expectedTools.some((tool) => caseDef.forbiddenTools.includes(tool))).toBe(false);
      expect(caseDef.expectedTools.length).toBeLessThanOrEqual(caseDef.efficiencyBudget.maxCareerTools);
      if (caseDef.harness === "existing") expect(caseDef.existingTestRefs.length).toBeGreaterThan(0);
    }
  });

  it("keeps Hermes cases inside the P4.7a production tool profile", () => {
    const visible = new Set<string>(HERMES_PRODUCTION_TOOL_PROFILE);
    for (const caseDef of hermesCareerAgentEvalCases) {
      expect(caseDef.expectedTools.every((tool) => visible.has(tool))).toBe(true);
      expect(caseDef.forbiddenTools).toContain("career.system.runtime_status");
      expect(caseDef.forbiddenTools).toContain("career.system.current_task");
      expect(caseDef.forbiddenTools).toContain("career.system.last_failure");
    }
  });

  it("points mapped safety and artifact cases at existing tests", () => {
    for (const caseDef of mappedCareerAgentEvalCases) {
      for (const reference of caseDef.existingTestRefs) {
        expect(existsSync(resolve(process.cwd(), reference)), `${caseDef.id} reference missing: ${reference}`).toBe(true);
      }
    }
    expect(mappedCareerAgentEvalCases.find((caseDef) => caseDef.id === "H5")?.safetyInvariants).toEqual(expect.arrayContaining([
      "job_resume_branch_isolated",
      "resume_revision_created",
      "source_general_resume_unchanged",
      "presentation_config_preserved"
    ]));
  });
});
