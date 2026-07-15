export type DocxTextExtractionResult =
  | { ok: true; text: string; warnings: string[]; blocks: DocxExtractedBlock[]; metrics: DocxExtractionMetrics }
  | { ok: false; code: "invalid_docx" | "document_xml_missing" | "unsupported_compression" | "empty_docx_text"; message: string };

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export type DocxExtractedBlock = {
  id: string;
  sourcePath: string;
  text: string;
  rawText: string;
  blockType: "paragraph" | "heading" | "list_item" | "table_cell";
  parentId?: string;
  rowIndex?: number;
  columnIndex?: number;
  sourceEngine: "docx_xml";
  sourceEngineVersion: string;
  extractionConfidence: number;
  sourceKind: "docx";
  order: number;
};

export type DocxExtractionMetrics = {
  paragraphCount: number;
  headingCount: number;
  listItemCount: number;
  tableCount: number;
  tableCellCount: number;
  imageCount: number;
  textBoxCount: number;
  headerFooterPartCount: number;
};

export const DOCX_EXTRACTOR_VERSION = "resume-import.docx-xml.v2";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

export async function extractTextFromDocxBuffer(buffer: ArrayBuffer): Promise<DocxTextExtractionResult> {
  const bytes = new Uint8Array(buffer);
  const entries = readZipEntries(bytes);
  if (!entries.length) {
    return { ok: false, code: "invalid_docx", message: "DOCX 文件结构无效。" };
  }
  const documentEntry = entries.find((entry) => entry.name === "word/document.xml");
  if (!documentEntry) {
    return { ok: false, code: "document_xml_missing", message: "DOCX 中缺少正文 document.xml。" };
  }
  const compressed = readLocalFileData(bytes, documentEntry);
  const xmlBytes = documentEntry.compressionMethod === 0
    ? compressed
    : documentEntry.compressionMethod === 8
      ? await inflateRaw(compressed)
      : undefined;
  if (!xmlBytes) {
    return { ok: false, code: "unsupported_compression", message: "DOCX 使用了当前不支持的压缩方式。" };
  }
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  const blocks = extractWordXmlBlocks(xml);
  const text = blocks.map((block) => block.text).join("\n");
  if (!text.trim()) {
    return { ok: false, code: "empty_docx_text", message: "未能从 DOCX 正文中读取可导入文本。" };
  }
  return {
    ok: true,
    text,
    blocks,
    metrics: buildDocxMetrics(blocks, entries, xml),
    warnings: entries.some((entry) => entry.name.startsWith("word/media/"))
      ? ["DOCX 包含图片；本轮仅导入可读取的正文文本。"]
      : []
  };
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) {
    return [];
  }
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== CENTRAL_DIRECTORY_SIGNATURE) {
      return entries;
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    entries.push({
      name: new TextDecoder("utf-8").decode(nameBytes),
      compressionMethod,
      compressedSize,
      localHeaderOffset
    });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(view: DataView) {
  const minOffset = Math.max(0, view.byteLength - 66000);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  return -1;
}

function readLocalFileData(bytes: Uint8Array, entry: ZipEntry) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(entry.localHeaderOffset, true) !== LOCAL_FILE_SIGNATURE) {
    return new Uint8Array();
  }
  const fileNameLength = view.getUint16(entry.localHeaderOffset + 26, true);
  const extraLength = view.getUint16(entry.localHeaderOffset + 28, true);
  const dataOffset = entry.localHeaderOffset + 30 + fileNameLength + extraLength;
  return bytes.slice(dataOffset, dataOffset + entry.compressedSize);
}

async function inflateRaw(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    return undefined;
  }
  const chunk = new Uint8Array(bytes.byteLength);
  chunk.set(bytes);
  const stream = new Blob([chunk.buffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function extractWordXmlBlocks(xml: string): DocxExtractedBlock[] {
  const body = xml.match(/<w:body(?:\s[^>]*)?>([\s\S]*?)<\/w:body>/)?.[1] ?? xml;
  const blocks: DocxExtractedBlock[] = [];
  let paragraphIndex = 0;
  let tableIndex = 0;
  const elements = body.matchAll(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g);
  for (const match of elements) {
    const element = match[0];
    if (element.startsWith("<w:tbl")) {
      let rowIndex = 0;
      for (const row of element.matchAll(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g)) {
        let columnIndex = 0;
        for (const cell of row[0].matchAll(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g)) {
          const rawText = wordXmlText(cell[0]);
          if (rawText.trim()) {
            blocks.push({
              id: `docx:table:${tableIndex}:row:${rowIndex}:cell:${columnIndex}`,
              sourcePath: `word/document.xml#table[${tableIndex}].row[${rowIndex}].cell[${columnIndex}]`,
              text: rawText.trim(),
              rawText,
              blockType: "table_cell",
              parentId: `docx:table:${tableIndex}:row:${rowIndex}`,
              rowIndex,
              columnIndex,
              sourceEngine: "docx_xml",
              sourceEngineVersion: DOCX_EXTRACTOR_VERSION,
              extractionConfidence: 0.98,
              sourceKind: "docx",
              order: blocks.length
            });
          }
          columnIndex += 1;
        }
        rowIndex += 1;
      }
      tableIndex += 1;
      continue;
    }
    const rawText = wordXmlText(element);
    if (!rawText.trim()) {
      paragraphIndex += 1;
      continue;
    }
    const style = element.match(/<w:pStyle[^>]*w:val="([^"]+)"/)?.[1] ?? "";
    const isHeading = /heading|title|标题/i.test(style);
    const isList = /<w:numPr(?:\s|>)/.test(element);
    const numberingId = element.match(/<w:numId[^>]*w:val="([^"]+)"/)?.[1];
    blocks.push({
      id: `docx:paragraph:${paragraphIndex}`,
      sourcePath: `word/document.xml#paragraph[${paragraphIndex}]`,
      text: rawText.trim(),
      rawText,
      blockType: isHeading ? "heading" : isList ? "list_item" : "paragraph",
      parentId: isList && numberingId ? `docx:list:${numberingId}` : undefined,
      sourceEngine: "docx_xml",
      sourceEngineVersion: DOCX_EXTRACTOR_VERSION,
      extractionConfidence: /<w:txbxContent(?:\s|>)/.test(element) ? 0.72 : 0.98,
      sourceKind: "docx",
      order: blocks.length
    });
    paragraphIndex += 1;
  }
  return blocks;
}

function wordXmlText(xml: string) {
  return Array.from(xml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)(?:\s[^>]*)?\/>/g))
    .map((match) => match[1] !== undefined ? decodeXml(match[1]) : match[0].startsWith("<w:tab") ? "\t" : "\n")
    .join("")
    .replace(/[ \t]+\n/g, "\n");
}

function buildDocxMetrics(blocks: DocxExtractedBlock[], entries: ZipEntry[], xml: string): DocxExtractionMetrics {
  return {
    paragraphCount: blocks.filter((block) => block.blockType === "paragraph").length,
    headingCount: blocks.filter((block) => block.blockType === "heading").length,
    listItemCount: blocks.filter((block) => block.blockType === "list_item").length,
    tableCount: new Set(blocks.flatMap((block) => block.sourcePath.match(/table\[(\d+)\]/)?.[1] ?? [])).size,
    tableCellCount: blocks.filter((block) => block.blockType === "table_cell").length,
    imageCount: entries.filter((entry) => entry.name.startsWith("word/media/")).length,
    textBoxCount: Array.from(xml.matchAll(/<w:txbxContent(?:\s|>)/g)).length,
    headerFooterPartCount: entries.filter((entry) => /^word\/(?:header|footer)\d+\.xml$/.test(entry.name)).length
  };
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
