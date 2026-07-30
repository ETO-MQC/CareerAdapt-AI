import {
  ResumeSourceDocumentV2Schema,
  type ImportedResumeDraftV2,
  type ResumeSourceBlockV2,
  type ResumeSourceDocumentV2
} from "@/domain/schemas";
import type { SensitiveTextTokenizer } from "@/services/security/text";

export const RESUME_SOURCE_DOCUMENT_VERSION = "resume-source-document.v2";

export type SemanticSourceGroup = {
  id: string;
  blockIds: string[];
  blocks: ResumeSourceBlockV2[];
};

export type AiResumeSourceBlock = {
  id: string;
  text: string;
  blockType: ResumeSourceBlockV2["blockType"];
  order: number;
  page?: number;
  parentId?: string;
  rowIndex?: number;
  columnIndex?: number;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  originalBlockId?: string;
  fragment?: {
    index: number;
    start: number;
    end: number;
  };
};

export function sourceDocumentFromDraft(draft: ImportedResumeDraftV2): ResumeSourceDocumentV2 {
  return ResumeSourceDocumentV2Schema.parse({
    schemaVersion: "resume-source-document-v2",
    sourceId: draft.source.sourceSessionId ?? draft.importId,
    sourceKind: draft.sourceKind,
    fileName: draft.source.fileName,
    fileHash: draft.source.fileHash,
    pageCount: draft.source.pageCount,
    blocks: draft.sourceBlocks,
    quality: draft.qualityReport
  });
}

export function groupSourceDocument(document: ResumeSourceDocumentV2): SemanticSourceGroup[] {
  const groups: SemanticSourceGroup[] = [];
  let current: ResumeSourceBlockV2[] = [];
  const flush = () => {
    if (!current.length) return;
    const index = groups.length + 1;
    groups.push({ id: `source-group-${index}`, blockIds: current.map((block) => block.id), blocks: current });
    current = [];
  };
  for (const block of document.blocks) {
    if (block.blockType === "heading" && current.length) flush();
    current.push(block);
  }
  flush();
  return groups;
}

export function tokenizeResumeSourceDocument(
  document: ResumeSourceDocumentV2,
  tokenizer: SensitiveTextTokenizer
): ResumeSourceDocumentV2 {
  return ResumeSourceDocumentV2Schema.parse({
    ...document,
    blocks: document.blocks.map((block) => ({
      ...block,
      text: tokenizer.tokenize(block.text).text,
      rawText: tokenizer.tokenize(block.rawText).text,
      normalizedText: tokenizer.tokenize(block.normalizedText).text
    }))
  });
}

export function toAiResumeSourceBlock(block: ResumeSourceBlockV2): AiResumeSourceBlock {
  return {
    id: block.id,
    text: block.normalizedText,
    blockType: block.blockType,
    order: block.order,
    ...(block.page === undefined ? {} : { page: block.page }),
    ...(block.parentId === undefined ? {} : { parentId: block.parentId }),
    ...(block.rowIndex === undefined ? {} : { rowIndex: block.rowIndex }),
    ...(block.columnIndex === undefined ? {} : { columnIndex: block.columnIndex }),
    ...(block.position ? {
      bbox: {
        x: roundLayout(block.position.x),
        y: roundLayout(block.position.y),
        width: roundLayout(block.position.width),
        height: roundLayout(block.position.height)
      }
    } : {})
  };
}

export function buildSemanticMappingBatches(
  document: ResumeSourceDocumentV2,
  maxChars = 20_000
): AiResumeSourceBlock[][] {
  const groups = groupSourceDocument(document);
  const batches: AiResumeSourceBlock[][] = [];
  let current: AiResumeSourceBlock[] = [];

  const flush = () => {
    if (current.length) batches.push(current);
    current = [];
  };

  const append = (block: AiResumeSourceBlock) => {
    if (current.length && serializedSize([...current, block]) > maxChars) flush();
    if (serializedSize([block]) <= maxChars) {
      current.push(block);
      return;
    }
    for (const fragment of fragmentAiBlock(block, maxChars)) {
      if (current.length && serializedSize([...current, fragment]) > maxChars) flush();
      current.push(fragment);
    }
  };

  for (const group of groups) {
    const compactGroup = group.blocks.map(toAiResumeSourceBlock);
    if (
      current.length
      && serializedSize([...current, ...compactGroup]) > maxChars
      && serializedSize(compactGroup) <= maxChars
    ) {
      flush();
    }
    compactGroup.forEach(append);
  }
  flush();
  return batches;
}

function fragmentAiBlock(block: AiResumeSourceBlock, maxChars: number): AiResumeSourceBlock[] {
  const originalBlockId = block.originalBlockId ?? block.id;
  const emptyFragmentSize = serializedSize([{
    ...block,
    id: `${originalBlockId}#fragment-999`,
    text: "",
    originalBlockId,
    fragment: { index: 999, start: block.text.length, end: block.text.length }
  }]);
  const maxTextChars = Math.max(1, maxChars - emptyFragmentSize - 8);
  const fragments: AiResumeSourceBlock[] = [];
  let start = 0;
  while (start < block.text.length) {
    let end = Math.min(block.text.length, start + maxTextChars);
    if (end < block.text.length) {
      const safeBreak = Math.max(
        block.text.lastIndexOf("\n", end),
        block.text.lastIndexOf("。", end),
        block.text.lastIndexOf("；", end),
        block.text.lastIndexOf(" ", end)
      );
      if (safeBreak > start + Math.floor(maxTextChars / 2)) end = safeBreak + 1;
    }
    const index = fragments.length;
    fragments.push({
      ...block,
      id: `${originalBlockId}#fragment-${index + 1}`,
      text: block.text.slice(start, end),
      originalBlockId,
      fragment: { index, start, end }
    });
    start = end;
  }
  return fragments;
}

function serializedSize(blocks: readonly AiResumeSourceBlock[]) {
  return JSON.stringify(blocks).length;
}

function roundLayout(value: number) {
  return Math.round(value * 1000) / 1000;
}
