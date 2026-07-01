import { demoCareerProfile } from "@/data/demoProfile";

export default function ProfilePage() {
  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Career Master Profile</p>
        <h1>{demoCareerProfile.name}</h1>
        <p>{demoCareerProfile.basics.summary}</p>
      </section>

      <section className="profile-layout">
        <div className="panel">
          <h2>基本信息</h2>
          <dl className="info-list">
            <div>
              <dt>地点</dt>
              <dd>{demoCareerProfile.basics.location}</dd>
            </div>
            <div>
              <dt>邮箱</dt>
              <dd>{demoCareerProfile.basics.email}</dd>
            </div>
            <div>
              <dt>版本</dt>
              <dd>v{demoCareerProfile.version}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <h2>技能</h2>
          <div className="chip-row">
            {demoCareerProfile.skills.map((skill) => (
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
          {demoCareerProfile.experiences.map((experience) => (
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
