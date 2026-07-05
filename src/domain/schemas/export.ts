import { z } from "zod";
import { IsoDateStringSchema } from "./common";
import {
  OverflowStatusSchema,
  ResumeRenderModelSchema,
  ResumeRenderSectionTypeSchema,
  TemplateIdSchema
} from "./resumeRender";
import {
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
    showTitle: z.boolean().optional()
  }))
});

export const ResumePdfExportSnapshotSchema = z.object({
  branchId: z.string().min(1),
  branchRevision: z.number().int().min(0),
  currentRevisionId: z.string().min(1),
  presentationRevision: z.number().int().min(0),
  templateId: TemplateIdSchema,
  generatedAt: IsoDateStringSchema,
  filename: SafePdfFileNameSchema,
  overflowStatus: OverflowStatusSchema,
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
});

export const ResumePdfExportRequestSchema = z.object({
  schemaVersion: z.literal("resume-direct-pdf-v1"),
  exportId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/),
  exportMethod: z.literal("direct_pdf"),
  snapshot: ResumePdfExportSnapshotSchema
});

export type ResumePdfExportSnapshot = z.infer<typeof ResumePdfExportSnapshotSchema>;
export type ResumePdfExportRequest = z.infer<typeof ResumePdfExportRequestSchema>;
