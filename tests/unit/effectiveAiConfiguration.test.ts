import { describe, expect, it } from "vitest";
import {
  resolveEffectiveAiConfiguration,
  safeAiConfigurationDiagnostic
} from "@/ai/providers/effectiveConfiguration";

describe("effective AI configuration diagnostics", () => {
  it("resolves each non-empty custom field before environment values", () => {
    const effective = resolveEffectiveAiConfiguration({
      provider: "custom-compatible",
      model: "",
      baseUrl: "https://custom.example/v2/",
      apiKey: "custom-secret"
    }, {
      AI_PROVIDER: "env-compatible",
      AI_MODEL: "env-model",
      AI_BASE_URL: "https://env.example/v1",
      AI_API_KEY: "env-secret"
    });

    expect(effective).toMatchObject({
      provider: "custom:careeradapt",
      model: "env-model",
      baseUrl: "https://custom.example/v2/",
      apiKey: "custom-secret",
      sources: {
        provider: "custom_header",
        model: "server_env",
        baseUrl: "custom_header",
        credential: "custom_header"
      }
    });
  });

  it("exposes host/path and credential presence without exposing the credential", () => {
    const diagnostic = safeAiConfigurationDiagnostic(resolveEffectiveAiConfiguration(undefined, {
      AI_PROVIDER: "openai-compatible",
      AI_MODEL: "mimo-v2.5-pro",
      AI_BASE_URL: "https://token-plan-cn.xiaomimimo.com/v1?secret=hidden",
      AI_API_KEY: "tp-never-print-this"
    }));

    expect(diagnostic).toMatchObject({
      provider: "custom:careeradapt",
      model: "mimo-v2.5-pro",
      baseUrlHostPath: "token-plan-cn.xiaomimimo.com/v1",
      credentialPresent: true,
      authMode: "bearer_server_env"
    });
    expect(JSON.stringify(diagnostic)).not.toContain("tp-never-print-this");
    expect(JSON.stringify(diagnostic)).not.toContain("secret=hidden");
  });
});
