const OPENROUTER_CREDENTIAL_ENV = "OPENROUTER_API_KEY";
const OPENAI_CREDENTIAL_ENV = "OPENAI_API_KEY";
const CUSTOM_CREDENTIAL_ENV = "HERMES_CUSTOM_CAREERADAPT_API_KEY";

/**
 * Resolve the one provider/credential binding used by CareerAdapt's Hermes
 * companion and Supervisor. The returned value is safe metadata only; the key
 * itself is never returned or persisted here.
 */
function resolveHermesProviderBinding({ baseUrl = "", model = "", genericApiKey = "", provider = "" } = {}) {
  void model;
  const hostname = providerHost(baseUrl);
  const requested = String(provider || "").trim().toLowerCase();
  const credentialConfigured = Boolean(String(genericApiKey || "").trim());

  if (isOpenRouterHost(hostname) || (!hostname && requested === "openrouter")) {
    return {
      providerId: "openrouter",
      credentialEnvName: OPENROUTER_CREDENTIAL_ENV,
      baseUrlEnvName: "OPENROUTER_BASE_URL",
      credentialConfigured,
      customProviderName: undefined
    };
  }
  if (isOpenAiHost(hostname) || (!hostname && ["openai", "openai-api", "openai_api", "openai api"].includes(requested))) {
    return {
      providerId: "openai-api",
      credentialEnvName: OPENAI_CREDENTIAL_ENV,
      baseUrlEnvName: "OPENAI_BASE_URL",
      credentialConfigured,
      customProviderName: undefined
    };
  }
  return {
    providerId: "custom:careeradapt",
    credentialEnvName: CUSTOM_CREDENTIAL_ENV,
    baseUrlEnvName: undefined,
    credentialConfigured,
    customProviderName: "careeradapt"
  };
}

function providerHost(baseUrl) {
  if (!baseUrl || typeof baseUrl !== "string") return "";
  try {
    return new URL(baseUrl).hostname.toLowerCase().replace(/\.$/u, "");
  } catch {
    return "";
  }
}

function isOpenRouterHost(hostname) {
  return hostname === "openrouter.ai" || hostname.endsWith(".openrouter.ai");
}

function isOpenAiHost(hostname) {
  return hostname === "api.openai.com" || hostname.endsWith(".openai.com");
}

module.exports = {
  CUSTOM_CREDENTIAL_ENV,
  OPENAI_CREDENTIAL_ENV,
  OPENROUTER_CREDENTIAL_ENV,
  resolveHermesProviderBinding
};
