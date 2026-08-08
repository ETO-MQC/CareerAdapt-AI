import { describe, expect, it } from "vitest";
import { ProfileIntakeSemanticService, type ProfileIntakeFollowUpPatchInput } from "@/domain/profileIntake/ProfileIntakeSemanticService";
import { salvageProfileIntakeFollowUpPatch } from "@/domain/profileIntake/ProfileIntakeNormalizer";
import { ResumeItemV2Schema } from "@/domain/schemas";
import { aiTaskRegistry } from "@/ai/tasks/registry";

const item = ResumeItemV2Schema.parse({
  id: "candidate-p44b",
  sectionType: "project",
  title: "穿戴设备",
  role: "协助开发",
  description: "完成心跳模块和蓝牙连接。",
  tools: [],
  highlights: [],
  outcomes: [],
  customFields: []
});

describe("P4.4b typed profile-intake follow-up patch", () => {
  it("salvages changed grounded fields and quarantines malformed or unsupported fields", () => {
    const answer = "最后集成了一个可以检测心跳和判断跌倒的板子，并且通过蓝牙连接";
    const result = salvageProfileIntakeFollowUpPatch({
      item,
      evidenceQuote: answer,
      rawPatch: {
        outcomes: [answer],
        highlights: "not-an-array",
        title: "未在回答中出现的新标题",
        inventedField: "drop me"
      }
    });
    expect(result.patch).toMatchObject({ outcomes: [answer] });
    expect(result.patch).not.toHaveProperty("title");
    expect(result.patch).not.toHaveProperty("inventedField");
    expect(result.quarantinedFields).toEqual(expect.arrayContaining([
      "invalid:highlights",
      "unsupported:inventedField"
    ]));
  });

  it("uses the dedicated task and corrects an unsafe provider quote locally", async () => {
    let received: ProfileIntakeFollowUpPatchInput | undefined;
    const service = new ProfileIntakeSemanticService(
      async () => ({ ok: false as const, errorCode: "unused" }),
      async (input) => {
        received = input;
        return {
          ok: true as const,
          data: {
            candidateId: "wrong-candidate",
            patch: { outcomes: [input.currentUserAnswer] },
            evidenceQuote: "not in answer",
            answeredDimension: "wrong-dimension",
            confidence: 0.88
          },
          diagnostics: { provider: "test", model: "test-model", attempt: 1, latencyMs: 3 }
        };
      }
    );
    const answer = "通过蓝牙连接并实时观测数据";
    const result = await service.proposeFollowUpPatch({
      candidateId: item.id,
      sectionType: "project",
      expectedDimension: "result",
      currentStructuredItem: item,
      currentUserAnswer: answer,
      relevantSourceTurns: [{ turnId: "turn-prior", sourceText: "项目原始回答" }]
    });
    expect(received?.candidateId).toBe(item.id);
    expect(result).toMatchObject({
      candidateId: item.id,
      answeredDimension: "result",
      evidenceQuote: answer,
      safeDiagnostics: { semanticTask: "profile-intake-follow-up-patch" }
    });
  });

  it("falls back to a grounded local patch when the dedicated provider fails", async () => {
    const service = new ProfileIntakeSemanticService(
      async () => ({ ok: false as const, errorCode: "unused" }),
      async () => ({
        ok: false as const,
        errorCode: "provider_timeout",
        diagnostics: { provider: "test", model: "test-model", attempt: 1, latencyMs: 7 }
      })
    );
    const answer = "结果是通过蓝牙连接并实时观测数据";
    const result = await service.proposeFollowUpPatch({
      candidateId: item.id,
      sectionType: "project",
      expectedDimension: "result",
      currentStructuredItem: item,
      currentUserAnswer: answer,
      relevantSourceTurns: []
    });

    expect(result.mode).toBe("local");
    expect(result.patch).toEqual({ outcomes: [answer] });
    expect(result.safeDiagnostics).toMatchObject({
      semanticTask: "profile-intake-follow-up-patch",
      code: "provider_timeout",
      patchStage: "provider",
      schemaStage: "partial",
      groundingStage: "partial",
      repositoryStage: "pending"
    });
  });

  it("keeps the task registry output tolerant so local salvage can run", () => {
    const input = {
      candidateId: item.id,
      sectionType: "project" as const,
      expectedDimension: "result",
      currentStructuredItem: item,
      currentUserAnswer: "结果是通过蓝牙连接",
      relevantSourceTurns: [],
      inputHash: "p44b-follow-up-hash"
    };
    const coerced = aiTaskRegistry["profile-intake-follow-up-patch"].coerceRawOutput({
      candidateId: item.id,
      patch: { outcomes: "malformed optional list" },
      evidenceQuote: input.currentUserAnswer,
      answeredDimension: "result",
      confidence: 0.5
    }, input);
    expect(aiTaskRegistry["profile-intake-follow-up-patch"].normalizeOutput(coerced as never).patch).toEqual({ outcomes: "malformed optional list" });
  });
});
