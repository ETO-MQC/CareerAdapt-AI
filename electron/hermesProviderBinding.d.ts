export type HermesProviderBinding = {
  providerId: "openrouter" | "openai-api" | "custom:careeradapt";
  credentialEnvName: "OPENROUTER_API_KEY" | "OPENAI_API_KEY" | "HERMES_CUSTOM_CAREERADAPT_API_KEY";
  baseUrlEnvName?: "OPENROUTER_BASE_URL" | "OPENAI_BASE_URL";
  credentialConfigured: boolean;
  customProviderName?: "careeradapt";
};

export function resolveHermesProviderBinding(input?: {
  baseUrl?: string;
  model?: string;
  genericApiKey?: string;
  provider?: string;
}): HermesProviderBinding;

export const CUSTOM_CREDENTIAL_ENV: "HERMES_CUSTOM_CAREERADAPT_API_KEY";
export const OPENAI_CREDENTIAL_ENV: "OPENAI_API_KEY";
export const OPENROUTER_CREDENTIAL_ENV: "OPENROUTER_API_KEY";
