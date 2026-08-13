import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  allocateLocalRuntimeUrl,
  loadCareerAdaptEnvironment,
  prepareHermesEnvironment,
  startHermesCompanion,
  stopHermesCompanion
} = require("../electron/hermesCompanion.js");

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const runtimeRoot = path.resolve(process.env.HERMES_RUNTIME_ROOT?.trim() || path.join(projectRoot, ".electron-build", "hermes-runtime-v4"));
const python = path.join(runtimeRoot, "python", "python.exe");
const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "careeradapt-hermes-self-test-"));
const hermesHome = path.join(tempRoot, "home");
const logPath = path.join(tempRoot, "hermes-runtime.log");

let handle;
try {
  assertFile(python, "bundled Python");
  assertFile(manifestPath, "runtime manifest");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const field of [
    "hermesVersion", "hermesGitCommit", "hermesSourceTreeHash", "pythonVersion",
    "sitePackagesFingerprint", "careerAdaptPatchVersion", "careerAdaptPatchHash",
    "careerSkillsHash", "generatedAt"
  ]) {
    if (!manifest[field]) throw new Error(`runtime manifest is missing ${field}`);
  }

  const environment = loadCareerAdaptEnvironment(projectRoot, process.env);
  const allocated = await allocateLocalRuntimeUrl({ ...environment, HERMES_RUNTIME_URL: "http://127.0.0.1:8642" });
  if (allocated.error || allocated.runtime.error) throw new Error(allocated.error || allocated.runtime.error);
  const prepared = prepareHermesEnvironment(allocated.environment, {
    allowEphemeralRuntimeKey: true,
    projectRoot,
    hermesHome,
    hermesRuntimeRoot: runtimeRoot,
    appBaseUrl: environment.CAREERADAPT_BASE_URL || environment.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000"
  });

  const pythonVersion = execFileSync(python, ["--version"], { encoding: "utf8", env: prepared.childEnvironment, windowsHide: true }).trim();
  execFileSync(python, ["-c", [
    "import hermes_cli",
    "import gateway.run",
    "import gateway.platforms.api_server",
    "import aiohttp",
    "print('imports-ok')"
  ].join("; ")], { encoding: "utf8", env: prepared.childEnvironment, windowsHide: true });
  const managedConfigPath = path.join(hermesHome, "config.yaml");
  assertFile(managedConfigPath, "managed Hermes config");
  const managedConfig = fs.readFileSync(managedConfigPath, "utf8");
  for (const required of ["api_server:", "mcp_servers:", "careeradapt:", "key_env: OPENAI_API_KEY"]) {
    if (!managedConfig.includes(required)) throw new Error(`managed Hermes config is missing ${required}`);
  }
  const providerKey = prepared.childEnvironment.OPENAI_API_KEY;
  if (providerKey && managedConfig.includes(providerKey)) throw new Error("managed Hermes config contains the provider key value");

  handle = await startHermesCompanion({
    projectRoot,
    environment: allocated.environment,
    hermesHome,
    hermesRuntimeRoot: runtimeRoot,
    logPath,
    appBaseUrl: environment.CAREERADAPT_BASE_URL || environment.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    allowEphemeralRuntimeKey: true,
    requireBundledRuntime: true,
    watchMcpBridge: false,
    timeoutMs: 60_000
  });
  if (!handle.ok) throw new Error(`bundled gateway failed: ${JSON.stringify(handle.startupFailure || handle.reason)}`);

  const [health, models, toolsets] = await Promise.all([
    getJson(`${handle.runtime.baseUrl}/health`, handle.runtimeApiKey),
    getJson(`${handle.runtime.baseUrl}/v1/models`, handle.runtimeApiKey),
    getJson(`${handle.runtime.baseUrl}/v1/toolsets`, handle.runtimeApiKey)
  ]);
  const toolsetRows = Array.isArray(toolsets.data) ? toolsets.data : [];
  const careerToolset = toolsetRows.find((row) => row?.name === "mcp-careeradapt" && row.enabled !== false);
  if (!health || !models || !careerToolset || !Array.isArray(careerToolset.tools) || careerToolset.tools.length === 0) {
    throw new Error("bundled gateway is healthy but mcp-careeradapt is not visible; start the CareerAdapt app bridge before acceptance");
  }
  console.log(JSON.stringify({
    ok: true,
    runtimeRoot,
    hermesVersion: manifest.hermesVersion,
    hermesGitCommit: manifest.hermesGitCommit,
    pythonVersion,
    runtimeUrl: handle.runtime.baseUrl,
    modelCount: Array.isArray(models.data) ? models.data.length : undefined,
    careerToolCount: careerToolset.tools.length,
    logPath
  }, null, 2));
} finally {
  if (handle) await stopHermesCompanion(handle);
}

async function getJson(url, apiKey) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`${label} was not found: ${filePath}`);
}
