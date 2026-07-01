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
      label: "Schema",
      value: "核心实体已定义",
      detail: "CareerProfile / JobDescription / ResumeBranch / AiSuggestion"
    },
    {
      label: "Repository 母档案",
      value: profile?.name ?? "未读取到母档案",
      detail: profile ? `${profile.experiences.length} 段经历，${profile.skills.length} 项技能` : "数据来自 IndexedDB"
    },
    {
      label: "Repository 岗位",
      value: `${jobs.length} 份 JD`,
      detail: jobs.length > 0 ? jobs.map((job) => job.title).join(" / ") : "暂无岗位数据"
    },
    {
      label: "PDF 探针",
      value: "A4 HTML",
      detail: "优先读取应用 workspace 数据，失败时使用固定探针数据"
    }
  ];

  return (
    <main className="page-shell">
      <section className="workspace-band">
        <div>
          <p className="eyebrow">阶段A / Sprint 0</p>
          <h1>项目空间</h1>
        </div>
        <Link className="primary-link" href="/export/probe">
          打开 A4 探针
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
        <Link href="/profile">查看母档案</Link>
        <Link href="/jobs">查看岗位</Link>
        <Link href="/resume">查看简历工作台</Link>
      </section>
    </main>
  );
}
