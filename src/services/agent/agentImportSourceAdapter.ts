export type AgentImportEvidence = {
  sourceId: string;
  pageNumber?: number;
  charStart: number;
  charEnd: number;
  extractedText: string;
};

export type AgentResumeImportSource = {
  fileName: string;
  mimeType: "application/pdf";
  text: string;
  evidence: AgentImportEvidence[];
};

/**
 * Adapter boundary only. PDF extraction/OCR remains owned by the existing
 * document-recognition pipeline; Agent tools consume its authoritative page
 * text and evidence without introducing another PDF parser.
 */
export function adaptExtractedPdfForAgent(input: {
  fileName: string;
  sourceId: string;
  pages: Array<{ pageNumber: number; text: string }>;
}): AgentResumeImportSource {
  let offset = 0;
  const evidence = input.pages.map((page) => {
    const extractedText = page.text.trim();
    const charStart = offset;
    const charEnd = charStart + extractedText.length;
    offset = charEnd + 2;
    return {
      sourceId: input.sourceId,
      pageNumber: page.pageNumber,
      charStart,
      charEnd,
      extractedText
    };
  });
  return {
    fileName: input.fileName,
    mimeType: "application/pdf",
    text: evidence.map((item) => item.extractedText).join("\n\n"),
    evidence
  };
}
