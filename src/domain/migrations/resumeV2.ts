import {
  CareerProfileSchema,
  ResumeBranchSchema,
  ResumeContentItemV2Schema,
  type BranchContentItem,
  type CareerProfile,
  type CareerProfileV2,
  type Experience,
  type ResumeBranch,
  type ResumeBranchV2,
  type ResumeContentItemV2,
  type ResumeItemV2
} from "@/domain/schemas";
import { resumeFieldCatalog } from "@/domain/resumeFields";

export function migrateCareerProfileToV2(profile: CareerProfile): CareerProfileV2 {
  if (profile.schemaVersion === "career-profile-v2" && profile.structuredFacts && profile.structuredBasics) return profile as CareerProfileV2;
  const structuredFacts = [
    ...profile.experiences.map((experience) => ({ data: migrateExperience(experience), factIds: experience.facts.map((fact) => fact.id) })),
    ...profile.skills.map((skill) => ({
      data: skill.fact?.category === "language"
        ? { id: skill.id, sectionType: "languages" as const, language: skill.name, description: skill.fact.statement, customFields: [] }
        : { id: skill.id, sectionType: "skills" as const, name: skill.name, level: skill.level, description: skill.fact?.statement, customFields: [] },
      factIds: skill.fact ? [skill.fact.id] : []
    })),
    ...profile.certificates.map((certificate) => ({ data: { id: certificate.id, sectionType: "certificates" as const, name: certificate.name, issuer: certificate.issuer, issuedAt: certificate.issuedAt, customFields: [] }, factIds: certificate.fact ? [certificate.fact.id] : [] }))
  ];
  return CareerProfileSchema.parse({
    ...profile,
    schemaVersion: "career-profile-v2",
    structuredBasics: {
      name: profile.basics.name,
      headline: profile.basics.headline,
      summary: profile.basics.summary,
      phone: profile.basics.phone,
      email: profile.basics.email,
      location: profile.basics.location,
      otherLinks: profile.basics.links,
      customFields: []
    },
    structuredFacts
  }) as CareerProfileV2;
}

export function migrateResumeBranchToV2(branch: ResumeBranch): ResumeBranchV2 {
  if (branch.schemaVersion === "resume-branch-v2" && branch.structuredContentItems && branchContentV2IsCurrent(branch)) return branch as ResumeBranchV2;
  return ResumeBranchSchema.parse({
    ...branch,
    schemaVersion: "resume-branch-v2",
    structuredContentItems: branch.contentItems.map(migrateBranchContentItem)
  }) as ResumeBranchV2;
}

function branchContentV2IsCurrent(branch: ResumeBranch) {
  if (!branch.structuredContentItems || branch.structuredContentItems.length !== branch.contentItems.length) return false;
  const byId = new Map(branch.structuredContentItems.map((item) => [item.id, item]));
  return branch.contentItems.every((legacy) => {
    const item = byId.get(legacy.id);
    if (!item) return false;
    // Detect legacy data where internship was misclassified as work
    if (legacy.sourceSectionId === "internship" && item.data.sectionType === "work") return false;
    return Boolean(item
      && item.legacyTextProjection === legacy.text
      && item.order === legacy.order
      && item.visible === legacy.visible
      && item.source === legacy.source
      && JSON.stringify(item.factRefs) === JSON.stringify(legacy.factRefs)
      && item.guardMode === legacy.guardMode
      && item.guardStatus === legacy.guardStatus);
  });
}

export function migrateBranchContentItem(item: BranchContentItem): ResumeContentItemV2 {
  const data = legacyBranchData(item);
  return ResumeContentItemV2Schema.parse({
    id: item.id,
    schemaVersion: "resume-content-item-v2",
    data,
    factRefs: item.factRefs,
    source: item.source,
    order: item.order,
    visible: item.visible,
    guardMode: item.guardMode,
    guardStatus: item.guardStatus,
    guardFindings: item.guardFindings,
    userConfirmation: item.userConfirmation,
    legacyTextProjection: item.text
  });
}

export function projectResumeItemV2(item: ResumeItemV2): string {
  if (item.sectionType === "summary") return item.text;
  const record = item as unknown as Record<string, unknown>;
  const lines = resumeFieldCatalog.filter((field) => field.sectionType === item.sectionType).flatMap((field) => {
    const key = field.id.split(".").at(-1)!;
    const value = record[key];
    if (value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0)) return [];
    return [`${field.label}：${Array.isArray(value) ? value.join("；") : value === true ? "是" : String(value)}`];
  });
  for (const field of item.customFields) {
    const value = Array.isArray(field.value) ? field.value.join("；") : String(field.value);
    if (value.trim()) lines.push(`${field.label}：${value}`);
  }
  return lines.join("\n");
}

function migrateExperience(experience: Experience): ResumeItemV2 {
  const common = { id: experience.id, startDate: experience.startDate, endDate: experience.endDate, location: experience.location, customFields: [] };
  switch (experience.type) {
    case "education": return { ...common, sectionType: "education", school: experience.organization, degree: experience.role, major: experience.major, courses: experience.courses ?? [], honors: [], highlights: [], current: false };
    case "internship": return { ...common, sectionType: "internship", organization: experience.organization, role: experience.role, highlights: [], current: false };
    case "project": return { id: experience.id, sectionType: "project", title: experience.organization, role: experience.role, location: experience.location, startDate: experience.startDate, endDate: experience.endDate, current: false, tools: [], highlights: [], outcomes: [], customFields: [] };
    case "competition": return { id: experience.id, sectionType: "awards", name: experience.role, issuer: experience.organization, customFields: [] };
    case "campus": return { ...common, sectionType: "campus", organization: experience.organization, role: experience.role, highlights: [], current: false };
    case "volunteer": return { ...common, sectionType: "volunteer", organization: experience.organization, role: experience.role, highlights: [], current: false };
    case "work": return { ...common, sectionType: "work", organization: experience.organization, role: experience.role, highlights: [], current: false };
    default: return { id: experience.id, sectionType: "other", title: experience.organization, description: experience.role, highlights: [], customFields: [] };
  }
}

function legacyBranchData(item: BranchContentItem): ResumeItemV2 {
  const base = { id: item.id, description: item.text, highlights: [], customFields: [] };
  if (item.itemType === "summary") return { id: item.id, sectionType: "summary", text: item.text, customFields: [] };
  switch (item.sourceSectionId) {
    case "education": return { ...base, sectionType: "education", courses: [], honors: [], current: false };
    case "experience": return { ...base, sectionType: "work", current: false };
    case "work": return { ...base, sectionType: "work", current: false };
    case "internship": return { ...base, sectionType: "internship", current: false };
    case "projects":
    case "project": return { ...base, sectionType: "project", current: false, tools: [], outcomes: [] };
    case "campus": return { ...base, sectionType: "campus", current: false };
    case "volunteer": return { ...base, sectionType: "volunteer", current: false };
    case "research": return { ...base, sectionType: "research", title: item.text, methods: [], current: false };
    case "awards": return { id: item.id, sectionType: "awards", name: item.text, customFields: [] };
    case "skills": return { id: item.id, sectionType: "skills", name: item.text, customFields: [] };
    case "certificates": return { id: item.id, sectionType: "certificates", name: item.text, customFields: [] };
    case "language":
    case "languages": return { id: item.id, sectionType: "languages", language: item.text, customFields: [] };
    case "publications": return { id: item.id, sectionType: "publications", title: item.text, authors: [], customFields: [] };
    case "patents": return { id: item.id, sectionType: "patents", title: item.text, inventors: [], customFields: [] };
    case "portfolio": return { ...base, sectionType: "portfolio", title: item.text, tools: [] };
    case "custom": return { ...base, sectionType: "custom" };
    default: return { ...base, sectionType: "other" };
  }
}
