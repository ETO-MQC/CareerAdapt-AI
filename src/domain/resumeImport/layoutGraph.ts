import { z } from "zod";
import { LayoutDocumentSchema, type LayoutBlock, type LayoutDocument } from "./layoutDocument";

export const LAYOUT_GRAPH_VERSION = "resume-layout-graph-v1";
export const LayoutRelationSchema = z.enum([
  "same_row", "above", "below", "left", "right", "same_column", "nearby",
  "under_heading", "continuation_of", "bullet_content_of"
]);
export const LayoutGraphEdgeSchema = z.object({
  from: z.string().min(1), to: z.string().min(1), relation: LayoutRelationSchema,
  confidence: z.number().min(0).max(1)
}).strict();
export const LayoutGraphSchema = z.object({
  schemaVersion: z.literal(LAYOUT_GRAPH_VERSION),
  documentVersion: z.literal("resume-layout-document-v1"),
  edges: z.array(LayoutGraphEdgeSchema)
}).strict();

export type LayoutGraph = z.infer<typeof LayoutGraphSchema>;
export type LayoutGraphEdge = z.infer<typeof LayoutGraphEdgeSchema>;

const BULLET_PATTERN = /^[\s•·●▪◦■□◆◇▶►*-]+$/u;
const HEADING_PATTERN = /^(?:个人总结|自我评价|教育背景|教育经历|实习经历|工作经历|项目与研究经历|项目经历|科研经历|技能(?:与证书)?|证书)$/u;

export function buildLayoutGraph(documentInput: LayoutDocument): LayoutGraph {
  const document = LayoutDocumentSchema.parse(documentInput);
  const edges: LayoutGraphEdge[] = [];
  const blocks = document.blocks;
  for (let leftIndex = 0; leftIndex < blocks.length; leftIndex += 1) {
    const left = blocks[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < blocks.length; rightIndex += 1) {
      const right = blocks[rightIndex];
      if (left.page !== right.page) continue;
      const verticalGap = Math.abs(left.bbox.y - right.bbox.y);
      const rowTolerance = Math.max(left.bbox.height, right.bbox.height) * 0.55;
      if (left.lineId === right.lineId || verticalGap <= rowTolerance) {
        add(edges, left.id, right.id, "same_row", 0.98);
        const [first, second] = left.bbox.x <= right.bbox.x ? [left, right] : [right, left];
        add(edges, first.id, second.id, "left", 0.98);
        add(edges, second.id, first.id, "right", 0.98);
        if (BULLET_PATTERN.test(first.text.trim())) add(edges, first.id, second.id, "bullet_content_of", 0.99);
      }
      if (left.columnId === right.columnId) add(edges, left.id, right.id, "same_column", 0.94);
      const upper = left.bbox.y >= right.bbox.y ? left : right;
      const lower = upper === left ? right : left;
      add(edges, upper.id, lower.id, "above", 0.96);
      add(edges, lower.id, upper.id, "below", 0.96);
      const distance = euclideanDistance(left, right);
      if (distance <= Math.max(left.bbox.height, right.bbox.height) * 3.2) add(edges, left.id, right.id, "nearby", 0.82);
    }
  }

  for (const [index, block] of blocks.entries()) {
    const previous = blocks.slice(0, index).reverse().find((candidate) => candidate.page === block.page && HEADING_PATTERN.test(candidate.text.trim()));
    if (previous) add(edges, block.id, previous.id, "under_heading", 0.96);
    const above = blocks.slice(0, index).reverse().find((candidate) => candidate.page === block.page && candidate.columnId === block.columnId);
    if (above && isHardWrap(above, block)) add(edges, block.id, above.id, "continuation_of", 0.86);
  }
  return LayoutGraphSchema.parse({ schemaVersion: LAYOUT_GRAPH_VERSION, documentVersion: document.schemaVersion, edges: uniqueEdges(edges) });
}

export function mergeBulletAndContinuationText(document: LayoutDocument, graph: LayoutGraph): Map<string, string> {
  const output = new Map(document.blocks.map((block) => [block.id, block.text.trim()]));
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  for (const edge of graph.edges) {
    if (edge.relation === "bullet_content_of") {
      const marker = byId.get(edge.from);
      const body = byId.get(edge.to);
      if (marker && body) output.set(marker.id, body.text.trim());
    }
    if (edge.relation === "continuation_of") {
      const continuation = byId.get(edge.from);
      const parent = byId.get(edge.to);
      if (continuation && parent) output.set(parent.id, `${output.get(parent.id) ?? parent.text}${continuation.text}`.trim());
    }
  }
  return output;
}

function isHardWrap(above: LayoutBlock, below: LayoutBlock): boolean {
  const gap = above.bbox.y - below.bbox.y;
  if (gap < 0 || gap > Math.max(above.bbox.height, below.bbox.height) * 2.2) return false;
  if (HEADING_PATTERN.test(above.text.trim()) || HEADING_PATTERN.test(below.text.trim())) return false;
  if (/[。！？；.!?;:]$/u.test(above.text.trim())) return false;
  return /^[\p{Script=Han}A-Za-z0-9]/u.test(below.text.trim());
}

function euclideanDistance(left: LayoutBlock, right: LayoutBlock): number {
  const dx = left.bbox.x - right.bbox.x;
  const dy = left.bbox.y - right.bbox.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function add(edges: LayoutGraphEdge[], from: string, to: string, relation: LayoutGraphEdge["relation"], confidence: number) {
  if (from !== to) edges.push({ from, to, relation, confidence });
}

function uniqueEdges(edges: LayoutGraphEdge[]): LayoutGraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    const key = `${edge.from}:${edge.to}:${edge.relation}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
