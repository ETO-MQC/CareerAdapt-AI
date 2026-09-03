/* eslint-disable @typescript-eslint/no-require-imports */

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const net = require("net");
const fs = require("fs");
const {
  applyEnvironment,
  allocateLocalRuntimeUrl,
  findAvailablePort,
  loadCareerAdaptEnvironment,
  parsePort,
  resolveRuntimeControlKey
} = require("./hermesCompanion");
const { HermesSupervisor } = require("./hermesSupervisor");

let mainWindow;
let nextServer;
let nextApp;
let serverUrl;
let ocrSidecarProcess;
let ocrSidecarStarting = false;
let ocrBootstrapTimer;
let hermesSupervisor;

const isDev = !app.isPackaged;
const HOST = "127.0.0.1";
const DEFAULT_APP_PORT = 3000;
const APP_PORT_STATE_FILE = "runtime-ports.json";
let serverPort = DEFAULT_APP_PORT;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "职适AI",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js")
    },
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.loadURL(url).catch((error) => {
    console.error("Failed to load CareerAdapt AI:", error);
    dialog.showErrorBox("页面加载失败", `无法打开应用页面：${error.message}`);
    app.quit();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function getAppPath() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
}

function getServerUrl() {
  return `http://${HOST}:${serverPort}`;
}

function readSavedAppPort() {
  try {
    const statePath = path.join(app.getPath("userData"), APP_PORT_STATE_FILE);
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return parsePort(state.appPort, undefined);
  } catch {
    return undefined;
  }
}

function saveAppPort(port) {
  try {
    const statePath = path.join(app.getPath("userData"), APP_PORT_STATE_FILE);
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify({ appPort: port }, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn("Unable to persist the selected app port:", error instanceof Error ? error.message : error);
  }
}

function configureOcrDefaults() {
  const ocrDataPath = path.join(app.getPath("userData"), "ocr");
  process.env.CAREERADAPT_OCR_DATA_DIR = process.env.CAREERADAPT_OCR_DATA_DIR || ocrDataPath;
  process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR = process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR
    || path.join(ocrDataPath, "PaddleOCR-VL-1.6");
}

async function configureHermesDefaults(appPath, environment, options = {}) {
  const bundledRuntimeRoot = app.isPackaged
    ? path.join(process.resourcesPath, "hermes-runtime")
    : path.join(appPath, ".electron-build", "hermes-runtime-v4");
  const hermesHome = environment.CAREERADAPT_HERMES_HOME?.trim() || path.join(app.getPath("userData"), "hermes");
  const hasBundledRuntime = fs.existsSync(path.join(bundledRuntimeRoot, "runtime-manifest.json"));
  if (hasBundledRuntime) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(bundledRuntimeRoot, "runtime-manifest.json"), "utf8"));
      if (!environment.AI_BASE_URL && typeof manifest.providerBaseUrl === "string") environment.AI_BASE_URL = manifest.providerBaseUrl;
      if (!environment.AI_MODEL && typeof manifest.model === "string") environment.AI_MODEL = manifest.model;
    } catch {
      // The companion will report a missing provider configuration if the
      // optional build manifest cannot be read.
    }
  }

  if (!options.preserveRuntimeUrl) {
    const runtimeAllocation = await allocateLocalRuntimeUrl({
      ...environment,
      HERMES_RUNTIME_URL: environment.HERMES_RUNTIME_URL || "http://127.0.0.1:8642"
    }, { reservedPorts: [serverPort] });
    environment.HERMES_RUNTIME_URL = runtimeAllocation.environment.HERMES_RUNTIME_URL
      || environment.HERMES_RUNTIME_URL
      || "http://127.0.0.1:8642";
  } else {
    environment.HERMES_RUNTIME_URL = environment.HERMES_RUNTIME_URL || "http://127.0.0.1:8642";
  }
  // These are internal service addresses. Always publish the addresses
  // selected for this launch instead of retaining stale values from .env.
  environment.CAREERADAPT_BASE_URL = getServerUrl();
  environment.CAREERADAPT_APP_PORT = String(serverPort);
  environment.PORT = String(serverPort);
  // HERMES_HOME is application state, not a pointer to a separately
  // installed Hermes checkout. Keep it under Electron userData so the
  // bundled runtime owns its config, sessions, logs and managed skills.
  environment.HERMES_HOME = hermesHome;
  if (hasBundledRuntime) {
    environment.HERMES_RUNTIME_MODE = "bundled";
    environment.HERMES_RUNTIME_ROOT = bundledRuntimeRoot;
    environment.HERMES_SKILLS_ROOT = path.join(bundledRuntimeRoot, "skills", "careeradapt");
  }
}

function getStandalonePath(appPath) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "next-standalone")
    : path.join(appPath, ".next", "standalone");
}

function isPortAvailable(port, host = HOST) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    const onError = (error) => {
      probe.removeListener("listening", onListening);
      if (error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    };
    const onListening = () => {
      probe.close(() => resolve(true));
    };

    probe.once("error", onError);
    probe.once("listening", onListening);
    probe.listen(port, host);
  });
}

function waitForServer(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const check = () => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.setTimeout(1000, () => request.destroy());
      request.once("error", () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`本地应用服务器在 ${timeoutMs / 1000} 秒内没有响应。`));
          return;
        }
        setTimeout(check, 150);
      });
    };

    check();
  });
}

async function startDevelopmentServer(appPath, port) {
  const next = require(path.join(appPath, "node_modules", "next"));
  nextApp = next({
    dev: true,
    dir: appPath,
    hostname: HOST,
    port
  });
  await nextApp.prepare();

  const handle = nextApp.getRequestHandler();
  nextServer = http.createServer((request, response) => handle(request, response));
  await new Promise((resolve, reject) => {
    nextServer.once("error", reject);
    nextServer.listen(port, HOST, resolve);
  });

  return getServerUrl();
}

async function startLocalOcrSidecar(appPath) {
  if (process.env.PADDLEOCR_VL_ENDPOINT || ocrSidecarProcess || ocrSidecarStarting) return;
  ocrSidecarStarting = true;
  try {
    const modelDirectory = process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR;
    const scriptPath = app.isPackaged
      ? path.join(process.resourcesPath, "scripts", "paddleocr_vl_sidecar.py")
      : path.join(appPath, "scripts", "paddleocr_vl_sidecar.py");
    if (!modelDirectory || !fs.existsSync(path.join(modelDirectory, "config.json")) || !fs.existsSync(scriptPath)) {
      return;
    }
    if (!await isPortAvailable(8765)) {
      process.env.PADDLEOCR_VL_ENDPOINT = "http://127.0.0.1:8765";
      return;
    }

    const configuredPython = process.env.CAREERADAPT_PADDLEOCR_PYTHON;
    const bundledPython = path.join(app.getPath("userData"), "ocr", "runtime", ".venv", "Scripts", "python.exe");
    const python = configuredPython || (fs.existsSync(bundledPython) ? bundledPython : "py");
    const args = python === "py" ? ["-3", scriptPath] : [scriptPath];
    const endpoint = "http://127.0.0.1:8765";
    const token = crypto.randomBytes(24).toString("hex");
    process.env.PADDLEOCR_VL_ENDPOINT = endpoint;
    process.env.PADDLEOCR_VL_MODEL_DIR = modelDirectory;
    process.env.PADDLEOCR_VL_PORT = "8765";
    process.env.PADDLEOCR_VL_TOKEN = token;
    const environment = {
      ...process.env,
      PADDLEOCR_VL_ENDPOINT: endpoint,
      PADDLEOCR_VL_MODEL_DIR: modelDirectory,
      PADDLEOCR_VL_PORT: "8765",
      PADDLEOCR_VL_TOKEN: token
    };
    ocrSidecarProcess = spawn(python, args, {
      cwd: app.isPackaged ? process.resourcesPath : appPath,
      env: environment,
      windowsHide: true,
      stdio: "ignore"
    });
    ocrSidecarProcess.once("error", () => {
      ocrSidecarProcess = null;
      delete process.env.PADDLEOCR_VL_ENDPOINT;
      delete process.env.PADDLEOCR_VL_MODEL_DIR;
      delete process.env.PADDLEOCR_VL_PORT;
      delete process.env.PADDLEOCR_VL_TOKEN;
    });
    ocrSidecarProcess.once("exit", () => {
      ocrSidecarProcess = null;
      delete process.env.PADDLEOCR_VL_ENDPOINT;
      delete process.env.PADDLEOCR_VL_MODEL_DIR;
      delete process.env.PADDLEOCR_VL_PORT;
      delete process.env.PADDLEOCR_VL_TOKEN;
    });
    await waitForServer(`${endpoint}/health`, 6000).catch(() => {
      // Python or PaddleOCR may not be installed yet. The settings page will
      // report the missing runtime while the app remains usable without OCR.
    });
  } finally {
    ocrSidecarStarting = false;
  }
}

async function startPackagedServer(appPath, port) {
  const standalonePath = getStandalonePath(appPath);
  const serverPath = path.join(standalonePath, "server.js");

  if (!fs.existsSync(serverPath)) {
    throw new Error(`找不到 Next standalone 服务：${serverPath}`);
  }

  process.env.NODE_ENV = "production";
  process.env.HOSTNAME = HOST;
  process.env.PORT = String(port);
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  // standalone/server.js 会在当前进程内启动 Next 服务，避免依赖安装 Node.js。
  require(serverPath);
  await waitForServer(getServerUrl());
  return getServerUrl();
}

async function startServer() {
  const appPath = getAppPath();
  const environment = loadCareerAdaptEnvironment(appPath);
  const preferredAppPort = parsePort(
    environment.CAREERADAPT_APP_PORT || readSavedAppPort() || environment.PORT,
    DEFAULT_APP_PORT
  );
  const preferredAppUrl = `http://${HOST}:${preferredAppPort}`;
  const preferredPortAvailable = await isPortAvailable(preferredAppPort);
  let reuseExistingDevelopmentServer = false;
  if (!preferredPortAvailable && isDev) {
    reuseExistingDevelopmentServer = await waitForServer(preferredAppUrl, 3000).then(() => true).catch(() => false);
  }
  if (reuseExistingDevelopmentServer) {
    serverPort = preferredAppPort;
    const existingHealth = await readServerJson(`${preferredAppUrl}/api/agent/runtime/hermes/health`);
    if (existingHealth?.runtimeUrl) environment.HERMES_RUNTIME_URL = existingHealth.runtimeUrl;
  } else {
    const selectedAppPort = await findAvailablePort({
      host: HOST,
      preferredPort: preferredPortAvailable ? preferredAppPort : preferredAppPort + 1,
      reservedPorts: []
    });
    if (!selectedAppPort) {
      throw new Error(`从端口 ${preferredAppPort} 开始没有找到可用的本地应用端口。`);
    }
    serverPort = selectedAppPort;
  }
  await configureHermesDefaults(appPath, environment, {
    preserveRuntimeUrl: reuseExistingDevelopmentServer && Boolean(environment.HERMES_RUNTIME_URL)
  });
  configureOcrDefaults();
  await startLocalOcrSidecar(appPath);
  ocrBootstrapTimer = setInterval(() => { void startLocalOcrSidecar(appPath); }, 5000);

  const runtimeControlKey = resolveRuntimeControlKey(environment, {
    allowEphemeralRuntimeKey: !reuseExistingDevelopmentServer
  });
  environment.HERMES_RUNTIME_API_KEY = runtimeControlKey || "";
  environment.API_SERVER_KEY = runtimeControlKey || "";
  environment.HERMES_API_KEY = "";
  applyEnvironment(environment);

  console.log("Starting CareerAdapt AI server...");
  console.log("App path:", appPath);
  console.log("Server URL:", getServerUrl());
  console.log("Hermes URL:", environment.HERMES_RUNTIME_URL);
  console.log("Packaged:", app.isPackaged);

  if (reuseExistingDevelopmentServer) {
    applyEnvironment(environment);
    console.warn(`端口 ${serverPort} 已有开发服务器，直接复用：${getServerUrl()}`);
    createHermesSupervisor(appPath, environment, runtimeControlKey);
    saveAppPort(serverPort);
    return getServerUrl();
  }

  const url = isDev
    ? startDevelopmentServer(appPath, serverPort)
    : startPackagedServer(appPath, serverPort);
  const resolvedUrl = await url;
  saveAppPort(serverPort);
  // Hermes starts only after the renderer-owned Browser Domain Host sends
  // the MCP READY handshake.
  createHermesSupervisor(appPath, environment, runtimeControlKey);
  return resolvedUrl;
}

async function readServerJson(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
    return response.ok ? await response.json() : undefined;
  } catch {
    return undefined;
  }
}


function createHermesSupervisor(appPath, environment, runtimeControlKey) {
  hermesSupervisor = new HermesSupervisor({
    projectRoot: appPath,
    appPath,
    appBaseUrl: getServerUrl(),
    environment: { ...environment },
    runtimeControlKey,
    hermesHome: environment.HERMES_HOME,
    hermesRuntimeRoot: environment.HERMES_RUNTIME_ROOT,
    runtimeCwd: app.isPackaged ? process.resourcesPath : appPath,
    logPath: path.join(app.getPath("logs"), "hermes-runtime.log"),
    requireBundledRuntime: app.isPackaged,
    broadcast: broadcastHermesStatus
  });
  console.log("[Hermes] Supervisor created; waiting for renderer MCP/domain host READY");
  return hermesSupervisor;
}

function broadcastHermesStatus(snapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("careeradapt:hermes:status-changed", snapshot);
  }
}

ipcMain.handle("careeradapt:hermes:renderer-ready", async (_event, requestedSettings) => {
  if (!hermesSupervisor) return { ok: false, reason: "careeradapt_app_not_ready" };
  const snapshot = await hermesSupervisor.rendererHostReady(requestedSettings);
  return { ok: true, snapshot };
});

ipcMain.handle("careeradapt:hermes:status", () => hermesSupervisor?.getStatus());

ipcMain.handle("careeradapt:hermes:start", async (_event, requestedSettings) => {
  return runHermesControlAction("start", () => hermesSupervisor.ensureStarted(requestedSettings));
});

ipcMain.handle("careeradapt:hermes:stop", async () => {
  return runHermesControlAction("stop", () => hermesSupervisor.stop());
});

ipcMain.handle("careeradapt:hermes:restart", async (_event, options) => {
  return runHermesControlAction("restart", () => hermesSupervisor.restart(options));
});

ipcMain.handle("careeradapt:hermes:recover", async () => {
  return runHermesControlAction("recover", () => hermesSupervisor.recover());
});

ipcMain.handle("careeradapt:hermes:logs", async () => {
  if (!hermesSupervisor) return { logPath: undefined, latestLifecycleEntries: [], recentLogLines: [] };
  return hermesSupervisor.getLogs();
});

ipcMain.handle("careeradapt:hermes:open-logs", async () => {
  if (!hermesSupervisor) return { ok: false, reason: "careeradapt_app_not_ready" };
  const result = await shell.openPath((await hermesSupervisor.getLogs()).logPath);
  return result ? { ok: false, reason: result } : { ok: true };
});

ipcMain.handle("careeradapt:hermes:config", async () => hermesSupervisor?.getConfig());
ipcMain.handle("careeradapt:hermes:config-schema", async () => hermesSupervisor?.getConfigSchema());
ipcMain.handle("careeradapt:hermes:update-config", async (_event, settings) => {
  return runHermesControlAction("update_config", () => hermesSupervisor.updateConfig(settings));
});
ipcMain.handle("careeradapt:hermes:reload-config", async () => {
  return runHermesControlAction("reload_config", () => hermesSupervisor.reloadConfigFromEnvironment());
});
ipcMain.handle("careeradapt:hermes:reset-config", async () => {
  return runHermesControlAction("reset_config", () => hermesSupervisor.resetConfig());
});

async function runHermesControlAction(action, operation) {
  const requestedAt = new Date().toISOString();
  if (!hermesSupervisor) {
    return {
      ok: false,
      reason: "careeradapt_app_not_ready",
      receipt: {
        action,
        requestedAt,
        accepted: false,
        executed: false,
        previousState: "unavailable",
        nextState: "unavailable",
        safeReasonCode: "careeradapt_app_not_ready",
        controlOwner: "electron_supervisor"
      }
    };
  }
  const previous = hermesSupervisor.getStatus();
  let snapshot;
  try {
    snapshot = await operation();
  } catch (error) {
    const safeReasonCode = safeControlReason(error, `${action}_failed`);
    return {
      ok: false,
      reason: safeReasonCode,
      snapshot: previous,
      receipt: {
        action,
        requestedAt,
        accepted: true,
        executed: false,
        previousState: serviceState(previous),
        nextState: serviceState(previous),
        safeReasonCode,
        controlOwner: "electron_supervisor"
      }
    };
  }
  const safeReasonCode = snapshot.reasonCode || `${action}_completed`;
  const configAction = ["update_config", "reload_config", "reset_config"].includes(action);
  const runtimeConfig = snapshot.runtimeConfig;
  const configApplied = runtimeConfig?.applyStatus === "applied" && runtimeConfig.verified === true;
  const configRolledBack = runtimeConfig?.applyStatus === "rolled_back";
  return {
    ok: configAction
      ? configApplied
      : action === "start" ? snapshot.overallState !== "unavailable" : true,
    reason: snapshot.reasonCode,
    runtimeUrl: snapshot.runtimeUrl,
    snapshot,
    receipt: {
      action,
      requestedAt,
      accepted: true,
      executed: configAction ? configApplied || configRolledBack : true,
      previousState: serviceState(previous),
      nextState: serviceState(snapshot),
      safeReasonCode,
      controlOwner: "electron_supervisor",
      ...(configAction ? {
        applyStatus: runtimeConfig?.applyStatus,
        desiredFingerprint: runtimeConfig?.desiredFingerprint,
        activeFingerprint: runtimeConfig?.activeFingerprint,
        restartPerformed: runtimeConfig?.restartPerformed === true,
        verified: configApplied,
        rollbackOccurred: configRolledBack,
        reasonCode: runtimeConfig?.reasonCode || snapshot.reasonCode
      } : {})
    }
  };
}

function safeControlReason(error, fallback) {
  const candidate = error && typeof error === "object" && typeof error.code === "string" ? error.code : undefined;
  return candidate ? candidate.replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 120) : fallback;
}

function serviceState(snapshot) {
  if (snapshot.overallState === "stopped") return "stopped";
  if (["starting", "api_ready", "syncing_career_tools", "restarting"].includes(snapshot.overallState)) return "starting";
  if (snapshot.overallState === "stopping") return "stopping";
  if (snapshot.overallState === "unavailable") return "unavailable";
  return snapshot.processReady ? "running" : "unavailable";
}

async function stopServer() {
  if (ocrBootstrapTimer) {
    clearInterval(ocrBootstrapTimer);
    ocrBootstrapTimer = null;
  }
  if (ocrSidecarProcess) {
    ocrSidecarProcess.kill();
    ocrSidecarProcess = null;
  }
  if (hermesSupervisor) {
    await hermesSupervisor.shutdown();
    hermesSupervisor = undefined;
  }
  if (nextServer) {
    await new Promise((resolve) => nextServer.close(resolve));
    nextServer = null;
  }
  if (nextApp && typeof nextApp.close === "function") {
    await nextApp.close();
    nextApp = null;
  }
}

Menu.setApplicationMenu(null);

app.whenReady().then(async () => {
  try {
    serverUrl = await startServer();
    createWindow(serverUrl);
  } catch (error) {
    console.error("Failed to start CareerAdapt AI:", error);
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("启动失败", message);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  void stopServer();
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
    createWindow(serverUrl);
  }
});

app.on("before-quit", () => {
  void stopServer();
});
