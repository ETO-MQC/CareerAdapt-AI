import type { ResumeRenderModel } from "@/domain/schemas";
import { RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { findSection, RenderSection } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";
import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";

export const renderBusinessConsulting: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    const sidebarTypes = new Set<ResumeSectionTypeV2>(["skills", "certificates", "languages", "awards"]);
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} compact context={context} /> : null}
      <div className="resume-business-grid">
        <div><RenderCanonicalSections sections={model.structuredSections.filter((item) => !sidebarTypes.has(item.sectionType))} context={context} /></div>
        <aside><RenderCanonicalSections sections={model.structuredSections.filter((item) => sidebarTypes.has(item.sectionType))} context={context} compact /></aside>
      </div>
    </>;
  }
  const summary = findSection(model, "summary");
  const skills = findSection(model, "skills");
  const certificates = findSection(model, "certificates");
  const experiences = findSection(model, "experience");
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} compact context={context} /> : null}
      <div className="resume-business-grid">
        <div>
          {summary ? <RenderSection section={summary} mode="compact" context={context} /> : null}
          {experiences ? <RenderSection section={experiences} mode="business" context={context} /> : null}
        </div>
        <aside>
          {skills ? <RenderSection section={skills} mode="plainInline" context={context} /> : null}
          {certificates ? <RenderSection section={certificates} mode="compact" context={context} /> : null}
        </aside>
      </div>
    </>
  );
};
