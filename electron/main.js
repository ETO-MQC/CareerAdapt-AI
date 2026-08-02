/* eslint-disable @typescript-eslint/no-require-imports */

const { app, BrowserWindow, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const http = require("http");
const net = require("net");
const fs = require("fs");

let mainWindow;
let nextServer;
let nextApp;
let serverUrl;
let ocrSidecarProcess;
let ocrSidecarStarting = false;
let ocrBootstrapTimer;

const isDev = !app.isPackaged;
const HOST = "127.0.0.1";
// Keep the origin stable so Chromium's IndexedDB and LocalStorage survive restarts.
const PORT = 3000;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    title: "职适AI",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
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
  return `http://${HOST}:${PORT}`;
}

function configureOcrDefaults() {
  const ocrDataPath = path.join(app.getPath("userData"), "ocr");
  process.env.CAREERADAPT_OCR_DATA_DIR = process.env.CAREERADAPT_OCR_DATA_DIR || ocrDataPath;
  process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR = process.env.CAREERADAPT_PADDLEOCR_MODEL_DIR
    || path.join(ocrDataPath, "PaddleOCR-VL-1.6");
}

function getStandalonePath(appPath) {
  return app.isPackaged
    ? path.join(process.resourcesPath, "next-standalone")
    : path.join(appPath, ".next", "standalone");
}

function isPortAvailable(port) {
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
    probe.listen(port, HOST);
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

async function startDevelopmentServer(appPath) {
  const next = require(path.join(appPath, "node_modules", "next"));
  nextApp = next({
    dev: true,
    dir: appPath,
    hostname: HOST,
    port: PORT
  });
  await nextApp.prepare();

  const handle = nextApp.getRequestHandler();
  nextServer = http.createServer((request, response) => handle(request, response));
  await new Promise((resolve, reject) => {
    nextServer.once("error", reject);
    nextServer.listen(PORT, HOST, resolve);
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

async function startPackagedServer(appPath) {
  const standalonePath = getStandalonePath(appPath);
  const serverPath = path.join(standalonePath, "server.js");

  if (!fs.existsSync(serverPath)) {
    throw new Error(`找不到 Next standalone 服务：${serverPath}`);
  }

  process.env.NODE_ENV = "production";
  process.env.HOSTNAME = HOST;
  process.env.PORT = String(PORT);
  process.env.NEXT_TELEMETRY_DISABLED = "1";

  // standalone/server.js 会在当前进程内启动 Next 服务，避免依赖安装 Node.js。
  require(serverPath);
  await waitForServer(getServerUrl());
  return getServerUrl();
}

async function startServer() {
  const appPath = getAppPath();
  configureOcrDefaults();
  await startLocalOcrSidecar(appPath);
  ocrBootstrapTimer = setInterval(() => { void startLocalOcrSidecar(appPath); }, 5000);
  const portAvailable = await isPortAvailable(PORT);

  if (!portAvailable) {
    if (isDev && await waitForServer(getServerUrl(), 3000).then(() => true).catch(() => false)) {
      console.warn(`端口 ${PORT} 已有开发服务器，直接复用：${getServerUrl()}`);
      return getServerUrl();
    }
    throw new Error(`端口 ${PORT} 已被占用。请关闭占用该端口的程序后重试。`);
  }

  console.log("Starting CareerAdapt AI server...");
  console.log("App path:", appPath);
  console.log("Server URL:", getServerUrl());
  console.log("Packaged:", app.isPackaged);

  return isDev
    ? startDevelopmentServer(appPath)
    : startPackagedServer(appPath);
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
