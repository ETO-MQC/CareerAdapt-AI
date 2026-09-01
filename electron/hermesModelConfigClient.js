const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The only boundary adapter for Hermes' native model configuration API.
 *
 * This module is loaded by the Electron/Web Supervisor, never by the
 * browser. It deliberately has no lifecycle state, persistence, retries, or
 * provider abstraction: Hermes owns provider resolution and config writes.
 */
class HermesModelConfigClient {
  constructor(options = {}) {
    this.runtimeUrl = String(options.runtimeUrl || "").replace(/\/$/u, "");
    this.runtimeApiKey = typeof options.runtimeApiKey === "string" ? options.runtimeApiKey : "";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.timeoutMs = options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async readModelConfig() {
    const payload = await this.#request("/api/model/info", { method: "GET" });
    return {
      provider: stringValue(payload.provider),
      model: stringValue(payload.model),
      baseUrl: stringValue(payload.base_url) || stringValue(payload.baseUrl),
      capabilities: isRecord(payload.capabilities) ? payload.capabilities : {}
    };
  }

  async testCapability() {
    const response = await this.#fetch("/api/model/info", { method: "GET" });
    if (response.status === 404 || response.status === 405) return { supported: false };
    const payload = await readJson(response);
    if (!response.ok) return { supported: response.status !== undefined && response.status !== 404 && response.status !== 405, httpStatus: response.status };
    return {
      supported: true,
      model: stringValue(payload.model),
      provider: stringValue(payload.provider)
    };
  }

  async setMainModel(input) {
    const payload = await this.#request("/api/model/set", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "main",
        provider: input.provider,
        model: input.model,
        base_url: input.baseUrl || "",
        api_key: input.apiKey || "",
        confirm_expensive_model: true
      })
    });
    if (payload.ok !== true) {
      throw requestError("hermes_model_config_rejected", 422, payload);
    }
    return {
      provider: stringValue(payload.provider),
      model: stringValue(payload.model),
      baseUrl: stringValue(payload.base_url) || stringValue(payload.baseUrl),
      credentialConfigured: Boolean(input.apiKey)
    };
  }

  async #request(pathname, init) {
    const response = await this.#fetch(pathname, init);
    const payload = await readJson(response);
    if (!response.ok) {
      const detail = typeof payload.detail === "string" ? payload.detail : undefined;
      throw requestError(
        response.status === 404 || response.status === 405 ? "hermes_model_config_endpoint_missing" : `hermes_model_config_http_${response.status}`,
        response.status,
        { ...payload, ...(detail ? { detail } : {}) }
      );
    }
    return payload;
  }

  async #fetch(pathname, init) {
    if (!this.runtimeUrl) throw requestError("hermes_runtime_url_missing");
    const headers = {
      Accept: "application/json",
      ...(this.runtimeApiKey ? { Authorization: `Bearer ${this.runtimeApiKey}` } : {}),
      ...(init.headers || {})
    };
    const signal = init.signal || AbortSignal.timeout(this.timeoutMs);
    return this.fetchImpl(`${this.runtimeUrl}${pathname}`, { ...init, headers, signal, cache: "no-store" });
  }
}

function requestError(code, httpStatus, payload = {}) {
  const error = new Error(code);
  error.code = code;
  if (httpStatus !== undefined) error.httpStatus = httpStatus;
  if (isRecord(payload) && typeof payload.detail === "string") error.detail = payload.detail;
  return error;
}

async function readJson(response) {
  const payload = await response.json();
  if (!isRecord(payload)) throw requestError("hermes_model_config_invalid_response", response.status);
  return payload;
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

module.exports = { HermesModelConfigClient };
