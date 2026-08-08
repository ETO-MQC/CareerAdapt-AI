import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentExecutor } from "@/agent/runtime/agentExecutor";
import { AgentRuntimeRouter } from "@/agent/runtime/AgentRuntimeRouter";
import { NativeCareerAgentRuntime } from "@/agent/runtime/NativeCareerAgentRuntime";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { appendProfileIntakeQuestionAnswer } from "@/domain/profileIntake/ProfileIntakeQuestionAnswer";

const AnyInput = z.object({}).passthrough();
const AnyOutput = z.object({}).passthrough();

describe("P4.4a runtime and career tool boundaries", () => {
  it("defaults to native and keeps Hermes an explicit optional route", () => {
    const native = new NativeCareerAgentRuntime({ runTurn: async () => ({ ok: true }) });
    const router = new AgentRuntimeRouter({ native });

    expect(router.configurationSnapshot.agentRuntime).toBe("native");
    expect(router.active()).toBe(native);
    expect(() => router.resolve("hermes")).toThrowError(/unavailable/iu);
  });

  it("exposes progress/completion events and lifecycle capabilities", async () => {
    const native = new NativeCareerAgentRuntime({
      runTurn: async () => ({ result: "done" }),
      pause: () => undefined,
      interrupt: () => undefined,
      resume: () => undefined
    });
    const events = [];
    for await (const event of native.runTurn({
      sessionId: "session-p44a",
      userMessage: "继续",
      pageContext: { query: {} }
    })) events.push(event);

    expect(events.map((event) => event.type)).toEqual(["reasoning_status", "progress", "turn_completed"]);
    expect(events.at(-1)?.data).toEqual({ result: "done" });
    expect(native.capabilities()).toMatchObject({
      streaming: true,
      interruptible: true,
      resumable: true,
      toolCalls: true,
      approvals: true
    });
  });

  it("maps stable career namespaces to typed receipts and error taxonomy", async () => {
    const registry = new AgentToolRegistry([
      tool("list_profiles", false, async () => ({ profiles: [{ id: "profile-1" }] })),
      tool("get_profile", false, async () => ({ profile: { id: "profile-1" } })),
      tool("commit_profile_intake", true, async () => ({ committed: true }))
    ]);
    const gateway = new CareerToolGateway({ registry, executor: new AgentExecutor(registry) });

    expect(gateway.listContracts().map((contract) => contract.name)).toEqual(expect.arrayContaining([
      "career.profile.list",
      "career.profile.get",
      "career.profile.commit_intake"
    ]));

    const read = await gateway.execute("career.profile.list", {}, { operationId: "p44a-read-01" });
    expect(read).toMatchObject({
      ok: true,
      data: { profiles: [{ id: "profile-1" }] },
      receipt: { operationId: "p44a-read-01", toolName: "career.profile.list", status: "completed" }
    });

    const confirmation = await gateway.execute("career.profile.commit_intake", {}, { operationId: "p44a-write-01" });
    expect(confirmation).toMatchObject({
      ok: false,
      error: { code: "agent_confirmation_required", category: "permission" },
      receipt: { status: "confirmation_required" }
    });

    const unknown = await gateway.execute("career.profile.nope", {});
    expect(unknown).toMatchObject({
      ok: false,
      error: { code: "unknown_career_tool", category: "not_found" }
    });
  });

  it("keeps the question ledger exact-once by question and source turn", () => {
    const entry = {
      questionId: "question-1",
      candidateId: "candidate-1",
      dimension: "tools_methods",
      sourceTurnId: "turn-1",
      answerRevision: 2,
      status: "answered" as const,
      capturedAt: "2026-08-08T01:00:00.000Z"
    };
    const first = appendProfileIntakeQuestionAnswer([], entry);
    const second = appendProfileIntakeQuestionAnswer(first.answers, { ...entry, answerRevision: 3 });

    expect(first.appended).toBe(true);
    expect(second.appended).toBe(false);
    expect(second.answers).toHaveLength(1);
    expect(second.answers[0].answerRevision).toBe(2);
  });
});

function tool(name: string, requiresConfirmation: boolean, execute: () => Promise<unknown>) {
  return {
    name,
    description: `Test ${name}`,
    risk: requiresConfirmation ? "write" as const : "read" as const,
    requiresConfirmation,
    idempotent: true,
    resumable: true,
    category: "test",
    dataScope: "career",
    producesArtifact: false,
    external: false,
    inputSchema: AnyInput,
    outputSchema: AnyOutput,
    execute
  };
}
