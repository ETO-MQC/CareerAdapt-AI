"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore
} from "react";
import {
  persistWorkspaceMode,
  readWorkspaceMode,
  WORKSPACE_MODE_STORAGE_KEY,
  type WorkspaceMode
} from "@/services/preferences/workspaceMode";

type WorkspaceModeContextValue = {
  mode: WorkspaceMode;
  setMode(mode: WorkspaceMode): void;
};

const WorkspaceModeContext = createContext<WorkspaceModeContextValue | null>(null);

export function WorkspaceModeProvider({
  children,
  initialMode
}: {
  children: React.ReactNode;
  initialMode: WorkspaceMode;
}) {
  // The server already resolved the cookie-backed mode. Read localStorage
  // after hydration so the initial provider tree is stable in both runtimes.
  const mode = useSyncExternalStore(
    subscribeToWorkspaceMode,
    useCallback(() => readWorkspaceMode(window.localStorage, initialMode), [initialMode]),
    useCallback(() => initialMode, [initialMode])
  );

  useEffect(() => {
    applyInitialAppearance(mode);
    const handlePreferenceChange = () => applyInitialAppearance(mode, true);
    window.addEventListener("careeradapt-preferences-change", handlePreferenceChange);
    return () => window.removeEventListener("careeradapt-preferences-change", handlePreferenceChange);
  }, [mode]);

  const setMode = useCallback((nextMode: WorkspaceMode) => {
    persistWorkspaceMode(nextMode, window.localStorage, document);
    window.dispatchEvent(new CustomEvent("careeradapt-workspace-mode-change"));
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <WorkspaceModeContext.Provider value={value}>{children}</WorkspaceModeContext.Provider>;
}

export function useWorkspaceMode() {
  const value = useContext(WorkspaceModeContext);
  if (!value) throw new Error("useWorkspaceMode must be used within WorkspaceModeProvider");
  return value;
}

function applyInitialAppearance(mode: WorkspaceMode, force = false) {
  const preference = window.localStorage.getItem("careeradapt.theme");
  if (!force && document.documentElement.dataset.theme) return;
  const resolved = preference === "light" || preference === "dark"
    ? preference
    : mode === "ai"
      ? "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference ?? (mode === "ai" ? "dark" : "system");
  document.documentElement.dataset.density = window.localStorage.getItem("careeradapt.density") === "comfortable"
    ? "comfortable"
    : "compact";
  document.documentElement.style.colorScheme = resolved;
}

function subscribeToWorkspaceMode(onChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === WORKSPACE_MODE_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener("careeradapt-workspace-mode-change", onChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener("careeradapt-workspace-mode-change", onChange);
  };
}
