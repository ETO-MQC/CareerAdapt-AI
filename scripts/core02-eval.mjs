import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

// Use the existing development compiler so this script also works on Node 20.
const fixture = readFileSync(new URL("../tests/agent-eval/core02-cases.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(fixture, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { core02EvalCases } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const reportPath = process.argv[2] ?? ".tmp/core02-unit.json";
const report = JSON.parse(readFileSync(reportPath, "utf8"));
const results = core02EvalCases.map(scenario => {
  const suite = report.testResults.find(suite => suite.name.replaceAll("\\", "/").endsWith(scenario.testFile));
  const assertions = suite?.assertionResults.filter(assertion => assertion.fullName.includes(scenario.testTitle)) ?? [];
  return { ...scenario, status: assertions.length && assertions.every(assertion => assertion.status === "passed") ? "passed" : "unverified",
    matchedAssertions: assertions.length };
});
const output = { baselineVersion: "core02-eval-1", provider: "mapped-unit-integration-oracles", realModelQualityEvaluated: false,
  inputReport: reportPath, total: results.length, passed: results.filter(result => result.status === "passed").length, results };
writeFileSync(".tmp/core02-eval-results.json", JSON.stringify(output, null, 2));
console.log(`Core-02 mapped regression baseline: ${output.passed}/${output.total}; real model quality is not evaluated.`);
if (output.passed !== output.total) process.exitCode = 1;
