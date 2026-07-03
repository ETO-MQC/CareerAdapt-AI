import {
  type BranchContentItem,
  type BranchGuardStatus,
  type CareerProfile,
  type JobDescription,
  type ResumeBranch,
  type ResumeRenderSectionType,
  type TemplateId
} from "@/domain/schemas";
import { branchFactRefKey, resolveBranchFactRefs } from "@/domain/branch/validation";

export type ResumeDocumentBlock = {
  id: string;
  contentItemId: string;
  sectionType: ResumeRenderSectionType;
  itemType: BranchContentItem["itemType"];
  text: string;
  order: number;
  visible: boolean;
  renderable: boolean;
  editable: boolean;
  guardStatus: BranchGuardStatus;
  guardMode: BranchContentItem["guardMode"];
  guardRiskLevel: BranchContentItem["guardRiskLevel"];
  factRefKeys: string[];
  requirementIds: string[];
  notRenderableReason?: string;
  notEditableReason?: string;
};

export type ResumeDocumentSection = {
  type: ResumeRenderSectionType;
  title: string;
  blocks: ResumeDocumentBlock[];
};

export type ResumeDocument = {
  id: string;
  branchId: string;
  profileId: string;
  jobId: string;
  templateId: TemplateId;
  branchRevision: number;
  branchCurrentRevisionId: string;
  sections: ResumeDocumentSection[];
  blocks: ResumeDocumentBlock[];
  editable: boolean;
  notEditableReason?: string;
};

export function mapBranchToResumeDocument(input: {
  branch: ResumeBranch;
  profile: CareerProfile;
  job: JobDescription;
  templateId: TemplateId;
}): ResumeDocument {
  const branchEditability = getBranchEditability(input.branch);
  const blocks = [...input.branch.contentItems]
    .sort((a, b) => sectionRank(a.itemType) - sectionRank(b.itemType) || a.order - b.order)
    .map((item) => mapContentItemToBlock({
      item,
      profile: input.profile,
      branchEditable: branchEditability.editable,
      branchNotEditableReason: branchEditability.reason
    }));

  return {
    id: `resume-document:${input.branch.id}:${input.branch.currentRevisionId ?? "missing"}`,
    branchId: input.branch.id,
    profileId: input.profile.id,
    jobId: input.job.id,
    templateId: input.templateId,
    branchRevision: input.branch.revision,
    branchCurrentRevisionId: input.branch.currentRevisionId ?? "",
    sections: buildSections(blocks),
    blocks,
    editable: branchEditability.editable,
    notEditableReason: branchEditability.reason
  };
}

export function getBranchEditability(branch: ResumeBranch): { editable: boolean; reason?: string } {
  if (branch.migrationStatus !== "verified") {
    return { editable: false, reason: "legacy_unverified" };
  }
  if (branch.lifecycleStatus !== "active") {
    return { editable: false, reason: "archived" };
  }
  if (!branch.currentRevisionId) {
    return { editable: false, reason: "missing_current_revision" };
  }
  if (branch.syncStatusCache.status === "invalid_reference") {
    return { editable: false, reason: "invalid_reference" };
  }
  return { editable: true };
}

export function isRenderableContentItem(input: {
  item: BranchContentItem;
  profile: CareerProfile;
}): { renderable: boolean; reason?: string } {
  if (input.item.guardStatus !== "pass" && input.item.guardStatus !== "ai_failed_rule_kept") {
    return { renderable: false, reason: "guard_not_passed" };
  }

  if (input.item.itemType === "structural") {
    return { renderable: true };
  }

  try {
    resolveBranchFactRefs(input.profile, input.item.factRefs);
    return { renderable: true };
  } catch {
    return { renderable: false, reason: "invalid_fact_reference" };
  }
}

export function sectionTitle(type: ResumeRenderSectionType) {
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

export function blockSectionType(itemType: BranchContentItem["itemType"]): ResumeRenderSectionType {
  if (itemType === "summary") {
    return "summary";
  }
  if (itemType === "skill") {
    return "skills";
  }
  if (itemType === "certificate") {
    return "certificates";
  }
  return "experience";
}

function mapContentItemToBlock(input: {
  item: BranchContentItem;
  profile: CareerProfile;
  branchEditable: boolean;
  branchNotEditableReason?: string;
}): ResumeDocumentBlock {
  const renderability = isRenderableContentItem({ item: input.item, profile: input.profile });
  const editable = input.branchEditable && input.item.itemType !== "structural";
  return {
    id: input.item.id,
    contentItemId: input.item.id,
    sectionType: blockSectionType(input.item.itemType),
    itemType: input.item.itemType,
    text: input.item.text,
    order: input.item.order,
    visible: input.item.visible,
    renderable: renderability.renderable,
    editable,
    guardStatus: input.item.guardStatus,
    guardMode: input.item.guardMode,
    guardRiskLevel: input.item.guardRiskLevel,
    factRefKeys: input.item.factRefs.map(branchFactRefKey),
    requirementIds: input.item.requirementIds,
    notRenderableReason: renderability.reason,
    notEditableReason: editable ? undefined : input.branchNotEditableReason ?? "structural_content"
  };
}

function buildSections(blocks: ResumeDocumentBlock[]): ResumeDocumentSection[] {
  const sectionTypes: ResumeRenderSectionType[] = ["summary", "skills", "experience", "certificates"];
  return sectionTypes.map((type) => ({
    type,
    title: sectionTitle(type),
    blocks: blocks.filter((block) => block.sectionType === type)
  }));
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
