import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashSkill, loadEvaluation, qualityMetrics } from "./skills-quality-eval.mjs";

export function buildBlindReview(collection, evaluation, seed = "SQ1-QC-20261031-v1") {
  const answerKey = { seed, mapping: [] };
  const cases = evaluation.fixture.cases.map(scenario => {
    const pair = ["before", "after"].map(arm => collection.results.filter(row => row.caseId === scenario.id && row.arm === arm && row.completionStatus === "COMPLETED"));
    if (pair.some(rows => rows.length !== 1)) throw new Error(`quality_blind_incomplete:${scenario.id}`);
    const arms = Number.parseInt(hashSkill(`${seed}:${scenario.id}`).slice(0, 2), 16) % 2 ? ["after", "before"] : ["before", "after"];
    answerKey.mapping.push({ caseId: scenario.id, A: arms[0], B: arms[1] });
    const responses = Object.fromEntries(arms.map((arm, index) => [index === 0 ? "A" : "B", pair[arm === "before" ? 0 : 1][0].anonymizedResult]));
    return { caseId: scenario.id, category: scenario.category, prompt: scenario.prompt,
      fixedFollowUp: scenario.followUpTurns, acceptanceCriteria: scenario.rubric, responses,
      rubric: Object.fromEntries(qualityMetrics.map(name => [name, null])),
      acceptance: { A: "NEEDS_REVIEW", B: "NEEDS_REVIEW" }, pairwisePreference: "NEEDS_REVIEW", reason: null };
  });
  return { pack: { scope: "Direct Skill policy only; no actual tool/write evidence", cases }, answerKey };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const collection = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const { pack, answerKey } = buildBlindReview(collection, loadEvaluation());
  const prefix = "docs/quality/skills-quality-v1-blind-review";
  const files = [`${prefix}.json`, `${prefix}-pack.md`, `${prefix}-answer-key.json`];
  if (files.some(file => fs.existsSync(file))) throw new Error("quality_blind_output_exists");
  fs.writeFileSync(files[0], JSON.stringify(pack, null, 2) + "\n");
  fs.writeFileSync(files[2], JSON.stringify(answerKey, null, 2) + "\n");
  const markdown = ["# SQ1 Blind Review", "", "Review both responses against the original acceptance criteria. Do not consult the separate answer key until review is complete.",
    "Question usefulness, recruiter relevance, wording, verbosity and actionability require independent review. No overall numeric score.", "",
    ...pack.cases.flatMap(row => [`## ${row.caseId}`, "", row.prompt, "", `Acceptance: ${row.acceptanceCriteria}`, "",
      `Fixed follow-up: ${JSON.stringify(row.fixedFollowUp)}`, "",
      ...["A", "B"].flatMap(label => [`### Response ${label}`, "", ...row.responses[label].flatMap((text, index) => [`Turn ${index + 1}`, "", text, ""])]),
      `Rubric: ${qualityMetrics.join(", ")}`, "", "Acceptance A/B: NEEDS_REVIEW. Pairwise preference: NEEDS_REVIEW. Reason: pending.", ""])
  ].join("\n");
  fs.writeFileSync(files[1], markdown);
  console.log("Blind pack generated; answer key stored separately. Independent review pending.");
}
