"use client";

import Link from "next/link";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

export function HomeWorkspace() {
  const workspace = useWorkspace();

  const profile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const jobs = workspace.status === "ready" ? workspace.jobs : [];

  const workspaceItems = [
    {
      label: "我的资料",
      value: profile?.name ?? "等待创建",
      detail: profile ? `${profile.experiences.length} 段经历，${profile.skills.length} 项技能` : "先导入或填写真实经历"
    },
    {
      label: "我的简历",
      value: "可编辑工作台",
      detail: "从零创建、导入 PDF、换模板和导出"
    },
    {
      label: "岗位",
      value: `${jobs.length} 份 JD`,
      detail: jobs.length > 0 ? jobs.map((job) => job.title).join(" / ") : "粘贴岗位描述后开始匹配"
    },
    {
      label: "求职进度",
      value: "看板",
      detail: "管理投递、材料和跟进"
    }
  ];

  return (
    <main className="page-shell">
      <section className="workspace-band">
        <div>
          <p className="eyebrow">简历与求职工作台</p>
          <h1>首页</h1>
          <p>从真实经历开始，制作可编辑、可针对岗位调整并可导出的简历。</p>
        </div>
        <Link className="primary-link" href="/resume">
          开始制作简历
        </Link>
      </section>

      {workspace.status === "loading" ? <WorkspaceLoadingState /> : null}
      {workspace.status === "error" ? <WorkspaceErrorState message={workspace.error} /> : null}
      {workspace.status === "empty" ? <WorkspaceEmptyState /> : null}

      <section className="status-grid" aria-label="底座状态">
        {workspaceItems.map((item) => (
          <article className="status-tile" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.detail}</p>
          </article>
        ))}
      </section>

      <section className="route-grid" aria-label="工作区入口">
        <Link href="/resume">我的简历</Link>
        <Link href="/profile">个人资料库</Link>
        <Link href="/jobs">岗位</Link>
        <Link href="/applications">求职进度</Link>
      </section>
    </main>
  );
}
