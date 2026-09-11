import type { ResumeRenderModel, TemplateId } from "@/domain/schemas";
import { RESUME_SECTION_TYPES_V2 } from "@/domain/resumeFields";
import { renderAtsMinimal } from "./atsMinimal";
import { renderBusinessConsulting } from "./businessConsulting";
import { renderCampusClean } from "./campusClean";
import { renderClassicTechnical } from "./classicTechnical";
import { renderModernOperations } from "./modernOperations";
import { renderProfessionalClassic } from "./professionalClassic";
import {
  DEFAULT_TEMPLATE_STYLE_CONFIG,
  getTemplateDefaultStyleConfig as getDefaultStyleForTemplate
} from "./presentationStyles";
import type {
  ResumeTemplateDefinition,
  ResumeTemplateStyleConfig,
  TemplateCapabilities,
  TemplateFilterKey,
  TemplateRenderer
} from "./types";

export type {
  ResumeTemplateDefinition,
  ResumeTemplateStyleConfig,
  TemplateCapabilities,
  TemplateDefinition,
  TemplateFilterKey,
  TemplateRenderContext,
  TemplateRenderer,
  TemplateThumbnailRenderer
} from "./types";
export {
  cloneTemplateStyleConfig,
  DEFAULT_TEMPLATE_STYLE_CONFIG,
  resolveTemplateStyleConfig,
  resolveTemplateSwitchStyle,
  resumeTemplateStyleVars
} from "./presentationStyles";

export const templateFilterOptions: Array<{ key: TemplateFilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "ats", label: "ATS优先" },
  { key: "single-column", label: "单栏" },
  { key: "two-column", label: "双栏" },
  { key: "technical", label: "技术简洁" },
  { key: "business", label: "商务正式" },
  { key: "campus", label: "校园 / 应届" }
];

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

const CAMPUS_STYLE: ResumeTemplateStyleConfig = {
  ...DEFAULT_TEMPLATE_STYLE_CONFIG,
  spacing: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.spacing, itemGap: "normal" },
  theme: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.theme, primaryColor: "blue", accentColor: "blue", density: "balanced" }
};

const PROFESSIONAL_STYLE: ResumeTemplateStyleConfig = {
  ...DEFAULT_TEMPLATE_STYLE_CONFIG,
  typography: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.typography, englishFont: "arial" },
  theme: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.theme, primaryColor: "graphite", accentColor: "graphite", density: "balanced" }
};

function definition(input: {
  id: TemplateId;
  name: string;
  shortName: string;
  description: string;
  category: ResumeTemplateDefinition["category"];
  layout: ResumeTemplateDefinition["layout"];
  atsLevel: ResumeTemplateDefinition["atsLevel"];
  suitableRoles: string[];
  tags: string[];
  defaultPresentationStyle: ResumeTemplateStyleConfig;
  className: string;
  render: TemplateRenderer;
}): ResumeTemplateDefinition {
  return {
    ...input,
    capabilities: ALL_STYLE_CAPABILITIES,
    version: 1,
    status: "active",
    renderThumbnail: (model, context) => input.render(model, { ...context, thumbnail: true })
  };
}

/** The sole template catalog used by the editor, thumbnail renderer and PDF. */
export const resumeTemplates: ResumeTemplateDefinition[] = [
  definition({
    id: "classic-technical",
    name: "稳重技术",
    shortName: "技术",
    description: "稳重单栏结构，优先突出项目、技能和可验证成果。",
    category: "technical",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["技术", "数据", "研究", "产品"],
    tags: ["技术简洁", "项目经历", "单栏"],
    defaultPresentationStyle: DEFAULT_TEMPLATE_STYLE_CONFIG,
    className: "template-classic-technical",
    render: renderClassicTechnical
  }),
  definition({
    id: "modern-operations",
    name: "简洁现代",
    shortName: "现代",
    description: "轻双栏布局，适合展示综合能力、运营成果和协作经历。",
    category: "modern",
    layout: "two-column",
    atsLevel: "medium",
    suitableRoles: ["运营", "产品", "项目管理", "综合岗位"],
    tags: ["现代", "双栏", "运营产品"],
    defaultPresentationStyle: {
      ...DEFAULT_TEMPLATE_STYLE_CONFIG,
      typography: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.typography, bodyTextScale: "small" }
    },
    className: "template-modern-operations",
    render: renderModernOperations
  }),
  definition({
    id: "ats-minimal",
    name: "ATS极简单栏",
    shortName: "ATS",
    description: "黑白文本优先的单栏模板，减少装饰和复杂结构，便于人工与系统读取。",
    category: "ats",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["技术", "运营", "产品", "数据", "校招", "通用岗位"],
    tags: ["ATS优先", "单栏", "黑白", "通用"],
    defaultPresentationStyle: {
      ...DEFAULT_TEMPLATE_STYLE_CONFIG,
      typography: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.typography, titleTextScale: "small", lineHeight: "tight" },
      spacing: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.spacing, sectionGap: "tight", itemGap: "tight" },
      theme: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.theme, primaryColor: "graphite", accentColor: "graphite", density: "compact" }
    },
    className: "template-ats-minimal",
    render: renderAtsMinimal
  }),
  definition({
    id: "business-consulting",
    name: "商务咨询正式",
    shortName: "商务",
    description: "高信息密度的正式双栏模板，强调教育、量化成果和商业表达。",
    category: "business",
    layout: "two-column",
    atsLevel: "medium",
    suitableRoles: ["经济", "金融", "咨询", "外贸", "供应链", "商务", "管理"],
    tags: ["商务正式", "咨询", "金融", "双栏"],
    defaultPresentationStyle: {
      ...DEFAULT_TEMPLATE_STYLE_CONFIG,
      typography: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.typography, bodyTextScale: "small" },
      spacing: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.spacing, sectionGap: "tight" },
      theme: { ...DEFAULT_TEMPLATE_STYLE_CONFIG.theme, primaryColor: "blue", accentColor: "blue", density: "compact" }
    },
    className: "template-business-consulting",
    render: renderBusinessConsulting
  }),
  definition({
    id: "campus-clean",
    name: "校园清爽",
    shortName: "校园",
    description: "面向学生与实习申请的单栏模板，教育与项目优先，信息密度紧凑但保留呼吸感。",
    category: "campus",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["学生", "实习", "校招", "应届", "初级岗位"],
    tags: ["校园", "应届", "教育优先", "单栏"],
    defaultPresentationStyle: CAMPUS_STYLE,
    className: "template-campus-clean",
    render: renderCampusClean
  }),
  definition({
    id: "professional-classic",
    name: "专业经典",
    shortName: "经典",
    description: "传统企业与综合管理场景的正式单栏模板，采用中性字体和克制层级。",
    category: "business",
    layout: "single-column",
    atsLevel: "high",
    suitableRoles: ["国企", "行政", "综合管理", "传统企业", "专业职能"],
    tags: ["正式", "管理", "商务", "单栏"],
    defaultPresentationStyle: PROFESSIONAL_STYLE,
    className: "template-professional-classic",
    render: renderProfessionalClassic
  })
];

export function getResumeTemplate(templateId: TemplateId) {
  return resumeTemplates.find((template) => template.id === templateId) ?? resumeTemplates[0];
}

export function isResumeTemplateId(value: unknown): value is TemplateId {
  return typeof value === "string" && resumeTemplates.some((template) => template.id === value);
}

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

export function filterResumeTemplates(
  filter: TemplateFilterKey,
  templates: ResumeTemplateDefinition[] = resumeTemplates
) {
  if (filter === "ats") return templates.filter((template) => template.atsLevel === "high");
  if (filter === "single-column" || filter === "two-column") return templates.filter((template) => template.layout === filter);
  if (filter === "technical") {
    return templates.filter((template) => template.category === "technical" || template.tags.some((tag) => tag.includes("技术")) || template.suitableRoles.some((role) => role.includes("技术")));
  }
  if (filter === "business") return templates.filter((template) => template.category === "business");
  if (filter === "campus") {
    return templates.filter((template) => template.category === "campus" || template.tags.some((tag) => tag.includes("校园") || tag.includes("应届")));
  }
  return templates;
}

export function getTemplateDefaultStyleConfig(templateId: TemplateId): ResumeTemplateStyleConfig {
  return getDefaultStyleForTemplate(getResumeTemplate(templateId));
}
