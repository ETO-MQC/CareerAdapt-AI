import fs from "node:fs";
import companion from "../electron/hermesCompanion.js";
import { loadEvaluation, runRealEvaluation, resolveQualityGenerationPolicy } from "./skills-quality-eval.mjs";

// This is one transport verification, not a new certification cohort or an A/B pair.
const env = companion.loadCareerAdaptEnvironment(process.cwd());
const settings = { baseUrl: env.AI_BASE_URL, model: env.AI_MODEL, apiKey: env.AI_API_KEY };
const budgetIndex = process.argv.indexOf("--max-tokens");
const budget = budgetIndex >= 0 ? Number(process.argv[budgetIndex + 1]) : 2048;
if (![2048, 8192, 16384].includes(budget)) throw new Error("probe_budget_not_authorized");
settings.qualityMaxTokens = budget;
const timeoutIndex = process.argv.indexOf("--timeout-ms");
const timeoutMs = timeoutIndex >= 0 ? Number(process.argv[timeoutIndex + 1]) : 120000;
if (![120000, 480000].includes(timeoutMs) || (timeoutMs === 480000 && budget !== 16384)) throw new Error("probe_timeout_not_authorized");
settings.qualityTimeoutMs = timeoutMs;
if (settings.baseUrl !== "https://developer.amd.com.cn/radeon/api/v1" || settings.model !== "Qwen3.8-27B" || !settings.apiKey) throw new Error("probe_configuration_mismatch");
const output = `docs/quality/amd-qwen-low-reasoning-after-probe${budget === 2048 ? "" : `-${budget}`}${timeoutMs === 120000 ? "" : `-${timeoutMs}ms`}-20261031.json`;
const evaluation = loadEvaluation();
const scenario = evaluation.fixture.cases.find(row => row.id === "jd_understanding-01");
evaluation.fixture = { ...evaluation.fixture, cases: [scenario] };
const legacyPath = "docs/quality/p5.1-sq1-quality-certification-20261031-amd-collection.json";
const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
const before = legacy.results.find(row => row.caseId === scenario.id && row.arm === "before");
if (!before || before.skillSHA256 !== evaluation.skills[scenario.skill].beforeSHA256) throw new Error("legacy_before_missing_or_changed");
const evidence = { status: "AUTHORIZED_SINGLE_REQUEST_PENDING", caseId: scenario.id, arm: "after",
  providerOrigin: new URL(settings.baseUrl).origin, model: settings.model,
  parameters: { ...resolveQualityGenerationPolicy(settings), timeoutMs },
  skillSHA256: evaluation.skills[scenario.skill].afterSHA256,
  legacyBefore: { path: legacyPath, preserved: true, durationMs: before.requestTiming[0].totalMs,
    sameGenerationPolicy: false, note: "Legacy default-xhigh before is not comparable to this explicit-low after. No certification pair is created." },
  requestsAttempted: 0, attempts: [], results: [] };
// Exclusive creation is the one-request guard, including across process restarts/crashes.
fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx" });
const save = () => fs.writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
settings.completed = [{ caseId: scenario.id, arm: "before", completionStatus: "COMPLETED" }];
settings.onAttempt = attempt => { evidence.attempts.push(attempt); save(); };
settings.onProgress = save;
settings.onRecord = record => { evidence.results.push(record); save(); };
try {
  await runRealEvaluation(evaluation, settings, async (url, init) => {
    if (evidence.requestsAttempted !== 0) throw new Error("probe_request_limit_reached");
    const body = JSON.parse(init.body);
    if (body.reasoning_effort !== "low" || body.max_tokens !== budget || body.temperature !== 0) throw new Error("probe_wire_policy_mismatch");
    evidence.requestsAttempted++;
    evidence.requestJournal = { requestedAt: new Date().toISOString(), requestBytes: Buffer.byteLength(init.body),
      model: body.model, reasoning_effort: body.reasoning_effort, max_tokens: body.max_tokens, temperature: body.temperature };
    save();
    return fetch(url, init);
  });
  const timing = evidence.results[0]?.requestTiming[0];
  const passed = timing?.httpStatus === 200 && timing?.finishReason === "stop" && timing.contentChars > 0 && timing.totalMs < timeoutMs;
  evidence.status = passed ? (timeoutMs === 120000 ? "AMD_QWEN_REASONING_TIMEOUT_ROOT_CAUSE_CONFIRMED_FIXED" : "AMD_QWEN_LONG_TIMEOUT_PROBE_SUCCEEDED") : "AMD_QWEN_LOW_REASONING_STILL_BLOCKED";
} catch (error) {
  evidence.status = "AMD_QWEN_LOW_REASONING_STILL_BLOCKED";
  evidence.errorName = error.name;
  evidence.errorClassification = evidence.attempts.at(-1)?.errorClassification ?? "PROBE_ERROR";
  process.exitCode = 2;
} finally { save(); console.log(JSON.stringify({ status: evidence.status, requests: evidence.requestsAttempted, evidence: output })); }
