export type TailoringContextCandidate = {
  id: string;
  order?: number;
  name?: string;
  title?: string;
  company?: string;
  [key: string]: unknown;
};

export type TailoringEntityResolution<T extends TailoringContextCandidate = TailoringContextCandidate> =
  | { status: "resolved"; candidate: T; reason: "id" | "exact" | "ordinal" | "substring" | "relative" }
  | { status: "ambiguous"; candidates: T[] }
  | { status: "unresolved"; candidates: T[] };

/**
 * Resolve only against the authoritative candidate set supplied by the
 * current task. This function never creates or guesses an entity id.
 */
export function resolveTailoringEntityReference<T extends TailoringContextCandidate>(
  reference: string,
  candidates: readonly T[]
): TailoringEntityResolution<T> {
  const ordered = [...candidates].sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const text = cleanReference(reference);
  if (!text || ordered.length === 0) return { status: "unresolved", candidates: [] };

  if (/^(?:刚才那个|上一个|前一个)$/u.test(text)) {
    const candidate = ordered.at(-1);
    return candidate
      ? { status: "resolved", candidate, reason: "relative" }
      : { status: "unresolved", candidates: ordered };
  }
  if (/^(?:最后一个|最后一份|末个|末份)$/u.test(text)) {
    const candidate = ordered.at(-1);
    return candidate
      ? { status: "resolved", candidate, reason: "relative" }
      : { status: "unresolved", candidates: ordered };
  }

  const ordinal = ordinalFrom(text);
  if (ordinal !== undefined) {
    const candidate = ordered[ordinal - 1];
    return candidate
      ? { status: "resolved", candidate, reason: "ordinal" }
      : { status: "unresolved", candidates: ordered };
  }

  const byId = ordered.find((candidate) => candidate.id === reference.trim());
  if (byId) return { status: "resolved", candidate: byId, reason: "id" };

  const exact = ordered.filter((candidate) => candidateTextValues(candidate)
    .some((value) => normalize(value) === text));
  if (exact.length === 1) return { status: "resolved", candidate: exact[0], reason: "exact" };
  if (exact.length > 1) return { status: "ambiguous", candidates: exact };

  const terms = queryTerms(text);
  const matches = ordered.filter((candidate) => {
    const searchable = normalize(candidateTextValues(candidate).join(" "));
    return terms.length > 1
      ? terms.every((term) => searchable.includes(term))
      : searchable.includes(text);
  });
  if (matches.length === 1) return { status: "resolved", candidate: matches[0], reason: "substring" };
  if (matches.length > 1) return { status: "ambiguous", candidates: matches };
  return { status: "unresolved", candidates: ordered };
}

function candidateTextValues(candidate: TailoringContextCandidate) {
  return [candidate.name, candidate.title, candidate.company]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function cleanReference(value: string) {
  const normalized = normalize(value);
  if (/^(?:刚才那个|上一个|前一个|最后一个|最后一份|末个|末份)$/u.test(normalized)) return normalized;
  return normalized
    .replace(/^(?:我(?:想|要|选)?|请|帮我|就|选择|选|用|针对|优化|定制|适配|做|创建|生成)+/u, "")
    .replace(/(?:那个|这个|岗位|职位)$/u, "")
    .trim();
}

function queryTerms(value: string) {
  const terms = value
    .split(/[的和与及、,，/|｜:：\s]+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0);
  return terms.length > 1 ? terms : [value];
}

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/安卓/gu, "android")
    .replace(/[“”「」『』《》【】()[\]{}<>]/gu, "")
    .replace(/\s+/gu, "")
    .trim();
}

function ordinalFrom(value: string) {
  const match = value.match(/(?:第)?(\d+|[一二三四五六七八九十百]+)(?:个|份|项|号)/u);
  if (!match) {
    if (/^(?:最后一个|最后一份|末个|末份)$/u.test(value)) return -1;
    return undefined;
  }
  const number = /^\d+$/u.test(match[1]) ? Number(match[1]) : chineseNumber(match[1]);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function chineseNumber(value: string) {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0 };
  if (value.length === 1) return digits[value] ?? NaN;
  if (value === "十") return 10;
  const ten = value.indexOf("十");
  if (ten >= 0) {
    const leading = ten === 0 ? 1 : digits[value[0]] ?? NaN;
    const trailing = ten === value.length - 1 ? 0 : digits[value[ten + 1]] ?? NaN;
    return leading * 10 + trailing;
  }
  return NaN;
}
