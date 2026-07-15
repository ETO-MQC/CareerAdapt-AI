import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import {
  OverflowStatusSchema,
  ResumePaginationStatusSchema,
  ResumeRenderModelSchema,
  ResumeRenderSectionTypeSchema,
  TemplateIdSchema
} from "./resumeRender";
import {
  ResumePagePolicySchema,
  PresentationAccentColorSchema,
  PresentationBodyTextScaleSchema,
  PresentationDensitySchema,
  PresentationLineHeightSchema,
  PresentationSpacingScaleSchema,
  PresentationTitleTextScaleSchema
} from "./presentation";

export const SafePdfFileNameSchema = z.string()
  .min(1)
  .max(120)
  .regex(/^[^\\/:*?"<>|\u0000-\u001F]+\.pdf$/)
  .refine((value) => !value.includes("..") && !value.endsWith(".pdf.pdf"), "unsafe pdf filename");

export const ExportSnapshotPresentationSchema = z.object({
  templateId: TemplateIdSchema,
  sectionOrder: z.array(ResumeRenderSectionTypeSchema),
  itemOrderBySection: z.record(z.string(), z.array(z.string().min(1))),
  hiddenItemIds: z.array(z.string().min(1)),
  typography: z.object({
    bodyTextScale: PresentationBodyTextScaleSchema,
    titleTextScale: PresentationTitleTextScaleSchema,
    lineHeight: PresentationLineHeightSchema
  }),
  spacing: z.object({
    sectionGap: PresentationSpacingScaleSchema,
    itemGap: PresentationSpacingScaleSchema
  }),
  theme: z.object({
    accentColor: PresentationAccentColorSchema,
    density: PresentationDensitySchema
  }),
  sectionStyleOverrides: z.record(z.string(), z.object({
    showTitle: z.boolean().optional(),
    titleOverride: z.string().trim().min(1).max(80).optional()
  })),
  pagination: z.object({
    pagePolicy: ResumePagePolicySchema,
    pageBreakBeforeSections: z.array(ResumeRenderSectionTypeSchema)
  })
});

export const ResumePaginationPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(3),
  sectionTypes: z.array(ResumeRenderSectionTypeSchema),
  itemIdsBySection: z.record(z.string(), z.array(z.string().min(1))),
  blockIds: z.array(z.string().min(1))
});

export const ResumePaginationPlanSchema = z.object({
  schemaVersion: z.literal("resume-pagination-v1"),
  pagePolicy: ResumePagePolicySchema,
  requestedMaxPages: z.union([z.literal(1), z.literal(2)]),
  actualPageCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: ResumePaginationStatusSchema,
  pages: z.array(ResumePaginationPageSchema).min(1).max(3),
  forcedBreakBeforeSections: z.array(ResumeRenderSectionTypeSchema),
  overflowBlockIds: z.array(z.string().min(1)),
  oversizedBlockIds: z.array(z.string().min(1)).default([]),
  measurement: z.object({
    scrollHeight: z.number().nonnegative(),
    clientHeight: z.number().positive(),
    remainingPx: z.number()
  }),
  paginationHash: z.string().min(8)
});

export const ResumePdfExportSnapshotSchema = z.object({
  renderSchemaVersion: z.enum(["resume-render-v1", "resume-render-v2"]),
  catalogVersion: z.string().min(1),
  templateVersion: z.number().int().positive(),
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  currentRevisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  templateId: TemplateIdSchema,
  generatedAt: IsoDateStringSchema,
  filename: SafePdfFileNameSchema,
  overflowStatus: OverflowStatusSchema,
  pagePolicy: ResumePagePolicySchema,
  requestedMaxPages: z.union([z.literal(1), z.literal(2)]),
  actualPageCount: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  pageBreakBeforeSections: z.array(ResumeRenderSectionTypeSchema),
  paginationPlan: ResumePaginationPlanSchema,
  paginationHash: z.string().min(8),
  presentation: ExportSnapshotPresentationSchema,
  renderModel: ResumeRenderModelSchema,
  snapshotHash: z.string().min(8)
}).superRefine((snapshot, ctx) => {
  if (snapshot.branchId !== snapshot.renderModel.branchId) {
    ctx.addIssue({
      code: "custom",
      path: ["renderModel", "branchId"],
      message: "snapshot branchId must match renderModel branchId"
    });
  }
  if (snapshot.branchRevision !== snapshot.renderModel.branchRevision) {
    ctx.addIssue({
      code: "custom",
      path: ["renderModel", "branchRevision"],
      message: "snapshot branchRevision must match renderModel branchRevision"
    });
  }
  if (snapshot.currentRevisionId !== snapshot.renderModel.branchCurrentRevisionId) {
    ctx.addIssue({
      code: "custom",
      path: ["renderModel", "branchCurrentRevisionId"],
      message: "snapshot currentRevisionId must match renderModel currentRevisionId"
    });
  }
  if (snapshot.templateId !== snapshot.presentation.templateId) {
    ctx.addIssue({
      code: "custom",
      path: ["presentation", "templateId"],
      message: "snapshot templateId must match presentation templateId"
    });
  }
  if (snapshot.pagePolicy !== snapshot.paginationPlan.pagePolicy) {
    ctx.addIssue({
      code: "custom",
      path: ["paginationPlan", "pagePolicy"],
      message: "snapshot pagePolicy must match pagination plan"
    });
  }
  if (snapshot.requestedMaxPages !== snapshot.paginationPlan.requestedMaxPages) {
    ctx.addIssue({
      code: "custom",
      path: ["paginationPlan", "requestedMaxPages"],
      message: "snapshot requestedMaxPages must match pagination plan"
    });
  }
  if (snapshot.actualPageCount !== snapshot.paginationPlan.actualPageCount) {
    ctx.addIssue({
      code: "custom",
      path: ["paginationPlan", "actualPageCount"],
      message: "snapshot actualPageCount must match pagination plan"
    });
  }
  if (snapshot.paginationHash !== snapshot.paginationPlan.paginationHash) {
    ctx.addIssue({
      code: "custom",
      path: ["paginationHash"],
      message: "snapshot paginationHash must match pagination plan"
    });
  }
});

export const ResumePdfExportRequestSchema = z.object({
  schemaVersion: z.literal("resume-direct-pdf-v1"),
  exportId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  exportMethod: z.literal("direct_pdf"),
  snapshot: ResumePdfExportSnapshotSchema
});

export type ResumePaginationPage = z.infer<typeof ResumePaginationPageSchema>;
export type ResumePaginationPlan = z.infer<typeof ResumePaginationPlanSchema>;
export type ResumePdfExportSnapshot = z.infer<typeof ResumePdfExportSnapshotSchema>;
export type ResumePdfExportRequest = z.infer<typeof ResumePdfExportRequestSchema>;
