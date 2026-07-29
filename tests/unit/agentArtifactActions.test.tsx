import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentArtifactContent } from "@/components/agent/artifacts/AgentArtifactContent";
import type { AgentTaskState } from "@/agent/contracts/agentSession";

describe("Agent artifact decisions", () => {
  it("dispatches profile candidate rejection as a typed action", () => {
    const onArtifactAction = vi.fn();
    const onImportAction = vi.fn();
    render(
      <AgentArtifactContent
        state={{
          step: "select_resume",
          busy: false,
          diffs: [],
          confirmedRequirementIds: []
        }}
        taskState={{
          rootGoal: "profile_intake",
          knownSlots: {
            intakeArtifact: {
              recognized: [],
              needsConfirmation: [{
                id: "candidate-deep-tutor",
                label: "DeepTutor",
                reason: "可能是对比产品"
              }],
              duplicates: [],
              additions: [],
              sources: []
            }
          }
        } as unknown as AgentTaskState}
        onArtifactAction={onArtifactAction}
        onImportAction={onImportAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "忽略" }));

    expect(onArtifactAction).toHaveBeenCalledWith({
      type: "profile_intake_candidate_decision",
      candidateId: "candidate-deep-tutor",
      decision: "reject"
    });
    expect(onImportAction).not.toHaveBeenCalled();
  });

  it("renders rich career asset review in user language with grounded detail actions", () => {
    const onArtifactAction = vi.fn();
    const onImportAction = vi.fn();
    render(
      <AgentArtifactContent
        state={{ step: "select_resume", busy: false, diffs: [], confirmedRequirementIds: [] }}
        taskState={{
          rootGoal: "profile_intake",
          knownSlots: {
            intakeArtifact: {
              candidates: [{
                id: "candidate-tidenote",
                sectionType: "project",
                label: "TideNote",
                time: "2026-02 — 2026-05",
                organization: "个人项目",
                role: "开发者",
                professionalDescription: "使用 Rust 实现本地索引，并使用 Tauri 构建桌面界面。",
                highlights: ["完成离线搜索流程。"],
                toolsOrMethods: ["Rust", "Tauri"],
                outcomes: ["交付可运行桌面应用。"],
                sources: ["我用 Rust 写本地索引，用 Tauri 做桌面界面。"],
                status: "ai_review",
                confidence: 0.9
              }],
              recognized: [],
              needsConfirmation: [{ id: "candidate-tidenote", label: "TideNote", reason: "AI 已整理" }],
              duplicates: [],
              additions: [],
              sources: []
            }
          }
        } as unknown as AgentTaskState}
        onArtifactAction={onArtifactAction}
        onImportAction={onImportAction}
      />
    );

    expect(screen.getByText("项目")).toBeVisible();
    expect(screen.getByText("AI 整理待确认")).toBeVisible();
    expect(screen.getByText(/2026-02/)).toBeVisible();
    expect(screen.getByText(/使用 Rust 实现本地索引/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "补充细节" }));
    expect(onImportAction).toHaveBeenCalledWith("补充“TideNote”最有价值的细节");
    expect(screen.queryByText(/operationId|expectedVersion|structuredPatch/)).not.toBeInTheDocument();
  });
});
