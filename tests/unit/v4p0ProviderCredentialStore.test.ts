import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * V4-P0 S-0 contract: the secure provider-credential store.
 *
 * These tests pin the two properties the feature exists for:
 *   1. the credential is never written in plaintext at rest, and
 *   2. no renderer-facing status object can leak the value.
 *
 * A fake `safeStorage` is injected so the behaviour is deterministic and the module stays
 * importable under vitest, where `require("electron")` is unavailable.
 */

const require = createRequire(import.meta.url);
const {
  CREDENTIAL_STORE_REASONS,
  STORE_FILE_NAME,
  createProviderCredentialStore
} = require("../../electron/providerCredentialStore.js") as {
  CREDENTIAL_STORE_REASONS: Record<string, string>;
  STORE_FILE_NAME: string;
  createProviderCredentialStore: (options: Record<string, unknown>) => {
    available(): boolean;
    describe(): { available: boolean; configured: boolean; source: string; reason?: string };
    read(): string | undefined;
    write(apiKey: string): { ok: boolean; reason?: string; available: boolean; configured: boolean };
    clear(): { ok: boolean; changed: boolean; available: boolean; configured: boolean };
  };
};

const SECRET = "unit-test-provider-secret-do-not-log";

function createTempDir() {
  return mkdtempSync(path.join(tmpdir(), "careeradapt-v4p0-credentials-"));
}

/** Reversible stand-in for Electron safeStorage; mirrors the base64 ciphertext contract. */
function createFakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, "utf8"),
    decryptString: (buffer: Buffer) => {
      const decoded = buffer.toString("utf8");
      if (!decoded.startsWith("enc:")) throw new Error("not an encrypted payload");
      return decoded.slice("enc:".length);
    }
  };
}

describe("V4-P0 S-0 secure provider credential store", () => {
  it("stores the credential encrypted and never as plaintext on disk", () => {
    const dir = createTempDir();
    try {
      const store = createProviderCredentialStore({
        storePath: path.join(dir, STORE_FILE_NAME),
        safeStorage: createFakeSafeStorage()
      });

      expect(store.available()).toBe(true);
      expect(store.write(SECRET).ok).toBe(true);

      const raw = readFileSync(path.join(dir, STORE_FILE_NAME), "utf8");
      expect(raw, "the credential must not be recoverable from the file").not.toContain(SECRET);
      expect(JSON.parse(raw)).toMatchObject({ version: 1 });

      // The plaintext is still recoverable by this OS user, which is the point of the store.
      expect(store.read()).toBe(SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never returns the credential through describe()", () => {
    const dir = createTempDir();
    try {
      const store = createProviderCredentialStore({
        storePath: path.join(dir, STORE_FILE_NAME),
        safeStorage: createFakeSafeStorage()
      });
      store.write(SECRET);

      const description = store.describe();
      expect(description).toEqual({ available: true, configured: true, source: "secure_store" });
      // This is the exact object shape that crosses IPC to the renderer.
      expect(JSON.stringify(description)).not.toContain(SECRET);
      expect(JSON.stringify(store.write(SECRET))).not.toContain(SECRET);
      expect(JSON.stringify(store.clear())).not.toContain(SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to store anything when encryption is unavailable instead of falling back to plaintext", () => {
    const dir = createTempDir();
    try {
      const store = createProviderCredentialStore({
        storePath: path.join(dir, STORE_FILE_NAME),
        safeStorage: createFakeSafeStorage(false)
      });

      expect(store.available()).toBe(false);
      const result = store.write(SECRET);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(CREDENTIAL_STORE_REASONS.unavailable);

      // Nothing may have been written, and the value must not be readable back.
      expect(store.read()).toBeUndefined();
      expect(store.describe()).toMatchObject({ available: false, configured: false, source: "server_env" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports server-env-only when no store path or safeStorage handle exists", () => {
    // Web mode: main.js always supplies both, so this mirrors a browser-only deployment.
    const noStorage = createProviderCredentialStore({});
    expect(noStorage.available()).toBe(false);
    expect(noStorage.describe()).toMatchObject({ available: false, source: "server_env" });
    expect(noStorage.write(SECRET).ok).toBe(false);
    expect(noStorage.read()).toBeUndefined();

    const noPath = createProviderCredentialStore({ safeStorage: createFakeSafeStorage() });
    expect(noPath.available()).toBe(false);
    expect(noPath.describe().source).toBe("server_env");
  });

  it("rejects a blank credential and clears an existing one", () => {
    const dir = createTempDir();
    try {
      const storePath = path.join(dir, STORE_FILE_NAME);
      const store = createProviderCredentialStore({ storePath, safeStorage: createFakeSafeStorage() });

      expect(store.write("   ").ok).toBe(false);
      expect(store.write("").ok).toBe(false);
      expect(store.describe().configured).toBe(false);

      store.write(SECRET);
      expect(store.clear()).toMatchObject({ ok: true, changed: true });
      expect(store.read()).toBeUndefined();
      expect(store.describe()).toMatchObject({ available: true, configured: false, source: "server_env" });
      // Clearing again is a no-op rather than an error.
      expect(store.clear()).toMatchObject({ ok: true, changed: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("surfaces a corrupt store file as a diagnosable failure, not as a usable credential", () => {
    const dir = createTempDir();
    try {
      const storePath = path.join(dir, STORE_FILE_NAME);
      const store = createProviderCredentialStore({ storePath, safeStorage: createFakeSafeStorage() });
      writeFileSync(storePath, "{ not json", "utf8");

      expect(store.describe()).toMatchObject({ available: true, configured: false, reason: CREDENTIAL_STORE_REASONS.read_failed });
      expect(store.read()).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not resurrect a payload that this OS user cannot decrypt", () => {
    const dir = createTempDir();
    try {
      const storePath = path.join(dir, STORE_FILE_NAME);
      createProviderCredentialStore({ storePath, safeStorage: createFakeSafeStorage() }).write(SECRET);

      // Simulates a re-imaged keychain / different OS user: decrypt now throws.
      const rekeyed = createProviderCredentialStore({
        storePath,
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (plain: string) => Buffer.from(plain, "utf8"),
          decryptString: () => { throw new Error("decryption failed"); }
        }
      });
      expect(rekeyed.read()).toBeUndefined();
      // Still reports configured, because the ciphertext is present; read() stays empty so the
      // key never reaches the provider by accident.
      expect(rekeyed.describe().configured).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});