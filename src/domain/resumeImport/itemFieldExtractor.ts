import type { ResumeItemV2 } from "@/domain/schemas";
import { ResumeItemV2Schema } from "@/domain/schemas";
import type { SegmentedResumeItem } from "./itemSegmenter";

const DATE_RANGE_PATTERN = /(?<!\d)((?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2}日?)?)\s*(?:-|–|—|至|到)\s*((?:19|20)\d{2}(?:[./年-]\d{1,2})?(?:[./月-]\d{1,2}日?)?|至今|现在|Present|Current|仍在职|在读)/i;
const LOCATION_PATTERN = /(?:北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|天津|重庆|苏州|某地|长沙|合肥|厦门|青岛|大连|昆明|济南|珠海|佛山|东莞|无锡|宁波|温州|福州|贵阳|南昌|太原|石家庄|哈尔滨|长春|沈阳|洛阳|测试市)(?:（远程）|\(远程\))?/g;
const HIGHLIGHT_START = /(?=\s+(?:将|对|形成|协助|设计|针对|开发|实现|识别|发现|搭建|封装|适配|集成|基于|完成|复用))/g;

export function extractSegmentedItemFields(item: SegmentedResumeItem): ResumeItemV2 {
  const text = item.normalizedText.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const headerText = (item.headingText ?? item.normalizedText).replace(/\s+/g, " ").trim();
  const dateMatch = headerText.match(DATE_RANGE_PATTERN);
  const startDate = item.dateCandidate?.startDate?.value;
  const current = Boolean(item.dateCandidate?.endDate?.current);
  const endDate = current ? undefined : item.dateCandidate?.endDate?.value;
  const beforeDate = dateMatch ? headerText.slice(0, dateMatch.index).trim() : headerText;
  const afterDate = dateMatch ? headerText.slice((dateMatch.index ?? 0) + dateMatch[0].length).trim() : "";
  const locationMatches = [...beforeDate.matchAll(LOCATION_PATTERN)];
  const locationMatch = locationMatches.at(-1);
  const location = locationMatch?.[0];
  const identity = locationMatch
    ? `${beforeDate.slice(0, locationMatch.index).trim()} ${beforeDate.slice((locationMatch.index ?? 0) + locationMatch[0].length).trim()}`.trim()
    : beforeDate;
  const [primary, secondary] = splitIdentity(identity);
  const highlights = splitHighlights(afterDate, item.bodyBlocks.slice(1).map((block) => block.normalizedText));
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
  const separator = /\s+[|/]\s+/.exec(value);
  if (!separator || separator.index === undefined) return [value.trim(), ""];
  const primary = value.slice(0, separator.index).trim();
  const secondary = value.slice(separator.index + separator[0].length).replace(/[|/]\s*$/, "").trim();
  return [primary, secondary];
}

function splitHighlights(inline: string, continuation: string[]) {
  const combined = [inline, ...continuation].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!combined) return [];
  return combined.split(HIGHLIGHT_START).map((part) => part.trim()).filter(Boolean);
}

function singleMonth(text: string) {
  const match = text.match(/(?<!\d)((?:19|20)\d{2})[./-](\d{1,2})(?!\d)/);
  return match ? `${match[1]}-${match[2].padStart(2, "0")}` : undefined;
}
