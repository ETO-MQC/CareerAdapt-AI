import type { ResumeRenderModel } from "@/domain/schemas";
import { type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { orderCanonicalSections, RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { section } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";

const CAMPUS_SECTION_ORDER: ResumeSectionTypeV2[] = [
  "summary", "education", "project", "internship", "work", "campus", "skills", "certificates",
  "awards", "languages", "research", "volunteer", "publications", "patents", "portfolio", "other", "custom"
];

export const renderCampusClean: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      <div className="resume-campus-clean-layout">
        <RenderCanonicalSections sections={orderCanonicalSections(model.structuredSections, CAMPUS_SECTION_ORDER)} context={context} />
      </div>
    </>;
  }
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      {section(model, "summary", undefined, context)}
      {section(model, "experience", undefined, context)}
      {section(model, "skills", "inline", context)}
      {section(model, "certificates", "inline", context)}
    </>
  );
};
