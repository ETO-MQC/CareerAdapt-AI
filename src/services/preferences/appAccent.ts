export const APP_ACCENT_STORAGE_KEY = "careeradapt.appAccent";
export type AppAccent = "green" | "burgundy";

export function readAppAccent(): AppAccent {
  return typeof window !== "undefined" && window.localStorage.getItem(APP_ACCENT_STORAGE_KEY) === "burgundy"
    ? "burgundy" : "green";
}

export function applyAppAccent() {
  document.documentElement.dataset.appAccent = readAppAccent();
}

export function subscribeAppAccent(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === APP_ACCENT_STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener("careeradapt-preferences-change", onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("careeradapt-preferences-change", onChange);
  };
}

export function persistAppAccent(accent: AppAccent) {
  window.localStorage.setItem(APP_ACCENT_STORAGE_KEY, accent);
  applyAppAccent();
  window.dispatchEvent(new Event("careeradapt-preferences-change"));
}
