/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { execFile, execFileSync, spawn } = require("child_process");

const DEFAULT_RUNTIME_URL = "http://127.0.0.1:8642";
const DEFAULT_APP_URL = "http://127.0.0.1:3000";
const DEFAULT_LOCAL_HOST = "127.0.0.1";
const DEFAULT_PORT_SCAN_LIMIT = 100;
// Hermes can finish binding its API server before its first health response is
// serviced. This is especially visible on a cold packaged start while the
// bundled Python runtime opens its state databases and registers MCP tools.
// Keep the wait bounded, but allow that first authenticated probe to complete.
const DEFAULT_START_TIMEOUT_MS = 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 15_000;
const HEALTH_POLL_MS = 500;
const MCP_WATCH_INTERVAL_MS = 1_000;
const MCP_REFRESH_COOLDOWN_MS = 15_000;
const GATEWAY_REPLACEMENT_TIMEOUT_MS = 15_000;

function loadCareerAdaptEnvironment(projectRoot, baseEnvironment = process.env) {
  const fileEnvironment = {};
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(projectRoot, fileName);
    if (!fs.existsSync(filePath)) continue;
    Object.assign(fileEnvironment, readEnvFile(filePath));
  }
  return { ...fileEnvironment, ...baseEnvironment };
}

function readEnvFile(filePath) {
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u);
    if (!match) continue;
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

function applyEnvironment(environment) {
  for (const [name, value] of Object.entries(environment)) {
    if (typeof value === "string") process.env[name] = value;
  }
}

function createEphemeralRuntimeApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

function resolveRuntimeConfig(environment) {
  const rawUrl = firstValue(environment.HERMES_RUNTIME_URL) || DEFAULT_RUNTIME_URL;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: "hermes_runtime_url_invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "hermes_runtime_url_protocol_invalid" };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  return {
    baseUrl: rawUrl.replace(/\/$/u, ""),
    healthUrl: `${rawUrl.replace(/\/$/u, "")}/health`,
    host: url.hostname,
    port,
    local: ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
  };
}

function parsePort(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : fallback;
}

async function findAvailablePort(options = {}) {
  const host = options.host || DEFAULT_LOCAL_HOST;
  const preferredPort = parsePort(options.preferredPort, 1_024);
  const maxAttempts = parsePort(options.maxAttempts, DEFAULT_PORT_SCAN_LIMIT);
  const reservedPorts = new Set((options.reservedPorts || []).map((port) => parsePort(port, -1)));
  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65_535 || reservedPorts.has(candidate)) continue;
    if (await isPortAvailable(candidate, host)) return candidate;
  }
  return undefined;
}

async function allocateLocalRuntimeUrl(environment, options = {}) {
  const runtime = resolveRuntimeConfig(environment);
  if (runtime.error || !runtime.local) return { environment, runtime };
  const reservedPorts = new Set((options.reservedPorts || []).map((port) => parsePort(port, -1)));
  if (!reservedPorts.has(runtime.port) && await isPortAvailable(runtime.port, runtime.host)) {
    return {
      environment: { ...environment, HERMES_RUNTIME_URL: runtime.baseUrl },
      runtime
    };
  }

  const port = await findAvailablePort({
    host: runtime.host,
    preferredPort: runtime.port + 1,
    maxAttempts: options.maxAttempts ?? DEFAULT_PORT_SCAN_LIMIT,
    reservedPorts: [...reservedPorts]
  });
  if (!port) return { environment, runtime, error: "hermes_runtime_no_available_port" };
  const baseUrl = replaceUrlPort(runtime.baseUrl, port);
  return {
    environment: { ...environment, HERMES_RUNTIME_URL: baseUrl },
    runtime: resolveRuntimeConfig({ ...environment, HERMES_RUNTIME_URL: baseUrl })
  };
}

function replaceUrlPort(value, port) {
  const url = new URL(value);
  url.port = String(port);
  return url.toString().replace(/\/$/u, "");
}

function prepareHermesEnvironment(environment, options = {}) {
  const runtime = resolveRuntimeConfig(environment);
  if (runtime.error) return { environment, runtime };

  const bundledRuntime = resolveBundledHermesRuntime(environment, options);

  const result = { ...environment };
  let runtimeApiKey = firstValue(
    result.HERMES_RUNTIME_API_KEY,
    result.HERMES_API_KEY,
    result.API_SERVER_KEY
  );
  if (!runtimeApiKey && options.allowProviderKeyFallback === true) {
    runtimeApiKey = firstValue(result.AI_API_KEY);
  }
  if (!runtimeApiKey && options.allowEphemeralRuntimeKey === true) {
    runtimeApiKey = createEphemeralRuntimeApiKey();
    result.HERMES_RUNTIME_API_KEY = runtimeApiKey;
  }

  const providerBaseUrl = firstValue(result.AI_BASE_URL, result.HERMES_BASE_URL, result.OPENAI_BASE_URL);
  const providerApiKey = firstValue(result.AI_API_KEY, result.OPENAI_API_KEY);
  const model = firstValue(result.HERMES_MODEL, result.AI_MODEL, result.HERMES_INFERENCE_MODEL);
  const appBaseUrl = firstValue(options.appBaseUrl, result.CAREERADAPT_BASE_URL, result.PLAYWRIGHT_BASE_URL, DEFAULT_APP_URL);
  const hermesHome = firstValue(options.hermesHome, result.CAREERADAPT_HERMES_HOME, result.HERMES_HOME);
  const childEnvironment = {
    ...result,
    API_SERVER_ENABLED: "true",
    API_SERVER_HOST: runtime.host,
    API_SERVER_PORT: String(runtime.port),
    ...(runtimeApiKey ? { API_SERVER_KEY: runtimeApiKey } : {}),
    ...(providerBaseUrl ? { OPENAI_BASE_URL: providerBaseUrl } : {}),
    ...(providerApiKey ? { OPENAI_API_KEY: providerApiKey } : {}),
    ...(model ? { HERMES_INFERENCE_MODEL: model } : {})
  };

  if (bundledRuntime) {
    childEnvironment.HERMES_RUNTIME_MODE = "bundled";
    childEnvironment.HERMES_RUNTIME_ROOT = bundledRuntime.root;
    childEnvironment.HERMES_SOURCE_ROOT = bundledRuntime.sourceRoot;
    childEnvironment.HERMES_SKILLS_ROOT = bundledRuntime.skillsRoot;
    childEnvironment.HERMES_BUNDLED_SKILLS = bundledRuntime.bundledSkillsRoot;
    childEnvironment.PYTHONHOME = bundledRuntime.pythonRoot;
    childEnvironment.PYTHONPATH = [
      bundledRuntime.sourceRoot,
      bundledRuntime.sitePackagesRoot,
      path.join(bundledRuntime.sitePackagesRoot, "win32"),
      path.join(bundledRuntime.sitePackagesRoot, "win32", "lib"),
      path.join(bundledRuntime.sitePackagesRoot, "pywin32_system32"),
      result.PYTHONPATH
    ].filter(Boolean).join(path.delimiter);
    childEnvironment.Path = [
      path.join(bundledRuntime.sitePackagesRoot, "pywin32_system32"),
      result.Path || result.PATH
    ].filter(Boolean).join(path.delimiter);
    childEnvironment.PATH = childEnvironment.Path;
    childEnvironment.HERMES_HOME = hermesHome || path.join(options.projectRoot ?? process.cwd(), ".next", "dev", "hermes");
    ensureManagedHermesConfig(childEnvironment.HERMES_HOME, {
      baseUrl: providerBaseUrl,
      model,
      appBaseUrl,
      runtimeUrl: runtime.baseUrl
    });
  }
  return { environment: result, childEnvironment, runtime, runtimeApiKey };
}

function resolveBundledHermesRuntime(environment = process.env, options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const configuredRoot = firstValue(
    options.hermesRuntimeRoot,
    environment.HERMES_RUNTIME_ROOT,
    path.join(projectRoot, ".electron-build", "hermes-runtime-v4")
  );
  if (!configuredRoot) return undefined;
  const root = path.resolve(configuredRoot);
  const pythonRoot = path.join(root, "python");
  const sourceRoot = path.join(root, "source");
  const sitePackagesRoot = path.join(root, "site-packages");
  const bundledSkillsRoot = path.join(root, "skills");
  const pythonExecutable = firstValue(environment.HERMES_PYTHON) || path.join(pythonRoot, "python.exe");
  if (!fs.existsSync(path.join(root, "runtime-manifest.json"))
    || !fs.existsSync(pythonExecutable)
    || !fs.existsSync(path.join(sourceRoot, "hermes_cli"))
    || !fs.existsSync(sitePackagesRoot)) {
    return undefined;
  }
  return {
    root,
    pythonRoot,
    pythonExecutable,
    sourceRoot,
    sitePackagesRoot,
    bundledSkillsRoot,
    skillsRoot: path.join(bundledSkillsRoot, "careeradapt")
  };
}

function ensureManagedHermesConfig(hermesHome, values) {
  const configPath = path.join(hermesHome, "config.yaml");
  fs.mkdirSync(hermesHome, { recursive: true });
  const baseUrl = firstValue(values.baseUrl);
  const model = firstValue(values.model);
  const provider = baseUrl && model ? "custom:careeradapt" : "custom";
  const mcpUrl = `${String(values.appBaseUrl || DEFAULT_APP_URL).replace(/\/$/u, "")}/api/agent/mcp`;
  const developerMode = firstValue(values.mode, process.env.CAREERADAPT_HERMES_MODE)?.toLowerCase() === "developer"
    || firstValue(values.developerMode, process.env.CAREERADAPT_HERMES_DEVELOPER_MODE)?.toLowerCase() === "true";
  const apiServerToolsets = developerMode ? ["hermes-api-server", "careeradapt"] : ["skills", "careeradapt"];
  const lines = [
    "# Managed by CareerAdapt AI. Do not put API keys in this file.",
    "# The key is injected into the Hermes process as OPENAI_API_KEY.",
    "model:",
    `  default: ${yamlScalar(model || "hermes-agent")}`,
    `  provider: ${yamlScalar(provider)}`,
    ...(baseUrl ? [`  base_url: ${yamlScalar(baseUrl)}`, "  api_mode: chat_completions"] : []),
    ...(baseUrl && model ? [
      "custom_providers:",
      "  - name: careeradapt",
      `    base_url: ${yamlScalar(baseUrl)}`,
      "    key_env: OPENAI_API_KEY",
      "    api_mode: chat_completions",
      `    model: ${yamlScalar(model)}`
    ] : []),
    "platform_toolsets:",
    "  api_server:",
    ...apiServerToolsets.map((toolset) => `    - ${toolset}`),
    "mcp_servers:",
    "  careeradapt:",
    `    url: ${yamlScalar(mcpUrl)}`,
    "    enabled: true",
    "    connect_timeout: 10",
    "gateway:",
    `  careeradapt_runtime_url: ${yamlScalar(values.runtimeUrl || DEFAULT_RUNTIME_URL)}`,
    ""
  ];
  const content = lines.join("\n");
  if (!fs.existsSync(configPath) || fs.readFileSync(configPath, "utf8") !== content) {
    fs.writeFileSync(configPath, content, "utf8");
  }
}

function yamlScalar(value) {
  return JSON.stringify(String(value ?? ""));
}

function findHermesBinary(environment = process.env) {
  const configured = firstValue(environment.HERMES_BIN);
  if (configured && fs.existsSync(configured)) return configured;
  if (process.platform === "win32") {
    try {
      const output = execFileSync("where.exe", ["hermes"], { encoding: "utf8", windowsHide: true });
      const candidate = output.split(/\r?\n/u).map((line) => line.trim()).find(Boolean);
      if (candidate) return candidate;
    } catch {
      // Fall through to PATH resolution by spawn().
    }
  }
  return process.platform === "win32" ? "hermes.exe" : "hermes";
}

async function startHermesCompanion(options = {}) {
  let environment = options.environment ?? process.env;
  let runtime = options.runtime ?? resolveRuntimeConfig(environment);
  const projectRoot = options.projectRoot ?? process.cwd();
  const hermesHome = firstValue(options.hermesHome, environment.HERMES_HOME, path.join(projectRoot, ".next", "dev", "hermes"));
  const logPath = options.logPath ?? path.join(projectRoot, ".next", "dev", "logs", "hermes-runtime.log");
  const writeLog = createLogWriter(logPath, [
    environment.AI_API_KEY,
    environment.HERMES_API_KEY,
    environment.HERMES_RUNTIME_API_KEY,
    environment.API_SERVER_KEY,
    environment.OPENAI_API_KEY
  ]);

  if (runtime.error) {
    writeLog(`startup blocked: ${runtime.error}`);
    return failedCompanion(runtime.error, logPath);
  }
  if (!runtime.local) {
    writeLog(`startup skipped: configured runtime is remote (${runtime.host}:${runtime.port})`);
    return failedCompanion("hermes_runtime_remote", logPath);
  }
  if (options.requireBundledRuntime === true && !resolveBundledHermesRuntime(environment, options)) {
    writeLog("startup blocked: bundled Hermes runtime is required but unavailable");
    return failedCompanion("hermes_bundled_runtime_missing", logPath, { runtime });
  }

  let prepared = prepareHermesEnvironment(environment, {
    allowEphemeralRuntimeKey: options.allowEphemeralRuntimeKey === true,
    allowProviderKeyFallback: options.allowProviderKeyFallback === true,
    projectRoot,
    appBaseUrl: options.appBaseUrl,
    hermesHome,
    hermesRuntimeRoot: options.hermesRuntimeRoot
  });
  if (!prepared.runtimeApiKey) {
    writeLog("startup blocked: no Hermes runtime API key is available");
    return failedCompanion("hermes_runtime_api_key_missing", logPath);
  }

  const existing = await probeHealth(runtime.healthUrl, prepared.runtimeApiKey);
  if (existing.ok) {
    writeLog(`reusing existing Hermes API Server at ${runtime.baseUrl}`);
    return { ok: true, reused: true, owned: false, child: undefined, logPath, runtime, runtimeApiKey: prepared.runtimeApiKey };
  }
  if (existing.reachable && existing.status !== 404) {
    writeLog(`the preferred Hermes port responded with HTTP ${existing.status}; looking for another local port`);
  }
  if (await isPortBusy(runtime.port, runtime.host)) {
    const previousPort = runtime.port;
    const allocated = await allocateLocalRuntimeUrl(environment, {
      maxAttempts: options.portScanLimit ?? DEFAULT_PORT_SCAN_LIMIT
    });
    if (allocated.error || allocated.runtime.error || allocated.runtime.port === runtime.port) {
      writeLog(`startup blocked: ${runtime.host}:${runtime.port} is occupied by another process`);
      return failedCompanion("hermes_runtime_port_occupied", logPath, { runtime });
    }
    environment = allocated.environment;
    runtime = allocated.runtime;
    prepared = prepareHermesEnvironment(environment, {
      allowEphemeralRuntimeKey: options.allowEphemeralRuntimeKey === true,
      allowProviderKeyFallback: options.allowProviderKeyFallback === true,
      projectRoot,
      appBaseUrl: options.appBaseUrl,
      hermesHome,
      hermesRuntimeRoot: options.hermesRuntimeRoot
    });
    if (!prepared.runtimeApiKey) {
      writeLog("startup blocked: no Hermes runtime API key is available after port reassignment");
      return failedCompanion("hermes_runtime_api_key_missing", logPath, { runtime });
    }
    writeLog(`runtime port ${previousPort} is occupied; reassigned Hermes API Server to ${runtime.host}:${runtime.port}`);
  }

  const launch = resolveHermesLaunch(environment, options, prepared.childEnvironment);
  const args = launch.args;
  const bridgeStatusUrl = options.watchMcpBridge === false ? undefined : resolveBridgeStatusUrl(environment, options);
  const bridgeAtStart = bridgeStatusUrl ? await probeMcpBridge(bridgeStatusUrl) : { connected: true, bridgeId: undefined };
  writeLog(`starting Hermes gateway API Server on ${runtime.host}:${runtime.port}`);
  const child = spawnGateway(launch, prepared.childEnvironment, launch.cwd ?? projectRoot, writeLog);
  const handle = {
    ok: false,
    reused: false,
    owned: true,
    child,
    logPath,
    runtime,
    runtimeApiKey: prepared.runtimeApiKey,
    exit: undefined,
    binary: launch.command,
    args,
    launch,
    cwd: launch.cwd ?? projectRoot,
    childEnvironment: prepared.childEnvironment,
    configurationFingerprint: hermesConfigurationFingerprint(prepared.childEnvironment),
    writeLog,
    bridgeStatusUrl,
    bridgeConnected: bridgeAtStart.connected,
    bridgeId: bridgeAtStart.bridgeId,
    bridgeWatcher: undefined,
    bridgeRefreshInFlight: false,
    bridgeRefreshPromise: undefined,
    // If the bridge was already connected before Hermes launched, the child
    // registered its live MCP catalog during its own startup. Refreshing it
    // again immediately would replace a healthy gateway during renderer boot.
    // A bridge discovered later still gets one bounded refresh.
    bridgeRefreshCompleted: bridgeAtStart.connected,
    lastRefreshedBridgeId: bridgeAtStart.connected
      ? (bridgeAtStart.bridgeId ?? "connected")
      : undefined,
    lastBridgeRefreshAt: 0,
    replacementChild: undefined,
    stopping: false
  };
  attachChildLifecycle(handle, child);

  try {
    await waitForHealth(runtime.healthUrl, prepared.runtimeApiKey, child, options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS);
    handle.ok = true;
    writeLog("Hermes API Server health check passed");
    if (bridgeStatusUrl) startMcpBridgeWatcher(handle, options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS);
    return handle;
  } catch (error) {
    writeLog(`startup failed: ${error instanceof Error ? error.message : String(error)}`);
    await stopHermesCompanion(handle);
    return failedCompanion("hermes_runtime_start_failed", logPath, { runtime, runtimeApiKey: prepared.runtimeApiKey });
  }
}

function resolveHermesLaunch(environment, options, childEnvironment) {
  const bundledRuntime = resolveBundledHermesRuntime(childEnvironment, { ...options, projectRoot: options.projectRoot ?? process.cwd() });
  if (bundledRuntime) {
    return {
      kind: "bundled",
      command: bundledRuntime.pythonExecutable,
      args: ["-m", "hermes_cli.main", "gateway", "run", "--replace", "--force"],
      cwd: options.runtimeCwd || path.dirname(bundledRuntime.pythonExecutable)
    };
  }
  const binary = findHermesBinary(environment);
  return {
    kind: "external",
    command: binary,
    args: ["gateway", "run", "--replace", "--force"],
    cwd: options.runtimeCwd || options.projectRoot || process.cwd()
  };
}

function hermesConfigurationFingerprint(environment) {
  return crypto.createHash("sha256").update(JSON.stringify({
    baseUrl: firstValue(environment.AI_BASE_URL, environment.HERMES_BASE_URL, environment.OPENAI_BASE_URL),
    model: firstValue(environment.AI_MODEL, environment.HERMES_MODEL, environment.HERMES_INFERENCE_MODEL),
    apiKey: firstValue(environment.AI_API_KEY, environment.OPENAI_API_KEY),
    runtimeUrl: firstValue(environment.HERMES_RUNTIME_URL) || DEFAULT_RUNTIME_URL
  })).digest("hex");
}

async function stopHermesCompanion(handle) {
  if (!handle?.owned) return;
  handle.stopping = true;
  if (handle.bridgeWatcher) clearInterval(handle.bridgeWatcher);
  handle.bridgeWatcher = undefined;
  const children = [handle.child, handle.replacementChild].filter((child, index, list) => child && list.indexOf(child) === index);
  for (const child of children) {
    if (child.exitCode === null) await terminateChild(child);
  }
  handle.replacementChild = undefined;
}

async function terminateChild(child) {
  if (process.platform === "win32" && child.pid) {
    await new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  } else {
    child.kill("SIGTERM");
  }
  await waitForExit(child, 5_000);
}

function spawnGateway(launch, environment, cwd, writeLog) {
  const child = spawn(launch.command, launch.args, {
    cwd,
    env: environment,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    // The bundled launcher is a real python.exe and the external fallback is
    // expected to be a real Hermes executable. Never create a visible CMD
    // window or route the managed child through a shell.
    shell: false
  });
  attachLog(child.stdout, writeLog, "stdout");
  attachLog(child.stderr, writeLog, "stderr");
  return child;
}

function attachChildLifecycle(handle, child) {
  child.once("error", (error) => {
    if (handle.child === child) handle.exit = { code: undefined, signal: undefined, error: error.message };
    handle.writeLog(`process error: ${error.message}`);
  });
  child.once("exit", (code, signal) => {
    if (handle.child === child) handle.exit = { code, signal };
    handle.writeLog(`process exited: code=${code ?? "none"} signal=${signal ?? "none"}`);
  });
}

function resolveBridgeStatusUrl(environment, options) {
  const appBaseUrl = firstValue(
    options.appBaseUrl,
    environment.CAREERADAPT_BASE_URL,
    environment.PLAYWRIGHT_BASE_URL,
    DEFAULT_APP_URL
  );
  return `${appBaseUrl.replace(/\/$/u, "")}/api/agent/mcp`;
}

async function probeMcpBridge(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000), headers: { Accept: "application/json" } });
    const payload = await response.json().catch(() => ({}));
    return {
      connected: response.ok
      && payload
      && typeof payload === "object"
      && payload.status
      && payload.status.connected === true,
      bridgeId: payload?.status?.bridgeId
    };
  } catch {
    return { connected: false, bridgeId: undefined };
  }
}

function startMcpBridgeWatcher(handle, timeoutMs) {
  handle.bridgeWatcher = setInterval(async () => {
    if (!handle.owned || handle.stopping || handle.bridgeRefreshInFlight) return;
    const bridge = await probeMcpBridge(handle.bridgeStatusUrl);
    if (!bridge.connected) {
      handle.bridgeConnected = false;
      handle.bridgeId = undefined;
      return;
    }
    const bridgeKey = bridge.bridgeId ?? "connected";
    const bridgeChanged = Boolean(handle.bridgeId && bridge.bridgeId && handle.bridgeId !== bridge.bridgeId);
    const needsRefresh = !handle.bridgeRefreshCompleted
      && (!handle.bridgeConnected || bridgeChanged || handle.lastRefreshedBridgeId !== bridgeKey);
    if (!needsRefresh) {
      handle.bridgeConnected = true;
      handle.bridgeId = bridge.bridgeId;
      return;
    }
    handle.bridgeConnected = true;
    handle.bridgeId = bridge.bridgeId;
    if (Date.now() - handle.lastBridgeRefreshAt < MCP_REFRESH_COOLDOWN_MS) return;
    handle.lastBridgeRefreshAt = Date.now();
    handle.bridgeRefreshInFlight = true;
    handle.writeLog(`CareerAdapt MCP bridge connected (${bridgeKey}); refreshing Hermes MCP session`);
    const refreshPromise = (async () => {
      await delay(500);
      if (await refreshHermesGateway(handle, timeoutMs)) {
        handle.lastRefreshedBridgeId = bridgeKey;
        handle.bridgeRefreshCompleted = true;
      }
    })();
    handle.bridgeRefreshPromise = refreshPromise;
    try {
      await refreshPromise;
    } finally {
      if (handle.bridgeRefreshPromise === refreshPromise) handle.bridgeRefreshPromise = undefined;
      handle.bridgeRefreshInFlight = false;
    }
  }, MCP_WATCH_INTERVAL_MS);
}

async function refreshHermesGateway(handle, timeoutMs) {
  if (handle.stopping) return false;
  const previous = handle.child;
  // A bridge that was present before the gateway became healthy was already
  // included in the initial Hermes MCP registration. Do not replace the
  // gateway just to repeat that same registration during renderer boot.
  if (handle.bridgeRefreshCompleted && handle.lastRefreshedBridgeId) return true;
  const replacement = spawnGateway(handle.launch, handle.childEnvironment, handle.cwd ?? process.cwd(), handle.writeLog);
  handle.replacementChild = replacement;
  attachChildLifecycle(handle, replacement);
  try {
    // The replacement process may initially see the old server's health
    // response. Wait for the old gateway to release its singleton/port before
    // probing health, otherwise the old response can make us adopt a process
    // that is about to exit with "another gateway instance".
    if (previous && previous !== replacement && previous.exitCode === null) {
      await waitForExit(previous, GATEWAY_REPLACEMENT_TIMEOUT_MS);
      if (previous.exitCode === null) await terminateChild(previous);
    }
    if (replacement.exitCode !== null) throw new Error(`replacement exited before health check (code=${replacement.exitCode})`);
    await waitForHealth(handle.runtime.healthUrl, handle.runtimeApiKey, replacement, timeoutMs);
    if (handle.stopping) {
      await terminateChild(replacement);
      return false;
    }
    handle.child = replacement;
    handle.replacementChild = undefined;
    handle.exit = undefined;
    handle.writeLog("Hermes MCP session refreshed after CareerAdapt bridge registration");
    return true;
  } catch (error) {
    handle.writeLog(`Hermes MCP session refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    await terminateChild(replacement);
    if (handle.replacementChild === replacement) handle.replacementChild = undefined;
    return false;
  }
}

function failedCompanion(reason, logPath, extra = {}) {
  return { ok: false, reused: false, owned: false, child: undefined, reason, logPath, ...extra };
}

function createLogWriter(logPath, secrets) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  return (message) => {
    const safe = redact(String(message), secrets);
    fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${safe}\n`, "utf8");
  };
}

function attachLog(stream, writeLog, channel) {
  if (!stream) return;
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line) writeLog(`[${channel}] ${line}`);
  });
  stream.on("end", () => {
    if (buffer) writeLog(`[${channel}] ${buffer}`);
  });
}

function redact(value, secrets) {
  let safe = value;
  for (const secret of secrets.filter((item) => typeof item === "string" && item.length >= 8)) {
    safe = safe.split(secret).join("[REDACTED]");
  }
  return safe.replace(/Bearer\s+[A-Za-z0-9._~+/-]+/giu, "Bearer [REDACTED]");
}

async function waitForHealth(url, apiKey, child, timeoutMs) {
  const startedAt = Date.now();
  let lastError = "unreachable";
  while (Date.now() - startedAt < timeoutMs) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Hermes exited before health check (code=${child.exitCode})`);
    }
    const response = await probeHealth(url, apiKey);
    if (response.ok) return response;
    lastError = response.status ? `HTTP ${response.status}` : "unreachable";
    await delay(HEALTH_POLL_MS);
  }
  throw new Error(`Hermes health check timed out: ${lastError}`);
}

async function probeHealth(url, apiKey) {
  const urls = [url];
  if (url.endsWith("/health")) urls.push(`${url.slice(0, -"/health".length)}/api/health`);
  let lastResult = { ok: false, reachable: false, status: undefined };
  for (const candidate of urls) {
    try {
      const response = await fetch(candidate, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } : { Accept: "application/json" },
        signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS)
      });
      lastResult = { ok: response.ok, reachable: true, status: response.status };
      if (response.ok || response.status !== 404) return lastResult;
    } catch {
      // Try the compatibility health path before reporting the runtime as down.
    }
  }
  return lastResult;
}

function isPortBusy(port, host) {
  return isPortAvailable(port, host).then((available) => !available);
}

function isPortAvailable(port, host = DEFAULT_LOCAL_HOST) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    const onError = (error) => {
      server.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    };
    const onListening = () => server.close(() => resolve(true));
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim();
}

async function runCli() {
  const command = process.argv[2] ?? "start";
  const projectRoot = path.resolve(__dirname, "..");
  const environment = loadCareerAdaptEnvironment(projectRoot);
  if (command === "check") {
    const runtime = resolveRuntimeConfig(environment);
    const result = runtime.error ? { ok: false, reason: runtime.error } : await probeHealth(runtime.healthUrl, firstValue(environment.HERMES_RUNTIME_API_KEY, environment.HERMES_API_KEY, environment.AI_API_KEY));
    console.log(`Hermes companion: ${result.ok ? "READY" : "NOT READY"}`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command !== "start") {
    console.error("Usage: node electron/hermesCompanion.js [start|check]");
    process.exitCode = 2;
    return;
  }
  const handle = await startHermesCompanion({
    projectRoot,
    environment,
    hermesHome: path.join(projectRoot, ".next", "dev", "hermes"),
    logPath: path.join(projectRoot, ".next", "dev", "logs", "hermes-runtime.log"),
    allowProviderKeyFallback: true
  });
  if (!handle.ok) {
    console.error(`Hermes companion failed to start: ${handle.reason ?? "unknown"}`);
    console.error(`Hermes log: ${handle.logPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Hermes companion ready on ${handle.runtime.baseUrl}`);
  console.log(`Hermes log: ${handle.logPath}`);
  const shutdown = async () => {
    await stopHermesCompanion(handle);
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  await new Promise(() => {});
}

module.exports = {
  applyEnvironment,
  createEphemeralRuntimeApiKey,
  findAvailablePort,
  allocateLocalRuntimeUrl,
  loadCareerAdaptEnvironment,
  prepareHermesEnvironment,
  hermesConfigurationFingerprint,
  resolveRuntimeConfig,
  parsePort,
  ensureManagedHermesConfig,
  startHermesCompanion,
  stopHermesCompanion
};

if (require.main === module) void runCli();
