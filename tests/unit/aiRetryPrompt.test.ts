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

  it("repairs profile intake evidence without weakening the candidate-local boundary", () => {
    const prompt = buildRetryPrompt({
      task: "profile-intake-semantic",
      baseUserPrompt: "profile narrative",
      failure: "profile_intake_field_source_outside_candidate"
    });
    expect(prompt).toContain("every fieldEvidence.sourceQuote");
    expect(prompt).toContain("exactly the same substring");
    expect(prompt).toContain("split it into another candidate or omit");
    expect(prompt).toContain("Never output null");
    expect(prompt).not.toContain('"suggestions"');
  });
});
