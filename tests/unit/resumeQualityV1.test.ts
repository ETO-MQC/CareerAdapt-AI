import { describe, expect, it } from "vitest";
import {
  CareerResumeQualityPolicyV1,
  careerResumeQualityWarnings
} from "@/domain/resumeComposition/CareerResumeQualityPolicyV1";

describe("Career Resume Quality V1", () => {
  it("exposes the accomplishment-first policy and flags generic or repeated writing", () => {
    expect(CareerResumeQualityPolicyV1.id).toBe("career-resume-quality-v1");
    expect(CareerResumeQualityPolicyV1.principles).toContain("accomplishment_first");

    const warnings = careerResumeQualityWarnings({
      summary: "积极主动，责任心强，热爱技术。",
      bullets: ["负责系统开发。", "负责系统开发。"]
    });

    expect(warnings).toEqual(expect.arrayContaining([
      CareerResumeQualityPolicyV1.reviewerWarnings.genericSummary,
      CareerResumeQualityPolicyV1.reviewerWarnings.repeatedContent
    ]));
  });
});
