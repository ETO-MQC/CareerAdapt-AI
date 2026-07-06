import { z } from "zod";
import { EntityBaseSchema, IsoDateStringSchema, RiskLevelSchema } from "./common";

export const BranchLifecycleStatusSchema = z.enum(["active", "archived"]);
export const BranchMigrationStatusSchema = z.enum(["verified", "legacy_unverified"]);
export const ResumeBranchPurposeSchema = z.enum(["job_specific", "general"]);

export const BranchFactRefSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("experience_fact"),
    experienceId: z.string().min(1),
    factId: z.string().min(1)
  }),
  z.object({
    type: z.literal("skill_fact"),
    skillId: z.string().min(1),
    factId: z.string().min(1)
  }),
  z.object({
    type: z.literal("certificate_fact"),
    certificateId: z.string().min(1),
    factId: z.string().min(1)
  }),
  z.object({
    type: z.literal("evidence_file"),
    evidenceId: z.string().min(1),
    linkedFactId: z.string().min(1)
  })
]);

export const BranchContentItemTypeSchema = z.enum([
  "experience",
  "skill",
  "certificate",
  "summary",
  "custom",
  "structural"
]);

export const BranchContentSourceSchema = z.enum([
  "adaptation_draft",
  "resume_import",
  "user_manual",
  "restored",
  "system_structural",
  "legacy"
]);

export const BranchGuardModeSchema = z.enum([
  "ai_verified",
  "rule_verified",
  "rule_only_verified",
  "not_fact"
]);

export const BranchGuardStatusSchema = z.enum([
  "pass",
  "ai_failed_rule_kept"
]);

export const BranchGuardFindingSnapshotSchema = z.object({
  type: z.string().min(1),
  text: z.string().min(1),
  severity: RiskLevelSchema,
  allowed: z.boolean(),
  message: z.string().min(1)
});

export const BranchContentItemSchema = z.object({
  id: z.string().min(1),
  itemType: BranchContentItemTypeSchema,
  source: BranchContentSourceSchema,
  sourceSectionId: z.string().optional(),
  text: z.string().min(1),
  originalText: z.string().min(1),
  order: z.number().int().min(0),
  visible: z.boolean(),
  requirementIds: z.array(z.string().min(1)).default([]),
  sourceSuggestionIds: z.array(z.string().min(1)).default([]),
  factRefs: z.array(BranchFactRefSchema).default([]),
  guardMode: BranchGuardModeSchema,
  guardStatus: BranchGuardStatusSchema,
  guardRiskLevel: RiskLevelSchema,
  guardFindings: z.array(BranchGuardFindingSnapshotSchema).default([]),
  guardedAt: IsoDateStringSchema.optional(),
  guardVersion: z.string().optional()
}).superRefine((item, ctx) => {
  if (item.itemType !== "structural" && item.factRefs.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["factRefs"],
      message: "factual branch content must reference confirmed facts"
    });
  }

  if (item.itemType === "structural" && item.factRefs.length > 0) {
    ctx.addIssue({
      code: "custom",
      path: ["factRefs"],
      message: "structural content must not carry fact refs"
    });
  }
});

export const BranchSyncStatusSchema = z.object({
  status: z.enum([
    "in_sync",
    "profile_updated",
    "job_updated",
    "profile_and_job_updated",
    "invalid_reference"
  ]),
  sourceProfileVersion: z.number().int().min(1),
  currentProfileVersion: z.number().int().min(1),
  sourceJobVersion: z.string().min(1).optional(),
  currentJobVersion: z.string().min(1).optional(),
  invalidFactRefs: z.array(z.string().min(1)).default([]),
  checkedAt: IsoDateStringSchema,
  message: z.string().min(1)
});

export const ResumeBranchSnapshotSchema = z.object({
  name: z.string().min(1),
  lifecycleStatus: BranchLifecycleStatusSchema,
  contentItems: z.array(BranchContentItemSchema)
});

export const ResumeRevisionSourceSchema = z.enum([
  "created",
  "import_confirmed",
  "manual_edit",
  "suggestion_accept",
  "reorder",
  "visibility",
  "restore",
  "undo",
  "archive"
]);

export const ResumeRevisionSchema = EntityBaseSchema.extend({
  branchId: z.string().min(1),
  revisionNumber: z.number().int().min(0),
  source: ResumeRevisionSourceSchema,
  operationId: z.string().min(1),
  previousRevisionId: z.string().nullish(),
  restoredFromRevisionId: z.string().nullish(),
  snapshot: ResumeBranchSnapshotSchema
}).superRefine((revision, ctx) => {
  if (revision.revisionNumber > 0 && !revision.previousRevisionId) {
    ctx.addIssue({
      code: "custom",
      path: ["previousRevisionId"],
      message: "every non-initial resume revision must have previousRevisionId"
    });
  }
});

export const ResumeBranchSchema = EntityBaseSchema.extend({
  branchPurpose: ResumeBranchPurposeSchema.default("job_specific"),
  profileId: z.string().min(1),
  jobId: z.string().min(1).optional(),
  name: z.string().min(1),
  sourceProfileVersion: z.number().int().min(1),
  sourceJobVersion: z.string().min(1).optional(),
  sourceAdaptationDraftId: z.string().min(1).optional(),
  sourceImportId: z.string().min(1).optional(),
  sourceBranchId: z.string().min(1).optional(),
  sourceRevisionId: z.string().min(1).optional(),
  derivedAt: IsoDateStringSchema.optional(),
  sourceDraftRevision: z.number().int().min(0),
  matcherVersion: z.string().min(1),
  sourceMatchSetHash: z.string().min(8),
  requirementMatchIds: z.array(z.string().min(1)).default([]),
  revision: z.number().int().min(0),
  currentRevisionId: z.string().nullish(),
  lifecycleStatus: BranchLifecycleStatusSchema,
  migrationStatus: BranchMigrationStatusSchema,
  syncStatusCache: BranchSyncStatusSchema,
  contentItems: z.array(BranchContentItemSchema).default([]),
  legacyPayload: z.unknown().optional()
}).superRefine((branch, ctx) => {
  if (branch.migrationStatus !== "verified") {
    return;
  }

  if (branch.branchPurpose === "job_specific" && !branch.jobId) {
    ctx.addIssue({
      code: "custom",
      path: ["jobId"],
      message: "job-specific branches must keep a jobId"
    });
  }

  const hasDerivedSource = Boolean(branch.sourceBranchId && branch.sourceRevisionId);
  if (branch.branchPurpose === "job_specific" && !branch.sourceAdaptationDraftId && !hasDerivedSource) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceAdaptationDraftId"],
      message: "job-specific branches must keep source adaptation draft id or source branch derivation"
    });
  }

  if (branch.branchPurpose === "job_specific" && !branch.sourceJobVersion) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceJobVersion"],
      message: "job-specific branches must keep source job version"
    });
  }

  if (branch.branchPurpose === "general" && !branch.sourceImportId) {
    ctx.addIssue({
      code: "custom",
      path: ["sourceImportId"],
      message: "general branches must keep source import id"
    });
  }

  if (branch.branchPurpose === "job_specific" && branch.requirementMatchIds.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["requirementMatchIds"],
      message: "verified resume branches must keep source requirement match ids"
    });
  }

  if (branch.contentItems.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["contentItems"],
      message: "verified resume branches must contain branch content items"
    });
  }
});

export const ResumeBranchOperationTypeSchema = z.enum([
  "create_from_draft",
  "resume_import_confirm",
  "derive_job_branch",
  "manual_edit",
  "suggestion_accept",
  "reorder",
  "visibility",
  "restore",
  "undo",
  "refresh_sync_status",
  "archive",
  "legacy_migration"
]);

export const ResumeBranchOperationSchema = EntityBaseSchema.extend({
  operationId: z.string().min(1),
  branchId: z.string().optional(),
  sourceAdaptationDraftId: z.string().optional(),
  type: ResumeBranchOperationTypeSchema,
  expectedRevision: z.number().int().min(0).optional(),
  beforeRevision: z.number().int().min(0).optional(),
  afterRevision: z.number().int().min(0).optional(),
  revisionId: z.string().optional(),
  occurredAt: IsoDateStringSchema
});

export const ExportStatusSchema = z.enum([
  "direct_pdf_success",
  "print_invoked",
  "blocked_overflow",
  "failed"
]);

export const ExportMethodSchema = z.enum(["direct_pdf", "browser_print"]);

export const ExportOverflowStatusSchema = z.enum([
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

export const ExportRecordPresentationSnapshotSchema = z.object({
  templateId: z.string().min(1),
  sectionOrder: z.array(z.string().min(1)).optional(),
  itemOrderBySection: z.record(z.string(), z.array(z.string().min(1))),
  hiddenItemIds: z.array(z.string().min(1)),
  typography: z.object({
    bodyTextScale: z.enum(["small", "normal", "large"]),
    titleTextScale: z.enum(["small", "normal", "large"]),
    lineHeight: z.enum(["tight", "normal", "relaxed"])
  }).optional(),
  spacing: z.object({
    sectionGap: z.enum(["tight", "normal", "relaxed"]),
    itemGap: z.enum(["tight", "normal", "relaxed"])
  }).optional(),
  theme: z.object({
    accentColor: z.enum(["graphite", "emerald", "blue", "rose"]),
    density: z.enum(["compact", "balanced", "spacious"])
  }).optional(),
  sectionStyleOverrides: z.record(z.string(), z.object({
    showTitle: z.boolean().optional()
  })).optional(),
  pagination: z.object({
    pagePolicy: z.enum(["one_page_strict", "up_to_two_pages"]),
    pageBreakBeforeSections: z.array(z.enum(["summary", "experience", "skills", "certificates"]))
  }).optional()
});

export const ExportRecordSchema = EntityBaseSchema.extend({
  operationId: z.string().min(1),
  branchId: z.string().min(1),
  revisionId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  templateId: z.string().min(1),
  format: z.enum(["pdf", "json"]),
  fileName: z.string().min(1),
  displayName: z.string().min(1),
  exportStatus: ExportStatusSchema,
  overflowStatus: ExportOverflowStatusSchema,
  exportedAt: IsoDateStringSchema,
  errorCode: z.string().min(1).optional(),
  presentationRevision: z.number().int().min(0).optional(),
  presentationSnapshot: ExportRecordPresentationSnapshotSchema.optional(),
  exportMethod: ExportMethodSchema.optional(),
  mimeType: z.string().min(1).optional(),
  fileSize: z.number().int().min(0).optional(),
  startedAt: IsoDateStringSchema.optional(),
  completedAt: IsoDateStringSchema.optional(),
  failureCode: z.string().min(1).optional(),
  snapshotHash: z.string().min(8).optional(),
  pdfContentHash: z.string().min(8).optional(),
  pagePolicy: z.enum(["one_page_strict", "up_to_two_pages"]).optional(),
  actualPageCount: z.number().int().min(1).max(3).optional(),
  requestedMaxPages: z.number().int().min(1).max(2).optional(),
  paginationHash: z.string().min(8).optional(),
  paginationSnapshot: z.unknown().optional(),
  exceededPageLimit: z.boolean().optional(),
  continuationHeader: z.enum(["none", "candidate_name"]).optional(),
  pageSize: z.literal("A4").optional(),
  pageDimensions: z.object({
    widthMm: z.number().positive(),
    heightMm: z.number().positive()
  }).optional(),
  diagnosticsEngineVersion: z.string().min(1).optional(),
  diagnosticsSnapshotHash: z.string().min(8).optional(),
  criticalIssueCount: z.number().int().min(0).optional(),
  warningIssueCount: z.number().int().min(0).optional(),
  requirementCoverageSummary: z.object({
    totalRequirements: z.number().int().min(0),
    covered: z.number().int().min(0),
    partial: z.number().int().min(0),
    weak: z.number().int().min(0),
    uncovered: z.number().int().min(0),
    factGaps: z.number().int().min(0)
  }).optional()
});

export type BranchLifecycleStatus = z.infer<typeof BranchLifecycleStatusSchema>;
export type BranchMigrationStatus = z.infer<typeof BranchMigrationStatusSchema>;
export type ResumeBranchPurpose = z.infer<typeof ResumeBranchPurposeSchema>;
export type BranchFactRef = z.infer<typeof BranchFactRefSchema>;
export type BranchContentItemType = z.infer<typeof BranchContentItemTypeSchema>;
export type BranchContentSource = z.infer<typeof BranchContentSourceSchema>;
export type BranchGuardMode = z.infer<typeof BranchGuardModeSchema>;
export type BranchGuardStatus = z.infer<typeof BranchGuardStatusSchema>;
export type BranchGuardFindingSnapshot = z.infer<typeof BranchGuardFindingSnapshotSchema>;
export type BranchContentItem = z.infer<typeof BranchContentItemSchema>;
export type BranchSyncStatus = z.infer<typeof BranchSyncStatusSchema>;
export type ResumeBranchSnapshot = z.infer<typeof ResumeBranchSnapshotSchema>;
export type ResumeRevisionSource = z.infer<typeof ResumeRevisionSourceSchema>;
export type ResumeRevision = z.infer<typeof ResumeRevisionSchema>;
export type ResumeBranch = z.infer<typeof ResumeBranchSchema>;
export type ResumeBranchOperationType = z.infer<typeof ResumeBranchOperationTypeSchema>;
export type ResumeBranchOperation = z.infer<typeof ResumeBranchOperationSchema>;
export type ExportStatus = z.infer<typeof ExportStatusSchema>;
export type ExportMethod = z.infer<typeof ExportMethodSchema>;
export type ExportOverflowStatus = z.infer<typeof ExportOverflowStatusSchema>;
export type ExportRecordPresentationSnapshot = z.infer<typeof ExportRecordPresentationSnapshotSchema>;
export type ExportRecord = z.infer<typeof ExportRecordSchema>;
