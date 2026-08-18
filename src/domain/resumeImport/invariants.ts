import type { ImportedResumeDraft } from "@/domain/schemas";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";

export type ResumeImportInvariantReport = {
  genericExperienceCount: number;
  duplicateSectionIdCount: number;
  duplicateItemIdCount: number;
  orphanDateCandidateCount: number;
  sameSourceRangeConflictCount: number;
  mappedContentRepeatedInUnclassified: number;
  mappedSourceBlockRepeatedInUnclassified: number;
  presentationHeadingLeakedIntoContent: number;
  semanticStructureReviewCount: number;
};

export function auditResumeImportInvariants(draft: ImportedResumeDraft): ResumeImportInvariantReport {
  const sectionIds = draft.sections.map((section) => section.id);
  const itemIds = draft.sections.flatMap((section) => section.items.map((item) => item.id));
  const candidates = draft.schemaVersion === "resume-import-v2" ? draft.fieldCandidates : [];
  const rangeTargets = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const range of candidate.sourceRanges ?? []) {
      const key = `${range.blockId}:${range.start}:${range.end}`;
      rangeTargets.set(key, new Set([...(rangeTargets.get(key) ?? []), candidate.targetFieldId]));
    }
  }
  const mappedTexts = new Set(draft.sections.flatMap((section) => section.items.flatMap((item) => {
    const text = item.structuredItem ? projectResumeItemV2(item.structuredItem) : item.normalizedText;
    return normalizeComparableText(text) ? [normalizeComparableText(text)] : [];
  })));
  const unclassifiedText = draft.unclassifiedBlocks.map((block) => normalizeComparableText(
    "sourceValue" in block ? JSON.stringify(block.sourceValue) : block.text
  ));
  const mappedSourceBlockIds = new Set([
    ...Object.values(draft.basics).flatMap((field) => Array.isArray(field)
      ? field.flatMap((entry) => entry.sourceBlockIds)
      : field?.sourceBlockIds ?? []),
    ...draft.sections.flatMap((section) =>
      section.items.flatMap((item) => item.sourceBlockIds)
    )
  ]);
  const mappedSourceRanges = [
    ...Object.values(draft.basics).flatMap((field) => Array.isArray(field)
      ? field.flatMap((entry) => entry.sourceRanges ?? [])
      : field?.sourceRanges ?? []),
    ...draft.sections.flatMap((section) => section.items.flatMap((item) => item.sourceRanges ?? []))
  ];
  return {
    genericExperienceCount: draft.sections.filter((section) => section.sectionType === "experience").length,
    duplicateSectionIdCount: duplicateCount(sectionIds),
    duplicateItemIdCount: duplicateCount(itemIds),
    orphanDateCandidateCount: candidates.filter((candidate) =>
      /\.(?:startDate|endDate|current|awardedAt|issuedAt|expiresAt|publishedAt|filedAt|grantedAt|createdAt)$/.test(candidate.targetFieldId)
      && (!candidate.sectionId || !candidate.itemId)
    ).length,
    sameSourceRangeConflictCount: [...rangeTargets.values()].filter((targets) => targets.size > 1).length,
    mappedContentRepeatedInUnclassified: unclassifiedText.filter((text) => text && mappedTexts.has(text)).length,
    mappedSourceBlockRepeatedInUnclassified: draft.unclassifiedBlocks.filter((block) => {
      if (/字段未通过来源|ai_field_not_grounded/i.test(block.reason)) return false;
      if ("sourcePath" in block) return mappedSourceBlockIds.has(block.sourcePath);
      return mappedSourceRanges.some((range) => range.blockId === block.sourceBlockId
        && rangesOverlap(range.start, range.end, block.sourceRange.start, block.sourceRange.end));
    }).length,
    presentationHeadingLeakedIntoContent: draft.sections.flatMap((section) => section.items).filter((item) =>
      /^(?:经历|奖项[、,]技能与语言)$/i.test(item.normalizedText.normalize("NFKC").trim())
    ).length,
    // Unincluded conversation candidates are intentionally quarantined. They
    // must not block a commit of the independently reviewed facts; only an
    // item that is both included and still ambiguous violates the commit
    // invariant.
    semanticStructureReviewCount: draft.sections.flatMap((section) => section.items)
      .filter((item) => item.included && item.structuredItem && item.sourceStatus === "ambiguous")
      .length
  };
}

export function resumeImportInvariantIssueCount(report: ResumeImportInvariantReport) {
  return Object.values(report).reduce((total, count) => total + count, 0);
}

function duplicateCount(ids: string[]) {
  return ids.length - new Set(ids).size;
}

function normalizeComparableText(value: string) {
  return value.normalize("NFKC").replace(/\s+/g, "").trim();
}

function rangesOverlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) {
  return leftStart < rightEnd && rightStart < leftEnd;
}
