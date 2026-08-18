import type { ResumeItemV2 } from "@/domain/schemas";
import { ResumeItemV2Schema } from "@/domain/schemas";
import type { SegmentedResumeItem } from "./itemSegmenter";

const DATE_RANGE_PATTERN = /(?<!\d)(?:(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[./-]\d{1,2}(?:[./-]\d{1,2})?)?\s*(?:-|–|—|至|到)\s*(?:(?:19|20)\d{2}(?:\s*年\s*\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?|[./-]\d{1,2}(?:[./-]\d{1,2})?)?|至今|现在|Present|Current|仍在职|在读)|至今|现在|目前|Present|Current|仍在职|在读)/i;
const LOCATION_PATTERN = /(?<![\p{L}\p{N}])(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|天津|重庆|苏州|某地|长沙|合肥|厦门|青岛|大连|昆明|济南|珠海|佛山|东莞|无锡|宁波|温州|福州|贵阳|南昌|太原|石家庄|哈尔滨|长春|沈阳|洛阳|测试市)(?:（远程）|\(远程\))?(?![\p{L}\p{N}])/gu;
const HIGHLIGHT_START = /(?=\s+(?:将|对|形成|协助|设计|针对|开发|实现|识别|发现|搭建|封装|适配|集成|基于|完成|复用))/g;
const HIGHLIGHT_ACTION_START = /^(?:负责|将|对|形成|协助|设计|针对|开发|实现|识别|发现|搭建|封装|适配|集成|基于|完成|复用)/;

export function extractSegmentedItemFields(item: SegmentedResumeItem): ResumeItemV2 {
  const text = stripResumeMarkup(item.normalizedText).replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const headerText = stripResumeMarkup(item.headingText ?? item.normalizedText).replace(/\s+/g, " ").trim();
  const dateMatch = headerText.match(DATE_RANGE_PATTERN);
  const startDate = item.dateCandidate?.startDate?.value;
  const current = Boolean(item.dateCandidate?.endDate?.current);
  const endDate = current ? undefined : item.dateCandidate?.endDate?.value;
  const beforeDate = (dateMatch ? headerText.slice(0, dateMatch.index) : headerText)
    .replace(/[|/]\s*$/, "")
    .trim();
  const afterDate = dateMatch ? headerText.slice((dateMatch.index ?? 0) + dateMatch[0].length).trim() : "";
  const locationMatches = [...beforeDate.matchAll(LOCATION_PATTERN)];
  const locationMatch = locationMatches.at(-1);
  const location = locationMatch?.[0];
  const identity = locationMatch
    ? `${beforeDate.slice(0, locationMatch.index).trim()} ${beforeDate.slice((locationMatch.index ?? 0) + locationMatch[0].length).trim()}`.trim()
    : beforeDate;
  const [primary, secondary] = splitIdentity(identity);
  const contentTexts = item.contentBlocks.map((block) => stripResumeMarkup(block.normalizedText));
  const highlights = item.contentBlocks.length > 0 && item.contentBlocks.every(isBulletBlock)
    ? [afterDate, ...contentTexts].map((value) => value.trim()).filter(Boolean)
    : splitHighlights(afterDate, contentTexts);
  const base = { id: item.id, customFields: [] };

  switch (item.sectionType) {
    case "summary":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "summary", text });
    case "education": {
      const majorMatch = headerText.match(/专业[：:]\s*([^\n]+?)(?:专业)?$/);
      const educationHighlights = highlights.filter((highlight) => !/^专业[：:]/.test(highlight));
      return ResumeItemV2Schema.parse({
        ...base,
        sectionType: "education",
        school: primary || undefined,
        degree: secondary || undefined,
        major: majorMatch?.[1]?.trim(),
        location,
        startDate,
        endDate,
        current,
        courses: [],
        honors: [],
        highlights: educationHighlights
      });
    }
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return ResumeItemV2Schema.parse({
        ...base,
        sectionType: item.sectionType,
        organization: primary || undefined,
        role: secondary || undefined,
        location,
        startDate,
        endDate,
        current,
        highlights,
        description: highlights.length ? undefined : afterDate || undefined
      });
    case "project":
      return ResumeItemV2Schema.parse({
        ...base,
        sectionType: "project",
        title: primary || undefined,
        role: secondary || undefined,
        location,
        startDate,
        endDate,
        current,
        tools: [],
        highlights,
        outcomes: [],
        description: highlights.length ? undefined : afterDate || undefined
      });
    case "research":
      return ResumeItemV2Schema.parse({
        ...base,
        sectionType: "research",
        title: primary || text,
        authorRole: secondary || undefined,
        startDate,
        endDate,
        current,
        methods: [],
        highlights,
        description: highlights.length ? undefined : afterDate || undefined
      });
    case "awards": {
      const name = (dateMatch ? text.slice(0, dateMatch.index) : text.replace(/(?:·|•)?\s*(?:19|20)\d{2}[./-]\d{1,2}\s*$/, ""))
        .replace(/[·•\s]+$/, "").trim();
      const awardedAt = startDate ?? singleMonth(text);
      return ResumeItemV2Schema.parse({ ...base, sectionType: "awards", name, awardedAt });
    }
    case "skills":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "skills", name: text });
    case "languages":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "languages", language: text });
    case "certificates":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "certificates", name: text });
    case "publications":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "publications", title: primary || text, authors: [], description: highlights.join("\n") || undefined });
    case "patents":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "patents", title: primary || text, inventors: [], description: highlights.join("\n") || undefined });
    case "portfolio":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "portfolio", title: primary || text, role: secondary || undefined, tools: [], highlights });
    case "custom":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "custom", title: primary || undefined, description: highlights.join("\n") || text, highlights: [] });
    case "other":
      return ResumeItemV2Schema.parse({ ...base, sectionType: "other", title: primary || undefined, description: highlights.join("\n") || text, highlights: [] });
    default:
      return ResumeItemV2Schema.parse({ ...base, sectionType: "other", description: text, highlights: [] });
  }
}

export function itemDisplayLabel(item: ResumeItemV2) {
  if (item.sectionType === "education") return item.school ?? "教育经历";
  if (["work", "internship", "campus", "volunteer"].includes(item.sectionType)) {
    return "organization" in item ? item.organization ?? item.role ?? "经历条目" : "经历条目";
  }
  if (item.sectionType === "project") return item.title ?? "项目";
  if (item.sectionType === "awards" || item.sectionType === "certificates") return item.name;
  if (item.sectionType === "skills") return item.name;
  if (item.sectionType === "languages") return item.language;
  if (item.sectionType === "summary") return "个人概述";
  return "title" in item && item.title ? item.title : "条目";
}

function splitIdentity(value: string): [string, string] {
  const separators = Array.from(value.matchAll(/\s+[|/]\s+/g));
  const separator = value.includes(" - ") ? separators.at(-1) : separators[0];
  if (!separator || separator.index === undefined) return [value.trim(), ""];
  if (value.includes(" - ")) {
    const beforeSeparator = value.slice(0, separator.index).trimEnd();
    const roleStart = beforeSeparator.lastIndexOf(" ");
    if (roleStart > value.indexOf(" - ") + 3) {
      return [
        beforeSeparator.slice(0, roleStart).trim(),
        `${beforeSeparator.slice(roleStart).trim()}${separator[0]}${value.slice(separator.index + separator[0].length).trim()}`.trim()
      ];
    }
  }
  const primary = value.slice(0, separator.index).trim();
  const secondary = value.slice(separator.index + separator[0].length).replace(/[|/]\s*$/, "").trim();
  return [primary, secondary];
}

function splitHighlights(inline: string, continuation: string[]) {
  const repairedSegments = [inline, ...continuation].reduce<string[]>((result, current) => {
    const value = current.trim();
    if (!value) return result;
    const previous = result.at(-1);
    const hardWrapped = previous
      && !/[。！？；;.!?]$/u.test(previous)
      && !HIGHLIGHT_ACTION_START.test(value)
      && /[\p{Script=Han}A-Za-z0-9]$/u.test(previous)
      && /^[\p{Script=Han}A-Za-z0-9]/u.test(value);
    if (hardWrapped) result[result.length - 1] = `${previous}${value}`;
    else result.push(value);
    return result;
  }, []);
  const combined = repairedSegments.join(" ").replace(/\s+/g, " ").trim();
  if (!combined) return [];
  return combined.split(HIGHLIGHT_START).map((part) => part.trim()).filter(Boolean);
}

function singleMonth(text: string) {
  const match = text.match(/(?<!\d)((?:19|20)\d{2})[./-](\d{1,2})(?!\d)/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : undefined;
}

function stripResumeMarkup(text: string) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[•·●▪◦■□◆◇▶►*-]\s+/u, "")
    .replace(/^#{1,6}\s*/u, "")
    .trim();
}

function isBulletBlock(block: SegmentedResumeItem["contentBlocks"][number]) {
  return block.blockType === "list_item" || /^[•·●▪◦■□◆◇▶►*-]\s+/u.test(block.normalizedText.trim());
}
