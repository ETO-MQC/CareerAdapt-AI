import type {
  ResumePdfExportRequest,
  ResumePdfExportSnapshot,
  ResumePaginationPlan,
  ResumePresentationConfig,
  ResumeRenderModel
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { RESUME_CATALOG_VERSION } from "@/domain/resumeFields";

export function createResumePdfExportRequest(input: {
  exportId: string;
  renderModel: ResumeRenderModel;
  presentationConfig: ResumePresentationConfig;
  generatedAt: string;
  filename: string;
  overflowStatus: ResumePdfExportSnapshot["overflowStatus"];
  paginationPlan: ResumePaginationPlan;
  templateVersion?: number;
}): ResumePdfExportRequest {
  const snapshotWithoutHash = {
    renderSchemaVersion: input.renderModel.schemaVersion,
    catalogVersion: RESUME_CATALOG_VERSION,
    templateVersion: input.templateVersion ?? 1,
    branchId: input.renderModel.branchId,
    branchRevision: input.renderModel.branchRevision,
    currentRevisionId: input.renderModel.branchCurrentRevisionId,
    presentationRevision: input.presentationConfig.presentationRevision,
    templateId: input.presentationConfig.templateId,
    generatedAt: input.generatedAt,
    filename: input.filename,
    overflowStatus: input.overflowStatus,
    pagePolicy: input.paginationPlan.pagePolicy,
    requestedMaxPages: input.paginationPlan.requestedMaxPages,
    actualPageCount: input.paginationPlan.actualPageCount,
    pageBreakBeforeSections: input.paginationPlan.forcedBreakBeforeSections,
    paginationPlan: input.paginationPlan,
    paginationHash: input.paginationPlan.paginationHash,
    presentation: presentationSnapshotFromConfig(input.presentationConfig),
    renderModel: input.renderModel
  };
  const snapshotHash = hashExportSnapshot(snapshotWithoutHash);

  return {
    schemaVersion: "resume-direct-pdf-v1",
    exportId: input.exportId,
    exportMethod: "direct_pdf",
    snapshot: {
      ...snapshotWithoutHash,
      snapshotHash
    }
  };
}

export function presentationSnapshotFromConfig(config: ResumePresentationConfig): ResumePdfExportSnapshot["presentation"] {
  return {
    templateId: config.templateId,
    sectionOrder: config.sectionOrder,
    itemOrderBySection: config.itemOrderBySection,
    hiddenItemIds: config.hiddenItemIds,
    typography: config.typography,
    spacing: config.spacing,
    theme: config.theme,
    pagination: config.pagination,
    sectionStyleOverrides: config.sectionStyleOverrides,
    highlightListStyle: config.highlightListStyle,
    itemHeaderMiddleAlignment: config.itemHeaderMiddleAlignment
  };
}

export function presentationConfigFromExportSnapshot(snapshot: ResumePdfExportSnapshot): ResumePresentationConfig {
  return {
    schemaVersion: "resume-presentation-v1",
    branchId: snapshot.branchId,
    templateId: snapshot.templateId,
    contentRevision: {
      branchRevision: snapshot.branchRevision,
      currentRevisionId: snapshot.currentRevisionId
    },
    sectionOrder: snapshot.presentation.sectionOrder,
    itemOrderBySection: snapshot.presentation.itemOrderBySection,
    hiddenItemIds: snapshot.presentation.hiddenItemIds,
    typography: snapshot.presentation.typography,
    spacing: snapshot.presentation.spacing,
    theme: snapshot.presentation.theme,
    pagination: snapshot.presentation.pagination,
    sectionStyleOverrides: snapshot.presentation.sectionStyleOverrides,
    highlightListStyle: "bullet" as const,
    itemHeaderMiddleAlignment: "balanced" as const,
    presentationRevision: snapshot.presentationRevision,
    updatedAt: snapshot.generatedAt
  };
}

export function verifyExportSnapshotHash(snapshot: ResumePdfExportSnapshot) {
  return snapshot.snapshotHash === hashExportSnapshot(snapshotWithoutHash(snapshot));
}

export function hashExportSnapshot(snapshot: Omit<ResumePdfExportSnapshot, "snapshotHash">) {
  return stableHashText(stableStringify(snapshot));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function snapshotWithoutHash(snapshot: ResumePdfExportSnapshot): Omit<ResumePdfExportSnapshot, "snapshotHash"> {
  const rest: Partial<ResumePdfExportSnapshot> = { ...snapshot };
  delete rest.snapshotHash;
  return rest as Omit<ResumePdfExportSnapshot, "snapshotHash">;
}
