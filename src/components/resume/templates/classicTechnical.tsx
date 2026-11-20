import type { ResumeRenderModel } from "@/domain/schemas";
import { ResumeHeader } from "./shared/canonical";
import { findSection, RenderSection, section } from "./shared/legacy";
import type { TemplateRenderContext, TemplateRenderer } from "./types";
import { renderCampusReference } from "./campusReference";

export const renderClassicTechnical: TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    return renderCampusReference(model, { ...context, referenceCompact: true });
  }
  const experience = findSection(model, "experience");
  const beforeSkillsSectionIds = ["experience", "education", "projects", "campus", "awards"];
  const experienceBeforeSkills = experience ? { ...experience, blocks: experience.blocks.filter((block) => beforeSkillsSectionIds.includes(block.sourceSectionId ?? "")) } : undefined;
  const experienceAfterSkills = experience ? { ...experience, blocks: experience.blocks.filter((block) => !beforeSkillsSectionIds.includes(block.sourceSectionId ?? "")) } : undefined;
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      {section(model, "summary", undefined, context)}
      {experienceBeforeSkills?.blocks.length ? <RenderSection section={experienceBeforeSkills} context={context} /> : null}
      {section(model, "skills", "inline", context)}
      {section(model, "certificates", "inline", context)}
      {experienceAfterSkills?.blocks.length ? <RenderSection section={experienceAfterSkills} context={context} showSectionTitle={Boolean(!experienceBeforeSkills?.blocks.length)} /> : null}
    </>
  );
};
