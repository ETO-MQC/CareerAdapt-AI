import { createRequire } from "node:module";
import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeConfigFingerprint, runtimeConfigFingerprintPayload } from "@/services/agent/aiRuntimeConfiguration";

const require = createRequire(import.meta.url);
const {
  captureLine,
  createLogRedactor,
  hermesConfigurationFingerprint,
  hermesLogSecrets
} = require("../../electron/hermesCompanion.js") as {
  captureLine: (lines: string[], line: string, redactLine?: (line: string) => string) => void;
  createLogRedactor: (secrets: unknown[]) => (line: string) => string;
  hermesConfigurationFingerprint: (environment: Record<string, string>) => string;
  hermesLogSecrets: (environment: Record<string, string>) => string[];
};
const { ensureCredentialFingerprintPepper } = require("../../electron/credentialFingerprintPepper.js") as {
  ensureCredentialFingerprintPepper: (configured?: string) => string;
};

const PEPPER = "v4p0-credential-fingerprint-pepper";
const CREDENTIAL_ENV = {
  AI_PROVIDER: "openrouter",
  AI_BASE_URL: "https://openrouter.ai/api/v1",
  AI_MODEL: "test-model",
  AI_API_KEY: "sk-v4p0-credential-under-test"
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("V4-P0 A1 credential fingerprint boundary", () => {
  it("hashes the credential through a peppered HMAC so the raw key never drives the fingerprint", () => {
    vi.stubEnv("CAREERADAPT_CREDENTIAL_PEPPER", PEPPER);

    const fingerprint = hermesConfigurationFingerprint(CREDENTIAL_ENV);
    const credentialTag = crypto.createHmac("sha256", PEPPER).update(CREDENTIAL_ENV.AI_API_KEY).digest("hex");
    const expected = crypto.createHash("sha256").update(JSON.stringify({
      provider: "openrouter",
      baseUrl: CREDENTIAL_ENV.AI_BASE_URL,
      model: CREDENTIAL_ENV.AI_MODEL,
      credentialFingerprint: credentialTag
    })).digest("hex");

    expect(fingerprint).toBe(expected);
    expect(fingerprint).not.toBe(crypto.createHash("sha256").update(CREDENTIAL_ENV.AI_API_KEY).digest("hex"));
    expect(fingerprint).not.toContain(CREDENTIAL_ENV.AI_API_KEY);
  });

  it("keeps the configuration-change detection semantics when only the credential changes", () => {
    vi.stubEnv("CAREERADAPT_CREDENTIAL_PEPPER", PEPPER);

    const before = hermesConfigurationFingerprint(CREDENTIAL_ENV);
    const afterKeyRotation = hermesConfigurationFingerprint({ ...CREDENTIAL_ENV, AI_API_KEY: "sk-rotated-key" });
    const afterClear = hermesConfigurationFingerprint({ ...CREDENTIAL_ENV, AI_API_KEY: "" });

    expect(afterKeyRotation).not.toBe(before);
    expect(afterClear).not.toBe(before);
    expect(afterKeyRotation).not.toBe(afterClear);
    expect(hermesConfigurationFingerprint(CREDENTIAL_ENV)).toBe(before);
  });

  it("produces different fingerprints under different peppers (salting proof)", () => {
    vi.stubEnv("CAREERADAPT_CREDENTIAL_PEPPER", PEPPER);
    const first = hermesConfigurationFingerprint(CREDENTIAL_ENV);
    vi.stubEnv("CAREERADAPT_CREDENTIAL_PEPPER", `${PEPPER}-rotated`);
    const second = hermesConfigurationFingerprint(CREDENTIAL_ENV);
    expect(first).not.toBe(second);
  });

  it("matches the Next-side runtimeConfigFingerprint for the same resolved configuration and pepper", async () => {
    vi.stubEnv("CAREERADAPT_CREDENTIAL_PEPPER", PEPPER);

    const companionFingerprint = hermesConfigurationFingerprint(CREDENTIAL_ENV);
    const serverFingerprint = await runtimeConfigFingerprint({
      provider: CREDENTIAL_ENV.AI_PROVIDER,
      baseUrl: CREDENTIAL_ENV.AI_BASE_URL,
      model: CREDENTIAL_ENV.AI_MODEL,
      apiKey: CREDENTIAL_ENV.AI_API_KEY
    });

    expect(serverFingerprint).toBe(companionFingerprint);
  });

  it("keeps the credential out of the canonical fingerprint payload", () => {
    const parsed = JSON.parse(runtimeConfigFingerprintPayload({
      provider: CREDENTIAL_ENV.AI_PROVIDER,
      baseUrl: CREDENTIAL_ENV.AI_BASE_URL,
      model: CREDENTIAL_ENV.AI_MODEL,
      apiKey: CREDENTIAL_ENV.AI_API_KEY
    }, "tag")) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["provider", "baseUrl", "model", "credentialFingerprint"]);
    expect(parsed.credentialFingerprint).toBe("tag");
  });
  it("reuses a configured pepper and generates one into process.env when absent", () => {
    delete process.env.CAREERADAPT_CREDENTIAL_PEPPER;
    const generated = ensureCredentialFingerprintPepper();
    expect(generated).toHaveLength(64);
    expect(process.env.CAREERADAPT_CREDENTIAL_PEPPER).toBe(generated);
    const pinned = ensureCredentialFingerprintPepper("custom-pepper-at-least-16-chars");
    expect(pinned).toBe("custom-pepper-at-least-16-chars");
    expect(process.env.CAREERADAPT_CREDENTIAL_PEPPER).toBe("custom-pepper-at-least-16-chars");
    delete process.env.CAREERADAPT_CREDENTIAL_PEPPER;
  });
});

describe("V4-P0 A2 startup output redaction", () => {
  it("collects the launch secret set from the dedicated environment names only", () => {
    const secrets = hermesLogSecrets({
      AI_API_KEY: "ai-key-value-1234",
      OPENAI_API_KEY: "openai-key-value-123",
      HERMES_CUSTOM_CAREERADAPT_API_KEY: "short",
      UNRELATED_SECRET: "not-a-managed-name-123"
    });
    expect(secrets).toEqual(["ai-key-value-1234", "openai-key-value-123"]);
  });

  it("redacts secrets and bearer tokens through the shared log redactor", () => {
    const redactLine = createLogRedactor(["super-secret-provider-key", "runtime-key-value-123"]);
    expect(redactLine("error with key super-secret-provider-key")).toBe("error with key [REDACTED]");
    expect(redactLine("Authorization: Bearer runtime-key-value-123")).toBe("Authorization: Bearer [REDACTED]");
    expect(redactLine("harmless line")).toBe("harmless line");
  });

  it("applies the redactor to captured child output lines", () => {
    const lines: string[] = [];
    const redactLine = createLogRedactor(["super-secret-provider-key"]);
    captureLine(lines, "provider key: super-secret-provider-key", redactLine);
    captureLine(lines, "plain line", undefined);
    expect(lines[0]).toBe("provider key: [REDACTED]");
    expect(lines[1]).toBe("plain line");
    expect(lines.join("\n")).not.toContain("super-secret-provider-key");
  });
});
