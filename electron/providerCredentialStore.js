/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * Secure provider-credential storage for the Electron main process (V4-P0 S-0).
 *
 * Purpose: give the renderer a way to set/clear a provider API key WITHOUT the key ever being
 * readable or storable in the browser. The renderer previously kept the key in plaintext
 * `localStorage` and shipped it as base64 (not encryption) in the `x-ai-config` header.
 *
 * Guarantees:
 *   - At rest the key is encrypted with Electron `safeStorage` (OS keychain / DPAPI / libsecret)
 *     and written as base64 ciphertext. There is NO plaintext fallback: if encryption is not
 *     available, writes fail with an explicit reason instead of degrading to plain storage.
 *   - `describe()` is the only shape allowed to cross to the renderer. It reports availability and
 *     whether a credential exists -- never the value.
 *   - `read()` returns the plaintext and is for main-process consumers only (Hermes child env,
 *     Next routes running in this same process). Callers must not forward it to the renderer.
 *
 * Module boundary: standalone CommonJS so it can be unit-tested under vitest (electron/main.js and
 * electron/preload.js cannot be imported there because they require("electron")). The Electron
 * `safeStorage` handle is injected, with a resolver used only in production.
 */

const fs = require("fs");
const path = require("path");

const STORE_FILE_NAME = "provider-credentials.json";
const STORE_VERSION = 1;

/** Reason codes are stable identifiers; callers map them to UI copy. Do not embed secrets. */
const CREDENTIAL_STORE_REASONS = {
  unavailable: "credential_store_unavailable",
  not_configured: "credential_store_not_configured",
  read_failed: "credential_store_read_failed",
  write_failed: "credential_store_write_failed",
  invalid_payload: "credential_store_invalid_payload"
};

function resolveElectronSafeStorage() {
  // Only reachable inside the Electron main process. Absent in web-only mode and in vitest,
  // which is exactly why availability is reported rather than assumed.
  try {
    const electron = require("electron");
    return electron && electron.safeStorage ? electron.safeStorage : undefined;
  } catch {
    return undefined;
  }
}

function createProviderCredentialStore(options = {}) {
  const storePath = typeof options.storePath === "string" && options.storePath.trim()
    ? options.storePath
    : undefined;
  const safeStorage = options.safeStorage;

  function available() {
    if (!storePath) return false;
    if (!safeStorage || typeof safeStorage.encryptString !== "function") return false;
    if (typeof safeStorage.isEncryptionAvailable !== "function") return false;
    try {
      return safeStorage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  function readStoredPayload() {
    if (!storePath || !fs.existsSync(storePath)) return undefined;
    const raw = fs.readFileSync(storePath, "utf8");
    if (!raw.trim()) return undefined;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw credentialStoreError(CREDENTIAL_STORE_REASONS.invalid_payload, "credential store file is not valid JSON");
    }
    if (!parsed || typeof parsed !== "object" || typeof parsed.encryptedApiKey !== "string" || !parsed.encryptedApiKey) {
      throw credentialStoreError(CREDENTIAL_STORE_REASONS.invalid_payload, "credential store file has no encrypted key");
    }
    return parsed;
  }

  /**
   * Renderer-safe status. Never includes the key or any derivative of it.
   * `source` describes where an effective credential would come from, not where it came from.
   */
  function describe() {
    if (!available()) {
      // Web mode, or a platform without an OS keychain. Per V4-P0 S-0 the caller may only read
      // server-side environment configuration in that case; it must not offer to store a key.
      return { available: false, configured: false, source: "server_env", reason: CREDENTIAL_STORE_REASONS.unavailable };
    }
    let configured = false;
    try {
      configured = readStoredPayload() !== undefined;
    } catch {
      return { available: true, configured: false, source: "server_env", reason: CREDENTIAL_STORE_REASONS.read_failed };
    }
    return { available: true, configured, source: configured ? "secure_store" : "server_env" };
  }

  /** Main-process only. Returns the plaintext key, or undefined when nothing is stored. */
  function read() {
    if (!available()) return undefined;
    let payload;
    try {
      payload = readStoredPayload();
    } catch {
      return undefined;
    }
    if (!payload) return undefined;
    try {
      const apiKey = safeStorage.decryptString(Buffer.from(payload.encryptedApiKey, "base64"));
      return typeof apiKey === "string" && apiKey.trim() ? apiKey : undefined;
    } catch {
      // A payload encrypted by another OS user or a re-imaged keychain is unusable. Report it
      // rather than returning a wrong value; `describe()` surfaces the same failure.
      return undefined;
    }
  }

  /** Persists the key encrypted. Refuses to store plaintext when safeStorage is unavailable. */
  function write(apiKey) {
    if (!available()) {
      return { ok: false, reason: CREDENTIAL_STORE_REASONS.unavailable, ...describe() };
    }
    const value = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!value) {
      return { ok: false, reason: CREDENTIAL_STORE_REASONS.invalid_payload, ...describe() };
    }
    try {
      const encryptedApiKey = safeStorage.encryptString(value).toString("base64");
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(
        storePath,
        `${JSON.stringify({ version: STORE_VERSION, encryptedApiKey }, null, 2)}\n`,
        "utf8"
      );
      // Restrict the file to the current user before it holds a secret.
      try {
        fs.chmodSync(storePath, 0o600);
      } catch {
        // Windows and some filesystems do not support chmod; safeStorage already bound the
        // ciphertext to this OS user, so this is not a security boundary.
      }
      return { ok: true, ...describe() };
    } catch {
      return { ok: false, reason: CREDENTIAL_STORE_REASONS.write_failed, ...describe() };
    }
  }

  function clear() {
    if (!storePath || !fs.existsSync(storePath)) return { ok: true, changed: false, ...describe() };
    try {
      fs.rmSync(storePath);
      return { ok: true, changed: true, ...describe() };
    } catch {
      return { ok: false, reason: CREDENTIAL_STORE_REASONS.write_failed, ...describe() };
    }
  }

  return { available, describe, read, write, clear };
}

function credentialStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/** Store bound to Electron's userData directory. Callers must be in the main process. */
function createUserDataCredentialStore(userDataPath, safeStorage = resolveElectronSafeStorage()) {
  return createProviderCredentialStore({
    storePath: path.join(userDataPath, STORE_FILE_NAME),
    safeStorage
  });
}

module.exports = {
  CREDENTIAL_STORE_REASONS,
  STORE_FILE_NAME,
  STORE_VERSION,
  createProviderCredentialStore,
  createUserDataCredentialStore,
  resolveElectronSafeStorage
};