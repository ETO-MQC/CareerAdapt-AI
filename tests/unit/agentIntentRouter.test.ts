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

  it("does not open the profile browser for profile-library questions", () => {
    expect(routeAgentIntent("我的资料库中的经历丰富吗")).toMatchObject({ kind: "llm" });
    expect(routeAgentIntent("看看资料库里有哪些项目经历")).toMatchObject({ kind: "llm" });
  });

  it("still routes explicit profile resume assembly and explicit profile browsing", () => {
    expect(routeAgentIntent("从资料库组装简历")).toMatchObject({
      kind: "workflow_control",
      action: { type: "start_workflow", workflowId: "build_resume_from_profile" }
    });
    expect(routeAgentIntent("打开资料库")).toMatchObject({
      kind: "ui_action",
      action: { type: "open_profile_browser" }
    });
  });
});
