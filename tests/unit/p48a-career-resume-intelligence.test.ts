import { describe, expect, it } from "vitest";
import {
  FactStatementSchema,
  ResumeItemV2Schema,
  ResumeTailoringPlanSchema,
  resolveTailoringMode,
  type FactStatement,
  type JobDescription,
  type ResumeBranch,
  type ResumeTailorTaskInputV2
} from "@/domain/schemas";
import {
  buildClarificationQuestions,
  answerTailoringClarification,
  createTailoringQuestionPlan
} from "@/services/jobs/tailoringService";
import { buildCareerExperienceReview, buildCareerFactBullets } from "@/domain/profileIntake/CareerFactBullets";
import { factMaturityOf, maturityForTailoringAnswer } from "@/domain/profile/factMaturity";
import { careerResumeQualityWarnings } from "@/domain/resumeComposition/CareerResumeQualityPolicyV1";
import { resolveTailoringClaimPolicy } from "@/domain/jobOptimization/tailoringClaimPolicy";
import { runRuleFactGuard } from "@/domain/adaptation/factGuard";

const NOW = "2026-09-10T00:00:00.000Z";

describe("P4.8a career resume intelligence", () => {
  it("keeps demonstrated, confirmed, familiar, and learning evidence distinct", () => {
    const demonstrated = makeFact({ id: "fact-demonstrated", category: "experience", maturity: "demonstrated" });
    const confirmed = makeFact({ id: "fact-confirmed", category: "skill", maturity: "confirmed_capability" });
    const familiar = makeFact({ id: "fact-familiar", category: "skill", maturity: "familiar" });
    const learning = makeFact({ id: "fact-learning", category: "skill", maturity: "learning" });

    expect([demonstrated, confirmed, familiar, learning].map((fact) => factMaturityOf(fact))).toEqual([
      "demonstrated", "confirmed_capability", "familiar", "learning"
    ]);
    expect(maturityForTailoringAnswer("实际做过")).toBe("confirmed_capability");
    expect(maturityForTailoringAnswer("接触 / 学习过")).toBe("familiar");
    expect(maturityForTailoringAnswer("正在学习")).toBe("learning");
    expect(maturityForTailoringAnswer("没有使用过")).toBeUndefined();
  });

  it("projects legacy facts from their confirmation and source contract without migrating them", () => {
    const legacyExperience = makeFact({ category: "experience", maturity: undefined });
    const legacyLanguage = makeFact({ category: "language", maturity: undefined });
    const unconfirmed = makeFact({
      maturity: undefined,
      confirmedByUser: false,
      provenance: legacyExperience.provenance.map((source) => ({ ...source, confirmedByUser: false }))
    });

    expect(factMaturityOf(legacyExperience)).toBe("demonstrated");
    expect(factMaturityOf(legacyLanguage)).toBe("confirmed_capability");
    expect(factMaturityOf(unconfirmed, "familiar")).toBe("familiar");
    expect(legacyExperience.maturity).toBeUndefined();
  });

  it("builds at most four exact, reusable confirmed fact bullets without project provenance", () => {
    const item = ResumeItemV2Schema.parse({
      id: "project-1",
      sectionType: "project",
      title: "模型评估项目",
      role: "开发者",
      description: "完成模型输出评估与结果核验。"
    });
    const facts = [
      makeFact({ id: "fact-1", statement: "使用 RAG 评估模型输出。", category: "skill", maturity: "confirmed_capability" }),
      makeFact({ id: "fact-2", statement: "完成结果核验并记录复盘。", category: "experience" }),
      makeFact({ id: "fact-3", statement: "与后端协作交付测试工具。", category: "experience" }),
      makeFact({ id: "fact-4", statement: "补充一条可复用的用户确认事实。", category: "experience" }),
      makeFact({ id: "fact-5", statement: "这条事实不应超过四条。", category: "experience" })
    ];

    const bullets = buildCareerFactBullets({ item, facts });
    expect(bullets).toHaveLength(4);
    expect(bullets.map((bullet) => bullet.text)).toEqual(facts.slice(0, 4).map((fact) => fact.statement.replace(/[。！？!?；;]+$/u, "")));
    expect(bullets[0]).toMatchObject({ maturity: "confirmed_capability", evidenceStatus: "confirmed" });
    expect(bullets[0].sourceQuotes).toContain(facts[0].statement);

    const review = buildCareerExperienceReview({ item, facts });
    expect(review.reviewState).toBe("ready_for_confirmation");
    expect(review.bullets).toHaveLength(4);
    expect(review.missingDimensions).toEqual(expect.any(Array));
  });

  it("uses explicit mode semantics and freezes a bounded question budget", () => {
    const questions = buildClarificationQuestions({ job: fixtureJob(), taskInputs: fixtureTaskInputs(), mode: "max_fit" });
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(3);
    const question = questions.find((candidate) => candidate.answerType === "single_select");
    expect(question).toBeDefined();
    expect(question?.mode).toBe("max_fit");
    expect(question?.options?.map((option) => option.label)).toEqual([
      "实际做过",
      "能够独立完成基础任务",
      "接触 / 学习过",
      "没有使用过",
      "不确定",
      "跳过"
    ]);
    expect(createTailoringQuestionPlan({ sessionId: "steady", questions, mode: "steady", now: NOW }).questionIds).toEqual([]);
    expect(createTailoringQuestionPlan({ sessionId: "competitive", questions, mode: "competitive", now: NOW }).questionIds).toHaveLength(1);
    const maxFitPlan = createTailoringQuestionPlan({ sessionId: "max-fit", questions, mode: "max_fit", now: NOW });
    expect(maxFitPlan.maximumBudget).toBe(3);
    expect(maxFitPlan.questionIds.length).toBeLessThanOrEqual(3);
    expect(resolveTailoringMode({ intensity: "proactive" })).toBe("max_fit");
    expect(() => resolveTailoringMode({ mode: "max_fit", intensity: "conservative" })).toThrow("tailoring_mode_intensity_conflict");
  });

  it("keeps a high-value missing dimension visible while allowing an incomplete review to finish", () => {
    const item = ResumeItemV2Schema.parse({
      id: "project-missing-tools",
      sectionType: "project",
      title: "模型评估项目",
      role: "项目成员"
    });
    const review = buildCareerExperienceReview({
      item,
      facts: [makeFact({ statement: "完成模型评估并形成评估报告。", category: "experience", maturity: undefined })]
    });

    expect(review.bullets).toHaveLength(1);
    expect(review.reviewState).toBe("needs_more_detail");
    expect(review.missingDimensions).toContain("tools_methods");
    expect(review.nextQuestion).toContain("工具");
  });

  it("records a max-fit answer as bounded resume-only evidence instead of copying the option text", () => {
    const questions = buildClarificationQuestions({ job: fixtureJob(), taskInputs: fixtureTaskInputs(), mode: "max_fit" });
    const question = questions.find((candidate) => candidate.answerType === "single_select");
    expect(question).toBeDefined();
    const questionPlan = createTailoringQuestionPlan({ sessionId: "answer", questions: [question!], mode: "max_fit", now: NOW });
    const plan = ResumeTailoringPlanSchema.parse({
      id: "plan-max-fit",
      branchId: "branch-1",
      jobId: "job-1",
      intensity: "proactive",
      mode: "max_fit",
      basedOnBranchRevision: 1,
      claims: [],
      clarificationQuestions: [question],
      questionPlan,
      estimatedFitScore: 40,
      createdAt: NOW
    });
    const answered = answerTailoringClarification({
      plan,
      question: question!,
      answer: "实际做过",
      branch: fixtureBranch(),
      operationId: "answer-max-fit",
      now: NOW
    });
    expect(answered.claims[0]).toMatchObject({
      maturity: "confirmed_capability",
      decision: "requires_confirmation",
      syncScope: "resume_only"
    });
    expect(answered.claims[0].proposedText).not.toContain("实际做过");
    expect(answered.clarificationAnswers?.[0]).toMatchObject({ maturity: "confirmed_capability" });
  });

  it("keeps hard fact findings blocking even when a claim is user-confirmed", () => {
    const guardResult = runRuleFactGuard({
      originalText: "参与模型评估",
      checkedText: "主导模型评估并提升 30%",
      usedEvidenceRefs: [],
      now: NOW
    });
    const policy = resolveTailoringClaimPolicy({
      suggestion: { claimSupportLevel: "user_declared", targetKeywords: ["模型评估"] },
      guardResult,
      sectionType: "project",
      intensity: "proactive",
      maturity: "confirmed_capability"
    });
    expect(policy.decision).toBe("blocked");
    expect(policy.claimClass).toBe("unsupported_hard_fact");
    expect(policy.blockingFindings.map((finding) => finding.type)).toEqual(expect.arrayContaining(["new_number", "participation_to_owner"]));
  });

  it("flags mechanical or empty-adjective resume wording for human review", () => {
    const warnings = careerResumeQualityWarnings({
      summary: "具备良好的沟通能力和学习能力。",
      bullets: [
        "基于岗位需求完成任务。",
        "围绕业务目标实现优化。",
        "具备较强的综合能力。"
      ]
    });
    expect(warnings).toEqual(expect.arrayContaining([
      "resume_quality.summary_generic",
      "resume_quality.mechanical_ai_wording",
      "resume_quality.empty_adjective"
    ]));
  });
});

function makeFact(overrides: Partial<FactStatement> = {}): FactStatement {
  const statement = overrides.statement ?? "用户确认的事实表述";
  return FactStatementSchema.parse({
    id: "fact-default",
    statement,
    category: "experience",
    provenance: [{
      sourceType: "user_input",
      sourceId: "turn-1",
      sourceText: statement,
      sourceQuote: statement,
      confidence: 1,
      confirmedByUser: true,
      riskLevel: "low",
      createdAt: NOW
    }],
    confirmedByUser: true,
    riskLevel: "low",
    maturity: "demonstrated",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  });
}

function fixtureJob(): JobDescription {
  return {
    id: "job-1",
    title: "AI 软件工程师",
    company: "目标公司",
    rawText: "AI 软件工程师\n使用 Python 完成接口开发。",
    source: "manual",
    requirements: [{
      id: "req-python",
      category: "required_skill",
      description: "使用 Python 完成接口开发",
      priority: "high",
      hardConstraint: false,
      sourceSpan: { start: 0, end: 24, text: "使用 Python 完成接口开发" },
      keywords: ["Python", "接口开发"],
      confidence: 1,
      createdAt: NOW,
      updatedAt: NOW
    }],
    createdAt: NOW,
    updatedAt: NOW
  } as JobDescription;
}

function fixtureTaskInputs(): ResumeTailorTaskInputV2[] {
  return [{
    draftId: "draft-1",
    profileId: "profile-1",
    jobId: "job-1",
    intensity: "proactive",
    jobContext: { title: "AI 软件工程师", rawText: "使用 Python 完成接口开发。", responsibilities: [], mustHave: [], niceToHave: [], tools: ["Python"], keywords: ["Python"] },
    target: { sectionType: "skills", sectionId: "skills", itemId: "skill-1", fieldPath: "description" },
    currentContent: {
      structuredItem: ResumeItemV2Schema.parse({ id: "skill-1", sectionType: "skills", name: "技能" }),
      fieldValue: "",
      renderedText: ""
    },
    relevantRequirements: [{
      requirementId: "req-python",
      description: "使用 Python 完成接口开发",
      priority: "high",
      keywords: ["Python", "接口开发"],
      relevanceScore: 1
    }],
    allowedEvidenceRefs: [],
    allowedFacts: [],
    evidenceBundle: {
      directEvidence: [],
      relatedResumeEvidence: [],
      relatedProfileEvidence: [],
      confirmableSignals: [],
      confirmedUserDeclarations: [],
      negativeUserDeclarations: [],
      uncertainUserDeclarations: []
    },
    wholeResumeContext: { neighboringLines: [], topCapabilityPhrases: [], alreadySelectedRequirementIds: [], nearbyItemIds: [] }
  }];
}

function fixtureBranch(): ResumeBranch {
  return {
    id: "branch-1",
    currentRevisionId: "revision-1",
    contentItems: [{ id: "skill-1", itemType: "skill", source: "user_manual", sourceSectionId: "skills", text: "技能", originalText: "技能", order: 0, visible: true, requirementIds: [], sourceSuggestionIds: [], factRefs: [], guardMode: "not_fact", guardStatus: "pass", guardFindings: [], userConfirmation: { scope: "resume_only", confirmedTextHash: "hash-skill-1", confirmedAt: NOW } }],
    structuredContentItems: [{ id: "skill-1", data: ResumeItemV2Schema.parse({ id: "skill-1", sectionType: "skills", name: "技能", description: "技能基础" }) }]
  } as unknown as ResumeBranch;
}
