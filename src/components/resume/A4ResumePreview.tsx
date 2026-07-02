"use client";

import type { RefObject } from "react";
import type { ResumeRenderModel } from "@/domain/schemas";
import { type TemplateDefinition } from "./templates/templateRegistry";

export function A4ResumePreview({
  model,
  template,
  pageRef
}: {
  model: ResumeRenderModel;
  template: TemplateDefinition;
  pageRef: RefObject<HTMLElement | null>;
}) {
  return (
    <article
      ref={pageRef}
      className={`resume-a4-page ${template.className}`}
      data-testid="resume-a4-page"
      aria-label="A4 简历预览"
    >
      {template.render(model)}
    </article>
  );
}
