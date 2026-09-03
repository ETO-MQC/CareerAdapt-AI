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
const bundleRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT?.trim() || path.join(projectRoot, ".electron-build", "hermes-runtime-v4"));
const appPort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 3010, maxAttempts: 100 });
if (!appPort) throw new Error("no free port for hermetic CareerAdapt integration");
const runtimePort = await companion.findAvailablePort({ host: "127.0.0.1", preferredPort: 19742, reservedPorts: [appPort], maxAttempts: 100 });
if (!runtimePort) throw new Error("no free port for hermetic Hermes integration");
const provider = await startFakeOpenAiProvider({ mode: "integration" });
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
  HERMES_PROVIDER: "openai-compatible",
  HERMES_BASE_URL: provider.baseUrl,
  HERMES_MODEL: "careeradapt-test",
  HERMES_CUSTOM_CAREERADAPT_API_KEY: provider.apiKey,
  AI_PROVIDER: "openai-compatible",
  AI_BASE_URL: provider.baseUrl,
  AI_MODEL: "careeradapt-test",
  AI_API_KEY: "",
  OPENAI_API_KEY: "",
  OPENROUTER_API_KEY: "",
  HERMES_WEB_CONTROL_ENABLED: "true",
  HERMES_RUNTIME_PROTOCOL: "official",
  HERMES_INTEGRATION_PROVIDER_URL: provider.baseUrl,
  HERMES_INTEGRATION_PROVIDER_KEY: provider.apiKey,
  HERMES_HOME: hermesHome,
  CAREERAD_NEXT_DIST_DIR: path.relative(projectRoot, nextDistDir),
  NEXT_TELEMETRY_DISABLED: "1",
  NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --max-old-space-size=4096`.trim()
};
let appProcess;
try {
  appProcess = spawnPnpm(["dev"], { cwd: projectRoot, env: childEnvironment, stdio: "inherit", windowsHide: true });
  await waitForApp(appProcess, appUrl);
  const result = await runPlaywright(childEnvironment, appUrl);
  if (result !== 0) throw new Error(`Hermes integration Playwright exited with code ${result}`);
  assert(provider.requests.length > 0, "fake provider did not receive integration requests");
  assert(provider.requests.every((request) => request.authorization === `Bearer ${provider.apiKey}`), "integration control key crossed into Provider Authorization");
  console.log(`[Hermes integration] PASS app=${appUrl} providerCalls=${provider.requests.length}`);
} catch (error) {
  console.error(`[Hermes integration] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await stopWebSupervisor(appUrl);
  if (appProcess && appProcess.exitCode === null) await terminateProcessTree(appProcess);
  await provider.close();
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

async function runPlaywright(environment, url) {
  const result = await new Promise((resolve, reject) => {
    const args = [
      "exec",
      "playwright",
      "test",
      "--config=playwright.hermes-integration.config.ts"
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
