/**
 * Shared section heading matcher used by both parser.ts and fieldCandidates.ts.
 * Single source of truth for section heading detection.
 */
import type { ResumeSectionTypeV2 } from "@/domain/resumeFields";

export type ImportedResumeSectionType = ResumeSectionTypeV2 | "experience" | "unknown";

export type ImportedResumeCategory =
  | "summary"
  | "education"
  | "work"
  | "project"
  | "campus"
  | "award"
  | "skill"
  | "certificate"
  | "language"
  | "custom";

export type ResumeHeadingMatch =
  | {
      kind: "canonical_section";
      sectionType: ResumeSectionTypeV2;
      importedSectionType: ImportedResumeSectionType;
      category?: ImportedResumeCategory;
      confidence: "high" | "medium";
      label: string;
    }
  | {
      kind: "presentation_group";
      groupId: string;
      label: string;
    }
  | {
      kind: "unknown_heading";
      label: string;
    };

export type SectionHeadingMatch = Extract<ResumeHeadingMatch, { kind: "canonical_section" }>;

/**
 * Maps ResumeSectionTypeV2 (field catalog section) to the V1 ImportedResumeSectionType
 * used by the parser draft schema.
 */
function toImportedSectionType(sectionType: ResumeSectionTypeV2): ImportedResumeSectionType {
  return sectionType;
}

/**
 * Maps ResumeSectionTypeV2 to the ImportedResumeCategory used by the parser draft.
 */
function toImportedCategory(sectionType: ResumeSectionTypeV2): ImportedResumeCategory {
  switch (sectionType) {
    case "summary": return "summary";
    case "education": return "education";
    case "work": return "work";
    case "internship": return "work";
    case "project": return "project";
    case "research": return "work";
    case "campus": return "campus";
    case "volunteer": return "campus";
    case "awards": return "award";
    case "skills": return "skill";
    case "certificates": return "certificate";
    case "languages": return "language";
    case "publications": return "custom";
    case "patents": return "custom";
    case "portfolio": return "custom";
    case "other": return "custom";
    case "basics": return "custom";
    case "custom": return "custom";
    default: return "custom";
  }
}

type SectionPatternEntry = {
  sectionType: ResumeSectionTypeV2;
  confidence: "high" | "medium";
  pattern: RegExp;
};

/**
 * All section heading patterns, unified from parser.ts and fieldCandidates.ts.
 * Ordered by specificity (more specific patterns first).
 */
const SECTION_HEADING_PATTERNS: SectionPatternEntry[] = [
  // Summary
  { sectionType: "summary", confidence: "high", pattern: /^(?:个人总结|个人概述|个人简介|自我评价|求职意向|summary|profile|objective)\s*[:：]?$/i },

  // Education
  { sectionType: "education", confidence: "high", pattern: /^(?:教育经历|教育背景|education)\s*[:：]?$/i },

  // Work & Internship (most specific first)
  { sectionType: "internship", confidence: "high", pattern: /^(?:实习经历|internships?)\s*[:：]?$/i },
  { sectionType: "work", confidence: "high", pattern: /^(?:工作(?:与实习)?经历|工作经验|experience|work(?:\s*(?:与|and)\s*internship)?\s*experience|employment)$/i },

  // Research
  { sectionType: "research", confidence: "high", pattern: /^(?:科研经历|research)\s*[:：]?$/i },

  // Project
  { sectionType: "project", confidence: "high", pattern: /^(?:项目与研究经历|项目经历|项目成果|projects?|project(?:\s*(?:experience|results|outcomes))?)\s*[:：]?$/i },

  // Campus & Volunteer
  { sectionType: "campus", confidence: "high", pattern: /^(?:校园经历|社团经历|实践经历|campus experience|leadership)\s*[:：]?$/i },
  { sectionType: "volunteer", confidence: "high", pattern: /^(?:志愿经历|volunteer)\s*[:：]?$/i },

  // Skills
  { sectionType: "skills", confidence: "high", pattern: /^(?:技能与证书|技能|专业技能|技能清单|AI能力|工程与表达|skills?|technical skills)$/i },

  // Awards
  { sectionType: "awards", confidence: "high", pattern: /^(?:荣誉(?:奖项)?|奖项|awards?|honou?rs?)\s*[:：]?$/i },

  // Certificates
  { sectionType: "certificates", confidence: "high", pattern: /^(?:证书|资格证书|certificates?|certifications?)\s*[:：]?$/i },

  // Languages
  { sectionType: "languages", confidence: "high", pattern: /^(?:语言(?:能力)?|languages?)\s*[:：]?$/i }
];

/**
 * Match a line of text against known section heading patterns.
 * Returns the match result or undefined if no pattern matches.
 */
export function matchResumeSectionHeading(text: string): ResumeHeadingMatch | undefined {
  const trimmed = normalizeResumeHeading(text);
  // Skip very long lines (not headings)
  if (Array.from(trimmed).length > 48) return undefined;
  if (/^经历$/.test(trimmed)) {
    return {
      kind: "presentation_group",
      groupId: "experience-group",
      label: "经历"
    };
  }
  if (/^奖项[、,]技能与语言$/i.test(trimmed)) {
    return { kind: "presentation_group", groupId: "awards-skills-languages-group", label: trimmed };
  }

  for (const entry of SECTION_HEADING_PATTERNS) {
    if (entry.pattern.test(trimmed)) {
      return {
        kind: "canonical_section",
        sectionType: entry.sectionType,
        importedSectionType: toImportedSectionType(entry.sectionType),
        category: toImportedCategory(entry.sectionType),
        confidence: entry.confidence,
        label: trimmed
      };
    }
  }
  return undefined;
}

export function normalizeResumeHeading(text: string) {
  return text.normalize("NFKC")
    .trim()
    .replace(/[：:]\s*$/, "")
    .replace(/[／/]/g, "与")
    .replace(/\s*(?:&|及)\s*/gi, "与")
    .replace(/[—–-]/g, "-")
    .replace(/\s+/g, "")
    .toLocaleLowerCase()
    .replace(/^ai/, "AI");
}

/**
 * For fieldCandidates.ts: detect section type from text.
 * Returns the ResumeSectionTypeV2 (field catalog section type).
 */
export function detectSectionType(text: string): ResumeSectionTypeV2 | undefined {
  const match = matchResumeSectionHeading(text);
  return match?.kind === "canonical_section" ? match.sectionType : undefined;
}

/**
 * Section types that support date fields (startDate, endDate, current) in the catalog.
 */
const DATE_SECTION_TYPES = new Set<ResumeSectionTypeV2>([
  "education", "work", "internship", "project", "research", "campus", "volunteer"
]);

/**
 * For fieldCandidates.ts: the catalog section type to use when generating date field candidates.
 * Some section types (internship, research) don't have their own date fields in the catalog,
 * so we map them to the closest section type that does.
 */
const DATE_FIELD_SECTION_MAP: Partial<Record<ResumeSectionTypeV2, ResumeSectionTypeV2>> = {};

/**
 * Returns the section type to use for date field candidate generation.
 * Maps section types without their own date fields to the appropriate parent.
 */
export function dateFieldSectionType(sectionType: ResumeSectionTypeV2): ResumeSectionTypeV2 | undefined {
  if (!DATE_SECTION_TYPES.has(sectionType)) return undefined;
  return DATE_FIELD_SECTION_MAP[sectionType] ?? sectionType;
}

/**
 * Returns true if the given section type has date-related fields in the catalog.
 */
export function sectionHasDateFields(sectionType: ResumeSectionTypeV2): boolean {
  return DATE_SECTION_TYPES.has(sectionType);
}
