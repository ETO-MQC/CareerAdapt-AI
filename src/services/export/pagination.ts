import type {
  ResumePaginationPlan,
  ResumePaginationStatus,
  ResumePresentationConfig,
  ResumePresentationItem,
  ResumeRenderModel,
  ResumeRenderSectionType
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";
import { RESUME_SECTION_TYPES_V2, type ResumeSectionTypeV2 } from "@/domain/resumeFields";

type AnySectionType = ResumeRenderSectionType | ResumeSectionTypeV2;

export type ResumePaginationUnitMeasurement = {
  key: string;
  top: number;
  bottom: number;
  height: number;
};

export type ResumePaginationBlockMeasurement = {
  sourceItemId: string;
  sectionType: AnySectionType;
  sectionId?: string;
  top: number;
  bottom: number;
  height: number;
  horizontalOverflow?: boolean;
  units?: ResumePaginationUnitMeasurement[];
};

export type ResumePaginationSectionMeasurement = {
  sectionType: AnySectionType;
  sectionId?: string;
  top: number;
  bottom: number;
  height: number;
  blockIds: string[];
};

export type ResumePaginationMeasurement = {
  scrollHeight: number;
  clientHeight: number;
  sections: ResumePaginationSectionMeasurement[];
  blocks: ResumePaginationBlockMeasurement[];
};

type MutablePaginationPage = Omit<ResumePaginationPlan["pages"][number], "sectionTypes"> & {
  sectionTypes: AnySectionType[];
  itemIdsBySection: Record<string, string[]>;
  itemFragments: NonNullable<ResumePaginationPlan["pages"][number]["itemFragments"]>;
};

const PAGE_NEAR_LIMIT_PX = 36;
const SECTION_TYPES: AnySectionType[] = [...defaultResumeRenderSectionOrder, ...RESUME_SECTION_TYPES_V2.filter((t) => t !== "basics")];

export function collectResumePaginationMeasurement(pageElement: HTMLElement): ResumePaginationMeasurement {
  const pageRect = pageElement.getBoundingClientRect();
  const sectionElements = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-render-section]"));
  const blockElements = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-pagination-item-id]"));
  const sections = sectionElements.flatMap((element) => {
    const sectionType = parseSectionType(element.dataset.renderSection);
    if (!sectionType) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    const blockIds = Array.from(element.querySelectorAll<HTMLElement>("[data-pagination-item-id]"))
      .map((block) => block.dataset.paginationItemId)
      .filter((id): id is string => Boolean(id));
    return [{
      sectionType,
      sectionId: element.dataset.renderSectionId,
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
      height: rect.height,
      blockIds
    }];
  });
  const blocks = blockElements.flatMap((element) => {
    const sectionElement = element.closest<HTMLElement>("[data-render-section]");
    const sectionType = parseSectionType(sectionElement?.dataset.renderSection);
    const sourceItemId = element.dataset.paginationItemId;
    if (!sectionType || !sourceItemId) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    const unitElements = element.matches("[data-pagination-unit]")
      ? [element]
      : Array.from(element.querySelectorAll<HTMLElement>("[data-pagination-unit]"));
    return [{
      sourceItemId,
      sectionType,
      sectionId: sectionElement?.dataset.renderSectionId,
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
      height: rect.height,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 2,
      units: unitElements.flatMap((unit) => {
        const key = unit.dataset.paginationUnit;
        if (!key) return [];
        const unitRect = unit.getBoundingClientRect();
        return [{
          key,
          top: unitRect.top - pageRect.top,
          bottom: unitRect.bottom - pageRect.top,
          height: unitRect.height
        }];
      })
    }];
  });

  return {
    scrollHeight: pageElement.scrollHeight,
    clientHeight: pageElement.clientHeight,
    sections: sections.sort((left, right) => left.top - right.top || SECTION_TYPES.indexOf(left.sectionType) - SECTION_TYPES.indexOf(right.sectionType)),
    blocks: blocks.sort((left, right) => left.top - right.top || left.sourceItemId.localeCompare(right.sourceItemId))
  };
}

export function createResumePaginationPlan(input: {
  measurement: ResumePaginationMeasurement;
  paginationConfig: ResumePresentationConfig["pagination"];
}): ResumePaginationPlan {
  const pagePolicy = input.paginationConfig.pagePolicy;
  const requestedMaxPages = 4 as const;
  const clientHeight = Math.max(1, input.measurement.clientHeight);
  const forcedBreakBeforeSections = sanitizeForcedBreaks(
    input.paginationConfig.pageBreakBeforeSections,
    input.measurement.sections.filter((section) => section.blockIds.length > 0).map((section) => section.sectionType)
  );
  const pages: MutablePaginationPage[] = [createPage(1)];
  const overflowBlockIds: string[] = [];
  const oversizedBlockIds: string[] = [];
  let currentPageNumber = 1;

  for (const section of input.measurement.sections) {
    const sectionBlocks = input.measurement.blocks.filter((block) => block.sectionType === section.sectionType
      && (!section.sectionId || !block.sectionId || block.sectionId === section.sectionId));
    if (sectionBlocks.length === 0) {
      continue;
    }
    if (forcedBreakBeforeSections.includes(section.sectionType) && pageHasContent(pages[currentPageNumber - 1])) {
      currentPageNumber += 1;
      ensurePage(pages, currentPageNumber);
    }

    for (const [blockIndex, block] of sectionBlocks.entries()) {
      if (block.units?.length) {
        const chunks = paginationUnitChunks(block.units);
        for (const [fragmentIndex, chunk] of chunks.entries()) {
          const chunkBottom = chunk.at(-1)?.bottom ?? block.bottom;
          const naturalPage = Math.max(1, Math.ceil(Math.max(chunkBottom, 1) / clientHeight));
          const assignedPage = Math.max(currentPageNumber, naturalPage);
          ensurePage(pages, assignedPage);
          addBlockToPage(pages[assignedPage - 1], block);
          addItemFragment(pages[assignedPage - 1], {
            sectionId: section.sectionId ?? section.sectionType,
            sectionType: section.sectionType,
            itemId: block.sourceItemId,
            fragmentIndex,
            includeSectionTitle: blockIndex === 0 && fragmentIndex === 0,
            unitKeys: chunk.map((unit) => unit.key)
          });
          if (chunk.some((unit) => unit.height > clientHeight)) {
            oversizedBlockIds.push(block.sourceItemId);
            overflowBlockIds.push(block.sourceItemId);
          }
          currentPageNumber = assignedPage;
        }
        continue;
      }
      let assignedPage = currentPageNumber;
      if (block.height > clientHeight) {
        oversizedBlockIds.push(block.sourceItemId);
        overflowBlockIds.push(block.sourceItemId);
      } else {
        const naturalPage = Math.max(1, Math.ceil(Math.max(block.bottom, 1) / clientHeight));
        assignedPage = Math.max(currentPageNumber, naturalPage);
      }
      ensurePage(pages, assignedPage);
      addBlockToPage(pages[assignedPage - 1], block);
      if (block.bottom > assignedPage * clientHeight + 2) {
        overflowBlockIds.push(block.sourceItemId);
      }
      currentPageNumber = assignedPage;
    }
  }

  const usedPages = pages.filter(pageHasContent);
  const assignedPageCount = Math.max(1, ...usedPages.map((page) => page.pageNumber));
  const actualPageCount = clampActualPageCount(assignedPageCount);
  const status = paginationStatus({
    actualPageCount,
    remainingPx: clientHeight - input.measurement.scrollHeight,
    measurementFailed: input.measurement.clientHeight <= 0
  });

  const planWithoutHash = {
    schemaVersion: "resume-pagination-v1" as const,
    pagePolicy,
    requestedMaxPages,
    preferredPageCount: input.paginationConfig.preferredPageCount,
    maximumPageCount: input.paginationConfig.maximumPageCount,
    overflowBehavior: input.paginationConfig.overflowBehavior,
    actualPageCount,
    status,
    pages: usedPages.length > 0 ? usedPages : [createPage(1)],
    forcedBreakBeforeSections,
    overflowBlockIds: uniqueStrings(overflowBlockIds),
    oversizedBlockIds: uniqueStrings(oversizedBlockIds),
    measurement: {
      scrollHeight: input.measurement.scrollHeight,
      clientHeight,
      remainingPx: clientHeight - input.measurement.scrollHeight
    }
  };

  return {
    ...planWithoutHash,
    paginationHash: stableHashText(stableStringify({
      ...planWithoutHash,
      measurement: undefined
    }))
  };
}

export function paginateResumeRenderModel(model: ResumeRenderModel, plan?: ResumePaginationPlan): ResumeRenderModel[] {
  if (!plan || plan.pages.length <= 1) {
    return [model];
  }

  return plan.pages
    .map((page) => {
      const filteredSections = model.sections.flatMap((section) => {
        const itemIds = page.itemIdsBySection[section.type] ?? [];
        if (itemIds.length === 0) {
          return [];
        }
        const itemSet = new Set(itemIds);
        const blocks = section.blocks.filter((block) => itemSet.has(block.sourceItemId));
        return blocks.length > 0 ? [{ ...section, blocks }] : [];
      });
      const isV2 = model.schemaVersion === "resume-render-v2";
      const filteredStructuredSections = isV2
        ? model.structuredSections.flatMap((section) => {
          if ((page.itemFragments?.length ?? 0) > 0) {
            const fragments = page.itemFragments!.filter((fragment) => fragment.sectionId === section.sectionId);
            if (fragments.length === 0) return [];
            const items = fragments.flatMap((fragment) => {
              const item = section.items.find((candidate) => candidate.itemId === fragment.itemId);
              if (!item) return [];
              return [{
                ...item,
                presentation: applyPresentationFragment(item.presentation, fragment.unitKeys, fragment.fragmentIndex)
              }];
            });
            return items.length > 0 ? [{
              ...section,
              showTitle: fragments.some((fragment) => fragment.includeSectionTitle),
              items
            }] : [];
          }
          const itemIds = page.itemIdsBySection[section.sectionType] ?? [];
          if (itemIds.length === 0) {
            return [];
          }
          const itemSet = new Set(itemIds);
          const items = section.items.filter((item) => itemSet.has(item.itemId));
          return items.length > 0 ? [{ ...section, items }] : [];
        })
        : [];
      return {
        ...model,
        sections: filteredSections,
        ...(isV2 ? { structuredSections: filteredStructuredSections } : {})
      };
    })
    .filter((pageModel) => pageModel.sections.length > 0 || (model.schemaVersion === "resume-render-v2" && (pageModel.structuredSections?.length ?? 0) > 0));
}

export function isPaginationPlanBlocked(plan?: ResumePaginationPlan) {
  if (!plan) {
    return true;
  }
  return plan.status === "measurement_failed";
}

export function paginationStatusAllowsExport(status: ResumePaginationStatus) {
  return status !== "measurement_failed" && status !== "measuring";
}

export function paginationStatusLabel(status: ResumePaginationStatus) {
  if (status === "fits_one_page" || status === "fits") {
    return "1 页";
  }
  if (status === "near_one_page_limit" || status === "near_limit") {
    return "接近 1 页上限";
  }
  if (status === "fits_two_pages") {
    return "2 页";
  }
  if (status === "fits_three_pages") {
    return "3 页";
  }
  if (status === "fits_four_pages") {
    return "4 页";
  }
  if (status === "exceeds_four_pages") {
    return "超过 4 页";
  }
  if (status === "exceeds_two_pages" || status === "overflow") {
    return "超过建议页数";
  }
  return status === "measurement_failed" ? "分页测量失败" : "正在测量";
}

function sanitizeForcedBreaks(
  configured: string[],
  visibleSections: AnySectionType[]
) {
  const visible = uniqueSections(visibleSections);
  const firstVisible = visible[0];
  return uniqueSections(configured as AnySectionType[]).filter((section) => visible.includes(section) && section !== firstVisible);
}

function paginationStatus(input: {
  actualPageCount: number;
  remainingPx: number;
  measurementFailed: boolean;
}): ResumePaginationStatus {
  if (input.measurementFailed) {
    return "measurement_failed";
  }
  if (input.actualPageCount > 4) {
    return "exceeds_four_pages";
  }
  if (input.actualPageCount === 4) {
    return "fits_four_pages";
  }
  if (input.actualPageCount === 2) {
    return "fits_two_pages";
  }
  if (input.actualPageCount === 3) {
    return "fits_three_pages";
  }
  return input.remainingPx <= PAGE_NEAR_LIMIT_PX ? "near_one_page_limit" : "fits_one_page";
}

function clampActualPageCount(pageCount: number) {
  if (pageCount <= 1) {
    return 1;
  }
  if (pageCount === 2) {
    return 2;
  }
  return Math.ceil(pageCount);
}

function createPage(pageNumber: number): MutablePaginationPage {
  return {
    pageNumber,
    sectionTypes: [],
    itemIdsBySection: {},
    blockIds: [],
    itemFragments: []
  };
}

function paginationUnitChunks(units: ResumePaginationUnitMeasurement[]) {
  const highlightIndex = units.findIndex((unit) => unit.key.startsWith("highlight:"));
  const headingIndex = units.findIndex((unit) => unit.key === "heading");
  const prefixEnd = highlightIndex >= 0 ? highlightIndex : Math.max(0, headingIndex);
  const prefix = units.slice(0, prefixEnd + 1);
  const remaining = units.slice(prefixEnd + 1).map((unit) => [unit]);
  return [prefix, ...remaining].filter((chunk) => chunk.length > 0);
}

function applyPresentationFragment(
  item: ResumePresentationItem,
  unitKeys: string[],
  fragmentIndex: number
): ResumePresentationItem {
  if (unitKeys.includes("content")) {
    return { ...item, sourceItemId: item.sourceItemId ?? item.id, fragmentIndex };
  }
  const keys = new Set(unitKeys);
  const includeHeading = keys.has("heading");
  const highlightIndexes = new Set(unitKeys.flatMap((key) => key.startsWith("highlight:")
    ? [Number(key.slice("highlight:".length))]
    : []));
  const customBulletIndexes = new Set(unitKeys.flatMap((key) => key.startsWith("custom-bullet:")
    ? [Number(key.slice("custom-bullet:".length))]
    : []));
  const normalCustomRows = item.customRows.filter((row) => row.displayMode !== "bullet");
  const bulletCustomRows = item.customRows.filter((row) => row.displayMode === "bullet");

  return {
    ...item,
    id: fragmentIndex === 0 ? item.id : `${item.id}::fragment:${fragmentIndex}`,
    sourceItemId: item.sourceItemId ?? item.id,
    fragmentIndex,
    primaryTitle: includeHeading ? item.primaryTitle : undefined,
    secondaryTitle: includeHeading ? item.secondaryTitle : undefined,
    dateRange: includeHeading ? item.dateRange : undefined,
    tertiaryTitle: keys.has("subtitle") ? item.tertiaryTitle : undefined,
    location: keys.has("subtitle") ? item.location : undefined,
    inlineMeta: keys.has("inline-meta") ? item.inlineMeta : [],
    secondaryMeta: item.secondaryMeta.filter((_, index) => keys.has(`secondary-meta:${index}`)),
    description: keys.has("description") ? item.description : undefined,
    highlights: item.highlights.filter((_, index) => highlightIndexes.has(index)),
    links: keys.has("links") ? item.links : [],
    customRows: [
      ...(keys.has("custom-rows") ? normalCustomRows : []),
      ...bulletCustomRows.filter((_, index) => customBulletIndexes.has(index))
    ]
  };
}

function ensurePage(pages: MutablePaginationPage[], pageNumber: number) {
  while (pages.length < pageNumber) {
    pages.push(createPage(pages.length + 1));
  }
}

function addBlockToPage(page: MutablePaginationPage, block: ResumePaginationBlockMeasurement) {
  if (!page.sectionTypes.includes(block.sectionType)) {
    page.sectionTypes.push(block.sectionType);
  }
  page.itemIdsBySection[block.sectionType] = page.itemIdsBySection[block.sectionType] ?? [];
  if (!page.itemIdsBySection[block.sectionType].includes(block.sourceItemId)) {
    page.itemIdsBySection[block.sectionType].push(block.sourceItemId);
  }
  if (!page.blockIds.includes(block.sourceItemId)) {
    page.blockIds.push(block.sourceItemId);
  }
}

function addItemFragment(
  page: MutablePaginationPage,
  fragment: NonNullable<ResumePaginationPlan["pages"][number]["itemFragments"]>[number]
) {
  const existing = page.itemFragments.find((candidate) => candidate.sectionId === fragment.sectionId && candidate.itemId === fragment.itemId);
  if (existing) {
    existing.unitKeys = uniqueStrings([...existing.unitKeys, ...fragment.unitKeys]);
    existing.includeSectionTitle ||= fragment.includeSectionTitle;
    return;
  }
  page.itemFragments.push(fragment);
}

function pageHasContent(page: MutablePaginationPage | undefined) {
  return Boolean(page?.blockIds.length);
}

function parseSectionType(value: unknown): AnySectionType | undefined {
  return SECTION_TYPES.find((section) => section === value);
}

function uniqueSections(values: AnySectionType[]) {
  return Array.from(new Set(values));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function stableStringify(value: unknown): string {
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
