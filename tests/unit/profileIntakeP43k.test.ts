import { afterEach, describe, expect, it } from "vitest";
import { adaptConversationMessageToIntakeDraft, buildConversationIntakeReviewProjectionFromDraft } from "@/domain/profileIntake/ConversationIntakeAdapter";
import { synthesizeProfileIntakeDraft } from "@/domain/profileIntake/ProfileIntakeFinalSynthesis";
import {
  applyProfileIntakeFinalCareerSynthesis,
  ProfileIntakeFinalCareerSynthesisOutputSchema
} from "@/domain/profileIntake/ProfileIntakeFinalCareerSynthesis";
import { ProfileIntakeSourceTurnSchema } from "@/domain/profileIntake/ProfileIntakeSourceTurn";
import { highestValueFollowUpDetail } from "@/domain/profileIntake/ProfileIntakeCompleteness";
import { ProfileIntakeFinalizationSupervisor } from "@/agent/workflows/ProfileIntakeFinalizationSupervisor";
import { resolveProfileIntakeInterviewSupervisor } from "@/agent/workflows/ProfileIntakeInterviewSupervisor";
import type { ProfileIntakeSemanticResult } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { BrowserAgentToolService } from "@/services/agent/agentToolService";
import { AgentAttachmentStore } from "@/services/agent/AgentAttachmentStore";
import { AgentExecutionCoordinator } from "@/agent/runtime/AgentExecutionCoordinator";
import { CareerAdaptDb } from "@/services/storage/db";
import { WorkspaceRepository } from "@/services/storage/repositories";
import { stableHashText } from "@/services/security/text";
import { classifyProfileIntakeTurn, resolveActiveQuestionTurn } from "@/agent/runtime/AgentTurnIntent";

let db: CareerAdaptDb | undefined;

afterEach(async () => {
  db?.close();
  if (db) await db.delete();
  db = undefined;
});

describe("P4.3k interview-first profile intake", () => {
  it("routes the exact active-question answer to the existing asset before generic lexical heuristics", () => {
    const answer = "在codex的协助下，使用 PlatformIO + Arduino 框架，通过 C++ 模块化架构（驱动层/算法层/输出层分离）和 Mock 信号仿真（正弦波模拟 PPG 波形），在无硬件条件下完成了 ESP32 MAX30102 心率检测 demo 的编译验证。";
    const activeQuestion = {
      questionId: "question-shoe-lace-tools",
      candidateId: "candidate-shoe-lace",
      candidateLabel: "鞋带",
      dimension: "tools_methods",
      questionRevision: 3,
      question: "你完成这项工作时，明确使用了什么方法或工具？"
    } as const;

    expect(resolveActiveQuestionTurn({ text: answer, activeQuestion })).toMatchObject({
      kind: "answer",
      activeQuestionId: activeQuestion.questionId,
      candidateId: activeQuestion.candidateId,
      dimension: activeQuestion.dimension
    });
    expect(classifyProfileIntakeTurn({
      text: answer,
      stage: "collect_experience",
      activeQuestionId: activeQuestion.questionId,
      activeQuestionLabel: activeQuestion.candidateLabel,
      expectedAnswerDimension: activeQuestion.dimension
    })).toBe("follow_up_answer");
  });

  it("resolves references, skips, and explicit new assets against the active question", () => {
    const activeQuestion = {
      questionId: "question-shoe-lace-tools",
      candidateId: "candidate-shoe-lace",
      candidateLabel: "鞋带",
      dimension: "tools_methods",
      questionRevision: 3,
      sourceTurns: [{
        turnId: "turn-shoe-lace-answer",
        text: "在无硬件条件下使用 PlatformIO + Arduino 框架完成编译验证。"
      }]
    } as const;

    expect(resolveActiveQuestionTurn({
      text: "就是使用 PlatformIO + Arduino 框架，通过 C++ 模块化架构完成验证。",
      activeQuestion
    })).toMatchObject({ kind: "answer", candidateId: activeQuestion.candidateId });
    expect(resolveActiveQuestionTurn({ text: "我已经说了", activeQuestion })).toMatchObject({
      kind: "reference_question",
      reason: "previous_answer_satisfies_active_dimension",
      resolvedBySourceTurnId: "turn-shoe-lace-answer"
    });
    expect(resolveActiveQuestionTurn({ text: "跳过", activeQuestion })).toMatchObject({
      kind: "skip",
      activeQuestionId: activeQuestion.questionId
    });
    expect(resolveActiveQuestionTurn({
      text: "在 Learn AI 项目中负责数据清洗，交付训练数据集。",
      activeQuestion
    })).toMatchObject({ kind: "new_asset" });
  });

  it("builds one final synthesis from all provisional source turns and keeps source items", () => {
    const text = "我在 Smart Fox 课程项目中负责数据采集，使用 RPA 完成自动化处理。";
    const prepared = adaptConversationMessageToIntakeDraft({
      importId: "p43k-synthesis",
      sessionId: "session-p43k",
      messageId: "message-p43k-1",
      turnId: "turn-p43k-1",
      text,
      capturedAt: "2026-08-07T01:00:00.000Z",
      semanticResult: semanticResult(text, "Smart Fox")
    });
    const sourceTurn = ProfileIntakeSourceTurnSchema.parse({
      sessionId: "session-p43k",
      messageId: "message-p43k-1",
      turnId: "turn-p43k-1",
      exactSourceText: text,
      sourceHash: stableHashText(text),
      capturedAt: "2026-08-07T01:00:00.000Z",
      workflowStage: "structure_facts",
      processingStatus: "structured",
      extractionStatus: "structured_local",
      candidateIds: ["smart-fox"],
      candidateCount: 1
    });

    const result = synthesizeProfileIntakeDraft({
      draft: prepared.draft,
      sourceTurns: [sourceTurn],
      now: "2026-08-07T01:01:00.000Z"
    });
    const projection = buildConversationIntakeReviewProjectionFromDraft(result.draft);

    expect(result.synthesis.sourceTurnIds).toContain("turn-p43k-1");
    expect(result.synthesis.assets).toHaveLength(1);
    expect(result.synthesis.assets[0].candidateId).toMatch(/^synth-/);
    expect(result.synthesis.assets[0].highlights).toContain("数据采集");
    expect(result.draft.intakeSession?.phase).toBe("ready_for_review");
    expect(projection.finalSynthesis?.version).toBe("profile-intake-final-synthesis-v1");
    expect(projection.candidates[0]?.id).toBe(result.synthesis.assets[0].candidateId);
    const sourceCandidateId = result.synthesis.assets[0].sourceCandidateIds[0];
    expect(result.draft.sections.flatMap((section) => section.items).some((item) => item.id === sourceCandidateId && item.included === false)).toBe(true);

    const finalization = new ProfileIntakeFinalizationSupervisor().decide({
      text: "确认",
      stage: "final_review",
      reviewProjection: projection
    });
    expect(finalization.autoAcceptCandidateIds).toEqual([]);
    expect(finalization.unresolvedCandidateIds).toContain(result.synthesis.assets[0].candidateId);
    expect(finalization.shouldReconcile).toBe(false);
  });

  it("stores a user correction as provenance without running transcript Fact Guard", async () => {
    db = new CareerAdaptDb(`ProfileIntakeP43k-${crypto.randomUUID()}`);
    const repository = new WorkspaceRepository(db);
    const text = "我在 Learn AI 项目中负责数据清洗。";
    const prepared = adaptConversationMessageToIntakeDraft({
      importId: "p43k-correction",
      sessionId: "session-p43k-correction",
      messageId: "message-p43k-correction",
      turnId: "turn-p43k-correction",
      text,
      capturedAt: "2026-08-07T01:00:00.000Z",
      semanticResult: semanticResult(text, "Learn AI")
    });
    const saved = await repository.saveImportedResumeDraft(prepared.draft, 0);
    const itemId = saved.sections[0]?.items[0]?.id;
    expect(itemId).toBeTruthy();
    const service = new BrowserAgentToolService(repository, new (class {
      async normalize() {
        throw new Error("provider_not_called_for_user_correction_test");
      }
    })() as never);

    await service.reviewProfileIntake({
      importId: saved.importId,
      expectedDraftRevision: saved.revision,
      candidateId: itemId,
      decision: "accept",
      userCorrection: true,
      structuredPatch: { role: "项目负责人" }
    });
    const corrected = await repository.getImportedResumeDraft(saved.importId);
    const correctedItem = corrected?.sections.flatMap((section) => section.items).find((item) => item.id === itemId);
    const correction = correctedItem?.provenance?.find((entry) => entry.kind === "user_correction");

    expect(correctedItem?.structuredItem && "role" in correctedItem.structuredItem ? correctedItem.structuredItem.role : undefined).toBe("项目负责人");
    expect(correction).toMatchObject({
      kind: "user_correction",
      sourceCandidateId: itemId,
      fieldNames: ["role"]
    });
    expect(correctedItem?.conversationEvidence?.length).toBeGreaterThan(0);
  });

  it("keeps deterministic facts and provenance when final career wording is ungrounded", () => {
    const text = "我在 Smart Fox 课程项目中负责数据采集，使用 RPA 完成自动化处理。";
    const prepared = adaptConversationMessageToIntakeDraft({
      importId: "p43k-career-writing-guard",
      sessionId: "session-p43k-writing",
      messageId: "message-p43k-writing",
      turnId: "turn-p43k-writing",
      text,
      capturedAt: "2026-08-07T01:00:00.000Z",
      semanticResult: semanticResult(text, "Smart Fox")
    });
    const sourceTurn = ProfileIntakeSourceTurnSchema.parse({
      sessionId: "session-p43k-writing",
      messageId: "message-p43k-writing",
      turnId: "turn-p43k-writing",
      exactSourceText: text,
      sourceHash: stableHashText(text),
      capturedAt: "2026-08-07T01:00:00.000Z",
      workflowStage: "structure_facts",
      processingStatus: "structured",
      extractionStatus: "structured_local",
      candidateIds: ["smart-fox"],
      candidateCount: 1
    });
    const synthesized = synthesizeProfileIntakeDraft({ draft: prepared.draft, sourceTurns: [sourceTurn] });
    const asset = synthesized.synthesis.assets[0];
    const output = ProfileIntakeFinalCareerSynthesisOutputSchema.parse({
      assets: [{
        candidateId: asset.candidateId,
        structuredItem: asset.structuredItem,
        careerReadySummary: "带来全球营收增长 300%",
        careerReadyHighlights: ["带来全球营收增长 300%", "使用 RPA 完成自动化处理"],
        missingDimensions: asset.missingDimensions,
        conflicts: asset.conflicts ?? []
      }]
    });

    const applied = applyProfileIntakeFinalCareerSynthesis({
      draft: synthesized.draft,
      synthesis: synthesized.synthesis,
      output
    });
    const appliedAsset = applied.synthesis.assets[0];
    const careerReadyHighlights = appliedAsset.careerReadyHighlights ?? [];
    expect(appliedAsset.structuredItem).toEqual(asset.structuredItem);
    expect(appliedAsset.provenance).toEqual(asset.provenance);
    expect(appliedAsset.careerReadySummary).not.toContain("300%");
    expect(careerReadyHighlights.length).toBeGreaterThanOrEqual(2);
    expect(careerReadyHighlights.length).toBeLessThanOrEqual(4);
    expect(careerReadyHighlights.join(" ")).not.toContain("300%");
  });

  it("uses the same descending follow-up selector and allows only the identity repair as a third question", () => {
    const item = semanticResult("我做了一个项目", "项目 A").candidates[0].normalization.structuredItem!;
    const first = highestValueFollowUpDetail([item], { followUpCounts: { [item.id]: 0 } });
    const second = highestValueFollowUpDetail([item], { followUpCounts: { [item.id]: 2 } });
    const fourth = highestValueFollowUpDetail([item], { followUpCounts: { [item.id]: 3 } });

    expect(first?.item.id).toBe(item.id);
    expect(second).toBeUndefined();
    expect(fourth).toBeUndefined();

    const unnamedProject = {
      id: "unnamed-project",
      sectionType: "project" as const,
      role: "项目负责人",
      description: "完成数据清洗和交付。",
      current: false,
      tools: [],
      highlights: [],
      outcomes: [],
      customFields: []
    };
    expect(highestValueFollowUpDetail([unnamedProject], { followUpCounts: { [unnamedProject.id]: 0 } })?.dimension).toBe("identity");
    expect(highestValueFollowUpDetail([unnamedProject], { followUpCounts: { [unnamedProject.id]: 2 } })?.dimension).toBe("identity");
    expect(highestValueFollowUpDetail([unnamedProject], { followUpCounts: { [unnamedProject.id]: 3 } })).toBeUndefined();
  });

  it("binds selector-generated follow-ups to the exact Career Asset", () => {
    const item = semanticResult("我做了一个项目", "项目 A").candidates[0].normalization.structuredItem!;
    const action = resolveProfileIntakeInterviewSupervisor({ provisionalItems: [item] });

    expect(action).toMatchObject({
      type: "ask_follow_up",
      candidateId: item.id,
      candidateLabel: "项目 A",
      dimension: "result"
    });
    expect(action.type === "ask_follow_up" ? action.question : "").toContain("“项目 A”");
  });
});

describe("P4.3k bounded runtime resources", () => {
  it("removes terminal executions and releases attachment references", async () => {
    const coordinator = new AgentExecutionCoordinator();
    coordinator.begin({ sessionId: "session-resource" });
    coordinator.finish("session-resource", "completed");
    expect(coordinator.get("session-resource")).toBeUndefined();

    const store = new AgentAttachmentStore();
    const first = await store.register(new File(["first"], "first.txt", { type: "text/plain" }));
    const second = await store.register(new File(["second"], "second.txt", { type: "text/plain" }));
    expect(store.activeCount).toBe(2);
    store.releaseMany([first.id, second.id]);
    expect(store.activeCount).toBe(0);
    expect(store.has(first.id)).toBe(false);
  });
});

function semanticResult(text: string, title: string): ProfileIntakeSemanticResult {
  return {
    mode: "deterministic",
    providerStatus: "available",
    extractionStatus: "structured",
    candidates: [{
      id: stableHashText(title).slice(0, 12),
      label: title,
      sourceQuote: text,
      professionalText: text,
      normalization: {
        sectionType: "project",
        normalizedText: text,
        structuredItem: {
          id: stableHashText(title).slice(0, 12),
          sectionType: "project",
          title,
          role: "参与者",
          description: text,
          current: false,
          tools: ["RPA"],
          highlights: ["数据采集"],
          outcomes: [],
          customFields: []
        },
        confidence: 0.9,
        needsConfirmation: false,
        needsNormalization: false,
        fieldEvidence: [{
          field: "description",
          sourceQuote: text,
          support: "explicit",
          confidence: 0.9,
          needsConfirmation: false
        }]
      }
    }]
  };
}
