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
});
