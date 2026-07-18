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

const DATE_RANGE_SIGNAL = /(?<!\d)(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[./-]\d{1,2}(?:[./-]\d{1,2})?)?\s*(?:-|–|—|至|到)\s*(?:(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[./-]\d{1,2}(?:[./-]\d{1,2})?)?|至今|现在|Present|Current|仍在职|在读)/i;

export function segmentResumeItems(input: {
  sectionType: ResumeSectionTypeV2;
  blocks: NormalizedSourceBlock[];
}): SegmentedResumeItem[] {
  const blocks = input.blocks.filter((block) => block.normalizedText.trim());
  if (!blocks.length) return [];

  if (input.sectionType === "skills") {
    return groupHardWrappedBlocks(blocks).flatMap((group, index) => splitSkillGroup(group, index));
  }
  if (input.sectionType === "awards") {
    return blocks.flatMap((block, blockIndex) => splitDelimitedRanges(block.normalizedText).map((range, rangeIndex) =>
      buildSegment(input.sectionType, [block], blockIndex * 10 + rangeIndex, range.start, range.end)
    ));
  }
  if (input.sectionType === "languages" || input.sectionType === "certificates") {
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
    dateCandidate: alignResumeDateRange(firstStart > 0 || firstEnd < first.normalizedText.length
      ? { ...first, text: firstText, rawText: firstText, normalizedText: firstText }
      : first)
  };
}

function splitDelimitedRanges(text: string) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (const match of text.matchAll(/[；;]/g)) {
    const end = match.index ?? start;
    if (text.slice(start, end).trim()) ranges.push({ start, end });
    start = end + match[0].length;
  }
  if (text.slice(start).trim()) ranges.push({ start, end: text.length });
  return ranges.length ? ranges : [{ start: 0, end: text.length }];
}

function groupHardWrappedBlocks(blocks: NormalizedSourceBlock[]) {
  const groups: NormalizedSourceBlock[][] = [];
  for (const block of blocks) {
    const previous = groups.at(-1);
    const previousText = previous?.at(-1)?.normalizedText.trim() ?? "";
    const groupStartsWithBullet = Boolean(previous?.[0] && /^[•·●▪◦■□◆◇▶►*-]\s*/u.test(previous[0].normalizedText.trim()));
    const blockStartsWithBullet = /^[•·●▪◦■□◆◇▶►*-]\s*/u.test(block.normalizedText.trim());
    if (previous && groupStartsWithBullet && !blockStartsWithBullet) previous.push(block);
    else if (previous && (/[、，,]$/.test(previousText) || block.normalizedText.trim().length <= 8)) previous.push(block);
    else groups.push([block]);
  }
  return groups;
}

function splitSkillGroup(group: NormalizedSourceBlock[], index: number) {
  const joined = group.map((block) => block.normalizedText.trim()).join("");
  if (group.length !== 1 || (joined.match(/\s+[|/]\s+/g)?.length ?? 0) < 2) {
    const segment = buildSegment("skills", group, index * 10);
    return [{ ...segment, normalizedText: joined }];
  }
  const candidates = Array.from(joined.matchAll(/(?<![|/])\s+(?![|/])/g))
    .map((match) => match.index ?? 0)
    .filter((position) => position > joined.length * 0.25 && position < joined.length * 0.75);
  const boundary = candidates.sort((left, right) => Math.abs(left - joined.length / 2) - Math.abs(right - joined.length / 2))[0];
  if (!boundary) return [buildSegment("skills", group, index * 10)];
  return [
    buildSegment("skills", group, index * 10, 0, boundary),
    buildSegment("skills", group, index * 10 + 1, boundary, joined.length)
  ];
}
