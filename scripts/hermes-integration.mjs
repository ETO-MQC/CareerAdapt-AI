import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

import companion from "../electron/hermesCompanion.js";
import { startFakeOpenAiProvider } from "../tests/support/fake-openai-compatible-provider.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const suite = process.argv[2] || "integration";
const isCareerAgentEval = suite === "career-agent-eval";
const isCareerAgentReal = suite === "career-agent-real";
if (!isCareerAgentEval && !isCareerAgentReal && suite !== "integration") {
  throw new Error(`unknown Hermes integration suite: ${suite}`);
}
const bundleRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT?.trim() || path.join(projectRoot, ".electron-build", "hermes-runtime-v4"));
const appPort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3010, maxAttempts: 100 });
if (!appPort) throw new Error("no free port for hermetic CareerAdapt integration");
const runtimePort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 19742, reservedPorts: [appPort], maxAttempts: 100 });
if (!runtimePort) throw new Error("no free port for hermetic Hermes integration");
const provider = isCareerAgentReal
  ? undefined
  : await startFakeOpenAiProvider({ mode: isCareerAgentEval ? "career-agent-eval" : "integration" });
const realProviderBaseUrl = isCareerAgentReal
  ? (process.env.CAREER_AGENT_REAL_BASE_URL || process.env.HERMES_BASE_URL || process.env.AI_BASE_URL || "").trim()
  : undefined;
const realProviderApiKey = isCareerAgentReal
  ? (process.env.CAREER_AGENT_REAL_API_KEY || process.env.HERMES_API_KEY || process.env.AI_API_KEY || "").trim()
  : undefined;
const realProviderModel = isCareerAgentReal
  ? (process.env.CAREER_AGENT_REAL_MODEL || process.env.HERMES_MODEL || process.env.AI_MODEL || "").trim()
  : undefined;
if (isCareerAgentReal && (!realProviderBaseUrl || !realProviderApiKey || !realProviderModel)) {
  console.log("[Hermes integration] SKIP suite=career-agent-real; credentials absent (set CAREER_AGENT_REAL_BASE_URL/API_KEY/MODEL or Hermes/AI equivalents)");
  process.exit(0);
}
const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), "careerad-hermes-integration-"));
const nextDistDir = path.join(path.parse(projectRoot).root, `careerad-next-integration-${appPort}-${Date.now()}`);
const appUrl = `http://127.0.0.1:${appPort}`;
const childEnvironment = {
  ...process.env,
  NODE_ENV: "development",
  CAREERADAPT_PROJECT_ROOT: projectRoot,
  CAREERADAPT_APP_PORT: String(appPort),
  CAREERADAPT_BASE_URL: appUrl,
  PORT: String(appPort),
  HERMES_RUNTIME_ROOT: bundleRoot,
  HERMES_RUNTIME_URL: `http://127.0.0.1:${runtimePort}`,
  HERMES_RUNTIME_API_KEY: "",
  API_SERVER_KEY: "",
  HERMES_API_KEY: "",
  HERMES_PROVIDER: isCareerAgentReal ? (process.env.HERMES_PROVIDER || "openai-compatible") : "openai-compatible",
  HERMES_BASE_URL: isCareerAgentReal ? realProviderBaseUrl : provider.baseUrl,
  HERMES_MODEL: isCareerAgentReal ? realProviderModel : "careeradapt-test",
  HERMES_CUSTOM_CAREERADAPT_API_KEY: isCareerAgentReal ? realProviderApiKey : provider.apiKey,
  AI_PROVIDER: isCareerAgentReal ? (process.env.AI_PROVIDER || "openai-compatible") : "openai-compatible",
  AI_BASE_URL: isCareerAgentReal ? realProviderBaseUrl : provider.baseUrl,
  AI_MODEL: isCareerAgentReal ? realProviderModel : "careeradapt-test",
  AI_API_KEY: isCareerAgentReal ? realProviderApiKey : "",
  OPENAI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  HERMES_WEB_CONTROL_ENABLED: "true",
  HERMES_RUNTIME_PROTOCOL: "official",
  ...(provider ? {
    HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl,
    HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey
  } : {}),
  ...(isCareerAgentReal ? {
    HERMES_INTEGRATION_REAL_PROVIDER_URL: realProviderBaseUrl,
    HERMES_INTEGRATION_REAL_PROVIDER_KEY: realProviderApiKey,
    HERMES_INTEGRATION_REAL_PROVIDER_MODEL: realProviderModel
  } : {}),
  HERMES_HOME: hermesHome,
  CAREERAD_NEXT_DIST_DIR: path.relative(projectRoot, nextDistDir),
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim()
};
let appProcess;
try {
  appProcess = spawnPnpm(["dev"], { cwd: projectRoot, env: childEnvironment, stdio: "inherit", windowsHide: true });
  await waitForApp(appProcess, appUrl);
  const result = await runPlaywright(childEnvironment, appUrl, suite);
  if (result !== 0) throw new Error(`Hermes integration Playwright exited with code ${result}`);
  if (provider) {
    assert(provider.requests.length > 0, "fake provider did not receive integration requests");
    assert(provider.requests.every((request) => request.authorization === `Bearer ${provider.apiKey}`), "integration control key crossed into Provider Authorization");
  }
  console.log(`[Hermes integration] PASS suite=${suite} app=${appUrl}${provider ? ` providerCalls=${provider.requests.length}` : " provider=real"}`);
} catch (error) {
  console.error(`[Hermes integration] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopWebSupervisor(appUrl);
  if (appProcess && appProcess.exitCode === null) await terminateProcessTree(appProcess);
  await provider?.close();
  console.log(`[Hermes integration] hermesHome=${hermesHome}`);
}

function spawnPnpm(args, options) {
  if (process.platform !== "win32") return spawn("pnpm", args, options);
  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", ["pnpm.cmd", ...args].join(" ")], {
    ...options,
    shell: false
  });
}

async function waitForApp(child, url) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    if (child.exitCode !== null) throw new Error(`CareerAdapt dev server exited before readiness (code=${child.exitCode})`);
    try {
      const response = await fetch(`${url}/api/agent/mcp`, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The local Next process is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`CareerAdapt did not become ready on ${url}`);
}

async function runPlaywright(environment, url, selectedSuite) {
  const result = await new Promise((resolve, reject) => {
    const args = [
      "exec",
      "playwright",
      "test",
      `--config=${selectedSuite === "career-agent-eval" ? "playwright.career-agent-eval.config.ts" : selectedSuite === "career-agent-real" ? "playwright.career-agent-real.config.ts" : "playwright.hermes-integration.config.ts"}`
    ];
    const child = spawnPnpm(args, {
      cwd: projectRoot,
      env: { ...environment, HERMES_INTEGRATION_BASE_URL: url },
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(typeof code === "number" ? code : signal ? 1 : 0));
  });
  return result;
}

async function stopWebSupervisor(url) {
  await fetch(`${url}/api/agent/runtime/hermes/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: url },
    body: JSON.stringify({ action: "stop" }),
    signal: AbortSignal.timeout(5_000)
  }).catch(() => undefined);
}

async function terminateProcessTree(child) {
  if (process.platform === "win32" && child.pid) {
    await execFileAsync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }).catch(() => undefined);
    return;
  }
  child.kill("SIGTERM");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
