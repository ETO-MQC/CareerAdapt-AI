import { canonicalProfileBasics, canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import type { CareerProfile } from "@/domain/schemas";

export type ProfileContentCounts = {
  basicFieldCount: number;
  careerItemCount: number;
  confirmedFactCount: number;
  resumeCount: number;
};

/**
 * The profile UI and model preflight use the same vocabulary. In particular,
 * a name is one basic field; it must never be rendered as an empty profile.
 */
export function countProfileContent(profile: CareerProfile, resumeCount = 0): ProfileContentCounts {
  const basics = canonicalProfileBasics(profile);
  const basicFieldValues: unknown[] = [
    basics.name,
    basics.headline,
    basics.phone,
    basics.email,
    basics.location,
    basics.summary,
    ...(basics.otherLinks ?? [])
  ];
  const basicFieldCount = basicFieldValues.filter((value) => typeof value === "string" && value.trim().length > 0).length;
  const items = canonicalProfileLibraryItems(profile);
  const careerItemCount = items.filter((item) => item.sectionType !== "summary").length;
  const confirmedFactIds = new Set<string>();
  for (const item of items) {
    for (const factId of item.factIds) confirmedFactIds.add(factId);
  }
  return {
    basicFieldCount,
    careerItemCount,
    confirmedFactCount: confirmedFactIds.size,
    resumeCount
  };
}

export function profileCountSummary(counts: Pick<ProfileContentCounts, "careerItemCount" | "basicFieldCount">) {
  return `${counts.careerItemCount} 条经历 · ${counts.basicFieldCount} 项基础信息`;
}
