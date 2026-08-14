import { afterEach, describe, expect, it, vi } from "vitest";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import type { CareerToolContract } from "@/agent/tools/CareerToolGateway";
import { classifyCareerTask, classifyTurnIntent } from "@/agent/runtime/AgentTurnIntent";
import { logicalToolOperationId } from "@/agent/runtime/hermes/HermesBridgeTransport";
import {
  classifyHermesRunFailure,
  createHermesRunFailure
} from "@/agent/runtime/hermes/hermesRunReliability";
import {
  clearHermesRunReadiness,
  readHermesRunReadiness,
  recordHermesRunStartFailure,
  recordHermesRunStartSuccess
} from "@/agent/runtime/hermes/hermesRunReadiness";
import { hermesProductionToolNames } from "@/agent/runtime/hermes/HermesCareerToolCatalog";
import {
  registerCareerAdaptMcpBridge,
  createCareerAdaptMcpBridgeGateway,
  disconnectCareerAdaptMcpBridge
} from "@/server/careerAdaptMcpBridgeRegistry";
import { demoCareerProfile } from "@/data/demoProfile";
import {
  CareerContextRetrieveInputSchema,
  retrieveCareerContext
} from "@/domain/careerContext/retrieveCareerContext";
import { CareerProfileSchema } from "@/domain/schemas";
import { sanitizeRuntimeFailureDiagnostics } from "@/components/agent/AgentWorkspace";

describe("P4.5c.1.8 Hermes conversational career agent", () => {
  const runtimeUrl = "http://hermes-p45c18.test";

  afterEach(() => {
    clearHermesRunReadiness(runtimeUrl);
  });

  it("retrieves confirmed evidence without returning a profile-shaped blob", () => {
    const result = retrieveCareerContext({
      request: CareerContextRetrieveInputSchema.parse({
        profileId: demoCareerProfile.id,
        query: "哪些项目能证明我的数据分析能力？",
        intent: "evidence_search",
        targetText: "需要 Python 项目经验"
      }),
      profile: demoCareerProfile
    });

    expect(result.facts.some((fact) => fact.factId === "fact-stat-stata")).toBe(true);
    expect(result.facts.find((fact) => fact.factId === "fact-stat-stata")?.evidenceRefs).toContain("evidence-stat-report");
    expect(result).not.toHaveProperty("profile.experiences");
    expect(result.unsupportedClaims.some((claim) => /python/i.test(claim))).toBe(true);
    expect(result.sourceSummary.excludedSourceTypes).toEqual(expect.arrayContaining(["unconfirmed", "stale_derived"]));
  });

  it("excludes an unconfirmed fact even when its text matches the query", () => {
    const uncertain = CareerProfileSchema.parse({
      ...demoCareerProfile,
      experiences: demoCareerProfile.experiences.map((experience, index) => index === 0
        ? {
            ...experience,
            facts: experience.facts.map((fact) => ({
              ...fact,
              confirmedByUser: false,
              provenance: fact.provenance.map((source) => ({ ...source, confirmedByUser: false }))
            }))
          }
        : experience)
    });
    const result = retrieveCareerContext({
      request: CareerContextRetrieveInputSchema.parse({ profileId: uncertain.id, query: "Stata 数据清洗" }),
      profile: uncertain
    });

    expect(result.facts.some((fact) => fact.factId === "fact-stat-stata")).toBe(false);
  });

  it("keeps natural Q&A conversational and escalates explicit resume work", () => {
    for (const text of [
      "申请理由：结合我的真实经历写 150 字",
      "你觉得我最适合讲哪个项目？",
      "Python 水平怎么样？",
      "请给我三个优势",
      "面试时如何回答问题解决能力？",
      "这个岗位适合我吗？",
      "我有没有做过能证明数据分析能力的事情？",
      "我的资料里有没有和 AI 有关的东西？"
    ]) {
      expect(classifyTurnIntent({ text }).taskMutation).toBe("preserve");
      expect(classifyCareerTask({ text }).taskClass).toBe("ConversationalCareerTask");
    }
    expect(classifyTurnIntent({ text: "用我的资料库生成一份岗位简历" }).newTask?.workflowId).toBe("compose_resume");
    expect(classifyCareerTask({ text: "上传一份简历并导入资料库" }).taskClass).toBe("TransactionalCareerWorkflow");
  });

  it("keeps the production MCP boundary high-level while preserving internal contracts", () => {
    const contracts = [
      contract("career.context.retrieve", "retrieve_career_context"),
      contract("career.workflow.compose_resume", "career.workflow.compose_resume"),
      contract("career.resume.compose", "compose_resume")
    ];
    const registration = registerCareerAdaptMcpBridge(contracts);
    try {
      const production = createCareerAdaptMcpBridgeGateway("hermes-production").listContracts().map((item) => item.name);
      const internal = createCareerAdaptMcpBridgeGateway("internal").listContracts().map((item) => item.name);
      expect(production).toEqual(expect.arrayContaining(["career.context.retrieve", "career.workflow.compose_resume"]));
      expect(production).not.toContain("career.resume.compose");
      expect(internal).toContain("career.resume.compose");
      expect(hermesProductionToolNames().has("career.context.retrieve")).toBe(true);
    } finally {
      disconnectCareerAdaptMcpBridge(registration.bridgeId, registration.token);
    }
  });

  it("keeps a local run-start failure authoritative until a real success", () => {
    recordHermesRunStartFailure(runtimeUrl, {
      code: "upstream_busy",
      message: "upstream temporarily unavailable",
      httpStatus: 503,
      runStartKind: "new"
    });
    const failed = readHermesRunReadiness(runtimeUrl);
    expect(failed).toMatchObject({ ready: false, safeErrorCode: "hermes_run_start_http_failed" });
    expect(failed?.runtimeFailureDiagnostics).toMatchObject({ failureLayer: "bridge_http", httpStatus: 503 });

    vi.useFakeTimers();
    vi.advanceTimersByTime(60_000);
    expect(readHermesRunReadiness(runtimeUrl)?.ready).toBe(false);
    vi.useRealTimers();

    recordHermesRunStartSuccess(runtimeUrl);
    expect(readHermesRunReadiness(runtimeUrl)?.ready).toBe(true);
  });

  it("classifies the common run_start failure layers and carries one logical ID", async () => {
    expect(classifyHermesRunFailure({ httpStatus: 401, code: "auth_failed" }).safeErrorCode).toBe("hermes_provider_auth_failed");
    expect(classifyHermesRunFailure({ httpStatus: 409, code: "conflict" }).safeErrorCode).toBe("hermes_active_run_conflict");
    expect(classifyHermesRunFailure({ code: "timeout" }).safeErrorCode).toBe("hermes_run_start_timeout");
    expect(classifyHermesRunFailure({ code: "invalid_run" }).safeErrorCode).toBe("hermes_run_start_invalid_response");
    expect(classifyHermesRunFailure({ code: "hermes_provider_unconfigured", httpStatus: 503 }).safeErrorCode).toBe("hermes_provider_unconfigured");

    const logical = logicalToolOperationId({ turnId: "turn-1", stableToolName: "career.context.retrieve" });
    expect(logical).toBe("hermes-tool-turn-1-career.context.retrieve");
    const captured: Array<{ operationId?: string; logicalToolOperationId?: string }> = [];
    const adapter = new CareerAdaptMcpAdapter({
      listContracts: () => [contract("career.context.retrieve", "retrieve_career_context")],
      execute: async (_name, _input, context) => {
        captured.push({ operationId: context?.operationId, logicalToolOperationId: context?.logicalToolOperationId });
        return {
          ok: true,
          data: { facts: [] },
          artifacts: [],
          receipt: { operationId: context?.operationId ?? "mcp-career-test", toolName: "career.context.retrieve", status: "completed", completedAt: new Date().toISOString() }
        };
      }
    });
    await adapter.callTool("career.context.retrieve", {}, { operationId: "mcp-career-operation", logicalToolOperationId: logical });
    expect(captured).toEqual([{ operationId: "mcp-career-operation", logicalToolOperationId: logical }]);
    expect(createHermesRunFailure({ code: "hermes_run_start_failed", httpStatus: 429 }).diagnostics).toMatchObject({ retryable: true, httpStatus: 429 });
  });

  it("exports only safe runtime failure diagnostics", () => {
    expect(sanitizeRuntimeFailureDiagnostics({
      failureLayer: "provider",
      safeErrorCode: "hermes_provider_auth_failed",
      safeErrorMessage: "Bearer secret-token",
      retryable: false,
      httpStatus: 401,
      privatePrompt: "do not export"
    })).toEqual({
      failureLayer: "provider",
      safeErrorCode: "hermes_provider_auth_failed",
      safeErrorMessage: "Bearer [redacted]",
      retryable: false,
      httpStatus: 401
    });
  });
});

function contract(name: string, sourceToolName: string): CareerToolContract {
  return {
    name,
    description: name,
    sourceToolName,
    namespace: name.split(".").slice(0, 2).join("."),
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    readWrite: name.includes("workflow") ? "write" as const : "read" as const,
    safetyClass: name.includes("workflow") ? "SAFE_WRITE" as const : "READ" as const,
    confirmationPolicy: "none" as const,
    idempotencyKeyPolicy: name.includes("workflow") ? "operation_id" as const : "none" as const,
    personProfileBinding: name.includes("context") || name.includes("workflow") ? "required" as const : "none" as const,
    artifactBehavior: name.includes("workflow") ? "produces_artifact" as const : "none" as const,
    errorTaxonomy: ["validation", "not_found", "recoverable", "internal"]
  };
}
