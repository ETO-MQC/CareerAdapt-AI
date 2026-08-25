import { describe, expect, it, vi } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { ResumeTailorTaskInputV2Schema, ResumeTailoringPlanSchema, type ResumeTailoringDiffTaskInput } from "@/domain/schemas";
import {
  analyzeJobCommand,
  applyTailoringSessionCommand,
  createTailoringSessionCommand,
  generateTailoringDiffsCommand,
  reviewTailoringDiffCommand,
  tailoringDiffId
} from "@/services/jobs/tailoringCommands";
import { AI_TRAINER_JD_V4 } from "../fixtures/aiTrainerJdV4";

const NOW = "2026-07-23T08:00:00.000Z";

describe("headless tailoring commands", () => {
  it("analyzes a JD without UI state and returns a reviewable V4 graph", () => {
    const result = analyzeJobCommand({
      operationId: "analyze-command-1",
      rawText: AI_TRAINER_JD_V4
    });
    expect(result.graph.schemaVersion).toBe("job-requirement-graph-v4");
    expect(result.graph.contextGroups[0].details).toHaveLength(3);
    expect(result.needsReview).toBe(true);
  });

  it("retries only a rejected target once and keeps the successful retry", async () => {
    const job = demoJobDescriptions[0];
    const built = buildJobBranchFromProfile({
      profile: demoCareerProfile,
      jobId: job.id,
      jobTitle: job.title,
      jobVersion: "test-job-v1",
      operationId: "headless-branch-create",
      name: "Headless 岗位简历",
      selectedCanonicalItemIds: canonicalProfileLibraryItems(demoCareerProfile).slice(0, 4).map((item) => item.id),
      requirementMatchIds: [],
      sourceMatchSetHash: "headless-match-hash",
      now: NOW
    });
    const created = createTailoringSessionCommand({
      operationId: "tailoring-command-1",
      profile: demoCareerProfile,
      branch: built.branch,
      job,
      intensity: "balanced"
    });
    const content = built.branch.structuredContentItems?.find((item) => ["summary", "skills", "project", "work", "internship"].includes(item.data.sectionType));
    if (!content) throw new Error("headless_content_fixture_missing");
    const data = content.data as unknown as Record<string, unknown>;
    const field = content.data.sectionType === "summary" ? "text"
      : content.data.sectionType === "skills" ? (typeof data.description === "string" ? "description" : "name")
        : Array.isArray(data.highlights) && data.highlights.length ? "highlights" : "description";
    const original = (data[field] ?? (field === "highlights" ? [] : "")) as string | string[];
    const requirement = job.requirements[0];
    const task = ResumeTailorTaskInputV2Schema.parse({
      draftId: "headless-draft",
      profileId: demoCareerProfile.id,
      jobId: job.id,
      intensity: "balanced",
      jobContext: {
        title: job.title,
        company: job.company,
        rawText: job.rawText,
        responsibilities: job.requirements.map((item) => item.description),
        mustHave: [],
        niceToHave: [],
        tools: [],
        keywords: job.requirements.flatMap((item) => item.keywords)
      },
      target: {
        sectionType: content.data.sectionType,
        sectionId: content.data.sectionType,
        itemId: content.id,
        fieldPath: `sections.${content.data.sectionType}.items.${content.id}.${field}`
      },
      currentContent: {
        structuredItem: content.data,
        fieldValue: original,
        renderedText: content.legacyTextProjection ?? String(original)
      },
      relevantRequirements: [{
        requirementId: requirement.id,
        description: requirement.description,
        priority: requirement.priority,
        keywords: requirement.keywords,
        relevanceScore: 1
      }],
      allowedEvidenceRefs: [],
      allowedFacts: []
    });
    const session = { ...created.session, taskInputs: [task] };
    const generate = vi.fn(async (request: ResumeTailoringDiffTaskInput) => {
      const original = request.currentContent.fieldValue;
      const value = Array.isArray(original)
        ? original.map((item, index) => index === 0 ? `${item}。` : item)
        : `${original.replace(/[。；;]$/, "")}；聚焦岗位相关经验。`;
      return {
        diffs: [{
          target: {
            sectionId: request.target.sectionId,
            itemId: request.target.itemId!,
            fieldPath: request.target.fieldPath as "text" | "description" | "highlights" | "name" | "visible" | "order"
          },
          operation: "replace" as const,
          original: generate.mock.calls.length === 1 ? (Array.isArray(original) ? ["stale"] : "stale") : original,
          value,
          reason: "基于已有内容做岗位相关表达调整",
          requirementIds: request.relevantRequirements.map((item) => item.requirementId),
          targetKeywords: request.relevantRequirements.flatMap((item) => item.keywords).slice(0, 3),
          evidenceRefs: [],
          supportLevel: "reasonable_inference" as const
        }],
        clarifications: []
      };
    });

    const result = await generateTailoringDiffsCommand({
      operationId: "generate-command-1",
      session,
      generate
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.appliedDiffs).toHaveLength(1);
    expect(result.rejectedDiffs).toHaveLength(0);
    const noChange = vi.fn(async () => ({ diffs: [], clarifications: [] }));
    const noChangeResult = await generateTailoringDiffsCommand({
      operationId: "generate-command-no-change",
      session,
      generate: noChange
    });
    expect(noChange).toHaveBeenCalledTimes(1);
    expect(noChangeResult.appliedDiffs).toHaveLength(0);
    expect(noChangeResult.session.plan.generationDiagnostics).toEqual(expect.arrayContaining([{ code: "no_change_needed", targetItemId: session.taskInputs[0].target.itemId }]));

    const requirementId = session.taskInputs[0].relevantRequirements[0].requirementId;
    const itemId = session.taskInputs[0].target.itemId!;
    const answeredQuestion = {
      id: "q-capability",
      question: "你是否使用过 Cursor？",
      requirementIds: [requirementId],
      sourceItemIds: [itemId],
      relatedItemIds: [itemId],
      candidateClaim: "Cursor",
      targetFieldPaths: [session.taskInputs[0].target.fieldPath],
      answerType: "boolean" as const,
      status: "answered" as const
    };
    const blockedSession = {
      ...session,
      plan: ResumeTailoringPlanSchema.parse({
        ...session.plan,
        clarificationQuestions: [answeredQuestion],
        clarificationAnswers: [{ questionId: "q-capability", status: "rejected", answer: false, answerRevision: 1, resolvedAt: NOW }],
        answerReceipts: [{ questionPlanId: "question-plan-1", questionPlanRevision: 1, questionId: "q-capability", answerMessageId: "answer-message-1", disposition: "none", consumedAt: NOW }],
        questionPlan: { questionPlanVersion: 2, id: "question-plan-1", sessionId: session.id, revision: 1, status: "completed", defaultBudget: 1, maximumBudget: 1, questionIds: ["q-capability"], answeredQuestionIds: ["q-capability"], skippedQuestionIds: [], uncertainQuestionIds: [], createdAt: NOW, completedAt: NOW }
      })
    };
    const blockedRequests: ResumeTailoringDiffTaskInput[] = [];
    const blockedResult = await generateTailoringDiffsCommand({
      operationId: "generate-command-denied-capability",
      session: blockedSession,
      generate: vi.fn(async (request: ResumeTailoringDiffTaskInput) => {
        blockedRequests.push(request);
        return { diffs: [], clarifications: [] };
      })
    });
    expect(blockedRequests[0].evidenceBundle?.negativeUserDeclarations[0]?.value).toBe("Cursor");
    expect(blockedResult.appliedDiffs).toHaveLength(0);

    const positiveQuestion = { ...answeredQuestion, id: "q-positive", candidateClaim: "Claude Code" };
    const positiveSession = {
      ...session,
      plan: ResumeTailoringPlanSchema.parse({
        ...session.plan,
        clarificationQuestions: [positiveQuestion],
        clarificationAnswers: [{ questionId: "q-positive", status: "accepted", answer: "Claude Code 使用 4 个月", proficiency: "familiar", answerRevision: 1, resolvedAt: NOW }],
        answerReceipts: [{ questionPlanId: "question-plan-2", questionPlanRevision: 1, questionId: "q-positive", answerMessageId: "answer-message-2", disposition: "answered", answerText: "Claude Code 使用 4 个月", consumedAt: NOW }],
        questionPlan: { questionPlanVersion: 2, id: "question-plan-2", sessionId: session.id, revision: 1, status: "completed", defaultBudget: 1, maximumBudget: 1, questionIds: ["q-positive"], answeredQuestionIds: ["q-positive"], skippedQuestionIds: [], uncertainQuestionIds: [], createdAt: NOW, completedAt: NOW }
      })
    };
    const positiveRequests: ResumeTailoringDiffTaskInput[] = [];
    const positiveResult = await generateTailoringDiffsCommand({
      operationId: "generate-command-positive-capability",
      session: positiveSession,
      generate: vi.fn(async (request: ResumeTailoringDiffTaskInput) => {
        positiveRequests.push(request);
        const original = request.currentContent.fieldValue;
        return {
          diffs: [{ target: { sectionId: request.target.sectionId, itemId: request.target.itemId!, fieldPath: request.target.fieldPath }, operation: "replace" as const, original, value: Array.isArray(original) ? [...original, "熟悉 Claude Code 在真实任务中的使用"] : `${original}；熟悉 Claude Code 在真实任务中的使用`, reason: "根据用户已确认的使用经历做范围受控改写", requirementIds: [requirementId], targetKeywords: [], evidenceRefs: [], supportLevel: "user_declared" as const }],
          clarifications: []
        };
      })
    });
    expect(positiveRequests[0].evidenceBundle?.confirmedUserDeclarations[0]?.value).toContain("Claude Code");
    expect(positiveResult.appliedDiffs).toHaveLength(1);
    const diffId = tailoringDiffId(result.appliedDiffs[0]);
    const accepted = reviewTailoringDiffCommand({
      operationId: "review-diff-command-1",
      session: result.session,
      diffId,
      decision: "accept"
    });
    expect(accepted.selectedDiffIds).toEqual([diffId]);
    expect(accepted.selectedDiffs).toEqual(result.appliedDiffs);
    expect(accepted.acceptedDiffIds).toEqual([diffId]);
    expect(accepted.editedDiffIds).toEqual([]);
    expect(accepted.acceptedDiffCount).toBe(1);
    expect(accepted.remainingDiffCount).toBe(0);

    const rejected = reviewTailoringDiffCommand({
      operationId: "review-diff-command-reject",
      session: accepted.session,
      diffId,
      decision: "reject"
    });
    const applyRepository = { applyTailoringDiffs: vi.fn() };
    await expect(applyTailoringSessionCommand({
      operationId: "apply-no-selected-diffs",
      repository: applyRepository as never,
      session: rejected.session,
      selectedDiffs: rejected.selectedDiffs
    })).rejects.toMatchObject({ code: "tailoring_no_selected_changes" });
    expect(applyRepository.applyTailoringDiffs).not.toHaveBeenCalled();

    const noOpRepository = {
      applyTailoringDiffs: vi.fn(async () => ({
        branch: rejected.session.branch,
        revision: undefined,
        appliedDiffs: [],
        rejectedDiffs: [],
        warnings: [],
        idempotent: false,
        beforeContentHash: "same-hash",
        afterContentHash: "same-hash"
      }))
    };
    await expect(applyTailoringSessionCommand({
      operationId: "apply-verification-failure",
      repository: noOpRepository as never,
      session: accepted.session,
      selectedDiffs: accepted.selectedDiffs
    })).rejects.toMatchObject({ code: "tailoring_apply_verification_failed" });

    expect(result.generationStats).toEqual({
      selectedTargetCount: 1,
      providerCallCount: 2,
      retryCount: 1,
      acceptedDiffCount: 1
    });
  });
});
