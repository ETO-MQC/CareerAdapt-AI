import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAiSettings,
  decodeAiSettingsFromHeader,
  encodeAiSettingsForHeader,
  hasCustomAiSettings,
  readAiSettings,
  writeAiSettings,
  type AiSettings
} from "@/services/storage/aiSettings";

/**
 * V4-P0 S-1/S-2/S-4 credential-handling contract.
 *
 * These tests pin the security boundary that replaced the old plaintext flow, where the key lived
 * in `localStorage` and was shipped as base64 (an encoding, not encryption) in `x-ai-config`:
 *
 *   1. `writeAiSettings` never persists a credential.
 *   2. `readAiSettings` never returns one, and scrubs a legacy plaintext value.
 *   3. The header encoder never emits a credential, and the decoder discards a legacy one.
 *
 * A regression here would silently reintroduce renderer-held secrets, so the assertions are on the
 * serialized bytes rather than on types.
 */

const SECRET = "unit-test-provider-secret-do-not-log";
const STORAGE_KEY = "careeradapt-ai-settings";

const settings: AiSettings = {
  provider: "openai-compatible",
  baseUrl: "https://provider.example/v1",
  apiKey: SECRET,
  model: "candidate-model",
  apiKeyConfigured: true
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllEnvs();
});

describe("V4-P0 credential transport contract", () => {
  it("never persists a credential, even when one is passed in", () => {
    writeAiSettings(settings);

    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    expect(raw, "localStorage must not contain the credential").not.toContain(SECRET);
    expect(JSON.parse(raw)).toMatchObject({
      baseUrl: "https://provider.example/v1",
      model: "candidate-model",
      apiKeyConfigured: true
    });
    // The field is dropped rather than written as an empty string, so no code can read it back.
    expect("apiKey" in JSON.parse(raw)).toBe(false);
  });

  it("never returns a credential on read", () => {
    writeAiSettings(settings);
    expect(readAiSettings().apiKey).toBe("");
  });

  it("scrubs a credential persisted by an earlier build", () => {
    // Simulate the pre-S-1 payload: plaintext apiKey sitting in localStorage.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: SECRET,
      model: "candidate-model"
    }));

    const restored = readAiSettings();

    expect(restored.apiKey, "a stored credential must never be restored").toBe("");
    // The legacy value is converted into the boolean flag so the UI can still report presence.
    expect(restored.apiKeyConfigured).toBe(true);
    // And the plaintext is removed from storage, not merely ignored.
    const raw = localStorage.getItem(STORAGE_KEY) ?? "";
    expect(raw, "legacy plaintext credential must be scrubbed from storage").not.toContain(SECRET);
    expect("apiKey" in JSON.parse(raw)).toBe(false);
  });

  it("encodes only non-sensitive fields into the header", () => {
    const encoded = encodeAiSettingsForHeader(settings);
    const decoded = decodeAiSettingsFromHeader(encoded);

    expect(decoded?.baseUrl).toBe("https://provider.example/v1");
    expect(decoded?.model).toBe("candidate-model");
    expect(decoded?.provider).toBe("openai-compatible");
    // base64 is reversible, so assert on the encoded and decoded payloads both.
    expect(encoded).not.toContain(SECRET);
    expect(decodeURIComponent(atob(encoded))).not.toContain(SECRET);
    expect(decoded?.apiKey).toBe("");
  });

  it("discards a credential sent by an outdated client", () => {
    const legacyEncoded = btoa(encodeURIComponent(JSON.stringify({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      apiKey: SECRET,
      model: "candidate-model"
    })));

    const decoded = decodeAiSettingsFromHeader(legacyEncoded);

    expect(decoded?.apiKey, "a credential in the header must not be honoured").toBe("");
    expect(decoded?.baseUrl).toBe("https://provider.example/v1");
  });

  it("does not treat a stored credential flag as a custom renderer configuration", () => {
    // The credential is resolved server-side, so the renderer must not claim to configure the
    // provider on its own behalf and attach a header as a result.
    writeAiSettings({ ...settings, apiKey: "", baseUrl: "", model: "" });
    expect(hasCustomAiSettings()).toBe(false);
  });

  it("clears stored settings entirely", () => {
    writeAiSettings(settings);
    clearAiSettings();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(readAiSettings().apiKey).toBe("");
  });
});