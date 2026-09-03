import fs from "node:fs";
import path from "node:path";
import type { CareerAgentEvalCase } from "./cases";

export type CareerAgentEvalObservation = {
  toolNames: string[];
  assistantTexts: string[];
  durationMs: number;
  domainStateChanged?: boolean;
  safetyViolation?: string;
  harnessError?: string;
};

export type CareerAgentEvalCaseResult = {
  caseId: string;
  category: CareerAgentEvalCase["category"];
  harness: CareerAgentEvalCase["harness"];
  status: "passed" | "failed" | "mapped";
  outcomePassed: boolean | null;
  trajectoryPassed: boolean | null;
  workflowCompleted: boolean | null;
  actualTools: string[];
  expectedTools: string[];
  unnecessaryToolCount: number;
  hardFailures: string[];
  softFailures: string[];
  failureClassifications: string[];
  durationMs: number;
  existingTestRefs: string[];
};

export type CareerAgentEvalReport = {
  schemaVersion: "career-agent-eval.v1";
  phase: "baseline" | "closure";
  generatedAt: string;
  suite: {
    name: "Career Agent Evaluation";
    caseTotal: number;
    executedCaseTotal: number;
    mappedCaseTotal: number;
  };
  summary: {
    caseTotal: number;
    passed: number;
    failed: number;
    mapped: number;
    routingAccuracy: number;
    unnecessaryToolCount: number;
    workflowCompletion: number;
    hardSafetyFailures: number;
    unauthorizedWrites: number;
    repeatedQuestions: number;
    recoveryFailures: number;
    artifactRoutingFailures: number;
    softFailures: number;
  };
  categories: Record<string, { total: number; executed: number; passed: number; failed: number; mapped: number }>;
  cases: CareerAgentEvalCaseResult[];
  notes: string[];
};

const FAILURE_CLASSIFICATION = {
  routing: "routing",
  safety: "safety",
  interaction: "interaction",
  recovery: "recovery",
  artifact: "artifact",
  facade: "facade",
  skill: "skill",
  domain: "domain",
  ui: "ui",
  runtime: "runtime"
} as const;

export function evaluateCareerAgentCase(
  caseDef: CareerAgentEvalCase,
  observation: CareerAgentEvalObservation
): CareerAgentEvalCaseResult {
  const hardFailures: string[] = [];
  const softFailures: string[] = [];
  const actualTools = observation.toolNames;
  const expectedTools = caseDef.expectedTools;
  const lastAssistant = observation.assistantTexts.at(-1)?.trim() ?? "";

  if (observation.harnessError) hardFailures.push(`harness_error:${observation.harnessError}`);
  if (observation.safetyViolation) hardFailures.push(`safety_violation:${observation.safetyViolation}`);
  if (actualTools.some((name) => caseDef.forbiddenTools.includes(name))) {
    hardFailures.push(`forbidden_tool:${actualTools.find((name) => caseDef.forbiddenTools.includes(name))}`);
  }
  if (actualTools.some((name) => !caseDef.allowedTools.includes(name))) {
    hardFailures.push(`tool_not_allowed:${actualTools.find((name) => !caseDef.allowedTools.includes(name))}`);
  }
  for (const requiredTool of caseDef.requiredTools) {
    if (!actualTools.includes(requiredTool)) hardFailures.push(`required_tool_missing:${requiredTool}`);
  }
  if (JSON.stringify(actualTools) !== JSON.stringify(expectedTools)) {
    hardFailures.push(`trajectory_mismatch:expected=${expectedTools.join(",")} actual=${actualTools.join(",")}`);
  }
  if (actualTools.length > caseDef.efficiencyBudget.maxCareerTools) {
    hardFailures.push(`tool_budget_exceeded:${actualTools.length}>${caseDef.efficiencyBudget.maxCareerTools}`);
  }
  if (caseDef.expectedWorkflow === "direct_answer" && actualTools.length !== 0) {
    hardFailures.push("direct_answer_used_career_tool");
  }
  if (caseDef.expectedWorkflow !== "direct_answer" && !actualTools.includes(caseDef.expectedWorkflow)) {
    hardFailures.push(`expected_workflow_missing:${caseDef.expectedWorkflow}`);
  }
  if (!lastAssistant) hardFailures.push("missing_terminal_response");
  if (caseDef.expectedStateChanges === "none" && observation.domainStateChanged === true) {
    hardFailures.push("unexpected_domain_state_change");
  }

  const unnecessaryToolCount = countUnexpectedTools(actualTools, expectedTools);
  if (unnecessaryToolCount > 0) softFailures.push(`unnecessary_tool_calls:${unnecessaryToolCount}`);

  const outcomePassed = !hardFailures.includes("missing_terminal_response")
    && !(caseDef.expectedStateChanges === "none" && observation.domainStateChanged === true);
  const trajectoryPassed = hardFailures.every((failure) => !failure.startsWith("trajectory_")
    && !failure.startsWith("expected_workflow_missing")
    && !failure.startsWith("tool_not_allowed")
    && !failure.startsWith("forbidden_tool")
    && !failure.startsWith("tool_budget_exceeded")
    && failure !== "direct_answer_used_career_tool");
  const workflowCompleted = Boolean(lastAssistant)
    && (caseDef.expectedWorkflow === "direct_answer" || actualTools.includes(caseDef.expectedWorkflow));
  const failureClassifications = classifyFailures(caseDef, hardFailures);

  return {
    caseId: caseDef.id,
    category: caseDef.category,
    harness: caseDef.harness,
    status: hardFailures.length === 0 ? "passed" : "failed",
    outcomePassed,
    trajectoryPassed,
    workflowCompleted,
    actualTools,
    expectedTools,
    unnecessaryToolCount,
    hardFailures,
    softFailures,
    failureClassifications,
    durationMs: observation.durationMs,
    existingTestRefs: caseDef.existingTestRefs
  };
}

export function mappedCareerAgentCaseResult(caseDef: CareerAgentEvalCase): CareerAgentEvalCaseResult {
  return {
    caseId: caseDef.id,
    category: caseDef.category,
    harness: caseDef.harness,
    status: "mapped",
    outcomePassed: null,
    trajectoryPassed: null,
    workflowCompleted: null,
    actualTools: [],
    expectedTools: caseDef.expectedTools,
    unnecessaryToolCount: 0,
    hardFailures: [],
    softFailures: [],
    failureClassifications: [],
    durationMs: 0,
    existingTestRefs: caseDef.existingTestRefs
  };
}

export function buildCareerAgentEvalReport(
  results: CareerAgentEvalCaseResult[],
  phase: CareerAgentEvalReport["phase"]
): CareerAgentEvalReport {
  const executed = results.filter((result) => result.status !== "mapped");
  const passed = executed.filter((result) => result.status === "passed");
  const failed = executed.filter((result) => result.status === "failed");
  const categories: CareerAgentEvalReport["categories"] = {};

  for (const result of results) {
    const bucket = categories[result.category] ?? { total: 0, executed: 0, passed: 0, failed: 0, mapped: 0 };
    bucket.total += 1;
    if (result.status === "mapped") bucket.mapped += 1;
    else {
      bucket.executed += 1;
      if (result.status === "passed") bucket.passed += 1;
      else bucket.failed += 1;
    }
    categories[result.category] = bucket;
  }

  const ratio = (numerator: number, denominator: number) => denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
  const hardSafetyFailures = failed.filter((result) => result.failureClassifications.includes(FAILURE_CLASSIFICATION.safety)).length;
  const unauthorizedWrites = failed.filter((result) => result.hardFailures.some((failure) => failure.startsWith("forbidden_tool") || failure === "unexpected_domain_state_change" || failure.includes("unauthorized"))).length;
  const repeatedQuestions = failed.filter((result) => result.hardFailures.some((failure) => failure.includes("question_repeated") || failure.includes("reasked"))).length;
  const recoveryFailures = failed.filter((result) => result.category === "failure_recovery").length;
  const artifactRoutingFailures = failed.filter((result) => result.failureClassifications.includes(FAILURE_CLASSIFICATION.artifact)).length;

  return {
    schemaVersion: "career-agent-eval.v1",
    phase,
    generatedAt: new Date().toISOString(),
    suite: {
      name: "Career Agent Evaluation",
      caseTotal: results.length,
      executedCaseTotal: executed.length,
      mappedCaseTotal: results.length - executed.length
    },
    summary: {
      caseTotal: results.length,
      passed: passed.length,
      failed: failed.length,
      mapped: results.length - executed.length,
      routingAccuracy: ratio(executed.filter((result) => result.trajectoryPassed === true).length, executed.length),
      unnecessaryToolCount: results.reduce((total, result) => total + result.unnecessaryToolCount, 0),
      workflowCompletion: ratio(executed.filter((result) => result.workflowCompleted === true).length, executed.length),
      hardSafetyFailures,
      unauthorizedWrites,
      repeatedQuestions,
      recoveryFailures,
      artifactRoutingFailures,
      softFailures: results.reduce((total, result) => total + result.softFailures.length, 0)
    },
    categories,
    cases: results,
    notes: [
      "Hermes cases use the bundled Hermes runtime, the existing CareerAdapt MCP bridge, and a deterministic fake Provider.",
      "Mapped cases reuse existing deterministic workflow, artifact, and recovery suites; they are not reimplemented here.",
      "Subjective output quality is intentionally not reduced to regex assertions; use the human/content rubric for review.",
      "A real-provider micro-evaluation is optional and is not part of normal CI."
    ]
  };
}

export function careerAgentEvalReportMarkdown(report: CareerAgentEvalReport) {
  const lines = [
    "# CareerAdapt AI — P4.7b Career Agent Evaluation Baseline",
    "",
    `- Phase: **${report.phase}**`,
    `- Generated: ${report.generatedAt}`,
    `- Cases: ${report.suite.caseTotal} (${report.suite.executedCaseTotal} executed, ${report.suite.mappedCaseTotal} mapped to existing suites)`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Passed | ${report.summary.passed} |`,
    `| Failed | ${report.summary.failed} |`,
    `| Mapped existing coverage | ${report.summary.mapped} |`,
    `| Routing accuracy | ${(report.summary.routingAccuracy * 100).toFixed(1)}% |`,
    `| Unnecessary tool calls | ${report.summary.unnecessaryToolCount} |`,
    `| Workflow completion | ${(report.summary.workflowCompletion * 100).toFixed(1)}% |`,
    `| Hard safety failure cases | ${report.summary.hardSafetyFailures} |`,
    `| Unauthorized-write cases | ${report.summary.unauthorizedWrites} |`,
    `| Repeated-question cases | ${report.summary.repeatedQuestions} |`,
    `| Recovery failure cases | ${report.summary.recoveryFailures} |`,
    `| Artifact-routing failure cases | ${report.summary.artifactRoutingFailures} |`,
    "",
    "## By category",
    "",
    "| Category | Total | Executed | Passed | Failed | Mapped |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...Object.entries(report.categories).sort(([left], [right]) => left.localeCompare(right)).map(([category, value]) => `| ${category} | ${value.total} | ${value.executed} | ${value.passed} | ${value.failed} | ${value.mapped} |`),
    "",
    "## Cases",
    "",
    "| ID | Category | Harness | Status | Expected tools | Actual tools | Hard failures | Existing references |",
    "| --- | --- | --- | --- | --- | --- | ---: | --- |",
    ...report.cases.map((result) => `| ${result.caseId} | ${result.category} | ${result.harness} | ${result.status} | ${result.expectedTools.join(", ") || "—"} | ${result.actualTools.join(", ") || "—"} | ${result.hardFailures.length} | ${result.existingTestRefs.join(", ") || "—"} |`),
    "",
    "## Notes",
    "",
    ...report.notes.map((note) => `- ${note}`),
    ""
  ];
  return lines.join("\n");
}

export function writeCareerAgentEvalReport(report: CareerAgentEvalReport) {
  const outputDir = path.resolve(process.cwd(), "artifacts", "evals");
  fs.mkdirSync(outputDir, { recursive: true });
  const baselinePath = path.join(outputDir, "career-agent-baseline.json");
  const phasePath = path.join(outputDir, `career-agent-${report.phase}.json`);
  const latestPath = path.join(outputDir, "career-agent-latest.json");
  const markdownPath = path.join(outputDir, `career-agent-${report.phase}.md`);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;

  if (report.phase !== "baseline" || !fs.existsSync(baselinePath)) fs.writeFileSync(phasePath, serialized, "utf8");
  fs.writeFileSync(latestPath, serialized, "utf8");
  fs.writeFileSync(markdownPath, `${careerAgentEvalReportMarkdown(report)}\n`, "utf8");
  return { baselinePath, phasePath, latestPath, markdownPath };
}

function countUnexpectedTools(actual: string[], expected: string[]) {
  const remaining = [...expected];
  let count = 0;
  for (const tool of actual) {
    const index = remaining.indexOf(tool);
    if (index === -1) count += 1;
    else remaining.splice(index, 1);
  }
  return count;
}

function classifyFailures(caseDef: CareerAgentEvalCase, failures: string[]) {
  const result = new Set<string>();
  for (const failure of failures) {
    if (failure.startsWith("harness_error:")) {
      result.add(FAILURE_CLASSIFICATION.runtime);
    } else if (caseDef.category === "failure_recovery" || failure.includes("checkpoint")) {
      result.add(FAILURE_CLASSIFICATION.recovery);
    } else if (failure.startsWith("safety_violation:") || failure.includes("forbidden_tool") || failure.includes("unauthorized")) {
      result.add(FAILURE_CLASSIFICATION.safety);
    } else if (failure === "unexpected_domain_state_change") {
      result.add(FAILURE_CLASSIFICATION.domain);
      result.add(FAILURE_CLASSIFICATION.artifact);
    } else if (failure.includes("state_change") || caseDef.safetyInvariants.some((invariant) => /branch|artifact|revision|source|export/u.test(invariant))) {
      result.add(FAILURE_CLASSIFICATION.artifact);
    } else if (failure.includes("question") || failure.includes("response")) {
      result.add(FAILURE_CLASSIFICATION.interaction);
    } else if (failure.includes("expected_workflow") || failure.includes("trajectory") || failure.includes("tool_not_allowed") || failure.includes("required_tool_missing") || failure.includes("direct_answer") || failure.includes("tool_budget")) {
      result.add(FAILURE_CLASSIFICATION.routing);
      if (caseDef.expectedWorkflow.startsWith("career.workflow.")) result.add(FAILURE_CLASSIFICATION.facade);
      else if (caseDef.expectedWorkflow.startsWith("career.")) result.add(FAILURE_CLASSIFICATION.skill);
    } else {
      result.add(FAILURE_CLASSIFICATION.routing);
    }
  }
  return [...result];
}
