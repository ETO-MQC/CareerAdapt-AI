import { describe, expect, it, vi } from "vitest";
import { demoCareerProfile } from "@/data/demoProfile";
import { demoJobDescriptions } from "@/data/demoJobs";
import { buildJobBranchFromProfile } from "@/domain/branch/profileBranch";
import { canonicalProfileLibraryItems } from "@/domain/profile/canonicalLibrary";
import { ResumeTailorTaskInputV2Schema, type ResumeTailoringDiffTaskInput } from "@/domain/schemas";
import {
  analyzeJobCommand,
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
    const diffId = tailoringDiffId(result.appliedDiffs[0]);
    const accepted = reviewTailoringDiffCommand({
      operationId: "review-diff-command-1",
      session: result.session,
      diffId,
      decision: "accept"
    });
    expect(accepted.selectedDiffIds).toEqual([diffId]);
    expect(accepted.selectedDiffs).toEqual(result.appliedDiffs);
    expect(accepted.remainingDiffCount).toBe(0);

    const consolidated = vi.fn(async (requests: ResumeTailoringDiffTaskInput[]) => ({
      diffs: requests.map((request) => ({
        target: {
          sectionId: request.target.sectionId,
          itemId: request.target.itemId!,
          fieldPath: request.target.fieldPath as "text" | "description" | "highlights" | "name" | "visible" | "order"
        },
        operation: "replace" as const,
        original: request.currentContent.fieldValue,
        value: Array.isArray(request.currentContent.fieldValue)
          ? request.currentContent.fieldValue.map((item, index) => index === 0 ? `${item}。` : item)
          : `${request.currentContent.fieldValue.replace(/[。；;]$/, "")}；突出岗位相关交付。`,
        reason: "一次总体优化中生成的岗位相关表达",
        requirementIds: request.relevantRequirements.map((item) => item.requirementId),
        targetKeywords: request.relevantRequirements.flatMap((item) => item.keywords).slice(0, 3),
        evidenceRefs: [],
        supportLevel: "reasonable_inference" as const
      }))
    }));
    const fallback = vi.fn();
    const consolidatedResult = await generateTailoringDiffsCommand({
      operationId: "generate-command-consolidated",
      session,
      generate: fallback,
      generateConsolidated: consolidated
    });
    expect(consolidated).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(consolidatedResult.appliedDiffs).toHaveLength(1);
  });
});
