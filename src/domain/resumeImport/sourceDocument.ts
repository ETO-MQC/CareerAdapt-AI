import {
  ResumeSourceDocumentV2Schema,
  type ImportedResumeDraftV2,
  type ResumeSourceBlockV2,
  type ResumeSourceDocumentV2
} from "@/domain/schemas";

export const RESUME_SOURCE_DOCUMENT_VERSION = "resume-source-document.v2";

export type SemanticSourceGroup = {
  id: string;
  blockIds: string[];
  blocks: ResumeSourceBlockV2[];
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

export function buildSemanticMappingBatches(
  document: ResumeSourceDocumentV2,
  maxChars = 20_000
): ResumeSourceBlockV2[][] {
  const groups = groupSourceDocument(document);
  const batches: ResumeSourceBlockV2[][] = [];
  let current: ResumeSourceBlockV2[] = [];
  let currentSize = 2;
  for (const group of groups) {
    const groupSize = JSON.stringify(group.blocks).length;
    if (groupSize > maxChars) {
      throw new Error(`resume_semantic_group_too_large:${group.id}`);
    }
    if (current.length && currentSize + groupSize > maxChars) {
      batches.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(...group.blocks);
    currentSize += groupSize;
  }
  if (current.length) batches.push(current);
  return batches;
}
