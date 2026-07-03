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
  render: (model: ResumeRenderModel, context?: TemplateRenderContext) => ReactNode;
};

export type TemplateRenderContext = {
  selectedItemId?: string;
};

export const resumeTemplates: TemplateDefinition[] = [
  {
    id: "classic-technical",
    name: "模板A 稳重清晰",
    audience: "数据 / 技术 / 研究",
    className: "template-classic-technical",
    render: (model, context) => <ClassicTechnicalTemplate model={model} context={context} />
  },
  {
    id: "modern-operations",
    name: "模板B 简洁现代",
    audience: "运营 / 产品 / 综合",
    className: "template-modern-operations",
    render: (model, context) => <ModernOperationsTemplate model={model} context={context} />
  }
];

export function getResumeTemplate(templateId: TemplateId) {
  return resumeTemplates.find((template) => template.id === templateId) ?? resumeTemplates[0];
}

function ClassicTechnicalTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  return (
    <>
      <ResumeHeader model={model} />
      {section(model, "summary", undefined, context)}
      {section(model, "skills", "inline", context)}
      {section(model, "experience", undefined, context)}
      {section(model, "certificates", "inline", context)}
    </>
  );
}

function ModernOperationsTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  const summary = findSection(model, "summary");
  const skills = findSection(model, "skills");
  const certificates = findSection(model, "certificates");
  const experiences = findSection(model, "experience");

  return (
    <>
      <ResumeHeader model={model} compact />
      <div className="resume-modern-grid">
        <aside>
          {summary ? <RenderSection section={summary} mode="compact" context={context} /> : null}
          {skills ? <RenderSection section={skills} mode="tag" context={context} /> : null}
          {certificates ? <RenderSection section={certificates} mode="compact" context={context} /> : null}
        </aside>
        <div>
          {experiences ? <RenderSection section={experiences} context={context} /> : null}
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

function section(model: ResumeRenderModel, type: ResumeRenderSection["type"], mode?: "inline" | "compact" | "tag", context?: TemplateRenderContext) {
  const found = findSection(model, type);
  return found ? <RenderSection section={found} mode={mode} context={context} /> : null;
}

function findSection(model: ResumeRenderModel, type: ResumeRenderSection["type"]) {
  return model.sections.find((candidate) => candidate.type === type);
}

function RenderSection({ section, mode, context }: { section: ResumeRenderSection; mode?: "inline" | "compact" | "tag"; context?: TemplateRenderContext }) {
  return (
    <section className={`resume-template-section ${mode ? `resume-section-${mode}` : ""}`} data-render-section={section.type}>
      <h2>{section.title}</h2>
      {mode === "inline" || mode === "tag" ? (
        <div className={mode === "tag" ? "resume-tag-list" : "resume-inline-list"}>
          {section.blocks.map((block) => (
            <span key={block.sourceItemId} className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</span>
          ))}
        </div>
      ) : (
        <div className="resume-block-list">
          {section.blocks.map((block) => <RenderBlock key={block.sourceItemId} block={block} compact={mode === "compact"} context={context} />)}
        </div>
      )}
    </section>
  );
}

function RenderBlock({ block, compact, context }: { block: ResumeRenderBlock; compact?: boolean; context?: TemplateRenderContext }) {
  if (compact || block.itemType === "summary") {
    return <p className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</p>;
  }

  return (
    <div className={`resume-template-item ${selectedClass(block, context)}`} {...editableBlockAttrs(block, context)}>
      <p>{block.text}</p>
    </div>
  );
}

function editableBlockAttrs(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  const selected = block.sourceItemId === context?.selectedItemId;
  return {
    "data-source-item-id": block.sourceItemId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

function selectedClass(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  return block.sourceItemId === context?.selectedItemId ? "resume-template-item-selected" : "";
}
