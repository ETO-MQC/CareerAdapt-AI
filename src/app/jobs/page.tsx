import { demoJobDescriptions } from "@/data/demoJobs";

export default function JobsPage() {
  return (
    <main className="page-shell">
      <section className="page-title">
        <p className="eyebrow">Job Workspace</p>
        <h1>岗位工作区</h1>
      </section>

      <section className="job-list">
        {demoJobDescriptions.map((job) => (
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
