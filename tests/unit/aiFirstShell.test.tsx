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

  it("keeps shortcuts disabled until the session is ready", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<AgentQuickStartCards onSelect={onSelect} disabled />);
    const button = screen.getByRole("button", { name: /从零整理我的经历/ });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<AgentQuickStartCards onSelect={onSelect} disabled={false} />);
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("build_profile_from_scratch");
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
        state="overlay"
        workflowState={{ step: "select_resume", busy: false, diffs: [], confirmedRequirementIds: [] }}
        onStateChange={onStateChange}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "关闭任务产物" }).at(-1)!);
    expect(onStateChange).toHaveBeenCalledWith("closed");
    expect(artifacts).toHaveLength(1);
  });

  it("selects a requested artifact and leaves later manual tab selection intact", () => {
    const shared = { entityType: "job" as const, status: "active" as const,
      createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z" };
    const artifacts = [
      { ...shared, id: "impact", kind: "resume_impact" as const, title: "经历与岗位影响", entityId: "impact-1" },
      { ...shared, id: "fit", kind: "job_fit_overview" as const, title: "岗位匹配分析", entityId: "job-1" }
    ];
    const request = { id: "fit" };
    const props = { artifacts, state: "split" as const,
      workflowState: { step: "select_resume" as const, busy: false, diffs: [], confirmedRequirementIds: [] }, onStateChange: vi.fn() };
    const { rerender } = render(<AgentArtifactDrawer {...props} requestedArtifact={request} />);
    expect(screen.getByRole("tab", { name: "岗位匹配分析" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "经历与岗位影响" }));
    rerender(<AgentArtifactDrawer {...props} artifacts={[...artifacts]} requestedArtifact={request} />);
    expect(screen.getByRole("tab", { name: "经历与岗位影响" })).toHaveAttribute("aria-selected", "true");
    rerender(<AgentArtifactDrawer {...props} requestedArtifact={{ id: "fit" }} />);
    expect(screen.getByRole("tab", { name: "岗位匹配分析" })).toHaveAttribute("aria-selected", "true");
  });

  it("expands a collapsed desktop artifact rail back to split and renders no backdrop", () => {
    const onStateChange = vi.fn();
    const artifacts = [{
      id: "artifact-split-1", kind: "tailoring_diff" as const, title: "修改预览",
      entityType: "tailoring_session" as const, entityId: "tailoring-1", status: "active" as const,
      summary: "待核对", createdAt: "2026-08-02T10:00:00.000Z", updatedAt: "2026-08-02T10:00:00.000Z"
    }];
    const { rerender } = render(<AgentArtifactDrawer
      artifacts={artifacts}
      state="collapsed"
      workflowState={{ step: "preview_changes", busy: false, diffs: [], confirmedRequirementIds: [] }}
      onStateChange={onStateChange}
    />);
    fireEvent.click(screen.getByRole("button", { name: /展开任务产物/ }));
    expect(onStateChange).toHaveBeenCalledWith("split");
    rerender(<AgentArtifactDrawer
      artifacts={artifacts}
      state="split"
      workflowState={{ step: "preview_changes", busy: false, diffs: [], confirmedRequirementIds: [] }}
      onStateChange={onStateChange}
    />);
    expect(document.querySelector(".agent-artifact-drawer.is-split")).toBeInTheDocument();
    expect(document.querySelector(".agent-artifact-backdrop")).not.toBeInTheDocument();
  });
});
