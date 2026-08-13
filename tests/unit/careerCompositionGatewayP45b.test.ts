import { describe, expect, it } from "vitest";
import {
  CAREER_WORKFLOW_FACADE_DEFINITIONS,
  executeCareerWorkflowFacade
} from "@/agent/workflows/CareerWorkflowFacade";
import type { CareerToolResult } from "@/agent/tools/CareerToolGateway";

const input = {
  profileId: "profile-1",
  expectedProfileRevision: 3,
  mode: "general" as const
};

function result(toolName: string, data: unknown): CareerToolResult {
  return {
    ok: true,
    data,
    artifacts: [],
    receipt: {
      operationId: `atomic-${toolName}`,
      toolName,
      status: "completed",
      completedAt: "2026-08-01T00:00:00.000Z"
    }
  };
}

describe("P4.5b composition workflow boundary", () => {
  it("shows the proposal before calling the write tool, then composes after confirmation", async () => {
    const calls: string[] = [];
    const executeAtomic = async (name: string) => {
      calls.push(name);
      if (name === "career.resume.plan_composition") {
        return result(name, {
          checkpointId: "checkpoint-1",
          compositionProposal: { title: "通用简历组装预览" },
          evidenceGraph: { nodes: [], edges: [] },
          blueprint: { informationNeeds: [] },
          reviewResult: { status: "PASS" },
          metrics: { unsupportedClaims: 0 },
          keywordCoverage: [],
          informationNeeds: []
        });
      }
      return result(name, { resumeId: "resume-1", composition: { profileId: input.profileId } });
    };

    const pending = await executeCareerWorkflowFacade(
      "career.workflow.compose_resume",
      input,
      { confirmed: false, confirmationCount: 0 },
      "compose-operation",
      executeAtomic
    );

    expect(pending.data.status).toBe("waiting_for_confirmation");
    expect(calls).toEqual(["career.resume.plan_composition"]);

    const checkpointId = pending.data.workflowCheckpoint.checkpointId;
    const completed = await executeCareerWorkflowFacade(
      "career.workflow.compose_resume",
      { ...input, checkpointId },
      { confirmed: true, confirmationCount: 1 },
      "compose-operation-confirmed",
      executeAtomic
    );

    expect(completed.data.status).toBe("completed");
    expect(completed.data.workflowCheckpoint.checkpointId).toBe("checkpoint-1");
    expect(calls).toEqual(["career.resume.plan_composition", "career.resume.compose"]);
  });

  it("publishes the composition facade as a stable career contract", () => {
    expect(CAREER_WORKFLOW_FACADE_DEFINITIONS.some((definition) => definition.name === "career.workflow.compose_resume")).toBe(true);
  });
});
