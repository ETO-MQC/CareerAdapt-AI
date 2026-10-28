/* eslint-disable @typescript-eslint/no-require-imports -- Native Electron main-process diagnostic entry. */
const { app, dialog } = require("electron");
const path = require("node:path");

if (process.env.CORE_MODEL_DIAGNOSTICS === "true") {
  globalThis.__coreModelDiagnostics = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const pathname = new URL(typeof input === "string" ? input : input.url).pathname;
    if (pathname !== "/api/model/options") return originalFetch(input, init);
    const event = { at: new Date().toISOString(), endpoint: pathname };
    globalThis.__coreModelDiagnostics.push(event);
    try {
      const response = await originalFetch(input, init);
      event.httpStatus = response.status;
      const body = await response.clone().json();
      event.readback = { model: body.model, provider: body.provider };
      return response;
    } catch (error) {
      event.exception = { name: ["TimeoutError", "AbortError", "TypeError", "SyntaxError"].includes(error.name) ? error.name : "Error",
        code: typeof error.code === "number" ? error.code : undefined };
      throw error;
    } finally { event.finishedAt = new Date().toISOString(); }
  };
  const { HermesSupervisor } = require("../../electron/hermesSupervisor.js");
  const applyStatus = HermesSupervisor.prototype.setConfigurationApplyStatus;
  HermesSupervisor.prototype.setConfigurationApplyStatus = function (...args) {
    const result = applyStatus.apply(this, args);
    globalThis.__coreModelDiagnostics.push({ at: new Date().toISOString(), applyStatus: args[0], reasonCode: args[1],
      activeModel: this.runtimeConfigState.active?.model, desiredModel: this.runtimeConfigState.desired?.model,
      activeFingerprint: this.runtimeConfigState.active?.configFingerprint, desiredFingerprint: this.runtimeConfigState.desired?.configFingerprint });
    return result;
  };
}

app.setPath("userData", process.env.CLOSURE_PROFILE);
// Suppress development DevTools only; the real product renderer, preload and IPC remain intact.
app.on("browser-window-created", (_event, window) => {
  window.webContents.openDevTools = () => undefined;
  window.once("ready-to-show", () => window.hide());
});
// A corrupt-store scenario must report the native startup error without a blocking OS dialog.
dialog.showErrorBox = (_title, message) => {
  console.log(JSON.stringify({ closureEvent: "startup-error", code: message === "credential_store_read_failed" ? message : "startup_error" }));
};
app.whenReady().then(() => {
  console.log(JSON.stringify({ closureEvent: "ready", electron: process.versions.electron, sessionDataMatchesUserData: app.getPath("sessionData") === app.getPath("userData") }));
});
require(path.resolve(__dirname, "../../electron/main.js"));
