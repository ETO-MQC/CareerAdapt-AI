import { describe, expect, it } from "vitest";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiSuggestionSchema,
  CareerProfileSchema,
  FactStatementSchema,
  JobDescriptionSchema,
  ResumeBranchSchema,
  type ResumeBranch
} from "@/domain/schemas";

const TEST_TIME = "2026-07-01T10:00:00.000Z";

describe("stage A schemas", () => {
  it("validates the fixed demo profile and demo jobs", () => {
    expect(CareerProfileSchema.safeParse(demoCareerProfile).success).toBe(true);

    for (const job of demoJobDescriptions) {
      expect(JobDescriptionSchema.safeParse(job).success).toBe(true);
    }
  });

  it("requires provenance for facts that can enter resume output", () => {
    const result = FactStatementSchema.safeParse({
      id: "fact-without-provenance",
      statement: "缺少来源的事实不应进入核心数据。",
      category: "experience",
      provenance: [],
      confirmedByUser: false,
      riskLevel: "high",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    expect(result.success).toBe(false);
  });

  it("validates a minimal resume branch and AI suggestion", () => {
    const branch: ResumeBranch = {
      id: "branch-stage-a",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "数据分析实习生 - 阶段A",
      selectedItems: [
        {
          experienceId: demoCareerProfile.experiences[0].id,
          draftId: demoCareerProfile.experiences[0].resumeDrafts[0].id,
          order: 0,
          visible: true
        }
      ],
      customTexts: [],
      templateId: "a4-probe",
      templateConfig: {
        templateId: "a4-probe",
        fontScale: 1,
        density: "comfortable"
      },
      currentRevisionId: "revision-stage-a",
      profileVersion: demoCareerProfile.version,
      requirementMatches: [],
      aiSuggestions: [],
      revisions: [
        {
          id: "revision-stage-a",
          branchId: "branch-stage-a",
          snapshot: { selectedItems: ["exp-stat-modeling"] },
          source: "template_probe",
          createdAt: TEST_TIME,
          updatedAt: TEST_TIME
        }
      ],
      exportRecords: [],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const suggestion = {
      id: "suggestion-stage-a",
      draftId: "adaptation-draft-stage-a",
      targetSectionId: "section-stage-a",
      type: "rewrite",
      originalText: "使用 Stata 做分析。",
      suggestedText: "使用 Stata 清洗 31 个省级样本并完成统计分析。",
      reason: "突出已确认的工具、样本规模和分析任务。",
      requirementIds: [demoJobDescriptions[0].requirements[0].id],
      usedEvidenceRefs: [
        {
          type: "experience_fact",
          experienceId: demoCareerProfile.experiences[0].id,
          factId: demoCareerProfile.experiences[0].facts[0].id,
          factQuote: demoCareerProfile.experiences[0].facts[0].provenance[0].sourceText,
          factText: demoCareerProfile.experiences[0].facts[0].statement
        }
      ],
      guardResult: {
        status: "pass",
        ruleFindings: [],
        riskLevel: "low",
        allowedEvidenceRefs: [
          {
            type: "experience_fact",
            experienceId: demoCareerProfile.experiences[0].id,
            factId: demoCareerProfile.experiences[0].facts[0].id,
            factQuote: demoCareerProfile.experiences[0].facts[0].provenance[0].sourceText,
            factText: demoCareerProfile.experiences[0].facts[0].statement
          }
        ],
        checkedText: "使用 Stata 清洗 31 个省级样本并完成统计分析。",
        checkedAt: TEST_TIME,
        guardVersion: "fact-guard-rule.v1"
      },
      riskLevel: "low",
      status: "pending_review",
      promptVersion: "resume-tailor.v1",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    expect(ResumeBranchSchema.safeParse(branch).success).toBe(true);
    expect(AiSuggestionSchema.safeParse(suggestion).success).toBe(true);
  });
});
