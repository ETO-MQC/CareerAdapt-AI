import { nanoid } from "nanoid";
import {
  ImportedResumeDraftSchema,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeItem,
  type ImportedResumePage,
  type ImportedResumePageRef,
  type ImportedResumeSection,
  type ImportedResumeFieldCandidate,
  type ImportQualityReport,
  type MappingDecision,
  type NormalizedSourceBlock,
  type ResumeSourceKind,
  StructuredResumeDraftSchema,
  type ImportedResumeSource,
  type CareerAdaptResumeJsonV2,
  type PdfPageText,
  type StructuredResumeDraft
} from "@/domain/schemas";
import { locatePdfSourceQuote } from "@/domain/pdfImport/sourceMapping";
import {
  buildImportQualityReportV2,
  buildResumeSourceBlocksV2,
  classifyImportSource,
  RESUME_IMPORT_PIPELINE_VERSION
} from "./pipeline";
import { computeResidualSegments, createDeterministicFieldCandidates, type ConsumedSourceRange } from "./fieldCandidates";
import { matchResumeSectionHeading, type ImportedResumeCategory, type ImportedResumeSectionType } from "./sectionHeading";
import { segmentResumeItems } from "./itemSegmenter";
import { extractSegmentedItemFields, itemDisplayLabel } from "./itemFieldExtractor";
import { projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import type { LayoutDocument } from "./layoutDocument";
import type { LayoutGraph } from "./layoutGraph";
import { mapSemanticItemToResumeItem, type ResumeSemanticTree } from "./resumeSemanticTree";

export const RESUME_IMPORT_PARSER_VERSION = "resume-import.local-rules.v2";

type PageInput = Pick<PdfPageText, "pageNumber" | "extractedPageText" | "cleanedPageText" | "charStart" | "charEnd">;

type SourceInput = {
  sourceSessionId?: string;
  rawInputId?: string;
  fileName: string;
  mimeType?: ImportedResumeSource["mimeType"];
  fileHash: string;
  normalizedTextHash?: string;
  pageCount: number;
  extractedAt?: string;
};

type LineWithPage = {
  text: string;
  pageNumber: number;
};

type ResumeLayoutArtifact = {
  layoutDocument: LayoutDocument;
  layoutGraph: LayoutGraph;
  semanticTree: ResumeSemanticTree;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?\d[\d\s-]{7,}\d|1[3-9]\d{9})/;
const LINK_PATTERN = /(?:https?:\/\/|www\.|github\.com\/|linkedin\.com\/)[^\s，,；;]+/i;

export function createImportedResumeDraftFromPdf(input: {
  importId?: string;
  source: SourceInput;
  pages: PageInput[];
  sourceKind?: ResumeSourceKind;
  sourceBlocks?: NormalizedSourceBlock[];
  qualityReport?: ImportQualityReport;
  layoutArtifacts?: ResumeLayoutArtifact[];
  now?: string;
}): ImportedResumeDraft {
  return createImportedResumeDraftFromText({
    ...input,
    source: {
      ...input.source,
      mimeType: "application/pdf"
    }
  });
}

export function createImportedResumeDraftFromText(input: {
  importId?: string;
  source: SourceInput & { mimeType: ImportedResumeSource["mimeType"] };
  pages: PageInput[];
  sourceKind?: ResumeSourceKind;
  sourceBlocks?: NormalizedSourceBlock[];
  qualityReport?: ImportQualityReport;
  layoutArtifacts?: ResumeLayoutArtifact[];
  now?: string;
}): ImportedResumeDraft {
  const now = input.now ?? new Date().toISOString();
  const importId = input.importId ?? `resume-import-${nanoid(10)}`;
  const pages = input.pages.map((page): ImportedResumePage => ({
    pageNumber: page.pageNumber,
    rawText: page.extractedPageText,
    normalizedText: page.cleanedPageText,
    charStart: page.charStart,
    charEnd: page.charEnd
  }));
  const pageSources = input.pages.map((page) => ({
    pageNumber: page.pageNumber,
    cleanedPageText: page.cleanedPageText,
    charStart: page.charStart,
    charEnd: page.charEnd
  }));
  const normalizedSourceBlocks = input.sourceBlocks?.length
    ? input.sourceBlocks
    : createFallbackSourceBlocks(pages, input.source.mimeType);
  const classification = classifyImportSource({
    sourceKind: input.sourceKind ?? (input.source.mimeType === "application/pdf" ? "text_pdf" : "docx"),
    qualityReport: input.qualityReport,
    blocks: normalizedSourceBlocks
  });
  const sourceBlocks = buildResumeSourceBlocksV2({ blocks: normalizedSourceBlocks, classification });
  const qualityReport = buildImportQualityReportV2({
    classification,
    pageCount: input.source.pageCount,
    blocks: sourceBlocks,
    legacyReport: input.qualityReport
  });
  const candidateResult = createDeterministicFieldCandidates(sourceBlocks);
  const basics = detectBasicsFromBlocks(sourceBlocks, pageSources);
  const sections = input.layoutArtifacts?.length
    ? detectSectionsFromSemanticArtifacts(input.layoutArtifacts, sourceBlocks)
    : detectSectionsFromBlocks(sourceBlocks);
  const abnormalPhoneCandidate: ImportedResumeFieldCandidate[] = basics.phone?.confidence === "low" && basics.phone.sourceBlockIds.length ? [{
    id: `candidate-abnormal-phone-${importId}`,
    targetFieldId: "basics.phone",
    value: basics.phone.value,
    sourceBlockIds: basics.phone.sourceBlockIds,
    sourceRanges: basics.phone.sourceRanges,
    sourceQuote: basics.phone.value,
    confidence: 0.45,
    needsConfirmation: true,
    userConfirmed: false,
    reviewStatus: "needs_review",
    mappingReason: "电话号码位数不符合常见手机号格式，保留原值等待人工核对。"
  }] : [];
  const fieldCandidates = bindCandidatesToItems([...candidateResult.candidates, ...abnormalPhoneCandidate], sections, sourceBlocks);
  const mappingDecisions = fieldCandidates.map((candidate) => ({
    kind: "canonical_field" as const,
    targetFieldId: candidate.targetFieldId,
    sourceBlockIds: candidate.sourceBlockIds,
    sourceQuote: candidate.sourceQuote,
    confidence: candidate.confidence,
    needsConfirmation: candidate.needsConfirmation,
    mappingReason: candidate.mappingReason
  }));
  const structureConsumedRanges = collectStructureConsumedRanges({ basics, sections, sourceBlocks });
  const residualSegments = computeResidualSegments(
    [...candidateResult.consumedRanges, ...structureConsumedRanges],
    sourceBlocks
  );
  const warnings = [
    ...sections
      .filter((section) => section.sectionType === "unknown")
      .map((section) => ({
        code: "unknown_section",
        message: `无法自动判断栏目：${section.detectedTitle}`,
        sectionId: section.id
      })),
    ...sections
      .flatMap((section) => section.items)
      .filter((item) => item.sourceStatus !== "located")
      .map((item) => ({
        code: `source_${item.sourceStatus}`,
        message: "该条目未能在 PDF 页文本中唯一定位，默认需要用户核对。",
        itemId: item.id,
        pageNumber: item.pageRefs[0]?.pageNumber
      }))
  ];

  return ImportedResumeDraftSchema.parse({
    id: importId,
    schemaVersion: "resume-import-v2",
    importId,
    revision: 0,
    status: "reviewing",
    source: {
      sourceSessionId: input.source.sourceSessionId,
      rawInputId: input.source.rawInputId,
      fileName: input.source.fileName,
      mimeType: input.source.mimeType,
      fileHash: input.source.fileHash,
      normalizedTextHash: input.source.normalizedTextHash,
      pageCount: input.source.pageCount,
      extractedAt: input.source.extractedAt ?? now
    },
    sourceKind: classification,
    sourceBlocks,
    qualityReport,
    basics,
    sections,
    pages,
    unclassifiedBlocks: residualSegments.map((segment) => ({
      sourceBlockId: segment.blockId,
      sourceRange: { blockId: segment.blockId, start: segment.start, end: segment.end },
      text: segment.normalizedText,
      reason: "未映射文本区间"
    })),
    warnings,
    mappingDecisions,
    fieldCandidates,
    parserVersion: `${RESUME_IMPORT_PIPELINE_VERSION}.${RESUME_IMPORT_PARSER_VERSION}`,
    createdAt: now,
    updatedAt: now
  });
}

export function createImportedResumeDraftFromStructuredJson(input: {
  importId?: string;
  source: SourceInput & { mimeType: ImportedResumeSource["mimeType"] };
  structuredDraft: StructuredResumeDraft;
  unclassifiedBlocks?: ImportedResumeDraft["unclassifiedBlocks"];
  sourceKind?: "standard_json" | "external_json";
  sourceBlocks?: NormalizedSourceBlock[];
  qualityReport?: ImportQualityReport;
  mappingDecisions?: MappingDecision[];
  fieldCandidates?: ImportedResumeFieldCandidate[];
  canonicalResume?: CareerAdaptResumeJsonV2;
  now?: string;
}): ImportedResumeDraft {
  const now = input.now ?? new Date().toISOString();
  const importId = input.importId ?? `resume-import-${nanoid(10)}`;
  const structuredDraft = StructuredResumeDraftSchema.parse(input.structuredDraft);
  const pageText = structuredJsonToReviewText(structuredDraft);
  const normalizedSourceBlocks = input.sourceBlocks?.length
    ? input.sourceBlocks
    : createFallbackSourceBlocks([{ pageNumber: 1, rawText: pageText, normalizedText: pageText }], input.source.mimeType);
  const classification = classifyImportSource({
    sourceKind: input.sourceKind ?? "standard_json",
    qualityReport: input.qualityReport,
    blocks: normalizedSourceBlocks
  });
  const sourceBlocksV2 = buildResumeSourceBlocksV2({ blocks: normalizedSourceBlocks, classification });
  const qualityReportV2 = buildImportQualityReportV2({
    classification,
    pageCount: 1,
    blocks: sourceBlocksV2,
    legacyReport: input.qualityReport
  });
  const pageSources = [{
    pageNumber: 1,
    cleanedPageText: pageText,
    charStart: 0,
    charEnd: pageText.length
  }];
  const structuredField = (value: NonNullable<StructuredResumeDraft["basics"]["name"]>, confidence: "high" | "medium" | "low") => {
    const field = makeStructuredField(value, pageSources, confidence);
    const mappingPaths = typeof value === "string" ? [] : value.mapping.sourcePaths;
    const matches = sourceBlocksV2.filter((block) => mappingPaths.includes(block.sourcePath ?? "") || block.normalizedText.includes(field.value));
    return { ...field, sourceBlockIds: matches.map((block) => block.id), sourceQuote: field.value };
  };
  const canonicalJsonField = (value: string, needsConfirmation = false) => {
    const matches = sourceBlocksV2.filter((block) => block.normalizedText.includes(value) || value.includes(block.normalizedText));
    return {
      ...makeField(value, pageSources, needsConfirmation ? "low" as const : "high" as const),
      sourceStatus: needsConfirmation ? "ambiguous" as const : "located" as const,
      userEdited: false,
      sourceBlockIds: matches.map((block) => block.id),
      sourceRanges: matches.flatMap((block) => block.normalizedText ? [{ blockId: block.id, start: 0, end: block.normalizedText.length }] : []),
      sourceQuote: value
    };
  };
  const canonicalBasics = input.canonicalResume?.basics;
  const abnormalCanonicalPhone = Boolean(canonicalBasics?.phone && !/^1[3-9]\d{9}$/.test(canonicalBasics.phone.replace(/\D/g, "")));
  const basics = {
    name: canonicalBasics?.name ? canonicalJsonField(canonicalBasics.name) : structuredDraft.basics.name ? structuredField(structuredDraft.basics.name, "high") : undefined,
    email: canonicalBasics?.email ? canonicalJsonField(canonicalBasics.email) : structuredDraft.basics.email ? structuredField(structuredDraft.basics.email, "high") : undefined,
    phone: canonicalBasics?.phone ? canonicalJsonField(canonicalBasics.phone, abnormalCanonicalPhone) : structuredDraft.basics.phone ? structuredField(structuredDraft.basics.phone, "medium") : undefined,
    location: canonicalBasics?.location ? canonicalJsonField(canonicalBasics.location) : structuredDraft.basics.location ? structuredField(structuredDraft.basics.location, "medium") : undefined,
    links: canonicalBasics
      ? [
          canonicalBasics.homepage,
          canonicalBasics.linkedin,
          canonicalBasics.github,
          ...canonicalBasics.portfolioLinks,
          ...canonicalBasics.otherLinks
        ].filter((value): value is string => Boolean(value)).map((value) => canonicalJsonField(value))
      : (structuredDraft.basics.links ?? []).map((link) => structuredField(link, "medium")),
    targetRole: canonicalBasics?.targetRole ? canonicalJsonField(canonicalBasics.targetRole) : undefined,
    summary: input.canonicalResume
      ? canonicalBasics?.summary ? canonicalJsonField(canonicalBasics.summary) : undefined
      : structuredDraft.basics.summary ? structuredField(structuredDraft.basics.summary, "medium") : undefined
  };
  const sections: ImportedResumeSection[] = input.canonicalResume ? input.canonicalResume.sections.map((section, sectionIndex) => ({
    id: section.id,
    sectionType: section.sectionType,
    category: inferStructuredCategory(section.title, section.sectionType),
    detectedTitle: section.title,
    included: section.visible,
    order: section.order,
    confidence: "high",
    items: section.items.map((structuredItem, itemIndex) => {
      const traceBlockIds = new Set((section.mappingTrace ?? []).flatMap((trace) => trace.sourceBlockIds));
      const evidenceValues = structuredItemEvidenceValues(structuredItem);
      const sourceBlocks = sourceBlocksV2.filter((block) => traceBlockIds.has(block.id)
        || Boolean(block.sourcePath && traceBlockIds.has(block.sourcePath))
        || block.sourcePath?.includes(`sections.${sectionIndex}.items.${itemIndex}`)
        || block.sourcePath?.includes(`sections[${sectionIndex}].items[${itemIndex}]`)
        || evidenceValues.some((value) =>
          block.normalizedText === value
          || block.normalizedText.includes(value)
          || value.includes(block.normalizedText)
        ));
      const text = projectResumeItemV2(structuredItem);
      return {
        id: structuredItem.id,
        rawText: text,
        normalizedText: text,
        included: section.visible,
        order: itemIndex,
        pageRefs: [{ pageNumber: 1, quote: text.slice(0, 240) }],
        confidence: "high" as const,
        sourceStatus: sourceBlocks.length ? "located" as const : "ambiguous" as const,
        userEdited: false,
        sourceBlockIds: sourceBlocks.map((block) => block.id),
        sourceQuote: text,
        itemLabel: itemDisplayLabel(structuredItem),
        structuredItem,
        structuredMappingTrace: section.mappingTrace ?? []
      };
    })
  })) : structuredDraft.sections.map((section, sectionIndex) => ({
    id: `import-section-${sectionIndex}-${nanoid(6)}`,
    sectionType: section.sectionType,
    category: section.category ?? inferStructuredCategory(section.title, section.sectionType),
    detectedTitle: section.title,
    included: section.included ?? section.sectionType !== "unknown",
    order: sectionIndex,
    confidence: section.sectionType === "unknown" ? "low" : "high",
    mapping: section.mapping,
    items: section.items.map((item, itemIndex) => {
      const normalized = structuredItemText(item);
      const mapping = typeof item === "string" ? undefined : item.mapping;
      const sourceBlocks = sourceBlocksV2.filter((block) =>
        mapping?.sourcePaths.includes(block.sourcePath ?? "")
        || block.normalizedText.includes(normalized)
        || normalized.includes(block.normalizedText)
      );
      return {
        id: `import-item-${nanoid(10)}`,
        rawText: normalized,
        normalizedText: normalized.trim(),
        included: typeof item === "string" ? true : item.included ?? !mapping?.needsConfirmation,
        order: itemIndex,
        pageRefs: [{ pageNumber: 1, quote: normalized.trim().slice(0, 240) }],
        confidence: mapping?.confidenceLevel ?? "high" as const,
        sourceStatus: mapping?.needsConfirmation ? "ambiguous" as const : "user_confirmed_modified" as const,
        userEdited: !mapping,
        sourceBlockIds: sourceBlocks.map((block) => block.id),
        sourceQuote: normalized.trim(),
        structuredMappingTrace: [],
        mapping
      };
    })
  }));

  return ImportedResumeDraftSchema.parse({
    id: importId,
    schemaVersion: "resume-import-v2",
    importId,
    revision: 0,
    status: "reviewing",
    source: {
      sourceSessionId: input.source.sourceSessionId,
      rawInputId: input.source.rawInputId,
      fileName: input.source.fileName,
      mimeType: input.source.mimeType,
      fileHash: input.source.fileHash,
      normalizedTextHash: input.source.normalizedTextHash,
      pageCount: 1,
      extractedAt: input.source.extractedAt ?? now
    },
    sourceKind: classification,
    sourceBlocks: sourceBlocksV2,
    qualityReport: qualityReportV2,
    basics,
    sections,
    pages: [{
      pageNumber: 1,
      rawText: pageText,
      normalizedText: pageText,
      charStart: 0,
      charEnd: pageText.length
    }],
    unclassifiedBlocks: input.unclassifiedBlocks ?? [],
    warnings: [
      ...(abnormalCanonicalPhone ? [{ code: "abnormal_phone_format", message: "电话号码格式异常，已保留原值，请人工核对。" }] : []),
      ...sections
      .filter((section) => section.sectionType === "unknown")
      .map((section) => ({
        code: "unknown_section",
        message: `JSON栏目仍需确认：${section.detectedTitle}`,
        sectionId: section.id
      }))
    ],
    mappingDecisions: input.mappingDecisions ?? [],
    fieldCandidates: input.fieldCandidates ?? (abnormalCanonicalPhone && canonicalBasics?.phone && basics.phone?.sourceBlockIds.length ? [{
      id: `candidate-phone-${importId}`,
      targetFieldId: "basics.phone",
      value: canonicalBasics.phone,
      sourceBlockIds: basics.phone.sourceBlockIds,
      sourceRanges: basics.phone.sourceRanges,
      sourceQuote: canonicalBasics.phone,
      confidence: 0.45,
      needsConfirmation: true,
      userConfirmed: false,
      reviewStatus: "needs_review",
      mappingReason: "电话号码位数不符合常见手机号格式，保留原值等待人工核对。"
    }] : []),
    parserVersion: `${RESUME_IMPORT_PIPELINE_VERSION}.${RESUME_IMPORT_PARSER_VERSION}.structured-json`,
    createdAt: now,
    updatedAt: now
  });
}

function createFallbackSourceBlocks(
  pages: readonly Pick<ImportedResumePage, "pageNumber" | "rawText" | "normalizedText">[],
  mimeType: ImportedResumeSource["mimeType"]
): NormalizedSourceBlock[] {
  const sourceEngine = mimeType === "application/json"
    ? "json_mapper" as const
    : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      ? "docx_xml" as const
      : mimeType === "application/pdf"
        ? "pdfjs" as const
        : "plain_text" as const;
  let order = 0;
  return pages.flatMap((page) => page.normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => ({
      id: `fallback:${page.pageNumber}:${order}`,
      page: page.pageNumber,
      text: line,
      rawText: line,
      normalizedText: line,
      normalizationActions: [],
      blockType: matchResumeSectionHeading(line) ? "heading" as const : "text_block" as const,
      sourceEngine,
      sourceEngineVersion: "unknown",
      extractionConfidence: 0.7,
      order: order++
    })));
}

function structuredJsonToReviewText(draft: StructuredResumeDraft) {
  const lines = [
    draft.basics.name,
    draft.basics.email,
    draft.basics.phone,
    draft.basics.location,
    draft.basics.summary,
    ...(draft.basics.links ?? [])
  ].map((value) => value ? structuredValueText(value) : "").filter(Boolean);
  for (const section of draft.sections) {
    lines.push(section.title);
    for (const item of section.items) {
      lines.push(structuredItemText(item));
    }
  }
  return lines.join("\n");
}

function structuredValueText(value: StructuredResumeDraft["basics"]["name"] extends infer T ? NonNullable<T> : never) {
  return typeof value === "string" ? value : value.value;
}

function makeStructuredField(
  value: NonNullable<StructuredResumeDraft["basics"]["name"]>,
  pageSources: Array<{ pageNumber: number; cleanedPageText: string; charStart: number; charEnd: number }>,
  confidence: "high" | "medium" | "low"
) {
  const text = structuredValueText(value);
  const field = makeField(text, pageSources, confidence);
  return typeof value === "string" ? field : {
    ...field,
    confidence: value.mapping.confidenceLevel,
    sourceStatus: value.mapping.needsConfirmation ? "ambiguous" as const : "user_confirmed_modified" as const,
    mapping: value.mapping
  };
}

function structuredItemText(item: StructuredResumeDraft["sections"][number]["items"][number]) {
  if (typeof item === "string") return item.trim();
  if (item.text) return item.text.trim();
  const header = [item.organization, item.role, item.location].filter(Boolean).join(" | ");
  const dateRange = [item.startDate, item.current ? "至今" : item.endDate].filter(Boolean).join(" - ");
  return [header, dateRange, ...(item.highlights ?? [])].filter(Boolean).join("\n").trim();
}

function inferStructuredCategory(title: string, sectionType: ImportedResumeSectionType): ImportedResumeCategory {
  if (sectionType === "summary") return "summary";
  if (sectionType === "skills") return "skill";
  if (sectionType === "education") return "education";
  if (sectionType === "project") return "project";
  if (sectionType === "campus" || sectionType === "volunteer") return "campus";
  if (sectionType === "awards") return "award";
  if (sectionType === "languages") return "language";
  if (sectionType === "certificates") return "certificate";
  if (["research", "publications", "patents", "portfolio", "other", "custom"].includes(sectionType)) return "custom";
  if (sectionType === "work" || sectionType === "internship") return "work";
  if (/教育|education/i.test(title)) return "education";
  if (/项目|project/i.test(title)) return "project";
  if (/校园|社团|campus/i.test(title)) return "campus";
  if (/奖项|荣誉|award|honou?r/i.test(title)) return "award";
  if (/语言|language/i.test(title)) return "language";
  if (/证书|certificate/i.test(title)) return "certificate";
  if (/工作|实习|work|intern|experience/i.test(title)) return "work";
  return sectionType === "unknown" ? "custom" : "work";
}

function detectBasicsFromBlocks(
  blocks: NormalizedSourceBlock[],
  pageSources: Array<{ pageNumber: number; cleanedPageText: string; charStart: number; charEnd: number }>
) {
  const ordered = [...blocks].sort((left, right) => left.order - right.order);
  const firstSectionIndex = ordered.findIndex((block) => matchResumeSectionHeading(block.normalizedText)?.kind === "canonical_section");
  const identityBlocks = ordered.slice(0, firstSectionIndex < 0 ? Math.min(ordered.length, 12) : firstSectionIndex);
  const emailMatch = findBlockMatch(identityBlocks, EMAIL_PATTERN);
  const phoneMatch = findBlockMatch(identityBlocks, /(?<!\d)1[3-9]\d{9}(?!\d)/);
  const abnormalPhoneMatch = phoneMatch ? undefined : findBlockMatch(identityBlocks, /(?<!\d)\d{12}(?!\d)/);
  const linkMatches = identityBlocks.flatMap((block) =>
    Array.from(block.normalizedText.matchAll(new RegExp(LINK_PATTERN, "gi"))).map((match) => ({ block, match }))
  );
  const locationMatch = identityBlocks.map((block) => ({
    block,
    match: block.normalizedText.match(/(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|天津|重庆|苏州|某地|长沙|合肥|厦门|青岛|大连|昆明|济南|珠海|佛山|东莞|无锡|宁波|温州|福州|贵阳|南昌|太原|石家庄|哈尔滨|长春|沈阳|洛阳|测试市)(?:（远程）|\(远程\))?|(?:Remote|Hong Kong|Singapore)/i)
  })).find((entry) => entry.match);
  const maximumFontSize = Math.max(...identityBlocks.map((block) => block.fontSize ?? 0), 0);
  const nameMatch = identityBlocks.flatMap((block) => {
    const candidates = Array.from(block.normalizedText.matchAll(/(?:^|\s)([A-Za-z][A-Za-z .'-]{0,30}|[\p{Script=Han}]{2,8})(?=\s|$)/gu));
    return candidates.map((match) => ({
      block,
      value: match[1].trim(),
      start: (match.index ?? 0) + match[0].indexOf(match[1]),
      score: (block.fontSize ?? 0) / Math.max(1, maximumFontSize)
        + ((block.position?.x ?? 999) < 160 ? 0.4 : 0)
    }));
  }).filter((entry) =>
    !EMAIL_PATTERN.test(entry.value)
    && !PHONE_PATTERN.test(entry.value)
    && !LINK_PATTERN.test(entry.value)
    && !/(远程|Remote|通用简历|未指定岗位)/i.test(entry.value)
    && entry.value !== locationMatch?.match?.[0]
    && (entry.value.length > 1 || (entry.block.fontSize ?? 0) >= maximumFontSize * 0.9)
  ).sort((left, right) => right.score - left.score)[0];
  const excludedIdentityBlockIds = new Set([
    emailMatch?.block.id,
    phoneMatch?.block.id ?? abnormalPhoneMatch?.block.id,
    locationMatch?.block.id,
    nameMatch?.block.id,
    ...linkMatches.map(({ block }) => block.id)
  ].filter((id): id is string => Boolean(id)));
  const isPresentationTag = (text: string) => /^(?:[A-Z][A-Z0-9 +#.-]*\s*[|｜]\s*){1,}[A-Z][A-Z0-9 +#.-]*$/i.test(text.trim());
  const targetRoleBlock = identityBlocks.find((block) => {
    const text = block.normalizedText.trim();
    return !excludedIdentityBlockIds.has(block.id)
      && !isPresentationTag(text)
      && text.length <= 80
      && /(?:训练师|工程师|设计|评测|评估|开发|分析|运营|产品|研究|顾问|实习|[|/｜／])/i.test(text);
  });
  const contactHeadline = emailMatch ? emailMatch.block.normalizedText
    .replace(EMAIL_PATTERN, "")
    .replace(PHONE_PATTERN, "")
    .replace(new RegExp(LINK_PATTERN, "gi"), "")
    .replace(locationMatch?.match?.[0] ?? /$^/, "")
    .replace(/^[\s|｜·•/／-]+|[\s|｜·•/／-]+$/g, "")
    .trim() : "";
  const summaryBlocks = identityBlocks.filter((block) => {
    const text = block.normalizedText.trim();
    return !excludedIdentityBlockIds.has(block.id)
      && block.id !== targetRoleBlock?.id
      && !isPresentationTag(text)
      && text.length >= 18;
  });

  return {
    name: nameMatch ? makeBlockField(nameMatch.value, nameMatch.block, "high", nameMatch.start) : undefined,
    email: emailMatch ? makeBlockField(emailMatch.match[0], emailMatch.block, "high", emailMatch.match.index) : undefined,
    phone: phoneMatch
      ? makeBlockField(phoneMatch.match[0], phoneMatch.block, "high", phoneMatch.match.index)
      : abnormalPhoneMatch
        ? { ...makeBlockField(abnormalPhoneMatch.match[0], abnormalPhoneMatch.block, "low", abnormalPhoneMatch.match.index), sourceStatus: "ambiguous" as const }
        : undefined,
    location: locationMatch?.match ? makeBlockField(locationMatch.match[0], locationMatch.block, "high", locationMatch.match.index) : undefined,
    links: linkMatches.map(({ block, match }) => makeBlockField(match[0], block, "high", match.index)),
    targetRole: targetRoleBlock
      ? makeBlockField(targetRoleBlock.normalizedText.trim(), targetRoleBlock, "high")
      : contactHeadline && emailMatch
        ? makeBlockField(contactHeadline, emailMatch.block, "medium", Math.max(0, emailMatch.block.normalizedText.indexOf(contactHeadline)))
        : undefined,
    summary: summaryBlocks.length ? makeBlocksField(summaryBlocks.map((block) => block.normalizedText.trim()).join(""), summaryBlocks, "high") : undefined
  };

  function makeBlockField(value: string, block: NormalizedSourceBlock, confidence: "high" | "medium" | "low", start = 0): ImportedResumeField {
    return {
      value,
      pageRefs: block.page ? [{ pageNumber: block.page, quote: value }] : makeField(value, pageSources, confidence).pageRefs,
      confidence,
      sourceStatus: "located",
      userEdited: false,
      sourceBlockIds: [block.id],
      sourceRanges: [{ blockId: block.id, start, end: start + value.length }],
      sourceQuote: value
    };
  }

  function makeBlocksField(value: string, sourceBlocks: NormalizedSourceBlock[], confidence: "high" | "medium" | "low"): ImportedResumeField {
    return {
      value,
      pageRefs: pageRefsFromBlocks(sourceBlocks),
      confidence,
      sourceStatus: "located",
      userEdited: false,
      sourceBlockIds: sourceBlocks.map((block) => block.id),
      sourceRanges: sourceBlocks.map((block) => ({ blockId: block.id, start: 0, end: block.normalizedText.length })),
      sourceQuote: value
    };
  }
}

function findBlockMatch(blocks: NormalizedSourceBlock[], pattern: RegExp) {
  for (const block of blocks) {
    const match = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(block.normalizedText);
    if (match) return { block, match };
  }
  return undefined;
}

function detectSectionsFromSemanticArtifacts(artifacts: ResumeLayoutArtifact[], sourceBlocks: NormalizedSourceBlock[]): ImportedResumeSection[] {
  const sourceBlockById = new Map(sourceBlocks.map((block) => [block.id, block]));
  const sections: ImportedResumeSection[] = [];
  for (const artifact of artifacts) {
    const layoutBlockById = new Map(artifact.layoutDocument.blocks.map((block) => [block.id, block]));
    const semanticItemById = new Map(artifact.semanticTree.items.map((item) => [item.id, item]));
    for (const semanticSection of artifact.semanticTree.sections) {
      const headingBlocks = semanticSection.headingBlockIds.flatMap((blockId) => layoutBlockById.get(blockId) ? [layoutBlockById.get(blockId)!] : []);
      const headingText = headingBlocks.map((block) => block.text).join("").trim();
      const items = semanticSection.itemIds.flatMap((itemId, itemIndex): ImportedResumeItem[] => {
        const semanticItem = semanticItemById.get(itemId);
        if (!semanticItem) return [];
        const structuredItem = mapSemanticItemToResumeItem({
          sectionType: semanticSection.sectionType,
          item: semanticItem,
          layoutDocument: artifact.layoutDocument,
          layoutGraph: artifact.layoutGraph
        });
        const sourceBlockIds = [...new Set(semanticItem.sourceBlockIds.flatMap((blockId) => layoutBlockById.get(blockId)?.sourceBlockRefs ?? []))]
          .filter((blockId) => sourceBlockById.has(blockId));
        const boundBlocks = sourceBlockIds.flatMap((blockId) => sourceBlockById.get(blockId) ? [sourceBlockById.get(blockId)!] : []);
        const normalizedText = projectResumeItemV2(structuredItem);
        const structurallyComplete = hasCompleteSemanticStructure(
          semanticSection.sectionType,
          semanticItem,
          structuredItem,
          artifact.semanticTree.invariantIssues
        );
        const effectiveFieldRoleConfidence = structurallyComplete
          ? Math.max(semanticItem.confidence.fieldRole, 0.85)
          : semanticItem.confidence.fieldRole;
        const needsStructureReview = semanticItem.confidence.itemBoundary < 0.85
          || effectiveFieldRoleConfidence < 0.85
          || semanticItem.confidence.sourceBinding < 0.85
          || artifact.semanticTree.invariantIssues.some((issue) => issue.includes(semanticItem.id));
        return [{
          id: semanticItem.id,
          rawText: boundBlocks.map((block) => block.rawText).join("\n") || normalizedText,
          normalizedText,
          included: true,
          order: itemIndex,
          pageRefs: pageRefsFromBlocks(boundBlocks),
          confidence: numericConfidence(effectiveFieldRoleConfidence),
          sourceStatus: sourceBlockIds.length && !needsStructureReview ? "located" : "ambiguous",
          userEdited: false,
          sourceBlockIds,
          sourceRanges: boundBlocks.flatMap((block) => block.normalizedText ? [{ blockId: block.id, start: 0, end: block.normalizedText.length }] : []),
          itemLabel: itemDisplayLabel(structuredItem),
          structuredItem,
          structuredMappingTrace: [],
          sourceQuote: boundBlocks.map((block) => block.normalizedText).join("\n") || normalizedText
        }];
      });
      sections.push({
        id: semanticSection.id,
        sectionType: semanticSection.sectionType,
        category: inferStructuredCategory(headingText || semanticSection.sectionType, semanticSection.sectionType),
        detectedTitle: headingText || semanticSection.sectionType,
        included: true,
        order: sections.length,
        confidence: numericConfidence(semanticSection.confidence.section),
        items
      });
    }
  }
  return sections;
}

function hasCompleteSemanticStructure(
  sectionType: Exclude<ResumeSemanticTree["sections"][number]["sectionType"], "basics">,
  item: ResumeSemanticTree["items"][number],
  structuredItem: ReturnType<typeof mapSemanticItemToResumeItem>,
  invariantIssues: readonly string[]
) {
  const value = structuredItem as unknown as Record<string, unknown>;
  const hasText = (key: string) => typeof value[key] === "string" && Boolean((value[key] as string).trim());
  const headerComplete = sectionType === "summary"
    ? hasText("text")
    : sectionType === "education"
      ? hasText("school") && (hasText("major") || hasText("degree"))
      : ["work", "internship", "campus", "volunteer"].includes(sectionType)
        ? hasText("organization") && hasText("role")
        : ["project", "research"].includes(sectionType)
          ? hasText("title") && (hasText("role") || hasText("authorRole"))
          : sectionType === "skills" || sectionType === "certificates"
            ? hasText("name")
            : item.sourceBlockIds.length > 0;
  const dateBindingClear = !["education", "work", "internship", "campus", "volunteer", "project", "research"].includes(sectionType)
    || item.dateBlockIds.length > 0;
  return headerComplete
    && dateBindingClear
    && item.sourceBlockIds.length > 0
    && item.confidence.sourceBinding >= 0.85
    && !invariantIssues.some((issue) => issue.includes(item.id));
}

function numericConfidence(value: number): "high" | "medium" | "low" {
  return value >= 0.85 ? "high" : value >= 0.6 ? "medium" : "low";
}

function detectSectionsFromBlocks(blocks: NormalizedSourceBlock[]): ImportedResumeSection[] {
  const sections: Array<{
    heading: Extract<NonNullable<ReturnType<typeof matchResumeSectionHeading>>, { kind: "canonical_section" }>;
    title: string;
    headingBlock: NormalizedSourceBlock;
    blocks: NormalizedSourceBlock[];
  }> = [];
  let current: (typeof sections)[number] | undefined;
  for (const block of [...blocks].sort((left, right) => left.order - right.order)) {
    const inlineHeading = matchInlineCanonicalSection(block.normalizedText);
    if (inlineHeading) {
      current = {
        heading: inlineHeading.heading,
        title: inlineHeading.heading.label,
        headingBlock: block,
        blocks: []
      };
      sections.push(current);
      if (inlineHeading.content) {
        current.blocks.push({
          ...block,
          text: inlineHeading.content,
          rawText: inlineHeading.content,
          normalizedText: inlineHeading.content
        });
      }
      continue;
    }
    const heading = matchResumeSectionHeading(block.normalizedText);
    if (heading?.kind === "presentation_group") {
      current = undefined;
      continue;
    }
    if (heading?.kind === "canonical_section") {
      current = { heading, title: heading.label, headingBlock: block, blocks: [] };
      sections.push(current);
      continue;
    }
    current?.blocks.push(block);
  }

  return sections.map((section, sectionIndex): ImportedResumeSection => {
    const segmented = segmentResumeItems({ sectionType: section.heading.sectionType, blocks: section.blocks });
    const items = segmented.map((segment, itemIndex): ImportedResumeItem => {
      const structuredItem = extractSegmentedItemFields(segment);
      return {
        id: segment.id,
        rawText: segment.normalizedText,
        normalizedText: segment.normalizedText,
        included: true,
        order: itemIndex,
        pageRefs: pageRefsFromBlocks(segment.bodyBlocks),
        confidence: "high",
        sourceStatus: "located",
        userEdited: false,
        sourceBlockIds: segment.sourceBlockIds,
        sourceRanges: segment.sourceRanges,
        itemLabel: itemDisplayLabel(structuredItem),
        structuredItem,
        structuredMappingTrace: [],
        sourceQuote: segment.normalizedText
      };
    });
    return {
      id: `import-section-${sectionIndex}-${nanoid(6)}`,
      sectionType: section.heading.sectionType as ImportedResumeSectionType,
      category: section.heading.category,
      detectedTitle: section.title,
      included: true,
      order: sectionIndex,
      confidence: section.heading.confidence,
      items
    };
  });
}

function matchInlineCanonicalSection(text: string) {
  const match = text.trim().match(/^([^:：]{1,48})[:：]\s*(.*)$/);
  if (!match) return undefined;
  const heading = matchResumeSectionHeading(match[1].trim());
  if (!heading || heading.kind !== "canonical_section") return undefined;
  return { heading, content: match[2].trim() };
}

function pageRefsFromBlocks(blocks: NormalizedSourceBlock[]): ImportedResumePageRef[] {
  const refs = new Map<number, string>();
  for (const block of blocks) {
    if (block.page && !refs.has(block.page)) refs.set(block.page, block.normalizedText.slice(0, 240));
  }
  return Array.from(refs, ([pageNumber, quote]) => ({ pageNumber, quote }));
}

function bindCandidatesToItems(
  candidates: ImportedResumeFieldCandidate[],
  sections: ImportedResumeSection[],
  blocks: NormalizedSourceBlock[]
) {
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const itemEntries = sections.flatMap((section) => section.items.map((item) => ({ section, item })));
  return candidates.map((candidate) => {
    const entry = itemEntries.find(({ item }) => candidate.sourceBlockIds.some((blockId) => item.sourceBlockIds.includes(blockId)));
    const sourceRanges = candidate.sourceBlockIds.flatMap((blockId) => {
      const block = blockById.get(blockId);
      if (!block) return [];
      const start = block.normalizedText.indexOf(candidate.sourceQuote);
      return start >= 0 ? [{ blockId, start, end: start + candidate.sourceQuote.length }] : [];
    });
    return {
      ...candidate,
      sourceRanges,
      sectionId: entry?.section.id ?? "basics",
      itemId: entry?.item.id ?? "basics",
      itemLabel: entry?.item.itemLabel ?? "基本信息"
    };
  });
}

function collectStructureConsumedRanges(input: {
  basics: ReturnType<typeof detectBasicsFromBlocks>;
  sections: ImportedResumeSection[];
  sourceBlocks: NormalizedSourceBlock[];
}): ConsumedSourceRange[] {
  const ranges: ConsumedSourceRange[] = [];
  const fields = [
    input.basics.name,
    input.basics.email,
    input.basics.phone,
    input.basics.location,
    input.basics.targetRole,
    input.basics.summary,
    ...input.basics.links
  ];
  for (const field of fields) {
    for (const range of field?.sourceRanges ?? []) {
      ranges.push({ ...range, targetFieldId: "structure.basics", candidateId: `structure:${range.blockId}:${range.start}` });
    }
  }
  for (const section of input.sections) {
    for (const item of section.items) {
      for (const range of item.sourceRanges ?? []) {
        ranges.push({ ...range, targetFieldId: `structure.${section.sectionType}`, candidateId: item.id });
      }
    }
  }
  for (const block of input.sourceBlocks) {
    if (matchResumeSectionHeading(block.normalizedText) || matchInlineCanonicalSection(block.normalizedText)) {
      ranges.push({
        blockId: block.id,
        start: 0,
        end: block.normalizedText.length,
        targetFieldId: "structure.heading",
        candidateId: `heading:${block.id}`
      });
    }
  }
  return ranges;
}

export function detectBasics(
  text: string,
  pageSources: Array<{ pageNumber: number; cleanedPageText: string; charStart: number; charEnd: number }>
) {
  const firstLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, 12);
  const nameLine = firstLines.find((line) =>
    !isSectionTitle(line)
    && !EMAIL_PATTERN.test(line)
    && !PHONE_PATTERN.test(line)
    && !LINK_PATTERN.test(line)
    && Array.from(line).length <= 32
    && !isSingleLatinLetter(line)
  );
  const email = text.match(EMAIL_PATTERN)?.[0];
  const phone = findPhoneExcludingEmail(text, email);
  const links = Array.from(text.matchAll(new RegExp(LINK_PATTERN, "gi"))).map((match) => match[0]);
  const locationLine = firstLines.find((line) => {
    // Explicit location labels
    if (/^(?:所在地|地点|Location|Base|居住地|现居|坐标)\s*[:：]/i.test(line)) return true;
    // Known city names (hardcoded list as enhancement, not sole rule)
    if (/(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|天津|重庆|苏州|某地|长沙|合肥|厦门|青岛|大连|昆明|济南|珠海|佛山|东莞|无锡|宁波|温州|福州|贵阳|南昌|太原|石家庄|哈尔滨|长春|沈阳|洛阳|呼和浩特|银川|西宁|拉萨|乌鲁木齐|兰州|海口|南宁|三亚|China|Remote|Tokyo|London|New York|Singapore|Hong Kong|Toronto|Sydney|Berlin)/i.test(line)) return true;
    // Chinese city pattern with separator (e.g., 河南·某地)
    if (/[一-鿿]{2,}·[一-鿿]{2,}/u.test(line)) return true;
    // Remote work indicators
    if (/(?:远程|线上|居家|Remote)/i.test(line)) return true;
    // Parenthetical location (e.g., 某地（远程）)
    if (/[一-鿿]{2,}[（(][一-鿿]+[）)]/u.test(line)) return true;
    return false;
  });

  return {
    name: nameLine ? makeField(nameLine, pageSources, "medium") : undefined,
    email: email ? makeField(email, pageSources, "high") : undefined,
    phone: phone ? makeField(phone, pageSources, "medium") : undefined,
    location: locationLine ? makeField(locationLine, pageSources, "low") : undefined,
    links: uniqueStrings(links).map((link) => makeField(link, pageSources, "medium")),
    targetRole: undefined,
    summary: undefined
  };
}

export function detectSections(lines: LineWithPage[]): ImportedResumeSection[] {
  const sections: ImportedResumeSection[] = [];
  let current: ImportedResumeSection | undefined;
  let itemBuffer: LineWithPage[] = [];

  const flushItem = () => {
    if (!current || itemBuffer.length === 0) {
      itemBuffer = [];
      return;
    }
    const item = createItem(itemBuffer, current.items.length);
    current.items.push(item);
    itemBuffer = [];
  };

  const startSection = (title: string, sectionType: ImportedResumeSectionType, confidence: "high" | "medium" | "low", category?: ImportedResumeCategory) => {
    flushItem();
    current = {
      id: `import-section-${sections.length}-${nanoid(6)}`,
      sectionType,
      category: category ?? inferCategoryFromTitle(title),
      detectedTitle: title,
      included: sectionType !== "unknown",
      order: sections.length,
      confidence,
      items: []
    };
    sections.push(current);
  };

  for (const line of lines) {
    const inlineSection = parseInlineSectionLine(line.text);
    if (inlineSection) {
      startSection(inlineSection.title, inlineSection.type, inlineSection.confidence, inlineSection.category);
      itemBuffer.push({ text: inlineSection.content, pageNumber: line.pageNumber });
      continue;
    }

    const sectionMatch = classifySectionTitle(line.text);
    if (sectionMatch) {
      startSection(line.text.replace(/[:：]\s*$/, ""), sectionMatch.type, sectionMatch.confidence, sectionMatch.category);
      continue;
    }

    if (!current) {
      startSection("未分类", "unknown", "low");
    }

    if (isBulletLine(line.text) && itemBuffer.length > 0) {
      flushItem();
    }
    itemBuffer.push(line);
  }
  flushItem();

  return sections.map((section) => {
    const nextSection = {
      ...section,
      items: section.items.map((item, index) => ({ ...item, order: index }))
    };
    if (nextSection.sectionType === "summary" && nextSection.items.length > 1) {
      return {
        ...nextSection,
        items: [{
          ...nextSection.items[0],
          rawText: nextSection.items.map((item) => item.rawText).join("\n"),
          normalizedText: nextSection.items.map((item) => item.normalizedText).join(" "),
          pageRefs: nextSection.items.flatMap((item) => item.pageRefs),
          sourceStatus: nextSection.items.every((item) => item.sourceStatus === "located") ? "located" : "ambiguous"
        }]
      };
    }
    return nextSection;
  });
}

function createItem(lines: LineWithPage[], order: number): ImportedResumeItem {
  const rawText = lines.map((line) => line.text).join("\n").trim();
  const normalizedText = normalizeItemText(rawText);
  const pageRefs = createPageRefs(lines, normalizedText);
  return {
    id: `import-item-${nanoid(10)}`,
    rawText,
    normalizedText,
    included: true,
    order,
    pageRefs,
    confidence: pageRefs.length > 0 ? "medium" : "low",
    sourceStatus: pageRefs.length > 0 ? "located" : "unlocated",
    userEdited: false,
    sourceBlockIds: [],
    structuredMappingTrace: [],
    sourceQuote: rawText
  };
}

function structuredItemEvidenceValues(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length >= 2 ? [normalized] : [];
  }
  if (typeof value === "number" && Number.isFinite(value)) return [String(value)];
  if (Array.isArray(value)) return [...new Set(value.flatMap(structuredItemEvidenceValues))];
  if (!value || typeof value !== "object") return [];
  return [...new Set(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["id", "sectionType", "current"].includes(key))
    .flatMap(([, entry]) => structuredItemEvidenceValues(entry)))];
}

function makeField(
  value: string,
  pageSources: Array<{ pageNumber: number; cleanedPageText: string; charStart: number; charEnd: number }>,
  confidence: "high" | "medium" | "low"
): ImportedResumeField {
  const location = locatePdfSourceQuote(value, pageSources);
  return {
    value,
    pageRefs: location.status === "located" ? [{ pageNumber: location.locator.pageNumber, quote: value }] : [],
    confidence: location.status === "located" ? confidence : "low",
    sourceStatus: location.status,
    userEdited: false,
    sourceBlockIds: [],
    sourceQuote: value
  };
}

function createPageRefs(lines: LineWithPage[], normalizedText: string): ImportedResumePageRef[] {
  const refs = new Map<number, string>();
  for (const line of lines) {
    if (!refs.has(line.pageNumber)) {
      refs.set(line.pageNumber, line.text);
    }
  }
  if (refs.size === 0 && normalizedText) {
    const first = lines[0];
    if (first) {
      refs.set(first.pageNumber, normalizedText.slice(0, 160));
    }
  }
  return Array.from(refs.entries()).map(([pageNumber, quote]) => ({
    pageNumber,
    quote: quote.slice(0, 240)
  }));
}

function classifySectionTitle(line: string) {
  const match = matchResumeSectionHeading(line);
  if (!match || match.kind !== "canonical_section") return undefined;
  return {
    type: match.importedSectionType,
    category: match.category,
    confidence: match.confidence
  };
}

function inferCategoryFromTitle(title: string): ImportedResumeCategory {
  if (/自我评价|个人概述|个人简介|summary|profile|objective/i.test(title)) return "summary";
  if (/教育|education/i.test(title)) return "education";
  if (/项目|project/i.test(title)) return "project";
  if (/校园|社团|campus/i.test(title)) return "campus";
  if (/荣誉|奖项|award|honou?r/i.test(title)) return "award";
  if (/语言|language/i.test(title)) return "language";
  if (/证书|certificate/i.test(title)) return "certificate";
  if (/技能|skill/i.test(title)) return "skill";
  if (/工作|实习|work|intern|experience/i.test(title)) return "work";
  if (/科研|research/i.test(title)) return "work";
  if (/志愿|volunteer/i.test(title)) return "campus";
  return "custom";
}

function parseInlineSectionLine(line: string) {
  const match = line.trim().match(/^([\p{L}\s/]+?)\s*[:：]\s*(.+)$/u);
  if (!match) {
    return undefined;
  }
  const title = match[1].trim();
  const content = match[2].trim();
  const section = classifySectionTitle(title);
  if (!section || !content) {
    return undefined;
  }
  return {
    title,
    content,
    type: section.type,
    confidence: section.confidence,
    category: section.category
  };
}

function isSectionTitle(line: string) {
  return Boolean(classifySectionTitle(line));
}

function isBulletLine(line: string) {
  return /^\s*(?:[-*•·●▪]|[0-9]+[.)、])\s+/.test(line);
}

function isSingleLatinLetter(line: string) {
  const trimmed = line.trim();
  return /^[A-Za-z]$/.test(trimmed);
}

function findPhoneExcludingEmail(text: string, email: string | undefined): string | undefined {
  const CN_MOBILE = /(?<!\d)1[3-9]\d{9}(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = CN_MOBILE.exec(text)) !== null) {
    const phone = m[0];
    if (email && email.includes(phone)) continue;
    return phone;
  }
  const GENERIC = /(?:\+?\d[\d\s\-]{7,}\d)/g;
  while ((m = GENERIC.exec(text)) !== null) {
    const raw = m[0];
    const digits = raw.replace(/[\s\-]/g, "");
    if (email && email.includes(digits)) continue;
    if (/^1[3-9]\d{9}$/.test(digits)) continue;
    return raw.replace(/\s+/g, " ").trim();
  }
  return undefined;
}

function normalizeItemText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
