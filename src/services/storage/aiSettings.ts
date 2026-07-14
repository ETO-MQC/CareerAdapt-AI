const STORAGE_KEY = "careeradapt-ai-settings";

export type AiSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: string;
};

const DEFAULTS: AiSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  provider: "openai-compatible"
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
    return {
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : DEFAULTS.baseUrl,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : DEFAULTS.apiKey,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULTS.model,
      provider: typeof parsed.provider === "string" ? parsed.provider : DEFAULTS.provider
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeAiSettings(settings: AiSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function clearAiSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
}

export function hasCustomAiSettings(): boolean {
  const settings = readAiSettings();
  return settings.apiKey.length > 0 || settings.baseUrl.length > 0 || settings.model.length > 0;
}

export function encodeAiSettingsForHeader(settings: AiSettings): string {
  return btoa(encodeURIComponent(JSON.stringify(settings)));
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
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      provider: typeof parsed.provider === "string" ? parsed.provider : "openai-compatible"
    };
  } catch {
    return undefined;
  }
}
