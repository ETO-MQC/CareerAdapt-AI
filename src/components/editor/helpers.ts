/**
 * Shared label helpers and structured-field utilities for the resume editor.
 * Extracted from ResumeWorkspace.tsx so section-page components can import them.
 */

export function contentItemTypeLabel(value: string) {
  const labels: Record<string, string> = {
    summary: "个人简介",
    experience: "经历",
    project: "项目",
    education: "教育",
    skill: "技能",
    certificate: "证书",
    award: "奖项",
    language: "语言",
    custom: "自定义"
  };
  return labels[value] ?? "段落";
}

export function guardStatusLabel(value: string) {
  const labels: Record<string, string> = {
    pass: "事实检查通过",
    ai_failed_rule_kept: "AI未通过/规则保留",
    failed: "事实检查失败",
    blocked: "已阻断",
    pending: "待检查",
    rule_only_verified: "规则检查通过"
  };
  return labels[value] ?? value;
}

export function riskLevelLabel(value: string) {
  const labels: Record<string, string> = {
    low: "低风险",
    medium: "中风险",
    high: "高风险"
  };
  return labels[value] ?? value;
}

export function extractStructuredField(
  text: string,
  field: "organization" | "role" | "location" | "start" | "end" | "current"
) {
  const parsed = parseStructuredHeader(text);
  if (field === "current") return parsed.current ? "true" : "false";
  return parsed[field];
}

export function updateStructuredFieldInText(
  text: string,
  field: "organization" | "role" | "location" | "start" | "end" | "current",
  newValue: string
): string {
  const parsed = parseStructuredHeader(text);
  const next = {
    ...parsed,
    [field]: field === "current" ? newValue === "true" : newValue.trim()
  };
  if (field === "current" && next.current) next.end = "";
  const identity = [next.organization, next.role].filter(Boolean).join(" / ");
  const dates = next.start
    ? `${serializeDate(next.start)} - ${next.current ? "至今" : serializeDate(next.end)}`.replace(/\s+-\s+$/, "")
    : next.current ? "至今" : serializeDate(next.end);
  const header = [identity, next.location, dates].filter(Boolean).join("  ");
  return [header, ...parsed.descriptionLines].filter((line, index) => index > 0 || Boolean(line)).join("\n");
}

function parseStructuredHeader(text: string) {
  const [rawHeader = "", ...descriptionLines] = text.split("\n");
  let header = rawHeader.trim();
  const current = /(?:至今|现在|present|current)/i.test(header);
  const dates = header.match(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g) ?? [];
  header = header
    .replace(/(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g, "")
    .replace(/(?:至今|现在|present|current)/gi, "")
    .replace(/\s+-\s*$/, "")
    .trim();
  const segments = header.split(/\s{2,}/).map((value) => value.trim()).filter(Boolean);
  const identity = segments[0] ?? "";
  const separator = [" / ", " ｜ ", " | ", "，", ","].find((value) => identity.includes(value));
  const identityParts = separator ? identity.split(separator).map((value) => value.trim()) : [identity];
  return {
    organization: identityParts[0] ?? "",
    role: identityParts.slice(1).join(separator ?? " / "),
    location: segments.slice(1).join(" "),
    start: normalizeDate(dates[0] ?? ""),
    end: current ? "" : normalizeDate(dates[1] ?? ""),
    current,
    descriptionLines
  };
}

function normalizeDate(value: string) {
  if (!value) return "";
  const parts = value.split(/[./-]/);
  if (parts.length === 1) return `${parts[0]}-01-01`;
  if (parts.length === 2) return `${parts[0]}-${parts[1].padStart(2, "0")}-01`;
  return `${parts[0]}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
}

function serializeDate(value: string) {
  if (!value) return "";
  if (/^\d{4}-01-01$/.test(value)) return value.slice(0, 4);
  if (/^\d{4}-\d{2}-01$/.test(value)) return `${value.slice(0, 4)}.${value.slice(5, 7)}`;
  return value.replace(/-/g, ".");
}

/**
 * Convert plain text (possibly with newlines) to simple HTML for TipTap.
 * Each line becomes a <p> element.
 */
export function plainTextToHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  // If already HTML, return as-is
  if (trimmed.startsWith("<")) return trimmed;
  return trimmed
    .split("\n")
    .map((line) => `<p>${line}</p>`)
    .join("");
}

/**
 * Strip HTML tags from TipTap output back to plain text.
 * Preserves line breaks from <p> and <li> tags.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\/p>\s*<p[^>]*>/g, "\n")
    .replace(/<p[^>]*>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<\/li>\s*<li[^>]*>/g, "\n")
    .replace(/<li[^>]*>/g, "• ")
    .replace(/<\/li>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
