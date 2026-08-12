/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("careerAdaptDesktop", {
  startHermes: (settings) => ipcRenderer.invoke("careeradapt:hermes:start", settings)
});
