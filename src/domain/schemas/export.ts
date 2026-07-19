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
  PresentationEnglishFontFamilySchema,
  PresentationFontFamilySchema,
  PresentationHeaderFooterSchema,
  PresentationLineHeightSchema,
  PresentationPageMarginSchema,
  PresentationSpacingScaleSchema,
  PresentationTitleTextScaleSchema,
  PresentationHighlightListStyleSchema,
  PresentationItemHeaderMiddleAlignmentSchema
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
    chineseFont: PresentationFontFamilySchema,
    englishFont: PresentationEnglishFontFamilySchema,
    bodyTextScale: PresentationBodyTextScaleSchema,
    titleTextScale: PresentationTitleTextScaleSchema,
    lineHeight: PresentationLineHeightSchema
  }),
  spacing: z.object({
    pageMargin: PresentationPageMarginSchema,
    sectionGap: PresentationSpacingScaleSchema,
    itemGap: PresentationSpacingScaleSchema
  }),
  theme: z.object({
    primaryColor: PresentationAccentColorSchema,
    accentColor: PresentationAccentColorSchema,
    dividerColor: PresentationAccentColorSchema,
    density: PresentationDensitySchema
  }),
  sectionStyleOverrides: z.record(z.string(), z.object({
    showTitle: z.boolean().optional(),
    titleOverride: z.string().trim().min(1).max(80).optional()
  })),
  pagination: z.object({
    pagePolicy: ResumePagePolicySchema,
    preferredPageCount: z.union([z.literal(1), z.literal(2)]),
    maximumPageCount: z.literal(4),
    overflowBehavior: z.enum(["warn", "allow"]),
    headerFooter: PresentationHeaderFooterSchema,
    showPhoto: z.boolean(),
    pageBreakBeforeSections: z.array(ResumeRenderSectionTypeSchema)
  }),
  highlightListStyle: PresentationHighlightListStyleSchema.default("bullet"),
  itemHeaderMiddleAlignment: PresentationItemHeaderMiddleAlignmentSchema.default("balanced")
});

export const ResumePaginationPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  sectionTypes: z.array(z.string()),
  itemIdsBySection: z.record(z.string(), z.array(z.string().min(1))),
  blockIds: z.array(z.string().min(1)),
  utilization: z.object({
    usedHeight: z.number().nonnegative(),
    availableHeight: z.number().positive(),
    ratio: z.number().nonnegative()
  }).optional(),
  itemFragments: z.array(z.object({
    sectionId: z.string().min(1),
    sectionType: z.string().min(1),
    itemId: z.string().min(1),
    fragmentIndex: z.number().int().min(0),
    includeSectionTitle: z.boolean(),
    unitKeys: z.array(z.string().min(1)).min(1)
  }).strict()).optional()
});

export const ResumePaginationPlanSchema = z.object({
  schemaVersion: z.literal("resume-pagination-v1"),
  pagePolicy: ResumePagePolicySchema,
  requestedMaxPages: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  preferredPageCount: z.union([z.literal(1), z.literal(2)]),
  maximumPageCount: z.literal(4),
  overflowBehavior: z.enum(["warn", "allow"]),
  actualPageCount: z.number().int().min(1),
  status: ResumePaginationStatusSchema,
  pages: z.array(ResumePaginationPageSchema).min(1),
  forcedBreakBeforeSections: z.array(z.string()),
  overflowBlockIds: z.array(z.string().min(1)),
  oversizedBlockIds: z.array(z.string().min(1)).default([]),
  issues: z.array(z.enum([
    "oversized_content",
    "prefer_one_page_overflow",
    "strict_one_page_overflow",
    "exceeds_two_pages",
    "horizontal_overflow",
    "measurement_failed"
  ])).optional(),
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
  requestedMaxPages: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  actualPageCount: z.number().int().min(1),
  pageBreakBeforeSections: z.array(z.string()),
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
