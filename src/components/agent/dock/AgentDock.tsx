"use client";

import Link from "next/link";
import { Bot, ChevronRight, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { useAgentPageContext } from "@/components/agent/context/AgentPageContextProvider";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";

export function AgentDock() {
  const { context } = useAgentPageContext();
  const [open, setOpen] = useState(true);
  const [session, setSession] = useState<AgentSession>();

  useEffect(() => {
    void new AgentSessionStore().list(1).then((items) => setSession(items[0]));
  }, []);

  useEffect(() => {
    const openDock = () => setOpen(true);
    window.addEventListener("careeradapt-agent-dock-open", openDock);
    return () => window.removeEventListener("careeradapt-agent-dock-open", openDock);
  }, []);

  return (
    <aside className={open ? "agent-dock is-open" : "agent-dock"} aria-label="AI 协作助手">
      <button
        className="agent-dock-toggle"
        type="button"
        aria-label={open ? "收起 AI 协作助手" : "展开 AI 协作助手"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
      </button>
      {open ? (
        <div className="agent-dock-content">
          <header>
            <span><Bot aria-hidden="true" /> AI 协作助手</span>
            <small>{session?.workflowState.status === "running" ? "处理中" : "可随时继续"}</small>
          </header>
          <div className="agent-dock-context">
            <span>当前页面</span>
            <strong>{context.title ?? routeLabel(context.route ?? context.pathname ?? "/")}</strong>
            {context.dirty ? <small>有未保存修改</small> : <small>上下文已同步</small>}
          </div>
          {session ? (
            <div className="agent-dock-session">
              <small>当前任务</small>
              <strong>{session.title}</strong>
              <p>{session.messages.at(-1)?.content ?? "返回 AI 助手继续这项任务。"}</p>
            </div>
          ) : (
            <p className="agent-dock-empty">还没有 AI 任务。打开助手，从真实经历或岗位开始。</p>
          )}
          <Link href="/ai-workspace" className="agent-dock-open-link">
            打开 AI 助手 <ChevronRight aria-hidden="true" />
          </Link>
        </div>
      ) : null}
    </aside>
  );
}

function routeLabel(route: string) {
  if (route.startsWith("/resume")) return "我的简历";
  if (route.startsWith("/profile")) return "个人资料库";
  if (route.startsWith("/jobs")) return "岗位";
  if (route.startsWith("/applications")) return "求职进度";
  return "工作区";
}
