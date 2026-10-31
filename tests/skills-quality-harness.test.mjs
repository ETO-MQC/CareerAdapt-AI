import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEvaluation, runRealEvaluation, resolveQualityGenerationPolicy } from "../scripts/skills-quality-eval.mjs";
import { buildBlindReview } from "../scripts/skills-quality-blind-review.mjs";
import http from "node:http";
import fs from "node:fs";
import { spawn } from "node:child_process";

test("failure preserves partial turns; explicit continuation skips completed arms and numbers attempts", async () => {
  const evaluation = loadEvaluation();
  evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases.find(row => row.id === "guided_clarification-01")] };
  const attempts = [], completed = [];
  const settings = { baseUrl: "https://synthetic.invalid/v1", apiKey: "test", model: "test", attempts, completed,
    onAttempt: row => attempts.push(row), onRecord: row => completed.push(row) };
  let calls = 0;
  const ok = { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "匿名回复？" }, finish_reason: "stop" }] }) };
  await assert.rejects(runRealEvaluation(evaluation, settings, async () => {
    if (++calls === 4) throw new DOMException("timeout", "TimeoutError");
    return ok;
  }));
  assert.equal(completed.length, 1);
  assert.equal(attempts[1].errorClassification, "TIMEOUT");
  assert.deepEqual(attempts[1].partialResponses, ["匿名回复？"]);
  let resumed = 0;
  await runRealEvaluation(evaluation, settings, async () => { resumed++; return ok; });
  assert.equal(resumed, 2);
  assert.equal(completed.length, 2);
  assert.equal(attempts[2].attemptNumber, 2);
  assert.equal(attempts[2].previousFailure, "TIMEOUT");
  assert.equal(completed[1].turnCount, 2);
  assert.equal(completed[1].questionCount, 2);
  assert.ok(completed[1].requestTiming.every(row => row.totalMs >= 0));
});

test("HTTP and invalid JSON failures are retained without retry", async () => {
  for (const [response, classification] of [
    [{ ok: false, status: 429 }, "HTTP_ERROR"],
    [{ ok: true, json: async () => { throw new SyntaxError("invalid JSON"); } }, "PARSE_ERROR"]
  ]) {
    const evaluation = loadEvaluation();
    evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
    const attempts = [];
    let calls = 0;
    await assert.rejects(runRealEvaluation(evaluation, { baseUrl: "https://synthetic.invalid", apiKey: "test", model: "test", onAttempt: row => attempts.push(row) }, async () => { calls++; return response; }));
    assert.equal(calls, 1);
    assert.equal(attempts[0].errorClassification, classification);
  }
});

test("AMD uses identical bounded low policy in both arms; other routes retain existing parameters", async () => {
  const evaluation = loadEvaluation();
  evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
  const requests = [];
  const results = await runRealEvaluation(evaluation, { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", apiKey: "synthetic", model: "Qwen3.8-27B" }, async (_url, request) => {
    requests.push(JSON.parse(request.body));
    return { ok: true, json: async () => ({ choices: [{ message: { content: "Answer", reasoning: "PRIVATE_REASONING_NOT_TO_SAVE" }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 10 } } }) };
  });
  for (const body of requests) assert.deepEqual({ reasoning_effort: body.reasoning_effort, max_tokens: body.max_tokens, temperature: body.temperature }, { reasoning_effort: "low", max_tokens: 2048, temperature: 0 });
  assert.doesNotMatch(JSON.stringify(results), /PRIVATE_REASONING_NOT_TO_SAVE/u);
  assert.equal(results[0].requestTiming[0].reasoningChars, 29);
  assert.deepEqual(resolveQualityGenerationPolicy({ baseUrl: "https://other.invalid/v1", model: "Qwen3.8-27B" }), { temperature: 0 });
  assert.deepEqual(resolveQualityGenerationPolicy({ baseUrl: "https://developer.amd.com.cn/v1", model: "other" }), { temperature: 0 });
});

test("budget exhaustion stops at one request, retains counters, and never saves reasoning", async () => {
  for (const [content, finish] of [["truncated", "length"], ["", "stop"]]) {
    const evaluation = loadEvaluation();
    evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
    const attempts = []; let calls = 0;
    await assert.rejects(runRealEvaluation(evaluation, { baseUrl: "https://developer.amd.com.cn/v1", apiKey: "synthetic", model: "Qwen3.8-27B", onAttempt: row => attempts.push(row) }, async () => {
      calls++; return { ok: true, json: async () => ({ choices: [{ message: { content, reasoning: "PRIVATE_REASONING" }, finish_reason: finish }], usage: { completion_tokens: 2048 } }) };
    }), { code: "QUALITY_OUTPUT_BUDGET_EXHAUSTED" });
    assert.equal(calls, 1); assert.equal(attempts[0].errorClassification, "QUALITY_OUTPUT_BUDGET_EXHAUSTED");
    assert.doesNotMatch(JSON.stringify(attempts), /PRIVATE_REASONING/u);
  }
});

test("explicitly authorized larger budgets are sent and recorded without changing the default", async () => {
  const evaluation = loadEvaluation();
  evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
  for (const budget of [8192, 16384]) {
    const results = await runRealEvaluation(evaluation, { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B", apiKey: "synthetic", qualityMaxTokens: budget }, async (_url, request) => {
      const body = JSON.parse(request.body);
      assert.equal(body.max_tokens, budget);
      assert.equal(body.reasoning_effort, "low");
      assert.equal(body.temperature, 0);
      return { ok: true, json: async () => ({ choices: [{ message: { content: "Synthetic answer" }, finish_reason: "stop" }] }) };
    });
    assert.ok(results.every(row => row.generationPolicy.maxTokens === budget && row.requestTiming[0].parameters.maxTokens === budget));
  }
  assert.equal(resolveQualityGenerationPolicy({ baseUrl: "https://developer.amd.com.cn/v1", model: "Qwen3.8-27B" }).maxTokens, 2048);
  assert.throws(() => resolveQualityGenerationPolicy({ baseUrl: "https://developer.amd.com.cn/v1", model: "Qwen3.8-27B", qualityMaxTokens: -1 }), /quality_max_tokens_invalid/u);
});

test("explicit eight-minute probe uses the approved abort deadline; default remains two minutes", async () => {
  const evaluation = loadEvaluation();
  evaluation.fixture = { ...evaluation.fixture, cases: [evaluation.fixture.cases[0]] };
  const original = AbortSignal.timeout;
  const deadlines = [];
  AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return original(milliseconds); };
  try {
    const settings = { baseUrl: "https://developer.amd.com.cn/radeon/api/v1", model: "Qwen3.8-27B", apiKey: "synthetic", qualityMaxTokens: 16384, qualityTimeoutMs: 480000 };
    const response = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "Synthetic answer" }, finish_reason: "stop" }] }) });
    const result = await runRealEvaluation(evaluation, settings, response);
    assert.deepEqual(deadlines, [480000, 480000]);
    assert.ok(result.every(row => row.requestTiming[0].timeoutMs === 480000));
    delete settings.qualityTimeoutMs;
    await runRealEvaluation(evaluation, settings, response);
    assert.deepEqual(deadlines.slice(2), [120000, 120000]);
    await assert.rejects(runRealEvaluation(evaluation, { ...settings, qualityTimeoutMs: 480001 }, response), /quality_timeout_invalid/u);
  } finally { AbortSignal.timeout = original; }
});

test("blind pack is reproducible, omits version identity, and rejects missing arms", () => {
  const evaluation = loadEvaluation();
  const collection = { results: evaluation.fixture.cases.flatMap(row => ["before", "after"].map(arm => ({ caseId: row.id, arm, completionStatus: "COMPLETED", anonymizedResult: ["匿名回答"] }))) };
  const first = buildBlindReview(collection, evaluation);
  assert.deepEqual(first, buildBlindReview(collection, evaluation));
  assert.equal(first.pack.cases.length, 30);
  assert.ok(first.answerKey.mapping.some(row => row.A === "after"));
  assert.ok(first.answerKey.mapping.some(row => row.A === "before"));
  assert.doesNotMatch(JSON.stringify(first.pack), /before|after|SHA256|baselineCommit/u);
  collection.results.pop();
  assert.throws(() => buildBlindReview(collection, evaluation), /quality_blind_incomplete/u);
});

test("CLI persists all arms, resumes without requests, rejects changed configuration and preserves evidence", async () => {
  let calls = 0;
  const server = http.createServer((request, response) => {
    calls++;
    request.resume();
    request.on("end", () => { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ choices: [{ message: { content: "Synthetic fixture response" }, finish_reason: "stop" }] })); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const directory = fs.mkdtempSync(".tmp/sq1-harness-test-");
  const output = `${directory}/synthetic.json`;
  const env = { ...process.env, SKILLS_QUALITY_BASE_URL: `http://127.0.0.1:${server.address().port}`, SKILLS_QUALITY_API_KEY: "synthetic-credential-must-not-be-saved", SKILLS_QUALITY_MODEL: "synthetic-only" };
  const run = (args, overrides = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/skills-quality-eval.mjs", "--real-provider", ...args, output], { env: { ...env, ...overrides }, stdio: "ignore", windowsHide: true });
    child.on("error", reject); child.on("exit", code => resolve(code));
  });
  try {
    assert.equal(await run(["--output"]), 0);
    const evidence = fs.readFileSync(output, "utf8");
    assert.equal(JSON.parse(evidence).results.length, 60);
    assert.equal(calls, 64);
    assert.doesNotMatch(evidence, /synthetic-credential-must-not-be-saved/u);
    assert.equal(await run(["--resume"]), 0);
    assert.equal(calls, 64);
    const saved = fs.readFileSync(output, "utf8");
    assert.equal(await run(["--resume"], { SKILLS_QUALITY_MODEL: "different" }), 1);
    assert.equal(fs.readFileSync(output, "utf8"), saved);
    assert.equal(calls, 64);
    assert.equal(await run(["--output"]), 1);
    assert.equal(fs.readFileSync(output, "utf8"), saved);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
