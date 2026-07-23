import { describe, expect, it } from "vitest";
import { demoJobDescriptions } from "@/data/demoJobs";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  AiSuggestionSchema,
  CareerProfileSchema,
  CommittedJobDescriptionSchema,
  FactStatementSchema,
  JobDescriptionSchema,
  ResumeBranchSchema,
  type ResumeBranch
} from "@/domain/schemas";

const TEST_TIME = "2026-07-01T10:00:00.000Z";

describe("core schemas", () => {
  it("validates the fixed demo profile and demo jobs", () => {
    expect(CareerProfileSchema.safeParse(demoCareerProfile).success).toBe(true);

    for (const job of demoJobDescriptions) {
      expect(JobDescriptionSchema.safeParse(job).success).toBe(true);
    }
  });

  it("requires at least one requirement for a formal job save", () => {
    expect(CommittedJobDescriptionSchema.safeParse({
      ...demoJobDescriptions[0],
      requirements: []
    }).success).toBe(false);
  });

  it("requires provenance for facts that can enter resume output", () => {
    const result = FactStatementSchema.safeParse({
      id: "fact-without-provenance",
      statement: "Facts without provenance must not enter core data.",
      category: "experience",
      provenance: [],
      confirmedByUser: false,
      riskLevel: "high",
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    });

    expect(result.success).toBe(false);
  });

  it("validates a formal D1 resume branch and AI suggestion", () => {
    const branch: ResumeBranch = {
      id: "branch-stage-d1",
      branchPurpose: "job_specific",
      profileId: demoCareerProfile.id,
      jobId: demoJobDescriptions[0].id,
      name: "schema test branch",
      sourceProfileVersion: demoCareerProfile.version,
      sourceJobVersion: demoJobDescriptions[0].updatedAt,
      sourceAdaptationDraftId: "adaptation-draft-stage-a",
      sourceDraftRevision: 0,
      matcherVersion: "evidence-matcher.v1",
      sourceMatchSetHash: "schema-test-hash",
      requirementMatchIds: ["match-schema-test"],
      revision: 0,
      currentRevisionId: "revision-stage-d1",
      tailoringAppliedCount: 0,
      lifecycleStatus: "active",
      migrationStatus: "verified",
      syncStatusCache: {
        status: "in_sync",
        sourceProfileVersion: demoCareerProfile.version,
        currentProfileVersion: demoCareerProfile.version,
        sourceJobVersion: demoJobDescriptions[0].updatedAt,
        currentJobVersion: demoJobDescriptions[0].updatedAt,
        invalidFactRefs: [],
        checkedAt: TEST_TIME,
        message: "Branch is in sync with its source profile and job versions."
      },
      contentItems: [
        {
          id: "branch-item-stage-d1",
          itemType: "experience",
          source: "adaptation_draft",
          sourceSectionId: "section-stage-a",
          text: demoCareerProfile.experiences[0].facts[0].statement,
          originalText: demoCareerProfile.experiences[0].facts[0].statement,
          order: 0,
          visible: true,
          requirementIds: [demoJobDescriptions[0].requirements[0].id],
          sourceSuggestionIds: [],
          factRefs: [
            {
              type: "experience_fact",
              experienceId: demoCareerProfile.experiences[0].id,
              factId: demoCareerProfile.experiences[0].facts[0].id
            }
          ],
          guardMode: "rule_verified",
          guardStatus: "pass",
          guardRiskLevel: "low",
          guardFindings: [],
          guardedAt: TEST_TIME,
          guardVersion: "fact-guard-rule.v1"
        }
      ],
      createdAt: TEST_TIME,
      updatedAt: TEST_TIME
    };

    const suggestion = {
      id: "suggestion-stage-a",
      draftId: "adaptation-draft-stage-a",
      targetSectionId: "section-stage-a",
      type: "rewrite",
      originalText: "Use Stata for analysis.",
      suggestedText: "Use Stata to clean confirmed samples and complete statistical analysis.",
      reason: "Keep the wording grounded in confirmed facts.",
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
        checkedText: "Use Stata to clean confirmed samples and complete statistical analysis.",
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
