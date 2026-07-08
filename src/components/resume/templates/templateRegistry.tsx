import type { CSSProperties, ReactNode } from "react";
import type {
  ResumePresentationConfig,
  ResumeRenderBlock,
  ResumeRenderModel,
  ResumeRenderSection,
  TemplateId
} from "@/domain/schemas";

export type ResumeTemplateStyleConfig = Pick<
  ResumePresentationConfig,
  "typography" | "spacing" | "theme" | "sectionStyleOverrides"
>;

export type TemplateCapabilities = {
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
    bodyTextScale: "normal",
    titleTextScale: "normal",
    lineHeight: "normal"
  },
  spacing: {
    sectionGap: "normal",
    itemGap: "normal"
  },
  theme: {
    accentColor: "emerald",
    density: "balanced"
  },
  sectionStyleOverrides: {}
};

const ALL_STYLE_CAPABILITIES: TemplateCapabilities = {
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
        bodyTextScale: "normal",
        titleTextScale: "small",
        lineHeight: "tight"
      },
      spacing: {
        sectionGap: "tight",
        itemGap: "tight"
      },
      theme: {
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
        bodyTextScale: "small",
        titleTextScale: "normal",
        lineHeight: "normal"
      },
      spacing: {
        sectionGap: "tight",
        itemGap: "normal"
      },
      theme: {
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
  const density = densityTokens(style.theme.density);
  const bodyTextScale = bodyTextScaleTokens(style.typography.bodyTextScale);
  const titleTextScale = titleTextScaleTokens(style.typography.titleTextScale);
  const spacing = spacingTokens(style.spacing);

  return {
    "--resume-body-font-size": bodyTextScale.fontSize,
    "--resume-line-height": lineHeightToken(style.typography.lineHeight),
    "--resume-section-title-size": titleTextScale.sectionTitleSize,
    "--resume-header-title-size": titleTextScale.headerTitleSize,
    "--resume-section-padding-top": spacing.sectionPaddingTop,
    "--resume-section-padding-bottom": spacing.sectionPaddingBottom,
    "--resume-item-gap": spacing.itemGap,
    "--resume-inline-gap-row": spacing.inlineGapRow,
    "--resume-inline-gap-column": spacing.inlineGapColumn,
    "--resume-page-padding-block": density.pagePaddingBlock,
    "--resume-page-padding-inline": density.pagePaddingInline,
    "--resume-modern-grid-gap": density.modernGridGap,
    "--resume-accent-color": accent.accent,
    "--resume-accent-strong": accent.strong,
    "--resume-accent-soft": accent.soft,
    "--resume-accent-border": accent.border,
    "--resume-bullet-color": accent.bullet
  } as CSSProperties;
}

function ClassicTechnicalTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
  return (
    <>
      {!context?.pagination?.isContinuation ? <ResumeHeader model={model} context={context} /> : null}
      {section(model, "summary", undefined, context)}
      {section(model, "skills", "inline", context)}
      {section(model, "experience", undefined, context)}
      {section(model, "certificates", "inline", context)}
    </>
  );
}

function ModernOperationsTemplate({ model, context }: { model: ResumeRenderModel; context?: TemplateRenderContext }) {
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
        <p>{model.company} / {model.jobTitle}</p>
      </div>
      <address>
        {model.candidate.contacts.map((contact, index) => (
          <span key={contact} {...profileFieldAttrs(profileFieldIdForContact(contact, index), context)}>{contact}</span>
        ))}
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
  context
}: {
  section: ResumeRenderSection;
  mode?: "inline" | "compact" | "tag" | "plain" | "plainInline" | "business";
  context?: TemplateRenderContext;
}) {
  const showTitle = context?.presentationConfig?.sectionStyleOverrides[section.type]?.showTitle !== false;
  const inlineMode = mode === "inline" || mode === "tag" || mode === "plainInline";
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
          {section.blocks.map((block) => (
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

function profileFieldIdForContact(contact: string, index: number) {
  if (contact.includes("@")) {
    return "profile:email";
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
