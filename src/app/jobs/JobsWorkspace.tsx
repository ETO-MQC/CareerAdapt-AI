"use client";

import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

export function JobsWorkspace() {
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

  if (workspace.status === "empty" || workspace.jobs.length === 0) {
    return (
      <main className="page-shell">
        <WorkspaceEmptyState />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Job Workspace / Repository</p>
        <h1>岗位工作区</h1>
      </section>

      <section className="job-list">
        {workspace.jobs.map((job) => (
          <article className="panel" key={job.id}>
            <div className="job-heading">
              <div>
                <h2>{job.title}</h2>
                <p>
                  {job.company} · {job.location}
                </p>
              </div>
              <span>{job.requirements.length} 条要求</span>
            </div>
            <p className="raw-text">{job.rawText}</p>
            <div className="requirement-list">
              {job.requirements.map((requirement) => (
                <div key={requirement.id}>
                  <strong>{requirement.description}</strong>
                  <span>{requirement.priority}</span>
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
