import type { CSSProperties, ReactNode } from "react";
import type {
  ResumePresentationConfig,
  ResumePresentationItem,
  ResumeRenderBlock,
  ResumeRenderModel,
  ResumeRenderSection,
  ResumeRenderStructuredSectionV2,
  TemplateId
} from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2, type CanonicalFieldId, type ResumeSectionTypeV2 } from "@/domain/resumeFields";

export type ResumeTemplateStyleConfig = Pick<
  ResumePresentationConfig,
  "typography" | "spacing" | "theme" | "sectionStyleOverrides"
>;

export type TemplateCapabilities = {
  supportedSections: ResumeSectionTypeV2[];
  supportedFields: CanonicalFieldId[] | "*";
  supportsPhoto: boolean;
  supportsCustomSections: boolean;
  fallbackBehavior: {
    unsupportedField: "render_plain" | "preserve_with_warning";
    unsupportedSection: "render_under_other" | "preserve_with_warning";
  };
  supportsAccentColor: boolean;
  supportsDensity: boolean;
  supportsBodyScale: boolean;
  supportsHeadingScale: boolean;
  supportsLineHeight: boolean;
  supportsSectionGap: boolean;
  supportsItemGap: boolean;
  supportsSectionTitleVisibility: boolean;
  supportsTwoPages: boolean;
  supportsSectionPageBreaks: boolean;
  supportsContinuationHeader: boolean;
};

export type TemplateRenderContext = {
  selectedItemId?: string;
  selectedProfileFieldId?: string;
  selectedSectionTitleId?: string;
  presentationConfig?: ResumePresentationConfig;
  thumbnail?: boolean;
  pagination?: {
    pageNumber: number;
    pageCount: number;
    isContinuation: boolean;
  };
};

export type TemplateRenderer = (model: ResumeRenderModel, context?: TemplateRenderContext) => ReactNode;
export type TemplateThumbnailRenderer = TemplateRenderer;

export type ResumeTemplateDefinition = {
  id: TemplateId;
  name: string;
  shortName: string;
  description: string;
  category: "ats" | "technical" | "business" | "modern";
  layout: "single-column" | "two-column";
  atsLevel: "high" | "medium" | "visual";
  suitableRoles: string[];
  tags: string[];
  capabilities: TemplateCapabilities;
  defaultPresentationStyle: ResumeTemplateStyleConfig;
  version: number;
  status: "active" | "experimental";
  className: string;
  render: TemplateRenderer;
  renderThumbnail: TemplateThumbnailRenderer;
};

export type TemplateDefinition = ResumeTemplateDefinition;
export type TemplateFilterKey = "all" | "ats" | "single-column" | "two-column" | "technical" | "business";

export const templateFilterOptions: Array<{ key: TemplateFilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "ats", label: "ATS优先" },
  { key: "single-column", label: "单栏" },
  { key: "two-column", label: "双栏" },
  { key: "technical", label: "技术简洁" },
  { key: "business", label: "商务正式" }
];

const DEFAULT_STYLE_CONFIG: ResumeTemplateStyleConfig = {
  typography: {
    chineseFont: "system_sans",
    englishFont: "system_sans",
    bodyTextScale: "normal",
    titleTextScale: "normal",
    lineHeight: "normal"
  },
  spacing: {
    pageMargin: "normal",
    sectionGap: "normal",
    itemGap: "normal"
  },
  theme: {
    primaryColor: "emerald",
    accentColor: "emerald",
    dividerColor: "graphite",
    density: "balanced"
  },
  sectionStyleOverrides: {}
};

const ALL_STYLE_CAPABILITIES: TemplateCapabilities = {
  supportedSections: [...RESUME_SECTION_TYPES_V2],
  supportedFields: "*",
  supportsPhoto: false,
  supportsCustomSections: true,
  fallbackBehavior: {
    unsupportedField: "render_plain",
    unsupportedSection: "render_under_other"
  },
  supportsAccentColor: true,
  supportsDensity: true,
  supportsBodyScale: true,
  supportsHeadingScale: true,
  supportsLineHeight: true,
  supportsSectionGap: true,
  supportsItemGap: true,
  supportsSectionTitleVisibility: true,
  supportsTwoPages: true,
  supportsSectionPageBreaks: true,
  supportsContinuationHeader: false
};

export function assessTemplateCompatibility(model: ResumeRenderModel, template: ResumeTemplateDefinition) {
  if (model.schemaVersion !== "resume-render-v2") return [];
  const supportedSections = new Set(template.capabilities.supportedSections);
  const warnings: string[] = [];
  for (const section of model.structuredSections) {
    if (!supportedSections.has(section.sectionType)) warnings.push(`模板不直接支持栏目“${section.title}”，将按 ${template.capabilities.fallbackBehavior.unsupportedSection} 保留。`);
  }
  if (model.candidate.contacts.length > 0 && !template.capabilities.supportsPhoto) {
    // Photo is not represented in the v1-compatible candidate yet; capability is still declared explicitly.
  }
  return warnings;
}

export const resumeTemplates: ResumeTemplateDefinition[] = [
  {
    id: "classic-technical",
    name: "稳重技术",
    shortName: "技术",
    description: "稳重单栏结构，优先突出项目、技能和可验证成果。",
    category: "technical",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["技术", "数据", "研究", "产品"],
    tags: ["技术简洁", "项目经历", "单栏"],
    capabilities: ALL_STYLE_CAPABILITIES,
    defaultPresentationStyle: DEFAULT_STYLE_CONFIG,
    version: 1,
    status: "active",
    className: "template-classic-technical",
    render: (model, context) => <ClassicTechnicalTemplate model={model} context={context} />,
    renderThumbnail: (model, context) => <ClassicTechnicalTemplate model={model} context={{ ...context, thumbnail: true }} />
  },
  {
    id: "modern-operations",
    name: "简洁现代",
    shortName: "现代",
    description: "轻双栏布局，适合展示综合能力、运营成果和协作经历。",
    category: "modern",
    layout: "two-column",
    atsLevel: "medium",
    suitableRoles: ["运营", "产品", "项目管理", "综合岗位"],
    tags: ["现代", "双栏", "运营产品"],
    capabilities: ALL_STYLE_CAPABILITIES,
    defaultPresentationStyle: {
      ...DEFAULT_STYLE_CONFIG,
      typography: {
        ...DEFAULT_STYLE_CONFIG.typography,
        bodyTextScale: "small"
      }
    },
    version: 1,
    status: "active",
    className: "template-modern-operations",
    render: (model, context) => <ModernOperationsTemplate model={model} context={context} />,
    renderThumbnail: (model, context) => <ModernOperationsTemplate model={model} context={{ ...context, thumbnail: true }} />
  },
  {
    id: "ats-minimal",
    name: "ATS极简单栏",
    shortName: "ATS",
    description: "黑白文本优先的单栏模板，减少装饰和复杂结构，便于人工与系统读取。",
    category: "ats",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["技术", "运营", "产品", "数据", "校招", "通用岗位"],
    tags: ["ATS优先", "单栏", "黑白", "通用"],
    capabilities: ALL_STYLE_CAPABILITIES,
    defaultPresentationStyle: {
      ...DEFAULT_STYLE_CONFIG,
      typography: {
        ...DEFAULT_STYLE_CONFIG.typography,
        bodyTextScale: "normal",
        titleTextScale: "small",
        lineHeight: "tight"
      },
      spacing: {
        ...DEFAULT_STYLE_CONFIG.spacing,
        sectionGap: "tight",
        itemGap: "tight"
      },
      theme: {
        ...DEFAULT_STYLE_CONFIG.theme,
        primaryColor: "graphite",
        accentColor: "graphite",
        density: "compact"
      }
    },
    version: 1,
    status: "active",
    className: "template-ats-minimal",
    render: (model, context) => <AtsMinimalTemplate model={model} context={context} />,
    renderThumbnail: (model, context) => <AtsMinimalTemplate model={model} context={{ ...context, thumbnail: true }} />
  },
  {
    id: "business-consulting",
    name: "商务咨询正式",
    shortName: "商务",
    description: "高信息密度的正式双栏模板，强调教育、量化成果和商业表达。",
    category: "business",
    layout: "two-column",
    atsLevel: "medium",
    suitableRoles: ["经济", "金融", "咨询", "外贸", "供应链", "商务", "管理"],
    tags: ["商务正式", "咨询", "金融", "双栏"],
    capabilities: ALL_STYLE_CAPABILITIES,
    defaultPresentationStyle: {
      ...DEFAULT_STYLE_CONFIG,
      typography: {
        ...DEFAULT_STYLE_CONFIG.typography,
        bodyTextScale: "small",
        titleTextScale: "normal",
        lineHeight: "normal"
      },
      spacing: {
        ...DEFAULT_STYLE_CONFIG.spacing,
        sectionGap: "tight",
        itemGap: "normal"
      },
      theme: {
        ...DEFAULT_STYLE_CONFIG.theme,
        primaryColor: "blue",
        accentColor: "blue",
        density: "compact"
      }
    },
    version: 1,
    status: "active",
    className: "template-business-consulting",
    render: (model, context) => <BusinessConsultingTemplate model={model} context={context} />,
    renderThumbnail: (model, context) => <BusinessConsultingTemplate model={model} context={{ ...context, thumbnail: true }} />
  }
];

export function getResumeTemplate(templateId: TemplateId) {
  return resumeTemplates.find((template) => template.id === templateId) ?? resumeTemplates[0];
}

export function isResumeTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && resumeTemplates.some((template) => template.id === value);
}

export function filterResumeTemplates(
  filter: TemplateFilterKey,
  templates: ResumeTemplateDefinition[] = resumeTemplates
) {
  if (filter === "ats") {
    return templates.filter((template) => template.atsLevel === "high");
  }
  if (filter === "single-column" || filter === "two-column") {
    return templates.filter((template) => template.layout === filter);
  }
  if (filter === "technical") {
    return templates.filter((template) =>
      template.category === "technical"
      || template.tags.some((tag) => tag.includes("技术"))
      || template.suitableRoles.some((role) => role.includes("技术"))
    );
  }
  if (filter === "business") {
    return templates.filter((template) => template.category === "business");
  }
  return templates;
}

export function getTemplateDefaultStyleConfig(templateId: TemplateId): ResumeTemplateStyleConfig {
  return cloneTemplateStyleConfig(getResumeTemplate(templateId).defaultPresentationStyle);
}

export function cloneTemplateStyleConfig(style: ResumeTemplateStyleConfig): ResumeTemplateStyleConfig {
  return {
    typography: { ...style.typography },
    spacing: { ...style.spacing },
    theme: { ...style.theme },
    sectionStyleOverrides: { ...style.sectionStyleOverrides }
  };
}

export function resolveTemplateStyleConfig(
  template: TemplateDefinition,
  presentationConfig?: ResumePresentationConfig
): ResumeTemplateStyleConfig {
  if (!presentationConfig) {
    return cloneTemplateStyleConfig(template.defaultPresentationStyle);
  }
  return {
    typography: presentationConfig.typography,
    spacing: presentationConfig.spacing,
    theme: presentationConfig.theme,
    sectionStyleOverrides: presentationConfig.sectionStyleOverrides
  };
}

export function resumeTemplateStyleVars(
  template: TemplateDefinition,
  presentationConfig?: ResumePresentationConfig
): CSSProperties {
  const style = resolveTemplateStyleConfig(template, presentationConfig);
  const accent = accentColorTokens(style.theme.accentColor);
  const primary = accentColorTokens(style.theme.primaryColor);
  const divider = accentColorTokens(style.theme.dividerColor);
  const density = densityTokens(style.theme.density);
  const pageMargin = pageMarginTokens(style.spacing.pageMargin);
  const bodyTextScale = bodyTextScaleTokens(style.typography.bodyTextScale);
  const titleTextScale = titleTextScaleTokens(style.typography.titleTextScale);
  const spacing = spacingTokens(style.spacing);

  return {
    "--resume-font-family": fontFamilyToken(style.typography.chineseFont, style.typography.englishFont),
    "--resume-body-font-size": bodyTextScale.fontSize,
    "--resume-line-height": lineHeightToken(style.typography.lineHeight),
    "--resume-section-title-size": titleTextScale.sectionTitleSize,
    "--resume-header-title-size": titleTextScale.headerTitleSize,
    "--resume-section-padding-top": spacing.sectionPaddingTop,
    "--resume-section-padding-bottom": spacing.sectionPaddingBottom,
    "--resume-item-gap": spacing.itemGap,
    "--resume-inline-gap-row": spacing.inlineGapRow,
    "--resume-inline-gap-column": spacing.inlineGapColumn,
    "--resume-page-padding-block": pageMargin.pagePaddingBlock,
    "--resume-page-padding-inline": pageMargin.pagePaddingInline,
    "--resume-modern-grid-gap": density.modernGridGap,
    "--resume-accent-color": accent.accent,
    "--resume-accent-strong": accent.strong,
    "--resume-accent-soft": accent.soft,
    "--resume-accent-border": accent.border,
    "--resume-bullet-color": accent.bullet,
    "--resume-primary-color": primary.accent,
    "--resume-primary-strong": primary.strong,
    "--resume-divider-color": divider.border
  } as CSSProperties;
}

function ClassicTechnicalTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    return <>{!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}<RenderCanonicalSections sections={model.structuredSections} context={context} /></>;
  }
  const experience = findSection(model, "experience");
  const beforeSkillsSectionIds = ["experience", "education", "projects", "campus", "awards"];
  const experienceBeforeSkills = experience ? {
    ...experience,
    blocks: experience.blocks.filter((block) => beforeSkillsSectionIds.includes(block.sourceSectionId ?? ""))
  } : undefined;
  const experienceAfterSkills = experience ? {
    ...experience,
    blocks: experience.blocks.filter((block) => !beforeSkillsSectionIds.includes(block.sourceSectionId ?? ""))
  } : undefined;
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      {section(model, "summary", undefined, context)}
      {experienceBeforeSkills?.blocks.length ? <RenderSection section={experienceBeforeSkills} context={context} /> : null}
      {section(model, "skills", "inline", context)}
      {section(model, "certificates", "inline", context)}
      {experienceAfterSkills?.blocks.length ? (
        <RenderSection
          section={experienceAfterSkills}
          context={context}
          showSectionTitle={experienceBeforeSkills?.blocks.length ? false : undefined}
        />
      ) : null}
    </>
  );
}

function ModernOperationsTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    const sidebarTypes = new Set<ResumeSectionTypeV2>(["summary", "skills", "certificates", "languages"]);
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} compact context={context} /> : null}
      <div className="resume-modern-grid">
        <aside><RenderCanonicalSections sections={model.structuredSections.filter((section) => sidebarTypes.has(section.sectionType))} context={context} /></aside>
        <div><RenderCanonicalSections sections={model.structuredSections.filter((section) => !sidebarTypes.has(section.sectionType))} context={context} /></div>
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
        <div>
          {experiences ? <RenderSection section={experiences} context={context} /> : null}
        </div>
      </div>
    </>
  );
}

function AtsMinimalTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
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
}

function BusinessConsultingTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  if (model.schemaVersion === "resume-render-v2" && model.structuredSections.length > 0) {
    const sidebarTypes = new Set<ResumeSectionTypeV2>(["skills", "certificates", "languages", "awards"]);
    return <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} compact context={context} /> : null}
      <div className="resume-business-grid">
        <div><RenderCanonicalSections sections={model.structuredSections.filter((section) => !sidebarTypes.has(section.sectionType))} context={context} /></div>
        <aside><RenderCanonicalSections sections={model.structuredSections.filter((section) => sidebarTypes.has(section.sectionType))} context={context} compact /></aside>
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
      <div className="resume-business-grid">
        <div>
          {summary ? <RenderSection section={summary} mode="compact" context={context} /> : null}
          {experiences ? <RenderSection section={experiences} mode="business" context={context} /> : null}
        </div>
        <aside>
          {skills ? <RenderSection section={skills} mode="plainInline" context={context} /> : null}
          {certificates ? <RenderSection section={certificates} mode="compact" context={context} /> : null}
        </aside>
      </div>
    </>
  );
}

function RenderCanonicalSections({
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
      <section className={`resume-template-section resume-canonical-section ${compact ? "resume-section-compact" : ""}`} data-render-section={section.sectionType} data-render-section-id={section.sectionId} data-render-section-primary={section.showTitle === false ? "false" : "true"} key={section.sectionId}>
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
    const label = item.groupLabel ?? "";
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return <div className="resume-skill-groups">
    {[...groups.entries()].map(([label, groupItems]) => (
      <div className="resume-skill-group" key={label || "uncategorized"}>
        {label ? <strong>{label}</strong> : null}
        <div className="resume-skill-values">
          {groupItems.map((item, index) => (
            <div {...presentationItemAttrs(item, context, "resume-skill-item")} data-pagination-unit="content" key={`${item.id}-${index}`}>
              <strong className="resume-skill-name">{item.primaryTitle}</strong>
              {item.secondaryTitle ? <span className="resume-skill-level">（{item.secondaryTitle}）</span> : null}
              {item.description ? <span className="resume-skill-description">{item.description}</span> : null}
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

function ResumeHeader({
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
        {model.candidate.targetRole?.trim() ? (
          <p {...profileFieldAttrs("branch:targetRole", context)}>{model.candidate.targetRole}</p>
        ) : null}
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

function section(
  model: ResumeRenderModel,
  type: ResumeRenderSection["type"],
  mode?: "inline" | "compact" | "tag" | "plain" | "plainInline" | "business",
  context?: TemplateRenderContext
) {
  const found = findSection(model, type);
  return found ? <RenderSection section={found} mode={mode} context={context} /> : null;
}

function findSection(model: ResumeRenderModel, type: ResumeRenderSection["type"]) {
  return model.sections.find((candidate) => candidate.type === type);
}

function RenderSection({
  section,
  mode,
  context,
  showSectionTitle
}: {
  section: ResumeRenderSection;
  mode?: "inline" | "compact" | "tag" | "plain" | "plainInline" | "business";
  context?: TemplateRenderContext;
  showSectionTitle?: boolean;
}) {
  const showTitle = (showSectionTitle ?? true)
    && context?.presentationConfig?.sectionStyleOverrides[section.type]?.showTitle !== false;
  const inlineMode = mode === "inline" || mode === "tag" || mode === "plainInline";
  const experienceGroups = section.type === "experience" ? groupExperienceBlocks(section.blocks) : [];
  return (
    <section className={`resume-template-section ${mode ? `resume-section-${mode}` : ""}`} data-render-section={section.type}>
      {showTitle ? <h2 {...sectionTitleAttrs(section, context)}>{section.title}</h2> : null}
      {inlineMode ? (
        <div className={mode === "tag" ? "resume-tag-list" : "resume-inline-list"}>
          {section.blocks.map((block) => (
            <span key={block.sourceItemId} className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</span>
          ))}
        </div>
      ) : (
        <div className="resume-block-list">
          {experienceGroups.length > 0 ? experienceGroups.map((group) => (
            <div className="resume-experience-group" key={group.key} data-resume-experience-group={group.key}>
              <h3 className="resume-experience-group-title">{group.label}</h3>
              {group.blocks.map((block) => (
                <RenderBlock
                  key={block.sourceItemId}
                  block={block}
                  compact={mode === "compact" || mode === "plain"}
                  business={mode === "business"}
                  context={context}
                />
              ))}
            </div>
          )) : section.blocks.map((block) => (
            <RenderBlock
              key={block.sourceItemId}
              block={block}
              compact={mode === "compact" || mode === "plain"}
              business={mode === "business"}
              context={context}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function groupExperienceBlocks(blocks: ResumeRenderBlock[]) {
  type GroupKey = "work" | "internship" | "education" | "project" | "campus" | "awards" | "languages" | "custom";
  const order: GroupKey[] = ["education", "work", "internship", "project", "campus", "awards", "languages", "custom"];
  const labels: Record<GroupKey, string> = {
    work: "工作经历",
    internship: "实习经历",
    education: "教育经历",
    project: "项目经历",
    campus: "校园经历",
    awards: "奖项",
    languages: "语言",
    custom: "其他内容"
  };
  const grouped = new Map<GroupKey, ResumeRenderBlock[]>();
  for (const block of blocks) {
    const aliases: Record<string, GroupKey> = { experience: "work", projects: "project", language: "languages" };
    const normalized = block.sourceSectionId ? aliases[block.sourceSectionId] ?? block.sourceSectionId : "";
    const key = order.includes(normalized as GroupKey)
      ? normalized as GroupKey
      : block.itemType === "experience" ? "work" : "custom";
    grouped.set(key, [...(grouped.get(key) ?? []), block]);
  }
  return order.flatMap((key) => {
    const groupBlocks = grouped.get(key);
    return groupBlocks?.length ? [{ key, label: labels[key], blocks: groupBlocks }] : [];
  });
}

function RenderBlock({
  block,
  compact,
  business,
  context
}: {
  block: ResumeRenderBlock;
  compact?: boolean;
  business?: boolean;
  context?: TemplateRenderContext;
}) {
  if (compact || block.itemType === "summary") {
    return <p className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</p>;
  }

  return (
    <div className={`resume-template-item ${business ? "resume-template-item-business" : ""} ${selectedClass(block, context)}`} {...editableBlockAttrs(block, context)}>
      <p>{block.text}</p>
    </div>
  );
}

function editableBlockAttrs(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  const selected = block.sourceItemId === context?.selectedItemId;
  return {
    "data-source-item-id": block.sourceItemId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

function profileFieldAttrs(fieldId: string, context?: TemplateRenderContext) {
  const selected = fieldId === context?.selectedProfileFieldId;
  return {
    className: selected ? "resume-template-inline-selected" : undefined,
    "data-source-item-id": fieldId,
    "data-profile-field-id": fieldId,
    "data-editable-block": "true",
    "data-selected": selected ? "true" : "false"
  };
}

function sectionTitleAttrs(section: ResumeRenderSection, context?: TemplateRenderContext) {
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

function profileFieldIdForContact(contact: string, index: number, contactCount: number) {
  if (contact.includes("@")) {
    return contactCount <= 1 ? "profile:email" : `profile:email:link:${index}`;
  }
  if (/[\d+\-()\s]{6,}/.test(contact)) {
    return "profile:phone";
  }
  if (/^https?:\/\//i.test(contact)) {
    return `profile:link:${index}`;
  }
  return "profile:location";
}

function selectedClass(block: ResumeRenderBlock, context?: TemplateRenderContext) {
  return block.sourceItemId === context?.selectedItemId ? "resume-template-item-selected" : "";
}

function accentColorTokens(color: ResumePresentationConfig["theme"]["accentColor"]) {
  if (color === "graphite") {
    return {
      accent: "#202522",
      strong: "#111",
      soft: "#f0f2f0",
      border: "#c9cec8",
      bullet: "#202522"
    };
  }
  if (color === "blue") {
    return {
      accent: "#1d4f91",
      strong: "#143866",
      soft: "#edf4ff",
      border: "#bfd2ef",
      bullet: "#1d4f91"
    };
  }
  if (color === "rose") {
    return {
      accent: "#9d3151",
      strong: "#74213a",
      soft: "#fff0f4",
      border: "#efc1ce",
      bullet: "#9d3151"
    };
  }
  return {
    accent: "#0f5145",
    strong: "#176b5b",
    soft: "#eef6f3",
    border: "#c7ddd5",
    bullet: "#176b5b"
  };
}

function densityTokens(density: ResumePresentationConfig["theme"]["density"]) {
  if (density === "compact") {
    return {
      pagePaddingBlock: "10mm",
      pagePaddingInline: "12mm",
      modernGridGap: "6mm"
    };
  }
  if (density === "spacious") {
    return {
      pagePaddingBlock: "14mm",
      pagePaddingInline: "16mm",
      modernGridGap: "10mm"
    };
  }
  return {
    pagePaddingBlock: "12mm",
    pagePaddingInline: "14mm",
    modernGridGap: "8mm"
  };
}

function pageMarginTokens(pageMargin: ResumePresentationConfig["spacing"]["pageMargin"]) {
  if (pageMargin === "narrow") {
    return { pagePaddingBlock: "10mm", pagePaddingInline: "12mm" };
  }
  if (pageMargin === "wide") {
    return { pagePaddingBlock: "16mm", pagePaddingInline: "18mm" };
  }
  return { pagePaddingBlock: "12mm", pagePaddingInline: "14mm" };
}

function fontFamilyToken(
  chineseFont: ResumePresentationConfig["typography"]["chineseFont"],
  englishFont: ResumePresentationConfig["typography"]["englishFont"]
) {
  const chinese = chineseFont === "source_han_serif"
    ? '"Source Han Serif SC", "Noto Serif CJK SC", SimSun'
    : chineseFont === "source_han_sans"
      ? '"Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei"'
      : '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC"';
  const english = englishFont === "georgia"
    ? "Georgia"
    : englishFont === "arial"
      ? "Arial"
      : '"Segoe UI", Arial';
  return `${chinese}, ${english}, sans-serif`;
}

function bodyTextScaleTokens(scale: ResumePresentationConfig["typography"]["bodyTextScale"]) {
  if (scale === "small") {
    return { fontSize: "8.8pt" };
  }
  if (scale === "large") {
    return { fontSize: "9.9pt" };
  }
  return { fontSize: "9.3pt" };
}

function titleTextScaleTokens(scale: ResumePresentationConfig["typography"]["titleTextScale"]) {
  if (scale === "small") {
    return {
      sectionTitleSize: "10.4pt",
      headerTitleSize: "20pt"
    };
  }
  if (scale === "large") {
    return {
      sectionTitleSize: "12pt",
      headerTitleSize: "22pt"
    };
  }
  return {
    sectionTitleSize: "11.2pt",
    headerTitleSize: "21pt"
  };
}

function lineHeightToken(lineHeight: ResumePresentationConfig["typography"]["lineHeight"]) {
  if (lineHeight === "tight") {
    return 1.34;
  }
  if (lineHeight === "relaxed") {
    return 1.62;
  }
  return 1.48;
}

function spacingTokens(spacing: ResumePresentationConfig["spacing"]) {
  const section = spacing.sectionGap === "tight"
    ? { top: "3.8mm", bottom: "2.8mm" }
    : spacing.sectionGap === "relaxed"
      ? { top: "6mm", bottom: "4.8mm" }
      : { top: "5mm", bottom: "3.8mm" };
  const item = spacing.itemGap === "tight"
    ? { gap: "2mm", row: "1.5mm", column: "3mm" }
    : spacing.itemGap === "relaxed"
      ? { gap: "4mm", row: "2.8mm", column: "5mm" }
      : { gap: "3mm", row: "2mm", column: "4mm" };

  return {
    sectionPaddingTop: section.top,
    sectionPaddingBottom: section.bottom,
    itemGap: item.gap,
    inlineGapRow: item.row,
    inlineGapColumn: item.column
  };
}
