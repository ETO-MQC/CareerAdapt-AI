"use client";

import { useWorkspace } from "@/services/workspace/useWorkspace";
import { WorkspaceEmptyState, WorkspaceErrorState, WorkspaceLoadingState } from "@/components/workspace/WorkspaceStates";

export function ProfileWorkspace() {
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
      <section className="page-title">
        <p className="eyebrow">Career Master Profile / Repository</p>
        <h1>{profile.name}</h1>
        <p>{profile.basics.summary}</p>
      </section>

      <section className="profile-layout">
        <div className="panel">
          <h2>基本信息</h2>
          <dl className="info-list">
            <div>
              <dt>地点</dt>
              <dd>{profile.basics.location}</dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>{profile.basics.email}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>v{profile.version}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <h2>技能</h2>
          <div className="chip-row">
            {profile.skills.map((skill) => (
              <span className="chip" key={skill.id}>
                {skill.name}
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>经历事实</h2>
        <div className="timeline">
          {profile.experiences.map((experience) => (
            <article key={experience.id}>
              <div>
                <h3>{experience.organization}</h3>
                <p>
                  {experience.role} · {experience.startDate} - {experience.endDate}
                </p>
              </div>
              {experience.facts.map((fact) => (
                <p className="fact-line" key={fact.id}>
                  {fact.statement}
                  <span>{fact.confirmedByUser ? "已确认" : "待确认"}</span>
                </p>
              ))}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
