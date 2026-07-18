import { z } from "zod";
import type { ExtractedSourceBlock, ResumeSourceEngine } from "@/domain/schemas";

export const LAYOUT_DOCUMENT_VERSION = "resume-layout-document-v1";

export const LayoutBoundingBoxSchema = z.object({
  x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0)
}).strict();

export const LayoutBlockSchema = z.object({
  id: z.string().min(1),
  page: z.number().int().min(1),
  text: z.string(),
  bbox: LayoutBoundingBoxSchema,
  font: z.object({
    size: z.number().positive().optional(),
    weight: z.number().int().min(1).max(1000).optional(),
    family: z.string().min(1).optional(),
    color: z.string().min(1).optional()
  }).strict(),
  lineId: z.string().min(1),
  columnId: z.string().min(1),
  sourceBlockRefs: z.array(z.string().min(1)).min(1),
  sourceEngine: z.string().min(1),
  order: z.number().int().min(0)
}).strict();

export const LayoutDocumentSchema = z.object({
  schemaVersion: z.literal(LAYOUT_DOCUMENT_VERSION),
  pageCount: z.number().int().min(1),
  blocks: z.array(LayoutBlockSchema)
}).strict().superRefine((document, context) => {
  const ids = new Set<string>();
  for (const [index, block] of document.blocks.entries()) {
    if (block.page > document.pageCount) context.addIssue({ code: "custom", path: ["blocks", index, "page"], message: "layout block page exceeds pageCount" });
    if (ids.has(block.id)) context.addIssue({ code: "custom", path: ["blocks", index, "id"], message: "layout block ids must be unique" });
    ids.add(block.id);
  }
});

export type LayoutBlock = z.infer<typeof LayoutBlockSchema>;
export type LayoutDocument = z.infer<typeof LayoutDocumentSchema>;

export type LayoutTextFragment = {
  id?: string;
  page: number;
  text: string;
  bbox: LayoutBlock["bbox"];
  fontSize?: number;
  fontWeight?: number;
  fontFamily?: string;
  color?: string;
  sourceBlockRef?: string;
  sourceEngine: ResumeSourceEngine;
  lineId?: string;
};

export function createLayoutDocument(input: { pageCount: number; fragments: readonly LayoutTextFragment[] }): LayoutDocument {
  const rows = clusterRows(input.fragments);
  const columnAnchors = detectColumnAnchors(rows);
  const blocks = rows.flatMap((row, rowIndex) => {
    const sorted = [...row].sort((left, right) => left.bbox.x - right.bbox.x);
    return sorted.map((fragment, fragmentIndex): LayoutBlock => ({
      id: fragment.id ?? `layout:${fragment.page}:${rowIndex}:${fragmentIndex}`,
      page: fragment.page,
      text: fragment.text,
      bbox: fragment.bbox,
      font: {
        size: fragment.fontSize,
        weight: fragment.fontWeight,
        family: fragment.fontFamily,
        color: fragment.color
      },
      lineId: fragment.lineId ?? `page:${fragment.page}:line:${rowIndex}`,
      columnId: `page:${fragment.page}:column:${closestAnchor(fragment.bbox.x, columnAnchors.get(fragment.page) ?? [fragment.bbox.x])}`,
      sourceBlockRefs: [fragment.sourceBlockRef ?? fragment.id ?? `source:${fragment.page}:${rowIndex}:${fragmentIndex}`],
      sourceEngine: fragment.sourceEngine,
      order: 0
    }));
  }).sort((left, right) => left.page - right.page || right.bbox.y - left.bbox.y || left.bbox.x - right.bbox.x)
    .map((block, order) => ({ ...block, order }));
  return LayoutDocumentSchema.parse({ schemaVersion: LAYOUT_DOCUMENT_VERSION, pageCount: input.pageCount, blocks });
}

export function layoutDocumentFromSourceBlocks(input: { pageCount: number; blocks: readonly ExtractedSourceBlock[]; engine: ResumeSourceEngine }): LayoutDocument {
  return createLayoutDocument({
    pageCount: input.pageCount,
    fragments: input.blocks.flatMap((block) => block.position ? [{
      id: block.id,
      page: block.page ?? 1,
      text: block.text,
      bbox: block.position,
      fontSize: block.fontSize,
      sourceBlockRef: block.id,
      sourceEngine: block.sourceEngine ?? input.engine
    }] : [])
  });
}

function clusterRows(fragments: readonly LayoutTextFragment[]): LayoutTextFragment[][] {
  const rows: LayoutTextFragment[][] = [];
  for (const fragment of [...fragments].sort((a, b) => a.page - b.page || b.bbox.y - a.bbox.y || a.bbox.x - b.bbox.x)) {
    const tolerance = Math.max(1.5, Math.min(5, fragment.bbox.height * 0.42));
    const row = rows.find((candidate) => candidate[0]?.page === fragment.page && (fragment.lineId && candidate[0]?.lineId
      ? fragment.lineId === candidate[0].lineId
      : Math.abs(average(candidate.map((item) => item.bbox.y)) - fragment.bbox.y) <= tolerance));
    if (row) row.push(fragment);
    else rows.push([fragment]);
  }
  return rows;
}

function detectColumnAnchors(rows: readonly LayoutTextFragment[][]): Map<number, number[]> {
  const byPage = new Map<number, number[]>();
  for (const row of rows) {
    for (const fragment of row) {
      const anchors = byPage.get(fragment.page) ?? [];
      if (!anchors.some((anchor) => Math.abs(anchor - fragment.bbox.x) <= Math.max(8, fragment.bbox.height))) anchors.push(fragment.bbox.x);
      byPage.set(fragment.page, anchors.sort((a, b) => a - b));
    }
  }
  return byPage;
}

function closestAnchor(value: number, anchors: readonly number[]): number {
  let best = 0;
  for (let index = 1; index < anchors.length; index += 1) {
    if (Math.abs(anchors[index] - value) < Math.abs(anchors[best] - value)) best = index;
  }
  return best;
}

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
