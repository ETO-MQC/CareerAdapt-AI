import { CareerProfileSchema, type CareerProfile, type Certificate, type Experience, type Skill } from "@/domain/schemas";
import { migrateCareerProfileToV2 } from "@/domain/migrations/resumeV2";

export const PROFILE_JSON_EXPORT_FORMAT = "careeradapt-profile-export-v1" as const;

export type ProfileJsonArchive = {
  experiences: Experience[];
  certificates: Certificate[];
  skills: Skill[];
  customBlocks: Array<{
    id: string;
    text: string;
    createdAt: string;
    updatedAt: string;
  }>;
};

export function buildProfileJsonExport(input: {
  profile: CareerProfile;
  archive: ProfileJsonArchive;
  exportedAt: string;
}) {
  return {
    format: PROFILE_JSON_EXPORT_FORMAT,
    exportedAt: input.exportedAt,
    profile: migrateCareerProfileToV2(CareerProfileSchema.parse(input.profile)),
    archive: {
      experiences: input.archive.experiences,
      certificates: input.archive.certificates,
      skills: input.archive.skills,
      customBlocks: input.archive.customBlocks
    }
  };
}

export function profileJsonExportFileName(profile: Pick<CareerProfile, "name" | "id">, date: string) {
  const safeName = profile.name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || profile.id;
  return `careeradapt-profile-${safeName}-${date}.json`;
}
