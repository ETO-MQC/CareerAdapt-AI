import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

import companion from "../electron/hermesCompanion.js";

const {
  applyEnvironment,
  allocateLocalRuntimeUrl,
  createEphemeralRuntimeApiKey,
  findAvailablePort,
  loadCareerAdaptEnvironment,
  parsePort,
  startHermesCompanion,
  stopHermesCompanion
} = companion;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = "127.0.0.1";
const environment = loadCareerAdaptEnvironment(projectRoot);
environment.HERMES_RUNTIME_ROOT = environment.HERMES_RUNTIME_ROOT
  || path.join(projectRoot, ".electron-build", "hermes-runtime-v4");
const preferredAppPort = parsePort(environment.CAREERADAPT_APP_PORT || environment.PORT, 3000);
const preferredAppUrl = `http://${host}:${preferredAppPort}`;
const appAlreadyRunning = await isAppReady(preferredAppUrl);
const existingAppHealth = appAlreadyRunning ? await readAppHealth(preferredAppUrl) : undefined;
const appPort = appAlreadyRunning
  ? preferredAppPort
  : await findAvailablePort({
    host,
    preferredPort: preferredAppPort,
    maxAttempts: 100
  });
if (!appPort) throw new Error(`从端口 ${preferredAppPort} 开始没有找到可用的本地应用端口。`);
environment.CAREERADAPT_APP_PORT = String(appPort);
environment.PORT = String(appPort);
environment.CAREERADAPT_BASE_URL = `http://${host}:${appPort}`;
const runtimeAllocation = await allocateLocalRuntimeUrl({
  ...environment,
  HERMES_RUNTIME_URL: existingAppHealth?.runtimeUrl
    || environment.HERMES_RUNTIME_URL
    || "http://127.0.0.1:8642"
}, { reservedPorts: [appPort] });
if (runtimeAllocation.environment.HERMES_RUNTIME_URL) {
  environment.HERMES_RUNTIME_URL = runtimeAllocation.environment.HERMES_RUNTIME_URL;
}
const appUrl = environment.CAREERADAPT_BASE_URL;
const logPath = path.join(projectRoot, ".next", "dev", "logs", "hermes-runtime.log");
const webControlEnabled = (environment.HERMES_WEB_CONTROL_ENABLED ?? "true").trim().toLowerCase() !== "false";
environment.HERMES_WEB_CONTROL_ENABLED = webControlEnabled ? "true" : "false";

let nextProcess;
let hermesHandle;
let shuttingDown = false;

if (appAlreadyRunning) {
  console.log(`[CareerAdapt] Reusing the existing app at ${appUrl}`);
} else {
  if (!environment.HERMES_RUNTIME_API_KEY && !environment.HERMES_API_KEY && !environment.API_SERVER_KEY) {
    environment.HERMES_RUNTIME_API_KEY = createEphemeralRuntimeApiKey();
  }
  // The CLI heap flag on this wrapper does not propagate to the separately
  // spawned Next.js process. Pass it through explicitly so the long-lived
  // dev server has the same safety fuse.
  environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ""} --max-old-space-size=4096`.trim();
  applyEnvironment(environment);
  nextProcess = spawnPnpm(["exec", "next", "dev", "--webpack", "--hostname", host, "--port", String(appPort)], {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true
  });
  nextProcess.once("error", (error) => {
    console.error(`[CareerAdapt] Failed to start Next.js: ${error.message}`);
  });
  await waitForApp(nextProcess);
}

if (webControlEnabled) {
  console.log(`[Hermes] Web Supervisor enabled; the browser bridge will start Hermes at ${environment.HERMES_RUNTIME_URL}.`);
} else {
  hermesHandle = await startHermesCompanion({
    projectRoot,
    environment,
    hermesHome: path.join(projectRoot, ".next", "dev", "hermes"),
    logPath,
    allowEphemeralRuntimeKey: !appAlreadyRunning,
    allowProviderKeyFallback: appAlreadyRunning
  });

  if (hermesHandle.ok) {
    console.log(`[Hermes] Ready at ${hermesHandle.runtime.baseUrl}; log=${hermesHandle.logPath}`);
  } else {
    console.warn(`[Hermes] Not ready (${hermesHandle.reason ?? "unknown"}); CareerAdapt remains available with Native fallback.`);
    console.warn(`[Hermes] Startup log: ${hermesHandle.logPath}`);
    if (environment.HERMES_AUTOSTART_REQUIRED?.trim().toLowerCase() === "true") {
      await shutdown(1);
    }
  }
}

if (nextProcess) {
  nextProcess.once("exit", async (code) => {
    if (shuttingDown) return;
    await shutdown(typeof code === "number" ? code : 0);
  });
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
await new Promise(() => {});

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (webControlEnabled && nextProcess && !appAlreadyRunning) {
    console.log("[CareerAdapt] Asking the Web Supervisor to stop Hermes...");
    await fetch(`${appUrl}/api/agent/runtime/hermes/control`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: appUrl },
      body: JSON.stringify({ action: "stop" }),
      signal: AbortSignal.timeout(5_000)
    }).catch(() => undefined);
  } else {
    console.log("[CareerAdapt] Stopping managed Hermes companion...");
    await stopHermesCompanion(hermesHandle);
  }
  if (nextProcess && nextProcess.exitCode === null) nextProcess.kill();
  process.exit(code);
}

async function isAppReady(url) {
  try {
    const response = await fetch(`${url}/api/agent/mcp`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function readAppHealth(url) {
  try {
    const response = await fetch(`${url}/api/agent/runtime/hermes/health`, { signal: AbortSignal.timeout(1_500) });
    return await response.json();
  } catch {
    return undefined;
  }
}

async function waitForApp(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null && child.exitCode !== undefined) {
      throw new Error(`Next.js exited before becoming ready (code=${child.exitCode})`);
    }
    if (await isAppReady(appUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`CareerAdapt did not become ready on port ${appPort} within 30 seconds.`);
}

function spawnPnpm(args, options) {
  if (process.platform !== "win32") return spawn("pnpm", args, options);
  // `pnpm.cmd` is a command shim, so it must be invoked through cmd.exe on
  // Windows. Keep the executable unquoted: with `/s /c`, quoting the first
  // token makes some Node/cmd combinations treat the quotes as part of the
  // command name.
  const command = ["pnpm.cmd", ...args].join(" ");
  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], {
    ...options,
    shell: false
  });
}
