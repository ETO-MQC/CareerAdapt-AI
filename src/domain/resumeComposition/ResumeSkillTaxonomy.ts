import type { ResumeItemV2 } from "@/domain/schemas";
import type { ResumeSkillEvidence } from "./contracts";

export const RESUME_SKILL_CATEGORIES = [
  "编程语言",
  "前端",
  "后端",
  "数据库",
  "数据与 AI",
  "嵌入式 / IoT",
  "工程与测试"
] as const;

type SkillDefinition = {
  name: string;
  category: (typeof RESUME_SKILL_CATEGORIES)[number];
  aliases: string[];
};

const DEFINITIONS: SkillDefinition[] = [
  ...["TypeScript", "JavaScript", "Python", "Java", "C++", "Rust", "Go"].map((name) => ({ name, category: "编程语言" as const, aliases: [name] })),
  ...["React", "Next.js", "Vue"].map((name) => ({ name, category: "前端" as const, aliases: [name] })),
  { name: "Node.js", category: "后端", aliases: ["Node.js", "Node"] },
  { name: "FastAPI", category: "后端", aliases: ["FastAPI"] },
  { name: "REST API", category: "后端", aliases: ["REST API", "RESTful API", "REST接口"] },
  { name: "SQLx", category: "后端", aliases: ["SQLx"] },
  ...["SQL", "SQLite", "MySQL", "PostgreSQL", "MongoDB", "Redis"].map((name) => ({ name, category: "数据库" as const, aliases: [name] })),
  ...["RPA", "RAG", "LLM", "TensorFlow", "PyTorch", "机器学习", "深度学习", "数据处理", "数据分析", "数据可视化", "爬虫"].map((name) => ({ name, category: "数据与 AI" as const, aliases: [name] })),
  ...["ESP32", "Arduino", "PlatformIO"].map((name) => ({ name, category: "嵌入式 / IoT" as const, aliases: [name] })),
  ...["Git", "Docker", "Linux", "Figma", "Playwright", "Vitest"].map((name) => ({ name, category: "工程与测试" as const, aliases: [name] }))
];

const DEFINITION_BY_NAME = new Map(DEFINITIONS.map((definition) => [definition.name, definition]));

export function technicalTermDefinitions() {
  return DEFINITIONS;
}

export function findTechnicalTerms(text: string) {
  return DEFINITIONS
    .filter((definition) => definition.aliases.some((alias) => containsTerm(text, alias)))
    .map((definition) => definition.name);
}

export function canonicalTechnicalTerm(value: string) {
  const normalized = normalizeTerm(value);
  return DEFINITIONS.find((definition) => definition.aliases.some((alias) => {
    const normalizedAlias = normalizeTerm(alias);
    return normalized === normalizedAlias || new RegExp(`^${escapeRegExp(normalizedAlias)}(?:\\s*v?\\d+(?:\\.\\d+)*)$`, "iu").test(normalized);
  }))?.name;
}

export function technicalTermCategory(term: string) {
  return DEFINITION_BY_NAME.get(term)?.category;
}

export function extractTechnicalTerms(item: ResumeItemV2, text: string) {
  const record = item as unknown as Record<string, unknown>;
  const explicit = [
    ...(Array.isArray(record.tools) ? record.tools : []),
    ...(Array.isArray(record.methods) ? record.methods : []),
    ...(Array.isArray(record.highlights) ? record.highlights : []),
    ...(Array.isArray(record.outcomes) ? record.outcomes : []),
    ...(Array.isArray(record.courses) ? record.courses : []),
    text
  ].filter((value): value is string => typeof value === "string").join(" ");
  return DEFINITIONS
    .filter((definition) => definition.aliases.some((alias) => containsTerm(explicit, alias)) && !isNegated(explicit, definition.aliases))
    .map((definition) => definition.name);
}

export function normalizeSkillGroups(skills: ResumeSkillEvidence[]) {
  const grouped = new Map<string, string[]>();
  for (const skill of skills) {
    const canonical = canonicalTechnicalTerm(skill.name) ?? skill.name.trim();
    const category = technicalTermCategory(canonical) ?? skill.category;
    if (!canonical || !category || !isUsefulSkillName(canonical)) continue;
    grouped.set(category, unique([...(grouped.get(category) ?? []), canonical]));
  }
  return Object.fromEntries([...grouped.entries()].map(([category, values]) => [category, values.slice(0, 16)]));
}

export function isUsefulSkillName(value: string) {
  return !/^(?:API|工具|测试|开发|技术|框架|软件|平台|系统|自动化)$/iu.test(value.trim());
}

export function compactSkillCategory(category: string) {
  return category === "后端" || category === "数据库" ? "后端 / 数据库" : category;
}

function containsTerm(text: string, alias: string) {
  return new RegExp(`(?:^|[^A-Za-z0-9+#.-])${escapeRegExp(alias)}(?:\\s*v?\\d+(?:\\.\\d+)*)?(?:$|[^A-Za-z0-9+#.-])`, "iu").test(text);
}

function isNegated(text: string, aliases: string[]) {
  return aliases.some((alias) => new RegExp(`(?:未涉及|未使用|没有|不会|不使用|不支持|不含|无)\\s*(?:[A-Za-z0-9+#.-]+\\s*){0,2}${escapeRegExp(alias)}`, "iu").test(text));
}

function normalizeTerm(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[\u00a0\s]+/gu, " ");
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
