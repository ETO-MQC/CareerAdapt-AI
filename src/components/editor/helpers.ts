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
  field: "organization" | "role" | "location" | "start" | "end"
) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const orgRoleSeparators = [" / ", " - ", " ｜ ", " | ", "，", ","];
  const separator = orgRoleSeparators.find((value) => normalized.includes(value));

  if (field === "organization") {
    if (!separator) return normalized;
    return normalized.split(separator)[0].trim();
  }

  if (field === "role") {
    if (!separator) return "";
    const afterSep = normalized.split(separator).slice(1).join(separator).trim();
    if (!afterSep) return "";
    return afterSep.replace(/\s+(?:19|20)\d{2}.*$/, "").replace(/\s{2,}.*$/, "").trim();
  }

  if (field === "location") {
    const afterOrgRole = separator
      ? normalized.split(separator).slice(1).join(separator).trim()
      : normalized;
    const cleaned = afterOrgRole
      .replace(/\s+(?:19|20)\d{2}(?:[./-]\d{1,2})?\b.*$/g, "")
      .trim();
    const rolePart = cleaned.replace(/\s{2,}.*$/, "").trim();
    const locPart = cleaned.slice(rolePart.length).trim();
    if (separator && locPart) return locPart;
    if (!separator && cleaned) return cleaned;
    return "";
  }

  if (field === "start" || field === "end") {
    const dateMatch = normalized.match(/(19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g) ?? [];
    const raw = field === "start" ? dateMatch[0] ?? "" : dateMatch[1] ?? "";
    if (!raw) return "";
    if (/^\d{4}$/.test(raw)) return `${raw}-01-01`;
    if (/^\d{4}[./-]\d{1,2}$/.test(raw)) {
      const [y, m] = raw.split(/[./-]/);
      return `${y}-${m.padStart(2, "0")}-01`;
    }
    return raw.replace(/[./]/g, "-");
  }

  return "";
}

export function updateStructuredFieldInText(
  text: string,
  field: "organization" | "role" | "location" | "start" | "end",
  newValue: string
): string {
  const lines = text.split("\n");
  const firstLine = lines[0] ?? "";
  const rest = lines.slice(1);
  const normalized = firstLine.replace(/\s+/g, " ").trim();

  const orgRoleSeparators = [" / ", " - ", " ｜ ", " | ", "，", ","];
  const separator = orgRoleSeparators.find((value) => normalized.includes(value)) ?? " / ";

  if (field === "organization" || field === "role") {
    const org = separator ? normalized.split(separator)[0].trim() : normalized;
    const afterSep = separator ? normalized.split(separator).slice(1).join(separator).trim() : "";
    const roleClean = afterSep
      ? afterSep.replace(/\s+(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b.*$/g, "").replace(/\s{2,}.*$/, "").trim()
      : "";
    const locAndDates = afterSep.slice(roleClean.length).trim();

    const nextOrg = field === "organization" ? newValue.trim() : org;
    const nextRole = field === "role" ? newValue.trim() : roleClean;

    const parts: string[] = [];
    if (nextOrg && nextRole) {
      parts.push(`${nextOrg}${separator}${nextRole}`);
    } else if (nextOrg) {
      parts.push(nextOrg);
    } else if (nextRole) {
      parts.push(nextRole);
    }
    if (locAndDates) parts.push(locAndDates);
    return [parts.join(" "), ...rest].join("\n");
  }

  if (field === "location") {
    const afterSep = separator ? normalized.split(separator).slice(1).join(separator).trim() : "";
    const roleClean = afterSep
      ? afterSep.replace(/\s+(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b.*$/g, "").replace(/\s{2,}.*$/, "").trim()
      : "";
    const dateMatch = afterSep.match(/(19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b\s*(?:-\s*(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?)?\b/);
    const dateStr = dateMatch ? dateMatch[0].trim() : "";

    const orgPart = separator ? normalized.split(separator)[0].trim() : "";
    const nextLoc = newValue.trim();

    const parts: string[] = [];
    if (orgPart && roleClean) {
      parts.push(`${orgPart}${separator}${roleClean}`);
    } else if (orgPart) {
      parts.push(orgPart);
    } else if (roleClean) {
      parts.push(roleClean);
    }
    if (nextLoc) parts.push(nextLoc);
    if (dateStr) parts.push(dateStr);
    return [parts.join("  "), ...rest].join("\n");
  }

  if (field === "start" || field === "end") {
    const fullDatePattern = /(19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?/g;
    const dateMatch = normalized.match(fullDatePattern) ?? [];
    const rawStart = dateMatch[0] ?? "";
    const rawEnd = dateMatch[1] ?? "";

    const normalizeDate = (d: string) => {
      if (!d) return "";
      if (/^\d{4}$/.test(d)) return `${d}-01-01`;
      if (/^\d{4}[./-]\d{1,2}$/.test(d)) {
        const [y, m] = d.split(/[./-]/);
        return `${y}-${m.padStart(2, "0")}-01`;
      }
      return d.replace(/[./]/g, "-");
    };
    const serializeDate = (d: string) => {
      if (!d) return "";
      if (/^\d{4}-01-01$/.test(d)) return d.slice(0, 4);
      if (/^\d{4}-\d{2}-01$/.test(d)) return `${d.slice(0, 4)}.${d.slice(5, 7)}`;
      return d.replace(/-/g, ".");
    };

    const nextStart = field === "start" ? normalizeDate(newValue) : normalizeDate(rawStart);
    const nextEnd = field === "end" ? normalizeDate(newValue) : normalizeDate(rawEnd);

    // Rebuild: org / role  location  dates
    const org = separator ? normalized.split(separator)[0].trim() : normalized;
    const afterSep = separator ? normalized.split(separator).slice(1).join(separator).trim() : "";
    const roleClean = afterSep
      ? afterSep.replace(/\s+(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b.*$/g, "").replace(/\s{2,}.*$/, "").trim()
      : "";
    const locPart = afterSep.slice(roleClean.length).trim()
      .replace(/(19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?\b\s*(?:-\s*(?:19|20)\d{2}(?:[./-]\d{1,2})?(?:[./-]\d{1,2})?)?\b/g, "")
      .trim();

    const dateParts: string[] = [];
    if (nextStart) dateParts.push(serializeDate(nextStart));
    if (nextEnd) dateParts.push(serializeDate(nextEnd));
    const dateStr = dateParts.length > 0 ? dateParts.join(" - ") : "";

    const headerParts: string[] = [];
    if (org && roleClean) {
      headerParts.push(`${org}${separator}${roleClean}`);
    } else if (org) {
      headerParts.push(org);
    } else if (roleClean) {
      headerParts.push(roleClean);
    }
    if (locPart) headerParts.push(locPart);
    if (dateStr) headerParts.push(dateStr);

    return [headerParts.join("  "), ...rest].join("\n");
  }

  return text;
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
