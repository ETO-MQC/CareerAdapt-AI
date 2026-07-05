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
  const blocks = renderableBlocks.map((block): ResumeRenderBlock => ({
    sourceItemId: block.contentItemId,
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
      title: sectionTitle(section.type),
      blocks: blocks.filter((block) => blockType(block) === section.type)
    }))
    .filter((section) => section.blocks.length > 0);

  if (blocks.length === 0) {
    throw new ResumeRenderMapperError("render_model_requires_visible_content");
  }

  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v1",
    branchId: branch.id,
    branchRevision: branch.revision,
    branchCurrentRevisionId: branch.currentRevisionId,
    branchName: branch.name,
    jobTitle: job?.title ?? "通用简历",
    company: job?.company ?? "未指定岗位",
    candidate: {
      name: profile.basics.name,
      summary: profile.basics.summary,
      contacts: [
        profile.basics.location,
        profile.basics.phone,
        profile.basics.email,
        ...profile.basics.links
      ].filter((value): value is string => Boolean(value?.trim())),
      targetRole: job?.title
    },
    sections,
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
