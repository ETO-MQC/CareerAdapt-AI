import Link from "next/link";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";

const workspaceItems = [
  {
    label: "Schema",
    value: "核心实体已定义",
    detail: "CareerProfile / JobDescription / ResumeBranch / AiSuggestion"
  },
  {
    label: "示例母档案",
    value: demoCareerProfile.name,
    detail: `${demoCareerProfile.experiences.length} 段经历，${demoCareerProfile.skills.length} 项技能`
  },
  {
    label: "示例岗位",
    value: `${demoJobDescriptions.length} 份 JD`,
    detail: demoJobDescriptions.map((job) => job.title).join(" / ")
  },
  {
    label: "PDF 探针",
    value: "A4 HTML",
    detail: "浏览器打印导出，保留可复制文本"
  }
];

export default function HomePage() {
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
        <Link href="/profile">查看示例母档案</Link>
        <Link href="/jobs">查看示例岗位</Link>
        <Link href="/resume">查看简历工作台</Link>
      </section>
    </main>
  );
}
