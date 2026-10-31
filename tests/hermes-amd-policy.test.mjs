import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { patchAmdReasoningTransport, patchAmdReasoningSummary } from "../scripts/hermes-amd-reasoning-patch.mjs";

test("AMD runtime patches are idempotent and reject an unknown upstream shape", () => {
  const root = ".electron-build/hermes-runtime-v4/source/";
  const transport = fs.readFileSync(root + "agent/transports/chat_completions.py", "utf8");
  const summary = fs.readFileSync(root + "agent/chat_completion_helpers.py", "utf8");
  assert.equal(patchAmdReasoningTransport(transport), transport);
  assert.equal(patchAmdReasoningSummary(summary), summary);
  assert.throws(() => patchAmdReasoningTransport("different upstream"), /shape changed/u);
  assert.throws(() => patchAmdReasoningSummary("different upstream"), /shape changed/u);
  assert.equal((summary.match(/careeradapt_amd_reasoning\(summary_kwargs/gu) ?? []).length, 2);
});

test("existing AMD success is recognized without issuing its before arm again", async () => {
  const { loadEvaluation, runRealEvaluation } = await import("../scripts/skills-quality-eval.mjs");
  const legacy = JSON.parse(fs.readFileSync("docs/quality/p5.1-sq1-quality-certification-20261031-amd-collection.json", "utf8"));
  const evaluation = loadEvaluation();
  evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
  let calls = 0;
  const result = await runRealEvaluation(evaluation, { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B", apiKey: "synthetic", completed: legacy.results }, async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Synthetic after only" }, finish_reason: "stop" }] }) };
  });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
  assert.equal(result[0].arm, "after");
  assert.equal(result[0].generationPolicy.reasoningEffort, "low");
});

test("CLI refuses a legacy AMD cohort after changing generation policy, without fetching", () => {
  const file = "docs/quality/p5.1-sq1-quality-certification-20261031-amd-collection.json";
  const original = fs.readFileSync(file, "utf8");
  const result = spawnSync(process.execPath, ["scripts/skills-quality-eval.mjs", "--real-provider", "--resume", file], {
    env: { ...process.env, SKILLS_QUALITY_BASE_URL: "https://developer.amd.com.cn/radeon/api/v1", SKILLS_QUALITY_MODEL: "Qwen3.8-27B", SKILLS_QUALITY_API_KEY: "offline-synthetic-invalid-key" },
    encoding: "utf8", windowsHide: true, timeout: 5000
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /quality_resume_configuration_mismatch/u);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});
