"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from "react";
import {
  parseWorkspaceMode,
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
  const [mode, setModeState] = useState<WorkspaceMode>(() =>
    typeof window === "undefined" ? initialMode : readWorkspaceMode(window.localStorage, initialMode)
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== WORKSPACE_MODE_STORAGE_KEY) return;
      const next = parseWorkspaceMode(event.newValue);
      if (next) setModeState(next);
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    applyInitialAppearance(mode);
    const handlePreferenceChange = () => applyInitialAppearance(mode, true);
    window.addEventListener("careeradapt-preferences-change", handlePreferenceChange);
    return () => window.removeEventListener("careeradapt-preferences-change", handlePreferenceChange);
  }, [mode]);

  const setMode = useCallback((nextMode: WorkspaceMode) => {
    setModeState(nextMode);
    persistWorkspaceMode(nextMode, window.localStorage, document);
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
}
