import { describe, expect, it } from "vitest";
import { CareerAdaptMcpAdapter } from "@/agent/mcp/CareerAdaptMcpAdapter";
import { AgentTaskStateSchema } from "@/agent/contracts/agentSession";
import { AgentTaskStateReducer } from "@/agent/runtime/AgentTaskStateReducer";
import {
  resolveTurnScopedTailoringInput
} from "@/agent/workflows/CareerWorkflowFacade";
import { safeCareerToolArgumentShape } from "@/agent/tools/careerToolDiagnostics";
import { mapOfficialHermesEvent } from "@/agent/runtime/hermes/HermesBridgeTransport";
import { CareerToolGateway } from "@/agent/tools/CareerToolGateway";
import { AgentToolRegistry } from "@/agent/tools/registry";
import { editorHtmlToExperienceDocument, experienceDocumentToEditorHtml, experienceEditorContentCounts } from "@/components/editor/helpers";
import { buildProfileContentIntegrity } from "@/domain/profile/profileContentIntegrity";
import { demoCareerProfile } from "@/data/demoProfile";

describe("P4.5c.1.18 turn-scoped tailoring and live profile integrity", () => {
  it("resolves an omitted Hermes target only from the current persisted UserMessage", () => {
    const state = AgentTaskStateSchema.parse({
      rootGoal: "conversation",
      workflowId: "conversation",
      stage: "collecting_intent",
      completionType: "conversational",
      updatedAt: "2026-08-18T00:00:00.000Z"
    });
    const prepared = new AgentTaskStateReducer().reduce(state, {
      type: "new_root_task",
      goal: "generate_job_specific_resume",
      workflowId: "tailor_resume",
      stage: "choose_resume_source"
    });
    const targetText = [
      "岗位职责 Responsibilities：负责跨团队项目交付、用户流程设计与质量闭环。",
      "任职要求 Requirements：熟悉 TypeScript、React、证据链和可回归测试。",
      "补充信息：",
      "x".repeat(260)
    ].join("\n");
    const next = new AgentTaskStateReducer().reduce(prepared, {
      type: "user_message",
      message: targetText,
      sessionId: "session-1",
      turnId: "turn-current",
      capturedAt: "2026-08-18T00:00:00.000Z"
    });
    const resolved = resolveTurnScopedTailoringInput({}, {
      logicalTurnId: "turn-current",
      authoritativeTaskState: next,
      sourceUserMessageId: "message-current",
      sourceUserMessage: targetText
    });
    expect(resolved.sameTurnTarget).toBe(true);
    expect(resolved.input).toMatchObject({ targetText });

    const previousTurn = resolveTurnScopedTailoringInput({}, {
      logicalTurnId: "turn-previous",
      authoritativeTaskState: next
    });
    expect(previousTurn).toEqual({ input: {}, sameTurnTarget: false });
  });

  it("keeps Hermes, MCP and Gateway logical identity deterministic when MCP metadata carries a turn", async () => {
    const contract = new CareerToolGateway(new AgentToolRegistry([])).getContract("career.workflow.tailor_resume");
    let receivedLogicalId = "";
    const adapter = new CareerAdaptMcpAdapter({
      listContracts: () => [contract],
      execute: async (_name, _input, context) => {
        receivedLogicalId = context?.logicalToolOperationId ?? "";
        return {
          ok: true,
          data: { status: "waiting_for_user" },
          artifacts: [],
          receipt: {
            operationId: context?.operationId ?? "operation-1",
            toolName: "career.workflow.tailor_resume",
            status: "completed",
            completedAt: "2026-08-18T00:00:00.000Z"
          }
        };
      }
    });

    await adapter.callTool("career.workflow.tailor_resume", {}, { operationId: "mcp-transport-operation-1", logicalTurnId: "turn-logical-1" });
    expect(receivedLogicalId).toBe("mcp-transport-operation-1");
  });

  it("records safe argument shapes without copying the pasted target", () => {
    const targetText = "A private job description that must not be present in diagnostics.";
    const shape = safeCareerToolArgumentShape({ targetText, jobId: "job-1" });
    expect(shape.targetText).toMatchObject({ present: true, lengthBucket: "length:21-200" });
    expect((shape.targetText as { hashPrefix?: string }).hashPrefix).toMatch(/^fnv-/u);
    expect(JSON.stringify(shape)).not.toContain(targetText);
    expect(shape.jobId).toMatchObject({ present: true, lengthBucket: "length:1-20" });
  });

  it("records the Hermes boundary shape while removing raw tool arguments from the event projection", () => {
    const targetText = "A private external job description that must not be exported.";
    const event = mapOfficialHermesEvent("tool.started", {
      tool_name: "career.workflow.tailor_resume",
      tool_call_id: "tool-shape-1",
      input: { targetText }
    });
    expect(event).toMatchObject({
      type: "tool_call_started",
      data: {
        hermesToolCallArgumentShape: {
          targetText: { present: true, lengthBucket: "length:21-200" }
        }
      }
    });
    expect(JSON.stringify(event && "data" in event ? event.data : event)).not.toContain(targetText);
  });

  it("renders four highlights as four visible list items even with an empty description", () => {
    const current = {
      description: "",
      highlights: ["A", "B", "C", "D"],
      outcomes: [],
      tools: [],
      background: ""
    };
    const html = experienceDocumentToEditorHtml(current);
    const parsed = editorHtmlToExperienceDocument(html, current);
    expect((html.match(/<li(?:\s|>)/giu) ?? [])).toHaveLength(4);
    expect(experienceEditorContentCounts(html)).toMatchObject({
      descriptionParagraphs: 0,
      highlights: 4,
      outcomes: 0
    });
    expect(parsed).toMatchObject({ description: "", highlights: ["A", "B", "C", "D"], outcomes: [] });
  });

  it("exposes canonical, editor, rendered and general-resume count slots with build markers", () => {
    const integrity = buildProfileContentIntegrity({
      profile: demoCareerProfile,
      editorProjection: {
        description: "",
        highlights: ["A", "B", "C", "D"],
        outcomes: [],
        tools: [],
        background: ""
      },
      renderedEditorCounts: { highlights: 4 }
    });
    expect(integrity).toMatchObject({
      profileId: demoCareerProfile.id,
      revision: demoCareerProfile.version,
      editorProjection: { itemCount: 1, bulletCount: 4, paragraphCount: 0 },
      renderedEditor: { visibleBulletCount: 4, visibleParagraphCount: 0 },
      generalResume: { projectBulletCount: 0, workBulletCount: 0 }
    });
    expect(integrity.appBuildCommit).toBeTruthy();
    expect(integrity.appBuildTimestamp).toBeTruthy();
    expect(integrity.careerToolContractVersion).toBeTruthy();
  });
});
