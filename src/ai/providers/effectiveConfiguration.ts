import type { AiSettings } from "@/services/storage/aiSettings";
import { normalizeAiProviderIdentity } from "@/services/agent/aiRuntimeConfiguration";

type Environment = Record<string, string | undefined>;
type ConfigurationSource = "custom_header" | "server_env" | "default" | "missing";

export type EffectiveAiConfiguration = {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  sources: {
    provider: ConfigurationSource;
    model: ConfigurationSource;
    baseUrl: ConfigurationSource;
    credential: ConfigurationSource;
  };
};

export type SafeAiConfigurationDiagnostic = {
  provider: string;
  model: string;
  baseUrlHostPath: string;
  credentialPresent: boolean;
  authMode: "bearer_custom_header" | "bearer_server_env" | "missing";
  sources: EffectiveAiConfiguration["sources"];
  configFingerprint?: string;
  configGeneration?: number;
};

export function resolveEffectiveAiConfiguration(
  settings?: AiSettings,
  environment: Environment = process.env
): EffectiveAiConfiguration {
  const custom = {
    provider: settings?.provider.trim() ?? "",
    model: settings?.model.trim() ?? "",
    baseUrl: settings?.baseUrl.trim() ?? "",
    apiKey: settings?.apiKey.trim() ?? ""
  };
  const fromEnvironment = {
    provider: environment.AI_PROVIDER?.trim() ?? "",
    model: environment.AI_MODEL?.trim() ?? "",
    baseUrl: environment.AI_BASE_URL?.trim() ?? "",
    apiKey: environment.AI_API_KEY?.trim() ?? ""
  };
  return {
    provider: normalizeAiProviderIdentity(custom.provider || fromEnvironment.provider, custom.baseUrl || fromEnvironment.baseUrl),
    model: custom.model || fromEnvironment.model,
    baseUrl: custom.baseUrl || fromEnvironment.baseUrl || "https://api.openai.com/v1",
    apiKey: custom.apiKey || fromEnvironment.apiKey,
    sources: {
      provider: custom.provider ? "custom_header" : fromEnvironment.provider ? "server_env" : "default",
      model: custom.model ? "custom_header" : fromEnvironment.model ? "server_env" : "missing",
      baseUrl: custom.baseUrl ? "custom_header" : fromEnvironment.baseUrl ? "server_env" : "default",
      credential: custom.apiKey ? "custom_header" : fromEnvironment.apiKey ? "server_env" : "missing"
    }
  };
}

export function safeAiConfigurationDiagnostic(
  configuration: EffectiveAiConfiguration
): SafeAiConfigurationDiagnostic {
  return {
    provider: configuration.provider,
    model: configuration.model,
    baseUrlHostPath: safeHostPath(configuration.baseUrl),
    credentialPresent: Boolean(configuration.apiKey),
    authMode: configuration.sources.credential === "custom_header"
      ? "bearer_custom_header"
      : configuration.sources.credential === "server_env"
        ? "bearer_server_env"
        : "missing",
    sources: configuration.sources
  };
}

function safeHostPath(baseUrl: string) {
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.host}${path}`;
  } catch {
    return "invalid-url";
  }
}
