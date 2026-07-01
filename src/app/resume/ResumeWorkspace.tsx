"use client";

import Link from "next/link";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

export function ResumeWorkspace() {
  const workspace = useWorkspace();

  if (workspace.status === "loading") {
    return (
      <main className="page-shell">
        <WorkspaceLoadingState />
      </main>
    );
  }

  if (workspace.status === "error") {
    return (
      <main className="page-shell">
        <WorkspaceErrorState message={workspace.error} />
      </main>
    );
  }

  if (workspace.status === "empty" || workspace.profiles.length === 0) {
    return (
      <main className="page-shell">
        <WorkspaceEmptyState />
      </main>
    );
  }

  const profile = workspace.profiles[0];

  return (
    <main className="page-shell">
      <section className="workspace-band">
        <div>
          <p className="eyebrow">Resume Workbench / Repository</p>
          <h1>简历工作台</h1>
          <p>{profile.name} 的 A4 探针预览优先连接应用 workspace 数据。</p>
        </div>
        <Link className="primary-link" href="/export/probe">
          查看预览
        </Link>
      </section>
    </main>
  );
}
