export type DocxTextExtractionResult =
  | { ok: true; text: string; warnings: string[] }
  | { ok: false; code: "invalid_docx" | "document_xml_missing" | "unsupported_compression" | "empty_docx_text"; message: string };

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
};

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
  const text = extractWordXmlText(xml);
  if (!text.trim()) {
    return { ok: false, code: "empty_docx_text", message: "未能从 DOCX 正文中读取可导入文本。" };
  }
  return {
    ok: true,
    text,
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

function extractWordXmlText(xml: string) {
  return xml
    .split(/<\/w:p>/)
    .map((paragraph) => Array.from(paragraph.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/g))
      .map((match) => decodeXml(match[1]))
      .join(""))
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .join("\n");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}
