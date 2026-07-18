import { z } from "zod";
import {
  BranchContentItemTypeSchema,
  BranchGuardModeSchema,
  BranchGuardStatusSchema
} from "./branch";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema } from "./resumeV2";
import { ResumePresentationItemSchema } from "./resumePresentation";

export const TemplateIdSchema = z.enum([
  "classic-technical",
  "modern-operations",
  "ats-minimal",
  "business-consulting"
]);

export const ResumePaginationStatusSchema = z.enum([
  "fits",
  "near_limit",
  "overflow",
  "fits_one_page",
  "near_one_page_limit",
  "fits_two_pages",
  "fits_three_pages",
  "fits_four_pages",
  "exceeds_four_pages",
  "exceeds_two_pages",
  "measuring",
  "measurement_failed"
]);
export const OverflowStatusSchema = ResumePaginationStatusSchema;

export const ResumeRenderSectionTypeSchema = z.enum([
  "summary",
  "experience",
  "skills",
  "certificates"
]);

export const ResumeRenderBlockSchema = z.object({
  sourceItemId: z.string().min(1),
  sourceSectionId: z.string().min(1).optional(),
  itemType: BranchContentItemTypeSchema,
  order: z.number().int().min(0),
  text: z.string().min(1),
  factRefKeys: z.array(z.string().min(1)).default([]),
  requirementIds: z.array(z.string().min(1)).default([]),
  guardMode: BranchGuardModeSchema,
  guardStatus: BranchGuardStatusSchema
});

export const ResumeRenderSectionSchema = z.object({
  type: ResumeRenderSectionTypeSchema,
  title: z.string().min(1),
  blocks: z.array(ResumeRenderBlockSchema).default([])
});

export const ResumeRenderCandidateSchema = z.object({
  name: z.string(),
  summary: z.string().optional(),
  contacts: z.array(z.string().min(1)).default([]),
  targetRole: z.string().optional()
});

export const ResumeRenderSafetySchema = z.object({
  ruleOnlyItemIds: z.array(z.string().min(1)).default([]),
  visibleItemCount: z.number().int().min(0),
  excludedItemIds: z.array(z.string().min(1)).default([])
});

export const ResumeRenderSourceTraceSchema = z.object({
  profileId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  currentRevisionId: z.string().min(1),
  sourceProfileVersion: z.number().int().min(1),
  sourceJobVersion: z.string().min(1).optional()
});

export const ResumeRenderModelV1Schema = z.object({
  schemaVersion: z.literal("resume-render-v1"),
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  branchCurrentRevisionId: z.string().min(1),
  branchName: z.string().min(1),
  jobTitle: z.string().min(1),
  company: z.string().min(1),
  candidate: ResumeRenderCandidateSchema,
  sections: z.array(ResumeRenderSectionSchema).default([]),
  safety: ResumeRenderSafetySchema,
  sourceTrace: ResumeRenderSourceTraceSchema
});

export const ResumeRenderStructuredItemV2Schema = z.object({
  sectionId: z.string().min(1),
  itemId: z.string().min(1),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  data: ResumeItemV2Schema,
  plainText: z.string().min(1),
  presentation: ResumePresentationItemSchema
}).strict();

export const ResumeRenderStructuredSectionV2Schema = z.object({
  sectionId: z.string().min(1),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  title: z.string().min(1),
  order: z.number().int().min(0),
  showTitle: z.boolean().optional(),
  items: z.array(ResumeRenderStructuredItemV2Schema).default([])
}).strict();

export const ResumeRenderModelV2Schema = ResumeRenderModelV1Schema.omit({ schemaVersion: true }).extend({
  schemaVersion: z.literal("resume-render-v2"),
  structuredSections: z.array(ResumeRenderStructuredSectionV2Schema).default([]),
  compatibilityWarnings: z.array(z.string().min(1)).default([])
});

export const ResumeRenderModelSchema = z.union([ResumeRenderModelV2Schema, ResumeRenderModelV1Schema]);

export type TemplateId = z.infer<typeof TemplateIdSchema>;
export type ResumePaginationStatus = z.infer<typeof ResumePaginationStatusSchema>;
export type OverflowStatus = z.infer<typeof OverflowStatusSchema>;
export type ResumeRenderSectionType = z.infer<typeof ResumeRenderSectionTypeSchema>;
export type ResumeRenderBlock = z.infer<typeof ResumeRenderBlockSchema>;
export type ResumeRenderSection = z.infer<typeof ResumeRenderSectionSchema>;
export type ResumeRenderCandidate = z.infer<typeof ResumeRenderCandidateSchema>;
export type ResumeRenderSafety = z.infer<typeof ResumeRenderSafetySchema>;
export type ResumeRenderSourceTrace = z.infer<typeof ResumeRenderSourceTraceSchema>;
export type ResumeRenderModel = z.infer<typeof ResumeRenderModelSchema>;
export type ResumeRenderModelV1 = z.infer<typeof ResumeRenderModelV1Schema>;
export type ResumeRenderModelV2 = z.infer<typeof ResumeRenderModelV2Schema>;
export type ResumeRenderStructuredSectionV2 = z.infer<typeof ResumeRenderStructuredSectionV2Schema>;
