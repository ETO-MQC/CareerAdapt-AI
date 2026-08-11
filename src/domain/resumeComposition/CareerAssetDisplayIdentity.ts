import type { ResumeItemV2 } from "@/domain/schemas";

export type CareerAssetDisplayIdentity = {
  label: string;
  sectionLabel: string;
  displayIdentityMissing: boolean;
};

const SECTION_LABELS: Record<string, string> = {
  education: "教育经历",
  work: "工作经历",
  internship: "实习经历",
  campus: "校园经历",
  volunteer: "志愿经历",
  project: "项目经历",
  research: "科研经历",
  awards: "奖项",
  certificates: "证书",
  skills: "技能",
  languages: "语言能力",
  publications: "论文 / 发表",
  patents: "专利",
  portfolio: "作品集",
  other: "其他经历",
  custom: "其他经历",
  summary: "个人总结"
};

/**
 * One user-facing identity for a Career Asset.
 *
 * IDs remain provenance and storage keys. They are deliberately never used
 * as a label fallback in proposals, editors, previews, or PDFs.
 */
export function resolveCareerAssetDisplayIdentity(item: ResumeItemV2 | Record<string, unknown>): CareerAssetDisplayIdentity {
  const record = item as Record<string, unknown>;
  const sectionType = typeof record.sectionType === "string" ? record.sectionType : "other";
  const sectionLabel = SECTION_LABELS[sectionType] ?? "其他经历";
  const candidates = identityCandidates(sectionType, record);
  const label = candidates.find((value) => typeof value === "string" && value.trim())?.trim();
  return {
    label: label ?? sectionLabel,
    sectionLabel,
    displayIdentityMissing: !label
  };
}

export function resumeSectionDisplayLabel(sectionType: string) {
  return SECTION_LABELS[sectionType] ?? "其他经历";
}

function identityCandidates(sectionType: string, record: Record<string, unknown>) {
  const text = (key: string) => typeof record[key] === "string" && record[key].trim() ? record[key] as string : undefined;
  switch (sectionType) {
    case "education":
      return [text("school"), text("institution"), text("major")];
    case "project":
    case "research":
    case "publications":
    case "patents":
    case "portfolio":
      return [text("title"), text("name"), text("organization"), text("institution")];
    case "work":
    case "internship":
    case "campus":
    case "volunteer":
      return [text("role"), text("organization"), text("title")];
    case "awards":
    case "certificates":
    case "skills":
      return [text("name"), text("title")];
    case "languages":
      return [text("language"), text("name")];
    case "summary":
      return [text("text")];
    default:
      return [text("title"), text("name"), text("organization"), text("school"), text("institution"), text("language"), text("text")];
  }
}
