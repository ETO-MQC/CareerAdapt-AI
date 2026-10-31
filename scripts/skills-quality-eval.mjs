import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import generationPolicy from "../electron/providerGenerationPolicy.js";
export const { resolveQualityGenerationPolicy } = generationPolicy;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = JSON.parse(fs.readFileSync(path.join(root, "docs/quality/skills-quality-v1-baseline.json"), "utf8"));
export const qualityMetrics = ["correctTool", "unnecessaryQuestions", "questionUsefulness", "repeatQuestions",
  "jdRequirementCoverage", "supportedKeywordCoverage", "userConfirmedNewClaimsUsed", "unsupportedObjectiveClaims",
  "wrongOwnership", "fabricatedMetrics", "recruiterRelevance", "verbosity", "completionRate"];
export const hashSkill = text => crypto.createHash("sha256").update(text).digest("hex");

export function loadEvaluation() {
  const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/skills-quality-eval-v1.json"), "utf8"));
  const skills = {};
  for (const [name, entry] of Object.entries(baseline.skills)) {
    const relative = `skills/career/${name}/SKILL.md`;
    const before = execFileSync("git", ["show", `${baseline.baselineCommit}:${relative}`], { cwd: root, encoding: "utf8" });
    if (hashSkill(before) !== entry.beforeSHA256) throw new Error(`baseline_hash_mismatch:${name}`);
    const after = fs.readFileSync(path.join(root, relative), "utf8");
    if (hashSkill(after) !== entry.afterSHA256) throw new Error(`after_hash_mismatch:${name}`);
    skills[name] = { before, after, beforeSHA256: hashSkill(before), afterSHA256: hashSkill(after) };
  }
  return { fixture, skills };
}

/** No automatic model-quality verdict: rubric scores are independent human annotations. */
export function makeRecord(scenario, arm, skill, model, messages, toolTrace = []) {
  return { caseId: scenario.id, arm, skill: scenario.skill, skillSHA256: skill[`${arm}SHA256`],
    model, anonymizedResult: messages, questionCount: null, toolTrace,
    toolTraceScope: "intended_only_no_host_execution", rubric: scenario.rubric,
    metrics: Object.fromEntries(qualityMetrics.map(name => [name, null])), reviewStatus: "PENDING_HUMAN_REVIEW" };
}

export async function runRealEvaluation({ fixture, skills }, settings, request = fetch) {
  const policy = resolveQualityGenerationPolicy(settings);
  const timeoutMs = settings.qualityTimeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 480_000) throw new Error("quality_timeout_invalid");
  const results = [];
  for (const scenario of fixture.cases) {
    for (const arm of ["before", "after"]) {
      if (settings.completed?.some(row => row.caseId === scenario.id && row.arm === arm && row.completionStatus === "COMPLETED")) continue;
      const previous = settings.attempts?.filter(row => row.caseId === scenario.id && row.arm === arm) ?? [];
      const attempt = { caseId: scenario.id, category: scenario.category, arm, attemptNumber: previous.length + 1,
        previousFailure: previous.at(-1)?.errorClassification ?? null, requestedAt: new Date().toISOString(), turns: [] };
      settings.onAttempt?.(attempt);
      const messages = [{ role: "system", content: `${skills[scenario.skill][arm]}\nThis is an anonymous isolated policy evaluation. Supplied scenario facts are the complete context. Do not execute or claim a host write. Name the intended high-level tool when relevant; otherwise respond naturally.` },
        { role: "user", content: scenario.prompt }];
      const answers = [];
      try {
      for (const turn of [null, ...scenario.followUpTurns]) {
        if (turn) messages.push({ role: "user", content: turn });
        settings.onRequest?.({ caseId: scenario.id, arm, turnIndex: answers.length });
        const body = JSON.stringify({ model: settings.model, messages, temperature: policy.temperature,
          ...(policy.reasoningEffort ? { reasoning_effort: policy.reasoningEffort } : {}),
          ...(policy.maxTokens ? { max_tokens: policy.maxTokens } : {}) });
        const timing = { turnIndex: answers.length, requestedAt: new Date().toISOString(), requestBytes: Buffer.byteLength(body),
          parameters: policy, timeoutMs };
        attempt.turns.push(timing);
        settings.onProgress?.();
        const started = performance.now();
        try {
        const response = await request(`${settings.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
          body, signal: AbortSignal.timeout(timeoutMs)
        });
        timing.headersMs = performance.now() - started;
        timing.httpStatus = response.status ?? 200;
        if (!response.ok) {
          timing.retryAfter = response.headers?.get("retry-after") ?? null;
          // Consume the error body, retaining only safe classification, never raw provider text.
          const errorBody = response.text ? await response.text() : "";
          timing.bodyMs = performance.now() - started;
          timing.providerErrorHint = /quota|余额|额度|配额|insufficient/iu.test(errorBody) ? "QUOTA_RELATED_TEXT" :
            /rate.limit|too many|频率|限流/iu.test(errorBody) ? "RATE_LIMIT_RELATED_TEXT" : "UNCLASSIFIED";
          throw new Error(`quality_provider_http_${response.status}`);
        }
        const payload = await response.json();
        timing.bodyMs = performance.now() - started;
        timing.finishReason = payload.choices?.[0]?.finish_reason ?? null;
        const reasoning = payload.choices?.[0]?.message?.reasoning;
        timing.reasoningPresent = typeof reasoning === "string" && reasoning.length > 0;
        timing.reasoningChars = typeof reasoning === "string" ? reasoning.length : 0;
        timing.usage = { prompt_tokens: payload.usage?.prompt_tokens ?? null,
          completion_tokens: payload.usage?.completion_tokens ?? null,
          completion_tokens_details: { reasoning_tokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null } };
        const content = payload.choices?.[0]?.message?.content;
        timing.contentChars = typeof content === "string" ? content.length : 0;
        if (timing.finishReason === "length" || (!timing.contentChars && timing.reasoningPresent && policy.maxTokens &&
          timing.usage.completion_tokens >= policy.maxTokens)) {
          throw Object.assign(new Error("quality_output_budget_exhausted"), { code: "QUALITY_OUTPUT_BUDGET_EXHAUSTED" });
        }
        if (typeof content !== "string" || !content.trim()) throw new Error("quality_provider_empty_content");
        messages.push({ role: "assistant", content });
        answers.push(content);
        } finally { timing.totalMs = performance.now() - started; settings.onProgress?.(); }
      }
      const record = makeRecord(scenario, arm, skills[scenario.skill], settings.model, answers);
      Object.assign(record, { category: scenario.category, completionStatus: "COMPLETED", errorClassification: null,
        providerOrigin: new URL(settings.baseUrl).origin, turnCount: answers.length,
        questionCount: answers.reduce((sum, answer) => sum + (answer.match(/[?？]/gu)?.length ?? 0), 0),
        questionCountMethod: "question-mark count; semantic multi-question review pending", attemptNumber: attempt.attemptNumber,
        requestTiming: attempt.turns, requestedAt: attempt.requestedAt });
      record.generationPolicy = policy;
      attempt.completionStatus = "COMPLETED";
      results.push(record);
      settings.onRecord?.(record);
      } catch (error) {
        attempt.completionStatus = "FAILED";
        attempt.errorClassification = error.code === "QUALITY_OUTPUT_BUDGET_EXHAUSTED" ? error.code :
          error.name === "TimeoutError" || error.name === "AbortError" ? "TIMEOUT" :
          error.message.startsWith("quality_provider_http_") ? "HTTP_ERROR" :
          error instanceof SyntaxError || error.message === "quality_provider_empty_content" ? "PARSE_ERROR" : "PROVIDER_ERROR";
        attempt.partialResponses = answers;
        settings.onProgress?.();
        throw error;
      }
    }
  }
  return results;
}

function writePack(evaluation) {
  const out = path.join(root, "docs/quality/skills-quality-eval-v1-web-pack.md");
  const text = ["# Skills Quality Eval v1：匿名 Web 评测包", "",
    "只在空白匿名测试人物/独立任务中使用，不上传真实资料。固定同一模型、同一案例顺序和设置。",
    "当前 Web 产品验证 after；before 必须使用冻结版本的独立测试环境，不能把新版本结果标为旧版。",
    "每例先提交初始材料，收到提问后按顺序回答固定 follow-up；已足够生成时不要强迫提问。",
    "保留实际工具 trace、匿名回答、提问数、模型、Skill SHA，按 rubric 人工评分。不要把意图工具名当执行 trace。",
    "before/after 用相同案例。除计数外各维度可用 Strong/Good/Needs work；未观察项留 null。",
    "评分维度：" + qualityMetrics.join(", "), "",
    "JSON记录格式见同目录 skills-quality-v1-ab-results.json；把 reviewStatus 改为 REVIEWED 并填写观察，不保存凭据。",
    "模型直连方法：在本机仅通过环境变量设置 SKILLS_QUALITY_BASE_URL/API_KEY/MODEL，运行 node scripts/skills-quality-eval.mjs --real-provider。",
    "直连是 Skill policy A/B，不执行 Hermes/Repository/PDF；产品闭环由独立 Hermes 测试证明。",
    "",
    ...evaluation.fixture.cases.flatMap(row => [`## ${row.id} / ${row.skill}`, "", row.prompt,
      ...row.followUpTurns.map(turn => `\n固定后续回答：${turn}`), "", `验收：${row.rubric}`, ""])
  ].join("\n");
  fs.writeFileSync(out, text.trimEnd() + "\n");
  const records = evaluation.fixture.cases.flatMap(row => ["before", "after"].map(arm => makeRecord(row, arm, evaluation.skills[row.skill], "PENDING", [])));
  const resultFile = path.join(root, "docs/quality/skills-quality-v1-ab-results.json");
  // Never overwrite an existing reviewed result with empty placeholders.
  if (!fs.existsSync(resultFile)) fs.writeFileSync(resultFile, JSON.stringify({ schemaVersion: "skills-quality-eval-v1", status: "REAL_PROVIDER_BLOCKED", results: records }, null, 2) + "\n");
  console.log(`Anonymous evaluation pack: ${path.relative(root, out)}; ${evaluation.fixture.cases.length} cases, 2 arms; model-quality verdict pending.`);
}

async function main() {
  const evaluation = loadEvaluation();
  writePack(evaluation);
  if (!process.argv.includes("--real-provider")) return;
  const settings = { baseUrl: process.env.SKILLS_QUALITY_BASE_URL, apiKey: process.env.SKILLS_QUALITY_API_KEY, model: process.env.SKILLS_QUALITY_MODEL };
  if (!settings.baseUrl || !settings.apiKey || !settings.model) {
    console.log("REAL_PROVIDER_BLOCKED: credentials/model absent; use the anonymous Web pack.");
    process.exitCode = 2;
    return;
  }
  const url = new URL(settings.baseUrl);
  if (url.protocol !== "https:" && !(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && url.protocol === "http:")) throw new Error("quality_provider_requires_https_or_loopback");
  if (url.username || url.password) throw new Error("quality_provider_url_credentials_forbidden");
  const resumeIndex = process.argv.indexOf("--resume");
  const outputIndex = process.argv.indexOf("--output");
  if ((resumeIndex >= 0 && !process.argv[resumeIndex + 1]) || (outputIndex >= 0 && !process.argv[outputIndex + 1])) throw new Error("quality_output_path_required");
  const output = path.resolve(root, resumeIndex >= 0 ? process.argv[resumeIndex + 1] : outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(".tmp", `skills-quality-real-${Date.now()}.json`));
  if (resumeIndex < 0 && fs.existsSync(output)) throw new Error("quality_output_exists_use_resume");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const prior = resumeIndex >= 0 ? JSON.parse(fs.readFileSync(output, "utf8")) : null;
  const results = prior?.results ?? [];
  const attempts = prior?.attempts ?? [];
  let requestsAttempted = prior?.requestsAttempted ?? 0;
  let activeRequest;
  const metadata = { providerOrigin: url.origin, model: settings.model, baselineCommit: baseline.baselineCommit,
    parameters: { ...resolveQualityGenerationPolicy(settings), timeoutMs: 120000 }, order: "fixture order, before then after, fixed follow-up order",
    fixtureSHA256: hashSkill(JSON.stringify(evaluation.fixture)),
    skillHashes: Object.fromEntries(Object.entries(evaluation.skills).map(([name, skill]) => [name, { before: skill.beforeSHA256, after: skill.afterSHA256 }])) };
  if (prior && Object.keys(metadata).some(key => JSON.stringify(prior[key]) !== JSON.stringify(metadata[key]))) throw new Error("quality_resume_configuration_mismatch");
  for (const row of results) {
    const scenario = evaluation.fixture.cases.find(item => item.id === row.caseId);
    if (!scenario || !["before", "after"].includes(row.arm) || row.completionStatus !== "COMPLETED" ||
      row.skill !== scenario.skill || row.skillSHA256 !== evaluation.skills[scenario.skill][`${row.arm}SHA256`] ||
      row.model !== settings.model || row.providerOrigin !== url.origin || row.turnCount !== scenario.followUpTurns.length + 1 ||
      row.anonymizedResult.length !== row.turnCount) throw new Error("quality_resume_record_mismatch");
  }
  if (new Set(results.map(row => `${row.caseId}:${row.arm}`)).size !== results.length) throw new Error("quality_resume_duplicate_arm");
  for (const attempt of attempts) {
    if (!attempt.completionStatus) { attempt.completionStatus = "FAILED"; attempt.errorClassification = "INTERRUPTED"; }
  }
  const save = (status, diagnostics) => {
    fs.writeFileSync(`${output}.pending`, JSON.stringify({ schemaVersion: "skills-quality-eval-v1", status,
      ...metadata, requestsAttempted, activeRequest, ...(diagnostics ? { diagnostics } : {}), attempts, results }, null, 2) + "\n");
    fs.renameSync(`${output}.pending`, output);
  };
  settings.completed = results;
  settings.attempts = attempts;
  settings.onAttempt = attempt => { attempts.push(attempt); save("RUNNING"); };
  settings.onProgress = () => save("RUNNING");
  settings.onRequest = request => { requestsAttempted++; activeRequest = request; save("RUNNING"); };
  settings.onRecord = record => {
    results.push(record);
    save("PENDING_HUMAN_REVIEW");
  };
  try {
    await runRealEvaluation(evaluation, settings);
  } catch (error) {
    const diagnostics = { errorName: error.name,
      ...(error.code === "QUALITY_OUTPUT_BUDGET_EXHAUSTED" ? { code: error.code } : error.message.startsWith("quality_") ? { code: error.message } : {}),
      ...(typeof error.cause?.code === "string" && /^[A-Z_]+$/u.test(error.cause.code) ? { transportCode: error.cause.code } : {}) };
    save("REAL_QUALITY_EVAL_BLOCKED", diagnostics);
    console.log(`REAL_QUALITY_EVAL_BLOCKED: ${requestsAttempted} requests attempted, ${results.length} arms completed; safe evidence: ${path.relative(root, output)}`);
    process.exitCode = 2;
    return;
  }
  console.log(`Policy A/B responses saved: ${path.relative(root, output)}; human rubric review required.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message.startsWith("quality_") ? error.message : "skills_quality_eval_failed"); process.exitCode = 1; });
}
