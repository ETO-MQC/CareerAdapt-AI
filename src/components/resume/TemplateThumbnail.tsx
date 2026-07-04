"use client";

import type { ResumePresentationConfig, ResumeRenderModel } from "@/domain/schemas";
import {
  resumeTemplateStyleVars,
  type ResumeTemplateDefinition
} from "./templates/templateRegistry";

export function TemplateThumbnail({
  model,
  template,
  presentationConfig
}: {
  model: ResumeRenderModel;
  template: ResumeTemplateDefinition;
  presentationConfig?: ResumePresentationConfig;
}) {
  return (
    <div className="template-thumbnail" aria-hidden="true" data-testid={`template-thumbnail-${template.id}`}>
      <div className="template-thumbnail-scale">
        <article
          className={`resume-a4-page template-thumbnail-page ${template.className}`}
          style={resumeTemplateStyleVars(template, presentationConfig)}
        >
          {template.renderThumbnail(model, { presentationConfig, thumbnail: true })}
        </article>
      </div>
    </div>
  );
}
