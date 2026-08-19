import { describe, expect, it, vi } from "vitest";
import { CareerAdaptMcpBridgeClient } from "@/agent/mcp/CareerAdaptMcpBridgeClient";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import {
  CAREER_TOOL_CONTRACT_VERSION,
  TailorResumeInputSchema,
  normalizeTailorResumeInput,
  runCareerToolContractSelfTest
} from "@/agent/tools/careerToolContract";
import { AgentToolRegistry } from "@/agent/tools/registry";

describe("P4.5c.1.16 canonical Career tool contract closure", () => {
  it("publishes one canonical tailor schema and passes the deterministic self-test", () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const contract = gateway.getContract("career.workflow.tailor_resume");
    const representative = {
      profileId: "profile-contract-test",
      sourceResumeId: "resume-contract-test",
      targetText: "A representative external job description with enough detail."
    };

    expect(TailorResumeInputSchema.safeParse(representative).success).toBe(true);
    expect(runCareerToolContractSelfTest([contract])).toMatchObject({
      ready: true,
      contractVersion: CAREER_TOOL_CONTRACT_VERSION,
      mismatches: []
    });
    expect(contract.contractSchemaHash).toEqual(expect.stringMatching(/^fnv1a-[0-9a-f]{8}$/));
  });

  it("normalizes only documented legacy target aliases at the Facade boundary", () => {
    expect(normalizeTailorResumeInput({
      profileId: "profile-legacy",
      resumeId: "resume-legacy",
      target: "A legacy external job description with enough detail."
    })).toEqual({
      profileId: "profile-legacy",
      sourceResumeId: "resume-legacy",
      targetText: "A legacy external job description with enough detail."
    });

    expect(normalizeTailorResumeInput({
      profileId: "profile-legacy",
      sourceResumeId: "resume-legacy",
      targetText: "A legacy external job description with enough detail.",
      target: "A legacy external job description with enough detail."
    })).toEqual({
      profileId: "profile-legacy",
      sourceResumeId: "resume-legacy",
      targetText: "A legacy external job description with enough detail."
    });

    expect(normalizeTailorResumeInput({
      profileId: "profile-legacy",
      target: { type: "saved_job", jobId: "job-legacy" }
    })).toEqual({ profileId: "profile-legacy", jobId: "job-legacy" });
  });

  it("exports safe schema issues and contract identity without input values", async () => {
    const rawTarget = "raw-target-value-must-not-leak";
    const result = await new CareerToolGateway(new AgentToolRegistry([])).execute("career.workflow.tailor_resume", {
      profileId: "profile-invalid",
      targetText: "too-short"
    }, {
      operationId: "contract-invalid-operation",
      logicalToolOperationId: "contract-invalid-logical",
      logicalTurnId: "contract-invalid-turn"
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "schema_validation_failed",
        scope: "career_workflow",
        invalidFields: ["targetText"],
        acceptedShapeHint: { requiredOneOf: ["targetText", "jobId", "checkpointId"] }
      },
      diagnostics: {
        failureKind: "gateway_validation_failed",
        safeDomainErrorCode: "schema_validation_failed",
        publishedContractVersion: CAREER_TOOL_CONTRACT_VERSION,
        gatewayContractVersion: CAREER_TOOL_CONTRACT_VERSION,
        publishedSchemaHash: expect.stringMatching(/^fnv1a-/),
        gatewaySchemaHash: expect.stringMatching(/^fnv1a-/),
        schemaIssues: [expect.objectContaining({ path: "targetText", code: "too_small" })]
      }
    });
    expect(JSON.stringify(result.diagnostics)).not.toContain(rawTarget);
    expect(JSON.stringify(result.diagnostics)).not.toContain("too-short");
  });

  it("returns target_required when an external caller omits every explicit target", async () => {
    const result = await new CareerToolGateway(new AgentToolRegistry([])).execute(
      "career.workflow.tailor_resume",
      {},
      { operationId: "target-required-operation" }
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ code: "target_required", recoverable: false });
    expect(result.diagnostics).toMatchObject({
      safeDomainErrorCode: "target_required",
      toolFailureLayer: "gateway_validation"
    });
  });

  it("fails readiness before execution when the published contract drifts", () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const contract = gateway.getContract("career.workflow.tailor_resume");
    const result = runCareerToolContractSelfTest([{
      ...contract,
      contractVersion: "career-tool-contract-stale"
    }]);

    expect(result).toMatchObject({
      ready: false,
      reason: "career_tool_contract_mismatch",
      mismatches: [{ toolName: "career.workflow.tailor_resume", reason: "version" }]
    });
  });

  it("projects one correction for a repeated non-retryable invalid call", async () => {
    const gateway = new CareerToolGateway(new AgentToolRegistry([]));
    const executeSpy = vi.spyOn(gateway, "execute");
    const client = new CareerAdaptMcpBridgeClient();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const internal = client as unknown as {
        gateway: typeof gateway;
        bridgeId: string;
        token: string;
        stopped: boolean;
        execute(request: unknown): Promise<void>;
      };
      internal.gateway = gateway;
      internal.bridgeId = "bridge-contract-test";
      internal.token = "token-contract-test";
      internal.stopped = false;
      const request = (operationId: string) => ({
        id: `request-${operationId}`,
        name: "career.workflow.tailor_resume",
        input: { profileId: "profile-invalid", targetText: "too-short" },
        operationId,
        logicalToolOperationId: "career-logical-contract-turn-tailor",
        logicalTurnId: "contract-turn-duplicate",
        requireSessionBinding: false
      });

      await internal.execute(request("operation-one"));
      await internal.execute(request("operation-two"));

      expect(executeSpy).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const first = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { result: { error?: { code?: string }; diagnostics?: Record<string, unknown> } };
      const second = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { result: { error?: { code?: string }; diagnostics?: Record<string, unknown> } };
      expect(first.result.error?.code).toBe("schema_validation_failed");
      expect(second.result.error?.code).toBe("career_agent_duplicate_invalid_call");
      expect(second.result.diagnostics).toMatchObject({
        duplicateProjection: true,
        safeDomainErrorCode: "career_agent_duplicate_invalid_call",
        failureKind: "gateway_validation_failed",
        duplicateOfOperationId: "operation-one",
        previousSchemaFingerprint: expect.any(String),
        previousArgumentShapeFingerprint: expect.any(String)
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
