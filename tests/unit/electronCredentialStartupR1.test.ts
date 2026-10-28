// @vitest-environment node
import { createRequire } from "node:module";
import vm from "node:vm";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const credentials = require("../../electron/providerCredentialStore.js");
const companion = require("../../electron/hermesCompanion.js");
const secret = "synthetic-desktop-r1-credential";
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`test-encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().slice("test-encrypted:".length)
};

function boot(mode: string, userData: string, safeStorage = fakeSafeStorage) {
  const order: string[] = [];
  const ipc = new Map<string, (...args: unknown[]) => unknown>();
  let supervisorEnvironment: Record<string, string> = {};
  const environment: Record<string, string> = { PADDLEOCR_VL_ENDPOINT: "http://127.0.0.1:1" };
  const app = { isPackaged: mode === "packaged", getPath: () => userData, getAppPath: () => process.cwd(), whenReady: () => ({ then: () => undefined }), on: () => undefined };
  const context = vm.createContext({
    module: { exports: {} }, __dirname: path.resolve("electron"), Buffer,
    process: { env: environment, resourcesPath: path.resolve(".tmp/r1-resources") },
    console: { log: () => undefined, warn: () => undefined, error: () => undefined },
    setInterval: () => 1, clearInterval: () => undefined, setTimeout,
    require: (id: string) => {
      if (id === "electron") return { app, ipcMain: { handle: (name: string, fn: (...args: unknown[]) => unknown) => ipc.set(name, fn) }, Menu: { setApplicationMenu: () => undefined } };
      if (id === "./providerCredentialStore") return {
        createUserDataCredentialStore: () => { order.push("store-init"); return credentials.createUserDataCredentialStore(userData, safeStorage); },
        restoreProviderCredential: (env: Record<string, string>, store: unknown) => { order.push("restore"); return credentials.restoreProviderCredential(env, store); }
      };
      if (id === "./hermesCompanion") return {
        ...companion,
        loadCareerAdaptEnvironment: () => ({ AI_BASE_URL: "https://provider.example/v1", AI_MODEL: "before-model", AI_API_KEY: "old-env-key", HERMES_CUSTOM_CAREERADAPT_API_KEY: "old-bound-key" }),
        applyEnvironment: (env: Record<string, string>) => Object.assign(environment, env),
        allocateLocalRuntimeUrl: async (env: Record<string, string>) => ({ environment: env })
      };
      if (id === "./hermesSupervisor") return { HermesSupervisor: class {
        constructor(options: { environment: Record<string, string> }) { order.push("supervisor"); supervisorEnvironment = options.environment; }
      } };
      if (id === "net") return { createServer: () => {
        const probe = new EventEmitter() as EventEmitter & { listen(): void; close(fn: () => void): void };
        probe.listen = () => queueMicrotask(() => probe.emit(mode === "reuse" ? "error" : "listening", { code: "EADDRINUSE" }));
        probe.close = fn => fn();
        return probe;
      } };
      if (id === "http") return {
        get: (_url: string, callback: (r: unknown) => void) => { queueMicrotask(() => callback({ resume: () => undefined })); return { setTimeout: () => undefined, once: () => undefined }; },
        createServer: () => ({ once: () => undefined, listen: (_p: number, _h: string, resolve: () => void) => resolve() })
      };
      if (id === "fs") return { ...fs, existsSync: (p: string) => p.endsWith("server.js") || fs.existsSync(p) && !p.includes("runtime-manifest") };
      if (id.endsWith(path.join("node_modules", "next"))) return () => ({ prepare: async () => { order.push("next-dev"); expect(environment.AI_API_KEY).toBe(secret); }, getRequestHandler: () => () => undefined });
      if (id.endsWith("server.js")) { order.push("next-packaged"); expect(environment.AI_API_KEY).toBe(secret); return {}; }
      return require(id.startsWith("./") ? path.resolve("electron", id) : id);
    },
    fetch: async () => ({ ok: true, json: async () => ({ runtimeUrl: "http://127.0.0.1:18642" }) })
  });
  vm.runInContext(fs.readFileSync("electron/main.js", "utf8") + "\nmodule.exports = { startServer };", context);
  return { start: () => (context.module.exports as { startServer(): Promise<string> }).startServer(), order, ipc, getEnvironment: () => supervisorEnvironment };
}

describe("R1 Desktop credential startup ordering", () => {
  it.each(["reuse", "self", "packaged"])("restores secure credentials before %s server/Supervisor and IPC use", async mode => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "careeradapt-r1-boot-"));
    credentials.createUserDataCredentialStore(dir, fakeSafeStorage).write(secret);
    const fixture = boot(mode, dir);
    await fixture.start();
    expect(fixture.order.slice(0, 2)).toEqual(["store-init", "restore"]);
    expect(fixture.order.at(-1)).toBe("supervisor");
    const description = await fixture.ipc.get("careeradapt:credentials:describe")!();
    expect(description).toMatchObject({ available: true, configured: true, source: "secure_store" });
    expect(JSON.stringify(description)).not.toContain(secret);
    expect(fixture.getEnvironment()).toMatchObject({ AI_API_KEY: secret, HERMES_CUSTOM_CAREERADAPT_API_KEY: secret, CAREERADAPT_CREDENTIAL_SOURCE: "secure_store" });
    // A fresh main process restores the same ciphertext, without asking for another key.
    const restarted = boot(mode, dir);
    await restarted.start();
    expect(restarted.getEnvironment().AI_API_KEY).toBe(secret);
  });

  it("distinguishes unavailable, unconfigured, and decrypt-failed stores", async () => {
    const dir = fs.mkdtempSync(path.join(tmpdir(), "careeradapt-r1-status-"));
    const unavailable = credentials.createUserDataCredentialStore(dir, { ...fakeSafeStorage, isEncryptionAvailable: () => false });
    expect(unavailable.describe()).toMatchObject({ available: false, reason: "credential_store_unavailable" });
    expect(unavailable.write(secret)).toMatchObject({ ok: false, reason: "credential_store_unavailable" });
    expect(credentials.createUserDataCredentialStore(dir, fakeSafeStorage).describe()).toMatchObject({ available: true, configured: false, reason: "credential_store_not_configured" });
    credentials.createUserDataCredentialStore(dir, fakeSafeStorage).write(secret);
    const bad = boot("self", dir, { ...fakeSafeStorage, decryptString: () => { throw new Error("must not disclose secret"); } });
    await expect(bad.start()).rejects.toThrow("credential_store_read_failed");
    expect(bad.order).toEqual(["store-init", "restore"]);
  });
});
