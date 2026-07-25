import { describe, expect, it } from "vitest";
import { routeAgentIntent } from "@/agent/runtime/agentIntentRouter";

describe("agent intent router", () => {
  it("routes high-confidence job ingestion before the planner", () => {
    const routed = routeAgentIntent("我要录入岗位", { activeWorkflowId: "build_resume_from_profile" });
    expect(routed).toMatchObject({
      kind: "workflow_control",
      action: { type: "switch_workflow", workflowId: "job_ingestion", preserveCurrent: true }
    });
  });

  it("routes cancel to workflow control instead of conversation input", () => {
    const routed = routeAgentIntent("确认取消", { activeWorkflowId: "job_ingestion" });
    expect(routed).toMatchObject({
      kind: "workflow_control",
      action: { type: "cancel_workflow", workflowId: "job_ingestion" }
    });
  });

  it("routes composer shortcuts to UI actions", () => {
    expect(routeAgentIntent("选择简历")).toMatchObject({ kind: "ui_action", action: { type: "open_resume_picker" } });
    expect(routeAgentIntent("打开工具")).toMatchObject({ kind: "ui_action", action: { type: "open_tool_palette" } });
  });
});

