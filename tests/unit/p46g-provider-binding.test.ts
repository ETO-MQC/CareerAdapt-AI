import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const {
  CUSTOM_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  OPENROUTER_CREDENTIAL_ENV
} = require("../../electron/hermesProviderBinding.js") as {
  CUSTOM_CREDENTIAL_ENV: string;
  OPENAI_CREDENTIAL_ENV: string;
  OPENROUTER_CREDENTIAL_ENV: string;
};
const {
  prepareHermesEnvironment,
  providerCredential,
  resolveHermesProviderBinding,
  resolveRuntimeControlKey
} = require("../../electron/hermesCompanion.js") as {
  CUSTOM_CREDENTIAL_ENV: string;
  OPENAI_CREDENTIAL_ENV: string;
  OPENROUTER_CREDENTIAL_ENV: string;
  prepareHermesEnvironment: (environment: Record<string, string>, options?: Record<string, unknown>) => {
    environment: Record<string, string>;
    childEnvironment?: Record<string, string>;
    runtime: Record<string, unknown>;
  };
  providerCredential: (environment: Record<string, string>) => string | undefined;
  resolveRuntimeControlKey: (environment: Record<string, string>, options?: Record<string, unknown>) => string | undefined;
  resolveHermesProviderBinding: (input: {
    provider?: string;
    baseUrl?: string;
    model?: string;
    genericApiKey?: string;
  }) => {
    providerId: string;
    credentialEnvName: string;
    baseUrlEnvName?: string;
    credentialConfigured: boolean;
    customProviderName?: string;
  };
};

describe("P4.6g Hermes provider credential binding", () => {
  it("maps exact provider hosts to their Hermes credential environments", () => {
    expect(resolveHermesProviderBinding({
      provider: "openai-compatible",
      baseUrl: "https://api.openrouter.ai/api/v1",
      genericApiKey: "router-secret"
    })).toMatchObject({
      providerId: "openrouter",
      credentialEnvName: OPENROUTER_CREDENTIAL_ENV,
      baseUrlEnvName: "OPENROUTER_BASE_URL",
      credentialConfigured: true
    });
    expect(resolveHermesProviderBinding({
      provider: "anything",
      baseUrl: "https://api.openai.com/v1"
    })).toMatchObject({
      providerId: "openai-api",
      credentialEnvName: OPENAI_CREDENTIAL_ENV,
      baseUrlEnvName: "OPENAI_BASE_URL"
    });
    expect(resolveHermesProviderBinding({
      provider: "openai-compatible",
      baseUrl: "https://provider.example/v1",
      genericApiKey: "custom-secret"
    })).toMatchObject({
      providerId: "custom:careeradapt",
      credentialEnvName: CUSTOM_CREDENTIAL_ENV,
      customProviderName: "careeradapt",
      credentialConfigured: true
    });
  });

  it("does not classify lookalike hosts or leak a key through binding metadata", () => {
    const binding = resolveHermesProviderBinding({
      baseUrl: "https://openrouter.ai.example/v1",
      genericApiKey: "must-not-return"
    });
    expect(binding.providerId).toBe("custom:careeradapt");
    expect(binding).not.toHaveProperty("apiKey");
    expect(JSON.stringify(binding)).not.toContain("must-not-return");
  });

  it("normalizes the canonical control key before legacy runtime aliases", () => {
    expect(resolveRuntimeControlKey({
      API_SERVER_KEY: "canonical-control-key",
      HERMES_RUNTIME_API_KEY: "legacy-runtime-key",
      HERMES_API_KEY: "ambiguous-key"
    })).toBe("canonical-control-key");
  });

  it("injects only the matching canonical credential and base-url environment", () => {
    const prepared = prepareHermesEnvironment({
      HERMES_RUNTIME_URL: "http://127.0.0.1:18642",
      HERMES_PROVIDER: "openrouter",
      HERMES_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_API_KEY: "wrong-openai-secret",
      OPENROUTER_API_KEY: "router-secret",
      HERMES_MODEL: "openrouter-model"
    }, { hermesRuntimeRoot: "C:/careeradapt-missing-hermes-runtime" });
    expect(prepared.childEnvironment).toMatchObject({
      AI_API_KEY: "",
      OPENAI_API_KEY: "",
      OPENROUTER_API_KEY: "router-secret",
      OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_BASE_URL: ""
    });
    expect(JSON.stringify(prepared.childEnvironment)).toContain("router-secret");
    expect(JSON.stringify(prepared.childEnvironment)).not.toContain("wrong-openai-secret");
  });

  it("does not reuse an OpenAI key for OpenRouter or arbitrary custom endpoints", () => {
    expect(providerCredential({
      HERMES_PROVIDER: "openrouter",
      HERMES_BASE_URL: "https://openrouter.ai/api/v1",
      OPENAI_API_KEY: "wrong-openai-secret",
      HERMES_API_KEY: "ambiguous-runtime-secret"
    })).toBeUndefined();
    expect(providerCredential({
      HERMES_PROVIDER: "openai-compatible",
      HERMES_BASE_URL: "https://provider.example/v1",
      OPENAI_API_KEY: "wrong-openai-secret",
      HERMES_API_KEY: "ambiguous-runtime-secret"
    })).toBeUndefined();
  });
});
