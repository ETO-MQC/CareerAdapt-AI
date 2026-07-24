"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Archive,
  Bot,
  BriefcaseBusiness,
  Check,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  FolderKanban,
  Menu,
  Pencil,
  Plus,
  Recycle,
  Search,
  Settings,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { WORKSPACE_MODE_OPTIONS } from "@/services/preferences/workspaceMode";
import { useWorkspaceMode } from "@/components/layout/WorkspaceModeProvider";

const COLLAPSED_KEY = "careeradapt.agentSidebarCollapsed.v1";
export const ACTIVE_SESSION_KEY = "careeradapt.agent.activeSessionId";

const assetItems = [
  { href: "/ai-workspace", label: "AI 助手", icon: Bot },
  { href: "/resume", label: "我的简历", icon: FileText },
  { href: "/profile", label: "个人资料库", icon: Archive },
  { href: "/jobs", label: "岗位", icon: BriefcaseBusiness },
  { href: "/applications", label: "求职进度", icon: FolderKanban },
  { href: "/recycle", label: "回收站", icon: Recycle }
];

export function AgentSidebar() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const { mode, setMode } = useWorkspaceMode();
  const [collapsed, setCollapsed] = useState(() =>
    typeof window !== "undefined" && window.localStorage.getItem(COLLAPSED_KEY) === "true"
  );
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const store = new AgentSessionStore();

  const refreshSessions = () => {
    void store.list(6).then(setSessions);
  };

  useEffect(() => {
    let active = true;
    void store.list(6).then((items) => {
      if (active) setSessions(items);
    });
    window.addEventListener("careeradapt-agent-sessions-change", refreshSessions);
    return () => {
      active = false;
      window.removeEventListener("careeradapt-agent-sessions-change", refreshSessions);
    };
  }, []);

  const handleArchive = async (id: string) => {
    await store.archive(id);
    refreshSessions();
  };

  const startRename = (session: AgentSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title);
    requestAnimationFrame(() => renameInputRef.current?.select());
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) await store.rename(renamingId, trimmed);
    setRenamingId(null);
    refreshSessions();
  };

  const cancelRename = () => {
    setRenamingId(null);
  };

  const setSidebarCollapsed = (next: boolean) => {
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSED_KEY, String(next));
  };

  const startNewTask = () => {
    window.localStorage.removeItem(ACTIVE_SESSION_KEY);
    router.push("/ai-workspace");
    window.dispatchEvent(new CustomEvent("careeradapt-agent-new-task"));
  };

  const openSession = (sessionId: string) => {
    window.localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
    router.push("/ai-workspace");
    window.dispatchEvent(new CustomEvent("careeradapt-agent-session-select", { detail: { sessionId } }));
  };

  return (
    <aside className={collapsed ? "agent-sidebar is-collapsed" : "agent-sidebar"} aria-label="AI 工作区导航">
      <div className="agent-sidebar-brand">
        <Link href="/" className="agent-brand" aria-label="职适AI 首页">
          <span className="agent-brand-mark" aria-hidden="true">职</span>
          <span className="agent-sidebar-label">职适AI</span>
        </Link>
        <button
          className="agent-sidebar-icon-button"
          type="button"
          aria-label={collapsed ? "展开 AI 导航" : "收起 AI 导航"}
          title={collapsed ? "展开导航" : "收起导航"}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronsRight aria-hidden="true" /> : <ChevronsLeft aria-hidden="true" />}
        </button>
      </div>

      <div className="agent-sidebar-primary">
        <button className="agent-sidebar-action is-primary" type="button" onClick={startNewTask}>
          <Plus aria-hidden="true" />
          <span className="agent-sidebar-label">新任务</span>
        </button>
        <button
          className="agent-sidebar-action"
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("careeradapt-agent-history-open"))}
        >
          <Search aria-hidden="true" />
          <span className="agent-sidebar-label">搜索 / 历史</span>
        </button>
      </div>

      <nav className="agent-sidebar-assets" aria-label="资产">
        <span className="agent-sidebar-section-label agent-sidebar-label">资产</span>
        {assetItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/ai-workspace"
            ? pathname === "/" || pathname.startsWith("/ai-workspace")
            : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={active ? "agent-sidebar-link is-active" : "agent-sidebar-link"}
              title={collapsed ? label : undefined}
            >
              <Icon aria-hidden="true" />
              <span className="agent-sidebar-label">{label}</span>
            </Link>
          );
        })}
      </nav>

      <section className="agent-recent-sessions" aria-label="最近任务">
        <span className="agent-sidebar-section-label agent-sidebar-label">最近任务</span>
        {sessions.length === 0 ? (
          <p className="agent-sidebar-empty agent-sidebar-label">完成第一条任务后会显示在这里。</p>
        ) : sessions.map((session) => (
          <div className="agent-session-item" key={session.id}>
            {renamingId === session.id ? (
              <form className="agent-session-rename-form" onSubmit={(e) => { e.preventDefault(); void commitRename(); }}>
                <input
                  ref={renameInputRef}
                  className="agent-session-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") cancelRename(); }}
                  maxLength={160}
                  autoFocus
                />
                <button className="agent-session-action-btn" type="submit" aria-label="确认重命名"><Check aria-hidden="true" /></button>
                <button className="agent-session-action-btn" type="button" aria-label="取消" onClick={cancelRename}><X aria-hidden="true" /></button>
              </form>
            ) : (
              <>
                <button
                  className="agent-recent-session"
                  type="button"
                  title={session.title}
                  onClick={() => openSession(session.id)}
                >
                  <span className={`agent-session-dot is-${session.workflowState.status}`} aria-hidden="true" />
                  <span className="agent-sidebar-label">{session.title}</span>
                </button>
                <div className="agent-session-actions">
                  <button className="agent-session-action-btn" type="button" aria-label="重命名" onClick={(e) => { e.stopPropagation(); startRename(session); }}><Pencil aria-hidden="true" /></button>
                  <button className="agent-session-action-btn" type="button" aria-label="归档" onClick={(e) => { e.stopPropagation(); void handleArchive(session.id); }}><Archive aria-hidden="true" /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </section>

      <div className="agent-sidebar-footer">
        <div className="agent-mode-switcher" aria-label="工作区模式">
          {WORKSPACE_MODE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              className={mode === option.value ? "is-active" : ""}
              title={collapsed ? option.label : undefined}
              onClick={() => setMode(option.value)}
            >
              {option.value === "ai" ? <Bot aria-hidden="true" /> : option.value === "hybrid" ? <Menu aria-hidden="true" /> : <UserRound aria-hidden="true" />}
              <span className="agent-sidebar-label">{option.label.replace("模式", "")}</span>
            </button>
          ))}
        </div>
        <Link href="/settings" className="agent-sidebar-link">
          <Settings aria-hidden="true" />
          <span className="agent-sidebar-label">设置与更多</span>
        </Link>
        <div className="agent-user-area">
          <span className="agent-user-avatar" aria-hidden="true">CA</span>
          <span className="agent-sidebar-label"><strong>求职工作区</strong><small>本地数据</small></span>
        </div>
      </div>
    </aside>
  );
}
