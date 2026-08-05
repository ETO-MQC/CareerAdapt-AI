import { describe, expect, it } from "vitest";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import { AgentRuntime } from "@/agent/runtime/agentRuntime";
import { AuthoritativeConversationAlignmentGuard } from "@/agent/kernel/AuthoritativeConversationAlignmentGuard";

function projection(status: "accepted" | "proposed" = "accepted") {
  return {
    importId: "intake-1",
    draftRevision: 2,
    finalReviewRevision: status === "accepted" ? 3 : undefined,
    sourceMessageId: "message-1",
    sourceTurnId: "turn-1",
    sourceContentHash: "source-hash-123",
    providerStatus: "available" as const,
    extractionStatus: "structured_ai" as const,
    candidates: [{
      id: "candidate-1",
      sectionType: "project" as const,
      sourceSpan: { start: 0, end: 8 },
      sourceQuote: "一个项目经历",
      professionalText: "一个项目经历",
      uncertainFields: [],
      confidence: 0.9,
      needsConfirmation: status !== "accepted",
      status,
      canAccept: true,
      fieldEvidence: []
    }],
    reviewProgress: {
      total: 1,
      proposed: status === "accepted" ? 0 : 1,
      valid: 1,
      uncertain: 0,
      accepted: status === "accepted" ? 1 : 0,
      ignored: 0,
      rejected: 0,
      reviewed: status === "accepted" ? 1 : 0
    },
    followUpQuestions: []
  };
}

function taskState() {
  const session = AgentRuntime.create("guided_profile_intake", "profile_complete");
  const reducer = new AgentTaskStateReducer();
  const base = reducer.create(session, "profile_intake");
  return {
    ...base,
    workflowId: "guided_profile_intake" as const,
    stage: "profile_complete" as const,
    knownSlots: { ...base.knownSlots, profileIntakeReviewProjection: projection() },
    selectedEntities: { ...base.selectedEntities, profileId: "profile-1", profileVersion: 4 }
  };
}

describe("P4.3h authoritative conversation alignment", () => {
  it.each(["已保存", "已导入资料库", "已更新档案", "已创建简历"])(
    "blocks unsupported completion claim: %s",
    (text) => {
      const result = new AuthoritativeConversationAlignmentGuard().validate({
        text,
        taskState: taskState(),
        reviewProjection: projection()
      });

      expect(result.aligned).toBe(false);
      if (result.aligned) throw new Error("unexpected alignment");
      expect(result.safeErrorCode).toBe("profile_commit_verification_missing");
    }
  );

  it("requires a final review revision and every candidate to be resolved", () => {
    const state = taskState();
    const result = new AuthoritativeConversationAlignmentGuard().validate({
      text: "档案已整理完成",
      taskState: state,
      reviewProjection: projection("proposed")
    });

    expect(result.aligned).toBe(false);
    if (result.aligned) throw new Error("unexpected alignment");
    expect(result.safeErrorCode).toBe("final_review_incomplete");
  });

  it("allows a verified profile write and final archive claim", () => {
    const state = taskState();
    const result = new AuthoritativeConversationAlignmentGuard().validate({
      text: "档案已整理完成，已保存到个人资料库",
      taskState: state,
      reviewProjection: projection(),
      observations: [
        { toolName: "commit_profile_intake", value: { profileId: "profile-1", profileVersion: 4 } },
        { toolName: "get_profile", value: { profile: { id: "profile-1", version: 4 } } }
      ]
    });

    expect(result).toEqual({ aligned: true });
  });

  it("does not let narration regeneration ask a new workflow question", () => {
    const result = new AuthoritativeConversationAlignmentGuard().validate({
      text: "接下来请告诉我你的项目经历？",
      taskState: { ...taskState(), stage: "collect_experience" },
      narrationOnly: true
    });

    expect(result.aligned).toBe(false);
    if (result.aligned) throw new Error("unexpected alignment");
    expect(result.safeErrorCode).toBe("narration_regeneration_advanced_workflow");
  });
});
