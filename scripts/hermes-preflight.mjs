import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { resolveHermesProviderBinding } = require("../electron/hermesProviderBinding.js");

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const env = {
  ...loadEnvFile(path.join(projectRoot, ".env")),
  ...loadEnvFile(path.join(projectRoot, ".env.local")),
  ...process.env
};
const appBaseUrl = env.CAREERADAPT_BASE_URL?.trim()
  || env.PLAYWRIGHT_BASE_URL?.trim()
  || "http://127.0.0.1:3000";
const expectedCareerSkills = [
  "candidate-profile-interview",
  "career-story-mining",
  "job-fit-analysis",
  "resume-tailoring",
  "resume-review",
  "resume-composition"
];

const hermesBinary = findHermesBinary();
const version = hermesBinary ? firstLine(runHermes(hermesBinary, ["--version"]).output) : "unavailable";
const companionHealth = await fetchHermesHealth(env.HERMES_RUNTIME_URL);
const mcpList = hermesBinary ? runHermes(hermesBinary, ["mcp", "list"]) : emptyCommandResult();
const mcpConfigured = /careeradapt/iu.test(mcpList.output);
const mcpTest = hermesBinary && mcpConfigured
  ? runHermes(hermesBinary, ["mcp", "test", "careeradapt"])
  : emptyCommandResult();
const mcpEndpoint = extractMcpEndpoint(mcpTest.output) || extractMcpEndpoint(mcpList.output) || `${appBaseUrl.replace(/\/$/u, "")}/api/agent/mcp`;
const mcpStatus = await fetchMcpStatus(mcpEndpoint);
const browserBridgeStatus = await fetchMcpStatus(`${appBaseUrl.replace(/\/$/u, "")}/api/agent/mcp`);
const careerSkillCount = countCareerSkills(env);

const providerConfigured = Boolean(firstValue(env.HERMES_BASE_URL, env.AI_BASE_URL))
  || companionHealth.providerConfigured === true;
const modelConfigured = Boolean(firstValue(env.HERMES_MODEL, env.AI_MODEL))
  || Boolean(companionHealth.model);
const providerBinding = resolveHermesProviderBinding({
  provider: firstValue(env.HERMES_PROVIDER, env.AI_PROVIDER),
  baseUrl: firstValue(env.HERMES_BASE_URL, env.AI_BASE_URL, env.OPENROUTER_BASE_URL, env.OPENAI_BASE_URL),
  model: firstValue(env.HERMES_MODEL, env.AI_MODEL, env.HERMES_INFERENCE_MODEL),
  genericApiKey: firstValue(env.AI_API_KEY, env.HERMES_API_KEY)
});
const credentialPresent = Boolean(firstValue(
  env[providerBinding.credentialEnvName],
  env.AI_API_KEY,
  env.HERMES_API_KEY
));
const companionReachable = companionHealth.reachable;
const mcpCareerAdaptReachable = mcpStatus.reachable && mcpConfigured && mcpTestPassed(mcpTest);
const browserBridgeReachable = browserBridgeStatus.connected;
const runtimeReady = companionHealth.available === true && companionHealth.providerReachable === true;
const skillsReady = careerSkillCount === expectedCareerSkills.length;
const hermesReady = Boolean(
  hermesBinary
  && providerConfigured
  && modelConfigured
  && credentialPresent
  && companionReachable
  && runtimeReady
  && mcpCareerAdaptReachable
  && mcpStatus.toolCount > 0
  && skillsReady
  && browserBridgeReachable
);

console.log(`Hermes binary: ${hermesBinary ? "YES" : "NO"}`);
console.log(`Hermes version: ${version || "unavailable"}`);
console.log(`provider configured: ${providerConfigured ? "YES" : "NO"}`);
console.log(`model configured: ${modelConfigured ? "YES" : "NO"}`);
console.log(`credential present: ${credentialPresent ? "YES" : "NO"}`);
console.log(`companion reachable: ${companionReachable ? "YES" : "NO"}`);
console.log(`MCP careeradapt reachable: ${mcpCareerAdaptReachable ? "YES" : "NO"}`);
console.log(`MCP tool count: ${browserBridgeStatus.toolCount || mcpStatus.toolCount}`);
console.log(`Career skill count: ${careerSkillCount}`);
console.log(`browser bridge reachable: ${browserBridgeReachable ? "YES" : "NO"}`);
console.log(`HERMES_READY: ${hermesReady ? "YES" : "NO"}`);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match || match[1] in values) continue;
    const raw = match[2].replace(/\s+#.*$/u, "").trim();
    values[match[1]] = stripQuotes(raw);
  }
  return values;
}

function stripQuotes(value) {
  if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim();
}

function findHermesBinary() {
  const configured = firstValue(env.HERMES_BIN);
  if (configured && fs.existsSync(configured)) return configured;
  const names = process.platform === "win32" ? ["hermes.exe", "hermes.cmd", "hermes"] : ["hermes"];
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function runHermes(binary, args) {
  const result = spawnSync(binary, args, {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: args[0] === "mcp" && args[1] === "test" ? 25_000 : 10_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter((value) => typeof value === "string").join("\n")
  };
}

function emptyCommandResult() {
  return { ok: false, output: "" };
}

async function fetchHermesHealth(runtimeUrl) {
  const root = firstValue(runtimeUrl);
  if (!root) return { reachable: false, available: false, providerReachable: false };
  const runtimeKey = firstValue(env.HERMES_RUNTIME_API_KEY, env.HERMES_API_KEY, env.AI_API_KEY);
  const urls = [
    `${root.replace(/\/$/u, "")}/health`,
    `${root.replace(/\/$/u, "")}/api/health`
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 404) {
        return { reachable: true, available: false, providerReachable: false };
      }
      if (response.status === 404) continue;
      const health = asRecord(payload);
      const runtimeHealth = asRecord(health.runtimeHealth);
      const modelProbe = await fetchHermesModels(root, runtimeKey);
      return {
        reachable: true,
        available: health.available === true || runtimeHealth.runtimeAvailable === true || response.ok,
        providerConfigured: runtimeHealth.providerConfigured === true
          || health.providerStatus !== "unconfigured"
          || modelProbe.modelCount > 0
          || typeof health.model === "string"
          || typeof runtimeHealth.model === "string",
        providerReachable: runtimeHealth.providerReachable === true
          || health.providerStatus === "ready"
          || modelProbe.ok,
        model: typeof health.model === "string"
          ? health.model
          : typeof runtimeHealth.model === "string"
            ? runtimeHealth.model
            : modelProbe.model
      };
    } catch {
      // Try the compatibility endpoint before reporting the companion down.
    }
  }
  return { reachable: false, available: false, providerReachable: false };
}

async function fetchHermesModels(root, apiKey) {
  try {
    const response = await fetch(`${root.replace(/\/$/u, "")}/v1/models`, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        Accept: "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      }
    });
    const payload = asRecord(await response.json().catch(() => ({})));
    const records = Array.isArray(payload.data) ? payload.data : [];
    const first = records[0] && typeof records[0] === "object" && !Array.isArray(records[0])
      ? records[0]
      : {};
    return {
      ok: response.ok,
      modelCount: records.length,
      model: typeof first.id === "string" ? first.id : undefined
    };
  } catch {
    return { ok: false, modelCount: 0, model: undefined };
  }
}

async function fetchMcpStatus(endpoint) {
  try {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json" }
    });
    const payload = asRecord(await response.json().catch(() => ({})));
    const status = asRecord(payload.status);
    return {
      reachable: response.ok,
      connected: status.connected === true,
      toolCount: typeof status.discoveredToolCount === "number" && Number.isInteger(status.discoveredToolCount)
        ? status.discoveredToolCount
        : 0
    };
  } catch {
    return { reachable: false, connected: false, toolCount: 0 };
  }
}

function extractMcpEndpoint(output) {
  return output
    .match(/https?:\/\/[^\s)]+\/api\/agent\/mcp/iu)?.[0]
    ?.replace(/[.,;]+$/u, "");
}

function mcpTestPassed(result) {
  return result.ok && !/connection failed|server error|service unavailable|\bfailed\b|✗/iu.test(result.output);
}

function countCareerSkills(values) {
  const hermesHome = firstValue(values.HERMES_HOME)
    || (process.platform === "win32"
      ? firstValue(values.LOCALAPPDATA) || path.join(os.homedir(), "AppData", "Local", "hermes")
      : path.join(os.homedir(), ".hermes"));
  const root = path.resolve(firstValue(values.HERMES_SKILLS_ROOT) || path.join(hermesHome, "skills", "careeradapt"));
  return expectedCareerSkills.filter((name) => fs.existsSync(path.join(root, name, "SKILL.md"))).length;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstLine(value) {
  return value.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}
