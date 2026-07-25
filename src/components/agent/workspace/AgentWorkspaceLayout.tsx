"use client";

import { History, Monitor, Moon, MoreHorizontal, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentArtifactLauncher } from "@/components/agent/artifacts/AgentArtifactLauncher";

type ThemePreference = "system" | "light" | "dark";

const themeOptions: Array<{ value: ThemePreference; label: string; icon: typeof Monitor }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "明亮", icon: Sun },
  { value: "dark", label: "暗黑", icon: Moon }
];

export function AgentWorkspaceLayout({
  children,
  sessionTitle,
  status,
  artifactCount,
  onOpenArtifacts,
  onOpenHistory
}: {
  children: React.ReactNode;
  sessionTitle: string;
  status: string;
  artifactCount: number;
  onOpenArtifacts(): void;
  onOpenHistory(): void;
}) {
  const [theme, setTheme] = useState<ThemePreference>(() => readThemePreference());
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const handlePreferenceChange = () => setTheme(readThemePreference());
    window.addEventListener("careeradapt-preferences-change", handlePreferenceChange);
    return () => window.removeEventListener("careeradapt-preferences-change", handlePreferenceChange);
  }, []);

  const updateTheme = (nextTheme: ThemePreference) => {
    setTheme(nextTheme);
    window.localStorage.setItem("careeradapt.theme", nextTheme);
    applyThemePreference(nextTheme);
    window.dispatchEvent(new Event("careeradapt-preferences-change"));
  };

  return (
    <main className="agent-workspace">
      <header className="agent-workspace-topbar">
        <strong title={sessionTitle}>{sessionTitle}</strong>
        <div>
          <span className="agent-workflow-status">{status}</span>
          <AgentArtifactLauncher count={artifactCount} onOpen={onOpenArtifacts} />
          <button type="button" aria-label="打开历史记录" title="历史记录" onClick={onOpenHistory}>
            <History aria-hidden="true" />
          </button>
          <div className="agent-topbar-menu">
            <button
              type="button"
              aria-label="更多任务操作"
              aria-expanded={menuOpen}
              title="更多操作"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="agent-topbar-menu-popover" role="menu" aria-label="更多任务操作">
                <div className="agent-topbar-menu-group" role="group" aria-label="主题">
                  <span>主题</span>
                  {themeOptions.map((option) => {
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="menuitemradio"
                        aria-checked={theme === option.value}
                        className={theme === option.value ? "is-active" : ""}
                        onClick={() => updateTheme(option.value)}
                      >
                        <Icon aria-hidden="true" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <Link role="menuitem" href="/settings" onClick={() => setMenuOpen(false)}>
                  <Settings aria-hidden="true" />
                  设置与更多
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}

function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  const value = window.localStorage.getItem("careeradapt.theme");
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function applyThemePreference(theme: ThemePreference) {
  const resolved = theme === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = theme;
  document.documentElement.style.colorScheme = resolved;
}
