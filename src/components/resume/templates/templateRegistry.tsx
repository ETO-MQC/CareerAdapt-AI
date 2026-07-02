import type { ReactNode } from "react";
import type {
  ResumeRenderBlock,
  ResumeRenderModel,
  ResumeRenderSection,
  TemplateId
} from "@/domain/schemas";

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  audience: string;
  className: string;
  render: (model: ResumeRenderModel) => ReactNode;
};

export const resumeTemplates: TemplateDefinition[] = [
  {
    id: "classic-technical",
    name: "模板A 稳重清晰",
    audience: "数据 / 技术 / 研究",
    className: "template-classic-technical",
    render: (model) => <ClassicTechnicalTemplate model={model} />
  },
  {
    id: "modern-operations",
    name: "模板B 简洁现代",
    audience: "运营 / 产品 / 综合",
    className: "template-modern-operations",
    render: (model) => <ModernOperationsTemplate model={model} />
  }
];

export function getResumeTemplate(templateId: TemplateId) {
  return resumeTemplates.find((template) => template.id === templateId) ?? resumeTemplates[0];
}

function ClassicTechnicalTemplate({ model }: { model: ResumeRenderModel }) {
  return (
    <>
      <ResumeHeader model={model} />
      {section(model, "summary")}
      {section(model, "skills", "inline")}
      {section(model, "experience")}
      {section(model, "certificates", "inline")}
    </>
  );
}

function ModernOperationsTemplate({ model }: { model: ResumeRenderModel }) {
  const summary = findSection(model, "summary");
  const skills = findSection(model, "skills");
  const certificates = findSection(model, "certificates");
  const experiences = findSection(model, "experience");

  return (
    <>
      <ResumeHeader model={model} compact />
      <div className="resume-modern-grid">
        <aside>
          {summary ? <RenderSection section={summary} mode="compact" /> : null}
          {skills ? <RenderSection section={skills} mode="tag" /> : null}
          {certificates ? <RenderSection section={certificates} mode="compact" /> : null}
        </aside>
        <div>
          {experiences ? <RenderSection section={experiences} /> : null}
        </div>
      </div>
    </>
  );
}

function ResumeHeader({ model, compact = false }: { model: ResumeRenderModel; compact?: boolean }) {
  return (
    <header className={`resume-template-header ${compact ? "resume-template-header-compact" : ""}`}>
      <div>
        <h1>{model.candidate.name}</h1>
        <p>{model.company} / {model.jobTitle}</p>
      </div>
      <address>
        {model.candidate.contacts.map((contact) => (
          <span key={contact}>{contact}</span>
        ))}
      </address>
    </header>
  );
}

function section(model: ResumeRenderModel, type: ResumeRenderSection["type"], mode?: "inline" | "compact" | "tag") {
  const found = findSection(model, type);
  return found ? <RenderSection section={found} mode={mode} /> : null;
}

function findSection(model: ResumeRenderModel, type: ResumeRenderSection["type"]) {
  return model.sections.find((candidate) => candidate.type === type);
}

function RenderSection({ section, mode }: { section: ResumeRenderSection; mode?: "inline" | "compact" | "tag" }) {
  return (
    <section className={`resume-template-section ${mode ? `resume-section-${mode}` : ""}`} data-render-section={section.type}>
      <h2>{section.title}</h2>
      {mode === "inline" || mode === "tag" ? (
        <div className={mode === "tag" ? "resume-tag-list" : "resume-inline-list"}>
          {section.blocks.map((block) => (
            <span key={block.sourceItemId}>{block.text}</span>
          ))}
        </div>
      ) : (
        <div className="resume-block-list">
          {section.blocks.map((block) => <RenderBlock key={block.sourceItemId} block={block} compact={mode === "compact"} />)}
        </div>
      )}
    </section>
  );
}

function RenderBlock({ block, compact }: { block: ResumeRenderBlock; compact?: boolean }) {
  if (compact || block.itemType === "summary") {
    return <p data-source-item-id={block.sourceItemId}>{block.text}</p>;
  }

  return (
    <div className="resume-template-item" data-source-item-id={block.sourceItemId}>
      <p>{block.text}</p>
    </div>
  );
}
