import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { core02EvalCases } from "../agent-eval/core02-cases";

describe("Core-02 frozen anonymous scenario manifest", () => {
  it("retains the 8/8/8/8/4/4 distribution and resolvable nonempty executable oracles", () => {
    expect(core02EvalCases).toHaveLength(40);
    expect(new Set(core02EvalCases.map(row => row.id)).size).toBe(40);
    for (const [category, count] of Object.entries({ intent: 8, intake: 8, job: 8, resume_safety: 8, fit: 4, recovery: 4 })) {
      expect(core02EvalCases.filter(row => row.category === category)).toHaveLength(count);
    }
    for (const scenario of core02EvalCases) {
      expect(scenario.testTitle.length).toBeGreaterThan(10);
      expect(readFileSync(scenario.testFile, "utf8"), scenario.id).toContain(scenario.testTitle);
    }
  });
});
