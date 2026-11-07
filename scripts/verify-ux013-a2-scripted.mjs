import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import companion from "../electron/hermesCompanion.js";
import { assertRp01RuntimeParity } from "./rp01-preflight.mjs";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const root = process.cwd(), stage = path.join(root, ".tmp/rp011-app/ux013-a2-source");
const runtimeRoot = path.join(root, ".electron-build/hermes-runtime-rp011");
const parity = assertRp01RuntimeParity(root, runtimeRoot);
const directory = path.join(root, "docs/quality/ux-01.3-a2-logs", `scripted-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const provider = await startFakeOpenAiProvider({ responseForRequest: ({ messages, tools }) => {
  const last = messages.findLastIndex(m => m.role === "user");
  const content = messages[last]?.content;
  const text = typeof content === "string" ? content : JSON.stringify(content ?? "");
  const kind = text.includes("UX013-A2-F") ? "fact_correction" : text.includes("UX013-A2-S") ? "confirmed_skill_addition"
    : text.includes("UX013-A2-D") ? "bullet_removal" : text.includes("UX013-A2-R") ? "bullet_reordering" : undefined;
  if (!kind) return { content: "本地 Scripted Provider 准备就绪。" };
  if (messages.slice(last + 1).some(m => m.role === "tool")) return { content: "已生成所选目标的结构化提案，请审核并明确确认；尚未正式写入。" };
  const name = tools.map(t => t.function?.name).find(n => n === "career.workflow.precise_edit" || n?.endsWith("workflow_precise_edit"));
  if (!name) throw new Error("precise_facade_not_exposed_to_scripted_provider");
  const output = kind === "fact_correction" ? { operation: kind, proposedValue: "Scripted 用户原始纠正名称" }
    : kind === "bullet_reordering" ? { operation: kind, permutation: [1, 0] } : { operation: kind };
  return { toolCall: { name, arguments: JSON.stringify(output) } };
} });
const appPort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3118, maxAttempts: 20 });
const runtimePort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 29862, reservedPorts: [appPort], maxAttempts: 20 });
if (!appPort || !runtimePort) throw new Error("isolated_ports_unavailable");
const appUrl = `http://127.0.0.1:${appPort}`, home = fs.mkdtempSync(path.join(os.tmpdir(), "ux013-a2-hermes-"));
fs.writeFileSync(path.join(home, "config.yaml"), "skills:\n  creation_nudge_interval: 0\nmemory:\n  nudge_interval: 0\ncurator:\n  enabled: false\n");
// Whitelist OS plumbing. Never read or inherit real Provider credentials.
const controlKey = `ux013-a2-control-${randomUUID()}`;
const environment = Object.fromEntries(["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH", "Path", "LOCALAPPDATA", "APPDATA", "USERPROFILE", "ComSpec"].flatMap(k => process.env[k] ? [[k, process.env[k]]] : []));
Object.assign(environment, { NODE_ENV: "development", CAREERADAPT_PROJECT_ROOT: stage, CAREERADAPT_BASE_URL: appUrl, CAREERADAPT_APP_PORT: String(appPort),
  HERMES_RUNTIME_ROOT: runtimeRoot, HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`, HERMES_HOME: home, HERMES_WEB_CONTROL_ENABLED: "true", HERMES_RUNTIME_PROTOCOL: "official",
  HERMES_PROVIDER: "openai-compatible", HERMES_BASE_URL: provider.baseUrl, HERMES_MODEL: "careeradapt-test", HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
  HERMES_RUNTIME_API_KEY: controlKey, API_SERVER_KEY: controlKey, HERMES_API_KEY: "", OPENAI_API_KEY: "", OPENROUTER_API_KEY: "",
  PLAYWRIGHT_BASE_URL: appUrl, HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl, HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
  UX013_A2_SCRIPTED_DIR: directory, UX013_DEPENDENCY_ROOT: path.dirname(stage), CAREERAD_NEXT_DIST_DIR: `.next-scripted-${Date.now()}`, NEXT_TELEMETRY_DISABLED: "1" });
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
    const pw = spawn(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.ux013-a2-scripted.config.ts", `--output=${path.join(directory, "browser")}`], { cwd: root, env: environment, windowsHide: true, stdio: "inherit" });
    pw.once("error", reject); pw.once("exit", code => resolve(code ?? 1));
  });
  result.playwrightExitCode = code;
  if (code !== 0) throw new Error(`scripted_browser_exit_${code}`);
  const kinds = new Set(provider.requests.map(r => { try { return JSON.parse(r.response?.toolCall?.arguments ?? "{}").operation; } catch { return undefined; } }));
  for (const kind of ["fact_correction", "confirmed_skill_addition", "bullet_removal", "bullet_reordering"]) if (!kinds.has(kind)) throw new Error(`missing_provider_operation_${kind}`);
  result.status = "PASS";
} catch (error) { result.status = "FAIL"; result.error = String(error); process.exitCode = 1; }
finally {
  result.providerRequests = provider.requests.map(r => ({ at: r.at, finishedAt: r.finishedAt, model: r.model, toolNames: r.toolNames, response: r.response,
    syntheticAuthorizationMatched: r.authorization === `Bearer ${provider.apiKey}`, messages: r.messages }));
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify(result, null, 2) + "\n");
  try { await fetch(`${appUrl}/api/agent/runtime/hermes/control`, { method: "POST", headers: { "Content-Type": "application/json", Origin: appUrl }, body: JSON.stringify({ action: "stop" }), signal: AbortSignal.timeout(5000) }); } catch { /* retain failed-run evidence; only stop the owned process */ }
  child?.kill(); fs.closeSync(runtimeLog); await provider.close();
}
console.log(`A2 Scripted Provider ${result.status}: ${directory}`);
