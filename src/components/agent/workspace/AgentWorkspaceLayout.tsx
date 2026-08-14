"use client";

import { History, Monitor, Moon, MoreHorizontal, Settings, Sun } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentArtifactLauncher } from "@/components/agent/artifacts/AgentArtifactLauncher";
import type { RuntimeStatusSnapshot } from "@/agent/runtime/runtimeStatus";

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
  runtimeStatus,
  onStartHermes,
  contextSelector,
  pinnedContextLabel,
  artifactCount,
  onOpenArtifacts,
  onOpenHistory
}: {
  children: React.ReactNode;
  sessionTitle: string;
  status: string;
  runtimeStatus?: RuntimeStatusSnapshot;
  onStartHermes?: () => Promise<{ ok: boolean; reason?: string }>;
  contextSelector?: React.ReactNode;
  pinnedContextLabel?: string;
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
        <div className="agent-workspace-topbar-heading">
          <strong title={sessionTitle}>{sessionTitle}</strong>
          {pinnedContextLabel ? <span className="agent-pinned-context">固定：{pinnedContextLabel}</span> : null}
          {contextSelector}
        </div>
        <div>
          {runtimeStatus ? <RuntimeStatusBadge status={runtimeStatus} onStartHermes={onStartHermes} /> : null}
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

function RuntimeStatusBadge({
  status,
  onStartHermes
}: {
  status: RuntimeStatusSnapshot;
  onStartHermes?: () => Promise<{ ok: boolean; reason?: string }>;
}) {
  const [controlBusy, setControlBusy] = useState(false);
  // The badge identifies the configured conversational owner, not a legacy
  // execution fallback. Hermes remains the visible identity while it is
  // reconnecting or unavailable, so a failed tool/run cannot impersonate a
  // second Native assistant.
  const runtimeLabel = status.preferredRuntime === "hermes" ? "Hermes" : "Native";
  const statusLabel = status.status === "ready" ? "Ready" : status.status === "starting" ? "Reconnecting" : "Unavailable";
  const details = [
    status.reason,
    status.health?.requiredCareerFacadesMissing.length ? `缺少 ${status.health.requiredCareerFacadesMissing.length} 个 Career facade` : undefined,
    status.health?.hermesMcpToolCount !== undefined ? `Hermes MCP ${status.health.hermesMcpToolCount} tools` : undefined,
    status.model ? `model ${status.model}` : undefined
  ].filter(Boolean).join(" · ");
  const handleStartHermes = async () => {
    if (!onStartHermes || controlBusy || status.status === "starting") return;
    setControlBusy(true);
    try {
      await onStartHermes();
    } finally {
      setControlBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={`agent-runtime-status is-${status.status}`}
        title={details || `AI Runtime: ${runtimeLabel} · ${statusLabel}`}
        aria-label={`AI Runtime ${runtimeLabel}，状态 ${statusLabel}`}
        aria-busy={controlBusy || status.status === "starting"}
        disabled={!onStartHermes || controlBusy || status.status === "starting"}
        onClick={() => void handleStartHermes()}
      >
        <span className="agent-runtime-status-label">AI · {runtimeLabel}</span>
        <span className="agent-runtime-status-state">{statusLabel}</span>
        {onStartHermes ? <span className="agent-runtime-status-action">{controlBusy ? "重连中…" : status.status === "ready" ? "重启" : "启动"}</span> : null}
      </button>
      {status.roadshowMode ? <RoadshowDiagnostics status={status} /> : null}
    </>
  );
}

function RoadshowDiagnostics({ status }: { status: RuntimeStatusSnapshot }) {
  const health = status.health;
  const checks = [
    ["Runtime", health?.runtimeAvailable === true],
    ["Provider / model", health?.providerConfigured === true && health.providerReachable === true && Boolean(health.model)],
    ["Hermes API", health?.runtimeAvailable === true],
    ["Browser Career Domain Host", health?.browserCareerDomainHostConnected === true],
    ["Career MCP server", health?.careerMcpServerReachable === true && health.careerMcpContractCount > 0],
    ["Hermes MCP registry", health?.hermesMcpRegistered === true && health.hermesMcpToolCount > 0],
    ["Required Career facades", health?.requiredCareerFacadesMissing.length === 0 && (health?.hermesCareerFacadeCount ?? 0) > 0],
    ["Career skills", health?.careerSkillsLoaded === true],
    ["Resume preview", status.mcpConnected === true && status.resumePreviewAvailable === true],
    ["PDF export", status.mcpConnected === true && status.pdfExportAvailable === true]
  ] as const;
  const ready = checks.every(([, passed]) => passed);
  return (
    <details className={`agent-roadshow-diagnostics ${ready ? "is-ready" : "is-blocked"}`}>
      <summary>Roadshow {ready ? "ready" : "check"}</summary>
      <div className="agent-roadshow-diagnostics-panel" role="status" aria-label="Roadshow readiness">
        {checks.map(([label, passed]) => (
          <span key={label} className={passed ? "is-passed" : "is-pending"}>
            <span aria-hidden="true">{passed ? "✓" : "–"}</span> {label}
          </span>
        ))}
      </div>
    </details>
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
