import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { hasUserSectionOrder, orderCanonicalSections, RenderCanonicalSections, ResumeHeader } from "./shared/canonical";
import { section } from "./shared/legacy";
import type { TemplateRenderer } from "./types";

const ORDER: ResumeSectionTypeV2[] = ["education", "work", "internship", "project", "research", "campus", "volunteer", "training", "skills", "certificates", "languages", "awards", "publications", "patents", "portfolio", "other", "custom", "summary"];

/** Reference-led single column. Canonical sections and item IDs stay intact for coverage and editing. */
export const renderCampusReference: TemplateRenderer = (model, context) => {
  const renderContext = { ...context, inlineDepartment: true };
  if (model.schemaVersion !== "resume-render-v2" || !model.structuredSections.length) {
    return <>{!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      {section(model, "experience", undefined, context)}{section(model, "skills", "inline", context)}
      {section(model, "certificates", "inline", context)}{section(model, "summary", undefined, context)}</>;
  }
  const sections = orderCanonicalSections(model.structuredSections, ORDER, context);
  // Grouping is purely visual: preserve each canonical section container and its coverage identity.
  let groupStarted = false;
  const groupedHeadingSectionIds: string[] = [];
  const grouped = sections.map((entry) => {
    if (hasUserSectionOrder(context) || !["skills", "certificates", "languages"].includes(entry.sectionType)
      || context?.presentationConfig?.sectionStyleOverrides[entry.sectionId]?.titleOverride) return entry;
    const first = !groupStarted;
    groupStarted = true;
    if (!first) groupedHeadingSectionIds.push(entry.sectionId);
    return { ...entry, title: first ? "技能与证书" : entry.title };
  });
  return <>{!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
    <div className="resume-campus-reference-layout"><RenderCanonicalSections sections={grouped} context={renderContext} groupedHeadingSectionIds={groupedHeadingSectionIds} compact /></div></>;
};
