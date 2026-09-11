import type { ResumeRenderModel } from "@/domain/schemas";
import { RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { section } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";

export const renderAtsMinimal: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    return <>{!context?.pagination?.isContinuation ? <ResumeHeader model={model} plain context={context} /> : null}<RenderCanonicalSections sections={model.structuredSections} context={context} compact /></>;
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
