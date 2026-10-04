import { describe, expect, it } from "vitest";
import {
  RESUME_FOCUS_AREA_LABELS,
  RESUME_TONE_STYLE_LABELS,
  ResumeCompositionPreferencesSchema,
  parseUserPreferences,
  renderCompositionPreferenceDirectives,
  userPreferenceRejectionReason
} from "@/domain/resumeComposition/ResumeCompositionPreferences";
import { resumeCareerWriterPrompt } from "@/ai/prompts/resumeCareerWriter";
import { promptVersions } from "@/ai/prompts/versions";

describe("resume composition user preferences", () => {
  it("accepts only the closed preference keys", () => {
    expect(ResumeCompositionPreferencesSchema.safeParse({ toneStyle: "technical" }).success).toBe(true);
    expect(ResumeCompositionPreferencesSchema.safeParse({ toneStyle: "poetic" }).success).toBe(false);
    expect(ResumeCompositionPreferencesSchema.safeParse({ favouriteColour: "blue" }).success).toBe(false);
    expect(ResumeCompositionPreferencesSchema.safeParse({}).success).toBe(true);
    expect(ResumeCompositionPreferencesSchema.safeParse({ focusAreas: ["management", "management"] }).success).toBe(true);
    expect(ResumeCompositionPreferencesSchema.safeParse({ focusAreas: ["management", "innovation", "collaboration", "technical_depth", "innovation"] }).success).toBe(false);
  });

  it("explains an unknown key instead of dropping it silently", () => {
    expect(userPreferenceRejectionReason({ toneStyle: "technical" })).toBeUndefined();
    expect(userPreferenceRejectionReason(undefined)).toBeUndefined();
    expect(userPreferenceRejectionReason({})).toBeUndefined();
    expect(userPreferenceRejectionReason({ nickname: "x" })).toBe("user_preferences_unknown_key:nickname");
    expect(userPreferenceRejectionReason({ toneStyle: "poetic" })).toBe("user_preferences_invalid");
    expect(userPreferenceRejectionReason("nope")).toBe("user_preferences_invalid");
  });

  it("treats absent and malformed preferences differently", () => {
    expect(parseUserPreferences(undefined)).toBeUndefined();
    expect(parseUserPreferences(null)).toBeUndefined();
    expect(parseUserPreferences({ toneStyle: "plain" })).toEqual({ toneStyle: "plain" });
    expect(parseUserPreferences({ toneStyle: "poetic" })).toBeUndefined();
  });

  it("renders every supported preference into a writer directive", () => {
    const directives = renderCompositionPreferenceDirectives({
      toneStyle: "business",
      focusAreas: ["quantified_results", "project_impact"],
      audience: "互联网大厂产品岗",
      avoidJargon: true
    });

    expect(directives).toHaveLength(4);
    expect(directives.join("\n")).toContain(RESUME_TONE_STYLE_LABELS.business);
    expect(directives.join("\n")).toContain(RESUME_FOCUS_AREA_LABELS.quantified_results);
    expect(directives.join("\n")).toContain("互联网大厂产品岗");
    expect(directives.join("\n")).toContain("术语");
  });

  it("states in every directive that it may not add facts", () => {
    const directives = renderCompositionPreferenceDirectives({ toneStyle: "technical", focusAreas: ["innovation"], audience: "研究岗" });
    expect(directives).toHaveLength(3);
    for (const directive of directives) {
      expect(directive).toMatch(/不得|只能|仍然只能|据此调整/);
    }
  });

  it("produces no directives when no preference is supplied", () => {
    expect(renderCompositionPreferenceDirectives(undefined)).toEqual([]);
    expect(renderCompositionPreferenceDirectives({})).toEqual([]);
  });

  it("tells the writer prompt about the preference channel", () => {
    expect(resumeCareerWriterPrompt.system).toContain("writingPreferenceDirectives");
    expect(resumeCareerWriterPrompt.system).toContain("never as Profile facts");
    expect(promptVersions.resumeCareerWriter).toBe("resume-career-writer.v5-user-preferences");
  });
});
