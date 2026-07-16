import { describe, expect, it, vi } from "vitest";
import {
  classifyJobAiFailure,
  commitParsedJob,
  JobWorkflowError,
  MIN_JD_TEXT_LENGTH,
  updateRequirementConfirmation,
  validateJobInput
} from "@/services/jobs/jobWorkflow";
import type { JobAnalysisDraft, RawInputDocument } from "@/domain/schemas";

const now = "2026-07-16T12:00:00.000Z";
const rawInput: RawInputDocument = {
  id: "raw-job-workflow",
  kind: "job_jd",
  rawText: "负责数据分析与报表建设，要求熟练使用 SQL，并能与业务团队协作。",
  inputHash: "job-workflow-hash",
  title: "示例公司 / 数据分析师",
  createdAt: now,
  updatedAt: now
};

function createDraft(confirmedByUser = true): JobAnalysisDraft {
  return {
    id: "job-draft-workflow",
    rawInputId: rawInput.id,
    revision: 2,
    title: "数据分析师",
    company: "示例公司",
    status: "manual_mode",
    promptVersion: "jd-analyzer.v1",
    attemptCount: 1,
    manualRequirements: [
      {
        id: "requirement-workflow",
        category: "required_skill",
        description: "熟练使用 SQL",
        priority: "important",
        hardConstraint: true,
        sourceQuote: "要求熟练使用 SQL",
        sourceSpan: { start: 10, end: 20, text: "要求熟练使用 SQL" },
        keywords: ["SQL"],
        confidenceLevel: "low",
        confidenceReason: "手动分类",
        needsConfirmation: !confirmedByUser,
        confirmedByUser,
        createdAt: now,
        updatedAt: now
      }
    ],
    riskNotes: [],
    createdAt: now,
    updatedAt: now
  };
}

describe("job workflow", () => {
  it("accepts a normal JD and trims user input", () => {
    expect(validateJobInput({
      title: " 数据分析师 ",
      company: " 示例公司 ",
      rawText: ` ${rawInput.rawText} `
    })).toEqual({
      title: "数据分析师",
      company: "示例公司",
      rawText: rawInput.rawText
    });
  });

  it("distinguishes empty and short JD input", () => {
    expect(() => validateJobInput({ title: "岗位", company: "公司", rawText: "" }))
      .toThrowError(expect.objectContaining({ state: expect.objectContaining({ code: "empty_input" }) }));
    expect(() => validateJobInput({ title: "岗位", company: "公司", rawText: "太短" }))
      .toThrowError(expect.objectContaining({ state: expect.objectContaining({ code: "text_too_short" }) }));
    expect(MIN_JD_TEXT_LENGTH).toBeGreaterThan(2);
  });

  it("distinguishes schema validation from invalid AI output", () => {
    expect(classifyJobAiFailure("client_schema_validation_failed").state.code).toBe("schema_validation_failed");
    expect(classifyJobAiFailure("provider_empty_output").state.code).toBe("ai_invalid_output");
  });

  it("updates manual classification locally without mutating the previous draft", () => {
    const draft = createDraft(false);
    const updated = updateRequirementConfirmation(draft, "requirement-workflow", true);

    expect(draft.manualRequirements[0].confirmedByUser).toBe(false);
    expect(updated.status).toBe("editing");
    expect(updated.manualRequirements[0]).toMatchObject({
      confirmedByUser: true,
      needsConfirmation: false
    });
  });

  it("rejects a formal save when no confirmed locatable requirement remains", async () => {
    const repository = { commitJobDraft: vi.fn() };

    await expect(commitParsedJob({
      repository: repository as never,
      draft: createDraft(false),
      rawInput
    })).rejects.toMatchObject({
      state: expect.objectContaining({ code: "schema_validation_failed" })
    });
    expect(repository.commitJobDraft).not.toHaveBeenCalled();
  });

  it("maps repository failures to a retryable save error", async () => {
    const repository = {
      commitJobDraft: vi.fn().mockRejectedValue(new Error("indexeddb unavailable"))
    };

    await expect(commitParsedJob({
      repository: repository as never,
      draft: createDraft(true),
      rawInput
    })).rejects.toEqual(expect.any(JobWorkflowError));
    await expect(commitParsedJob({
      repository: repository as never,
      draft: createDraft(true),
      rawInput
    })).rejects.toMatchObject({
      state: expect.objectContaining({
        code: "repository_save_failed",
        retryable: true
      })
    });
  });
});
