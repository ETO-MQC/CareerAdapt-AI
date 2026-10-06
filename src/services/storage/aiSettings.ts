const STORAGE_KEY = "careeradapt-ai-settings";

/**
 * Renderer-side AI settings (V4-P0 S-1).
 *
 * Security contract: this module NEVER persists or returns a provider API key. Previously the key
 * was written to `localStorage` in plaintext and shipped as base64 (not encryption) in the
 * `x-ai-config` header, which meant any renderer script injection could read it.
 *
 * The credential now lives only in the Electron main process, encrypted with `safeStorage` (see
 * `electron/providerCredentialStore.js`), or in server-side environment configuration for web.
 * This module keeps only a boolean saying whether a credential is configured.
 *
 * `apiKey` remains on the type as an in-flight form value: the Settings input holds what the user
 * typed until it is handed to the secure store, and it is never written here or restored from
 * storage.
 */
export type AiSettings = {
  baseUrl: string;
  /** In-flight form value only. Never persisted and never restored by `readAiSettings`. */
  apiKey: string;
  /** Whether a credential is configured, via the secure store or server environment. */
  apiKeyConfigured?: boolean;
  model: string;
  provider: string;
  /** Blank keys are normally left unchanged; the UI uses clear explicitly. */
  credentialAction?: "unchanged" | "replace" | "clear";
};

const DEFAULTS: AiSettings = {
  baseUrl: "",
  apiKey: "",
  apiKeyConfigured: false,
  model: "",
  provider: "openai-compatible",
  credentialAction: "unchanged"
};

export function readAiSettings(): AiSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULTS };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULTS };
    }

    const parsed = JSON.parse(raw);
    const stored: AiSettings = {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULTS.baseUrl,
      // Deliberately always empty: a key is never read back out of storage.
      apiKey: "",
      apiKeyConfigured: typeof parsed.apiKeyConfigured === "boolean"
        ? parsed.apiKeyConfigured
        : typeof parsed.apiKey === "string" && parsed.apiKey.length > 0,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULTS.model,
      provider: typeof parsed.provider === "string" ? parsed.provider : DEFAULTS.provider,
      credentialAction: parsed.credentialAction === "replace" || parsed.credentialAction === "clear"
        ? parsed.credentialAction
        : "unchanged"
    };

    // One-time scrub of a credential persisted by an earlier build. Without this the plaintext key
    // would sit in localStorage indefinitely even though nothing reads it any more.
    if (typeof parsed.apiKey === "string" && parsed.apiKey.length > 0) {
      writeAiSettings(stored);
    }

    return stored;
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Persists settings without the credential. `apiKey` is dropped here by construction, so no
 * call site can leak a key into storage even if it passes one in.
 */
export function writeAiSettings(settings: AiSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    baseUrl: settings.baseUrl,
    apiKeyConfigured: settings.apiKeyConfigured,
    model: settings.model,
    provider: settings.provider,
    credentialAction: settings.credentialAction
  }));
}

export function clearAiSettings(): void {
  if (typeof window === "undefined") {
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

export function hasStoredAiSettings(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) !== null;
}

/**
 * Whether the renderer holds settings that differ from the server defaults. Credentials are not
 * part of this: they are resolved by the server from the secure store or its own environment, so
 * a stored `apiKeyConfigured` flag must not make the renderer claim a custom configuration.
 */
export function hasCustomAiSettings(): boolean {
  const settings = readAiSettings();
  return settings.baseUrl.length > 0
    || settings.model.length > 0
    || (settings.provider.length > 0 && settings.provider !== DEFAULTS.provider)
    || settings.credentialAction === "clear";
}

/**
 * Transport encoding for the non-sensitive settings fields.
 *
 * The credential is excluded here on purpose (V4-P0 S-1): base64 is an encoding, not encryption,
 * so a header carrying the key exposed it to any log, proxy, or crash dump on the request path.
 * S-2 removes the remaining credential path from the receiving routes.
 */
export function encodeAiSettingsForHeader(settings: AiSettings): string {
  return btoa(encodeURIComponent(JSON.stringify({
    baseUrl: settings.baseUrl,
    model: settings.model,
    provider: settings.provider,
    credentialAction: settings.credentialAction
  })));
}

export function decodeAiSettingsFromHeader(encoded: string): AiSettings | undefined {
  try {
    const decoded = decodeURIComponent(atob(encoded));
    const parsed = JSON.parse(decoded);
    if (typeof parsed !== "object" || parsed === null) {
      return undefined;
    }
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      // A key sent by an older client is discarded rather than honoured.
      apiKey: "",
      apiKeyConfigured: typeof parsed.apiKeyConfigured === "boolean" ? parsed.apiKeyConfigured : false,
      model: typeof parsed.model === "string" ? parsed.model : "",
      provider: typeof parsed.provider === "string" ? parsed.provider : "openai-compatible",
      credentialAction: parsed.credentialAction === "replace" || parsed.credentialAction === "clear"
        ? parsed.credentialAction
        : "unchanged"
    };
  } catch {
    return undefined;
  }
}