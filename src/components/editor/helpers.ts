import {
  parseStructuredExperienceText,
  serializeStructuredExperienceText,
  type ResumeFieldCategoryId
} from "@/domain/resumeFields/catalog";

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
  field: "organization" | "role" | "location" | "degree" | "major" | "courses" | "start" | "end" | "current"
) {
  const parsed = parseStructuredExperienceText(text);
  if (field === "current") return parsed.current ? "true" : "false";
  if (field === "start") return parsed.startDate;
  if (field === "end") return parsed.endDate;
  return parsed[field];
}

export function updateStructuredFieldInText(
  text: string,
  field: "organization" | "role" | "location" | "degree" | "major" | "courses" | "start" | "end" | "current",
  newValue: string,
  category: ResumeFieldCategoryId = "work"
): string {
  const parsed = parseStructuredExperienceText(text);
  const targetField = field === "start" ? "startDate" : field === "end" ? "endDate" : field;
  const next = {
    ...parsed,
    [targetField]: field === "current" ? newValue === "true" : newValue.trim()
  };
  if (field === "current" && next.current) next.endDate = "";
  return serializeStructuredExperienceText(next, category);
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
