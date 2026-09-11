import type { ResumeRenderModel } from "@/domain/schemas";
import { RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { findSection, RenderSection } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";
import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";

export const renderModernOperations: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    const sidebarTypes = new Set<ResumeSectionTypeV2>(["summary", "skills", "certificates", "languages"]);
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} compact context={context} /> : null}
      <div className="resume-modern-grid">
        <aside><RenderCanonicalSections sections={model.structuredSections.filter((item) => sidebarTypes.has(item.sectionType))} context={context} /></aside>
        <div><RenderCanonicalSections sections={model.structuredSections.filter((item) => !sidebarTypes.has(item.sectionType))} context={context} /></div>
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
      <div className="resume-modern-grid">
        <aside>
          {summary ? <RenderSection section={summary} mode="compact" context={context} /> : null}
          {skills ? <RenderSection section={skills} mode="tag" context={context} /> : null}
          {certificates ? <RenderSection section={certificates} mode="compact" context={context} /> : null}
        </aside>
        <div>{experiences ? <RenderSection section={experiences} context={context} /> : null}</div>
      </div>
    </>
  );
};
