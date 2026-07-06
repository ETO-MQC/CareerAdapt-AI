import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema } from "./common";
import { ResumePagePolicySchema } from "./presentation";
import { TemplateIdSchema } from "./resumeRender";

export const ApplicationStatusSchema = z.enum([
  "discovered",
  "preparing",
  "ready",
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
  "archived"
]);

export const ApplicationPrioritySchema = z.enum(["low", "normal", "high"]);

export const ApplicationSourceChannelSchema = z.enum([
  "campus",
  "company_site",
  "job_board",
  "referral",
  "social",
  "other"
]);

export const ApplicationTimelineEventTypeSchema = z.enum([
  "created",
  "status_changed",
  "priority_changed",
  "details_updated",
  "branch_linked",
  "revision_selected",
  "export_attached",
  "deadline_changed",
  "follow_up_changed",
  "note_added",
  "archived",
  "restored"
]);

export const ApplicationReadinessLevelSchema = z.enum([
  "blocked",
  "needs_attention",
  "ready"
]);

export const ApplicationTimelineEventSchema = z.object({
  id: z.string().min(1),
  type: ApplicationTimelineEventTypeSchema,
  occurredAt: IsoDateStringSchema,
  createdAt: IsoDateStringSchema,
  fromStatus: ApplicationStatusSchema.optional(),
  toStatus: ApplicationStatusSchema.optional(),
  summary: z.string().min(1).max(280),
  note: z.string().max(2000).optional(),
  operationId: z.string().min(1)
});

export const ApplicationAppliedSnapshotSchema = z.object({
  revisionId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  presentationRevision: z.number().int().min(0),
  templateId: TemplateIdSchema,
  exportRecordId: z.string().min(1).optional(),
  lockedAt: IsoDateStringSchema
});

export const ApplicationDiagnosticSummarySchema = z.object({
  diagnosticsEngineVersion: z.string().min(1).optional(),
  diagnosticsSnapshotHash: z.string().min(8).optional(),
  criticalIssueCount: z.number().int().min(0).default(0),
  warningIssueCount: z.number().int().min(0).default(0),
  requirementCoverageSummary: z.object({
    totalRequirements: z.number().int().min(0),
    covered: z.number().int().min(0),
    partial: z.number().int().min(0),
    weak: z.number().int().min(0),
    uncovered: z.number().int().min(0),
    factGaps: z.number().int().min(0)
  }).optional()
});

export const ApplicationRecordSchema = EntityBaseSchema.extend({
  schemaVersion: z.literal("application-v1"),
  profileId: z.string().min(1),
  jobId: z.string().min(1),
  jobTitleSnapshot: z.string().min(1).max(180),
  companySnapshot: z.string().min(1).max(180).optional(),
  sourceGeneralBranchId: z.string().min(1).optional(),
  jobSpecificBranchId: z.string().min(1),
  selectedRevisionId: z.string().min(1),
  selectedBranchRevision: z.number().int().min(0),
  selectedPresentationRevision: z.number().int().min(0),
  selectedTemplateId: TemplateIdSchema,
  selectedPagePolicy: ResumePagePolicySchema.optional(),
  selectedActualPageCount: z.number().int().min(1).max(3).optional(),
  selectedExportRecordId: z.string().min(1).optional(),
  diagnosticSummary: ApplicationDiagnosticSummarySchema.optional(),
  appliedSnapshot: ApplicationAppliedSnapshotSchema.optional(),
  previousStatusBeforeArchive: ApplicationStatusSchema.exclude(["archived"]).optional(),
  status: ApplicationStatusSchema,
  priority: ApplicationPrioritySchema,
  sourceChannel: ApplicationSourceChannelSchema.optional(),
  sourceUrl: z.string().max(2048).optional(),
  deadlineAt: IsoDateStringSchema.optional(),
  plannedApplyAt: IsoDateStringSchema.optional(),
  appliedAt: IsoDateStringSchema.optional(),
  nextFollowUpAt: IsoDateStringSchema.optional(),
  note: z.string().max(4000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  timeline: z.array(ApplicationTimelineEventSchema).max(200).default([]),
  version: z.number().int().min(1),
  archivedAt: IsoDateStringSchema.optional()
}).superRefine((record, ctx) => {
  if (record.status === "archived" && !record.archivedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["archivedAt"],
      message: "archived applications must keep archivedAt"
    });
  }

  if (record.status !== "archived" && record.archivedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["archivedAt"],
      message: "active applications must not keep archivedAt"
    });
  }

  if (record.appliedSnapshot && !record.appliedAt) {
    ctx.addIssue({
      code: "custom",
      path: ["appliedAt"],
      message: "applied snapshot requires appliedAt"
    });
  }

  const eventIds = new Set<string>();
  for (const event of record.timeline) {
    if (eventIds.has(event.id)) {
      ctx.addIssue({
        code: "custom",
        path: ["timeline"],
        message: "timeline event ids must be unique"
      });
    }
    eventIds.add(event.id);
  }
});

export const ApplicationReadinessItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  level: ApplicationReadinessLevelSchema,
  message: z.string().min(1)
});

export const ApplicationReadinessSchema = z.object({
  level: ApplicationReadinessLevelSchema,
  items: z.array(ApplicationReadinessItemSchema).min(1),
  updatedAt: IsoDateStringSchema
});

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>;
export type ApplicationPriority = z.infer<typeof ApplicationPrioritySchema>;
export type ApplicationSourceChannel = z.infer<typeof ApplicationSourceChannelSchema>;
export type ApplicationTimelineEventType = z.infer<typeof ApplicationTimelineEventTypeSchema>;
export type ApplicationTimelineEvent = z.infer<typeof ApplicationTimelineEventSchema>;
export type ApplicationAppliedSnapshot = z.infer<typeof ApplicationAppliedSnapshotSchema>;
export type ApplicationDiagnosticSummary = z.infer<typeof ApplicationDiagnosticSummarySchema>;
export type ApplicationRecord = z.infer<typeof ApplicationRecordSchema>;
export type ApplicationReadinessLevel = z.infer<typeof ApplicationReadinessLevelSchema>;
export type ApplicationReadinessItem = z.infer<typeof ApplicationReadinessItemSchema>;
export type ApplicationReadiness = z.infer<typeof ApplicationReadinessSchema>;
