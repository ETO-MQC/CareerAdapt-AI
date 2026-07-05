import { z } from "zod";
import {
  BranchContentItemTypeSchema,
  BranchGuardModeSchema,
  BranchGuardStatusSchema
} from "./branch";

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
  name: z.string().min(1),
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

export const ResumeRenderModelSchema = z.object({
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
