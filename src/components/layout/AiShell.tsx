"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useAgentPageContext } from "@/components/agent/context/AgentPageContextProvider";
import { AgentSidebar } from "@/components/agent/shell/AgentSidebar";
import { AgentSessionStore } from "@/services/agent/agentSessionStore";
import { WorkspaceRepository } from "@/services/storage/repositories";

const assetRoutes = ["/resume", "/profile", "/jobs", "/applications", "/recycle"];

export function AiShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const isAssetPage = assetRoutes.some((route) => pathname.startsWith(route));
  const { updateContext } = useAgentPageContext();

  useEffect(() => {
    let active = true;
    void new AgentSessionStore().list(1).then(async (items) => {
      if (!active) return;
      const current = items[0];
      const branch = current?.activeResumeId
        ? await new WorkspaceRepository().getResumeBranch(current.activeResumeId)
        : undefined;
      if (!active) return;
      updateContext({
        route: pathname,
        pathname,
        title: routeTitle(pathname),
        agentSessionId: current?.id,
        personId: current?.personId,
        profileId: current?.activeProfileId,
        profileVersionNumber: current?.profileVersionNumber,
        profileRevision: current?.profileRevision,
        branchId: current?.activeResumeId,
        revisionId: branch?.currentRevisionId ?? undefined,
        jobId: current?.activeJobId,
        dirty: false
      });
      const previousRevisionId = current?.workflowState?.data.revisionId;
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
        <div className={isAssetPage ? "ai-shell-content ai-asset-content" : "ai-shell-content"}>
          {children}
        </div>
      </div>
    </div>
  );
}

function routeTitle(pathname: string) {
  if (pathname.startsWith("/resume")) return "我的简历";
  if (pathname.startsWith("/profile")) return "个人资料库";
  if (pathname.startsWith("/jobs")) return "岗位";
  if (pathname.startsWith("/applications")) return "求职进度";
  return "AI 助手";
}
