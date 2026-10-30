import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  const results = [];
  for (const scenario of fixture.cases) {
    for (const arm of ["before", "after"]) {
      const messages = [{ role: "system", content: `${skills[scenario.skill][arm]}\nThis is an anonymous isolated policy evaluation. Supplied scenario facts are the complete context. Do not execute or claim a host write. Name the intended high-level tool when relevant; otherwise respond naturally.` },
        { role: "user", content: scenario.prompt }];
      const answers = [];
      for (const turn of [null, ...scenario.followUpTurns]) {
        if (turn) messages.push({ role: "user", content: turn });
        settings.onRequest?.({ caseId: scenario.id, arm, turnIndex: answers.length });
        const response = await request(`${settings.baseUrl.replace(/\/$/u, "")}/chat/completions`, {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
          body: JSON.stringify({ model: settings.model, messages, temperature: 0 }), signal: AbortSignal.timeout(120_000)
        });
        if (!response.ok) throw new Error(`quality_provider_http_${response.status}`);
        const payload = await response.json();
        const content = payload.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) throw new Error("quality_provider_empty_content");
        messages.push({ role: "assistant", content });
        answers.push(content);
      }
      const record = makeRecord(scenario, arm, skills[scenario.skill], settings.model, answers);
      results.push(record);
      settings.onRecord?.(record);
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
  const output = path.join(root, ".tmp", `skills-quality-real-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const results = [];
  let requestsAttempted = 0;
  let activeRequest;
  const metadata = { providerOrigin: url.origin, model: settings.model, baselineCommit: baseline.baselineCommit,
    parameters: { temperature: 0 }, order: "fixture order, before then after, fixed follow-up order" };
  const save = (status, diagnostics) => fs.writeFileSync(output, JSON.stringify({ schemaVersion: "skills-quality-eval-v1", status,
    ...metadata, requestsAttempted, activeRequest, ...(diagnostics ? { diagnostics } : {}), results }, null, 2) + "\n");
  settings.onRequest = request => { requestsAttempted++; activeRequest = request; save("RUNNING"); };
  settings.onRecord = record => {
    results.push(record);
    save("PENDING_HUMAN_REVIEW");
  };
  try {
    await runRealEvaluation(evaluation, settings);
  } catch (error) {
    const diagnostics = { errorName: error.name,
      ...(error.message.startsWith("quality_") ? { code: error.message } : {}),
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
