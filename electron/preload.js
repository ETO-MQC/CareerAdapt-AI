/* eslint-disable @typescript-eslint/no-require-imports */

const { contextBridge, ipcRenderer } = require("electron");

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("careerAdaptDesktop", {
  getHermesStatus: () => ipcRenderer.invoke("careeradapt:hermes:status"),
  notifyHermesRendererReady: (settings) => ipcRenderer.invoke("careeradapt:hermes:renderer-ready", settings),
  startHermes: (settings) => ipcRenderer.invoke("careeradapt:hermes:start", settings),
  stopHermes: () => ipcRenderer.invoke("careeradapt:hermes:stop"),
  restartHermes: (options) => ipcRenderer.invoke("careeradapt:hermes:restart", options),
  recoverHermes: () => ipcRenderer.invoke("careeradapt:hermes:recover"),
  getHermesLogs: () => ipcRenderer.invoke("careeradapt:hermes:logs"),
  openHermesLogs: () => ipcRenderer.invoke("careeradapt:hermes:open-logs"),
  getHermesConfig: () => ipcRenderer.invoke("careeradapt:hermes:config"),
  getHermesConfigSchema: () => ipcRenderer.invoke("careeradapt:hermes:config-schema"),
  updateHermesConfig: (settings) => ipcRenderer.invoke("careeradapt:hermes:update-config", settings),
  reloadHermesConfig: () => ipcRenderer.invoke("careeradapt:hermes:reload-config"),
  resetHermesConfig: () => ipcRenderer.invoke("careeradapt:hermes:reset-config"),
  // V4-P0 S-0 secure credential channel. These expose no read-back of the stored key: `set`
  // accepts a key to store encrypted, and both calls resolve to a status object only.
  describeProviderCredential: () => ipcRenderer.invoke("careeradapt:credentials:describe"),
  setProviderCredential: (credential) => ipcRenderer.invoke("careeradapt:credentials:set", credential),
  clearProviderCredential: () => ipcRenderer.invoke("careeradapt:credentials:clear"),
  subscribeHermesStatus: (listener) => subscribe("careeradapt:hermes:status-changed", listener)
});
