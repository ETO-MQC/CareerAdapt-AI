import { encodeAiSettingsForHeader, readAiSettings, type AiSettings } from "@/services/storage/aiSettings";

export type HermesStartResult = {
  ok: boolean;
  reason?: string;
  runtimeUrl?: string;
};

export type HermesStartSettings = Pick<AiSettings, "baseUrl" | "apiKey" | "model" | "provider">;

/** Starts or reuses the local Hermes companion without exposing credentials to the browser. */
export async function requestHermesStart(): Promise<HermesStartResult> {
  const settings = readAiSettings();
  const customSettings = hasCustomSettings(settings) ? settings : undefined;
  if (typeof window !== "undefined" && window.careerAdaptDesktop) {
    // Send the complete local settings object in Electron, including an empty
    // object after "restore defaults", so the main process can return to its
    // clean environment instead of retaining an old provider key in memory.
    const result = await window.careerAdaptDesktop.startHermes(settings);
    return {
      ok: result.ok,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.runtimeUrl ? { runtimeUrl: result.runtimeUrl } : {})
    };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (customSettings) headers["x-ai-config"] = encodeAiSettingsForHeader(customSettings);
  const response = await fetch("/api/agent/runtime/hermes/control", {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "start" })
  });
  const payload = await response.json().catch(() => ({})) as {
    ok?: boolean;
    data?: { runtimeUrl?: string };
    error?: { code?: string; message?: string };
  };
  if (!response.ok || payload.ok !== true) {
    throw new Error(payload.error?.message || "Hermes 启动失败，请查看运行日志。", { cause: payload.error?.code });
  }
  return {
    ok: true,
    ...(payload.data?.runtimeUrl ? { runtimeUrl: payload.data.runtimeUrl } : {})
  };
}

function hasCustomSettings(settings: HermesStartSettings) {
  return Boolean(settings.apiKey.trim() || settings.baseUrl.trim() || settings.model.trim());
}
