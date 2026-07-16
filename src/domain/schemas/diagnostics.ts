import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import { ResumePagePolicySchema } from "./presentation";
import { ResumeRenderSectionTypeSchema, TemplateIdSchema } from "./resumeRender";

export const ResumeDiagnosticCategorySchema = z.enum([
  "requirement_coverage",
  "fact_gap",
  "content_relevance",
  "content_density",
  "readability",
  "spacing",
  "pagination",
  "template_fit",
  "ats_structure",
  "contact_completeness",
  "section_structure"
]);

export const ResumeDiagnosticSeveritySchema = z.enum(["info", "warning", "critical"]);
export const ResumeDiagnosticStatusSchema = z.enum(["open", "ignored", "resolved", "stale"]);

export const ResumeDiagnosticEvidenceSchema = z.object({
  type: z.enum(["measurement", "requirement", "content", "template_metadata", "pagination", "presentation"]),
  label: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  sourceId: z.string().min(1).optional()
});

export const ResumeDiagnosticActionKindSchema = z.enum([
  "open_content_editor",
  "open_job_suggestion",
  "open_fact_gap",
  "set_density",
  "set_body_scale",
  "set_line_height",
  "set_section_gap",
  "set_item_gap",
  "switch_template",
  "change_page_policy",
  "cancel_section_break",
  "hide_block",
  "show_block",
  "move_block_up",
  "move_block_down",
  "ignore_issue"
]);

export const ResumeDiagnosticActionSchema = z.object({
  id: z.string().min(1),
  kind: ResumeDiagnosticActionKindSchema,
  safeAutoApply: z.boolean(),
  label: z.string().min(1),
  payload: z.unknown().optional()
});

export const ResumeDiagnosticIssueSchema = z.object({
  id: z.string().min(1),
  issueKey: z.string().min(1),
  branchId: z.string().min(1),
  basedOnBranchRevision: z.number().int().min(0),
  basedOnRevisionId: z.string().min(1),
  basedOnPresentationRevision: z.number().int().min(0),
  requirementsHash: z.string().min(8).optional(),
  paginationHash: z.string().min(8).optional(),
  templateId: TemplateIdSchema,
  category: ResumeDiagnosticCategorySchema,
  severity: ResumeDiagnosticSeveritySchema,
  code: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  requirementIds: z.array(z.string().min(1)).default([]),
  sectionType: ResumeRenderSectionTypeSchema.optional(),
  contentItemIds: z.array(z.string().min(1)).default([]),
  evidence: z.array(ResumeDiagnosticEvidenceSchema).default([]),
  recommendedActions: z.array(ResumeDiagnosticActionSchema).default([]),
  status: ResumeDiagnosticStatusSchema,
  createdAt: IsoDateStringSchema
});

export const ResumeDiagnosticSummarySchema = z.object({
  total: z.number().int().min(0),
  critical: z.number().int().min(0),
  warning: z.number().int().min(0),
  info: z.number().int().min(0),
  open: z.number().int().min(0),
  ignored: z.number().int().min(0),
  requirementCoverage: z.object({
    totalRequirements: z.number().int().min(0),
    covered: z.number().int().min(0),
    partial: z.number().int().min(0),
    weak: z.number().int().min(0),
    uncovered: z.number().int().min(0),
    factGaps: z.number().int().min(0)
  }),
  page: z.object({
    pagePolicy: ResumePagePolicySchema,
    actualPageCount: z.number().int().min(0),
    requestedMaxPages: z.number().int().min(1).max(4),
    paginationBlocked: z.boolean()
  }),
  atsStructureStatus: z.enum(["structure_friendly", "minor_risk", "clear_risk", "unknown"]),
  exportHardBlocked: z.boolean(),
  exportHardBlockReasons: z.array(z.string()).default([])
});

export const ResumeDiagnosticSnapshotSchema = z.object({
  schemaVersion: z.literal("resume-diagnostics-v1"),
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  currentRevisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  templateId: TemplateIdSchema,
  pagePolicy: ResumePagePolicySchema,
  paginationHash: z.string().min(8).optional(),
  requirementsHash: z.string().min(8).optional(),
  diagnosticsEngineVersion: z.string().min(1),
  rulesetVersion: z.string().min(1),
  templateRegistryVersion: z.string().min(1),
  generatedAt: IsoDateStringSchema,
  snapshotKey: z.string().min(8),
  diagnosticHash: z.string().min(8),
  issues: z.array(ResumeDiagnosticIssueSchema),
  summary: ResumeDiagnosticSummarySchema
});

export type ResumeDiagnosticCategory = z.infer<typeof ResumeDiagnosticCategorySchema>;
export type ResumeDiagnosticSeverity = z.infer<typeof ResumeDiagnosticSeveritySchema>;
export type ResumeDiagnosticStatus = z.infer<typeof ResumeDiagnosticStatusSchema>;
export type ResumeDiagnosticEvidence = z.infer<typeof ResumeDiagnosticEvidenceSchema>;
export type ResumeDiagnosticActionKind = z.infer<typeof ResumeDiagnosticActionKindSchema>;
export type ResumeDiagnosticAction = z.infer<typeof ResumeDiagnosticActionSchema>;
export type ResumeDiagnosticIssue = z.infer<typeof ResumeDiagnosticIssueSchema>;
export type ResumeDiagnosticSummary = z.infer<typeof ResumeDiagnosticSummarySchema>;
export type ResumeDiagnosticSnapshot = z.infer<typeof ResumeDiagnosticSnapshotSchema>;
