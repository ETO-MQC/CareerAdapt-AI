export const developerModeStorageKey = "careeradapt.developerMode";

export function readDeveloperMode(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(developerModeStorageKey) === "enabled";
}

export function writeDeveloperMode(enabled: boolean) {
  window.localStorage.setItem(developerModeStorageKey, enabled ? "enabled" : "disabled");
  window.dispatchEvent(new CustomEvent("careeradapt-developer-mode-change", { detail: enabled }));
}
