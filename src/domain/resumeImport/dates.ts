import {
  ImportedResumeDateValueSchema,
  type ImportedResumeDateValue,
  type NormalizedSourceBlock
} from "@/domain/schemas";

const CURRENT_PATTERN = /^(?:至今|现在|目前|present|current|now|仍在职|在读)$/i;
const DATE_TOKEN_PATTERN = /(?<!\d)(?:(?:19|20)\d{2}(?:\s*(?:[./-]\s*\d{1,2}(?:\s*[./-]\s*\d{1,2})?|年\s*\d{1,2}(?:\s*月\s*\d{1,2}\s*日?|\s*月)?))?|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(?:19|20)\d{2})(?!\d)|至今|现在|目前|present|current|now|仍在职|在读/gi;

const ENGLISH_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};

export function parseResumeDateToken(input: {
  rawText: string;
  sourceBlockId: string;
  confidence?: number;
}): ImportedResumeDateValue | undefined {
  const rawText = input.rawText.trim();
  if (!rawText) return undefined;
  if (CURRENT_PATTERN.test(rawText)) {
    return ImportedResumeDateValueSchema.parse({
      rawText,
      current: true,
      businessPrecision: "month",
      sourceBlockIds: [input.sourceBlockId],
      sourceQuote: rawText,
      confidence: input.confidence ?? 1,
      needsConfirmation: false
    });
  }

  const english = rawText.match(/^([A-Za-z]+)\s+((?:19|20)\d{2})$/);
  if (english) {
    const month = ENGLISH_MONTHS[english[1].toLowerCase()];
    if (!month) return undefined;
    return dateValue(rawText, Number(english[2]), month, undefined, input);
  }

  const compact = rawText.replace(/\s+/g, "");
  const parts = compact.match(/^((?:19|20)\d{2})(?:(?:[./-](\d{1,2})(?:[./-](\d{1,2}))?)|(?:年(\d{1,2})(?:月(\d{1,2})日?|月)?))?$/);
  if (!parts) return undefined;
  const year = Number(parts[1]);
  const monthText = parts[2] ?? parts[4];
  const dayText = parts[3] ?? parts[5];
  const month = monthText ? Number(monthText) : undefined;
  const day = dayText ? Number(dayText) : undefined;
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  if (day !== undefined && !validDay(year, month!, day)) return undefined;
  return dateValue(rawText, year, month, day, input);
}

export function extractResumeDatesFromBlock(block: Pick<NormalizedSourceBlock, "id" | "normalizedText" | "extractionConfidence">) {
  const matches = block.normalizedText.match(DATE_TOKEN_PATTERN) ?? [];
  return matches.flatMap((rawText) => {
    const parsed = parseResumeDateToken({
      rawText,
      sourceBlockId: block.id,
      confidence: block.extractionConfidence ?? 0.9
    });
    return parsed ? [parsed] : [];
  });
}

export function alignResumeDateRange(block: Pick<NormalizedSourceBlock, "id" | "normalizedText" | "extractionConfidence">) {
  const dates = extractResumeDatesFromBlock(block);
  if (!dates.length) return {};
  if (dates.length === 1) {
    return dates[0].current ? { endDate: dates[0] } : { startDate: { ...dates[0], needsConfirmation: true } };
  }
  return { startDate: dates[0], endDate: dates[1] };
}

function dateValue(
  rawText: string,
  year: number,
  month: number | undefined,
  day: number | undefined,
  input: { sourceBlockId: string; confidence?: number }
) {
  const sourcePrecision = day !== undefined ? "day" as const : month !== undefined ? "month" as const : "year" as const;
  const value = month !== undefined ? `${year}-${pad(month)}` : String(year);
  return ImportedResumeDateValueSchema.parse({
    rawText,
    value,
    precision: sourcePrecision,
    sourcePrecision,
    businessPrecision: "month",
    current: false,
    sourceBlockIds: [input.sourceBlockId],
    sourceQuote: rawText,
    confidence: input.confidence ?? 0.98,
    needsConfirmation: false
  });
}

function validDay(year: number, month: number, day: number) {
  if (day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}
