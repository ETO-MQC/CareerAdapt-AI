import type { ReactNode } from "react";
import type {
  ResumePresentationConfig,
  ResumeRenderModel,
  TemplateId
} from "@/domain/schemas";
import type { CanonicalFieldId, ResumeSectionTypeV2 } from "@/domain/resumeFields";

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
  measurement?: boolean;
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
  category: "ats" | "technical" | "business" | "modern" | "campus";
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
export type TemplateFilterKey =
  | "all"
  | "ats"
  | "single-column"
  | "two-column"
  | "technical"
  | "business"
  | "campus";
