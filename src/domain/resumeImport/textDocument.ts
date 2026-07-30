import type { ExtractedSourceBlock } from "@/domain/schemas";

export const MARKDOWN_EXTRACTOR_VERSION = "resume-import.markdown.v1";
export const TEXT_EXTRACTOR_VERSION = "resume-import.text.v1";

export function extractMarkdownSourceBlocks(text: string): ExtractedSourceBlock[] {
  const blocks: ExtractedSourceBlock[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let paragraphStart = 0;
  const flushParagraph = () => {
    const rawText = paragraph.join("\n");
    if (rawText.trim()) blocks.push(block("markdown", paragraphStart, rawText, "paragraph", blocks.length));
    paragraph = [];
  };
  lines.forEach((line, index) => {
    if (!line.trim()) {
      flushParagraph();
      return;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    const listItem = line.match(/^\s*(?:[-+*]|\d+[.)])\s+(.+)$/);
    if (heading || listItem) {
      flushParagraph();
      blocks.push(block(
        "markdown",
        index,
        line,
        heading ? "heading" : "list_item",
        blocks.length,
        heading?.[1] ?? listItem?.[1]
      ));
      return;
    }
    if (!paragraph.length) paragraphStart = index;
    paragraph.push(line);
  });
  flushParagraph();
  return blocks;
}

export function extractPlainTextSourceBlocks(text: string): ExtractedSourceBlock[] {
  return text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).flatMap((paragraph, index) => {
    const rawText = paragraph.trim();
    return rawText ? [block("text", index, rawText, "paragraph", index)] : [];
  });
}

function block(
  kind: "markdown" | "text",
  sourceLine: number,
  rawText: string,
  blockType: "heading" | "list_item" | "paragraph",
  order: number,
  displayText = rawText
): ExtractedSourceBlock {
  return {
    id: `${kind}:block:${sourceLine}`,
    sourcePath: `${kind}#line[${sourceLine + 1}]`,
    text: displayText.trim(),
    rawText,
    blockType,
    sourceEngine: kind === "markdown" ? "markdown_parser" : "plain_text",
    sourceEngineVersion: kind === "markdown" ? MARKDOWN_EXTRACTOR_VERSION : TEXT_EXTRACTOR_VERSION,
    extractionConfidence: 1,
    sourceKind: kind,
    order
  };
}
