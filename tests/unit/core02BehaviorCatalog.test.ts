import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { core02BehaviorCases } from "../agent-eval/core02-behavior-cases";
it("keeps fourteen named integration cases and twelve independently executed behavior scenarios", () => {
  const source = readFileSync("tests/e2e/hermes-p46h-integration.spec.ts", "utf8");
  const cases = [...source.matchAll(/test\("CASE ([A-Z]) /gu)].map(match => match[1]).sort();
  expect(cases).toEqual("ABCDEFGHIJKLMN".split(""));
  expect(core02BehaviorCases).toHaveLength(12);
  expect(new Set(core02BehaviorCases.map(item => item.id)).size).toBe(12);
  for (const category of ["intent", "material", "job", "resume", "fit_tailoring", "recovery"]) {
    expect(core02BehaviorCases.filter(item => item.category === category)).toHaveLength(2);
  }
});
