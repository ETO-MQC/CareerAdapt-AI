"use client";

import { usePathname } from "next/navigation";
import { AgentDock } from "@/components/agent/dock/AgentDock";
import { AgentPageContextProvider } from "@/components/agent/context/AgentPageContextProvider";
import { NotificationProvider } from "@/components/notifications/NotificationProvider";
import { useWorkspaceMode } from "./WorkspaceModeProvider";
import { AiShell } from "./AiShell";
import { AppShell } from "./AppShell";

export function ModeAwareAppShell({ children }: { children: React.ReactNode }) {
  const { mode, setMode } = useWorkspaceMode();
  const pathname = usePathname() || "/";

  if (mode === "ai") {
    return (
      <NotificationProvider>
        <AgentPageContextProvider route={pathname}>
          <AiShell>{children}</AiShell>
        </AgentPageContextProvider>
      </NotificationProvider>
    );
  }

  if (mode === "hybrid") {
    return (
      <AgentPageContextProvider route={pathname}>
        <AppShell>
          <div className="hybrid-shell-frame">
            <div className="hybrid-shell-content">{children}</div>
            <AgentDock />
          </div>
        </AppShell>
      </AgentPageContextProvider>
    );
  }

  return (
    <AppShell>
      {pathname.startsWith("/ai-workspace") ? (
        <main className="page-shell">
          <section className="panel">
            <h1>AI 助手未在手动模式中运行</h1>
            <p>手动模式不会挂载 Agent Runtime 或调用在线模型。切换到 AI 模式后，可以继续已保存的任务。</p>
            <button className="primary-button" type="button" onClick={() => setMode("ai")}>切换到 AI 模式</button>
          </section>
        </main>
      ) : children}
    </AppShell>
  );
}
