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
}) {
  const { branch, profile, job } = input;
  assertRenderableBranch(branch);

  if (branch.profileId !== profile.id) {
    throw new ResumeRenderMapperError("render_source_mismatch");
  }
  if (branch.branchPurpose !== "general" && (!job || branch.jobId !== job.id)) {
    throw new ResumeRenderMapperError("render_source_mismatch");
  }

  const document = mapBranchToResumeDocument({
    branch,
    profile,
    job,
    templateId: input.presentationConfig?.templateId ?? "classic-technical",
    presentationConfig: input.presentationConfig
  });
  const excludedItemIds = document.blocks
    .filter((block) => !block.visible || !block.renderable)
    .map((block) => block.contentItemId);
  const renderableBlocks = document.blocks.filter((block) => block.visible && block.renderable);
  const renderableItemIds = new Set(renderableBlocks.map((block) => block.contentItemId));
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

  const runtimeBranch = migrateResumeBranchToV2(branch);
  const seenStructuredItemIds = new Set<string>();
  const structuredItems = runtimeBranch.structuredContentItems.flatMap((item) => {
    if (!item.visible || !renderableItemIds.has(item.id)) return [];
    if (seenStructuredItemIds.has(item.id)) return [];
    seenStructuredItemIds.add(item.id);
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
      presentation: { ...presentation, id: item.id }
    }];
  });
  const structuredSections = [...new Set(structuredItems.map((item) => item.sectionId))].map((sectionId, order) => {
    const items = structuredItems.filter((item) => item.sectionId === sectionId);
    const sectionType = items[0]!.sectionType;
    return { sectionId, sectionType, title: sectionType === "custom" ? "自定义栏目" : getResumeSectionDefinition(sectionType).label, order, items };
  });

  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v2",
    branchId: branch.id,
    branchRevision: branch.revision,
    branchCurrentRevisionId: branch.currentRevisionId,
    branchName: branch.name,
    jobTitle: job?.title ?? "通用简历",
    company: job?.company ?? "未指定岗位",
    candidate: {
      name: basics.name,
      summary: basics.summary || undefined,
      contacts: [
        basics.location,
        basics.phone,
        basics.email,
        ...basics.links
      ].filter((value): value is string => Boolean(value?.trim())),
      targetRole: job?.title
    },
    sections,
    structuredSections,
    compatibilityWarnings: [],
    safety: {
      ruleOnlyItemIds: renderableBlocks.filter((block) => block.guardMode === "rule_only_verified").map((block) => block.contentItemId),
      visibleItemCount: blocks.length,
      excludedItemIds
    },
    sourceTrace: {
      profileId: profile.id,
      jobId: job?.id,
      currentRevisionId: branch.currentRevisionId,
      sourceProfileVersion: branch.sourceProfileVersion,
      sourceJobVersion: branch.sourceJobVersion
    }
  });
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
