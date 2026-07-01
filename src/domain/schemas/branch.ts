import { z } from "zod";
import { EntityBaseSchema } from "./common";
import { AiSuggestionSchema } from "./ai";
import { RequirementMatchSchema } from "./job";

export const SelectedContentSchema = z.object({
  experienceId: z.string().min(1),
  draftId: z.string().optional(),
  order: z.number().int().min(0),
  visible: z.boolean()
});

export const CustomTextSchema = EntityBaseSchema.extend({
  targetPath: z.string().min(1),
  text: z.string().min(1),
  factIds: z.array(z.string()).default([])
});

export const TemplateConfigSchema = z.object({
  templateId: z.string().min(1),
  fontScale: z.number().min(0.8).max(1.2).default(1),
  density: z.enum(["comfortable", "compact"]).default("comfortable")
});

export const ResumeRevisionSchema = EntityBaseSchema.extend({
  branchId: z.string().min(1),
  snapshot: z.unknown(),
  source: z.enum(["user_manual", "ai_suggestion", "template_probe", "system"])
});

export const ExportRecordSchema = EntityBaseSchema.extend({
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  templateId: z.string().min(1),
  format: z.enum(["pdf", "json"]),
  fileName: z.string().min(1)
});

export const ResumeBranchSchema = EntityBaseSchema.extend({
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  name: z.string().min(1),
  selectedItems: z.array(SelectedContentSchema).default([]),
  customTexts: z.array(CustomTextSchema).default([]),
  templateId: z.string().min(1),
  templateConfig: TemplateConfigSchema,
  currentRevisionId: z.string().optional(),
  profileVersion: z.number().int().min(1),
  requirementMatches: z.array(RequirementMatchSchema).default([]),
  aiSuggestions: z.array(AiSuggestionSchema).default([]),
  revisions: z.array(ResumeRevisionSchema).default([]),
  exportRecords: z.array(ExportRecordSchema).default([])
});

export type SelectedContent = z.infer<typeof SelectedContentSchema>;
export type CustomText = z.infer<typeof CustomTextSchema>;
export type TemplateConfig = z.infer<typeof TemplateConfigSchema>;
export type ResumeRevision = z.infer<typeof ResumeRevisionSchema>;
export type ExportRecord = z.infer<typeof ExportRecordSchema>;
export type ResumeBranch = z.infer<typeof ResumeBranchSchema>;
