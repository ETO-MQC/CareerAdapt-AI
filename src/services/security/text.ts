import type { SourceSpan } from "@/domain/schemas";

export type RedactionResult = {
  text: string;
  redactions: {
    type: "phone" | "email" | "id_card" | "address";
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
    pattern: /[\u4e00-\u9fa5A-Za-z0-9]{2,}(?:省|市|区|县|镇|街道|路|号楼|单元|室)/g,
    placeholderPrefix: "ADDRESS"
  }
];

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

export function redactSensitiveTextForModel(text: string): RedactionResult {
  let redacted = text;
  const redactions: RedactionResult["redactions"] = [];
  const restorationMap: Record<string, string> = {};

  for (const item of redactionPatterns) {
    let count = 0;
    const placeholders = new Map<string, string>();
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

export function restoreSensitivePlaceholders<T>(value: T, restorationMap: Record<string, string>): T {
  const restoreText = (text: string) => Object.entries(restorationMap)
    .reduce((current, [placeholder, original]) => current.split(placeholder).join(original), text);
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
