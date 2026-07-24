import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AgentExecutor, AgentConfirmationRequiredError } from "@/agent/runtime/agentExecutor";
import { AgentToolRegistry, createAgentToolRegistry, type AgentToolServices } from "@/agent/tools/registry";

function services(): AgentToolServices {
  const result = async () => ({ value: "ok" });
  return {
    listResumes: result,
    listProfiles: result,
    listJobs: result,
    parseResumeFile: result,
    createResumeImportDraft: result,
    commitResumeImport: result,
    parseJobDescription: result,
    commitJob: result,
    analyzeJobFit: result,
    createTailoringSession: result,
    answerTailoringQuestion: result,
    previewTailoringChanges: result,
    applyTailoringChanges: result,
    exportResume: result
  };
}

describe("agent tool registry", () => {
  it("rejects unknown tools and exposes the required policy metadata", () => {
    const registry = createAgentToolRegistry(services());
    expect(() => registry.require("drop_database")).toThrow("Unknown agent tool");
    expect(registry.list()).toHaveLength(14);
    expect(registry.require("list_resumes")).toMatchObject({ risk: "read", requiresConfirmation: false });
    expect(registry.require("commit_job")).toMatchObject({ risk: "write", requiresConfirmation: true });
    expect(registry.require("answer_tailoring_question")).toMatchObject({ risk: "user_declared", requiresConfirmation: true });
    expect(registry.require("apply_tailoring_changes")).toMatchObject({ risk: "write", requiresConfirmation: true });
  });

  it("validates tool input and output schemas", async () => {
    const registry = createAgentToolRegistry(services());
    await expect(registry.execute("parse_job_description", { title: "", company: "A", rawText: "short" }, "operation-valid-1")).rejects.toThrow();

    const invalidOutput = new AgentToolRegistry([{
      name: "invalid_output",
      description: "test",
      risk: "read",
      requiresConfirmation: false,
      idempotent: true,
      resumable: true,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ operationId: z.string(), value: z.number() }),
      execute: vi.fn(async () => ({ operationId: "operation-valid-2", value: "wrong" }))
    }]);
    const result = await invalidOutput.execute("invalid_output", {}, "operation-valid-2");
    expect(result.ok).toBe(false);
  });

  it("enforces confirmation and operationId idempotency", async () => {
    const execute = vi.fn(async () => ({ operationId: "apply-operation-1", revisionId: "revision-2" }));
    const registry = new AgentToolRegistry([{
      name: "apply",
      description: "apply",
      risk: "write",
      requiresConfirmation: true,
      idempotent: true,
      resumable: true,
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ operationId: z.string(), revisionId: z.string() }),
      execute
    }]);
    const executor = new AgentExecutor(registry);
    await expect(executor.execute({ toolName: "apply", toolInput: {}, operationId: "apply-operation-1" }))
      .rejects.toBeInstanceOf(AgentConfirmationRequiredError);
    const first = await executor.execute({ toolName: "apply", toolInput: {}, operationId: "apply-operation-1", confirmed: true });
    const second = await executor.execute({ toolName: "apply", toolInput: {}, operationId: "apply-operation-1", confirmed: true });
    expect(first).toEqual(second);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
