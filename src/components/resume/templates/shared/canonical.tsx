import { orderContactDetails } from "@/domain/resumePresentation/contacts";
import { FormattedText, fieldAppearanceFor } from "./FormattedText";
import { localResumePhoto } from "@/domain/schemas/resumePhoto";
import type { ResumePresentationItem, ResumeRenderBlock, ResumeRenderModel, ResumeRenderSection, ResumeRenderStructuredSectionV2 } from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { compactSkillCategory } from "@/domain/resumeComposition/ResumeSkillTaxonomy";
import type { TemplateRenderContext } from "../types";

export function orderCanonicalSections(
  sections: ResumeRenderStructuredSectionV2[],
  preferredTypes: ResumeSectionTypeV2[] = [...RESUME_SECTION_TYPES_V2],
  context?: TemplateRenderContext
) {
  if (hasUserSectionOrder(context)) return sections;
  const preferredOrder = new Map(preferredTypes.map((type, index) => [type, index]));
  return [...sections].sort((left, right) => {
    const leftRank = preferredOrder.get(left.sectionType) ?? preferredTypes.length;
    const rightRank = preferredOrder.get(right.sectionType) ?? preferredTypes.length;
    return leftRank - rightRank || left.order - right.order || left.sectionId.localeCompare(right.sectionId);
  });
}

export function hasUserSectionOrder(context?: TemplateRenderContext) {
  return Boolean(context?.presentationConfig?.canonicalSectionOrder?.length);
}

export function RenderCanonicalSections({
  sections,
  context,
  compact = false,
  groupedHeadingSectionIds = []
}: {
  sections: ResumeRenderStructuredSectionV2[];
  context?: TemplateRenderContext;
  compact?: boolean;
  groupedHeadingSectionIds?: readonly string[];
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
        {section.showTitle !== false && !groupedHeadingSectionIds.includes(section.sectionId) ? <h2 {...canonicalSectionTitleAttrs(section, context)}>{section.title}</h2> : null}
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
  const groups: Array<[string, ResumePresentationItem[]]> = [];
  for (const item of items) {
    const label = compactSkillCategory(item.groupLabel ?? "");
    const previous = groups.at(-1);
    if (previous?.[0] === label) previous[1].push(item);
    else groups.push([label, [item]]);
  }
  return <div className="resume-skill-groups">
    {groups.map(([label, groupItems], index) => (
      <div className={`resume-skill-group ${label ? "" : "resume-skill-group-uncategorized"}`} key={`${label || "uncategorized"}-${index}`}>
        {label ? <strong>{label}</strong> : null}
        <div className="resume-skill-values">
          {groupItems.map((item) => (
            <div {...presentationItemAttrs(item, context, "resume-skill-item")} data-pagination-unit="content" key={item.id}>
              <span className="resume-skill-heading">
                <strong className="resume-skill-name"><FormattedText text={item.primaryTitle ?? ""} itemId={item.sourceItemId ?? item.id} fields={["name", "language"]} context={context}/></strong>
                {item.secondaryTitle ? <span className="resume-skill-level">（<FormattedText text={item.secondaryTitle} itemId={item.sourceItemId ?? item.id} fields={["level"]} context={context}/>）</span> : null}
              </span>
              {item.description ? <span className="resume-skill-description"><FormattedText text={item.description} itemId={item.sourceItemId ?? item.id} fields={["description"]} context={context}/></span> : null}
              <RenderCustomRows rows={item.customRows} context={context} />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>;
}

function RenderLanguagePresentation({ items, context }: { items: ResumePresentationItem[]; context?: TemplateRenderContext }) {
  return <div className="resume-language-list">
    {items.map((item, index) => (
      <div {...presentationItemAttrs(item, context, "resume-language-row")} data-pagination-unit="content" key={item.id}>
        {index > 0 ? "，" : ""}{[item.primaryTitle, ...(item.secondaryTitle?.split(" · ") ?? []), item.description].filter(Boolean).map((text, at) => <FormattedText key={at} text={text!} itemId={item.sourceItemId ?? item.id} fields={["language", "level", "description", "testName", "score"]} context={context}/>)}
        <RenderCustomRows rows={item.customRows} />
      </div>
    ))}
  </div>;
}

function RenderPresentationItem({ item, context }: { item: ResumePresentationItem; context?: TemplateRenderContext }) {
  const format = (text: string, fields: string[]) => <FormattedText text={text} itemId={item.sourceItemId ?? item.id} fields={fields} context={context}/>;
  if (item.sectionType === "summary") {
    return <div {...presentationItemAttrs(item, context, "resume-presentation-summary")}><p data-pagination-unit="description">{format(item.description ?? "", ["text", "description"])}</p></div>;
  }
  if (item.sectionType === "languages") {
    return <div {...presentationItemAttrs(item, context, "resume-language-row")} data-pagination-unit="content">
      <strong><FormattedText text={item.primaryTitle ?? ""} itemId={item.sourceItemId ?? item.id} fields={["name", "language"]} context={context}/></strong>{item.secondaryTitle ? <><span aria-hidden="true">：</span><span>{item.secondaryTitle}</span></> : null}
      {item.description ? <span className="resume-language-description"> · <FormattedText text={item.description} itemId={item.sourceItemId ?? item.id} fields={["description"]} context={context}/></span> : null}
      <RenderCustomRows rows={item.customRows} />
    </div>;
  }
  const unlistedLinks = item.links.filter((link) => !item.inlineMeta.includes(link) && !item.secondaryMeta.includes(link));
  const placement = context?.presentationConfig?.departmentPlacement ?? "auto";
  const entryStyle = context?.presentationConfig?.precision?.entryStyle;
  const headerLocation = (entryStyle === "stacked" || entryStyle === "compact") && Boolean(item.primaryTitle || item.secondaryTitle || item.dateRange);
  const inlineDepartment = ["work", "internship", "campus", "volunteer"].includes(item.sectionType)
    && (placement === "inline" || placement === "auto" && context?.inlineDepartment);
  const secondaryTitle = inlineDepartment ? joinPresentationValues([...item.secondaryMeta, item.secondaryTitle]) : item.secondaryTitle;
  return (
    <article {...presentationItemAttrs(item, context, "resume-template-item resume-canonical-item")}>
      {(item.primaryTitle || item.secondaryTitle || item.dateRange) ? (
        <div className={`resume-presentation-heading resume-presentation-heading-${context?.presentationConfig?.itemHeaderMiddleAlignment ?? "balanced"}`} data-pagination-unit="heading">
          {item.primaryTitle ? <h3>{format(item.primaryTitle, item.sectionType === "education" ? ["school"] : ["work", "internship", "campus", "volunteer"].includes(item.sectionType) ? ["organization"] : ["title", "name", "institution"])}</h3> : <span />}
          {secondaryTitle && secondaryTitle !== item.primaryTitle ? <strong>{secondaryTitle.split(" · ").map((part, index) => <span key={`${index}-${part}`}>{index > 0 ? " · " : ""}<span>{format(part, ["role", "degree", "major", "department", "authorRole", "issuer", "level", "status", "type"])}</span></span>)}</strong> : null}
          {item.dateRange ? <time>{item.dateRange.split("–").map((part, index) => <span key={`${index}-${part}`}>{index > 0 ? "–" : ""}<span data-editor-date={index === 0 ? "start" : "end"}>{format(part, index === 0 ? ["startDate", "awardedAt", "issuedAt", "publishedAt", "createdAt", "filedAt"] : ["endDate", "expectedEndDate", "expiresAt", "grantedAt"])}</span></span>)}{entryStyle === "compact" && item.location ? <span className="resume-entry-inline-location"> · {format(item.location, ["location"])}</span> : null}</time> : null}
          {entryStyle === "compact" && item.location && !item.dateRange ? <span className="resume-entry-inline-location">{format(item.location, ["location"])}</span> : null}
          {entryStyle === "stacked" && item.location ? <span className="resume-entry-location">{format(item.location, ["location"])}</span> : null}
        </div>
      ) : null}
      {item.tertiaryTitle || item.location && !headerLocation ? <p className="resume-presentation-subtitle" data-pagination-unit="subtitle">{[headerLocation ? undefined : item.location, item.tertiaryTitle].filter(Boolean).map((value, index) => <span key={index}>{index ? " · " : ""}{format(value!, ["location", "department", "institution", "level", "publisher", "office"])}</span>)}</p> : null}
      {item.inlineMeta.length ? <p className="resume-presentation-meta" data-pagination-unit="inline-meta"><RenderMetaValues values={item.inlineMeta} context={context} itemId={item.sourceItemId ?? item.id} fields={["organization", "tools", "authors", "inventors"]} /></p> : null}
      {!inlineDepartment ? item.secondaryMeta.map((meta, index) => <p className="resume-presentation-secondary" data-pagination-unit={`secondary-meta:${index}`} key={meta}>{format(meta, ["department", "background"])}</p>) : null}
      {item.description ? <p className="resume-presentation-description" data-pagination-unit="description">{format(item.description, ["description", "background"])}</p> : null}
      {item.highlights.length ? <RenderHighlights highlights={item.highlights.map((highlight, index) => ({ value: highlight, key: `highlight:${index}` }))} itemId={item.sourceItemId ?? item.id} fields={["highlights", "outcomes", "honors", "methods"]} context={context} /> : null}
      {unlistedLinks.length ? <p className="resume-presentation-links" data-pagination-unit="links"><RenderMetaValues values={unlistedLinks} context={context} itemId={item.sourceItemId ?? item.id} fields={["url"]} /></p> : null}
      <RenderCustomRows rows={item.customRows} context={context} />
    </article>
  );
}

function RenderHighlights({ highlights: source, context, itemId, fields = [] }: { highlights: Array<{ value: string; key: string }>; context?: TemplateRenderContext; itemId?: string; fields?: string[] }) {
  const highlights = source.filter(h => !itemId || !fieldAppearanceFor(context, itemId, fields, h.value).some(entry => entry.hidden));
  const text = (value: string) => itemId ? <FormattedText text={value} itemId={itemId} fields={fields} context={context}/> : value;
  const bullet = context?.presentationConfig?.precision?.bulletStyle;
  const listStyle = bullet === "decimal" ? "numbered" : bullet === "none" ? "none" : bullet ? "bullet" : context?.presentationConfig?.highlightListStyle ?? "bullet";
  if (!highlights.length) return null;
  if (listStyle === "none") {
    return <ul className="resume-presentation-highlights resume-presentation-highlights-none">
      {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{text(h.value)}</li>)}
    </ul>;
  }
  if (listStyle === "numbered") {
    return <ol className="resume-presentation-highlights">
      {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{text(h.value)}</li>)}
    </ol>;
  }
  return <ul className="resume-presentation-highlights">
    {highlights.map((h) => <li data-pagination-unit={h.key} key={h.key}>{text(h.value)}</li>)}
  </ul>;
}

function RenderMetaValues({ values, context, itemId, fields = [] }: { values: string[]; context?: TemplateRenderContext; itemId?: string; fields?: string[] }) {
  const render = (value: string) => itemId ? <FormattedText text={value} itemId={itemId} fields={fields} context={context}/> : value;
  return <>{values.map((value, index) => <span key={value}>{index > 0 ? " · " : ""}{isUrl(value) ? <a href={value}>{render(value)}</a> : render(value)}</span>)}</>;
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
  plain = false,
  supportsPhoto = true
}: {
  model: ResumeRenderModel;
  context?: TemplateRenderContext;
  compact?: boolean;
  plain?: boolean;
  supportsPhoto?: boolean;
}) {
  const photo = supportsPhoto && context?.presentationConfig?.pagination.showPhoto ? localResumePhoto(model.candidate.photo) : undefined;
  // Standalone PDF HTML cannot use Next's client image component; uploads are already resized locally.
  // eslint-disable-next-line @next/next/no-img-element
  const photoElement = photo ? <img className="resume-candidate-photo" src={photo} alt="简历照片" width={84} height={112} onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : null;
  return (
    <header className={`resume-template-header ${photo ? "resume-template-header-with-photo" : ""} ${compact ? "resume-template-header-compact" : ""} ${plain ? "resume-template-header-plain" : ""}`}>
      {photoElement}
      <div>
        <h1 {...profileFieldAttrs("profile:name", context)}><FormattedText text={model.candidate.name} itemId="basics" fields={["name"]} context={context}/></h1>
        {model.candidate.targetRole?.trim() ? <p {...profileFieldAttrs("branch:targetRole", context)}><FormattedText text={model.candidate.targetRole} itemId="basics" fields={["headline", "targetRole"]} context={context}/></p> : null}
      </div>
      <address className="resume-personal-contacts">
        {orderContactDetails(model.candidate.contactDetails ?? model.candidate.contacts.map((value, index) => ({ id: `legacy:${index}`, label: value.includes("@") ? "邮箱" : /^https?:/.test(value) ? "个人网站" : /[0-9]{6}/.test(value) ? "手机号" : "地址", value })), context?.presentationConfig?.contactOrder).filter(detail => detail.value.trim() || detail.id.startsWith("break:")).map(detail => detail.id.startsWith("break:")
          ? <span key={detail.id} className="resume-contact-break" aria-hidden="true" />
          : <span key={detail.id} data-contact-id={detail.id} {...(detail.id.startsWith("custom:") ? {} : profileFieldAttrs(detail.id === "phone" ? "profile:phone" : detail.id === "email" ? "profile:email" : detail.id === "location" ? "profile:location" : "profile:link:0", context))}>
            {context?.presentationConfig?.precision?.contactIcons ? <span className="resume-contact-label">{detail.label}：</span> : null}<FormattedText text={detail.value} itemId="basics" fields={["email", "phone", "address", "location", "linkedin", "homepage"]} context={context}/>
          </span>)}
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
