import type { ResumePresentationItem, ResumeRenderBlock, ResumeRenderModel, ResumeRenderSection, ResumeRenderStructuredSectionV2 } from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { compactSkillCategory } from "@/domain/resumeComposition/ResumeSkillTaxonomy";
import type { TemplateRenderContext } from "../types";

export function orderCanonicalSections(
  sections: ResumeRenderStructuredSectionV2[],
  preferredTypes: ResumeSectionTypeV2[] = [...RESUME_SECTION_TYPES_V2]
) {
  const preferredOrder = new Map(preferredTypes.map((type, index) => [type, index]));
  return [...sections].sort((left, right) => {
    const leftRank = preferredOrder.get(left.sectionType) ?? preferredTypes.length;
    const rightRank = preferredOrder.get(right.sectionType) ?? preferredTypes.length;
    return leftRank - rightRank || left.order - right.order || left.sectionId.localeCompare(right.sectionId);
  });
}

export function RenderCanonicalSections({
  sections,
  context,
  compact = false
}: {
  sections: ResumeRenderStructuredSectionV2[];
  context?: TemplateRenderContext;
  compact?: boolean;
}) {
  return <>
    {sections.map((section) => (
      <section
        className={`resume-template-section resume-canonical-section ${compact ? "resume-section-compact" : ""}`}
        data-render-section={section.sectionType}
        data-render-section-id={section.sectionId}
        data-render-section-primary={section.showTitle === false ? "false" : "true"}
        key={section.sectionId}
      >
        {section.showTitle !== false ? <h2 {...canonicalSectionTitleAttrs(section, context)}>{section.title}</h2> : null}
        <RenderPresentationItems items={section.items.map((item) => item.presentation)} context={context} />
      </section>
    ))}
  </>;
}

function RenderPresentationItems({ items, context }: { items: ResumePresentationItem[]; context?: TemplateRenderContext }) {
  if (items[0]?.sectionType === "skills") return <RenderSkillPresentation items={items} context={context} />;
  if (items[0]?.sectionType === "languages") return <RenderLanguagePresentation items={items} context={context} />;
  return <div className="resume-block-list">{items.map((item) => <RenderPresentationItem item={item} context={context} key={item.id} />)}</div>;
}

function RenderSkillPresentation({ items, context }: { items: ResumePresentationItem[]; context?: TemplateRenderContext }) {
  const groups = new Map<string, ResumePresentationItem[]>();
  for (const item of items) {
    const label = compactSkillCategory(item.groupLabel ?? "");
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return <div className="resume-skill-groups">
    {[...groups.entries()].map(([label, groupItems]) => (
      <div className="resume-skill-group" key={label || "uncategorized"}>
        {label ? <strong>{label}</strong> : null}
        <div className="resume-skill-values">
          {context?.measurement
            ? groupItems.map((item) => (
                <div {...presentationItemAttrs(item, context, "resume-skill-item")} data-pagination-unit="content" key={item.id}>
                  <span className="resume-skill-heading">
                    <strong className="resume-skill-name">{item.primaryTitle}</strong>
                    {item.secondaryTitle ? <span className="resume-skill-level">（{item.secondaryTitle}）</span> : null}
                  </span>
                  {item.description ? <span className="resume-skill-description">{item.description}</span> : null}
                </div>
              ))
            : (
                <div {...presentationItemAttrs(groupItems[0], context, "resume-skill-item")} data-pagination-unit="content">
                  <span className="resume-skill-heading">
                    <strong className="resume-skill-name">{groupItems.map((item) => item.primaryTitle).filter(Boolean).join(" · ")}</strong>
                    {groupItems.some((item) => item.secondaryTitle) ? <span className="resume-skill-level">（{groupItems.map((item) => item.secondaryTitle).filter(Boolean).join(" · ")}）</span> : null}
                  </span>
                  {groupItems.map((item) => item.description).filter(Boolean).length ? <span className="resume-skill-description">{groupItems.map((item) => item.description).filter(Boolean).join("；")}</span> : null}
                  {groupItems.slice(1).map((item) => (
                    <span
                      aria-hidden="true"
                      className="resume-skill-coverage-marker"
                      data-coverage-item-id={item.sourceItemId ?? item.id}
                      data-render-fragment-index={item.fragmentIndex ?? 0}
                      key={`coverage:${item.id}`}
                    />
                  ))}
                </div>
              )}
        </div>
      </div>
    ))}
  </div>;
}

function RenderLanguagePresentation({ items, context }: { items: ResumePresentationItem[]; context?: TemplateRenderContext }) {
  return <div className="resume-language-list">
    {items.map((item, index) => (
      <div {...presentationItemAttrs(item, context, "resume-language-row")} data-pagination-unit="content" key={item.id}>
        {index > 0 ? "，" : ""}{[item.primaryTitle, item.secondaryTitle, item.description].filter(Boolean).join("")}
        <RenderCustomRows rows={item.customRows} />
      </div>
    ))}
  </div>;
}

function RenderPresentationItem({ item, context }: { item: ResumePresentationItem; context?: TemplateRenderContext }) {
  if (item.sectionType === "summary") {
    return <div {...presentationItemAttrs(item, context, "resume-presentation-summary")}><p data-pagination-unit="description">{item.description}</p></div>;
  }
  if (item.sectionType === "languages") {
    return <div {...presentationItemAttrs(item, context, "resume-language-row")} data-pagination-unit="content">
      <strong>{item.primaryTitle}</strong>{item.secondaryTitle ? <><span aria-hidden="true">：</span><span>{item.secondaryTitle}</span></> : null}
      {item.description ? <span className="resume-language-description"> · {item.description}</span> : null}
      <RenderCustomRows rows={item.customRows} />
    </div>;
  }
  const unlistedLinks = item.links.filter((link) => !item.inlineMeta.includes(link) && !item.secondaryMeta.includes(link));
  return (
    <article {...presentationItemAttrs(item, context, "resume-template-item resume-canonical-item")}>
      {(item.primaryTitle || item.secondaryTitle || item.dateRange) ? (
        <div className={`resume-presentation-heading resume-presentation-heading-${context?.presentationConfig?.itemHeaderMiddleAlignment ?? "balanced"}`} data-pagination-unit="heading">
          {item.primaryTitle ? <h3>{item.primaryTitle}</h3> : <span />}
          {item.secondaryTitle ? <strong>{item.secondaryTitle}</strong> : null}
          {item.dateRange ? <time>{item.dateRange}</time> : null}
        </div>
      ) : null}
      {item.tertiaryTitle || item.location ? <p className="resume-presentation-subtitle" data-pagination-unit="subtitle">{joinPresentationValues([item.location, item.tertiaryTitle])}</p> : null}
      {item.inlineMeta.length ? <p className="resume-presentation-meta" data-pagination-unit="inline-meta"><RenderMetaValues values={item.inlineMeta} /></p> : null}
      {item.secondaryMeta.map((meta, index) => <p className="resume-presentation-secondary" data-pagination-unit={`secondary-meta:${index}`} key={meta}>{meta}</p>)}
      {item.description ? <p className="resume-presentation-description" data-pagination-unit="description">{item.description}</p> : null}
      {item.highlights.length ? <RenderHighlights highlights={item.highlights.map((highlight, index) => ({ value: highlight, key: `highlight:${index}` }))} context={context} /> : null}
      {unlistedLinks.length ? <p className="resume-presentation-links" data-pagination-unit="links"><RenderMetaValues values={unlistedLinks} /></p> : null}
      <RenderCustomRows rows={item.customRows} context={context} />
    </article>
  );
}

function RenderHighlights({ highlights, context }: { highlights: Array<{ value: string; key: string }>; context?: TemplateRenderContext }) {
  const listStyle = context?.presentationConfig?.highlightListStyle ?? "bullet";
  if (!highlights.length) return null;
  if (listStyle === "none") {
    return <ul className="resume-presentation-highlights resume-presentation-highlights-none">
      {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{h.value}</li>)}
    </ul>;
  }
  if (listStyle === "numbered") {
    return <ol className="resume-presentation-highlights">
      {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{h.value}</li>)}
    </ol>;
  }
  return <ul className="resume-presentation-highlights">
    {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{h.value}</li>)}
  </ul>;
}

function RenderMetaValues({ values }: { values: string[] }) {
  return <>{values.map((value, index) => <span key={value}>{index > 0 ? " · " : ""}{isUrl(value) ? <a href={value}>{value}</a> : value}</span>)}</>;
}

function RenderCustomRows({ rows, context }: { rows: ResumePresentationItem["customRows"]; context?: TemplateRenderContext }) {
  const normalRows = rows.filter((row) => row.displayMode !== "bullet");
  const bulletRows = rows.filter((row) => row.displayMode === "bullet");
  return <>
    {normalRows.length ? <div className="resume-presentation-custom-rows" data-pagination-unit="custom-rows">{normalRows.map((row) => (
      <p className={`resume-presentation-custom-${row.displayMode}`} key={`${row.label ?? ""}-${row.value}`}>
        {row.label ? <strong>{row.label}：</strong> : null}{row.value}
      </p>
    ))}</div> : null}
    {bulletRows.length ? <RenderHighlights highlights={bulletRows.map((row, index) => ({ value: row.label ? `${row.label}：${row.value}` : row.value, key: `custom-bullet:${index}` }))} context={context} /> : null}
  </>;
}

function presentationItemAttrs(item: ResumePresentationItem, context?: TemplateRenderContext, baseClassName?: string) {
  const selected = item.id === context?.selectedItemId;
  return {
    className: [baseClassName, selected ? "resume-template-item-selected" : ""].filter(Boolean).join(" ") || undefined,
    "data-source-item-id": item.id,
    "data-coverage-item-id": item.sourceItemId ?? item.id,
    "data-pagination-item-id": item.sourceItemId ?? item.id,
    "data-render-fragment-index": item.fragmentIndex ?? 0,
    "data-presentation-item": item.sectionType,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

function joinPresentationValues(values: Array<string | undefined>) {
  return values.filter((value): value is string => Boolean(value)).join(" · ");
}

function isUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function canonicalSectionTitleAttrs(section: ResumeRenderStructuredSectionV2, context?: TemplateRenderContext) {
  const fieldId = `section-title:${section.sectionId}`;
  const selected = fieldId === context?.selectedSectionTitleId;
  return {
    className: selected ? "resume-template-inline-selected" : undefined,
    "data-source-item-id": fieldId,
    "data-section-title-id": fieldId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

export function ResumeHeader({
  model,
  context,
  compact = false,
  plain = false
}: {
  model: ResumeRenderModel;
  context?: TemplateRenderContext;
  compact?: boolean;
  plain?: boolean;
}) {
  return (
    <header className={`resume-template-header ${compact ? "resume-template-header-compact" : ""} ${plain ? "resume-template-header-plain" : ""}`}>
      <div>
        <h1 {...profileFieldAttrs("profile:name", context)}>{model.candidate.name}</h1>
        {model.candidate.targetRole?.trim() ? <p {...profileFieldAttrs("branch:targetRole", context)}>{model.candidate.targetRole}</p> : null}
      </div>
      <address>
        {(() => {
          const emailCount = model.candidate.contacts.filter((c) => c.includes("@")).length;
          return model.candidate.contacts.map((contact, index) => (
            <span key={`${contact}-${index}`} {...profileFieldAttrs(profileFieldIdForContact(contact, index, emailCount), context)}>{contact}</span>
          ));
        })()}
      </address>
    </header>
  );
}

export function editableBlockAttrs(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  const selected = block.sourceItemId === context?.selectedItemId;
  return {
    "data-source-item-id": block.sourceItemId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

export function profileFieldAttrs(fieldId: string, context?: TemplateRenderContext) {
  const selected = fieldId === context?.selectedProfileFieldId;
  return {
    className: selected ? "resume-template-inline-selected" : undefined,
    "data-source-item-id": fieldId,
    "data-profile-field-id": fieldId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

export function sectionTitleAttrs(section: ResumeRenderSection, context?: TemplateRenderContext) {
  const fieldId = `section-title:${section.type}`;
  const selected = fieldId === context?.selectedSectionTitleId;
  return {
    className: selected ? "resume-template-inline-selected" : undefined,
    "data-source-item-id": fieldId,
    "data-section-title-id": fieldId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

export function profileFieldIdForContact(contact: string, index: number, contactCount: number) {
  if (contact.includes("@")) return contactCount <= 1 ? "profile:email" : `profile:email:link:${index}`;
  if (/[\d+\-()\s]{6,}/.test(contact)) return "profile:phone";
  if (/^https?:\/\//i.test(contact)) return `profile:link:${index}`;
  return "profile:location";
}

export function selectedClass(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  return block.sourceItemId === context?.selectedItemId ? "resume-template-item-selected" : "";
}
