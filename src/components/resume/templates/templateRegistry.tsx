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

export type ResumeTemplateStyleCapabilities = {
  density: boolean;
  bodyTextScale: boolean;
  titleTextScale: boolean;
  lineHeight: boolean;
  sectionGap: boolean;
  itemGap: boolean;
  accentColor: boolean;
  sectionTitleVisibility: boolean;
};

export type TemplateDefinition = {
  id: TemplateId;
  name: string;
  audience: string;
  className: string;
  defaultStyleConfig: ResumeTemplateStyleConfig;
  styleCapabilities: ResumeTemplateStyleCapabilities;
  render: (model: ResumeRenderModel, context?: TemplateRenderContext) => ReactNode;
};

export type TemplateRenderContext = {
  selectedItemId?: string;
  presentationConfig?: ResumePresentationConfig;
};

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

const ALL_STYLE_CAPABILITIES: ResumeTemplateStyleCapabilities = {
  density: true,
  bodyTextScale: true,
  titleTextScale: true,
  lineHeight: true,
  sectionGap: true,
  itemGap: true,
  accentColor: true,
  sectionTitleVisibility: true
};

export const resumeTemplates: TemplateDefinition[] = [
  {
    id: "classic-technical",
    name: "模板A 稳重清晰",
    audience: "数据 / 技术 / 研究",
    className: "template-classic-technical",
    defaultStyleConfig: DEFAULT_STYLE_CONFIG,
    styleCapabilities: ALL_STYLE_CAPABILITIES,
    render: (model, context) => <ClassicTechnicalTemplate model={model} context={context} />
  },
  {
    id: "modern-operations",
    name: "模板B 简洁现代",
    audience: "运营 / 产品 / 综合",
    className: "template-modern-operations",
    defaultStyleConfig: {
      ...DEFAULT_STYLE_CONFIG,
      typography: {
        ...DEFAULT_STYLE_CONFIG.typography,
        bodyTextScale: "small"
      }
    },
    styleCapabilities: ALL_STYLE_CAPABILITIES,
    render: (model, context) => <ModernOperationsTemplate model={model} context={context} />
  }
];

export function getResumeTemplate(templateId: TemplateId) {
  return resumeTemplates.find((template) => template.id === templateId) ?? resumeTemplates[0];
}

export function getTemplateDefaultStyleConfig(templateId: TemplateId): ResumeTemplateStyleConfig {
  return cloneTemplateStyleConfig(getResumeTemplate(templateId).defaultStyleConfig);
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
    return cloneTemplateStyleConfig(template.defaultStyleConfig);
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
      <ResumeHeader model={model} />
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
      <ResumeHeader model={model} compact />
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

function ResumeHeader({ model, compact = false }: { model: ResumeRenderModel; compact?: boolean }) {
  return (
    <header className={`resume-template-header ${compact ? "resume-template-header-compact" : ""}`}>
      <div>
        <h1>{model.candidate.name}</h1>
        <p>{model.company} / {model.jobTitle}</p>
      </div>
      <address>
        {model.candidate.contacts.map((contact) => (
          <span key={contact}>{contact}</span>
        ))}
      </address>
    </header>
  );
}

function section(model: ResumeRenderModel, type: ResumeRenderSection["type"], mode?: "inline" | "compact" | "tag", context?: TemplateRenderContext) {
  const found = findSection(model, type);
  return found ? <RenderSection section={found} mode={mode} context={context} /> : null;
}

function findSection(model: ResumeRenderModel, type: ResumeRenderSection["type"]) {
  return model.sections.find((candidate) => candidate.type === type);
}

function RenderSection({ section, mode, context }: { section: ResumeRenderSection; mode?: "inline" | "compact" | "tag"; context?: TemplateRenderContext }) {
  const showTitle = context?.presentationConfig?.sectionStyleOverrides[section.type]?.showTitle !== false;
  return (
    <section className={`resume-template-section ${mode ? `resume-section-${mode}` : ""}`} data-render-section={section.type}>
      {showTitle ? <h2>{section.title}</h2> : null}
      {mode === "inline" || mode === "tag" ? (
        <div className={mode === "tag" ? "resume-tag-list" : "resume-inline-list"}>
          {section.blocks.map((block) => (
            <span key={block.sourceItemId} className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</span>
          ))}
        </div>
      ) : (
        <div className="resume-block-list">
          {section.blocks.map((block) => <RenderBlock key={block.sourceItemId} block={block} compact={mode === "compact"} context={context} />)}
        </div>
      )}
    </section>
  );
}

function RenderBlock({ block, compact, context }: { block: ResumeRenderBlock; compact?: boolean; context?: TemplateRenderContext }) {
  if (compact || block.itemType === "summary") {
    return <p className={selectedClass(block, context)} {...editableBlockAttrs(block, context)}>{block.text}</p>;
  }

  return (
    <div className={`resume-template-item ${selectedClass(block, context)}`} {...editableBlockAttrs(block, context)}>
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
