/**
 * Test/fixture compiler only. Production parsing must never use the paired JSON
 * as an oracle; it is accepted here solely to generate deterministic fixtures.
 */
import type { CareerAdaptResumeJsonV2, ResumeItemV2 } from "@/domain/schemas";
import { LayoutDocumentSchema, type LayoutDocument } from "./layoutDocument";
import { LayoutGraphSchema, type LayoutGraph } from "./layoutGraph";
import {
  RESUME_SEMANTIC_TREE_VERSION,
  ResumeSemanticTreeSchema,
  semanticSourceCoverage,
  type ResumeSemanticItem,
  type ResumeSemanticTree
} from "./resumeSemanticTree";
import { adaptWenmoResumeJson } from "./wenmoJsonAdapter";

export type PairedResumeFixture = {
  expectedCanonicalV2: CareerAdaptResumeJsonV2;
  expectedLayoutBlockRoles: Record<string, string[]>;
  expectedSemanticTree: ResumeSemanticTree;
  metrics: { sourceCoverage: number; hallucinationCount: number };
};

export function compilePairedResumeFixture(input: {
  externalJson: unknown;
  layoutDocument: LayoutDocument;
  layoutGraph: LayoutGraph;
}): PairedResumeFixture {
  const document = LayoutDocumentSchema.parse(input.layoutDocument);
  const graph = LayoutGraphSchema.parse(input.layoutGraph);
  const canonical = adaptWenmoResumeJson(input.externalJson).canonicalResume;
  const roles: Record<string, string[]> = {};
  const basicsBlockIds = unique(Object.entries(canonical.basics).flatMap(([field, value]) => {
    if (field === "customFields") return [];
    return values(value).flatMap((text) => bind(text, document, graph, roles, `basics.${field}`));
  }));
  const consumedHeadingBlockIds: string[] = [];
  const semanticItems: ResumeSemanticItem[] = [];
  const semanticSections = canonical.sections.map((section, sectionIndex) => {
    const headingBlockId = findBestBlock(section.title, document)?.id ?? `missing-heading:${section.id}`;
    if (!headingBlockId.startsWith("missing-heading:")) {
      consumedHeadingBlockIds.push(headingBlockId);
      addRole(roles, headingBlockId, "section_heading");
    }
    const itemIds = section.items.map((item, itemIndex) => {
      const semantic = pairedSemanticItem(item, document, graph, roles, `${section.id}:${itemIndex}`);
      semanticItems.push(semantic);
      return semantic.id;
    });
    return {
      id: `paired-section:${sectionIndex}`,
      sectionType: section.sectionType,
      headingBlockId,
      headingBlockIds: [headingBlockId],
      itemIds,
      confidence: confidence(1, 1, 1, 1)
    };
  });
  const sourceBlockIds = document.blocks.map((block) => block.id);
  const initiallyConsumed = new Set([...basicsBlockIds, ...consumedHeadingBlockIds, ...semanticItems.flatMap((item) => item.sourceBlockIds)]);
  for (const block of document.blocks) {
    if (initiallyConsumed.has(block.id)) continue;
    const nearestItem = semanticItems
      .map((item) => ({ item, distance: nearestSourceDistance(block.order, item.sourceBlockIds, document) }))
      .sort((left, right) => left.distance - right.distance)[0]?.item;
    if (nearestItem) {
      nearestItem.sourceBlockIds = unique([...nearestItem.sourceBlockIds, block.id]);
      addRole(roles, block.id, "source_evidence");
    } else basicsBlockIds.push(block.id);
  }
  const tree = ResumeSemanticTreeSchema.parse({
    schemaVersion: RESUME_SEMANTIC_TREE_VERSION,
    sourceBlockIds,
    basicsBlockIds,
    consumedHeadingBlockIds,
    sections: semanticSections,
    items: semanticItems,
    invariantIssues: []
  });
  const canonicalTexts = collectCanonicalTexts(canonical);
  const sourceText = normalizeComparable(`${document.blocks.map((block) => block.text).join("")} ${flattenSourceStrings(input.externalJson).join(" ")}`);
  const hallucinationCount = canonicalTexts.filter((text) => !sourceText.includes(normalizeComparable(text))).length;
  return {
    expectedCanonicalV2: canonical,
    expectedLayoutBlockRoles: roles,
    expectedSemanticTree: tree,
    metrics: { sourceCoverage: semanticSourceCoverage(tree), hallucinationCount }
  };
}

function pairedSemanticItem(item: ResumeItemV2, document: LayoutDocument, graph: LayoutGraph, roles: Record<string, string[]>, id: string): ResumeSemanticItem {
  const sourceBlockIds: string[] = [];
  const buckets = {
    titleBlockIds: [] as string[], organizationBlockIds: [] as string[], roleBlockIds: [] as string[], degreeBlockIds: [] as string[],
    majorBlockIds: [] as string[], dateBlockIds: [] as string[], bodyBlockIds: [] as string[], highlightBlockIds: [] as string[]
  };
  for (const [field, value] of Object.entries(item)) {
    if (["id", "sectionType", "customFields", "current"].includes(field)) continue;
    for (const text of values(value)) {
      const role = semanticRole(field, item.sectionType);
      const ids = bind(text, document, graph, roles, role);
      sourceBlockIds.push(...ids);
      if (field === "title" || field === "name") buckets.titleBlockIds.push(...ids);
      else if (["organization", "school", "institution"].includes(field)) buckets.organizationBlockIds.push(...ids);
      else if (["role", "authorRole"].includes(field)) buckets.roleBlockIds.push(...ids);
      else if (field === "degree") buckets.degreeBlockIds.push(...ids);
      else if (field === "major") buckets.majorBlockIds.push(...ids);
      else if (["startDate", "endDate", "issuedAt", "awardedAt"].includes(field)) buckets.dateBlockIds.push(...ids);
      else if (field === "highlights") buckets.highlightBlockIds.push(...ids);
      else buckets.bodyBlockIds.push(...ids);
    }
  }
  const uniqueBuckets = Object.fromEntries(Object.entries(buckets).map(([key, blockIds]) => [key, unique(blockIds)])) as typeof buckets;
  const expectedHighlights = "highlights" in item ? item.highlights : [];
  return {
    id: `paired-item:${id}`,
    sourceBlockIds: unique(sourceBlockIds),
    ...uniqueBuckets,
    bodyGroups: uniqueBuckets.bodyBlockIds.length ? [pairedGroup(`paired-item:${id}:body`, "description", uniqueBuckets.bodyBlockIds, document)] : [],
    highlightGroups: expectedHighlights.map((highlight, index) => ({
      ...pairedGroup(`paired-item:${id}:highlight:${index}`, "highlight", unique(bind(highlight, document, graph, roles, `${item.sectionType}.highlight`)), document)
    })).filter((group) => group.blockIds.length),
    confidence: confidence(1, 1, 1, sourceBlockIds.length ? 1 : 0)
  };
}

function pairedGroup(id: string, role: "description" | "highlight", blockIds: string[], document: LayoutDocument) {
  const orders = blockIds.flatMap((blockId) => {
    const block = document.blocks.find((candidate) => candidate.id === blockId);
    return block ? [block.order] : [];
  });
  return { id, role, blockIds, markerBlockIds: [], sourceOrderStart: orders.length ? Math.min(...orders) : 0, sourceOrderEnd: orders.length ? Math.max(...orders) : 0 };
}

function bind(text: string, document: LayoutDocument, graph: LayoutGraph, roles: Record<string, string[]>, role: string): string[] {
  const normalized = normalizeComparable(text);
  if (!normalized) return [];
  const direct = document.blocks.filter((block) => {
    const blockText = normalizeComparable(block.text);
    return blockText === normalized || blockText.includes(normalized) || normalized.includes(blockText) && blockText.length >= 3;
  });
  const matches = direct.length ? direct : findConsecutiveBlocks(normalized, document);
  const ids = new Set(matches.map((block) => block.id));
  for (const edge of graph.edges) {
    if (edge.relation === "bullet_content_of" && (ids.has(edge.from) || ids.has(edge.to))) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
  }
  for (const id of ids) addRole(roles, id, role);
  return [...ids];
}

function findConsecutiveBlocks(text: string, document: LayoutDocument) {
  for (let start = 0; start < document.blocks.length; start += 1) {
    let combined = "";
    for (let end = start; end < Math.min(document.blocks.length, start + 12); end += 1) {
      if (document.blocks[end].page !== document.blocks[start].page) break;
      combined += normalizeComparable(document.blocks[end].text);
      if (combined.includes(text) || text.includes(combined) && combined.length >= 3) return document.blocks.slice(start, end + 1);
      if (combined.length > text.length * 1.4) break;
    }
  }
  return [];
}

function findBestBlock(text: string, document: LayoutDocument) {
  const normalized = normalizeComparable(text);
  return document.blocks.find((block) => normalizeComparable(block.text) === normalized)
    ?? document.blocks.find((block) => normalizeComparable(block.text).includes(normalized));
}

function semanticRole(field: string, sectionType: ResumeItemV2["sectionType"]): string {
  if (["title", "name"].includes(field)) return `${sectionType}.title`;
  if (["organization", "school", "institution"].includes(field)) return `${sectionType}.organization`;
  if (["role", "authorRole"].includes(field)) return `${sectionType}.role`;
  if (["startDate", "endDate", "issuedAt", "awardedAt"].includes(field)) return `${sectionType}.date`;
  if (field === "highlights") return `${sectionType}.highlight`;
  return `${sectionType}.${field}`;
}

function collectCanonicalTexts(resume: CareerAdaptResumeJsonV2): string[] {
  return [
    ...Object.values(resume.basics).flatMap(values),
    ...resume.sections.flatMap((section) => [section.title, ...section.items.flatMap((item) => Object.entries(item)
      .filter(([field]) => !["id", "sectionType", "current", "customFields"].includes(field))
      .flatMap(([, value]) => values(value)))])
  ].filter((value) => value.length >= 2 && !/^(?:true|false)$/i.test(value));
}

function values(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(values);
  return [];
}

function flattenSourceStrings(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenSourceStrings);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap(flattenSourceStrings);
  return [];
}

function addRole(roles: Record<string, string[]>, blockId: string, role: string) {
  roles[blockId] = unique([...(roles[blockId] ?? []), role]);
}

function nearestSourceDistance(order: number, blockIds: readonly string[], document: LayoutDocument): number {
  const orders = blockIds.flatMap((id) => {
    const block = document.blocks.find((candidate) => candidate.id === id);
    return block ? [block.order] : [];
  });
  return orders.length ? Math.min(...orders.map((candidate) => Math.abs(candidate - order))) : Number.POSITIVE_INFINITY;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").replace(/[^\p{Letter}\p{Number}]+/gu, "").trim();
}

function confidence(section: number, itemBoundary: number, fieldRole: number, sourceBinding: number) {
  return { section, itemBoundary, fieldRole, sourceBinding };
}
