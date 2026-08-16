import type { ResumeBranch, ResumeRenderModel, ResumeSectionTypeV2 } from "@/domain/schemas";
import type { ResumeDocument } from "@/domain/resumeDocument/mapper";
import { migrateResumeBranchToV2 } from "@/domain/migrations/resumeV2";

export type RenderCoverageStage = "presentation" | "pagination" | "rendered";

export type RenderCoverageEntry = {
  sectionType: Exclude<ResumeSectionTypeV2, "basics"> | "experience";
  sectionId: string;
  itemId?: string;
};

export type RenderCoverageDrop = {
  sectionType: RenderCoverageEntry["sectionType"];
  sectionId: string;
  itemId?: string;
  droppedStage: RenderCoverageStage;
  reason: string;
};

export type RenderCoverageLabel = {
  sectionType: string;
  sectionId: string;
  itemId?: string;
  label: string;
  count?: number;
};

export type RenderCoverageStageCounts = {
  sections: number;
  items: number;
};

export type RenderCoverageDiagnostics = {
  failedStage?: RenderCoverageStage;
  droppedSections: RenderCoverageLabel[];
  droppedItems: RenderCoverageLabel[];
  duplicateSections: RenderCoverageLabel[];
  duplicateItems: RenderCoverageLabel[];
  sourceCounts: RenderCoverageStageCounts;
  presentationCounts: RenderCoverageStageCounts;
  paginatedCounts?: RenderCoverageStageCounts;
  renderedCounts?: RenderCoverageStageCounts;
  paginationHash?: string;
  revisionId?: string;
  presentationRevision?: number;
};

export type RenderCoverageReport = {
  source: RenderCoverageEntry[];
  presentation: RenderCoverageEntry[];
  paginated?: RenderCoverageEntry[];
  rendered?: RenderCoverageEntry[];
  droppedEntries: RenderCoverageDrop[];
  silentDroppedSectionCount: number;
  silentDroppedItemCount: number;
  duplicateRenderedSectionCount: number;
  duplicateRenderedItemCount: number;
  genericExperienceRendered: number;
  diagnostics: RenderCoverageDiagnostics;
};

export function presentationCoverage(model: ResumeRenderModel): RenderCoverageEntry[] {
  if (model.schemaVersion !== "resume-render-v2") return legacyCoverage(model);
  return model.structuredSections.flatMap((section) => [
    { sectionType: section.sectionType, sectionId: section.sectionId },
    ...section.items.map((item) => ({
      sectionType: section.sectionType,
      sectionId: section.sectionId,
      itemId: item.itemId
    }))
  ]);
}

export function sourceVisibleCoverage(input: {
  branch: ResumeBranch;
  document: ResumeDocument;
  derivedSummary?: string;
}): RenderCoverageEntry[] {
  const runtimeBranch = migrateResumeBranchToV2(input.branch);
  const hasPersistedSummaryItem = input.document.blocks.some((block) => !block.derivedFrom && block.itemType === "summary");
  const visibleIds = new Set(input.document.blocks
    .filter((block) => block.visible && block.renderable)
    .map((block) => block.contentItemId));
  const entries = runtimeBranch.structuredContentItems.flatMap((item): RenderCoverageEntry[] => {
    if (!item.visible || !visibleIds.has(item.id)) return [];
    const legacy = input.branch.contentItems.find((candidate) => candidate.id === item.id);
    const customSection = legacy?.sourceSectionId?.startsWith("custom:") ? legacy.sourceSectionId : undefined;
    const sectionType = customSection ? "custom" : item.data.sectionType;
    const sectionId = customSection ?? sectionType;
    return [{ sectionType, sectionId, itemId: item.id }];
  });
  const visibleSummaryBlock = input.document.blocks.find((block) => !block.derivedFrom && block.itemType === "summary" && block.visible && block.renderable);
  if (visibleSummaryBlock && !entries.some((entry) => entry.sectionType === "summary")) {
    entries.unshift({ sectionType: "summary", sectionId: "summary", itemId: visibleSummaryBlock.contentItemId });
  }
  const derivedSummaryBlock = input.document.blocks.find((block) => block.derivedFrom === "resumeBasics.summary");
  if (input.derivedSummary?.trim()
    && !hasPersistedSummaryItem
    && derivedSummaryBlock?.visible
    && derivedSummaryBlock.renderable
    && !entries.some((entry) => entry.sectionType === "summary")) {
    entries.unshift({ sectionType: "summary", sectionId: "summary", itemId: `derived-summary:${input.branch.id}` });
  }
  const sectionEntries = entries.flatMap((entry, index, all): RenderCoverageEntry[] => all.findIndex((candidate) => candidate.sectionId === entry.sectionId) === index
    ? [{ sectionType: entry.sectionType, sectionId: entry.sectionId }]
    : []);
  return [...sectionEntries, ...entries];
}

export function paginatedCoverage(models: ResumeRenderModel[]): RenderCoverageEntry[] {
  return dedupeEntries(models.flatMap(presentationCoverage));
}

export function renderedCoverage(root: ParentNode): RenderCoverageEntry[] {
  const sections = Array.from(root.querySelectorAll<HTMLElement>("[data-render-section][data-render-section-id]"))
    .filter((section) => section.dataset.renderSectionPrimary !== "false")
    .map((section) => ({
      sectionType: section.dataset.renderSection as RenderCoverageEntry["sectionType"],
      sectionId: section.dataset.renderSectionId!
    }));
  const items = Array.from(root.querySelectorAll<HTMLElement>("[data-coverage-item-id]"))
    .filter((item) => (item.dataset.renderFragmentIndex ?? "0") === "0")
    .flatMap((item) => {
      const section = item.closest<HTMLElement>("[data-render-section][data-render-section-id]");
      const itemId = item.dataset.coverageItemId;
      if (!section || !itemId) return [];
      return [{
        sectionType: section.dataset.renderSection as RenderCoverageEntry["sectionType"],
        sectionId: section.dataset.renderSectionId!,
        itemId
      }];
    });
  return [...sections, ...items];
}

export function createRenderCoverageReport(input: {
  source: RenderCoverageEntry[];
  presentation: RenderCoverageEntry[];
  paginated?: RenderCoverageEntry[];
  rendered?: RenderCoverageEntry[];
  paginationHash?: string;
  revisionId?: string;
  presentationRevision?: number;
}): RenderCoverageReport {
  const droppedEntries: RenderCoverageDrop[] = [];
  compareStages(input.source, input.presentation, "presentation", "presentation projector did not preserve visible source entry", droppedEntries);
  if (input.paginated) compareStages(input.presentation, input.paginated, "pagination", "pagination plan did not preserve presentation entry", droppedEntries);
  if (input.rendered) compareStages(input.paginated ?? input.presentation, input.rendered, "rendered", "template DOM did not preserve paginated entry", droppedEntries);
  const rendered = input.rendered ?? [];
  const duplicateSections = duplicateLabels(rendered.filter((entry) => !entry.itemId));
  const duplicateItems = duplicateLabels(rendered.filter((entry) => Boolean(entry.itemId)));
  const failedStage = droppedEntries[0]?.droppedStage
    ?? (duplicateSections.length > 0 || duplicateItems.length > 0 || rendered.some((entry) => entry.sectionType === "experience" && !entry.itemId)
      ? "rendered"
      : undefined);
  const diagnostics: RenderCoverageDiagnostics = {
    failedStage,
    droppedSections: droppedEntries.filter((entry) => !entry.itemId).map(toLabel),
    droppedItems: droppedEntries.filter((entry) => Boolean(entry.itemId)).map(toLabel),
    duplicateSections,
    duplicateItems,
    sourceCounts: stageCounts(input.source),
    presentationCounts: stageCounts(input.presentation),
    paginatedCounts: input.paginated ? stageCounts(input.paginated) : undefined,
    renderedCounts: input.rendered ? stageCounts(input.rendered) : undefined,
    paginationHash: input.paginationHash,
    revisionId: input.revisionId,
    presentationRevision: input.presentationRevision
  };
  return {
    source: input.source,
    presentation: input.presentation,
    paginated: input.paginated,
    rendered: input.rendered,
    droppedEntries,
    silentDroppedSectionCount: droppedEntries.filter((entry) => !entry.itemId).length,
    silentDroppedItemCount: droppedEntries.filter((entry) => Boolean(entry.itemId)).length,
    duplicateRenderedSectionCount: duplicateCount(rendered.filter((entry) => !entry.itemId)),
    duplicateRenderedItemCount: duplicateCount(rendered.filter((entry) => Boolean(entry.itemId))),
    genericExperienceRendered: rendered.filter((entry) => entry.sectionType === "experience" && !entry.itemId).length,
    diagnostics
  };
}

export function renderCoverageHasBlockingFailure(report: RenderCoverageReport) {
  return report.silentDroppedSectionCount > 0
    || report.silentDroppedItemCount > 0
    || report.duplicateRenderedSectionCount > 0
    || report.duplicateRenderedItemCount > 0
    || report.genericExperienceRendered > 0;
}

export function coverageCounts(entries: RenderCoverageEntry[]) {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    if (!entry.itemId) continue;
    counts[entry.sectionType] = (counts[entry.sectionType] ?? 0) + 1;
  }
  return counts;
}

function stageCounts(entries: RenderCoverageEntry[]): RenderCoverageStageCounts {
  const unique = dedupeEntries(entries);
  return {
    sections: unique.filter((entry) => !entry.itemId).length,
    items: unique.filter((entry) => Boolean(entry.itemId)).length
  };
}

function toLabel(entry: RenderCoverageEntry | RenderCoverageDrop): RenderCoverageLabel {
  return {
    sectionType: entry.sectionType,
    sectionId: entry.sectionId,
    itemId: entry.itemId,
    label: entry.itemId ?? entry.sectionId
  };
}

function duplicateLabels(entries: RenderCoverageEntry[]): RenderCoverageLabel[] {
  const counts = new Map<string, { entry: RenderCoverageEntry; count: number }>();
  for (const entry of entries) {
    const key = entryKey(entry);
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { entry, count: 1 });
    }
  }
  return Array.from(counts.values())
    .filter((item) => item.count > 1)
    .map((item) => ({ ...toLabel(item.entry), count: item.count }));
}

function legacyCoverage(model: ResumeRenderModel): RenderCoverageEntry[] {
  return model.sections.flatMap((section) => [
    { sectionType: section.type, sectionId: section.type },
    ...section.blocks.map((block) => ({
      sectionType: section.type,
      sectionId: section.type,
      itemId: block.sourceItemId
    }))
  ]);
}

function compareStages(
  previous: RenderCoverageEntry[],
  current: RenderCoverageEntry[],
  droppedStage: RenderCoverageStage,
  reason: string,
  drops: RenderCoverageDrop[]
) {
  const currentKeys = new Set(current.map(entryKey));
  for (const entry of dedupeEntries(previous)) {
    if (!currentKeys.has(entryKey(entry))) drops.push({ ...entry, droppedStage, reason });
  }
}

function dedupeEntries(entries: RenderCoverageEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entryKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function duplicateCount(entries: RenderCoverageEntry[]) {
  return entries.length - new Set(entries.map(entryKey)).size;
}

function entryKey(entry: RenderCoverageEntry) {
  return `${entry.sectionType}\u0000${entry.sectionId}\u0000${entry.itemId ?? ""}`;
}
