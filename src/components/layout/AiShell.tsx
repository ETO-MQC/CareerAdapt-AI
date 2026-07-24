"use client";

import Link from "next/link";
import { ArrowLeft, CircleDot } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { AgentSession } from "@/agent/contracts/agentSession";
import { useAgentPageContext } from "@/components/agent/context/AgentPageContextProvider";
import { AgentSidebar } from "@/components/agent/shell/AgentSidebar";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { ACTIVE_SESSION_KEY } from "@/components/agent/shell/AgentSidebar";

const assetRoutes = ["/resume", "/profile", "/jobs", "/applications"];

export function AiShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isAssetPage = assetRoutes.some((route) => pathname.startsWith(route));
  const [session, setSession] = useState<AgentSession>();
  const { updateContext } = useAgentPageContext();

  useEffect(() => {
    let active = true;
    void new AgentSessionStore().list(1).then(async (items) => {
      if (!active) return;
      const current = items[0];
      setSession(current);
      const branch = current?.activeResumeId
        ? await new WorkspaceRepository().getResumeBranch(current.activeResumeId)
        : undefined;
      if (!active) return;
      updateContext({
        route: pathname,
        pathname,
        title: routeTitle(pathname),
        profileId: current?.activeProfileId,
        branchId: current?.activeResumeId,
        revisionId: branch?.currentRevisionId ?? undefined,
        jobId: current?.activeJobId,
        dirty: false
      });
      const previousRevisionId = current?.workflowState.data.revisionId;
      if (
        current
        && branch?.currentRevisionId
        && typeof previousRevisionId === "string"
        && previousRevisionId !== branch.currentRevisionId
      ) {
        window.dispatchEvent(new CustomEvent("careeradapt-agent-revision-change", {
          detail: { branchId: branch.id, revisionId: branch.currentRevisionId }
        }));
      }
    });
    return () => { active = false; };
  }, [pathname, updateContext]);

  return (
    <div className="ai-shell">
      <AgentSidebar />
      <div className="ai-shell-main">
        {isAssetPage ? (
          <div className="ai-context-bar" role="status">
            <div>
              <span>正在处理</span>
              <strong>{session?.title ?? "浏览求职资产"}</strong>
            </div>
            <span className="ai-context-status"><CircleDot aria-hidden="true" /> {statusLabel(session?.workflowState.status)}</span>
            <Link
              href="/ai-workspace"
              onClick={() => {
                if (session) window.localStorage.setItem(ACTIVE_SESSION_KEY, session.id);
              }}
            >
              <ArrowLeft aria-hidden="true" /> 返回任务
            </Link>
          </div>
        ) : null}
        <div className={isAssetPage ? "ai-shell-content ai-asset-content" : "ai-shell-content"}>
          {children}
        </div>
      </div>
    </div>
  );
}

function statusLabel(status?: AgentSession["workflowState"]["status"]) {
  if (status === "running") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "需要处理";
  if (status === "waiting_for_confirmation") return "等待确认";
  return "等待继续";
}

function routeTitle(pathname: string) {
  if (pathname.startsWith("/resume")) return "我的简历";
  if (pathname.startsWith("/profile")) return "个人资料库";
  if (pathname.startsWith("/jobs")) return "岗位";
  if (pathname.startsWith("/applications")) return "求职进度";
  return "AI 助手";
}
