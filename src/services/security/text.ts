import type { SourceSpan } from "@/domain/schemas";

export type RedactionResult = {
  text: string;
  redactions: {
    type: "name" | "phone" | "email" | "id_card" | "address";
    count: number;
  }[];
  restorationMap: Record<string, string>;
};

const redactionPatterns: Array<{
  type: RedactionResult["redactions"][number]["type"];
  pattern: RegExp;
  placeholderPrefix: string;
}> = [
  {
    type: "email",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    placeholderPrefix: "EMAIL"
  },
  {
    type: "phone",
    pattern: /\b1[3-9]\d{9}\b/g,
    placeholderPrefix: "PHONE"
  },
  {
    type: "id_card",
    pattern: /\b\d{17}[\dXx]\b/g,
    placeholderPrefix: "ID_NUMBER"
  },
  {
    type: "address",
    pattern: /(?:(?:[\u4e00-\u9fa5]{2,}(?:省|自治区))?(?:[\u4e00-\u9fa5]{2,}(?:市|自治州))?[\u4e00-\u9fa5]{2,}(?:区|县)[\u4e00-\u9fa5A-Za-z0-9]{1,}(?:路|街|道|巷|弄)[\u4e00-\u9fa5A-Za-z0-9号楼栋单元室-]{0,30}|[\u4e00-\u9fa5A-Za-z0-9]{2,}(?:路|街|道|巷|弄)(?:\d+|某)号(?:\d+(?:号楼|栋|单元|室))?)/g,
    placeholderPrefix: "ADDRESS"
  }
];

export type SensitiveTextTokenizer = {
  tokenize(text: string): RedactionResult;
  readonly restorationMap: Record<string, string>;
};

export async function hashText(text: string) {
  if (globalThis.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

export async function hashBytes(bytes: Uint8Array) {
  if (globalThis.crypto?.subtle) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv-${(hash >>> 0).toString(16).padStart(8, "0")}-${bytes.byteLength}`;
}

export function stableHashText(text: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `fnv-${(hash >>> 0).toString(16).padStart(8, "0")}-${text.length}`;
}

export function createSensitiveTextTokenizer(input: {
  highConfidenceNames?: string[];
} = {}): SensitiveTextTokenizer {
  const restorationMap: Record<string, string> = {};
  const placeholdersByType = new Map<string, Map<string, string>>();
  const namePatterns = Array.from(new Set(
    (input.highConfidenceNames ?? []).map((name) => name.trim()).filter(isPlausibleSensitiveNameCandidate)
  )).map((name) => ({
    type: "name" as const,
    pattern: new RegExp(escapeRegExp(name), "g"),
    placeholderPrefix: "NAME"
  }));
  const patterns = [...namePatterns, ...redactionPatterns];

  return {
    restorationMap,
    tokenize(text: string) {
      let redacted = text;
      const redactions: RedactionResult["redactions"] = [];
      for (const item of patterns) {
        let count = 0;
        const placeholders = placeholdersByType.get(item.placeholderPrefix) ?? new Map<string, string>();
        placeholdersByType.set(item.placeholderPrefix, placeholders);
        redacted = redacted.replace(item.pattern, (matched) => {
          count += 1;
          const existing = placeholders.get(matched);
          if (existing) return existing;
          const placeholder = `[${item.placeholderPrefix}_${placeholders.size + 1}]`;
          placeholders.set(matched, placeholder);
          restorationMap[placeholder] = matched;
          return placeholder;
        });

        if (count > 0) {
          redactions.push({ type: item.type, count });
        }
      }
      return { text: redacted, redactions, restorationMap };
    }
  };
}

export function isPlausibleSensitiveNameCandidate(value: string | undefined): value is string {
  const candidate = value?.trim();
  if (!candidate) return false;
  const normalized = candidate.normalize("NFKC");
  if (/^\d+$/u.test(normalized)) return false;
  if (/^[#>*•·\-–—]+$/u.test(normalized)) return false;
  if (/^(?:page|p|第?\d+页|heading|title|section)$/iu.test(normalized)) return false;
  if (/^(?:\d+[.)、]?|[A-Za-z][.)、])$/u.test(normalized)) return false;
  if (normalized.length < 2 || normalized.length > 48) return false;
  if (!/[\p{L}]/u.test(normalized)) return false;
  if (/(?:简历|项目|经历|教育|技能|电话|邮箱|求职|个人信息|resume|education|project|skill)/iu.test(normalized)) return false;
  return true;
}

export function redactSensitiveTextForModel(
  text: string,
  input: { highConfidenceNames?: string[] } = {}
): RedactionResult {
  return createSensitiveTextTokenizer(input).tokenize(text);
}

/**
 * Restore the placeholders created for this import, including the bare-token
 * spelling some providers produce while normalizing punctuation.
 *
 * The aliases are derived only from the current import map. This is
 * deliberately narrower than replacing every string that happens to look
 * like a token in arbitrary application data.
 */
export function restoreKnownSensitiveTokens<T>(value: T, restorationMap: Record<string, string>): T {
  const restoreText = (text: string) => Object.entries(restorationMap)
    .flatMap(([placeholder, original]) => {
      const bareAlias = bareSensitiveTokenAlias(placeholder);
      return bareAlias ? [{ placeholder, original, bareAlias }] : [];
    })
    .sort((left, right) => right.bareAlias.length - left.bareAlias.length)
    .reduce((current, { placeholder, original, bareAlias }) => {
      const restoredBracketed = current.split(placeholder).join(original);
      return restoredBracketed.replace(
        safeSensitiveTokenPattern(bareAlias),
        () => original
      );
    }, text);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return restoreText(current);
    if (Array.isArray(current)) return current.map(visit);
    if (current && typeof current === "object") {
      return Object.fromEntries(Object.entries(current).map(([key, item]) => [key, visit(item)]));
    }
    return current;
  };
  return visit(value) as T;
}

export function restoreSensitivePlaceholders<T>(value: T, restorationMap: Record<string, string>): T {
  return restoreKnownSensitiveTokens(value, restorationMap);
}

export const unresolvedSensitivePlaceholderPattern =
  /(?:\[(?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+\]|(?<![\p{L}\p{N}_])(?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+(?![\p{L}\p{N}_]))/u;

const exactSensitiveTransportTokenPattern = /^(?:\[(?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+\]|(?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+)$/u;

export function isSensitiveTransportToken(value: unknown): boolean {
  return typeof value === "string" && exactSensitiveTransportTokenPattern.test(value.trim());
}

export function containsUnresolvedSensitivePlaceholder(
  value: unknown,
  restorationMap?: Record<string, string>
): boolean {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return false;
  if (!restorationMap) return unresolvedSensitivePlaceholderPattern.test(serialized);

  return Object.keys(restorationMap)
    .map(bareSensitiveTokenAlias)
    .filter((alias): alias is string => Boolean(alias))
    .some((alias) => serialized.includes(`[${alias}]`) || safeSensitiveTokenPattern(alias).test(serialized));
}

/** Returns only transport-token shapes, never the values they represent. */
export function sensitiveTransportTokenShapes(value: unknown): string[] {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (!serialized) return [];
  const matches = serialized.match(/\[?(?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+\]?/gu) ?? [];
  return [...new Set(matches)];
}

function bareSensitiveTokenAlias(placeholder: string) {
  const match = placeholder.match(/^\[((?:NAME|PHONE|EMAIL|ADDRESS|ID_NUMBER)_\d+)\]$/u);
  return match?.[1];
}

function safeSensitiveTokenPattern(alias: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(alias)}(?![\\p{L}\\p{N}_])`, "gu");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function locateSourceQuote(rawText: string, sourceQuote: string): SourceSpan | undefined {
  const normalizedQuote = sourceQuote.trim();
  if (!normalizedQuote) {
    return undefined;
  }

  const directStart = rawText.indexOf(normalizedQuote);
  if (directStart >= 0) {
    return {
      start: directStart,
      end: directStart + normalizedQuote.length,
      text: normalizedQuote
    };
  }

  const compactRaw = rawText.replace(/\s+/g, "");
  const compactQuote = normalizedQuote.replace(/\s+/g, "");
  const compactStart = compactRaw.indexOf(compactQuote);

  if (compactStart < 0) {
    return undefined;
  }

  let compactCursor = 0;
  let start = -1;
  let end = -1;

  for (let index = 0; index < rawText.length; index += 1) {
    if (/\s/.test(rawText[index])) {
      continue;
    }

    if (compactCursor === compactStart) {
      start = index;
    }

    compactCursor += 1;

    if (compactCursor === compactStart + compactQuote.length) {
      end = index + 1;
      break;
    }
  }

  if (start < 0 || end < 0) {
    return undefined;
  }

  return {
    start,
    end,
    text: rawText.slice(start, end)
  };
}

export function summarizeErrorCode(error: unknown) {
  if (error instanceof Error) {
    return error.name || "error";
  }

  return "unknown_error";
}
