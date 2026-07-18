import { migrateCareerProfileToV2, projectResumeItemV2 } from "@/domain/migrations/resumeV2";
import { resumeSectionCatalog } from "@/domain/resumeFields";
import type { CareerProfile, ResumeItemV2 } from "@/domain/schemas";

export const profileSectionCatalog = resumeSectionCatalog;

export type CanonicalProfileLibraryItem = {
  id: string;
  sectionType: ResumeItemV2["sectionType"];
  title: string;
  subtitle: string;
  body: string;
  factIds: string[];
  data: ResumeItemV2;
};

export function canonicalProfileBasics(profile: CareerProfile) {
  return migrateCareerProfileToV2(profile).structuredBasics;
}

export function canonicalProfileLibraryItems(profile: CareerProfile): CanonicalProfileLibraryItem[] {
  return migrateCareerProfileToV2(profile).structuredFacts.map((entry) => ({
    id: entry.data.id,
    sectionType: entry.data.sectionType,
    title: canonicalItemTitle(entry.data),
    subtitle: canonicalItemSubtitle(entry.data),
    body: projectResumeItemV2(entry.data),
    factIds: entry.factIds,
    data: entry.data
  }));
}

export function canonicalProfileSectionCounts(profile: CareerProfile) {
  const counts = new Map(profileSectionCatalog.map((section) => [section.id, 0]));
  counts.set("basics", canonicalProfileBasics(profile).name ? 1 : 0);
  for (const item of canonicalProfileLibraryItems(profile)) {
    counts.set(item.sectionType, (counts.get(item.sectionType) ?? 0) + 1);
  }
  return counts;
}

function canonicalItemTitle(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return firstText(record, ["title", "name", "organization", "school", "institution", "language", "text"])
    ?? resumeSectionCatalog.find((section) => section.id === item.sectionType)?.label
    ?? item.sectionType;
}

function canonicalItemSubtitle(item: ResumeItemV2) {
  const record = item as unknown as Record<string, unknown>;
  return firstText(record, ["role", "degree", "issuer", "authorRole", "publisher", "level", "type"]) ?? "";
}

function firstText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}
