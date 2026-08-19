"use client";

import { FileText, History, Monitor, Moon, MoreHorizontal, Power, RotateCcw, Settings, Sun, Wrench } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AgentArtifactLauncher } from "@/components/agent/artifacts/AgentArtifactLauncher";
import type { RuntimeStatusSnapshot } from "@/agent/runtime/runtimeStatus";
import {
  createInitialHermesControlSnapshot,
  hermesControlStatusLabel
} from "@/services/agent/hermesControl";

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
  onStopHermes,
  onRestartHermes,
  onRecoverHermes,
  onReconnectHermes,
  onTestProvider,
  onStopCurrentRun,
  onOpenHermesLogs,
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
  onStartHermes?: () => Promise<unknown>;
  onStopHermes?: () => Promise<unknown>;
  onRestartHermes?: () => Promise<unknown>;
  onRecoverHermes?: () => Promise<unknown>;
  onReconnectHermes?: () => Promise<unknown>;
  onTestProvider?: () => Promise<unknown>;
  onStopCurrentRun?: () => Promise<unknown>;
  onOpenHermesLogs?: () => Promise<unknown>;
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
          {runtimeStatus ? (
            <RuntimeStatusBadge
              status={runtimeStatus}
              onStartHermes={onStartHermes}
              onStopHermes={onStopHermes}
              onRestartHermes={onRestartHermes}
              onRecoverHermes={onRecoverHermes}
              onReconnectHermes={onReconnectHermes}
              onTestProvider={onTestProvider}
              onStopCurrentRun={onStopCurrentRun}
              onOpenHermesLogs={onOpenHermesLogs}
            />
          ) : null}
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
  onStartHermes,
  onStopHermes,
  onRestartHermes,
  onRecoverHermes,
  onReconnectHermes,
  onTestProvider,
  onStopCurrentRun,
  onOpenHermesLogs
}: {
  status: RuntimeStatusSnapshot;
  onStartHermes?: () => Promise<unknown>;
  onStopHermes?: () => Promise<unknown>;
  onRestartHermes?: () => Promise<unknown>;
  onRecoverHermes?: () => Promise<unknown>;
  onReconnectHermes?: () => Promise<unknown>;
  onTestProvider?: () => Promise<unknown>;
  onStopCurrentRun?: () => Promise<unknown>;
  onOpenHermesLogs?: () => Promise<unknown>;
}) {
  const [controlBusy, setControlBusy] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const controlSnapshot = status.controlSnapshot ?? createInitialHermesControlSnapshot();
  const runtimeLabel = "Hermes";
  const statusLabel = hermesControlStatusLabel(controlSnapshot);
  const details = [
    `Hermes · ${statusLabel}`,
    `API ${mark(controlSnapshot.apiReady)}  Provider ${mark(controlSnapshot.providerReady)}`,
    `Career MCP ${mark(controlSnapshot.careerMcpReady)}  工具面 ${mark(controlSnapshot.toolSurfaceReady)}  Run ${mark(controlSnapshot.runReady)}`,
    `Domain ${controlSnapshot.careerDomainToolCount ?? 0} · Hermes Career ${controlSnapshot.hermesCareerToolCount ?? 0}`,
    controlSnapshot.model ? `模型 ${controlSnapshot.model}` : undefined
  ].filter(Boolean).join("\n");
  const runControl = async (action?: () => Promise<unknown>) => {
    if (!action || controlBusy) return;
    setControlBusy(true);
    try {
      await action();
      setControlOpen(false);
    } finally {
      setControlBusy(false);
    }
  };
  const isActiveRun = controlSnapshot.capabilities.canStopCurrentRun;
  return (
    <div className="agent-runtime-status-control">
      <button
        type="button"
        className={`agent-runtime-status is-${controlSnapshot.status}`}
        title={details || `AI Runtime: ${runtimeLabel} · ${statusLabel}`}
        aria-label={`AI Runtime ${runtimeLabel}，状态 ${statusLabel}`}
        aria-expanded={controlOpen}
        aria-busy={controlBusy}
        onClick={() => setControlOpen((open) => !open)}
      >
        <span className="agent-runtime-status-label">AI · {runtimeLabel}</span>
        <span className="agent-runtime-status-state">{statusLabel}</span>
        <span className="agent-runtime-status-action">{controlBusy ? "处理中…" : "控制"}</span>
      </button>
      {controlOpen ? (
        <div className="agent-runtime-status-popover" role="dialog" aria-label="Hermes 控制中心">
          <div className="agent-runtime-status-popover-heading">
            <div>
              <strong>Hermes Control Center</strong>
              <span>{statusLabel}</span>
            </div>
            <Link href="/settings?category=ai" onClick={() => setControlOpen(false)} aria-label="打开 Hermes 设置">
              <Settings aria-hidden="true" />
            </Link>
          </div>
          <div className="agent-runtime-status-popover-grid">
            <span>API <b>{mark(controlSnapshot.apiReady)}</b></span>
            <span>Provider <b>{mark(controlSnapshot.providerReady)}</b></span>
            <span>Career MCP <b>{mark(controlSnapshot.careerMcpReady)}</b></span>
            <span>工具面 <b>{mark(controlSnapshot.toolSurfaceReady)}</b></span>
            <span>Run <b>{mark(controlSnapshot.runReady)}</b></span>
          </div>
          <p className="agent-runtime-status-popover-counts">
            Domain {controlSnapshot.careerDomainToolCount ?? 0} · Hermes Career {controlSnapshot.hermesCareerToolCount ?? 0} · Facades {controlSnapshot.careerIntegration.requiredToolCount}/{controlSnapshot.careerIntegration.requiredToolTotal}
          </p>
          <p className="agent-runtime-status-popover-counts">Provider {controlSnapshot.provider || "未确认"} · 模型 {controlSnapshot.model || "未配置"} · 凭证 {controlSnapshot.providerDiagnostic.credentialConfigured ? "已配置" : "未配置"}</p>
          {controlSnapshot.environment === "web" ? <p className="agent-runtime-status-popover-warning">{controlSnapshot.capabilities.unsupportedReason}</p> : null}
          {isActiveRun ? <p className="agent-runtime-status-popover-warning">当前有 Hermes Run；停止当前任务只调用 Run stop，不重启服务。</p> : null}
          <details className="agent-runtime-status-diagnostics">
            <summary>查看安全诊断</summary>
            <span>安全错误码：{controlSnapshot.safeReasonCode ?? "none"} · Provider 状态：{controlSnapshot.providerState}</span>
            <span>数据上下文：{controlSnapshot.storage.storageEnvironment} · {controlSnapshot.storage.storageOrigin} · {controlSnapshot.storage.storagePartition} · {controlSnapshot.storage.activeProfileSource}</span>
            {controlSnapshot.environment === "web" ? <span>Web Profile 不验证 Electron Profile；最终验收请使用拥有实际 Profile 的桌面版/开发 Electron 环境。</span> : null}
          </details>
          <div className="agent-runtime-status-popover-actions">
            {controlSnapshot.capabilities.canStartService && ["stopped", "unavailable"].includes(controlSnapshot.serviceState) ? <button type="button" onClick={() => void runControl(onStartHermes)} disabled={controlBusy}><Power aria-hidden="true" />启动</button> : null}
            {controlSnapshot.capabilities.canStopService && !["stopped", "stopping"].includes(controlSnapshot.serviceState) ? <button type="button" onClick={() => void runControl(onStopHermes)} disabled={controlBusy}><Power aria-hidden="true" />停止服务</button> : null}
            {controlSnapshot.capabilities.canRestartService ? <button type="button" onClick={() => void runControl(onRestartHermes)} disabled={controlBusy}><RotateCcw aria-hidden="true" />重启服务</button> : null}
            {controlSnapshot.capabilities.canRecoverService && ["unavailable", "running"].includes(controlSnapshot.serviceState) ? <button type="button" onClick={() => void runControl(onRecoverHermes)} disabled={controlBusy}><Wrench aria-hidden="true" />自动修复</button> : null}
            {controlSnapshot.capabilities.canReconnect ? <button type="button" onClick={() => void runControl(onReconnectHermes)} disabled={controlBusy}>重新连接</button> : null}
            {controlSnapshot.capabilities.canStopCurrentRun ? <button type="button" onClick={() => void runControl(onStopCurrentRun)} disabled={controlBusy}><Power aria-hidden="true" />停止当前任务</button> : null}
            {controlSnapshot.capabilities.canTestProvider ? <button type="button" onClick={() => void runControl(onTestProvider)} disabled={controlBusy}>测试模型连接</button> : null}
            {controlSnapshot.environment === "electron" ? <button type="button" onClick={() => void runControl(onOpenHermesLogs)} disabled={controlBusy}><FileText aria-hidden="true" />日志</button> : null}
            <Link href="/settings?category=ai" onClick={() => setControlOpen(false)}><Settings aria-hidden="true" />设置</Link>
          </div>
        </div>
      ) : null}
      {status.roadshowMode ? <RoadshowDiagnostics status={status} /> : null}
    </div>
  );
}

function mark(value: boolean | undefined) {
  return value === true ? "✓" : "—";
}

function RoadshowDiagnostics({ status }: { status: RuntimeStatusSnapshot }) {
  const health = status.health;
  const checks = [
    ["Runtime", health?.runtimeAvailable === true],
    ["Provider / model", health?.providerConfigured === true && health.providerReachable === true && Boolean(health.model)],
    ["Hermes API", health?.runtimeAvailable === true],
    ["Hermes run start", health?.runReady === true],
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
