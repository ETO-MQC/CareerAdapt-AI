import { nanoid } from "nanoid";
import {
  ImportedResumeDraftSchema,
  type ImportedResumeDraft,
  type ImportedResumeField,
  type ImportedResumeItem,
  type ImportedResumePage,
  type ImportedResumePageRef,
  type ImportedResumeSection,
  type ImportedResumeSectionType,
  type ImportQualityReport,
  type NormalizedSourceBlock,
  type ResumeSourceKind,
  StructuredResumeDraftSchema,
  type ImportedResumeSource,
  type PdfPageText,
  type StructuredResumeDraft
} from "@/domain/schemas";
import { locatePdfSourceQuote } from "@/domain/pdfImport/sourceMapping";
import type { ImportedResumeCategory } from "@/domain/schemas";

export const RESUME_IMPORT_PARSER_VERSION = "resume-import.local-rules.v1";

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

const SECTION_PATTERNS: Array<{
  type: ImportedResumeSectionType;
  confidence: "high" | "medium";
  pattern: RegExp;
}> = [
  { type: "summary", confidence: "high", pattern: /^(个人概述|个人简介|自我评价|求职意向|summary|profile|objective)\s*[:：]?$/i },
  { type: "experience", confidence: "high", pattern: /^(工作经历|工作经验|实习经历|项目经历|校园经历|社团经历|实践经历|experience|work experience|internship|projects?|campus experience)\s*[:：]?$/i },
  { type: "experience", confidence: "medium", pattern: /^(教育经历|教育背景|education)\s*[:：]?$/i },
  { type: "skills", confidence: "high", pattern: /^(技能|专业技能|技能清单|skills?|technical skills)\s*[:：]?$/i },
  { type: "certificates", confidence: "high", pattern: /^(证书|资格证书|奖项|荣誉|语言能力|certificates?|awards?|honou?rs?|languages?)\s*[:：]?$/i }
];

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
  const lines = pages.flatMap((page) => splitPageLines(page));
  const combinedText = pages.map((page) => page.normalizedText).join("\n\n");
  const basics = attachBasicBlockSources(detectBasics(combinedText, pageSources), input.sourceBlocks ?? []);
  const sections = attachSectionBlockSources(detectSections(lines), input.sourceBlocks ?? []);
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
    schemaVersion: "resume-import-v1",
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
    sourceKind: input.sourceKind ?? (input.source.mimeType === "application/pdf" ? "text_pdf" : "docx"),
    sourceBlocks: input.sourceBlocks ?? [],
    qualityReport: input.qualityReport,
    basics,
    sections,
    pages,
    warnings,
    parserVersion: RESUME_IMPORT_PARSER_VERSION,
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
  now?: string;
}): ImportedResumeDraft {
  const now = input.now ?? new Date().toISOString();
  const importId = input.importId ?? `resume-import-${nanoid(10)}`;
  const structuredDraft = StructuredResumeDraftSchema.parse(input.structuredDraft);
  const pageText = structuredJsonToReviewText(structuredDraft);
  const pageSources = [{
    pageNumber: 1,
    cleanedPageText: pageText,
    charStart: 0,
    charEnd: pageText.length
  }];
  const structuredField = (value: NonNullable<StructuredResumeDraft["basics"]["name"]>, confidence: "high" | "medium" | "low") => {
    const field = makeStructuredField(value, pageSources, confidence);
    const mappingPaths = typeof value === "string" ? [] : value.mapping.sourcePaths;
    const matches = (input.sourceBlocks ?? []).filter((block) => mappingPaths.includes(block.sourcePath ?? "") || block.normalizedText.includes(field.value));
    return { ...field, sourceBlockIds: matches.map((block) => block.id), sourceQuote: field.value };
  };
  const basics = {
    name: structuredDraft.basics.name ? structuredField(structuredDraft.basics.name, "high") : undefined,
    email: structuredDraft.basics.email ? structuredField(structuredDraft.basics.email, "high") : undefined,
    phone: structuredDraft.basics.phone ? structuredField(structuredDraft.basics.phone, "medium") : undefined,
    location: structuredDraft.basics.location ? structuredField(structuredDraft.basics.location, "medium") : undefined,
    links: (structuredDraft.basics.links ?? []).map((link) => structuredField(link, "medium")),
    targetRole: undefined,
    summary: structuredDraft.basics.summary ? structuredField(structuredDraft.basics.summary, "medium") : undefined
  };
  const sections: ImportedResumeSection[] = structuredDraft.sections.map((section, sectionIndex) => ({
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
      const sourceBlocks = (input.sourceBlocks ?? []).filter((block) =>
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
        mapping
      };
    })
  }));

  return ImportedResumeDraftSchema.parse({
    id: importId,
    schemaVersion: "resume-import-v1",
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
    sourceKind: input.sourceKind ?? "standard_json",
    sourceBlocks: input.sourceBlocks ?? [],
    qualityReport: input.qualityReport,
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
    warnings: sections
      .filter((section) => section.sectionType === "unknown")
      .map((section) => ({
        code: "unknown_section",
        message: `JSON栏目仍需确认：${section.detectedTitle}`,
        sectionId: section.id
      })),
    parserVersion: `${RESUME_IMPORT_PARSER_VERSION}.structured-json`,
    createdAt: now,
    updatedAt: now
  });
}

function attachBasicBlockSources<T extends ReturnType<typeof detectBasics>>(basics: T, blocks: NormalizedSourceBlock[]): T {
  const attach = (field: ImportedResumeField | undefined) => {
    if (!field) return field;
    const matches = findSourceBlocks(field.value, blocks);
    return { ...field, sourceBlockIds: matches.map((block) => block.id), sourceQuote: field.value };
  };
  return {
    ...basics,
    name: attach(basics.name),
    email: attach(basics.email),
    phone: attach(basics.phone),
    location: attach(basics.location),
    links: basics.links.map((field) => attach(field)!)
  };
}

function attachSectionBlockSources(sections: ImportedResumeSection[], blocks: NormalizedSourceBlock[]) {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      const matches = findSourceBlocks(item.rawText, blocks);
      return { ...item, sourceBlockIds: matches.map((block) => block.id), sourceQuote: item.rawText };
    })
  }));
}

function findSourceBlocks(quote: string, blocks: NormalizedSourceBlock[]) {
  const compactQuote = quote.replace(/\s+/g, "");
  return blocks.filter((block) => {
    const compact = block.normalizedText.replace(/\s+/g, "");
    return compact && (compactQuote.includes(compact) || compact.includes(compactQuote));
  });
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
  if (/教育|education/i.test(title)) return "education";
  if (/项目|project/i.test(title)) return "project";
  if (/校园|社团|campus/i.test(title)) return "campus";
  if (/奖项|荣誉|award|honou?r/i.test(title)) return "award";
  if (/语言|language/i.test(title)) return "language";
  if (/证书|certificate/i.test(title)) return "certificate";
  if (/工作|实习|work|intern|experience/i.test(title)) return "work";
  return sectionType === "unknown" ? "custom" : "work";
}

function splitPageLines(page: ImportedResumePage): LineWithPage[] {
  return page.normalizedText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, pageNumber: page.pageNumber }));
}

function detectBasics(
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
  );
  const email = text.match(EMAIL_PATTERN)?.[0];
  const phone = text.match(PHONE_PATTERN)?.[0]?.replace(/\s+/g, " ").trim();
  const links = Array.from(text.matchAll(new RegExp(LINK_PATTERN, "gi"))).map((match) => match[0]);
  const locationLine = firstLines.find((line) => /(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|天津|重庆|苏州|China|Remote|New York|London)/i.test(line));

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

function detectSections(lines: LineWithPage[]): ImportedResumeSection[] {
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

  const startSection = (title: string, sectionType: ImportedResumeSectionType, confidence: "high" | "medium" | "low") => {
    flushItem();
    current = {
      id: `import-section-${sections.length}-${nanoid(6)}`,
      sectionType,
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
      startSection(inlineSection.title, inlineSection.type, inlineSection.confidence);
      itemBuffer.push({ text: inlineSection.content, pageNumber: line.pageNumber });
      continue;
    }

    const sectionMatch = classifySectionTitle(line.text);
    if (sectionMatch) {
      startSection(line.text.replace(/[:：]\s*$/, ""), sectionMatch.type, sectionMatch.confidence);
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
    sourceQuote: rawText
  };
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
  const normalized = line.trim();
  if (Array.from(normalized).length > 48) {
    return undefined;
  }
  return SECTION_PATTERNS.find((item) => item.pattern.test(normalized));
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
    confidence: section.confidence
  };
}

function isSectionTitle(line: string) {
  return Boolean(classifySectionTitle(line));
}

function isBulletLine(line: string) {
  return /^\s*(?:[-*•·●▪]|[0-9]+[.)、])\s+/.test(line);
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
