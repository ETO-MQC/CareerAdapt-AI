import {
  type BranchContentItem,
  type BranchGuardStatus,
  type CareerProfile,
  type JobDescription,
  type ResumePresentationConfig,
  type ResumeBranch,
  type ResumeRenderSectionType,
  type TemplateId
} from "@/domain/schemas";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";
import { branchFactRefKey, resolveBranchFactRefs } from "@/domain/branch/validation";
import { stableHashText } from "@/services/security/text";

export type ResumeDocumentBlock = {
  id: string;
  contentItemId: string;
  sectionType: ResumeRenderSectionType;
  sourceSectionId?: string;
  canonicalSectionType?: string;
  itemType: BranchContentItem["itemType"];
  text: string;
  order: number;
  contentVisible: boolean;
  presentationHidden: boolean;
  visible: boolean;
  renderable: boolean;
  editable: boolean;
  guardStatus: BranchGuardStatus;
  guardMode: BranchContentItem["guardMode"];
  guardRiskLevel: BranchContentItem["guardRiskLevel"];
  factRefKeys: string[];
  requirementIds: string[];
  hiddenReason?: "hidden_by_content" | "hidden_by_presentation";
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
  jobId?: string;
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
  job?: JobDescription;
  templateId: TemplateId;
  presentationConfig?: ResumePresentationConfig;
}): ResumeDocument {
  if (input.branch.branchPurpose !== "general" && (!input.job || input.branch.jobId !== input.job.id)) {
    throw new Error("resume_document_source_job_missing");
  }
  const branchEditability = getBranchEditability(input.branch);
  const structuredByItem = new Map((input.branch.structuredContentItems ?? []).map((s) => [s.id, s.data.sectionType]));
  const baseBlocks = [...input.branch.contentItems]
    .sort((a, b) => sectionRank(a.itemType) - sectionRank(b.itemType) || a.order - b.order)
    .map((item) => mapContentItemToBlock({
      item,
      profile: input.profile,
      branchEditable: branchEditability.editable,
      branchNotEditableReason: branchEditability.reason,
      canonicalSectionType: structuredByItem.get(item.id)
    }));
  const blocks = applyPresentationConfig(baseBlocks, input.presentationConfig);

  return {
    id: `resume-document:${input.branch.id}:${input.branch.currentRevisionId ?? "missing"}`,
    branchId: input.branch.id,
    profileId: input.profile.id,
    jobId: input.job?.id,
    templateId: input.templateId,
    branchRevision: input.branch.revision,
    branchCurrentRevisionId: input.branch.currentRevisionId ?? "",
    sections: buildSections(blocks, input.presentationConfig),
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

  if (input.item.userConfirmation?.scope === "resume_only") {
    return input.item.source === "user_manual"
      && input.item.userConfirmation.confirmedTextHash === stableHashText(input.item.text)
      ? { renderable: true }
      : { renderable: false, reason: "resume_only_confirmation_mismatch" };
  }

  if (input.item.factRefs.length === 0) {
    return { renderable: false, reason: "missing_fact_reference" };
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
    return "自我评价";
  }
  if (type === "skills") {
    return "技能";
  }
  if (type === "certificates") {
    return "证书";
  }
  return "经历";
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
  canonicalSectionType?: string;
}): ResumeDocumentBlock {
  const renderability = isRenderableContentItem({ item: input.item, profile: input.profile });
  const editable = input.branchEditable && input.item.itemType !== "structural";
  const contentVisible = input.item.visible;
  return {
    id: input.item.id,
    contentItemId: input.item.id,
    sectionType: blockSectionType(input.item.itemType),
    sourceSectionId: input.item.sourceSectionId,
    canonicalSectionType: input.canonicalSectionType,
    itemType: input.item.itemType,
    text: input.item.text,
    order: input.item.order,
    contentVisible,
    presentationHidden: false,
    visible: contentVisible,
    renderable: renderability.renderable,
    editable,
    guardStatus: input.item.guardStatus,
    guardMode: input.item.guardMode,
    guardRiskLevel: input.item.guardRiskLevel,
    factRefKeys: input.item.factRefs.map(branchFactRefKey),
    requirementIds: input.item.requirementIds,
    hiddenReason: contentVisible ? undefined : "hidden_by_content",
    notRenderableReason: renderability.reason,
    notEditableReason: editable ? undefined : input.branchNotEditableReason ?? "structural_content"
  };
}

function buildSections(blocks: ResumeDocumentBlock[], presentationConfig?: ResumePresentationConfig): ResumeDocumentSection[] {
  const sectionTypes = sanitizeSectionOrder(presentationConfig?.sectionOrder);
  return sectionTypes.map((type) => ({
    type,
    title: sectionTitle(type),
    blocks: blocks.filter((block) => block.sectionType === type)
  }));
}

function applyPresentationConfig(
  blocks: ResumeDocumentBlock[],
  presentationConfig?: ResumePresentationConfig
): ResumeDocumentBlock[] {
  const hiddenItemIds = new Set(presentationConfig?.hiddenItemIds ?? []);
  const sectionTypes = sanitizeSectionOrder(presentationConfig?.sectionOrder);

  return sectionTypes.flatMap((sectionType) => {
    const sectionBlocks = blocks
      .filter((block) => block.sectionType === sectionType)
      .sort((a, b) => a.order - b.order || a.contentItemId.localeCompare(b.contentItemId));
    const sectionItemIds = new Set(sectionBlocks.map((block) => block.contentItemId));
    const configuredOrder = (presentationConfig?.itemOrderBySection[sectionType] ?? [])
      .filter((itemId, index, source) => sectionItemIds.has(itemId) && source.indexOf(itemId) === index);
    const missingOrder = sectionBlocks
      .map((block) => block.contentItemId)
      .filter((itemId) => !configuredOrder.includes(itemId));
    const order = [...configuredOrder, ...missingOrder];

    const orderedBlocks: ResumeDocumentBlock[] = [];
    for (const [index, itemId] of order.entries()) {
      const block = sectionBlocks.find((candidate) => candidate.contentItemId === itemId);
      if (!block) {
        continue;
      }
      const presentationHidden = hiddenItemIds.has(block.contentItemId);
      orderedBlocks.push({
        ...block,
        order: index,
        presentationHidden,
        visible: block.contentVisible && !presentationHidden,
        hiddenReason: !block.contentVisible
          ? "hidden_by_content"
          : presentationHidden
            ? "hidden_by_presentation"
            : undefined
      });
    }
    return orderedBlocks;
  });
}

function sanitizeSectionOrder(sectionOrder?: ResumeRenderSectionType[]) {
  const defaults: ResumeRenderSectionType[] = [...defaultResumeRenderSectionOrder];
  if (!sectionOrder) {
    return defaults;
  }
  const unique = sectionOrder.filter((section, index) => sectionOrder.indexOf(section) === index);
  return [...unique, ...defaults.filter((section) => !unique.includes(section))];
}

function sectionRank(itemType: BranchContentItem["itemType"]) {
  if (itemType === "summary") {
    return 0;
  }
  if (itemType === "certificate") {
    return 3;
  }
  if (itemType === "skill") {
    return 2;
  }
  return 1;
}
