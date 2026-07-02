import {
  ResumeRenderModelSchema,
  type BranchContentItem,
  type CareerProfile,
  type JobDescription,
  type ResumeBranch,
  type ResumeRenderBlock,
  type ResumeRenderSection,
  type ResumeRenderSectionType
} from "@/domain/schemas";
import { branchFactRefKey, resolveBranchFactRefs } from "@/domain/branch/validation";

export class ResumeRenderMapperError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ResumeRenderMapperError";
  }
}

export function mapBranchToResumeRenderModel(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job: JobDescription;
}) {
  const { branch, profile, job } = input;
  assertRenderableBranch(branch);

  if (branch.profileId !== profile.id || branch.jobId !== job.id) {
    throw new ResumeRenderMapperError("render_source_mismatch");
  }

  const excludedItemIds: string[] = [];
  const renderableItems = branch.contentItems
    .filter((item) => {
      if (!item.visible) {
        excludedItemIds.push(item.id);
        return false;
      }
      if (item.guardStatus !== "pass" && item.guardStatus !== "ai_failed_rule_kept") {
        excludedItemIds.push(item.id);
        return false;
      }
      return true;
    })
    .sort((a, b) => sectionRank(a.itemType) - sectionRank(b.itemType) || a.order - b.order);

  for (const item of renderableItems) {
    if (item.itemType !== "structural") {
      resolveBranchFactRefs(profile, item.factRefs);
    }
  }

  const blocks = renderableItems.map(toRenderBlock);
  const sections = buildSections(blocks);

  if (blocks.length === 0) {
    throw new ResumeRenderMapperError("render_model_requires_visible_content");
  }

  return ResumeRenderModelSchema.parse({
    schemaVersion: "resume-render-v1",
    branchId: branch.id,
    branchRevision: branch.revision,
    branchCurrentRevisionId: branch.currentRevisionId,
    branchName: branch.name,
    jobTitle: job.title,
    company: job.company,
    candidate: {
      name: profile.basics.name,
      summary: profile.basics.summary,
      contacts: [
        profile.basics.location,
        profile.basics.phone,
        profile.basics.email,
        ...profile.basics.links
      ].filter((value): value is string => Boolean(value?.trim())),
      targetRole: job.title
    },
    sections,
    safety: {
      ruleOnlyItemIds: renderableItems.filter((item) => item.guardMode === "rule_only_verified").map((item) => item.id),
      visibleItemCount: blocks.length,
      excludedItemIds
    },
    sourceTrace: {
      profileId: profile.id,
      jobId: job.id,
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

function toRenderBlock(item: BranchContentItem): ResumeRenderBlock {
  return {
    sourceItemId: item.id,
    itemType: item.itemType,
    order: item.order,
    text: item.text,
    factRefKeys: item.factRefs.map(branchFactRefKey),
    requirementIds: item.requirementIds,
    guardMode: item.guardMode,
    guardStatus: item.guardStatus
  };
}

function buildSections(blocks: ResumeRenderBlock[]): ResumeRenderSection[] {
  const sectionTypes: ResumeRenderSectionType[] = ["summary", "skills", "experience", "certificates"];
  return sectionTypes
    .map((type) => ({
      type,
      title: sectionTitle(type),
      blocks: blocks.filter((block) => blockType(block) === type)
    }))
    .filter((section) => section.blocks.length > 0);
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

function sectionTitle(type: ResumeRenderSectionType) {
  if (type === "summary") {
    return "岗位概览";
  }
  if (type === "skills") {
    return "技能";
  }
  if (type === "certificates") {
    return "证书";
  }
  return "项目与经历";
}

function sectionRank(itemType: BranchContentItem["itemType"]) {
  if (itemType === "summary") {
    return 0;
  }
  if (itemType === "skill") {
    return 1;
  }
  if (itemType === "certificate") {
    return 3;
  }
  return 2;
}
