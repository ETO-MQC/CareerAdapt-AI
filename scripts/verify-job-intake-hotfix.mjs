import { hasVerifiedJobCommit } from "../tests/support/job-intake-scripted-response.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import companion from "../electron/hermesCompanion.js";
import { assertRp01RuntimeParity } from "./rp01-preflight.mjs";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd(), stage = path.join(root, ".tmp/rp011-app/job-intake-hotfix-source");
const runtimeRoot = path.join(root, ".electron-build/hermes-runtime-rp011");
const parity = assertRp01RuntimeParity(root, runtimeRoot);
const directory = path.join(root, "docs/quality/job-intake-hotfix-01-logs", `scripted-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const provider = await startFakeOpenAiProvider({ responseForRequest: ({ messages, tools }) => {
  const last = messages.findLastIndex(m => m.role === "user");
  const content = messages[last]?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  if (messages.slice(last + 1).some(m => m.role === "tool")) {
    const committed = messages.slice(last + 1).filter(m => m.role === "tool").some(m => hasVerifiedJobCommit(m.content));
    return { content: committed ? "岗位已保存并核对，可以在岗位列表查看。" : "岗位信息已经整理，但尚未完成保存。当前资料已保留，可以继续完成保存。" };
  }
  const name = tools.map(t => t.function?.name).find(n => n === "career.workflow.job_intake" || n?.endsWith("workflow_job_intake"));
  if (!name) return { content: "本地岗位测试服务就绪。" };
  const fixture = fs.readFileSync(path.join(root, "tests/fixtures/jobIntakeIncident.ts"), "utf8");
  const rawText = JSON.parse(fixture.slice(fixture.indexOf(" = ") + 3).trim().replace(/;$/, ""));
  const input = text.includes("公司是华为") ? { company: "华为", persistence: "save" }
    : text.includes("毕业要求") ? { rawText, persistence: "save" } : { persistence: "save" };
  return { toolCall: { name, arguments: JSON.stringify(input) } };
} });
const appPort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3118, maxAttempts: 20 });
const runtimePort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 29862, reservedPorts: [appPort], maxAttempts: 20 });
if (!appPort || !runtimePort) throw new Error("isolated_ports_unavailable");
const appUrl = `http://127.0.0.1:${appPort}`, home = fs.mkdtempSync(path.join(os.tmpdir(), "job-hotfix-hermes-"));
fs.writeFileSync(path.join(home, "config.yaml"), "skills:\n  creation_nudge_interval: 0\nmemory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
// Whitelist OS plumbing. Never read or inherit real Provider credentials.
const controlKey = `job-hotfix-control-${randomUUID()}`;
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl, CAREERADAPT_APP_PORT: String(appPort),
  HERMES_RUNTIME_ROOT: runtimeRoot, HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`, HERMES_HOME: home, HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_PROTOCOL: "official",
  HERMES_PROVIDER: "openai-compatible", HERMES_BASE_URL: provider.baseUrl, HERMES_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
  HERMES_RUNTIME_API_KEY: controlKey, API_SERVER_KEY: controlKey, HERMES_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "",
  PLAYWRIGHT_BASE_URL: appUrl, HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl, HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
  JOB_HOTFIX_DIR: directory, UX013_DEPENDENCY_ROOT: path.dirname(stage), CAREERAD_NEXT_DIST_DIR: `.next-scripted-${Date.now()}`, NEXT_TELEMETRY_DISABLED: "1" });
const runtimeLog = fs.openSync(path.join(directory, "runtime.log"), "a");
let child;
const result = { status: "RUNNING", directory, parity, syntheticProviderOnly: true, realProviderRequests: 0, appUrl, runtimeUrl: environment.HERMES_RUNTIME_URL, isolatedHome: home };
try {
  child = spawn(process.execPath, [path.join(root, ".tmp/rp011-app/node_modules/next/dist/bin/next"), "dev", "-p", String(appPort)], { cwd: stage, env: environment, windowsHide: true, stdio: ["ignore", runtimeLog, runtimeLog] });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`app_exited_${child.exitCode}`);
    try { ready = (await fetch(`${appUrl}/api/agent/mcp`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* bounded startup polling */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("app_not_ready");
  const code = await new Promise((resolve, reject) => {
    const pw = spawn(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.job-intake-hotfix.config.ts", `--output=${path.join(directory, "browser")}`], { cwd: root, env: environment, windowsHide: true, stdio: "inherit" });
    pw.once("error", reject); pw.once("exit", code => resolve(code ?? 1));
  });
  result.playwrightExitCode = code;
  if (code !== 0) throw new Error(`scripted_browser_exit_${code}`);
  if (provider.requests.filter(r => r.response?.toolCall).length < 2) throw new Error("missing_job_tool_calls");
  result.status = "PASS";
} catch (error) { result.status = "FAIL"; result.error = String(error); process.exitCode = 1; }
finally {
  result.providerRequests = provider.requests.map(r => ({ at: r.at, finishedAt: r.finishedAt, model: r.model, toolNames: r.toolNames, response: r.response,
    syntheticAuthorizationMatched: r.authorization === `Bearer ${provider.apiKey}`, messages: r.messages }));
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(result, null, 2) + "\n");
  try { await fetch(`${appUrl}/api/agent/runtime/hermes/control`, { method: "POST", headers: { "Content-Type": "application/json", Origin: appUrl }, body: JSON.stringify({ action: "stop" }), signal: AbortSignal.timeout(5000) }); } catch { /* retain failed-run evidence; only stop the owned process */ }
  child?.kill(); fs.closeSync(runtimeLog); await provider.close();
}
console.log(`Job Intake Scripted Provider ${result.status}: ${directory}`);
