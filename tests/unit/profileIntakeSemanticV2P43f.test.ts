import { describe, expect, it } from "vitest";
import { ProfileIntakeSemanticService } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { adaptConversationMessageToIntakeDraft, buildConversationIntakeReviewProjectionFromDraft, mergeConversationIntakeDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { aiTaskRegistry } from "@/ai/tasks/registry";

describe("P4.3f V2 conversational extraction", () => {
  it("uses named source blocks and quarantines one bad V3 candidate without numeric offsets", async () => {
    const narrative = "开发 TaskAI 项目，使用 Python。获得省级竞赛三等奖。";
    const result = await new ProfileIntakeSemanticService(async () => ({
      ok: true as const,
      data: {
        candidates: [
          {
            candidateKey: "taskai",
            sectionType: "project" as const,
            sourceBlockIds: ["source-block-1"],
            sourceQuote: "开发 TaskAI 项目，使用 Python。",
            structuredItem: { sectionType: "project" as const, title: "TaskAI", tools: ["Python"] },
            professionalText: "开发 TaskAI 项目，使用 Python。",
            uncertainFields: []
          },
          {
            candidateKey: "bad-award",
            sectionType: "awards" as const,
            sourceBlockIds: ["missing-source-block"],
            sourceQuote: "获得省级竞赛三等奖。",
            structuredItem: { sectionType: "awards" as const, name: "省级竞赛三等奖" },
            uncertainFields: []
          }
        ],
        followUpQuestions: []
      }
    })).normalize({ rawNarrative: narrative });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sourceQuote).toBe("开发 TaskAI 项目，使用 Python。");
    expect(result.candidates[0]?.sourceSpan).toEqual({ start: 0, end: "开发 TaskAI 项目，使用 Python。".length });
    expect(result.candidates[0]?.sourceBlockIds).toEqual(["source-block-1"]);
    expect(result.quarantinedCandidateCount).toBe(1);
    expect(result.extractionStatus).toBe("partial");
  });

  it("keeps an explicit award title and marks an unresolved single-block quote uncertain", async () => {
    const narrative = "参加示例编程竞赛并获得某省省级三等奖。开发示例学习助手。";
    const result = await new ProfileIntakeSemanticService(async () => ({
      ok: true as const,
      data: {
        candidates: [
          {
            candidateKey: "award",
            sectionType: "awards" as const,
            sourceBlockIds: ["source-block-1"],
            sourceQuote: "某省省级三等奖。",
            structuredItem: { sectionType: "awards" as const, title: "某省省级三等奖" },
            uncertainFields: []
          },
          {
            candidateKey: "learning-assistant",
            sectionType: "project" as const,
            sourceBlockIds: ["source-block-1"],
            sourceQuote: "学习助手项目的概括性引用",
            structuredItem: { sectionType: "project" as const, title: "示例学习助手" },
            uncertainFields: []
          }
        ],
        followUpQuestions: []
      }
    })).normalize({ rawNarrative: narrative });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.find((candidate) => candidate.normalization.structuredItem?.sectionType === "awards")?.normalization.structuredItem).toMatchObject({
      sectionType: "awards",
      name: "某省省级三等奖"
    });
    expect(result.candidates.find((candidate) => candidate.normalization.structuredItem?.sectionType === "project")?.uncertainFields).toContain("sourceQuote");
    expect(result.quarantinedCandidateCount).toBe(0);
  });

  it("does not let a historical provider warning poison the latest successful source turn", async () => {
    const failed = adaptConversationMessageToIntakeDraft({
      sessionId: "session-history",
      messageId: "message-history-1",
      turnId: "turn-history-1",
      text: "旧回答暂未完成整理。",
      capturedAt: "2026-08-04T09:00:00.000Z",
      semanticResult: { mode: "deterministic", providerStatus: "failed", extractionStatus: "failed", warning: "provider_unavailable", candidates: [] }
    }).draft;
    const successful = await new ProfileIntakeSemanticService(async () => ({
      ok: true as const,
      data: {
        candidates: [{
          candidateKey: "taskai",
          sectionType: "project" as const,
          sourceSpan: { start: 0, end: 14 },
          structuredItem: { sectionType: "project" as const, title: "TaskAI" },
          professionalText: "开发 TaskAI 项目。",
          uncertainFields: []
        }],
        followUpQuestions: []
      }
    })).normalize({ rawNarrative: "我开发 TaskAI 项目。" });
    const current = adaptConversationMessageToIntakeDraft({
      sessionId: "session-history",
      messageId: "message-history-2",
      turnId: "turn-history-2",
      text: "我开发 TaskAI 项目。",
      capturedAt: "2026-08-04T09:01:00.000Z",
      semanticResult: successful
    }).draft;
    const merged = mergeConversationIntakeDraft(failed, current);
    const projection = buildConversationIntakeReviewProjectionFromDraft(merged);

    expect(merged.warnings.some((warning) => warning.code === "provider_unavailable")).toBe(true);
    expect(projection.extractionStatus).toBe("structured_ai");
    expect(projection.safeDiagnostics?.extractionStatus).toBe("structured_ai");
  });

  it("salvages valid candidates when one candidate has an invalid source span", async () => {
    const narrative = "我开发 TaskAI 项目，使用 Python。参加示例编程竞赛并获得省级三等奖。";
    const service = new ProfileIntakeSemanticService(async () => ({
      ok: true as const,
      data: {
        candidates: [
          {
            candidateKey: "project-taskai",
            sectionType: "project" as const,
            sourceSpan: { start: 0, end: 31 },
            structuredItem: {
              sectionType: "project" as const,
              title: "TaskAI",
              tools: ["Python"],
              description: "开发 TaskAI 项目，使用 Python。"
            },
            professionalText: "开发 TaskAI 项目，使用 Python。",
            uncertainFields: []
          },
          {
            candidateKey: "bad-award",
            sectionType: "awards" as const,
            sourceSpan: { start: 900, end: 950 },
            structuredItem: { sectionType: "awards", name: "不存在" },
            professionalText: "不存在",
            uncertainFields: []
          }
        ],
        followUpQuestions: ["项目的结果是什么？"]
      }
    })).normalize({ rawNarrative: narrative });

    expect(service).toBeDefined();
    const result = await service;
    expect(result.providerStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.sourceQuote).toBe(narrative.slice(0, 31));
    expect(result.followUpQuestions).toEqual(["项目的结果是什么？"]);
  });

  it("quarantines unsupported fields and malformed dates without discarding the candidate", async () => {
    const narrative = "开发示例系统，2024/13 开始，使用 Python。";
    const result = await new ProfileIntakeSemanticService(async () => ({
      ok: true as const,
      data: {
        candidates: [{
          candidateKey: "project-with-uncertain-fields",
          sectionType: "project" as const,
          sourceSpan: { start: 0, end: narrative.length },
          structuredItem: {
            sectionType: "project" as const,
            title: "示例系统",
            startDate: "2024/13",
            unsupportedField: "不会进入简历",
            description: "开发示例系统，使用 Python。",
            tools: ["Python"],
            highlights: [],
            outcomes: []
          },
          professionalText: "开发示例系统并使用 Python。",
          uncertainFields: []
        }],
        followUpQuestions: []
      }
    })).normalize({ rawNarrative: narrative });

    expect(result.providerStatus).toBe("available");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.normalization.structuredItem).not.toHaveProperty("unsupportedField");
    expect(result.candidates[0]?.normalization.structuredItem).not.toHaveProperty("startDate");
    expect(result.candidates[0]?.uncertainFields).toEqual(expect.arrayContaining(["unsupportedField", "startDate"]));
  });

  it("projects failed extraction as a recoverable card without an adoptable fallback", () => {
    const adapted = adaptConversationMessageToIntakeDraft({
      sessionId: "session-p43f",
      messageId: "message-p43f",
      turnId: "turn-p43f",
      text: "这是一段无法完成结构化的经历描述。",
      capturedAt: "2026-08-04T09:00:00.000Z",
      semanticResult: {
        mode: "deterministic",
        providerStatus: "failed",
        warning: "provider_exception",
        candidates: []
      }
    });

    expect(adapted.reviewProjection.extractionStatus).toBe("failed");
    expect(adapted.reviewProjection.candidates[0]?.status).toBe("failed");
    expect(adapted.reviewProjection.candidates[0]?.canAccept).toBe(false);
    expect(adapted.reviewProjection.failedExtraction?.actions).toEqual(["retry", "manual", "preserve"]);
  });

  it("keeps a deterministic education candidate reviewable when the provider fails", async () => {
    const narrative = "我就读郑州大学，本科，计算机科学与技术专业，2024年9月入学，预计2028年6月毕业。";
    const result = await new ProfileIntakeSemanticService(async () => {
      throw new Error("provider_down");
    }).normalize({ rawNarrative: narrative });

    expect(result.providerStatus).toBe("failed");
    expect(result.extractionStatus).toBe("structured_local");
    expect(result.candidates[0]?.normalization.structuredItem).toMatchObject({
      sectionType: "education",
      school: "郑州大学",
      degree: "本科",
      major: "计算机科学与技术",
      startDate: "2024-09",
      endDate: "2028-06"
    });

    const adapted = adaptConversationMessageToIntakeDraft({
      sessionId: "session-p43g-local",
      messageId: "message-p43g-local",
      turnId: "turn-p43g-local",
      text: narrative,
      capturedAt: "2026-08-04T09:00:00.000Z",
      semanticResult: result
    });
    expect(adapted.reviewProjection.providerStatus).toBe("failed");
    expect(adapted.reviewProjection.extractionStatus).toBe("structured_local");
    expect(adapted.reviewProjection.candidates[0]?.status).toBe("uncertain");
    expect(adapted.reviewProjection.candidates[0]?.status).not.toBe("failed");
  });

  it("converts the legacy provider fixture into the V2 boundary before validation", async () => {
    const narrative = "我现在是示例大学本科学生，计算机相关专业专业，2024年9月入学，预计2028年6月毕业";
    const input = { rawNarrative: narrative, existingDraftContext: [], canonicalSections: ["education"] as ("education")[], inputHash: "p43f-test-input-hash" };
    const raw = {
      candidates: [{
        candidateKey: "legacy-education",
        sectionType: "education",
        structuredItem: {
          id: "legacy-education",
          sectionType: "education",
          school: "示例大学",
          degree: "本科",
          major: "计算机相关专业",
          startDate: "2024-9",
          endDate: "2028-6",
          current: false,
          courses: [],
          honors: [],
          highlights: [],
          customFields: []
        },
        description: "教育背景待核对。",
        sourceQuote: narrative,
        fieldEvidence: []
      }],
      followUpQuestion: "教育经历中你最希望保留的方向是什么？"
    };
    const coerced = aiTaskRegistry["profile-intake-semantic"].coerceRawOutput(raw, input) as Record<string, unknown>;
    const normalized = aiTaskRegistry["profile-intake-semantic"].normalizeOutput(coerced as never);
    const result = await new ProfileIntakeSemanticService(async () => ({ ok: true as const, data: normalized })).normalize({ rawNarrative: narrative });
    expect(result.providerStatus).toBe("available");
    expect(result.candidates[0]?.normalization.structuredItem).toMatchObject({ school: "示例大学", degree: "本科" });
  });
});
