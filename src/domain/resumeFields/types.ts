export const RESUME_CATALOG_VERSION = "resume-field-catalog-v2.1.0" as const;

export const RESUME_SECTION_TYPES_V2 = [
  "basics",
  "summary",
  "education",
  "work",
  "internship",
  "project",
  "research",
  "campus",
  "volunteer",
  "awards",
  "skills",
  "certificates",
  "languages",
  "publications",
  "patents",
  "portfolio",
  "other",
  "custom"
] as const;

export type ResumeSectionTypeV2 = typeof RESUME_SECTION_TYPES_V2[number];
export type CanonicalFieldId = `${Exclude<ResumeSectionTypeV2, "custom">}.${string}`;

export type ResumeFieldValueType =
  | "string"
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "url"
  | "string_list";

export type ResumeFieldUiControl =
  | "text"
  | "textarea"
  | "date"
  | "checkbox"
  | "number"
  | "url"
  | "tags"
  | "select";

export type ResumeFieldDefinition = {
  id: CanonicalFieldId;
  sectionType: ResumeSectionTypeV2;
  label: string;
  aliases: readonly string[];
  valueType: ResumeFieldValueType;
  repeatable: boolean;
  required: boolean;
  importable: boolean;
  aiMappable: boolean;
  sensitive: boolean;
  defaultVisible: boolean;
  displayOrder: number;
  uiControl?: ResumeFieldUiControl;
};

export type ResumeSectionDefinition = {
  id: ResumeSectionTypeV2;
  label: string;
  aliases: readonly string[];
  repeatable: boolean;
  defaultVisible: boolean;
  addable: boolean;
  displayOrder: number;
};
