import { describe, expect, it } from "vitest";
import { buildCareerInteractionPlan, scoreCareerInformationNeed } from "@/domain/careerInteraction/CareerInteractionPlan";
import {
  assessCareerAssetCompleteness,
  createProfileIntakeInterviewPlan,
  highestValueFollowUpDetail
} from "@/domain/profileIntake/ProfileIntakeCompleteness";
import { buildProfileIntakeInteractionPlan } from "@/domain/profileIntake/ProfileIntakeInteractionProjection";
import { ProjectItemV2Schema } from "@/domain/schemas/resumeV2";

describe("P4.5a Career Interaction Plan", () => {
  it("ranks expected information value instead of empty-field coverage", () => {
    const substantialProject = ProjectItemV2Schema.parse({
      id: "project-smart-fox",
      sectionType: "project",
      title: "Smart Fox",
      role: "主要负责开发",
      description: "实现任务四象限和提醒流程，使用 TypeScript 完成可运行原型。",
      tools: ["TypeScript"],
      outcomes: ["完成可运行原型"],
      highlights: [],
      current: false,
      customFields: []
    });
    const thinProject = ProjectItemV2Schema.parse({
      id: "project-thin",
      sectionType: "project",
      title: "课程作业",
      role: "参与者",
      description: "参与课程项目。",
      tools: [],
      outcomes: [],
      highlights: [],
      current: false,
      customFields: []
    });

    const complete = assessCareerAssetCompleteness(substantialProject);
    expect(complete.readiness).toBeGreaterThanOrEqual(0.75);
    expect(highestValueFollowUpDetail([substantialProject], { followUpCounts: { [substantialProject.id]: 0 } })).toBeUndefined();

    const next = highestValueFollowUpDetail([substantialProject, thinProject], { followUpCounts: { [substantialProject.id]: 0, [thinProject.id]: 0 } });
    expect(next?.item.id).toBe("project-thin");
    expect(next?.dimension).toBe("result");
    expect(next?.question).toContain("课程作业");
    expect(next?.question).not.toMatch(/outcomes|scope|schema/iu);
  });

  it("does not ask an answered or skipped dimension again and exposes asset state", () => {
    const project = ProjectItemV2Schema.parse({
      id: "project-answer-ledger",
      sectionType: "project",
      title: "Data Tool",
      role: "参与",
      description: "参与数据处理项目。",
      tools: [],
      outcomes: [],
      highlights: [],
      current: false,
      customFields: []
    });
    const answered = {
      questionId: "q-result",
      candidateId: project.id,
      dimension: "result",
      sourceTurnId: "turn-2",
      answerRevision: 1,
      status: "skipped" as const,
      capturedAt: "2026-08-10T00:00:00.000Z"
    };
    const interviewPlan = createProfileIntakeInterviewPlan([project], 2, {
      followUpCounts: { [project.id]: 1 },
      questionAnswers: [answered]
    });
    expect(interviewPlan.careerAssetState[0]).toMatchObject({
      candidateId: project.id,
      questionBudget: 1,
      skippedDimensions: ["result"],
      interviewStatus: "enriching"
    });
    expect(interviewPlan.activeQuestion?.dimension).not.toBe("result");

    const interactionPlan = buildProfileIntakeInteractionPlan({
      items: [project],
      interviewPlan,
      options: { questionAnswers: [answered], followUpCounts: { [project.id]: 1 } }
    });
    expect(interactionPlan.knownContext).toBeDefined();
    expect(interactionPlan.informationNeeds.some((need) => need.alreadyAsked)).toBe(true);
  });

  it("uses a single question and can proceed conservatively", () => {
    const plan = buildCareerInteractionPlan({
      workflow: "job-fit",
      objective: "分析岗位匹配",
      informationNeeds: [{
        id: "sql-evidence",
        type: "factual_gap",
        dimension: "applied_sql",
        importance: 0.8,
        reason: "你是否在某个项目中实际使用过 SQL？",
        answerChangesOutcome: true,
        required: false,
        alreadyAsked: false,
        priorityFactors: { expectedArtifactImpact: 1, jobRelevance: 1 }
      }, {
        id: "optional-location",
        type: "optional_enrichment",
        dimension: "location",
        importance: 0.2,
        reason: "工作地点偏好是什么？",
        answerChangesOutcome: false,
        required: false,
        alreadyAsked: false
      }],
      canProceedWithoutQuestion: true
    });
    expect(plan.recommendedNextQuestion?.needId).toBe("sql-evidence");
    expect(plan.canProceedWithoutQuestion).toBe(true);
    expect(scoreCareerInformationNeed({
      answerChangesOutcome: false,
      required: false,
      importance: 1,
      priorityFactors: { expectedArtifactImpact: 1 }
    })).toBe(0);
  });
});
