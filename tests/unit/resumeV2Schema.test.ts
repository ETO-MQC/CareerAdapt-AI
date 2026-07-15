import { describe, expect, it } from "vitest";
import { CustomFieldValueSchema, ResumeItemV2Schema } from "@/domain/schemas";

describe("resume item schema v2", () => {
  it("keeps work and internship as distinct discriminators", () => {
    expect(ResumeItemV2Schema.parse({ id: "w1", sectionType: "work", organization: "甲公司", role: "工程师" }).sectionType).toBe("work");
    expect(ResumeItemV2Schema.parse({ id: "i1", sectionType: "internship", organization: "乙公司", role: "实习生" }).sectionType).toBe("internship");
  });

  it("enforces education cross-field constraints", () => {
    expect(ResumeItemV2Schema.safeParse({ id: "e1", sectionType: "education", school: "大学", gpa: 4.2, gpaScale: 4 }).success).toBe(false);
    expect(ResumeItemV2Schema.safeParse({ id: "e1", sectionType: "education", school: "大学", rankPosition: 8, rankTotal: 5 }).success).toBe(false);
    expect(ResumeItemV2Schema.safeParse({ id: "e1", sectionType: "education", school: "大学", current: true, endDate: "2026-06" }).success).toBe(false);
  });

  it("rejects unknown professional fields and type-invalid custom values", () => {
    expect(ResumeItemV2Schema.safeParse({ id: "s1", sectionType: "skills", name: "TypeScript", invented: true }).success).toBe(false);
    expect(CustomFieldValueSchema.safeParse({ id: "cf1", label: "作品数", valueType: "number", value: "3", order: 0 }).success).toBe(false);
  });
});
