import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  createQuickActionIntent,
  AGENT_QUICK_ACTION_INTENTS
} from "@/agent/contracts/agentQuickAction";
import {
  serializeAgentPageContext
} from "@/agent/contracts/agentContext";
import {
  persistWorkspaceMode,
  readWorkspaceMode,
  WORKSPACE_MODE_STORAGE_KEY
} from "@/services/preferences/workspaceMode";
import { AgentQuickStartCards } from "@/components/agent/AgentQuickStartCards";
import { AgentArtifactDrawer } from "@/components/agent/artifacts/AgentArtifactDrawer";

describe("AI-first workspace foundations", () => {
  it("defaults to AI mode and persists mode without changing Agent session storage", () => {
    const values = new Map<string, string>([["careeradapt.agent.activeSessionId", "session-1"]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const cookieTarget = { cookie: "" };

    expect(readWorkspaceMode(storage)).toBe("ai");
    persistWorkspaceMode("manual", storage, cookieTarget);

    expect(values.get(WORKSPACE_MODE_STORAGE_KEY)).toBe("manual");
    expect(values.get("careeradapt.agent.activeSessionId")).toBe("session-1");
    expect(cookieTarget.cookie).toContain("careeradapt_workspace_mode=manual");
  });

  it("creates a normalized quick intent for every enabled shortcut", () => {
    for (const actionId of Object.keys(AGENT_QUICK_ACTION_INTENTS) as Array<keyof typeof AGENT_QUICK_ACTION_INTENTS>) {
      expect(createQuickActionIntent(actionId)).toEqual({
        actionId,
        intent: AGENT_QUICK_ACTION_INTENTS[actionId],
        source: "zero_state",
        task: expect.objectContaining({
          rootGoal: expect.any(String),
          workflowId: expect.any(String),
          stage: expect.any(String)
        })
      });
    }
  });

  it("renders six workflow shortcuts and delegates without navigation", () => {
    const onSelect = vi.fn();
    render(<AgentQuickStartCards onSelect={onSelect} />);

    expect(screen.getAllByRole("button")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: /生成岗位定制简历/ }));
    expect(onSelect).toHaveBeenCalledWith("tailor_resume_to_job");
  });

  it("serializes explicit page context without reading the DOM", () => {
    expect(serializeAgentPageContext({
      route: "/resume",
      profileId: "profile-1",
      branchId: "branch-1",
      revisionId: "revision-2",
      jobId: "job-1",
      selectedSectionId: "experience",
      selectedItemId: "experience-1",
      selectedFieldPath: "highlights.0",
      selectedText: "已确认的项目经历",
      templateId: "modern",
      dirty: true,
      query: {}
    })).toMatchObject({
      route: "/resume",
      pathname: "/resume",
      revisionId: "revision-2",
      dirty: true
    });
  });

  it("closes an artifact drawer without mutating the artifact reference", () => {
    const onStateChange = vi.fn();
    const artifacts = [{
      id: "artifact-upload-1",
      kind: "resume_import_review" as const,
      title: "导入核对",
      entityType: "resume_import_draft" as const,
      entityId: "upload-1",
      status: "active" as const,
      summary: "等待核对",
      createdAt: "2026-07-24T10:00:00.000Z",
      updatedAt: "2026-07-24T10:00:00.000Z"
    }];
    render(
      <AgentArtifactDrawer
        artifacts={artifacts}
        state="open"
        workflowState={{ step: "select_resume", busy: false, diffs: [], confirmedRequirementIds: [] }}
        onStateChange={onStateChange}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "关闭任务产物" }).at(-1)!);
    expect(onStateChange).toHaveBeenCalledWith("closed");
    expect(artifacts).toHaveLength(1);
  });
});
