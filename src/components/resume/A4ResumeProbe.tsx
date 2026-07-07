"use client";

import Link from "next/link";
import { demoCareerProfile } from "@/data/demoProfile";
import { useWorkspace } from "@/services/workspace/useWorkspace";
import { printCurrentPage } from "@/services/export/browserPrint";

export function A4ResumeProbe() {
  const workspace = useWorkspace();
  const repositoryProfile = workspace.status === "ready" ? workspace.profiles[0] : undefined;
  const profile = repositoryProfile ?? demoCareerProfile;
  const sourceLabel = repositoryProfile ? "使用当前资料" : "使用示例资料";

  return (
    <main className="probe-shell">
      <div className="probe-toolbar no-print">
        <Link href="/resume">返回工作台</Link>
        <span className="probe-source">{sourceLabel}</span>
        <button type="button" onClick={printCurrentPage}>
          打印 / 保存 PDF
        </button>
      </div>

      <article className="a4-page" data-testid="a4-page" aria-label="A4 简历预览">
        <header className="resume-header">
          <div>
            <h1>{profile.basics.name}</h1>
            <p>{profile.basics.summary}</p>
          </div>
          <address>
            <span>{profile.basics.location}</span>
            <span>{profile.basics.phone}</span>
            <span>{profile.basics.email}</span>
          </address>
        </header>

        <section className="resume-section">
          <h2>求职方向</h2>
          <p>{profile.preference.targetRoles.join(" / ")}</p>
        </section>

        <section className="resume-section">
          <h2>项目与经历</h2>
          {profile.experiences.map((experience) => (
            <div className="resume-item" key={experience.id}>
              <div className="resume-item-heading">
                <strong>{experience.organization}</strong>
                <span>
                  {experience.startDate} - {experience.endDate}
                </span>
              </div>
              <p className="resume-role">{experience.role}</p>
              <ul>
                {experience.resumeDrafts.slice(0, 1).map((draft) => (
                  <li key={draft.id}>{draft.text}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="resume-section two-column">
          <div>
            <h2>技能</h2>
            <p>{profile.skills.map((skill) => skill.name).join(" / ")}</p>
          </div>
          <div>
            <h2>证书</h2>
            <p>{profile.certificates.map((certificate) => certificate.name).join(" / ")}</p>
          </div>
        </section>
      </article>
    </main>
  );
}
