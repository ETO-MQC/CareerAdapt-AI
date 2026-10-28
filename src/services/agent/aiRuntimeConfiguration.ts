import type { AiSettings } from "@/services/storage/aiSettings";
import { hashText, stableHashText } from "@/services/security/text";
import { resolveHermesProviderBinding } from "../../../electron/hermesProviderBinding.js";
import { credentialFingerprintPepper } from "../../../electron/credentialFingerprintPepper.js";

export type AiRuntimeConfigDraft = AiSettings;
export const DEFAULT_AI_PROVIDER_BASE_URL = "https://api.openai.com/v1";
export type AiRuntimeConfigSource = "environment" | "managed_config" | "runtime_readback" | "unknown";
export type AiRuntimeConfigApplyStatus =
  | "idle"
  | "validating"
  | "testing"
  | "saving"
  | "restarting_runtime"
  | "verifying"
  | "applied"
  | "deferred"
  | "failed"
  | "rolled_back";

export type AiRuntimeConfigValue = {
  provider: string;
  baseUrl: string;
  baseUrlHostPath?: string;
  model: string;
  credentialConfigured: boolean;
  credentialSource: "server_env" | "secure_store" | "managed_config" | "custom_header" | "default" | "missing" | "unknown";
  configFingerprint: string;
  configGeneration: number;
  source: AiRuntimeConfigSource;
  lastAppliedAt?: string;
};

export type AiRuntimeConfigActive = AiRuntimeConfigValue;
export type AiRuntimeConfigDesired = AiRuntimeConfigValue;

export type AiRuntimeConfigState = {
  active?: AiRuntimeConfigActive;
  desired?: AiRuntimeConfigDesired;
  activeFingerprint?: string;
  desiredFingerprint?: string;
  activeGeneration?: number;
  desiredGeneration?: number;
  applyStatus: AiRuntimeConfigApplyStatus;
  restartPerformed?: boolean;
  verified?: boolean;
  rollbackOccurred?: boolean;
  reasonCode?: string;
  updatedAt?: string;
};

export type AiRuntimeConfigApplyReceipt = {
  applyStatus: AiRuntimeConfigApplyStatus;
  desiredFingerprint?: string;
  activeFingerprint?: string;
  restartPerformed: boolean;
  verified: boolean;
  rollbackOccurred: boolean;
  reasonCode?: string;
};

export function normalizeAiRuntimeConfigDraft(settings: AiRuntimeConfigDraft): AiRuntimeConfigDraft {
  return {
    provider: settings.provider.trim(),
    baseUrl: settings.baseUrl.trim(),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    credentialAction: settings.credentialAction
  };
}

export function validateAiRuntimeConfigDraft(settings: AiRuntimeConfigDraft): string | undefined {
  const draft = normalizeAiRuntimeConfigDraft(settings);
  if (draft.baseUrl) {
    let url: URL;
    try {
      url = new URL(draft.baseUrl);
    } catch {
      return "provider_base_url_invalid";
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return "provider_base_url_protocol_invalid";
  }
  if (draft.provider && /^https?:\/\//iu.test(draft.provider)) return "provider_identity_must_not_be_url";
  if (draft.credentialAction === "clear" && draft.apiKey) return "credential_clear_conflict";
  if (draft.credentialAction === "replace" && !draft.apiKey) return "credential_replace_missing";
  return undefined;
}

export function normalizeAiProviderIdentity(provider: string | undefined, baseUrl: string | undefined) {
  return resolveHermesProviderBinding({ provider, baseUrl }).providerId;
}

// V4-P0 A1: the configuration fingerprint reaches the renderer, so the raw
// provider credential must never be a direct hash input. The credential is
// reduced to an HMAC-SHA-256 tag under a pepper shared with the Electron-side
// fingerprint (see electron/credentialFingerprintPepper.js for the launch-path
// rules). This mirrors electron/hermesCompanion.js credentialFingerprintValue().
async function credentialFingerprintValue(credential: string | undefined) {
  const pepper = credentialFingerprintPepper();
  const message = credential?.trim() ?? "";
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Same fallback contract as hashText() for runtimes without WebCrypto;
    // supported runtimes (Node >= 20, Chromium) always take the HMAC path.
    return stableHashText(`${pepper}:${message}`);
  }
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function runtimeConfigFingerprintPayload(input: {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}, credentialFingerprint: string) {
  return JSON.stringify({
    provider: normalizeAiProviderIdentity(input.provider, input.baseUrl),
    baseUrl: input.baseUrl?.trim() || DEFAULT_AI_PROVIDER_BASE_URL,
    model: input.model?.trim() ?? "",
    credentialFingerprint
  });
}

export async function runtimeConfigFingerprint(input: {
  provider?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}) {
  return hashText(runtimeConfigFingerprintPayload(input, await credentialFingerprintValue(input.apiKey)));
}

export function credentialSourceForDraft(settings: AiRuntimeConfigDraft): AiRuntimeConfigValue["credentialSource"] {
  if (settings.apiKey.trim() || settings.credentialAction === "replace") return "managed_config";
  return settings.credentialAction === "clear" ? "missing" : "unknown";
}
