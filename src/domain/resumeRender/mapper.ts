import {
  ResumeRenderModelSchema,
  type CareerProfile,
  type JobDescription,
  type ResumePresentationConfig,
  type ResumeBranch,
  type ResumeRenderBlock,
  type ResumeRenderSection,
  type ResumeRenderSectionType
} from "@/domain/schemas";
import { mapBranchToResumeDocument, sectionTitle } from "@/domain/resumeDocument/mapper";
import { migrateResumeBranchToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { getResumeSectionDefinition, type ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { projectResumePresentationItem } from "@/domain/resumePresentation/projector";
import { resolveResumeTargetRole } from "@/domain/branch/targetRole";
import { jobTargetSnapshotToJobDescription } from "@/domain/jobTarget/jobTargetSnapshot";
import { inspectResumeItemStructuralIntegrity, rehydrateLegacyStructuredResumeItem } from "@/domain/resumeIntegrity";
import {
  createRenderCoverageReport,
  presentationCoverage,
  renderCoverageHasBlockingFailure,
  sourceVisibleCoverage
} from "@/services/export/renderCoverage";

export class ResumeRenderMapperError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResumeRenderMapperError";
  }
}

export function mapBranchToResumeRenderModel(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job?: JobDescription;
  presentationConfig?: ResumePresentationConfig;
  coveragePolicy?: "strict" | "warn";
}) {
  const { branch, profile } = input;
  const job = input.job ?? (branch.targetSnapshot ? jobTargetSnapshotToJobDescription(branch.targetSnapshot) : undefined);
  assertRenderableBranch(branch);

  if (branch.profileId !== profile.id) {
    throw new ResumeRenderMapperError("render_source_mismatch");
  }
  if (
    branch.branchPurpose !== "general"
    && (!job || branch.jobId && branch.jobId !== job.id)
  ) {
    throw new ResumeRenderMapperError("render_source_mismatch");
  }

  const compatibilityWarnings: string[] = [];
  let runtimeStructuredContentItems: NonNullable<ResumeBranch["structuredContentItems"]> = [];
  try {
    const runtimeBranch = migrateResumeBranchToV2(branch);
    runtimeStructuredContentItems = runtimeBranch.structuredContentItems.map((item) => {
        try {
          const legacy = branch.contentItems.find((candidate) => candidate.id === item.id);
          const integrity = inspectResumeItemStructuralIntegrity(item.data, { origin: "legacy_projection", legacyTextProjection: legacy?.text });
          if (item.source === "legacy" && integrity.detectedLabels.length === 0) return item;
          const rehydrated = rehydrateLegacyStructuredResumeItem(item.data, legacy?.text, { origin: "structured" });
          return { ...item, data: rehydrated.item };
        } catch (error) {
          if (input.coveragePolicy !== "warn") throw error;
          addCompatibilityWarning(compatibilityWarnings, "兼容预览提示：部分结构化字段未能重建，已保留对应的已核验原文。正式 PDF 仍需完成结构化校验。");
          logRenderCompatibilityIssue("structured_item_rehydration", error);
          return item;
        }
      });
  } catch (error) {
    if (input.coveragePolicy !== "warn") throw error;
    addCompatibilityWarning(compatibilityWarnings, "兼容预览提示：结构化字段暂未能完整重建，已使用已核验的来源文本继续显示。正式 PDF 仍需完成结构化校验。");
    logRenderCompatibilityIssue("structured_migration", error);
  }

  const document = mapBranchToResumeDocument({
    branch,
    profile,
    job,
    templateId: input.presentationConfig?.templateId ?? "classic-technical",
    presentationConfig: input.presentationConfig
  });
  const sourceBlocks = document.blocks.filter((block) => !block.derivedFrom);
  const explicitSummaryBlock = sourceBlocks.find((block) => block.itemType === "summary");
  const visibleSummaryBlock = sourceBlocks.find((block) => block.itemType === "summary" && block.visible && block.renderable);
  const excludedItemIds = sourceBlocks
    .filter((block) => !block.visible || !block.renderable)
    .map((block) => block.contentItemId);
  const renderableBlocks = sourceBlocks.filter((block) => block.visible && block.renderable);
  const renderableItemIds = new Set(document.blocks
    .filter((block) => block.visible && block.renderable)
    .map((block) => block.contentItemId));
  const blocks = renderableBlocks.map((block): ResumeRenderBlock => ({
    sourceItemId: block.contentItemId,
    sourceSectionId: block.sourceSectionId,
    itemType: block.itemType,
    order: block.order,
    text: block.text,
    factRefKeys: block.factRefKeys,
    requirementIds: block.requirementIds,
    guardMode: block.guardMode,
    guardStatus: block.guardStatus
  }));
  const sections = document.sections
    .map((section): ResumeRenderSection => ({
      type: section.type,
      title: input.presentationConfig?.sectionStyleOverrides[section.type]?.titleOverride ?? sectionTitle(section.type),
      blocks: blocks.filter((block) => blockType(block) === section.type)
    }))
    .filter((section) => section.blocks.length > 0);

  const basics = branch.resumeBasics ?? {
    name: profile.basics.name,
    email: profile.basics.email ?? "",
    phone: profile.basics.phone ?? "",
    location: profile.basics.location ?? "",
    summary: profile.basics.summary ?? "",
    links: profile.basics.links
  };

  const targetRole = resolveResumeTargetRole({ branch, profile, job });
  const persistedSummaryItem = runtimeStructuredContentItems.find((item) => item.data.sectionType === "summary");
  const derivedSummaryItemId = `derived-summary:${branch.id}`;
  const seenStructuredItemIds = new Set<string>();
  const structuredItems = runtimeStructuredContentItems.flatMap((item) => {
    if (!item.visible || !renderableItemIds.has(item.id)) return [];
    if (seenStructuredItemIds.has(item.id)) return [];
    seenStructuredItemIds.add(item.id);
    try {
      const sourceSectionId = branch.contentItems.find((legacy) => legacy.id === item.id)?.sourceSectionId;
      const sectionType = canonicalRenderSection(item.data.sectionType, sourceSectionId);
      const sectionId = sourceSectionId?.startsWith("custom:") ? sourceSectionId : sectionType;
      const presentation = projectResumePresentationItem(item.data);
      return [{
        sectionId,
        sectionType,
        itemId: item.id,
        data: item.data,
        plainText: projectResumeItemV2(item.data),
        presentation: { ...presentation, id: item.id, sourceItemId: item.id }
      }];
    } catch (error) {
      if (input.coveragePolicy !== "warn") throw error;
      addCompatibilityWarning(compatibilityWarnings, "兼容预览提示：部分结构化字段未能投影，已保留对应的已核验原文块。");
      logRenderCompatibilityIssue("structured_item_projection", error);
      return [];
    }
  });
  if (visibleSummaryBlock) {
    const data = persistedSummaryItem?.data.sectionType === "summary"
      ? { ...persistedSummaryItem.data, id: visibleSummaryBlock.contentItemId, text: visibleSummaryBlock.text }
      : { id: visibleSummaryBlock.contentItemId, sectionType: "summary" as const, text: visibleSummaryBlock.text, customFields: [] };
    const presentation = projectResumePresentationItem(data);
    const summaryItem = {
      sectionId: "summary",
      sectionType: "summary" as const,
      itemId: visibleSummaryBlock.contentItemId,
      data,
      plainText: data.text,
      presentation: { ...presentation, id: visibleSummaryBlock.contentItemId, sourceItemId: visibleSummaryBlock.contentItemId }
    };
    const withoutSummary = structuredItems.filter((item) => item.sectionType !== "summary");
    structuredItems.splice(0, structuredItems.length, summaryItem, ...withoutSummary);
  }
  if (basics.summary?.trim() && !explicitSummaryBlock && !structuredItems.some((item) => item.sectionType === "summary") && renderableItemIds.has(derivedSummaryItemId)) {
    const itemId = derivedSummaryItemId;
    const data = { id: itemId, sectionType: "summary" as const, text: basics.summary.trim(), customFields: [] };
    const presentation = projectResumePresentationItem(data);
    structuredItems.unshift({
      sectionId: "summary",
      sectionType: "summary",
      itemId,
      data,
      plainText: data.text,
      presentation: { ...presentation, id: itemId, sourceItemId: itemId }
    });
  }
  const structuredSections = [...new Set(structuredItems.map((item) => item.sectionId))].map((sectionId, order) => {
    const items = structuredItems.filter((item) => item.sectionId === sectionId);
    const sectionType = items[0]!.sectionType;
    return { sectionId, sectionType, title: sectionType === "custom" ? "自定义栏目" : getResumeSectionDefinition(sectionType).label, order, items };
  });

  const modelInput = {
    schemaVersion: "resume-render-v2",
    branchId: branch.id,
    branchRevision: branch.revision,
    branchCurrentRevisionId: branch.currentRevisionId,
    branchName: branch.name,
    jobTitle: targetRole ?? (branch.branchPurpose === "job_specific" ? job?.title : undefined) ?? "通用简历",
    company: job?.company ?? "通用简历",
    candidate: {
      name: basics.name,
      summary: basics.summary || undefined,
      contacts: [
        basics.location,
        basics.phone,
        basics.email,
        ...basics.links
      ].filter((value): value is string => Boolean(value?.trim())),
      targetRole
    },
    sections,
    structuredSections,
    compatibilityWarnings,
    safety: {
      ruleOnlyItemIds: renderableBlocks.filter((block) => block.guardMode === "rule_only_verified").map((block) => block.contentItemId),
      visibleItemCount: structuredItems.length,
      excludedItemIds
    },
    sourceTrace: {
      profileId: profile.id,
      jobId: job?.id,
      currentRevisionId: branch.currentRevisionId,
      sourceProfileVersion: branch.sourceProfileVersion,
      sourceJobVersion: branch.sourceJobVersion
    }
  };
  const parsedModel = ResumeRenderModelSchema.safeParse(modelInput);
  let model = parsedModel.success ? parsedModel.data : undefined;
  if (!model) {
    if (input.coveragePolicy !== "warn") throw parsedModel.error;
    addCompatibilityWarning(compatibilityWarnings, "兼容预览提示：结构化预览模型校验未通过，已使用来源文本生成兼容预览。");
    logRenderCompatibilityIssue("render_model_schema", parsedModel.error);
    model = ResumeRenderModelSchema.parse({
      ...modelInput,
      structuredSections: [],
      compatibilityWarnings,
      safety: {
        ...modelInput.safety,
        visibleItemCount: renderableBlocks.length
      }
    });
  }
  const sourceCoverage = sourceVisibleCoverage({ branch, document, derivedSummary: basics.summary });
  const coverage = createRenderCoverageReport({
    source: sourceCoverage,
    presentation: presentationCoverage(model)
  });
  const hasCoverageFailure = renderCoverageHasBlockingFailure(coverage);
  if (hasCoverageFailure && input.coveragePolicy !== "warn") {
    throw new ResumeRenderMapperError("render_coverage_failed");
  }
  const completePreviewModel = hasCoverageFailure && input.coveragePolicy === "warn" && model.schemaVersion === "resume-render-v2"
    ? ResumeRenderModelSchema.parse({
        ...model,
        structuredSections: [],
        compatibilityWarnings: [
          ...model.compatibilityWarnings,
          "兼容预览提示：结构化内容未完整投影，已切换到来源文本布局，确保所有已核验内容可见。"
        ],
        safety: {
          ...model.safety,
          visibleItemCount: renderableBlocks.length
        }
      })
    : model;
  return ResumeRenderModelSchema.parse({
    ...completePreviewModel,
    compatibilityWarnings: [
      ...(completePreviewModel.schemaVersion === "resume-render-v2" ? completePreviewModel.compatibilityWarnings : []),
      ...(hasCoverageFailure ? [renderCoverageWarning(coverage)] : [])
    ]
  });
}

function addCompatibilityWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) warnings.push(warning);
}

function logRenderCompatibilityIssue(stage: string, error: unknown) {
  if (process.env.NODE_ENV === "production") return;
  const issueCode = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
    ? error.issues
      .slice(0, 4)
      .map((issue: unknown) => {
        if (!issue || typeof issue !== "object") return "unknown";
        const value = issue as { path?: unknown; code?: unknown };
        const path = Array.isArray(value.path) ? value.path.join(".") : "root";
        return `${path}:${typeof value.code === "string" ? value.code : "invalid"}`;
      })
      .join(",")
    : error instanceof Error ? error.name : "unknown";
  console.warn("[resume-render:compatibility]", { stage, issueCode });
}

function renderCoverageWarning(report: ReturnType<typeof createRenderCoverageReport>) {
  const issues = [
    report.silentDroppedItemCount > 0 ? `${report.silentDroppedItemCount} 项内容未完整映射` : undefined,
    report.silentDroppedSectionCount > 0 ? `${report.silentDroppedSectionCount} 个栏目未完整映射` : undefined,
    report.duplicateRenderedItemCount > 0 ? `${report.duplicateRenderedItemCount} 项内容重复显示` : undefined,
    report.duplicateRenderedSectionCount > 0 ? `${report.duplicateRenderedSectionCount} 个栏目重复显示` : undefined,
    report.genericExperienceRendered > 0 ? "存在未关联来源的经历块" : undefined
  ].filter((value): value is string => Boolean(value));
  return `兼容预览提示：${issues.join("；")}。已先显示可渲染内容；正式 PDF 默认仍会拦截此问题，确认后可选择继续导出。`;
}

function canonicalRenderSection(dataSection: ResumeSectionTypeV2, sourceSectionId?: string): Exclude<ResumeSectionTypeV2, "basics"> {
  if (sourceSectionId?.startsWith("custom:")) return "custom";
  return dataSection === "basics" ? "other" : dataSection;
}

function assertRenderableBranch(branch: ResumeBranch) {
  if (branch.migrationStatus !== "verified") {
    throw new ResumeRenderMapperError("legacy_branch_cannot_render");
  }
  if (branch.lifecycleStatus !== "active") {
    throw new ResumeRenderMapperError("archived_branch_cannot_render");
  }
  if (!branch.currentRevisionId) {
    throw new ResumeRenderMapperError("branch_current_revision_missing");
  }
  if (branch.syncStatusCache.status === "invalid_reference") {
    throw new ResumeRenderMapperError("branch_invalid_reference");
  }
}

function blockType(block: ResumeRenderBlock): ResumeRenderSectionType {
  if (block.itemType === "summary") {
    return "summary";
  }
  if (block.itemType === "skill") {
    return "skills";
  }
  if (block.itemType === "certificate") {
    return "certificates";
  }
  return "experience";
}
