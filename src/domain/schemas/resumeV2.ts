import { z } from "zod";
import { RESUME_SECTION_TYPES_V2 } from "@/domain/resumeFields/types";

const NonEmptyStringSchema = z.string().trim().min(1);
const OptionalTextSchema = NonEmptyStringSchema.optional();
const OptionalUrlSchema = z.string().trim().url().optional();
const StringListSchema = z.array(NonEmptyStringSchema).default([]);

export const ResumeSectionTypeV2Schema = z.enum(RESUME_SECTION_TYPES_V2);
export const CustomFieldValueTypeSchema = z.enum(["string", "text", "number", "boolean", "date", "url", "string_list"]);
export const CustomFieldPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.array(NonEmptyStringSchema)]);

export const CustomFieldValueSchema = z.object({
  id: NonEmptyStringSchema,
  label: NonEmptyStringSchema,
  valueType: CustomFieldValueTypeSchema,
  value: CustomFieldPrimitiveSchema,
  order: z.number().int().min(0),
  sensitive: z.boolean().default(false)
}).strict().superRefine((field, context) => {
  const valid = field.valueType === "number" ? typeof field.value === "number"
    : field.valueType === "boolean" ? typeof field.value === "boolean"
      : field.valueType === "string_list" ? Array.isArray(field.value)
        : typeof field.value === "string";
  if (!valid) context.addIssue({ code: "custom", path: ["value"], message: `custom field value must match ${field.valueType}` });
});

const ItemBaseShape = {
  id: NonEmptyStringSchema,
  customFields: z.array(CustomFieldValueSchema).default([])
};

const ExperienceShape = {
  organization: OptionalTextSchema,
  role: OptionalTextSchema,
  department: OptionalTextSchema,
  location: OptionalTextSchema,
  startDate: OptionalTextSchema,
  endDate: OptionalTextSchema,
  current: z.boolean().default(false),
  description: OptionalTextSchema,
  highlights: StringListSchema
};

export const ResumeBasicsV2Schema = z.object({
  name: OptionalTextSchema,
  photo: OptionalUrlSchema,
  headline: OptionalTextSchema,
  targetRole: OptionalTextSchema,
  summary: OptionalTextSchema,
  phone: OptionalTextSchema,
  email: OptionalTextSchema,
  location: OptionalTextSchema,
  homepage: OptionalUrlSchema,
  linkedin: OptionalUrlSchema,
  github: OptionalUrlSchema,
  portfolioLinks: z.array(z.string().url()).default([]),
  otherLinks: z.array(z.string().url()).default([]),
  customFields: z.array(CustomFieldValueSchema).default([])
}).strict();

export const SummaryItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("summary"), text: NonEmptyStringSchema }).strict();

export const EducationItemV2Schema = z.object({
  ...ItemBaseShape,
  sectionType: z.literal("education"),
  school: OptionalTextSchema,
  major: OptionalTextSchema,
  degree: OptionalTextSchema,
  department: OptionalTextSchema,
  location: OptionalTextSchema,
  startDate: OptionalTextSchema,
  endDate: OptionalTextSchema,
  current: z.boolean().default(false),
  gpa: z.number().min(0).optional(),
  gpaScale: z.number().positive().optional(),
  rankPosition: z.number().int().positive().optional(),
  rankTotal: z.number().int().positive().optional(),
  courses: StringListSchema,
  honors: StringListSchema,
  description: OptionalTextSchema,
  highlights: StringListSchema
}).strict();

const experienceItem = <T extends "work" | "internship" | "campus" | "volunteer">(sectionType: T) =>
  z.object({ ...ItemBaseShape, sectionType: z.literal(sectionType), ...ExperienceShape }).strict();

export const WorkItemV2Schema = experienceItem("work");
export const InternshipItemV2Schema = experienceItem("internship");
export const CampusItemV2Schema = experienceItem("campus");
export const VolunteerItemV2Schema = experienceItem("volunteer");

export const ProjectItemV2Schema = z.object({
  ...ItemBaseShape, sectionType: z.literal("project"), title: OptionalTextSchema, role: OptionalTextSchema,
  organization: OptionalTextSchema, location: OptionalTextSchema, startDate: OptionalTextSchema, endDate: OptionalTextSchema,
  current: z.boolean().default(false), url: OptionalUrlSchema,
  tools: StringListSchema, background: OptionalTextSchema, description: OptionalTextSchema, highlights: StringListSchema, outcomes: StringListSchema
}).strict();

export const ResearchItemV2Schema = z.object({
  ...ItemBaseShape, sectionType: z.literal("research"), title: OptionalTextSchema, authorRole: OptionalTextSchema,
  institution: OptionalTextSchema, startDate: OptionalTextSchema, endDate: OptionalTextSchema, methods: StringListSchema,
  current: z.boolean().default(false),
  samples: OptionalTextSchema, publication: OptionalTextSchema, publicationStatus: OptionalTextSchema, url: OptionalUrlSchema,
  description: OptionalTextSchema, highlights: StringListSchema
}).strict();

export const SkillItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("skills"), name: NonEmptyStringSchema, category: OptionalTextSchema, level: OptionalTextSchema, description: OptionalTextSchema }).strict();
export const CertificateItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("certificates"), name: NonEmptyStringSchema, issuer: OptionalTextSchema, issuedAt: OptionalTextSchema, expiresAt: OptionalTextSchema, credentialId: OptionalTextSchema, status: OptionalTextSchema, description: OptionalTextSchema }).strict();
export const AwardItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("awards"), name: NonEmptyStringSchema, issuer: OptionalTextSchema, level: OptionalTextSchema, awardedAt: OptionalTextSchema, rank: OptionalTextSchema, description: OptionalTextSchema }).strict();
export const LanguageItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("languages"), language: NonEmptyStringSchema, level: OptionalTextSchema, testName: OptionalTextSchema, score: OptionalTextSchema, description: OptionalTextSchema }).strict();

export const PublicationItemV2Schema = z.object({
  ...ItemBaseShape, sectionType: z.literal("publications"), title: NonEmptyStringSchema, authors: StringListSchema,
  authorRole: OptionalTextSchema, publisher: OptionalTextSchema, publishedAt: OptionalTextSchema, status: OptionalTextSchema,
  doi: OptionalTextSchema, url: OptionalUrlSchema, description: OptionalTextSchema
}).strict();

export const PatentItemV2Schema = z.object({
  ...ItemBaseShape, sectionType: z.literal("patents"), title: NonEmptyStringSchema, inventors: StringListSchema,
  patentNumber: OptionalTextSchema, office: OptionalTextSchema, filedAt: OptionalTextSchema, grantedAt: OptionalTextSchema,
  status: OptionalTextSchema, url: OptionalUrlSchema, description: OptionalTextSchema
}).strict();

export const PortfolioItemV2Schema = z.object({
  ...ItemBaseShape, sectionType: z.literal("portfolio"), title: NonEmptyStringSchema, type: OptionalTextSchema,
  role: OptionalTextSchema, url: OptionalUrlSchema, createdAt: OptionalTextSchema, tools: StringListSchema,
  description: OptionalTextSchema, highlights: StringListSchema
}).strict();

export const OtherItemV2Schema = z.object({ ...ItemBaseShape, sectionType: z.literal("other"), title: OptionalTextSchema, description: NonEmptyStringSchema, highlights: StringListSchema }).strict();

export const FlexibleItemV2Schema = z.object({
  ...ItemBaseShape,
  sectionType: z.literal("custom"),
  title: OptionalTextSchema,
  description: OptionalTextSchema,
  highlights: StringListSchema
}).strict().refine((item) => Boolean(item.title || item.description || item.highlights.length || item.customFields.length), {
  message: "custom item must contain at least one value"
});

export const ResumeItemV2Schema = z.discriminatedUnion("sectionType", [
  SummaryItemV2Schema, EducationItemV2Schema, WorkItemV2Schema, InternshipItemV2Schema, ProjectItemV2Schema,
  ResearchItemV2Schema, CampusItemV2Schema, VolunteerItemV2Schema, AwardItemV2Schema, SkillItemV2Schema,
  CertificateItemV2Schema, LanguageItemV2Schema, PublicationItemV2Schema, PatentItemV2Schema,
  PortfolioItemV2Schema, OtherItemV2Schema, FlexibleItemV2Schema
]).superRefine((item, context) => {
  if ("current" in item && item.current && item.endDate) context.addIssue({ code: "custom", path: ["endDate"], message: "current item must not have endDate" });
  if (item.sectionType === "education") {
    if (item.gpa !== undefined && item.gpaScale !== undefined && item.gpa > item.gpaScale) context.addIssue({ code: "custom", path: ["gpa"], message: "gpa must not exceed gpaScale" });
    if (item.rankPosition !== undefined && item.rankTotal !== undefined && item.rankPosition > item.rankTotal) context.addIssue({ code: "custom", path: ["rankPosition"], message: "rankPosition must not exceed rankTotal" });
  }
});

export const FlexibleSectionV2Schema = z.object({
  id: NonEmptyStringSchema,
  sectionType: z.literal("custom"),
  title: NonEmptyStringSchema,
  order: z.number().int().min(0),
  visible: z.boolean().default(true),
  items: z.array(FlexibleItemV2Schema).default([]),
  customFields: z.array(CustomFieldValueSchema).default([])
}).strict();

export type ResumeSectionTypeV2 = z.infer<typeof ResumeSectionTypeV2Schema>;
export type CustomFieldValue = z.infer<typeof CustomFieldValueSchema>;
export type ResumeBasicsV2 = z.infer<typeof ResumeBasicsV2Schema>;
export type ResumeItemV2 = z.infer<typeof ResumeItemV2Schema>;
export type EducationItemV2 = z.infer<typeof EducationItemV2Schema>;
export type WorkItemV2 = z.infer<typeof WorkItemV2Schema>;
export type InternshipItemV2 = z.infer<typeof InternshipItemV2Schema>;
export type CampusItemV2 = z.infer<typeof CampusItemV2Schema>;
export type VolunteerItemV2 = z.infer<typeof VolunteerItemV2Schema>;
export type ProjectItemV2 = z.infer<typeof ProjectItemV2Schema>;
export type FlexibleItemV2 = z.infer<typeof FlexibleItemV2Schema>;
export type FlexibleSectionV2 = z.infer<typeof FlexibleSectionV2Schema>;
