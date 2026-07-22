import { describe, expect, it } from "vitest";
import { buildRetryPrompt } from "@/ai/retryPrompt";

describe("structured AI retry prompts", () => {
  it("uses the compact JD contract without resume suggestions", () => {
    const prompt = buildRetryPrompt({ task: "jd-analyzer", baseUserPrompt: "JD", failure: "missing_source_units", input: { sourceUnits: [{ id: "unit-1" }] } });
    expect(prompt).toContain("unitAssignments");
    expect(prompt).toContain("unit-1");
    expect(prompt).not.toContain("suggestions");
  });

  it("keeps the resume-tailor suggestions retry contract", () => {
    const prompt = buildRetryPrompt({ task: "resume-tailor", baseUserPrompt: "resume", failure: "resume_tailor_after_missing" });
    expect(prompt).toContain('"suggestions"');
  });
});
