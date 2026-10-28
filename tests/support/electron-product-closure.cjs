/* eslint-disable @typescript-eslint/no-require-imports -- Native Electron main-process diagnostic entry. */
const { app, dialog } = require("electron");
const path = require("node:path");

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
