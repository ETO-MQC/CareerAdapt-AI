import { describe, expect, it } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  buildProfileJsonExport,
  PROFILE_JSON_EXPORT_FORMAT,
  profileJsonExportFileName
} from "@/services/export/profileJson";

describe("profile JSON export", () => {
  it("exports one complete CareerProfile with its person-scoped archive", () => {
    const archivedSkill = structuredClone(demoCareerProfile.skills[0]);
    const payload = buildProfileJsonExport({
      profile: demoCareerProfile,
      archive: {
        experiences: [],
        certificates: [],
        skills: [archivedSkill],
        customBlocks: [{
          id: "archived-custom-1",
          text: "归档调试资料",
          createdAt: "2026-07-28T10:00:00.000Z",
          updatedAt: "2026-07-28T10:00:00.000Z"
        }]
      },
      exportedAt: "2026-07-28T12:00:00.000Z"
    });

    expect(payload).toMatchObject({
      format: PROFILE_JSON_EXPORT_FORMAT,
      exportedAt: "2026-07-28T12:00:00.000Z",
      profile: {
        id: demoCareerProfile.id,
        version: demoCareerProfile.version,
        schemaVersion: "career-profile-v2",
        structuredBasics: expect.any(Object),
        structuredFacts: expect.any(Array)
      },
      archive: {
        skills: [archivedSkill],
        customBlocks: [expect.objectContaining({ id: "archived-custom-1" })]
      }
    });
    expect(payload).not.toHaveProperty("resumes");
    expect(payload).not.toHaveProperty("jobs");
    expect(payload).not.toHaveProperty("agentSessions");
  });

  it("builds a filesystem-safe, person-specific filename", () => {
    expect(profileJsonExportFileName(
      { id: "profile-1", name: "小明 / 测试:*?" },
      "2026-07-28"
    )).toBe("careeradapt-profile-小明-测试-2026-07-28.json");
  });
});
