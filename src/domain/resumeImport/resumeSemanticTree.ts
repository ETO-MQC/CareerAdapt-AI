import { z } from "zod";
import type { ResumeItemV2, ResumeSectionTypeV2 } from "@/domain/schemas";
import { ResumeItemV2Schema, ResumeSectionTypeV2Schema } from "@/domain/schemas";
import { LayoutDocumentSchema, type LayoutDocument } from "./layoutDocument";
import { LayoutGraphSchema, type LayoutGraph } from "./layoutGraph";

export const RESUME_SEMANTIC_TREE_VERSION = "resume-semantic-tree-v1";

export const SemanticConfidenceSchema = z.object({
  section: z.number().min(0).max(1),
  itemBoundary: z.number().min(0).max(1),
  fieldRole: z.number().min(0).max(1),
  sourceBinding: z.number().min(0).max(1)
}).strict();

export const SemanticTextGroupSchema = z.object({
  id: z.string().min(1),
  blockIds: z.array(z.string().min(1)).min(1),
  role: z.enum(["description", "highlight", "skill_title", "skill_description"])
}).strict();

export const ResumeSemanticItemSchema = z.object({
  id: z.string().min(1),
  sourceBlockIds: z.array(z.string().min(1)).min(1),
  titleBlockIds: z.array(z.string().min(1)).default([]),
  organizationBlockIds: z.array(z.string().min(1)).default([]),
  roleBlockIds: z.array(z.string().min(1)).default([]),
  degreeBlockIds: z.array(z.string().min(1)).default([]),
  majorBlockIds: z.array(z.string().min(1)).default([]),
  dateBlockIds: z.array(z.string().min(1)).default([]),
  bodyBlockIds: z.array(z.string().min(1)).default([]),
  highlightBlockIds: z.array(z.string().min(1)).default([]),
  bodyGroups: z.array(SemanticTextGroupSchema).default([]),
  highlightGroups: z.array(SemanticTextGroupSchema).default([]),
  confidence: SemanticConfidenceSchema
}).strict();

export const ResumeSemanticSectionSchema = z.object({
  id: z.string().min(1),
  sectionType: ResumeSectionTypeV2Schema.exclude(["basics"]),
  headingBlockId: z.string().min(1),
  headingBlockIds: z.array(z.string().min(1)).min(1),
  itemIds: z.array(z.string().min(1)),
  confidence: SemanticConfidenceSchema
}).strict();

export const ResumeSemanticTreeSchema = z.object({
  schemaVersion: z.literal(RESUME_SEMANTIC_TREE_VERSION),
  sourceBlockIds: z.array(z.string().min(1)),
  basicsBlockIds: z.array(z.string().min(1)).default([]),
  consumedHeadingBlockIds: z.array(z.string().min(1)),
  sections: z.array(ResumeSemanticSectionSchema),
  items: z.array(ResumeSemanticItemSchema),
  invariantIssues: z.array(z.string())
}).strict().superRefine((tree, context) => {
  const itemIds = new Set(tree.items.map((item) => item.id));
  for (const [sectionIndex, section] of tree.sections.entries()) {
    for (const itemId of section.itemIds) {
      if (!itemIds.has(itemId)) context.addIssue({ code: "custom", path: ["sections", sectionIndex, "itemIds"], message: "semantic section references a missing item" });
    }
  }
});

export type ResumeSemanticTree = z.infer<typeof ResumeSemanticTreeSchema>;
export type ResumeSemanticItem = z.infer<typeof ResumeSemanticItemSchema>;
export type SemanticTextGroup = z.infer<typeof SemanticTextGroupSchema>;

export interface ResumeSemanticResolver {
  readonly id: string;
  resolve(input: { layoutDocument: LayoutDocument; layoutGraph: LayoutGraph }): ResumeSemanticTree;
}

const SECTION_TYPES: Array<[RegExp, Exclude<ResumeSectionTypeV2, "basics">]> = [
  [/^(?:个人总结|个人简介|自我评价)$/u, "summary"],
  [/^教育(?:背景|经历)$/u, "education"],
  [/^实习经历$/u, "internship"],
  [/^(?:项目与研究经历|项目经历)$/u, "project"],
  [/^(?:研究|科研)经历$/u, "research"],
  [/^工作经历$/u, "work"],
  [/^技能(?:与证书)?$/u, "skills"],
  [/^证书$/u, "certificates"]
];
const DATE_PATTERN = /(?<!\d)(?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:\s*(?:-|–|—|至|到)\s*(?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在|present|current))?/iu;
export class LocalDeterministicSemanticResolver implements ResumeSemanticResolver {
  readonly id = "local-deterministic-semantic-resolver.v1";

  resolve(input: { layoutDocument: LayoutDocument; layoutGraph: LayoutGraph }): ResumeSemanticTree {
    const document = LayoutDocumentSchema.parse(input.layoutDocument);
    const graph = LayoutGraphSchema.parse(input.layoutGraph);
    const rows = document.blocks.reduce<Array<{ blocks: LayoutDocument["blocks"]; text: string }>>((result, block) => {
      const row = result.find((candidate) => candidate.blocks[0]?.lineId === block.lineId);
      if (row) {
        row.blocks.push(block);
        row.blocks.sort((left, right) => left.bbox.x - right.bbox.x);
        row.text = row.blocks.map((item) => item.text).join("");
      } else result.push({ blocks: [block], text: block.text });
      return result;
    }, []);
    const headings = rows.flatMap((row) => {
      const match = SECTION_TYPES.find(([pattern]) => pattern.test(row.text.normalize("NFKC").trim()));
      return match ? [{ block: row.blocks[0], blocks: row.blocks, text: row.text, sectionType: match[1] }] : [];
    });
    const items: ResumeSemanticItem[] = [];
    const sections = headings.map((heading, sectionIndex) => {
      const next = headings[sectionIndex + 1]?.block;
      const body = document.blocks.filter((block) => isWithinSection(block, heading.block, next));
      const groups = groupItems(heading.sectionType, body);
      const itemIds = groups.map((group, itemIndex) => {
        const item = assignRoles(heading.sectionType, group, `semantic:${sectionIndex}:${itemIndex}`, graph);
        items.push(item);
        return item.id;
      });
      return {
        id: `semantic-section:${sectionIndex}`,
        sectionType: heading.sectionType,
        headingBlockId: heading.block.id,
        headingBlockIds: heading.blocks.map((block) => block.id),
        itemIds,
        confidence: confidence(0.98, groups.length ? 0.9 : 0.35, 0.86, 1)
      };
    });
    const sourceBlockIds = document.blocks.map((block) => block.id);
    const firstHeading = headings[0]?.block;
    const basicsBlockIds = document.blocks.filter((block) => !firstHeading || block.page < firstHeading.page || (block.page === firstHeading.page && block.bbox.y > firstHeading.bbox.y)).map((block) => block.id);
    const consumedHeadingBlockIds = headings.flatMap((heading) => heading.blocks.map((block) => block.id));
    const bound = new Set([...basicsBlockIds, ...consumedHeadingBlockIds, ...items.flatMap((item) => item.sourceBlockIds)]);
    const invariantIssues = sourceBlockIds.filter((id) => !bound.has(id)).map((id) => `unbound_source_block:${id}`);
    return ResumeSemanticTreeSchema.parse({
      schemaVersion: RESUME_SEMANTIC_TREE_VERSION,
      sourceBlockIds,
      basicsBlockIds,
      consumedHeadingBlockIds,
      sections,
      items,
      invariantIssues
    });
  }
}

export function mapSemanticItemToResumeItem(input: {
  sectionType: Exclude<ResumeSectionTypeV2, "basics">;
  item: ResumeSemanticItem;
  layoutDocument: LayoutDocument;
  layoutGraph?: LayoutGraph;
}): ResumeItemV2 {
  const document = LayoutDocumentSchema.parse(input.layoutDocument);
  const graph = input.layoutGraph ? LayoutGraphSchema.parse(input.layoutGraph) : undefined;
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  const read = (ids: readonly string[]) => joinLayoutBlockText(ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []));
  const [startDate, endDate, current] = parseDate(read(input.item.dateBlockIds));
  const highlightGroups = input.item.highlightGroups.length
    ? input.item.highlightGroups
    : input.item.highlightBlockIds.map((id, index): SemanticTextGroup => ({ id: `${input.item.id}:legacy-highlight:${index}`, blockIds: [id], role: "highlight" }));
  const bodyGroups = input.item.bodyGroups.length
    ? input.item.bodyGroups
    : input.item.bodyBlockIds.length ? [{ id: `${input.item.id}:legacy-body`, blockIds: input.item.bodyBlockIds, role: "description" as const }] : [];
  const highlights = highlightGroups.map((group) => materializeSemanticTextGroup({ group, layoutDocument: document, layoutGraph: graph })).filter(Boolean);
  const body = bodyGroups.map((group) => materializeSemanticTextGroup({ group, layoutDocument: document, layoutGraph: graph })).join("").trim();
  const customFields: [] = [];
  const common = { id: input.item.id, customFields };
  let candidate: ResumeItemV2;
  if (input.sectionType === "summary") candidate = { ...common, sectionType: "summary", text: body || read(input.item.sourceBlockIds) };
  else if (input.sectionType === "education") candidate = { ...common, sectionType: "education", school: read(input.item.organizationBlockIds) || undefined,
    major: read(input.item.majorBlockIds) || undefined, degree: read(input.item.degreeBlockIds) || undefined,
    startDate, endDate, current, courses: [], honors: [], highlights };
  else if (["work", "internship", "campus", "volunteer"].includes(input.sectionType)) candidate = { ...common,
    sectionType: input.sectionType as "work" | "internship" | "campus" | "volunteer",
    organization: read(input.item.organizationBlockIds) || undefined, role: read(input.item.roleBlockIds) || undefined,
    description: body || undefined, startDate, endDate, current, highlights };
  else if (input.sectionType === "project") candidate = { ...common, sectionType: "project", title: read(input.item.titleBlockIds) || undefined,
    role: read(input.item.roleBlockIds) || undefined, description: body || undefined, startDate, endDate, current,
    tools: [], highlights, outcomes: [] };
  else if (input.sectionType === "research") candidate = { ...common, sectionType: "research", title: read(input.item.titleBlockIds) || undefined,
    authorRole: read(input.item.roleBlockIds) || undefined, description: body || undefined, startDate, endDate, current,
    methods: [], highlights };
  else if (input.sectionType === "skills") {
    const skillText = materializeSemanticTextGroup({
      group: { id: `${input.item.id}:skill`, blockIds: input.item.sourceBlockIds, role: "skill_description" },
      layoutDocument: document,
      layoutGraph: graph
    });
    const boundary = skillText.search(/[:：]/u);
    const groupedName = input.item.bodyGroups.find((group) => group.role === "skill_title");
    const groupedDescription = input.item.bodyGroups.find((group) => group.role === "skill_description");
    const name = groupedName ? materializeSemanticTextGroup({ group: groupedName, layoutDocument: document, layoutGraph: graph })
      : boundary >= 0 ? skillText.slice(0, boundary).trim() : read(input.item.titleBlockIds) || skillText;
    const description = groupedDescription ? materializeSemanticTextGroup({ group: groupedDescription, layoutDocument: document, layoutGraph: graph })
      : boundary >= 0 ? skillText.slice(boundary + 1).trim() : body;
    candidate = { ...common, sectionType: "skills", name, description: description || undefined };
  }
  else if (input.sectionType === "certificates") candidate = { ...common, sectionType: "certificates", name: read(input.item.titleBlockIds) || read(input.item.sourceBlockIds), description: body || undefined };
  else candidate = { ...common, sectionType: "other", title: read(input.item.titleBlockIds) || undefined, description: body || read(input.item.sourceBlockIds), highlights };
  return ResumeItemV2Schema.parse(candidate);
}

export function materializeSemanticTextGroup(input: {
  group: SemanticTextGroup;
  layoutDocument: LayoutDocument;
  layoutGraph?: LayoutGraph;
}): string {
  const document = LayoutDocumentSchema.parse(input.layoutDocument);
  const graph = input.layoutGraph ? LayoutGraphSchema.parse(input.layoutGraph) : undefined;
  const byId = new Map(document.blocks.map((block) => [block.id, block]));
  const ids = new Set(input.group.blockIds);
  const graphMarkers = new Set(graph?.edges.flatMap((edge) => edge.relation === "bullet_content_of" ? [edge.from] : []) ?? []);
  const groupBlocks = [...ids].flatMap((id) => byId.get(id) ? [byId.get(id)!] : [])
    .filter((block) => !graphMarkers.has(block.id) && !isBulletMarker(block.text));
  return stripBullet(joinLayoutBlockText(groupBlocks, false));
}

export function semanticSourceCoverage(tree: ResumeSemanticTree): number {
  if (!tree.sourceBlockIds.length) return 1;
  const consumed = new Set([...tree.basicsBlockIds, ...tree.consumedHeadingBlockIds, ...tree.items.flatMap((item) => item.sourceBlockIds)]);
  return tree.sourceBlockIds.filter((id) => consumed.has(id)).length / tree.sourceBlockIds.length;
}

function groupItems(sectionType: Exclude<ResumeSectionTypeV2, "basics">, blocks: LayoutDocument["blocks"]): LayoutDocument["blocks"][] {
  if (!blocks.length) return [];
  if (sectionType === "summary" || sectionType === "education") return [blocks];
  const groups: LayoutDocument["blocks"][] = [];
  let current: LayoutDocument["blocks"] = [];
  const rows = blocks.reduce<LayoutDocument["blocks"][]>((result, block) => {
    const row = result.find((candidate) => candidate[0]?.lineId === block.lineId);
    if (row) row.push(block);
    else result.push([block]);
    return result;
  }, []);
  for (const row of rows) {
    const startsItem = row.some((block) => DATE_PATTERN.test(block.text)) && current.length > 0
      || ((sectionType === "skills" || sectionType === "certificates") && row.some((block) => /^[•·●▪◦■□◆◇▶►*-]\s*$/u.test(block.text.trim())) && current.length > 0)
      || ((sectionType === "skills" || sectionType === "certificates") && row.some((block) => block.font.weight !== undefined && block.font.weight >= 600) && current.length > 0);
    if (startsItem) {
      groups.push(current);
      current = [];
    }
    current.push(...row);
  }
  if (current.length) groups.push(current);
  return groups;
}

function assignRoles(sectionType: Exclude<ResumeSectionTypeV2, "basics">, blocks: LayoutDocument["blocks"], id: string, graph: LayoutGraph): ResumeSemanticItem {
  const dateStartBlock = blocks.find((block) => DATE_PATTERN.test(block.text));
  const dateBlocks = dateStartBlock
    ? blocks.filter((block) => block.lineId === dateStartBlock.lineId && block.bbox.x >= dateStartBlock.bbox.x)
    : [];
  const markerBlocks = blocks.filter((block) => /^[•·●▪◦■□◆◇▶►*-]\s*$/u.test(block.text.trim()));
  const highlightGroups = ["skills", "certificates"].includes(sectionType) ? [] : buildHighlightGroups(blocks, markerBlocks, graph, id);
  const highlightIds = new Set(highlightGroups.flatMap((group) => group.blockIds));
  const highlightBlocks = blocks.filter((block) => highlightIds.has(block.id));
  const headerLineId = blocks.find((block) => !markerBlocks.includes(block))?.lineId;
  const header = sectionType === "summary" ? [] : blocks.filter((block) => !dateBlocks.includes(block) && !highlightBlocks.includes(block) && !markerBlocks.includes(block) && block.lineId === headerLineId);
  const remaining = blocks.filter((block) => !dateBlocks.includes(block) && !header.includes(block) && !highlightBlocks.includes(block) && !markerBlocks.includes(block));
  const headerGroups = partitionHeaderFields(header, sectionType === "education" ? 3 : ["work", "internship", "campus", "volunteer", "project", "research"].includes(sectionType) ? 2 : 1);
  const titleBlockIds = sectionType === "project" || sectionType === "research" || sectionType === "skills" || sectionType === "certificates" ? (headerGroups[0] ?? []).map((block) => block.id) : [];
  const organizationBlockIds = sectionType === "education" || ["work", "internship", "campus", "volunteer"].includes(sectionType) ? (headerGroups[0] ?? []).map((block) => block.id) : [];
  const roleBlockIds = ["work", "internship", "campus", "volunteer", "project", "research"].includes(sectionType) ? (headerGroups[1] ?? []).map((block) => block.id) : [];
  const majorBlockIds = sectionType === "education" ? (headerGroups[1] ?? []).map((block) => block.id) : [];
  const degreeBlockIds = sectionType === "education" ? (headerGroups[2] ?? []).map((block) => block.id) : [];
  const bodyGroups: SemanticTextGroup[] = remaining.length ? [{
    id: `${id}:body:0`,
    blockIds: remaining.map((block) => block.id),
    role: "description"
  }] : [];
  return {
    id,
    sourceBlockIds: blocks.map((block) => block.id),
    titleBlockIds,
    organizationBlockIds,
    roleBlockIds,
    degreeBlockIds,
    majorBlockIds,
    dateBlockIds: dateBlocks.map((block) => block.id),
    bodyBlockIds: remaining.map((block) => block.id),
    highlightBlockIds: highlightBlocks.map((block) => block.id),
    bodyGroups,
    highlightGroups,
    confidence: confidence(0.95, dateBlocks.length || ["summary", "education", "skills", "certificates"].includes(sectionType) ? 0.88 : 0.62, header.length ? 0.84 : 0.55, 1)
  };
}

function buildHighlightGroups(blocks: LayoutDocument["blocks"], markerBlocks: LayoutDocument["blocks"], graph: LayoutGraph, itemId: string): SemanticTextGroup[] {
  const allowed = new Set(blocks.map((block) => block.id));
  const markers = new Set(markerBlocks.map((block) => block.id));
  const byId = new Map(blocks.map((block) => [block.id, block]));
  return markerBlocks.flatMap((marker, index) => {
    const nextMarkerOrder = markerBlocks[index + 1]?.order ?? Number.POSITIVE_INFINITY;
    const seedIds = graph.edges.flatMap((edge) => edge.relation === "bullet_content_of" && edge.from === marker.id && allowed.has(edge.to) ? [edge.to] : []);
    if (!seedIds.length) return [];
    const ids = new Set(seedIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (!allowed.has(edge.from) || !allowed.has(edge.to) || markers.has(edge.from) || markers.has(edge.to)) continue;
        const connected = edge.relation === "same_row" || edge.relation === "continuation_of";
        if (!connected || ids.has(edge.from) === ids.has(edge.to)) continue;
        const candidateId = ids.has(edge.from) ? edge.to : edge.from;
        const candidate = byId.get(candidateId);
        const anchor = byId.get(ids.has(edge.from) ? edge.from : edge.to);
        if (!candidate || !anchor || candidate.order <= marker.order || candidate.order >= nextMarkerOrder
          || edge.relation === "continuation_of" && !sameIndent(anchor, candidate)) continue;
        ids.add(candidateId);
        changed = true;
      }
    }
    return [{ id: `${itemId}:highlight:${index}`, blockIds: [...ids], role: "highlight" as const }];
  });
}

function sameIndent(left: LayoutDocument["blocks"][number], right: LayoutDocument["blocks"][number]): boolean {
  return Math.abs(left.bbox.x - right.bbox.x) <= Math.max(left.bbox.height, right.bbox.height) * 1.6;
}

function isBulletMarker(value: string): boolean {
  return /^[\s•·●▪◦■□◆◇▶►*-]+$/u.test(value.trim());
}

function isWithinSection(block: LayoutDocument["blocks"][number], heading: LayoutDocument["blocks"][number], next?: LayoutDocument["blocks"][number]): boolean {
  if (block.id === heading.id || block.page < heading.page) return false;
  if (next && (block.page > next.page || (block.page === next.page && block.bbox.y <= next.bbox.y))) return false;
  return block.page > heading.page || block.bbox.y < heading.bbox.y;
}

function parseDate(value: string): [string | undefined, string | undefined, boolean] {
  const range = value.match(/((?:19|20)\d{2}(?:[./年-]\d{1,2})?)\s*(?:-|–|—|至|到)\s*((?:(?:19|20)\d{2}(?:[./年-]\d{1,2})?)|至今|现在|present|current)/iu);
  const tokens = range ? [range[1], range[2]] : [value];
  const normalize = (token?: string) => {
    const match = token?.match(/((?:19|20)\d{2})(?:[./年-](\d{1,2}))?/);
    return match ? (match[2] ? `${match[1]}-${match[2].padStart(2, "0")}` : match[1]) : undefined;
  };
  const current = /(?:至今|现在|present|current)/iu.test(tokens[1] ?? "");
  return [normalize(tokens[0]), current ? undefined : normalize(tokens[1]), current];
}

function stripBullet(value: string): string {
  return value.replace(/^[\s•·●▪◦■□◆◇▶►*-]+/u, "").trim();
}

function partitionHeaderFields(blocks: LayoutDocument["blocks"], targetCount: number): LayoutDocument["blocks"][] {
  const sorted = [...blocks].sort((left, right) => left.bbox.x - right.bbox.x);
  if (targetCount <= 1 || sorted.length <= 1) return [sorted];
  const boundaries = sorted.slice(0, -1).map((block, index) => ({
    index: index + 1,
    gap: sorted[index + 1].bbox.x - (block.bbox.x + block.bbox.width)
  })).sort((left, right) => right.gap - left.gap).slice(0, Math.min(targetCount - 1, sorted.length - 1)).map((entry) => entry.index).sort((a, b) => a - b);
  const groups: LayoutDocument["blocks"][] = [];
  let start = 0;
  for (const boundary of boundaries) {
    groups.push(sorted.slice(start, boundary));
    start = boundary;
  }
  groups.push(sorted.slice(start));
  return groups;
}

function joinLayoutBlockText(blocks: LayoutDocument["blocks"], preserveLineBreaks = true): string {
  const sorted = [...blocks].sort((left, right) => left.page - right.page || right.bbox.y - left.bbox.y || left.bbox.x - right.bbox.x);
  let text = "";
  let previous: LayoutDocument["blocks"][number] | undefined;
  for (const block of sorted) {
    if (!previous) text = block.text.trim();
    else if (previous.lineId !== block.lineId) text += `${preserveLineBreaks ? "\n" : ""}${block.text.trim()}`;
    else {
      const gap = block.bbox.x - (previous.bbox.x + previous.bbox.width);
      const size = Math.max(previous.font.size ?? previous.bbox.height, block.font.size ?? block.bbox.height);
      const left = previous.text.at(-1) ?? "";
      const right = block.text.at(0) ?? "";
      const space = gap > size * 0.28 && /[A-Za-z0-9)]/.test(left) && /[A-Za-z0-9(]/.test(right) ? " " : "";
      text += `${space}${block.text.trim()}`;
    }
    previous = block;
  }
  return text.trim();
}

function confidence(section: number, itemBoundary: number, fieldRole: number, sourceBinding: number) {
  return { section, itemBoundary, fieldRole, sourceBinding };
}
