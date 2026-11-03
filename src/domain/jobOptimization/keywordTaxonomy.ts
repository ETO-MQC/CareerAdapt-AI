export type TailoringKeywordType =
  | "exact_phrase"
  | "technical_term"
  | "action_phrase"
  | "workflow"
  | "domain_term"
  | "soft_signal"
  | "semantic_alias";

export type TailoringKeyword = {
  phrase: string;
  type: TailoringKeywordType;
  weight: number;
  aliases: string[];
};

const PHRASE_CATALOG: TailoringKeyword[] = [
  keyword("复杂多轮指令", "workflow", 1),
  keyword("复杂任务规划", "workflow", 1),
  keyword("输出质量评估", "action_phrase", 1, ["模型评测", "AI 回答质量评估"]),
  keyword("逻辑缺陷识别", "action_phrase", 0.95, ["漏洞识别"]),
  keyword("Prompt Engineering", "technical_term", 1, ["提示词工程"]),
  keyword("Coding Agent", "exact_phrase", 1, ["代码智能体"]),
  keyword("Vibe Coding", "exact_phrase", 0.95, ["AI 辅助开发"]),
  keyword("AI Coding", "exact_phrase", 0.95),
  keyword("AI Agent", "exact_phrase", 0.95, ["智能体"]),
  keyword("模型评测", "domain_term", 1, ["输出质量评估"]),
  keyword("任务拆解", "action_phrase", 0.9),
  keyword("回答纠错", "action_phrase", 0.9),
  keyword("搜索任务", "workflow", 0.9),
  keyword("Benchmark", "technical_term", 0.95, ["基准测试"]),
  keyword("Verifier", "technical_term", 0.95, ["验证器"]),
  keyword("Badcase", "technical_term", 0.95, ["失败案例", "反例"]),
  keyword("RAG", "technical_term", 1, ["检索增强生成"]),
  keyword("Claude Code", "technical_term", 1),
  keyword("Cursor", "technical_term", 1),
  keyword("Codex", "technical_term", 1),
  keyword("Windsurf", "technical_term", 1),
  keyword("Playwright", "technical_term", 1),
  keyword("Vitest", "technical_term", 1),
  keyword("FastAPI", "technical_term", 1),
  keyword("Python", "technical_term", 1),
  keyword("reward hacking", "domain_term", 0.95, ["评测规避", "投机行为"])
];

const LOW_WEIGHT_STANDALONE: Record<string, TailoringKeywordType> = {
  ai: "soft_signal",
  coding: "soft_signal",
  agent: "soft_signal",
  vibe: "soft_signal"
};

export function extractPhraseAwareKeywords(values: string[]): TailoringKeyword[] {
  const text = values.join("\n");
  const normalized = normalize(text);
  const result: TailoringKeyword[] = [];
  for (const entry of [...PHRASE_CATALOG].sort((left, right) => right.phrase.length - left.phrase.length)) {
    if ([entry.phrase, ...entry.aliases].some((candidate) => containsKeywordTerm(normalized, candidate))) result.push(entry);
  }
  const technical = text.match(/\b(?:[A-Z][A-Za-z0-9.+#-]{1,}|[A-Za-z]+(?:\s+[A-Za-z]+){1,2})\b/g) ?? [];
  for (const phrase of technical) {
    const trimmed = phrase.trim();
    const lowType = LOW_WEIGHT_STANDALONE[trimmed.toLowerCase()];
    addUnique(result, keyword(trimmed, lowType ?? "technical_term", lowType ? 0.15 : 0.75));
  }
  for (const [phrase, type] of Object.entries(LOW_WEIGHT_STANDALONE)) {
    if (new RegExp(`\\b${phrase}\\b`, "i").test(text)) addUnique(result, keyword(phrase.toUpperCase() === "AI" ? "AI" : phrase, type, 0.15));
  }
  return result.sort((left, right) => right.weight - left.weight || right.phrase.length - left.phrase.length);
}

export function keywordMatchScore(keyword: TailoringKeyword, text: string) {
  const normalized = normalize(text);
  if (containsKeywordTerm(normalized, keyword.phrase)) return keyword.weight;
  if (keyword.aliases.some((alias) => containsKeywordTerm(normalized, alias))) return keyword.weight * 0.8;
  return 0;
}

export function matchPhraseAwareKeywords(keywords: TailoringKeyword[], text: string) {
  return keywords.filter((entry) => keywordMatchScore(entry, text) > 0);
}

function keyword(phrase: string, type: TailoringKeywordType, weight: number, aliases: string[] = []): TailoringKeyword {
  return { phrase, type, weight, aliases };
}

function addUnique(items: TailoringKeyword[], candidate: TailoringKeyword) {
  if (!items.some((item) => normalize(item.phrase) === normalize(candidate.phrase))) items.push(candidate);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s_-]+/g, " ").trim();
}

/** Latin identifiers must not match inside another identifier; Chinese stays phrase based. */
export function containsKeywordTerm(text: string, term: string) {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) return false;
  return new RegExp(`${/^[a-z0-9]/i.test(term) ? "(?<![a-z0-9_])" : ""}${escaped}${/[a-z0-9]$/i.test(term) ? "(?![a-z0-9_])" : ""}`, "iu").test(normalize(text));
}

export type KeywordRelation = "direct" | "synonym" | "adjacent" | "transferable" | "unknown" | "negative" | "ambiguous";
export function classifyKeywordRelation(term: string, text: string): KeywordRelation {
  const clauses = text.split(/[。；;，,\n]/u);
  const matches = clauses.filter((clause) => containsKeywordTerm(clause, term));
  const negative = (clause: string) => /未涉及|未使用|没有|不会|不使用|不支持|不含/u.test(clause);
  const uncertain = (clause: string) => /不确定|待确认|尚未确认|未知/u.test(clause);
  if (matches.some((clause) => !negative(clause) && !uncertain(clause))) return "direct";
  if (matches.some(uncertain)) return "unknown";
  if (matches.length) return "negative";
  const catalog = PHRASE_CATALOG.find((entry) => [entry.phrase, ...entry.aliases].some((alias) => normalize(alias) === normalize(term)));
  if (catalog) {
    const aliasClauses = clauses.filter((clause) => [catalog.phrase, ...catalog.aliases].some((alias) => containsKeywordTerm(clause, alias)));
    if (aliasClauses.some((clause) => !negative(clause) && !uncertain(clause))) return "synonym";
    if (aliasClauses.some(uncertain)) return "unknown";
    if (aliasClauses.length) return "negative";
  }
  const adjacent: Record<string, string[]> = { postgresql: ["SQLite", "MySQL", "SQL"], sqlite: ["PostgreSQL", "MySQL"], mysql: ["SQL", "SQLite", "PostgreSQL"], sql: ["MySQL", "SQLite", "PostgreSQL"] };
  if ((adjacent[normalize(term)] ?? []).some((alias) => containsKeywordTerm(text, alias))) return "adjacent";
  const transferable: Record<string, string[]> = { backend: ["FastAPI", "Node.js", "Rust", "API"], frontend: ["React", "Next.js", "TypeScript"] };
  if ((transferable[normalize(term)] ?? []).some((alias) => containsKeywordTerm(text, alias))) return "transferable";
  if (/^(?:平台开发|平台|platform development)$/iu.test(term)) return "ambiguous";
  return "unknown";
}
