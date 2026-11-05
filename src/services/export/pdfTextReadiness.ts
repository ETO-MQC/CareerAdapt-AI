export { PdfTextReadinessSchema, type PdfTextReadiness } from "@/domain/schemas/pdfTextReadiness";

// Preserve punctuation and numbers. Only Unicode compatibility and layout whitespace
// are normalized; deleting arbitrary symbols would conceal missing PDF content.
export function normalizePdfText(text: string) {
  return text.normalize("NFKC").replace(/\s+/gu, "");
}

export function comparePdfText(expected: string, pages: string[]) {
  const source = normalizePdfText(expected);
  const actual = normalizePdfText(pages.join(""));
  // Every rendered text line must occur exactly once (including expected
  // duplicates), with no unexplained remainder. Order is assessed separately.
  let remainder = actual;
  let complete = true;
  const lines = expected.split(/\r?\n/u).map(normalizePdfText).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const index = remainder.indexOf(line);
    if (index < 0) { complete = false; break; }
    remainder = remainder.slice(0, index) + remainder.slice(index + line.length);
  }
  const parity = !source ? "unknown" : complete && !remainder ? "pass" : "needs_review";
  return {
    textLayer: actual.length ? "pass" as const : "needs_review" as const,
    contentParity: parity,
    // This is the observed PDF content stream sequence, not an ATS prediction.
    readingOrder: source && source === actual ? "pass" : parity === "pass" ? "needs_review" : "unknown",
    extractedCharacters: actual.length,
    expectedCharacters: source.length
  } as const;
}
