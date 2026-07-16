import type { NormalizedSourceBlock, ResumeSourceRange } from "@/domain/schemas";
import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";
import { alignResumeDateRange } from "./dates";

export type SegmentedResumeItem = {
  id: string;
  sectionType: ResumeSectionTypeV2;
  sourceBlockIds: string[];
  sourceRanges: ResumeSourceRange[];
  headingText?: string;
  normalizedText: string;
  bodyBlocks: NormalizedSourceBlock[];
  dateCandidate?: ReturnType<typeof alignResumeDateRange>;
};

const DATE_RANGE_SIGNAL = /(?<!\d)(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2}日?)?\s*(?:-|–|—|至|到)\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2}日?)?|至今|现在|Present|Current|仍在职|在读)/i;

export function segmentResumeItems(input: {
  sectionType: ResumeSectionTypeV2;
  blocks: NormalizedSourceBlock[];
}): SegmentedResumeItem[] {
  const blocks = input.blocks.filter((block) => block.normalizedText.trim());
  if (!blocks.length) return [];

  if (input.sectionType === "skills") {
    return blocks.flatMap((block, blockIndex) =>
      splitSkillRanges(block.normalizedText).map((range, rangeIndex) =>
        buildSegment(input.sectionType, [block], blockIndex * 10 + rangeIndex, range.start, range.end)
      )
    );
  }
  if (input.sectionType === "awards" || input.sectionType === "languages" || input.sectionType === "certificates") {
    return blocks.map((block, index) => buildSegment(input.sectionType, [block], index));
  }
  if (input.sectionType === "summary" || input.sectionType === "education") {
    return [buildSegment(input.sectionType, blocks, 0)];
  }

  const groups: NormalizedSourceBlock[][] = [];
  let current: NormalizedSourceBlock[] = [];
  for (const block of blocks) {
    if (DATE_RANGE_SIGNAL.test(block.normalizedText) && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(block);
  }
  if (current.length) groups.push(current);
  return groups.map((group, index) => buildSegment(input.sectionType, group, index));
}

function buildSegment(
  sectionType: ResumeSectionTypeV2,
  blocks: NormalizedSourceBlock[],
  index: number,
  firstStart = 0,
  firstEnd = blocks[0]?.normalizedText.length ?? 0
): SegmentedResumeItem {
  const first = blocks[0];
  const firstText = first.normalizedText.slice(firstStart, firstEnd).trim();
  const texts = [firstText, ...blocks.slice(1).map((block) => block.normalizedText.trim())].filter(Boolean);
  const sourceRanges = blocks.map((block, blockIndex) => ({
    blockId: block.id,
    start: blockIndex === 0 ? firstStart : 0,
    end: blockIndex === 0 ? firstEnd : block.normalizedText.length
  })).filter((range) => range.end > range.start);
  return {
    id: `segmented:${sectionType}:${first.id}:${index}`,
    sectionType,
    sourceBlockIds: [...new Set(blocks.map((block) => block.id))],
    sourceRanges,
    headingText: firstText,
    normalizedText: texts.join("\n"),
    bodyBlocks: blocks,
    dateCandidate: alignResumeDateRange(first)
  };
}

function splitSkillRanges(text: string) {
  const boundaries = [
    "模型输出评估",
    "需求拆解",
    "React / Next.js / TypeScript"
  ];
  for (const marker of boundaries) {
    const index = text.indexOf(marker);
    if (index > 0) {
      return [
        { start: 0, end: index },
        { start: index, end: text.length }
      ];
    }
  }
  return [{ start: 0, end: text.length }];
}
