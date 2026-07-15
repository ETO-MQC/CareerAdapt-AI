import type {
  ResumePaginationPlan,
  ResumePaginationStatus,
  ResumePresentationConfig,
  ResumeRenderModel,
  ResumeRenderSectionType
} from "@/domain/schemas";
import { stableHashText } from "@/services/security/text";
import { defaultResumeRenderSectionOrder } from "@/domain/resumeFields/catalog";

export type ResumePaginationBlockMeasurement = {
  sourceItemId: string;
  sectionType: ResumeRenderSectionType;
  top: number;
  bottom: number;
  height: number;
  horizontalOverflow?: boolean;
};

export type ResumePaginationSectionMeasurement = {
  sectionType: ResumeRenderSectionType;
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

type MutablePaginationPage = ResumePaginationPlan["pages"][number] & {
  itemIdsBySection: Record<string, string[]>;
};

const PAGE_NEAR_LIMIT_PX = 36;
const SECTION_TYPES: ResumeRenderSectionType[] = [...defaultResumeRenderSectionOrder];

export function collectResumePaginationMeasurement(pageElement: HTMLElement): ResumePaginationMeasurement {
  const pageRect = pageElement.getBoundingClientRect();
  const sectionElements = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-render-section]"));
  const blockElements = Array.from(pageElement.querySelectorAll<HTMLElement>("[data-source-item-id]"));
  const sections = sectionElements.flatMap((element) => {
    const sectionType = parseSectionType(element.dataset.renderSection);
    if (!sectionType) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    const blockIds = Array.from(element.querySelectorAll<HTMLElement>("[data-source-item-id]"))
      .map((block) => block.dataset.sourceItemId)
      .filter((id): id is string => Boolean(id));
    return [{
      sectionType,
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
      height: rect.height,
      blockIds
    }];
  });
  const blocks = blockElements.flatMap((element) => {
    const sectionElement = element.closest<HTMLElement>("[data-render-section]");
    const sectionType = parseSectionType(sectionElement?.dataset.renderSection);
    const sourceItemId = element.dataset.sourceItemId;
    if (!sectionType || !sourceItemId) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    return [{
      sourceItemId,
      sectionType,
      top: rect.top - pageRect.top,
      bottom: rect.bottom - pageRect.top,
      height: rect.height,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 2
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
  const requestedMaxPages: 1 | 2 = pagePolicy === "up_to_two_pages" ? 2 : 1;
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
    const sectionBlocks = input.measurement.blocks.filter((block) => block.sectionType === section.sectionType);
    if (sectionBlocks.length === 0) {
      continue;
    }
    // Reset to 1 so each section starts evaluating from page 1
    // This prevents blocks from being pushed to later pages unnecessarily
    currentPageNumber = 1;
    if (forcedBreakBeforeSections.includes(section.sectionType) && pageHasContent(pages[currentPageNumber - 1])) {
      currentPageNumber += 1;
      ensurePage(pages, currentPageNumber);
    }

    for (const block of sectionBlocks) {
      let assignedPage = currentPageNumber;
      if (block.height > clientHeight) {
        oversizedBlockIds.push(block.sourceItemId);
        overflowBlockIds.push(block.sourceItemId);
      } else {
        const naturalPage = Math.max(1, Math.ceil(Math.max(block.bottom, 1) / clientHeight));
        assignedPage = Math.max(currentPageNumber, naturalPage);
        assignedPage = Math.min(assignedPage, pages.length + 1);
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
  const naturalPageCount = Math.max(1, Math.ceil(input.measurement.scrollHeight / clientHeight));
  const assignedPageCount = Math.max(1, ...usedPages.map((page) => page.pageNumber));
  const actualPageCount = clampActualPageCount(Math.max(naturalPageCount, assignedPageCount));
  const status = paginationStatus({
    actualPageCount,
    remainingPx: clientHeight - input.measurement.scrollHeight,
    measurementFailed: input.measurement.clientHeight <= 0
  });

  const planWithoutHash = {
    schemaVersion: "resume-pagination-v1" as const,
    pagePolicy,
    requestedMaxPages,
    actualPageCount,
    status,
    pages: usedPages.length > 0 ? usedPages.slice(0, 3) : [createPage(1)],
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
    .filter((page) => page.pageNumber <= plan.requestedMaxPages)
    .map((page) => ({
      ...model,
      sections: model.sections.flatMap((section) => {
        const itemIds = page.itemIdsBySection[section.type] ?? [];
        if (itemIds.length === 0) {
          return [];
        }
        const itemSet = new Set(itemIds);
        const blocks = section.blocks.filter((block) => itemSet.has(block.sourceItemId));
        return blocks.length > 0 ? [{ ...section, blocks }] : [];
      })
    }))
    .filter((pageModel) => pageModel.sections.length > 0);
}

export function isPaginationPlanBlocked(plan?: ResumePaginationPlan) {
  if (!plan) {
    return true;
  }
  return plan.status === "measurement_failed" || plan.actualPageCount > plan.requestedMaxPages;
}

export function paginationStatusAllowsExport(status: ResumePaginationStatus) {
  return status === "fits_one_page" || status === "near_one_page_limit" || status === "fits_two_pages" || status === "fits" || status === "near_limit";
}

export function paginationStatusLabel(status: ResumePaginationStatus) {
  if (status === "fits_one_page" || status === "fits") {
    return "fits_one_page";
  }
  if (status === "near_one_page_limit" || status === "near_limit") {
    return "near_one_page_limit";
  }
  if (status === "fits_two_pages") {
    return "fits_two_pages";
  }
  if (status === "exceeds_two_pages" || status === "overflow") {
    return "exceeds_two_pages";
  }
  return status;
}

function sanitizeForcedBreaks(
  configured: ResumeRenderSectionType[],
  visibleSections: ResumeRenderSectionType[]
) {
  const visible = uniqueSections(visibleSections);
  const firstVisible = visible[0];
  return uniqueSections(configured).filter((section) => visible.includes(section) && section !== firstVisible);
}

function paginationStatus(input: {
  actualPageCount: 1 | 2 | 3;
  remainingPx: number;
  measurementFailed: boolean;
}): ResumePaginationStatus {
  if (input.measurementFailed) {
    return "measurement_failed";
  }
  if (input.actualPageCount >= 3) {
    return "exceeds_two_pages";
  }
  if (input.actualPageCount === 2) {
    return "fits_two_pages";
  }
  return input.remainingPx <= PAGE_NEAR_LIMIT_PX ? "near_one_page_limit" : "fits_one_page";
}

function clampActualPageCount(pageCount: number): 1 | 2 | 3 {
  if (pageCount <= 1) {
    return 1;
  }
  if (pageCount === 2) {
    return 2;
  }
  return 3;
}

function createPage(pageNumber: number): MutablePaginationPage {
  return {
    pageNumber,
    sectionTypes: [],
    itemIdsBySection: {},
    blockIds: []
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

function pageHasContent(page: MutablePaginationPage | undefined) {
  return Boolean(page?.blockIds.length);
}

function parseSectionType(value: unknown): ResumeRenderSectionType | undefined {
  return SECTION_TYPES.find((section) => section === value);
}

function uniqueSections(values: ResumeRenderSectionType[]) {
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
