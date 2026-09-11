import type { ResumeRenderModel } from "@/domain/schemas";
import { type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { orderCanonicalSections, RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { section } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";

const PROFESSIONAL_SECTION_ORDER: ResumeSectionTypeV2[] = [
  "summary", "education", "work", "internship", "campus", "project", "research", "skills", "certificates",
  "languages", "awards", "volunteer", "publications", "patents", "portfolio", "other", "custom"
];

export const renderProfessionalClassic: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} plain context={context} /> : null}
      <div className="resume-professional-classic-layout">
        <RenderCanonicalSections sections={orderCanonicalSections(model.structuredSections, PROFESSIONAL_SECTION_ORDER)} context={context} />
      </div>
    </>;
  }
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} plain context={context} /> : null}
      {section(model, "summary", "plain", context)}
      {section(model, "experience", "plain", context)}
      {section(model, "skills", "plainInline", context)}
      {section(model, "certificates", "plainInline", context)}
    </>
  );
};
